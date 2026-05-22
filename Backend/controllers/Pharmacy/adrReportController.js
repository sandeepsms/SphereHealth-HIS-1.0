/**
 * adrReportController.js  (R7bf-G / A5-CRIT-4 / NABH MOM.7)
 * Thin HTTP layer over services/Pharmacy/adrReportService.
 */
const svc = require("../../services/Pharmacy/adrReportService");

function _mapStatus(e) {
  if (e.status) return e.status;
  if (e.code === "ARG_MISSING") return 400;
  if (e.code === "NOT_FOUND") return 404;
  if (e.code === "ALREADY_SUBMITTED" || e.code === "NOT_DRAFT" || e.code === "NOT_SUBMITTED") return 409;
  return 500;
}

const actor = (req) => ({
  _id:      req.user?._id || req.user?.id,
  fullName: req.user?.fullName || req.user?.name || "",
  role:     req.user?.role || "",
});

// POST /api/adr-reports
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

// PUT /api/adr-reports/:id
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

// PUT /api/adr-reports/:id/submit
exports.submit = async (req, res, next) => {
  try {
    const doc = await svc.submit(req.params.id, actor(req));
    res.json({ success: true, data: doc });
  } catch (e) {
    const status = _mapStatus(e);
    if (status !== 500) return res.status(status).json({ success: false, message: e.message, code: e.code });
    next(e);
  }
};

// PUT /api/adr-reports/:id/file-pvpi
exports.filePvPI = async (req, res, next) => {
  try {
    const doc = await svc.filePvPI(req.params.id, req.body || {}, actor(req));
    res.json({ success: true, data: doc });
  } catch (e) {
    const status = _mapStatus(e);
    if (status !== 500) return res.status(status).json({ success: false, message: e.message, code: e.code });
    next(e);
  }
};

// PUT /api/adr-reports/:id/reopen
exports.reopen = async (req, res, next) => {
  try {
    const doc = await svc.reopen(req.params.id, actor(req), req.body?.reason || "");
    res.json({ success: true, data: doc });
  } catch (e) {
    const status = _mapStatus(e);
    if (status !== 500) return res.status(status).json({ success: false, message: e.message, code: e.code });
    next(e);
  }
};

// GET /api/adr-reports/:id
exports.getOne = async (req, res, next) => {
  try {
    const doc = await svc.getById(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: "ADR report not found" });
    res.json({ success: true, data: doc });
  } catch (e) { next(e); }
};

// GET /api/adr-reports?uhid=&status=&severity=
exports.list = async (req, res, next) => {
  try {
    const data = await svc.list({
      uhid:     req.query?.uhid,
      status:   req.query?.status,
      severity: req.query?.severity,
      limit:    Number(req.query?.limit) || 100,
    });
    res.json({ success: true, data, count: data.length });
  } catch (e) { next(e); }
};
