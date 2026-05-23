/**
 * bmwManifestController.js  (R7bj-F6 / NABH WB-CRIT-1 / BMW Rules 2016)
 *
 * Thin HTTP layer over services/Compliance/bmwManifestService. Maps
 * service error codes → HTTP status. The service uses gap-less
 * counters and append-only enforcement, so callers don't need to
 * reach into the model directly.
 */
const svc = require("../../services/Compliance/bmwManifestService");
// R7bm-F9: canonical envelope helper — collapses `count` etc. into the
// reserved `meta` field so the response shape stays `{ success, data, meta? }`.
const { sendOk } = require("../../utils/apiEnvelope");

function _mapStatus(e) {
  if (e.status) return e.status;
  if (e.statusCode) return e.statusCode;
  if (e.code === "ARG_MISSING" || e.code === "ARG_INVALID" || e.code === "DUP_BARCODE") return 400;
  if (e.code === "NOT_FOUND") return 404;
  if (
    e.code === "ALREADY_HANDED_OVER" ||
    e.code === "ALREADY_FILED" ||
    e.code === "INVALID_STATE" ||
    e.code === "BMW_MANIFEST_APPEND_ONLY"
  ) return 409;
  return 500;
}

const actor = (req) => ({
  _id:        req.user?._id || req.user?.id,
  fullName:   req.user?.fullName || req.user?.name || "",
  role:       req.user?.role || "",
  hospitalId: req.user?.hospitalId || null,
});

// POST /api/bmw-manifest
exports.create = async (req, res, next) => {
  try {
    const doc = await svc.createManifest(req.body || {}, actor(req));
    res.status(201).json({ success: true, data: doc });
  } catch (e) {
    const status = _mapStatus(e);
    if (status !== 500) return res.status(status).json({ success: false, message: e.message, code: e.code });
    next(e);
  }
};

// PUT /api/bmw-manifest/:id/handover
exports.handover = async (req, res, next) => {
  try {
    const doc = await svc.handover(req.params.id, req.body || {}, actor(req));
    res.json({ success: true, data: doc });
  } catch (e) {
    const status = _mapStatus(e);
    if (status !== 500) return res.status(status).json({ success: false, message: e.message, code: e.code });
    next(e);
  }
};

// PUT /api/bmw-manifest/:id/pcb-filed
//   body: { refNumber }
exports.markPcbFiled = async (req, res, next) => {
  try {
    const doc = await svc.markPcbFiled(req.params.id, req.body?.refNumber, actor(req));
    res.json({ success: true, data: doc });
  } catch (e) {
    const status = _mapStatus(e);
    if (status !== 500) return res.status(status).json({ success: false, message: e.message, code: e.code });
    next(e);
  }
};

// GET /api/bmw-manifest/:id
exports.getOne = async (req, res, next) => {
  try {
    const doc = await svc.getById(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: "BMW manifest not found" });
    res.json({ success: true, data: doc });
  } catch (e) { next(e); }
};

// GET /api/bmw-manifest?from=&to=&pcbFiled=
exports.list = async (req, res, next) => {
  try {
    const data = await svc.list({
      from:     req.query?.from,
      to:       req.query?.to,
      pcbFiled: req.query?.pcbFiled,
      limit:    Number(req.query?.limit) || 100,
    });
    return sendOk(res, data, { count: data.length });
  } catch (e) { next(e); }
};
