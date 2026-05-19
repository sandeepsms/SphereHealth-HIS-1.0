/**
 * indentController.js — thin HTTP layer over indentService.
 */
const svc = require("../../services/Pharmacy/indentService");

function mapStatus(code) {
  if (code === "ARG_MISSING" || code === "INVALID_QTY" || code === "NOTHING_TO_RELEASE") return 400;
  if (code === "ALREADY_CLOSED" || code === "ALREADY_RELEASED") return 409;
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
    res.status(201).json({ success: true, data: doc });
  } catch (e) {
    const status = e.status || mapStatus(e.code);
    if (status !== 500) return res.status(status).json({ success: false, message: e.message, code: e.code });
    next(e);
  }
};

// GET /api/indents
exports.list = async (req, res, next) => {
  try {
    const list = await svc.listIndents(req.query || {});
    res.json({ success: true, data: list, count: list.length });
  } catch (e) { next(e); }
};

// GET /api/indents/:id
exports.getOne = async (req, res, next) => {
  try {
    const doc = await svc.getIndent(req.params.id);
    res.json({ success: true, data: doc });
  } catch (e) {
    if (e.status === 404) return res.status(404).json({ success: false, message: e.message });
    next(e);
  }
};

// POST /api/indents/:id/acknowledge
exports.acknowledge = async (req, res, next) => {
  try {
    const doc = await svc.acknowledgeIndent(req.params.id, req.user || {});
    res.json({ success: true, data: doc });
  } catch (e) {
    const status = e.status || mapStatus(e.code);
    if (status !== 500) return res.status(status).json({ success: false, message: e.message, code: e.code });
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
    res.json({ success: true, data: doc });
  } catch (e) {
    const status = e.status || mapStatus(e.code);
    if (status !== 500) return res.status(status).json({ success: false, message: e.message, code: e.code });
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
    res.json({ success: true, data: doc });
  } catch (e) {
    const status = e.status || mapStatus(e.code);
    if (status !== 500) return res.status(status).json({ success: false, message: e.message, code: e.code });
    next(e);
  }
};
