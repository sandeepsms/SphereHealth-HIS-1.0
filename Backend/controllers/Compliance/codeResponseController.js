/**
 * codeResponseController.js  (R7bj-F6 / NABH SEC-CRIT-1 / FMS.5 + COP.18)
 * Thin HTTP layer over services/Compliance/codeResponseService.
 */
const svc = require("../../services/Compliance/codeResponseService");
// R7bm-F9: canonical envelope helper — `count` moves into `meta` so the
// response stays `{ success, data, meta? }` per apiEnvelope contract.
const { sendOk } = require("../../utils/apiEnvelope");

function _mapStatus(e) {
  if (e.status) return e.status;
  if (e.statusCode) return e.statusCode;
  if (e.code === "ARG_MISSING" || e.code === "ARG_INVALID") return 400;
  if (e.code === "NOT_FOUND") return 404;
  if (
    e.code === "ALREADY_RESOLVED" ||
    e.code === "CODE_RESPONSE_RESOLVED"
  ) return 409;
  return 500;
}

const actor = (req) => ({
  _id:        req.user?._id || req.user?.id,
  fullName:   req.user?.fullName || req.user?.name || "",
  role:       req.user?.role || "",
  hospitalId: req.user?.hospitalId || null,
});

// POST /api/code-response
//   body: { code, location, bedNumber?, patientUHID?, patientName?, alertedAt?, notes? }
exports.create = async (req, res, next) => {
  try {
    const body = req.body || {};
    const doc = await svc.recordEvent(body.code, body, actor(req));
    res.status(201).json({ success: true, data: doc });
  } catch (e) {
    const status = _mapStatus(e);
    if (status !== 500) return res.status(status).json({ success: false, message: e.message, code: e.code });
    next(e);
  }
};

// PUT /api/code-response/:id/responder
//   body: { byUserId?, name?, role?, arrivedAt? }
exports.addResponder = async (req, res, next) => {
  try {
    const doc = await svc.addResponder(req.params.id, req.body || {}, actor(req));
    res.json({ success: true, data: doc });
  } catch (e) {
    const status = _mapStatus(e);
    if (status !== 500) return res.status(status).json({ success: false, message: e.message, code: e.code });
    next(e);
  }
};

// PUT /api/code-response/:id/resolve
//   body: { outcome, notes?, evacuationCount?, linkedMortuaryId?, linkedIncidentId? }
exports.resolve = async (req, res, next) => {
  try {
    const doc = await svc.resolveEvent(req.params.id, req.body || {}, actor(req));
    res.json({ success: true, data: doc });
  } catch (e) {
    const status = _mapStatus(e);
    if (status !== 500) return res.status(status).json({ success: false, message: e.message, code: e.code });
    next(e);
  }
};

// GET /api/code-response/:id
exports.getOne = async (req, res, next) => {
  try {
    const doc = await svc.getById(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: "Code-response event not found" });
    res.json({ success: true, data: doc });
  } catch (e) { next(e); }
};

// GET /api/code-response?code=&from=&to=&outcome=&uhid=
exports.list = async (req, res, next) => {
  try {
    const data = await svc.list({
      code:    req.query?.code,
      from:    req.query?.from,
      to:      req.query?.to,
      outcome: req.query?.outcome,
      uhid:    req.query?.uhid,
      limit:   Number(req.query?.limit) || 100,
    });
    return sendOk(res, data, { count: data.length });
  } catch (e) { next(e); }
};

// GET /api/code-response/stats?from=&to=
exports.stats = async (req, res, next) => {
  try {
    const rows = await svc.stats({ from: req.query?.from, to: req.query?.to });
    return sendOk(res, rows, { count: rows.length });
  } catch (e) { next(e); }
};
