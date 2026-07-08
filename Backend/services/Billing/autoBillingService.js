/**
 * autoBillingService.js
 * Event-driven billing engine — every clinical action fires a BillingTrigger
 * that either immediately bills or waits for completion before billing.
 *
 * Rules of engagement (as of redesign-1):
 *
 *   BED CHARGES        — daily, priced from the bed's room-category
 *                        `defaultPricing.perBedDailyRate`. Falls back to the
 *                        flat ServiceMaster default if the category is
 *                        missing a rate. Dedup'd by `admissionId+date`.
 *
 *   NURSING DAILY FEE  — daily, priced from the bed's room-category
 *                        `defaultPricing.nursingCharges`. Same daily cadence
 *                        as the bed charge. ICU/HDU patients get the higher
 *                        category nursing fee automatically. Bed-side
 *                        consumables (gloves, syringes, gauze) bill
 *                        separately via `onEquipmentCharged` from
 *                        nursingChargesService.
 *
 *   DOCTOR VISITS      — one charge per doctor per round per day. Note
 *                        sub-type drives the service code:
 *                            progress + shift=morning  → DOC-MORN-ROUND
 *                            progress + shift=evening  → DOC-EVE-ROUND
 *                            progress + shift=night    → DOC-NIGHT-ROUND
 *                            consultation              → DOC-CONSULT
 *                            admission                 → DOC-ADMISSION
 *                            discharge                 → DOC-DISCHARGE
 *                        Dedup key includes the doctor's identity, so two
 *                        consultants on the same day are billed separately
 *                        (NABH multi-disciplinary care).
 *
 *   BILL FREEZE        — auto-charges flow as long as
 *                        admission.status === "Active". The moment status
 *                        flips to Discharged / Cancelled, the cron stops
 *                        firing. dischargePatient() in admissionService
 *                        invokes flushDailyChargesForAdmission() one last
 *                        time so the day-of-discharge bed + nursing get
 *                        billed before the freeze.
 */
const BillingTrigger = require("../../models/Billing/BillingTrigger");
const ServiceMaster  = require("../../models/ServiceMaster/serviceMasterModel");
const PatientBill    = require("../../models/PatientBillModel/PatientBillModel");
const ServicePricing = require("../../models/ServicePricing/ServicePricingModel");
const Admission      = require("../../models/Patient/admissionModel");
const Room           = require("../../models/bedMgmt/roomModel");
// R7bh-F3 / R7bg-6-CRIT-1: NaN guard for addItemToBill — every
// pricing branch goes through toNum() so a malformed Decimal128
// or undefined upstream value can never leak NaN into a BillItem
// (which then poisoned grossAmount/netAmount across the whole bill).
// R7bm-F6 / R7bl-2: toDec also re-exported for the onOrderCancelled
// proportional GST distribution math (Decimal128 casts on CN write).
const { toNum, toDec } = require("../../utils/money");

// R7bh-F3 / R7bg-1-CRIT-6 / NABH-CRIT-A3: every BillingTrigger.create() goes
// through this helper so the new audit trio (triggeredBy/triggeredById/
// triggeredByRole) is populated consistently. Callers pass a minimal
// `actor = { userId, name, role }` and the helper fills the trigger doc.
//
//   - cron emits  (runDailyBedChargeAccrual / flushDailyChargesForAdmission)
//     pass { name: "System", role: "Cron" }
//   - service emits inherit from orderedBy* on the caller's payload when
//     no explicit actor is given.
//
// The helper is a pure wrapper around BillingTrigger.create — every
// existing E11000 / VersionError handling stays on the caller side.
async function _emitTrigger(payload, actor = null) {
  const data = { ...payload };
  // Only populate fields that aren't already on the payload (caller can
  // override explicitly for special cases like paper-trail rows where
  // the actor differs from the orderedBy).
  if (data.triggeredBy === undefined) {
    data.triggeredBy =
      actor?.name ||
      data.orderedBy ||
      data.completedBy ||
      "System";
  }
  if (data.triggeredById === undefined) {
    data.triggeredById =
      actor?.userId ||
      actor?._id ||
      data.orderedById ||
      data.completedById ||
      null;
  }
  if (data.triggeredByRole === undefined) {
    // Map "System" + dailyDedup to "Cron" so the audit ledger can
    // distinguish a scheduled accrual from a user-initiated trigger.
    const fallbackRole = data.orderedByRole || data.completedByRole || "System";
    data.triggeredByRole = actor?.role || fallbackRole;
  }
  const trigger = await BillingTrigger.create(data);

  // R7bj-F5 / R7bi-6-TBA-CRIT-1: emit a BillingAudit row for every
  // BillingTrigger fired. Pre-R7bj the audit trail covered bill-side
  // events (payment/refund/cancel/finalise) but NOT the trigger emit
  // itself — so a 3 AM cron firing a phantom bed charge left no
  // chronological audit footprint distinct from the bill item. NABH
  // AAC.7 + GST Act §35 expect a single queryable timeline that
  // includes the originating clinical event. Best-effort: the emit
  // helper already swallows its own errors, and we wrap in a defensive
  // try anyway so the audit miss never breaks billing.
  try {
    const { emitBillingAudit } = require("../../models/Billing/BillingAudit");
    await emitBillingAudit({
      event:      "TRIGGER_EMITTED",
      UHID:       trigger.UHID,
      admissionId: trigger.admissionId,
      triggerId:  trigger._id,
      amount:     trigger.totalAmount,
      actorId:    actor?.userId || actor?._id || data.triggeredById || null,
      actorName:  actor?.name   || data.triggeredBy   || "System",
      actorRole:  actor?.role   || data.triggeredByRole || "Cron",
      reason:     `Trigger emitted: ${trigger.serviceCode || trigger.sourceType}`,
      after: {
        triggerId:           trigger._id,
        sourceType:          trigger.sourceType,
        serviceCode:         trigger.serviceCode,
        serviceName:         trigger.serviceName,
        totalAmount:         trigger.totalAmount,
        quantity:            trigger.quantity,
        sourceDocumentId:    trigger.sourceDocumentId,
        sourceDocumentModel: trigger.sourceDocumentModel,
      },
    });
  } catch (e) {
    console.warn("[autoBilling] audit emit failed (non-fatal):", e?.message || e);
  }

  return trigger;
}

// ── Service-event map: maps clinical event types → service codes ──────────────
// autoCharge: true = bill immediately when trigger created
// dailyDedup: true = only charge once per calendar day per admission
// requiresConfirmation: true = staff must confirm before billing
const EVENT_SERVICE_MAP = {
  // Nurse notes — immediate charges (nurse performed the action)
  "NurseNote:iv":        { serviceCode: "NRS-001", autoCharge: true,  dailyDedup: false },
  "NurseNote:blood":     { serviceCode: "NRS-BLD", autoCharge: false, dailyDedup: false, requiresConfirmation: true },
  "NurseNote:wound":     { serviceCode: "NRS-004", autoCharge: true,  dailyDedup: false },
  "NurseNote:skin":      { serviceCode: "NRS-005", autoCharge: true,  dailyDedup: false },
  "NurseNote:procedure": { serviceCode: null,      autoCharge: false, requiresConfirmation: true },
  "NurseNote:vitals":    { serviceCode: "NRS-009", autoCharge: true,  dailyDedup: true  }, // RBS once/day
  "NurseNote:intake":    { serviceCode: null,      autoCharge: false  },
  "NurseNote:neuro":     { serviceCode: null,      autoCharge: false  },
  "NurseNote:pain":      { serviceCode: null,      autoCharge: false  },
  "NurseNote:fall":      { serviceCode: null,      autoCharge: false  },
  "NurseNote:discharge": { serviceCode: null,      autoCharge: false  },
  "NurseNote:general":   { serviceCode: null,      autoCharge: false  },

  // Doctor notes
  "DoctorNote:progress":    { serviceCode: "CON-001", autoCharge: true,  dailyDedup: true  }, // doctor visit/day
  "DoctorNote:assessment":  { serviceCode: "CON-001", autoCharge: true,  dailyDedup: true  },
  "DoctorNote:admission":   { serviceCode: "CON-001", autoCharge: true,  dailyDedup: false },

  // MAR drug administration — charge the drug/injection fee if service exists
  "MAR:administered":       { serviceCode: null, dynamicLookup: true, autoCharge: true, dailyDedup: false },

  // Investigation — bill when order RESULTED
  "Investigation:ordered":  { serviceCode: null, dynamicLookup: true, autoCharge: false, dailyDedup: false },
  "Investigation:resulted": { serviceCode: null, dynamicLookup: true, autoCharge: true,  dailyDedup: false },

  // Equipment/consumables (from nursing charges) — always immediate
  "Equipment:used":         { serviceCode: null, dynamicLookup: true, autoCharge: true,  dailyDedup: false },
};

// ── Helper: get date key YYYY-MM-DD in the hospital's local timezone ─────────
// Previously used `toISOString().slice(0,10)`, which yields a UTC date. India
// is UTC+5:30, so an order placed between 18:30 UTC and 23:59 UTC on day N
// (which is 00:00–05:29 IST on day N+1) would land under day N — opening a
// 5.5-hour window where the dedup'd "once-per-day" bed/insulin charge could
// either double-fire or get silently skipped around midnight IST.
// Override with HOSPITAL_TZ in .env if deployed outside India.
const HOSPITAL_TZ = process.env.HOSPITAL_TZ || "Asia/Kolkata";
const DATE_KEY_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: HOSPITAL_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const getDateKey = (d = new Date()) => DATE_KEY_FMT.format(d);

// ── Helper: find ServiceMaster by code ───────────────────────────────────────
async function findServiceByCode(code) {
  if (!code) return null;
  return ServiceMaster.findOne({ serviceCode: code, isActive: true }).lean();
}

// ── Helper: walk admission → room → category to get pricing ──────────────────
// Returns { bedRate, nursingRate, categoryCode, categoryName, roomType }
// for the room the patient is currently in. Returns zero rates if the
// patient has no bed (OPD / Services stub) or if the category is missing
// pricing — the caller falls back to whatever ServiceMaster has.
async function resolveBedAndNursingRates(admission, opts = {}) {
  // R7hr-12-S2 (D10-06): optional `_roomCacheById` lets the batched cron
  // skip the Room.findById().populate() round-trip when the cron driver
  // has already preloaded every active admission's room+category in one
  // shot (runDailyBedChargeAccrual). Discharge / on-demand / backfill
  // callers omit the cache and fall through to the original query path.
  const { _roomCacheById } = opts || {};
  const empty = { bedRate: 0, nursingRate: 0, categoryCode: null, categoryName: null, roomType: null };
  if (!admission?.roomId) return empty;
  try {
    // R7hr-12-S2 (D10-06): cache lookup. When the cron passes a
    // preloaded Map it has already pulled every active admission's
    // Room+RoomCategory in one $in find — absence is authoritative
    // (room was deleted between cache-warm and now, or admission.roomId
    // is stale). Non-cron callers omit the Map and take the original
    // per-call findById path unchanged.
    let room;
    if (_roomCacheById instanceof Map) {
      room = _roomCacheById.get(String(admission.roomId)) || null;
    } else {
      room = await Room.findById(admission.roomId).populate("roomCategory").lean();
    }
    const cat = room?.roomCategory;
    if (!cat) return empty;
    return {
      bedRate:     Number(cat.defaultPricing?.perBedDailyRate) || 0,
      nursingRate: Number(cat.defaultPricing?.nursingCharges)   || 0,
      categoryCode: cat.categoryCode || null,
      categoryName: cat.categoryName || null,
      roomType:     cat.roomType     || null,
    };
  } catch (e) {
    console.error("[AutoBilling] resolveBedAndNursingRates error:", e.message);
    return empty;
  }
}

// ── R7en helper: resolve full charge matrix from RoomCategoryCharges ─────────
// Returns the eight-field charge sheet from the new per-category matrix
// (Backend/models/admin/RoomCategoryChargesModel.js). Falls back to a
// minimal { bedRent, nursingCharge } shape derived from the legacy
// RoomCategory.defaultPricing when no matrix row exists — so an
// admission whose bed category hasn't been migrated yet still bills
// the old two-line set (no silent revenue loss on the cron flip).
//
// Output shape:
//   {
//     matched:        boolean   — true if a RoomCategoryCharges row matched
//     categoryCode:   "GENW" | "PVT" | ...
//     categoryName:   "Private Room" | ...
//     roomType:       legacy enum for serviceCode tagging
//     chargingRule:   "Full" | "HalfOnAdmission" | "HalfOnDischarge" | "HalfBoth"
//     charges: {
//       bedRent, nursingCharge, doctorVisitCharge, rmoCharge,
//       monitoringCharge, dieteticsCharge, housekeepingCharge, linenCharge
//     }
//   }
async function resolveRoomCategoryChargeMatrix(admission, opts = {}) {
  // R7hr-12-S2 (D10-06): optional caches plumbed in by the batched cron
  // (runDailyBedChargeAccrual). When `_roomCacheById` is provided the
  // Room+RoomCategory lookup short-circuits to a Map.get; when
  // `_matrixCacheByCategoryCode` is provided the RoomCategoryCharges
  // findOne short-circuits the same way. Callers who don't pass caches
  // (discharge flush, on-demand recalc, backfill) get the original
  // per-call query path — preserves zero behaviour change off the cron.
  const { _roomCacheById, _matrixCacheByCategoryCode } = opts || {};
  const legacy = await resolveBedAndNursingRates(admission, { _roomCacheById });
  const empty = {
    matched: false,
    categoryCode: legacy.categoryCode,
    categoryName: legacy.categoryName,
    roomType:     legacy.roomType,
    chargingRule: "HalfBoth",
    charges: {
      bedRent:           legacy.bedRate     || 0,
      nursingCharge:     legacy.nursingRate || 0,
      doctorVisitCharge: 0,
      rmoCharge:         0,
      monitoringCharge:  0,
      dieteticsCharge:   0,
      housekeepingCharge:0,
      linenCharge:       0,
    },
  };
  if (!legacy.categoryCode) return empty;
  try {
    const codeKey = String(legacy.categoryCode).toUpperCase();
    // R7hr-12-S2 (D10-06): cache lookup. When the cron passes a
    // preloaded Map it has already pulled every active RoomCategoryCharges
    // row in one shot (same filter we'd use here) — so the absence of a
    // categoryCode in the Map is authoritative and we DON'T fall through
    // to findOne. Non-cron callers (discharge flush, backfill, on-demand)
    // omit the Map and take the live findOne path unchanged.
    let row;
    if (_matrixCacheByCategoryCode instanceof Map) {
      row = _matrixCacheByCategoryCode.get(codeKey) || null;
    } else {
      const RoomCategoryCharges = require("../../models/Admin/RoomCategoryChargesModel");
      row = await RoomCategoryCharges.findOne({
        categoryCode: codeKey,
        active:       true,
        effectiveTo:  null,
      }).lean();
    }
    if (!row) return empty;
    return {
      matched: true,
      categoryCode: row.categoryCode,
      categoryName: row.categoryName || legacy.categoryName,
      roomType:     legacy.roomType,
      chargingRule: row.chargingRule || "HalfBoth",
      charges: {
        bedRent:           Number(row.charges?.bedRent           || 0),
        nursingCharge:     Number(row.charges?.nursingCharge     || 0),
        doctorVisitCharge: Number(row.charges?.doctorVisitCharge || 0),
        rmoCharge:         Number(row.charges?.rmoCharge         || 0),
        monitoringCharge:  Number(row.charges?.monitoringCharge  || 0),
        dieteticsCharge:   Number(row.charges?.dieteticsCharge   || 0),
        housekeepingCharge:Number(row.charges?.housekeepingCharge|| 0),
        linenCharge:       Number(row.charges?.linenCharge       || 0),
      },
    };
  } catch (e) {
    console.error("[AutoBilling] resolveRoomCategoryChargeMatrix error:", e.message);
    return empty;
  }
}

// ── R7en helper: half-day proration multiplier ──────────────────────────────
// Maps a (chargingRule, isAdmissionDay, isDischargeDay) tuple to a 0.5 or 1
// multiplier. The cron call site computes `isAdmissionDay` from the
// admission.admissionDate vs the day cursor, and `isDischargeDay` from
// admission.actualDischargeDate (when present) vs the cursor.
function halfDayMultiplier(chargingRule, { isAdmissionDay, isDischargeDay }) {
  const rule = chargingRule || "HalfBoth";
  if (rule === "Full") return 1;
  if (rule === "HalfOnAdmission" && isAdmissionDay) return 0.5;
  if (rule === "HalfOnDischarge" && isDischargeDay) return 0.5;
  if (rule === "HalfBoth"        && (isAdmissionDay || isDischargeDay)) return 0.5;
  return 1;
}

// ── R7en helper: serviceCode + category mapping for each line item ──────────
// Single source of truth so the cron, the override paths, and the
// ServiceMaster duplicate audit all stay aligned. Skip-zero short-circuits
// at the call site — there's no "bill ₹0" line, the trigger isn't emitted.
const ROOM_CATEGORY_LINE_ITEMS = [
  // [chargesKey,         serviceCode prefix,    serviceName label,             billCategory]
  ["bedRent",             "BED",                 "Bed Charge",                  "ROOM"],
  ["nursingCharge",       "NURSING",             "Nursing Care",                "NURSING"],
  ["doctorVisitCharge",   "DOC-VISIT",           "Doctor Daily Visit",          "DOCTOR_VISIT"],
  ["rmoCharge",           "RMO",                 "RMO Attendance",              "DOCTOR_VISIT"],
  ["monitoringCharge",    "ICU-MONITOR",         "Continuous Monitoring",       "ICU_MONITORING"],
  ["dieteticsCharge",     "DIET",                "Clinical Dietetics",          "DIET"],
  ["housekeepingCharge",  "HOUSEKEEPING",        "Housekeeping",                "HOUSEKEEPING"],
  ["linenCharge",         "LINEN",               "Linen / Laundry",             "LINEN"],
];

// ── Helper: map doctor note (type + shift) → billable visit code ─────────────
// One charge per doctor per round per day. The dedup-by-doctor flag ensures
// two consultants on the same day each get a separate line.
//
// Emergency window detection: the after-hours threshold is currently
// hard-coded at 20:00 (8 PM). Hospitals doing genuine night rounds at
// 22:00–23:00 can later make this configurable per-hospital, but the
// 8 PM cutoff matches the typical Indian ward routine: morning round
// 8–10 AM, evening round 5–7 PM, anything later is unscheduled.
const EMERGENCY_HOUR_START = 20;  // 20:00 = 8 PM

function resolveDoctorVisitCode(noteType, shift, opts = {}) {
  const nt = String(noteType || "").toLowerCase();
  const sh = String(shift || "").toLowerCase();
  if (nt === "consultation") return { code: "DOC-CONSULT",      name: "Inter-department Consultation", dailyDedup: false, dedupByDoctor: true };
  // R7hr-191 (USER): "DOC-ADMISSION aur DOC-DISCHARGE ye charges
  // applicable nahi honge according to our system." Admission and
  // discharge notes are documentation milestones, not billable doctor
  // visits — retired at the mapping itself so they stay dead even if
  // DOCTOR_NOTE_BILLING_ENABLED (R7hr-190) is ever flipped back on.
  if (nt === "admission" || nt === "discharge") return null;
  if (nt === "icu")          return { code: "DOC-ICU-VISIT",    name: "ICU Doctor Visit",              dailyDedup: true,  dedupByDoctor: true };
  if (nt === "procedure" || nt === "operative" || nt === "preop" || nt === "postop") {
    // Procedure billing happens via its own ServiceMaster lookup elsewhere
    // — don't double-charge a generic visit on top of the procedure fee.
    return null;
  }

  // ── Emergency / after-hours fork ──────────────────────────────────
  // A doctor coming back AFTER the regular evening round (>= 20:00) for
  // an unplanned visit (i.e. a routine round has already been billed
  // today by this same doctor) should fire DOC-EMERGENCY-VISIT instead
  // of a 2nd round charge. The dedup-by-doctor on the regular codes
  // would otherwise skip the trigger silently — the hospital would
  // lose the chargeable event. Emergency has no daily dedup so a doctor
  // can fire multiple emergency visits the same night if the patient
  // crashes more than once.
  const hour = (opts.now ? new Date(opts.now) : new Date()).getHours();
  if (opts.isRepeatToday && hour >= EMERGENCY_HOUR_START) {
    return { code: "DOC-EMERGENCY-VISIT", name: "Emergency Consultant Visit (After Hours)",
             dailyDedup: false, dedupByDoctor: false };
  }

  // Routine round notes (progress, daily, assessment, general) — shift-based.
  if (/evening/.test(sh)) return { code: "DOC-EVE-ROUND",   name: "Doctor Evening Round", dailyDedup: true, dedupByDoctor: true };
  if (/night/.test(sh))   return { code: "DOC-NIGHT-ROUND", name: "Doctor Night Round",   dailyDedup: true, dedupByDoctor: true };
  // morning / afternoon / unspecified all fall into morning-round
  return { code: "DOC-MORN-ROUND", name: "Doctor Morning Round", dailyDedup: true, dedupByDoctor: true };
}

// ── Helper: find ServiceMaster by name (fuzzy) ───────────────────────────────
async function findServiceByName(name, patientType = "IPD") {
  if (!name) return null;
  const regex = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  return ServiceMaster.findOne({
    serviceName: regex, isActive: true,
    $or: [{ applicableTo: patientType }, { applicableTo: "ALL" }],
  }).lean();
}

// ── Helper: batch fuzzy-find a list of service names in a single query ────────
// Returns a Map<originalName, service|null> preserving the same first-match
// regex semantics as findServiceByName. Used to collapse per-test N+1 loops
// in the investigation handlers below.
async function findServicesByNamesBatch(names, patientType = "IPD") {
  const result = new Map();
  const clean = (names || []).filter(Boolean);
  if (!clean.length) return result;

  const escaped = clean.map((n) =>
    n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  );
  const services = await ServiceMaster.find({
    isActive: true,
    $and: [
      {
        $or: escaped.map((p) => ({
          serviceName: { $regex: p, $options: "i" },
        })),
      },
      {
        $or: [{ applicableTo: patientType }, { applicableTo: "ALL" }],
      },
    ],
  }).lean();

  for (let i = 0; i < clean.length; i++) {
    const re = new RegExp(escaped[i], "i");
    result.set(clean[i], services.find((s) => re.test(s.serviceName)) || null);
  }
  return result;
}

// ── Helper: get or create draft bill for admission ────────────────────────────
async function getOrCreateBill(admissionId, patientType) {
  const admission = await Admission.findById(admissionId).lean();
  if (!admission) {
    console.warn(`[AutoBilling] getOrCreateBill — admission ${admissionId} not found`);
    return null;
  }
  // billingService.js exports an INSTANCE — use directly, no `new`.
  const billingService = require("./billingService");
  try {
    return await billingService.getOrCreateDraftBill(
      admission.UHID,
      patientType || "IPD",
      admissionId.toString()
    );
  } catch (e) {
    // FIX (E2E test caught this): the previous `catch { return null }`
    // silently swallowed every billing failure, leaving the upstream
    // trigger forever in status="completed" with billId=undefined and
    // NO breadcrumb on the bill or in logs. The audit UI would show
    // "trigger fired" but the user would see "no bill" with no way to
    // diagnose. Log the error with context so future failures are
    // visible to the operator AND a downstream sweeper can retry.
    try {
      const { logErr } = require("../../utils/logErr");
      logErr("autoBilling", `getOrCreateDraftBill UHID=${admission.UHID} adm=${admissionId} type=${patientType}`)(e);
    } catch {
      console.error(`[AutoBilling] getOrCreateDraftBill UHID=${admission.UHID} adm=${admissionId}:`, e?.message || e);
    }
    return null;
  }
}

// ── Helper: add item to bill ──────────────────────────────────────────────────
// `source.unitPriceOverride` lets a caller inject a price computed elsewhere
// (e.g. bed rate from the room category) instead of using ServicePricing.
async function addItemToBill(bill, service, quantity, source, trigger) {
  if (!bill || !service) return null;
  try {
    let unitPrice;
    if (source.unitPriceOverride != null) {
      // R7bh-F3 / R7bg-6-CRIT-1: wrap every branch in toNum so a
      // Decimal128, BSON wrapper, or stringy "300.00" never leaks
      // NaN into the bill item. Pre-R7bh `Number(Decimal128)` returned
      // NaN, which then poisoned grossAmount/netAmount across the
      // whole bill via the pre-save aggregator.
      unitPrice = toNum(source.unitPriceOverride);
    } else {
      const pricing = await ServicePricing.getPriceFor(service._id, bill.paymentType || "CASH", bill.tpa?.toString());
      unitPrice = toNum(pricing?.finalPrice ?? service.defaultPrice ?? 0);
    }
    const qty        = Number(quantity) || 1;
    const totalAmt   = toNum(unitPrice) * qty;

    // R7bj-F5 / R7bi-6-TBA-CRIT-3: propagate GST attributes from
    // ServiceMaster to the BillItem. Pre-R7bj auto-billed lines landed
    // with isTaxable:false (schema default) regardless of the master's
    // taxPercentage — so the bill's pre-save recalcTotals computed
    // taxAmount=0 across every auto charge. The patient was undercharged
    // and the hospital under-paid GST → GST Act §31 + GSTR-1 violation.
    // The recalcTotals hook on PatientBill expects only isTaxable +
    // taxPercent + hsnSacCode here; it derives taxAmount, cgstAmount,
    // sgstAmount, igstAmount itself based on bill-level placeOfSupply.
    // PatientBill schema enforces taxPercent ∈ {0, 0.25, 3, 5, 12, 18, 28}
    // (Indian GST slabs). A ServiceMaster row with a typo / pre-GST legacy
    // value (e.g. 8, 15) would fail the bill.save() validator and dump the
    // whole bill into pending-review. Coerce off-slab values to 0 instead
    // (operator can correct the master later). Spec-canonical 18% medical
    // services slab stays untouched.
    const _GST_SLABS = new Set([0, 0.25, 3, 5, 12, 18, 28]);
    const _rawTaxPct = Number(service?.taxPercentage ?? service?.gstRate ?? 0) || 0;
    const taxPercent = _GST_SLABS.has(_rawTaxPct) ? _rawTaxPct : 0;
    const isTaxable  = taxPercent > 0;

    const item = {
      serviceId:       service._id,
      serviceCode:     service.serviceCode,
      serviceName:     service.serviceName,
      category:        service.category,
      billingType:     service.billingType,
      quantity:        qty,
      unitPrice,
      grossAmount:     totalAmt,
      discountPercent: 0, discountAmount: 0,
      netAmount:       totalAmt,
      // R7bj-F5 / R7bi-6-TBA-CRIT-3: GST propagation. taxPercent must be
      // one of {0, 0.25, 3, 5, 12, 18, 28} (PatientBill enum) — service
      // master values not in that list will fail validation, so we coerce
      // to 0 (and isTaxable=false) in that case. The 18% slab is the
      // canonical Indian medical services GST rate.
      isTaxable,
      taxPercent:      isTaxable ? taxPercent : 0,
      tpaPayableAmount:     bill.paymentType === "TPA" ? totalAmt : 0,
      patientPayableAmount: bill.paymentType === "TPA" ? 0 : totalAmt,
      chargeDate:      source.chargeDate ? new Date(source.chargeDate) : new Date(),
      appliedTariff:   bill.paymentType || "CASH",
      remarks:         source.remarks || `Auto-billed via ${source.sourceType}`,
      addedBySource:   source.addedBySource || "Auto",
      addedBy:         source.addedBy || "System",
      addedByRole:     source.addedByRole || "System",
      isAutoCharged:   true,
      // R7aw-FIX-2/D6-MED-5: stamp HSN/SAC on every auto-billed line.
      // Precedence: ServiceMaster.hsnSacCode (per-service override,
      // typically set for pharmacy/consumables) → "9993" SAC for
      // human-health services (clinical default). GST Act §31 + GSTR-1
      // need this on every taxable line; empty HSN cells block monthly
      // filing.
      hsnSacCode:      service.hsnSacCode || "9993",
      // Round-trip link — every auto-billed line carries the trigger _id
      // back so the IPD Live Billing ledger can undo/override the exact
      // bill row without scanning by serviceCode. Manual line items added
      // via the receptionist UI never set this field.
      triggerId:       trigger?._id,
    };

    // R7ab: VersionError-retry loop. The bill schema sets
    // optimisticConcurrency:true, so a concurrent saver (parallel trigger
    // fan-out, cron, manual receptionist edit) bumps __v and the second
    // save throws VersionError — losing the line item AND leaving the
    // bill's grossAmount/netAmount stale. That's the root cause of bills
    // showing ₹0 totals with non-zero billItems[] (R7aa). Retry the
    // load-push-save up to 5 times before giving up; each retry refetches
    // so the latest __v sticks.
    const MAX_RETRIES = 5;
    let attempt = 0;
    let lastErr = null;
    while (attempt < MAX_RETRIES) {
      attempt += 1;
      try {
        const freshBill = await PatientBill.findById(bill._id);
        if (!freshBill) return null;
        // FIX (audit P6-B3): closed bills are immutable.
        if (["PAID", "CANCELLED", "REFUNDED"].includes(freshBill.billStatus)) {
          console.warn(`[AutoBilling] skipping addItemToBill — bill ${freshBill._id} is ${freshBill.billStatus}`);
          if (trigger?._id) {
            const { logErr } = require("../../utils/logErr");
            await BillingTrigger.findByIdAndUpdate(trigger._id, {
              status: "skipped",
              skipReason: `Bill ${freshBill.billStatus.toLowerCase()} — no new charges accepted`,
              skippedAt: new Date(),
            }).catch(logErr("autoBilling", `mark-trigger-skipped ${trigger._id}`));
          }
          return null;
        }
        freshBill.billItems.push(item);
        await freshBill.save();
        const savedItem = freshBill.billItems[freshBill.billItems.length - 1];

        // R7bj-F5 / R7bi-6-TBA-CRIT-1: emit ITEM_ADDED audit row whenever
        // a trigger → bill line lands. Pre-R7bj only the post-finalise
        // BILL_GENERATED row existed; an auto-billed bed/nursing/MAR row
        // accruing into a DRAFT bill left no audit footprint until the
        // bill was finalised. Best-effort: emit is non-fatal.
        try {
          const { emitBillingAudit } = require("../../models/Billing/BillingAudit");
          await emitBillingAudit({
            event:      "ITEM_ADDED",
            UHID:       freshBill.UHID,
            billId:     freshBill._id,
            billNumber: freshBill.billNumber,
            triggerId:  trigger?._id,
            amount:     totalAmt,
            actorName:  source.addedBy     || "System",
            actorRole:  source.addedByRole || "System",
            reason:     `Bill line added: ${item.serviceCode} × ${qty}`,
            after: {
              billItemId: savedItem._id,
              serviceCode: item.serviceCode,
              serviceName: item.serviceName,
              quantity:    qty,
              unitPrice,
              totalAmount: totalAmt,
              isTaxable:   item.isTaxable,
              taxPercent:  item.taxPercent,
              hsnSacCode:  item.hsnSacCode,
              triggerId:   trigger?._id,
            },
          });
        } catch (e) {
          console.warn("[autoBilling] ITEM_ADDED audit emit failed (non-fatal):", e?.message || e);
        }

        return { bill: freshBill, itemId: savedItem._id, unitPrice, totalAmt };
      } catch (e) {
        lastErr = e;
        // Mongoose VersionError name === "VersionError"; some drivers
        // surface it as a generic Error with .name === "VersionError" or
        // with a "Cast to ObjectId failed" — only retry the version case.
        const isVersionErr = e?.name === "VersionError"
          || (e?.message || "").includes("No matching document found for id");
        if (!isVersionErr || attempt >= MAX_RETRIES) break;
        // Brief jittered backoff so concurrent retries don't dogpile.
        await new Promise((r) => setTimeout(r, 20 + Math.random() * 50));
      }
    }
    console.error(
      `[AutoBilling] addItemToBill failed after ${attempt} attempts on bill=${bill?._id} service=${service?.serviceCode || "(none)"} trigger=${trigger?._id || "(none)"}: ${lastErr?.name || "Error"}: ${lastErr?.message}`,
    );
    return null;
  } catch (e) {
    console.error(
      `[AutoBilling] addItemToBill outer error on bill=${bill?._id} service=${service?.serviceCode || "(none)"} trigger=${trigger?._id || "(none)"}: ${e.name || "Error"}: ${e.message}`,
    );
    return null;
  }
}

// ── Helper: create trigger and optionally bill immediately ────────────────────
async function createTrigger(config) {
  const {
    admissionId, patientId, UHID, patientType = "IPD",
    serviceCode, serviceName, serviceId, quantity = 1,
    sourceType, sourceDocumentId, sourceDocumentModel,
    // R7hr-163 — Caller-supplied idempotency key. When passed (an
    // ObjectId from the source document — e.g. NurseNote._id for blood-
    // transfusion charges), the unique partial index
    // `(sourceType, sourceRef)` on BillingTrigger enforces one-charge-
    // per-source. Without this every amend / retry / double-POST of the
    // same nurse note fired a fresh trigger. Investigation per-item
    // idempotency still needs a separate schema redesign — deferred.
    sourceRef,
    orderedBy, orderedById, orderedByRole = "System",
    completedBy, completedById, completedByRole,
    orderDetails, completionNotes,
    autoCharge = false, dailyDedup = false, requiresConfirmation = false,
    dedupByDoctor = false, // NEW — when true, dedup key includes doctor identity
    unitPriceOverride,     // NEW — bed/nursing daily rates from room category
    overrideDateKey,       // NEW — historical backfill uses past dateKey while
                           //       keeping the dailyDedup guard intact
    chargeDate,            // NEW — bill-item chargeDate (defaults to today)
    shift, department, notes,
    // R7as-FIX-4/D5-crit-1: bypass-flag for the post-TX discharge flush so
    // bed/nursing/doctor-round charges for the discharge day still land
    // even though the admission is now status:Discharged.
    _dischargingFlush = false,
    // R7bh-F3 / R7bg-1-CRIT-6 / NABH-CRIT-A3: explicit attribution trio.
    // Callers MAY pass these to label the emit precisely (e.g. cron passes
    // role:"Cron"). When omitted, _emitTrigger defaults from orderedBy*.
    triggeredBy,
    triggeredById,
    triggeredByRole,
  } = config;

  // R7u: zombie-charge guard. Reject triggers for admissions that have
  // moved to a terminal state (Cancelled / Discharged). The daily cron
  // already filters to status=Active, but manual triggers (e.g. a stray
  // /add-manual-charge after discharge, or a race where the indent
  // releases finalise AFTER the admission discharge fires) would
  // otherwise land charges on a closed file. We allow autoCharge=false
  // / requiresConfirmation paths to bypass when admissionId is missing
  // (OPD / Daycare / walk-in services use UHID only).
  if (admissionId) {
    try {
      const Admission = require("../../models/Patient/admissionModel");
      const adm = await Admission.findById(admissionId).select("status").lean();
      // R7as-FIX-4/D5-crit-1: Cancelled is always rejected. Discharged is
      // rejected UNLESS the caller is `flushDailyChargesForAdmission`'s
      // post-TX final flush (passes `_dischargingFlush:true` via opts).
      // Pre-R7as P1-21 moved flush to AFTER admission.save({status:Discharged}),
      // so every subsequent createTrigger hit this guard and SILENTLY
      // skipped bed/nursing/doctor-round charges for the discharge day —
      // revenue leakage on every IPD discharge.
      if (adm) {
        if (adm.status === "Cancelled") {
          console.warn(`[autoBilling] Rejecting trigger for Cancelled admission ${admissionId} (serviceCode=${serviceCode}, source=${sourceType})`);
          return { skipped: true, reason: "Admission is Cancelled — billing closed" };
        }
        if (adm.status === "Discharged" && !_dischargingFlush) {
          console.warn(`[autoBilling] Rejecting trigger for Discharged admission ${admissionId} (serviceCode=${serviceCode}, source=${sourceType})`);
          return { skipped: true, reason: "Admission is Discharged — billing closed" };
        }
      }
    } catch (e) {
      // Look-up failure shouldn't block the existing behaviour — log and proceed.
      console.error(`[autoBilling] admission-status lookup failed for ${admissionId}:`, e.message);
    }
  }

  const dateKey = overrideDateKey || getDateKey();

  // Daily dedup check. Doctor-round charges set dedupByDoctor=true so two
  // consulting doctors on the same day each get their own line (NABH
  // multi-disciplinary care). Without that flag the existing behaviour
  // (one-per-admission-per-day, regardless of who) is preserved for
  // bed/nursing/RBS/etc.
  if (dailyDedup && admissionId && serviceCode) {
    // R7ar-P1-18/D1-aq-06/D7-aq-03: include `pending-review` in the dedup
    // check so a stuck/silent-error trigger doesn't get duplicated on the
    // next cron tick. Pre-R7ar the partial-unique index would block create
    // but the find-then-create dedup would silently skip — leaving the
    // patient unbilled.
    const dedupQuery = {
      admissionId, serviceCode, dateKey,
      status: { $in: ["completed", "billed", "pending", "pending-review"] },
    };
    if (dedupByDoctor) {
      // Prefer ObjectId match if we have one; otherwise fall back to
      // name match. Either dimension uniquely identifies "this doctor
      // on this day for this admission".
      if (orderedById) dedupQuery.orderedById = orderedById;
      else if (orderedBy) dedupQuery.orderedBy = orderedBy;
    }
    const existing = await BillingTrigger.findOne(dedupQuery).lean();
    if (existing) {
      // R7bj-F5 / R7bi-6-TBA-CRIT-1: TRIGGER_DEDUPED audit. Low-traffic
      // event — only fires when the cron actually re-attempts a charge
      // it had already filed today, so this isn't a flood. NABH wants
      // the dedup to be queryable (so "why wasn't this billed?" can be
      // answered without grep'ing logs).
      try {
        const { emitBillingAudit } = require("../../models/Billing/BillingAudit");
        await emitBillingAudit({
          event:       "TRIGGER_DEDUPED",
          UHID:        UHID,
          admissionId: admissionId,
          triggerId:   existing._id,
          actorName:   orderedBy || "System",
          actorRole:   orderedByRole || "System",
          reason:      `Daily dedup hit on ${serviceCode} (${dateKey})`,
          after:       { skippedNewTrigger: true, winningTriggerId: existing._id, serviceCode, dateKey },
        });
      } catch (e) { /* non-fatal — emit helper already swallows */ }
      return { skipped: true, reason: "Daily dedup — already charged today", existing };
    }
  }

  // Find service if serviceCode given but no serviceId
  let resolvedService = null;
  if (serviceId) {
    resolvedService = await ServiceMaster.findById(serviceId).lean();
  } else if (serviceCode) {
    resolvedService = await findServiceByCode(serviceCode);
  }

  // Price precedence: caller override (room-category rate) → ServicePricing
  // tariff (TPA/Corporate aware, looked up inside addItemToBill) →
  // ServiceMaster.defaultPrice → 0. We store the override here on the
  // trigger so the audit row reflects exactly what the patient will pay.
  // R7bh-F3 / R7bg-6-CRIT-1: toNum-wrapped so a Decimal128 ServiceMaster
  // defaultPrice can't leak NaN into trigger.unitPrice/totalAmount and
  // (transitively) into the bill line item.
  const unitPrice   = unitPriceOverride != null
    ? toNum(unitPriceOverride)
    : toNum(resolvedService?.defaultPrice ?? 0);
  // R7hr-249 (audit: no qty floor) — a negative quantity produced a negative
  // totalAmount (a silent bill credit). Treat non-positive / NaN as 1, matching
  // the prior 0-handling.
  const totalAmount = toNum(unitPrice) * (Number(quantity) > 0 ? Number(quantity) : 1);

  // If a code was requested but ServiceMaster doesn't have it yet (common
  // for newly-introduced codes like DOC-MORN-ROUND or BED-ICU), accept
  // the trigger anyway — the bill item is fully described by serviceCode +
  // serviceName + unitPriceOverride. A nightly job can backfill missing
  // ServiceMaster rows from accumulated triggers.
  const canAutoCharge = autoCharge && (resolvedService || (serviceCode && unitPriceOverride != null && serviceName));
  const triggerStatus = canAutoCharge ? "completed" : requiresConfirmation ? "pending" : "pending";

  // R7bh-F3 / R7bg-1-CRIT-6 / NABH-CRIT-A3: derive attribution role.
  // Explicit triggeredByRole wins (cron callsites pass "Cron" explicitly).
  // Otherwise mirror orderedByRole so service-layer emits keep their
  // actor identity in the audit trail. NB: we do NOT auto-infer "Cron"
  // from sourceType because both onAdmissionCreated (Day-1 bed/nursing)
  // and the daily cron share the same sourceType+orderedByRole shape —
  // only the call site knows which it is, and runDailyBedChargeAccrual
  // / flushDailyChargesForAdmission pass triggeredByRole:"Cron" below.
  const _autoRole = triggeredByRole != null
    ? triggeredByRole
    : (orderedByRole || "System");

  const triggerData = {
    admissionId, patientId, UHID, patientType,
    serviceId:    resolvedService?._id,
    serviceCode:  resolvedService?.serviceCode || serviceCode,
    serviceName:  resolvedService?.serviceName || serviceName,
    quantity, unitPrice, totalAmount,
    // Snapshot of the rate/qty at first fire — never mutated. The
    // override path edits unitPrice/quantity/totalAmount in-place and
    // appends to overrideHistory[]; this pair lets the UI render
    // "₹600 (originally ₹500)" without diffing the history array.
    originalUnitPrice: unitPrice,
    originalQuantity:  quantity,
    sourceType, sourceDocumentId, sourceDocumentModel,
    // R7hr-163 — only stamp sourceRef when caller supplied one; partial
    // unique index on (sourceType, sourceRef) requires an ObjectId, so
    // a null/undefined would just be ignored by the partial filter.
    ...(sourceRef ? { sourceRef } : {}),
    orderedBy, orderedById, orderedByRole,
    orderedAt: new Date(),
    orderDetails,
    completedBy,   completedById,   completedByRole,
    completedAt:   completedBy ? new Date() : undefined,
    completionNotes,
    // R7bh-F3 / R7bg-1-CRIT-6: emit-actor attribution trio.
    triggeredBy:     triggeredBy   != null ? triggeredBy   : (orderedBy   || completedBy   || "System"),
    triggeredById:   triggeredById != null ? triggeredById : (orderedById || completedById || null),
    triggeredByRole: _autoRole,
    status: triggerStatus,
    autoCharged: autoCharge,
    requiresConfirmation,
    isDailyCharge: dailyDedup,
    dateKey, shift, department, notes,
  };

  // R7ap-F10/D7-04: wrap create in try/catch on E11000 — the new partial
  // unique index on (admissionId, serviceCode, dateKey) is the defence
  // against multi-instance / cron-vs-manual races where the read-side
  // dedup check above passes for both writers. When the unique index
  // fires, the loser silently reuses the winner's row.
  let trigger;
  try {
    // _emitTrigger is a thin wrapper that's a no-op when the trio is
    // already populated (above) — kept on the path so future emits stay
    // consistent and the helper has a single integration point to add
    // future audit columns to.
    trigger = await _emitTrigger(triggerData);
  } catch (e) {
    if (e.code === 11000 && dailyDedup) {
      const existing = await BillingTrigger.findOne({
        admissionId, serviceCode, dateKey,
        status: { $in: ["completed", "billed", "pending", "pending-review"] },
      });
      if (existing) {
        return { skipped: true, reason: "Daily dedup race — concurrent winner already created", existing };
      }
    }
    throw e;
  }

  // Auto-bill immediately if configured. We accept a synthetic service
  // doc (built from the trigger fields) when ServiceMaster doesn't have
  // the code yet — addItemToBill only needs name/code/category/billingType.
  if (canAutoCharge && admissionId) {
    const bill = await getOrCreateBill(admissionId, patientType);
    if (bill) {
      const serviceForItem = resolvedService || {
        _id: undefined,
        serviceCode,
        serviceName: serviceName || serviceCode,
        category: "Service",
        billingType: "PER_DAY",
        defaultPrice: unitPrice,
      };
      const result = await addItemToBill(bill, serviceForItem, quantity, {
        addedBySource: config.sourceType === "DoctorNote" ? "Doctor" :
                       config.sourceType === "NurseNote"  ? "Nurse"  :
                       config.sourceType === "MAR"        ? "Nurse"  :
                       config.sourceType === "Equipment"  ? "Nurse"  :
                       config.sourceType === "InvestigationOrder" ? "Lab" : "Auto",
        addedBy:    completedBy || orderedBy || "System",
        addedByRole: completedByRole || orderedByRole || "System",
        remarks:    `${sourceType} — ${orderDetails || serviceName || serviceCode}`,
        sourceType,
        unitPriceOverride,
        chargeDate,
      }, trigger);

      if (result) {
        await BillingTrigger.findByIdAndUpdate(trigger._id, {
          status:      "billed",
          billId:      result.bill._id,
          billItemId:  result.itemId,
          billedAt:    new Date(),
          billedBy:    completedBy || orderedBy || "System",
          unitPrice:   result.unitPrice,
          totalAmount: result.totalAmt,
        });
        return { trigger, billed: true, billId: result.bill._id };
      }
      // addItemToBill returned null even though the bill existed.
      // Flag the trigger as "pending-review" so the operator sees it
      // in the Stuck Triggers tile on the IPD Live Ledger and can
      // retry/move-it/cancel-it without it silently disappearing.
      // Most likely cause: closed/frozen bill (PAID/REFUNDED), or a
      // Decimal128 / enum validation error inside save().
      //
      // R7cm: DON'T clobber a status the inner addItemToBill flow already
      // set. When the bill is PAID / CANCELLED / REFUNDED, the inner guard
      // (≈line 437) cleanly marks the trigger as `status:"skipped"` with a
      // clear skipReason ("Bill paid — no new charges accepted") — that's
      // a LEGITIMATE business outcome, not a stuck trigger. Pre-R7cm this
      // outer block unconditionally overwrote "skipped" with
      // "pending-review", surfacing every "add-to-closed-bill" attempt as
      // an alarming red flag in the Stuck Triggers tile (e.g. Admin adds a
      // manual charge after the bill auto-finalised via advance settlement
      // — perfectly normal). Use a conditional findOneAndUpdate so the
      // skipped state is preserved atomically.
      const reason = `addItemToBill returned null for ${trigger.serviceCode} on bill ${bill?._id} (status=${bill?.billStatus})`;
      console.warn(`[AutoBilling] ${reason}`);
      const escalated = await BillingTrigger.findOneAndUpdate(
        { _id: trigger._id, status: { $ne: "skipped" } },
        { $set: { status: "pending-review", reviewReason: reason, reviewedAt: new Date() } },
        { new: true },
      ).catch(() => null);
      // R7bj-F5 / R7bi-6-TBA-CRIT-1: TRIGGER_PENDING_REVIEW audit.
      // R7cm: only emit the audit row when we actually escalated to
      // pending-review. If the trigger was already "skipped" (PAID/closed
      // bill), the inner branch's CHARGE_SKIPPED audit covers it — no
      // need to double-emit a misleading pending-review event.
      if (escalated) {
        try {
          const { emitBillingAudit } = require("../../models/Billing/BillingAudit");
          await emitBillingAudit({
            event:       "TRIGGER_PENDING_REVIEW",
            UHID:        trigger.UHID,
            admissionId: trigger.admissionId,
            triggerId:   trigger._id,
            billId:      bill?._id,
            amount:      trigger.totalAmount,
            actorName:   "AutoBilling",
            actorRole:   "System",
            reason,
            after:       { status: "pending-review", serviceCode: trigger.serviceCode, billStatus: bill?.billStatus },
          });
        } catch (_) { /* non-fatal */ }
      }
    } else {
      const reason = `getOrCreateBill returned null for admission=${admissionId} patientType=${patientType}`;
      console.warn(`[AutoBilling] ${reason} — trigger ${trigger?._id} (${trigger.serviceCode}) flagged pending-review`);
      await BillingTrigger.findByIdAndUpdate(trigger._id, {
        status:       "pending-review",
        reviewReason: reason,
        reviewedAt:   new Date(),
      }).catch(() => { /* best-effort flag */ });
      // R7bj-F5 / R7bi-6-TBA-CRIT-1: TRIGGER_PENDING_REVIEW audit (bill-missing branch).
      try {
        const { emitBillingAudit } = require("../../models/Billing/BillingAudit");
        await emitBillingAudit({
          event:       "TRIGGER_PENDING_REVIEW",
          UHID:        trigger.UHID,
          admissionId: trigger.admissionId,
          triggerId:   trigger._id,
          amount:      trigger.totalAmount,
          actorName:   "AutoBilling",
          actorRole:   "System",
          reason,
          after:       { status: "pending-review", serviceCode: trigger.serviceCode },
        });
      } catch (_) { /* non-fatal */ }
    }
  }

  return { trigger, billed: false };
}

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC EVENT HANDLERS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Fire when a nurse note is saved
 * @param {Object} noteDoc - saved NurseNote document
 */
async function onNurseNoteSaved(noteDoc) {
  if (!noteDoc) return;
  const noteType = noteDoc.noteType || "general";
  const mapKey   = `NurseNote:${noteType}`;
  const mapping  = EVENT_SERVICE_MAP[mapKey];
  if (!mapping || (!mapping.serviceCode && !mapping.dynamicLookup)) return;

  const admissionId = noteDoc.admissionId || await resolveAdmissionId(noteDoc);
  if (!admissionId) return;

  const nurseName = noteDoc.nurseName || "Nursing Staff";

  try {
    await createTrigger({
      admissionId,
      patientId:   noteDoc.patientId,
      UHID:        noteDoc.patientUHID || noteDoc.UHID,
      patientType: "IPD",
      serviceCode: mapping.serviceCode,
      sourceType:  "NurseNote",
      sourceDocumentId:    noteDoc._id,
      sourceDocumentModel: "NurseNote",
      // R7hr-163 — One NurseNote = at most one billing trigger. Without
      // this key, amending / re-saving / a double-POST of the same blood-
      // transfusion or RBS note silently created a second ₹1,500 charge.
      // Partial unique index on (sourceType, sourceRef) enforces it.
      sourceRef:           noteDoc._id,
      orderedBy:     nurseName,
      orderedByRole: "Nurse",
      completedBy:   nurseName,
      completedByRole: "Nurse",
      orderDetails:  `${noteType} note — ${noteDoc.remarks?.slice(0, 80) || ""}`,
      completionNotes: noteDoc.remarks?.slice(0, 120),
      autoCharge:    mapping.autoCharge,
      dailyDedup:    mapping.dailyDedup,
      requiresConfirmation: mapping.requiresConfirmation,
      shift:         noteDoc.shift,
    });
  } catch (e) {
    // E11000 duplicate-key from the unique (sourceType, sourceRef) index
    // is the expected outcome on a re-save/amend — log at info level
    // (not error) so ops doesn't get noise. Same for any other duplicate.
    if (e?.code === 11000) {
      console.info(`[AutoBilling] onNurseNoteSaved deduped (sourceRef match) for note ${noteDoc._id}`);
    } else {
      console.error("[AutoBilling] onNurseNoteSaved error:", e.message);
    }
  }
}

/**
 * Fire when a doctor note is saved.
 *
 * Charges are differentiated by note sub-type + shift so the bill shows
 * what the doctor actually did, not a single opaque "consultation" line:
 *   - progress / daily / assessment + shift → MORN-ROUND / EVE-ROUND / NIGHT-ROUND
 *   - consultation                            → DOC-CONSULT (separate per consultant)
 *   - admission                               → DOC-ADMISSION
 *   - discharge                               → DOC-DISCHARGE
 *   - icu                                     → DOC-ICU-VISIT (higher tariff)
 *   - procedure / operative / preop / postop  → no visit charge (procedure code handles it)
 *
 * Dedup is per-doctor-per-day, so multiple consultants attending the
 * same admission on the same day each generate their own line (NABH
 * multi-disciplinary care reporting).
 */
// R7hr-190 (USER): "hum doctor ke liye room matrix se hi kaam karenge."
// Doctor attendance is billed ONLY via the per-room daily DOC-VISIT-*
// line that DailyRoomAccrual raises from the RoomCategoryCharges
// matrix. The per-note charges this hook used to raise (DOC-MORN/EVE/
// NIGHT-ROUND, DOC-ICU-VISIT, DOC-CONSULT, DOC-EMERGENCY-VISIT,
// DOC-ADMISSION, DOC-DISCHARGE) double-billed the same attendance on
// note-writing days. Flip to true to restore per-note doctor billing —
// the R7gl/R7hr-163 cap machinery below stays retained untouched.
const DOCTOR_NOTE_BILLING_ENABLED = false;

async function onDoctorNoteSaved(noteDoc) {
  if (!noteDoc) return;
  if (!DOCTOR_NOTE_BILLING_ENABLED) {
    return; // R7hr-190 — doctor attendance bills via the room matrix only
  }
  const noteType = noteDoc.noteType || "progress";

  const admissionId = noteDoc.admissionId || await resolveAdmissionId(noteDoc);
  if (!admissionId) return;

  const doctorName = noteDoc.doctorName || noteDoc.consultantName || noteDoc.orderedBy || "Doctor";
  const doctorId   = noteDoc.doctor || noteDoc.doctorId || null;

  // Repeat-visit detection: has this doctor already triggered ANY round
  // charge today on this admission? If so AND the current time is past
  // the evening-round cutoff, resolveDoctorVisitCode will fork to
  // DOC-EMERGENCY-VISIT — the after-hours unplanned visit code.
  let isRepeatToday = false;
  try {
    const dateKey = getDateKey();
    const q = {
      admissionId, dateKey,
      serviceCode: { $in: ["DOC-MORN-ROUND", "DOC-EVE-ROUND", "DOC-NIGHT-ROUND", "DOC-CONSULT", "DOC-ICU-VISIT"] },
      status: { $in: ["completed", "billed", "pending"] },
    };
    if (doctorId)        q.orderedById = doctorId;
    else if (doctorName) q.orderedBy   = doctorName;
    const existing = await BillingTrigger.findOne(q).lean();
    isRepeatToday  = !!existing;
  } catch (e) {
    // If the lookup fails the worst case is a missed-emergency charge,
    // which is a graceful degradation — better than aborting the whole
    // trigger creation. Log so the operator can investigate later.
    console.warn("[AutoBilling] repeat-visit lookup failed:", e.message);
  }

  const visit = resolveDoctorVisitCode(noteType, noteDoc.shift, { isRepeatToday });
  if (!visit) return; // procedure notes etc. bill via their own path

  // R7gl — Daily auto-bill cap on doctor visits.
  //
  // Business rule from the hospital owner: in IPD a doctor's routine
  // visit charge should auto-add at most TWICE per day (morning round
  // + evening round). Any further visit the same day MUST be entered
  // by hand from the IPD Live Ledger "Manual Charge" button so a
  // human stops to confirm the third+ event is genuinely billable
  // (could be a courtesy round, family-meeting, or a re-explained
  // procedure already covered by another code) instead of letting a
  // back-dated nursing note or a late evening progress entry quietly
  // billowing a 3rd, 4th, 5th visit fee.
  //
  // Applies to the routine-round / ICU / emergency-after-hours codes.
  // DOC-ADMISSION, DOC-DISCHARGE, DOC-CONSULT are independent
  // milestones — they bypass the cap (admission is a one-shot,
  // discharge is a one-shot, consult is a separate consultant whose
  // fee is independently negotiated and only fires once via
  // dedupByDoctor).
  const VISIT_CAP_CODES = new Set([
    "DOC-MORN-ROUND", "DOC-EVE-ROUND", "DOC-NIGHT-ROUND",
    "DOC-ICU-VISIT", "DOC-EMERGENCY-VISIT",
  ]);
  if (VISIT_CAP_CODES.has(visit.code)) {
    try {
      const dateKeyToday = getDateKey();
      // R7hr-163 — Per-shift cap, not just per-day total.
      //
      // The old query counted ALL VISIT_CAP_CODES regardless of shift,
      // then capped at 2. That fired for "1 morning + 1 evening = 2 → OK"
      // (correct) but ALSO fired for "1 morning + 1 morning = 2 → OK"
      // (incorrect — should have been blocked at the SECOND morning).
      // When two clinicians each filed a morning note on the same day
      // both rounds slipped through and double-billed.
      //
      // New rule: at most ONE round per (date, shift, codeFamily). The
      // shift identity is taken from the incoming note. ICU and
      // emergency-after-hours codes don't have a shift dimension; they
      // fall back to the legacy total-of-2 cap as before.
      const isShiftedRound = ["DOC-MORN-ROUND", "DOC-EVE-ROUND", "DOC-NIGHT-ROUND"].includes(visit.code);
      let capQuery;
      let capLimit;
      if (isShiftedRound && noteDoc.shift) {
        // Block second morning when first morning already exists; same
        // for evening / night. Only the SAME shift counts toward the cap.
        capQuery = {
          admissionId, dateKey: dateKeyToday,
          serviceCode: visit.code,
          shift: noteDoc.shift,
          status: { $nin: ["voided", "cancelled", "skipped"] },
        };
        capLimit = 1;
      } else {
        // ICU / Emergency-after-hours: legacy 2-per-day total cap.
        capQuery = {
          admissionId, dateKey: dateKeyToday,
          serviceCode: { $in: Array.from(VISIT_CAP_CODES) },
          status: { $nin: ["voided", "cancelled", "skipped"] },
        };
        capLimit = 2;
      }
      const activeVisitsToday = await BillingTrigger.countDocuments(capQuery);
      if (activeVisitsToday >= capLimit) {
        // R7hr-191 (USER): cap hit par ab koi `status:"skipped"` paper-
        // trail trigger NAHI banta — "ye sirf bad data ko badha rahe
        // hai jo system ko load karega". Pre-R7hr-191 every capped note
        // dropped a ₹0 skipped row into BillingTrigger, flooding the
        // Audit Trail (dozens per restart/backfill). Log-only now; a
        // genuine 3rd+ visit can still be added manually from the IPD
        // Live Ledger's Add Charge button.
        console.info(
          `[AutoBilling] doctor-visit cap reached — ${visit.code} not billed ` +
          `for note ${noteDoc._id} (no skipped row per R7hr-191)`,
        );
        return;
      }
    } catch (e) {
      // If the count lookup fails we'd rather under-bill than double-bill,
      // so log + fall through (the existing dailyDedup on the trigger
      // itself still protects against a same-code same-day duplicate).
      console.warn("[AutoBilling] doctor-visit cap lookup failed:", e.message);
    }
  }

  try {
    await createTrigger({
      admissionId,
      patientId:   noteDoc.patientId,
      UHID:        noteDoc.UHID || noteDoc.patientUHID,
      patientType: "IPD",
      serviceCode: visit.code,
      serviceName: visit.name,
      sourceType:  "DoctorNote",
      sourceDocumentId:    noteDoc._id,
      sourceDocumentModel: "DoctorNote",
      orderedBy:     doctorName,
      orderedById:   doctorId,
      orderedByRole: "Doctor",
      completedBy:   doctorName,
      completedById: doctorId,
      completedByRole: "Doctor",
      orderDetails:  `${visit.name} — ${doctorName}${noteType !== "progress" ? ` (${noteType})` : ""}${isRepeatToday && visit.code === "DOC-EMERGENCY-VISIT" ? " · after-hours unscheduled visit" : ""}`,
      autoCharge:    true,
      dailyDedup:    visit.dailyDedup,
      dedupByDoctor: visit.dedupByDoctor,
      shift:         noteDoc.shift,
    });
  } catch (e) {
    console.error("[AutoBilling] onDoctorNoteSaved error:", e.message);
  }
}

/**
 * Fire when a drug is administered via MAR.
 *
 * The MAR controller (marController.recordAdministration) normalises the
 * incoming status to one of: GIVEN, MISSED, HELD, REFUSED, OMITTED. We
 * only bill on GIVEN. Older clients sent "administered" — accept it for
 * back-compat so a legacy script doesn't silently stop billing drugs.
 *
 * Drug → service code resolution (in order):
 *   1. Exact ServiceMaster match by drug name (specific drugs in master)
 *   2. PHARM-<drug> fallback (every prescribed drug gets billed at the
 *      Pharmacy/Medications category even when not in the master) —
 *      keeps the IPD ledger honest about meds delivered. The unit price
 *      defaults to the medication.unitPrice / pricePerUnit if set on the
 *      MAR med row; falls back to ServiceMaster.defaultPrice for the
 *      generic NRS-INJ admin fee; final fallback is 0 so the audit row
 *      still appears (operator can override price later).
 *   3. NRS-INJ generic injection / administration fee — for parenteral
 *      drugs when no specific pharmacy line is set up.
 */
async function onMARAdministration(marDoc, medication, administrationEntry) {
  if (!marDoc || !medication) return;
  const adminStatus = String(administrationEntry?.status || "").toUpperCase();
  if (adminStatus !== "GIVEN" && adminStatus !== "ADMINISTERED") return;

  const admissionId = marDoc.admissionId;
  if (!admissionId) return;

  // Try to find a billable service matching the drug name
  const drugName = medication.drugName || medication.medicineName || medication.name || "";

  // Pricing precedence: per-medication unitPrice (if pharmacy stocked the
  // drug + the prescribed row carries a price), then ServiceMaster default,
  // then NRS-INJ generic admin fee. Quantity defaults to 1 (one dose);
  // some MARs record a doseAmount we can honour later if needed.
  let service = await findServiceByName(drugName, "IPD");
  let unitPriceOverride = null;

  // Drug name didn't match the master — fire a synthetic "PHARM-*" line
  // so the medication still appears on the bill and in the audit trail.
  // The createTrigger path accepts a synthetic service when serviceCode +
  // serviceName + unitPriceOverride are all set.
  if (!service && drugName) {
    const medPrice = Number(medication.unitPrice || medication.pricePerUnit || 0);
    if (medPrice > 0) {
      unitPriceOverride = medPrice;
      service = {
        serviceCode: `PHARM-${drugName.toUpperCase().replace(/\s+/g, "-").slice(0, 24)}`,
        serviceName: `${drugName} (per dose)`,
        category:    "PHARMACY",
        billingType: "PER_UNIT",
        defaultPrice: medPrice,
      };
    }
  }

  // Final fallback — generic injection / administration fee at the
  // nursing tariff, even if the drug name is unknown.
  if (!service) {
    service = await findServiceByCode("NRS-INJ");
  }

  if (!service) return; // No way to bill — log & move on

  // R7az-CRIT-1 (D6-CRIT-1): pharmacy double-count guard — REPAIRED.
  //
  // R7au tried to dedup MAR-administer charges against the pharmacy
  // reservation charge, but searched for sourceType ∈ ["PharmacyIndent",
  // "INDENT", "PHARM_RELEASE"] — none of which the indent-release path
  // ever wrote (it wrote "MAR", which the schema enum allowed). So the
  // dedup query NEVER matched and every dispensed-then-administered
  // drug was billed twice. R7az picks ONE canonical sourceType for the
  // pharmacy reservation row — "MAR_RESERVATION" (added to schema enum
  // in this cycle) — and updates both call sites + the dedup query to
  // line up. Pre-existing rows with the old sourceType:"MAR" stamped by
  // onIndentReleased will continue to dedup against themselves because
  // the dedup is on serviceCode+admissionId+time-window even if the
  // sourceType filter never matches them — but new rows are guaranteed
  // to dedup correctly going forward.
  //
  // R7bn-4 / D7-4-fix: tighten dedup window from 6h → 2h. The R7az
  // 6h window dedups BD (q12h) doses correctly but breaks QID (q6h):
  // the second QID dose at +6h is treated as a duplicate of the
  // first dose's pharmacy reservation. With a 2h window, only the
  // "MAR-given immediately after pharmacy-release" case dedups —
  // every subsequent dose (BD/TDS/QID/q4h) bills as a separate
  // PHARM-* MAR row. Risk: if pharmacy releases > 2h before the
  // nurse administers (rare — typically minutes), the first dose
  // will bill twice. That risk is preferable to under-billing
  // entire QID schedules.
  try {
    const BillingTrigger = require("../../models/Billing/BillingTrigger");

    // R7hr-12-S2 (D5-08): two-dimensional MAR↔reservation dedup join.
    //
    // The original guard (kept below as the fallback) joins purely on
    // (serviceCode, sourceType:"MAR_RESERVATION", admissionId, 2h
    // window). The 2-hour window is the only barrier when the
    // serviceCode axis hits — meaning:
    //   (a) a drug released > 2h before the nurse administers it
    //       (post-op morning meds after a previous-evening release)
    //       double-bills the first dose, and
    //   (b) QID/q6h schedules deliberately bill every subsequent
    //       dose as a fresh PHARM-* row (the R7bn-4 trade-off).
    //
    // To shrink (a) without re-introducing the (b) regression, look
    // up the indent items for this admission whose drugName matches
    // the MAR med — and pre-filter to UNCONSUMED reservations
    // (item.finalTriggerId is unset). If we find one, the dedup
    // succeeds independently of the 2h window AND we stamp the
    // indent item's finalTriggerId so subsequent administrations of
    // the SAME indent line won't double-match (a second admin reads
    // the indent item, sees finalTriggerId already populated, and
    // falls through to the regular emit — which is correct QID
    // behaviour: the second dose IS a fresh charge).
    //
    // Architectural note for the eventual schema fix flagged in
    // needsManualReview: stamping `reservationTriggerId` or
    // `indentItemId` directly onto AdministrationEntrySchema is
    // the cleaner long-term home for the join key — once that
    // lands, this name-based pre-filter can drop in favour of an
    // exact id-on-id join. For now the indent-side
    // finalTriggerId-stamping (existing schema slot at L78 in
    // PharmacyIndentModel.js) is the round-trip that lets us
    // dedup correctly across the 2-hour boundary.
    let matchedIndentItemId = null;
    let matchedIndentDocId = null;
    try {
      const PharmacyIndent = require("../../models/Pharmacy/PharmacyIndentModel");
      const drugNameRe = new RegExp(
        `^${drugName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
        "i",
      );
      // Look at items reserved within the last 24h that haven't yet
      // been consumed by a MAR row. The 24h horizon covers overnight
      // hold-and-dispense (evening release → next-morning admin) but
      // still bounds the query to a single recent batch.
      const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const candidateIndent = await PharmacyIndent.findOne(
        {
          admissionId,
          status: { $in: ["Released", "PartiallyReleased"] },
          releasedAt: { $gte: since24h },
          items: {
            $elemMatch: {
              drugName:             drugNameRe,
              reservationTriggerId: { $ne: null },
              finalTriggerId:       null,
            },
          },
        },
        { _id: 1, items: 1 },
      ).lean();
      if (candidateIndent?.items?.length) {
        const hit = candidateIndent.items.find(
          (it) =>
            it?.reservationTriggerId &&
            !it?.finalTriggerId &&
            drugNameRe.test(it.drugName || ""),
        );
        if (hit) {
          matchedIndentItemId = hit._id;
          matchedIndentDocId  = candidateIndent._id;
        }
      }
    } catch (lookupErr) {
      // Non-fatal — fall through to the legacy 2h serviceCode guard.
      console.warn("[AutoBilling] R7hr-12-S2 indent-item lookup skipped:", lookupErr.message);
    }

    const since = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2h (R7bn)
    // R7hr-12-S2 (D5-08): join on EITHER (serviceCode + 2h window) for
    // legacy back-compat OR (sourceDocumentId === indent item._id) for
    // the precise round-trip — whichever fires first wins. The $or
    // skips the second clause when matchedIndentItemId is null so the
    // legacy code path is preserved when the lookup didn't hit.
    const dedupOr = [
      {
        serviceCode: service.serviceCode,
        createdAt:   { $gte: since },
      },
    ];
    if (matchedIndentItemId) {
      dedupOr.push({ sourceDocumentId: matchedIndentItemId });
    }
    const reservation = await BillingTrigger.findOne({
      admissionId,
      sourceType: "MAR_RESERVATION",
      status:     { $in: ["completed", "billed", "pending"] },
      $or:        dedupOr,
    }).select("_id status sourceDocumentId").lean();
    if (reservation) {
      console.log(`[AutoBilling] onMARAdministration skipped duplicate — reservation trigger ${reservation._id} already covers ${service.serviceCode} (joinKey=${reservation.sourceDocumentId || "serviceCode+2h"})`);
      // R7hr-12-S2 (D5-08): stamp finalTriggerId on the matching indent
      // item so subsequent administrations of the SAME indent line
      // don't hit this branch again — QID's second dose then bills
      // correctly as a fresh PHARM-* row (the R7bn-4 trade-off
      // continues to hold for doses-after-the-first). If we joined via
      // the legacy serviceCode path we DON'T stamp because we can't be
      // sure we matched the right indent item — that branch keeps the
      // pre-S2 behaviour (a single dedup-skip per 2h window).
      if (matchedIndentDocId && matchedIndentItemId && reservation.sourceDocumentId
        && String(reservation.sourceDocumentId) === String(matchedIndentItemId)) {
        try {
          const PharmacyIndent = require("../../models/Pharmacy/PharmacyIndentModel");
          await PharmacyIndent.updateOne(
            { _id: matchedIndentDocId, "items._id": matchedIndentItemId, "items.finalTriggerId": null },
            { $set: { "items.$.finalTriggerId": reservation._id } },
          );
        } catch (stampErr) {
          // Non-fatal — without the stamp the next admin will still
          // dedup via the same path the first time around, just with a
          // redundant lookup.
          console.warn("[AutoBilling] R7hr-12-S2 finalTriggerId stamp failed:", stampErr.message);
        }
      }
      return;
    }
  } catch (e) {
    // Dedup lookup failed — proceed (bias toward billing, not skipping).
    console.warn("[AutoBilling] MAR-dedup lookup skipped:", e.message);
  }

  try {
    await createTrigger({
      admissionId,
      patientId:   marDoc.patientId,
      UHID:        marDoc.UHID,
      patientType: "IPD",
      serviceId:   service._id,                                // undefined for synthetic
      serviceCode: service.serviceCode,
      serviceName: service.serviceName,
      sourceType:  "MAR",
      sourceDocumentId:    marDoc._id,
      sourceDocumentModel: "MAR",
      orderedBy:     medication.prescribedBy || "Doctor",
      orderedByRole: "Doctor",
      orderedAt:     medication.startDate || marDoc.date,
      completedBy:   administrationEntry.nurseName || administrationEntry.administeredBy || "Nurse",
      completedByRole: "Nurse",
      orderDetails:  `${drugName} — ${medication.dose || ""} ${medication.route || ""}`.trim(),
      completionNotes: administrationEntry.remarks || administrationEntry.notes || "",
      autoCharge:    true,
      unitPriceOverride,
      shift:         marDoc.shift || "",
    });
  } catch (e) {
    console.error("[AutoBilling] onMARAdministration error:", e.message);
  }
}

/**
 * Read the list of test/item rows off an InvestigationOrder document
 * regardless of which generation of the model produced it.
 *
 * R7z fix: the canonical schema field is `items[]` (see
 * InvestigationOrderModel.js) and each row has `investigationName` +
 * `resultStatus`. The old service code read `tests || investigations`
 * which were never populated by the current model — that meant lab
 * billing was silently dead for the entire IPD lab workflow.
 *
 * We keep the legacy fallback so any older queued doc still works,
 * but the live path now reads `items` first.
 */
function readOrderRows(orderDoc) {
  if (!orderDoc) return [];
  const rows = orderDoc.items || orderDoc.tests || orderDoc.investigations || [];
  // Normalise to a stable shape: { name, status }
  return rows.map((r) => ({
    name: r.investigationName || r.testName || r.name || "",
    status: r.resultStatus || r.status || "",
    raw: r,
  }));
}

/**
 * Fire when an investigation is ordered
 */
async function onInvestigationOrdered(orderDoc) {
  if (!orderDoc) return;
  const admissionId = orderDoc.admissionId;
  if (!admissionId) return;

  const rows = readOrderRows(orderDoc);
  const testNames = rows.map((r) => r.name).filter(Boolean);

  // Batch-resolve all services in one query (was N+1 — one findServiceByName
  // per test). For a 30-test panel this collapses 30 round-trips into 1.
  const serviceByName = await findServicesByNamesBatch(testNames, "IPD");

  for (const row of rows) {
    const testName = row.name;
    if (!testName) continue;
    const service = serviceByName.get(testName);
    if (!service) continue;

    try {
      await createTrigger({
        admissionId,
        patientId:   orderDoc.patientId,
        UHID:        orderDoc.UHID,
        patientType: "IPD",
        serviceId:   service._id,
        serviceCode: service.serviceCode,
        serviceName: service.serviceName,
        sourceType:  "InvestigationOrder",
        sourceDocumentId:    orderDoc._id,
        sourceDocumentModel: "InvestigationOrder",
        orderedBy:     orderDoc.orderedBy || "Doctor",
        orderedByRole: "Doctor",
        orderDetails:  `Investigation ordered: ${testName}`,
        autoCharge:    false,  // bill when resulted, not when ordered
        requiresConfirmation: false,
        status:        "pending",
      });
    } catch (e) {
      console.error("[AutoBilling] onInvestigationOrdered error:", e.message);
    }
  }
}

/**
 * Fire when an investigation is resulted/completed.
 *
 * R7z: only bill triggers whose corresponding order item has actually
 * been resulted. Previously this billed EVERY pending trigger on the
 * order the moment ANY single test had a result entered — so a 20-test
 * panel was billed in full after the first CBC line was typed in,
 * even if the other 19 hadn't been run yet. Now each test bills only
 * when its own row reaches COMPLETED/VERIFIED.
 */
async function onInvestigationResulted(orderDoc) {
  if (!orderDoc) return;
  const admissionId = orderDoc.admissionId;
  if (!admissionId) return;

  const rows = readOrderRows(orderDoc);
  // Set of normalised lowercase names that have actual results entered.
  // We compare case-insensitively because ServiceMaster.serviceName and
  // InvestigationMaster.investigationName aren't guaranteed to share
  // capitalisation across all the historical data we've imported.
  const resultedNameSet = new Set(
    rows
      .filter((r) => r.status === "COMPLETED" || r.status === "VERIFIED")
      .map((r) => (r.name || "").trim().toLowerCase())
      .filter(Boolean),
  );

  // No resulted items → nothing to bill. (Happens when the controller
  // hits this hook on a partial save that didn't actually advance any
  // item's state — defensive no-op.)
  if (resultedNameSet.size === 0) return;

  // Pending triggers for this order — only the ones whose serviceName
  // matches a resulted item.
  const pendingTriggers = await BillingTrigger.find({
    sourceDocumentId: orderDoc._id,
    sourceType: "InvestigationOrder",
    status: "pending",
  });

  const billableTriggers = pendingTriggers.filter((t) =>
    resultedNameSet.has((t.serviceName || "").trim().toLowerCase()),
  );

  const bill = billableTriggers.length > 0
    ? await getOrCreateBill(admissionId, "IPD")
    : null;

  // Batch-resolve services in one query (was N+1 — one findById per trigger).
  const serviceIds = billableTriggers
    .map((t) => t.serviceId)
    .filter(Boolean);
  const services = serviceIds.length
    ? await ServiceMaster.find({ _id: { $in: serviceIds } }).lean()
    : [];
  const servicesById = new Map(services.map((s) => [String(s._id), s]));

  for (const trigger of billableTriggers) {
    const service = trigger.serviceId
      ? servicesById.get(String(trigger.serviceId)) || null
      : null;
    if (!service || !bill) continue;

    const labStaffName = orderDoc.resultedBy || orderDoc.verifiedBy || "Lab Staff";

    const result = await addItemToBill(bill, service, trigger.quantity || 1, {
      addedBySource: "Lab",
      addedBy: labStaffName,
      addedByRole: "Lab",
      remarks: `Lab result entered: ${trigger.serviceName}`,
      sourceType: "InvestigationOrder",
    }, trigger);

    if (result) {
      await BillingTrigger.findByIdAndUpdate(trigger._id, {
        status:       "billed",
        billId:       result.bill._id,
        billItemId:   result.itemId,
        billedAt:     new Date(),
        billedBy:     "Lab System",
        completedBy:  labStaffName,
        completedByRole: "Lab",
        completedAt:  new Date(),
        completionNotes: "Results entered and bill auto-generated",
      });
    }
  }

  // Catch resulted tests that never had a trigger created (e.g. items
  // added via addTest after the initial onInvestigationOrdered fan-out
  // missed them). Only fires for items that actually have a result.
  for (const row of rows) {
    const testName = row.name;
    if (!testName) continue;
    if (row.status !== "COMPLETED" && row.status !== "VERIFIED") continue;

    const exists = await BillingTrigger.findOne({
      sourceDocumentId: orderDoc._id,
      serviceName: { $regex: new RegExp(`^${testName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") },
      status: { $in: ["billed", "pending"] },
    }).lean();
    if (exists) continue;

    const service = await findServiceByName(testName, "IPD");
    if (!service) continue;

    const freshBill = bill || await getOrCreateBill(admissionId, "IPD");
    if (!freshBill) continue;

    const labStaff = orderDoc.resultedBy || "Lab Staff";

    await createTrigger({
      admissionId,
      patientId:   orderDoc.patientId,
      UHID:        orderDoc.UHID,
      patientType: "IPD",
      serviceId:   service._id,
      serviceCode: service.serviceCode,
      serviceName: service.serviceName,
      sourceType:  "InvestigationOrder",
      sourceDocumentId:    orderDoc._id,
      sourceDocumentModel: "InvestigationOrder",
      orderedBy:     orderDoc.orderedBy || "Doctor",
      orderedByRole: "Doctor",
      completedBy:   labStaff,
      completedByRole: "Lab",
      orderDetails:  `Investigation: ${testName}`,
      completionNotes: "Result auto-billed on result entry",
      autoCharge:    true,
    });
  }
}

/* ────────────────────────────────────────────────────────────────────
   R7hr-83 Phase C — auto-bill on doctor-order completion.
   Reads serviceCode/unitPrice that Phase B writes on order placement;
   fires once per (sourceType, sourceRef) to prevent double-billing on
   retry/restart.
──────────────────────────────────────────────────────────────────── */
// Maps DoctorOrder.orderType → category hint stamped on the trigger.
// NOTE: BillingTrigger schema has no top-level `category` field — the
// IPDLedger byCategory aggregator derives the category from the
// serviceCode prefix (e.g. "LAB-CBC-001" → "LAB"). We persist this map
// on the trigger's `department` field as a secondary hint and rely on
// the serviceCode set by Phase B for the canonical category bucket.
const DOCTOR_ORDER_CATEGORY_MAP = {
  Lab:              "LAB",
  Radiology:        "RADIOLOGY",
  Investigation:    "LAB",            // alias for Lab in the orderType enum
  Procedure:        "PROCEDURE",
  BloodTransfusion: "BLOOD",
  IV_Fluid:         "PHARMACY",       // IV fluids billed under pharmacy line
  Diet:             "DIET",
  Oxygen:           "OXYGEN",
  Physiotherapy:    "PHYSIO",
  Activity:         "NURSING",        // activity orders billed under nursing line
  Nursing:          "NURSING",
  Consultation:     "CONSULTATION",
  Medication:       "PHARMACY",       // safety net; pharmacy MAR path is the primary biller
};

async function onDoctorOrderCompleted(order) {
  try {
    // 1. Guards.
    if (!order || !order._id) return null;
    const od = order.orderDetails || {};
    if (!od.serviceCode || od.unitPrice == null) return null;   // no ServiceMaster pick — nothing to bill
    if (!order.admissionId) return null;                        // IPD-only path; OPD bills via Services & Orders panel

    // 2. Idempotency — one trigger per (sourceType, sourceRef).
    const existing = await BillingTrigger.findOne({
      sourceType: "DoctorOrder",
      sourceRef:  order._id,
    });
    if (existing) return existing;

    // 3. Compose the trigger doc.
    const category = DOCTOR_ORDER_CATEGORY_MAP[order.orderType] || null;
    const unitPrice  = toNum(od.unitPrice);
    const quantity   = 1;
    const totalPrice = unitPrice * quantity;
    const completedById = order.completedById || order.updatedBy || null;
    const completedByName = order.completedBy || order.updatedByName || null;

    // BillingTrigger schema stores money as Decimal128 + price/qty/name
    // at top-level (not as `lineItems[]`); the IPD ledger byCategory tab
    // derives the section from `serviceCode.split("-")[0]`, so the
    // category map above is recorded on `department` as a hint and
    // mirrored into `notes` for audit greppability. Status enum is
    // lowercase ("pending") per the schema.
    const trigger = await _emitTrigger({
      admissionId: order.admissionId,
      patientId:   order.patientId,
      UHID:        order.patientUHID || order.UHID,
      patientType: "IPD",

      // Service line.
      serviceId:   od.serviceMasterId || null,
      serviceCode: od.serviceCode,
      serviceName: od.serviceName,
      quantity,
      unitPrice,
      totalAmount: totalPrice,

      // Source linkage — sourceRef is the R7hr-83 dedup key (partial-unique
      // index on (sourceType, sourceRef) lives on the schema). We also
      // populate the legacy sourceDocumentId/Model pair so any older
      // audit/retry path that joins on those keeps working.
      sourceType:          "DoctorOrder",
      sourceRef:           order._id,
      sourceDocumentId:    order._id,
      sourceDocumentModel: "DoctorOrder",

      // Subcategory + category hint — schema has no `subCategory` field,
      // so we encode the orderType in notes and the ledger-bucket hint
      // in department.
      department: category,
      notes:      `subCategory:${order.orderType}${category ? ` · ledgerBucket:${category}` : ""}`,

      // Actor.
      orderedBy:      order.orderedBy || null,
      orderedById:    order.orderedById || null,
      orderedByRole:  order.orderedByRole || "Doctor",
      completedBy:    completedByName,
      completedById:  completedById,
      completedByRole: order.completedByRole || "Doctor",
      completedAt:    order.completedAt || new Date(),

      status: "pending",   // PatientBill picker will materialise this row
    }, completedByName ? { name: completedByName, userId: completedById, role: order.completedByRole || "Doctor" } : null);

    return trigger;
  } catch (e) {
    // Async-emit pattern (per R7gw-B4 cron-handler convention) — the
    // upstream order-completion flow cannot rollback this billing emit,
    // so we log and swallow. The next sweep / manual retry can re-fire.
    console.error("[AutoBilling] onDoctorOrderCompleted error:", e && e.message);
    return null;
  }
}

/**
 * Fire when nursing equipment / consumable is logged from
 * nursingChargesService.logItems(). Routes through the standard
 * createTrigger path so the item lands on the patient's bill (closed-bill
 * guard + audit trail) instead of just creating an orphan audit row.
 *
 * Uses unitPriceOverride from the NursingChargeEntry's stored price so
 * the bill matches exactly what the nurse logged (no surprise re-pricing
 * if the master rate changes later).
 */
async function onEquipmentCharged(chargeEntry, billItemId) {
  if (!chargeEntry) return;
  // R7gg — Idempotency guard. One Badal admission had 36,925 duplicate
  // BillingTrigger rows pointing to a SINGLE NursingChargeEntry (Foley
  // Catheter ₹300 × 1) because this hook was being re-fired by a
  // backfill / cron / retry path with no dedupe check. ₹110 lakh
  // appeared under "EQUIP" in the IPD Live Ledger as a result, the
  // category response timed out the renderer (32k+ items shipped),
  // and the receptionist's Billing Counter also froze loading the
  // same payload. Before creating yet another trigger for this
  // chargeEntry, look up whether one already exists; bail out if so.
  if (chargeEntry?._id) {
    try {
      const existing = await BillingTrigger.findOne({
        sourceDocumentId: chargeEntry._id,
        sourceDocumentModel: "NursingChargeEntry",
      }).select("_id").lean();
      if (existing) {
        // Already billed — nothing to do. Don't even log; the cron may
        // poll us many times per minute and noise would drown real errors.
        return;
      }
    } catch (e) {
      console.error("[AutoBilling] onEquipmentCharged idempotency check failed:", e.message);
      // Fall through and try to create — losing a charge is worse than
      // creating one duplicate (the same guard on the next call will
      // catch it once Mongo is healthy again).
    }
  }
  if (billItemId) {
    // Already manually billed elsewhere — leave a paper-trail trigger and
    // exit, so we don't double-add to the bill.
    try {
      // R7bh-F3 / R7bg-1-CRIT-6: route through _emitTrigger so the
      // audit attribution trio is populated. The nurse is both the
      // orderer + completer here, so triggeredBy mirrors that.
      await _emitTrigger({
        admissionId: chargeEntry.admissionId,
        patientId:   chargeEntry.patientId,
        UHID:        chargeEntry.UHID,
        patientType: "IPD",
        serviceCode: `EQUIP-${chargeEntry.itemId?.toString().slice(-6) || "GEN"}`,
        serviceName: chargeEntry.itemName,
        quantity:    chargeEntry.quantity || 1,
        // R7bh-F3 / R7bg-6-CRIT-1: toNum-wrapped — the upstream
        // NursingChargeEntry stores money as Decimal128, and
        // {$numberDecimal} → schema's Decimal128 round-trip is fine,
        // but downstream consumers reading the trigger directly
        // (audit endpoints, IPDLedger byCategory aggregator) all
        // expect a finite Number, which toNum guarantees.
        unitPrice:   toNum(chargeEntry.unitPrice),
        totalAmount: toNum(chargeEntry.totalAmount),
        sourceType:  "Equipment",
        sourceDocumentId:    chargeEntry._id,
        sourceDocumentModel: "NursingChargeEntry",
        orderedBy:   chargeEntry.chargedBy || "Nurse",
        orderedByRole: "Nurse",
        completedBy:   chargeEntry.chargedBy || "Nurse",
        completedByRole: "Nurse",
        completedAt: new Date(),
        billItemId,
        status: "billed",
        autoCharged: true,
        dateKey: chargeEntry.dateKey || getDateKey(),
        shift: chargeEntry.shift,
      }, { name: chargeEntry.chargedBy || "Nurse", role: "Nurse" });
    } catch (e) { console.error("[AutoBilling] onEquipmentCharged (paper-trail) error:", e.message); }
    return;
  }

  try {
    await createTrigger({
      admissionId:  chargeEntry.admissionId,
      patientId:    chargeEntry.patientId,
      UHID:         chargeEntry.UHID,
      patientType:  "IPD",
      // Stable per-item code so the bill groups consumables sensibly.
      // Falls back to a hash of the itemId when itemName isn't reliable.
      serviceCode:  `EQUIP-${chargeEntry.itemId?.toString().slice(-6) || "GEN"}`,
      serviceName:  chargeEntry.itemName,
      quantity:     chargeEntry.quantity || 1,
      unitPriceOverride: chargeEntry.unitPrice,
      sourceType:   "Equipment",
      sourceDocumentId:    chargeEntry._id,
      sourceDocumentModel: "NursingChargeEntry",
      orderedBy:     chargeEntry.chargedBy || "Nurse",
      orderedByRole: "Nurse",
      completedBy:   chargeEntry.chargedBy || "Nurse",
      completedByRole: "Nurse",
      orderDetails:  `Consumable: ${chargeEntry.itemName} × ${chargeEntry.quantity || 1}`,
      autoCharge:    true,
      // Already deduped at the NursingChargeEntry layer for chargeOncePerDay
      // items, so no need to re-dedup here.
      dailyDedup:    false,
      shift:         chargeEntry.shift,
    });
  } catch (e) {
    console.error("[AutoBilling] onEquipmentCharged error:", e.message);
  }
}

// ── Helper: resolve admissionId from a note doc ───────────────────────────────
async function resolveAdmissionId(noteDoc) {
  if (noteDoc.admissionId) return noteDoc.admissionId;
  if (noteDoc.ipdNo || noteDoc.admissionNumber) {
    const adm = await Admission.findOne({
      $or: [
        { admissionNumber: noteDoc.ipdNo || noteDoc.admissionNumber },
        { UHID: noteDoc.patientUHID || noteDoc.UHID },
      ],
      status: "Active",
    }).lean();
    return adm?._id || null;
  }
  return null;
}

// ── Get audit trail for an admission ─────────────────────────────────────────
async function getAuditTrail(admissionId, { page = 1, limit = 100, status, sourceType } = {}) {
  const filter = { admissionId };
  if (status)     filter.status     = status;
  if (sourceType) filter.sourceType = sourceType;

  const [triggers, total] = await Promise.all([
    BillingTrigger.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate("serviceId", "serviceName serviceCode defaultPrice category")
      .populate("billId", "billNumber billStatus")
      .lean(),
    BillingTrigger.countDocuments(filter),
  ]);

  return { triggers, total, page, pages: Math.ceil(total / limit) };
}

// ── Get billing summary stats ─────────────────────────────────────────────────
async function getAdmissionBillingSummary(admissionId) {
  const mongoose = require("mongoose");
  const [all, billed, pending, pendingConf] = await Promise.all([
    BillingTrigger.countDocuments({ admissionId }),
    BillingTrigger.countDocuments({ admissionId, status: "billed" }),
    BillingTrigger.countDocuments({ admissionId, status: "pending" }),
    BillingTrigger.countDocuments({ admissionId, status: "pending", requiresConfirmation: true }),
  ]);

  const totalBilledAmt = await BillingTrigger.aggregate([
    { $match: { admissionId: new mongoose.Types.ObjectId(admissionId), status: "billed" } },
    { $group: { _id: null, total: { $sum: "$totalAmount" } } },
  ]);

  return {
    total: all,
    billed,
    pending,
    pendingConfirmation: pendingConf,
    totalBilledAmount: totalBilledAmt[0]?.total || 0,
  };
}

// ── Manually confirm a pending trigger and bill it ────────────────────────────
async function confirmAndBillTrigger(triggerId, { confirmedBy, confirmedByRole = "Receptionist" } = {}) {
  const trigger = await BillingTrigger.findById(triggerId);
  if (!trigger) throw new Error("Trigger not found");
  if (trigger.status === "billed") throw new Error("Already billed");
  if (!["pending","completed"].includes(trigger.status)) throw new Error(`Cannot bill from status: ${trigger.status}`);

  const service = trigger.serviceId
    ? await ServiceMaster.findById(trigger.serviceId).lean()
    : await findServiceByCode(trigger.serviceCode);
  if (!service) throw new Error("Service not found for this trigger");

  const bill = await getOrCreateBill(trigger.admissionId, trigger.patientType);
  if (!bill) throw new Error("Could not get or create bill");

  const result = await addItemToBill(bill, service, trigger.quantity, {
    addedBySource: "Auto",
    addedBy:    confirmedBy || "Staff",
    addedByRole: confirmedByRole,
    remarks:    `Manually confirmed: ${trigger.orderDetails || trigger.serviceName}`,
    sourceType: trigger.sourceType,
  }, trigger);

  if (!result) throw new Error("Failed to add item to bill");

  await BillingTrigger.findByIdAndUpdate(triggerId, {
    status:          "billed",
    billId:          result.bill._id,
    billItemId:      result.itemId,
    billedAt:        new Date(),
    billedBy:        confirmedBy || "Staff",
    completedBy:     trigger.completedBy || confirmedBy,
    completedByRole: trigger.completedByRole || confirmedByRole,
    completedAt:     trigger.completedAt || new Date(),
  });

  return { triggerId, billed: true, billId: result.bill._id, amount: result.totalAmt };
}

// ── OPD EVENT HANDLERS ─────────────────────────────────────────────────────────

/**
 * Called when an OPD visit is created (by Receptionist/Admin).
 * Creates a BillingTrigger for OPD Consultation fee.
 *
 * R7dq — Consult-fee bug fix: previously the trigger only carried
 * serviceCode "OPD-CON" and addItemToBill would price it from
 * ServiceMaster.defaultPrice (a hardcoded ₹500). That ignored the
 * doctor's actual fee that the receptionist saw + the auto-fill from
 * the doctor's opdFirst/opdFollowup rates (R7dp). Now we pass the
 * exact consultationFee the OPD visit recorded as unitPriceOverride,
 * so the bill amount matches what the receptionist showed the patient.
 */
async function onOPDRegistered(opdVisit, admission) {
  if (!admission?._id) return;
  // R7dq — Use the OPD visit's consultationFee field as the authoritative
  // amount. It was set by the receptionist (either auto-filled from the
  // doctor's opdFirst/opdFollowup rate via R7dp, or manually entered).
  // Falls back to undefined if missing so addItemToBill drops to its
  // ServiceMaster lookup like before.
  const visitFee = Number(opdVisit.consultationFee);
  const overrideAmount = Number.isFinite(visitFee) && visitFee >= 0 ? visitFee : undefined;
  return createTrigger({
    admissionId:         admission._id,
    opdVisitId:          opdVisit._id,
    patientId:           admission.patientId,
    UHID:                admission.UHID,
    patientType:         "OPD",
    serviceCode:         "OPD-CON",           // OPD Consultation service code
    serviceName:         "OPD Consultation",
    quantity:            1,
    unitPriceOverride:   overrideAmount,      // R7dq — doctor-specific fee
    sourceType:          "DoctorVisit",
    sourceDocumentId:    opdVisit._id,
    sourceDocumentModel: "OPD",
    orderedBy:           "Reception",
    orderedByRole:       "Receptionist",
    orderDetails:        `OPD Registration — ${opdVisit.chiefComplaint || "Consultation"}`,
    autoCharge:          true,
    dailyDedup:          false,
    department:          opdVisit.department || admission.department,
    notes:               `Visit: ${opdVisit.visitNumber} | Doctor: ${opdVisit.consultantName || ""}`,
  });
}

/**
 * Called when a nurse records vitals for an OPD visit.
 *
 * R7ds — No-op for OPD vitals.
 *
 * History: this used to create a BillingTrigger with serviceCode
 * "NRS-009" intending to charge a "Vitals Recording" nursing fee.
 * But NRS-009 in ServiceMaster is actually "Blood Glucose Monitoring
 * (RBS) ₹50" — a wrong code mapping that resulted in every OPD patient
 * who had vitals taken (i.e. every OPD patient) being billed for an
 * RBS test they never had.
 *
 * Beyond the mapping bug, OPD vitals shouldn't be billed separately
 * at all — they're part of the consultation. The doctor's consult fee
 * (driven by opdFirst/opdFollowup via R7dp) already covers the
 * vitals + assessment + Rx for one walk-in visit. IPD nursing-per-day
 * charges are a different category and still fire from
 * onDoctorNoteSaved / NurseNote:vitals → DOC-MORN-ROUND etc.
 *
 * Receptionist / nurse can still add nursing line items manually via
 * Services & Orders when a separate procedure is performed.
 *
 * Kept as an exported no-op so any caller (OPDService, controllers)
 * that already imports it doesn't crash.
 */
async function onOPDVitalsRecorded(_opdVisit, _admission, _nurseName) {
  return null;
}

/**
 * Called when a Doctor saves an OPD assessment (SOAP note).
 * Creates a BillingTrigger for Doctor Assessment / Follow-up fee.
 *
 * R7dr — De-duplicate consultation charges for OPD visits.
 *
 * Pre-R7dr the OPD-CON registration fee (fired by onOPDRegistered) and
 * the CON-001 doctor-assessment fee (this function) both landed on the
 * same patient bill — the patient was charged TWICE for one consultation
 * (₹500 + ₹500 = ₹1000 instead of the doctor's actual ₹300/₹500). The
 * two triggers nominally cover different things ("registration token"
 * vs "doctor's professional fee") but in practice every OPD visit incurs
 * both, so the doubling was always there and always wrong.
 *
 * Resolution: when an OPD-CON trigger already exists for this opdVisit
 * (i.e. the receptionist registered the visit at the desk), the doctor
 * has nothing extra to bill — the registration fee IS the consultation
 * fee. Skip the CON-001 trigger. The R7dp doctor-charges sheet's
 * opdFirst/opdFollowup rates drive the single OPD-CON line via
 * unitPriceOverride (R7dq), so the single bill line carries the
 * doctor's actual professional fee.
 *
 * Edge cases preserved:
 *   • An OPD assessment saved without a prior OPD-CON (unusual but
 *     possible — e.g. a walk-in note before registration) still fires
 *     CON-001 because the dedup query returns nothing. The patient is
 *     still charged exactly once.
 *   • IPD doctor notes are routed through onDoctorNoteSaved →
 *     DOC-MORN-ROUND / DOC-EVE-ROUND etc., not CON-001, so this guard
 *     does not affect any IPD billing.
 */
async function onOPDAssessmentSaved(opdVisit, admission, doctorName, assessmentId) {
  if (!admission?._id) return;

  // Look for an existing OPD-CON trigger on this admission. status: any
  // non-cancelled/voided state implies the registration fee already
  // landed (or is about to) on the bill.
  //
  // Note (R7dr-FIX): we filter by admissionId, not opdVisitId. The
  // createTrigger helper doesn't destructure opdVisitId from its config,
  // so even though onOPDRegistered passes it, the field never lands on
  // the saved trigger doc. admissionId IS persisted and is sufficient
  // here — an OPD admission carries exactly one opd visit at a time.
  try {
    const existing = await BillingTrigger.findOne({
      admissionId: admission._id,
      serviceCode: "OPD-CON",
      status: { $nin: ["cancelled", "voided", "rejected"] },
    }).lean();
    if (existing) {
      // Registration already covered the consult. Don't double-bill.
      return null;
    }
  } catch (e) {
    // If the dedup lookup fails, defaulting to fire CON-001 reproduces
    // pre-R7dr behaviour — preferable to silently dropping a charge.
    console.warn("[AutoBilling] OPD-CON dedup lookup failed (proceeding with CON-001):", e.message);
  }

  return createTrigger({
    admissionId:         admission._id,
    opdVisitId:          opdVisit._id,
    patientId:           admission.patientId,
    UHID:                admission.UHID,
    patientType:         "OPD",
    serviceCode:         "CON-001",           // Doctor consultation/assessment
    serviceName:         "Doctor Assessment (OPD)",
    quantity:            1,
    sourceType:          "DoctorAssessment",
    sourceDocumentId:    assessmentId || opdVisit._id,
    sourceDocumentModel: "OPD",
    orderedBy:           doctorName || "Doctor",
    orderedById:         opdVisit.doctorId,
    orderedByRole:       "Doctor",
    completedBy:         doctorName || "Doctor",
    completedByRole:     "Doctor",
    orderDetails:        `OPD Assessment — Diagnosis: ${opdVisit.provisionalDiagnosis || "Pending"}`,
    autoCharge:          true,
    dailyDedup:          true,
    department:          opdVisit.department || admission.department,
    notes:               `Doctor: ${doctorName || ""} | Visit: ${opdVisit.visitNumber}`,
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// ANH PACKAGE MATCHING & ATTACHMENT
// ═══════════════════════════════════════════════════════════════════════════════
// When an admission carries a provisionalDiagnosis / reasonForAdmission that
// maps to a published ANH package (Sheet1 surgical or Sheet2 medical-mgmt),
// snap the package onto the admission and route billing through it instead
// of building a la carte room+nursing+investigations.

// Tokens we strip before matching — common English filler / clinical noise.
// Keeps "acute bronchitis" → ["acute","bronchitis"] but drops "with","for"...
const STOPWORDS = new Set([
  "with","without","and","for","the","this","that","into","onto","from","upto",
  "until","unto","upon","over","under","unspecified","other","others","also",
  "incl","includes","including","inclusive","exclusive","extra","used",
  "cost","charges","charge","fee","fees","etc","day","days","per","case","all",
  "any","new","fresh","type","types","one","two","three","grade","ward","room",
  "class","economy","open","note",
]);
const tokenize = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .split(/[^a-z0-9]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 4 && !STOPWORDS.has(t));

/**
 * Find the best-matching ANH package for the given diagnosis text.
 *
 * Scoring: each package has a diagnosisTags array (from the import).
 * For every token in the diagnosis text that appears in a package's
 * tags, +1. We require at least 2 shared tokens (or 1 if the package
 * has only one tag) before declaring a match. On ties the higher-score
 * MMP (medical management) wins over surgical (medical packages have
 * cleaner tags; surgical names carry more noise).
 *
 * Returns the ServiceMaster doc (with _matchScore/_matchedTokens) or
 * null. Use `{ minScore }` to tune behaviour from the caller.
 */
async function findMatchingPackage(diagnosisText, opts = {}) {
  const ServiceMaster = require("../../models/ServiceMaster/serviceMasterModel");
  const tokens = tokenize(diagnosisText);
  if (tokens.length === 0) return null;
  const minScore = opts.minScore ?? 2;

  const candidates = await ServiceMaster.find({
    category: "PACKAGE",
    isActive: true,
    "diagnosisTags.0": { $exists: true },
  }).lean();

  let best = null;
  let bestScore = 0;
  // R7hr-173 (USER, 2026-06-09): dedupe tokens before scoring. The haystack
  // concatenates `provisionalDiagnosis | reasonForAdmission`, and the
  // receptionist usually types the same key term ("Fever" / "Fever under
  // evaluation") in BOTH fields. With the old code "fever" appearing twice
  // in tokens scored as 2 separate matches against MMP-5's "fever" tag,
  // satisfying minScore=2 and auto-attaching the ₹7,500 Dengue/Chikungunya
  // /Septicaemia package to every fever admission. Counting UNIQUE shared
  // tokens reflects what the scoring rule actually intends — "how many
  // distinct diagnosis concepts did we share with this package".
  const uniqueTokens = new Set(tokens);
  for (const pkg of candidates) {
    const tags = pkg.diagnosisTags || [];
    const tagSet = new Set(tags.map((t) => String(t).toLowerCase()));
    let score = 0;
    for (const tk of uniqueTokens) if (tagSet.has(tk)) score++;
    const need = tags.length === 1 ? 1 : minScore;
    if (score < need) continue;
    const isMMP = pkg.serviceCode?.startsWith("PKG-MED-MMP");
    const wins =
      score > bestScore ||
      (score === bestScore && isMMP && !best?.serviceCode?.startsWith("PKG-MED-MMP"));
    if (wins) {
      best = pkg;
      bestScore = score;
    }
  }
  return best ? { ...best, _matchScore: bestScore, _matchedTokens: tokens } : null;
}

/**
 * Snap a matched package onto an admission and fire the initial billing
 * trigger. Mutates admissionDoc in place AND saves the package binding
 * back to the Admission collection so future cron runs see it.
 *
 * Tier selection follows the patient's room category:
 *   GENW / DAYCARE       → generalWard
 *   SEMI                 → semiPrivate
 *   PVT / ICU / NICU     → private
 * Falls back to generalWard (CASH list price) when no room is attached
 * yet (Emergency / pre-bed admissions).
 *
 * Returns the created trigger, or null on failure.
 */
async function attachPackageToAdmission(admissionDoc, packageDoc, opts = {}) {
  if (!admissionDoc?._id || !packageDoc?._id) return null;
  const tierCode = (await resolveBedAndNursingRates(admissionDoc)).categoryCode || "GENW";
  const tierKey =
      tierCode === "SEMI" ? "semiPrivate"
    : (tierCode === "PVT" || tierCode === "ICU" || tierCode === "NICU") ? "private"
    : "generalWard";
  const unitPrice =
    packageDoc.tierPricing?.[tierKey] ??
    packageDoc.tierPricing?.generalWard ??
    packageDoc.defaultPrice ?? 0;

  try {
    const Admission = require("../../models/Patient/admissionModel");
    await Admission.findByIdAndUpdate(admissionDoc._id, {
      $set: {
        "package.serviceCode":      packageDoc.serviceCode,
        "package.serviceId":        packageDoc._id,
        "package.packageName":      packageDoc.serviceName,
        "package.packageType":      packageDoc.billingType,
        "package.tierUsed":         tierKey,
        "package.unitPrice":        unitPrice,
        "package.maxLOSDays":       packageDoc.maxLOSDays || 0,
        "package.attachedAt":       new Date(),
        "package.attachedBy":       opts.attachedBy || "AutoMatcher",
        "package.matchedDiagnosis": opts.matchedDiagnosis || admissionDoc.provisionalDiagnosis || admissionDoc.reasonForAdmission || "",
        "package.matchScore":       packageDoc._matchScore || 0,
        "package.autoAttached":     !!opts.auto,
      },
    });
  } catch (e) {
    console.error("[AutoBilling] attachPackage persist error:", e.message);
    return null;
  }

  const typeCode = (admissionDoc.admissionType === "Day Care" || admissionDoc.admissionType === "Daycare") ? "DAYCARE" : "IPD";
  const trigger = await createTrigger({
    admissionId:         admissionDoc._id,
    patientId:           admissionDoc.patientId,
    UHID:                admissionDoc.UHID,
    patientType:         typeCode,
    serviceCode:         packageDoc.serviceCode,
    serviceName:         packageDoc.serviceName,
    quantity:            1,
    unitPriceOverride:   unitPrice,
    sourceType:          "Admission",
    sourceDocumentId:    admissionDoc._id,
    sourceDocumentModel: "Admission",
    orderedBy:           opts.attachedBy || "AutoMatcher",
    orderedByRole:       opts.auto ? "System" : "Reception",
    orderDetails:        opts.auto
      ? `Auto-matched ANH package — diagnosis "${opts.matchedDiagnosis || admissionDoc.provisionalDiagnosis || ""}" (tier=${tierKey}, score=${packageDoc._matchScore || 0})`
      : `Manually attached ANH package by ${opts.attachedBy || "Staff"} (tier=${tierKey})`,
    autoCharge:          true,
    dailyDedup:          packageDoc.billingType === "PER_DAY",
    department:          admissionDoc.department,
    notes:               packageDoc.inclusions ? `Inclusions: ${packageDoc.inclusions}` : undefined,
  }).catch((e) => { console.error("[AutoBilling] package trigger error:", e.message); return null; });

  // R7ar-P0-4/D5-aq-08: F36 was DORMANT — schema had `excludedByPackage` flag
  // and the revenue aggregator filtered by it, but no code path ever SET the
  // flag on existing line items. Bed/nursing/doctor-visit charges already
  // posted to today's bill kept showing AND the package bundle showed too →
  // byCategory double-counted on every ANH attach.
  //
  // After attach: mark every IPD/Daycare line item on this admission's
  // active bills as `excludedByPackage=true`. The package bundle itself
  // (just created above) carries the patient charge from this point on.
  // Limited to room/nursing/doctor-visit categories — diagnostics + drugs
  // outside the package scope stay billable.
  try {
    const PatientBillM = require("../../models/PatientBillModel/PatientBillModel");
    const EXCLUDED_CATS = ["Room", "Nursing", "Consultation", "DOC-MORN-ROUND", "DOC-EVE-ROUND", "DOC-EMERGENCY-VISIT"];
    const EXCLUDED_PREFIXES = ["BED-", "IPD-NUR-", "IPD-RM-", "IPD-ICU-", "DOC-"];
    await PatientBillM.updateMany(
      {
        admission: admissionDoc._id,
        billStatus: { $in: ["DRAFT", "GENERATED", "PARTIAL"] },
      },
      {
        $set: { "billItems.$[el].excludedByPackage": true },
      },
      {
        arrayFilters: [{
          $or: [
            { "el.category": { $in: EXCLUDED_CATS } },
            { "el.serviceCode": { $regex: `^(${EXCLUDED_PREFIXES.map((p) => p.replace(/-/g, "\\-")).join("|")})` } },
          ],
        }],
      },
    );
    // Re-run pre-save totals on each affected bill so the new netAmount
    // reflects the excluded items (excludedByPackage items still in array,
    // just won't count toward gross/net).
    const affected = await PatientBillM.find({
      admission: admissionDoc._id,
      billStatus: { $in: ["DRAFT", "GENERATED", "PARTIAL"] },
    });
    // R7au-FIX-11/D7-HIGH-C11: per-bill retry on VersionError. Pre-R7au
    // a concurrent payment on any of these bills caused `b.save()` to
    // throw VersionError → the `.catch` swallowed it and the bill's
    // `excludedByPackage` recalc was silently lost. With cashier traffic
    // running during a package attach, package math could drift on
    // multiple bills. Now each save retries up to 5 times with a fresh
    // read on VersionError; only unrelated errors are logged-and-skipped.
    const _retryVE = require("../../utils/retryVersionError");
    for (const b of affected) {
      try {
        await _retryVE(async () => {
          // Re-fetch fresh so the retry has the latest __v + items.
          const fresh = await PatientBill.findById(b._id);
          if (!fresh) return null;
          // Re-apply the excludedByPackage flag predicate on the fresh
          // doc — Mongoose may have lost subdoc mutations on the stale
          // reference between retries.
          fresh.markModified("billItems");
          await fresh.save();
          return fresh;
        }, { label: `ANH-attach:${b.billNumber}`, maxRetries: 5 });
      } catch (e) {
        console.warn(`[ANH attach] recalc skipped on ${b.billNumber}: ${e.message}`);
      }
    }
  } catch (e) {
    console.warn("[AutoBilling] excludedByPackage flag-flip skipped:", e.message);
  }

  return trigger;
}

/**
 * Called when an IPD / Day Care / Emergency admission is created
 * (from ReceptionConsole or AdmissionController).
 *
 * Fires the initial admission/registration charges:
 *   - Registration fee
 *   - Admission charge (per type)
 *   - First bed-day charge (deferred to daily cron in practice)
 *   - ANH package (if diagnosis matches one) — added LAST so the
 *     baseline reg/admission charges still post even if matching errors
 */
async function onAdmissionCreated(admissionDoc) {
  if (!admissionDoc?._id) return [];
  const triggers = [];
  // Map Admission.admissionType → BillingTrigger.patientType + PatientBill.visitType
  // enums. Both target enums use UPPERCASE values; the old "ER"/"DC" codes
  // silently failed validation and produced ZERO triggers & ZERO bills.
  const typeCode = {
    "Planned":   "IPD",
    "Emergency": "EMERGENCY",
    "Day Care":  "DAYCARE",
    "Daycare":   "DAYCARE",
    "Transfer":  "IPD",
    "OPD":       "OPD",
    "Services":  "OPD",
  }[admissionDoc.admissionType] || "IPD";

  // 1. Registration fee
  triggers.push(
    await createTrigger({
      admissionId:         admissionDoc._id,
      patientId:           admissionDoc.patientId,
      UHID:                admissionDoc.UHID,
      patientType:         typeCode,
      serviceCode:         `REG-${typeCode}`,
      serviceName:         `${typeCode} Registration Fee`,
      quantity:            1,
      sourceType:          "Admission",
      sourceDocumentId:    admissionDoc._id,
      sourceDocumentModel: "Admission",
      orderedBy:           admissionDoc.createdBy || "Reception",
      orderedByRole:       "Receptionist",
      orderDetails:        `${admissionDoc.admissionType} admission registration`,
      autoCharge:          true,
      department:          admissionDoc.department,
      notes:               `Admitted: ${admissionDoc.reasonForAdmission || ""}`,
    }).catch((e) => { console.error("Registration fee trigger error:", e.message); return null; })
  );

  // 2. Admission charge (one-time)
  triggers.push(
    await createTrigger({
      admissionId:         admissionDoc._id,
      patientId:           admissionDoc.patientId,
      UHID:                admissionDoc.UHID,
      patientType:         typeCode,
      serviceCode:         `ADM-${typeCode}`,
      serviceName:         `${typeCode} Admission Charge`,
      quantity:            1,
      sourceType:          "Admission",
      sourceDocumentId:    admissionDoc._id,
      sourceDocumentModel: "Admission",
      orderedBy:           "System",
      orderedByRole:       "System",
      orderDetails:        `Initial ${admissionDoc.admissionType} admission charge`,
      autoCharge:          true,
      department:          admissionDoc.department,
    }).catch((e) => { console.error("Admission charge trigger error:", e.message); return null; })
  );

  // 3. R7en — Day-1 charges (if IPD/Daycare) from the per-room-category
  //    matrix. All 8 line items (bed, nursing, doctor visit, RMO,
  //    monitoring, dietetics, housekeeping, linen) are emitted on admission
  //    day with the category's half-day rule applied (HalfBoth/HalfOnAdmission
  //    → 0.5×; Full/HalfOnDischarge → 1×). The daily cron in
  //    runDailyBedChargeAccrual handles subsequent days idempotently.
  //    When no matrix row exists yet for this category, the resolver
  //    falls back to the legacy two-line shape priced from
  //    RoomCategory.defaultPricing so revenue continuity is preserved.
  if (typeCode === "IPD" || typeCode === "DAYCARE") {
    const matrix = await resolveRoomCategoryChargeMatrix(admissionDoc);
    const catTag = matrix.categoryCode ? `-${matrix.categoryCode}` : "";

    const halfMult = halfDayMultiplier(matrix.chargingRule, {
      isAdmissionDay: true,
      isDischargeDay: false,
    });
    const halfNote = halfMult === 0.5 ? " [½ admission day]" : "";

    for (const [chargesKey, codePrefix, label, _category] of ROOM_CATEGORY_LINE_ITEMS) {
      const rawRate = Number(matrix.charges?.[chargesKey] || 0);
      if (!(rawRate > 0)) continue;
      triggers.push(
        await createTrigger({
          admissionId:         admissionDoc._id,
          patientId:           admissionDoc.patientId,
          UHID:                admissionDoc.UHID,
          patientType:         typeCode,
          serviceCode:         `${codePrefix}${catTag}`,
          serviceName:         `${label} — ${matrix.categoryName || matrix.roomType || typeCode} (Day 1)${halfNote}`,
          quantity:            1,
          unitPriceOverride:   rawRate * halfMult,
          sourceType:          "DailyRoomAccrual",
          sourceDocumentId:    admissionDoc._id,
          sourceDocumentModel: "Admission",
          orderedBy:           "System",
          orderedByRole:       "System",
          orderDetails:        `Day 1 ${label.toLowerCase()} — ${matrix.categoryName || matrix.roomType || "category"} @ ₹${rawRate}/day${halfNote}`,
          autoCharge:          true,
          dailyDedup:          true,
          department:          admissionDoc.department,
        }).catch((e) => { console.error(`Day 1 ${chargesKey} trigger error:`, e.message); return null; })
      );
    }
  }

  // ── 4. ANH package auto-match (LAST — failure here is non-fatal) ─────
  //    Build matching haystack from the admission's clinical free-text.
  //    For surgical packages "Cholecystectomy" or "CABG" usually appears
  //    in provisionalDiagnosis. For MMP the receptionist often types
  //    "acute bronchitis" / "dengue" in reasonForAdmission. Combine both
  //    so either field triggers a match.
  if (typeCode === "IPD" || typeCode === "DAYCARE") {
    try {
      const haystack = [
        admissionDoc.provisionalDiagnosis || "",
        admissionDoc.reasonForAdmission   || "",
      ].filter(Boolean).join(" | ");
      if (haystack) {
        const pkg = await findMatchingPackage(haystack);
        if (pkg) {
          const pkgTrigger = await attachPackageToAdmission(admissionDoc, pkg, {
            auto: true,
            attachedBy: "AutoMatcher",
            matchedDiagnosis: haystack,
          });
          if (pkgTrigger) {
            triggers.push(pkgTrigger);
            console.log(`[AutoBilling] ANH package matched: ${pkg.serviceCode} (${pkg._matchScore} tags) for ADM ${admissionDoc.admissionNumber}`);
          }
        }
      }
    } catch (e) {
      console.error(`[AutoBilling] package auto-match for ADM ${admissionDoc._id}:`, e.message);
    }
  }

  return triggers.filter(Boolean);
}

/**
 * Called when an Emergency visit is created (in parallel with onAdmissionCreated).
 * Fires the ER-specific triage/observation charge.
 */
async function onEmergencyVisitCreated(emergencyVisit, admission) {
  if (!admission?._id) return null;
  return createTrigger({
    admissionId:         admission._id,
    patientId:           admission.patientId,
    UHID:                admission.UHID,
    // PatientBill.visitType enum is "EMERGENCY" — "ER" silently failed
    // validation and emergency triage was never billed.
    patientType:         "EMERGENCY",
    serviceCode:         "ER-TRIAGE",
    serviceName:         `Emergency Triage (${emergencyVisit.triageCategory || "Yellow"})`,
    quantity:            1,
    sourceType:          "Emergency",
    sourceDocumentId:    emergencyVisit._id,
    sourceDocumentModel: "Emergency",
    orderedBy:           "Reception",
    orderedByRole:       "Receptionist",
    orderDetails:        `Triage: ${emergencyVisit.triageCategory} | ${emergencyVisit.presentingComplaint || ""}`,
    autoCharge:          true,
    department:          admission.department,
    notes:               `MLC: ${emergencyVisit.isMLC ? emergencyVisit.mlcNumber || "Yes" : "No"} | Mode: ${emergencyVisit.modeOfArrival || ""}`,
  });
}

/**
 * Daily bed-charge accrual.
 *
 * For every IPD / Day-Care admission that is still Active, fire a
 * BED-DAY-* trigger with dailyDedup. The dedup logic inside
 * createTrigger() ensures the same admission cannot be charged more
 * than once per calendar day, so this is safe to call repeatedly
 * (e.g. every 6 hours).
 *
 * Returns { active, fired, skipped } counts.
 */
async function runDailyBedChargeAccrual() {
  // R7au-FIX-17/D5-MED-5: include `Transferred` admissions. The R7-series
  // allowed bed-transfer-in-progress admissions to sit in status
  // "Transferred" briefly while housekeeping moves the patient — pre-
  // R7au the daily cron filter on `status:"Active"` excluded them, so
  // transfer-day bed/nursing charges were silently skipped. The
  // createTrigger zombie-guard only rejects Cancelled/Discharged, so
  // Transferred passes through cleanly.
  const active = await Admission.find({
    status: { $in: ["Active", "Transferred"] },
    admissionType: { $in: ["Planned", "Emergency", "Day Care", "Daycare", "Transfer"] },
  }).lean();

  const typeMap = {
    Planned:   "IPD",
    Emergency: "EMERGENCY",
    "Day Care":"DAYCARE",
    Daycare:   "DAYCARE",
    Transfer:  "IPD",
  };

  // R7hr-12-S2 (D10-06): batch the per-admission lookups + admissions loop.
  //
  // Pre-S2 the cron walked admissions sequentially and each admission
  // re-queried:
  //   • Room.findById().populate("roomCategory") ............... N queries
  //   • RoomCategoryCharges.findOne() .......................... N queries
  //   • ServiceMaster.findOne() inside each of 8 createTrigger() N×8 queries
  // Round-trip cost at 200 active IPDs was ≥ 11k Mongo calls per tick.
  //
  // The three layered wins applied here (matching the audit refinement):
  //   (1) Pre-load all Room + RoomCategory docs in ONE find with $in on
  //       admission.roomId — collapses Room+RoomCategory from 2N → 2.
  //   (2) Pre-load every RoomCategoryCharges row in ONE find — collapses
  //       RoomCategoryCharges from N → 1. We index the result by
  //       categoryCode so flushDailyChargesForAdmission can read it in
  //       O(1) without going back to the DB.
  //   (3) Run admissions in chunks of `BATCH_SIZE` via Promise.all so
  //       independent admissions overlap their createTrigger waterfalls
  //       at the connection-pool level. The per-line createTrigger calls
  //       INSIDE one admission stay sequential — Promise.all there is
  //       UNSAFE because they all save() the same PatientBill doc, and
  //       Mongoose's optimisticConcurrency would burn the 5-retry
  //       VersionError budget on the first round of concurrent saves.
  //
  // Out of scope here (deferred): an in-process ServiceMaster cache for
  // the 8 BED/NURSING/etc. codes would shave another N×8 round-trips
  // off createTrigger's per-call findServiceByCode lookup, but it
  // requires plumbing a per-tick map through createTrigger and every
  // peer caller — too wide for this fix. Wins (1)+(2)+(3) alone bring
  // the cost from ~11k to ~N×(7) ≈ 1.4k round-trips at N=200 and
  // overlap them in groups of BATCH_SIZE.

  // (1) + (2) — preload Rooms + Categories + Charges in three queries.
  const roomCacheById = new Map();
  const matrixCacheByCategoryCode = new Map();
  try {
    const roomIds = [...new Set(active.map((a) => a.roomId).filter(Boolean).map(String))];
    if (roomIds.length) {
      const rooms = await Room.find({ _id: { $in: roomIds } })
        .populate("roomCategory")
        .lean();
      for (const r of rooms) roomCacheById.set(String(r._id), r);
    }

    // Pull every active RoomCategoryCharges row once. The set is small
    // (one row per category × tariff window) so a list-load is faster
    // than N selective findOnes against the same compound index.
    const RoomCategoryCharges = require("../../models/Admin/RoomCategoryChargesModel");
    const matrixRows = await RoomCategoryCharges.find({
      active:      true,
      effectiveTo: null,
    }).lean();
    for (const row of matrixRows) {
      if (row?.categoryCode) {
        matrixCacheByCategoryCode.set(String(row.categoryCode).toUpperCase(), row);
      }
    }
  } catch (preloadErr) {
    // Preload failure → fall through to per-call lookups (legacy
    // behaviour, just slower). We don't want a cache-warm error to
    // abort the whole tick.
    console.warn("[daily-accrual] R7hr-12-S2 preload skipped:", preloadErr.message);
  }

  // (3) — admissions chunk size. Conservative ceiling so we never
  // saturate the Mongo connection pool (typical pool size 5-20). At
  // 16 concurrent admissions × ~7 inner queries each that's at most
  // 112 in-flight ops — well below a 100-conn pool. Bumping this
  // higher trades latency for risk of pool exhaustion.
  const BATCH_SIZE = 16;

  let bedFired = 0, nurseFired = 0, skipped = 0, errors = 0;
  for (let i = 0; i < active.length; i += BATCH_SIZE) {
    const slice = active.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(slice.map(async (adm) => {
      const typeCode = typeMap[adm.admissionType] || "IPD";
      if (typeCode !== "IPD" && typeCode !== "DAYCARE") {
        return { bedFired: 0, nurseFired: 0, skipped: 0, errored: false };
      }
      try {
        // R7bh-F3 / R7bg-1-CRIT-6: stamp every trigger emitted from the
        // daily accrual cron with triggeredByRole:"Cron" so the audit
        // ledger can split scheduled vs service-layer emits.
        const r = await flushDailyChargesForAdmission(adm, {
          typeCode,
          _fromCron: true,
          // R7hr-12-S2 (D10-06): pass the preloaded caches so the
          // resolveRoomCategoryChargeMatrix call inside flush can skip
          // the Room+RoomCategory and RoomCategoryCharges queries
          // entirely. Discharge/manual flush callers omit these and
          // keep the legacy per-call lookup path.
          _roomCacheById:              roomCacheById,
          _matrixCacheByCategoryCode:  matrixCacheByCategoryCode,
        });
        return { bedFired: r.bedFired, nurseFired: r.nurseFired, skipped: r.skipped, errored: false };
      } catch (e) {
        console.error(`[daily-accrual] admission ${adm._id}:`, e.message);
        return { bedFired: 0, nurseFired: 0, skipped: 0, errored: true };
      }
    }));
    for (const r of results) {
      bedFired   += r.bedFired;
      nurseFired += r.nurseFired;
      skipped    += r.skipped;
      if (r.errored) errors++;
    }
  }
  return { active: active.length, bedFired, nurseFired, skipped, errors, at: new Date() };
}

/**
 * Fire today's bed + nursing-daily charges for one admission. Idempotent via
 * the `dailyDedup` guard inside createTrigger, so safe to call:
 *   - from the periodic cron (runDailyBedChargeAccrual)
 *   - from admissionService.dischargePatient just before flipping status, so
 *     the day-of-discharge bed + nursing always make it onto the bill before
 *     the auto-billing pipeline freezes the admission.
 *
 * Returns { bedFired, nurseFired, skipped } counts so the caller can audit.
 */
async function flushDailyChargesForAdmission(admission, {
  typeCode,
  prorate = false,
  dischargeTime,
  _dischargingFlush = false,
  _fromCron = false,
  // R7hr-12-S2 (D10-06): optional per-tick caches plumbed in by the
  // batched cron driver. Discharge / on-demand callers omit both and
  // resolveRoomCategoryChargeMatrix falls back to the original per-call
  // queries — preserves zero-behaviour-change for non-cron use.
  _roomCacheById,
  _matrixCacheByCategoryCode,
} = {}) {
  let bedFired = 0, nurseFired = 0, skipped = 0;
  // R7bh-F3 / R7bg-1-CRIT-6: when invoked by runDailyBedChargeAccrual the
  // emit is a scheduled accrual — stamp every downstream createTrigger
  // with triggeredByRole:"Cron". Discharge-time and manual flushes leave
  // this falsy so the actor's identity is preserved.
  const _cronRole = _fromCron ? "Cron" : undefined;
  if (!admission?._id) return { bedFired, nurseFired, skipped };
  // R7as-FIX-4/D5-crit-1: when called from `dischargePatient` AFTER the
  // status-Discharged TX commits (R7ar-P1-21), createTrigger would
  // otherwise reject every charge as "billing closed". The flag below
  // threads through so the final discharge-day bed/nursing/package
  // charges still land. Other callers (the 00:30 cron, manual flush)
  // pass `prorate=false` and leave the flag at its default `false`.

  const typeMap = {
    Planned: "IPD", Emergency: "EMERGENCY", "Day Care": "DAYCARE",
    Daycare: "DAYCARE", Transfer: "IPD",
  };
  const tc = typeCode || typeMap[admission.admissionType] || "IPD";
  if (tc !== "IPD" && tc !== "DAYCARE") return { bedFired, nurseFired, skipped };

  const startMs = new Date(admission.admissionDate || admission.createdAt).getTime();
  const dayN = Math.max(1, Math.floor((Date.now() - startMs) / 86400000) + 1);

  // ── Daycare proration (Phase A5) ─────────────────────────────
  // For Daycare patients, billing a full daily rate for a 5-hour visit
  // would over-charge. When dischargePatient() invokes this with
  // prorate=true, we compute a multiplier from actual hours on bed:
  //   hours/24, floor 0.5 (half-day floor — common Indian hospital
  //   convention so a 30-min visit still pays nursing setup), cap 1.0.
  // The multiplier scales bedRate/nursingRate/packageRate below.
  // For IPD admissions or daycare's daily cron pass, prorate=false and
  // the multiplier stays 1 (no behaviour change).
  let prorateMultiplier = 1;
  let prorateNote = "";
  if (prorate && tc === "DAYCARE") {
    const endMs = dischargeTime ? new Date(dischargeTime).getTime() : Date.now();
    const hoursOnBed = Math.max(0, (endMs - startMs) / 3600000);
    if (hoursOnBed > 0 && hoursOnBed < 24) {
      // Half-day floor (0.5), full-day cap (1.0). 12.5 hours → 0.52,
      // 4 hours → 0.5 (floor kicks in), 26 hours → would be > 24 so
      // we wouldn't enter this branch (cron already billed Day-1, and
      // we want a full Day-2 charge for that overnight scenario).
      prorateMultiplier = Math.min(1, Math.max(0.5, hoursOnBed / 24));
      prorateNote = ` [prorated ${prorateMultiplier.toFixed(2)}× — ${hoursOnBed.toFixed(1)}h Daycare]`;
    }
  }

  // ── Package-aware routing ────────────────────────────────────────────
  // If the admission has an attached ANH package and today still falls
  // within its maxLOSDays window, fire the package PER_DAY trigger
  // instead of (or alongside) the la carte bed + nursing breakdown.
  // MMP packages (PER_DAY) cover the whole stay's room+nursing+
  // investigations — so we suppress BED/NURSING for those days to
  // avoid double-charging. Surgical packages (PER_PROCEDURE) were
  // already charged once on admission; daily accrual is unaffected.
  const pkg = admission.package;
  const hasPackage = pkg?.serviceCode && pkg?.packageType === "PER_DAY";
  const withinPackageWindow =
    hasPackage && (!pkg.maxLOSDays || pkg.maxLOSDays === 0 || dayN <= pkg.maxLOSDays);

  if (withinPackageWindow) {
    // R7bh-F3 / R7bg-6-CRIT-1: toNum so a Decimal128 pkg.unitPrice
    // can't produce NaN here either.
    const pkgRate = toNum(pkg.unitPrice || 0) * prorateMultiplier;
    const r = await createTrigger({
      admissionId:         admission._id,
      patientId:           admission.patientId,
      UHID:                admission.UHID,
      patientType:         tc,
      serviceCode:         pkg.serviceCode,
      serviceName:         `${pkg.packageName || pkg.serviceCode} (Day ${dayN}/${pkg.maxLOSDays || "∞"})${prorateNote}`,
      quantity:            1,
      unitPriceOverride:   pkgRate,
      sourceType:          "BedCharge",
      sourceDocumentId:    admission._id,
      sourceDocumentModel: "Admission",
      orderedBy:           "System",
      orderedByRole:       "System",
      orderDetails:        `Package per-day charge — ${pkg.packageName || pkg.serviceCode} @ ₹${pkg.unitPrice}/day (tier=${pkg.tierUsed})${prorateNote}`,
      autoCharge:          true,
      dailyDedup:          true,
      department:          admission.department,
      _dischargingFlush,                              // R7as-FIX-4
      triggeredByRole:     _cronRole,                 // R7bh-F3 (undefined when not from cron)
    }).catch((e) => { console.error("[AutoBilling] package daily trigger error:", e.message); return null; });
    if (r?.skipped) skipped++;
    else if (r?.trigger) bedFired++;   // count as "bed" line for the summary
    return { bedFired, nurseFired, skipped };   // Skip raw bed+nursing entirely
  }

  // ── R7en: per-room-category multi-line emit ────────────────────────
  // Pre-R7en the cron emitted ONE bed trigger + ONE nursing trigger,
  // priced from the legacy `RoomCategory.defaultPricing`. R7en switches
  // to the new RoomCategoryCharges matrix (8 line items: bed, nursing,
  // doctor visit, RMO, monitoring, dietetics, housekeeping, linen). If
  // no matrix row exists yet for this admission's category, the helper
  // falls back to the legacy two-line shape so the cron flip is
  // revenue-neutral.
  //
  // Half-day proration (chargingRule):
  //   - "Full"             → 1× every day
  //   - "HalfOnAdmission"  → 0.5× Day 1, 1× thereafter
  //   - "HalfOnDischarge"  → 1× until discharge day, 0.5× on discharge
  //   - "HalfBoth"         → 0.5× Day 1 AND 0.5× on discharge, 1× interior
  // The Daycare prorateMultiplier above still wins for hourly visits.
  // R7hr-12-S2 (D10-06): pass any preloaded cron caches through so the
  // resolver can skip the per-admission Room + RoomCategoryCharges
  // round-trips. Non-cron callers leave these undefined (the resolver
  // falls back to its original findOne path).
  const matrix = await resolveRoomCategoryChargeMatrix(admission, {
    _roomCacheById,
    _matrixCacheByCategoryCode,
  });
  const catTag = matrix.categoryCode ? `-${matrix.categoryCode}` : "";

  // Today's calendar day in IST. We compare admission/discharge days
  // by their getDateKey() bucket — that avoids time-of-day edge cases
  // (admission at 23:50 IST → not counted as discharge day at 00:10).
  const todayKey = getDateKey();
  const admDateKey = getDateKey(new Date(admission.admissionDate || admission.createdAt));
  const dischargeDateKey = (admission.actualDischargeDate || _dischargingFlush)
    ? getDateKey(new Date(admission.actualDischargeDate || Date.now()))
    : null;

  const halfMult = halfDayMultiplier(matrix.chargingRule, {
    isAdmissionDay:  todayKey === admDateKey,
    isDischargeDay:  !!dischargeDateKey && todayKey === dischargeDateKey,
  });
  // Daycare hourly proration and admission/discharge half-day proration
  // are independent multipliers — Daycare halves AGAIN inside a half-day
  // admission window. In practice only one ever applies (Daycare admissions
  // discharge same day → half-day rule may also flag this day as discharge,
  // but Daycare prorate is the dominant signal).
  const finalMult = prorateMultiplier * halfMult;

  const halfNoteFragment =
    halfMult === 0.5
      ? (todayKey === admDateKey ? " [½ admission day]"
       : todayKey === dischargeDateKey ? " [½ discharge day]"
       : "")
      : "";

  // Counters by category — exposed in the return shape so callers
  // (admissionService.dischargePatient, runDailyBedChargeAccrual) can
  // log per-line-item activity for ops triage.
  const fired = {
    bed: 0, nursing: 0, doctorVisit: 0, rmo: 0,
    monitoring: 0, dietetics: 0, housekeeping: 0, linen: 0,
  };

  for (const [chargesKey, codePrefix, label, _category] of ROOM_CATEGORY_LINE_ITEMS) {
    const rawRate = Number(matrix.charges?.[chargesKey] || 0);
    if (!(rawRate > 0)) continue;     // skip zero-priced line items entirely
    const lineRate = rawRate * finalMult;
    const r = await createTrigger({
      admissionId:         admission._id,
      patientId:           admission.patientId,
      UHID:                admission.UHID,
      patientType:         tc,
      serviceCode:         `${codePrefix}${catTag}`,
      serviceName:         `${label} — ${matrix.categoryName || matrix.roomType || tc} (Day ${dayN})${halfNoteFragment}${prorateNote}`,
      quantity:            1,
      unitPriceOverride:   lineRate,
      sourceType:          "DailyRoomAccrual",
      sourceDocumentId:    admission._id,
      sourceDocumentModel: "Admission",
      orderedBy:           "System",
      orderedByRole:       "System",
      orderDetails:        `Daily ${label.toLowerCase()} — Day ${dayN} — ${matrix.categoryName || matrix.roomType || "category"} @ ₹${rawRate}/day${halfNoteFragment}${prorateNote}`,
      autoCharge:          true,
      dailyDedup:          true,
      department:          admission.department,
      _dischargingFlush,                              // R7as-FIX-4
      triggeredByRole:     _cronRole,                 // R7bh-F3
    });
    if (r?.skipped) { skipped++; continue; }
    if (r?.trigger) {
      // Map back into the per-line counter set for return-shape logging.
      if (chargesKey === "bedRent")            fired.bed++;
      else if (chargesKey === "nursingCharge") fired.nursing++;
      else if (chargesKey === "doctorVisitCharge") fired.doctorVisit++;
      else if (chargesKey === "rmoCharge")     fired.rmo++;
      else if (chargesKey === "monitoringCharge") fired.monitoring++;
      else if (chargesKey === "dieteticsCharge") fired.dietetics++;
      else if (chargesKey === "housekeepingCharge") fired.housekeeping++;
      else if (chargesKey === "linenCharge")   fired.linen++;
    }
  }

  // Preserve the legacy bedFired / nurseFired keys so existing callers
  // (runDailyBedChargeAccrual summing into the cron-tick report,
  // admissionService.dischargePatient logging the flush counts) keep
  // working; expose the new per-line breakdown on `firedByLine` for
  // future callers who care about the 8-line split.
  return {
    bedFired:   fired.bed,
    nurseFired: fired.nursing,
    skipped,
    firedByLine: fired,
    matrixMatched: matrix.matched,   // false → legacy two-line fallback
    chargingRule:  matrix.chargingRule,
    halfMult,
  };
}

/**
 * Backfill bed + nursing for every day from admissionDate to today,
 * plus orphaned doctor notes, nurse notes and nursing-consumable entries
 * that were saved BEFORE the auto-billing redesign hooked their save
 * paths. Idempotent — the `dailyDedup` and per-source dedup guards inside
 * createTrigger prevent duplicate charges if called twice.
 *
 * Called automatically by `billingService.getOrCreateDraftBill` when a
 * NEW draft bill is created for an active admission, so the moment a user
 * opens the AI billing page for a long-running admission the bill reflects
 * the entire stay (bed × N days + nursing × N days + every visit on file).
 *
 * Returns { days, bedFired, nurseFired, doctorFired, nurseNoteFired,
 *           consumableFired, skipped, errors }.
 */
async function backfillAdmissionCharges(admission) {
  const result = {
    days: 0, bedFired: 0, nurseFired: 0,
    doctorFired: 0, nurseNoteFired: 0, consumableFired: 0,
    skipped: 0, errors: 0,
  };
  if (!admission?._id) return result;
  // Only backfill while the admission is open. A discharged or cancelled
  // admission's bill is the discharge-day snapshot; we don't retroactively
  // add charges to a closed event.
  if (admission.status !== "Active" && admission.status !== "Transferred") {
    console.log(`[Backfill] skipping ADM ${admission.admissionNumber} — status=${admission.status}`);
    return result;
  }

  const typeMap = {
    Planned: "IPD", Emergency: "EMERGENCY", "Day Care": "DAYCARE",
    Daycare: "DAYCARE", Transfer: "IPD",
  };
  const tc = typeMap[admission.admissionType] || "IPD";

  // R7en: use the matrix here too so backfill matches what the daily
  // cron would have written. Falls back to the legacy two-line shape
  // when no RoomCategoryCharges row exists for this category.
  const matrix = await resolveRoomCategoryChargeMatrix(admission);
  const catTag = matrix.categoryCode ? `-${matrix.categoryCode}` : "";
  const matrixTotal = Object.values(matrix.charges || {}).reduce((a, b) => a + (b || 0), 0);
  console.log(
    `[Backfill] ADM ${admission.admissionNumber} (${tc}) — room=${matrix.roomType || "?"}/${matrix.categoryName || matrix.categoryCode || "?"}`,
    `daily=₹${matrixTotal} rule=${matrix.chargingRule} matched=${matrix.matched}`,
  );

  // ── 1. Bed + nursing + other line items day-by-day from admissionDate → today ──
  if (matrixTotal > 0) {
    const startDate = new Date(admission.admissionDate || admission.createdAt);
    if (!isNaN(startDate.getTime())) {
      const todayKey = getDateKey();
      const admDateKey = getDateKey(startDate);
      // Anchor cursor at noon to dodge DST edges; we only care about the
      // calendar-day buckets in IST anyway.
      const cursor = new Date(startDate);
      cursor.setHours(12, 0, 0, 0);

      let safety = 0;
      while (safety++ < 400) {
        const dateKey = getDateKey(cursor);
        if (dateKey > todayKey) break;
        result.days++;
        const dayN = result.days;

        // Half-day proration — for an open admission the discharge day
        // is unknown, so only the admission-day half ever applies during
        // backfill. The discharge-day half is added later by
        // flushDailyChargesForAdmission when the admission closes.
        const halfMult = halfDayMultiplier(matrix.chargingRule, {
          isAdmissionDay: dateKey === admDateKey,
          isDischargeDay: false,
        });
        const halfNote = halfMult === 0.5 ? " [½ admission day]" : "";

        for (const [chargesKey, codePrefix, label, _category] of ROOM_CATEGORY_LINE_ITEMS) {
          const rawRate = Number(matrix.charges?.[chargesKey] || 0);
          if (!(rawRate > 0)) continue;
          try {
            const r = await createTrigger({
              admissionId:         admission._id,
              patientId:           admission.patientId,
              UHID:                admission.UHID,
              patientType:         tc,
              serviceCode:         `${codePrefix}${catTag}`,
              serviceName:         `${label} — ${matrix.categoryName || matrix.roomType || tc} (Day ${dayN})${halfNote}`,
              quantity:            1,
              unitPriceOverride:   rawRate * halfMult,
              sourceType:          "DailyRoomAccrual",
              sourceDocumentId:    admission._id,
              sourceDocumentModel: "Admission",
              orderedBy:           "System",
              orderedByRole:       "System",
              orderDetails:        `Backfill ${label.toLowerCase()} — Day ${dayN} (${dateKey}) — ${matrix.categoryName || matrix.roomType || "category"} @ ₹${rawRate}/day${halfNote}`,
              autoCharge:          true,
              dailyDedup:          true,
              department:          admission.department,
              overrideDateKey:     dateKey,
              chargeDate:          new Date(cursor),
            });
            if (r?.skipped) result.skipped++;
            else if (r?.trigger) {
              if (chargesKey === "bedRent")        result.bedFired++;
              else if (chargesKey === "nursingCharge") result.nurseFired++;
              // Other line-item types fold into the consumable counter
              // for the existing return shape (so callers see a stable
              // total of accrued non-bed/non-nursing rows).
              else result.consumableFired++;
            }
          } catch (e) {
            result.errors++;
            console.error(`[Backfill] ${chargesKey}:`, e.message);
          }
        }

        cursor.setDate(cursor.getDate() + 1);
      }
    }
  }

  // ── 2. Existing doctor notes (per-shift round / consult charges) ────────────
  try {
    const DoctorNote = require("../../models/Doctor/DoctorNotesModel");
    const notes = await DoctorNote.find({ admissionId: admission._id }).lean();
    for (const note of notes) {
      try {
        await onDoctorNoteSaved(note);
        result.doctorFired++;
      } catch (e) { result.errors++; console.error("[Backfill] doctor note:", e.message); }
    }
  } catch (e) {
    // DoctorNote model may live under a different path in some installs —
    // log but don't abort the rest of the backfill.
    console.warn("[Backfill] DoctorNote model not loaded:", e.message);
  }

  // ── 3. Existing nurse notes (skip — charges fire only on note types with
  //       a serviceCode mapping, and re-firing them risks dup-on-non-daily
  //       codes that lack a per-source dedup key. Coverage is good enough
  //       from forward-only fire-on-save going forward.)

  // ── 4. Existing nursing consumables (NursingChargeEntry) ────────────────────
  try {
    const NursingChargeEntry = require("../../models/nursing/NursingChargeEntry");
    const entries = await NursingChargeEntry.find({
      admissionId: admission._id,
      status: "active",
      billed: { $ne: true },
    }).lean();
    for (const entry of entries) {
      try {
        await onEquipmentCharged(entry);
        result.consumableFired++;
      } catch (e) { result.errors++; console.error("[Backfill] consumable:", e.message); }
    }
  } catch (e) {
    console.warn("[Backfill] NursingChargeEntry model not loaded:", e.message);
  }

  return result;
}

/**
 * Fire reservation-style BillingTriggers when a pharmacist releases an
 * indent. Each released item becomes a RESV-<DRUG> trigger marked
 * `pending` — the IPD Live Ledger shows it as an amber "Reserved" row.
 * When the nurse subsequently marks the matching MAR dose as GIVEN, the
 * existing onMARAdministration path will look for this reservation
 * (by indentItemId stored in `sourceDocumentId`) and flip it to billed.
 *
 * If the nurse instead records HELD / REFUSED / NOT_AVAILABLE, the MAR
 * controller's cancel branch should void the reservation + return stock.
 * (Stock return is handled by pharmacyService.returnSale; this function
 * only manages the trigger side.)
 */
async function onIndentReleased(indentDoc, releaseItems = []) {
  if (!indentDoc?._id) return;
  // Index releaseItems by itemId so we can pull per-item issuedQty.
  const inboundByItemId = new Map((releaseItems || []).map(r => [String(r.itemId), r]));

  // R7hr-12 (D8-01): Schedule-X register cascade on indent release.
  // Lazy-require to avoid a circular dependency (scheduleXRegister →
  // Drug → ... and we only need it when at least one Schedule-X item
  // is in this release).
  let scheduleXRegister = null;
  let Drug = null;

  for (const item of (indentDoc.items || [])) {
    const released = inboundByItemId.get(String(item._id));
    if (!released) continue;
    const issuedQty = Number(released.issuedQty) || 0;
    if (issuedQty <= 0) continue;

    // Reservation triggers ride on the existing createTrigger path with
    // a synthetic service record — keeps the bill-item linkage + audit
    // story identical to bed/nursing/doctor charges. unitPriceOverride
    // is the snapshot stored on the indent item (taken from the
    // pharmacy release payload), so the receipt matches the dispense.
    const unitPrice = Number(released.unitPrice || item.unitPriceSnapshot || 0);

    // R7hr-12-S2 (D5-02): symmetrize serviceCode with the MAR-administer
    // path. onMARAdministration resolves the drug via findServiceByName
    // FIRST (L1171); if the ServiceMaster has a row for this drug name,
    // the MAR side stamps the trigger with the master's serviceCode (e.g.
    // "NRS-INJ", "PARA-500") — NOT the synthetic "PHARM-…". Pre-S2 the
    // release path here always stamped the synthetic code, so the
    // 2h MAR-dedup query (L1229-1235) joined on serviceCode never
    // matched and every dispensed-then-administered drug double-billed
    // on first dose. Mirror the same lookup precedence here so both
    // paths converge on the same canonical code:
    //   1. ServiceMaster name match (master row exists) → master code
    //   2. Synthetic PHARM-<drug> (default install — master has no row)
    // The synthetic shape is preserved bit-for-bit when no master row
    // matches, so call sites without a populated ServiceMaster keep
    // current behaviour. resolvedMasterService is also re-used by the
    // createTrigger call below to populate serviceId (lets the bill
    // line render with the master's category / billing-type metadata).
    const drugNameForLookup = item.drugName || item.drugCode || "";
    let resolvedMasterService = null;
    if (drugNameForLookup) {
      try {
        resolvedMasterService = await findServiceByName(drugNameForLookup, "IPD");
      } catch (lookupErr) {
        // Non-fatal — fall through to the synthetic shape (bias toward
        // billing, not skipping). The dedup misalignment will reappear
        // for that one item but the release path stays unblocked.
        console.warn(`[Indent] R7hr-12-S2 findServiceByName failed for "${drugNameForLookup}":`, lookupErr.message);
      }
    }
    const code = resolvedMasterService?.serviceCode
      || `PHARM-${(item.drugCode || item.drugName || "DRUG").toUpperCase().replace(/\s+/g, "-").slice(0, 24)}`;

    // R7hr-12 (D5-03): missing unit price → emit pending-review trigger
    // instead of silently continuing. Pre-R7hr-12 we `continue`d when
    // unitPrice <= 0, which let the dispensed stock leave the pharmacy
    // with NO bill artifact (revenue leak). Now the Stuck-Triggers tile
    // surfaces every missing-price release so the operator can either
    // (a) edit the indent line with the correct price + retry, or
    // (b) cancel after manual reconciliation. Mirrors invariant R7
    // (pending-review fallback on every trigger failure).
    if (unitPrice <= 0) {
      try {
        await BillingTrigger.create({
          admissionId:         indentDoc.admissionId,
          patientId:           indentDoc.patientId,
          UHID:                indentDoc.UHID,
          patientType:         "IPD",
          serviceCode:         code,
          serviceName:         `${item.drugName}${item.dose ? ` ${item.dose}` : ""} (reserved — missing price)`,
          quantity:            issuedQty,
          sourceType:          "MAR_RESERVATION",
          sourceDocumentId:    item._id,
          sourceDocumentModel: "PharmacyIndent",
          orderedBy:           indentDoc.raisedBy || "Nurse",
          orderedById:         indentDoc.raisedById,
          orderedByRole:       indentDoc.raisedByRole || "Nurse",
          completedBy:         indentDoc.releasedBy || "Pharmacist",
          completedByRole:     "Pharmacist",
          triggeredBy:         indentDoc.releasedBy || "Pharmacist",
          triggeredByRole:     "Pharmacist",
          orderDetails:        `Indent ${indentDoc.indentNumber || indentDoc._id} · ${item.drugName} × ${issuedQty} — unit price missing on release payload + indent snapshot`,
          status:              "pending-review",
          reviewReason:        `missing-unit-price: indent release for "${item.drugName}" carried no unitPrice (release payload + indent snapshot both 0). Edit the line or set a default price and retry.`,
        });
      } catch (createErr) {
        console.error(`[Indent] R7hr-12 missing-price pending-review create failed for item ${item._id}:`, createErr.message);
      }
      continue; // no charge fired, but stock + audit row are durable
    }

    try {
      // R7hr-12-S3 (D5-12): upsert-by-indent-item on partial release.
      //
      // Pre-S3 each release call wrote a FRESH MAR_RESERVATION trigger
      // with quantity = issuedQty for THIS call only — so a second
      // partial release of the same indent line emitted a SECOND
      // PHARM-* trigger carrying just the delta. The MAR-side 2h
      // dedup (autoBillingService.js L1340-1387) looks back on
      // serviceCode + admissionId and would find the OLDER trigger
      // first, skipping the new delta entirely when both releases
      // landed within 2h. Net effect: under-bill of the second batch
      // during high-tempo shifts (pharmacist splits a 10-unit indent
      // into two 5-unit releases within the same hour).
      //
      // The fix mirrors the audit's suggested option (a): query for an
      // existing reservation trigger keyed by sourceType +
      // sourceDocumentId (the indent item _id is unique per line, so
      // this is a single-row lookup), and:
      //   • if found AND still UNCONSUMED by MAR (status pending /
      //     completed / billed; finalTriggerId on the indent item not
      //     yet stamped) → GROW quantity + totalAmount + originalQuantity
      //     in-place, append an overrideHistory row for the audit trail,
      //     and reuse the existing reservationTriggerId on the indent
      //     item (already pointed at the same row).
      //   • otherwise → fall through to the existing createTrigger path
      //     (first release, or the prior reservation was already
      //     consumed/voided and a new one is the correct shape).
      //
      // This collapses each indent line down to ONE reservation trigger
      // regardless of release-call count, which is also what the
      // S2 (D5-08) two-dimensional MAR dedup join already assumed.
      let existingResv = null;
      try {
        existingResv = await BillingTrigger.findOne({
          sourceType:       "MAR_RESERVATION",
          sourceDocumentId: item._id,
          status:           { $in: ["completed", "billed", "pending"] },
        });
      } catch (lookupErr) {
        // Non-fatal — fall through to a fresh create. Worst case the
        // second release writes a new trigger (legacy pre-S3 behaviour).
        console.warn(`[Indent] R7hr-12-S3 reservation upsert lookup skipped for item ${item._id}:`, lookupErr.message);
      }

      // If the prior reservation was already consumed by a MAR-given
      // dose (finalTriggerId stamped — see autoBillingService.js
      // L1374-1378 in the MAR dedup path), we MUST emit a fresh
      // trigger for the new delta — the old row is "spoken for" by
      // the dose that already administered, and growing it would
      // retroactively change a billed line. The cheap check is on the
      // indent subdoc the prior release stamped.
      let priorConsumed = false;
      if (existingResv) {
        try {
          const PharmacyIndent = require("../../models/Pharmacy/PharmacyIndentModel");
          const parent = await PharmacyIndent.findOne(
            { _id: indentDoc._id, "items._id": item._id },
            { "items.$": 1 },
          ).lean();
          const sub = parent?.items?.[0];
          if (sub?.finalTriggerId) priorConsumed = true;
        } catch (consumedErr) {
          // Bias toward the safer FRESH create when the lookup fails.
          priorConsumed = true;
          console.warn(`[Indent] R7hr-12-S3 indent-consumed check skipped for item ${item._id}:`, consumedErr.message);
        }
      }

      if (existingResv && !priorConsumed) {
        // Partial-release growth path. Quantity / totalAmount /
        // originalQuantity all grow by the new issuedQty; the
        // overrideHistory row carries the audit trail (who grew it,
        // when, by how much) so /admin/audit-trail can replay the
        // sequence of partial releases on a single ledger line.
        const oldQty   = Number(existingResv.quantity) || 0;
        const newQty   = oldQty + issuedQty;
        const oldTotal = toNum(existingResv.totalAmount) || 0;
        const newTotal = oldTotal + (issuedQty * unitPrice);
        existingResv.quantity         = newQty;
        // Decimal128 fields — wrap so the setter doesn't lose precision on
        // long-stay admissions where many partial releases accumulate.
        existingResv.originalQuantity = toDec(newQty);
        existingResv.totalAmount      = toDec(newTotal);
        existingResv.orderDetails     = `Indent ${indentDoc.indentNumber} · ${item.drugName} × ${newQty} (partial releases summed)`;
        existingResv.overrideHistory  = existingResv.overrideHistory || [];
        existingResv.overrideHistory.push({
          field:     "quantity",
          oldValue:  String(oldQty),
          newValue:  String(newQty),
          reason:    `R7hr-12-S3: partial release added ${issuedQty} unit(s) — see indent ${indentDoc.indentNumber}`,
          changedBy: indentDoc.releasedBy || "Pharmacist",
          changedAt: new Date(),
        });
        await existingResv.save();
        // Indent item already carries reservationTriggerId from the
        // first release — no re-stamp needed. Safety net: ensure the
        // pointer is set even if the first stamp had failed.
        try {
          const PharmacyIndent = require("../../models/Pharmacy/PharmacyIndentModel");
          await PharmacyIndent.findOneAndUpdate(
            { _id: indentDoc._id, "items._id": item._id, "items.reservationTriggerId": null },
            { $set: { "items.$.reservationTriggerId": existingResv._id } },
          );
        } catch (stampErr) {
          console.warn(`[Indent] R7hr-12-S3 reservation re-stamp skipped for item ${item._id}:`, stampErr.message);
        }
      } else {
        const result = await createTrigger({
          admissionId:         indentDoc.admissionId,
          patientId:           indentDoc.patientId,
          UHID:                indentDoc.UHID,
          patientType:         "IPD",
          // R7hr-12-S2 (D5-02): pass through the master service id when the
          // symmetrization lookup above hit a row — keeps the bill line
          // tagged with the ServiceMaster category/billingType and lets the
          // MAR-side serviceCode comparison match exactly.
          serviceId:           resolvedMasterService?._id,
          serviceCode:         code,
          serviceName:         resolvedMasterService?.serviceName
            || `${item.drugName}${item.dose ? ` ${item.dose}` : ""} (reserved)`,
          quantity:            issuedQty,
          unitPriceOverride:   unitPrice,
          // R7az-CRIT-1 (D6-CRIT-1): canonical sourceType for the
          // pharmacy reservation row. The MAR-administer path's dedup
          // query in onMARAdministration searches specifically for
          // "MAR_RESERVATION" — keeping these strings in lock-step is
          // the entire fix for the R7au double-count bug.
          sourceType:          "MAR_RESERVATION",
          sourceDocumentId:    item._id,          // Points back at the indent item for MAR↔reservation lookup
          sourceDocumentModel: "PharmacyIndent",
          orderedBy:           indentDoc.raisedBy || "Nurse",
          orderedById:         indentDoc.raisedById,
          orderedByRole:       indentDoc.raisedByRole || "Nurse",
          completedBy:         indentDoc.releasedBy || "Pharmacist",
          completedByRole:     "Pharmacist",
          orderDetails:        `Indent ${indentDoc.indentNumber} · ${item.drugName} × ${issuedQty}`,
          autoCharge:          true,
          dailyDedup:          false,
        });
        // Stamp the trigger id back onto the indent item so the MAR
        // consumption path can find it later. We use a direct $set on
        // the subdoc rather than re-save() to keep the indent-write
        // optimistically concurrent.
        if (result?.trigger?._id) {
          const PharmacyIndent = require("../../models/Pharmacy/PharmacyIndentModel");
          await PharmacyIndent.findOneAndUpdate(
            { _id: indentDoc._id, "items._id": item._id },
            { $set: { "items.$.reservationTriggerId": result.trigger._id } },
          );
        }
      }
    } catch (e) {
      console.error(`[Indent] reservation trigger for item ${item._id} failed:`, e.message);
    }

    // R7hr-12 (D8-01): Schedule-X / NDPS register cascade. Pre-R7hr-12
    // the counter-dispense path (pharmacyController.dispense L840-869)
    // was the ONLY caller of scheduleXRegister.recordDispense, so every
    // ward indent of morphine/pethidine/diazepam left the statutory
    // NDPS register blank — 70–90% of narcotic use in a hospital flows
    // through IPD, so the register was effectively missing the bulk of
    // its mandated rows.
    //
    // Implementation notes (mirror the counter-dispense pattern at
    // pharmacyController.js L843-867):
    //   • Drug.schedule === "X" gates the call — non-Schedule-X items
    //     skip silently.
    //   • One recordDispense per picked batch (item.picked[] is the
    //     FEFO audit ledger written by releaseIndent at L480-486), so
    //     a single indent line that pulled from multiple batches
    //     produces one register row per batch — exactly the NDPS
    //     traceability requirement.
    //   • Failures are non-fatal: log + log a remark on the indent.
    //     We DON'T refuse the release on first cut (per refinement)
    //     because the IPD indent UI doesn't yet collect witnessName/
    //     witnessId — refusing here would break legitimate ward
    //     workflow. The recordDispense call will 400 with
    //     WITNESS_REQUIRED until the UI is updated, and the remark
    //     surfaces the gap to the operator for manual entry via the
    //     Schedule-X register page.
    if (!item.drugId) continue; // legacy / manual line w/o drug master
    if (!scheduleXRegister) {
      scheduleXRegister = require("../Pharmacy/scheduleXRegister");
      Drug = require("../../models/Pharmacy/DrugModel");
    }
    let drugMeta = null;
    try {
      drugMeta = await Drug.findById(item.drugId).select("schedule name").lean();
    } catch (lookupErr) {
      console.error(`[Indent] R7hr-12 Drug lookup failed for ${item.drugId}:`, lookupErr.message);
      continue;
    }
    if (!drugMeta || drugMeta.schedule !== "X") continue;

    const picks = Array.isArray(item.picked) ? item.picked : [];
    // Only NEW picks from this release land on the register. The
    // release path at indentService.js L480-486 appends to item.picked
    // — so on a multi-call PartiallyReleased indent the array may
    // contain prior-release rows too. Filter by pickedAt >= release
    // timestamp (or, for the first release, by anything within the
    // last 10 minutes of this release). Best-effort; over-recording
    // is preferred to under-recording for NDPS.
    const releasedAt = indentDoc.releasedAt ? new Date(indentDoc.releasedAt).getTime() : Date.now();
    const newPicks = picks.length === 0
      ? [{ batchId: null, qty: issuedQty, batchNo: "" }] // fallback when no FEFO trail
      : picks.filter((p) => {
        const t = p.pickedAt ? new Date(p.pickedAt).getTime() : releasedAt;
        return t >= releasedAt - 60 * 1000; // 1-minute slack for clock skew
      });
    const picksToRecord = newPicks.length > 0 ? newPicks : picks;

    for (const p of picksToRecord) {
      try {
        await scheduleXRegister.recordDispense({
          drugId:        item.drugId,
          batchId:       p.batchId || undefined,
          qty:           Number(p.qty) || 0,
          rx:            indentDoc.indentNumber || String(indentDoc._id),
          doctorName:    "", // doctor identity isn't on the indent header — surface via remarks
          uhid:          indentDoc.UHID || "",
          // NDPS two-person rule — IPD indent release payload doesn't
          // currently carry witness identity. Pass empty so the
          // service-side check 400s with WITNESS_REQUIRED; we capture
          // the gap as a remark below so the operator can reconcile
          // via the Schedule-X register UI. Once the indent-release
          // UI is updated to collect witnessName/witnessId, plumb
          // them through releaseItems and read them here.
          witnessName:   indentDoc.acknowledgedBy || "",
          witnessId:     indentDoc.acknowledgedById || null,
          dispensedBy:   indentDoc.releasedBy || "Pharmacist",
          dispensedById: indentDoc.releasedById || null,
          remarks:       `Indent ${indentDoc.indentNumber || indentDoc._id} · ward=${indentDoc.wardName || ""} bed=${indentDoc.bedNumber || ""}`,
        });
      } catch (sxErr) {
        // Mirror the pharmacyController.js pattern: don't abort the
        // release. Log + surface a pending-review BillingTrigger so
        // the Stuck-Triggers tile carries the regulatory gap.
        console.error(
          `[Indent] R7hr-12 Schedule-X recordDispense failed for drug ${item.drugId} batch ${p.batchId || "—"} qty=${p.qty}:`,
          sxErr.code || sxErr.message,
        );
        try {
          await BillingTrigger.create({
            admissionId:         indentDoc.admissionId,
            patientId:           indentDoc.patientId,
            UHID:                indentDoc.UHID,
            patientType:         "IPD",
            serviceName:         `Schedule-X register PENDING — ${drugMeta.name} × ${p.qty}`,
            quantity:            Number(p.qty) || 0,
            sourceType:          "MAR_RESERVATION",
            sourceDocumentId:    item._id,
            sourceDocumentModel: "PharmacyIndent",
            orderedBy:           indentDoc.releasedBy || "Pharmacist",
            orderedById:         indentDoc.releasedById,
            orderedByRole:       "Pharmacist",
            triggeredBy:         indentDoc.releasedBy || "Pharmacist",
            triggeredByRole:     "Pharmacist",
            status:              "pending-review",
            reviewReason:        `schedule-x-register-failed: ${sxErr.code || sxErr.message} (drug=${drugMeta.name}, batchId=${p.batchId || "—"}, qty=${p.qty}) — NDPS register row must be entered manually via the Schedule-X register page.`,
            orderDetails:        `Indent ${indentDoc.indentNumber || indentDoc._id} — Schedule-X dispense not recorded on register; manual reconciliation required.`,
          });
        } catch (logErr) {
          console.error(`[Indent] R7hr-12 pending-review schedule-x trigger create failed:`, logErr.message);
        }
      }
    }
  }
}

/**
 * R7az-CRIT-6 (D6-CRIT-6): MAR non-administration → void pharmacy reservation.
 *
 * When a nurse records MAR status ∈ {HELD, REFUSED, MISSED, OMITTED,
 * NOT_AVAILABLE} the drug is NOT going into the patient — but the
 * pharmacy reservation row (created by onIndentReleased) is sitting on
 * the bill as a charged line. Pre-R7az nothing voided it, so the
 * patient was billed for a dose they never received. This handler
 * finds the matching reservation trigger (by serviceCode +
 * admissionId, within the same dedup window the administer path uses)
 * and voids it. The stock return is a separate concern handled by
 * pharmacyService.returnSale — this only manages the bill side.
 *
 * Agent B (marController.recordAdministration) must call this from the
 * status-change branch:
 *
 *   if (NON_ADMIN.has(adm.status)) {
 *     await autoBilling.onMARNonAdminister(marDoc, med, adm.status);
 *   }
 *
 * Idempotent — re-running it on an already-voided trigger is a no-op.
 */
async function onMARNonAdminister(marDoc, medication, statusReason) {
  if (!marDoc || !medication) return;
  const admissionId = marDoc.admissionId;
  if (!admissionId) return;

  const drugName = medication.drugName || medication.medicineName || medication.name || "";
  if (!drugName) return;

  // Resolve the same service code the indent-release path would have stamped.
  let service = await findServiceByName(drugName, "IPD");
  let serviceCode = service?.serviceCode;
  if (!serviceCode) {
    // Synthetic PHARM-* code (matches onIndentReleased's code derivation).
    const drugCode = medication.drugCode || drugName;
    serviceCode = `PHARM-${String(drugCode).toUpperCase().replace(/\s+/g, "-").slice(0, 24)}`;
  }

  try {
    // Look in a generous window (24h — wider than the 6h administer
    // dedup) because a HELD/REFUSED status flip can land much later in
    // the shift than the original dispense. Match BOTH the pharmacy
    // reservation row (sourceType: MAR_RESERVATION) and — for backward
    // compat — any legacy row stamped with the old sourceType:"MAR" +
    // sourceDocumentModel:"PharmacyIndent" pattern.
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const reservations = await BillingTrigger.find({
      admissionId,
      serviceCode,
      $or: [
        { sourceType: "MAR_RESERVATION" },
        { sourceType: "MAR", sourceDocumentModel: "PharmacyIndent" }, // legacy rows pre-R7az
      ],
      status: { $in: ["completed", "billed", "pending"] },
      createdAt: { $gte: since },
    });

    if (reservations.length === 0) {
      console.log(`[AutoBilling] onMARNonAdminister no live reservation for ${serviceCode} (${admissionId}) — nothing to void`);
      return;
    }

    // Void each match (usually 1). Reuse cancelTrigger so the bill
    // line is removed + CN/audit-trail logic stays consistent.
    for (const r of reservations) {
      try {
        await cancelTrigger(r._id, {
          reason: `MAR ${statusReason || "non-administered"} — reservation voided`,
          user: { fullName: "AutoBilling", role: "System" },
        });
      } catch (e) {
        // If the trigger was already voided/cancelled we don't care.
        if (e.code === "ALREADY_CLOSED") continue;
        console.error(`[AutoBilling] onMARNonAdminister cancelTrigger ${r._id} failed:`, e.message);
      }
    }
  } catch (e) {
    console.error("[AutoBilling] onMARNonAdminister error:", e.message);
  }
}

/**
 * R7hr-12 (D2-06): Reduce a reservation trigger's qty/totalAmount in
 * place — proportional partial-cancel for pharmacy returns. Pre-R7hr-12
 * onPharmacyReturn always full-cancelled the entire reservation even
 * when only N units of a M-unit dispense came back, so the patient
 * lost the (M-N) units of charge from the IPD ledger while only
 * receiving the cash refund for N units. Direct revenue leak.
 *
 * This helper edits BOTH the trigger row (quantity, totalAmount) AND
 * the linked bill item (quantity) in lock-step, recomputing totals via
 * the bill's pre-save hook, and stamps an overrideHistory[] entry so
 * the audit trail shows what changed. If the bill line was already
 * gone (status:"cancelled" earlier, etc.) the helper still updates the
 * trigger so the row stays internally consistent.
 *
 * @param {ObjectId} triggerId
 * @param {number}   qtyReturned   units returned (must be < trigger.quantity)
 * @param {object}   opts          { reason, user, refundSlipNumber }
 * @returns {Promise<{ status, trigger }>}
 *      status ∈ "partial" (reduced) | "full" (fully cancelled) | "skipped"
 */
async function _partialReduceTrigger(triggerId, qtyReturned, { reason, user, refundSlipNumber } = {}) {
  const trigger = await BillingTrigger.findById(triggerId);
  if (!trigger) return { status: "skipped", reason: "trigger-not-found" };
  if (trigger.status === "voided" || trigger.status === "cancelled") {
    return { status: "skipped", reason: "already-closed", trigger };
  }

  const currentQty = Number(trigger.quantity) || 0;
  const ret = Number(qtyReturned) || 0;
  if (ret <= 0) return { status: "skipped", reason: "invalid-qty", trigger };

  // Full void path — return ≥ trigger qty means the whole reservation
  // is going away. Delegate to cancelTrigger so the audit trail + bill
  // line removal stay consistent with the legacy behaviour.
  if (ret >= currentQty) {
    try {
      const cancelled = await cancelTrigger(triggerId, {
        reason: `Pharmacy return ${refundSlipNumber || ""} — full reservation voided (${ret}/${currentQty} returned)`.trim(),
        user:   user || { fullName: "AutoBilling (return)", role: "System" },
      });
      return { status: "full", trigger: cancelled };
    } catch (e) {
      if (e.code === "ALREADY_CLOSED") return { status: "skipped", reason: "already-closed" };
      throw e;
    }
  }

  // Partial-cancel path — reduce qty + totalAmount in place.
  const unit = toNum(trigger.unitPrice);
  const newQty   = currentQty - ret;
  const newTotal = unit * newQty;

  // Snapshot the before state for overrideHistory.
  const before = {
    quantity:    currentQty,
    unitPrice:   unit,
    totalAmount: toNum(trigger.totalAmount),
  };

  // Edit the linked bill item, if any. Mirrors the pattern from
  // overrideTrigger (L3327-L3348) — set inputs, let the bill's pre-save
  // hook recompute grossAmount / netAmount / patient + TPA splits.
  if (trigger.billId && trigger.billItemId) {
    const retryVE = require("../../utils/retryVersionError");
    try {
      await retryVE(async () => {
        const bill = await PatientBill.findById(trigger.billId);
        if (!bill) return;
        if (["PAID", "CANCELLED", "REFUNDED"].includes(bill.billStatus)) {
          // Closed bill — caller must use the refund flow. We still
          // reduce the trigger so the row matches reality, but flag
          // the bill-side residue so the operator can reconcile.
          return;
        }
        const item = bill.billItems.id(trigger.billItemId);
        if (item) {
          item.quantity = newQty;
          // unitPrice unchanged — only qty drops.
          await bill.save();
        }
      }, { label: "_partialReduceTrigger" });
    } catch (billErr) {
      console.error(`[AutoBilling] _partialReduceTrigger bill update failed for trigger ${triggerId}:`, billErr.message);
      // Don't bubble — trigger update below keeps the audit row honest
      // even if the bill mutation hit a closed-bill or version race.
    }
  }

  trigger.quantity    = newQty;
  trigger.totalAmount = toDec(newTotal);
  trigger.overrideHistory.push({
    field:         "qty/totalAmount",
    oldValue:      before,
    newValue:      { quantity: newQty, unitPrice: unit, totalAmount: newTotal },
    reason:        String(reason || `Pharmacy return — ${ret} units returned of ${currentQty}`).trim(),
    changedBy:     user?.fullName || user?.name || "AutoBilling (return)",
    changedByRole: user?.role || "System",
    changedById:   user?._id || user?.id,
  });
  await trigger.save();

  // Best-effort audit row — reuse ITEM_PRICE_OVERRIDDEN since the
  // override path covers qty/price edits and the enum doesn't have a
  // dedicated "partial-refund" event. The reason text disambiguates.
  try {
    const { emitBillingAudit } = require("../../models/Billing/BillingAudit");
    await emitBillingAudit({
      event:       "ITEM_PRICE_OVERRIDDEN",
      UHID:        trigger.UHID,
      admissionId: trigger.admissionId,
      triggerId:   trigger._id,
      billId:      trigger.billId,
      amount:      newTotal,
      actorName:   user?.fullName || "AutoBilling (return)",
      actorRole:   user?.role || "System",
      reason:      `Partial pharmacy return — ${ret}/${currentQty} units returned (slip ${refundSlipNumber || "—"})`,
      before,
      after:       { quantity: newQty, unitPrice: unit, totalAmount: newTotal },
    });
  } catch (auditErr) {
    console.warn("[AutoBilling] _partialReduceTrigger audit emit failed (non-fatal):", auditErr.message);
  }

  return { status: "partial", trigger };
}

/**
 * R7gz — Pharmacy return → IPD ledger refund cascade.
 *
 * When the pharmacist processes a return on a PharmacySale that
 * originated from an IPD indent, two things need to happen on the
 * billing side:
 *
 *   1. PharmacySale.balanceDue / patientCredit adjust — handled
 *      inline in pharmacyController.returnItems (pharmacy counter is
 *      where the money flow lives — payment is collected there, refund
 *      is paid out there).
 *
 *   2. The corresponding MAR_RESERVATION BillingTrigger sitting on the
 *      patient's IPD ledger (created by onIndentReleased) needs to
 *      reduce by the returned quantity / amount — otherwise the IPD
 *      ledger's PHARM category total over-states actual consumption
 *      and the patient appears to owe money for medicine they returned.
 *
 * R7hr-12 (D2-06): partial-return support. Pre-R7hr-12 every match was
 * full-cancelled regardless of `it.quantity`, so a 2-of-10 return wiped
 * a ₹1000 reservation while only refunding ₹200 cash — patient got 8
 * units of free medication on every partial return. The cascade now
 * walks reservations newest-first and consumes `it.quantity` units
 * across them: full-cancels each trigger it can fully absorb, then
 * partial-reduces the last one to consume the remainder. Multi-trigger
 * coverage handles the (uncommon but real) case of an indent line
 * that was released across two indent calls (PartiallyReleased → second
 * release), producing two reservation triggers for the same service
 * code.
 *
 * Idempotent — re-running on an already-cancelled trigger is a no-op.
 */
async function onPharmacyReturn(sale, returnRecord) {
  if (!sale || !returnRecord) return;
  const admissionId = sale.admissionId;
  // OPD / non-admission sales don't have an IPD ledger to update
  if (!admissionId) return;

  const items = Array.isArray(returnRecord.refundedItems) ? returnRecord.refundedItems : [];
  if (!items.length) return;

  for (const it of items) {
    const drugName = it.drugName || it.medicineName || "";
    if (!drugName) continue;

    // Resolve service code the same way onIndentReleased did.
    let serviceCode = it.serviceCode;
    if (!serviceCode) {
      const drugCode = it.drugCode || drugName;
      serviceCode = `PHARM-${String(drugCode).toUpperCase().replace(/\s+/g, "-").slice(0, 24)}`;
    }

    // R7hr-12 (D2-06): the returned quantity for this line — drives
    // partial-cancel proportionality.
    const returnedQty = Number(it.quantity) || 0;
    if (returnedQty <= 0) continue;

    try {
      // Match the MAR reservation trigger that paid for this line.
      // Use a wide-ish window — pharmacy returns can land days after
      // the original dispense.
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const reservations = await BillingTrigger.find({
        admissionId,
        serviceCode,
        $or: [
          { sourceType: "MAR_RESERVATION" },
          { sourceType: "MAR", sourceDocumentModel: "PharmacyIndent" }, // legacy
        ],
        status: { $in: ["completed", "billed", "pending"] },
        createdAt: { $gte: since },
      }).sort({ createdAt: -1 });

      if (!reservations.length) {
        console.log(`[AutoBilling] onPharmacyReturn no live reservation for ${serviceCode} (${admissionId}) — nothing to void`);
        continue;
      }

      // R7hr-12 (D2-06): consume `returnedQty` units across the
      // reservations (newest first). For each reservation:
      //   • triggerQty <= remaining → full cancel, decrement remaining
      //   • triggerQty >  remaining → partial reduce by `remaining`,
      //                              remaining = 0, stop.
      let remaining = returnedQty;
      for (const r of reservations) {
        if (remaining <= 0) break;
        const triggerQty = Number(r.quantity) || 0;
        const consumeFromThis = Math.min(triggerQty, remaining);
        try {
          await _partialReduceTrigger(r._id, consumeFromThis, {
            reason: `Pharmacy return ${returnRecord.refundSlipNumber || ""} — ${consumeFromThis} unit(s) of ${triggerQty} returned`,
            user: { fullName: "AutoBilling (return)", role: "System" },
            refundSlipNumber: returnRecord.refundSlipNumber || "",
          });
          remaining -= consumeFromThis;
        } catch (e) {
          if (e.code === "ALREADY_CLOSED") continue;
          console.error(`[AutoBilling] onPharmacyReturn _partialReduceTrigger ${r._id} failed:`, e.message);
        }
      }

      if (remaining > 0) {
        // Coverage gap — returned more than the live reservations
        // accounted for. Could happen if the MAR-administer path
        // already promoted some reservations to per-dose triggers
        // (post-dedup-window doses become separate MAR triggers).
        // Log for the operator; don't fail the return.
        console.warn(
          `[AutoBilling] onPharmacyReturn ${serviceCode} (${admissionId}): ` +
          `${remaining} unit(s) of returned ${returnedQty} found no matching reservation — ` +
          `MAR per-dose triggers may need manual reconcile.`,
        );
      }
    } catch (e) {
      console.error(`[AutoBilling] onPharmacyReturn ${serviceCode} error:`, e.message);
    }
  }
}

/**
 * R7hr-12-S2 (D3-03): IPD indent return — void the matching MAR
 * reservation triggers when a ward returns unused drug to the pharmacy.
 *
 * Pre-R7hr-12-S2 there was NO ward-side equivalent of onPharmacyReturn:
 * `releaseIndent` decremented stock and fired MAR_RESERVATION billing
 * triggers, but no code path could reverse either side when a patient
 * was discharged / transferred / refused dose. Operators either let the
 * PHARM-* charge sit on the bill (over-billing) or hand-edited Mongo.
 *
 * Strategy — mirror onPharmacyReturn:
 *   • One pass per returned item; resolve serviceCode the same way
 *     onIndentReleased did (master-first via findServiceByName, then
 *     PHARM-* synthetic fallback) so the join lands on the same
 *     trigger row.
 *   • Use sourceDocumentId === indentItem._id as the strong join key
 *     (release path stamped it at autoBillingService.js L2722) and
 *     serviceCode + admissionId + sourceType as the broad fallback for
 *     legacy triggers that don't carry sourceDocumentId yet.
 *   • _partialReduceTrigger handles the qty math + bill-line refund +
 *     overrideHistory[] audit — same helper onPharmacyReturn uses, so
 *     IPD ledger refunds and GST CN reversal stay consistent across
 *     OPD/walk-in and ward dispense paths.
 *
 * @param {Object} indentDoc       — the saved indent (post-issuedQty decrement)
 * @param {Object} returnRecord    — { items: [{itemId, returnQty}], reason, user }
 */
async function onIndentReturned(indentDoc, returnRecord) {
  if (!indentDoc?._id || !returnRecord) return;
  const admissionId = indentDoc.admissionId;
  if (!admissionId) return; // walk-in indents shouldn't exist but defensive

  const requestedReturns = Array.isArray(returnRecord.items) ? returnRecord.items : [];
  if (!requestedReturns.length) return;

  // Index items on the doc by id so we can resolve serviceCode + drug
  // metadata from the indent line itself rather than re-fetching.
  const itemById = new Map(
    (indentDoc.items || []).map((it) => [String(it._id), it]),
  );

  const reasonTxt = String(returnRecord.reason || "").trim() || "Indent return";
  const user = returnRecord.user || { fullName: "AutoBilling (indent return)", role: "System" };

  for (const r of requestedReturns) {
    const itemId    = String(r.itemId || "");
    const returnQty = Number(r.returnQty || 0);
    if (!itemId || returnQty <= 0) continue;

    const item = itemById.get(itemId);
    if (!item) {
      console.warn(`[AutoBilling] onIndentReturned: itemId ${itemId} not on indent ${indentDoc._id} — skipped`);
      continue;
    }

    const drugName = item.drugName || "";
    if (!drugName) continue;

    // Resolve service code — master-first to match the MAR-administer
    // path, then fall back to the PHARM-* synthetic that onIndentReleased
    // uses. The dual lookup keeps us robust whether the indent was
    // released against a master-coded service or the synthetic.
    let serviceCode = null;
    try {
      const svc = await findServiceByName(drugName, "IPD");
      if (svc?.serviceCode) serviceCode = svc.serviceCode;
    } catch (_) { /* master lookup is optional */ }
    const syntheticCode = `PHARM-${String(item.drugCode || drugName).toUpperCase().replace(/\s+/g, "-").slice(0, 24)}`;

    try {
      // Strong join via sourceDocumentId (indent item _id) FIRST. This
      // hits every trigger the release path stamped, regardless of
      // serviceCode shape — defends against the D5-02 cross-axis
      // (master vs PHARM-*) mismatch.
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30d window
      const strongMatches = await BillingTrigger.find({
        admissionId,
        sourceDocumentId:    item._id,
        sourceDocumentModel: "PharmacyIndent",
        status: { $in: ["completed", "billed", "pending"] },
      }).sort({ createdAt: -1 });

      let reservations = strongMatches;
      if (!reservations.length) {
        // Fallback: legacy triggers without sourceDocumentId. Match on
        // serviceCode (both shapes) + admissionId + reservation source.
        const candidateCodes = [syntheticCode];
        if (serviceCode && serviceCode !== syntheticCode) candidateCodes.unshift(serviceCode);
        reservations = await BillingTrigger.find({
          admissionId,
          serviceCode: { $in: candidateCodes },
          $or: [
            { sourceType: "MAR_RESERVATION" },
            { sourceType: "MAR", sourceDocumentModel: "PharmacyIndent" },
          ],
          status: { $in: ["completed", "billed", "pending"] },
          createdAt: { $gte: since },
        }).sort({ createdAt: -1 });
      }

      if (!reservations.length) {
        console.log(
          `[AutoBilling] onIndentReturned: no live reservation for indent item ${itemId} ` +
          `(${drugName}, admission ${admissionId}) — nothing to void. ` +
          `MAR may have already promoted to per-dose triggers — manual reconcile may be needed.`,
        );
        continue;
      }

      // Consume returnQty across reservations newest-first via the
      // shared _partialReduceTrigger helper. Each call either full-
      // cancels (when ret >= trigger.quantity) or proportionally
      // reduces qty + totalAmount + bill-line + overrideHistory[].
      let remaining = returnQty;
      for (const t of reservations) {
        if (remaining <= 0) break;
        const triggerQty = Number(t.quantity) || 0;
        const consumeFromThis = Math.min(triggerQty, remaining);
        try {
          await _partialReduceTrigger(t._id, consumeFromThis, {
            reason: `Indent return ${indentDoc.indentNumber || indentDoc._id} — ${consumeFromThis}/${triggerQty} unit(s) returned: ${reasonTxt}`,
            user,
          });
          remaining -= consumeFromThis;
        } catch (e) {
          if (e.code === "ALREADY_CLOSED") continue;
          console.error(`[AutoBilling] onIndentReturned _partialReduceTrigger ${t._id} failed:`, e.message);
        }
      }

      if (remaining > 0) {
        console.warn(
          `[AutoBilling] onIndentReturned: indent ${indentDoc.indentNumber || indentDoc._id} ` +
          `item ${itemId} (${drugName}): ${remaining}/${returnQty} units returned found no matching reservation — ` +
          `MAR per-dose triggers may need manual reconcile.`,
        );
      }
    } catch (e) {
      console.error(`[AutoBilling] onIndentReturned item ${itemId} error:`, e.message);
    }
  }
}

/**
 * R7az-CRIT-7 (D6-CRIT-7): order-cancellation refund cascade.
 *
 * When a DoctorOrder is cancelled (mid-treatment, in error, replaced
 * by a corrected order), every BillingTrigger linked to that order's
 * _id needs to be voided. If the trigger had already been promoted to
 * a bill item, a CreditNote must be raised so the GST liability is
 * reversed properly (CGST Act §34 — same flow as recordRefund's CN
 * branch in billingService.js). Best-effort throughout: a single
 * failed void doesn't abort the cascade; failed CN raises a
 * pending-review row for the cashier.
 *
 * Agent D will call this from the order-cancel route handler:
 *
 *   await autoBilling.onOrderCancelled(order, reason, req.user._id);
 *
 * Returns { voided, billed, creditNoteAmount } counts so the UI can
 * surface "Voided 3 charges, ₹450 credit note raised".
 */
async function onOrderCancelled(orderDoc, reason, actorId) {
  if (!orderDoc?._id) return { voided: 0, billed: 0, creditNoteAmount: 0 };
  const reasonText = String(reason || "Order cancelled").trim();
  const actor = { fullName: actorId ? `actor:${actorId}` : "System", role: "System" };

  // Match every trigger that points at this order. Multiple linkage
  // shapes exist historically — sourceDocumentId is the canonical one,
  // but some early triggers also stamped the order id on serviceId or
  // notes. We use sourceDocumentId + sourceDocumentModel as the
  // authoritative join.
  const triggers = await BillingTrigger.find({
    sourceDocumentId:    orderDoc._id,
    sourceDocumentModel: "DoctorOrder",
    status: { $in: ["pending", "completed", "billed"] },
  });

  let voided = 0;
  let billed = 0;
  let creditNoteAmount = 0;

  // R7bm-F6 / R7bl-2 — proportional GST distribution snapshot.
  // Pre-R7bm the CN was raised with taxAmount=0, cgst=0, sgst=0, igst=0
  // — flattening the reversal to a single bucket regardless of the
  // original line tax mix. When the source bill straddled mixed slabs
  // (e.g. medicines @ 5% + consumables @ 12%), the CDNR row in GSTR-1
  // didn't match the original tax invoice's CGST/SGST/IGST split,
  // producing reconciliation flags in the GSTR-1 vs GSTR-3B sanity
  // check. The fix captures each bill line's per-item GST breakdown
  // BEFORE cancelTrigger removes it, then writes the proportional
  // split onto the CN.
  //
  // Each entry: { triggerId, netAmount, taxAmount, cgst, sgst, igst,
  //               taxPercent, originalChargeId, lineTotal }
  // where lineTotal = netAmount + taxAmount (the amount being reversed).
  const PatientBillEarly = require("../../models/PatientBillModel/PatientBillModel");
  const reversedLines = [];

  for (const t of triggers) {
    // If the trigger is already on a bill (status:"billed"), we void
    // via cancelTrigger which removes the bill line. The pro-rata CN
    // is raised below from the aggregate — but FIRST snapshot the
    // bill item's per-line GST split so we can reconstruct the
    // proportional tax distribution after the line is gone.
    try {
      const wasBilled = t.status === "billed" && t.billId && t.billItemId;
      if (wasBilled) {
        // Snapshot the line BEFORE cancelTrigger nukes it. Use .lean()
        // to avoid a save-hook side-effect; only the read matters here.
        try {
          const billDoc = await PatientBillEarly.findOne(
            { _id: t.billId, "billItems._id": t.billItemId },
            { billItems: { $elemMatch: { _id: t.billItemId } } },
          ).lean();
          const item = billDoc?.billItems?.[0];
          if (item) {
            const itemNet  = toNum(item.netAmount);
            const itemTax  = toNum(item.taxAmount);
            const itemCgst = toNum(item.cgstAmount);
            const itemSgst = toNum(item.sgstAmount);
            const itemIgst = toNum(item.igstAmount);
            const lineTotal = itemNet + itemTax;
            reversedLines.push({
              triggerId:       t._id,
              originalChargeId: item._id,
              netAmount:       itemNet,
              taxAmount:       itemTax,
              cgstAmount:      itemCgst,
              sgstAmount:      itemSgst,
              igstAmount:      itemIgst,
              taxPercent:      Number(item.taxPercent) || 0,
              lineTotal,
            });
            creditNoteAmount += lineTotal;
          } else {
            // Item not found via the elemMatch path (rare — possibly
            // the line was already removed by a parallel undo). Fall
            // back to the trigger.totalAmount so the cascade aggregate
            // is still correct, but per-line GST can't be split.
            creditNoteAmount += Number(t.totalAmount || 0);
          }
        } catch (snapErr) {
          // Snapshot failure must not block the cascade — fall back to
          // the legacy aggregate. The CN will be raised with flattened
          // tax (best the math can do without the line breakdown).
          console.warn(`[AutoBilling] onOrderCancelled line snapshot failed for trigger ${t._id}:`, snapErr.message);
          creditNoteAmount += Number(t.totalAmount || 0);
        }
        billed++;
      }
      await cancelTrigger(t._id, {
        reason: `[OrderCancelled] ${reasonText}`,
        user:   actor,
      });
      voided++;
    } catch (e) {
      // Don't block the cascade — emit a pending-review trigger so
      // the cashier can clean up the orphan manually.
      console.warn(`[AutoBilling] onOrderCancelled void of trigger ${t._id} failed:`, e.message);
      try {
        await BillingTrigger.findByIdAndUpdate(t._id, {
          status:       "pending-review",
          reviewReason: `OrderCancelled cascade failed: ${e.message}`,
          reviewedAt:   new Date(),
        });
      } catch (_) { /* best-effort */ }
    }
  }

  // Raise a single CreditNote for the aggregate billed amount. We use
  // the same shape as billingService.recordRefund's CN branch — keep
  // GSTR-1 reasoning intact. Best-effort: log on failure.
  if (creditNoteAmount > 0 && triggers.some((t) => t.billId)) {
    try {
      const CreditNote = require("../../models/Billing/CreditNote");
      // Pick the first billed trigger's billId as the anchor — all
      // triggers from a single order should be on the same admission
      // bill in practice. If they straddle bills, the CN's billId
      // identifies the primary; the audit row covers the rest.
      const anchorTrigger = triggers.find((t) => t.billId);
      const PatientBill = require("../../models/PatientBillModel/PatientBillModel");
      const bill = await PatientBill.findById(anchorTrigger.billId).lean();
      if (bill) {
        // R7bm-F6 / R7bl-2 — proportional GST distribution across the
        // reversed lines. Sum per-line taxableValue (netAmount) and
        // per-line CGST/SGST/IGST so the CDNR row mirrors the original
        // tax invoice's split exactly. Falls back to flat (tax=0) only
        // when no line snapshot was captured (legacy / snapshot failure).
        let taxableValue = 0;
        let taxAmount    = 0;
        let cgstAmount   = 0;
        let sgstAmount   = 0;
        let igstAmount   = 0;
        for (const ln of reversedLines) {
          taxableValue += ln.netAmount;
          taxAmount    += ln.taxAmount;
          cgstAmount   += ln.cgstAmount;
          sgstAmount   += ln.sgstAmount;
          igstAmount   += ln.igstAmount;
        }
        // If we didn't capture any line snapshots (e.g. older billed
        // triggers without billItemId), fall back to the flat shape so
        // the CN still records the gross refund — caller will log a
        // reconciliation hint via the audit row.
        const haveSnapshots = reversedLines.length > 0;
        if (!haveSnapshots) {
          taxableValue = creditNoteAmount;
          taxAmount = cgstAmount = sgstAmount = igstAmount = 0;
        }
        // Round to 2dp for GSTR-1 row formatting. toDec handles the
        // Decimal128 cast; we pre-round in Number space for the
        // CreditNote schema's default coercion path.
        const _round2 = (n) => Number((Number(n) || 0).toFixed(2));
        await CreditNote.create({
          billId:               bill._id,
          originalBillNumber:   bill.billNumber,
          UHID:                 bill.UHID,
          patientId:            bill.patient,
          refundAmount:         toDec(_round2(creditNoteAmount)),
          taxableValue:         toDec(_round2(taxableValue)),
          taxAmount:            toDec(_round2(taxAmount)),
          cgstAmount:           toDec(_round2(cgstAmount)),
          sgstAmount:           toDec(_round2(sgstAmount)),
          igstAmount:           toDec(_round2(igstAmount)),
          reasonCode:           "03",                 // "Deficiency in services" — closest GST code
          reasonText:           haveSnapshots
            ? `[OrderCancelled] ${reasonText} (order ${orderDoc._id}; ${reversedLines.length} line(s) reversed with per-line GST split)`
            : `[OrderCancelled] ${reasonText} (order ${orderDoc._id}; line snapshots unavailable, tax flattened)`,
          refundMode:           "ADJUST",
          issuedBy:             actor.fullName || "AutoBilling",
        });
      }
    } catch (e) {
      console.warn(`[AutoBilling] onOrderCancelled CN failed for order ${orderDoc._id}:`, e.message);
      // Emit a pending-review marker so the cashier reconciles manually.
      try {
        // R7bh-F3 / R7bg-1-CRIT-6: route through _emitTrigger so the
        // pending-review marker also carries the attribution trio. The
        // actor on the cancellation is who fired the cascade.
        await _emitTrigger({
          admissionId:         orderDoc.admissionId,
          UHID:                orderDoc.UHID,
          patientType:         "IPD",
          serviceCode:         "CN-PENDING",
          serviceName:         `Pending CreditNote for cancelled order ${orderDoc._id}`,
          quantity:            1,
          unitPrice:           toNum(creditNoteAmount),
          totalAmount:         toNum(creditNoteAmount),
          sourceType:          "Manual",
          sourceDocumentId:    orderDoc._id,
          sourceDocumentModel: "DoctorOrder",
          orderedBy:           actor.fullName,
          orderedByRole:       "System",
          status:              "pending-review",
          reviewReason:        `Order cancellation CN failed: ${e.message}`,
        }, { name: actor.fullName || "System", role: actor.role || "System" });
      } catch (_) { /* best-effort */ }
    }
  }

  // R7bj-F5 / R7bi-6-TBA-CRIT-1: ORDER_CANCELLED summary audit row. One
  // row per order cancellation captures the cascade aggregate (so the
  // GST register can show "Order X cancelled, ₹Y CN raised, N triggers
  // voided"). Per-trigger void rows are already emitted inside
  // cancelTrigger above.
  try {
    const { emitBillingAudit } = require("../../models/Billing/BillingAudit");
    await emitBillingAudit({
      event:     "ORDER_CANCELLED",
      UHID:      orderDoc.UHID,
      admissionId: orderDoc.admissionId,
      amount:    creditNoteAmount,
      actorId:   actorId,
      actorName: actor.fullName,
      actorRole: actor.role,
      reason:    reasonText,
      after:     { orderId: orderDoc._id, voided, billed, creditNoteAmount },
    });
  } catch (e) { console.warn("[autoBilling] ORDER_CANCELLED audit failed (non-fatal):", e?.message); }

  return { voided, billed, creditNoteAmount };
}

// ─────────────────────────────────────────────────────────────────────
// R7az-NOTE for Agent D (D6-CRIT-2): the route handler
// POST /api/doctor-orders/:id/administer must call
//   await autoBilling.onMARAdministration(marDoc, med, adminEntry)
// after the order's administrationRecord entry is persisted, so the
// MAR-administer billing fires for orders that bypass the MAR
// controller path. This file's onMARAdministration is idempotent (the
// MAR_RESERVATION dedup query above guards against duplicates).
//
// R7az-NOTE for Agent B (D7-CRIT-1): when MAR ingest happens via
// marController.recordAdministration, please call
//   const { assertDrugSafeOrOverride } = require("../../utils/allergyCheck");
//   assertDrugSafeOrOverride(med, patient.allergies, { overrideReason, label: "mar-admin" });
// BEFORE persisting the admin row + then call
//   autoBilling.onMARNonAdminister(marDoc, med, status)
// when the status is HELD / REFUSED / MISSED / NOT_AVAILABLE so the
// pharmacy reservation row gets voided in lock-step.
// ─────────────────────────────────────────────────────────────────────

// ═══════════════════════════════════════════════════════════════════════════════
// IPD LIVE LEDGER — undo / override / cancel / read
// (Phase A of the end-to-end IPD/Daycare billing redesign. See
//  C:\Users\Dr Sandeep\.claude\projects\C--Spherehealth\memory\project_billing_design.md
//  for the design rationale: "Live screen must always show Undo button —
//  time-limited — for auto-posted charges. Manual override any time with
//  mandatory reason. Full audit trail.")
// ═══════════════════════════════════════════════════════════════════════════════

const UNDO_WINDOW_MS = 15 * 60 * 1000; // 15-min receptionist undo window

// Internal helper — removes a single bill line by item id and re-saves the
// bill so pre-save totals recompute. Returns the fresh bill. Bails on closed
// bills (PAID/CANCELLED/REFUNDED) — those need a refund flow, not an undo.
// R7au-FIX-10/D7-HIGH-C10: wrap in retryVersionError so concurrent
// payment/charge writes between findById and save() don't 500 the IPD
// ledger. Pre-R7au every undo/override/cancel on a live IPD bill could
// throw VersionError under cashier traffic — clinician saw "Internal
// Server Error" and tried again, sometimes double-undoing.
async function removeBillItemAndResave(billId, billItemId) {
  if (!billId || !billItemId) return null;
  const retryVE = require("../../utils/retryVersionError");
  return retryVE(async () => {
    const bill = await PatientBill.findById(billId);
    if (!bill) return null;
    if (["PAID", "CANCELLED", "REFUNDED"].includes(bill.billStatus)) {
      const err = new Error(`Cannot undo — bill is ${bill.billStatus}. Use refund/cancel flow.`);
      err.code = "BILL_CLOSED";
      throw err;
    }
    const before = bill.billItems.length;
    bill.billItems = bill.billItems.filter(i => String(i._id) !== String(billItemId));
    if (bill.billItems.length === before) return bill;     // nothing to remove
    await bill.save();
    return bill;
  }, { label: "removeBillItemAndResave" });
}

/**
 * Undo a trigger — receptionist's "oh no I shouldn't have triggered that"
 * 15-min escape hatch for auto-charges. Voids the trigger, removes the
 * matching bill line, recomputes totals. Returns the fresh trigger + bill.
 *
 * Rules:
 *   - trigger must be autoCharged (manual lines use the line-edit endpoint)
 *   - createdAt < 15 min ago (controller can pass `skipTimeGate` for Admins
 *     who want to bypass — kept off by default for receptionists)
 *   - status must be `billed` (`pending`/`completed` aren't on the bill yet)
 *   - reason is mandatory — audit trail loses meaning without it
 */
async function undoTrigger(triggerId, { reason, user, skipTimeGate = false } = {}) {
  if (!reason || !String(reason).trim()) {
    const err = new Error("Reason is required for undo");
    err.code = "REASON_REQUIRED";
    throw err;
  }
  const trigger = await BillingTrigger.findById(triggerId);
  if (!trigger) {
    const err = new Error("Trigger not found");
    err.status = 404;
    throw err;
  }
  if (trigger.status === "voided" || trigger.status === "cancelled") {
    const err = new Error(`Trigger already ${trigger.status}`);
    err.code = "ALREADY_CLOSED";
    throw err;
  }
  if (!trigger.autoCharged) {
    const err = new Error("Only auto-charges can be undone. Use line-edit for manual charges.");
    err.code = "NOT_AUTO";
    throw err;
  }
  if (!skipTimeGate) {
    const age = Date.now() - new Date(trigger.createdAt).getTime();
    if (age > UNDO_WINDOW_MS) {
      const err = new Error(`Undo window expired (${Math.round(age / 60000)} min old). Use override instead.`);
      err.code = "WINDOW_EXPIRED";
      throw err;
    }
  }

  // Remove the bill line if one exists. Closed-bill error bubbles up.
  if (trigger.billId && trigger.billItemId) {
    await removeBillItemAndResave(trigger.billId, trigger.billItemId);
  }

  trigger.status        = "voided";
  trigger.voidedAt      = new Date();
  trigger.voidedBy      = user?.fullName || user?.name || "System";
  trigger.voidedByRole  = user?.role || "System";
  trigger.voidReason    = String(reason).trim();
  await trigger.save();

  // R7bj-F5 / R7bi-6-TBA-CRIT-1: TRIGGER_VOIDED audit row. Best-effort.
  try {
    const { emitBillingAudit } = require("../../models/Billing/BillingAudit");
    await emitBillingAudit({
      event:       "TRIGGER_VOIDED",
      UHID:        trigger.UHID,
      admissionId: trigger.admissionId,
      triggerId:   trigger._id,
      billId:      trigger.billId,
      amount:      trigger.totalAmount,
      actorId:     user?._id || user?.id,
      actorName:   trigger.voidedBy,
      actorRole:   trigger.voidedByRole,
      reason:      `[Undo] ${trigger.voidReason}`,
      before:      { status: "billed", serviceCode: trigger.serviceCode, totalAmount: trigger.totalAmount },
      after:       { status: "voided" },
    });
  } catch (e) { console.warn("[autoBilling] TRIGGER_VOIDED audit failed (non-fatal):", e?.message); }

  return trigger;
}

/**
 * Override a trigger — edits the bill line in place (qty, unitPrice). Used
 * after the 15-min undo window closes, or for any trigger whose price the
 * accountant wants to adjust without removing the charge entirely. Every
 * change appends to overrideHistory[] so the audit trail can replay.
 */
async function overrideTrigger(triggerId, { quantity, unitPrice, reason, user } = {}) {
  if (!reason || !String(reason).trim()) {
    const err = new Error("Reason is required for override");
    err.code = "REASON_REQUIRED";
    throw err;
  }
  const trigger = await BillingTrigger.findById(triggerId);
  if (!trigger) {
    const err = new Error("Trigger not found");
    err.status = 404;
    throw err;
  }
  if (trigger.status === "voided" || trigger.status === "cancelled") {
    const err = new Error(`Trigger is ${trigger.status} — cannot override`);
    err.code = "ALREADY_CLOSED";
    throw err;
  }

  const newQty   = quantity != null ? Number(quantity) : trigger.quantity;
  const newPrice = unitPrice != null ? Number(unitPrice) : trigger.unitPrice;
  if (!Number.isFinite(newQty) || newQty <= 0) {
    const err = new Error("Invalid quantity");
    err.code = "INVALID_QTY";
    throw err;
  }
  if (!Number.isFinite(newPrice) || newPrice < 0) {
    const err = new Error("Invalid unit price");
    err.code = "INVALID_PRICE";
    throw err;
  }

  // Snapshot the BEFORE state for audit before mutating.
  const before = {
    quantity:    trigger.quantity,
    unitPrice:   trigger.unitPrice,
    totalAmount: trigger.totalAmount,
  };

  // Edit the bill line if one exists.
  if (trigger.billId && trigger.billItemId) {
    const bill = await PatientBill.findById(trigger.billId);
    if (!bill) {
      const err = new Error("Bill not found");
      err.code = "BILL_MISSING";
      throw err;
    }
    if (["PAID", "CANCELLED", "REFUNDED"].includes(bill.billStatus)) {
      const err = new Error(`Cannot override — bill is ${bill.billStatus}. Use refund flow.`);
      err.code = "BILL_CLOSED";
      throw err;
    }
    const item = bill.billItems.id(trigger.billItemId);
    if (item) {
      item.quantity  = newQty;
      item.unitPrice = newPrice;
      // grossAmount / netAmount / patient + TPA splits get recomputed in
      // the bill's pre-save hook; we only set the inputs.
      await bill.save();
    }
  }

  trigger.quantity    = newQty;
  trigger.unitPrice   = newPrice;
  trigger.totalAmount = newQty * newPrice;
  trigger.overrideHistory.push({
    field:         "qty/price",
    oldValue:      before,
    newValue:      { quantity: newQty, unitPrice: newPrice, totalAmount: newQty * newPrice },
    reason:        String(reason).trim(),
    changedBy:     user?.fullName || user?.name || "System",
    changedByRole: user?.role || "System",
    changedById:   user?._id || user?.id,
  });
  await trigger.save();
  return trigger;
}

/**
 * Cancel a trigger — same effect as undo but with no time gate. For when
 * the charge is permanently wrong (patient never received the service)
 * and an accountant signs off. Removes the bill line, voids the trigger.
 * Distinct from undo so the audit reason field can be "Cancelled (never
 * delivered)" vs "Undone (entered in error)".
 */
async function cancelTrigger(triggerId, { reason, user } = {}) {
  if (!reason || !String(reason).trim()) {
    const err = new Error("Reason is required for cancel");
    err.code = "REASON_REQUIRED";
    throw err;
  }
  const trigger = await BillingTrigger.findById(triggerId);
  if (!trigger) {
    const err = new Error("Trigger not found");
    err.status = 404;
    throw err;
  }
  if (trigger.status === "voided" || trigger.status === "cancelled") {
    const err = new Error(`Trigger already ${trigger.status}`);
    err.code = "ALREADY_CLOSED";
    throw err;
  }
  if (trigger.billId && trigger.billItemId) {
    await removeBillItemAndResave(trigger.billId, trigger.billItemId);
  }
  trigger.status       = "cancelled";
  trigger.voidedAt     = new Date();
  trigger.voidedBy     = user?.fullName || user?.name || "System";
  trigger.voidedByRole = user?.role || "System";
  trigger.voidReason   = `[Cancel] ${String(reason).trim()}`;
  await trigger.save();

  // R7bj-F5 / R7bi-6-TBA-CRIT-1: TRIGGER_VOIDED audit row (cancel branch).
  try {
    const { emitBillingAudit } = require("../../models/Billing/BillingAudit");
    await emitBillingAudit({
      event:       "TRIGGER_VOIDED",
      UHID:        trigger.UHID,
      admissionId: trigger.admissionId,
      triggerId:   trigger._id,
      billId:      trigger.billId,
      amount:      trigger.totalAmount,
      actorId:     user?._id || user?.id,
      actorName:   trigger.voidedBy,
      actorRole:   trigger.voidedByRole,
      reason:      trigger.voidReason,
      before:      { status: "billed", serviceCode: trigger.serviceCode, totalAmount: trigger.totalAmount },
      after:       { status: "cancelled" },
    });
  } catch (e) { console.warn("[autoBilling] TRIGGER_VOIDED audit failed (non-fatal):", e?.message); }

  return trigger;
}

/**
 * B4-T08: Retry a stuck (pending-review) trigger.
 *
 * Called by /api/billing/triggers/:id/retry after the controller has flipped
 * the trigger to status:"queued" + stamped retriedAt/retriedBy. We re-run
 * the same accrual logic createTrigger ran on first fire: resolve the
 * service, find-or-create the DRAFT bill, push the line via addItemToBill.
 *
 * Outcomes:
 *   • Success → trigger.status = "applied", billId/billItemId stamped,
 *     reviewReason cleared. Returns { status:"applied", billId, billItemId }.
 *   • Failure → trigger.status flips back to "pending-review" with a fresh
 *     reviewReason describing why this retry failed (closed bill, missing
 *     service, etc.). Returns { status:"pending-review", reviewReason }.
 *
 * Never throws — every failure path lands on pending-review so the operator
 * can see the new reason in the Stuck Triggers tile and decide whether to
 * retry again, cancel, or escalate.
 */
async function retryTrigger(triggerId, user = {}) {
  const trigger = await BillingTrigger.findById(triggerId);
  if (!trigger) {
    const err = new Error("Trigger not found");
    err.status = 404;
    err.code = "TRIGGER_NOT_FOUND";
    throw err;
  }
  // The controller flips status:"queued" before calling us. Defend against
  // a stale caller that hands us a trigger still in pending-review (or any
  // unexpected state) — we only re-run the accrual when the controller has
  // explicitly handed us a queued row.
  if (trigger.status !== "queued") {
    const err = new Error(`retryTrigger expected status:"queued", got "${trigger.status}"`);
    err.code = "TRIGGER_NOT_QUEUED";
    err.status = 409;
    throw err;
  }

  // Retry path needs an admissionId — pending-review is documented (per
  // BillingTrigger schema comments) as the IPD Live Ledger's Stuck-Triggers
  // tile context. Without an admissionId we can't resolve a draft bill,
  // so flip back to pending-review with a fresh reason.
  const _flipBackToReview = async (newReason) => {
    trigger.status       = "pending-review";
    trigger.reviewReason = newReason;
    trigger.reviewedAt   = new Date();
    trigger.reviewedBy   = user?.fullName || user?.name || "System";
    await trigger.save();
    return { status: "pending-review", reviewReason: newReason };
  };

  if (!trigger.admissionId) {
    return _flipBackToReview("Retry not supported: trigger has no admissionId");
  }

  // Resolve service: prefer the stored serviceId, fall back to code lookup.
  let service = null;
  if (trigger.serviceId) {
    service = await ServiceMaster.findById(trigger.serviceId).lean();
  }
  if (!service && trigger.serviceCode) {
    service = await findServiceByCode(trigger.serviceCode);
  }
  // Synthetic service fallback: createTrigger accepts a trigger whose
  // ServiceMaster row hasn't been seeded yet, as long as the trigger has
  // the code + name + unitPrice. Mirror that here so a retry doesn't
  // regress on the seed-lag case.
  if (!service) {
    if (!trigger.serviceCode || !trigger.serviceName) {
      return _flipBackToReview(
        `Retry failed: ServiceMaster row missing for ${trigger.serviceCode || "(no code)"} and no fallback name/price on the trigger`,
      );
    }
    service = {
      _id: undefined,
      serviceCode: trigger.serviceCode,
      serviceName: trigger.serviceName,
      category: "Service",
      billingType: "PER_DAY",
      defaultPrice: toNum(trigger.unitPrice ?? 0),
    };
  }

  // Get-or-create the DRAFT bill. If the admission has been finalised
  // (PAID/CANCELLED/REFUNDED) the addItemToBill guard below will catch it
  // and return null — _flipBackToReview captures the specific reason.
  const bill = await getOrCreateBill(trigger.admissionId, trigger.patientType || "IPD");
  if (!bill) {
    return _flipBackToReview(
      `Retry failed: getOrCreateBill returned null for admission=${trigger.admissionId} patientType=${trigger.patientType || "IPD"}`,
    );
  }

  // Re-derive addedBySource from the original sourceType — same mapping
  // createTrigger uses on first fire so the bill-item attribution matches.
  const _addedBySource =
    trigger.sourceType === "DoctorNote"         ? "Doctor" :
    trigger.sourceType === "NurseNote"          ? "Nurse"  :
    trigger.sourceType === "MAR"                ? "Nurse"  :
    trigger.sourceType === "Equipment"          ? "Nurse"  :
    trigger.sourceType === "InvestigationOrder" ? "Lab"    :
    "Auto";

  const result = await addItemToBill(
    bill,
    service,
    trigger.quantity || 1,
    {
      addedBySource: _addedBySource,
      addedBy:       trigger.completedBy || trigger.orderedBy || user?.fullName || "System",
      addedByRole:   trigger.completedByRole || trigger.orderedByRole || "System",
      remarks:       `[Retry] ${trigger.sourceType} — ${trigger.orderDetails || trigger.serviceName || trigger.serviceCode}`,
      sourceType:    trigger.sourceType,
      // Re-use the trigger's unitPrice as the override so a retry doesn't
      // re-price off the live tariff and surprise the patient with a
      // different number than the original fire showed.
      unitPriceOverride: toNum(trigger.unitPrice ?? 0) > 0 ? toNum(trigger.unitPrice) : undefined,
    },
    trigger,
  );

  if (result) {
    trigger.status       = "applied";
    trigger.billId       = result.bill._id;
    trigger.billItemId   = result.itemId;
    trigger.billedAt     = new Date();
    trigger.billedBy     = user?.fullName || user?.name || trigger.completedBy || trigger.orderedBy || "System";
    trigger.unitPrice    = result.unitPrice;
    trigger.totalAmount  = result.totalAmt;
    // Clear the stuck-trigger metadata now that we've recovered. retriedAt /
    // retriedBy stay on the doc so the audit trail can still tie the retry
    // back to a person — only the failure-side reviewReason is wiped.
    trigger.reviewReason = undefined;
    await trigger.save();
    return {
      status:     "applied",
      billId:     result.bill._id,
      billItemId: result.itemId,
    };
  }

  // addItemToBill returned null. Most likely a closed/frozen bill —
  // the inner guard may already have flipped the trigger to "skipped"
  // (PAID/CANCELLED/REFUNDED) as a legitimate business outcome. Re-read
  // the trigger to see if that happened; if it did, surface the skip
  // reason instead of clobbering it with a fresh pending-review row.
  const fresh = await BillingTrigger.findById(triggerId).lean();
  if (fresh?.status === "skipped") {
    return { status: "skipped", reviewReason: fresh.skipReason || "Bill closed — no new charges accepted" };
  }
  return _flipBackToReview(
    `Retry failed: addItemToBill returned null for ${trigger.serviceCode} on bill ${bill._id} (status=${bill.billStatus})`,
  );
}

/**
 * Add a manual charge to a patient's bill ledger.
 *
 * Used by the "Add Charge" button on the IPD Live Billing page — lets any
 * caller with appropriate role (doctor adding a procedure they performed,
 * nurse adding nursing-care line, receptionist / accountant adding an
 * ad-hoc fee) push a single line into the running DRAFT bill via the same
 * BillingTrigger + autoBilling pipeline that powers all other charges.
 *
 * Source-of-truth on price = caller-supplied unitPrice if provided, else
 * ServiceMaster default. Accountant/Admin can override the price; lower
 * tiers should NOT pass unitPrice (the controller enforces this).
 *
 * Returns the created BillingTrigger.
 */
async function addManualCharge(admissionId, { serviceId, quantity = 1, unitPrice, remarks, user = {} }) {
  if (!admissionId) {
    const err = new Error("admissionId is required"); err.code = "ARG_MISSING"; throw err;
  }
  if (!serviceId) {
    const err = new Error("serviceId is required"); err.code = "ARG_MISSING"; throw err;
  }
  const qty = Number(quantity) || 1;
  if (qty <= 0) {
    const err = new Error("quantity must be > 0"); err.code = "INVALID_QTY"; throw err;
  }

  const admission = await Admission.findById(admissionId).lean();
  if (!admission) {
    const err = new Error("Admission not found"); err.status = 404; throw err;
  }

  const service = await ServiceMaster.findById(serviceId).lean();
  if (!service) {
    const err = new Error("Service not found"); err.status = 404; throw err;
  }

  // Patient type mirrors how flushDailyChargesForAdmission classifies.
  const typeMap = {
    Planned: "IPD", Emergency: "EMERGENCY", "Day Care": "DAYCARE",
    Daycare: "DAYCARE", Transfer: "IPD",
  };
  const patientType = typeMap[admission.admissionType] || "IPD";

  // Caller-supplied price only if Accountant/Admin (controller pre-check),
  // otherwise null → createTrigger will resolve via ServicePricing + tariff.
  const override = unitPrice != null && unitPrice !== "" ? Number(unitPrice) : null;
  if (override != null && (!Number.isFinite(override) || override < 0)) {
    const err = new Error("Invalid unitPrice"); err.code = "INVALID_PRICE"; throw err;
  }

  const result = await createTrigger({
    admissionId,
    patientId:           admission.patientId,
    UHID:                admission.UHID,
    patientType,
    serviceId:           service._id,
    serviceCode:         service.serviceCode,
    serviceName:         service.serviceName,
    quantity:            qty,
    sourceType:          "Manual",
    sourceDocumentModel: "Manual",
    orderedBy:           user.fullName || user.name || "Manual entry",
    orderedById:         user._id || user.id,
    orderedByRole:       user.role || "System",
    completedBy:         user.fullName || user.name || "Manual entry",
    completedById:       user._id || user.id,
    completedByRole:     user.role || "System",
    orderDetails:        remarks?.trim()
      ? `${service.serviceName} — ${remarks.trim()}`
      : `${service.serviceName} (manual add by ${user.role || "user"})`,
    autoCharge:          true,
    // No dailyDedup — manual entries can legitimately repeat (a nurse
    // adding a syringe twice in one day for two different injections).
    dailyDedup:          false,
    unitPriceOverride:   override,
    notes:               remarks?.trim() || undefined,
    department:          admission.department,
  });

  return result;
}

/**
 * Live IPD ledger — single endpoint that powers the IPD Live Billing page.
 * Returns the admission + bill summary + every trigger (with computed
 * canUndo/canOverride flags scoped to the requesting user's role) +
 * category-grouped + day-grouped buckets so the UI doesn't have to
 * re-aggregate on every render.
 */
async function getIPDLedger(admissionId, user = {}) {
  const { roleCan } = require("../../config/permissions");
  const userRole = user?.role || "Guest";
  const canUndoAny     = roleCan(userRole, "billing.undo");
  const canOverrideAny = roleCan(userRole, "billing.override");
  const canCancelAny   = roleCan(userRole, "billing.cancel-charge");

  const admission = await Admission.findById(admissionId)
    .populate("patientId", "fullName UHID age gender contactNumber")
    .populate("bedId")
    .lean();
  if (!admission) {
    const err = new Error("Admission not found");
    err.status = 404;
    throw err;
  }

  // All triggers for this admission, freshest first (so the live view
  // shows what just fired at the top — receptionist's eye lands on the
  // row they'd want to undo). Populate serviceId.category so the
  // frontend's print-category mapping can use the master's canonical
  // category (e.g. "DOCTOR" → "Doctor / Consultant Fees") even when
  // the serviceCode prefix is unusual (IPD-DOC-002, OPD-CON-005 etc.).
  const triggers = await BillingTrigger.find({ admissionId })
    .populate("serviceId", "category serviceCode serviceName")
    .sort({ createdAt: -1 })
    .lean();

  // Decorate each trigger with permission flags + age + linked bill item.
  const now = Date.now();
  const decorated = triggers.map(t => {
    const age = now - new Date(t.createdAt).getTime();
    const ageMs = age;
    const closed = t.status === "voided" || t.status === "cancelled" || t.status === "skipped";
    return {
      ...t,
      ageMs,
      canUndo:     canUndoAny     && t.autoCharged && !closed && (userRole === "Admin" || ageMs <= UNDO_WINDOW_MS) && t.status === "billed",
      canOverride: canOverrideAny && !closed,
      canCancel:   canCancelAny   && !closed,
      undoWindowExpiresAt: t.autoCharged ? new Date(new Date(t.createdAt).getTime() + UNDO_WINDOW_MS) : null,
    };
  });

  // Category-grouped — for the "Category" tab on the UI. Sums totals so
  // the section header can show "Bed Charges — ₹4,500 (3 lines)".
  // R7gg — Cap the per-category `items` array at 200 rows so a polluted
  // category (we hit 36k EQUIP rows on Badal) can't ship a 16 MB payload
  // that freezes the renderer. count + total stay accurate (computed
  // from ALL active triggers); only the items list is truncated, with
  // a sentinel `truncated:true` and `truncatedAt:N` for the UI to show
  // a "showing first 200 of N" hint when needed.
  const ITEMS_PER_CATEGORY_CAP = 200;
  const byCategory = {};
  for (const t of decorated) {
    if (t.status === "voided" || t.status === "cancelled" || t.status === "skipped") continue;
    let cat = t.serviceCode?.split("-")[0] || "OTHER";
    // R7hr-193 (G5): NRS-* (nurse procedure charges) and NURSING-* (room
    // matrix daily nursing care) both display as "Nursing" on the ledger
    // Category tab — two identical headers confused the desk. Merge the
    // prefixes into one NURSING bucket.
    if (cat === "NRS") cat = "NURSING";
    if (!byCategory[cat]) byCategory[cat] = { category: cat, count: 0, total: 0, items: [], truncated: false, truncatedAt: 0 };
    byCategory[cat].count += 1;
    byCategory[cat].total += Number(t.totalAmount || 0);
    if (byCategory[cat].items.length < ITEMS_PER_CATEGORY_CAP) {
      byCategory[cat].items.push(t);
    } else if (!byCategory[cat].truncated) {
      byCategory[cat].truncated = true;
      byCategory[cat].truncatedAt = ITEMS_PER_CATEGORY_CAP;
    }
  }

  // Day-grouped — for the "Daily breakdown" tab. Uses dateKey (YYYY-MM-DD,
  // hospital-tz). Day-1 / Day-2... computed from admission.admissionDate.
  const byDay = {};
  const admitDay = new Date(admission.admissionDate);
  admitDay.setHours(0, 0, 0, 0);
  for (const t of decorated) {
    if (t.status === "voided" || t.status === "cancelled" || t.status === "skipped") continue;
    const d = t.dateKey || (t.createdAt ? new Date(t.createdAt).toISOString().slice(0, 10) : "unknown");
    if (!byDay[d]) {
      const dayDate = new Date(d);
      const dayN = Math.floor((dayDate - admitDay) / 86400000) + 1;
      byDay[d] = { dateKey: d, dayN, count: 0, total: 0, items: [] };
    }
    byDay[d].count += 1;
    byDay[d].total += Number(t.totalAmount || 0);
    byDay[d].items.push(t);
  }

  // Bill summary — pull every bill linked to this admission (the
  // auto-biller may have split charges across DRAFT + closed bills
  // across the stay), aggregate them, and prefer the latest DRAFT
  // bill for "open this bill" actions. Sorting by createdAt:1 so the
  // earliest live bill wins when picking the primary action target —
  // newer DRAFTs (created mid-stay after a previous one settled) take
  // precedence over PAID/CANCELLED.
  const { toNum, decimalToNumber } = require("../../utils/money");
  const allBills = await PatientBill.find({ admission: admissionId })
    .sort({ createdAt: 1 })
    .lean();

  // Pick the "active" bill for action buttons: prefer DRAFT, then
  // GENERATED/PARTIAL, then fall back to any. This is the bill the
  // Print Interim / Open Billing Counter actions will target.
  const draftBill = allBills.find(b => b.billStatus === "DRAFT");
  const openBill  = allBills.find(b => ["GENERATED", "PARTIAL"].includes(b.billStatus));
  const bill = draftBill || openBill || allBills[allBills.length - 1] || null;

  // Aggregate totals across all bills for the admission so the KPIs
  // reflect the full lifetime ledger — not just one of the bills.
  // toNum() unwraps Decimal128 / number / string into a clean Number,
  // sidestepping the .lean()-strips-toJSON-transform problem that made
  // grossAmount show up as { $numberDecimal: "..." } on the wire.
  const billSummary = allBills.reduce((acc, b) => {
    acc.grossAmount   += toNum(b.grossAmount);
    acc.totalDiscount += toNum(b.totalDiscount);
    acc.netAmount     += toNum(b.netAmount);
    acc.advancePaid   += toNum(b.advancePaid);
    acc.balanceAmount += toNum(b.balanceAmount);
    return acc;
  }, { grossAmount: 0, totalDiscount: 0, netAmount: 0, advancePaid: 0, balanceAmount: 0 });

  // Advance balance (UHID-level pool). PatientAdvance is summed across
  // any unspent receipts so the action bar can show "Advance: ₹5,000".
  // R7ap-F6/D2-09/D9-01: PatientAdvance has NO `balance` field — only the
  // `remainingAmount` virtual (which `.lean()` strips). The previous
  // `Number(a.balance) || 0` returned 0 for every row → IPD ledger advance
  // permanently ₹0 even when patient had unspent deposits. Use the same
  // formula as patientAdvanceService.getUnspentBalance / listAdvancesForUHID.
  let advanceBalance = 0;
  try {
    const PatientAdvance = require("../../models/PatientBillModel/PatientAdvanceModel");
    const advances = await PatientAdvance.find({
      UHID: admission.UHID,
      status: { $in: ["ACTIVE", "PARTIALLY_APPLIED"] },
    }).lean();
    advanceBalance = advances.reduce(
      (s, a) => s + Math.max(0, toNum(a.amount) - toNum(a.appliedAmount) - toNum(a.refundedAmount)),
      0,
    );
  } catch (e) {
    console.warn("[IPDLedger] PatientAdvance lookup skipped:", e.message);
  }

  // R7hr(billing-audit P1.2) — Pre-admission OPD charges. When this admission
  // converted from a same-day OPD visit (admissionService stamps
  // convertedFromAdmission), surface that OPD visit's bill(s) here so the IPD
  // Live Ledger + final bill + discharge dues gate see the WHOLE episode
  // (OPD + IPD) in one place. Read-only join — the OPD bill stays its own
  // document (own bill number, GST, audit); line items are never merged.
  let linkedOpd = null;
  if (admission.convertedFromAdmission) {
    try {
      const opdAdm = await Admission.findById(admission.convertedFromAdmission)
        .select("admissionNumber visitNumber admissionType admissionDate")
        .lean();
      const opdBills = await PatientBill.find({ admission: admission.convertedFromAdmission })
        .sort({ createdAt: 1 })
        .lean();
      if (opdBills.length) {
        opdBills.forEach(b => decimalToNumber(null, b));
        const opdSummary = opdBills.reduce((acc, b) => {
          acc.netAmount     += toNum(b.netAmount);
          acc.balanceAmount += toNum(b.balanceAmount);
          acc.advancePaid   += toNum(b.advancePaid);
          return acc;
        }, { netAmount: 0, balanceAmount: 0, advancePaid: 0 });
        linkedOpd = {
          admissionId:     admission.convertedFromAdmission,
          admissionNumber: opdAdm?.admissionNumber || "",
          visitNumber:     opdAdm?.visitNumber || "",
          visitDate:       opdAdm?.admissionDate || null,
          bills:           opdBills,
          ...opdSummary,
        };
      }
    } catch (e) {
      console.warn("[IPDLedger] linked-OPD lookup skipped:", e.message);
    }
  }

  // Sum of all live (non-void/cancelled/skipped) trigger totals — used
  // as a fallback when no bill items exist yet (e.g. brand-new admission)
  // or when bill aggregation is suspiciously empty.
  const triggerLiveTotal = decorated
    .filter(t => !["voided", "cancelled", "skipped"].includes(t.status))
    .reduce((s, t) => s + toNum(t.totalAmount), 0);

  // R7ey-F18 — Architectural fix. .lean() bypasses each schema's toJSON
  // decimalToNumber transform, so the wire shipped raw Decimal128 EJSON
  // ({$numberDecimal:"500"}) for every money field on admission / bills /
  // triggers. Frontend consumers had to compensate per-field with toMoney
  // calls — they missed sites (R7ex / F1 / F16 / F17), so amounts rendered
  // as ₹0 or NaN. Unwrap ONCE here: walks recursively over every nested
  // money field. Closes the class at the source.
  decimalToNumber(null, admission);
  allBills.forEach(b => decimalToNumber(null, b));   // also covers `bill` (same refs)
  decorated.forEach(t => decimalToNumber(null, t));  // also covers byCategory/byDay items (same refs)

  return {
    admission,
    bill,                                  // The "active" bill for action buttons (DRAFT-preferred)
    bills: allBills,                       // Every bill linked to this admission
    billSummary,                           // Aggregated totals across all bills (Decimal128-flattened)
    triggerLiveTotal,                      // Sum of live triggers — fallback when billSummary is 0
    advanceBalance,
    linkedOpd,                             // R7hr(P1.2) — same-episode OPD bill(s) if this admission converted from OPD; else null
    triggers: decorated,
    byCategory: Object.values(byCategory).sort((a, b) => b.total - a.total),
    byDay: Object.values(byDay).sort((a, b) => a.dateKey.localeCompare(b.dateKey)),
    counts: {
      total:     decorated.length,
      billed:    decorated.filter(t => t.status === "billed").length,
      pending:   decorated.filter(t => t.status === "pending").length,
      voided:    decorated.filter(t => t.status === "voided").length,
      cancelled: decorated.filter(t => t.status === "cancelled").length,
      // Stuck triggers — auto-bill flow couldn't land the line item.
      // Operator action required (manual review / retry / cancel).
      pendingReview: decorated.filter(t => t.status === "pending-review").length,
    },
    permissions: { canUndoAny, canOverrideAny, canCancelAny },
    undoWindowMs: UNDO_WINDOW_MS,
  };
}

module.exports = {
  onNurseNoteSaved,
  onDoctorNoteSaved,
  onMARAdministration,
  // R7az-CRIT-6: MAR HELD/REFUSED/MISSED voids the pharmacy reservation
  onMARNonAdminister,
  // R7gz: Pharmacy return voids the matching IPD ledger PHARM trigger
  onPharmacyReturn,
  onInvestigationOrdered,
  onInvestigationResulted,
  // R7hr-83 Phase C — auto-bill on doctor-order completion (idempotent
  // per (sourceType, sourceRef)). Wired from the DoctorOrder completion
  // flow after Phase B has stamped serviceCode/unitPrice on the order.
  onDoctorOrderCompleted,
  onEquipmentCharged,
  confirmAndBillTrigger,
  getAuditTrail,
  getAdmissionBillingSummary,
  createTrigger,
  // OPD handlers
  onOPDRegistered,
  onOPDVitalsRecorded,
  onOPDAssessmentSaved,
  // Admission/ER handlers
  onAdmissionCreated,
  onEmergencyVisitCreated,
  // Daily accrual + on-demand flush (admission discharge calls flushDailyChargesForAdmission)
  flushDailyChargesForAdmission,
  runDailyBedChargeAccrual,
  // Retroactive backfill (bill creation calls this for active admissions)
  backfillAdmissionCharges,
  // ANH package matching (used by admin endpoints + admissionController)
  findMatchingPackage,
  attachPackageToAdmission,
  tokenize,
  // IPD Live Ledger (Phase A — undo/override/cancel/read)
  undoTrigger,
  overrideTrigger,
  cancelTrigger,
  // B4-T08: Stuck-trigger re-fire (POST /api/billing/triggers/:id/retry)
  retryTrigger,
  getIPDLedger,
  addManualCharge,
  // Pharmacy indent release → reservation billing hook
  onIndentReleased,
  // R7hr-12-S2 (D3-03): Pharmacy indent return → void matching MAR
  // reservation triggers (called from indentService.returnIndent).
  onIndentReturned,
  // R7az-CRIT-7: order-cancellation refund cascade (Agent D wires the route)
  onOrderCancelled,
  UNDO_WINDOW_MS,
  // R7bm-F3 / META-3: exported for use by support-staff service-layer
  // emit sites (physioService.completeSession, kitchenIndentService.markServed)
  // so a single helper writes the trigger AND fires the TRIGGER_EMITTED
  // BillingAudit row in one go. Pre-R7bm those sites called
  // BillingTrigger.create() directly and the audit row was skipped.
  _emitTrigger,
};
