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
const Settings    = require("../../models/Pharmacy/PharmacySettingsModel");
const PharmacyDayClose = require("../../models/Pharmacy/PharmacyDayCloseModel");
const Counter     = require("../../models/CounterModel");
const Patient     = require("../../models/Patient/patientModel");
const mongoose    = require("mongoose");
const { assertDrugSafeOrOverride } = require("../../utils/allergyCheck");
const scheduleXRegister = require("../../services/Pharmacy/scheduleXRegister");
// R7cu — pulled to module scope so collectCredit() can convert payment
// amounts to Decimal128 + retry on VersionError races (two cashiers
// collecting on the same sale simultaneously).
const { toDec } = require("../../utils/money");
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
    res.json({ success: true, data: drug });
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

    // Issue a GRN number (per-day sequence is fine for now).
    const grnNumber = `GRN-${new Date().toISOString().slice(0,10).replace(/-/g, "")}-${Math.floor(Math.random() * 9000) + 1000}`;

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

    // R7bh-F4 / R7bg-10-CRIT-2: bump the Schedule-X running balance on
    // receipt so the CAS in scheduleXRegister.recordDispense has stock
    // to deduct against. Best-effort — log on failure but don't fail
    // the GRN itself (a missed balance bump shows as 0 in the register
    // and the operator can reconcile manually).
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
      }
    }

    res.status(201).json({ success: true, data: batch, grnNumber });
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
    const seq = await nextSeq("pharmacyBill");
    const billNumber = `PHM-${new Date().toISOString().slice(0,10).replace(/-/g, "")}-${String(seq).padStart(4, "0")}`;

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
    let pharmacyState = "";
    try {
      const setRow = await Settings.findOne({}).select("state").lean();
      pharmacyState = String(setRow?.state || "").trim().toUpperCase();
    } catch (_) { /* settings missing — falls back to intra-state */ }
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
            uhid:          patientUHID || "",
            // NDPS two-person rule — the dispenser is the cashier; we
            // accept an optional witnessId on the body. If missing, the
            // register service will 400; we surface that as a Schedule-X
            // audit warning since the Sale itself is already durable.
            witnessName:   req.body?.witnessName || "",
            witnessId:     req.body?.witnessId   || null,
            dispensedBy:   req.user?.fullName    || "System",
            dispensedById: req.user?._id         || null,
            remarks:       `Sale ${sale.billNumber} — ${sx.drugName}`,
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
  const sales = await Sale.find({
    admissionId,
    // status:"Completed" excludes Cancelled/Refunded sales — they
    // don't carry real balance even if the field is non-zero.
    status:    "Completed",
    saleType:  { $in: ["IPD", "Homecare"] },
  }).select("billNumber grandTotal amountPaid balanceDue items createdAt").lean();
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
    // ── A. PharmacySale-based credit ─────────────────────────────
    // Aggregate PharmacySale → group by admissionId where balanceDue > 0.
    // We do the grouping in JS rather than via $group + $lookup because
    // the typical active-IPD set is small (< 200) and the JS path keeps
    // the Decimal128-unwrap logic identical to getOutstandingForAdmission
    // (single source of truth).
    const rawSales = await Sale.find({
      saleType:    { $in: ["IPD", "Homecare"] },
      status:      "Completed",
      admissionId: { $ne: null },
    }).select("admissionId admissionNumber patientUHID patientName balanceDue grandTotal createdAt billNumber").lean();
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
    const openBills = await PatientBill.find({
      visitType:  "IPD",
      billStatus: { $in: ["DRAFT", "GENERATED", "PARTIAL"] },
      admissionId: { $ne: null },
      $or: [
        { "billItems.category":    { $regex: /^pharmacy$/i } },
        { "billItems.serviceCode": { $regex: /^PHARM-/i }   },
      ],
    }).select("admissionId UHID patientName billItems balanceAmount billStatus billNumber createdAt").lean();
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
      const key = String(b.admissionId);
      const cur = byAdm.get(key) || {
        admissionId:     b.admissionId,
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
        consultant:     a.primaryConsultant || "",
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
      .select("admissionNumber UHID patientId bedId wardName department primaryConsultant status admissionDate")
      .populate("patientId", "fullName age gender contactNumber")
      .populate("bedId",     "bedNumber wardName")
      .lean();
    if (!adm) return res.status(404).json({ success: false, message: "Admission not found" });
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
    const since = new Date(); since.setDate(since.getDate() - days);
    since.setHours(0, 0, 0, 0);
    const sales = await Sale.find({
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
    })
      .select("billNumber admissionId admissionNumber patientUHID patientName grandTotal amountPaid balanceDue items createdAt paymentMode collectionLog")
      .sort({ createdAt: -1 })
      .lean();

    // Group by dateKey (YYYY-MM-DD in server-local timezone — fine
    // for India-deployed servers; if multi-tz becomes a concern we
    // switch to IST via Intl.DateTimeFormat like cron jobs do).
    const byDay = new Map();
    for (const s of sales) {
      const dKey = s.createdAt
        ? new Date(s.createdAt).toISOString().slice(0, 10)
        : "unknown";
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
    const indentBills = await PatientBill.find({
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
    })
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
      const byDateOnBill = new Map();
      for (const it of pharmItems) {
        const when  = it.chargeDate ? new Date(it.chargeDate) : (b.createdAt ? new Date(b.createdAt) : null);
        if (!when || when < since) continue;
        const dKey = when.toISOString().slice(0, 10);
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
        receiptNumber = `PHM-COLL-${new Date().toISOString().slice(0,10).replace(/-/g, "")}-${String(seq).padStart(4, "0")}`;
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

    const sale = await Sale.findById(req.params.id);
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
    const seq = await nextSeq("pharmacyRefund");
    const refundSlipNumber = `REF-PHM-${new Date().toISOString().slice(0,10).replace(/-/g, "")}-${String(seq).padStart(4, "0")}`;

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
    sale.returns.push(returnRecord);

    // Decide new status — fully returned (sum of all returned == sum of all sold)
    // → Refunded; partially returned → Partial-Return.
    const totalSoldQty = (sale.items || []).reduce((s, it) => s + Number(it.quantity || 0), 0);
    const totalReturnedQty = (sale.returns || []).reduce(
      (s, r) => s + (r.refundedItems || []).reduce((ss, ri) => ss + Number(ri.quantity || 0), 0), 0);
    sale.status = totalReturnedQty >= totalSoldQty ? "Refunded" : "Partial-Return";

    // Money flow on refund:
    //   1. If patient still owed money on this bill (balanceDue > 0),
    //      first knock that off — patient now owes less.
    //   2. Any refund amount LEFT OVER after that is money the pharmacy
    //      must pay back. How we account for it depends on refundMode:
    //        • Cash / Card / UPI — paid out at counter now, no ledger entry.
    //        • Credit-note / Adjusted — pharmacy still holds the money
    //          (will offset future bill or be paid out later), so it goes
    //          to patientCredit as a positive balance.
    const due       = Number(sale.balanceDue || 0);
    const dueOffset = Math.min(due, refundAmount);
    sale.balanceDue = round2(due - dueOffset);
    const payable   = round2(refundAmount - dueOffset);

    if (payable > 0 && (refundMode === "Credit-note" || refundMode === "Adjusted")) {
      sale.patientCredit = round2((sale.patientCredit || 0) + payable);
      sale.patientCreditLog.push({
        amount: payable,
        reason: `Refund (${refundMode})`,
        refSlip: refundSlipNumber,
        byName: req.user?.fullName || req.user?.name || "System",
        byId:   req.user?._id || null,
      });
    }

    sale.remarks = (sale.remarks ? sale.remarks + " · " : "") +
      `Returned ${refundedItems.length} line(s) · refund ${refundSlipNumber} · ${fmtINRSimple(refundAmount)} via ${refundMode}` +
      (payable > 0 && (refundMode === "Credit-note" || refundMode === "Adjusted")
        ? ` · credit ${fmtINRSimple(payable)} held for patient` : "");

    await sale.save();

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

    const sale = await Sale.findById(req.params.id);
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
    const seq = await nextSeq("pharmacySupplement");
    const supplementSlipNumber = `SUP-PHM-${new Date().toISOString().slice(0,10).replace(/-/g, "")}-${String(seq).padStart(4, "0")}`;

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
    sale.supplements.push(supplementRecord);

    // Roll up balanceDue + patient credit on the parent sale.
    // Any unpaid portion of the supplement is added to the parent's balanceDue.
    sale.balanceDue = round2((sale.balanceDue || 0) + Math.max(0, addedTotal - paid));
    // If the patient over-paid for the supplement, treat the excess as credit.
    const overPaid = Math.max(0, paid - addedTotal);
    if (overPaid > 0) {
      sale.patientCredit = round2((sale.patientCredit || 0) + overPaid);
      sale.patientCreditLog.push({
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
    if (sale.status === "Completed") sale.status = "Supplemented";

    sale.remarks = (sale.remarks ? sale.remarks + " · " : "") +
      `Added ${addedItems.length} line(s) · slip ${supplementSlipNumber} · ${fmtINRSimple(addedTotal)} via ${paymentMode}`;

    await sale.save();

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

    // 5. Money flow + remarks via versioned save with retry. We touch
    //    patientCredit / patientCreditLog (arrays) so optimistic
    //    concurrency can collide if another endpoint pushed credit
    //    mid-flight.
    const refundedSoFar  = (s.returns || []).reduce((t, r) => t + Number(r.refundAmount || 0), 0);
    const payable        = Math.max(0, Number(s.amountPaid || 0) - refundedSoFar);

    try {
      const retryVersionError = require("../../utils/retryVersionError");
      await retryVersionError(async () => {
        const fresh = await Sale.findById(s._id);
        if (!fresh) return;
        if (payable > 0) {
          fresh.patientCredit = round2((fresh.patientCredit || 0) + payable);
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

    res.json({ success: true, data: s });
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
    const batch = await DrugBatch.findById(batchId);
    if (!batch) return res.status(404).json({ success: false, message: "Batch not found" });
    const remaining = Math.max(0, (batch.quantityIn || 0) - (batch.quantityOut || 0) - (batch.vendorReturned || 0));
    if (qtyN > remaining) {
      return res.status(409).json({
        success: false,
        code: "INSUFFICIENT_STOCK",
        message: `Cannot return ${qtyN} — only ${remaining} remaining in batch ${batch.batchNo}.`,
      });
    }
    batch.vendorReturned = (batch.vendorReturned || 0) + qtyN;
    // remaining is recomputed by pre-save hook (in - out - vendorReturned).
    await batch.save();

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
    try {
      const { emit } = require("../../models/Billing/BillingAudit");
      await emit({
        event:     "ITEM_PRICE_OVERRIDDEN",  // re-used enum bucket
        actorId:   req.user?._id || req.user?.id,
        actorName: req.user?.fullName,
        actorRole: req.user?.role,
        amount:    qtyN * Number(batch.purchaseRate || 0),
        reason:    `VENDOR_RETURN: ${batch.drugName || ""} batch ${batch.batchNo} qty=${qtyN} reason=${reason || "EXPIRED"} (debit-note ${debitNoteNo || "—"})`,
        before:    { remaining, vendorReturned: (batch.vendorReturned || 0) - qtyN },
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
const _MAX_RANGE_MS = 90 * 86400000;
function _assertRange(req) {
  const { from, to } = req.query;
  if (!from || !to) return { ok: true };
  const f = new Date(from).getTime();
  const t = new Date(to).getTime();
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
    const out = rows.map(s => {
      const hsnMap = new Map();
      let totalDisc = 0;
      for (const it of (s.items || [])) {
        const key = `${it.gstRate || 12}`;
        if (!hsnMap.has(key)) hsnMap.set(key, { gstRate: Number(key), taxable: 0, tax: 0 });
        const r = hsnMap.get(key);
        r.taxable += Number(it.taxableAmount || 0);
        r.tax     += Number(it.gstAmount    || 0);
        totalDisc += Number(it.discountAmount || 0);
      }
      const refundAmount     = (s.returns || []).reduce((t, r) => t + Number(r.refundAmount || 0), 0);
      const supplementAmount = (s.supplements || []).reduce((t, x) => t + Number(x.addedTotal || 0), 0);
      const netEffective     = Math.max(0, Number(s.grandTotal || 0) + supplementAmount - refundAmount);
      return {
        _id: s._id,
        billNumber: s.billNumber,
        date: s.createdAt,
        patientName: s.patientName || "Walk-in",
        patientUHID: s.patientUHID || "",
        admissionNumber: s.admissionNumber || "",
        saleType: s.saleType,
        paymentMode: s.paymentMode,
        status: s.status,
        itemsCount: s.items?.length || 0,
        returnsCount: (s.returns || []).length,
        supplementsCount: (s.supplements || []).length,
        subTotal: s.subTotal,
        discount: totalDisc,
        taxable: s.totalTaxable,
        cgst: Math.round(s.totalGst / 2 * 100) / 100,
        sgst: Math.round(s.totalGst / 2 * 100) / 100,
        gstTotal: s.totalGst,
        grandTotal: s.grandTotal,
        refundAmount,                  // sum of all return slips (credit notes)
        supplementAmount,              // sum of all supplement slips (debit notes)
        netAfterReturns: netEffective, // grandTotal + supplements − refunds
        hsnBreakup: [...hsnMap.values()],
      };
    });
    const totals = rows.reduce((acc, s) => {
      const refundAmount     = (s.returns || []).reduce((t, r) => t + Number(r.refundAmount || 0), 0);
      const supplementAmount = (s.supplements || []).reduce((t, x) => t + Number(x.addedTotal || 0), 0);
      acc.bills += 1;
      acc.subTotal     += s.subTotal     || 0;
      acc.taxable      += s.totalTaxable || 0;
      acc.gstTotal     += s.totalGst     || 0;
      acc.grandTotal   += s.grandTotal   || 0;
      acc.refunds      += refundAmount;
      acc.supplements  += supplementAmount;
      acc.net          += Math.max(0, (s.grandTotal || 0) + supplementAmount - refundAmount);
      return acc;
    }, { bills: 0, subTotal: 0, taxable: 0, gstTotal: 0, grandTotal: 0, refunds: 0, supplements: 0, net: 0 });
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
    const where = {
      status: { $in: ["Completed", "Partial-Return", "Refunded", "Supplemented"] },
      ..._rangeFilter(req),
    };
    const sales = await Sale.find(where).sort({ createdAt: 1 }).lean();
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

      // ── Supplementary items (debit notes) — Schedule H items added
      //    AFTER the original bill are equally regulated and must show
      //    up in the register with their slip number for audit.
      for (const sup of (s.supplements || [])) {
        for (const it of (sup.addedItems || [])) {
          const d = await getDrug(it.drugId);
          if (d && /^(H|H1|X)$/i.test(d.schedule || "")) {
            out.push({
              date: sup.addedAt || s.createdAt,
              billNumber: s.billNumber + " · " + (sup.supplementSlipNumber || "SUP"),
              patientName: s.patientName || "—",
              patientUHID: s.patientUHID || "—",
              doctorName:  s.doctorName  || "—",
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
          out.push({
            date: s.createdAt,
            billNumber: s.billNumber,
            patientName: s.patientName || "—",
            patientUHID: s.patientUHID || "—",
            doctorName:  s.doctorName  || "—",
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
    const sales = await Sale.aggregate([
      { $match: { status: { $in: STATUS_IN }, ...range } },
      { $unwind: "$items" },
      { $group: {
        _id: "$items.gstRate",
        taxable: { $sum: "$items.taxableAmount" },
        tax:     { $sum: "$items.gstAmount" },
        qty:     { $sum: "$items.quantity" },
        billsArr:{ $addToSet: "$_id" },
      } },
      { $project: { gstRate: "$_id", _id: 0, taxable: 1, tax: 1, qty: 1, billCount: { $size: "$billsArr" } } },
      { $sort: { gstRate: 1 } },
    ]);
    // Credit-note bucket — refunded items per gstRate.
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
    const buckets = [...allRates].sort((a, b) => a - b).map(rate => {
      const r = salesMap.get(rate) || { taxable: 0, tax: 0, qty: 0, billCount: 0 };
      const ref = refundMap.get(rate) || { taxable: 0, tax: 0, qty: 0 };
      const sup = suppMap.get(rate) || { taxable: 0, tax: 0, qty: 0 };
      const netTaxable = r.taxable + sup.taxable - ref.taxable;
      const netTax     = r.tax     + sup.tax     - ref.tax;
      return {
        gstRate:  rate,
        qty:      r.qty,
        billCount: r.billCount,
        taxable:  Math.round(r.taxable * 100) / 100,
        tax:      Math.round(r.tax     * 100) / 100,
        cgst:     Math.round(r.tax / 2 * 100) / 100,
        sgst:     Math.round(r.tax / 2 * 100) / 100,
        refundQty:     ref.qty,
        refundTaxable: Math.round(ref.taxable * 100) / 100,
        refundTax:     Math.round(ref.tax     * 100) / 100,
        supplementQty:     sup.qty,
        supplementTaxable: Math.round(sup.taxable * 100) / 100,
        supplementTax:     Math.round(sup.tax     * 100) / 100,
        netTaxable:    Math.round(netTaxable  * 100) / 100,
        netTax:        Math.round(netTax      * 100) / 100,
      };
    });
    const totals = buckets.reduce((acc, r) => ({
      taxable:           acc.taxable           + r.taxable,
      tax:               acc.tax               + r.tax,
      refundTaxable:     acc.refundTaxable     + r.refundTaxable,
      refundTax:         acc.refundTax         + r.refundTax,
      supplementTaxable: acc.supplementTaxable + r.supplementTaxable,
      supplementTax:     acc.supplementTax     + r.supplementTax,
    }), { taxable: 0, tax: 0, refundTaxable: 0, refundTax: 0, supplementTaxable: 0, supplementTax: 0 });
    const netTaxable = totals.taxable + totals.supplementTaxable - totals.refundTaxable;
    const netTax     = totals.tax     + totals.supplementTax     - totals.refundTax;
    res.json({ success: true, data: {
      buckets,
      grandTaxable:           Math.round(totals.taxable * 100) / 100,
      grandTax:               Math.round(totals.tax     * 100) / 100,
      grandCGST:              Math.round(totals.tax / 2 * 100) / 100,
      grandSGST:              Math.round(totals.tax / 2 * 100) / 100,
      grandRefundTaxable:     Math.round(totals.refundTaxable     * 100) / 100,
      grandRefundTax:         Math.round(totals.refundTax         * 100) / 100,
      grandSupplementTaxable: Math.round(totals.supplementTaxable * 100) / 100,
      grandSupplementTax:     Math.round(totals.supplementTax     * 100) / 100,
      grandNetTaxable:        Math.round(netTaxable * 100) / 100,
      grandNetTax:            Math.round(netTax     * 100) / 100,
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
