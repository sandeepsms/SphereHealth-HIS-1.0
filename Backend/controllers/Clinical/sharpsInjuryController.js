/**
 * sharpsInjuryController.js  (R7bj-F6 / NABH HK-CRIT-1 / HIC.6)
 * Thin HTTP layer over services/Clinical/sharpsInjuryService.
 */
const svc = require("../../services/Clinical/sharpsInjuryService");

function _mapStatus(e) {
  if (e.status) return e.status;
  if (e.statusCode) return e.statusCode;
  if (e.code === "ARG_MISSING" || e.code === "ARG_INVALID") return 400;
  if (e.code === "NOT_FOUND") return 404;
  if (
    e.code === "ALREADY_CLOSED" ||
    e.code === "SHARPS_INJURY_CLOSED"
  ) return 409;
  return 500;
}

const actor = (req) => ({
  _id:        req.user?._id || req.user?.id,
  fullName:   req.user?.fullName || req.user?.name || "",
  role:       req.user?.role || "",
  hospitalId: req.user?.hospitalId || null,
});

// POST /api/sharps-injury
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

// PUT /api/sharps-injury/:id
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

// PUT /api/sharps-injury/:id/pep-started
//   body: { regimen?, startedAt? }
exports.pepStarted = async (req, res, next) => {
  try {
    const doc = await svc.markPepStarted(req.params.id, req.body || {}, actor(req));
    res.json({ success: true, data: doc });
  } catch (e) {
    const status = _mapStatus(e);
    if (status !== 500) return res.status(status).json({ success: false, message: e.message, code: e.code });
    next(e);
  }
};

// PUT /api/sharps-injury/:id/serology
//   body: { test, result?, completedAt?, dueAt?, notes? }
exports.serology = async (req, res, next) => {
  try {
    const doc = await svc.recordSerologyResult(req.params.id, req.body || {}, actor(req));
    res.json({ success: true, data: doc });
  } catch (e) {
    const status = _mapStatus(e);
    if (status !== 500) return res.status(status).json({ success: false, message: e.message, code: e.code });
    next(e);
  }
};

// PUT /api/sharps-injury/:id/close
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

// GET /api/sharps-injury/:id
exports.getOne = async (req, res, next) => {
  try {
    const doc = await svc.getById(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: "Sharps-injury record not found" });
    res.json({ success: true, data: doc });
  } catch (e) { next(e); }
};

// GET /api/sharps-injury?status=&injuredById=&uhid=&from=&to=
exports.list = async (req, res, next) => {
  try {
    const data = await svc.list({
      status:      req.query?.status,
      injuredById: req.query?.injuredById,
      uhid:        req.query?.uhid,
      from:        req.query?.from,
      to:          req.query?.to,
      limit:       Number(req.query?.limit) || 100,
    });
    res.json({ success: true, data, count: data.length });
  } catch (e) { next(e); }
};
