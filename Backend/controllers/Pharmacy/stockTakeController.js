/**
 * stockTakeController.js  (R7bd-E-2 / A2-MED-18)
 * Thin HTTP layer over services/Pharmacy/stockTake.
 */
const svc = require("../../services/Pharmacy/stockTake");

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
    res.status(201).json({ success: true, data: doc });
  } catch (e) {
    const status = e.status || _map(e.code);
    if (status !== 500) return res.status(status).json({ success: false, message: e.message, code: e.code });
    next(e);
  }
};

// GET /api/pharmacy/stock-take?status=DRAFT&from=&to=
exports.list = async (req, res, next) => {
  try {
    const list = await svc.listCounts(req.query || {});
    res.json({ success: true, data: list, count: list.length });
  } catch (e) { next(e); }
};

// GET /api/pharmacy/stock-take/:id
exports.getOne = async (req, res, next) => {
  try {
    const doc = await svc.getCount(req.params.id);
    res.json({ success: true, data: doc });
  } catch (e) {
    if (e.status === 404) return res.status(404).json({ success: false, message: e.message });
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
    res.json({ success: true, data: doc });
  } catch (e) {
    const status = e.status || _map(e.code);
    if (status !== 500) return res.status(status).json({ success: false, message: e.message, code: e.code });
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
    res.json({ success: true, data: out });
  } catch (e) {
    const status = e.status || _map(e.code);
    if (status !== 500) return res.status(status).json({ success: false, message: e.message, code: e.code });
    next(e);
  }
};
