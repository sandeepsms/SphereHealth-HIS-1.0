// services/Compliance/assessmentComplianceService.js
// ════════════════════════════════════════════════════════════════════
// R7bn-5 / D6-fix: assessment-compliance helpers.
//
// `recordAssessment` is called from every assessment-save hot path
// (nursing-assessment POST, vitals save, doctor-notes save). It upserts
// the per-(admission,type,role) row, refreshing lastAssessedAt + nextDueAt.
//
// `getStatusByAdmission` returns the compliance snapshot the frontend
// uses to render red OVERDUE badges on Nursing/Doctor Notes tiles.
//
// `sweepOverdue` is invoked by the hourly cron — sets status to OVERDUE
// for any row where nextDueAt has slipped past now.
// ════════════════════════════════════════════════════════════════════
const AssessmentCompliance = require("../../models/Compliance/AssessmentComplianceModel");

const DUE_SOON_MINUTES = 60;  // status flips to DUE_SOON in the last hour before nextDueAt

/**
 * Compute the new status based on nextDueAt vs now.
 */
function _statusFor(nextDueAt, now = new Date()) {
  if (!nextDueAt) return "NOT_DUE_YET";
  const ms = nextDueAt.getTime() - now.getTime();
  if (ms <= 0) return "OVERDUE";
  if (ms <= DUE_SOON_MINUTES * 60 * 1000) return "DUE_SOON";
  return "DONE_THIS_WINDOW";
}

/**
 * Record an assessment write. Upserts the compliance row for this
 * (admission, type, role), advances lastAssessedAt, recomputes nextDueAt.
 *
 * Idempotent — calling twice for the same shift is fine; nextDueAt just
 * moves forward.
 *
 * Returns the upserted row, or null on error (never throws — calling
 * clinical save already succeeded, audit logging is non-blocking).
 */
async function recordAssessment({
  admissionId,
  UHID = "",
  patientName = "",
  assessmentType,
  role = "nurse",
  actor = {},
  cadenceHours = 12,
}) {
  try {
    if (!admissionId || !assessmentType) return null;
    const now = new Date();
    const nextDueAt = new Date(now.getTime() + cadenceHours * 60 * 60 * 1000);

    const row = await AssessmentCompliance.findOneAndUpdate(
      { admissionId, assessmentType, role },
      {
        $set: {
          UHID,
          patientName,
          lastAssessedAt: now,
          lastAssessedBy: {
            userId: actor?._id || actor?.id || null,
            name:   actor?.fullName
              || [actor?.firstName, actor?.lastName].filter(Boolean).join(" ").trim()
              || actor?.name
              || "",
          },
          nextDueAt,
          status: "DONE_THIS_WINDOW",
          cadenceHours,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    return row;
  } catch (e) {
    console.error("[assessmentCompliance] recordAssessment failed:", e?.message);
    return null;
  }
}

/**
 * Fetch the compliance snapshot for an admission. Returns one row per
 * (assessmentType, role) tuple — frontend can group by type or surface
 * the worst-status as a single badge.
 */
async function getStatusByAdmission(admissionId) {
  if (!admissionId) return [];
  try {
    const rows = await AssessmentCompliance.find({ admissionId }).lean();
    // Re-evaluate status in case the cron hasn't run yet (lazy refresh).
    const now = new Date();
    return rows.map(r => ({ ...r, status: _statusFor(r.nextDueAt, now) }));
  } catch (e) {
    console.error("[assessmentCompliance] getStatusByAdmission failed:", e?.message);
    return [];
  }
}

/**
 * Cron sweeper — flip status to OVERDUE for every row whose nextDueAt
 * is in the past. Returns counts so the cron can log.
 */
async function sweepOverdue() {
  try {
    const now = new Date();
    const res = await AssessmentCompliance.updateMany(
      { nextDueAt: { $ne: null, $lt: now }, status: { $ne: "OVERDUE" } },
      { $set: { status: "OVERDUE" } },
    );
    const flipped = res.modifiedCount || res.nModified || 0;
    // Also flip DONE_THIS_WINDOW → DUE_SOON if we're inside the last hour.
    const soonAt = new Date(now.getTime() + DUE_SOON_MINUTES * 60 * 1000);
    const res2 = await AssessmentCompliance.updateMany(
      {
        nextDueAt: { $ne: null, $gte: now, $lte: soonAt },
        status: "DONE_THIS_WINDOW",
      },
      { $set: { status: "DUE_SOON" } },
    );
    const soonFlipped = res2.modifiedCount || res2.nModified || 0;
    return { overdue: flipped, dueSoon: soonFlipped, at: now };
  } catch (e) {
    console.error("[assessmentCompliance] sweepOverdue failed:", e?.message);
    return { overdue: 0, dueSoon: 0, error: e?.message };
  }
}

module.exports = {
  recordAssessment,
  getStatusByAdmission,
  sweepOverdue,
  _statusFor,
};
