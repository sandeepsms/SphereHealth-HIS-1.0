// services/Compliance/clinicalAuditService.js
// ════════════════════════════════════════════════════════════════════
// R7bn-1 / D9-fix: ClinicalAudit emit helper.
//
// One-call helper for controllers to write to the ClinicalAudit
// collection without each callsite re-creating the boilerplate of
// "pull user from req, compute retainUntil, swallow errors so the
// underlying clinical save never fails just because audit logging hit
// a transient mongo blip."
//
// Usage:
//   await emitClinicalAudit({
//     req,                                    // Express req — auto-extracts actor/IP/UA
//     event: "DOCTOR_NOTE_SIGNED",
//     UHID: note.patientUHID,
//     admissionId: note.admissionId,
//     targetType: "DoctorNote",
//     targetId: note._id,
//     after: { noteType: note.noteType, signedAt: note.signedAt },
//   });
//
// Failures are logged to stderr but never thrown — the clinical write
// already succeeded by the time we're emitting. A separate health-check
// monitors the audit-emit success rate via the BillingAudit pattern.
// ════════════════════════════════════════════════════════════════════

const ClinicalAudit = require("../../models/Compliance/ClinicalAuditModel");

// Events that are SIGNED / FINALIZED / DELETED get the longer 7y retention
// floor per NABH IPSG.6 + MCI Indian Medical Records Act 1956 §3.
// Everything else (DRAFT, recording, acknowledge) gets 3y.
const LONG_RETENTION_EVENTS = new Set([
  "DOCTOR_NOTE_SIGNED",
  "DOCTOR_NOTE_DELETED",
  "DOCTOR_NOTE_AMENDED",
  "NURSE_NOTE_DELETED",
  "INITIAL_ASSESSMENT_DOCTOR_SIGNED",
  "INITIAL_ASSESSMENT_NURSE_SIGNED",
  "CONSENT_SIGNED",
  "CONSENT_REVOKED",
  "MLC_CREATED",
  "MLC_FINALIZED",
  "MLC_CLOSED",
  "TRANSFUSION_ORDERED",
  "TRANSFUSION_STARTED",
  "TRANSFUSION_COMPLETED",
  "TRANSFUSION_REACTION_LOGGED",
  "DISCHARGE_SUMMARY_FINALIZED",
  "ADMISSION_REACTIVATED",
  "MAR_DOSE_ADMINISTERED",     // HAM drugs need 7y per NABH IPSG.3
]);

function computeRetainUntil(event) {
  const now = new Date();
  const yearsToAdd = LONG_RETENTION_EVENTS.has(event) ? 7 : 3;
  const d = new Date(now);
  d.setFullYear(d.getFullYear() + yearsToAdd);
  return d;
}

/**
 * Emit a clinical audit row. Never throws — silent on failure with a
 * stderr log so the calling clinical write succeeds even if the audit
 * collection is temporarily unreachable.
 *
 * @param {Object}  opts
 * @param {Object} [opts.req]          Express req (preferred — auto-fills actor/ip/ua)
 * @param {String}  opts.event         enum value from ClinicalAuditModel
 * @param {String} [opts.UHID]
 * @param {ObjectId|String} [opts.admissionId]
 * @param {ObjectId|String} [opts.patientId]
 * @param {String} [opts.patientName]
 * @param {String} [opts.targetType]
 * @param {ObjectId|String} [opts.targetId]
 * @param {Object} [opts.before]
 * @param {Object} [opts.after]
 * @param {String} [opts.reason]
 * @param {Object} [opts.actor]        Explicit override if no req available
 *                                     ({ _id, fullName, role })
 */
async function emitClinicalAudit(opts) {
  try {
    const { req, event } = opts;
    if (!event) {
      console.warn("[ClinicalAudit] emit called without event — skipped");
      return null;
    }

    const user = req?.user || opts.actor || {};
    const actorId = user._id || user.id || null;
    const actorName = user.fullName
      || [user.firstName, user.lastName].filter(Boolean).join(" ").trim()
      || user.name
      || "";
    const actorRole = user.role || "";

    const ipAddress =
      req?.headers?.["x-forwarded-for"]?.split(",")[0]?.trim()
      || req?.socket?.remoteAddress
      || req?.connection?.remoteAddress
      || "";
    const userAgent = req?.headers?.["user-agent"] || "";

    const row = await ClinicalAudit.create({
      event,
      actorId,
      actorName,
      actorRole,
      UHID: opts.UHID || "",
      admissionId: opts.admissionId || null,
      patientId: opts.patientId || null,
      patientName: opts.patientName || "",
      targetType: opts.targetType || "",
      targetId: opts.targetId || null,
      before: opts.before || null,
      after: opts.after || null,
      reason: opts.reason || "",
      ipAddress,
      userAgent,
      retainUntil: computeRetainUntil(event),
    });
    return row;
  } catch (err) {
    // R7bn — log to stderr but never throw. The clinical write that
    // triggered this emit has already succeeded; we don't want a
    // transient audit-collection blip to roll back patient care.
    console.error(
      "[ClinicalAudit] emit failed:",
      opts.event,
      "—",
      err?.message || err,
    );
    return null;
  }
}

module.exports = { emitClinicalAudit };
