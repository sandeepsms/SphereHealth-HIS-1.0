/**
 * criticalValueAlerter.js  (R7bf-G / A5-CRIT-1 / NABH AAC.6 + IPSG.2)
 *
 * Service-layer for the Critical / Panic Value Alert ledger. Pre-R7bf
 * critical lab and vital values had no formal acknowledgement loop:
 * the LIS could flag a K+ of 6.8 mmol/L and nothing in the system
 * obliged anyone to act on it inside the NABH-mandated 30-min window.
 * This module ships the four operations needed to close the loop:
 *
 *   emit(...)            → create an alert
 *   acknowledge(...)     → clinician sign-off (OPEN/ESCALATED → ACK)
 *   listOpen(...)        → unack queue for the on-duty team
 *   escalateOverdue()    → cron worker — auto-bump SLA-breachers
 *
 * The escalation strategy is intentionally simple: any OPEN alert whose
 * age exceeds slaMinutes is flipped to ESCALATED and tagged with the
 * default escalation target ("Nurse" charge role). Real-world chat /
 * SMS / paging integrations are deferred — for now the audit row +
 * status flip drive the UI bell.
 *
 * NABH artefacts: every transition is logged into auditTrail[] with the
 * actor + timestamp + reason, satisfying R13.
 */
const CriticalValueAlert = require("../../models/Clinical/CriticalValueAlertModel");

function _audit(action, opts = {}) {
  return {
    action,
    at:       new Date(),
    byName:   opts.byName   || "system",
    byRole:   opts.byRole   || "",
    byUserId: opts.byUserId || null,
    reason:   opts.reason   || "",
  };
}

/**
 * Emit a new critical-value alert. The lab service / vital sheet / drug
 * allergy checker / imaging service should call this whenever a flagged
 * value lands.
 *
 * @param {object} args
 *   kind          — 'LAB' | 'VITAL' | 'DRUG' | 'IMAGING' | 'OTHER'
 *   patientUHID   — uppercase UHID string
 *   patientName   — display name
 *   sourceRef     — ObjectId of originating document (optional)
 *   sourceKind    — string label of the source collection (optional)
 *   valueLabel    — human-readable label, e.g. "K+ 6.8 mmol/L"
 *   severity      — 'CRITICAL' | 'PANIC'
 *   slaMinutes    — defaults to 30 — override for PANIC (e.g. 10)
 *   emittedBy     — actor name (system | user fullName)
 *   emittedById   — ObjectId of the User who created the alert
 *   notes         — optional free text
 */
async function emit({
  kind,
  patientUHID,
  patientName,
  sourceRef = null,
  sourceKind = "",
  valueLabel,
  severity = "CRITICAL",
  slaMinutes,
  emittedBy = "system",
  emittedById = null,
  notes = "",
  hospitalId = null,
} = {}) {
  if (!kind) throw new Error("kind is required");
  if (!patientUHID) throw new Error("patientUHID is required");
  if (!valueLabel) throw new Error("valueLabel is required");

  const doc = await CriticalValueAlert.create({
    kind,
    patientUHID: String(patientUHID).toUpperCase().trim(),
    patientName: patientName || "",
    sourceRef,
    sourceKind,
    valueLabel,
    severity,
    slaMinutes: Number.isFinite(slaMinutes) && slaMinutes > 0 ? slaMinutes : (severity === "PANIC" ? 10 : 30),
    emittedAt: new Date(),
    emittedBy,
    emittedById,
    notes,
    hospitalId,
    status: "OPEN",
    auditTrail: [_audit("EMITTED", { byName: emittedBy, byUserId: emittedById, reason: `Severity=${severity}; SLA ${slaMinutes || (severity === "PANIC" ? 10 : 30)}m.` })],
  });
  return doc;
}

/**
 * Clinician acknowledges an open / escalated alert.
 *
 * @param {string|ObjectId} id        — alert _id
 * @param {object} actor              — { _id, fullName, role }
 * @param {string} [notes]            — optional clinical action note
 */
async function acknowledge(id, actor = {}, notes = "") {
  if (!id) throw new Error("alert id is required");
  // CAS — only flip if currently OPEN or ESCALATED. If another clinician
  // beat us to it, return the existing doc as-is (idempotent).
  const updated = await CriticalValueAlert.findOneAndUpdate(
    { _id: id, status: { $in: ["OPEN", "ESCALATED"] } },
    {
      $set: {
        status: "ACK",
        acknowledgedAt: new Date(),
        acknowledgedBy: actor._id || actor.id || null,
        acknowledgedByName: actor.fullName || actor.name || "",
        acknowledgedByRole: actor.role || "",
        notes: notes || undefined,
      },
      $push: {
        auditTrail: _audit("ACKNOWLEDGED", {
          byName:   actor.fullName || actor.name || "",
          byRole:   actor.role || "",
          byUserId: actor._id || actor.id || null,
          reason:   notes || "",
        }),
      },
    },
    { new: true },
  );
  if (!updated) {
    const existing = await CriticalValueAlert.findById(id).lean();
    if (!existing) {
      const err = new Error("Alert not found");
      err.status = 404;
      throw err;
    }
    // Already acknowledged or closed — return as-is.
    return existing;
  }
  return updated;
}

/**
 * Manually close an alert (typically after clinical action — re-test
 * negative, antidote given, etc.).
 */
async function close(id, actor = {}, reason = "") {
  if (!id) throw new Error("alert id is required");
  const updated = await CriticalValueAlert.findOneAndUpdate(
    { _id: id, status: { $ne: "CLOSED" } },
    {
      $set: {
        status: "CLOSED",
        closedAt: new Date(),
        closedBy: actor._id || actor.id || null,
        closedByName: actor.fullName || actor.name || "",
      },
      $push: {
        auditTrail: _audit("CLOSED", {
          byName:   actor.fullName || actor.name || "",
          byRole:   actor.role || "",
          byUserId: actor._id || actor.id || null,
          reason,
        }),
      },
    },
    { new: true },
  );
  if (!updated) {
    const err = new Error("Alert not found or already closed");
    err.status = 404;
    throw err;
  }
  return updated;
}

/**
 * List open alerts (OPEN + ESCALATED) — optionally filter by UHID
 * and/or since date.
 */
async function listOpen({ uhid, since, limit = 200 } = {}) {
  const q = { status: { $in: ["OPEN", "ESCALATED"] } };
  if (uhid) q.patientUHID = String(uhid).toUpperCase().trim();
  if (since instanceof Date) q.emittedAt = { $gte: since };
  return CriticalValueAlert.find(q).sort({ emittedAt: -1 }).limit(Math.min(500, Math.max(1, limit))).lean();
}

/**
 * Drill-down by UHID — full history including ACK + CLOSED rows.
 */
async function listByUHID(uhid, { limit = 200 } = {}) {
  if (!uhid) return [];
  return CriticalValueAlert.find({ patientUHID: String(uhid).toUpperCase().trim() })
    .sort({ emittedAt: -1 })
    .limit(Math.min(500, Math.max(1, limit)))
    .lean();
}

/**
 * Cron worker: walk OPEN alerts whose age has crossed slaMinutes and
 * flip them to ESCALATED. The "escalatedTo" target is the in-charge
 * nurse role today; future cycles can resolve a real on-call rota.
 *
 * Safe to run every few minutes — the CAS predicate on status=OPEN
 * stops double-escalation under concurrent ticks.
 */
async function escalateOverdue() {
  // R7bf-G: pull a bounded batch so a backlog never freezes the cron.
  // Find OPEN alerts where (now - emittedAt) > slaMinutes * 60s.
  const now = new Date();
  const candidates = await CriticalValueAlert.find({ status: "OPEN" })
    .select("_id emittedAt slaMinutes patientUHID severity valueLabel")
    .sort({ emittedAt: 1 })
    .limit(200)
    .lean();

  let _escalateTo = "Nurse";
  let _escalateToId = null;
  // Best-effort: pick the first active Nurse user as the escalation target.
  // The role-label is what the UI uses today; the userId is informational.
  try {
    const User = require("../../models/User/userModel");
    const chargeNurse = await User.findOne({ role: "Nurse", isActive: { $ne: false } })
      .select("_id fullName")
      .lean();
    if (chargeNurse) {
      _escalateTo   = "Nurse";
      _escalateToId = chargeNurse._id;
    }
  } catch (_) { /* best-effort */ }

  let escalated = 0;
  for (const a of candidates) {
    const ageMs = now.getTime() - new Date(a.emittedAt).getTime();
    if (ageMs < (a.slaMinutes || 30) * 60 * 1000) continue;
    // CAS — only flip if still OPEN.
    const r = await CriticalValueAlert.updateOne(
      { _id: a._id, status: "OPEN" },
      {
        $set: {
          status: "ESCALATED",
          escalatedAt: now,
          escalatedTo: _escalateTo,
          escalatedToId: _escalateToId,
        },
        $push: {
          auditTrail: _audit("ESCALATED", {
            byName: "system (escalateOverdue)",
            reason: `SLA ${a.slaMinutes || 30}m breached — escalated to ${_escalateTo}.`,
          }),
        },
      },
    );
    if (r.modifiedCount > 0) escalated += 1;
  }
  return { scanned: candidates.length, escalated };
}

module.exports = {
  emit,
  acknowledge,
  close,
  listOpen,
  listByUHID,
  escalateOverdue,
};
