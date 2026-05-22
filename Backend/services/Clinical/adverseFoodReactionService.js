// services/Clinical/adverseFoodReactionService.js
// ════════════════════════════════════════════════════════════════════
// R7bj-F2 / R7bi-KI-CRIT-1 — Adverse Food Reaction register service
// (NABH COP.21). Same shape as adrReportService (drug ADR) so the
// controller / route layout is a copy-with-rename for the food path.
// ════════════════════════════════════════════════════════════════════

"use strict";

const AdverseFoodReaction = require("../../models/Clinical/AdverseFoodReactionModel");

function _audit(action, actor = {}, reason = "") {
  return {
    action,
    at:       new Date(),
    byName:   actor.fullName || actor.name || "",
    byRole:   actor.role || "",
    byUserId: actor._id || actor.id || null,
    reason,
  };
}

function _err(code, message, status) {
  const e = new Error(message);
  e.code = code; e.status = status;
  return e;
}

async function create(payload, actor = {}) {
  if (!payload?.patientUHID)         throw _err("ARG_MISSING", "patientUHID is required", 400);
  if (!payload?.reactionDescription) throw _err("ARG_MISSING", "reactionDescription is required", 400);
  if (!payload?.severity)            throw _err("ARG_MISSING", "severity is required", 400);

  const body = {
    ...payload,
    patientUHID:    String(payload.patientUHID).toUpperCase().trim(),
    reportedById:   actor._id || actor.id || null,
    reportedByName: actor.fullName || actor.name || "",
    reportedByRole: actor.role || "",
    reportedAt:     new Date(),
    status:         "OPEN",
    auditTrail:     [_audit("CREATED", actor, `Severity=${payload.severity}`)],
  };
  const doc = await AdverseFoodReaction.create(body);
  return doc;
}

async function update(id, payload, actor = {}) {
  const doc = await AdverseFoodReaction.findById(id);
  if (!doc) throw _err("NOT_FOUND", "Adverse food reaction not found", 404);
  if (doc.status === "CLOSED") {
    throw _err("ALREADY_CLOSED", "Cannot edit a CLOSED reaction — reopen first", 409);
  }
  const body = { ...(payload || {}) };
  delete body.auditTrail;
  delete body.status;
  delete body.reportedById;
  delete body.reportedByName;
  delete body.reportedByRole;
  delete body.reportedAt;
  for (const [k, v] of Object.entries(body)) {
    if (k === "patientUHID") doc.set(k, String(v).toUpperCase().trim());
    else doc.set(k, v);
  }
  doc.auditTrail.push(_audit("UPDATED", actor));
  await doc.save();
  return doc;
}

async function close(id, actor = {}, reason = "") {
  const updated = await AdverseFoodReaction.findOneAndUpdate(
    { _id: id, status: { $in: ["OPEN", "ESCALATED"] } },
    {
      $set:  { status: "CLOSED", outcome: "RESOLVED" },
      $push: { auditTrail: _audit("CLOSED", actor, reason) },
    },
    { new: true },
  );
  if (!updated) {
    const existing = await AdverseFoodReaction.findById(id).lean();
    if (!existing) throw _err("NOT_FOUND", "Adverse food reaction not found", 404);
    throw _err("ALREADY_CLOSED", `Cannot close a ${existing.status} reaction`, 409);
  }
  return updated;
}

async function escalate(id, actor = {}, reason = "") {
  const updated = await AdverseFoodReaction.findOneAndUpdate(
    { _id: id, status: "OPEN" },
    {
      $set:  { status: "ESCALATED", outcome: "ESCALATED" },
      $push: { auditTrail: _audit("ESCALATED", actor, reason) },
    },
    { new: true },
  );
  if (!updated) {
    const existing = await AdverseFoodReaction.findById(id).lean();
    if (!existing) throw _err("NOT_FOUND", "Adverse food reaction not found", 404);
    throw _err("NOT_OPEN", `Cannot escalate a ${existing.status} reaction`, 409);
  }
  return updated;
}

async function reopen(id, actor = {}, reason = "") {
  const updated = await AdverseFoodReaction.findOneAndUpdate(
    { _id: id, status: "CLOSED" },
    {
      $set:  { status: "OPEN" },
      $push: { auditTrail: _audit("REOPENED", actor, reason) },
    },
    { new: true },
  );
  if (!updated) throw _err("NOT_FOUND", "Adverse food reaction not found or not CLOSED", 404);
  return updated;
}

async function getById(id) {
  if (!id) return null;
  return AdverseFoodReaction.findById(id).lean();
}

async function list({ uhid, status, severity, kitchenIndentId, limit = 100 } = {}) {
  const q = {};
  if (uhid)            q.patientUHID     = String(uhid).toUpperCase().trim();
  if (status)          q.status          = status;
  if (severity)        q.severity        = severity;
  if (kitchenIndentId) q.kitchenIndentId = kitchenIndentId;
  return AdverseFoodReaction
    .find(q)
    .sort({ reportedAt: -1, createdAt: -1 })
    .limit(Math.min(500, Math.max(1, Number(limit) || 100)))
    .lean();
}

module.exports = {
  create,
  update,
  close,
  escalate,
  reopen,
  getById,
  list,
};
