/**
 * stockTakeController.js  (R7bd-E-2 / A2-MED-18)
 * Thin HTTP layer over services/Pharmacy/stockTake.
 *
 * R7bh-F4 / R7bg-3-CRIT-12: envelope normalised via utils/apiEnvelope.
 */
const svc = require("../../services/Pharmacy/stockTake");
const { sendOk, sendErr } = require("../../utils/apiEnvelope");

function _map(code) {
  if (code === "ARG_MISSING" || code === "INVALID_QTY" || code === "REASON_REQUIRED") return 400;
  if (code === "ALREADY_CLOSED" || code === "ALREADY_VERIFIED" || code === "NOT_SUBMITTED" || code === "VERIFIER_SELF") return 409;
  if (code === "NO_BATCHES") return 404;
  return 500;
}

// POST /api/pharmacy/stock-take  { date, drugIds, title, scope }
exports.create = async (req, res, next) => {
  try {
    const doc = await svc.createCount({
      date:    req.body?.date,
      drugIds: Array.isArray(req.body?.drugIds) ? req.body.drugIds : [],
      title:   req.body?.title,
      scope:   req.body?.scope,
      user:    req.user || {},
    });
    return sendOk(res, doc, undefined, 201);
  } catch (e) {
    const status = e.status || _map(e.code);
    if (status !== 500) return sendErr(res, e, e.code, status);
    next(e);
  }
};

// GET /api/pharmacy/stock-take?status=DRAFT&from=&to=
exports.list = async (req, res, next) => {
  try {
    const list = await svc.listCounts(req.query || {});
    return sendOk(res, list, { count: list.length });
  } catch (e) { next(e); }
};

// GET /api/pharmacy/stock-take/:id
exports.getOne = async (req, res, next) => {
  try {
    const doc = await svc.getCount(req.params.id);
    return sendOk(res, doc);
  } catch (e) {
    if (e.status === 404) return sendErr(res, e, "NOT_FOUND", 404);
    next(e);
  }
};

// PUT /api/pharmacy/stock-take/:id/line  { batchId, physicalQty, reason }
exports.enterPhysical = async (req, res, next) => {
  try {
    const doc = await svc.enterPhysical(req.params.id, {
      batchId:     req.body?.batchId,
      physicalQty: req.body?.physicalQty,
      reason:      req.body?.reason,
    });
    return sendOk(res, doc);
  } catch (e) {
    const status = e.status || _map(e.code);
    if (status !== 500) return sendErr(res, e, e.code, status);
    next(e);
  }
};

// PUT /api/pharmacy/stock-take/:id/verify
exports.verify = async (req, res, next) => {
  try {
    const u = req.user || {};
    const out = await svc.verifyAndAdjust(req.params.id, {
      verifierId:   u._id || u.id,
      verifierName: u.fullName || u.employeeId || "Pharmacist",
    });
    return sendOk(res, out);
  } catch (e) {
    const status = e.status || _map(e.code);
    if (status !== 500) return sendErr(res, e, e.code, status);
    next(e);
  }
};
