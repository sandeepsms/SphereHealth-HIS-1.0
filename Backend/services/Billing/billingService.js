// services/billingService.js
const PatientBill = require("../../models/PatientBillModel/PatientBillModel");
const Admission = require("../../models/Patient/admissionModel");
const ServiceMaster = require("../../models/ServiceMaster/serviceMasterModel");
const ServicePricing = require("../../models/ServicePricing/ServicePricingModel");
const AutoBilledItems = require("../../models/PatientBillModel/AutoBilledItemsModel");
const { toNum } = require("../../utils/money");

// R7d: Indian GST slabs allowed on BillItem.taxPercent enum. ServiceMaster
// + InvestigationMaster historically allow 0-28 without an enum, so seeded
// off-slab values (e.g. 9, 13, 20) would crash bill.save() with the new
// enum guard. Sanitize on write — clamp to nearest valid slab, fall back
// to 0 when value is null/undefined/negative or not a finite number.
const GST_SLABS = [0, 0.25, 3, 5, 12, 18, 28];
function sanitizeTaxPct(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (GST_SLABS.includes(n)) return n;
  // Snap to nearest valid slab (defensive — never throws).
  return GST_SLABS.reduce((best, slab) =>
    Math.abs(slab - n) < Math.abs(best - n) ? slab : best, 0);
}

// R7ap-F9/D7-03/D6-02: atomic bill-number generator.
// Previous implementation used `countDocuments({$regex})` + `count+1` which
// was race-prone: two concurrent generates both read the same count and
// produced duplicate billNumbers, second insert hitting E11000 with a
// cryptic "duplicate key" surfaced to the cashier. Income-Tax Rule 46
// requires sequential gap-less invoice numbering — the atomic counter
// (same `nextSequence` used by PatientAdvance receipt + admission ID
// since R7ab/R7ag) is the only race-safe way.
//
// Format unified to `BILL-YYYY-NNNNNN` (matching the PatientBill pre-save
// hook so both code paths produce the same shape). Legacy bills with
// `BILL-YYYYMMDD-NNNNN` (5-digit serial) remain queryable — only NEW
// bills use the unified format.
const { nextSequence, fyStartYear } = require("../../utils/counter");

async function generateBillNumber() {
  // R7hb — Short bill number: BILL-YY-NN (continuous within year,
  // auto-widens past 99). Pre-R7hb this was BILL-YYYY-NNNNNN — too
  // long for counter receipts and verbal hand-off.
  // R7hr(NABH-P2.4) — YY is the FINANCIAL-year start year (Apr–Mar), not
  // the calendar year: the series no longer resets on Jan 1 mid-FY, and a
  // Feb-2027 invoice stays in the BILL-26- series (FY 2026-27) per IT
  // Rule 46 / GST per-FY gap-less practice. No change Apr–Dec (FY start
  // == calendar year).
  const yy = String(fyStartYear()).slice(-2);
  const key = `bill:${yy}`;
  // Seed from existing max on first call this year so legacy series
  // continues without a gap. Looks for the short prefix BILL-YY-; the
  // migration script (migrateNumberShortFormat.js) is responsible for
  // renaming old BILL-YYYY-NNNNNN rows to the new format. If no
  // already-short rows exist, seed is 0 and the counter starts fresh.
  const prefix = `BILL-${yy}-`;
  const last = await PatientBill.findOne({
    billNumber: { $regex: `^${prefix}` },
  })
    .sort({ billNumber: -1 })
    .select({ billNumber: 1 })
    .lean();
  const seed = last ? parseInt(last.billNumber.slice(prefix.length), 10) || 0 : 0;
  const seq  = await nextSequence(key, seed);
  return `${prefix}${String(seq).padStart(2, "0")}`;
}

// R7hr(NABH-P3.4) — gap-less per-payment receipt serial: REC-YY-N, keyed
// on the FINANCIAL year like the bill series. Minted for cashier-collected
// money only (recordPayment, bulk-collect legs, discharge waterfall);
// ADVANCE_ADJUSTMENT transfers carry none — that money was receipted at
// deposit time (ADV-…). Same seed-from-max self-heal as generateBillNumber.
async function generatePaymentReceiptNumber() {
  const yy = String(fyStartYear()).slice(-2);
  const key = `receipt:${yy}`;
  const prefix = `REC-${yy}-`;
  const last = await PatientBill.findOne({
    "payments.receiptNumber": { $regex: `^${prefix}` },
  })
    .sort({ "payments.receiptNumber": -1 })
    .select({ "payments.receiptNumber": 1 })
    .lean();
  let seed = 0;
  if (last) {
    seed = (last.payments || [])
      .map((p) => (p.receiptNumber || "").startsWith(prefix) ? parseInt(p.receiptNumber.slice(prefix.length), 10) : 0)
      .reduce((m, n) => (Number.isFinite(n) && n > m ? n : m), 0);
  }
  const seq = await nextSequence(key, seed);
  return `${prefix}${String(seq).padStart(2, "0")}`;
}

// R7bp-FIX (audit P0 — billNumber dup-null E11000) — defense-in-depth.
// Pattern B (status-gated billNumber): the canonical commitment in this
// codebase is that DRAFT bills carry `billNumber: null` and a fresh
// sequence number is stamped only at finalisation (`generateFinalBill`)
// — see R7at-FIX-11 in PatientBillModel.js. The pre-save hook on the
// model already enforces this on `isNew` documents, but several writers
// (discharge clearance in admissionController, ledger flips in
// patientAdvanceService, etc.) mutate `billStatus` on an EXISTING DRAFT
// bill and `bill.save()` without going through generateFinalBill — the
// pre-save guard's `isNew` predicate skips them, so the bill lands in
// PAID/PARTIAL/CANCELLED state with `billNumber: null`. Once Agent 1
// drops the legacy plain `billNumber_1` index in favour of the partial-
// unique replacement (filter `{ billNumber: { $type: "string" } }`),
// nulls coexist freely — but NABH + IT-Rule-46 still demand that every
// non-DRAFT bill have a real numbered identifier on the audit trail.
//
// `_ensureBillNumberForNonDraft` is the service-layer safety net: every
// path that flips a bill to a non-DRAFT state runs this just before
// save() so the invariant `billStatus !== "DRAFT" ⇒ billNumber set`
// holds regardless of which writer flips the status. Idempotent — if
// a billNumber is already assigned, returns immediately and burns no
// sequence position (so a VersionError retry never doubles).
async function _ensureBillNumberForNonDraft(bill) {
  if (!bill) return;
  if (bill.billStatus === "DRAFT") return;        // DRAFT may be null — by design
  if (bill.billNumber) return;                    // already stamped, idempotent
  // Use the same atomic Counter-backed generator as generateFinalBill so
  // the sequence stays gap-less across both code paths.
  bill.billNumber = await generateBillNumber();
}

// R7hr(NABH-P1.3) — tiered discount authorization (NABH ROM: documented
// authorization levels on financial concessions). One adjustment by a
// non-Admin may reduce a bill by at most BILLING_DISCOUNT_CAP_PCT (env,
// default 10%) of its pre-adjustment net; anything larger requires an
// Admin to perform it (403 DISCOUNT_ABOVE_CAP tells the UI exactly that).
// Admin reductions stay unlimited — but every path that calls this is
// already reason-mandatory + adjustmentLog'd + BillingAudit'd, so the
// unlimited tier is fully attributable. The cap covers BOTH the explicit
// extraDiscount and the sneaky equivalents (unit-price drops / line
// write-offs) because callers pass the net-to-net reduction, not just the
// discount field.
function enforceDiscountCap({ actorRole, beforeNet, reduction, context = "adjustment" }) {
  if (String(actorRole || "") === "Admin") return;
  const capPct = Number(process.env.BILLING_DISCOUNT_CAP_PCT) || 10;
  const capAmt = (Math.max(0, Number(beforeNet) || 0) * capPct) / 100;
  if (reduction > capAmt + 0.005) {
    const err = new Error(
      `Discount ₹${reduction.toFixed(2)} exceeds the ${capPct}% authorization cap ` +
      `(₹${capAmt.toFixed(2)} of ₹${(Number(beforeNet) || 0).toFixed(2)} net) for role ` +
      `${actorRole || "unknown"} — an Admin must apply this ${context}.`,
    );
    err.status = 403;
    err.code = "DISCOUNT_ABOVE_CAP";
    throw err;
  }
}

class BillingService {
  // ── 1. Patient + all bills by UHID ───────────────────────────
  async getPatientWithBills(UHID) {
    const Patient = require("../../models/Patient/patientModel");

    const [bills, patient] = await Promise.all([
      this.getBillsByUHID(UHID),
      Patient.findOne({ UHID })
        .populate("tpa", "tpaName tpaCode")
        .populate("department", "departmentName")
        .populate("doctor", "personalInfo"),
    ]);

    if (!patient) throw new Error(`Patient not found: ${UHID}`);
    return { patient, bills };
  }

  // ── 2. Get existing DRAFT bill or create new one ──────────────
  //
  // R7bp-FIX (audit P0 — billNumber dup-null E11000) — race-safe upsert.
  //
  // Pre-R7bp this method used the classic find-then-create pattern:
  //   1. PatientBill.findOne({UHID, visitType, billStatus:"DRAFT", admission})
  //   2. if missing → new PatientBill(...).save()
  // Two concurrent callers (the cashier's "Add Service" double-click;
  // /api/billing/create racing with an auto-billing trigger) could both
  // pass step 1 and both attempt step 2. The model carries a partial-
  // unique index on `(UHID, visitType, admission)` filtered to
  // `billStatus:"DRAFT"`, so the second insert always failed with E11000
  // — the caller's catch refetched and returned the winner's row.
  // That worked, but the FAILED insert was still attempted on disk,
  // and on installations where the legacy plain `billNumber_1` index
  // hadn't yet been replaced with the partial-unique variant, the
  // collision surfaced on `billNumber: null` instead and the catch's
  // refetch-by-filter found no match → re-thrown as a confusing
  // duplicate-key error from the OPD Services & Orders panel.
  //
  // Now: collapse the find-or-insert into a single atomic
  // `findOneAndUpdate({...DRAFT filter}, {$setOnInsert: {...}},
  // {upsert:true, new:true})`. Mongo guarantees one writer wins; the
  // loser's upsert reads the winner's document. No second-attempt
  // insert, no E11000 surface on the happy path.
  //
  // We still catch E11000 defensively — it can fire on the partial-
  // unique index during the millisecond between upsert dispatch and
  // commit if a parallel writer with a slightly different filter
  // (e.g. legacy bills missing the admission field) lands first. In
  // that case the catch refetches by the canonical filter and returns
  // the winner.
  async getOrCreateDraftBill(UHID, visitType, admissionId = null) {
    const Patient = require("../../models/Patient/patientModel");

    const patient = await Patient.findOne({ UHID }).populate("tpa");
    if (!patient) throw new Error(`Patient not found: ${UHID}`);

    // Canonical filter — must match the partialFilterExpression on the
    // `{UHID, visitType, admission} | billStatus:"DRAFT"` unique index.
    const filter = { UHID, visitType, billStatus: "DRAFT" };
    if (admissionId) filter.admission = admissionId;
    else            filter.admission = null;       // explicit so the OPD
                                                   // companion index matches

    // R7hr(billing-audit R1b) — SERVICE walk-in fresh-slate. A walk-in service
    // bill carries no admission and no visit entity, so its {UHID, "SERVICE",
    // admission:null} DRAFT is shared forever: a NEW walk-in would silently
    // merge its cart into a PRIOR walk-in's unfinalised DRAFT (two visits → one
    // bill, wrong per-visit accounting, and the patient sees stale charges).
    // Billing rule 1 says each fresh walk-in is its own bill. So if a PRIOR-DAY
    // SERVICE draft that still holds charges is open, finalise it through the
    // sanctioned generateFinalBill path — turning those abandoned charges into
    // a tracked pending bill that resurfaces at the next visit (see
    // getPreviousPendingDues) — which frees the DRAFT slot so the upsert below
    // mints a FRESH draft for today. Scoped strictly to SERVICE + no admission
    // (OPD/IPD/DAYCARE/EMERGENCY isolate by admission/visitId and are
    // untouched). Same-day drafts are left alone (the cart is still being built
    // this session). Empty stale drafts are harmless: generateFinalBill rejects
    // them (rolls back to DRAFT) and we simply reuse them. Fail-safe: any
    // hiccup falls through to the normal upsert (prior merge behaviour — never
    // blocks the new walk-in).
    if (visitType === "SERVICE" && !admissionId) {
      try {
        const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
        const staleDraft = await PatientBill.findOne({
          ...filter, createdAt: { $lt: startOfToday },
        }).select("_id billItems");
        if (staleDraft && (staleDraft.billItems?.length || 0) > 0) {
          await this.generateFinalBill(staleDraft._id, "System (auto-close stale walk-in draft)");
        }
      } catch (_) {
        // Empty-draft rejection / finalize hiccup → leave as-is, fall through.
      }
    }

    // setOnInsert payload — only applied if the upsert creates a new doc.
    // billNumber is INTENTIONALLY omitted: DRAFT bills carry null per
    // Pattern B (see _ensureBillNumberForNonDraft note above).
    const adm = admissionId ? await Admission.findById(admissionId) : null;
    // R7bw — visitId linkage. For OPD admissions, OPDService writes the
    // OPDRegistration.visitNumber onto the Admission doc (admission.visitNumber).
    // We copy it here so the patient-history aggregator can do an exact-
    // match join `{ UHID, visitType:"OPD", visitId }` instead of the
    // same-day proximity fallback that mis-pools items across visits.
    // For IPD/DAYCARE/EMERGENCY admissions the admission.visitNumber is
    // usually empty (OPD-specific), so visitId stays null — those bills
    // are joined by the canonical `admission` ObjectId ref.
    const setOnInsert = {
      patient: patient._id,
      paymentType: patient.tpa ? "TPA" : "CASH",
      tpa: patient.tpa?._id || null,
      tpaName: patient.tpa?.tpaName || null,
      billItems: [],
      ...(adm ? { admissionNumber: adm.admissionNumber } : {}),
      ...(adm?.visitNumber ? { visitId: adm.visitNumber } : {}),
    };

    let bill;
    let wasInserted = false;
    try {
      const before = await PatientBill.findOne(filter).select("_id").lean();
      bill = await PatientBill.findOneAndUpdate(
        filter,
        { $setOnInsert: setOnInsert },
        {
          new: true,
          upsert: true,
          setDefaultsOnInsert: true,
          // runValidators ensures required fields (e.g. patient) are
          // present on insert; idempotent on update.
          runValidators: true,
        },
      );
      wasInserted = !before;
    } catch (err) {
      // E11000 can still fire on a millisecond-tight race against the
      // partial-unique index. Refetch with the canonical filter — the
      // winner's row will be there.
      if (err && err.code === 11000) {
        const existing = await PatientBill.findOne(filter);
        if (existing) return existing;
      }
      throw err;
    }

    // R7bw — backfill visitId on a pre-existing DRAFT bill that pre-dates
    // the visitId column. The $setOnInsert above only fires on INSERT, so
    // a DRAFT bill that already exists for an OPD admission still carries
    // visitId:null until something stamps it. We do that here whenever the
    // admission carries a visitNumber and the bill is missing it. Single
    // direct collection update keeps the in-flight document in sync for
    // the caller (the bill object returned above). The visitId is
    // append-once (only set when null) so we never overwrite a value
    // another writer already stamped.
    if (bill && adm?.visitNumber && !bill.visitId) {
      try {
        await PatientBill.collection.updateOne(
          { _id: bill._id, $or: [{ visitId: null }, { visitId: { $exists: false } }] },
          { $set: { visitId: adm.visitNumber } },
        );
        bill.visitId = adm.visitNumber;
      } catch (e) {
        // Non-fatal: bill still returned, aggregator will fall back to
        // same-day match for this row.
        console.warn("[Billing] visitId stamp failed:", e.message);
      }
    }

    // Whether the bill is newly-inserted or existing, an IPD/DAYCARE
    // open admission triggers a top-up backfill for bed / nursing /
    // doctor-round / consumable charges that may have piled up before
    // the bill existed (or while it was open). Idempotent — the
    // dailyDedup guards in createTrigger make repeat calls no-ops.
    if (admissionId) {
      try {
        const admLite = await Admission.findById(admissionId).lean();
        if (admLite && (admLite.status === "Active" || admLite.status === "Transferred")) {
          const autoBilling = require("./autoBillingService");
          const r = await autoBilling.backfillAdmissionCharges(admLite);
          console.log(
            `[Billing] ${wasInserted ? "backfill" : "top-up backfill"} for ADM ${admLite.admissionNumber}:`,
            `bed=${r.bedFired} nursing=${r.nurseFired}`,
            `doctor=${r.doctorFired} consumables=${r.consumableFired}`,
            `skipped=${r.skipped} errors=${r.errors}`,
          );
          // Re-fetch so the freshly-backfilled items are reflected.
          const refreshed = await PatientBill.findById(bill._id);
          if (refreshed) bill = refreshed;
        }
      } catch (e) {
        console.error("[Billing] backfill failed (bill still returned):", e.message);
      }
    }

    return bill;
  }

  // ── 3. Get single bill (fully populated) ─────────────────────
  async getBillById(billId) {
    const bill = await PatientBill.findById(billId)
      .populate("patient")
      .populate("tpa")
      .populate("admission")
      .populate("billItems.serviceId");

    if (!bill) throw new Error("Bill not found");
    return bill;
  }

  // ── 4. Get draft bill (populated) ────────────────────────────
  async getDraftBillPopulated(UHID, visitType, admissionId) {
    const bill = await this.getOrCreateDraftBill(UHID, visitType, admissionId);
    return PatientBill.findById(bill._id)
      .populate("patient", "fullName title UHID contactNumber gender tpa")
      .populate("tpa", "tpaName tpaCode")
      .populate("admission");
  }

  // ── 5. All bills for a UHID ───────────────────────────────────
  // R7bh-F10 / R7bg-9-CRIT-4: perf hardening.
  //   Pre-R7bh this method:
  //     • no `.lean()` — every doc returned was a full Mongoose
  //       hydrated instance with the BillItem sub-schema graph still
  //       attached (same retained-graph problem R7aw documented for
  //       getRevenueBreakdown). For an IPD patient who's been admitted
  //       8 days with 60+ bill items per draft, a UHID with 12 bills
  //       could push 40MB+ of retained schema meta into the response
  //       cycle.
  //     • no `.limit()` — a long-stay patient's lookup or a re-admit
  //       could return 100+ historical bills, every one with full
  //       billItems[] arrays.
  //     • 3 chained `.populate()` — patient + tpa + admission round-
  //       trips on every page hit (plus the per-doc hydration above).
  //   Fix:
  //     • `.lean({ virtuals: true })` — bypasses the BillItem sub-doc
  //       hydration. Decimal128 unwrap is handled at the wire by the
  //       toJSON transform (decimalToNumber) on lean output.
  //     • `.limit(200)` — bounds the worst-case payload. A patient
  //       legitimately needing > 200 bills is a data-quality issue
  //       (re-admit chain) the operator should investigate via the
  //       /billing?UHID=X paginated list, not this all-in-one read.
  //     • Drop populate("admission") — the callers that actually
  //       need bed/room data (DischargeQueue) fetch it from the
  //       admission endpoint directly. patient + tpa stay because
  //       every consumer renders them inline. If `getPatientWithBills`
  //       (which calls this) needs richer admission data, the caller
  //       layers it via a separate query (already does for `patient`).
  async getBillsByUHID(UHID) {
    return PatientBill.find({ UHID })
      .populate("patient", "fullName title contactNumber gender dateOfBirth")
      .populate("tpa", "tpaName tpaCode")
      .sort({ createdAt: -1 })
      .limit(200)
      .lean({ virtuals: true });
  }

  // ── R7hr(billing-audit P1.3) — previous PENDING dues for a patient ──
  // Rule 1: at the next visit, surface prior billing ONLY when it's still
  // pending. Returns every UNPAID bill (DRAFT/GENERATED/PARTIAL with
  // balance > 0) that is NOT the current visit/admission, so registration +
  // the billing page can warn the biller — while paid history stays hidden
  // (fresh slate). excludeVisitId / excludeAdmissionId scope out the current
  // encounter's own in-progress bill.
  async getPreviousPendingDues(UHID, { excludeVisitId, excludeAdmissionId } = {}) {
    const { toNum } = require("../../utils/money");
    const bills = await PatientBill.find({
      UHID,
      billStatus: { $in: ["DRAFT", "GENERATED", "PARTIAL"] },
    }).sort({ createdAt: -1 }).limit(200).lean();
    const pending = bills.filter((b) => {
      if (toNum(b.balanceAmount) <= 0.5) return false;
      if (excludeVisitId && b.visitId && String(b.visitId) === String(excludeVisitId)) return false;
      if (excludeAdmissionId && b.admission && String(b.admission) === String(excludeAdmissionId)) return false;
      return true;
    });
    return {
      hasPending: pending.length > 0,
      count:      pending.length,
      totalDue:   pending.reduce((s, b) => s + toNum(b.balanceAmount), 0),
      bills: pending.map((b) => ({
        billId:        b._id,
        billNumber:    b.billNumber || null,
        visitType:     b.visitType,
        visitId:       b.visitId || null,
        billStatus:    b.billStatus,
        netAmount:     toNum(b.netAmount),
        balanceAmount: toNum(b.balanceAmount),
        createdAt:     b.createdAt,
      })),
    };
  }

  // ── 6. Add service to bill ────────────────────────────────────
  // R7aw-FIX-7/D7-LOW: full body now wrapped in retryVersionError so a
  // concurrent cron / cashier writer doesn't 500 the addService request.
  // Matches the recordPayment / voidPayment retry pattern.
  async addServiceToBill(
    billId,
    serviceId,
    quantity = 1,
    chargeDate = new Date(),
    remarks = "",
    opts = {},
  ) {
    // opts shape:
    //   addedBySource  — "Doctor" | "Nurse" | "Lab" | "Radiology" |
    //                    "Reception" | "Auto" | "AI-Confirmed"
    //   addedBy        — display name of the staff member
    //   addedByRole    — role label for the audit trail
    //   orderStatus    — optional explicit override. When omitted, the
    //                    status is INFERRED from addedBySource:
    //                      Doctor / Nurse / Lab / Radiology  → "Ordered"
    //                      (this is the order-to-completion flow — the
    //                      lab/imaging/proceduralist team will mark it
    //                      complete once the work is done, and only
    //                      THEN does it count toward the patient's bill)
    //                      Reception / Auto / AI-Confirmed   → "Completed"
    //                      (walk-in paid upfront, system auto-charge,
    //                      and AI-confirmed are already-billable events)
    //   orderedBy / orderedById / orderedByRole — actor metadata for the
    //                    NABH audit trail on AAC.5 / MOM.6 orders
    const {
      addedBySource = "Reception",
      addedBy = "",
      addedByRole = "",
      orderStatus, // explicit override; otherwise inferred below
      orderedBy,
      orderedById,
      orderedByRole,
    } = opts;

    // R7hr-233 (audit: negative-qty self-discount) — a negative/zero/NaN
    // quantity produced a negative line total (a silent, unaudited discount on
    // a DRAFT bill). Require a positive, finite quantity.
    quantity = Number(quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      const err = new Error("Quantity must be a positive number.");
      err.status = 400;
      throw err;
    }

    // ServiceMaster lookup is bill-independent, run once outside the retry.
    const service = await ServiceMaster.findById(serviceId);
    if (!service) throw new Error("Service not found");

    // R7aw-FIX-7/D7-LOW: VersionError retry around the load-mutate-save.
    // Pricing depends on bill.paymentType so it lives inside the retry —
    // a concurrent TPA-flip would otherwise stale-price the line.
    const retryVE = require("../../utils/retryVersionError");
    return retryVE(async () => {
      const bill = await PatientBill.findById(billId);
      if (!bill) throw new Error("Bill not found");
      // Bill-edit freeze (business audit F-05). Originally only PAID /
      // CANCELLED bills were locked — that left PARTIAL bills (some payment
      // already received) editable, so a receptionist could add new line
      // items and inflate what the patient still owed AFTER the cashier
      // had counted money. Locking from GENERATED onward stops the leak;
      // legitimate "patient consumed more services" goes through the
      // dedicated `recordPayment` / `amendItem` (Accountant) path instead.
      // R7aw-FIX-8/D7: include GENERATING — a parallel finalize is in
      // flight and the bill is frozen for the duration of the CAS claim.
      if (["GENERATING", "GENERATED", "PARTIAL", "PAID", "CANCELLED", "REFUNDED"].includes(bill.billStatus)) {
        const err = new Error(
          `Cannot modify a ${bill.billStatus} bill — use the amendment workflow.`,
        );
        err.status = 409;
        throw err;
      }

      const pricing = await ServicePricing.getPriceFor(
        serviceId,
        bill.paymentType,
        bill.tpa,
      );

      // R2: money fields are Decimal128 at rest. `pricing.finalPrice` and
      // `tpaApprovedLimit` may arrive as Decimal128 objects from ServicePricing;
      // multiplying a Decimal128 by a Number gives a garbled
      // `{$numberDecimal: "..."}` shape that breaks downstream display and
      // bill-total recalc. Unwrap with toNum() before any arithmetic.
      const unitPrice = toNum(pricing?.finalPrice ?? service.defaultPrice);
      const grossAmount = unitPrice * quantity;
      const discountPct = toNum(pricing?.discount) || 0;
      const discountAmt = (grossAmount * discountPct) / 100;
      const netAmount = grossAmount - discountAmt;
      const taxAmount = service.isTaxable
        ? (netAmount * toNum(service.taxPercentage)) / 100
        : 0;
      const lineTotal = netAmount + taxAmount;

      let tpaPayableAmount = 0;
      if (bill.paymentType === "TPA") {
        const tpaCap = toNum(pricing?.tpaApprovedLimit);
        tpaPayableAmount = tpaCap > 0
          ? Math.min(tpaCap * quantity, lineTotal)
          : lineTotal;
      }

      // Decide order lifecycle. Clinical sources (Doctor / Nurse / Lab /
      // Radiology) open the line as "Ordered" — it stays pending in the
      // executing team's queue and DOES NOT charge the patient until the
      // executing team marks it complete via the /complete endpoint.
      // Front-desk + automated sources skip the order workflow and write
      // the line directly as Completed so existing flows (walk-in cash,
      // bed-day cron, doctor-visit auto-charge) keep working unchanged.
      const CLINICAL_ORDER_SOURCES = ["Doctor", "Nurse", "Lab", "Radiology"];
      const resolvedOrderStatus =
        orderStatus ||
        (CLINICAL_ORDER_SOURCES.includes(addedBySource) ? "Ordered" : "Completed");
      const now = new Date();

      bill.billItems.push({
        serviceId: service._id,
        serviceCode: service.serviceCode,
        serviceName: service.serviceName,
        category: service.category,
        billingType: service.billingType,
        quantity,
        unitPrice,
        grossAmount,
        discountPercent: discountPct,
        discountAmount: discountAmt,
        netAmount,
        tpaPayableAmount,
        patientPayableAmount: lineTotal - tpaPayableAmount,
        isTaxable: service.isTaxable,
        // R7aw-FIX-2/D6-MED-5: HSN/SAC on every line for GSTR-1 compliance.
        hsnSacCode: service.hsnSacCode || "9993",
        // R7d-CRIT: BillItem.taxPercent now has enum [0, 0.25, 3, 5, 12, 18, 28].
        // ServiceMaster.taxPercentage is min:0/max:28 with no enum, so an
        // off-slab value (e.g. 9, 13, 20) from older seeds would crash
        // bill.save() with ValidationError. Sanitize to nearest valid slab
        // when isTaxable is true; otherwise 0. Future cleanup: tighten
        // ServiceMaster enum to match.
        taxPercent: sanitizeTaxPct(service.isTaxable ? service.taxPercentage : 0),
        taxAmount,
        appliedTariff: bill.paymentType,
        chargeDate,
        remarks,
        addedBySource,
        addedBy,
        addedByRole,
        // Order lifecycle stamps. We capture orderedAt/By for every line so
        // even Completed-on-create items (walk-in / auto-charge) carry a
        // creation timestamp for the audit trail. completedAt fires for
        // Completed-on-create OR later via the /complete endpoint.
        orderStatus: resolvedOrderStatus,
        orderedAt: now,
        orderedBy: orderedBy || addedBy || "",
        orderedByRole: orderedByRole || addedByRole || addedBySource || "",
        completedAt: resolvedOrderStatus === "Completed" ? now : undefined,
        completedBy: resolvedOrderStatus === "Completed" ? (addedBy || "") : undefined,
        completedByRole: resolvedOrderStatus === "Completed" ? (addedByRole || addedBySource || "") : undefined,
      });

      await bill.save();
      return bill;
    }, { label: "addServiceToBill" });
  }

  /* ─── Mark an Active Order as Completed ─────────────────────────────
     Used by the lab / radiologist / proceduralist who executes the work
     ordered by the doctor. Flips the BillItem's orderStatus → "Completed",
     stamps the completer, and saves the bill so the pre-save totals
     recalc — at which point the item lands on grossAmount / balance and
     becomes payable. */
  async completeBillItemOrder(billId, itemId, opts = {}) {
    // R7aw-FIX-7/D7-LOW: retry on VersionError — a concurrent payment /
    // settlementAdjust landing between fetch and save would 500 the
    // clinician's complete-order click.
    const retryVE = require("../../utils/retryVersionError");
    return retryVE(async () => {
      const bill = await PatientBill.findById(billId);
      if (!bill) {
        const e = new Error("Bill not found");
        e.status = 404;
        throw e;
      }
      // R7au-FIX-5/D5-CRIT-C7: PAID is now also rejected — pre-R7au a late
      // "Ordered → Completed" flip on a PAID bill bumped grossAmount but
      // pre-save did NOT auto-flip PAID→PARTIAL, leaving the bill in an
      // inconsistent state (status=PAID with balance > 0). Cashier never
      // saw the new due. Now refuse the operation explicitly with a
      // clear message so the clinician knows the bill is sealed.
      if (["CANCELLED", "REFUNDED", "PAID"].includes(bill.billStatus)) {
        const e = new Error(`Cannot complete orders on a ${bill.billStatus} bill — use accountant adjust/refund flow instead`);
        e.status = 409;
        throw e;
      }
      const item = bill.billItems.id(itemId);
      if (!item) {
        const e = new Error("Bill item not found");
        e.status = 404;
        throw e;
      }
      if (item.orderStatus === "Completed") {
        // Idempotent — already completed, just return the bill so the
        // frontend can refresh without surfacing a confusing error.
        return bill;
      }
      if (item.orderStatus === "Cancelled") {
        const e = new Error("Order was cancelled — cannot mark it complete");
        e.status = 409;
        throw e;
      }
      item.orderStatus = "Completed";
      item.completedAt = new Date();
      item.completedBy = opts.completedBy || "";
      item.completedByRole = opts.completedByRole || "";
      await bill.save();
      // R7hr(NABH-P2.1) — this flip CHANGES the bill's billable total (the
      // line now counts toward what the patient owes) on a possibly
      // GENERATED/PARTIAL bill, yet emitted no chronological audit row —
      // one of the re-audit's "billable-value change without BillingAudit"
      // blind spots. Best-effort emit, never blocks the clinician's click.
      try {
        const { emit } = require("../../models/Billing/BillingAudit");
        await emit({
          event:      "BILL_ITEM_ORDER_COMPLETED",
          UHID:       bill.UHID,
          patientId:  bill.patient,
          billId:     bill._id,
          billNumber: bill.billNumber,
          amount:     toNum(item.netAmount) + toNum(item.taxAmount),
          actorName:  opts.completedBy || "System",
          reason:     `Order completed — ${item.serviceName || item.serviceCode || "line"} now payable`,
        });
      } catch (_) { /* audit best-effort */ }
      return bill;
    }, { label: "completeBillItemOrder" });
  }

  /* ─── Cancel an Active Order ───────────────────────────────────────
     Used when the doctor or executing team decides an order shouldn't
     proceed (patient declined, contraindication discovered, sample
     spoilt, etc.). Sets orderStatus → "Cancelled" so the line is
     preserved for audit but excluded from billable + pending totals.
     Throws if the line is already Completed (use the standard
     /items/:itemId DELETE path or accountant cancel for those). */
  async cancelBillItemOrder(billId, itemId, opts = {}) {
    // R7aw-FIX-7/D7-LOW: retry on VersionError — mirror completeBillItemOrder.
    const retryVE = require("../../utils/retryVersionError");
    return retryVE(async () => {
      const bill = await PatientBill.findById(billId);
      if (!bill) {
        const e = new Error("Bill not found");
        e.status = 404;
        throw e;
      }
      // R7au-FIX-5/D5-CRIT-C7: pre-R7au this had NO bill-level state guard.
      // Cancelling an Active order on a PAID / CANCELLED / REFUNDED bill
      // silently mutated billItems → the audit log drifted from reality.
      // Now refuse the operation explicitly.
      if (["CANCELLED", "REFUNDED", "PAID"].includes(bill.billStatus)) {
        const e = new Error(`Cannot cancel orders on a ${bill.billStatus} bill — use accountant refund/cancel flow instead`);
        e.status = 409;
        throw e;
      }
      const item = bill.billItems.id(itemId);
      if (!item) {
        const e = new Error("Bill item not found");
        e.status = 404;
        throw e;
      }
      if (item.orderStatus === "Completed") {
        const e = new Error("Cannot cancel an order that's already been completed — use accountant refund instead");
        e.status = 409;
        throw e;
      }
      item.orderStatus = "Cancelled";
      item.cancelledAt = new Date();
      item.cancelReason = (opts.cancelReason || "").trim() || "Cancelled by clinician";
      await bill.save();
      // R7hr(NABH-P2.1) — mirror of the complete-order emit: cancelling an
      // Active order EXCLUDES the line's value from the billable total on a
      // possibly GENERATED/PARTIAL bill, which previously left no
      // chronological audit row. Best-effort, never blocks the cancel.
      try {
        const { emit } = require("../../models/Billing/BillingAudit");
        await emit({
          event:      "BILL_ITEM_ORDER_CANCELLED",
          UHID:       bill.UHID,
          patientId:  bill.patient,
          billId:     bill._id,
          billNumber: bill.billNumber,
          amount:     toNum(item.netAmount) + toNum(item.taxAmount),
          actorName:  opts.cancelledBy || "System",
          reason:     `Order cancelled — ${item.serviceName || item.serviceCode || "line"}: ${item.cancelReason}`,
        });
      } catch (_) { /* audit best-effort */ }
      return bill;
    }, { label: "cancelBillItemOrder" });
  }

  // ── 7. Remove item from bill ──────────────────────────────────
  async removeItemFromBill(billId, itemId) {
    // R7aw-FIX-7/D7-LOW: retry on VersionError so concurrent writers
    // don't 500 a DRAFT-bill line removal.
    const retryVE = require("../../utils/retryVersionError");
    return retryVE(async () => {
      const bill = await PatientBill.findById(billId);
      if (!bill) throw new Error("Bill not found");
      // Bill-edit freeze (business audit F-05). Originally only PAID /
      // CANCELLED bills were locked — that left PARTIAL bills (some payment
      // already received) editable, so a receptionist could add new line
      // items and inflate what the patient still owed AFTER the cashier
      // had counted money. Locking from GENERATED onward stops the leak;
      // legitimate "patient consumed more services" goes through the
      // dedicated `recordPayment` / `amendItem` (Accountant) path instead.
      // R7aw-FIX-8/D7: include GENERATING — parallel finalize in flight.
      if (["GENERATING", "GENERATED", "PARTIAL", "PAID", "CANCELLED", "REFUNDED"].includes(bill.billStatus)) {
        const err = new Error(
          `Cannot modify a ${bill.billStatus} bill — use the amendment workflow.`,
        );
        err.status = 409;
        throw err;
      }

      bill.billItems = bill.billItems.filter(
        (i) => i._id.toString() !== itemId.toString(),
      );
      await bill.save();
      return bill;
    }, { label: "removeItemFromBill" });
  }

  // ── 8. Update item quantity ───────────────────────────────────
  async updateItemQuantity(billId, itemId, quantity) {
    if (quantity <= 0) throw new Error("Quantity must be greater than 0");

    // R7aw-FIX-7/D7-LOW: retry on VersionError — a concurrent addService
    // / payment on the same DRAFT bill would otherwise 500 the qty edit.
    const retryVE = require("../../utils/retryVersionError");
    return retryVE(async () => {
      const bill = await PatientBill.findById(billId);
      if (!bill) throw new Error("Bill not found");
      // Bill-edit freeze (business audit F-05). Originally only PAID /
      // CANCELLED bills were locked — that left PARTIAL bills (some payment
      // already received) editable, so a receptionist could add new line
      // items and inflate what the patient still owed AFTER the cashier
      // had counted money. Locking from GENERATED onward stops the leak;
      // legitimate "patient consumed more services" goes through the
      // dedicated `recordPayment` / `amendItem` (Accountant) path instead.
      // R7aw-FIX-8/D7: include GENERATING — parallel finalize in flight.
      if (["GENERATING", "GENERATED", "PARTIAL", "PAID", "CANCELLED", "REFUNDED"].includes(bill.billStatus)) {
        const err = new Error(
          `Cannot modify a ${bill.billStatus} bill — use the amendment workflow.`,
        );
        err.status = 409;
        throw err;
      }

      const item = bill.billItems.id(itemId);
      if (!item) throw new Error("Bill item not found");

      // Money fields are Decimal128 — do the math in Number space, then assign.
      // Mongoose auto-casts Number → Decimal128 on assignment, and the bill
      // pre-save hook will recompute everything (so even if we missed a field
      // here, the persisted state stays consistent).
      const unit = toNum(item.unitPrice);
      const grossAmount = unit * quantity;
      const discountAmount = (grossAmount * (toNum(item.discountPercent) || 0)) / 100;
      const netAmount = grossAmount - discountAmount;
      const taxAmount = item.isTaxable
        ? (netAmount * (toNum(item.taxPercent) || 0)) / 100
        : 0;
      const lineTotal = netAmount + taxAmount;

      item.quantity = quantity;
      item.grossAmount = grossAmount;
      item.discountAmount = discountAmount;
      item.netAmount = netAmount;
      item.taxAmount = taxAmount;

      if (bill.paymentType === "TPA") {
        const tpaLimit = item.tpaApprovedLimitPerUnit
          ? toNum(item.tpaApprovedLimitPerUnit) * quantity
          : lineTotal;
        item.tpaPayableAmount = Math.min(tpaLimit, lineTotal);
        item.patientPayableAmount = lineTotal - item.tpaPayableAmount;
      } else {
        item.tpaPayableAmount = 0;
        item.patientPayableAmount = lineTotal;
      }

      await bill.save();
      return bill;
    }, { label: "updateItemQuantity" });
  }

  // ── 8a. Settlement-time adjustment (GENERATED / PARTIAL bills) ─
  //
  // The receptionist at the counter can negotiate a final settlement
  // with the patient — e.g. waive a portion of the bill, drop a
  // procedure that wasn't actually performed, or recalibrate a unit
  // price. F-05 normally freezes a bill the moment it's generated so
  // nobody can silently inflate the total AFTER cash was counted;
  // this endpoint is the audited escape hatch.
  //
  // Every adjustment requires (1) a human-readable reason and (2) the
  // staff name making the change, and a before/after snapshot is
  // pushed onto bill.adjustmentLog so we can reconstruct any past
  // state for NABH audit.
  //
  // Payload shape:
  //   { extraDiscount, extraDiscountReason, items, adjustedBy, reason }
  //   items: [{ itemId, quantity?, unitPrice?, discountPercent? }]
  //
  // The pre-save hook re-derives every total from the (possibly-edited)
  // items + extraDiscount, so the caller never has to do math here.
  // R7bb-C / S5 (D7-CRIT-2): accept adjustedById from the controller so
  // the audit row can carry the operator's _id (not just display name).
  async settlementAdjust(billId, payload = {}) {
    const { extraDiscount, extraDiscountReason, items, adjustedBy, adjustedById, adjustedByRole, reason } = payload;

    if (!adjustedBy || !String(adjustedBy).trim()) {
      const err = new Error("adjustedBy (staff name) is required for audit");
      err.status = 400;
      throw err;
    }
    if (!reason || !String(reason).trim()) {
      const err = new Error("Reason is required for audit");
      err.status = 400;
      throw err;
    }

    // R7ar-P1-17/D5-aq-09: wrap the rest in retryVersionError so a
    // concurrent payment / refund landing between fetch and save retries
    // with a fresh read instead of 500ing the cashier's adjustment.
    const retryVE = require("../../utils/retryVersionError");
    return retryVE(async () => {
    const bill = await PatientBill.findById(billId);
    if (!bill) {
      const err = new Error("Bill not found");
      err.status = 404;
      throw err;
    }
    // Only post-generation bills (where a patient might already have
    // paid a partial amount) need this audited path. DRAFT bills use
    // the regular updateItemQuantity / removeItemFromBill endpoints
    // and PAID/CANCELLED/REFUNDED bills are permanently sealed.
    if (!["GENERATED", "PARTIAL"].includes(bill.billStatus)) {
      const err = new Error(
        `Cannot adjust a ${bill.billStatus} bill — only GENERATED / PARTIAL bills can be settled.`,
      );
      err.status = 409;
      throw err;
    }

    // Snapshot BEFORE state for audit.
    const beforeSnap = {
      netAmount:     toNum(bill.netAmount),
      totalDiscount: toNum(bill.totalDiscount),
      extraDiscount: toNum(bill.extraDiscount) || 0,
      balanceAmount: toNum(bill.balanceAmount),
      items: bill.billItems.map((it) => ({
        _id:             it._id.toString(),
        serviceName:     it.serviceName,
        quantity:        toNum(it.quantity),
        unitPrice:       toNum(it.unitPrice),
        discountPercent: it.discountPercent || 0,
        netAmount:       toNum(it.netAmount),
      })),
    };

    let touchedLines = false;
    let touchedDiscount = false;

    // Apply per-item edits.
    if (Array.isArray(items) && items.length > 0) {
      for (const upd of items) {
        if (!upd?.itemId) continue;
        const it = bill.billItems.id(upd.itemId);
        if (!it) continue;
        if (upd.quantity != null && Number(upd.quantity) > 0) {
          it.quantity = Number(upd.quantity);
          touchedLines = true;
        }
        if (upd.unitPrice != null && Number(upd.unitPrice) >= 0) {
          it.unitPrice = Number(upd.unitPrice);  // pre-save will toDec it
          touchedLines = true;
        }
        if (
          upd.discountPercent != null &&
          Number(upd.discountPercent) >= 0 &&
          Number(upd.discountPercent) <= 100
        ) {
          it.discountPercent = Number(upd.discountPercent);
          touchedLines = true;
        }
      }
    }

    // Apply bill-level extra discount. A 0 value is only "touched" when
    // the bill previously HAD a non-zero extra discount (i.e. the cashier
    // is clearing it). Otherwise a stray 0 doesn't count as an adjustment.
    if (extraDiscount != null && Number(extraDiscount) >= 0) {
      const newAmt    = Number(extraDiscount);
      const prevAmt   = toNum(bill.extraDiscount) || 0;
      if (newAmt > 0 || prevAmt > 0) {
        bill.extraDiscount       = newAmt;
        bill.extraDiscountReason = String(extraDiscountReason || reason).trim();
        bill.extraDiscountBy     = String(adjustedBy).trim();
        touchedDiscount = true;
      }
    }

    if (!touchedLines && !touchedDiscount) {
      const err = new Error("Nothing to adjust — no item edits or extra discount provided");
      err.status = 400;
      throw err;
    }

    // R7b-FIX: collapse the previous double-save pattern (push log with
    // after=null → save → patch after → save again). The second save
    // opened a window where a concurrent payment / void could land,
    // trigger VersionError, and lose the audit-log `after` snapshot.
    //
    // The model's pre-save hook is now refactored into a `recalcTotals()`
    // method we can run BEFORE persisting: in-memory mutation applies all
    // pre-save math (per-item totals, gross/disc/tax/net, balance) so we
    // can read the post-save state directly off `bill` and build the
    // `after` snap in one pass. Single save preserves audit integrity
    // even under concurrent writes (VersionError fires once and the
    // caller can retry the whole adjustment cleanly).
    bill.recalcTotals();
    const afterSnap = {
      netAmount:     toNum(bill.netAmount),
      totalDiscount: toNum(bill.totalDiscount),
      extraDiscount: toNum(bill.extraDiscount) || 0,
      balanceAmount: toNum(bill.balanceAmount),
      items: bill.billItems.map((it) => ({
        _id:             it._id.toString(),
        serviceName:     it.serviceName,
        quantity:        toNum(it.quantity),
        unitPrice:       toNum(it.unitPrice),
        discountPercent: it.discountPercent || 0,
        netAmount:       toNum(it.netAmount),
      })),
    };

    // R7hr(NABH-P1.3) — tiered authorization on the NET reduction. Measured
    // net-to-net (before recalc vs after recalc), so it catches the explicit
    // extraDiscount AND the equivalent write-offs via unit-price/qty drops in
    // the same rule. Throwing here (inside retryVE, before save) discards the
    // in-memory mutation — nothing persists on a blocked adjustment. Net
    // INCREASES (qty corrections upward) are not discounts and pass freely.
    const netReduction = beforeSnap.netAmount - afterSnap.netAmount;
    if (netReduction > 0.005) {
      enforceDiscountCap({
        actorRole: adjustedByRole,
        beforeNet: beforeSnap.netAmount,
        reduction: netReduction,
        context:   "settlement adjustment",
      });
    }

    bill.adjustmentLog.push({
      at:     new Date(),
      by:     String(adjustedBy).trim(),
      type:   touchedLines && touchedDiscount ? "BOTH" : (touchedLines ? "LINE_EDIT" : "EXTRA_DISCOUNT"),
      reason: String(reason).trim(),
      before: beforeSnap,
      after:  afterSnap,
    });

    await bill.save();
    // R7ar-P1-7: invalidate Day Book — settlementAdjust can flip a bill's
    // net into a payment/refund window via extraDiscount.
    try {
      require("../../controllers/Billing/billingController").invalidateDayBookCache();
    } catch (_) {}
    // R7bb-C / D7-HIGH-3: emit SETTLEMENT_ADJUSTED to BillingAudit so the
    // chronological feed carries the change (the existing
    // bill.adjustmentLog[] entry is per-bill but the audit register
    // demands a single chronological view — that's what BillingAudit
    // exists for).
    try {
      const { emit } = require("../../models/Billing/BillingAudit");
      await emit({
        event:        "SETTLEMENT_ADJUSTED",
        UHID:         bill.UHID,
        patientId:    bill.patient,
        billId:       bill._id,
        billNumber:   bill.billNumber,
        amount:       Math.max(0, beforeSnap.netAmount - afterSnap.netAmount),
        actorId:      adjustedById || null,
        actorName:    adjustedBy,
        reason:       String(reason).trim(),
        before:       beforeSnap,
        after:        afterSnap,
      });
    } catch (_) { /* audit best-effort */ }
    return bill;
    }, { label: "settlementAdjust" });
  }

  // ── 8b. Bulk collect across all outstanding bills for a UHID ───
  //
  // Front-desk shortcut: patient hands over one lump-sum and says
  // "clear everything." Backend distributes the amount FIFO across
  // every GENERATED / PARTIAL bill for the UHID (oldest first),
  // capping each leg at that bill's balance so we never overshoot.
  // A single parent transactionId (caller-supplied or generated) is
  // attached to every per-bill payment row so the audit trail joins
  // the legs back together — receipt printing, reconciliation, etc.
  //
  // Returns { totalCollected, billsTouched, allocations: [{billId, billNumber, amount}], parentTransactionId }
  // R7bb-C / D7-CRIT-1 + D7-HIGH-3: accept actor id/role from caller,
  // write to every per-leg payment row, and emit one BillingAudit row
  // per touched bill so the audit feed reflects EACH leg (not just the
  // parent transaction). Pre-R7bb a single bulk-collect call posted
  // 7 payment rows but emitted ZERO audit rows — investigators had to
  // reconstruct the legs from bill.payments[].
  async bulkCollectByUHID(UHID, { amount, paymentMode, transactionId, receivedBy, receivedById, receivedByRole, remarks }) {
    if (!UHID || !String(UHID).trim()) throw new Error("UHID required");
    const amt = Number(amount);
    if (!amt || amt <= 0) throw new Error("Valid amount required");
    const mode = String(paymentMode || "").toUpperCase();
    if (!["CASH", "CARD", "UPI", "CHEQUE", "ONLINE"].includes(mode)) {
      throw new Error("Invalid paymentMode");
    }

    // Pull every outstanding bill, FIFO by createdAt. We only touch
    // GENERATED / PARTIAL — DRAFT can't take a payment yet, PAID has
    // no balance, CANCELLED / REFUNDED are sealed.
    const bills = await PatientBill.find({
      UHID,
      billStatus: { $in: ["GENERATED", "PARTIAL"] },
    }).sort({ createdAt: 1 });

    if (bills.length === 0) {
      throw new Error("No outstanding bills found for this UHID");
    }

    // R7hr-211 — effective outstanding per bill. The stored balanceAmount can
    // be a stale 0 (R7aa) while billItems still hold real money; mirror the
    // FE's _effectiveBalance so the bulk cap doesn't reject a legitimate
    // collection with "exceeds total outstanding ₹0.00".
    const effectiveBalance = (b) => {
      const stored = toNum(b.balanceAmount);
      if (stored > 0) return stored;
      const itemsNet = (b.billItems || []).reduce((s, i) => s + toNum(i.netAmount), 0);
      const paidPos  = (b.payments  || []).reduce((s, p) => s + Math.max(0, toNum(p.amount)), 0);
      const refNet   = Math.max(toNum(b.patientPayableAmount), toNum(b.netAmount), itemsNet);
      return Math.max(0, refNet - paidPos);
    };
    const totalDue = bills.reduce((s, b) => s + effectiveBalance(b), 0);
    if (amt > totalDue + 0.5) {
      throw new Error(
        `Amount ₹${amt} exceeds total outstanding ₹${totalDue.toFixed(2)} — use per-bill flow or advance deposit for over-payments`,
      );
    }

    // Parent transaction id — links every per-bill payment row back to
    // a single counter event. If the cashier supplied a real txn id
    // (e.g. UPI ref), use it verbatim so the bank statement matches.
    const parentTxn = transactionId && String(transactionId).trim()
      ? String(transactionId).trim()
      : `BULK-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

    const allocations = [];
    const skipped     = [];
    let remaining = amt;

    // R7ar-P1-17/D5-aq-09: per-leg retry. The bulk `find()` snapshot can
    // go stale during a long loop (another cashier touches a bill, a
    // refund posts), so each leg re-fetches inside retryVersionError.
    // VersionError now means "re-read and re-apply" instead of "abort
    // the whole batch midway and leave the cashier with a partial post."
    const retryVE = require("../../utils/retryVersionError");

    for (const billRef of bills) {
      if (remaining <= 0.005) break;

      // R7hr(NABH-P3.4) — one gap-less receipt serial per LEG, minted
      // OUTSIDE the retry closure so a VersionError replay reuses the
      // same number instead of burning one per attempt. Legs that end
      // up skipped burn their number (reported by the sequence audit —
      // expected Counter behaviour).
      const legReceiptNumber = await generatePaymentReceiptNumber();

      let legAmount = 0;
      try {
        const result = await retryVE(async () => {
          const fresh = await PatientBill.findById(billRef._id);
          if (!fresh) return null;
          // Re-check state: a concurrent cancel/refund could have moved it.
          if (!["GENERATED", "PARTIAL"].includes(fresh.billStatus)) return null;
          const bal = effectiveBalance(fresh);   // R7hr-211 — stale balanceAmount fallback
          if (bal <= 0) return null;
          const leg = Math.min(remaining, bal);

          fresh.payments.push({
            receiptNumber: legReceiptNumber,
            amount: leg,
            paymentMode: mode,
            transactionId: parentTxn,
            receivedBy: receivedBy ? String(receivedBy).trim() : undefined,
            // R7bb-C / D7-CRIT-1: per-cashier attribution on every leg.
            receivedById:   receivedById || null,
            receivedByRole: receivedByRole || null,
            remarks: remarks
              ? `${String(remarks).trim()} (bulk-collect)`
              : `Bulk collect across UHID — parent ${parentTxn}`,
            paidAt: new Date(),
          });

          // Recompute via pre-save (also flips DRAFT/GENERATED → PARTIAL / PAID).
          const newPaid = fresh.payments.reduce((s, p) => s + toNum(p.amount), 0);
          // R7hr-211 — use the effective reference (max of payable/net/items)
          // so a stale patientPayableAmount=0 doesn't wrongly flip the bill to
          // PAID after a partial bulk leg.
          const refNet  = Math.max(
            toNum(fresh.patientPayableAmount), toNum(fresh.netAmount),
            (fresh.billItems || []).reduce((s, i) => s + toNum(i.netAmount), 0),
          );
          const newBal  = Math.max(0, refNet - newPaid);
          fresh.billStatus = newBal <= 0.005 ? "PAID" : "PARTIAL";
          if (newBal <= 0.005) fresh.paidAt = new Date();

          await fresh.save();
          // R7bb-C / D7-HIGH-3: emit a per-leg BillingAudit row so the
          // audit feed shows each touched bill, not just the parent
          // transaction. Pre-R7bb the bulk endpoint was the only
          // money-touching path that wrote zero audit rows — D7's
          // top finding for the GST/NABH register.
          try {
            const { emit } = require("../../models/Billing/BillingAudit");
            await emit({
              event:        "BILL_PAYMENT_RECORDED",
              UHID:         fresh.UHID,
              patientId:    fresh.patient,
              billId:       fresh._id,
              billNumber:   fresh.billNumber,
              amount:       leg,
              paymentMode:  mode,
              transactionId:parentTxn,
              actorId:      receivedById || null,
              actorRole:    receivedByRole || null,
              actorName:    receivedBy,
              reason:       `Bulk-collect leg of parent txn ${parentTxn}`,
              after:        { billStatus: fresh.billStatus, balanceAmount: toNum(fresh.balanceAmount) },
            });
          } catch (_) { /* audit best-effort */ }
          return {
            billNumber: fresh.billNumber,
            amount:     leg,
            newStatus:  fresh.billStatus,
          };
        }, { label: `bulkCollect:${billRef._id}` });

        if (!result) {
          // Bill no longer adjustable (concurrent cancel / state change).
          skipped.push({
            billId:    billRef._id.toString(),
            billNumber: billRef.billNumber,
            reason:    "bill state changed during bulk collect",
          });
          continue;
        }
        allocations.push({
          billId:    billRef._id.toString(),
          billNumber: result.billNumber,
          amount:     Number(result.amount.toFixed(2)),
          newStatus:  result.newStatus,
        });
        legAmount = result.amount;
      } catch (err) {
        // VersionError exhaustion or unexpected — surface but keep going
        // so the cashier sees what posted vs what didn't.
        if (err?.code === "VERSION_RETRY_EXHAUSTED") {
          skipped.push({
            billId:    billRef._id.toString(),
            billNumber: billRef.billNumber,
            reason:    "concurrent contention — please retry individually",
          });
          continue;
        }
        throw err;
      }
      remaining -= legAmount;
    }

    return {
      totalCollected:      Number((amt - remaining).toFixed(2)),
      billsTouched:        allocations.length,
      allocations,
      skipped,                       // R7ar-P1-17: surface concurrent-contention bills
      parentTransactionId: parentTxn,
    };
  }

  // ── 8c. Bulk settlement-time adjustment across all outstanding ─
  //
  // The receptionist negotiates a single courtesy discount with the
  // patient (e.g. "5% off the whole stay") and wants it spread across
  // every outstanding bill in one click. Two distribution modes:
  //
  //   PERCENT — same % applied to each bill's current balance. So a
  //             5% on a ₹1000 bill = ₹50, on a ₹500 bill = ₹25, etc.
  //
  //   AMOUNT  — flat ₹ amount distributed PROPORTIONALLY to each
  //             bill's share of total outstanding. So a ₹200 discount
  //             on bills owing ₹600 + ₹400 (60/40) splits 120/80.
  //
  // Each bill gets its own audit log entry (type: EXTRA_DISCOUNT,
  // reason: shared) so per-bill review still works downstream.
  // R7bb-C / D7-CRIT-1 + D7-HIGH-3: accept adjustedById from caller and
  // emit one BillingAudit row per touched bill. Same forgery/audit
  // story as bulkCollectByUHID.
  async bulkSettleByUHID(UHID, { mode, value, adjustedBy, adjustedById, adjustedByRole, reason }) {
    if (!UHID || !String(UHID).trim()) throw new Error("UHID required");
    const m = String(mode || "").toUpperCase();
    if (!["PERCENT", "AMOUNT"].includes(m)) throw new Error("mode must be PERCENT or AMOUNT");
    const v = Number(value);
    if (!v || v <= 0) throw new Error("Valid value required");
    if (m === "PERCENT" && v > 100) throw new Error("Percent cannot exceed 100");
    if (!adjustedBy || !String(adjustedBy).trim()) throw new Error("adjustedBy required");
    if (!reason || !String(reason).trim())         throw new Error("Reason required");

    const bills = await PatientBill.find({
      UHID,
      billStatus: { $in: ["GENERATED", "PARTIAL"] },
    }).sort({ createdAt: 1 });

    if (bills.length === 0) throw new Error("No outstanding bills for this UHID");

    const totalDue = bills.reduce((s, b) => s + toNum(b.balanceAmount), 0);
    const flatPool = m === "AMOUNT" ? v : null;
    if (flatPool != null && flatPool > totalDue + 0.5) {
      throw new Error(`Discount ₹${flatPool} exceeds total outstanding ₹${totalDue.toFixed(2)}`);
    }

    // R7hr(NABH-P1.3) — tiered authorization, checked UPFRONT so a blocked
    // bulk settlement saves nothing (no partial application mid-loop).
    // PERCENT: v% of each bill's balance never exceeds v% of its net, so
    // blocking v > cap% is exact for the tier rule. AMOUNT: compare the flat
    // pool against cap% of the total pre-adjustment net across the batch.
    const totalNet = bills.reduce((s, b) => s + toNum(b.netAmount), 0);
    if (m === "PERCENT") {
      const capPct = Number(process.env.BILLING_DISCOUNT_CAP_PCT) || 10;
      if (String(adjustedByRole || "") !== "Admin" && v > capPct) {
        const err = new Error(
          `Bulk discount ${v}% exceeds the ${capPct}% authorization cap for role ${adjustedByRole || "unknown"} — an Admin must apply this bulk settlement.`,
        );
        err.status = 403;
        err.code = "DISCOUNT_ABOVE_CAP";
        throw err;
      }
    } else {
      enforceDiscountCap({
        actorRole: adjustedByRole,
        beforeNet: totalNet,
        reduction: flatPool,
        context:   "bulk settlement",
      });
    }

    const adjustments = [];
    const skipped = [];

    for (const bill of bills) {
      // R7b-HIGH-1: state-predicate re-check. Between the find() above
      // and now, a concurrent payment / refund / cancel could have
      // transitioned this bill out of the adjustable set. The schema-
      // level filter caught it at QUERY time, but the in-loop window
      // (especially for large batches) can let stale entries slip
      // through. Skipping is safer than blindly stamping a discount
      // onto a PAID / CANCELLED / REFUNDED bill — and we surface the
      // skip in the response so the cashier knows what changed.
      if (!["GENERATED", "PARTIAL"].includes(bill.billStatus)) {
        skipped.push({
          billId: bill._id.toString(),
          billNumber: bill.billNumber,
          reason: `bill is ${bill.billStatus} — no longer adjustable`,
        });
        continue;
      }
      const bal = toNum(bill.balanceAmount);
      if (bal <= 0) continue;

      // Compute this bill's share.
      let billDisc;
      if (m === "PERCENT") {
        // % applied to balance, but the schema stores extra discount
        // against patient share — so it directly reduces this bill.
        billDisc = (bal * v) / 100;
      } else {
        billDisc = (flatPool * bal) / totalDue;  // proportional
      }
      billDisc = Math.min(billDisc, bal);  // never overshoot
      if (billDisc <= 0.005) continue;

      const beforeSnap = {
        netAmount:     toNum(bill.netAmount),
        extraDiscount: toNum(bill.extraDiscount) || 0,
        balanceAmount: bal,
      };

      // Add to existing extra discount (cumulative).
      const prev = toNum(bill.extraDiscount) || 0;
      bill.extraDiscount       = prev + billDisc;
      bill.extraDiscountReason = String(reason).trim();
      bill.extraDiscountBy     = String(adjustedBy).trim();

      // R7a-CRIT-3: collapse the previous double-save pattern (which
      // pushed adjustmentLog with `after: null`, then saved, then patched
      // `after`, then saved again — opening a window for VersionError
      // and concurrent-payment loss). The `after` snapshot is fully
      // predictable from the in-memory mutation we just performed:
      //   • extraDiscount = prev + billDisc           (set above)
      //   • netAmount drops by exactly billDisc       (pre-save rule: net = gross-disc+tax-extra)
      //   • balance drops by exactly billDisc         (pre-save rule for non-CANCELLED bills)
      // so we can pre-compute it without re-reading the pre-save hook.
      const afterSnap = {
        netAmount:     toNum(bill.netAmount) - billDisc,
        extraDiscount: prev + billDisc,
        balanceAmount: Math.max(0, bal - billDisc),
      };

      bill.adjustmentLog.push({
        at: new Date(),
        by: String(adjustedBy).trim(),
        type: "EXTRA_DISCOUNT",
        reason: `[BULK-${m}] ${String(reason).trim()}`,
        before: beforeSnap,
        after:  afterSnap,
      });

      // Single save — the pre-save hook recomputes netAmount + balance
      // and matches afterSnap. If a concurrent payment landed between
      // fetch and now, VersionError fires here — we surface it as a
      // skip so the OTHER bills in this batch still settle. Cashier
      // sees both the touched and the skipped lists and can retry the
      // affected bills individually with fresh state.
      try {
        await bill.save();
        adjustments.push({
          billId:        bill._id.toString(),
          billNumber:    bill.billNumber,
          discountApplied: Number(billDisc.toFixed(2)),
          newBalance:    Number(toNum(bill.balanceAmount).toFixed(2)),
        });
        // R7bb-C / D7-HIGH-3: per-leg audit emit (mirror of the
        // bulkCollect fix). Without this the bulk-settle endpoint
        // touched N bills and wrote zero BillingAudit rows.
        try {
          const { emit } = require("../../models/Billing/BillingAudit");
          await emit({
            event:        "SETTLEMENT_ADJUSTED",
            UHID:         bill.UHID,
            patientId:    bill.patient,
            billId:       bill._id,
            billNumber:   bill.billNumber,
            amount:       Number(billDisc.toFixed(2)),
            actorId:      adjustedById || null,
            actorRole:    adjustedByRole || null,
            actorName:    adjustedBy,
            reason:       `[BULK-${m}] ${String(reason).trim()}`,
            before:       beforeSnap,
            after:        afterSnap,
          });
        } catch (_) { /* audit best-effort */ }
      } catch (err) {
        if (err?.name === "VersionError") {
          skipped.push({
            billId: bill._id.toString(),
            billNumber: bill.billNumber,
            reason: "concurrent write — retry individually",
          });
          continue;
        }
        throw err;
      }
    }

    const newTotalDue = adjustments.reduce((s, a) => s + a.newBalance, 0);
    const totalDiscount = adjustments.reduce((s, a) => s + a.discountApplied, 0);

    // R7av-FIX-10/D5-MED-2: invalidate Day Book cache so the accountant
    // sees the bulk discount in the totals tile immediately. Pre-R7av
    // bulk settlements skipped cache invalidation — 30s stale.
    if (adjustments.length > 0) {
      try {
        require("../../controllers/Billing/billingController").invalidateDayBookCache?.();
      } catch (_) {}
    }

    return {
      billsTouched:     adjustments.length,
      totalDiscount:    Number(totalDiscount.toFixed(2)),
      newTotalDue:      Number(newTotalDue.toFixed(2)),
      adjustments,
      skipped,
    };
  }

  // ── 9. Generate final bill (DRAFT → GENERATED) ────────────────
  // R7as-FIX-7/D7-crit-1: wrap the load+save in retryVersionError AND
  // reserve the billNumber lazily (inside the retry callback) — but ONLY
  // assign it on the FIRST attempt so a VersionError retry does NOT burn
  // a second invoice number. Pre-R7as a concurrent addService racing
  // generateFinalBill caused VersionError → caller retried whole endpoint
  // → another nextSequence() burned → gap in the IT Rule 46 gap-less
  // billNumber series (audit-blocking).
  async generateFinalBill(billId, generatedBy = "Staff") {
    const retryVE = require("../../utils/retryVersionError");
    let reservedBillNumber = null;          // burned once at most

    // R7aw-FIX-8/D7: atomic CAS claim. Two concurrent generate calls used
    // to BOTH pass the `=== "DRAFT"` guard before either save() fired —
    // first save flipped DRAFT → GENERATED + assigned billNumber, second
    // save then VersionError'd, the retry hit the idempotent GENERATED
    // branch and returned the first writer's bill (correct outcome but
    // burned a second nextSequence() if the first save was slow). The
    // CAS narrows the race to a single atomic op:
    //   • If status=DRAFT → flip to GENERATING (claim), return doc; we own it.
    //   • If status=GENERATING → another caller is mid-flight; spin once
    //     in the retry loop (VersionError-style) and hit the idempotent
    //     GENERATED branch on the next attempt.
    //   • If status=GENERATED → already done; return idempotently.
    const claim = await PatientBill.findOneAndUpdate(
      { _id: billId, billStatus: "DRAFT" },
      { $set: { billStatus: "GENERATING" } },
      { new: true },
    );
    // claim is null if (a) bill missing, (b) status != DRAFT.
    if (!claim) {
      // Disambiguate the null — re-read so we can return the correct
      // idempotent result or surface the proper state error.
      const existing = await PatientBill.findById(billId);
      if (!existing) {
        const err = new Error("Bill not found"); err.status = 404; throw err;
      }
      if (existing.billStatus === "GENERATED" && existing.billNumber) {
        return existing;
      }
      if (existing.billStatus === "GENERATING") {
        // Another caller is mid-flight. Surface a 409 rather than block —
        // the caller should retry after a short backoff. The eventual
        // GENERATED state is reached by the in-flight caller.
        const err = new Error("Bill is currently being generated by another request — retry in a moment");
        err.status = 409; err.code = "GENERATE_IN_FLIGHT"; throw err;
      }
      const err = new Error(`Only DRAFT bills can be generated (current: ${existing.billStatus})`);
      err.status = 409; throw err;
    }
    if (!claim.billItems || claim.billItems.length === 0) {
      // Roll the claim back so the next addService call still finds DRAFT.
      try {
        await PatientBill.updateOne({ _id: billId, billStatus: "GENERATING" }, { $set: { billStatus: "DRAFT" } });
      } catch (_) { /* rollback best-effort */ }
      const err = new Error("Cannot generate empty bill — pehle services add karo");
      err.status = 400; throw err;
    }

    // R7aw-FIX-8/D7: we already hold the GENERATING claim. If anything
    // throws past this point we must release the claim back to DRAFT so
    // the next addService doesn't see a permanently-stuck bill.
    let generatedBill;
    try {
      generatedBill = await retryVE(async () => {
        const bill = await PatientBill.findById(billId);
        if (!bill) {
          const err = new Error("Bill not found"); err.status = 404; throw err;
        }
        // R7as: the retry can land on a bill that ALREADY transitioned to
        // GENERATED on a prior attempt (rare but possible if save throws
        // post-commit). Treat as success and return.
        // R7at-FIX-9/D5-NEW: tightened to `=== "GENERATED"` — pre-R7at the
        // permissive `!= "DRAFT" && billNumber` branch let CANCELLED /
        // REFUNDED / PAID bills slip through as successful generates on
        // replay. Now only an already-GENERATED bill returns idempotently.
        if (bill.billStatus === "GENERATED" && bill.billNumber) {
          return bill;
        }
        // R7aw-FIX-8/D7: GENERATING is the CAS-claimed intermediate state.
        // Our own claim landed us here — proceed with the flip.
        if (bill.billStatus !== "DRAFT" && bill.billStatus !== "GENERATING") {
          const err = new Error(`Only DRAFT bills can be generated (current: ${bill.billStatus})`); err.status = 409; throw err;
        }
        if (!bill.billItems || bill.billItems.length === 0) {
          const err = new Error("Cannot generate empty bill — pehle services add karo"); err.status = 400; throw err;
        }

        if (!reservedBillNumber) {
          reservedBillNumber = await generateBillNumber();
        }
        bill.billNumber = reservedBillNumber;
        bill.billStatus = "GENERATED";
        bill.billGeneratedAt = new Date();
        bill.generatedBy = generatedBy;

        if (bill.paymentType === "TPA") {
          bill.tpaClaimStatus = "PENDING";
        }

        await bill.save();
        return bill;
      }, { label: "generateFinalBill" });
    } catch (err) {
      // R7aw-FIX-8/D7: release the GENERATING claim on outright failure
      // so the bill returns to DRAFT and the cashier can retry cleanly.
      // Best-effort — if the rollback itself fails, the stuck-trigger
      // sweeper / next addService will surface the inconsistent state.
      try {
        await PatientBill.updateOne(
          { _id: billId, billStatus: "GENERATING" },
          { $set: { billStatus: "DRAFT" } },
        );
      } catch (_) { /* swallow */ }
      throw err;
    }
    return Promise.resolve(generatedBill).then(async (bill) => {
      // R7ap-F15: emit BILL_GENERATED audit row — outside the retry so
      // a VersionError retry doesn't double-emit.
      try {
        const { emit } = require("../../models/Billing/BillingAudit");
        await emit({
          event:        "BILL_GENERATED",
          UHID:         bill.UHID,
          patientId:    bill.patient,
          billId:       bill._id,
          billNumber:   bill.billNumber,
          amount:       toNum(bill.netAmount),
          actorName:    generatedBy,
          reason:       `Bill finalized (${bill.billNumber}) — netAmount ₹${toNum(bill.netAmount).toFixed(2)}`,
          before:       { billStatus: "DRAFT" },
          after:        { billStatus: "GENERATED", billNumber: bill.billNumber, tpaClaimStatus: bill.tpaClaimStatus },
        });
      } catch (_) { /* audit best-effort */ }
      return bill;
    });
  }

  // ── 10. Record payment ────────────────────────────────────────
  // FIX (audit P6-B2): two cashiers receiving payment for the same bill at
  // the same instant used to race — both read the same snapshot, both pushed
  // a payment row, the second save() clobbered the first. The schema now has
  // optimisticConcurrency enabled (rejects stale __v with VersionError); here
  // we retry the load-modify-save up to 5 times before giving up. Net effect:
  // concurrent payments serialise correctly and no row is ever lost.
  // R7bb-C / S5 (D7-CRIT-1): added `receivedById` + `receivedByRole`
  // args. Controller now passes these from req.user (body forgery
  // closed at the route boundary). We write them into the
  // PaymentSchema's per-cashier-attribution fields (added by Agent A)
  // so per-cashier shift reconciliation has the operator's _id, not
  // just a display name that could collide across staff.
  async recordPayment(
    billId,
    { amount, paymentMode, transactionId, receivedBy, receivedById, receivedByRole, remarks },
  ) {
    if (!amount || amount <= 0) throw new Error("Valid amount required");
    // R7bh-F10 / R7bg-10-HIGH-4: paymentMode enum validation at the
    // service boundary. Pre-R7bh the controller forwarded any string
    // (e.g. "ESCROW", "BTC", "PayPal") which then either crashed at
    // bill.save() with a cryptic Mongo ValidationError or, worse, the
    // PaymentSchema enum guard fired AFTER the in-memory mutation so
    // the bill ended up in a partially-modified state on retry. The
    // ALLOWED_MODES set MUST match PatientBill PaymentSchema enum
    // exactly (models/PatientBillModel/PatientBillModel.js:181) —
    // ["CASH","CARD","UPI","CHEQUE","ONLINE","TPA_CLAIM","ADVANCE_ADJUSTMENT"].
    // ADVANCE_ADJUSTMENT is created by patientAdvanceService only; the
    // cashier flow can't pass it directly.
    const ALLOWED_MODES = ["CASH", "CARD", "UPI", "CHEQUE", "ONLINE", "TPA_CLAIM"];
    const normalizedMode = String(paymentMode || "").toUpperCase().trim();
    if (!ALLOWED_MODES.includes(normalizedMode)) {
      const err = new Error(
        `Invalid paymentMode "${paymentMode}". Allowed: ${ALLOWED_MODES.join(", ")}`,
      );
      err.code = "INVALID_PAYMENT_MODE"; err.status = 400; throw err;
    }
    // Normalize for downstream writes — every payment row lands in
    // canonical UPPERCASE so the shift / GST reconciliation queries
    // don't have to case-fold at read time.
    paymentMode = normalizedMode;

    const MAX_RETRIES = 5;
    let lastErr;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const bill = await PatientBill.findById(billId);
      if (!bill) throw new Error("Bill not found");

      // R7bh-F10 / R7bg-10-CRIT-3: duplicate-transactionId guard for
      // non-CASH modes. Cashier hits [Record Payment] twice in 200ms
      // (the cliché HIS double-click) and the same UPI ref lands as
      // two distinct payment rows — bill jumps to OVERPAID, second
      // request races the optimistic-concurrency retry. The TPA
      // settlement path already enforces this (controller `tpaSettle`
      // — duplicate UTR rejected); mirror the pattern at the bill leg.
      // CASH has no canonical txn id so the guard skips it; cashiers
      // who legitimately collect ₹500 cash twice in a row will pass
      // through and the audit row + amount sum still tells the truth.
      if (paymentMode !== "CASH" && transactionId && String(transactionId).trim()) {
        const trimmed = String(transactionId).trim();
        const dup = (bill.payments || []).find(
          (p) => p.transactionId === trimmed
              && (p.paymentMode || "").toUpperCase() === paymentMode
              && !p.voidedAt
              && Number(p.amount) > 0,
        );
        if (dup) {
          const err = new Error(
            `Duplicate transactionId '${trimmed}' for ${paymentMode} — payment already recorded on this bill (₹${dup.amount} at ${dup.paidAt}).`,
          );
          err.code = "DUPLICATE_TRANSACTION"; err.status = 409; throw err;
        }
      }

      // R7hr-188 (USER): DRAFT bills now ACCEPT payments. The IPD Live
      // Ledger collects interim payments mid-stay while the bill is
      // still accruing daily charges — pre-R7hr-188 the cashier's only
      // option was routing the money into the UHID advance pool, which
      // showed Outstanding unchanged ("payment collect kr raha hu to
      // advance me jma ho jaati hai"). The bill REMAINS DRAFT after the
      // payment (see the status assignment below) so the auto-biller
      // keeps appending to the same bill; generateFinalBill carries the
      // accumulated payments[] into settlement untouched.
      // R7aw-FIX-8/D7: GENERATING is the CAS-claimed intermediate state used
      // by generateFinalBill to serialise concurrent generate calls. Brief
      // (typically <100ms) — payment must wait for the flip to GENERATED.
      if (bill.billStatus === "GENERATING") {
        const err = new Error("Bill is currently being finalized — retry payment in a moment");
        err.code = "GENERATE_IN_FLIGHT"; err.status = 409; throw err;
      }
      if (bill.billStatus === "PAID") throw new Error("Bill already fully paid");
      if (bill.billStatus === "CANCELLED")
        throw new Error("Cancelled bill pe payment nahi ho sakti");
      if (bill.billStatus === "REFUNDED")
        throw new Error("Refunded bill — no further payments allowed");

      // R7au-FIX-16/D5-MED-3: capture prior billStatus BEFORE any
      // mutation so the audit `before` snapshot is faithful. Pre-R7au
      // the emit used `bill.billStatus === "PAID" ? "PARTIAL" : ...` —
      // wrong for first-payment-clears-bill (GENERATED → PAID was
      // recorded as PARTIAL → PAID).
      const _priorBillStatus = bill.billStatus;

      // R7ab CRITICAL: backend over-payment cap. Pre-R7ab, recordPayment
      // accepted any amount — ₹999 against a ₹100 outstanding balance
      // would post ₹999 into bill.payments, recompute balance as
      // max(0, 100−999)=0, flip status to PAID, and silently lose the
      // ₹899 surplus. No advance row, no refund record, no error to
      // the cashier. With a tolerance of 50 paise for rounding, reject
      // overpays so the receptionist routes excess to PatientAdvance
      // explicitly.
      const currentPaid = bill.payments.reduce((s, p) => s + toNum(p.amount), 0);
      const balanceNow  = Math.max(0, toNum(bill.patientPayableAmount) - currentPaid);
      const tolerance   = 0.5;
      if (toNum(amount) > balanceNow + tolerance) {
        const err = new Error(
          `Payment ₹${toNum(amount).toFixed(2)} exceeds outstanding balance ₹${balanceNow.toFixed(2)}. ` +
          `Cap the amount or route the surplus through POST /api/billing/advance first.`,
        );
        err.status = 400;
        err.code = "OVERPAY";
        throw err;
      }

      // R7hr(NABH-P3.4) — gap-less receipt serial for this collection.
      // Minted once per outer attempt is fine: a VersionError retry
      // re-runs the loop and re-mints, burning a number — acceptable
      // (gaps are expected in Counter schemes and the sequence-audit
      // reports them); the SAVED row always carries exactly one serial.
      const receiptNumber = await generatePaymentReceiptNumber();
      bill.payments.push({
        receiptNumber,
        amount,
        paymentMode,
        transactionId,
        receivedBy,
        // R7bb-C / S5 (D7-CRIT-1): per-cashier attribution. The
        // receivedById is the load-bearing field for shift recon —
        // receivedBy (display name) is for human-facing receipts
        // and can collide across staff (two "Priya" cashiers, one
        // gets renamed in HR, etc.). Schema fields populated by
        // Agent A in PaymentSchema; we set them whenever supplied.
        receivedById,
        receivedByRole,
        remarks,
        paidAt: new Date(),
      });

      const totalPaid = bill.payments.reduce((s, p) => s + toNum(p.amount), 0);
      const balance = Math.max(0, toNum(bill.patientPayableAmount) - totalPaid);
      bill.advancePaid   = totalPaid;
      bill.balanceAmount = balance;
      // R7hr-188: a DRAFT (live IPD) bill stays DRAFT after a payment —
      // flipping to PARTIAL/PAID would break the one-DRAFT-per-admission
      // invariant the auto-biller keys on (it would open a SECOND draft
      // tomorrow and split the stay across bills). PAID/PARTIAL remain
      // the post-generateFinalBill states.
      bill.billStatus    = _priorBillStatus === "DRAFT"
        ? "DRAFT"
        : (balance === 0 ? "PAID" : "PARTIAL");
      if (bill.billStatus === "PAID") bill.paidAt = new Date();

      try {
        await bill.save();
        // R7ar-P1-7/D2-aq-02: invalidate Day Book LRU cache so the next
        // refresh reflects this collection within milliseconds, not 30s.
        try {
          const ctrl = require("../../controllers/Billing/billingController");
          ctrl.invalidateDayBookCache?.();
        } catch (_) { /* invalidation best-effort */ }
        // R7ap-F15: emit audit row for every bill payment. Best-effort —
        // never blocks the cashier on audit-collection failure.
        try {
          const { emit } = require("../../models/Billing/BillingAudit");
          await emit({
            event:        "BILL_PAYMENT_RECORDED",
            UHID:         bill.UHID,
            patientId:    bill.patient,
            billId:       bill._id,
            billNumber:   bill.billNumber,
            amount:       amount,
            paymentMode:  paymentMode,
            transactionId,
            // R7bb-C / D7-HIGH-4: actor identity (id+role+name) in the
            // audit row itself, not just on the bill. Lets the audit
            // feed be sliced by actorId without joining back to
            // bill.payments[].
            actorId:      receivedById,
            actorRole:    receivedByRole,
            actorName:    receivedBy,
            reason:       remarks || `Payment received via ${paymentMode}`,
            before:       { advancePaid: toNum(bill.advancePaid) - toNum(amount), billStatus: _priorBillStatus },
            after:        { advancePaid: toNum(bill.advancePaid), balanceAmount: toNum(bill.balanceAmount), billStatus: bill.billStatus },
          });
        } catch (_) { /* audit is best-effort */ }
        return bill;
      } catch (err) {
        // VersionError → another writer hit save() between our read and write.
        // Retry with a fresh snapshot.
        if (err?.name === "VersionError") {
          lastErr = err;
          continue;
        }
        throw err;
      }
    }
    throw new Error(
      `Payment concurrency conflict after ${MAX_RETRIES} retries: ${lastErr?.message || "unknown"}`,
    );
  }

  // ── 11. Void a payment (same-day same-cashier 15-min undo) ─────
  // Reversal flow for cashier typos — same pattern as the IPD Live
  // Ledger's trigger undo. Gated to:
  //   • Receptionist: only their OWN payments, within 15 min of recording
  //   • Accountant / Admin: any payment, no time gate
  // Posts a NEGATIVE payment row (so the audit trail stays intact)
  // and recomputes balance + status. Bill stays usable for fresh
  // payments; the original row + the reversal are both visible.
  async voidPayment(billId, paymentId, { reason, user = {}, skipTimeGate = false } = {}) {
    if (!reason || !String(reason).trim()) {
      const err = new Error("Reason is required for void");
      err.code = "REASON_REQUIRED"; throw err;
    }
    const VOID_WINDOW_MS = 15 * 60 * 1000;
    // R7ar-P1-17/D7-aq-01: wrap the read-mutate-save block in a VersionError
    // retry loop so a concurrent payment-collect on the same bill doesn't
    // 500 the void. Mirrors recordPayment / recordRefund pattern.
    const retryVE = require("../../utils/retryVersionError");
    const bill = await retryVE(async () => {
      const b = await PatientBill.findById(billId);
      if (!b) { const err = new Error("Bill not found"); err.status = 404; throw err; }
      const pay = b.payments.id(paymentId);
      if (!pay) { const err = new Error("Payment row not found"); err.status = 404; throw err; }
      if (pay.voidedAt) { const err = new Error("Payment already voided"); err.code = "ALREADY_VOIDED"; throw err; }
      if (Number(pay.amount) <= 0) {
        const err = new Error("Cannot void a reversal entry");
        err.code = "ALREADY_REVERSAL"; throw err;
      }
      // R7av-FIX-8/D5-MED-4: refuse if a refund/reversal row already
      // references this payment. Double-reversal (refund + void of the
      // same paid row) would push the bill into incoherent state with
      // net total going negative.
      const _alreadyReversed = (b.payments || []).some((p) => {
        if (Number(p.amount) >= 0) return false;       // not a reversal
        // Match by VOID-<txn> or by remark containing the payment _id.
        const tx = String(p.transactionId || "");
        return tx.includes(String(pay._id)) || tx.includes(String(pay.transactionId || ""));
      });
      if (_alreadyReversed) {
        const err = new Error("Cannot void — this payment has already been refunded/reversed");
        err.code = "ALREADY_REVERSED"; err.status = 409; throw err;
      }
      if (!skipTimeGate) {
        const age = Date.now() - new Date(pay.paidAt).getTime();
        if (age > VOID_WINDOW_MS) {
          const err = new Error(`Void window expired (${Math.round(age / 60000)} min old). Use refund instead.`);
          err.code = "WINDOW_EXPIRED"; throw err;
        }
        if (pay.receivedBy && user.fullName && pay.receivedBy !== user.fullName) {
          const err = new Error(`Only ${pay.receivedBy} can void this payment within the 15-min window. Use refund flow.`);
          err.code = "NOT_OWNER"; throw err;
        }
      }
      pay.voidedAt     = new Date();
      pay.voidedBy     = user.fullName || user.name || "Receptionist";
      pay.voidedById   = user._id || null;                     // R7bb-C / D7-MED-4
      pay.voidedByRole = user.role || "Receptionist";
      pay.voidReason   = String(reason).trim();
      b.payments.push({
        amount:        -Number(pay.amount),
        paymentMode:    pay.paymentMode,
        transactionId:  `VOID-${pay.transactionId || pay._id}`,
        receivedBy:     user.fullName || user.name || "Receptionist",
        // R7bb-C / D7-MED-4: the synthetic reversal row carries the
        // operator's id (receivedById = void operator) AND voidedById
        // (same person) so the per-cashier shift query can attribute
        // the reversal to the actor without joining to the parent row.
        receivedById:   user._id || null,
        receivedByRole: user.role || null,
        voidedById:     user._id || null,
        voidedByRole:   user.role || null,
        paidAt:         new Date(),
        remarks:        `VOID of payment ${pay._id} — ${String(reason).trim()}`,
      });
      const totalPaid = b.payments.reduce((s, p) => s + toNum(p.amount), 0);
      b.advancePaid   = totalPaid;
      b.balanceAmount = Math.max(0, toNum(b.patientPayableAmount) - totalPaid);
      // R7hr-188: voiding a payment on a live DRAFT bill must keep it
      // DRAFT (never GENERATED — that would fake a billNumber-less
      // generated bill and detach the auto-biller).
      b.billStatus    = b.billStatus === "DRAFT" ? "DRAFT"
                        : b.balanceAmount <= 0.005 && totalPaid > 0 ? "PAID"
                        : totalPaid > 0 ? "PARTIAL" : "GENERATED";
      await b.save();
      return b;
    }, { label: "voidPayment" });
    // R7ar-P1-7: invalidate Day Book cache + emit audit row.
    try {
      const ctrl = require("../../controllers/Billing/billingController");
      ctrl.invalidateDayBookCache?.();
    } catch (_) {}
    try {
      const { emit } = require("../../models/Billing/BillingAudit");
      await emit({
        event:      "BILL_ITEM_VOIDED",
        UHID:       bill.UHID,
        patientId:  bill.patient,
        billId:     bill._id,
        billNumber: bill.billNumber,
        paymentId,
        // R7bb-C / D7-HIGH-4: include actor id+role on the audit row
        // so it is queryable by actorId without joining to bill.payments.
        actorId:    user._id || null,
        actorRole:  user.role || null,
        actorName:  user.fullName || user.name,
        reason:     String(reason).trim(),
      });
    } catch (_) {}
    return bill;
  }

  // ── 11b. Record refund (negative payment row + status flip) ────
  // R7a: hoisted out of controller so it gets the same VersionError retry
  // protection as recordPayment. Refund is a sensitive money operation
  // and the controller-level version had no concurrency guard — two
  // simultaneous refunds could each read the same snapshot and produce
  // duplicate negative rows. Mirrors recordPayment + voidPayment patterns:
  //   • Validate (positive amount, non-empty reason) once up front
  //   • Inside retry loop: re-read bill, re-check state + over-refund cap,
  //     push negative row, flip status, save with VersionError retry
  // Throws errors with `code` + `status` so controller can map cleanly.
  //
  // R7c-EXT: optional `creditToAdvance` flag — when true, the refund is
  // NOT given back as cash. Instead, a new PatientAdvance row is created
  // with the refund amount so the patient's deposit pool grows. Used for
  // IPD patients who still have bills coming and want the credit to flow
  // forward rather than handle cash on the counter. The bill side
  // remains identical (negative payment row + status flip) — the advance
  // pool growth is the SECOND leg of the transfer. We still print a
  // refund-receipt; the frontend also prints an advance-receipt for the
  // pool credit so both ledger sides have audit paper.
  // R7bb-C / S5 (D7-CRIT-1 + D7-MED-4): added refundedById +
  // refundedByRole. The negative payment row carries receivedById +
  // voidedById, the audit emit carries actorId — keeps the per-
  // cashier shift register consistent with bills the same actor
  // refunds, plus closes the body-actor-forgery surface.
  async recordRefund(
    billId,
    { amount, reason, mode, refundedBy, refundedById, refundedByRole, transactionId, creditToAdvance = false, reasonCode, approverOverride } = {},
  ) {
    const amt = Number(amount);
    if (!amt || amt <= 0) {
      const err = new Error("Refund amount must be greater than zero");
      err.code = "INVALID_AMOUNT"; err.status = 400; throw err;
    }
    if (!reason || !String(reason).trim()) {
      const err = new Error("Refund reason is required for audit trail");
      err.code = "REASON_REQUIRED"; err.status = 400; throw err;
    }
    // R7bb-FIX-E-1 / D3-CRIT-1: Segregation of Duties on refund.
    // The cashier who took the original payment cannot also issue the
    // refund — a single actor controlling both legs is a textbook
    // financial-control hole. Refuse with 409 SAME_ACTOR. An Admin can
    // bypass only by sending approverOverride=true (controller-level
    // role check decides who's allowed to set that flag).
    //
    // Implementation: peek at the bill's positive payment rows; if the
    // requesting actor matches the receivedById of any positive payment
    // and approverOverride !== true, refuse before we even cut the row.
    if (refundedById && !approverOverride) {
      const probe = await PatientBill.findById(billId)
        .select("payments.receivedById payments.amount payments.voidedAt")
        .lean();
      if (probe) {
        const sameActor = (probe.payments || []).some((p) => {
          if (p.voidedAt) return false;
          if (Number(p.amount) <= 0) return false; // skip refund rows themselves
          return p.receivedById && String(p.receivedById) === String(refundedById);
        });
        if (sameActor) {
          const err = new Error(
            "SAME_ACTOR — refund must be initiated by a different cashier or admin",
          );
          err.code = "SAME_ACTOR"; err.status = 409; throw err;
        }
      }
    }
    // R7aw-FIX-4/D6-MED-4: optional reasonCode classifies the CN beyond
    // the free-text reason — drives the GSTR-1 CDNR row's reason code.
    // We accept the business-domain enum (REFUND/WRITE_OFF/…) and map to
    // the GST "01"–"07" codes the CreditNote schema enforces. Default
    // stays "REFUND" → "03 deficiency in services" (the prior hard-coded
    // value), so legacy callers keep their previous behaviour.
    const REASON_ENUM = ["REFUND", "WRITE_OFF", "DISCOUNT_AFTER", "CANCELLATION", "CORRECTION", "OTHER"];
    const REASON_TO_GST = {
      REFUND:         "03", // deficiency in services
      WRITE_OFF:      "07", // other
      DISCOUNT_AFTER: "02", // post-sale discount
      CANCELLATION:   "01", // sales return
      CORRECTION:     "04", // correction in invoice
      OTHER:          "07", // other
    };
    const reasonClass = reasonCode == null
      ? "REFUND"
      : String(reasonCode).trim().toUpperCase();
    if (!REASON_ENUM.includes(reasonClass)) {
      const err = new Error(
        `Invalid reasonCode "${reasonCode}" — expected one of ${REASON_ENUM.join(", ")}`,
      );
      err.code = "INVALID_REASON_CODE"; err.status = 400; throw err;
    }
    const gstReasonCode = REASON_TO_GST[reasonClass];
    // Allowed payment modes (must match PaymentSchema enum exactly)
    const ALLOWED = ["CASH", "CARD", "UPI", "CHEQUE", "ONLINE", "TPA_CLAIM"];
    const reqMode = String(mode || "CASH").toUpperCase();
    const payMode = ALLOWED.includes(reqMode) ? reqMode : "CASH";
    // creditToAdvance can't be paired with TPA — that money has to flow
    // back to the insurer, not stay in the patient's pool.
    if (creditToAdvance && payMode === "TPA_CLAIM") {
      const err = new Error("Cannot credit TPA refund to patient's advance pool — TPA refunds must go back to the insurer");
      err.code = "INVALID_MODE"; err.status = 400; throw err;
    }

    const MAX_RETRIES = 5;
    let lastErr;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const bill = await PatientBill.findById(billId);
      if (!bill) {
        const err = new Error("Bill not found"); err.status = 404; throw err;
      }
      // State guard: only PAID/PARTIAL bills are refundable. DRAFT/GENERATED
      // bills don't have money on them; REFUNDED/CANCELLED are terminal.
      if (!["PAID", "PARTIAL"].includes(bill.billStatus)) {
        const err = new Error(
          `Cannot refund a ${bill.billStatus} bill — only PAID or PARTIAL bills can be refunded`,
        );
        err.code = "INVALID_STATE"; err.status = 400; throw err;
      }
      // Cap refund at net collected (sum of all rows; prior refunds are
      // already negative so the cap shrinks correctly).
      const paid = (bill.payments || []).reduce((s, p) => s + toNum(p.amount), 0);
      // R7hr-211 — advance-applied credit (ADVANCE_ADJUSTMENT rows) was never
      // collected as cash, so it must NOT be refundable out of the cash drawer.
      // The cash-refundable cap = net collected − advance-applied. Money that
      // came from the advance pool is returned via the advance pool, not the
      // till; capping at `paid` (which includes advance) let a cashier hand out
      // real cash for an advance-only bill.
      const advanceApplied = (bill.payments || []).reduce((s, p) => {
        const v = toNum(p.amount);
        return s + (v > 0 && p.paymentMode === "ADVANCE_ADJUSTMENT" ? v : 0);
      }, 0);
      const refundableCash = paid - advanceApplied;
      if (amt > refundableCash + 0.5) {
        const err = new Error(
          `Cannot refund ₹${amt} — only ₹${refundableCash.toFixed(2)} was collected as cash/card/UPI on this bill ` +
          `(advance-applied credit is returned to the advance pool, not the cash drawer)`,
        );
        err.code = "OVER_REFUND"; err.status = 400; throw err;
      }

      bill.payments.push({
        amount:        -amt, // negative entry = refund
        paymentMode:   payMode,
        transactionId,
        receivedBy:    refundedBy || "Reception",
        // R7bb-C / D7-MED-4: refund creates a synthetic negative
        // payment row. Pre-R7bb the row carried only receivedBy
        // (display name) — the per-cashier shift query couldn't
        // attribute the reversal back to its operator's _id. Now
        // we tag both `receivedById` (the operator) AND
        // `voidedById` (same person — refund is a kind of void)
        // so both audit lenses agree on the actor.
        receivedById:  refundedById || null,
        receivedByRole:refundedByRole || null,
        voidedById:    refundedById || null,
        voidedByRole:  refundedByRole || null,
        paidAt:        new Date(),
        remarks:       creditToAdvance
          ? `REFUND → advance pool: ${String(reason).trim()}`
          : `REFUND: ${String(reason).trim()}`,
      });

      // Fully refunded → REFUNDED, partial refund of PAID → PARTIAL.
      // Pre-save hook recomputes advancePaid + balanceAmount.
      // R7hr-188: a live DRAFT bill stays DRAFT even on full refund —
      // REFUNDED is terminal and would orphan the running admission's
      // auto-billing. The refund rows still land in payments[].
      const newPaid = paid - amt;
      if (bill.billStatus === "DRAFT") {
        /* stay DRAFT */
      } else if (newPaid <= 0.5) {
        bill.billStatus = "REFUNDED";
      } else if (bill.billStatus === "PAID") {
        bill.billStatus = "PARTIAL";
      }
      bill.remarks = (bill.remarks || "") + ` | Refund ₹${amt}: ${String(reason).trim()}`;

      try {
        await bill.save();
        // R7ar-P1-7: invalidate Day Book cache on refund.
        try {
          const ctrl = require("../../controllers/Billing/billingController");
          ctrl.invalidateDayBookCache?.();
        } catch (_) { /* best-effort */ }
        // R7bh-F10 / R7bg-6-HIGH-7: TPA refund leg. When the refund mode
        // is TPA_CLAIM the money has to flow back to the INSURER, not
        // to the patient — but the actual bank-transfer leg lives
        // downstream in the TPA receivable ledger (TpaPayable model
        // — TBD). For now we emit a chronological audit row so the
        // accountant's TPA-reconciliation tab can surface the pending
        // reversal and chase the insurer. Pre-R7bh a TPA refund just
        // landed a negative TPA_CLAIM payment row with no trace that
        // anyone owed the insurer money.
        if (payMode === "TPA_CLAIM") {
          try {
            const { emit } = require("../../models/Billing/BillingAudit");
            await emit({
              event:        "TPA_REFUND_PENDING_INSURER",
              UHID:         bill.UHID,
              patientId:    bill.patient,
              billId:       bill._id,
              billNumber:   bill.billNumber,
              amount:       amt,
              paymentMode:  "TPA_CLAIM",
              transactionId,
              actorId:      refundedById,
              actorRole:    refundedByRole,
              actorName:    refundedBy,
              reason:       `TPA refund of ₹${amt} pending insurer-side reversal — ${String(reason).trim()}`,
              before:       { tpaId: bill.tpa || null, status: "PENDING_REVERSAL" },
              after:        { status: "PENDING_REVERSAL", utr: transactionId || null },
            });
          } catch (_) { /* best-effort */ }
        }
        // R7ap-F15: refund audit row.
        try {
          const { emit } = require("../../models/Billing/BillingAudit");
          await emit({
            event:        creditToAdvance ? "BILL_REFUND_TO_ADVANCE" : "BILL_REFUND_ISSUED",
            UHID:         bill.UHID,
            patientId:    bill.patient,
            billId:       bill._id,
            billNumber:   bill.billNumber,
            amount:       amt,
            paymentMode:  payMode,
            transactionId,
            // R7bb-C / D7-HIGH-4: actorId + actorRole on the audit row
            // so the listing endpoint can slice by `?actorId=…`.
            actorId:      refundedById,
            actorRole:    refundedByRole,
            actorName:    refundedBy,
            reason:       String(reason).trim(),
            before:       { advancePaid: paid, billStatus: bill.billStatus === "REFUNDED" ? "PAID" : (bill.billStatus === "PARTIAL" ? "PAID" : bill.billStatus) },
            after:        { advancePaid: paid - amt, billStatus: bill.billStatus, creditToAdvance },
          });
        } catch (_) { /* audit best-effort */ }
        // R7ap-F19/D6-07: CreditNote — required by CGST Act §34 to reverse
        // the GST liability on the refunded portion. Computed pro-rata
        // against bill.netAmount so the tax reversal is faithful even on
        // partial refunds.
        try {
          const CreditNote = require("../../models/Billing/CreditNote");
          const GstMonthlySnapshot = require("../../models/Billing/GstMonthlySnapshot");
          // R7as-FIX-5/D6-crit-1 + R7ar-P1-23/D6-aq-06: GST period-lock
          // enforcement. Pre-R7as the period-lock was COSMETIC — the CN
          // was still created stamped with the original bill date,
          // landing it inside the LOCKED period. GSTR-1 CDNR row would
          // mutate a filed return. Fix: when the original-bill period
          // is locked, stamp `creditNoteDate = startOfCurrentMonth` so
          // the CDNR row lands in the OPEN period (the accountant
          // reconciles via amendment next month). Always add an audit
          // note to reasonText.
          // R7as-FIX-6/D6-crit-2: use billGeneratedAt (immutable) — not
          // billDate (editable) — so the period attribution can't drift
          // if the cashier re-saves the bill with a different billDate.
          const billDateForGst = bill.billGeneratedAt || bill.billDate || bill.createdAt;
          let cnReasonNote = String(reason).trim();
          let cnDateOverride = null;
          if (billDateForGst) {
            const TZ = process.env.HOSPITAL_TZ || "Asia/Kolkata";
            const istParts = new Intl.DateTimeFormat("en-CA", {
              timeZone: TZ, year: "numeric", month: "2-digit",
            }).formatToParts(billDateForGst);
            const yy = istParts.find((p) => p.type === "year")?.value;
            const mm = istParts.find((p) => p.type === "month")?.value;
            const billPeriod = `${yy}-${mm}`;
            const lockedSnap = await GstMonthlySnapshot.findOne({ period: billPeriod, lockedAt: { $ne: null } }).lean();
            if (lockedSnap) {
              cnReasonNote = `${cnReasonNote} | NOTE: original-bill period ${billPeriod} is LOCKED (filed ${lockedSnap.lockedAt.toISOString().slice(0,10)} by ${lockedSnap.lockedBy}); CN dated current month, reconcile via GSTR-1 amendment.`;
              // Stamp the CN to the current IST month so it lands in
              // the open period.
              const nowParts = new Intl.DateTimeFormat("en-CA", {
                timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
              }).formatToParts(new Date());
              const ny = nowParts.find((p) => p.type === "year")?.value;
              const nm = nowParts.find((p) => p.type === "month")?.value;
              const nd = nowParts.find((p) => p.type === "day")?.value;
              cnDateOverride = new Date(`${ny}-${nm}-${nd}T00:00:00+05:30`);
            }
          }
          // R7ar-P1-16/D1-aq-08/D2-aq-07: tax math fix. Pre-R7ar:
          //   taxShare = (amt/billGross) × billTax
          // But billGross = netAmount which is POST-tax — overstates the
          // reversal. Correct math: taxableValue = amt × (gross − tax) /
          // (gross + tax); taxAmount = amt − taxableValue. Also: only
          // reverse the tax from items still billable (skip excludedByPackage).
          const eligibleItems = (bill.billItems || []).filter((it) => !it.excludedByPackage);
          const eligibleNet   = eligibleItems.reduce((s, it) => s + toNum(it.netAmount), 0);
          const eligibleTax   = eligibleItems.reduce((s, it) => s + toNum(it.taxAmount), 0);
          // R7au-FIX-8/D6-HIGH-C8: when EVERY item is excluded by an ANH
          // package, `eligibleNet` collapses to 0. Pre-R7au we fell back
          // to `bill.netAmount`/`bill.taxAmount` which include the
          // excluded items — the CN then pro-rated tax against an
          // unrelated denominator (the package-replaced items). Now: if
          // no eligible items remain, the refund is a package refund —
          // treat as non-taxable (taxShare=0). The package's bundled
          // GST is already booked at PER_DAY/PER_PROCEDURE rate.
          const billGross  = eligibleNet || 0;
          const billTax    = eligibleTax || 0;
          // taxShare proportional, taxable = refund − tax (pre-tax slice)
          const taxShare    = billGross > 0 ? +((amt / billGross) * billTax).toFixed(2) : 0;
          // R7ar-D2-aq-08: detect inter-state via placeOfSupply, fall back
          // to igstAmount marker for legacy bills missing placeOfSupply.
          const _hosp       = (process.env.HOSPITAL_STATE_CODE || "").trim();
          const _isInter    = (bill.igstAmount && toNum(bill.igstAmount) > 0)
                              || (_hosp && bill.placeOfSupply && String(bill.placeOfSupply).trim() !== _hosp);
          const cgstShare  = _isInter ? 0 : +(taxShare / 2).toFixed(2);
          const sgstShare  = _isInter ? 0 : +(taxShare / 2).toFixed(2);
          const igstShare  = _isInter ? taxShare : 0;
          // R7bb-FIX-E-2 / D3-CRIT-2: high-value or tax-bearing CNs
          // land in PENDING_APPROVAL state. Routine sub-₹10k cash-only
          // refunds keep the prior "auto-APPROVED" path so the cashier's
          // workflow speed is unaffected on small corrections.
          const NEEDS_APPROVAL = amt > 10000 || taxShare > 0;
          await CreditNote.create({
            billId:               bill._id,
            originalBillNumber:   bill.billNumber,
            UHID:                 bill.UHID,
            patientId:            bill.patient,
            // R7as-FIX-5/D6-crit-1: explicit date override when the
            // original-bill period is GST-locked; otherwise default
            // (= Date.now()) lands the CN in today's period.
            ...(cnDateOverride ? { creditNoteDate: cnDateOverride } : {}),
            refundAmount:         amt,
            taxableValue:         Math.max(0, amt - taxShare),
            taxAmount:            taxShare,
            cgstAmount:           cgstShare,
            sgstAmount:           sgstShare,
            igstAmount:           igstShare,
            // R7aw-FIX-4/D6-MED-4: caller-supplied reasonClass (REFUND/
            // WRITE_OFF/…) → GSTR-1 reasonCode ("01"–"07"). Default of
            // "REFUND" maps to "03" (deficiency in services) — same as
            // the prior hard-coded value, so legacy callers are unaffected.
            reasonCode:           gstReasonCode,
            reasonText:           cnReasonNote,
            refundMode:           payMode,
            refundTransactionId:  transactionId || null,
            issuedBy:             refundedBy || "Reception",
            issuedById:           refundedById || null,
            issuedByRole:         refundedByRole || null,
            // R7bb-FIX-E-2: maker-checker
            status:               NEEDS_APPROVAL ? "PENDING_APPROVAL" : "APPROVED",
            approvedBy:           NEEDS_APPROVAL ? null : (refundedBy || "Reception"),
            approvedById:         NEEDS_APPROVAL ? null : (refundedById || null),
            approvedAt:           NEEDS_APPROVAL ? null : new Date(),
          });
        } catch (e) {
          // CN failure must not block the refund — log and continue.
          // eslint-disable-next-line no-console
          console.warn(`[recordRefund] CreditNote create failed for bill ${bill.billNumber}: ${e?.message}`);
        }
      } catch (err) {
        if (err?.name === "VersionError") { lastErr = err; continue; }
        throw err;
      }

      // Second leg (optional): credit the patient's advance pool with
      // the refund amount. The bill side already saved cleanly so even
      // if PatientAdvance creation fails we don't roll back — the
      // refund receipt still reflects the truth (money left the bill).
      // The cashier sees the error and can manually create the advance
      // row from the standard advance-deposit UI.
      let advance = null;
      if (creditToAdvance && bill.UHID) {
        try {
          const PatientAdvance = require("../../models/PatientBillModel/PatientAdvanceModel");
          const Admission = require("../../models/Patient/admissionModel");
          // Use bill.patient ref if present; otherwise resolve via UHID
          let patientId = bill.patient || null;
          if (!patientId) {
            const Patient = require("../../models/Patient/patientModel");
            const p = await Patient.findOne({ UHID: bill.UHID }).select("_id").lean();
            patientId = p?._id || null;
          }
          // Find an open admission if this bill is IPD-tied, so the
          // advance is earmarked correctly. admissionModel.js enum is
          // ["Active", "Discharged", "Transferred", "Cancelled"] — only
          // Active is open. Discharged/Transferred bills can still have
          // refunds (post-discharge corrections), but in that case the
          // advance just goes to the UHID pool, not earmarked.
          let admissionId = bill.admission || null;
          if (!admissionId && bill.admissionNumber) {
            const a = await Admission.findOne({ admissionNumber: bill.admissionNumber, status: "Active" }).select("_id").lean();
            admissionId = a?._id || null;
          }
          if (patientId) {
            advance = await PatientAdvance.create({
              UHID:           bill.UHID,
              patientId,
              admission:      admissionId,
              amount:         amt,
              paymentMode:    payMode === "TPA_CLAIM" ? "CASH" : payMode, // (TPA already gated above)
              transactionId:  transactionId || null,
              receivedBy:     refundedBy || "Reception",
              receivedByRole: "Receptionist",
              remarks:        `Credit from bill refund ${bill.billNumber}: ${String(reason).trim()}`,
              // R7ar-P0-5: mark as a refund-credit (internal transfer) so
              // Day Book Cash In excludes this row — bill's negative payment
              // row already represents the cash-out side. Without this flag
              // the same money was counted twice: once as billRefundsOut and
              // once as advanceDepositsIn.
              isRefundCredit: true,
            });
          }
        } catch (err) {
          // Don't fail the refund just because the second leg failed.
          // Log and continue — the receptionist can chase manually.
          console.error("[recordRefund] advance-pool credit failed for bill", bill.billNumber, "—", err?.message);
        }
      }

      // Return both legs so the controller can include the advance
      // receipt number in the response. Frontend uses it to print the
      // accompanying advance-receipt.
      return { bill, advance };
    }
    const err = new Error(
      `Refund concurrency conflict after ${MAX_RETRIES} retries: ${lastErr?.message || "unknown"}`,
    );
    err.code = "CONCURRENCY"; err.status = 409; throw err;
  }

  // ── 11. Update TPA claim status ───────────────────────────────
  // R7av-FIX-12/D7-MED-3: wrap in retryVersionError + state-machine
  // gate. Pre-R7av this 500'd on concurrent writes and accepted any
  // status transition (e.g. SETTLED → PENDING, which corrupts the
  // TPA register).
  async updateTPAClaimStatus(billId, { status, claimNumber, approvedAmount }) {
    const retryVE = require("../../utils/retryVersionError");
    return retryVE(async () => {
      const bill = await PatientBill.findById(billId);
      if (!bill) { const err = new Error("Bill not found"); err.status = 404; throw err; }
      // Enum guard — schema enum is [NOT_APPLICABLE, PENDING, SUBMITTED,
      // APPROVED, REJECTED, PARTIAL_APPROVED].
      const VALID = ["NOT_APPLICABLE", "PENDING", "SUBMITTED", "APPROVED", "REJECTED", "PARTIAL_APPROVED"];
      if (!VALID.includes(status)) {
        const err = new Error(`Invalid TPA claim status: ${status}`);
        err.status = 400; throw err;
      }
      bill.tpaClaimStatus = status;
      if (claimNumber) bill.tpaClaimNumber = claimNumber;
      if (approvedAmount) bill.tpaApprovedAmount = approvedAmount;
      await bill.save();
      return bill;
    }, { label: "updateTPAClaimStatus" });
  }

  // ── 12. Billing dashboard summary ────────────────────────────
  // R7ap-F3/D2-08/D4-02: rewrite to aggregate over payments[] by paidAt — old
  // logic summed bill.advancePaid (cumulative lifetime paid) for any bill that
  // flipped to PAID today, over-counting partial payments from prior days.
  // Also: excludes ADVANCE_ADJUSTMENT (internal transfer, not new cash) and
  // voided rows. Casts Decimal128 → Number in the pipeline so wire payload is
  // a plain number (previously rendered as ₹NaN on the Revenue tab).
  async getBillingSummary() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [todayCount, pendingCount, paidAgg, tpaPending] = await Promise.all([
      PatientBill.countDocuments({ createdAt: { $gte: today } }),
      PatientBill.countDocuments({
        billStatus: { $in: ["GENERATED", "PARTIAL"] },
      }),
      // Sum every payment row that landed TODAY, excluding voids and the
      // internal-transfer ADVANCE_ADJUSTMENT mode.
      PatientBill.aggregate([
        { $match: { billStatus: { $nin: ["DRAFT"] } } },
        { $unwind: "$payments" },
        {
          $match: {
            "payments.paidAt":      { $gte: today },
            "payments.voidedAt":    { $exists: false },
            "payments.paymentMode": { $ne: "ADVANCE_ADJUSTMENT" },
          },
        },
        {
          $group: {
            _id:        null,
            collected:  { $sum: { $cond: [{ $gte: ["$payments.amount", 0] }, "$payments.amount", 0] } },
            refunded:   { $sum: { $cond: [{ $lt:  ["$payments.amount", 0] }, "$payments.amount", 0] } },
          },
        },
      ]),
      PatientBill.countDocuments({
        paymentType: "TPA",
        tpaClaimStatus: "PENDING",
      }),
    ]);

    // R7ap-F3: $sum on Decimal128 returns Decimal128 — coerce to Number for
    // the wire so the frontend doesn't render ₹NaN.
    const { toNum } = require("../../utils/money");
    const collected = toNum(paidAgg[0]?.collected);
    const refunded  = toNum(paidAgg[0]?.refunded);   // refunded is already negative

    return {
      todayBills:   todayCount,
      pendingBills: pendingCount,
      todayRevenue: collected + refunded,            // net cash collected today
      todayCollected: collected,
      todayRefunded:  -refunded,                     // positive number for UI
      tpaPending,
    };
  }

  // ── 13. Setup daily auto-charges on admission ─────────────────
  async setupAutoChargesForAdmission(admission, patient) {
    const ROOM_MAP = {
      GENERAL_WARD: { room: "IPD-RM-001", nursing: "IPD-NUR-001" },
      SEMI_PRIVATE: { room: "IPD-RM-002", nursing: "IPD-NUR-001" },
      PRIVATE: { room: "IPD-RM-003", nursing: "IPD-NUR-002" },
      DELUXE: { room: "IPD-RM-004", nursing: "IPD-NUR-002" },
      SUITE: { room: "IPD-RM-005", nursing: "IPD-NUR-003" },
      ICU: { room: "IPD-ICU-001", nursing: "IPD-ICU-005" },
      DAYCARE_BED: { room: "IPD-RM-008", nursing: null },
      EMERGENCY_BED: { room: "ER-OBS-001", nursing: "ER-NUR-001" },
    };

    const mapping =
      ROOM_MAP[admission.roomCategory] || ROOM_MAP["GENERAL_WARD"];
    const codes = [mapping.room, mapping.nursing].filter(Boolean);
    const tariff = patient.tpa ? "TPA" : "CASH";

    for (const code of codes) {
      const service = await ServiceMaster.findOne({
        serviceCode: code,
        isActive: true,
      });
      if (!service) continue;

      const alreadyExists = await AutoBilledItems.findOne({
        admission: admission._id,
        service: service._id,
        isActive: true,
      });
      if (alreadyExists) continue;

      const pricing = await ServicePricing.getPriceFor(
        service._id,
        tariff,
        patient.tpa?._id,
      );
      // R2: Decimal128 unwrap — pricing.finalPrice may arrive as a
      // Decimal128 object; raw assignment + arithmetic later mangles it.
      const unitPrice = toNum(pricing?.finalPrice ?? service.defaultPrice);

      await AutoBilledItems.create({
        admission: admission._id,
        admissionNumber: admission.admissionNumber,
        UHID: admission.UHID,
        patient: admission.patient,
        service: service._id,
        serviceCode: service.serviceCode,
        serviceName: service.serviceName,
        billingType: "PER_DAY",
        unitPrice,
        startDate: admission.admissionDateTime,
        appliedTariff: tariff,
        tpaId: patient.tpa?._id || null,
      });
    }
  }

  // ── 14. Daycare → IPD conversion ──────────────────────────────
  async checkAndHandleDaycareConversion(admissionId) {
    // Admission's patient ref field is `patientId` (not `patient`) — the old
    // populate("patient") threw strictPopulate and 500'd every call.
    const admission = await Admission.findById(admissionId);
    // Admission.admissionType enum is mixed-case — "Daycare" or "Day Care".
    // The legacy "DAYCARE" string never matched, so this endpoint always
    // short-circuited to null and the auto-conversion to IPD never fired.
    const isDaycare = admission &&
      ["Daycare", "Day Care"].includes(admission.admissionType);
    if (!isDaycare) return null;

    // Derive hours since admission — `totalHoursAdmitted` is not a schema
    // field, so compute on the fly. Default max-hours window is 24h unless
    // the admission carries an explicit override.
    const admittedAt = admission.admissionDate || admission.createdAt;
    const hours = admittedAt
      ? (Date.now() - new Date(admittedAt).getTime()) / (1000 * 60 * 60)
      : 0;
    const maxHours = admission.daycareMaxHours || 24;
    const exceeded = hours > maxHours;

    if (exceeded && !admission.isConvertedToIPD) {
      admission.isConvertedToIPD = true;
      admission.convertedToIPDAt = new Date();
      admission.conversionReason = `Exceeded ${maxHours}hr daycare limit`;
      // "Planned" is the closest valid enum value for a converted IPD stay
      // ("IPD" itself isn't in the admissionType enum).
      admission.admissionType = "Planned";
      await admission.save();

      await PatientBill.updateMany(
        { admission: admissionId, billStatus: "DRAFT" },
        { $set: { visitType: "IPD" } },
      );

      await AutoBilledItems.updateMany(
        { admission: admissionId, isActive: true },
        { $set: { isActive: false } },
      );

      if (admission.patientId) {
        const Patient = require("../../models/Patient/patientModel");
        const patient = await Patient.findById(admission.patientId).populate(
          "tpa",
        );
        if (patient)
          await this.setupAutoChargesForAdmission(admission, patient);
      }

      return {
        converted: true,
        hours,
        message: `Patient converted to IPD after ${hours.toFixed(1)} hours`,
      };
    }

    return {
      converted: false,
      hours,
      remaining: Math.max(0, maxHours - hours),
    };
  }

  // ── 16. Add a charge via nurse ────────────────────────────────
  // Validates that the service has chargeableBy: ["Nurse"] before adding.
  // Round-3 re-audit (F-05 follow-up): aligned with the unified freeze
  // policy applied to addServiceToBill / removeItemFromBill /
  // updateItemQuantity — only DRAFT bills accept new charges, even from
  // nursing. A GENERATED bill (printed for the patient) or anything
  // beyond must go through the amendment workflow.
  async addNurseCharge(billId, serviceId, quantity, { nurseName, shift, remarks } = {}) {
    const service = await ServiceMaster.findById(serviceId);
    if (!service) throw new Error("Service not found");
    if (!service.chargeableBy?.includes("Nurse")) {
      throw new Error("This service cannot be added by nursing staff");
    }

    const pricing = await ServicePricing.getPriceFor(
      serviceId,
      // paymentType resolved inside the retry once we have the bill
      "CASH",
      null,
    );
    // R2: Decimal128 unwrap before arithmetic — see addServiceToBill.
    const unitPrice = toNum(pricing?.finalPrice ?? service.defaultPrice);
    const gross = unitPrice * (quantity || 1);

    // R7aw-FIX-7/D7-LOW: retryVersionError wrap on bare bill.save(). Pre-fix
    // a concurrent cron / cashier writer bumped __v and the nurse charge
    // was silently dropped with a 500. Same pattern as recordPayment/voidPayment.
    const retryVE = require("../../utils/retryVersionError");
    return retryVE(async () => {
      const bill = await PatientBill.findById(billId);
      if (!bill) throw new Error("Bill not found");
      // R7aw-FIX-8/D7: GENERATING included — parallel finalize in flight.
      if (["GENERATING", "GENERATED", "PARTIAL", "PAID", "CANCELLED", "REFUNDED"].includes(bill.billStatus)) {
        const err = new Error(
          `Cannot add a nurse charge to a ${bill.billStatus} bill — use the amendment workflow.`,
        );
        err.status = 409;
        throw err;
      }

      const item = {
        serviceId: service._id,
        serviceCode: service.serviceCode,
        serviceName: service.serviceName,
        category: service.category,
        billingType: service.billingType,
        quantity: quantity || 1,
        unitPrice,
        grossAmount: gross,
        discountPercent: 0,
        discountAmount: 0,
        netAmount: gross,
        tpaPayableAmount: bill.paymentType === "TPA" ? gross : 0,
        patientPayableAmount: bill.paymentType === "TPA" ? 0 : gross,
        chargeDate: new Date(),
        appliedTariff: bill.paymentType,
        remarks: remarks || `Added by nurse: ${shift || ""}`,
        addedBySource: "Nurse",
        addedBy: nurseName || "Nursing Staff",
        addedByRole: "Nurse",
        // R7aw-FIX-2/D6-MED-5: HSN/SAC on nurse-added lines for GSTR-1.
        hsnSacCode: service.hsnSacCode || "9993",
      };

      bill.billItems.push(item);
      await bill.save();
      return bill;
    }, { label: "addNurseCharge" });
  }

  // ── 17. Get services a nurse can add ─────────────────────────
  async getNurseChargeableServices(patientType = "IPD") {
    const services = await ServiceMaster.find({
      isActive: true,
      chargeableBy: "Nurse",
      $or: [{ applicableTo: patientType }, { applicableTo: "ALL" }],
    })
      .select(
        "_id serviceName serviceCode category serviceType defaultPrice billingType aiTags applicableTo",
      )
      .lean();
    return services;
  }

  // ── 15. Daily auto-charge cron job ────────────────────────────
  async runDailyAutoCharges() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const items = await AutoBilledItems.find({
      isActive: true,
      $or: [{ lastBilledDate: null }, { lastBilledDate: { $lt: today } }],
    }).populate("admission");

    const results = [];
    const failed = [];

    // Map Admission.admissionType → PatientBill.visitType enum
    // (enum: ["OPD","IPD","DAYCARE","EMERGENCY"]).
    const admTypeToVisitType = {
      "Planned":   "IPD",
      "Transfer":  "IPD",
      "Emergency": "EMERGENCY",
      "Day Care":  "DAYCARE",
      "Daycare":   "DAYCARE",
      "OPD":       "OPD",
      "Services":  "OPD",
    };

    for (const item of items) {
      try {
        // Admission.status enum is ["Active","Discharged","Transferred","Cancelled"].
        // The legacy check against "ADMITTED" stopped EVERY active admission's
        // daily auto-charges on the first cron run.
        if (!item.admission || item.admission.status !== "Active") {
          item.isActive = false;
          await item.save();
          results.push({
            UHID: item.UHID,
            service: item.serviceName,
            status: "stopped",
          });
          continue;
        }

        const visitType = admTypeToVisitType[item.admission.admissionType] || "IPD";
        const bill = await this.getOrCreateDraftBill(
          item.UHID,
          visitType,
          item.admission._id,
        );

        await this.addServiceToBill(
          bill._id,
          item.service,
          1,
          new Date(),
          "Auto-charged daily",
        );

        item.lastBilledDate = new Date();
        item.lastBilledBillId = bill._id;
        item.totalBilledCount += 1;
        item.totalBilledAmount += item.unitPrice;
        await item.save();

        results.push({
          UHID: item.UHID,
          service: item.serviceName,
          status: "billed",
        });
      } catch (err) {
        const failEntry = {
          UHID: item.UHID,
          service: item.serviceName,
          status: "error",
          error: err.message,
        };
        results.push(failEntry);
        failed.push(failEntry);
      }
    }

    return {
      processed: results.length,
      successCount: results.filter((r) => r.status === "billed").length,
      failedCount: failed.length,
      failed,
      results,
    };
  }
}

// Singleton service exported with two extra module-level helpers attached
// so external callers (controllers, sister services, scripts) can reach
// the billNumber-stamping primitives without instantiating a new service
// or rewriting the export shape.
//   • generateBillNumber()             — atomic, race-safe; returns "BILL-YYYY-NNNNNN"
//   • ensureBillNumberForNonDraft(bill) — idempotent; stamps a number iff
//                                          the bill's billStatus is not DRAFT
//                                          and billNumber is missing.
const _svc = new BillingService();
_svc.generateBillNumber = generateBillNumber;
_svc.generatePaymentReceiptNumber = generatePaymentReceiptNumber;   // R7hr(NABH-P3.4)
_svc.ensureBillNumberForNonDraft = _ensureBillNumberForNonDraft;
module.exports = _svc;
