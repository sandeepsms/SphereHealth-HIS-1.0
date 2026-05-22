/**
 * adrReportController.js  (R7bf-G / A5-CRIT-4 / NABH MOM.7)
 * Thin HTTP layer over services/Pharmacy/adrReportService.
 *
 * R7bh-F4 / R7bg-3-CRIT-12: envelope normalised via utils/apiEnvelope.
 * Business logic remains with F5-CONT — this file only touches response shape.
 */
const svc = require("../../services/Pharmacy/adrReportService");
const { sendOk, sendErr } = require("../../utils/apiEnvelope");

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
    return sendOk(res, doc, undefined, 201);
  } catch (e) {
    const status = _mapStatus(e);
    if (status !== 500) return sendErr(res, e, e.code, status);
    next(e);
  }
};

// PUT /api/adr-reports/:id
exports.update = async (req, res, next) => {
  try {
    const doc = await svc.update(req.params.id, req.body || {}, actor(req));
    return sendOk(res, doc);
  } catch (e) {
    const status = _mapStatus(e);
    if (status !== 500) return sendErr(res, e, e.code, status);
    next(e);
  }
};

// PUT /api/adr-reports/:id/submit
exports.submit = async (req, res, next) => {
  try {
    const doc = await svc.submit(req.params.id, actor(req));
    return sendOk(res, doc);
  } catch (e) {
    const status = _mapStatus(e);
    if (status !== 500) return sendErr(res, e, e.code, status);
    next(e);
  }
};

// PUT /api/adr-reports/:id/file-pvpi
exports.filePvPI = async (req, res, next) => {
  try {
    const doc = await svc.filePvPI(req.params.id, req.body || {}, actor(req));
    return sendOk(res, doc);
  } catch (e) {
    const status = _mapStatus(e);
    if (status !== 500) return sendErr(res, e, e.code, status);
    next(e);
  }
};

// PUT /api/adr-reports/:id/reopen
exports.reopen = async (req, res, next) => {
  try {
    const doc = await svc.reopen(req.params.id, actor(req), req.body?.reason || "");
    return sendOk(res, doc);
  } catch (e) {
    const status = _mapStatus(e);
    if (status !== 500) return sendErr(res, e, e.code, status);
    next(e);
  }
};

// GET /api/adr-reports/:id
exports.getOne = async (req, res, next) => {
  try {
    const doc = await svc.getById(req.params.id);
    if (!doc) return sendErr(res, "ADR report not found", "NOT_FOUND", 404);
    return sendOk(res, doc);
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
    return sendOk(res, data, { count: data.length });
  } catch (e) { next(e); }
};
