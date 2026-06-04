/**
 * pharmacyController.js — every pharmacy endpoint in one file.
 *
 * Mounted at /api/pharmacy:
 *
 *   Drugs:        GET /drugs · POST /drugs · PUT /drugs/:id · DELETE /drugs/:id
 *                 GET /drugs/search?q=…
 *
 *   Suppliers:    GET /suppliers · POST /suppliers · PUT /suppliers/:id · DELETE /suppliers/:id
 *
 *   GRN/Batches:  POST /grn          (record a goods-receipt → create batch)
 *                 GET  /batches      (?drugId, ?expiringIn, ?lowStock)
 *                 GET  /stock        (live inventory rollup per drug)
 *
 *   Dispense:     POST /sales        (sell items; FIFO consumes batch.remaining)
 *                 GET  /sales        (history with filters)
 *                 GET  /sales/:id
 *                 POST /sales/:id/cancel
 *
 *   Dashboard:    GET /stats         (KPI summary)
 *                 GET /alerts        (low-stock + expiring + expired)
 */
const Drug        = require("../../models/Pharmacy/DrugModel");
const DrugBatch   = require("../../models/Pharmacy/DrugBatchModel");
const Supplier    = require("../../models/Pharmacy/SupplierModel");
const Sale        = require("../../models/Pharmacy/PharmacySaleModel");
// R7db-2 — IPD Credit ledger must surface BOTH PharmacySale-based credit
// (counter dispense booked as Credit / partial-pay) AND PatientBill-based
// pharmacy line items written by autoBillingService.onIndentReleased
// (PHARM-* synthetic codes added when a ward indent is released → these
// land on the admission's IPD PatientBill, NOT on a separate PharmacySale
// doc). Without PatientBill in the credit ledger, the IPD Credit tab is
// blind to the entire indent-released drug-charge category.
const PatientBill = require("../../models/PatientBillModel/PatientBillModel");
// R7hr-5: pharmacist Live Ledger can settle an outstanding sale from the
// patient's advance pool — exact mirror of the IPD ledger's apply-advance
// flow. PatientAdvance is the source-of-truth balance; we mutate that +
// the sale's collectionLog atomically.
const PatientAdvance = require("../../models/PatientBillModel/PatientAdvanceModel");
const Settings    = require("../../models/Pharmacy/PharmacySettingsModel");
const PharmacyDayClose = require("../../models/Pharmacy/PharmacyDayCloseModel");
const Counter     = require("../../models/CounterModel");
const Patient     = require("../../models/Patient/patientModel");
// R7hr-12-S2 (D8-07): Doctor master lookup to auto-populate the prescriber's
// MCI/state-council registration number on Sch H/H1/X dispenses — D&C Form 2
// requires the registration column on the Schedule H register, otherwise the
// state-FDA / NABH inspector marks the register as non-compliant.
const Doctor      = require("../../models/Doctor/doctorModel");
const mongoose    = require("mongoose");
const { assertDrugSafeOrOverride } = require("../../utils/allergyCheck");
const scheduleXRegister = require("../../services/Pharmacy/scheduleXRegister");
// B6-T05 — Pharmacy lifecycle ClinicalAudit emits (NABH AAC.7 + IMS.2).
// Dispense / cancel / return / addItems / collectCredit each leave one
// audit row so the NABH register can reconstruct "who dispensed what to
// whom, and when" without scraping individual Sale docs.
const { emitClinicalAudit } = require("../../services/Compliance/clinicalAuditService");
// R7cu — pulled to module scope so collectCredit() can convert payment
// amounts to Decimal128 + retry on VersionError races (two cashiers
// collecting on the same sale simultaneously).
// R7hr-12 (D2-01/D2-02): toNum coerces Decimal128 → Number safely. Without
// it, expressions like `(sale.patientCredit || 0) + payable` trigger
// Decimal128.toString() and become STRING CONCATENATION (`'100.00' + 50`
// → `'100.0050'` → round2 → 100.01 instead of 150). Used at every read of
// a Decimal128 money field before arithmetic.
const { toDec, toNum } = require("../../utils/money");
const retryVersionError = require("../../utils/retryVersionError");

const todayISO  = () => new Date().toISOString().slice(0, 10);
const isOid     = (v) => mongoose.Types.ObjectId.isValid(v);

// ── R7bh-F4 / R7bg-3-HIGH-1: payment-mode normalisation ──────────
// The PharmacySale model still uses Title-case enum ("Cash","Card","UPI",
// "Mixed","Credit") — flipping that enum belongs to F2 backlog. For now
// we normalise at the controller boundary so the API accepts any
// case-permutation the front-end sends and persists the canonical form.
const PAYMENT_MODE_MAP = {
  CASH:   "Cash",
  CARD:   "Card",
  UPI:    "UPI",
  MIXED:  "Mixed",
  CREDIT: "Credit",
};
function _normPaymentMode(v, fallback = "Cash") {
  const k = String(v || fallback).toUpperCase();
  return PAYMENT_MODE_MAP[k] || fallback;
}

// Centralised error reply — Mongoose ValidationError → 400, bad cast → 400,
// duplicate key → 409, everything else → 500. Caller passes (res, err).
const sendErr   = (res, e) => {
  if (e?.name === "ValidationError") {
    const msg = Object.values(e.errors).map(x => x.message).join("; ");
    return res.status(400).json({ success: false, message: msg, code: "VALIDATION" });
  }
  if (e?.name === "CastError") {
    return res.status(400).json({ success: false, message: `Invalid id / cast — ${e.path}`, code: "VALIDATION" });
  }
  if (e?.code === 11000) {
    return res.status(409).json({ success: false, message: "Duplicate key — record already exists", code: "DUPLICATE" });
  }
  return res.status(500).json({ success: false, message: e?.message || "Server error", code: e?.code || null });
};
// Counter helper — schema uses `_id: String` as the scope key, not `name`.
async function nextSeq(scope) {
  const c = await Counter.findOneAndUpdate(
    { _id: scope },
    { $inc: { seq: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return c.seq || 1;
}

/* ════════════════════════════════════════════════════════════════
   DRUGS
══════════════════════════════════════════════════════════════════ */
exports.listDrugs = async (req, res) => {
  try {
    const { q, category, includeInactive } = req.query;
    const where = {};
    if (!includeInactive) where.isActive = true;
    if (category) where.category = category;
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      where.$or = [{ name: rx }, { genericName: rx }, { brandName: rx }, { manufacturer: rx }];
    }
    const drugs = await Drug.find(where).sort({ name: 1 }).lean();
    res.json({ success: true, data: drugs });
  } catch (e) { sendErr(res, e); }
};

// R7bq-1-FIX / R7bh-F4 / R7bg-9-CRIT-1: drug autocomplete search.
//
// Pre-R7bq this used `$text: { $search: q }` over the `drug_text_search`
// index. That broke real-world doctor typing because MongoDB's $text
// operator is a *whole-word* stemmed search — it tokenises the corpus
// on word boundaries, so "para" never matched "Paracetamol", "amox"
// never matched "Amoxicillin", "cipro" never matched "Ciprofloxacin".
// The doctor would type 4 chars and get an empty dropdown even though
// the drug exists in the master + has stock in the pharmacy.
//
// Restored to a case-insensitive *contains* regex across name,
// genericName, brandName, manufacturer — the same shape `listDrugs`
// uses (and which actually returns hits for prefix queries). The {
// name: 1 } and { genericName: 1 } indexes still help the optimizer
// when the query is anchored at the start of the field; the worst
// case (substring miss in the middle) is a 5k-row collection scan,
// well under the latency budget for a typeahead.
//
// We then $lookup DrugBatch to compute the *pharmacy stock register*
// view per drug — sum(remaining) → currentStock, max(mrp) →  mrp,
// nearest expiry → soonestExpiry. The autocomplete row UI uses these
// to show the doctor whether the SKU is actually in stock before
// they prescribe it. Out-of-stock items are still returned (currentStock = 0)
// so the doctor can prescribe a brand-new SKU that just hasn't been
// received yet — never block Rx entry on inventory state.
exports.searchDrugs = async (req, res) => {
  try {
    const q = (req.query.q || "").trim();
    if (!q) return res.json({ success: true, data: [] });

    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const rx = new RegExp(escaped, "i");

    // Single-char queries still fall back to anchored-prefix on `name`
    // only — a 1-char contains-regex over four fields scans the whole
    // master per keystroke and brings nothing useful to the doctor
    // (the dropdown would have 80+ rows starting with "A").
    const where = q.length === 1
      ? { isActive: true, name: new RegExp("^" + escaped, "i") }
      : { isActive: true, $or: [
          { name:         rx },
          { genericName:  rx },
          { brandName:    rx },
          { manufacturer: rx },
        ] };

    const drugs = await Drug.aggregate([
      { $match: where },
      // Stock register join — sum remaining units across active,
      // unexpired batches per drug. Done as a sub-pipeline lookup
      // so we can apply the isActive + remaining > 0 + expiry > now
      // filters before grouping (smaller intermediate set than a
      // plain localField/foreignField lookup).
      { $lookup: {
          from: "pharmacydrugbatches",
          let: { drugId: "$_id" },
          pipeline: [
            { $match: { $expr: { $and: [
              { $eq: ["$drugId", "$$drugId"] },
              { $eq: ["$isActive", true] },
              { $gt: ["$remaining", 0] },
              { $gt: ["$expiryDate", new Date()] },
            ] } } },
            { $group: {
              _id: null,
              currentStock: { $sum: "$remaining" },
              mrp:          { $max: "$mrp" },
              salePrice:    { $max: "$salePrice" },
              soonestExpiry:{ $min: "$expiryDate" },
            } },
          ],
          as: "stockAgg",
        } },
      { $addFields: {
          currentStock: { $ifNull: [{ $arrayElemAt: ["$stockAgg.currentStock", 0] }, 0] },
          mrp:          { $ifNull: [{ $arrayElemAt: ["$stockAgg.mrp", 0] },          "$defaultSalePrice"] },
          salePrice:    { $ifNull: [{ $arrayElemAt: ["$stockAgg.salePrice", 0] },    "$defaultSalePrice"] },
          soonestExpiry:{ $arrayElemAt: ["$stockAgg.soonestExpiry", 0] },
          packSize:     "$pack",
        } },
      { $project: { stockAgg: 0 } },
      // Rank in-stock items first, then alphabetical — so the doctor
      // sees dispensable SKUs at the top of the dropdown without
      // hiding out-of-stock entries (which they can still prescribe).
      { $addFields: { _inStock: { $cond: [{ $gt: ["$currentStock", 0] }, 0, 1] } } },
      { $sort: { _inStock: 1, name: 1 } },
      { $project: { _inStock: 0 } },
      { $limit: 50 },
    ]);

    res.json({ success: true, data: drugs });
  } catch (e) { sendErr(res, e); }
};

// R7bh-F4 / R7bg-10-HIGH-1: explicit field allow-list (drop `...req.body`
// spread). Pre-R7bh a client could POST { _id: "...", isActive: true,
// __v: 5, createdBy: "Admin" } and have those fields land on the new doc.
const DRUG_ALLOWED_FIELDS = [
  "name","genericName","brandName","manufacturer","form","strength","pack",
  "category","schedule","hsnCode","gstRate","reorderLevel","defaultSalePrice",
  "isHighAlert","isLASA","isNarcotic","requiresRefrigeration","isActive",
];
function _pickDrug(body = {}) {
  const out = {};
  for (const k of DRUG_ALLOWED_FIELDS) if (body[k] !== undefined) out[k] = body[k];
  return out;
}

exports.createDrug = async (req, res) => {
  try {
    const drug = await Drug.create({
      ..._pickDrug(req.body || {}),
      createdBy: req.user?.fullName || "System",
    });
    res.status(201).json({ success: true, data: drug });
  } catch (e) { sendErr(res, e); }
};

exports.updateDrug = async (req, res) => {
  try {
    if (!isOid(req.params.id)) return res.status(400).json({ success: false, message: "Invalid drug id", code: "VALIDATION" });
    const drug = await Drug.findByIdAndUpdate(
      req.params.id,
      { $set: { ..._pickDrug(req.body || {}), updatedBy: req.user?.fullName || "System" } },
      { new: true, runValidators: true }
    );
    if (!drug) return res.status(404).json({ success: false, message: "Drug not found", code: "NOT_FOUND" });
    res.json({ success: true, data: drug });
  } catch (e) { sendErr(res, e); }
};

exports.deleteDrug = async (req, res) => {
  try {
    if (!isOid(req.params.id)) return res.status(400).json({ success: false, message: "Invalid drug id" });
    const drug = await Drug.findByIdAndUpdate(req.params.id, { $set: { isActive: false } }, { new: true });
    if (!drug) return res.status(404).json({ success: false, message: "Drug not found" });
    // R7hr-12-S2 (D3-07): cascade DrugBatch.isActive=false so existing
    // batches stop dispensing. Pre-fix the indent path
    // (indentService._fefoPickAndDecrement) only filters batches by
    // batch.isActive — it never re-reads Drug.isActive — so an
    // already-released-but-not-yet-administered indent could keep
    // dispensing a recalled / formulary-removed drug indefinitely.
    // The counter dispense path's L447 Drug.isActive check is also
    // TOCTOU-vulnerable against an admin deactivating mid-flight.
    // Cascade keeps both paths gated by a single is-Active source.
    let batchCount = 0;
    try {
      const result = await DrugBatch.updateMany(
        { drugId: drug._id, isActive: true },
        { $set: { isActive: false } },
      );
      batchCount = result?.modifiedCount || result?.nModified || 0;
    } catch (cascadeErr) {
      // Don't fail the deactivation — log so the operator knows to
      // hand-flip batches if the cascade was incomplete. The Drug master
      // flip is the higher-priority safety gate (new indents will fail
      // listDrugs at L115's isActive filter), so log + continue.
      console.error("[Pharmacy] deleteDrug: batch cascade failed for drug",
        String(drug._id), ":", cascadeErr.message);
    }
    // R7hr-12-S2 (D3-07): emit a ClinicalAudit row so the audit register
    // has a single anchor for recall events — the pharmacist later sees
    // "Drug X deactivated by admin Y at time Z, cascaded N batches".
    try {
      emitClinicalAudit({
        req,
        event: "PHARMACY_SALE_CANCELLED", // reused as closest enum bucket
        UHID: "",
        targetType: "Drug",
        targetId: drug._id,
        reason: `DRUG_DEACTIVATED: ${drug.name || ""} — cascaded ${batchCount} batch(es) to isActive=false`,
        before: { isActive: true },
        after: { isActive: false, drugName: drug.name, schedule: drug.schedule, cascadedBatches: batchCount },
      });
    } catch (_) { /* silent — audit emit is non-blocking */ }
    res.json({ success: true, data: drug, meta: { cascadedBatches: batchCount } });
  } catch (e) { sendErr(res, e); }
};

/* ════════════════════════════════════════════════════════════════
   SUPPLIERS
══════════════════════════════════════════════════════════════════ */
exports.listSuppliers = async (req, res) => {
  try {
    // Defensive cap (audit C-05). 1000 suppliers is generous for any
    // single hospital; the dropdown UI tops out well below that.
    const items = await Supplier.find({ isActive: true }).sort({ name: 1 }).limit(1000).lean();
    res.json({ success: true, data: items });
  } catch (e) { sendErr(res, e); }
};
// R7bh-F4 / R7bg-10-HIGH-1: explicit allow-list for Supplier writes.
const SUPPLIER_ALLOWED_FIELDS = [
  "name","contactPerson","phone","email","address","city","state","pincode",
  "gstin","panNumber","drugLicenseNo","bankAccount","ifscCode","creditDays","isActive",
];
function _pickSupplier(body = {}) {
  const out = {};
  for (const k of SUPPLIER_ALLOWED_FIELDS) if (body[k] !== undefined) out[k] = body[k];
  return out;
}
exports.createSupplier = async (req, res) => {
  try {
    const s = await Supplier.create({
      ..._pickSupplier(req.body || {}),
      createdBy: req.user?.fullName || "System",
    });
    res.status(201).json({ success: true, data: s });
  } catch (e) { sendErr(res, e); }
};
exports.updateSupplier = async (req, res) => {
  try {
    if (!isOid(req.params.id)) return res.status(400).json({ success: false, message: "Invalid supplier id", code: "VALIDATION" });
    const s = await Supplier.findByIdAndUpdate(req.params.id,
      { $set: { ..._pickSupplier(req.body || {}), updatedBy: req.user?.fullName || "System" } },
      { new: true, runValidators: true });
    if (!s) return res.status(404).json({ success: false, message: "Supplier not found", code: "NOT_FOUND" });
    res.json({ success: true, data: s });
  } catch (e) { sendErr(res, e); }
};
exports.deleteSupplier = async (req, res) => {
  try {
    if (!isOid(req.params.id)) return res.status(400).json({ success: false, message: "Invalid supplier id" });
    const s = await Supplier.findByIdAndUpdate(req.params.id, { $set: { isActive: false } }, { new: true });
    if (!s) return res.status(404).json({ success: false, message: "Supplier not found" });
    res.json({ success: true, data: s });
  } catch (e) { sendErr(res, e); }
};

/* ════════════════════════════════════════════════════════════════
   GRN — Goods Receipt → create batch
══════════════════════════════════════════════════════════════════ */
exports.recordGRN = async (req, res) => {
  try {
    const { drugId, batchNo, expiryDate, mfgDate,
            quantityIn, purchaseRate, mrp, salePrice,
            supplierId, supplierName, invoiceNo, invoiceDate, location } = req.body;

    if (!drugId || !batchNo || !expiryDate || !quantityIn) {
      return res.status(400).json({ success: false, message: "drugId, batchNo, expiryDate, quantityIn required" });
    }
    if (!isOid(drugId)) {
      return res.status(400).json({ success: false, message: "Invalid drug id" });
    }
    const qty = Number(quantityIn);
    if (!Number.isFinite(qty) || qty <= 0) {
      return res.status(400).json({ success: false, message: "quantityIn must be a positive number" });
    }
    const exp = new Date(expiryDate);
    if (isNaN(exp.getTime())) {
      return res.status(400).json({ success: false, message: "expiryDate is not a valid date" });
    }
    if (exp.getTime() <= Date.now()) {
      return res.status(400).json({ success: false, message: "expiryDate is already in the past — refusing to add expired stock" });
    }
    if (supplierId && !isOid(supplierId)) {
      return res.status(400).json({ success: false, message: "Invalid supplier id" });
    }
    const drug = await Drug.findById(drugId).lean();
    if (!drug) return res.status(404).json({ success: false, message: "Drug not found" });

    // R7hr-12-S2 (D8-06): supplier license / GST sanity check. Soft
    // warning surfaced via remarks — many legacy supplier rows have empty
    // gstin/drugLicenseNo defaults (SupplierModel L18-L20), so a hard
    // reject would block routine GRNs. The remarks string lands on the
    // BillingAudit emit below so the auditor sees the mismatch trail.
    // Validation runs only when supplierId is provided AND the supplier
    // doc carries non-empty fields to compare against.
    let supplierWarning = "";
    if (supplierId) {
      try {
        const sup = await Supplier.findById(supplierId).select("gstin drugLicenseNo name").lean();
        if (sup) {
          const reqGstin = String(req.body.invoiceGstin || req.body.supplierGstin || "").trim().toUpperCase();
          const supGstin = String(sup.gstin || "").trim().toUpperCase();
          if (reqGstin && supGstin && reqGstin !== supGstin) {
            supplierWarning += `GSTIN mismatch (master=${supGstin}, invoice=${reqGstin}); `;
          }
          const reqLic = String(req.body.supplierDrugLicenseNo || "").trim();
          const supLic = String(sup.drugLicenseNo || "").trim();
          if (reqLic && supLic && reqLic !== supLic) {
            supplierWarning += `Drug-License mismatch (master=${supLic}, invoice=${reqLic}); `;
          }
        }
      } catch (_) { /* best-effort */ }
    }

    // Issue a GRN number — monotonic via Counter so the D&C "sequential
    // purchase register" assumption holds and audits can detect a gap.
    // R7hr-12-S2 (D8-06): pre-fix used Math.random() suffix on a per-day
    // string, breaking the sequential-register expectation and exposing
    // a collision surface (1-in-9000 per day, low but non-zero). Switch
    // to nextSeq("pharmacyGRN") matching the existing pharmacyBill /
    // pharmacyCreditCollection / pharmacySupplement convention.
    const grnSeq = await nextSeq("pharmacyGRN");
    const yy = String(new Date().getFullYear()).slice(-2);
    const grnNumber = `GRN-${yy}-${String(grnSeq).padStart(6, "0")}`;

    const batch = await DrugBatch.create({
      drugId, drugName: drug.name,
      batchNo: batchNo.trim(), expiryDate: exp,
      mfgDate: mfgDate ? new Date(mfgDate) : null,
      quantityIn: qty,
      remaining:  qty,
      purchaseRate: Number(purchaseRate || 0),
      mrp:          Number(mrp || 0),
      salePrice:    Number(salePrice || drug.defaultSalePrice || mrp || 0),
      supplierId: supplierId || null,
      supplierName: supplierName || "",
      grnNumber,
      invoiceNo: invoiceNo || "",
      invoiceDate: invoiceDate ? new Date(invoiceDate) : null,
      location: location || "Main Pharmacy",
      createdBy: req.user?.fullName || "System",
    });

    // R7hr-12-S2 (D8-06): BillingAudit emit so the procurement chain has
    // a chronological audit row (D&C Rule §65 + GST Act §35 + NABH AAC.1).
    // Pre-fix recordGRN was the only mutating pharmacy procurement op
    // without an audit row — every other lifecycle op in this controller
    // (dispense, return, cancel, vendor-return, addItems, collectCredit)
    // emits one. Best-effort try/catch matches the vendor-return pattern
    // so an audit blip can't roll back the batch creation.
    try {
      const { emit } = require("../../models/Billing/BillingAudit");
      await emit({
        event:     "ITEM_ADDED", // closest enum bucket for purchase-side row addition
        actorId:   req.user?._id || req.user?.id || null,
        actorName: req.user?.fullName || "System",
        actorRole: req.user?.role || "",
        amount:    qty * Number(purchaseRate || 0),
        reason:    `GRN: ${drug.name || ""} batch ${batch.batchNo} qty=${qty} supplier=${supplierName || "—"} invoice=${invoiceNo || "—"}${supplierWarning ? " · WARN: " + supplierWarning : ""}`,
        after:     {
          batchId:    batch._id,
          grnNumber,
          supplierId: supplierId || null,
          invoiceNo:  invoiceNo || "",
          qty,
          purchaseRate: Number(purchaseRate || 0),
          supplierWarning: supplierWarning || null,
        },
      }, { req });
    } catch (_) { /* best-effort */ }

    // R7bh-F4 / R7bg-10-CRIT-2: bump the Schedule-X running balance on
    // receipt so the CAS in scheduleXRegister.recordDispense has stock
    // to deduct against.
    // R7hr-12-S2 (D3-06): no longer best-effort. Pre-fix a transient
    // recordReceipt failure left DrugBatch.remaining recording real
    // stock while ScheduleXBalance.balance stayed at 0 — the next
    // dispense's atomic CAS (scheduleXRegister.js:115-135) rejected
    // with INSUFFICIENT_REGISTER_BALANCE even though Morphine/Pethidine
    // was physically on the shelf. Pharmacist had no UI path to repair
    // the divergence (no admin endpoint bumps balance directly), forcing
    // hand-editing of Mongo to dispense a controlled substance during
    // an NDPS-regulated emergency. Now: if receipt fails, roll back the
    // DrugBatch.create above and 500 the GRN so the operator retries
    // with a clear error — guarantees DrugBatch.remaining and
    // ScheduleXBalance.balance never diverge.
    if (drug.schedule === "X") {
      try {
        await scheduleXRegister.recordReceipt({
          drugId,
          qty,
          receivedBy:   req.user?.fullName || "System",
          receivedById: req.user?._id || null,
        });
      } catch (sxErr) {
        console.error("[Pharmacy] GRN: Schedule-X balance bump failed for drug",
          String(drugId), "qty", qty, ":", sxErr.message);
        // R7hr-12-S2 (D3-06): roll back the just-created batch so the
        // two stores stay aligned. Best-effort delete — if this also
        // fails, the operator gets both errors via console for manual
        // reconciliation, but the original 500 surfaces in the response.
        try {
          await DrugBatch.findByIdAndDelete(batch._id);
        } catch (rbErr) {
          console.error("[Pharmacy] GRN: Schedule-X rollback failed for batch",
            String(batch._id), ":", rbErr.message);
        }
        return res.status(500).json({
          success: false,
          code: "SCHEDULE_X_RECEIPT_FAILED",
          message: `GRN aborted — Schedule-X register failed to record receipt: ${sxErr.message}. Retry once the register is available; do NOT dispense until the GRN is re-recorded successfully.`,
        });
      }
    }

    // R7hr-12-S2 (D8-06): surface supplierWarning in response so the
    // pharmacist sees the mismatch on the UI confirmation (the warning
    // is also persisted in the BillingAudit row above).
    res.status(201).json({
      success: true,
      data: batch,
      grnNumber,
      ...(supplierWarning ? { warning: supplierWarning } : {}),
    });
  } catch (e) {
    if (e.code === 11000) return res.status(409).json({ success: false, message: "This batch already exists for this drug" });
    sendErr(res, e);
  }
};

exports.listBatches = async (req, res) => {
  try {
    const { drugId, expiringIn, lowStock, location } = req.query;
    const where = { isActive: true };
    if (drugId)  where.drugId = drugId;
    if (location) where.location = location;
    if (expiringIn) {
      // IST-aware horizon (re-audit F-04-1) — the "expiring within N days"
      // filter must count days from the IST midnight the pharmacist sees,
      // not from the server's UTC instant.
      const { istStartOfDayPlus } = require("../../utils/queryGuards");
      const days = Number(expiringIn);
      where.expiryDate = { $lte: istStartOfDayPlus(days) };
    }
    if (lowStock === "true") where.remaining = { $lt: 5 };
    const batches = await DrugBatch.find(where).sort({ expiryDate: 1 }).populate("drugId", "name reorderLevel").lean();
    res.json({ success: true, data: batches });
  } catch (e) { sendErr(res, e); }
};

// Live stock rollup per drug — sum(remaining) across active batches.
exports.stockRollup = async (req, res) => {
  try {
    const rollup = await DrugBatch.aggregate([
      { $match: { isActive: true, remaining: { $gt: 0 } } },
      { $group: {
        _id: "$drugId",
        drugName: { $first: "$drugName" },
        totalRemaining: { $sum: "$remaining" },
        batchCount: { $sum: 1 },
        nearestExpiry: { $min: "$expiryDate" },
        latestSale: { $max: "$salePrice" },
      } },
      { $lookup: { from: "pharmacydrugs", localField: "_id", foreignField: "_id", as: "drug" } },
      { $unwind: { path: "$drug", preserveNullAndEmptyArrays: true } },
      { $project: {
        drugId: "$_id",
        drugName: { $ifNull: ["$drug.name", "$drugName"] },
        category: "$drug.category",
        reorderLevel: { $ifNull: ["$drug.reorderLevel", 10] },
        totalRemaining: 1, batchCount: 1, nearestExpiry: 1, latestSale: 1,
      } },
      { $sort: { drugName: 1 } },
    ]);
    res.json({ success: true, data: rollup });
  } catch (e) { sendErr(res, e); }
};

/* ════════════════════════════════════════════════════════════════
   DISPENSE — FIFO consume by expiry, race-safe via atomic updates
══════════════════════════════════════════════════════════════════ */
// Walks batches by expiry asc and reserves `qty` units atomically. Uses
// findOneAndUpdate with a `remaining: { $gte: take }` predicate so two
// concurrent dispenses can't both claim the same units — one wins, the
// other gets null and we re-read the live remaining and retry.
// Also rejects soft-deleted drugs and already-expired batches.
async function fifoConsume(drugId, qty) {
  // Drug.isActive gate — block dispense if the master record was disabled
  const drug = await Drug.findById(drugId).lean();
  if (!drug || !drug.isActive) throw new Error("Drug is deactivated — cannot dispense");

  const used = [];
  let need = qty;
  const triedBatchIds = new Set();
  // Hard cap on retries so a runaway concurrency situation can't loop forever
  const MAX_PASSES = 32;

  for (let pass = 0; pass < MAX_PASSES && need > 0; pass++) {
    // Re-query each pass so we always see live `remaining` after races.
    // Exclude already-tried-and-empty batches.
    // IST-aware "start of today" anchor (business audit F-04). Helper
    // hoisted to utils/queryGuards so listBatches + alerts (re-audit
    // F-04-1 / F-04-2) reuse the same boundary logic.
    const { istStartOfToday } = require("../../utils/queryGuards");
    const where = {
      drugId, isActive: true, remaining: { $gt: 0 },
      // Block expired batches at dispense time (D&C compliance) —
      // the GRN endpoint already refuses expiry < today on receipt,
      // but a previously-receivable batch may have expired since.
      expiryDate: { $gte: istStartOfToday() },
    };
    if (triedBatchIds.size > 0) where._id = { $nin: [...triedBatchIds] };

    const batches = await DrugBatch.find(where).sort({ expiryDate: 1 }).limit(8).lean();
    if (batches.length === 0) break;

    let madeProgress = false;
    for (const b of batches) {
      if (need <= 0) break;
      const take = Math.min(b.remaining, need);
      // Atomic conditional update — wins iff remaining still ≥ take
      const updated = await DrugBatch.findOneAndUpdate(
        { _id: b._id, isActive: true, remaining: { $gte: take } },
        { $inc: { quantityOut: take, remaining: -take } },
        { new: true },
      );
      if (!updated) {
        // Lost the race — mark this batch as "tried in this pass" so
        // we don't pick it again; next pass will see the new remaining.
        triedBatchIds.add(String(b._id));
        continue;
      }
      used.push({ batch: updated, used: take });
      need -= take;
      madeProgress = true;
    }
    if (!madeProgress) break;
  }

  if (need > 0) {
    // Roll back what we already reserved — this whole dispense is rejected.
    for (const u of used) {
      await DrugBatch.findByIdAndUpdate(u.batch._id,
        { $inc: { quantityOut: -u.used, remaining: u.used } });
    }
    throw new Error(`Insufficient stock — short by ${need} unit(s)`);
  }
  return used;
}

exports.dispense = async (req, res) => {
  try {
    const {
      patientUHID, patientName, contactNumber, age, gender, doctorName,
      saleType = "Walk-in", admissionId, admissionNumber, prescriptionRef,
      items, amountPaid, discountPercent = 0, remarks,
      // R7ct — GST Act §31 + GSTR-1 fields. placeOfSupply (state code)
      // drives intra-state vs inter-state split (CGST+SGST vs IGST).
      // customerGstin enables B2B / corporate panel ITC claim on
      // GSTR-1 schema. Both optional — when blank, intra-state default
      // (CGST+SGST = gst/2 each) applies and B2C bucket is used.
      placeOfSupply, customerGstin,
      // R7hp-2: structured payment metadata (Card last-4, UPI txn ref,
      // Mix splits). Whitelisted here so the service layer can persist
      // it on the Sale doc without a downstream schema change.
      paymentDetails,
      // R7hp-1: pharmacist counter identity for the bill footer.
      counter,
      // R7hr-12-S2 (D8-07): top-level prescriber registration number
      // (MCI / state-council reg) for Sch H/H1/X register completeness.
      // Either passed explicitly by the client, or auto-populated from
      // the Doctor master when the prescriber resolves by name during the
      // pre-flight loop below.
      prescriberRegistrationNo,
    } = req.body;

    // R7bh-F4 / R7bg-3-HIGH-1: normalise paymentMode at the controller boundary
    // so the model enum (still Title-case) accepts any case-permutation.
    const paymentMode = _normPaymentMode(req.body.paymentMode, "Cash");

    // ── Sale-type / patient identity sanity checks ────────────────────
    // saleType drives the legal billing flow (walk-in is anonymous OTC,
    // OPD/IPD/Homecare are patient-linked). Catch mismatches at the door
    // so we never end up with an IPD bill that has no admission, or a
    // walk-in bill that's silently linked to a stale admission id.
    const ST = ["OPD", "IPD", "Walk-in", "Homecare"];
    if (!ST.includes(saleType)) {
      return res.status(400).json({ success: false, message: `Invalid saleType "${saleType}"` });
    }

    if (admissionId && !isOid(admissionId)) {
      return res.status(400).json({ success: false, message: "Invalid admissionId" });
    }

    // Walk-in must NOT carry an admission reference — Counter UI sometimes
    // leaves the field set when the user switches sale-type. We strip it
    // here rather than reject, so the cashier doesn't have to re-enter.
    let _admissionId     = admissionId || null;
    let _admissionNumber = admissionNumber || "";
    if (saleType === "Walk-in") {
      _admissionId = null;
      _admissionNumber = "";
    }

    // IPD must have an admission link — that's the whole point of an
    // IPD bill (charge attaches to the admission ledger).
    if (saleType === "IPD" && !_admissionId) {
      return res.status(400).json({
        success: false,
        message: "IPD sale requires an admissionId — please select an active admission",
      });
    }

    // OPD/Homecare/IPD without UHID — at minimum we need to know WHO,
    // otherwise the prescription can't be audited later. Walk-in is the
    // only flow allowed to be anonymous.
    if (saleType !== "Walk-in" && !String(patientUHID || "").trim()) {
      return res.status(400).json({
        success: false,
        message: `${saleType} sale requires a patient UHID`,
      });
    }

    // R7hr-12-S2 (D2-10): block Walk-in + Credit / Advance — pharmacy has
    // no audit anchor to chase a credit/advance balance against an
    // anonymous customer. The IPD-credit ledger surfaces only saleType in
    // {IPD, Homecare} (listIpdCreditAdmissions L1097), so a Walk-in
    // credit/advance sale becomes a silent receivable the system can't
    // list. Advance against an anonymous customer is also structurally
    // impossible — applyAdvanceToSale resolves the pool by UHID.
    if (saleType === "Walk-in" && !String(patientUHID || "").trim()) {
      if (paymentMode === "Credit" || paymentMode === "Advance") {
        return res.status(400).json({
          success: false,
          code: "WALKIN_NEEDS_UHID",
          message: `Walk-in sale with ${paymentMode} payment requires a patient UHID — credit / advance modes need a chase-able audit anchor`,
        });
      }
    }

    if (!items || !items.length) {
      return res.status(400).json({ success: false, message: "items[] is required" });
    }

    // Per-item validation BEFORE we touch any state.
    for (const it of items) {
      if (!it.drugId || !isOid(it.drugId)) {
        return res.status(400).json({ success: false, message: `Invalid drugId on item "${it.drugName || ""}"`, code: "VALIDATION" });
      }
      const q = Number(it.quantity);
      if (!Number.isFinite(q) || q <= 0) {
        return res.status(400).json({ success: false, message: `Invalid quantity for "${it.drugName || it.drugId}" — must be > 0`, code: "VALIDATION" });
      }
    }

    // R7bh-F4 / R7bg-8-CRIT-P2: Schedule H / H1 / X drugs cannot be
    // dispensed without a prescription reference + prescriber name. The
    // master Drug schedule is the authority — we look up each drugId
    // once and reject the whole sale (atomic) on the first violation.
    // Schedule X gets the additional NDPS witness flow downstream
    // via scheduleXRegister.recordDispense.
    const drugMetaMap = new Map(); // drugId → { schedule, name, hsnCode }
    for (const it of items) {
      const key = String(it.drugId);
      if (drugMetaMap.has(key)) continue;
      // R7ct — pull hsnCode too so the sale item snapshots the HSN that
      // was in force at billing time (preserves historical GSTR-1 even
      // if the drug master HSN is later reclassified by CBIC).
      const d = await Drug.findById(it.drugId).select("schedule name hsnCode").lean();
      if (d) drugMetaMap.set(key, d);
    }

    // R7hr-12-S2 (D8-07): pre-resolve a top-level prescriber registration
    // number for the sale. Priority: explicit req.body.prescriberRegistrationNo
    // → Doctor master lookup by doctorName. The Doctor master fallback only
    // fires when there's a non-empty doctorName AND no explicit reg supplied;
    // a single keyed query per dispense so the cost is bounded. When the
    // lookup misses, we fall through and let the H/H1/X validator below raise
    // RX_REG_REQUIRED — never silently dispense a Sch H/H1/X drug without
    // the registration column populated, since the statutory register column
    // cannot be patched in post-hoc.
    let resolvedPrescriberReg = String(prescriberRegistrationNo || "").trim();
    if (!resolvedPrescriberReg) {
      const candidateName = String(doctorName || "").trim();
      if (candidateName) {
        try {
          // Match by personalInfo.fullName (auto-generated on Doctor save)
          // using a case-insensitive exact match; legacy rows without the
          // pre-save hook may need this query extended later.
          const escaped = candidateName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const docRow = await Doctor.findOne({
            "personalInfo.fullName": new RegExp("^" + escaped + "$", "i"),
          }).select("professional.registrationNumber personalInfo.fullName").lean();
          if (docRow?.professional?.registrationNumber) {
            resolvedPrescriberReg = String(docRow.professional.registrationNumber).trim();
          }
        } catch (_) { /* Doctor lookup failures must not block dispense */ }
      }
    }

    for (const it of items) {
      const meta = drugMetaMap.get(String(it.drugId));
      if (!meta) continue;
      const sched = String(meta.schedule || "");
      if (["H","H1","X"].includes(sched)) {
        if (!String(it.prescriptionRef || prescriptionRef || "").trim() ||
            !String(it.prescriberName || doctorName || "").trim()) {
          return res.status(400).json({
            success: false,
            code: "RX_REF_REQUIRED",
            message: `Drug "${meta.name}" is Schedule ${sched} — prescriptionRef + prescriberName are required on the item or sale`,
          });
        }
        // R7hr-12-S2 (D8-07): D&C Form 2 / Schedule H1 register mandates the
        // prescriber's MCI/state-council registration number. Accept from
        // the item, then the top-level body, then the Doctor master fallback
        // resolved above; reject if all three are empty so the auditor never
        // sees a Schedule H/H1/X dispense with a blank Reg-No column.
        const itemReg = String(it.prescriberRegistrationNo || "").trim();
        if (!itemReg && !resolvedPrescriberReg) {
          return res.status(400).json({
            success: false,
            code: "RX_REG_REQUIRED",
            message: `Drug "${meta.name}" is Schedule ${sched} — prescriberRegistrationNo is required on the item or sale (D&C Form 2). If the prescriber is in the Doctor master, ensure their professional.registrationNumber is set.`,
          });
        }
      }
    }

    // R7az-CRIT-1 (D7-CRIT-1): drug-allergy gate at the counter.
    // Walk-in sales are anonymous (no patient record); for every other
    // sale-type we look the patient up by UHID, hydrate the unified
    // `allergies` virtual (which merges legacy knownAllergies + the new
    // typed allergyList[]), and run the substring-match gate from
    // utils/allergyCheck. Per-line `_allergyOverrideReason` allows a
    // senior pharmacist to dispense against a known allergy with a
    // documented clinical reason (mirrors the Rx-side hook).
    if (saleType !== "Walk-in" && String(patientUHID || "").trim()) {
      try {
        const pat = await Patient.findOne({ UHID: String(patientUHID).trim() })
          .select("knownAllergies allergyList")
          .lean({ virtuals: true });
        if (pat) {
          const allergyPool = pat.allergies || pat.allergyList || pat.knownAllergies || [];
          for (const it of items) {
            assertDrugSafeOrOverride(
              { drugName: it.drugName, genericName: it.genericName, brandName: it.brandName },
              allergyPool,
              { overrideReason: it._allergyOverrideReason, label: "counter-dispense" },
            );
          }
        }
      } catch (allergyErr) {
        if (allergyErr.code === "ALLERGY_COLLISION") {
          return res.status(409).json({
            success: false,
            message: allergyErr.message,
            allergen: allergyErr.allergen,
            drugName: allergyErr.drugName,
          });
        }
        // Non-allergy errors fall through to the outer catch.
        throw allergyErr;
      }
    }

    // Bill number — Counter._id is the scope key, NOT a `name` field.
    // R7hq: simplified from PHM-YYYYMMDD-NNNN (e.g. PHM-20260604-0002)
    // to PHM-YY-NNNN (e.g. PHM-26-0002), matching the IPD-YY-NN style.
    // The seq counter stays continuous (so the audit trail still has a
    // monotonic per-pharmacy sequence number for GST §31 compliance);
    // only the human-facing prefix shrinks.
    const seq = await nextSeq("pharmacyBill");
    const yy = String(new Date().getFullYear()).slice(-2);
    const billNumber = `PHM-${yy}-${String(seq).padStart(4, "0")}`;

    // Stock pre-flight DELETED (business audit F-03). The previous
    // aggregation `$sum` + check happened OUTSIDE the atomic
    // findOneAndUpdate in fifoConsume, so two concurrent dispenses both
    // reading "have 5, need 5" would both pass pre-flight and the second
    // would only fail at fifoConsume — after the cashier had already
    // started ringing it up. We now trust fifoConsume's atomic predicate
    // (`remaining: { $gte: take }`) and add cross-item rollback so a
    // mid-loop shortage on item B unrolls item A's already-reserved
    // stock — the sale is all-or-nothing.
    // R7ct — Determine intra/inter-state for CGST/SGST vs IGST split.
    // Pharmacy's own state comes from PharmacySettings.state (the singleton
    // identity record); placeOfSupply on the request is the customer's
    // state. When both are present and DIFFERENT → inter-state (IGST);
    // otherwise intra-state default (CGST + SGST). Blank state on
    // either side falls back to intra-state — safer default for the B2C
    // walk-in case where state isn't captured.
    // R7hr-12-S2 (D8-03): drug-license expiry gate. NABH AAC.1 + Drugs &
    // Cosmetics Act §18-A require a current statutory license to dispense.
    // Pre-fix, drugLicenseExp was captured for invoice-header printing but
    // NEVER enforced — pharmacy could dispense for years on an expired
    // license without any system flag. We now load drugLicenseExp at the
    // same time as state (single Settings read, no extra round trip) and
    // reject the sale with code=LICENSE_EXPIRED unless the singleton's
    // drugLicenseExpiryOverride flag is on AND a documented reason is
    // present. Emergency override is itself audited downstream.
    let pharmacyState = "";
    let licenseExp = null;
    let licenseOverride = false;
    let licenseOverrideReason = "";
    try {
      const setRow = await Settings.findOne({})
        .select("state drugLicenseExp drugLicenseExpiryOverride drugLicenseExpiryOverrideReason")
        .lean();
      pharmacyState         = String(setRow?.state || "").trim().toUpperCase();
      licenseExp            = setRow?.drugLicenseExp || null;
      licenseOverride       = !!setRow?.drugLicenseExpiryOverride;
      licenseOverrideReason = String(setRow?.drugLicenseExpiryOverrideReason || "").trim();
    } catch (_) { /* settings missing — falls back to intra-state + no license enforcement */ }

    // Reject when drugLicenseExp is set AND past today (IST), unless the
    // explicit override is on with a documented reason. The override
    // requires BOTH the flag and a non-empty reason — silently setting
    // only the flag still triggers a 403.
    if (licenseExp instanceof Date && !Number.isNaN(licenseExp.getTime())) {
      const { istStartOfToday } = require("../../utils/queryGuards");
      const today = istStartOfToday();
      if (licenseExp < today) {
        if (!licenseOverride || !licenseOverrideReason) {
          return res.status(403).json({
            success: false,
            code: "LICENSE_EXPIRED",
            message: `Pharmacy drug license expired on ${licenseExp.toISOString().slice(0, 10)}. ` +
                     `Renew the license OR set the documented emergency override in /pharmacy/settings before dispensing.`,
          });
        }
        // Override path — emit a WARN-level BillingAudit row so every
        // expired-license sale is reconstructible later (NABH AAC.7).
        try {
          const BillingAudit = require("../../models/Billing/BillingAudit");
          if (BillingAudit && typeof BillingAudit.emitBillingAudit === "function") {
            await BillingAudit.emitBillingAudit({
              event:     "MASTER_DRUG_PRICE_CHANGED", // closest enum slot until LICENSE_OVERRIDE lands
              actorName: req?.user?.fullName || "System",
              actorId:   req?.user?._id,
              actorRole: req?.user?.role,
              reason:    `LICENSE_EXPIRED override used. Reason: ${licenseOverrideReason}`,
              after: {
                drugLicenseExp:        licenseExp,
                override:              true,
                overrideReason:        licenseOverrideReason,
                expiredByDays:         Math.floor((today.getTime() - licenseExp.getTime()) / 86400000),
                saleType,
                patientUHID:           String(patientUHID || ""),
              },
            }, { req });
          }
        } catch (_) { /* audit failure must not block emergency dispense */ }
      }
    }

    const customerState = String(placeOfSupply || "").trim().toUpperCase();
    const interState = !!(pharmacyState && customerState && pharmacyState !== customerState);

    const saleItems = [];
    const scheduleXItems = []; // [{drugId, qty, prescriptionRef, prescriberName, drugName}]
    let subTotal = 0, totalGst = 0, totalDisc = 0;
    // R7ct — bill-level GST split rollup, accumulated from per-item splits below.
    let totalCgst = 0, totalSgst = 0, totalIgst = 0;
    const consumedAll = []; // [{ batchId, qty }] across all items, for rollback
    try {
    for (const it of items) {
      const used = await fifoConsume(it.drugId, Number(it.quantity));
      // Track what we reserved so we can undo if a later item fails.
      for (const u of used) consumedAll.push({ batchId: u.batch._id, qty: u.used });
      // Collect Schedule-X dispenses for the post-FIFO register call below.
      const meta = drugMetaMap.get(String(it.drugId));
      if (meta && meta.schedule === "X") {
        for (const u of used) {
          scheduleXItems.push({
            drugId:          it.drugId,
            qty:             u.used,
            prescriptionRef: String(it.prescriptionRef || prescriptionRef || "").trim(),
            prescriberName:  String(it.prescriberName || doctorName || "").trim(),
            // R7hr-12-S2 (D8-07): pass the per-item or sale-level resolved
            // prescriber registration number through to scheduleXRegister
            // so the NDPS register row carries it for inspection.
            prescriberRegistrationNo: String(it.prescriberRegistrationNo || resolvedPrescriberReg || "").trim(),
            drugName:        meta.name,
            batchId:         u.batch._id,
          });
        }
      }
      // If split across batches, write one sale row per batch — keeps audit clean.
      for (const u of used) {
        const qty   = u.used;
        // R7bh-F4 / R7bg-10-CRIT-1: ALWAYS use the batch's salePrice — never
        // accept a client-supplied unitPrice. Pre-R7bh a malicious caller
        // could POST { unitPrice: 0.01 } and walk out with discounted stock.
        const unit  = Number(u.batch.salePrice || 0);
        const gstR  = Number(it.gstRate ?? 12);
        const discR = Number(it.discountPercent ?? discountPercent ?? 0);
        const gross = qty * unit;
        const discAmt = gross * discR / 100;
        const taxable = gross - discAmt;
        const gstAmt  = taxable * gstR / 100;
        const net     = taxable + gstAmt;
        // R7ct — split gstAmt into CGST/SGST (intra-state) or IGST
        // (inter-state) using the bill-level interState flag computed
        // from PharmacySettings.state vs req.body.placeOfSupply. The
        // sum across all three columns always equals gstAmt so legacy
        // GSTR-3B (which reads totalGst) and new GSTR-1 (which reads
        // split columns) agree.
        const cgstAmt = interState ? 0       : gstAmt / 2;
        const sgstAmt = interState ? 0       : gstAmt / 2;
        const igstAmt = interState ? gstAmt  : 0;
        // R7ct — HSN snapshot from drug master (resolved in drugMetaMap
        // pre-loop). Empty string is acceptable for compounded items
        // without an HSN yet — GSTR-1 line 12 will then aggregate
        // them under the unclassified bucket.
        const hsnSnap = String(drugMetaMap.get(String(it.drugId))?.hsnCode || "");

        saleItems.push({
          drugId: it.drugId, drugName: it.drugName,
          batchId: u.batch._id, batchNo: u.batch.batchNo, expiryDate: u.batch.expiryDate,
          quantity: qty, unitPrice: unit, gstRate: gstR, discountPercent: discR,
          hsnCode: hsnSnap,
          grossAmount: gross, discountAmount: discAmt,
          taxableAmount: taxable,
          gstAmount: gstAmt,
          cgstAmount: cgstAmt, sgstAmount: sgstAmt, igstAmount: igstAmt,
          netAmount: net,
          // R7hr-12-S2 (D8-07): per-item prescriber identity snapshot —
          // sale-level prescriberRegistrationNo handles the homogeneous
          // single-doctor script; per-item fields cover multi-doctor sales
          // and survive on the bill doc for register printing.
          prescriberName:           String(it.prescriberName || doctorName || "").trim(),
          prescriberRegistrationNo: String(it.prescriberRegistrationNo || resolvedPrescriberReg || "").trim(),
        });
        subTotal  += gross;
        totalDisc += discAmt;
        totalGst  += gstAmt;
        totalCgst += cgstAmt;
        totalSgst += sgstAmt;
        totalIgst += igstAmt;
      }
    }
    const totalTaxable = subTotal - totalDisc;
    const grandTotalRaw = totalTaxable + totalGst;
    const roundOff = Math.round(grandTotalRaw) - grandTotalRaw;
    const grandTotal = grandTotalRaw + roundOff;
    const paid = Number(amountPaid != null ? amountPaid : grandTotal);

    // R7hr-12-S2 (D2-11): hard-enforce that for paymentMode === "Mixed",
    // the splits[] sum equals amountPaid (±1 paisa epsilon). Pre-fix the
    // service trusted the client (schema note at PharmacySaleModel L141-L146:
    // "The sum must equal amountPaid; the service trusts the client today,
    // hard-enforces in a follow-up"), letting a buggy/malicious client post
    // splits=[Cash 100, Card 50] alongside amountPaid=500 — the day-book
    // byMode rollup would report ₹500 of "Mixed" while only ₹150 of split
    // detail was captured. NABH IMS.2 audit-trail integrity + cashier
    // shift-close reconciliation depend on this invariant. Cross-item
    // rollback hasn't fired yet at this point (stock not committed via
    // Sale.create); validate before consume.
    if (paymentMode === "Mixed") {
      const splits = Array.isArray(paymentDetails?.splits) ? paymentDetails.splits : [];
      const splitsSum = splits
        .filter(sp => sp && ["Cash", "Card", "UPI"].includes(sp.mode))
        .reduce((t, sp) => t + Math.max(0, Number(sp.amount) || 0), 0);
      if (Math.abs(splitsSum - paid) > 0.01) {
        // Roll back any consumed stock before bailing — same shape as the
        // outer cross-item rollback.
        for (const c of consumedAll) {
          try {
            await DrugBatch.findByIdAndUpdate(c.batchId, {
              $inc: { quantityOut: -c.qty, remaining: c.qty },
            });
          } catch (_) { /* best-effort */ }
        }
        return res.status(400).json({
          success: false,
          code: "MIXED_SPLITS_MISMATCH",
          message: `Mixed-mode splits[] sum ₹${splitsSum.toFixed(2)} does not match amountPaid ₹${paid.toFixed(2)} (tolerance 1 paisa)`,
        });
      }
    }

    // Over-payment becomes patient credit (pharmacy owes patient).
    // balanceDue tracks the OPPOSITE direction (patient owes pharmacy).
    // The two are never both non-zero on a single bill.
    const overPaid    = Math.max(0, paid - grandTotal);
    const balanceDue  = Math.max(0, grandTotal - paid);
    const creditLog   = overPaid > 0 ? [{
      amount: round2(overPaid),
      reason: "Over-payment at counter",
      refSlip: billNumber,
      byName: req.user?.fullName || "System",
      byId:   req.user?._id || null,
    }] : [];

    const sale = await Sale.create({
      billNumber,
      patientUHID, patientName, contactNumber, age, gender, doctorName,
      // R7hr-12-S2 (D8-07): persist the resolved prescriber registration
      // number at the sale level so scheduleHRegister + the printable
      // statutory register can surface it as the D&C Form 2 / Schedule H1
      // mandated "registration number of the prescriber" column.
      prescriberRegistrationNo: resolvedPrescriberReg || "",
      saleType, admissionId: _admissionId, admissionNumber: _admissionNumber,
      prescriptionRef: prescriptionRef || "",
      items: saleItems,
      subTotal, totalDiscount: totalDisc, totalTaxable, totalGst,
      roundOff, grandTotal,
      // R7ct — GST Act §31 + GSTR-1 schema fields. placeOfSupply
      // defaults to the pharmacy's own state for B2C walk-ins (no
      // customer state captured = intra-state assumption); explicit
      // value from req.body wins. customerGstin enables B2B ITC claim.
      placeOfSupply: customerState || pharmacyState || null,
      customerGstin: customerGstin ? String(customerGstin).trim().toUpperCase() : null,
      // Bill-level CGST/SGST/IGST rollup mirrors PatientBill schema
      // (R7ap-F18) — sum of per-item splits, kept independent so the
      // GSTR-1 emitter doesn't need to re-derive on every read.
      cgstAmount: totalCgst,
      sgstAmount: totalSgst,
      igstAmount: totalIgst,
      paymentMode, amountPaid: paid,
      balanceDue,
      // R7hp-2: shape-defensive whitelist on the payment metadata so
      // garbage from an old client can't sneak unknown fields onto the
      // sub-doc.
      paymentDetails: paymentDetails && typeof paymentDetails === "object" ? {
        cardLast4:      String(paymentDetails.cardLast4 || "").slice(0, 4),
        cardHolderName: String(paymentDetails.cardHolderName || "").slice(0, 80),
        upiTxnRef:      String(paymentDetails.upiTxnRef || "").slice(0, 64),
        splits: Array.isArray(paymentDetails.splits) ? paymentDetails.splits
          .filter(s => s && ["Cash","Card","UPI"].includes(s.mode))
          .map(s => ({
            mode:   s.mode,
            amount: Math.max(0, Number(s.amount) || 0),
            txnRef: String(s.txnRef || "").slice(0, 64),
          })) : [],
      } : undefined,
      // R7hp-1: counter identity — falls back to actor name when blank.
      counter: String(counter || req.user?.fullName || "").slice(0, 60),
      patientCredit:    round2(overPaid),
      patientCreditLog: creditLog,
      status: "Completed",
      createdBy: req.user?.fullName || "System",
      createdById: req.user?._id || null,
      remarks: remarks || "",
    });

    // R7bh-F4 / R7bg-META-3 / R7bg-CRIT-P1: route Schedule-X dispenses
    // through the dedicated register. The CAS in scheduleXRegister
    // guarantees the running balance stays non-negative. We do this
    // AFTER Sale.create so a failure here only short-circuits the
    // Schedule-X audit emission (which is best-effort logged + the
    // operator can reconcile manually) — the dispensed stock is already
    // consumed via fifoConsume.
    if (scheduleXItems.length > 0) {
      for (const sx of scheduleXItems) {
        try {
          await scheduleXRegister.recordDispense({
            drugId:        sx.drugId,
            batchId:       sx.batchId,
            qty:           sx.qty,
            rx:            sx.prescriptionRef,
            doctorName:    sx.prescriberName,
            // R7hr-12-S2 (D8-07): pass prescriber registration number so the
            // NDPS / Schedule X register can persist it once
            // ScheduleXEntryModel gains the column. The service ignores
            // unknown fields today but the data flow is in place for the
            // follow-up schema migration flagged in needsManualReview.
            doctorRegistrationNo: sx.prescriberRegistrationNo || "",
            uhid:          patientUHID || "",
            // NDPS two-person rule — the dispenser is the cashier; we
            // accept an optional witnessId on the body. If missing, the
            // register service will 400; we surface that as a Schedule-X
            // audit warning since the Sale itself is already durable.
            witnessName:   req.body?.witnessName || "",
            witnessId:     req.body?.witnessId   || null,
            dispensedBy:   req.user?.fullName    || "System",
            dispensedById: req.user?._id         || null,
            remarks:       `Sale ${sale.billNumber} — ${sx.drugName}` +
                           (sx.prescriberRegistrationNo ? ` (Rx Reg: ${sx.prescriberRegistrationNo})` : ""),
          });
        } catch (sxErr) {
          console.error("[Pharmacy] dispense: Schedule-X register failed for drug",
            String(sx.drugId), "sale", sale.billNumber, ":", sxErr.message);
          // Don't fail the sale — log + flag in remarks for audit.
          sale.remarks = (sale.remarks ? sale.remarks + " · " : "") +
            `Schedule-X register pending: ${sx.drugName} qty=${sx.qty} reason=${sxErr.code || sxErr.message}`;
          await sale.save().catch(() => {});
        }
      }
    }

    // B6-T05 — ClinicalAudit emit (NABH AAC.7 + MOM.4). Walk-in sales
    // emit too but with empty UHID/admissionId; HAM flag in metadata
    // surfaces controlled-drug dispenses for the audit register filter.
    try {
      emitClinicalAudit({
        req,
        event: "PHARMACY_DISPENSED",
        UHID: sale.patientUHID || "",
        admissionId: sale.admissionId || null,
        patientName: sale.patientName || "",
        targetType: "PharmacySale",
        targetId: sale._id,
        after: {
          billNumber: sale.billNumber,
          saleType: sale.saleType,
          totalAmount: Number(sale.grandTotal || 0),
          itemCount: (sale.items || []).length,
          paymentMode: sale.paymentMode,
          hamPresent: (sale.items || []).some((i) => i.isHAM === true),
          // R7hr-12-S2 (D8-07): record prescriber identity in the audit
          // trail so the NABH register can answer "who prescribed?" without
          // re-reading the Sale doc. Empty for non-prescription dispenses.
          prescriberName: sale.doctorName || "",
          prescriberRegistrationNo: sale.prescriberRegistrationNo || "",
        },
      });
    } catch (_) { /* silent — audit emit is non-blocking */ }

    // R7bf-H A6-HIGH-2: bust pharmacy revenue trend cache so the chart
    // doesn't lag the dashboard by up to 24h after a bulk sale.
    try {
      require("../Reports/dashboardsController").invalidatePharmacyTrendCache?.();
    } catch (_) { /* best-effort */ }
    res.status(201).json({ success: true, data: sale });
    } catch (consumeErr) {
      // Cross-item rollback (business audit F-03): if any item or the
      // Sale.create itself fails, undo every batch reservation we made
      // so the pharmacy's `remaining` counts stay accurate. Each
      // findByIdAndUpdate is itself atomic; we swallow individual undo
      // errors so a partial-rollback failure doesn't mask the original
      // dispense error.
      for (const c of consumedAll) {
        try {
          await DrugBatch.findByIdAndUpdate(c.batchId, {
            $inc: { quantityOut: -c.qty, remaining: c.qty },
          });
        } catch (rbErr) {
          console.error("[Pharmacy] dispense rollback failed for batch",
            String(c.batchId), ":", rbErr.message);
        }
      }
      const status = /^Insufficient stock/i.test(consumeErr.message || "") ? 409 : 500;
      return res.status(status).json({ success: false, message: consumeErr.message });
    }
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.listSales = async (req, res) => {
  try {
    // R7bh-F4 / R7bg-9-CRIT-3: range guard so callers can't request 5y of history.
    const guard = _assertRange(req);
    if (!guard.ok) return res.status(400).json({ success: false, code: "RANGE_TOO_LARGE", message: guard.message });

    const { from, to, status, saleType, uhid, q } = req.query;
    const where = {};
    if (status)   where.status = status;
    if (saleType) where.saleType = saleType;
    if (uhid)     where.patientUHID = uhid;
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.$gte = new Date(from);
      if (to)   where.createdAt.$lte = new Date(new Date(to).getTime() + 86399_999);
    }
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      where.$or = [{ billNumber: rx }, { patientName: rx }, { patientUHID: rx }];
    }
    // R7hr-12-S2 (D6-03): cross-team PHI/Rx scoping for Doctor and Nurse
    // rx.read holders. PharmacySale has no attendingDoctorId column, so the
    // scope goes through Admission — load admission ids matching
    // req.scopeFilter (attached by restrictToOwnDoctorPatients /
    // restrictToOwnNurseWard middleware on the route) and filter
    // Sale.admissionId by that set. NO-OP for Admin/Pharmacist/Accountant
    // (req.scopeFilter undefined). Failure to resolve the scope returns an
    // empty result (fail-closed) rather than leaking the full PHI feed.
    if (req.scopeFilter && Object.keys(req.scopeFilter).length > 0) {
      try {
        const Admission = require("../../models/Patient/admissionModel");
        const admWhere = {};
        if (req.scopeFilter.attendingDoctorId) {
          admWhere.attendingDoctorId = req.scopeFilter.attendingDoctorId;
        }
        if (req.scopeFilter["bed.ward"]) {
          admWhere.wardName = req.scopeFilter["bed.ward"];
        }
        const scopedAdms = await Admission.find(admWhere).select("_id").lean();
        const allowedIds = scopedAdms.map(a => a._id);
        where.admissionId = { $in: allowedIds };
      } catch (scopeErr) {
        console.error("[Pharmacy] listSales scope filter failed:", scopeErr.message);
        return res.json({ success: true, data: [] });
      }
    }
    const { limit, skip } = _pagination(req, 200, 500);
    const sales = await Sale.find(where).sort({ createdAt: -1 })
      .skip(skip).limit(limit)
      .lean();
    res.json({ success: true, data: sales });
  } catch (e) { sendErr(res, e); }
};

exports.getSale = async (req, res) => {
  try {
    if (!isOid(req.params.id)) return res.status(400).json({ success: false, message: "Invalid sale id" });
    const s = await Sale.findById(req.params.id).lean();
    if (!s) return res.status(404).json({ success: false, message: "Sale not found" });
    res.json({ success: true, data: s });
  } catch (e) { sendErr(res, e); }
};

/* ════════════════════════════════════════════════════════════════
   R7cu — IPD PHARMACY CREDIT LEDGER
   ──────────────────────────────────────────────────────────────
   Pharmacy bills can be booked with balanceDue > 0 — most commonly
   when the IPD ward sends a verbal indent and the patient settles
   later (or family settles at discharge). This block exposes 3
   surfaces + 1 helper:
     1. listIpdCreditAdmissions — pharmacist sees every active IPD
        admission that owes pharmacy money, oldest-due first
     2. getCreditByAdmission     — drill into one admission's credit
        sales (so pharmacist can hand a list to the family)
     3. collectCredit            — record a payment against ONE sale,
        atomically reduces balanceDue, appends collectionLog entry
     4. getOutstandingForAdmission — shared helper used by both the
        list endpoint AND the admission discharge gate (so the
        ground truth "is pharmacy clear?" lives in one place)
   ────────────────────────────────────────────────────────────── */

// Internal helper — exported so admissionController can call it
// during the BillCleared transition. Returns { total, count, sales }
// where sales is the lean array of unpaid PharmacySale docs.
//
// R7db-2 — Also rolls up pharmacy line items written to the IPD
// PatientBill by autoBillingService.onIndentReleased (PHARM-* synthetic
// codes). These items don't have their own PharmacySale row — they're
// embedded in the admission-wide PatientBill.billItems[] and their
// outstanding amount is the bill's balanceAmount * (pharmacy share).
// We use a simple proration: pharmacy_share = sum(PHARM-* netAmount) /
// totalNetAmount, applied to balanceAmount. Receptionist-collected
// payments naturally reduce balanceAmount → pharmacy share shrinks too.
exports.getOutstandingForAdmission = async function (admissionId) {
  if (!admissionId || !isOid(admissionId)) {
    return { total: 0, count: 0, sales: [], bills: [] };
  }
  // ── A. PharmacySale-based credit (counter dispense + IPD homecare) ──
  // R7hr-12 (D4-02): include Partial-Return and Supplemented in the
  // open-status set. Supplemented sales can carry non-zero balanceDue
  // when the add-on was booked Credit; Partial-Return sales can carry
  // non-zero balanceDue when the original credit wasn't fully cleared
  // by the refund. Both were silently passing the discharge gate before
  // because the filter only honoured "Completed". Cancelled is excluded
  // (cancelSale zeroes balanceDue atomically); Refunded is excluded
  // (fully returned ⇒ notional balance only); Hold is excluded (not yet
  // finalized). Same enum-set is already used at L2828 (salesRegister).
  const OPEN_BALANCE_STATUSES = ["Completed", "Partial-Return", "Supplemented"];
  const sales = await Sale.find({
    admissionId,
    status:    { $in: OPEN_BALANCE_STATUSES },
    saleType:  { $in: ["IPD", "Homecare"] },
  }).select("billNumber grandTotal amountPaid balanceDue items createdAt status").lean();
  let total = 0;
  const open = [];
  for (const s of sales) {
    const bal = Number(s.balanceDue?.toString?.() ?? s.balanceDue ?? 0);
    if (bal > 0) {
      total += bal;
      open.push({ ...s, balanceDue: bal });
    }
  }
  // ── B. PatientBill-embedded pharmacy line items (indent releases) ──
  // Find the admission's IPD bill(s) — usually 1 per admission but
  // historical data may have more. PARTIAL/GENERATED carry outstanding;
  // DRAFT means the patient is still being charged and indent items
  // haven't been moved to a final bill yet — we include DRAFT too because
  // ward-released drugs on a DRAFT bill are still real credit that
  // pharmacy needs visibility on.
  const bills = await PatientBill.find({
    admissionId,
    visitType:  "IPD",
    billStatus: { $in: ["DRAFT", "GENERATED", "PARTIAL"] },
  }).select("billNumber billStatus billItems grandTotal netAmount patientPayableAmount balanceAmount payments createdAt").lean();
  const billRows = [];
  for (const b of bills) {
    const bal = Number(b.balanceAmount?.toString?.() ?? b.balanceAmount ?? 0);
    if (bal <= 0) continue;
    // Sum pharmacy items — match by category=PHARMACY OR serviceCode
    // starting with "PHARM-" (handles both ServiceMaster-matched +
    // synthetic line items). Use netAmount (after discount, before tax).
    let pharmNet = 0, allNet = 0;
    const pharmItems = [];
    for (const it of (b.billItems || [])) {
      const net = Number(it.netAmount?.toString?.() ?? it.netAmount ?? 0);
      allNet += net;
      const isPharm = (it.category || "").toUpperCase() === "PHARMACY"
                   || /^PHARM-/i.test(it.serviceCode || "");
      if (isPharm) {
        pharmNet += net;
        pharmItems.push({
          serviceCode: it.serviceCode,
          serviceName: it.serviceName,
          quantity:    Number(it.quantity || 0),
          netAmount:   net,
          chargeDate:  it.chargeDate,
          addedBy:     it.addedBy,
        });
      }
    }
    if (pharmNet <= 0) continue;
    // Pro-rated pharmacy share of the outstanding balance.
    const pharmShare = allNet > 0 ? round2(bal * (pharmNet / allNet)) : 0;
    if (pharmShare <= 0) continue;
    total += pharmShare;
    billRows.push({
      _id:           b._id,
      billNumber:    b.billNumber || "(DRAFT)",
      billStatus:    b.billStatus,
      pharmNet:      round2(pharmNet),
      allNet:        round2(allNet),
      billBalance:   round2(bal),
      pharmBalance:  pharmShare,
      itemCount:     pharmItems.length,
      items:         pharmItems,
      createdAt:     b.createdAt,
    });
  }
  return {
    total: round2(total),
    count: open.length + billRows.length,
    sales: open,
    bills: billRows,
  };
};

// GET /api/pharmacy/credit/ipd-admissions
// One row per active IPD admission with pharmacy outstanding > 0.
//
// R7db-2 — Aggregates TWO sources:
//   (a) PharmacySale.balanceDue   — counter dispense booked as Credit
//   (b) PatientBill.billItems[]   — PHARM-* items added via indent release
//                                   (autoBillingService.onIndentReleased)
// Without (b) the page was blind to ward-dispensed drugs because they
// never become a PharmacySale doc — they're embedded in the admission's
// IPD PatientBill.
exports.listIpdCreditAdmissions = async (req, res) => {
  try {
    const Admission = require("../../models/Patient/admissionModel");
    // R7hr-12-S2 (D6-03): scope filter for Doctor / Nurse rx.read holders.
    // Resolve the allowed admission set up-front; downstream queries on
    // Sale + PatientBill both join on admissionId, so a single $in filter
    // covers both legs. Empty allowed set → empty response (fail-closed).
    let scopedAdmissionIds = null; // null = no scope (Admin/Pharmacist/Accountant)
    if (req.scopeFilter && Object.keys(req.scopeFilter).length > 0) {
      try {
        const admWhere = {};
        if (req.scopeFilter.attendingDoctorId) {
          admWhere.attendingDoctorId = req.scopeFilter.attendingDoctorId;
        }
        if (req.scopeFilter["bed.ward"]) {
          admWhere.wardName = req.scopeFilter["bed.ward"];
        }
        const scopedAdms = await Admission.find(admWhere).select("_id").lean();
        scopedAdmissionIds = scopedAdms.map(a => a._id);
        if (scopedAdmissionIds.length === 0) {
          return res.json({
            success: true,
            data: [],
            summary: { admissions: 0, totalOutstanding: 0 },
          });
        }
      } catch (scopeErr) {
        console.error("[Pharmacy] listIpdCreditAdmissions scope filter failed:", scopeErr.message);
        return res.json({ success: true, data: [], summary: { admissions: 0, totalOutstanding: 0 } });
      }
    }
    // ── A. PharmacySale-based credit ─────────────────────────────
    // Aggregate PharmacySale → group by admissionId where balanceDue > 0.
    // We do the grouping in JS rather than via $group + $lookup because
    // the typical active-IPD set is small (< 200) and the JS path keeps
    // the Decimal128-unwrap logic identical to getOutstandingForAdmission
    // (single source of truth).
    // R7hr-12 (D4-02): mirror the open-balance status set used by
    // getOutstandingForAdmission. If a Supplemented or Partial-Return sale
    // still owes money, the pharmacist must be able to see the admission
    // here and take payment — otherwise the discharge gate blocks with a
    // 409 PHARMACY_OUTSTANDING but the pharmacist has no UI row to collect
    // against (deadlocked discharge).
    // R7hr-12-S2 (D10-02): filter `balanceDue: { $gt: 0 }` at Mongo so we
    // don't hydrate fully-paid IPD sales into memory. Pre-fix the entire
    // PharmacySale history of completed IPD sales was loaded and the
    // balance > 0 check happened in JS — at 50k+ sales/year this became
    // multi-second TTFB on the hot pill-open path. Decimal128 $gt 0 works.
    const saleWhere = {
      saleType:    { $in: ["IPD", "Homecare"] },
      status:      { $in: ["Completed", "Partial-Return", "Supplemented"] },
      admissionId: { $ne: null },
      balanceDue:  { $gt: 0 },
    };
    if (scopedAdmissionIds) saleWhere.admissionId = { $in: scopedAdmissionIds };
    const rawSales = await Sale.find(saleWhere).select("admissionId admissionNumber patientUHID patientName balanceDue grandTotal createdAt billNumber status").lean();
    const byAdm = new Map();
    for (const s of rawSales) {
      const bal = Number(s.balanceDue?.toString?.() ?? s.balanceDue ?? 0);
      if (bal <= 0) continue;
      const key = String(s.admissionId);
      const cur = byAdm.get(key) || {
        admissionId:     s.admissionId,
        admissionNumber: s.admissionNumber || "",
        UHID:            s.patientUHID || "",
        patientName:     s.patientName || "",
        outstanding:     0,
        billCount:       0,
        billSources:     { sale: 0, indent: 0 },
        oldestDueAt:     null,
      };
      cur.outstanding += bal;
      cur.billCount   += 1;
      cur.billSources.sale += 1;
      if (!cur.oldestDueAt || (s.createdAt && s.createdAt < cur.oldestDueAt)) {
        cur.oldestDueAt = s.createdAt;
      }
      byAdm.set(key, cur);
    }
    // ── B. PatientBill-embedded indent items ─────────────────────
    // Scan all open IPD bills with at least one PHARM-* line item.
    // We can't use a simple $match on category because billItems is an
    // array — use $elemMatch + lean. Pre-filter on a Mongo regex on
    // billItems.serviceCode for fast index-less scan (small set).
    // R7hr-12-S2 (D6-03): scope filter PatientBill side too, matching the
    // PharmacySale leg above. Doctor/Nurse rx.read holders only see
    // ward-indent credits for their panel/ward.
    // R7hr-12-S2 (D10-02): PatientBill stores the admission FK as
    // `admission` (PatientBillModel L245, indexed at L708), NOT
    // `admissionId` — pre-fix the `admissionId: { $ne: null }` clause was
    // a no-op against an absent field (matched ALL docs) and the
    // post-fetch `String(b.admissionId)` group key was always "undefined",
    // collapsing every indent bill onto a single junk admission. Also
    // gate on `balanceAmount: { $gt: 0 }` at Mongo level so fully-paid
    // bills don't get hydrated (Decimal128 $gt 0 works).
    const billWhere = {
      visitType:  "IPD",
      billStatus: { $in: ["DRAFT", "GENERATED", "PARTIAL"] },
      admission:  { $ne: null },
      balanceAmount: { $gt: 0 },
      $or: [
        { "billItems.category":    { $regex: /^pharmacy$/i } },
        { "billItems.serviceCode": { $regex: /^PHARM-/i }   },
      ],
    };
    if (scopedAdmissionIds) billWhere.admission = { $in: scopedAdmissionIds };
    const openBills = await PatientBill.find(billWhere).select("admission UHID patientName billItems balanceAmount billStatus billNumber createdAt").lean();
    for (const b of openBills) {
      const bal = Number(b.balanceAmount?.toString?.() ?? b.balanceAmount ?? 0);
      if (bal <= 0) continue;
      let pharmNet = 0, allNet = 0;
      for (const it of (b.billItems || [])) {
        const net = Number(it.netAmount?.toString?.() ?? it.netAmount ?? 0);
        allNet += net;
        const isPharm = (it.category || "").toUpperCase() === "PHARMACY"
                     || /^PHARM-/i.test(it.serviceCode || "");
        if (isPharm) pharmNet += net;
      }
      if (pharmNet <= 0 || allNet <= 0) continue;
      const pharmShare = round2(bal * (pharmNet / allNet));
      if (pharmShare <= 0) continue;
      // R7hr-12-S2 (D10-02): group key sources the correct field name.
      const key = String(b.admission);
      const cur = byAdm.get(key) || {
        // R7hr-12-S2 (D10-02): admissionId reference also uses correct field
        admissionId:     b.admission,
        admissionNumber: "",
        UHID:            b.UHID || "",
        patientName:     b.patientName || "",
        outstanding:     0,
        billCount:       0,
        billSources:     { sale: 0, indent: 0 },
        oldestDueAt:     null,
      };
      cur.outstanding += pharmShare;
      cur.billCount   += 1;
      cur.billSources.indent += 1;
      if (!cur.oldestDueAt || (b.createdAt && b.createdAt < cur.oldestDueAt)) {
        cur.oldestDueAt = b.createdAt;
      }
      byAdm.set(key, cur);
    }
    // Hydrate the admission record so we can show bed/ward/consultant
    // and confirm the admission is still Active (a Cancelled or
    // Discharged admission's pharmacy credit is still real but the
    // discharge gate doesn't apply, so we flag it separately).
    const admIds = Array.from(byAdm.keys());
    const adms = await Admission.find({ _id: { $in: admIds } })
      .select("admissionNumber UHID patientId bedId wardName department primaryConsultant status admissionDate")
      .populate("patientId", "fullName age gender contactNumber")
      .populate("bedId",     "bedNumber wardName")
      .lean();
    const admMap = new Map(adms.map(a => [String(a._id), a]));
    const rows = Array.from(byAdm.values()).map(r => {
      const a = admMap.get(String(r.admissionId)) || {};
      return {
        ...r,
        outstanding:    round2(r.outstanding),
        admissionStatus: a.status || "Unknown",
        bedNumber:      a.bedId?.bedNumber || "—",
        wardName:       a.bedId?.wardName || a.wardName || a.department || "—",
        // R7ey-F39: attendingDoctor is the canonical denormalized name;
        // primaryConsultant was a phantom field that no save path populated.
        consultant:     a.attendingDoctor || a.primaryConsultant || "",
        patientFullName: a.patientId?.fullName || r.patientName,
        patientAge:     a.patientId?.age || null,
        patientGender:  a.patientId?.gender || "",
        patientPhone:   a.patientId?.contactNumber || "",
        admissionDate:  a.admissionDate || null,
      };
    });
    // Sort: still-Active first (those block discharge), then oldest-due first.
    rows.sort((a, b) => {
      const aActive = a.admissionStatus === "Active" ? 0 : 1;
      const bActive = b.admissionStatus === "Active" ? 0 : 1;
      if (aActive !== bActive) return aActive - bActive;
      return new Date(a.oldestDueAt || 0) - new Date(b.oldestDueAt || 0);
    });
    const grand = rows.reduce((s, r) => s + r.outstanding, 0);
    res.json({
      success: true,
      data: rows,
      summary: { admissions: rows.length, totalOutstanding: round2(grand) },
    });
  } catch (e) { sendErr(res, e); }
};

// GET /api/pharmacy/credit/admission/:admissionId
// Itemised credit sales for one admission — drill-down for the
// pharmacist. Mirrors getOutstandingForAdmission but enriched with
// per-bill item lines so the family can review what they're paying for.
//
// R7db-2 — Returns BOTH PharmacySale rows AND PatientBill PHARM-* line
// items (from indent releases). The drill-down panel now shows the full
// ward-released drug list alongside any counter dispenses booked on
// credit. openSales = PharmacySale outstanding; openBills =
// PatientBill rows with pharmacy items + outstanding share.
exports.getCreditByAdmission = async (req, res) => {
  try {
    const { admissionId } = req.params;
    if (!isOid(admissionId)) {
      return res.status(400).json({ success: false, message: "Invalid admissionId" });
    }
    const Admission = require("../../models/Patient/admissionModel");
    const adm = await Admission.findById(admissionId)
      .select("admissionNumber UHID patientId bedId wardName department primaryConsultant status admissionDate attendingDoctorId")
      .populate("patientId", "fullName age gender contactNumber")
      .populate("bedId",     "bedNumber wardName")
      .lean();
    if (!adm) return res.status(404).json({ success: false, message: "Admission not found" });
    // R7hr-12-S2 (D6-03): enforce scope filter on this drill-down too —
    // pre-fix a Doctor/Nurse could simply pass an out-of-scope admissionId
    // via URL and see the full credit ledger. NO-OP for Admin/Pharmacist/
    // Accountant (req.scopeFilter undefined).
    if (req.scopeFilter && Object.keys(req.scopeFilter).length > 0) {
      const reqDoctor = req.scopeFilter.attendingDoctorId
        ? String(req.scopeFilter.attendingDoctorId)
        : null;
      const reqWard = req.scopeFilter["bed.ward"] || null;
      const admDoctor = adm.attendingDoctorId ? String(adm.attendingDoctorId) : null;
      const admWard = adm.wardName || "";
      const inDoctorScope = reqDoctor ? admDoctor === reqDoctor : true;
      const inNurseScope  = reqWard ? admWard === reqWard : true;
      if (!inDoctorScope || !inNurseScope) {
        return res.status(403).json({
          success: false,
          code: "OUT_OF_SCOPE",
          message: "Admission is outside your patient panel / ward — access denied",
        });
      }
    }
    const allSales = await Sale.find({
      admissionId,
      saleType: { $in: ["IPD", "Homecare"] },
      status:   "Completed",
    }).sort({ createdAt: 1 }).lean();
    const openSales = allSales.filter(s => {
      const b = Number(s.balanceDue?.toString?.() ?? s.balanceDue ?? 0);
      return b > 0;
    });
    let totalOutstanding = openSales.reduce(
      (s, x) => s + Number(x.balanceDue?.toString?.() ?? x.balanceDue ?? 0), 0,
    );
    // R7db-2 — fold in PatientBill PHARM-* items
    const ph = await exports.getOutstandingForAdmission(admissionId);
    // ph.bills was added in R7db-2; tolerate older callers by defaulting
    const openBills = Array.isArray(ph.bills) ? ph.bills : [];
    const billOutstanding = openBills.reduce((s, b) => s + Number(b.pharmBalance || 0), 0);
    totalOutstanding += billOutstanding;
    res.json({
      success: true,
      data: {
        admission: adm,
        openSales,
        // also include closed sales so the family sees "what you've
        // already paid" + "what's outstanding" in one panel
        closedSales: allSales.filter(s => !openSales.includes(s)),
        // R7db-2 — PatientBill-embedded indent items
        openBills,
        totalOutstanding: round2(totalOutstanding),
        // Split-out so the UI can label sources differently (counter
        // dispense vs. ward indent — both block discharge but are
        // collected via different counters in some hospitals).
        breakdown: {
          counterDispense: round2(openSales.reduce((s, x) => s + Number(x.balanceDue?.toString?.() ?? x.balanceDue ?? 0), 0)),
          wardIndent:      round2(billOutstanding),
        },
      },
    });
  } catch (e) { sendErr(res, e); }
};

// GET /api/pharmacy/credit/ipd-history?days=30
// R7cv — Day-wise log of every IPD pharmacy credit sale (both
// outstanding AND already-cleared) grouped by date. The pharmacist
// asked for visibility into "every IPD where pharmacy credit ever
// went out" — the outstanding-only list above hides bills that were
// dispensed on credit but later paid. This endpoint surfaces the
// full chronological audit so the pharmacist can see e.g. "on
// 22-May ₹2000 went out on credit across 3 admissions, all paid
// by 24-May" or "today ₹4500 went out, ₹500 still pending".
//
// R7db-2 — Also includes ward-dispensed drugs from indent releases.
// Those land on PatientBill.billItems[] as PHARM-* lines (not as
// separate PharmacySale docs), so the pharmacist was previously
// blind to them in the history view. We scan billItems with
// category=PHARMACY OR serviceCode=/^PHARM-/ within the same window
// and bucket by chargeDate, treating each line item as a
// pharmacy-credit "row" with source=INDENT.
//
// Returns: array of { dateKey, totalDispensed, totalOutstanding,
//   totalCollected, bills: [{billNumber, admissionNumber, UHID,
//   patientName, grandTotal, amountPaid, balanceDue, items[], createdAt, source}] }
// sorted newest-first. source ∈ {SALE, INDENT} distinguishes counter
// dispense vs ward indent on the UI.
exports.getIpdCreditHistory = async (req, res) => {
  try {
    const days = Math.min(180, Math.max(1, Number(req.query.days) || 30));
    // R7hr-12-S2 (D4-03): use IST start-of-today for the since boundary
    // so the day-bucket window aligns with the IST calendar shown to the
    // pharmacist. Pre-fix `new Date(); .setDate(-days); .setHours(0,0,0,0)`
    // anchored on server-local time, which is UTC on default Linux pods
    // (TZ unset) and drifts 5h30m behind IST midnight.
    const { istStartOfToday } = require("../../utils/queryGuards");
    const since = new Date(istStartOfToday().getTime() - days * 86400000);
    // R7hr-12-S2 (D4-03): IST-aware YYYY-MM-DD formatter shared between
    // the sale-bucket loop AND the indent-bucket loop below so both halves
    // of the audit row land on the same IST calendar day. Pre-fix the
    // bucket used `.toISOString().slice(0,10)` (UTC) regardless of server
    // timezone — empirically `Date('2026-06-04T03:00 IST').toISOString()
    // .slice(0,10)` returns '2026-06-03', so any sale dispensed between
    // IST 00:00 and 05:30 was attributed to the PREVIOUS calendar day,
    // breaking day-close reconciliation against the day-book.
    const _IST_DKEY_FMT = new Intl.DateTimeFormat("en-CA", {
      timeZone: process.env.HOSPITAL_TZ || "Asia/Kolkata",
      year: "numeric", month: "2-digit", day: "2-digit",
    });
    const istDateKey = (d) => {
      if (!d) return "unknown";
      try { return _IST_DKEY_FMT.format(new Date(d)); } catch (_) { return "unknown"; }
    };
    // R7hr-12-S2 (D6-03): scope filter for Doctor/Nurse — pre-resolve the
    // admission set so both the Sale and PatientBill scans share it. NO-OP
    // for Admin/Pharmacist/Accountant.
    let scopedAdmissionIds = null;
    if (req.scopeFilter && Object.keys(req.scopeFilter).length > 0) {
      try {
        const Admission = require("../../models/Patient/admissionModel");
        const admWhere = {};
        if (req.scopeFilter.attendingDoctorId) {
          admWhere.attendingDoctorId = req.scopeFilter.attendingDoctorId;
        }
        if (req.scopeFilter["bed.ward"]) {
          admWhere.wardName = req.scopeFilter["bed.ward"];
        }
        const scopedAdms = await Admission.find(admWhere).select("_id").lean();
        scopedAdmissionIds = scopedAdms.map(a => a._id);
        if (scopedAdmissionIds.length === 0) {
          return res.json({
            success: true,
            data: [],
            summary: { days: 0, bills: 0, totalDispensed: 0, totalCollected: 0, totalOutstanding: 0, windowDays: days },
          });
        }
      } catch (scopeErr) {
        console.error("[Pharmacy] getIpdCreditHistory scope filter failed:", scopeErr.message);
        return res.json({ success: true, data: [], summary: { days: 0, bills: 0, totalDispensed: 0, totalCollected: 0, totalOutstanding: 0, windowDays: days } });
      }
    }
    const saleWhere = {
      saleType:    { $in: ["IPD", "Homecare"] },
      // status:"Completed" excludes Cancelled — we want both the open
      // credit AND the historically-credit-then-paid bills here.
      status:      "Completed",
      admissionId: { $ne: null },
      createdAt:   { $gte: since },
      // R7cv — A sale qualifies as "credit dispensed" if EITHER the
      // original paymentMode was Credit, OR balanceDue > 0 at any
      // point (which we infer from collectionLog being non-empty OR
      // current balanceDue > 0). Cash-up-front IPD sales are
      // excluded — they never went on credit.
      $or: [
        { paymentMode: "Credit" },
        { balanceDue: { $gt: 0 } },
        { "collectionLog.0": { $exists: true } },
      ],
    };
    if (scopedAdmissionIds) saleWhere.admissionId = { $in: scopedAdmissionIds };
    const sales = await Sale.find(saleWhere)
      .select("billNumber admissionId admissionNumber patientUHID patientName grandTotal amountPaid balanceDue items createdAt paymentMode collectionLog")
      .sort({ createdAt: -1 })
      .lean();

    // Group by dateKey (YYYY-MM-DD in IST per the istDateKey helper above
    // so the bucket matches the calendar day the pharmacist sees).
    const byDay = new Map();
    for (const s of sales) {
      const dKey = istDateKey(s.createdAt);
      const total = Number(s.grandTotal?.toString?.() ?? s.grandTotal ?? 0);
      const paid  = Number(s.amountPaid?.toString?.() ?? s.amountPaid ?? 0);
      const bal   = Number(s.balanceDue?.toString?.() ?? s.balanceDue ?? 0);
      if (!byDay.has(dKey)) {
        byDay.set(dKey, {
          dateKey: dKey,
          totalDispensed:   0,
          totalCollected:   0,
          totalOutstanding: 0,
          billCount:        0,
          bills:            [],
        });
      }
      const grp = byDay.get(dKey);
      grp.totalDispensed   += total;
      grp.totalCollected   += paid;
      grp.totalOutstanding += bal;
      grp.billCount        += 1;
      grp.bills.push({
        _id:            s._id,
        billNumber:     s.billNumber,
        admissionId:    s.admissionId,
        admissionNumber: s.admissionNumber || "",
        UHID:           s.patientUHID || "",
        patientName:    s.patientName || "",
        grandTotal:     total,
        amountPaid:     paid,
        balanceDue:     bal,
        paymentMode:    s.paymentMode,
        items:          (s.items || []).map(i => ({
          drugName: i.drugName,
          quantity: i.quantity,
          netAmount: Number(i.netAmount?.toString?.() ?? i.netAmount ?? 0),
        })),
        createdAt:      s.createdAt,
        // R7cv — convenience flag for the frontend pill colour
        cleared:        bal === 0,
        // R7db-2 — distinguishes counter dispense (SALE) from ward
        // indent (INDENT). Frontend renders different pills + actions.
        source:         "SALE",
      });
    }

    // R7db-2 ── Ward-released drugs (PatientBill PHARM-* line items) ──
    // Indent releases live on the IPD PatientBill as billItems[], not on
    // separate PharmacySale docs. Scan within the same window using
    // chargeDate (the per-item date stamped by autoBillingService) since
    // a long IPD admission's bill.createdAt may predate the window.
    // Each unique (admission, chargeDate) becomes one row in the history
    // (collapses multiple PHARM-* items dispensed on the same day onto
    // one "ward indent" entry to keep the audit log readable).
    // R7hr-12-S2 (D6-03): scope the indent-bills leg by the same
    // scopedAdmissionIds set computed above.
    const indentBillWhere = {
      visitType:   "IPD",
      admissionId: { $ne: null },
      // Anything but DRAFT — DRAFT means the bill hasn't been generated
      // yet, but indent items can still be on a DRAFT (the auto-billing
      // flow writes there). Include DRAFT so the history shows in-progress
      // ward dispenses too.
      billStatus:  { $in: ["DRAFT", "GENERATED", "PARTIAL", "PAID"] },
      $or: [
        { "billItems.category":    { $regex: /^pharmacy$/i } },
        { "billItems.serviceCode": { $regex: /^PHARM-/i }   },
      ],
    };
    if (scopedAdmissionIds) indentBillWhere.admissionId = { $in: scopedAdmissionIds };
    const indentBills = await PatientBill.find(indentBillWhere)
      .select("billNumber admissionId UHID patientName billItems balanceAmount netAmount patientPayableAmount payments createdAt billStatus")
      .lean();

    for (const b of indentBills) {
      // Filter pharm items and bucket by chargeDate (fall back to bill
      // createdAt if a line item is missing chargeDate — shouldn't
      // happen with new code but legacy rows might).
      const pharmItems = (b.billItems || []).filter(it =>
        (it.category || "").toUpperCase() === "PHARMACY"
        || /^PHARM-/i.test(it.serviceCode || ""),
      );
      if (!pharmItems.length) continue;

      // Group pharm items on this bill by dateKey
      // R7hr-12-S2 (D4-03): IST-aware dateKey via the istDateKey helper
      // hoisted earlier in this function — keeps the indent-side bucket
      // calendar-aligned with the sale-side bucket above so the audit
      // row totals don't drift 5h30m apart on early-morning dispenses.
      const byDateOnBill = new Map();
      for (const it of pharmItems) {
        const when  = it.chargeDate ? new Date(it.chargeDate) : (b.createdAt ? new Date(b.createdAt) : null);
        if (!when || when < since) continue;
        const dKey = istDateKey(when);
        if (!byDateOnBill.has(dKey)) {
          byDateOnBill.set(dKey, { dKey, items: [], itemsNet: 0, when });
        }
        const grp = byDateOnBill.get(dKey);
        grp.items.push({
          drugName:  it.serviceName || it.serviceCode,
          quantity:  Number(it.quantity || 0),
          netAmount: Number(it.netAmount?.toString?.() ?? it.netAmount ?? 0),
        });
        grp.itemsNet += Number(it.netAmount?.toString?.() ?? it.netAmount ?? 0);
        // Track the latest "when" on the day so display picks the most
        // recent dispense time for that day.
        if (when > grp.when) grp.when = when;
      }
      if (!byDateOnBill.size) continue;

      // Bill-level balance is shared across ALL line items on the bill —
      // we attribute a proportional share to ward-indent items only.
      const billBal      = Number(b.balanceAmount?.toString?.() ?? b.balanceAmount ?? 0);
      const billNetTotal = Number(b.netAmount?.toString?.() ?? b.netAmount ?? 0)
                        || Number(b.patientPayableAmount?.toString?.() ?? b.patientPayableAmount ?? 0);
      const totalPharmNet = pharmItems.reduce(
        (s, it) => s + Number(it.netAmount?.toString?.() ?? it.netAmount ?? 0), 0,
      );
      const pharmShareRatio = totalPharmNet > 0 && billNetTotal > 0
        ? Math.min(1, totalPharmNet / billNetTotal)
        : 0;
      const pharmOutstanding = round2(billBal * pharmShareRatio);
      // "Already paid" share of pharmacy = totalPharmNet − outstanding.
      const pharmPaid = round2(Math.max(0, totalPharmNet - pharmOutstanding));

      for (const [dKey, grp] of byDateOnBill) {
        // Per-day shares scale by itemsNet/totalPharmNet so the day-level
        // numbers stay consistent with the bill-level rollup.
        const dayRatio = totalPharmNet > 0 ? (grp.itemsNet / totalPharmNet) : 0;
        const dayBal   = round2(pharmOutstanding * dayRatio);
        const dayPaid  = round2(pharmPaid        * dayRatio);
        if (!byDay.has(dKey)) {
          byDay.set(dKey, {
            dateKey: dKey,
            totalDispensed:   0,
            totalCollected:   0,
            totalOutstanding: 0,
            billCount:        0,
            bills:            [],
          });
        }
        const day = byDay.get(dKey);
        day.totalDispensed   += grp.itemsNet;
        day.totalCollected   += dayPaid;
        day.totalOutstanding += dayBal;
        day.billCount        += 1;
        day.bills.push({
          _id:            b._id,                          // PatientBill id
          billNumber:     b.billNumber || "(DRAFT)",
          admissionId:    b.admissionId,
          admissionNumber: "",                            // hydrated client-side if needed
          UHID:           b.UHID || "",
          patientName:    b.patientName || "",
          grandTotal:     round2(grp.itemsNet),
          amountPaid:     dayPaid,
          balanceDue:     dayBal,
          paymentMode:    null,                           // mixed at bill level
          items:          grp.items,
          createdAt:      grp.when,
          cleared:        dayBal === 0,
          source:         "INDENT",                       // ward indent (R7db-2)
        });
      }
    }

    const days_arr = Array.from(byDay.values())
      .map(d => ({
        ...d,
        totalDispensed:   round2(d.totalDispensed),
        totalCollected:   round2(d.totalCollected),
        totalOutstanding: round2(d.totalOutstanding),
      }))
      .sort((a, b) => b.dateKey.localeCompare(a.dateKey));
    res.json({
      success: true,
      data: days_arr,
      summary: {
        days:                days_arr.length,
        bills:               sales.length,
        totalDispensed:      round2(days_arr.reduce((s, d) => s + d.totalDispensed,   0)),
        totalCollected:      round2(days_arr.reduce((s, d) => s + d.totalCollected,   0)),
        totalOutstanding:    round2(days_arr.reduce((s, d) => s + d.totalOutstanding, 0)),
        windowDays:          days,
      },
    });
  } catch (e) { sendErr(res, e); }
};

// POST /api/pharmacy/sales/:id/collect-credit
// Records a payment against an IPD/credit sale. Atomic:
//   • amount must be > 0 and ≤ current balanceDue
//   • amountPaid +=, balanceDue −=, collectionLog row appended
//   • once balanceDue hits 0 the sale is "fully paid" but stays
//     status:"Completed" — we never bounce status because the
//     dispense already happened (only Cancelled/Refunded change status)
exports.collectCredit = async (req, res) => {
  try {
    const saleId = req.params.id;
    if (!isOid(saleId)) {
      return res.status(400).json({ success: false, message: "Invalid sale id" });
    }
    const amt = Number(req.body?.amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      return res.status(400).json({
        success: false, code: "INVALID_AMOUNT",
        message: "amount must be a positive number",
      });
    }
    const mode   = _normPaymentMode(req.body?.mode, "Cash");
    const txnRef = String(req.body?.txnRef || "").trim();
    const notes  = String(req.body?.notes  || "").trim();

    // Load fresh, validate balance, mutate, save. Wrapped in
    // retryVersionError so two concurrent collections on the same
    // sale (rare but possible) don't 500 with VersionError —
    // second one retries against the fresh doc + sees less balance.
    const updated = await retryVersionError(async () => {
      const sale = await Sale.findById(saleId);
      if (!sale) {
        const e = new Error("Sale not found"); e.status = 404; throw e;
      }
      if (sale.status !== "Completed") {
        const e = new Error(`Cannot collect on a ${sale.status} sale`);
        e.status = 409; e.code = "SALE_NOT_COLLECTABLE"; throw e;
      }
      const bal = Number(sale.balanceDue?.toString?.() ?? sale.balanceDue ?? 0);
      if (bal <= 0) {
        const e = new Error("Sale is already fully paid"); e.status = 409;
        e.code = "ALREADY_PAID"; throw e;
      }
      if (amt > bal + 0.01) {           // 1 paisa epsilon
        const e = new Error(`Amount ₹${amt.toFixed(2)} exceeds outstanding ₹${bal.toFixed(2)}`);
        e.status = 400; e.code = "OVER_COLLECTION"; throw e;
      }
      const newPaid = Number(sale.amountPaid?.toString?.() ?? sale.amountPaid ?? 0) + amt;
      const newBal  = round2(bal - amt);
      sale.amountPaid = toDec(newPaid);
      sale.balanceDue = toDec(newBal);
      // Receipt # — sequential per pharmacy. Best-effort: failures
      // here don't block the payment, just leave receiptNumber empty
      // (operator can issue a manual receipt).
      let receiptNumber = "";
      try {
        const seq = await nextSeq("pharmacyCreditCollection");
        // R7hq: PHM-COLL-YY-NNNN format (was PHM-COLL-YYYYMMDD-NNNN).
        const yy = String(new Date().getFullYear()).slice(-2);
        receiptNumber = `PHM-COLL-${yy}-${String(seq).padStart(4, "0")}`;
      } catch (_) { /* non-fatal */ }
      sale.collectionLog = sale.collectionLog || [];
      sale.collectionLog.push({
        amount: toDec(amt),
        mode,
        txnRef,
        receiptNumber,
        collectedAt: new Date(),
        collectedBy: req.user?.fullName || "System",
        collectedById: req.user?._id || null,
        notes,
      });
      // Once balanceDue hits 0, paymentMode flips from "Credit" to
      // whatever cleared it — so the bill print shows the final mode.
      // Mixed mode if the original was Credit and we have ≥ 2
      // distinct modes across collectionLog.
      if (newBal === 0) {
        const modes = new Set(sale.collectionLog.map(c => c.mode));
        sale.paymentMode = modes.size > 1 ? "Mixed" : (mode || "Cash");
      }
      await sale.save();
      return sale.toObject();
    });

    // B6-T05 — ClinicalAudit emit on credit collection so the patient's
    // chronological audit trail reflects every money-flow against the
    // pharmacy bill (NABH AAC.7 + IMS.2).
    try {
      emitClinicalAudit({
        req,
        event: "PHARMACY_CREDIT_COLLECTED",
        UHID: updated.patientUHID || "",
        admissionId: updated.admissionId || null,
        patientName: updated.patientName || "",
        targetType: "PharmacySale",
        targetId: updated._id,
        after: {
          billNumber: updated.billNumber,
          amount: amt,
          mode,
          txnRef,
          balanceDueRemaining: Number(updated.balanceDue?.toString?.() ?? updated.balanceDue ?? 0),
          fullyPaid: updated.balanceDue?.toString?.() === "0" || Number(updated.balanceDue || 0) === 0,
        },
      });
    } catch (_) { /* silent — audit emit is non-blocking */ }

    res.json({
      success: true,
      message: updated.balanceDue.toString() === "0"
        ? "Credit cleared — bill is now fully paid"
        : `Partial collection recorded — ₹${round2(Number(updated.balanceDue.toString()))} still outstanding`,
      data: updated,
    });
  } catch (e) {
    const status = e.status || 500;
    res.status(status).json({
      success: false,
      code:    e.code || "COLLECT_FAILED",
      message: e.message,
    });
  }
};

// R7hr-5 ════════════════════════════════════════════════════════════
// POST /api/pharmacy/sales/:id/apply-advance
//
// Consumes the patient's PatientAdvance balance against an outstanding
// pharmacy sale. Mirrors the IPD Live Ledger's applyAdvanceToBill flow:
//
//   • Sum every ACTIVE/PARTIALLY_APPLIED advance row for the sale's UHID
//     (advances aren't auto-targeted at a single bill — they're a pool).
//   • Apply MIN(advance_remaining, sale_balance) — caller can pass an
//     explicit `amount` to apply less.
//   • Decrement each advance row's appliedAmount in deposit order
//     (oldest first) and flip status to PARTIALLY_APPLIED / FULLY_APPLIED.
//   • Append a collectionLog row to the sale with mode="Advance" + a
//     sourceAdvanceId pointer to the LAST advance we touched (the audit
//     trail can fan out via the per-advance appliedAmount delta).
//
// R7hr-11 ────────────────────────────────────────────────────────────
//   Pre-R7hr-11 the advance debits + sale write ran outside a session.
//   If the user double-clicked Apply Adv or two requests landed close
//   together, the optimistic-lock retry would re-read the sale (now
//   fully paid) and throw ALREADY_PAID — but the ADVANCE saves from
//   the failed attempt had ALREADY committed. Net effect on the field:
//   advance.appliedAmount climbed by N×slice per click, sale was paid
//   once. Patient lost balance with no provenance.
//
//   Fix: run advance + sale saves inside `session.withTransaction` so
//   either both commit or both roll back. The dispense() / sale code
//   in this controller already uses the same pattern.
exports.applyAdvanceToSale = async (req, res) => {
  try {
    const saleId = req.params.id;
    if (!isOid(saleId)) {
      return res.status(400).json({ success: false, message: "Invalid sale id" });
    }
    const requested = req.body?.amount != null ? Number(req.body.amount) : null;
    if (requested != null && (!Number.isFinite(requested) || requested <= 0)) {
      return res.status(400).json({
        success: false, code: "INVALID_AMOUNT",
        message: "amount, when provided, must be > 0",
      });
    }

    // R7hr-11: open a mongoose session. If the cluster is a replica set
    // (transactions supported) we wrap reads + writes in withTransaction;
    // otherwise we fall back to non-transactional with a defence-in-depth
    // CAS pattern (single-document optimisticConcurrency on advance saves
    // means a concurrent over-debit will throw VersionError and bubble up).
    // R7hr-12-S2 (D2-09): the previous detection read three different paths
    // into the driver internals; recent mongoose/mongodb-driver versions move
    // the option around and a mis-classified RS appears as standalone. Switch
    // to a capability probe — actually call startTransaction() in a try
    // and abort it immediately. If it throws "Transaction numbers are only
    // allowed on a replica set member or mongos", we're on standalone.
    const session = await mongoose.startSession().catch(() => null);
    let useTx = false;
    if (session) {
      try {
        session.startTransaction();
        await session.abortTransaction();
        useTx = true;
      } catch (_) {
        // standalone Mongo — transactions unsupported; fall back to the
        // OCC + retryVersionError path below.
        useTx = false;
      }
    }

    const doApply = async (s) => {
      const sale = await Sale.findById(saleId).session(s || undefined);
      if (!sale) {
        const e = new Error("Sale not found"); e.status = 404; throw e;
      }
      if (sale.status !== "Completed") {
        const e = new Error(`Cannot apply advance on a ${sale.status} sale`);
        e.status = 409; e.code = "SALE_NOT_COLLECTABLE"; throw e;
      }
      const bal = Number(sale.balanceDue?.toString?.() ?? sale.balanceDue ?? 0);
      if (bal <= 0) {
        const e = new Error("Sale is already fully paid"); e.status = 409;
        e.code = "ALREADY_PAID"; throw e;
      }
      const uhid = (sale.patientUHID || sale.UHID || "").toString().toUpperCase();
      if (!uhid) {
        const e = new Error("Sale has no UHID — cannot resolve patient advance pool");
        e.status = 400; e.code = "MISSING_UHID"; throw e;
      }

      // Pull all advance rows that still carry an unspent balance, in
      // deposit order (oldest first) so the audit log reads naturally.
      const advances = await PatientAdvance
        .find({ UHID: uhid, status: { $in: ["ACTIVE", "PARTIALLY_APPLIED"] } })
        .sort({ createdAt: 1 })
        .session(s || undefined);
      const remainingByAdv = advances.map(a => {
        const amt   = Number(a.amount?.toString?.() ?? a.amount ?? 0);
        const appl  = Number(a.appliedAmount?.toString?.() ?? a.appliedAmount ?? 0);
        const refd  = Number(a.refundedAmount?.toString?.() ?? a.refundedAmount ?? 0);
        return Math.max(0, amt - appl - refd);
      });
      const totalAvailable = remainingByAdv.reduce((s, n) => s + n, 0);
      if (totalAvailable <= 0) {
        const e = new Error("No unspent advance balance for this patient");
        e.status = 409; e.code = "NO_ADVANCE"; throw e;
      }

      // Cap at the LESSER of sale balance and advance pool, then clamp
      // any explicit caller-supplied request to that ceiling.
      const cap   = Math.min(bal, totalAvailable);
      const toApply = requested == null ? cap : Math.min(requested, cap);
      if (toApply <= 0) {
        const e = new Error("Nothing to apply"); e.status = 400;
        e.code = "ZERO_APPLY"; throw e;
      }

      // Build sale mutation FIRST so we have a receiptNumber + collectionLog
      // entry id for the appliedTo[] provenance row on each advance.
      const round2 = (n) => Math.round(n * 100) / 100;
      const newPaid = Number(sale.amountPaid?.toString?.() ?? sale.amountPaid ?? 0) + toApply;
      const newBal  = round2(bal - toApply);
      let receiptNumber = "";
      try {
        const Counter = require("../../models/CounterModel");
        const c = await Counter.findOneAndUpdate(
          { _id: "pharmacyCreditCollection" },
          { $inc: { seq: 1 } },
          { upsert: true, new: true, setDefaultsOnInsert: true, session: s || undefined },
        );
        const yy = String(new Date().getFullYear()).slice(-2);
        receiptNumber = `PHM-COLL-${yy}-${String(c.seq).padStart(4, "0")}`;
      } catch (_) { /* non-fatal */ }

      // Bleed advances FIFO until we've sucked `toApply` out of the pool.
      // For each touched advance, push an appliedTo[] entry pointing at the
      // sale (provenance) so reconcile + day-book queries can fan out.
      // R7hr-12-S2 (D2-09): idempotency — if a prior request already pushed
      // an appliedTo[] row for THIS sale onto this advance, skip the debit.
      // Pre-fix a retry that re-read a fresh sale (already paid by the prior
      // successful attempt) would still debit advances in the loop before
      // discovering balanceDue<=0 — leading to a double-debit. With the
      // idempotency check, retries become safe.
      let need = toApply;
      let lastAdvId = null;
      const advanceSlices = []; // collected for emit + UI message
      const debitedAdvanceIds = []; // for compensating reversal on failure
      for (let i = 0; i < advances.length && need > 0; i++) {
        const adv = advances[i];
        const slice = Math.min(need, remainingByAdv[i]);
        if (slice <= 0) continue;
        // R7hr-12-S2 (D2-09): skip if this advance already carries an
        // appliedTo[] row for this sale (idempotency on retry).
        const alreadyApplied = (adv.appliedTo || []).some(
          r => String(r.billId) === String(sale._id),
        );
        if (alreadyApplied) {
          need -= slice; // treat as already-spent for the cap math
          continue;
        }
        const newApplied = Number(adv.appliedAmount?.toString?.() ?? adv.appliedAmount ?? 0) + slice;
        adv.appliedAmount = toDec(newApplied);
        // The pre-save status hook auto-flips ACTIVE→PARTIAL→FULLY based on
        // appliedAmount vs amount-refunded, so we don't need to set it here.
        // R7hr-11: also record provenance — appliedTo[] is required for
        // accountant reconcile + advance refund eligibility checks.
        // billId is the saleId because the appliedTo subdoc schema marks
        // it required; billNumber carries the human-readable PHM-* code
        // so it reads naturally in the day-book UI.
        adv.appliedTo.push({
          billId:        sale._id,
          billNumber:    sale.billNumber || "",
          amount:        toDec(slice),
          appliedAt:     new Date(),
          appliedBy:     req.user?.fullName || req.user?.userName || "System",
          appliedById:   req.user?._id || null,
          billPaymentId: null, // collectionLog _id assigned after sale.save()
        });
        await adv.save({ session: s || undefined });
        debitedAdvanceIds.push({ advId: adv._id, slice });
        need -= slice;
        lastAdvId = adv._id;
        advanceSlices.push({ advId: adv._id, slice });
      }

      // Now apply the sale-side mutation atomically with the advance saves.
      sale.amountPaid = toDec(newPaid);
      sale.balanceDue = toDec(newBal);
      sale.collectionLog = sale.collectionLog || [];
      sale.collectionLog.push({
        amount: toDec(toApply),
        mode: "Advance",
        txnRef: "",
        receiptNumber,
        collectedAt: new Date(),
        collectedBy: req.user?.fullName || "System",
        collectedById: req.user?._id || null,
        sourceAdvanceId: lastAdvId,
        notes: "Auto-applied from patient advance pool",
      });
      if (newBal === 0) {
        const modes = new Set(sale.collectionLog.map(c => c.mode));
        sale.paymentMode = modes.size > 1 ? "Mixed" : "Advance";
      }
      // R7hr-12-S2 (D2-09): on standalone-Mongo deployments where the
      // wrapping transaction is unavailable, sale.save() can throw
      // VersionError (concurrent collectCredit) AFTER advance debits have
      // committed. The retryVersionError outer wrapper re-runs doApply, which
      // would naturally re-skip the already-applied advances thanks to the
      // idempotency check above — but if the retry's re-read sees the sale
      // already paid (ALREADY_PAID branch above), the partial advance
      // debit would orphan with no compensating reversal. Catch the save
      // error and compensate before re-throwing.
      try {
        await sale.save({ session: s || undefined });
      } catch (saveErr) {
        if (s) {
          // Transaction path: abort handles rollback for both advance + sale.
          throw saveErr;
        }
        // Standalone path: reverse the advance debits we committed above.
        // This is best-effort — if a debit reversal also fails, the audit
        // trail shows both the failed save and the failed reversal so the
        // operator can hand-fix.
        for (const dbg of debitedAdvanceIds) {
          try {
            await retryVersionError(async () => {
              const fresh = await PatientAdvance.findById(dbg.advId);
              if (!fresh) return;
              const newApplied = Math.max(0, Number(fresh.appliedAmount?.toString?.() ?? 0) - dbg.slice);
              fresh.appliedAmount = toDec(newApplied);
              fresh.appliedTo = (fresh.appliedTo || []).filter(
                r => String(r.billId) !== String(sale._id),
              );
              await fresh.save();
            });
          } catch (revErr) {
            console.error(
              "[Pharmacy] applyAdvanceToSale rollback failed for advance",
              String(dbg.advId), ":", revErr.message,
            );
          }
        }
        throw saveErr;
      }

      return {
        sale: sale.toObject(),
        applied: toApply,
        advanceRemaining: totalAvailable - toApply,
        slices: advanceSlices,
      };
    };

    let result;
    try {
      if (useTx) {
        await session.withTransaction(async () => { result = await doApply(session); });
      } else {
        // Non-replica-set fallback: retry on VersionError so a concurrent
        // race that bumped __v on advance OR sale starts fresh.
        result = await retryVersionError(() => doApply(null));
      }
    } finally {
      if (session) session.endSession();
    }

    try {
      emitClinicalAudit({
        req,
        event: "PHARMACY_ADVANCE_APPLIED",
        UHID: result.sale.patientUHID || "",
        admissionId: result.sale.admissionId || null,
        patientName: result.sale.patientName || "",
        targetType: "PharmacySale",
        targetId: result.sale._id,
        after: {
          billNumber: result.sale.billNumber,
          amount: result.applied,
          balanceDueRemaining: Number(result.sale.balanceDue?.toString?.() ?? result.sale.balanceDue ?? 0),
          advancePoolRemaining: result.advanceRemaining,
        },
      });
    } catch (_) { /* non-fatal */ }

    // R7hr-12-S2 (D4-07): emit BillingAudit ADVANCE_APPLIED so the money
    // trail lands on the canonical Day-Book / accountant feed. Pre-fix
    // applyAdvanceToSale only emitted a ClinicalAudit row; the accountant's
    // "advance utilisation" query keys off BillingAudit.event="ADVANCE_APPLIED"
    // (see patientAdvanceService.js:298-316 for the IPD-bill mirror), so the
    // pharmacy boundary was invisible to GST §35 + NABH AAC.7 reconcile. One
    // audit row per advance slice so each PatientAdvance->Sale debit is
    // independently auditable (matches patientAdvanceService's per-advance
    // emission shape).
    try {
      const { emit } = require("../../models/Billing/BillingAudit");
      const actorId   = req.user?._id || req.user?.id || null;
      const actorName = req.user?.fullName || "System";
      const actorRole = req.user?.role || "";
      for (const slice of (result.slices || [])) {
        // Look up the advance receipt number lazily — the slice carries only
        // the id; receiptNumber is human-readable for the audit trail.
        let advReceiptNumber = "";
        try {
          const adv = await PatientAdvance.findById(slice.advId).select("receiptNumber").lean();
          advReceiptNumber = adv?.receiptNumber || "";
        } catch (_) { /* best-effort */ }
        await emit({
          event:                "ADVANCE_APPLIED",
          actorId,
          actorName,
          actorRole,
          UHID:                 (result.sale.patientUHID || "").toString().toUpperCase(),
          billId:               result.sale._id,
          billNumber:           result.sale.billNumber || "",
          admissionId:          result.sale.admissionId || null,
          advanceId:            slice.advId,
          advanceReceiptNumber: advReceiptNumber,
          amount:               toDec(slice.slice),
          paymentMode:          "ADVANCE_ADJUSTMENT",
          reason:               `Pharmacy sale ${result.sale.billNumber || ""} — advance applied via Live Ledger`,
          after:                { source: "PHARMACY", saleType: result.sale.saleType || "" },
        }, { req });
      }
      // Bust the Day-Book cache so the accountant tile reflects the new
      // money flow immediately — mirrors patientAdvanceService.js:322-325.
      try {
        require("../Billing/billingController").invalidateDayBookCache?.();
      } catch (_) { /* best-effort */ }
    } catch (_) { /* best-effort — audit failure must not block sale */ }

    res.json({
      success: true,
      message: result.sale.balanceDue.toString() === "0"
        ? `Cleared ₹${result.applied.toFixed(2)} from advance — bill fully paid`
        : `Applied ₹${result.applied.toFixed(2)} from advance — ₹${Number(result.sale.balanceDue.toString()).toFixed(2)} still outstanding`,
      data: result.sale,
      meta: { applied: result.applied, advanceRemaining: result.advanceRemaining },
    });
  } catch (e) {
    const status = e.status || 500;
    res.status(status).json({
      success: false,
      code: e.code || "APPLY_ADVANCE_FAILED",
      message: e.message,
    });
  }
};

/* ════════════════════════════════════════════════════════════════
   PARTIAL RETURN — refund 1+ items, restore stock, recompute totals
══════════════════════════════════════════════════════════════════ */
exports.returnItems = async (req, res) => {
  try {
    if (!isOid(req.params.id)) return res.status(400).json({ success: false, message: "Invalid sale id" });
    const { items = [], refundMode = "Cash", reason = "", notes = "" } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: "items[] is required — at least one item to return" });
    }
    if (!["Cash","Card","UPI","Adjusted","Credit-note"].includes(refundMode)) {
      return res.status(400).json({ success: false, message: "Invalid refundMode" });
    }

    // R7hr-12 (D1-01 follow-on): `let` instead of `const` because the
    // final-stage retryVersionError reload may reassign this binding to
    // the freshly-saved doc after a VersionError race.
    let sale = await Sale.findById(req.params.id);
    if (!sale) return res.status(404).json({ success: false, message: "Sale not found" });
    if (!["Completed","Partial-Return"].includes(sale.status)) {
      return res.status(400).json({ success: false, message: `Cannot return items on a ${sale.status} sale` });
    }

    // Pre-compute how much has already been returned PER saleItem so we
    // can clamp this request against the remaining returnable quantity.
    const alreadyReturned = {};   // saleItemId → qty
    for (const r of (sale.returns || [])) {
      for (const ri of (r.refundedItems || [])) {
        const k = String(ri.saleItemId || "");
        if (!k) continue;
        alreadyReturned[k] = (alreadyReturned[k] || 0) + Number(ri.quantity || 0);
      }
    }

    // Build the return record, validate quantities, recompute money
    // (same formula as dispense so the inverse is exact: net per item =
    // qty × unitPrice × (1 - disc%) × (1 + gst%) ).
    const refundedItems = [];
    let refundAmount = 0, refundTaxable = 0, refundGst = 0, refundDiscount = 0;

    for (const reqIt of items) {
      const saleItemId = String(reqIt.saleItemId || reqIt._id || "");
      if (!saleItemId) {
        return res.status(400).json({ success: false, message: "Each item needs a saleItemId" });
      }
      const orig = sale.items.id(saleItemId);
      if (!orig) {
        return res.status(404).json({ success: false, message: `Sale item ${saleItemId} not found in this bill` });
      }
      const qty = Number(reqIt.quantity || 0);
      if (!Number.isFinite(qty) || qty <= 0) {
        return res.status(400).json({ success: false, message: `Invalid return quantity for "${orig.drugName}"` });
      }
      const remaining = Number(orig.quantity || 0) - (alreadyReturned[saleItemId] || 0);
      if (qty > remaining) {
        return res.status(409).json({
          success: false,
          message: `Cannot return ${qty} of "${orig.drugName}" — only ${remaining} remaining (of ${orig.quantity} originally sold)`,
        });
      }

      // Per-item math — proportional to the dispensed item
      const unit  = Number(orig.unitPrice || 0);
      const gst   = Number(orig.gstRate ?? 12);
      const dPct  = Number(orig.discountPercent || 0);
      const gross = qty * unit;
      const disc  = gross * dPct / 100;
      const taxable = gross - disc;
      const gstAmt  = taxable * gst / 100;
      const net     = taxable + gstAmt;

      refundedItems.push({
        saleItemId, drugId: orig.drugId, drugName: orig.drugName,
        batchId: orig.batchId, batchNo: orig.batchNo, expiryDate: orig.expiryDate,
        quantity: qty, unitPrice: unit, gstRate: gst, discountPercent: dPct,
        grossAmount: round2(gross), discountAmount: round2(disc),
        taxableAmount: round2(taxable), gstAmount: round2(gstAmt),
        netAmount: round2(net),
      });

      refundAmount   += net;
      refundTaxable  += taxable;
      refundGst      += gstAmt;
      refundDiscount += disc;

      // Restore stock to the original batch atomically (re-audit r7
      // follow-up: the previous load-then-save pattern raced with
      // concurrent dispenses and could clobber `remaining`). The
      // `quantityIn` is a fixed-on-receipt invariant so we just bump
      // `quantityOut` down and `remaining` up — both deltas are pure
      // $inc operations, so concurrent updates compose correctly.
      if (orig.batchId) {
        const restored = await DrugBatch.findOneAndUpdate(
          { _id: orig.batchId, isActive: true, quantityOut: { $gte: qty } },
          { $inc: { quantityOut: -qty, remaining: qty } },
          { new: true },
        );
        if (!restored) {
          // Batch is missing, disabled, or already at zero quantityOut —
          // shouldn't happen unless someone hand-edited Mongo, but logging
          // beats silently swallowing the failure.
          console.error(
            `[Pharmacy] returnItems: could not restore qty=${qty} to batch ${orig.batchId} ` +
            `(possibly inactive or already reset). Sale ${sale._id} return continues.`,
          );
        }
      }
    }

    // Issue a refund slip number via Counter (separate sequence)
    // R7hq: REF-PHM-YY-NNNN (was REF-PHM-YYYYMMDD-NNNN).
    const seq = await nextSeq("pharmacyRefund");
    const yy = String(new Date().getFullYear()).slice(-2);
    const refundSlipNumber = `REF-PHM-${yy}-${String(seq).padStart(4, "0")}`;

    const returnRecord = {
      refundSlipNumber,
      refundedItems,
      refundAmount:    round2(refundAmount),
      refundTaxable:   round2(refundTaxable),
      refundGst:       round2(refundGst),
      refundDiscount:  round2(refundDiscount),
      refundMode, reason, notes,
      refundedBy:      req.user?.fullName || req.user?.name || "System",
      refundedById:    req.user?._id || null,
    };

    // R7hr-12 (D1-01 follow-on): now that PharmacySaleSchema enables
    // optimisticConcurrency, a concurrent writer (collectCredit etc.) on the
    // same sale would otherwise throw VersionError here. Wrap the final
    // commit in retryVersionError and re-apply the diff on the freshly-read
    // doc each iteration. Stock restore + refund slip seq are above and run
    // exactly once (idempotent / counter-bumped).
    // R7hr-12 (D2-01): every Decimal128 read uses toNum() before arithmetic
    // to avoid string-concat corruption on retry.
    let appliedSale;
    let payable = 0;
    await retryVersionError(async () => {
      const fresh = await Sale.findById(req.params.id);
      if (!fresh) {
        const e = new Error("Sale not found"); e.status = 404; throw e;
      }
      // Idempotency guard — if a prior attempt already pushed this slip,
      // do not double-write. We re-read on each retry so this catches
      // any committed prior pass.
      const already = (fresh.returns || []).some(r => r.refundSlipNumber === refundSlipNumber);
      if (!already) fresh.returns.push(returnRecord);

      // Recompute status from FRESH state (other writers may have added returns).
      const totalSoldQty = (fresh.items || []).reduce((s, it) => s + Number(it.quantity || 0), 0);
      const totalReturnedQty = (fresh.returns || []).reduce(
        (s, r) => s + (r.refundedItems || []).reduce((ss, ri) => ss + Number(ri.quantity || 0), 0), 0);
      fresh.status = totalReturnedQty >= totalSoldQty ? "Refunded" : "Partial-Return";

      // Money flow on refund:
      //   1. If patient still owed money on this bill (balanceDue > 0),
      //      first knock that off — patient now owes less.
      //   2. Any refund amount LEFT OVER after that is money the pharmacy
      //      must pay back. How we account for it depends on refundMode:
      //        • Cash / Card / UPI — paid out at counter now, no ledger entry.
      //        • Credit-note / Adjusted — pharmacy still holds the money
      //          (will offset future bill or be paid out later), so it goes
      //          to patientCredit as a positive balance.
      // Compute delta against fresh balanceDue/patientCredit on each retry
      // so concurrent collectCredit's debit doesn't get clobbered.
      if (!already) {
        const due       = toNum(fresh.balanceDue);
        const dueOffset = Math.min(due, refundAmount);
        fresh.balanceDue = round2(due - dueOffset);
        payable          = round2(refundAmount - dueOffset);
        if (payable > 0 && (refundMode === "Credit-note" || refundMode === "Adjusted")) {
          fresh.patientCredit = round2(toNum(fresh.patientCredit) + payable);
          fresh.patientCreditLog.push({
            amount: payable,
            reason: `Refund (${refundMode})`,
            refSlip: refundSlipNumber,
            byName: req.user?.fullName || req.user?.name || "System",
            byId:   req.user?._id || null,
          });
        }
        fresh.remarks = (fresh.remarks ? fresh.remarks + " · " : "") +
          `Returned ${refundedItems.length} line(s) · refund ${refundSlipNumber} · ${fmtINRSimple(refundAmount)} via ${refundMode}` +
          (payable > 0 && (refundMode === "Credit-note" || refundMode === "Adjusted")
            ? ` · credit ${fmtINRSimple(payable)} held for patient` : "");
      }

      await fresh.save();
      appliedSale = fresh;
    }, { label: "returnItems" });
    // Rebind `sale` to the post-save doc so the rest of this handler sees
    // the canonical, persisted state for cascades + audit emits.
    sale = appliedSale;

    // R7gz — Cascade the return into the IPD ledger. The matching
    // MAR_RESERVATION BillingTrigger (emitted by onIndentReleased when
    // the pharmacy first dispensed this drug) needs to be voided so
    // the PHARM category total on /ipd-ledger reflects the refund.
    // The pharmacy counter handles the actual money flow via
    // PharmacySale.balanceDue / patientCredit above — this is the
    // cost-view side. Best-effort: a failure here does NOT roll back
    // the return (stock is already credited, refund slip is issued).
    try {
      const autoBilling = require("../../services/Billing/autoBillingService");
      if (typeof autoBilling.onPharmacyReturn === "function") {
        await autoBilling.onPharmacyReturn(sale, returnRecord);
      }
    } catch (e) {
      console.error("[Pharmacy] returnItems → onPharmacyReturn cascade failed:", e.message);
    }

    // B6-T05 — ClinicalAudit emit on partial / full return (NABH MOM.4 +
    // drug-control trail). Captures refund slip + amount + refund mode so
    // a register query can reconstruct the reversal trail per UHID.
    try {
      emitClinicalAudit({
        req,
        event: "PHARMACY_RETURNED",
        UHID: sale.patientUHID || "",
        admissionId: sale.admissionId || null,
        patientName: sale.patientName || "",
        targetType: "PharmacySale",
        targetId: sale._id,
        reason: reason || "",
        after: {
          billNumber: sale.billNumber,
          refundSlipNumber,
          refundAmount: round2(refundAmount),
          refundMode,
          itemCount: refundedItems.length,
          newStatus: sale.status,
        },
      });
    } catch (_) { /* silent — audit emit is non-blocking */ }

    res.json({ success: true, data: { sale, returnRecord } });
  } catch (e) { sendErr(res, e); }
};

/* ════════════════════════════════════════════════════════════════
   ADD ITEMS (SUPPLEMENTARY INVOICE / DEBIT NOTE) — append items
   that were missed when the original bill was created. Original
   items[] is NEVER mutated. Each call appends a record to
   sale.supplements[] with a sequential SUP-PHM-YYYYMMDD-NNNN slip
   number that satisfies GST debit-note requirements.
══════════════════════════════════════════════════════════════════ */
exports.addItems = async (req, res) => {
  try {
    if (!isOid(req.params.id)) return res.status(400).json({ success: false, message: "Invalid sale id", code: "VALIDATION" });
    const { items = [], amountPaid, discountPercent = 0, reason = "", notes = "" } = req.body;
    // R7bh-F4 / R7bg-3-HIGH-1: normalise paymentMode (any case → Title-case enum).
    const paymentMode = _normPaymentMode(req.body.paymentMode, "Cash");

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: "items[] is required — at least one item to add", code: "VALIDATION" });
    }

    // R7hr-12 (D1-01 follow-on): `let` so the final retryVersionError block
    // can rebind to the freshly-saved doc after a VersionError race.
    let sale = await Sale.findById(req.params.id);
    if (!sale) return res.status(404).json({ success: false, message: "Sale not found" });
    // Fully refunded sales shouldn't accept additions — that's a new bill.
    // Cancelled bills definitely can't accept additions.
    if (["Refunded","Cancelled"].includes(sale.status)) {
      return res.status(400).json({ success: false, message: `Cannot add items to a ${sale.status} sale — issue a new bill instead` });
    }

    // Per-item input validation BEFORE we touch any state.
    for (const it of items) {
      if (!it.drugId || !isOid(it.drugId)) {
        return res.status(400).json({ success: false, message: `Invalid drugId on item "${it.drugName || ""}"` });
      }
      const q = Number(it.quantity);
      if (!Number.isFinite(q) || q <= 0) {
        return res.status(400).json({ success: false, message: `Invalid quantity for "${it.drugName || it.drugId}" — must be > 0` });
      }
    }

    // Pre-flight DELETED — same TOCTOU bug as dispense() (re-audit
    // round-7 follow-up). fifoConsume's atomic predicate is now the
    // single source of truth; cross-item rollback below unrolls
    // already-reserved stock if a later item runs short OR if
    // sale.save() fails (e.g. parent-bill validation kicks).
    const addedItems = [];
    let subTotal = 0, totalGst = 0, totalDisc = 0;
    const consumedAll = []; // [{batchId, qty}] across all items, for rollback
    try {
    for (const it of items) {
      const used = await fifoConsume(it.drugId, Number(it.quantity));
      for (const u of used) consumedAll.push({ batchId: u.batch._id, qty: u.used });
      for (const u of used) {
        const qty   = u.used;
        // R7bh-F4 / R7bg-10-CRIT-1: ALWAYS use the batch's salePrice — never
        // trust a client-supplied unitPrice on supplementary invoices either.
        const unit  = Number(u.batch.salePrice || 0);
        const gstR  = Number(it.gstRate ?? 12);
        const discR = Number(it.discountPercent ?? discountPercent ?? 0);
        const gross = qty * unit;
        const discAmt = gross * discR / 100;
        const taxable = gross - discAmt;
        const gstAmt  = taxable * gstR / 100;
        const net     = taxable + gstAmt;
        addedItems.push({
          drugId: it.drugId, drugName: it.drugName,
          batchId: u.batch._id, batchNo: u.batch.batchNo, expiryDate: u.batch.expiryDate,
          quantity: qty, unitPrice: unit, gstRate: gstR, discountPercent: discR,
          grossAmount: round2(gross),  discountAmount: round2(discAmt),
          taxableAmount: round2(taxable), gstAmount: round2(gstAmt), netAmount: round2(net),
        });
        subTotal  += gross;
        totalDisc += discAmt;
        totalGst  += gstAmt;
      }
    }
    const totalTaxable = subTotal - totalDisc;
    const addedTotalRaw = totalTaxable + totalGst;
    const addedTotal    = Math.round(addedTotalRaw * 100) / 100;
    const paid          = Number(amountPaid != null ? amountPaid : addedTotal);

    // Issue supplementary slip number (separate sequence)
    // R7hq: SUP-PHM-YY-NNNN (was SUP-PHM-YYYYMMDD-NNNN).
    const seq = await nextSeq("pharmacySupplement");
    const yy = String(new Date().getFullYear()).slice(-2);
    const supplementSlipNumber = `SUP-PHM-${yy}-${String(seq).padStart(4, "0")}`;

    const supplementRecord = {
      supplementSlipNumber,
      addedItems,
      addedSubTotal: round2(subTotal),
      addedDiscount: round2(totalDisc),
      addedTaxable:  round2(totalTaxable),
      addedGst:      round2(totalGst),
      addedTotal,
      paymentMode,
      amountPaid: round2(paid),
      balanceDue: round2(Math.max(0, addedTotal - paid)),
      addedBy:    req.user?.fullName || req.user?.name || "System",
      addedById:  req.user?._id || null,
      reason, notes,
    };
    const overPaid = Math.max(0, paid - addedTotal);

    // R7hr-12 (D1-01 follow-on): wrap the final commit in retryVersionError.
    // PharmacySaleSchema now enables optimisticConcurrency so a concurrent
    // collectCredit/refund would throw VersionError without this. Stock
    // consume + slip seq above run exactly once (atomic / counter-bumped);
    // we re-read the doc and re-apply just the supplement diff on each
    // retry. Idempotency key: supplementSlipNumber (already-pushed check).
    // R7hr-12 (D2-01): every Decimal128 read uses toNum() before arithmetic.
    let appliedSale;
    await retryVersionError(async () => {
      const fresh = await Sale.findById(req.params.id);
      if (!fresh) {
        const e = new Error("Sale not found"); e.status = 404; throw e;
      }
      const already = (fresh.supplements || []).some(s => s.supplementSlipNumber === supplementSlipNumber);
      if (!already) {
        fresh.supplements.push(supplementRecord);
        // Roll up balanceDue + patient credit on the parent sale.
        // Any unpaid portion of the supplement is added to the parent's balanceDue.
        // Decimal128-safe arithmetic via toNum().
        fresh.balanceDue = round2(toNum(fresh.balanceDue) + Math.max(0, addedTotal - paid));
        if (overPaid > 0) {
          fresh.patientCredit = round2(toNum(fresh.patientCredit) + overPaid);
          fresh.patientCreditLog.push({
            amount: overPaid,
            reason: "Over-payment on supplementary invoice",
            refSlip: supplementSlipNumber,
            byName: req.user?.fullName || "System",
            byId:   req.user?._id || null,
          });
        }
        // Status — if the sale was Completed, mark it Supplemented so the
        // operator can tell from the register. Partial-Return stays as-is
        // (a sale can be both partial-returned AND supplemented; the
        // supplement record is the audit trail).
        if (fresh.status === "Completed") fresh.status = "Supplemented";
        fresh.remarks = (fresh.remarks ? fresh.remarks + " · " : "") +
          `Added ${addedItems.length} line(s) · slip ${supplementSlipNumber} · ${fmtINRSimple(addedTotal)} via ${paymentMode}`;
      }
      await fresh.save();
      appliedSale = fresh;
    }, { label: "addItems" });
    sale = appliedSale;

    // B6-T05 — ClinicalAudit emit on supplementary invoice (NABH AAC.7).
    // Surfaces post-bill drug additions so the register can flag
    // dispensers who routinely "remember" items after closing the bill.
    try {
      emitClinicalAudit({
        req,
        event: "PHARMACY_ITEMS_ADDED",
        UHID: sale.patientUHID || "",
        admissionId: sale.admissionId || null,
        patientName: sale.patientName || "",
        targetType: "PharmacySale",
        targetId: sale._id,
        reason: reason || "",
        after: {
          billNumber: sale.billNumber,
          supplementSlipNumber,
          addedTotal: round2(addedTotal),
          paymentMode,
          itemCount: addedItems.length,
          hamPresent: addedItems.some((i) => i.isHAM === true),
        },
      });
    } catch (_) { /* silent — audit emit is non-blocking */ }

    res.status(201).json({ success: true, data: { sale, supplementRecord } });
    } catch (consumeErr) {
      // Cross-item rollback identical to dispense() (re-audit r7
      // follow-up). Unrolls every reservation so addItems() is
      // all-or-nothing.
      for (const c of consumedAll) {
        try {
          await DrugBatch.findByIdAndUpdate(c.batchId, {
            $inc: { quantityOut: -c.qty, remaining: c.qty },
          });
        } catch (rbErr) {
          console.error("[Pharmacy] addItems rollback failed for batch",
            String(c.batchId), ":", rbErr.message);
        }
      }
      const status = /^Insufficient stock/i.test(consumeErr.message || "") ? 409 : 500;
      return res.status(status).json({ success: false, message: consumeErr.message });
    }
  } catch (e) { sendErr(res, e); }
};

function round2(n) { return Math.round(n * 100) / 100; }
function fmtINRSimple(n) { return `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`; }

// R7bh-F4 / R7bg-1-CRIT-3 + R7bg-2-HIGH-2: cancelSale rewrite.
//   • Atomic findOneAndUpdate with predicate { _id, status: "Completed" }
//     so two pharmacists clicking "Cancel" race-safely (only one wins).
//   • Stock restoration loop uses atomic findOneAndUpdate per batch
//     ($inc) instead of the previous load-modify-save (which lost races
//     with concurrent dispenses/returns).
//   • SOD: the cancelling user must NOT be the same person who dispensed
//     the sale, unless they're Admin (whose admin-override is audited).
exports.cancelSale = async (req, res) => {
  try {
    if (!isOid(req.params.id)) return res.status(400).json({ success: false, message: "Invalid sale id", code: "VALIDATION" });

    // 1. Cheap pre-read for guard logic that doesn't need the atomic write
    //    (returns-already-issued, SOD check). The actual status flip is
    //    atomic below.
    const pre = await Sale.findById(req.params.id).lean();
    if (!pre) return res.status(404).json({ success: false, message: "Sale not found", code: "NOT_FOUND" });
    if ((pre.returns || []).length > 0) {
      return res.status(409).json({
        success: false, code: "HAS_RETURNS",
        message: "Cannot cancel — this sale has refund slips on it. Reverse refunds first.",
      });
    }
    if (pre.status !== "Completed") {
      return res.status(409).json({
        success: false, code: "ILLEGAL_TRANSITION",
        message: `Only Completed sales can be cancelled (current: ${pre.status})`,
      });
    }

    // R7bh-F4 / R7bg-2-HIGH-2: SOD — block self-cancel unless Admin override.
    const cancellerId = req.user?._id ? String(req.user._id) : "";
    const dispenserId = pre.createdById ? String(pre.createdById) : "";
    const isAdminOverride = req.user?.role === "Admin";
    if (cancellerId && dispenserId && cancellerId === dispenserId && !isAdminOverride) {
      return res.status(403).json({
        success: false, code: "SOD_SELF_CANCEL",
        message: "Self-cancel blocked — a different pharmacist (or an Admin override) must cancel this sale.",
      });
    }

    // 2. Atomic CAS — set status to Cancelled iff still Completed. Caller
    //    races with anyone else attempting cancel; whoever loses gets the
    //    409 below.
    const cancelStamp = new Date();
    const cancelledById = req.user?._id || null;
    const cancelledByName = req.user?.fullName || "System";
    const s = await Sale.findOneAndUpdate(
      { _id: req.params.id, status: "Completed" },
      {
        $set: {
          status:        "Cancelled",
          balanceDue:    0,
          cancelledById,
          cancelledByName,
          cancelledAt:   cancelStamp,
        },
      },
      { new: true, runValidators: true },
    );
    if (!s) {
      return res.status(409).json({
        success: false, code: "ALREADY_CANCELLED",
        message: "Sale already cancelled or transitioned by another writer.",
      });
    }

    // 3. Per-item returned-qty map so we never over-restore stock.
    const returnedByItem = {};
    for (const r of (s.returns || [])) {
      for (const ri of (r.refundedItems || [])) {
        const k = String(ri.saleItemId || "");
        if (!k) continue;
        returnedByItem[k] = (returnedByItem[k] || 0) + Number(ri.quantity || 0);
      }
    }

    // 4. Restore stock atomically — pure $inc deltas compose race-safely
    //    against concurrent dispenses/returns. Pre-R7bh's load-modify-save
    //    pattern raced with any in-flight write on the same batch.
    for (const it of s.items) {
      if (!it.batchId) continue;
      const alreadyReturned = returnedByItem[String(it._id)] || 0;
      const restoreQty = Math.max(0, Number(it.quantity || 0) - alreadyReturned);
      if (restoreQty <= 0) continue;
      const restored = await DrugBatch.findOneAndUpdate(
        { _id: it.batchId, isActive: true, quantityOut: { $gte: restoreQty } },
        { $inc: { quantityOut: -restoreQty, remaining: restoreQty } },
        { new: true },
      );
      if (!restored) {
        console.error(
          `[Pharmacy] cancelSale: could not restore qty=${restoreQty} to batch ${it.batchId} ` +
          `(sale ${s._id}). Stock counts may need manual reconciliation.`,
        );
      }
    }

    // 4b. R7hr-12 (D4-01): reverse any advance application that settled
    //     this sale. Pre-fix, cancelSale flipped status + zeroed balanceDue
    //     + booked the WHOLE amountPaid into patientCredit — but for a sale
    //     that had been paid from PatientAdvance via applyAdvanceToSale,
    //     PatientAdvance.appliedAmount stayed inflated AND the same money
    //     also got parked into PharmacySale.patientCredit. Net: patient
    //     lost advance balance equal to the cancelled slice, books showed
    //     the cash twice (advance-spent + pharmacy credit), and the
    //     `applied + refunded ≤ amount` invariant blocked subsequent
    //     advance refunds for that slice (stuck-state requiring DB
    //     surgery).
    //
    //     Fix: walk PatientAdvance docs that carry an appliedTo[] row
    //     keyed on this sale's _id (NOT just the collectionLog's lone
    //     sourceAdvanceId — FIFO can bleed multiple advances and push a
    //     row into EACH touched advance, but collectionLog only stores
    //     the LAST advance id). Decrement appliedAmount by each matched
    //     row's amount, $pull the row, emit an ADVANCE_APPLY_REVERSED
    //     audit per advance. Net out the advance-sourced portion from
    //     `amountPaid` before computing the patientCredit booking below
    //     so the same money isn't double-counted.
    //
    //     OCC: PatientAdvanceSchema enables optimisticConcurrency (L136
    //     in PatientAdvanceModel.js), so a concurrent applyAdvance/refund
    //     mid-walk would throw VersionError; retryVersionError handles it
    //     per-advance. Stock restore above is already committed and
    //     idempotent, so a partial-failure here doesn't corrupt stock.
    let advanceReversed = 0;
    const advanceReversalLog = []; // [{ advanceId, receiptNumber, slice }]
    try {
      const uhid = (s.patientUHID || "").toString().toUpperCase();
      if (uhid) {
        const touchedAdvs = await PatientAdvance.find({
          UHID: uhid,
          "appliedTo.billId": s._id,
        });
        for (const adv of touchedAdvs) {
          // Sum slices applied specifically to this sale on this advance
          // (handles the rare case where FIFO bled+refilled the same
          // advance twice — both rows must be reversed).
          const matchingRows = (adv.appliedTo || []).filter(
            r => String(r.billId) === String(s._id),
          );
          if (!matchingRows.length) continue;
          const reversalAmt = matchingRows.reduce(
            (t, r) => t + toNum(r.amount), 0,
          );
          if (reversalAmt <= 0) continue;
          // CAS reversal with retry. Re-read the advance to capture
          // post-other-writer state, recompute the matching rows on
          // the FRESH doc, then $pull + decrement + save.
          await retryVersionError(async () => {
            const fresh = await PatientAdvance.findById(adv._id);
            if (!fresh) return;
            const freshRows = (fresh.appliedTo || []).filter(
              r => String(r.billId) === String(s._id),
            );
            const freshAmt = freshRows.reduce((t, r) => t + toNum(r.amount), 0);
            if (freshAmt <= 0) return; // already reversed by a prior attempt
            // Decrement appliedAmount; rely on the pre-save status hook
            // (already in PatientAdvanceModel) to flip the status enum
            // appropriately (FULLY_APPLIED → PARTIALLY_APPLIED → ACTIVE).
            const newApplied = Math.max(0, toNum(fresh.appliedAmount) - freshAmt);
            fresh.appliedAmount = toDec(newApplied);
            // $pull matching subdocs by mutating the in-memory array;
            // Mongoose tracks the change and emits a proper $pull on save.
            fresh.appliedTo = (fresh.appliedTo || []).filter(
              r => String(r.billId) !== String(s._id),
            );
            await fresh.save();
            advanceReversalLog.push({
              advanceId:     adv._id,
              receiptNumber: adv.receiptNumber || "",
              slice:         freshAmt,
            });
          }, { label: `cancelSale-advance-reverse-${adv._id}` });
        }
        advanceReversed = advanceReversalLog.reduce((t, r) => t + r.slice, 0);
        // Best-effort audit emit per reversed advance.
        try {
          const { emit } = require("../../models/Billing/BillingAudit");
          for (const log of advanceReversalLog) {
            await emit({
              event:     "ADVANCE_APPLY_REVERSED",
              actorId:   cancelledById,
              actorName: cancelledByName,
              actorRole: req.user?.role || "",
              advanceId: log.advanceId,
              advanceReceiptNumber: log.receiptNumber,
              UHID:      uhid,
              admissionId: s.admissionId || null,
              amount:    log.slice,
              reason:    `PHARM_SALE_CANCELLED: ${s.billNumber} — advance debit reversed`,
              before:    { billId: s._id, status: "Completed" },
              after:     { billId: s._id, status: "Cancelled", reversed: log.slice },
            }, { req });
          }
        } catch (_) { /* best-effort */ }
      }
    } catch (advErr) {
      console.error(
        "[Pharmacy] cancelSale: advance reversal failed for sale",
        String(s._id), ":", advErr.message,
      );
      // Do NOT abort the cancel — stock is already restored and the sale
      // is already in status:Cancelled. Surface the failure in remarks
      // below so accountant reconcile can flag it for manual unblock.
    }

    // 5. Money flow + remarks via versioned save with retry. We touch
    //    patientCredit / patientCreditLog (arrays) so optimistic
    //    concurrency can collide if another endpoint pushed credit
    //    mid-flight.
    // R7hr-12 (D4-01): subtract the advance-reversed slice from amountPaid
    // before booking patientCredit — the advance pool already absorbed
    // its share, so booking it again into patientCredit would double-
    // count. Only the genuine cash/card/UPI portion should land here.
    const refundedSoFar  = (s.returns || []).reduce((t, r) => t + Number(r.refundAmount || 0), 0);
    const payable        = Math.max(0, Number(s.amountPaid || 0) - refundedSoFar - advanceReversed);

    try {
      const retryVersionError = require("../../utils/retryVersionError");
      await retryVersionError(async () => {
        const fresh = await Sale.findById(s._id);
        if (!fresh) return;
        if (payable > 0) {
          // R7hr-12 (D2-01): fresh.patientCredit is Decimal128 on the
          // hydrated doc — `(D128 || 0) + N` is string concat. toNum()
          // coerces before + so the cancel's held-credit booking lands
          // as a real number instead of a corrupted string.
          fresh.patientCredit = round2(toNum(fresh.patientCredit) + payable);
          fresh.patientCreditLog.push({
            amount: payable,
            reason: "Sale cancelled — payment held as credit",
            refSlip: fresh.billNumber,
            byName: cancelledByName,
            byId:   cancelledById,
          });
        }
        fresh.remarks = (fresh.remarks ? fresh.remarks + " · " : "") +
          `Cancelled by ${cancelledByName} on ${cancelStamp.toISOString()}` +
          (payable > 0 ? ` · ${fmtINRSimple(payable)} held as credit` : "") +
          // R7hr-12 (D4-01): surface advance reversal in the audit-trail
          // remark so an accountant skimming the bill sees the linkage
          // without spelunking BillingAudit.
          (advanceReversed > 0 ? ` · ${fmtINRSimple(advanceReversed)} returned to patient advance pool` : "") +
          (isAdminOverride && cancellerId === dispenserId ? " · ADMIN-OVERRIDE self-cancel" : "");
        await fresh.save();
      }, { label: "cancelSale-credit" });
    } catch (creditErr) {
      console.error("[Pharmacy] cancelSale credit-update failed for sale",
        String(s._id), ":", creditErr.message);
    }

    // 6. Audit on admin override (SOD breach).
    if (isAdminOverride && cancellerId === dispenserId) {
      try {
        const { emit } = require("../../models/Billing/BillingAudit");
        await emit({
          event:     "SHIFT_CLOSED", // closest enum bucket for SOD override audit
          actorId:   req.user?._id || null,
          actorName: cancelledByName,
          actorRole: req.user?.role || "Admin",
          amount:    Number(s.grandTotal || 0),
          reason:    `ADMIN_OVERRIDE_SELF_CANCEL: pharmacy sale ${s.billNumber} cancelled by dispenser via admin override`,
          before:    { saleId: s._id, status: "Completed" },
          after:     { saleId: s._id, status: "Cancelled", cancelledAt: cancelStamp },
        }, { req });
      } catch (_) { /* best-effort */ }
    }

    // B6-T05 — ClinicalAudit emit on sale cancellation (NABH IMS.2). The
    // SOD-override flag below distinguishes legitimate cancels from
    // dispenser self-cancels that bypassed SOD via an Admin role.
    try {
      emitClinicalAudit({
        req,
        event: "PHARMACY_SALE_CANCELLED",
        UHID: s.patientUHID || "",
        admissionId: s.admissionId || null,
        patientName: s.patientName || "",
        targetType: "PharmacySale",
        targetId: s._id,
        before: { status: "Completed" },
        after: {
          billNumber: s.billNumber,
          status: "Cancelled",
          totalAmount: Number(s.grandTotal || 0),
          itemCount: (s.items || []).length,
          cancelledAt: cancelStamp,
          adminOverrideSelfCancel: isAdminOverride && cancellerId === dispenserId,
          hamPresent: (s.items || []).some((i) => i.isHAM === true),
          // R7hr-12 (D4-01): surface advance reversal on the clinical
          // audit so a per-UHID NABH register can join the two-leg flow.
          advanceReversedAmount: advanceReversed,
          advanceReversedCount:  advanceReversalLog.length,
        },
      });
    } catch (_) { /* silent — audit emit is non-blocking */ }

    res.json({
      success: true,
      data: s,
      // R7hr-12 (D4-01): tell the caller how much (and from which advance
      // receipt numbers) was returned to the patient's advance pool so
      // the UI can show a confirmation row instead of silently changing
      // the advance balance.
      meta: {
        advanceReversed,
        advanceReversals: advanceReversalLog.map(r => ({
          receiptNumber: r.receiptNumber,
          amount:        r.slice,
        })),
      },
    });
  } catch (e) { sendErr(res, e); }
};

/* ════════════════════════════════════════════════════════════════
   DASHBOARD STATS + ALERTS
══════════════════════════════════════════════════════════════════ */
/* ════════════════════════════════════════════════════════════════
   R7bb-FIX-E-11 / D6-HIGH-1: Vendor return — return a batch to the
   supplier (expired / damaged / recalled). Pre-R7bb the only way to
   adjust stock for a vendor return was a free-form stock adjustment
   that left no audit anchor. New path:
     POST /api/pharmacy/vendor-returns  { vendor, batchId, qty, reason, expiryDate?, debitNoteNo?, debitNoteDate?, remarks? }
   Effect:
     • DrugBatch.vendorReturned += qty  (pre-save hook recomputes remaining)
     • PharmacyVendorReturn row created
     • BillingAudit row emitted (event reused: ITEM_PRICE_OVERRIDDEN as
       generic master-data adjustment; reason carries the prefix
       VENDOR_RETURN for grep-ability)
   ════════════════════════════════════════════════════════════════ */
exports.recordVendorReturn = async (req, res) => {
  try {
    const PharmacyVendorReturn = require("../../models/Pharmacy/PharmacyVendorReturnModel");
    const { batchId, qty, reason, expiryDate, debitNoteNo, debitNoteDate, remarks, vendor, vendorName } = req.body || {};
    if (!batchId || !isOid(batchId)) {
      return res.status(400).json({ success: false, message: "batchId (ObjectId) required" });
    }
    const qtyN = Number(qty);
    if (!Number.isFinite(qtyN) || qtyN <= 0) {
      return res.status(400).json({ success: false, message: "qty must be a positive number" });
    }
    // R7hr-12 (D3-01) + R7hr-12-S2 (D1-06): replace the load-then-save
    // with an atomic findOneAndUpdate gated on a fresh `remaining >= qtyN`
    // $expr. Pre-fix, findById + batch.save() raced concurrent dispense
    // $inc decrements (fifoConsume's atomic update path). Between the read
    // and the save, dispense decremented quantityOut + remaining; the
    // pre-save hook then recomputed `remaining = in - out - vendorReturned`
    // from the STALE in-memory snapshot, silently erasing the concurrent
    // dispense's decrement and inflating closing stock — patients could be
    // over-dispensed units that were already sold (controlled-drug
    // compliance risk + Form 35 stock register corruption). The same fix
    // closes D1-06 (P1 sibling) — two concurrent vendor returns each
    // observing remaining=5 and both passing qty=4 would both succeed
    // load-check-mutate-save, overstating vendor-returned by the race
    // amount on supplier debit-notes. The atomic $expr/$inc pair makes
    // the over-decrement impossible — the second call returns null and
    // 409s with INSUFFICIENT_STOCK_RACED.
    // The atomic update bypasses Mongoose middleware entirely so the
    // pre-save remaining recompute can't see a stale snapshot. We still
    // need the pre-read to surface a friendly error message + audit
    // before/after snapshot, but the source-of-truth decrement is the
    // atomic $inc gated by $expr.
    const preBatch = await DrugBatch.findById(batchId);
    if (!preBatch) return res.status(404).json({ success: false, message: "Batch not found" });
    const preRemaining = Math.max(0, (preBatch.quantityIn || 0) - (preBatch.quantityOut || 0) - (preBatch.vendorReturned || 0));
    if (qtyN > preRemaining) {
      return res.status(409).json({
        success: false,
        code: "INSUFFICIENT_STOCK",
        message: `Cannot return ${qtyN} — only ${preRemaining} remaining in batch ${preBatch.batchNo}.`,
      });
    }
    // Atomic, race-safe deduction. The $expr predicate re-checks the
    // remaining invariant at write time (NOT against the stale read), so a
    // concurrent dispense that crossed remaining < qtyN between the pre-
    // read and the write returns null and we fail gracefully. Identical
    // pattern to fifoConsume() at L480-L484 (proven safe at R7az-CRIT-5).
    const batch = await DrugBatch.findOneAndUpdate(
      {
        _id: batchId,
        isActive: true,
        $expr: {
          $gte: [
            { $subtract: ["$quantityIn", { $add: ["$quantityOut", "$vendorReturned"] }] },
            qtyN,
          ],
        },
      },
      { $inc: { vendorReturned: qtyN, remaining: -qtyN } },
      { new: true },
    );
    if (!batch) {
      // Concurrent dispense bled the batch dry between the pre-read and
      // here. Re-read for the up-to-date count + return a 409 with the
      // fresh remaining so the UI can show the truth.
      const fresh = await DrugBatch.findById(batchId).lean();
      const freshRem = Math.max(0, (fresh?.quantityIn || 0) - (fresh?.quantityOut || 0) - (fresh?.vendorReturned || 0));
      return res.status(409).json({
        success: false,
        code: "INSUFFICIENT_STOCK_RACED",
        message: `Concurrent dispense changed batch ${preBatch.batchNo} — only ${freshRem} remaining now (asked ${qtyN}).`,
      });
    }

    const row = await PharmacyVendorReturn.create({
      batchId:     batch._id,
      drugId:      batch.drugId,
      drugName:    batch.drugName,
      batchNo:     batch.batchNo,
      vendor:      vendor && isOid(vendor) ? vendor : (batch.supplierId || null),
      vendorName:  vendorName || batch.supplierName || "",
      qty:         qtyN,
      reason:      String(reason || "EXPIRED").toUpperCase(),
      expiryDate:  expiryDate ? new Date(expiryDate) : (batch.expiryDate || null),
      debitNoteNo: String(debitNoteNo || "").trim(),
      debitNoteDate: debitNoteDate ? new Date(debitNoteDate) : null,
      remarks:     String(remarks || "").trim(),
      returnedAt:  new Date(),
      returnedBy:  req.user?.fullName || req.user?.employeeId || "Pharmacy",
      returnedById:   req.user?._id || req.user?.id || null,
      returnedByRole: req.user?.role || "",
    });

    // Best-effort audit.
    // R7hr-12 (D3-01): before-snapshot uses the preBatch read (pre-atomic);
    // after-snapshot uses the freshly-returned post-update doc. Both come
    // from independent reads so the audit trail records the actual delta
    // even when a concurrent dispense moved quantityOut between them.
    try {
      const { emit } = require("../../models/Billing/BillingAudit");
      await emit({
        event:     "ITEM_PRICE_OVERRIDDEN",  // re-used enum bucket
        actorId:   req.user?._id || req.user?.id,
        actorName: req.user?.fullName,
        actorRole: req.user?.role,
        amount:    qtyN * Number(batch.purchaseRate || 0),
        reason:    `VENDOR_RETURN: ${batch.drugName || ""} batch ${batch.batchNo} qty=${qtyN} reason=${reason || "EXPIRED"} (debit-note ${debitNoteNo || "—"})`,
        before:    { remaining: preRemaining, vendorReturned: preBatch.vendorReturned || 0 },
        after:     { remaining: batch.remaining, vendorReturned: batch.vendorReturned, vendorReturnId: row._id },
      }, { req });
    } catch (_) { /* best-effort */ }

    res.status(201).json({ success: true, data: row, batchAfter: batch });
  } catch (e) { sendErr(res, e); }
};

exports.listVendorReturns = async (req, res) => {
  try {
    // R7bh-F4 / R7bg-9-CRIT-3: bound the range + paginate.
    const guard = _assertRange(req);
    if (!guard.ok) return res.status(400).json({ success: false, code: "RANGE_TOO_LARGE", message: guard.message });
    const { limit, skip } = _pagination(req, 200, 1000);

    const PharmacyVendorReturn = require("../../models/Pharmacy/PharmacyVendorReturnModel");
    const { vendor, batchId, from, to, reason } = req.query;
    const q = {};
    if (vendor && isOid(vendor))  q.vendor = vendor;
    if (batchId && isOid(batchId)) q.batchId = batchId;
    if (reason) q.reason = String(reason).toUpperCase();
    if (from || to) {
      q.returnedAt = {};
      if (from) q.returnedAt.$gte = new Date(`${from}T00:00:00`);
      if (to)   q.returnedAt.$lte = new Date(`${to}T23:59:59.999`);
    }
    const rows = await PharmacyVendorReturn.find(q).sort({ returnedAt: -1 })
      .skip(skip).limit(limit)
      .lean();
    res.json({ success: true, count: rows.length, data: rows });
  } catch (e) { sendErr(res, e); }
};

/* ════════════════════════════════════════════════════════════════
   R7bb-FIX-E-14 / D6-HIGH-7: Pharmacy end-of-day cash close.
   Snapshots /pharmacy/stats for the day into a PharmacyDayClose doc
   and emits an audit row.

   R7bh-F4 / R7bg-10-HIGH-5: schema lifted to its own file
   (models/Pharmacy/PharmacyDayCloseModel.js) with a unique index on
   `asOf` so two pharmacists clicking "Close Day" concurrently can't
   create duplicate snapshots — findOneAndUpdate({ asOf }, ...,
   { upsert: true, new: true }) collapses to one row.
   ════════════════════════════════════════════════════════════════ */
exports.closeDay = async (req, res) => {
  try {
    // Floor `asOf` to the start of the calendar day so the unique index
    // collapses any two close-day calls on the same date.
    const rawAsOf = req.body?.asOf ? new Date(req.body.asOf) : new Date();
    const asOf = new Date(rawAsOf); asOf.setHours(0,0,0,0);
    // Re-use the same aggregation the /stats endpoint runs by calling it
    // inline. Cheaper than refactoring — only fires once per day.
    const todayStart = new Date(asOf);
    const monthStart = new Date(asOf.getFullYear(), asOf.getMonth(), 1);
    const SALE_STATUSES = ["Completed", "Partial-Return", "Refunded", "Supplemented"];
    const [drugsCount, batches, todayAgg, monthAgg] = await Promise.all([
      Drug.countDocuments({ isActive: true }),
      DrugBatch.find({ isActive: true, remaining: { $gt: 0 } }).lean(),
      Sale.aggregate([
        { $match: { status: { $in: SALE_STATUSES }, createdAt: { $gte: todayStart } } },
        { $group: { _id: null, count: { $sum: 1 }, total: { $sum: "$grandTotal" } } },
      ]),
      Sale.aggregate([
        { $match: { status: { $in: SALE_STATUSES }, createdAt: { $gte: monthStart } } },
        { $group: { _id: null, count: { $sum: 1 }, total: { $sum: "$grandTotal" } } },
      ]),
    ]);
    const stockValue = batches.reduce((s, b) => s + (b.remaining * (b.salePrice || b.mrp || 0)), 0);

    // Idempotent upsert keyed on the floored asOf — second click on the
    // same day returns the existing row instead of failing the unique index.
    const row = await PharmacyDayClose.findOneAndUpdate(
      { asOf },
      {
        $setOnInsert: {
          asOf,
          closedBy:     req.user?.fullName || req.user?.employeeId || "Pharmacy",
          closedById:   req.user?._id || req.user?.id || null,
          closedByRole: req.user?.role || "",
          drugsCount,
          batchesInStock: batches.length,
          stockValue:   Math.round(stockValue),
          todaySales: {
            count: todayAgg[0]?.count || 0,
            total: Math.round(todayAgg[0]?.total || 0),
          },
          monthSales: {
            count: monthAgg[0]?.count || 0,
            total: Math.round(monthAgg[0]?.total || 0),
          },
          cashOnHand:   Number(req.body?.cashOnHand || 0),
          varianceNote: String(req.body?.varianceNote || "").trim(),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    // Audit
    try {
      const { emit } = require("../../models/Billing/BillingAudit");
      await emit({
        event:     "SHIFT_CLOSED",   // closest enum bucket
        actorId:   req.user?._id || req.user?.id,
        actorName: row.closedBy,
        actorRole: row.closedByRole,
        amount:    row.todaySales?.total || 0,
        reason:    `PHARMACY_DAY_CLOSE asOf=${asOf.toISOString().slice(0,10)} sales=${row.todaySales?.count || 0}`,
        after:     { dayCloseId: row._id, stockValue: row.stockValue, todaySales: row.todaySales },
      }, { req });
    } catch (_) { /* best-effort */ }
    res.status(201).json({ success: true, data: row });
  } catch (e) { sendErr(res, e); }
};

// R7bh-F4 / R7bg-9-CRIT-2: stats rewrite — collapse the DrugBatch.find().lean()
// + in-memory reduce/filter (which materialised every batch row in Node and
// often ate 100+ MB on hospitals with large catalogues) into a single $facet
// aggregation on DrugBatch. The 6 Sale aggregations stay parallel since they
// hit a different collection.
exports.stats = async (req, res) => {
  try {
    const now = new Date();
    const todayStart = new Date(); todayStart.setHours(0,0,0,0);
    const horizon90 = new Date(now.getTime() + 90 * 86400000);

    const monthStart  = new Date(now.getFullYear(), now.getMonth(), 1);
    // Sales counted are anything that left the counter as a tax invoice —
    // Completed + Partial-Return + Refunded. Refunds are subtracted as a
    // separate aggregation so revenue is net of returns (matches register).
    const SALE_STATUSES = ["Completed", "Partial-Return", "Refunded", "Supplemented"];
    const [drugsCount, batchFacet, todaySalesAgg, monthSalesAgg, todayRefundAgg, monthRefundAgg, todaySuppAgg, monthSuppAgg] = await Promise.all([
      Drug.countDocuments({ isActive: true }),
      // Single facet aggregation — Mongo computes stockValue + expiring +
      // expired + total count in one pipeline pass without ferrying batch
      // rows over the wire.
      DrugBatch.aggregate([
        { $match: { isActive: true, remaining: { $gt: 0 } } },
        { $facet: {
            stockValue: [
              { $group: { _id: null, total: { $sum: { $multiply: ["$remaining", { $ifNull: ["$salePrice", { $ifNull: ["$mrp", 0] }] }] } } } },
            ],
            batchesInStock: [
              { $count: "n" },
            ],
            expiringWithin90Days: [
              { $match: { expiryDate: { $gte: now, $lte: horizon90 } } },
              { $count: "n" },
            ],
            alreadyExpired: [
              { $match: { expiryDate: { $lt: now } } },
              { $count: "n" },
            ],
        } },
      ]),
      Sale.aggregate([
        { $match: { status: { $in: SALE_STATUSES }, createdAt: { $gte: todayStart } } },
        { $group: { _id: null, count: { $sum: 1 }, total: { $sum: "$grandTotal" } } },
      ]),
      Sale.aggregate([
        { $match: { status: { $in: SALE_STATUSES }, createdAt: { $gte: monthStart } } },
        { $group: { _id: null, count: { $sum: 1 }, total: { $sum: "$grandTotal" } } },
      ]),
      Sale.aggregate([
        { $match: { status: { $in: ["Partial-Return","Refunded"] }, createdAt: { $gte: todayStart } } },
        { $unwind: "$returns" },
        { $match: { "returns.refundedAt": { $gte: todayStart } } },
        { $group: { _id: null, refund: { $sum: "$returns.refundAmount" } } },
      ]),
      Sale.aggregate([
        { $match: { status: { $in: ["Partial-Return","Refunded"] }, createdAt: { $gte: monthStart } } },
        { $unwind: "$returns" },
        { $match: { "returns.refundedAt": { $gte: monthStart } } },
        { $group: { _id: null, refund: { $sum: "$returns.refundAmount" } } },
      ]),
      Sale.aggregate([
        { $match: { status: { $in: ["Supplemented","Partial-Return"] }, createdAt: { $gte: todayStart } } },
        { $unwind: "$supplements" },
        { $match: { "supplements.addedAt": { $gte: todayStart } } },
        { $group: { _id: null, supp: { $sum: "$supplements.addedTotal" } } },
      ]),
      Sale.aggregate([
        { $match: { status: { $in: ["Supplemented","Partial-Return"] }, createdAt: { $gte: monthStart } } },
        { $unwind: "$supplements" },
        { $match: { "supplements.addedAt": { $gte: monthStart } } },
        { $group: { _id: null, supp: { $sum: "$supplements.addedTotal" } } },
      ]),
    ]);

    const facet = batchFacet[0] || {};
    const stockValue    = facet.stockValue?.[0]?.total || 0;
    const batchesCount  = facet.batchesInStock?.[0]?.n || 0;
    const expiringCount = facet.expiringWithin90Days?.[0]?.n || 0;
    const expiredCount  = facet.alreadyExpired?.[0]?.n || 0;

    const tGross  = todaySalesAgg[0]?.total || 0;
    const tRefund = todayRefundAgg[0]?.refund || 0;
    const tSupp   = todaySuppAgg[0]?.supp || 0;
    const mGross  = monthSalesAgg[0]?.total || 0;
    const mRefund = monthRefundAgg[0]?.refund || 0;
    const mSupp   = monthSuppAgg[0]?.supp || 0;

    res.json({ success: true, data: {
      drugsCount,
      batchesInStock: batchesCount,
      stockValue: Math.round(stockValue),
      expiringWithin90Days: expiringCount,
      alreadyExpired: expiredCount,
      todaySales: {
        count: todaySalesAgg[0]?.count || 0,
        total: Math.round(tGross),
        refunds: Math.round(tRefund),
        supplements: Math.round(tSupp),
        net:    Math.round(Math.max(0, tGross + tSupp - tRefund)),
      },
      monthSales: {
        count: monthSalesAgg[0]?.count || 0,
        total: Math.round(mGross),
        refunds: Math.round(mRefund),
        supplements: Math.round(mSupp),
        net:    Math.round(Math.max(0, mGross + mSupp - mRefund)),
      },
    } });
  } catch (e) { sendErr(res, e); }
};

/* ════════════════════════════════════════════════════════════════
   PHARMACY SETTINGS — in-house vs outsourced print identity
══════════════════════════════════════════════════════════════════ */
// R7bh-F4 / R7bg-10-HIGH-1 + R7bg-10-HIGH-5: explicit allow-list +
// atomic upsert for the singleton PharmacySettings doc keyed by
// `_id: "default"`. Pre-R7bh getSettings used findById-then-create which
// would race on first-ever load; the new atomic upsert collapses any
// race into a single row.
const SETTINGS_ALLOWED_FIELDS = [
  "mode","pharmacyName","tagline","logo","showLogoInPrint","showTagline",
  "addressLine1","addressLine2","city","state","pincode","country",
  "phone1","phone2","email","website",
  "gstin","panNumber","drugLicenseNo","drugLicenseExp","fssaiNumber",
  // R7hr-12-S2 (D8-03): admin emergency override for an expired drug
  // license + documented reason. Both whitelisted on the singleton
  // PharmacySettings doc so /api/pharmacy/settings PUT can toggle them.
  "drugLicenseExpiryOverride","drugLicenseExpiryOverrideReason",
  "bankName","bankAccount","ifscCode","bankBranch","upiId",
  "headerColor","accentColor","billTemplate","defaultPaper",
  "registerHeader","registerShowLogo","registerShowGstin","registerShowDL",
  "registerShowContact","registerSerialColumn","registerSignatures","registerOrientation",
  "footerNote","termsLine1","termsLine2","termsLine3","showModeBadge",
];
function _pickSettings(body = {}) {
  const out = {};
  for (const k of SETTINGS_ALLOWED_FIELDS) if (body[k] !== undefined) out[k] = body[k];
  return out;
}

exports.getSettings = async (req, res) => {
  try {
    // Atomic upsert — first load on a fresh DB returns the seeded doc
    // without racing two parallel requests.
    const s = await Settings.findByIdAndUpdate(
      "default",
      { $setOnInsert: { _id: "default" } },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
    );
    res.json({ success: true, data: s });
  } catch (e) { sendErr(res, e); }
};

exports.updateSettings = async (req, res) => {
  try {
    const body = { ..._pickSettings(req.body || {}), updatedBy: req.user?.fullName || "System" };
    const s = await Settings.findByIdAndUpdate(
      "default",
      { $set: body, $setOnInsert: { _id: "default" } },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
    );
    res.json({ success: true, data: s });
  } catch (e) { sendErr(res, e); }
};

/* ════════════════════════════════════════════════════════════════
   REGISTERS — auto-populated audit logs required by D&C Act + GST
══════════════════════════════════════════════════════════════════ */
// Tiny helper to parse from/to from query into a Date range filter.
function _rangeFilter(req, field = "createdAt") {
  const { from, to } = req.query;
  const f = {};
  if (from) f.$gte = new Date(from);
  if (to)   f.$lte = new Date(new Date(to).getTime() + 86399_999);
  return Object.keys(f).length ? { [field]: f } : {};
}

// R7bh-F4 / R7bg-9-CRIT-3: hard-cap any from..to range at 90 days so a
// caller can't blow up the server with a "give me 5 years of sales" GET.
// Returns { ok: true } / { ok: false, message } so callers can early-exit
// with 400 RANGE_TOO_LARGE.
// R7hr-12-S2 (D6-05): pre-fix the function short-circuited to `{ok:true}`
// when either bound was missing, letting `?from=1970-01-01` (no `to`)
// bypass the cap entirely. Combined with _pagination (max 1000/page) and
// rx.read holders including Doctor/Nurse, that opened a slow but real
// enumeration of the entire sales/purchase/vendor-returns history. Now we
// backfill the missing bound IN req.query before the span check + so the
// downstream _rangeFilter calls construct a bounded range too. `to=now`
// when only `from` is given; `from=to-90d` when only `to` is given.
const _MAX_RANGE_MS = 90 * 86400000;
function _assertRange(req) {
  const q = req.query || {};
  const hasFrom = !!q.from;
  const hasTo   = !!q.to;
  if (!hasFrom && !hasTo) return { ok: true };
  // R7hr-12-S2 (D6-05): backfill missing bound to keep the 90-day cap
  // enforceable in all cases — mutate req.query so downstream _rangeFilter
  // builds a bounded range too.
  if (!hasTo) {
    const fNow = new Date();
    q.to = fNow.toISOString().slice(0, 10);
  }
  if (!hasFrom) {
    const tDate = new Date(q.to);
    if (Number.isFinite(tDate.getTime())) {
      const fDate = new Date(tDate.getTime() - _MAX_RANGE_MS);
      q.from = fDate.toISOString().slice(0, 10);
    }
  }
  const f = new Date(q.from).getTime();
  const t = new Date(q.to).getTime();
  if (!Number.isFinite(f) || !Number.isFinite(t)) return { ok: true }; // let downstream error
  if (t - f > _MAX_RANGE_MS) {
    return {
      ok: false,
      message: "Date range too large — max 90 days. Narrow the from/to and retry.",
    };
  }
  return { ok: true };
}

// Default pagination — registers cap at 200 rows unless caller asks for more.
function _pagination(req, defaultLimit = 200, maxLimit = 1000) {
  const limit = Math.max(1, Math.min(Number(req.query.limit) || defaultLimit, maxLimit));
  const skip  = Math.max(0, Number(req.query.skip) || 0);
  return { limit, skip };
}

// Sales register — bill-wise with HSN-wise GST split.
// Includes Completed + Partial-Return + Refunded so the audit trail is
// complete. Refund deltas are reported in their own column so the row
// shows ORIGINAL totals (legal source) with a refund tail.
exports.salesRegister = async (req, res) => {
  try {
    // R7bh-F4 / R7bg-9-CRIT-3: bound the range + paginate the result so
    // a "give me all sales" GET can't OOM the API box.
    const guard = _assertRange(req);
    if (!guard.ok) return res.status(400).json({ success: false, code: "RANGE_TOO_LARGE", message: guard.message });
    const { limit, skip } = _pagination(req, 200, 1000);

    const where = {
      status: { $in: ["Completed", "Partial-Return", "Refunded", "Supplemented"] },
      ..._rangeFilter(req),
    };
    const rows = await Sale.find(where).sort({ createdAt: 1 })
      .skip(skip).limit(limit)
      .lean();
    // R7hr-12 (D2-02): .lean() bypasses the decimalToNumber toJSON transform,
    // so subTotal/totalTaxable/totalGst/grandTotal/cgst/sgst/igstAmount come
    // back as raw Decimal128. `0 + Decimal128('100.00')` is the string
    // '0100.00' (toString-coerced concat), which after a second row becomes
    // '0100.00200.00' — and the per-row Decimal128 also JSON-serializes as
    // {"$numberDecimal":"100.00"} on the wire, breaking every frontend
    // consumer. toNum() coerces every Decimal128 read to a JS Number, both
    // in the per-row mapper AND in the totals reducer, so the response is
    // a clean numeric grid.
    // R7hr-12 (D8-04): IGST handling — was `cgst: totalGst/2, sgst: totalGst/2`
    // regardless of placeOfSupply. For inter-state B2B/corporate-panel sales
    // (dispense() correctly routes the full gstAmt into igstAmount), the
    // register was printing CGST+SGST while GSTR-1 carries IGST — a filing-
    // blocking contradiction. Use the stored bill-level cgst/sgst/igstAmount
    // columns (populated by dispense() per the placeOfSupply split) instead
    // of hard-half-splitting totalGst.
    const out = rows.map(s => {
      const hsnMap = new Map();
      let totalDisc = 0;
      for (const it of (s.items || [])) {
        const key = `${it.gstRate || 12}`;
        if (!hsnMap.has(key)) hsnMap.set(key, { gstRate: Number(key), taxable: 0, tax: 0 });
        const r = hsnMap.get(key);
        r.taxable += toNum(it.taxableAmount);
        r.tax     += toNum(it.gstAmount);
        totalDisc += toNum(it.discountAmount);
      }
      const refundAmount     = (s.returns || []).reduce((t, r) => t + Number(r.refundAmount || 0), 0);
      const supplementAmount = (s.supplements || []).reduce((t, x) => t + Number(x.addedTotal || 0), 0);
      const grandTotalN      = toNum(s.grandTotal);
      const netEffective     = Math.max(0, grandTotalN + supplementAmount - refundAmount);
      return {
        _id: s._id,
        billNumber: s.billNumber,
        date: s.createdAt,
        patientName: s.patientName || "Walk-in",
        patientUHID: s.patientUHID || "",
        admissionNumber: s.admissionNumber || "",
        saleType: s.saleType,
        paymentMode: s.paymentMode,
        placeOfSupply: s.placeOfSupply || "",
        customerGstin: s.customerGstin || "",
        status: s.status,
        itemsCount: s.items?.length || 0,
        returnsCount: (s.returns || []).length,
        supplementsCount: (s.supplements || []).length,
        subTotal: toNum(s.subTotal),
        discount: totalDisc,
        taxable: toNum(s.totalTaxable),
        // R7hr-12 (D8-04) / R7hr-12-S2 (D2-03): trust the persisted split,
        // not a /2 fallback — D2-03 is the P1 sibling of D8-04 calling out
        // the same defect on salesRegister + gstSummary.
        cgst: toNum(s.cgstAmount),
        sgst: toNum(s.sgstAmount),
        igst: toNum(s.igstAmount),
        gstTotal: toNum(s.totalGst),
        grandTotal: grandTotalN,
        refundAmount,                  // sum of all return slips (credit notes)
        supplementAmount,              // sum of all supplement slips (debit notes)
        netAfterReturns: netEffective, // grandTotal + supplements − refunds
        hsnBreakup: [...hsnMap.values()],
      };
    });
    const totals = rows.reduce((acc, s) => {
      const refundAmount     = (s.returns || []).reduce((t, r) => t + Number(r.refundAmount || 0), 0);
      const supplementAmount = (s.supplements || []).reduce((t, x) => t + Number(x.addedTotal || 0), 0);
      const grandTotalN      = toNum(s.grandTotal);
      acc.bills += 1;
      // R7hr-12 (D2-02): toNum() before += so Decimal128 totals are summed
      // numerically instead of string-concatenated.
      acc.subTotal     += toNum(s.subTotal);
      acc.taxable      += toNum(s.totalTaxable);
      acc.gstTotal     += toNum(s.totalGst);
      acc.grandTotal   += grandTotalN;
      // R7hr-12 (D8-04): track per-bucket CGST/SGST/IGST so totals reflect
      // the true intra/inter-state mix instead of a blanket totalGst/2.
      acc.cgst         += toNum(s.cgstAmount);
      acc.sgst         += toNum(s.sgstAmount);
      acc.igst         += toNum(s.igstAmount);
      acc.refunds      += refundAmount;
      acc.supplements  += supplementAmount;
      acc.net          += Math.max(0, grandTotalN + supplementAmount - refundAmount);
      return acc;
    }, { bills: 0, subTotal: 0, taxable: 0, gstTotal: 0, cgst: 0, sgst: 0, igst: 0, grandTotal: 0, refunds: 0, supplements: 0, net: 0 });
    res.json({ success: true, data: { rows: out, totals } });
  } catch (e) { sendErr(res, e); }
};

// Purchase register — GRN-wise with supplier + GST claim.
exports.purchaseRegister = async (req, res) => {
  try {
    // R7bh-F4 / R7bg-9-CRIT-3: bound the range + paginate.
    const guard = _assertRange(req);
    if (!guard.ok) return res.status(400).json({ success: false, code: "RANGE_TOO_LARGE", message: guard.message });
    const { limit, skip } = _pagination(req, 200, 1000);

    const where = { isActive: true, ..._rangeFilter(req, "createdAt") };
    const batches = await DrugBatch.find(where).sort({ createdAt: 1 })
      .skip(skip).limit(limit)
      .populate("drugId", "name hsnCode gstRate category").lean();
    const out = batches.map(b => {
      const purchase = (b.quantityIn || 0) * (b.purchaseRate || 0);
      const gstRate  = b.drugId?.gstRate || 12;
      const taxable  = purchase / (1 + gstRate / 100);      // assume purchase rate is gross-of-tax
      const tax      = purchase - taxable;
      return {
        _id: b._id,
        grnNumber: b.grnNumber || "",
        invoiceNo: b.invoiceNo || "",
        invoiceDate: b.invoiceDate || b.createdAt,
        supplier:  b.supplierName || "—",
        drug:      b.drugId?.name || b.drugName,
        hsn:       b.drugId?.hsnCode || "30049099",
        batch:     b.batchNo,
        expiry:    b.expiryDate,
        qty:       b.quantityIn,
        rate:      b.purchaseRate,
        gross:     Math.round(purchase * 100) / 100,
        gstRate,
        taxable:   Math.round(taxable * 100) / 100,
        tax:       Math.round(tax * 100) / 100,
      };
    });
    const totals = out.reduce((acc, r) => ({
      grnCount: acc.grnCount + 1,
      gross:    acc.gross    + r.gross,
      taxable:  acc.taxable  + r.taxable,
      tax:      acc.tax      + r.tax,
    }), { grnCount: 0, gross: 0, taxable: 0, tax: 0 });
    res.json({ success: true, data: { rows: out, totals } });
  } catch (e) { sendErr(res, e); }
};

// Stock register — Form 35 (D&C): opening + receipts + issues + closing per drug.
// "Opening" = batches.created before from-date, sum(quantityIn). "Issued in range" =
// sales items linked to those batches during the range.
//
// Audit C-06: previous implementation looped per drug and ran 4 aggregations
// inside the loop — 4×N round-trips. On a 500-drug master that's 2000 calls,
// O(seconds). Now collapsed to 5 parallel aggregations total (1× DrugBatch
// per-drug rollup + 1× sales-items + 1× supplements + 1× returns + 1× Drug
// master) merged in JS by drugId. O(1) round-trip count regardless of N.
exports.stockRegister = async (req, res) => {
  try {
    const { from, to } = req.query;
    const start = from ? new Date(from) : new Date(Date.now() - 30 * 86400000);
    const end   = to   ? new Date(new Date(to).getTime() + 86399_999) : new Date();

    const [drugs, batchAgg, issuedAgg, suppAgg, returnedAgg] = await Promise.all([
      Drug.find({ isActive: true }).lean(),
      // Per-drug batch rollup — opening (created < start), receipts
      // (start ≤ created ≤ end), closing (sum remaining today). The
      // `drugId: $ne null` match (re-audit R14 follow-up) prevents
      // orphan batches from folding into a single `_id: null` bucket
      // that the merge loop would silently drop.
      DrugBatch.aggregate([
        { $match: { isActive: true, drugId: { $ne: null } } },
        { $group: {
            _id: "$drugId",
            opening:  { $sum: { $cond: [{ $lt:  ["$createdAt", start] }, { $ifNull: ["$quantityIn", 0] }, 0] } },
            receipts: { $sum: { $cond: [{ $and: [
                                          { $gte: ["$createdAt", start] },
                                          { $lte: ["$createdAt", end]   } ] },
                                       { $ifNull: ["$quantityIn", 0] }, 0] } },
            closing:  { $sum: { $ifNull: ["$remaining", 0] } },
        } },
      ]),
      // Original sale items in range — grouped by drugId. Filter null
      // drugIds AFTER unwind so the per-row guard catches malformed
      // items embedded in otherwise-valid sale docs.
      Sale.aggregate([
        { $match: { status: { $in: ["Completed", "Partial-Return", "Refunded", "Supplemented"] },
                    createdAt: { $gte: start, $lte: end } } },
        { $unwind: "$items" },
        { $match: { "items.drugId": { $ne: null } } },
        { $group: { _id: "$items.drugId", qty: { $sum: "$items.quantity" } } },
      ]),
      // Supplementary items (debit notes) in range — grouped by drugId
      Sale.aggregate([
        { $match: { status: { $in: ["Supplemented", "Partial-Return"] },
                    createdAt: { $gte: start, $lte: end } } },
        { $unwind: "$supplements" },
        { $unwind: "$supplements.addedItems" },
        { $match: { "supplements.addedItems.drugId": { $ne: null } } },
        { $group: { _id: "$supplements.addedItems.drugId", qty: { $sum: "$supplements.addedItems.quantity" } } },
      ]),
      // Returns in range — grouped by drugId
      Sale.aggregate([
        { $match: { status: { $in: ["Partial-Return", "Refunded"] },
                    createdAt: { $gte: start, $lte: end } } },
        { $unwind: "$returns" },
        { $unwind: "$returns.refundedItems" },
        { $match: { "returns.refundedItems.drugId": { $ne: null } } },
        { $group: { _id: "$returns.refundedItems.drugId", qty: { $sum: "$returns.refundedItems.quantity" } } },
      ]),
    ]);

    const idStr = (v) => String(v || "");
    const byBatch    = new Map(batchAgg.map(   r => [idStr(r._id), r]));
    const byIssued   = new Map(issuedAgg.map(  r => [idStr(r._id), r.qty]));
    const bySupp     = new Map(suppAgg.map(    r => [idStr(r._id), r.qty]));
    const byReturned = new Map(returnedAgg.map(r => [idStr(r._id), r.qty]));

    const out = [];
    for (const d of drugs) {
      const k = idStr(d._id);
      const b = byBatch.get(k) || { opening: 0, receipts: 0, closing: 0 };
      const grossIssued  = byIssued.get(k)   || 0;
      const supplementQty = bySupp.get(k)    || 0;
      const returnedQty  = byReturned.get(k) || 0;
      const issued = Math.max(0, grossIssued + supplementQty - returnedQty);
      if (b.opening || b.receipts || issued || b.closing) {
        out.push({
          drugId: d._id, drugName: d.name, category: d.category, hsn: d.hsnCode || "30049099",
          opening: b.opening, receipts: b.receipts, issued, closing: b.closing,
          reorderLevel: d.reorderLevel || 10,
        });
      }
    }
    res.json({ success: true, data: { rows: out, from: start, to: end } });
  } catch (e) { sendErr(res, e); }
};

// Schedule H / H1 / X register — every sale containing a controlled drug,
// with prescription reference + Rx prescriber. Required by D&C Rules.
// Includes Completed + Partial-Return + Refunded so the audit covers
// returns. Net dispensed quantity = sold − returned per (sale, item).
exports.scheduleHRegister = async (req, res) => {
  try {
    // R7hr-12-S2 (D10-03): bound the range + paginate. Pre-fix this
    // endpoint ran `Sale.find(where).sort().lean()` with neither a range
    // cap nor pagination, while salesRegister and purchaseRegister already
    // gate via `_assertRange + _pagination`. Without a guard, a rx.read
    // holder could ask for the full year-end H/H1/X register (a real D&C
    // surveyor-pull scenario), loading 50k+ sales × 20 items into Node
    // heap and triggering 503 / process restart.
    const guard = _assertRange(req);
    if (!guard.ok) return res.status(400).json({ success: false, code: "RANGE_TOO_LARGE", message: guard.message });
    const { limit, skip } = _pagination(req, 200, 1000);
    const where = {
      status: { $in: ["Completed", "Partial-Return", "Refunded", "Supplemented"] },
      ..._rangeFilter(req),
    };
    const sales = await Sale.find(where).sort({ createdAt: 1 })
      .skip(skip).limit(limit)
      .lean();
    // Cache drug schedule lookups so we don't re-read the same drug 50×
    const drugCache = new Map();
    const out = [];
    const getDrug = async (drugId) => {
      const key = String(drugId);
      let d = drugCache.get(key);
      if (!d) {
        d = await Drug.findById(drugId).select("schedule isHighAlert isNarcotic name").lean();
        drugCache.set(key, d);
      }
      return d;
    };

    for (const s of sales) {
      // Pre-compute returned qty per item from this sale's returns[]
      const returnedByItem = {};
      for (const r of (s.returns || [])) {
        for (const ri of (r.refundedItems || [])) {
          const k = String(ri.saleItemId || "");
          if (!k) continue;
          returnedByItem[k] = (returnedByItem[k] || 0) + Number(ri.quantity || 0);
        }
      }

      // R7hr-12-S2 (D8-07): sale-level prescriber registration number is
      // the D&C Form 2 fallback when per-item is empty (homogeneous bills
      // + legacy rows).
      const saleReg = String(s.prescriberRegistrationNo || "").trim();

      // ── Supplementary items (debit notes) — Schedule H items added
      //    AFTER the original bill are equally regulated and must show
      //    up in the register with their slip number for audit.
      for (const sup of (s.supplements || [])) {
        for (const it of (sup.addedItems || [])) {
          const d = await getDrug(it.drugId);
          if (d && /^(H|H1|X)$/i.test(d.schedule || "")) {
            // R7hr-12-S2 (D8-07): supplements.addedItems is a generic Array,
            // so per-item reg may not be set on legacy supplements.
            const itemReg = String(it.prescriberRegistrationNo || "").trim();
            out.push({
              date: sup.addedAt || s.createdAt,
              billNumber: s.billNumber + " · " + (sup.supplementSlipNumber || "SUP"),
              patientName: s.patientName || "—",
              patientUHID: s.patientUHID || "—",
              doctorName:  s.doctorName  || "—",
              // R7hr-12-S2 (D8-07): D&C Form 2 mandated prescriber reg column.
              prescriberRegistrationNo: itemReg || saleReg || "—",
              prescriptionRef: s.prescriptionRef || "—",
              drugName: d.name,
              schedule: d.schedule,
              batchNo: it.batchNo,
              expiryDate: it.expiryDate,
              quantity: Number(it.quantity || 0),
              quantitySold: Number(it.quantity || 0),
              quantityReturned: 0,
              isHighAlert: !!d.isHighAlert,
              isNarcotic:  !!d.isNarcotic,
              isReturned:  false,
              isSupplement: true,
            });
          }
        }
      }

      for (const it of (s.items || [])) {
        const d = await getDrug(it.drugId);
        if (d && /^(H|H1|X)$/i.test(d.schedule || "")) {
          const itemKey = String(it._id);
          const returnedQty = Number(returnedByItem[itemKey] || 0);
          const dispensedNet = Math.max(0, Number(it.quantity || 0) - returnedQty);
          // R7hr-12-S2 (D8-07): per-item prescriberRegistrationNo (new
          // on SALE_ITEM) wins over sale-level. Legacy rows without the
          // per-item column fall through to sale.prescriberRegistrationNo.
          const itemReg = String(it.prescriberRegistrationNo || "").trim();
          out.push({
            date: s.createdAt,
            billNumber: s.billNumber,
            patientName: s.patientName || "—",
            patientUHID: s.patientUHID || "—",
            doctorName:  s.doctorName  || "—",
            // R7hr-12-S2 (D8-07): D&C Form 2 mandated prescriber reg column.
            prescriberRegistrationNo: itemReg || saleReg || "—",
            prescriptionRef: s.prescriptionRef || "—",
            drugName: d.name,
            schedule: d.schedule,
            batchNo: it.batchNo,
            expiryDate: it.expiryDate,
            quantity: dispensedNet,             // net of returns
            quantitySold: it.quantity,           // original (audit trail)
            quantityReturned: returnedQty,
            isHighAlert: !!d.isHighAlert,
            isNarcotic:  !!d.isNarcotic,
            isReturned:  returnedQty > 0,
          });
        }
      }
    }
    res.json({ success: true, data: { rows: out } });
  } catch (e) { sendErr(res, e); }
};

// Expiry register — batches expiring within `within` days (default 90).
exports.expiryRegister = async (req, res) => {
  try {
    const within = Number(req.query.within || 90);
    const cutoff = new Date(Date.now() + within * 86400000);
    const batches = await DrugBatch.find({
      isActive: true, remaining: { $gt: 0 },
      expiryDate: { $lte: cutoff },
    }).sort({ expiryDate: 1 }).populate("drugId", "name category").lean();
    const out = batches.map(b => {
      const days = Math.floor((new Date(b.expiryDate).getTime() - Date.now()) / 86400000);
      return {
        drug: b.drugId?.name || b.drugName,
        category: b.drugId?.category,
        batchNo: b.batchNo,
        supplier: b.supplierName || "—",
        expiryDate: b.expiryDate,
        daysToExpiry: days,
        remaining: b.remaining,
        salePrice: b.salePrice,
        value: (b.remaining || 0) * (b.salePrice || 0),
        status: days < 0 ? "EXPIRED" : days <= 30 ? "URGENT" : days <= 60 ? "SOON" : "WATCH",
      };
    });
    const totalValue = out.reduce((s, r) => s + r.value, 0);
    res.json({ success: true, data: { rows: out, totalValue: Math.round(totalValue) } });
  } catch (e) { sendErr(res, e); }
};

// GST summary — daily/period totals, ready to plug into GSTR-1 / GSTR-3B.
// Includes Completed + Partial-Return + Refunded sales (the original invoice
// is the legal outward supply); refunds are subtracted as a separate credit-
// note bucket per gstRate so the output mirrors GSTR-1 (gross + credit-note).
exports.gstSummary = async (req, res) => {
  try {
    const range = _rangeFilter(req);
    const STATUS_IN = ["Completed", "Partial-Return", "Refunded", "Supplemented"];
    // R7hr-12 (D8-04): also $sum the per-item cgst/sgst/igstAmount columns
    // that dispense() persists per the intra/inter-state placeOfSupply split.
    // Pre-fix the bucket emitted cgst = sgst = tax/2 regardless of placeOfSupply,
    // which silently dropped IGST off the printed register for any inter-state
    // B2B / corporate-panel sale — the same sale then reconciles as IGST in
    // GSTR-1 (via gstService.aggregateGSTForMonth), making the printed register
    // contradict the filing and blocking submission.
    // R7hr-12 (D2-02 related): $sum on Decimal128 inside aggregation is safe
    // (Mongo coerces numerically); the issue was only on the Node side.
    const sales = await Sale.aggregate([
      { $match: { status: { $in: STATUS_IN }, ...range } },
      { $unwind: "$items" },
      { $group: {
        _id: "$items.gstRate",
        taxable: { $sum: "$items.taxableAmount" },
        tax:     { $sum: "$items.gstAmount" },
        cgst:    { $sum: { $ifNull: ["$items.cgstAmount", 0] } },
        sgst:    { $sum: { $ifNull: ["$items.sgstAmount", 0] } },
        igst:    { $sum: { $ifNull: ["$items.igstAmount", 0] } },
        qty:     { $sum: "$items.quantity" },
        billsArr:{ $addToSet: "$_id" },
      } },
      { $project: { gstRate: "$_id", _id: 0, taxable: 1, tax: 1, cgst: 1, sgst: 1, igst: 1, qty: 1, billCount: { $size: "$billsArr" } } },
      { $sort: { gstRate: 1 } },
    ]);
    // Credit-note bucket — refunded items per gstRate.
    // Returned items in PharmacySaleSchema.returns.refundedItems don't currently
    // carry the cgst/sgst/igst split (only gstAmount); derive the split from the
    // parent sale's placeOfSupply by emitting both an interState flag and the
    // raw tax then splitting on the Node side using the salesMap interState ratio.
    const refunds = await Sale.aggregate([
      { $match: { status: { $in: ["Partial-Return", "Refunded"] }, ...range } },
      { $unwind: "$returns" },
      { $unwind: "$returns.refundedItems" },
      { $group: {
        _id: "$returns.refundedItems.gstRate",
        taxable: { $sum: "$returns.refundedItems.taxableAmount" },
        tax:     { $sum: "$returns.refundedItems.gstAmount" },
        qty:     { $sum: "$returns.refundedItems.quantity" },
      } },
    ]);
    const refundMap = new Map(refunds.map(r => [Number(r._id), r]));
    // Debit-note bucket — supplementary items added post-bill per gstRate.
    const supplements = await Sale.aggregate([
      { $match: { status: { $in: ["Supplemented", "Partial-Return"] }, ...range } },
      { $unwind: "$supplements" },
      { $unwind: "$supplements.addedItems" },
      { $group: {
        _id: "$supplements.addedItems.gstRate",
        taxable: { $sum: "$supplements.addedItems.taxableAmount" },
        tax:     { $sum: "$supplements.addedItems.gstAmount" },
        qty:     { $sum: "$supplements.addedItems.quantity" },
      } },
    ]);
    const suppMap = new Map(supplements.map(r => [Number(r._id), r]));
    // Combine all gst rates across the three buckets so we don't drop
    // rates that only appear in supplements / refunds.
    const allRates = new Set([
      ...sales.map(s => Number(s.gstRate)),
      ...refunds.map(r => Number(r._id)),
      ...supplements.map(s => Number(s._id)),
    ]);
    const salesMap = new Map(sales.map(s => [Number(s.gstRate), s]));
    // R7hr-12 (D8-04): coerce every Decimal128 read to Number (Mongo aggregate
    // returns Decimal128 BSON types when the source fields are Decimal128).
    const buckets = [...allRates].sort((a, b) => a - b).map(rate => {
      const r = salesMap.get(rate) || { taxable: 0, tax: 0, cgst: 0, sgst: 0, igst: 0, qty: 0, billCount: 0 };
      const ref = refundMap.get(rate) || { taxable: 0, tax: 0, qty: 0 };
      const sup = suppMap.get(rate) || { taxable: 0, tax: 0, qty: 0 };
      const rTaxable = toNum(r.taxable),  rTax = toNum(r.tax);
      const rCgst    = toNum(r.cgst),     rSgst = toNum(r.sgst), rIgst = toNum(r.igst);
      const refTaxable = toNum(ref.taxable), refTax = toNum(ref.tax);
      const supTaxable = toNum(sup.taxable), supTax = toNum(sup.tax);
      // Split refunds/supplements proportionally on the same intra/inter-state
      // ratio observed in the sales bucket for this rate. If a rate only has
      // refunds (no matching sales row), fall back to intra-state half-split.
      const sumSplitSales = rCgst + rSgst + rIgst;
      const igstShare = sumSplitSales > 0 ? rIgst / sumSplitSales : 0;
      const refIgst = refTax * igstShare,  refCgst = (refTax - refIgst) / 2, refSgst = (refTax - refIgst) / 2;
      const supIgst = supTax * igstShare,  supCgst = (supTax - supIgst) / 2, supSgst = (supTax - supIgst) / 2;
      const netTaxable = rTaxable + supTaxable - refTaxable;
      const netTax     = rTax     + supTax     - refTax;
      const netCgst    = rCgst    + supCgst    - refCgst;
      const netSgst    = rSgst    + supSgst    - refSgst;
      const netIgst    = rIgst    + supIgst    - refIgst;
      return {
        gstRate:  rate,
        qty:      r.qty,
        billCount: r.billCount,
        taxable:  Math.round(rTaxable * 100) / 100,
        tax:      Math.round(rTax     * 100) / 100,
        cgst:     Math.round(rCgst    * 100) / 100,
        sgst:     Math.round(rSgst    * 100) / 100,
        igst:     Math.round(rIgst    * 100) / 100,
        refundQty:     ref.qty,
        refundTaxable: Math.round(refTaxable * 100) / 100,
        refundTax:     Math.round(refTax     * 100) / 100,
        refundCgst:    Math.round(refCgst    * 100) / 100,
        refundSgst:    Math.round(refSgst    * 100) / 100,
        refundIgst:    Math.round(refIgst    * 100) / 100,
        supplementQty:     sup.qty,
        supplementTaxable: Math.round(supTaxable * 100) / 100,
        supplementTax:     Math.round(supTax     * 100) / 100,
        supplementCgst:    Math.round(supCgst    * 100) / 100,
        supplementSgst:    Math.round(supSgst    * 100) / 100,
        supplementIgst:    Math.round(supIgst    * 100) / 100,
        netTaxable:    Math.round(netTaxable * 100) / 100,
        netTax:        Math.round(netTax     * 100) / 100,
        netCgst:       Math.round(netCgst    * 100) / 100,
        netSgst:       Math.round(netSgst    * 100) / 100,
        netIgst:       Math.round(netIgst    * 100) / 100,
      };
    });
    const totals = buckets.reduce((acc, r) => ({
      taxable:           acc.taxable           + r.taxable,
      tax:               acc.tax               + r.tax,
      cgst:              acc.cgst              + r.cgst,
      sgst:              acc.sgst              + r.sgst,
      igst:              acc.igst              + r.igst,
      refundTaxable:     acc.refundTaxable     + r.refundTaxable,
      refundTax:         acc.refundTax         + r.refundTax,
      refundCgst:        acc.refundCgst        + r.refundCgst,
      refundSgst:        acc.refundSgst        + r.refundSgst,
      refundIgst:        acc.refundIgst        + r.refundIgst,
      supplementTaxable: acc.supplementTaxable + r.supplementTaxable,
      supplementTax:     acc.supplementTax     + r.supplementTax,
      supplementCgst:    acc.supplementCgst    + r.supplementCgst,
      supplementSgst:    acc.supplementSgst    + r.supplementSgst,
      supplementIgst:    acc.supplementIgst    + r.supplementIgst,
    }), {
      taxable: 0, tax: 0, cgst: 0, sgst: 0, igst: 0,
      refundTaxable: 0, refundTax: 0, refundCgst: 0, refundSgst: 0, refundIgst: 0,
      supplementTaxable: 0, supplementTax: 0, supplementCgst: 0, supplementSgst: 0, supplementIgst: 0,
    });
    const netTaxable = totals.taxable + totals.supplementTaxable - totals.refundTaxable;
    const netTax     = totals.tax     + totals.supplementTax     - totals.refundTax;
    const netCgst    = totals.cgst    + totals.supplementCgst    - totals.refundCgst;
    const netSgst    = totals.sgst    + totals.supplementSgst    - totals.refundSgst;
    const netIgst    = totals.igst    + totals.supplementIgst    - totals.refundIgst;
    res.json({ success: true, data: {
      buckets,
      grandTaxable:           Math.round(totals.taxable * 100) / 100,
      grandTax:               Math.round(totals.tax     * 100) / 100,
      // R7hr-12 (D8-04): publish the true CGST/SGST/IGST grand totals
      // (sum of bill-level intra/inter-state splits) so the auditor-facing
      // printout no longer contradicts gstService's GSTR-1 feed.
      grandCGST:              Math.round(totals.cgst * 100) / 100,
      grandSGST:              Math.round(totals.sgst * 100) / 100,
      grandIGST:              Math.round(totals.igst * 100) / 100,
      grandRefundTaxable:     Math.round(totals.refundTaxable     * 100) / 100,
      grandRefundTax:         Math.round(totals.refundTax         * 100) / 100,
      grandRefundCGST:        Math.round(totals.refundCgst        * 100) / 100,
      grandRefundSGST:        Math.round(totals.refundSgst        * 100) / 100,
      grandRefundIGST:        Math.round(totals.refundIgst        * 100) / 100,
      grandSupplementTaxable: Math.round(totals.supplementTaxable * 100) / 100,
      grandSupplementTax:     Math.round(totals.supplementTax     * 100) / 100,
      grandSupplementCGST:    Math.round(totals.supplementCgst    * 100) / 100,
      grandSupplementSGST:    Math.round(totals.supplementSgst    * 100) / 100,
      grandSupplementIGST:    Math.round(totals.supplementIgst    * 100) / 100,
      grandNetTaxable:        Math.round(netTaxable * 100) / 100,
      grandNetTax:            Math.round(netTax     * 100) / 100,
      grandNetCGST:           Math.round(netCgst    * 100) / 100,
      grandNetSGST:           Math.round(netSgst    * 100) / 100,
      grandNetIGST:           Math.round(netIgst    * 100) / 100,
    } });
  } catch (e) { sendErr(res, e); }
};

exports.alerts = async (req, res) => {
  try {
    // IST-aware "today" and 90-day horizon (re-audit F-04-2). The
    // pharmacy alerts UI counts batches against the local IST calendar;
    // raw UTC instants drifted the boundary by ~5h30m at midnight.
    const { istStartOfToday, istStartOfDayPlus } = require("../../utils/queryGuards");
    const now = istStartOfToday();
    const horizon = istStartOfDayPlus(90);

    // Low stock: rollup per drug where total remaining < reorderLevel.
    const rollup = await DrugBatch.aggregate([
      { $match: { isActive: true, remaining: { $gt: 0 } } },
      { $group: { _id: "$drugId", drugName: { $first: "$drugName" }, totalRemaining: { $sum: "$remaining" } } },
      { $lookup: { from: "pharmacydrugs", localField: "_id", foreignField: "_id", as: "drug" } },
      { $unwind: { path: "$drug", preserveNullAndEmptyArrays: true } },
      { $match: { $expr: { $lt: ["$totalRemaining", { $ifNull: ["$drug.reorderLevel", 10] }] } } },
      { $project: { drugId: "$_id", drugName: { $ifNull: ["$drug.name", "$drugName"] },
                    totalRemaining: 1, reorderLevel: { $ifNull: ["$drug.reorderLevel", 10] } } },
      { $sort: { totalRemaining: 1 } },
    ]);

    const zeroStock = await Drug.find({ isActive: true }).lean();
    const stockDocs = await DrugBatch.aggregate([
      { $match: { isActive: true, remaining: { $gt: 0 } } },
      { $group: { _id: "$drugId" } },
    ]);
    const stockedIds = new Set(stockDocs.map(s => String(s._id)));
    const outOfStock = zeroStock.filter(d => !stockedIds.has(String(d._id))).map(d => ({
      drugId: d._id, drugName: d.name, totalRemaining: 0, reorderLevel: d.reorderLevel || 10,
    }));

    const expiringSoon = await DrugBatch.find({
      isActive: true, remaining: { $gt: 0 },
      expiryDate: { $lte: horizon, $gte: now },
    }).sort({ expiryDate: 1 }).limit(100).lean();

    const expired = await DrugBatch.find({
      isActive: true, remaining: { $gt: 0 },
      expiryDate: { $lt: now },
    }).sort({ expiryDate: -1 }).limit(100).lean();

    res.json({ success: true, data: { lowStock: rollup, outOfStock, expiringSoon, expired } });
  } catch (e) { sendErr(res, e); }
};
