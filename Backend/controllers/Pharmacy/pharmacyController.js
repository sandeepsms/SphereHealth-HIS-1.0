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
      const days = Number(expiringIn);
      where.expiryDate = { $lte: new Date(Date.now() + days * 86400000) };
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
   DISPENSE — FIFO consume by expiry
══════════════════════════════════════════════════════════════════ */
async function fifoConsume(drugId, qty) {
  // Pull batches with remaining > 0 in expiry order. Walk them, decrementing,
  // until we've consumed `qty`. Returns the list of {batch, used}.
  const batches = await DrugBatch.find({
    drugId, isActive: true, remaining: { $gt: 0 },
  }).sort({ expiryDate: 1 });

  const used = [];
  let need = qty;
  for (const b of batches) {
    if (need <= 0) break;
    const take = Math.min(b.remaining, need);
    b.quantityOut = (b.quantityOut || 0) + take;
    b.remaining   = (b.remaining   || 0) - take;
    await b.save();
    used.push({ batch: b, used: take });
    need -= take;
  }
  if (need > 0) throw new Error(`Insufficient stock — short by ${need} unit(s)`);
  return used;
}

exports.dispense = async (req, res) => {
  try {
    const {
      patientUHID, patientName, contactNumber, age, gender, doctorName,
      saleType = "Walk-in", admissionId, admissionNumber, prescriptionRef,
      items, paymentMode = "Cash", amountPaid, discountPercent = 0, remarks,
    } = req.body;

    // Validate admissionId if present
    if (admissionId && !isOid(admissionId)) {
      return res.status(400).json({ success: false, message: "Invalid admissionId" });
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

    // Pre-flight: enough stock?
    for (const it of items) {
      const have = await DrugBatch.aggregate([
        { $match: { drugId: new mongoose.Types.ObjectId(it.drugId), isActive: true, remaining: { $gt: 0 } } },
        { $group: { _id: null, total: { $sum: "$remaining" } } },
      ]);
      const total = have[0]?.total || 0;
      if (total < Number(it.quantity)) {
        return res.status(409).json({
          success: false,
          message: `Insufficient stock for ${it.drugName} — need ${it.quantity}, have ${total}`,
        });
      }
    }

    // Consume FIFO and build sale items with batch info.
    const saleItems = [];
    let subTotal = 0, totalGst = 0, totalDisc = 0;
    for (const it of items) {
      const used = await fifoConsume(it.drugId, Number(it.quantity));
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

    const sale = await Sale.create({
      billNumber,
      patientUHID, patientName, contactNumber, age, gender, doctorName,
      saleType, admissionId: admissionId || null, admissionNumber: admissionNumber || "",
      prescriptionRef: prescriptionRef || "",
      items: saleItems,
      subTotal, totalDiscount: totalDisc, totalTaxable, totalGst,
      roundOff, grandTotal,
      paymentMode, amountPaid: paid,
      balanceDue: Math.max(0, grandTotal - paid),
      status: "Completed",
      createdBy: req.user?.fullName || "System",
      createdById: req.user?._id || null,
      remarks: remarks || "",
    });
    res.json({ success: true, data: sale });
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

exports.cancelSale = async (req, res) => {
  try {
    if (!isOid(req.params.id)) return res.status(400).json({ success: false, message: "Invalid sale id" });
    const s = await Sale.findById(req.params.id);
    if (!s) return res.status(404).json({ success: false, message: "Sale not found" });
    if (s.status !== "Completed") return res.status(400).json({ success: false, message: "Only completed sales can be cancelled" });

    // Restore stock to the original batches.
    for (const it of s.items) {
      if (!it.batchId) continue;
      const b = await DrugBatch.findById(it.batchId);
      if (b) {
        b.quantityOut = Math.max(0, (b.quantityOut || 0) - it.quantity);
        b.remaining   = (b.quantityIn || 0) - (b.quantityOut || 0);
        await b.save();
      }
    }
    s.status = "Cancelled";
    s.remarks = (s.remarks ? s.remarks + " · " : "") + `Cancelled by ${req.user?.fullName || "System"} on ${new Date().toISOString()}`;
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

    const [drugsCount, batches, todaySalesAgg, monthSalesAgg] = await Promise.all([
      Drug.countDocuments({ isActive: true }),
      DrugBatch.find({ isActive: true, remaining: { $gt: 0 } }).lean(),
      Sale.aggregate([
        { $match: { status: "Completed", createdAt: { $gte: todayStart } } },
        { $group: { _id: null, count: { $sum: 1 }, total: { $sum: "$grandTotal" } } },
      ]),
      Sale.aggregate([
        { $match: { status: "Completed", createdAt: { $gte: new Date(now.getFullYear(), now.getMonth(), 1) } } },
        { $group: { _id: null, count: { $sum: 1 }, total: { $sum: "$grandTotal" } } },
      ]),
    ]);

    const stockValue = batches.reduce((s, b) => s + (b.remaining * (b.salePrice || b.mrp || 0)), 0);
    const expiringCount = batches.filter(b => b.expiryDate && new Date(b.expiryDate) <= new Date(Date.now() + 90 * 86400000)).length;
    const expiredCount  = batches.filter(b => b.expiryDate && new Date(b.expiryDate) < now).length;

    res.json({ success: true, data: {
      drugsCount,
      batchesInStock: batches.length,
      stockValue: Math.round(stockValue),
      expiringWithin90Days: expiringCount,
      alreadyExpired: expiredCount,
      todaySales: { count: todaySalesAgg[0]?.count || 0, total: Math.round(todaySalesAgg[0]?.total || 0) },
      monthSales: { count: monthSalesAgg[0]?.count || 0, total: Math.round(monthSalesAgg[0]?.total || 0) },
    } });
  } catch (e) { sendErr(res, e); }
};

exports.alerts = async (req, res) => {
  try {
    const now = new Date();
    const horizon = new Date(Date.now() + 90 * 86400000);

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
