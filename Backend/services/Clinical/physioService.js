/**
 * physioService.js — R7bj-F1.
 *
 * Business logic for the Physiotherapy module. Controllers stay thin; this
 * file owns validation, status transitions, audit append, and the billing
 * handoff.
 *
 * Public surface (all return plain JS objects via .lean()/.toJSON()):
 *
 *   createPlan(payload, actor)
 *     Validate admission is Active. Stamp actor trio. Push first audit row.
 *
 *   updatePlan(id, payload, actor)
 *     Strips `sessionsCompleted` and `status` from payload (those have
 *     dedicated endpoints — see completePlan / cancelPlan / completeSession).
 *
 *   completePlan(id, actor) / cancelPlan(id, actor, reason)
 *     Atomic status transition. Always appends an audit row.
 *
 *   createSession(planId, payload, actor)
 *     Inherits UHID / admissionId / patientName from parent plan.
 *     Validates sessionType ∈ plan.modalitySet.
 *
 *   completeSession(id, actor)
 *     Atomic findOneAndUpdate({status: SCHEDULED|MISSED}, COMPLETED).
 *     On success: increments plan.sessionsCompleted and emits a PHYSIO_SESSION
 *     BillingTrigger via _emitPhysioBillingTrigger.
 *
 *   cancelSession(id, actor, reason)
 *     Atomic transition; no billing emit.
 *
 *   listPlansByAdmission / listSessionsByPatient / statsForTherapist
 *     Read paths used by the Physiotherapist Console tabs.
 *
 * Errors thrown carry { status, code } so the controller can map straight
 * to apiEnvelope.sendErr() with no further translation.
 */
"use strict";

const mongoose = require("mongoose");
const PhysioPlan    = require("../../models/Clinical/PhysioPlanModel");
const PhysioSession = require("../../models/Clinical/PhysioSessionModel");
const Admission     = require("../../models/Patient/admissionModel");
const BillingTrigger = require("../../models/Billing/BillingTrigger");
const { toDec, toNum } = require("../../utils/money");

const MODALITY_ENUM  = PhysioPlan.MODALITY_ENUM;
const FREQUENCY_ENUM = PhysioPlan.FREQUENCY_ENUM;

function _err(status, message, code) {
  const e = new Error(message);
  e.status = status;
  if (code) e.code = code;
  return e;
}

function _actorTrio(actor = {}) {
  return {
    id:   actor._id || actor.id || null,
    name: actor.fullName || actor.name || actor.employeeId || "",
    role: actor.role || "",
  };
}

function _auditRow(action, actor, reason, meta) {
  const a = _actorTrio(actor);
  return {
    action,
    at:       new Date(),
    byUserId: a.id,
    byName:   a.name,
    byRole:   a.role,
    reason:   reason || "",
    meta:     meta || undefined,
  };
}

// ── Service-code derivation ────────────────────────────────────
// PHY-CRIT-1/2/3 (R7bi billing audit) wants every physio session billed.
// IPD-PHY-001 is the default catalog code. If the session uses a SPECIFIC
// machine modality (ULTRASOUND/SWD/TENS/IFC), bill against the per-modality
// code so the audit trail tells revenue which machine ran. Manual / exercise
// / mobilisation sessions all roll up to IPD-PHY-001 (the consult fee).
function _serviceCodeFor(sessionType = "") {
  const t = String(sessionType || "").toUpperCase();
  if (t === "ULTRASOUND") return "IPD-PHY-US";
  if (t === "SWD")        return "IPD-PHY-SWD";
  if (t === "TENS")       return "IPD-PHY-TENS";
  if (t === "IFC")        return "IPD-PHY-IFC";
  if (t === "CHEST_PHYSIO") return "IPD-PHY-CHEST";
  return "IPD-PHY-001";
}

// ── Billing emit ───────────────────────────────────────────────
// PHY-CRIT-1/2/3: every COMPLETED session writes a BillingTrigger so the
// IPD ledger picks it up via the same auto-bill sweep that handles MAR,
// vitals, and nurse-notes. NOTE for F5: BillingTrigger.orderedByRole enum
// must include "Physiotherapist" before this row can validate.
async function _emitPhysioBillingTrigger(session, actor) {
  const fee = toNum(session.sessionFee);
  if (!session.admissionId) {
    // OPD-attached sessions don't bill from here (the OPD invoice owns
    // them). Silently NOOP — audit trail is preserved on the session
    // doc itself.
    return null;
  }
  const a = _actorTrio(actor);
  const dateKey = new Date(session.sessionDate || Date.now())
    .toISOString().slice(0, 10);

  const payload = {
    admissionId:  session.admissionId,
    UHID:         session.UHID,
    patientType:  "IPD",

    serviceCode:  _serviceCodeFor(session.sessionType),
    serviceName:  `Physiotherapy Session — ${session.sessionType || "General"}`,
    quantity:     1,
    unitPrice:    toDec(fee),
    totalAmount:  toDec(fee),

    sourceType:           "Procedure",   // Closest fit in the existing enum
                                         // ("PHYSIO_SESSION" can be added
                                         //  to BillingTrigger.sourceType
                                         //  later; for now Procedure +
                                         //  sourceDocumentModel disambiguates).
    sourceDocumentId:     session._id,
    sourceDocumentModel:  "PhysioSession",

    orderedBy:            a.name || "Physiotherapist",
    orderedById:          a.id,
    orderedByRole:        "Physiotherapist",
    orderedAt:            new Date(),
    orderDetails:         `Physiotherapy session — ${session.sessionType || ""} (${session.duration_min || 0} min)`,

    completedBy:          a.name || "Physiotherapist",
    completedById:        a.id,
    completedByRole:      "Physiotherapist",
    completedAt:          new Date(),

    triggeredBy:          a.name || "Physiotherapist",
    triggeredById:        a.id,
    triggeredByRole:      "Physiotherapist",

    status:               "pending",     // billing-v3 sweep picks it up
    dateKey,
    department:           "Physiotherapy",
    autoCharged:          false,
  };

  try {
    const trigger = await BillingTrigger.create(payload);
    return trigger;
  } catch (e) {
    // Duplicate (E11000) is benign — same session re-completed (shouldn't
    // happen because of the atomic status guard, but defensive). Log and
    // move on; the session itself is already COMPLETED.
    if (e && e.code === 11000) return null;
    // Don't blow up the session completion just because billing failed —
    // the IPD ledger's "Stuck Triggers" sweep handles retries. Log and
    // continue.
    // eslint-disable-next-line no-console
    console.error("[physioService] BillingTrigger.create failed:", e.message);
    return null;
  }
}

// ════════════════════════════════════════════════════════════════
// PLANS
// ════════════════════════════════════════════════════════════════
async function createPlan(payload = {}, actor = {}) {
  if (!payload.admissionId || !mongoose.isValidObjectId(payload.admissionId)) {
    throw _err(400, "admissionId required", "VALIDATION");
  }
  const adm = await Admission.findById(payload.admissionId)
    .select("UHID patientName status hospitalId")
    .lean();
  if (!adm) throw _err(404, "Admission not found", "NOT_FOUND");
  if (adm.status !== "Active") {
    throw _err(409, `Admission is ${adm.status} — only Active admissions can carry a physio plan`, "ADMISSION_INACTIVE");
  }
  if (!payload.sessionsTotal || Number(payload.sessionsTotal) < 1) {
    throw _err(400, "sessionsTotal must be ≥ 1", "VALIDATION");
  }
  if (!payload.frequency || !FREQUENCY_ENUM.includes(payload.frequency)) {
    throw _err(400, `frequency must be one of ${FREQUENCY_ENUM.join(", ")}`, "VALIDATION");
  }
  // Validate every modality is in the canonical enum.
  const ms = Array.isArray(payload.modalitySet) ? payload.modalitySet : [];
  for (const m of ms) {
    if (!MODALITY_ENUM.includes(m)) {
      throw _err(400, `Unknown modality "${m}"`, "VALIDATION");
    }
  }

  const a = _actorTrio(actor);
  const doc = await PhysioPlan.create({
    admissionId:    adm._id,
    UHID:           adm.UHID,
    patientName:    adm.patientName || payload.patientName || "",
    diagnosis:      payload.diagnosis || "",
    goals:          Array.isArray(payload.goals) ? payload.goals : [],
    modalitySet:    ms,
    sessionsTotal:  Number(payload.sessionsTotal),
    sessionsCompleted: 0,
    frequency:      payload.frequency,
    dischargeAdvice: payload.dischargeAdvice || "",
    createdById:    a.id,
    createdByName:  a.name,
    createdByRole:  a.role,
    status:         "ACTIVE",
    hospitalId:     adm.hospitalId || payload.hospitalId,
    auditTrail:     [_auditRow("CREATED", actor)],
  });
  return doc.toJSON();
}

async function updatePlan(id, payload = {}, actor = {}) {
  if (!mongoose.isValidObjectId(id)) throw _err(400, "Invalid plan id", "VALIDATION");
  const plan = await PhysioPlan.findById(id);
  if (!plan) throw _err(404, "Plan not found", "NOT_FOUND");
  if (plan.status !== "ACTIVE") {
    throw _err(409, `Plan is ${plan.status} — cannot edit a closed plan`, "ILLEGAL_TRANSITION");
  }
  // Strip protected fields. sessionsCompleted is moved ONLY by the sessions
  // endpoint; status has dedicated complete/cancel actions; createdBy* are
  // immutable once stamped.
  const protectedKeys = [
    "sessionsCompleted", "status", "createdById", "createdByName",
    "createdByRole", "admissionId", "UHID", "printCount", "auditTrail",
    "closedAt", "closedReason",
  ];
  for (const k of protectedKeys) {
    if (k in payload) delete payload[k];
  }
  // Validate any new modalitySet entries.
  if (Array.isArray(payload.modalitySet)) {
    for (const m of payload.modalitySet) {
      if (!MODALITY_ENUM.includes(m)) {
        throw _err(400, `Unknown modality "${m}"`, "VALIDATION");
      }
    }
  }
  if (payload.frequency && !FREQUENCY_ENUM.includes(payload.frequency)) {
    throw _err(400, `frequency must be one of ${FREQUENCY_ENUM.join(", ")}`, "VALIDATION");
  }

  Object.assign(plan, payload);
  plan.auditTrail.push(_auditRow("UPDATED", actor, payload._reason || "", { fields: Object.keys(payload) }));
  await plan.save();
  return plan.toJSON();
}

async function completePlan(id, actor = {}, reason = "") {
  if (!mongoose.isValidObjectId(id)) throw _err(400, "Invalid plan id", "VALIDATION");
  const a = _actorTrio(actor);
  const plan = await PhysioPlan.findOneAndUpdate(
    { _id: id, status: "ACTIVE" },
    {
      $set: { status: "COMPLETED", closedAt: new Date(), closedReason: reason || "" },
      $push: { auditTrail: _auditRow("COMPLETED", actor, reason) },
    },
    { new: true },
  );
  if (!plan) throw _err(409, "Plan not found or not in ACTIVE state", "ILLEGAL_TRANSITION");
  return plan.toJSON();
}

async function cancelPlan(id, actor = {}, reason = "") {
  if (!mongoose.isValidObjectId(id)) throw _err(400, "Invalid plan id", "VALIDATION");
  if (!reason || !String(reason).trim()) {
    throw _err(400, "Cancel reason required", "VALIDATION");
  }
  const plan = await PhysioPlan.findOneAndUpdate(
    { _id: id, status: "ACTIVE" },
    {
      $set: { status: "CANCELLED", closedAt: new Date(), closedReason: reason },
      $push: { auditTrail: _auditRow("CANCELLED", actor, reason) },
    },
    { new: true },
  );
  if (!plan) throw _err(409, "Plan not found or not in ACTIVE state", "ILLEGAL_TRANSITION");
  return plan.toJSON();
}

// ════════════════════════════════════════════════════════════════
// SESSIONS
// ════════════════════════════════════════════════════════════════
async function createSession(planId, payload = {}, actor = {}) {
  if (!mongoose.isValidObjectId(planId)) throw _err(400, "Invalid planId", "VALIDATION");
  const plan = await PhysioPlan.findById(planId)
    .select("UHID patientName admissionId status modalitySet sessionsTotal sessionsCompleted hospitalId")
    .lean();
  if (!plan) throw _err(404, "Plan not found", "NOT_FOUND");
  if (plan.status !== "ACTIVE") {
    throw _err(409, `Plan is ${plan.status} — cannot add sessions`, "ILLEGAL_TRANSITION");
  }
  if (plan.sessionsCompleted >= plan.sessionsTotal) {
    throw _err(409, "Plan has already met its session quota", "QUOTA_REACHED");
  }
  // sessionType must be in plan.modalitySet (if the plan specified one).
  if (payload.sessionType && Array.isArray(plan.modalitySet) && plan.modalitySet.length > 0) {
    if (!plan.modalitySet.includes(payload.sessionType)) {
      throw _err(400, `sessionType "${payload.sessionType}" is not in plan.modalitySet`, "VALIDATION");
    }
  }
  if (payload.duration_min != null) {
    const d = Number(payload.duration_min);
    if (!Number.isFinite(d) || d < 5 || d > 120) {
      throw _err(400, "duration_min must be between 5 and 120", "VALIDATION");
    }
  }

  const a = _actorTrio(actor);
  const status = payload.status === "COMPLETED" ? "SCHEDULED" : (payload.status || "SCHEDULED");
  // We explicitly DON'T accept "COMPLETED" via create — completion is a
  // separate atomic transition that also emits the billing trigger. If a
  // caller wants to log a same-instant completion, they POST then PUT
  // /sessions/:id/complete.
  const doc = await PhysioSession.create({
    planId:         plan._id,
    admissionId:    plan.admissionId,
    UHID:           plan.UHID,
    patientName:    plan.patientName,
    sessionDate:    payload.sessionDate ? new Date(payload.sessionDate) : new Date(),
    sessionType:    payload.sessionType || "",
    duration_min:   payload.duration_min != null ? Number(payload.duration_min) : undefined,
    modalitiesUsed: Array.isArray(payload.modalitiesUsed) ? payload.modalitiesUsed : [],
    painScoreBefore: payload.painScoreBefore != null ? Number(payload.painScoreBefore) : undefined,
    painScoreAfter:  payload.painScoreAfter  != null ? Number(payload.painScoreAfter)  : undefined,
    tolerance:      payload.tolerance,
    patientCompliant: payload.patientCompliant !== false,
    notes:          payload.notes || "",
    sessionFee:     toDec(payload.sessionFee || 0),
    status,
    hospitalId:     plan.hospitalId,
  });
  return doc.toJSON();
}

async function completeSession(id, actor = {}) {
  if (!mongoose.isValidObjectId(id)) throw _err(400, "Invalid session id", "VALIDATION");
  const a = _actorTrio(actor);
  // Atomic transition: only SCHEDULED or MISSED sessions can be completed.
  // Re-completing an already-COMPLETED row is a no-op (returns null and
  // we 409 — prevents double-billing).
  const session = await PhysioSession.findOneAndUpdate(
    { _id: id, status: { $in: ["SCHEDULED", "MISSED"] } },
    {
      $set: {
        status:       "COMPLETED",
        signedById:   a.id,
        signedByName: a.name,
        signedAt:     new Date(),
      },
    },
    { new: true },
  );
  if (!session) throw _err(409, "Session not found or already completed/cancelled", "ILLEGAL_TRANSITION");

  // Increment parent plan's sessionsCompleted counter (single source of
  // truth for "doses delivered" — protected against payload tampering by
  // updatePlan's strip-list).
  await PhysioPlan.updateOne(
    { _id: session.planId },
    { $inc: { sessionsCompleted: 1 } },
  );

  // Emit billing trigger. Best-effort — failures are logged but do not
  // roll back the completion (the session is real, the bill row can be
  // retried from the "Stuck Triggers" sweep).
  try {
    const trigger = await _emitPhysioBillingTrigger(session, actor);
    if (trigger && trigger._id) {
      await PhysioSession.updateOne(
        { _id: session._id },
        { $set: { billingTriggerId: trigger._id } },
      );
      session.billingTriggerId = trigger._id;
    }
  } catch (_) { /* logged inside emit helper */ }

  return session.toJSON();
}

async function cancelSession(id, actor = {}, reason = "") {
  if (!mongoose.isValidObjectId(id)) throw _err(400, "Invalid session id", "VALIDATION");
  if (!reason || !String(reason).trim()) {
    throw _err(400, "Cancel reason required", "VALIDATION");
  }
  const session = await PhysioSession.findOneAndUpdate(
    { _id: id, status: { $in: ["SCHEDULED", "MISSED"] } },
    {
      $set: {
        status:          "CANCELLED",
        cancelledReason: reason,
      },
    },
    { new: true },
  );
  if (!session) throw _err(409, "Session not found or not in a cancellable state", "ILLEGAL_TRANSITION");
  return session.toJSON();
}

// ════════════════════════════════════════════════════════════════
// READS
// ════════════════════════════════════════════════════════════════
async function listPlans(filter = {}) {
  const q = {};
  if (filter.admissionId && mongoose.isValidObjectId(filter.admissionId)) {
    q.admissionId = filter.admissionId;
  }
  if (filter.UHID)   q.UHID   = String(filter.UHID).toUpperCase();
  if (filter.status) q.status = filter.status;
  if (filter.from || filter.to) {
    q.createdAt = {};
    if (filter.from) q.createdAt.$gte = new Date(filter.from);
    if (filter.to)   q.createdAt.$lte = new Date(filter.to);
  }
  const rows = await PhysioPlan.find(q)
    .sort({ createdAt: -1 })
    .limit(200)
    .lean();
  return rows;
}

async function listSessions(filter = {}) {
  const q = {};
  if (filter.planId && mongoose.isValidObjectId(filter.planId)) {
    q.planId = filter.planId;
  }
  if (filter.UHID)   q.UHID   = String(filter.UHID).toUpperCase();
  if (filter.status) q.status = filter.status;
  if (filter.from || filter.to) {
    q.sessionDate = {};
    if (filter.from) q.sessionDate.$gte = new Date(filter.from);
    if (filter.to)   q.sessionDate.$lte = new Date(filter.to);
  }
  const page  = Math.max(1, Number(filter.page  || 1));
  const limit = Math.min(200, Math.max(1, Number(filter.limit || 50)));
  const skip  = (page - 1) * limit;
  const [rows, total] = await Promise.all([
    PhysioSession.find(q).sort({ sessionDate: -1 }).skip(skip).limit(limit).lean({ getters: false }),
    PhysioSession.countDocuments(q),
  ]);
  // The toJSON Decimal128 unwrap doesn't run on .lean() — unwrap by hand for
  // wire shape parity.
  for (const r of rows) {
    if (r.sessionFee && typeof r.sessionFee.toString === "function") {
      r.sessionFee = Number(r.sessionFee.toString()) || 0;
    }
  }
  return { rows, total, page, limit };
}

async function statsForTherapist({ from, to, therapistId } = {}) {
  const q = {};
  if (therapistId && mongoose.isValidObjectId(therapistId)) {
    q.signedById = therapistId;
  }
  if (from || to) {
    q.sessionDate = {};
    if (from) q.sessionDate.$gte = new Date(from);
    if (to)   q.sessionDate.$lte = new Date(to);
  }
  const [completed, scheduled, missed, cancelled, activePlans] = await Promise.all([
    PhysioSession.countDocuments({ ...q, status: "COMPLETED" }),
    PhysioSession.countDocuments({ ...q, status: "SCHEDULED" }),
    PhysioSession.countDocuments({ ...q, status: "MISSED" }),
    PhysioSession.countDocuments({ ...q, status: "CANCELLED" }),
    PhysioPlan.countDocuments({ status: "ACTIVE" }),
  ]);
  return { completed, scheduled, missed, cancelled, activePlans };
}

module.exports = {
  createPlan,
  updatePlan,
  completePlan,
  cancelPlan,
  createSession,
  completeSession,
  cancelSession,
  listPlans,
  listSessions,
  statsForTherapist,
  // Exported for tests / billing-audit sweeps.
  _emitPhysioBillingTrigger,
  _serviceCodeFor,
};
