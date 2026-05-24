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
//
// R7bw — `seedAllActiveAdmissions` ensures every Active admission has a
// row for every expected (assessmentType, role) tuple. Pre-R7bw the
// collection only grew when an assessment was saved — so a freshly
// admitted patient who hadn't had any assessment yet showed up as
// "no rows" instead of "all overdue". Hospital-wide, the collection
// was 0 because admitting → first assessment was rarely <12 hours.
// The cron now seeds on boot AND every sweep; idempotent via upsert.
// ════════════════════════════════════════════════════════════════════
const AssessmentCompliance = require("../../models/Compliance/AssessmentComplianceModel");
const Admission            = require("../../models/Patient/admissionModel");

const DUE_SOON_MINUTES = 60;  // status flips to DUE_SOON in the last hour before nextDueAt

// R7bw — Expected (assessmentType, role, cadenceHours) tuples per Active
// admission. Aligns with the TYPE_MAP in nursingAssessmentsRoutes.js + the
// NABH cadence requirements ("twice a day" = 12h, "daily" = 24h).
const EXPECTED_TUPLES = [
  // Nurse-driven
  { assessmentType: "vitals",          role: "nurse",  cadenceHours: 4  }, // Q4H baseline
  { assessmentType: "mews",            role: "nurse",  cadenceHours: 12 },
  { assessmentType: "morse-fall",      role: "nurse",  cadenceHours: 12 },
  { assessmentType: "caprini-dvt",     role: "nurse",  cadenceHours: 24 },
  { assessmentType: "pressure-area",   role: "nurse",  cadenceHours: 12 },
  { assessmentType: "pain",            role: "nurse",  cadenceHours: 12 },
  { assessmentType: "intake-output",   role: "nurse",  cadenceHours: 12 },
  { assessmentType: "daily-nursing",   role: "nurse",  cadenceHours: 12 },
  { assessmentType: "neuro",           role: "nurse",  cadenceHours: 12 },
  // Doctor-driven
  { assessmentType: "doctor-progress", role: "doctor", cadenceHours: 12 },
  { assessmentType: "pain",            role: "doctor", cadenceHours: 24 },
];

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

/**
 * R7bw — Seed AssessmentCompliance rows for every Active admission
 * × EXPECTED_TUPLES. Idempotent: uses upsert keyed on (admissionId,
 * assessmentType, role) — the unique index on the model. Already-
 * existing rows (from real assessments) are left untouched.
 *
 * Sets `nextDueAt = admissionDate + cadenceHours` on first insert so
 * status flips to OVERDUE if the admission has been open longer than
 * the cadence already (the common case for the very first boot).
 *
 * Called both:
 *   - At backend boot (one-shot), to backfill the empty collection.
 *   - At every cron tick before sweepOverdue, to catch admissions
 *     created since last sweep.
 */
async function seedAllActiveAdmissions() {
  try {
    const admissions = await Admission.find({ status: "Active" })
      .select("_id UHID patientName admissionDate")
      .lean();
    const now = new Date();
    let inserted = 0;
    let skipped  = 0;
    let errored  = 0;

    for (const adm of admissions) {
      const baseAt = adm.admissionDate ? new Date(adm.admissionDate) : now;
      for (const tuple of EXPECTED_TUPLES) {
        const nextDueAt = new Date(baseAt.getTime() + tuple.cadenceHours * 60 * 60 * 1000);
        try {
          const r = await AssessmentCompliance.updateOne(
            {
              admissionId: adm._id,
              assessmentType: tuple.assessmentType,
              role: tuple.role,
            },
            {
              $setOnInsert: {
                admissionId: adm._id,
                UHID: adm.UHID || "",
                patientName: adm.patientName || "",
                assessmentType: tuple.assessmentType,
                role: tuple.role,
                cadenceHours: tuple.cadenceHours,
                lastAssessedAt: null,
                nextDueAt,
                status: nextDueAt <= now ? "OVERDUE" : "NOT_DUE_YET",
              },
            },
            { upsert: true },
          );
          if (r.upsertedCount) inserted++;
          else skipped++;
        } catch (e) {
          // Duplicate-key race (parallel call) — count as skipped, not errored.
          if (e?.code === 11000) skipped++; else { errored++; }
        }
      }
    }
    return { admissions: admissions.length, inserted, skipped, errored };
  } catch (e) {
    console.error("[assessmentCompliance] seedAllActiveAdmissions failed:", e?.message);
    return { admissions: 0, inserted: 0, skipped: 0, errored: 0, error: e?.message };
  }
}

module.exports = {
  recordAssessment,
  getStatusByAdmission,
  sweepOverdue,
  seedAllActiveAdmissions,
  EXPECTED_TUPLES,
  _statusFor,
};
