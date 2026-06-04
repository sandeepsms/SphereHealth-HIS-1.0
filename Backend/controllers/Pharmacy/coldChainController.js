// Backend/controllers/Pharmacy/coldChainController.js
// R7bh-F5: cold-chain log HTTP surface.

const svc = require("../../services/Pharmacy/coldChainLogger");
let envelope;
try {
  envelope = require("../../utils/apiEnvelope");
} catch (_) {
  envelope = {
    sendOk: (res, data, meta, status = 200) =>
      res.status(status).json(meta ? { success: true, data, meta } : { success: true, data }),
    sendErr: (res, e, code, status = 500) =>
      res.status(e?.statusCode || status).json({
        success: false,
        message: typeof e === "string" ? e : e?.message || "Internal error",
        code: code || e?.code || null,
      }),
  };
}

exports.logReading = async (req, res) => {
  try {
    const u = req.user || {};
    const doc = await svc.recordReading({
      ...req.body,
      recordedById: u._id || u.id,
      recordedByName: u.fullName || u.name,
      hospitalId: u.hospitalId || null,
    });
    return envelope.sendOk(res, doc, null, 201);
  } catch (e) {
    return envelope.sendErr(res, e, e.code, e.statusCode || 500);
  }
};

exports.getForFridge = async (req, res) => {
  try {
    const rows = await svc.getReadingsForFridge(req.params.fridgeId, req.query.from, req.query.to);
    return envelope.sendOk(res, rows, { count: rows.length, fridgeId: req.params.fridgeId });
  } catch (e) {
    return envelope.sendErr(res, e, e.code, e.statusCode || 500);
  }
};

exports.listBreaches = async (req, res) => {
  try {
    const u = req.user || {};
    const rows = await svc.getActiveBreaches(u.hospitalId || null);
    return envelope.sendOk(res, rows, { count: rows.length });
  } catch (e) {
    return envelope.sendErr(res, e, e.code, e.statusCode || 500);
  }
};

// R7hr-12-S3 (D6-12): cap correctiveAction at 500 chars to prevent
// audit-trail bloat / accidental dangerouslySetInnerHTML payloads from
// reaching the print preview. Trim at the controller boundary so the
// service's required-field check still rejects whitespace-only input.
const CORRECTIVE_ACTION_MAX = 500;

exports.acknowledgeBreach = async (req, res) => {
  try {
    const u = req.user || {};
    // R7hr-12-S3: trim + cap correctiveAction at controller boundary.
    const correctiveAction = req.body?.correctiveAction
      ? String(req.body.correctiveAction).trim().slice(0, CORRECTIVE_ACTION_MAX)
      : "";
    const doc = await svc.acknowledgeBreach(
      req.params.id,
      u._id || u.id,
      u.fullName || u.name,
      correctiveAction
    );
    return envelope.sendOk(res, doc);
  } catch (e) {
    return envelope.sendErr(res, e, e.code, e.statusCode || 500);
  }
};
