// controllers/Pharmacy/kitchenIndentController.js
// ════════════════════════════════════════════════════════════════════
// R7bj-F2 — KitchenIndent close-loop HTTP layer (thin wrapper around
// services/Pharmacy/kitchenIndentService). Response envelope normalised
// via utils/apiEnvelope (R7bh-F8 / R7bg-3-CRIT-12 spec).
// ════════════════════════════════════════════════════════════════════

"use strict";

const svc = require("../../services/Pharmacy/kitchenIndentService");
const { sendOk, sendErr } = require("../../utils/apiEnvelope");

const actor = (req) => ({
  _id:      req.user?._id || req.user?.id,
  fullName: req.user?.fullName || req.user?.employeeId || "",
  role:     req.user?.role || "",
});

// PUT /api/kitchen-indent/:id/mark-prepared
exports.markPrepared = async (req, res, next) => {
  try {
    const doc = await svc.markPrepared(req.params.id, actor(req));
    return sendOk(res, doc);
  } catch (e) {
    if (typeof e.status === "number") return sendErr(res, e, e.code, e.status);
    next(e);
  }
};

// PUT /api/kitchen-indent/:id/mark-served
exports.markServed = async (req, res, next) => {
  try {
    const doc = await svc.markServed(req.params.id, actor(req));
    return sendOk(res, doc);
  } catch (e) {
    if (typeof e.status === "number") return sendErr(res, e, e.code, e.status);
    next(e);
  }
};

// PUT /api/kitchen-indent/:id/mark-delivered
exports.markDelivered = async (req, res, next) => {
  try {
    const doc = await svc.markDelivered(req.params.id, actor(req));
    return sendOk(res, doc);
  } catch (e) {
    if (typeof e.status === "number") return sendErr(res, e, e.code, e.status);
    next(e);
  }
};

// PUT /api/kitchen-indent/:id/cancel
exports.cancel = async (req, res, next) => {
  try {
    const doc = await svc.cancelIndent(req.params.id, actor(req), req.body?.reason || "");
    return sendOk(res, doc);
  } catch (e) {
    if (typeof e.status === "number") return sendErr(res, e, e.code, e.status);
    next(e);
  }
};

// GET /api/kitchen-indent  (kitchen queue, ?date&status&mealSlot)
exports.listForKitchen = async (req, res, next) => {
  try {
    const data = await svc.listForKitchen({
      date:     req.query?.date,
      status:   req.query?.status,
      mealSlot: req.query?.mealSlot,
      limit:    Number(req.query?.limit) || 200,
    });
    return sendOk(res, data, { count: data.length });
  } catch (e) { next(e); }
};

// GET /api/kitchen-indent/wardboy-queue  (?wardId)
exports.listForWardBoy = async (req, res, next) => {
  try {
    const data = await svc.listForWardBoy({
      wardId: req.query?.wardId,
      limit:  Number(req.query?.limit) || 200,
    });
    return sendOk(res, data, { count: data.length });
  } catch (e) { next(e); }
};

// GET /api/kitchen-indent/:id
exports.getOne = async (req, res, next) => {
  try {
    const doc = await svc.getById(req.params.id);
    if (!doc) return sendErr(res, "Kitchen indent not found", "NOT_FOUND", 404);
    return sendOk(res, doc);
  } catch (e) { next(e); }
};
