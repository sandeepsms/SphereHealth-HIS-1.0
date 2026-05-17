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
const Settings    = require("../../models/Pharmacy/PharmacySettingsModel");
const Counter     = require("../../models/CounterModel");
const mongoose    = require("mongoose");

const todayISO  = () => new Date().toISOString().slice(0, 10);
const isOid     = (v) => mongoose.Types.ObjectId.isValid(v);
// Centralised error reply — Mongoose ValidationError → 400, bad cast → 400,
// duplicate key → 409, everything else → 500. Caller passes (res, err).
const sendErr   = (res, e) => {
  if (e?.name === "ValidationError") {
    const msg = Object.values(e.errors).map(x => x.message).join("; ");
    return res.status(400).json({ success: false, message: msg });
  }
  if (e?.name === "CastError") {
    return res.status(400).json({ success: false, message: `Invalid id / cast — ${e.path}` });
  }
  if (e?.code === 11000) {
    return res.status(409).json({ success: false, message: "Duplicate key — record already exists" });
  }
  return res.status(500).json({ success: false, message: e?.message || "Server error" });
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

exports.searchDrugs = async (req, res) => {
  try {
    const q = (req.query.q || "").trim();
    if (!q) return res.json({ success: true, data: [] });
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    const drugs = await Drug.find({ isActive: true, $or: [{ name: rx }, { genericName: rx }, { brandName: rx }] })
      .limit(25).lean();
    res.json({ success: true, data: drugs });
  } catch (e) { sendErr(res, e); }
};

exports.createDrug = async (req, res) => {
  try {
    const drug = await Drug.create({ ...req.body, createdBy: req.user?.fullName || "System" });
    res.json({ success: true, data: drug });
  } catch (e) { sendErr(res, e); }
};

exports.updateDrug = async (req, res) => {
  try {
    if (!isOid(req.params.id)) return res.status(400).json({ success: false, message: "Invalid drug id" });
    const drug = await Drug.findByIdAndUpdate(
      req.params.id,
      { $set: { ...req.body, updatedBy: req.user?.fullName || "System" } },
      { new: true, runValidators: true }
    );
    if (!drug) return res.status(404).json({ success: false, message: "Drug not found" });
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
    const items = await Supplier.find({ isActive: true }).sort({ name: 1 }).lean();
    res.json({ success: true, data: items });
  } catch (e) { sendErr(res, e); }
};
exports.createSupplier = async (req, res) => {
  try {
    const s = await Supplier.create({ ...req.body, createdBy: req.user?.fullName || "System" });
    res.json({ success: true, data: s });
  } catch (e) { sendErr(res, e); }
};
exports.updateSupplier = async (req, res) => {
  try {
    if (!isOid(req.params.id)) return res.status(400).json({ success: false, message: "Invalid supplier id" });
    const s = await Supplier.findByIdAndUpdate(req.params.id,
      { $set: { ...req.body, updatedBy: req.user?.fullName || "System" } }, { new: true, runValidators: true });
    if (!s) return res.status(404).json({ success: false, message: "Supplier not found" });
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
    res.json({ success: true, data: batch, grnNumber });
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
      items, paymentMode = "Cash", amountPaid, discountPercent = 0, remarks,
    } = req.body;

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
        return res.status(400).json({ success: false, message: `Invalid drugId on item "${it.drugName || ""}"` });
      }
      const q = Number(it.quantity);
      if (!Number.isFinite(q) || q <= 0) {
        return res.status(400).json({ success: false, message: `Invalid quantity for "${it.drugName || it.drugId}" — must be > 0` });
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
    const saleItems = [];
    let subTotal = 0, totalGst = 0, totalDisc = 0;
    const consumedAll = []; // [{ batchId, qty }] across all items, for rollback
    try {
    for (const it of items) {
      const used = await fifoConsume(it.drugId, Number(it.quantity));
      // Track what we reserved so we can undo if a later item fails.
      for (const u of used) consumedAll.push({ batchId: u.batch._id, qty: u.used });
      // If split across batches, write one sale row per batch — keeps audit clean.
      for (const u of used) {
        const qty   = u.used;
        const unit  = Number(it.unitPrice || u.batch.salePrice || 0);
        const gstR  = Number(it.gstRate ?? 12);
        const discR = Number(it.discountPercent ?? discountPercent ?? 0);
        const gross = qty * unit;
        const discAmt = gross * discR / 100;
        const taxable = gross - discAmt;
        const gstAmt  = taxable * gstR / 100;
        const net     = taxable + gstAmt;
        saleItems.push({
          drugId: it.drugId, drugName: it.drugName,
          batchId: u.batch._id, batchNo: u.batch.batchNo, expiryDate: u.batch.expiryDate,
          quantity: qty, unitPrice: unit, gstRate: gstR, discountPercent: discR,
          grossAmount: gross, discountAmount: discAmt,
          taxableAmount: taxable, gstAmount: gstAmt, netAmount: net,
        });
        subTotal  += gross;
        totalDisc += discAmt;
        totalGst  += gstAmt;
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
      paymentMode, amountPaid: paid,
      balanceDue,
      patientCredit:    round2(overPaid),
      patientCreditLog: creditLog,
      status: "Completed",
      createdBy: req.user?.fullName || "System",
      createdById: req.user?._id || null,
      remarks: remarks || "",
    });
    res.json({ success: true, data: sale });
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
    const sales = await Sale.find(where).sort({ createdAt: -1 }).limit(500).lean();
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
    if (!isOid(req.params.id)) return res.status(400).json({ success: false, message: "Invalid sale id" });
    const { items = [], paymentMode = "Cash", amountPaid, discountPercent = 0, reason = "", notes = "" } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: "items[] is required — at least one item to add" });
    }
    if (!["Cash","Card","UPI","Mixed","Credit"].includes(paymentMode)) {
      return res.status(400).json({ success: false, message: "Invalid paymentMode" });
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
        const unit  = Number(it.unitPrice || u.batch.salePrice || 0);
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

    res.json({ success: true, data: { sale, supplementRecord } });
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

exports.cancelSale = async (req, res) => {
  try {
    if (!isOid(req.params.id)) return res.status(400).json({ success: false, message: "Invalid sale id" });
    const s = await Sale.findById(req.params.id);
    if (!s) return res.status(404).json({ success: false, message: "Sale not found" });
    // Block cancellation if returns have already been issued — those refund
    // slips have left the counter and adjusting them retroactively would
    // mis-balance the GST register. Operator must reverse returns first.
    if ((s.returns || []).length > 0) {
      return res.status(409).json({
        success: false,
        message: "Cannot cancel — this sale has refund slips on it. Reverse refunds first.",
      });
    }
    if (s.status !== "Completed") {
      return res.status(400).json({ success: false, message: `Only Completed sales can be cancelled (current: ${s.status})` });
    }

    // Per-item returned-qty map so we never over-restore stock.
    const returnedByItem = {};
    for (const r of (s.returns || [])) {
      for (const ri of (r.refundedItems || [])) {
        const k = String(ri.saleItemId || "");
        if (!k) continue;
        returnedByItem[k] = (returnedByItem[k] || 0) + Number(ri.quantity || 0);
      }
    }

    // Restore stock to the original batches — only what wasn't already returned.
    for (const it of s.items) {
      if (!it.batchId) continue;
      const alreadyReturned = returnedByItem[String(it._id)] || 0;
      const restoreQty = Math.max(0, Number(it.quantity || 0) - alreadyReturned);
      if (restoreQty <= 0) continue;
      const b = await DrugBatch.findById(it.batchId);
      if (b) {
        b.quantityOut = Math.max(0, (b.quantityOut || 0) - restoreQty);
        b.remaining   = Math.max(0, (b.quantityIn || 0) - (b.quantityOut || 0));
        await b.save();
      }
    }

    // Money: any amount the patient already paid (minus refunds already
    // issued) becomes patientCredit, since on cancellation we can't
    // assume the cashier pays cash back instantly. The frontend can
    // surface this for counter-staff payout.
    const refundedSoFar  = (s.returns || []).reduce((t, r) => t + Number(r.refundAmount || 0), 0);
    const payable        = Math.max(0, Number(s.amountPaid || 0) - refundedSoFar);
    if (payable > 0) {
      s.patientCredit = round2((s.patientCredit || 0) + payable);
      s.patientCreditLog.push({
        amount: payable,
        reason: "Sale cancelled — payment held as credit",
        refSlip: s.billNumber,
        byName: req.user?.fullName || "System",
        byId:   req.user?._id || null,
      });
    }
    s.balanceDue = 0;
    s.status = "Cancelled";
    s.remarks = (s.remarks ? s.remarks + " · " : "") + `Cancelled by ${req.user?.fullName || "System"} on ${new Date().toISOString()}` +
      (payable > 0 ? ` · ${fmtINRSimple(payable)} held as credit` : "");
    await s.save();
    res.json({ success: true, data: s });
  } catch (e) { sendErr(res, e); }
};

/* ════════════════════════════════════════════════════════════════
   DASHBOARD STATS + ALERTS
══════════════════════════════════════════════════════════════════ */
exports.stats = async (req, res) => {
  try {
    const now = new Date();
    const todayStart = new Date(); todayStart.setHours(0,0,0,0);

    const monthStart  = new Date(now.getFullYear(), now.getMonth(), 1);
    // Sales counted are anything that left the counter as a tax invoice —
    // Completed + Partial-Return + Refunded. Refunds are subtracted as a
    // separate aggregation so revenue is net of returns (matches register).
    const SALE_STATUSES = ["Completed", "Partial-Return", "Refunded", "Supplemented"];
    const [drugsCount, batches, todaySalesAgg, monthSalesAgg, todayRefundAgg, monthRefundAgg, todaySuppAgg, monthSuppAgg] = await Promise.all([
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
      // Today's supplements — added items on existing bills (debit notes)
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

    const stockValue = batches.reduce((s, b) => s + (b.remaining * (b.salePrice || b.mrp || 0)), 0);
    const expiringCount = batches.filter(b => b.expiryDate && new Date(b.expiryDate) <= new Date(Date.now() + 90 * 86400000)).length;
    const expiredCount  = batches.filter(b => b.expiryDate && new Date(b.expiryDate) < now).length;

    const tGross  = todaySalesAgg[0]?.total || 0;
    const tRefund = todayRefundAgg[0]?.refund || 0;
    const tSupp   = todaySuppAgg[0]?.supp || 0;
    const mGross  = monthSalesAgg[0]?.total || 0;
    const mRefund = monthRefundAgg[0]?.refund || 0;
    const mSupp   = monthSuppAgg[0]?.supp || 0;

    res.json({ success: true, data: {
      drugsCount,
      batchesInStock: batches.length,
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
exports.getSettings = async (req, res) => {
  try {
    const s = await Settings.findById("default").lean();
    if (!s) {
      // Return a default doc on first load so the frontend has shape to bind to.
      const seeded = await Settings.create({ _id: "default" });
      return res.json({ success: true, data: seeded });
    }
    res.json({ success: true, data: s });
  } catch (e) { sendErr(res, e); }
};

exports.updateSettings = async (req, res) => {
  try {
    const body = { ...req.body, updatedBy: req.user?.fullName || "System" };
    delete body._id;
    const s = await Settings.findByIdAndUpdate(
      "default",
      { $set: body },
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

// Sales register — bill-wise with HSN-wise GST split.
// Includes Completed + Partial-Return + Refunded so the audit trail is
// complete. Refund deltas are reported in their own column so the row
// shows ORIGINAL totals (legal source) with a refund tail.
exports.salesRegister = async (req, res) => {
  try {
    const where = {
      status: { $in: ["Completed", "Partial-Return", "Refunded", "Supplemented"] },
      ..._rangeFilter(req),
    };
    const rows = await Sale.find(where).sort({ createdAt: 1 }).lean();
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
    const where = { isActive: true, ..._rangeFilter(req, "createdAt") };
    const batches = await DrugBatch.find(where).sort({ createdAt: 1 })
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
exports.stockRegister = async (req, res) => {
  try {
    const { from, to } = req.query;
    const start = from ? new Date(from) : new Date(Date.now() - 30 * 86400000);
    const end   = to   ? new Date(new Date(to).getTime() + 86399_999) : new Date();

    const drugs = await Drug.find({ isActive: true }).lean();
    const out = [];
    for (const d of drugs) {
      const allBatches = await DrugBatch.find({ drugId: d._id, isActive: true }).lean();
      const opening = allBatches
        .filter(b => new Date(b.createdAt) < start)
        .reduce((s, b) => s + (b.quantityIn || 0), 0);
      const receipts = allBatches
        .filter(b => new Date(b.createdAt) >= start && new Date(b.createdAt) <= end)
        .reduce((s, b) => s + (b.quantityIn || 0), 0);
      // Issued in range = sum(items.quantity from sales in range)
      //                 − sum(returns.refundedItems.quantity from sales in range)
      // Includes Partial-Return + Refunded sales so the audit is honest about
      // what stock actually left the pharmacy.
      const issuedAgg = await Sale.aggregate([
        { $match: {
            status: { $in: ["Completed", "Partial-Return", "Refunded", "Supplemented"] },
            createdAt: { $gte: start, $lte: end },
          } },
        { $unwind: "$items" },
        { $match: { "items.drugId": d._id } },
        { $group: { _id: null, qty: { $sum: "$items.quantity" } } },
      ]);
      const grossIssued = issuedAgg[0]?.qty || 0;

      // Add supplementary items (debit notes) — these are stock that
      // left the pharmacy AFTER the original bill, so they count
      // against opening + receipts.
      const supplementAgg = await Sale.aggregate([
        { $match: {
            status: { $in: ["Supplemented", "Partial-Return"] },
            createdAt: { $gte: start, $lte: end },
          } },
        { $unwind: "$supplements" },
        { $unwind: "$supplements.addedItems" },
        { $match: { "supplements.addedItems.drugId": d._id } },
        { $group: { _id: null, qty: { $sum: "$supplements.addedItems.quantity" } } },
      ]);
      const supplementQty = supplementAgg[0]?.qty || 0;

      const returnedAgg = await Sale.aggregate([
        { $match: {
            status: { $in: ["Partial-Return", "Refunded"] },
            createdAt: { $gte: start, $lte: end },
          } },
        { $unwind: "$returns" },
        { $unwind: "$returns.refundedItems" },
        { $match: { "returns.refundedItems.drugId": d._id } },
        { $group: { _id: null, qty: { $sum: "$returns.refundedItems.quantity" } } },
      ]);
      const returnedQty = returnedAgg[0]?.qty || 0;
      const issued = Math.max(0, grossIssued + supplementQty - returnedQty);
      const closing = allBatches.reduce((s, b) => s + (b.remaining || 0), 0);
      if (opening || receipts || issued || closing) {
        out.push({
          drugId: d._id, drugName: d.name, category: d.category, hsn: d.hsnCode || "30049099",
          opening, receipts, issued, closing,
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
