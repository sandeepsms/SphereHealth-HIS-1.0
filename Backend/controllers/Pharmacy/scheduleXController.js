/**
 * scheduleXController.js  (R7bd-E-1 / A2-MED-16)
 * Thin HTTP layer over services/Pharmacy/scheduleXRegister.
 */
const svc = require("../../services/Pharmacy/scheduleXRegister");

function _mapStatus(code) {
  if (code === "ARG_MISSING" || code === "INVALID_QTY") return 400;
  if (code === "WITNESS_REQUIRED") return 400;
  if (code === "WITNESS_SELF") return 409;
  if (code === "NOT_SCHEDULE_X") return 409;
  if (code === "INSUFFICIENT_REGISTER_BALANCE") return 409;
  if (code === "DAY_LOCKED") return 409;
  if (code === "ALREADY_VERIFIED") return 409;
  if (code === "NO_ACTIVITY") return 404;
  return 500;
}

// POST /api/pharmacy/schedule-x/dispense
exports.dispense = async (req, res, next) => {
  try {
    const u = req.user || {};
    const row = await svc.recordDispense({
      drugId:        req.body?.drugId,
      batchId:       req.body?.batchId,
      qty:           req.body?.qty,
      rx:            req.body?.rx || req.body?.prescriptionRef,
      doctorName:    req.body?.doctorName,
      uhid:          req.body?.uhid,
      witnessName:   req.body?.witnessName,
      witnessId:     req.body?.witnessId,
      dispensedBy:   u.fullName || u.employeeId || "Pharmacist",
      dispensedById: u._id || u.id,
      remarks:       req.body?.remarks,
    });
    res.status(201).json({ success: true, data: row });
  } catch (e) {
    const status = e.status || _mapStatus(e.code);
    if (status !== 500) return res.status(status).json({ success: false, message: e.message, code: e.code });
    next(e);
  }
};

// GET /api/pharmacy/schedule-x/register?date=YYYY-MM-DD
exports.register = async (req, res, next) => {
  try {
    const data = await svc.dailyBalance(req.query?.date || new Date());
    res.json({ success: true, data, count: data.length });
  } catch (e) { next(e); }
};

// POST /api/pharmacy/schedule-x/verify  { date }
exports.verify = async (req, res, next) => {
  try {
    const u = req.user || {};
    const out = await svc.verifyBalance(req.body?.date || new Date(), {
      verifierId:   u._id || u.id,
      verifierName: u.fullName || u.employeeId || "Pharmacist",
    });
    res.json({ success: true, data: out });
  } catch (e) {
    const status = e.status || _mapStatus(e.code);
    if (status !== 500) return res.status(status).json({ success: false, message: e.message, code: e.code });
    next(e);
  }
};
