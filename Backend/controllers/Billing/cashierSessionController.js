// controllers/Billing/cashierSessionController.js
// R7ap-F20/C-13/D6-01: CashierSession backend endpoints.
const CashierSession = require("../../models/Billing/CashierSession");
const PatientBill    = require("../../models/PatientBillModel/PatientBillModel");
const PatientAdvance = require("../../models/PatientBillModel/PatientAdvanceModel");
const { toNum }      = require("../../utils/money");

// GET /api/cashier-sessions/current — currently-OPEN shift for the authed cashier
exports.getCurrentSession = async (req, res, next) => {
  try {
    const cashierId = req.user?._id;
    if (!cashierId) return res.status(401).json({ success: false, message: "Authentication required" });
    const session = await CashierSession.findOne({ cashierId, status: "OPEN" }).lean();
    res.json({ success: true, data: session || null });
  } catch (e) { next(e); }
};

// POST /api/cashier-sessions/open  { openingCash, openNotes? }
exports.openSession = async (req, res, next) => {
  try {
    const cashierId = req.user?._id;
    if (!cashierId) return res.status(401).json({ success: false, message: "Authentication required" });
    const openingCash = toNum(req.body?.openingCash);
    if (!Number.isFinite(openingCash) || openingCash < 0) {
      return res.status(400).json({ success: false, message: "openingCash must be a non-negative number" });
    }
    // Partial-unique index will block second OPEN; surface the existing one
    // for a clean UX.
    const existing = await CashierSession.findOne({ cashierId, status: "OPEN" }).lean();
    if (existing) {
      return res.status(409).json({
        success: false,
        message: "An OPEN shift already exists for this cashier — close it first.",
        data: existing,
      });
    }
    const created = await CashierSession.create({
      cashierId,
      cashierName: req.user.fullName || req.user.employeeId || "Cashier",
      cashierRole: req.user.role,
      openedAt:    new Date(),
      openingCash,
      openNotes:   req.body?.openNotes || null,
    });
    res.status(201).json({ success: true, data: created });
  } catch (e) { next(e); }
};

// POST /api/cashier-sessions/:id/close  { closingCash, varianceNote?, closeNotes? }
exports.closeSession = async (req, res, next) => {
  try {
    const cashierId = req.user?._id;
    if (!cashierId) return res.status(401).json({ success: false, message: "Authentication required" });
    const session = await CashierSession.findById(req.params.id);
    if (!session) return res.status(404).json({ success: false, message: "Shift not found" });
    if (String(session.cashierId) !== String(cashierId) && req.user.role !== "Admin") {
      return res.status(403).json({ success: false, message: "Can only close your own shift" });
    }
    if (session.status === "CLOSED") {
      return res.status(400).json({ success: false, message: "Shift already closed" });
    }
    const closingCash = toNum(req.body?.closingCash);
    if (!Number.isFinite(closingCash) || closingCash < 0) {
      return res.status(400).json({ success: false, message: "closingCash must be a non-negative number" });
    }

    // Compute cash collected / refunded during the shift window from
    // PatientBill.payments + PatientAdvance create/refund.
    const windowStart = session.openedAt;
    const windowEnd   = new Date();
    const bills = await PatientBill.find({
      "payments.paidAt": { $gte: windowStart, $lte: windowEnd },
    }).select("payments").lean();
    let cashCollected = 0, cashRefundedOut = 0, advancesApplied = 0;
    for (const b of bills) {
      for (const p of (b.payments || [])) {
        const pAt = p.paidAt ? new Date(p.paidAt) : null;
        if (!pAt || pAt < windowStart || pAt > windowEnd) continue;
        if (p.voidedAt) continue;
        const amt = toNum(p.amount);
        const mode = (p.paymentMode || p.mode || "").toString();
        if (mode === "ADVANCE_ADJUSTMENT") { advancesApplied += amt; continue; }
        if (mode !== "CASH") continue;
        if (amt < 0) cashRefundedOut += -amt;
        else         cashCollected   += amt;
      }
    }
    const advanceDeposits = await PatientAdvance.find({
      paidAt:      { $gte: windowStart, $lte: windowEnd },
      paymentMode: "CASH",
    }).lean();
    for (const a of advanceDeposits) cashCollected += toNum(a.amount);
    const advanceRefunds = await PatientAdvance.find({
      refundedAt:  { $gte: windowStart, $lte: windowEnd },
      refundMode:  "CASH",
    }).lean();
    for (const a of advanceRefunds) cashRefundedOut += toNum(a.refundedAmount);

    const expectedClosing = toNum(session.openingCash) + cashCollected - cashRefundedOut;
    const variance        = +(closingCash - expectedClosing).toFixed(2);

    // Variance > ₹0.50 requires a note.
    if (Math.abs(variance) > 0.5 && !req.body?.varianceNote) {
      return res.status(400).json({
        success: false,
        message: `Variance of ₹${variance.toFixed(2)} — provide a varianceNote to explain the difference.`,
        meta: { expectedClosing, closingCash, variance },
      });
    }

    session.closedAt        = windowEnd;
    session.closingCash     = closingCash;
    session.expectedClosing = expectedClosing;
    session.variance        = variance;
    session.varianceNote    = req.body?.varianceNote || null;
    session.closeNotes      = req.body?.closeNotes || null;
    session.cashCollected   = cashCollected;
    session.cashRefundedOut = cashRefundedOut;
    session.advancesApplied = advancesApplied;
    session.status          = "CLOSED";
    await session.save();
    res.json({ success: true, data: session });
  } catch (e) { next(e); }
};

// GET /api/cashier-sessions?from=&to=&cashierId=
exports.listSessions = async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.cashierId) filter.cashierId = req.query.cashierId;
    if (req.query.from || req.query.to) {
      filter.openedAt = {};
      if (req.query.from) filter.openedAt.$gte = new Date(`${req.query.from}T00:00:00`);
      if (req.query.to)   filter.openedAt.$lte = new Date(`${req.query.to}T23:59:59.999`);
    }
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const rows = await CashierSession.find(filter).sort({ openedAt: -1 }).limit(limit).lean();
    res.json({ success: true, data: rows, meta: { count: rows.length, limit } });
  } catch (e) { next(e); }
};
