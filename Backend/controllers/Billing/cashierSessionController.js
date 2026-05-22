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
    // R7as-FIX-8/D7-high: catch the partial-unique-index race. Two
    // concurrent open requests (double-click, mobile + desktop) both
    // pass the `findOne({status:OPEN})` precheck above. The CashierSession
    // partial-unique index on `(cashierId)` where `status==="OPEN"` then
    // rejects the LOSER with E11000. Pre-R7as the controller crashed with
    // a 500; cashier saw a cryptic Mongo error. Now surface a clean 409.
    let created;
    try {
      created = await CashierSession.create({
        cashierId,
        cashierName: req.user.fullName || req.user.employeeId || "Cashier",
        cashierRole: req.user.role,
        openedAt:    new Date(),
        openingCash,
        openNotes:   req.body?.openNotes || null,
      });
    } catch (e) {
      if (e?.code === 11000) {
        // Race winner already created the session — re-fetch and 409.
        const winner = await CashierSession.findOne({ cashierId, status: "OPEN" }).lean();
        return res.status(409).json({
          success: false,
          message: "Another OPEN shift was just opened for this cashier — refresh.",
          data: winner || null,
        });
      }
      throw e;
    }
    // R7ar-P1-20/D6-aq-04: emit SHIFT_OPENED for chronological audit.
    try {
      const { emit } = require("../../models/Billing/BillingAudit");
      await emit({
        event:     "SHIFT_OPENED",
        actorId:   cashierId,
        actorName: created.cashierName,
        actorRole: created.cashierRole,
        amount:    openingCash,
        reason:    `Opened with ₹${openingCash} cash drawer${created.openNotes ? ` — ${created.openNotes}` : ""}`,
        after:     { sessionId: created._id, status: "OPEN", openedAt: created.openedAt },
      }, { req });
    } catch (_) { /* audit best-effort */ }
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

    // R7bh-F10 / R7bg-6-HIGH-6: refuse close while this cashier still
    // owns GENERATED / PARTIAL bills. The shift register treats
    // close-time variance against EXPECTED collection, but a
    // not-yet-collected bill is "expected ₹X later" cash — letting
    // the shift close orphans the bill on the next cashier's drawer
    // (whose `receivedById` filter will EXCLUDE it). Either the
    // outgoing cashier collects/handovers, or an Admin force-closes
    // with `?force=1` + a reason for the audit trail.
    const force = String(req.query?.force || "").trim() === "1";
    const unpaidOwned = await PatientBill.countDocuments({
      "payments.receivedById": session.cashierId,
      billStatus: { $in: ["GENERATED", "PARTIAL"] },
    });
    if (unpaidOwned > 0) {
      if (!force) {
        return res.status(409).json({
          success: false,
          code:    "UNPAID_BILLS_OUTSTANDING",
          message: `Cannot close shift — ${unpaidOwned} bill(s) you initiated are still GENERATED / PARTIAL. ` +
                   `Collect / handover before close, or pass ?force=1 (Admin) with a varianceNote.`,
          meta:    { count: unpaidOwned, cashierId: String(session.cashierId) },
        });
      }
      // Admin force-close is allowed but DEMANDS a non-empty
      // varianceNote (we re-use the existing field to anchor the
      // audit) AND must be initiated by Admin role only — Receptionist
      // / Accountant can't bypass via a URL param.
      if (req.user.role !== "Admin") {
        return res.status(403).json({
          success: false,
          code:    "FORCE_REQUIRES_ADMIN",
          message: "Admin only: cashier sessions with outstanding bills can only be force-closed by Admin.",
        });
      }
      if (!req.body?.varianceNote || !String(req.body.varianceNote).trim()) {
        return res.status(400).json({
          success: false,
          code:    "VARIANCE_NOTE_REQUIRED",
          message: "Force-close requires varianceNote describing why the outstanding bills are being orphaned.",
        });
      }
    }

    // R7ar-P1-11/D1-aq-07: scope the cash-flow window to THIS cashier only.
    // Pre-R7ar the close-window query was admission-wide → two cashiers on
    // overlapping shifts both claimed the whole drawer.
    const windowStart = session.openedAt;
    const windowEnd   = new Date();
    const bills = await PatientBill.find({
      "payments.paidAt":       { $gte: windowStart, $lte: windowEnd },
      "payments.receivedById": session.cashierId,
    }).select("payments").lean();
    let cashCollected = 0, cashRefundedOut = 0, advancesApplied = 0;
    let upiCollected = 0, cardCollected = 0, chequeCollected = 0;   // R7ar-D5-aq-12
    for (const b of bills) {
      for (const p of (b.payments || [])) {
        const pAt = p.paidAt ? new Date(p.paidAt) : null;
        if (!pAt || pAt < windowStart || pAt > windowEnd) continue;
        if (p.voidedAt) continue;
        // R7ar-P1-11: only count this cashier's rows.
        if (p.receivedById && String(p.receivedById) !== String(session.cashierId)) continue;
        const amt = toNum(p.amount);
        const mode = (p.paymentMode || p.mode || "").toString().toUpperCase();
        if (mode === "ADVANCE_ADJUSTMENT") { advancesApplied += amt; continue; }
        // R7ar-D5-aq-12: track non-cash modes too so reconciliation can show
        // UPI/CARD/CHEQUE totals per shift.
        if (amt < 0) {
          if (mode === "CASH") cashRefundedOut += -amt;
          continue;
        }
        if (mode === "CASH")    cashCollected   += amt;
        else if (mode === "UPI")    upiCollected    += amt;
        else if (mode === "CARD")   cardCollected   += amt;
        else if (mode === "CHEQUE") chequeCollected += amt;
      }
    }
    // R7ar-P1-11: filter advance deposits by receivedById too.
    const advanceDeposits = await PatientAdvance.find({
      paidAt:        { $gte: windowStart, $lte: windowEnd },
      paymentMode:   "CASH",
      receivedById:  session.cashierId,
    }).lean();
    for (const a of advanceDeposits) cashCollected += toNum(a.amount);
    // R7bh-F10 / R7bg-6-HIGH-4: match advance refunds by `refundedById`
    // (the operator's _id), not by `refundedBy` name. The name-based
    // match was fragile — two cashiers sharing a display name (common
    // in family-staffed clinics: "Priya M" + "Priya S" both saved as
    // "Priya"), an HR rename, or any whitespace difference would silently
    // drop the refund from the shift's cash-out side. PatientAdvance
    // already records `refundedById` on the refund (see
    // patientAdvanceService.refundAdvance) so we just need to filter on
    // it instead of the display name.
    const advanceRefunds = await PatientAdvance.find({
      refundedAt:    { $gte: windowStart, $lte: windowEnd },
      refundMode:    "CASH",
      refundedById:  session.cashierId,
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
    session.upiCollected    = upiCollected;     // R7ar-D5-aq-12
    session.cardCollected   = cardCollected;
    session.chequeCollected = chequeCollected;
    session.status          = "CLOSED";
    // R7bb-FIX-E-17 / D3-HIGH-6: cashier self-close is allowed but a
    // material variance triggers an Admin co-sign requirement. Same-
    // actor close on a clean drawer (≤ ₹500 abs variance, no short) is
    // routine and stays auto-approved.
    const SAME_ACTOR = String(session.cashierId) === String(cashierId);
    const sigVariance = Math.abs(variance) > 500;
    const isShort     = variance < 0;
    if (SAME_ACTOR && (sigVariance || isShort)) {
      session.closeApprovalPending = true;
    } else {
      session.closeApprovalPending = false;
    }
    await session.save();
    // R7ar-P1-20/D6-aq-04: emit SHIFT_CLOSED with variance snapshot.
    try {
      const { emit } = require("../../models/Billing/BillingAudit");
      await emit({
        event:     "SHIFT_CLOSED",
        actorId:   cashierId,
        actorName: session.cashierName,
        actorRole: session.cashierRole,
        amount:    closingCash,
        reason:    Math.abs(variance) > 0.5
          ? `Variance ₹${variance.toFixed(2)}: ${session.varianceNote || "—"}`
          : `Reconciled (expected ₹${expectedClosing.toFixed(2)}, closed ₹${closingCash.toFixed(2)})`,
        before:    {
          openingCash:    toNum(session.openingCash),
          openedAt:       session.openedAt,
        },
        after:     {
          sessionId:       session._id,
          status:          "CLOSED",
          closedAt:        session.closedAt,
          cashCollected,
          cashRefundedOut,
          advancesApplied,
          upiCollected,
          cardCollected,
          chequeCollected,
          expectedClosing,
          closingCash,
          variance,
        },
      }, { req });
    } catch (_) { /* audit best-effort */ }
    res.json({ success: true, data: session });
  } catch (e) { next(e); }
};

// POST /api/cashier-sessions/:id/clear-close  { remarks }
// R7bb-FIX-E-17 / D3-HIGH-6: Admin clears the post-close approval flag
// on a CLOSED shift that closed with significant variance / cash short.
// Approver must differ from the shift's cashier.
exports.clearCloseApproval = async (req, res, next) => {
  try {
    if (req.user?.role !== "Admin") {
      return res.status(403).json({ success: false, message: "Admin only" });
    }
    const session = await CashierSession.findById(req.params.id);
    if (!session) return res.status(404).json({ success: false, message: "Shift not found" });
    if (session.status !== "CLOSED") {
      return res.status(409).json({ success: false, message: "Shift is not CLOSED — clear is not applicable." });
    }
    if (!session.closeApprovalPending) {
      return res.status(409).json({ success: false, message: "Shift close approval is not pending." });
    }
    if (String(session.cashierId) === String(req.user?._id || req.user?.id)) {
      return res.status(409).json({
        success: false, code: "SAME_ACTOR",
        message: "SAME_ACTOR — close-approval must be cleared by a different user than the cashier",
      });
    }
    session.closeApprovalPending = false;
    session.closeApprovedBy      = req.user.fullName || req.user.employeeId || "Admin";
    session.closeApprovedById    = req.user._id || req.user.id || null;
    session.closeApprovedAt      = new Date();
    session.closeApprovalRemarks = String(req.body?.remarks || "").trim();
    await session.save();
    res.json({ success: true, data: session });
  } catch (e) { next(e); }
};

// GET /api/cashier-sessions?from=&to=&cashierId=
exports.listSessions = async (req, res, next) => {
  try {
    const filter = {};
    // R7au-FIX-15/D2-HIGH-5: validate cashierId ObjectId before stuffing
    // into the query. Pre-R7au a malformed id was silently coerced to
    // `null` by Mongo and the endpoint returned `[]` instead of 400 —
    // the operator had no way to tell their filter was bad.
    if (req.query.cashierId) {
      const mongoose = require("mongoose");
      if (!mongoose.isValidObjectId(req.query.cashierId)) {
        return res.status(400).json({ success: false, message: "cashierId must be a valid ObjectId" });
      }
      filter.cashierId = req.query.cashierId;
    }
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
