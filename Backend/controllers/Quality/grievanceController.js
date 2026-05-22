/**
 * grievanceController.js  (R7bf-G / A5-CRIT-5 / NABH PRE.6)
 * Thin HTTP layer over services/Quality/grievanceService.
 */
const svc = require("../../services/Quality/grievanceService");

function _mapStatus(e) {
  if (e.status) return e.status;
  if (e.code === "ARG_MISSING") return 400;
  if (e.code === "NOT_FOUND") return 404;
  if (e.code === "ALREADY_CLOSED" || e.code === "INVALID_STATE") return 409;
  return 500;
}

const actor = (req) => ({
  _id:        req.user?._id || req.user?.id,
  fullName:   req.user?.fullName || req.user?.name || "",
  role:       req.user?.role || "",
  hospitalId: req.user?.hospitalId || null,
});

// POST /api/grievances
exports.create = async (req, res, next) => {
  try {
    const doc = await svc.create(req.body || {}, actor(req));
    res.status(201).json({ success: true, data: doc });
  } catch (e) {
    const status = _mapStatus(e);
    if (status !== 500) return res.status(status).json({ success: false, message: e.message, code: e.code });
    next(e);
  }
};

// PUT /api/grievances/:id
exports.update = async (req, res, next) => {
  try {
    const doc = await svc.update(req.params.id, req.body || {}, actor(req));
    res.json({ success: true, data: doc });
  } catch (e) {
    const status = _mapStatus(e);
    if (status !== 500) return res.status(status).json({ success: false, message: e.message, code: e.code });
    next(e);
  }
};

// PUT /api/grievances/:id/assign
exports.assign = async (req, res, next) => {
  try {
    const doc = await svc.assign(req.params.id, req.body || {}, actor(req));
    res.json({ success: true, data: doc });
  } catch (e) {
    const status = _mapStatus(e);
    if (status !== 500) return res.status(status).json({ success: false, message: e.message, code: e.code });
    next(e);
  }
};

// PUT /api/grievances/:id/resolve
exports.resolve = async (req, res, next) => {
  try {
    const doc = await svc.resolve(req.params.id, req.body || {}, actor(req));
    res.json({ success: true, data: doc });
  } catch (e) {
    const status = _mapStatus(e);
    if (status !== 500) return res.status(status).json({ success: false, message: e.message, code: e.code });
    next(e);
  }
};

// PUT /api/grievances/:id/close
exports.close = async (req, res, next) => {
  try {
    const doc = await svc.close(req.params.id, req.body || {}, actor(req));
    res.json({ success: true, data: doc });
  } catch (e) {
    const status = _mapStatus(e);
    if (status !== 500) return res.status(status).json({ success: false, message: e.message, code: e.code });
    next(e);
  }
};

// PUT /api/grievances/:id/escalate
exports.escalate = async (req, res, next) => {
  try {
    const doc = await svc.escalate(req.params.id, req.body || {}, actor(req));
    res.json({ success: true, data: doc });
  } catch (e) {
    const status = _mapStatus(e);
    if (status !== 500) return res.status(status).json({ success: false, message: e.message, code: e.code });
    next(e);
  }
};

// GET /api/grievances/:id
exports.getOne = async (req, res, next) => {
  try {
    const doc = await svc.getById(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: "Grievance not found" });
    res.json({ success: true, data: doc });
  } catch (e) { next(e); }
};

// GET /api/grievances?uhid=&status=&category=
exports.list = async (req, res, next) => {
  try {
    const data = await svc.list({
      uhid:     req.query?.uhid,
      status:   req.query?.status,
      category: req.query?.category,
      limit:    Number(req.query?.limit) || 100,
    });
    res.json({ success: true, data, count: data.length });
  } catch (e) { next(e); }
};
