/**
 * grievanceService.js  (R7bf-G / A5-CRIT-5 / NABH PRE.6)
 *
 * Service-layer for the patient-grievance register. Implements the
 * raise → assign → resolve → close workflow with SLA tracking and
 * an append-only audit log.
 */
const Grievance = require("../../models/Quality/GrievanceModel");
const { nextSequence, formatId } = require("../../utils/counter");

function _audit(action, actor = {}, opts = {}) {
  return {
    action,
    at:        new Date(),
    byName:    actor.fullName || actor.name || "",
    byRole:    actor.role || "",
    byUserId:  actor._id || actor.id || null,
    fromStatus: opts.fromStatus || "",
    toStatus:   opts.toStatus || "",
    reason:    opts.reason || "",
  };
}

function _err(code, message, status) {
  const e = new Error(message);
  e.code = code; e.status = status;
  return e;
}

/**
 * Create a new grievance.
 */
async function create(payload, actor = {}) {
  if (!payload?.complainantName) throw _err("ARG_MISSING", "complainantName is required", 400);
  if (!payload?.category) throw _err("ARG_MISSING", "category is required", 400);
  if (!payload?.description) throw _err("ARG_MISSING", "description is required", 400);

  // Auto-generate ticket number — gap-less per the system invariant.
  const seq = await nextSequence("grievance");
  const ticketNumber = formatId("GRV", seq, 6); // e.g. GRV-000123

  const doc = await Grievance.create({
    ticketNumber,
    patientUHID:        payload.patientUHID ? String(payload.patientUHID).toUpperCase().trim() : "",
    complainantName:    payload.complainantName,
    complainantContact: payload.complainantContact || "",
    complainantType:    payload.complainantType || "PATIENT",
    category:           payload.category,
    description:        payload.description,
    raisedAt:           new Date(),
    slaHours:           Number.isFinite(payload.slaHours) ? payload.slaHours : 48,
    status:             "OPEN",
    auditTrail:         [_audit("CREATED", actor, { toStatus: "OPEN", reason: `Category=${payload.category}` })],
    hospitalId:         actor.hospitalId || payload.hospitalId || null,
  });
  return doc;
}

async function update(id, payload, actor = {}) {
  const doc = await Grievance.findById(id);
  if (!doc) throw _err("NOT_FOUND", "Grievance not found", 404);
  if (doc.status === "CLOSED") {
    throw _err("ALREADY_CLOSED", "Cannot edit a CLOSED grievance", 409);
  }
  // Block direct status / resolution mutations — use dedicated endpoints.
  const body = { ...(payload || {}) };
  delete body.auditTrail;
  delete body.status;
  delete body.ticketNumber;
  delete body.resolvedAt; delete body.resolvedBy; delete body.resolvedByName;
  delete body.escalatedAt; delete body.escalatedTo; delete body.escalatedToId;
  for (const [k, v] of Object.entries(body)) {
    if (k === "patientUHID" && v) doc.set(k, String(v).toUpperCase().trim());
    else doc.set(k, v);
  }
  doc.auditTrail.push(_audit("NOTE", actor, { reason: "Body update" }));
  await doc.save();
  return doc;
}

/**
 * Assign the grievance to a staff member.
 *   payload: { userId, userName, slaHours? }
 */
async function assign(id, payload = {}, actor = {}) {
  const updated = await Grievance.findOneAndUpdate(
    { _id: id, status: { $in: ["OPEN", "IN_PROGRESS", "ESCALATED"] } },
    {
      $set: {
        assignedTo:     payload.userId || null,
        assignedToName: payload.userName || "",
        assignedAt:     new Date(),
        status:         "IN_PROGRESS",
        slaHours:       Number.isFinite(payload.slaHours) ? payload.slaHours : undefined,
      },
      $push: {
        auditTrail: _audit("ASSIGNED", actor, {
          toStatus: "IN_PROGRESS",
          reason:   `Assigned to ${payload.userName || payload.userId || "—"}`,
        }),
      },
    },
    { new: true },
  );
  if (!updated) {
    const existing = await Grievance.findById(id).lean();
    if (!existing) throw _err("NOT_FOUND", "Grievance not found", 404);
    throw _err("INVALID_STATE", `Cannot assign a ${existing.status} grievance`, 409);
  }
  return updated;
}

/**
 * Resolve (status → RESOLVED). Closure (CLOSED) happens separately when
 * the complainant confirms satisfaction.
 *   payload: { resolutionNotes }
 */
async function resolve(id, payload = {}, actor = {}) {
  if (!payload?.resolutionNotes) throw _err("ARG_MISSING", "resolutionNotes is required", 400);
  const updated = await Grievance.findOneAndUpdate(
    { _id: id, status: { $in: ["OPEN", "IN_PROGRESS", "ESCALATED"] } },
    {
      $set: {
        status:         "RESOLVED",
        resolvedAt:     new Date(),
        resolvedBy:     actor._id || actor.id || null,
        resolvedByName: actor.fullName || actor.name || "",
        resolutionNotes: payload.resolutionNotes,
      },
      $push: {
        auditTrail: _audit("RESOLVED", actor, {
          toStatus: "RESOLVED",
          reason:   payload.resolutionNotes.slice(0, 200),
        }),
      },
    },
    { new: true },
  );
  if (!updated) {
    const existing = await Grievance.findById(id).lean();
    if (!existing) throw _err("NOT_FOUND", "Grievance not found", 404);
    throw _err("INVALID_STATE", `Cannot resolve a ${existing.status} grievance`, 409);
  }
  return updated;
}

async function close(id, payload = {}, actor = {}) {
  const updated = await Grievance.findOneAndUpdate(
    { _id: id, status: "RESOLVED" },
    {
      $set: {
        status: "CLOSED",
        satisfactionRating: Number.isFinite(payload.satisfactionRating)
          ? Math.max(1, Math.min(5, payload.satisfactionRating))
          : undefined,
      },
      $push: {
        auditTrail: _audit("CLOSED", actor, {
          fromStatus: "RESOLVED",
          toStatus:   "CLOSED",
          reason:     payload.satisfactionRating ? `Rating=${payload.satisfactionRating}/5` : "",
        }),
      },
    },
    { new: true },
  );
  if (!updated) {
    const existing = await Grievance.findById(id).lean();
    if (!existing) throw _err("NOT_FOUND", "Grievance not found", 404);
    throw _err("INVALID_STATE", `Cannot close a ${existing.status} grievance — resolve first`, 409);
  }
  return updated;
}

/**
 * Escalate — OPEN/IN_PROGRESS → ESCALATED. SLA breach or supervisor
 * intervention.
 */
async function escalate(id, payload = {}, actor = {}) {
  const updated = await Grievance.findOneAndUpdate(
    { _id: id, status: { $in: ["OPEN", "IN_PROGRESS"] } },
    {
      $set: {
        status:        "ESCALATED",
        escalatedAt:   new Date(),
        escalatedTo:   payload.escalatedTo || "",
        escalatedToId: payload.escalatedToId || null,
      },
      $push: {
        auditTrail: _audit("ESCALATED", actor, {
          toStatus: "ESCALATED",
          reason:   payload.reason || "",
        }),
      },
    },
    { new: true },
  );
  if (!updated) {
    const existing = await Grievance.findById(id).lean();
    if (!existing) throw _err("NOT_FOUND", "Grievance not found", 404);
    throw _err("INVALID_STATE", `Cannot escalate a ${existing.status} grievance`, 409);
  }
  return updated;
}

async function getById(id) {
  if (!id) return null;
  return Grievance.findById(id).lean();
}

async function list({ uhid, status, category, limit = 100 } = {}) {
  const q = {};
  if (uhid) q.patientUHID = String(uhid).toUpperCase().trim();
  if (status) q.status = status;
  if (category) q.category = category;
  return Grievance.find(q).sort({ raisedAt: -1 }).limit(Math.min(500, Math.max(1, limit))).lean();
}

/**
 * Cron worker — find every grievance where:
 *   • status ∈ ["OPEN", "IN_PROGRESS"]
 *   • raisedAt + slaHours hours < now
 * …and flip them to ESCALATED with reason="SLA breach". Returns
 * { scanned, escalated } for the cron logger.
 *
 * Wrapped by services/Quality/grievanceSlaCron.js (R7bh-F6) so the
 * scheduler in Backend/index.js doesn't reach inside grievanceService
 * to find this helper. NABH PRE.6 — SLA-breach escalator.
 */
async function escalateOverdue() {
  const now = new Date();
  // Find OPEN / IN_PROGRESS rows; SLA check happens per-row because
  // slaHours varies. Cap at 500 to keep the tick bounded.
  const rows = await Grievance.find({
    status: { $in: ["OPEN", "IN_PROGRESS"] },
  })
    .select("_id raisedAt slaHours status")
    .limit(500)
    .lean();
  let scanned = 0;
  let escalated = 0;
  for (const r of rows) {
    scanned += 1;
    const raised = new Date(r.raisedAt).getTime();
    const slaMs = (Number(r.slaHours) || 48) * 3600000;
    if (!Number.isFinite(raised) || raised + slaMs >= now.getTime()) continue;
    // CAS — only flip if still OPEN/IN_PROGRESS.
    const updated = await Grievance.findOneAndUpdate(
      { _id: r._id, status: { $in: ["OPEN", "IN_PROGRESS"] } },
      {
        $set: {
          status: "ESCALATED",
          escalatedAt: now,
          escalatedTo: "Cron — SLA breach",
        },
        $push: {
          auditTrail: {
            action: "ESCALATED",
            at: now,
            byName: "System (grievance-sla-cron)",
            byRole: "System",
            fromStatus: r.status,
            toStatus: "ESCALATED",
            reason: "SLA breach",
          },
        },
      },
      { new: false },
    );
    if (updated) escalated += 1;
  }
  return { scanned, escalated };
}

module.exports = { create, update, assign, resolve, close, escalate, escalateOverdue, getById, list };
