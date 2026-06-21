// services/Nurse/nursingAssessmentPlanService.js
// ════════════════════════════════════════════════════════════════════
// R7hr-231 — read/write the doctor-set nursing assessment plan + compute
// today's "done" count per assessment type (submitted/amended nurse notes for
// the calendar day) so the nurse sees "done X / min Y today". READ-ONLY for the
// counts; the plan is upserted per admission. ADDITIVE.
// ════════════════════════════════════════════════════════════════════
"use strict";

const NursingAssessmentPlan = require("../../models/Nurse/NursingAssessmentPlanModel");
const NurseNotes = require("../../models/Nurse/NurseNotesModel");

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

async function getPlan({ admissionId, uhid } = {}) {
  const UHID = String(uhid || "").toUpperCase();
  const empty = { items: [], todayCounts: {}, assignedByName: "", updatedAt: null };
  const planFilter = admissionId ? { admissionId } : (UHID ? { UHID } : null);
  if (!planFilter) return empty;

  const plan = await NursingAssessmentPlan.findOne(planFilter).lean().catch(() => null);

  // today's "done" count per noteType — a submitted/amended nurse note counts;
  // a draft does not (consistent with R7hr-230: a draft isn't really done).
  const countFilter = { noteDate: { $gte: startOfToday() }, status: { $in: ["submitted", "amended"] } };
  if (admissionId) countFilter.admissionId = admissionId;
  else countFilter.patientUHID = UHID;
  const agg = await NurseNotes.aggregate([
    { $match: countFilter },
    { $group: { _id: "$noteType", n: { $sum: 1 } } },
  ]).catch(() => []);
  const todayCounts = {};
  for (const r of agg) if (r._id) todayCounts[r._id] = r.n;

  return {
    items: plan?.items || [],
    todayCounts,
    assignedByName: plan?.assignedByName || "",
    updatedAt: plan?.updatedAt || null,
  };
}

async function setPlan({ admissionId, uhid, ipdNo, items, actor } = {}) {
  const UHID = String(uhid || "").toUpperCase();
  const planFilter = admissionId ? { admissionId } : (UHID ? { UHID } : null);
  if (!planFilter) throw new Error("admissionId or uhid is required");

  const clean = (Array.isArray(items) ? items : [])
    .filter((it) => it && it.type)
    .map((it) => ({
      type: String(it.type),
      label: String(it.label || ""),
      perDayMin: Math.max(0, Math.min(96, Number(it.perDayMin) || 1)),
    }));

  const plan = await NursingAssessmentPlan.findOneAndUpdate(
    planFilter,
    {
      $set: {
        items: clean,
        UHID,
        ipdNo: ipdNo || "",
        assignedBy: actor?.id || "",
        assignedByName: actor?.fullName || "",
      },
      $setOnInsert: { ...planFilter },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
  return plan;
}

module.exports = { getPlan, setPlan };
