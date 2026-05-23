/**
 * scheduleXController.js  (R7bd-E-1 / A2-MED-16)
 * Thin HTTP layer over services/Pharmacy/scheduleXRegister.
 *
 * R7bh-F4 / R7bg-3-CRIT-12: envelope normalised via utils/apiEnvelope so
 * every response shares the { success, data, meta? } / { success, message,
 * code } contract. `meta.count` carries the array length so the wire
 * shape is unchanged from the previous ad-hoc `count` top-level field.
 */
const svc = require("../../services/Pharmacy/scheduleXRegister");
const { sendOk, sendErr } = require("../../utils/apiEnvelope");

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
    return sendOk(res, row, undefined, 201);
  } catch (e) {
    const status = e.status || _mapStatus(e.code);
    if (status !== 500) return sendErr(res, e, e.code, status);
    next(e);
  }
};

// GET /api/pharmacy/schedule-x/register?date=YYYY-MM-DD
exports.register = async (req, res, next) => {
  try {
    const data = await svc.dailyBalance(req.query?.date || new Date());
    return sendOk(res, data, { count: data.length });
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
    return sendOk(res, out);
  } catch (e) {
    const status = e.status || _mapStatus(e.code);
    if (status !== 500) return sendErr(res, e, e.code, status);
    next(e);
  }
};
