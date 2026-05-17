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
async function resolveBedAndNursingRates(admission) {
  const empty = { bedRate: 0, nursingRate: 0, categoryCode: null, categoryName: null, roomType: null };
  if (!admission?.roomId) return empty;
  try {
    const room = await Room.findById(admission.roomId).populate("roomCategory").lean();
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

// ── Helper: map doctor note (type + shift) → billable visit code ─────────────
// One charge per doctor per round per day. The dedup-by-doctor flag ensures
// two consultants on the same day each get a separate line.
function resolveDoctorVisitCode(noteType, shift) {
  const nt = String(noteType || "").toLowerCase();
  const sh = String(shift || "").toLowerCase();
  if (nt === "consultation") return { code: "DOC-CONSULT",      name: "Inter-department Consultation", dailyDedup: false, dedupByDoctor: true };
  if (nt === "admission")    return { code: "DOC-ADMISSION",    name: "Admission Assessment",          dailyDedup: false, dedupByDoctor: true };
  if (nt === "discharge")    return { code: "DOC-DISCHARGE",    name: "Discharge Summary Visit",       dailyDedup: false, dedupByDoctor: true };
  if (nt === "icu")          return { code: "DOC-ICU-VISIT",    name: "ICU Doctor Visit",              dailyDedup: true,  dedupByDoctor: true };
  if (nt === "procedure" || nt === "operative" || nt === "preop" || nt === "postop") {
    // Procedure billing happens via its own ServiceMaster lookup elsewhere
    // — don't double-charge a generic visit on top of the procedure fee.
    return null;
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
  if (!admission) return null;
  // billingService.js exports an INSTANCE — use directly, no `new`.
  const billingService = require("./billingService");
  try {
    return await billingService.getOrCreateDraftBill(
      admission.UHID,
      patientType || "IPD",
      admissionId.toString()
    );
  } catch { return null; }
}

// ── Helper: add item to bill ──────────────────────────────────────────────────
// `source.unitPriceOverride` lets a caller inject a price computed elsewhere
// (e.g. bed rate from the room category) instead of using ServicePricing.
async function addItemToBill(bill, service, quantity, source, trigger) {
  if (!bill || !service) return null;
  try {
    let unitPrice;
    if (source.unitPriceOverride != null) {
      unitPrice = Number(source.unitPriceOverride) || 0;
    } else {
      const pricing = await ServicePricing.getPriceFor(service._id, bill.paymentType || "CASH", bill.tpa?.toString());
      unitPrice = pricing?.finalPrice ?? service.defaultPrice ?? 0;
    }
    const totalAmt   = unitPrice * (quantity || 1);

    const item = {
      serviceId:       service._id,
      serviceCode:     service.serviceCode,
      serviceName:     service.serviceName,
      category:        service.category,
      billingType:     service.billingType,
      quantity:        quantity || 1,
      unitPrice,
      grossAmount:     totalAmt,
      discountPercent: 0, discountAmount: 0,
      netAmount:       totalAmt,
      tpaPayableAmount:     bill.paymentType === "TPA" ? totalAmt : 0,
      patientPayableAmount: bill.paymentType === "TPA" ? 0 : totalAmt,
      chargeDate:      new Date(),
      appliedTariff:   bill.paymentType || "CASH",
      remarks:         source.remarks || `Auto-billed via ${source.sourceType}`,
      addedBySource:   source.addedBySource || "Auto",
      addedBy:         source.addedBy || "System",
      addedByRole:     source.addedByRole || "System",
    };

    const freshBill = await PatientBill.findById(bill._id);
    if (!freshBill) return null;
    // FIX (audit P6-B3): auto-billing was happily pushing new line items onto
    // bills that were already PAID / CANCELLED / REFUNDED, retroactively
    // making the patient's "settled" bill look unpaid. Closed bills are now
    // immutable — caller (createTrigger) decides what to do with the skipped
    // event (typically it'll spin up a new draft on the next admission day).
    if (["PAID", "CANCELLED", "REFUNDED"].includes(freshBill.billStatus)) {
      console.warn(`[AutoBilling] skipping addItemToBill — bill ${freshBill._id} is ${freshBill.billStatus}`);
      // Audit-clean the trigger: mark "skipped" with a reason instead of
      // leaving it in "pending" forever — otherwise the audit trail shows
      // an outstanding charge that will never actually bill.
      if (trigger?._id) {
        await BillingTrigger.findByIdAndUpdate(trigger._id, {
          status: "skipped",
          skipReason: `Bill ${freshBill.billStatus.toLowerCase()} — no new charges accepted`,
          skippedAt: new Date(),
        }).catch(() => {});
      }
      return null;
    }
    freshBill.billItems.push(item);
    await freshBill.save();
    const savedItem = freshBill.billItems[freshBill.billItems.length - 1];
    return { bill: freshBill, itemId: savedItem._id, unitPrice, totalAmt };
  } catch (e) {
    console.error("[AutoBilling] addItemToBill error:", e.message);
    return null;
  }
}

// ── Helper: create trigger and optionally bill immediately ────────────────────
async function createTrigger(config) {
  const {
    admissionId, patientId, UHID, patientType = "IPD",
    serviceCode, serviceName, serviceId, quantity = 1,
    sourceType, sourceDocumentId, sourceDocumentModel,
    orderedBy, orderedById, orderedByRole = "System",
    completedBy, completedById, completedByRole,
    orderDetails, completionNotes,
    autoCharge = false, dailyDedup = false, requiresConfirmation = false,
    dedupByDoctor = false, // NEW — when true, dedup key includes doctor identity
    unitPriceOverride,     // NEW — bed/nursing daily rates from room category
    shift, department, notes,
  } = config;

  const dateKey = getDateKey();

  // Daily dedup check. Doctor-round charges set dedupByDoctor=true so two
  // consulting doctors on the same day each get their own line (NABH
  // multi-disciplinary care). Without that flag the existing behaviour
  // (one-per-admission-per-day, regardless of who) is preserved for
  // bed/nursing/RBS/etc.
  if (dailyDedup && admissionId && serviceCode) {
    const dedupQuery = {
      admissionId, serviceCode, dateKey,
      status: { $in: ["completed", "billed", "pending"] },
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
  const unitPrice   = unitPriceOverride != null
    ? (Number(unitPriceOverride) || 0)
    : (resolvedService?.defaultPrice ?? 0);
  const totalAmount = unitPrice * (quantity || 1);

  // If a code was requested but ServiceMaster doesn't have it yet (common
  // for newly-introduced codes like DOC-MORN-ROUND or BED-ICU), accept
  // the trigger anyway — the bill item is fully described by serviceCode +
  // serviceName + unitPriceOverride. A nightly job can backfill missing
  // ServiceMaster rows from accumulated triggers.
  const canAutoCharge = autoCharge && (resolvedService || (serviceCode && unitPriceOverride != null && serviceName));
  const triggerStatus = canAutoCharge ? "completed" : requiresConfirmation ? "pending" : "pending";

  const triggerData = {
    admissionId, patientId, UHID, patientType,
    serviceId:    resolvedService?._id,
    serviceCode:  resolvedService?.serviceCode || serviceCode,
    serviceName:  resolvedService?.serviceName || serviceName,
    quantity, unitPrice, totalAmount,
    sourceType, sourceDocumentId, sourceDocumentModel,
    orderedBy, orderedById, orderedByRole,
    orderedAt: new Date(),
    orderDetails,
    completedBy,   completedById,   completedByRole,
    completedAt:   completedBy ? new Date() : undefined,
    completionNotes,
    status: triggerStatus,
    autoCharged: autoCharge,
    requiresConfirmation,
    isDailyCharge: dailyDedup,
    dateKey, shift, department, notes,
  };

  const trigger = await BillingTrigger.create(triggerData);

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
    console.error("[AutoBilling] onNurseNoteSaved error:", e.message);
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
async function onDoctorNoteSaved(noteDoc) {
  if (!noteDoc) return;
  const noteType = noteDoc.noteType || "progress";
  const visit = resolveDoctorVisitCode(noteType, noteDoc.shift);
  if (!visit) return; // procedure notes etc. bill via their own path

  const admissionId = noteDoc.admissionId || await resolveAdmissionId(noteDoc);
  if (!admissionId) return;

  const doctorName = noteDoc.doctorName || noteDoc.consultantName || noteDoc.orderedBy || "Doctor";
  const doctorId   = noteDoc.doctor || noteDoc.doctorId || null;

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
      orderDetails:  `${visit.name} — ${doctorName}${noteType !== "progress" ? ` (${noteType})` : ""}`,
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
 * Fire when a drug is administered via MAR
 */
async function onMARAdministration(marDoc, medication, administrationEntry) {
  if (!marDoc || !medication) return;
  if (administrationEntry?.status !== "administered") return;

  const admissionId = marDoc.admissionId;
  if (!admissionId) return;

  // Try to find a billable service matching the drug name
  const drugName = medication.drugName || medication.medicineName || "";

  // Look for generic injection/administration fee if no specific drug service
  const service = await findServiceByName(drugName, "IPD") ||
                  await findServiceByCode("NRS-INJ") || // injection charge
                  null;

  if (!service) return; // No matching billing service for this drug

  try {
    await createTrigger({
      admissionId,
      patientId:   marDoc.patientId,
      UHID:        marDoc.UHID,
      patientType: "IPD",
      serviceId:   service._id,
      serviceCode: service.serviceCode,
      serviceName: service.serviceName,
      sourceType:  "MAR",
      sourceDocumentId:    marDoc._id,
      sourceDocumentModel: "MAR",
      orderedBy:     medication.prescribedBy || "Doctor",
      orderedByRole: "Doctor",
      orderedAt:     medication.startDate || marDoc.date,
      completedBy:   administrationEntry.nurseName || "Nurse",
      completedByRole: "Nurse",
      orderDetails:  `${drugName} — ${medication.dose || ""} ${medication.route || ""}`,
      completionNotes: administrationEntry.remarks || "",
      autoCharge:    true,
      shift:         marDoc.shift || "",
    });
  } catch (e) {
    console.error("[AutoBilling] onMARAdministration error:", e.message);
  }
}

/**
 * Fire when an investigation is ordered
 */
async function onInvestigationOrdered(orderDoc) {
  if (!orderDoc) return;
  const admissionId = orderDoc.admissionId;
  if (!admissionId) return;

  const tests = orderDoc.tests || orderDoc.investigations || [];
  const testNames = tests.map((t) => t.testName || t.name || "").filter(Boolean);

  // Batch-resolve all services in one query (was N+1 — one findServiceByName
  // per test). For a 30-test panel this collapses 30 round-trips into 1.
  const serviceByName = await findServicesByNamesBatch(testNames, "IPD");

  for (const test of tests) {
    const testName = test.testName || test.name || "";
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
 * Fire when an investigation is resulted/completed
 */
async function onInvestigationResulted(orderDoc) {
  if (!orderDoc) return;
  const admissionId = orderDoc.admissionId;
  if (!admissionId) return;

  // Find pending triggers for this investigation order and bill them
  const pendingTriggers = await BillingTrigger.find({
    sourceDocumentId: orderDoc._id,
    sourceType: "InvestigationOrder",
    status: "pending",
  });

  const bill = pendingTriggers.length > 0
    ? await getOrCreateBill(admissionId, "IPD")
    : null;

  // Batch-resolve services in one query (was N+1 — one findById per trigger).
  const serviceIds = pendingTriggers
    .map((t) => t.serviceId)
    .filter(Boolean);
  const services = serviceIds.length
    ? await ServiceMaster.find({ _id: { $in: serviceIds } }).lean()
    : [];
  const servicesById = new Map(services.map((s) => [String(s._id), s]));

  for (const trigger of pendingTriggers) {
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

  // Also handle newly resulted tests not previously ordered through the trigger system
  // by looking at the tests array directly
  for (const test of (orderDoc.tests || [])) {
    const testName = test.testName || test.name || "";
    if (!testName) continue;

    // Check if we already have a trigger for this test on this order
    const exists = await BillingTrigger.findOne({
      sourceDocumentId: orderDoc._id,
      serviceName: { $regex: new RegExp(testName, "i") },
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
  if (billItemId) {
    // Already manually billed elsewhere — leave a paper-trail trigger and
    // exit, so we don't double-add to the bill.
    try {
      await BillingTrigger.create({
        admissionId: chargeEntry.admissionId,
        patientId:   chargeEntry.patientId,
        UHID:        chargeEntry.UHID,
        patientType: "IPD",
        serviceCode: `EQUIP-${chargeEntry.itemId?.toString().slice(-6) || "GEN"}`,
        serviceName: chargeEntry.itemName,
        quantity:    chargeEntry.quantity || 1,
        unitPrice:   chargeEntry.unitPrice,
        totalAmount: chargeEntry.totalAmount,
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
      });
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
 */
async function onOPDRegistered(opdVisit, admission) {
  if (!admission?._id) return;
  return createTrigger({
    admissionId:         admission._id,
    opdVisitId:          opdVisit._id,
    patientId:           admission.patientId,
    UHID:                admission.UHID,
    patientType:         "OPD",
    serviceCode:         "OPD-CON",           // OPD Consultation service code
    serviceName:         "OPD Consultation",
    quantity:            1,
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
 * Creates a BillingTrigger for Vitals/Nursing fee.
 */
async function onOPDVitalsRecorded(opdVisit, admission, nurseName) {
  if (!admission?._id) return;
  return createTrigger({
    admissionId:         admission._id,
    opdVisitId:          opdVisit._id,
    patientId:           admission.patientId,
    UHID:                admission.UHID,
    patientType:         "OPD",
    serviceCode:         "NRS-009",           // Nursing/Vitals service code
    serviceName:         "Vitals Recording (OPD)",
    quantity:            1,
    sourceType:          "NurseNote",
    sourceDocumentId:    opdVisit._id,
    sourceDocumentModel: "OPD",
    orderedBy:           nurseName || "Nurse",
    orderedByRole:       "Nurse",
    completedBy:         nurseName || "Nurse",
    completedByRole:     "Nurse",
    orderDetails:        `Vitals recorded for OPD visit ${opdVisit.visitNumber}`,
    autoCharge:          true,
    dailyDedup:          true,
    department:          opdVisit.department || admission.department,
    notes:               `Nurse: ${nurseName || "Nurse"} | Visit: ${opdVisit.visitNumber}`,
  });
}

/**
 * Called when a Doctor saves an OPD assessment (SOAP note).
 * Creates a BillingTrigger for Doctor Assessment / Follow-up fee.
 */
async function onOPDAssessmentSaved(opdVisit, admission, doctorName, assessmentId) {
  if (!admission?._id) return;
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

/**
 * Called when an IPD / Day Care / Emergency admission is created
 * (from ReceptionConsole or AdmissionController).
 *
 * Fires the initial admission/registration charges:
 *   - Registration fee
 *   - Admission charge (per type)
 *   - First bed-day charge (deferred to daily cron in practice)
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

  // 3. First bed-day + nursing-daily charge (if IPD/Daycare) — daily cron
  //    handles subsequent days. Rates come from the bed's room category
  //    so ICU/HDU/Private/Ward patients pay their tier's price without
  //    any per-category ServiceMaster pre-seed.
  if (typeCode === "IPD" || typeCode === "DAYCARE") {
    const rates = await resolveBedAndNursingRates(admissionDoc);
    const catTag = rates.categoryCode ? `-${rates.categoryCode}` : "";

    if (rates.bedRate > 0) {
      triggers.push(
        await createTrigger({
          admissionId:         admissionDoc._id,
          patientId:           admissionDoc.patientId,
          UHID:                admissionDoc.UHID,
          patientType:         typeCode,
          serviceCode:         `BED${catTag}`,
          serviceName:         `Bed Charge — ${rates.categoryName || rates.roomType || typeCode} (Day 1)`,
          quantity:            1,
          unitPriceOverride:   rates.bedRate,
          sourceType:          "BedCharge",
          sourceDocumentId:    admissionDoc._id,
          sourceDocumentModel: "Admission",
          orderedBy:           "System",
          orderedByRole:       "System",
          orderDetails:        `Day 1 bed charge — ${rates.categoryName || rates.roomType || "category"} @ ₹${rates.bedRate}/day`,
          autoCharge:          true,
          dailyDedup:          true,
          department:          admissionDoc.department,
        }).catch((e) => { console.error("Bed-day trigger error:", e.message); return null; })
      );
    }

    if (rates.nursingRate > 0) {
      triggers.push(
        await createTrigger({
          admissionId:         admissionDoc._id,
          patientId:           admissionDoc.patientId,
          UHID:                admissionDoc.UHID,
          patientType:         typeCode,
          serviceCode:         `NURSING${catTag}`,
          serviceName:         `Nursing Care — ${rates.categoryName || rates.roomType || typeCode} (Day 1)`,
          quantity:            1,
          unitPriceOverride:   rates.nursingRate,
          sourceType:          "BedCharge",
          sourceDocumentId:    admissionDoc._id,
          sourceDocumentModel: "Admission",
          orderedBy:           "System",
          orderedByRole:       "System",
          orderDetails:        `Day 1 nursing care — ${rates.categoryName || rates.roomType || "category"} @ ₹${rates.nursingRate}/day`,
          autoCharge:          true,
          dailyDedup:          true,
          department:          admissionDoc.department,
        }).catch((e) => { console.error("Nursing-day trigger error:", e.message); return null; })
      );
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
  const active = await Admission.find({
    status: "Active",
    admissionType: { $in: ["Planned", "Emergency", "Day Care", "Daycare", "Transfer"] },
  }).lean();

  const typeMap = {
    Planned:   "IPD",
    Emergency: "EMERGENCY",
    "Day Care":"DAYCARE",
    Daycare:   "DAYCARE",
    Transfer:  "IPD",
  };

  let bedFired = 0, nurseFired = 0, skipped = 0, errors = 0;
  for (const adm of active) {
    const typeCode = typeMap[adm.admissionType] || "IPD";
    if (typeCode !== "IPD" && typeCode !== "DAYCARE") continue;

    try {
      const result = await flushDailyChargesForAdmission(adm, { typeCode });
      bedFired   += result.bedFired;
      nurseFired += result.nurseFired;
      skipped    += result.skipped;
    } catch (e) {
      errors++;
      console.error(`[daily-accrual] admission ${adm._id}:`, e.message);
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
async function flushDailyChargesForAdmission(admission, { typeCode } = {}) {
  let bedFired = 0, nurseFired = 0, skipped = 0;
  if (!admission?._id) return { bedFired, nurseFired, skipped };

  const typeMap = {
    Planned: "IPD", Emergency: "EMERGENCY", "Day Care": "DAYCARE",
    Daycare: "DAYCARE", Transfer: "IPD",
  };
  const tc = typeCode || typeMap[admission.admissionType] || "IPD";
  if (tc !== "IPD" && tc !== "DAYCARE") return { bedFired, nurseFired, skipped };

  const startMs = new Date(admission.admissionDate || admission.createdAt).getTime();
  const dayN = Math.max(1, Math.floor((Date.now() - startMs) / 86400000) + 1);

  const rates = await resolveBedAndNursingRates(admission);
  const catTag = rates.categoryCode ? `-${rates.categoryCode}` : "";

  if (rates.bedRate > 0) {
    const r = await createTrigger({
      admissionId:         admission._id,
      patientId:           admission.patientId,
      UHID:                admission.UHID,
      patientType:         tc,
      serviceCode:         `BED${catTag}`,
      serviceName:         `Bed Charge — ${rates.categoryName || rates.roomType || tc} (Day ${dayN})`,
      quantity:            1,
      unitPriceOverride:   rates.bedRate,
      sourceType:          "BedCharge",
      sourceDocumentId:    admission._id,
      sourceDocumentModel: "Admission",
      orderedBy:           "System",
      orderedByRole:       "System",
      orderDetails:        `Daily bed accrual — Day ${dayN} — ${rates.categoryName || rates.roomType || "category"} @ ₹${rates.bedRate}/day`,
      autoCharge:          true,
      dailyDedup:          true,
      department:          admission.department,
    });
    if (r?.skipped) skipped++;
    else if (r?.trigger) bedFired++;
  }

  if (rates.nursingRate > 0) {
    const r = await createTrigger({
      admissionId:         admission._id,
      patientId:           admission.patientId,
      UHID:                admission.UHID,
      patientType:         tc,
      serviceCode:         `NURSING${catTag}`,
      serviceName:         `Nursing Care — ${rates.categoryName || rates.roomType || tc} (Day ${dayN})`,
      quantity:            1,
      unitPriceOverride:   rates.nursingRate,
      sourceType:          "BedCharge",
      sourceDocumentId:    admission._id,
      sourceDocumentModel: "Admission",
      orderedBy:           "System",
      orderedByRole:       "System",
      orderDetails:        `Daily nursing care — Day ${dayN} — ${rates.categoryName || rates.roomType || "category"} @ ₹${rates.nursingRate}/day`,
      autoCharge:          true,
      dailyDedup:          true,
      department:          admission.department,
    });
    if (r?.skipped) skipped++;
    else if (r?.trigger) nurseFired++;
  }

  return { bedFired, nurseFired, skipped };
}

module.exports = {
  onNurseNoteSaved,
  onDoctorNoteSaved,
  onMARAdministration,
  onInvestigationOrdered,
  onInvestigationResulted,
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
};
