// controllers/Clinical/adverseFoodReactionController.js
// ════════════════════════════════════════════════════════════════════
// R7bj-F2 / R7bi-KI-CRIT-1 — HTTP layer for the food-ADR register.
// Envelope normalised via utils/apiEnvelope (R7bh-F8).
// ════════════════════════════════════════════════════════════════════

"use strict";

const svc = require("../../services/Clinical/adverseFoodReactionService");
const { sendOk, sendErr } = require("../../utils/apiEnvelope");

function _mapStatus(e) {
  if (e.status) return e.status;
  if (e.code === "ARG_MISSING")    return 400;
  if (e.code === "NOT_FOUND")      return 404;
  if (e.code === "ALREADY_CLOSED") return 409;
  if (e.code === "NOT_OPEN")       return 409;
  return 500;
}

const actor = (req) => ({
  _id:      req.user?._id || req.user?.id,
  fullName: req.user?.fullName || req.user?.employeeId || "",
  role:     req.user?.role || "",
});

// POST /api/food-reactions
exports.create = async (req, res, next) => {
  try {
    const doc = await svc.create(req.body || {}, actor(req));
    return sendOk(res, doc, undefined, 201);
  } catch (e) {
    const s = _mapStatus(e);
    if (s !== 500) return sendErr(res, e, e.code, s);
    next(e);
  }
};

// PUT /api/food-reactions/:id
exports.update = async (req, res, next) => {
  try {
    const doc = await svc.update(req.params.id, req.body || {}, actor(req));
    return sendOk(res, doc);
  } catch (e) {
    const s = _mapStatus(e);
    if (s !== 500) return sendErr(res, e, e.code, s);
    next(e);
  }
};

// PUT /api/food-reactions/:id/close
exports.close = async (req, res, next) => {
  try {
    const doc = await svc.close(req.params.id, actor(req), req.body?.reason || "");
    return sendOk(res, doc);
  } catch (e) {
    const s = _mapStatus(e);
    if (s !== 500) return sendErr(res, e, e.code, s);
    next(e);
  }
};

// PUT /api/food-reactions/:id/escalate
exports.escalate = async (req, res, next) => {
  try {
    const doc = await svc.escalate(req.params.id, actor(req), req.body?.reason || "");
    return sendOk(res, doc);
  } catch (e) {
    const s = _mapStatus(e);
    if (s !== 500) return sendErr(res, e, e.code, s);
    next(e);
  }
};

// PUT /api/food-reactions/:id/reopen
exports.reopen = async (req, res, next) => {
  try {
    const doc = await svc.reopen(req.params.id, actor(req), req.body?.reason || "");
    return sendOk(res, doc);
  } catch (e) {
    const s = _mapStatus(e);
    if (s !== 500) return sendErr(res, e, e.code, s);
    next(e);
  }
};

// GET /api/food-reactions/:id
exports.getOne = async (req, res, next) => {
  try {
    const doc = await svc.getById(req.params.id);
    if (!doc) return sendErr(res, "Adverse food reaction not found", "NOT_FOUND", 404);
    return sendOk(res, doc);
  } catch (e) { next(e); }
};

// GET /api/food-reactions?uhid&status&severity&kitchenIndentId
exports.list = async (req, res, next) => {
  try {
    const data = await svc.list({
      uhid:            req.query?.uhid,
      status:          req.query?.status,
      severity:        req.query?.severity,
      kitchenIndentId: req.query?.kitchenIndentId,
      limit:           Number(req.query?.limit) || 100,
    });
    return sendOk(res, data, { count: data.length });
  } catch (e) { next(e); }
};
