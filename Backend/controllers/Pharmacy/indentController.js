/**
 * indentController.js — thin HTTP layer over indentService.
 *
 * R7bh-F4 / R7bg-3-CRIT-12: envelope normalised via utils/apiEnvelope so
 * every response shares the { success, data, meta? } / { success, message,
 * code } contract. `meta.count` carries the array length.
 */
const svc = require("../../services/Pharmacy/indentService");
const { sendOk, sendErr } = require("../../utils/apiEnvelope");

function mapStatus(code) {
  if (code === "ARG_MISSING" || code === "INVALID_QTY" || code === "NOTHING_TO_RELEASE") return 400;
  if (code === "ALREADY_CLOSED" || code === "ALREADY_RELEASED" || code === "ALREADY_ACKED") return 409;
  if (code === "ACK_OWNERSHIP_MISMATCH" || code === "NOT_ACKNOWLEDGED") return 409;
  return 500;
}

// POST /api/indents
exports.create = async (req, res, next) => {
  try {
    const doc = await svc.createIndent({
      admissionId: req.body?.admissionId,
      items:       req.body?.items,
      urgency:     req.body?.urgency,
      notes:       req.body?.notes,
      user:        req.user || {},
    });
    return sendOk(res, doc, undefined, 201);
  } catch (e) {
    const status = e.status || mapStatus(e.code);
    if (status !== 500) return sendErr(res, e, e.code, status);
    next(e);
  }
};

// GET /api/indents
exports.list = async (req, res, next) => {
  try {
    const list = await svc.listIndents(req.query || {});
    return sendOk(res, list, { count: list.length });
  } catch (e) { next(e); }
};

// GET /api/indents/:id
exports.getOne = async (req, res, next) => {
  try {
    const doc = await svc.getIndent(req.params.id);
    return sendOk(res, doc);
  } catch (e) {
    if (e.status === 404) return sendErr(res, e, "NOT_FOUND", 404);
    next(e);
  }
};

// POST /api/indents/:id/acknowledge
exports.acknowledge = async (req, res, next) => {
  try {
    const doc = await svc.acknowledgeIndent(req.params.id, req.user || {});
    return sendOk(res, doc);
  } catch (e) {
    const status = e.status || mapStatus(e.code);
    if (status !== 500) return sendErr(res, e, e.code, status);
    next(e);
  }
};

// POST /api/indents/:id/release  { items: [{ itemId, issuedQty, batchNumber, ... }] }
exports.release = async (req, res, next) => {
  try {
    const doc = await svc.releaseIndent(req.params.id, {
      items: req.body?.items,
      user:  req.user || {},
    });
    return sendOk(res, doc);
  } catch (e) {
    const status = e.status || mapStatus(e.code);
    if (status !== 500) return sendErr(res, e, e.code, status);
    next(e);
  }
};

// POST /api/indents/:id/cancel  { reason }
exports.cancel = async (req, res, next) => {
  try {
    const doc = await svc.cancelIndent(req.params.id, {
      reason: req.body?.reason,
      user:   req.user || {},
    });
    return sendOk(res, doc);
  } catch (e) {
    const status = e.status || mapStatus(e.code);
    if (status !== 500) return sendErr(res, e, e.code, status);
    next(e);
  }
};
