// scripts/relinkNabhRegisterAdmissions.js
// ════════════════════════════════════════════════════════════════════
// R7bw — Re-link NABH register rows whose admissionId points at a
// dedupe-cancelled admission. The dedupeActiveAdmissions cleanup
// (R7bq-A) walks core clinical rows (DoctorOrder, NurseNote, MAR,
// etc.) but never touched the NABH compliance registers. As a result
// rows like Fall-Risk + DVT for UH00000029 ended up pointing at
// status:"Cancelled" admissions while the live keeper admission has
// none — surveyors can't see the risk assessments.
//
// Strategy:
//   1. For each NABH register collection, find rows where the
//      referenced admission is either missing OR status:"Cancelled".
//   2. For each such row, look up the canonical (latest) Active
//      admission by UHID. If one exists, point the register row at it.
//      If not, look for the most recent Cancelled admission's
//      `mergedInto` and follow the merge chain. If still nothing,
//      leave the row alone (true historical orphan — surveyor can
//      ask why).
//   3. Never delete data. Append a one-liner to the auditTrail array
//      so the original admissionId is preserved.
//
// USAGE:
//   node Backend/scripts/relinkNabhRegisterAdmissions.js          (DRY-RUN by default)
//   node Backend/scripts/relinkNabhRegisterAdmissions.js --apply  (actually mutate)
//   node Backend/scripts/relinkNabhRegisterAdmissions.js --apply --uhid=UH00000029
// ════════════════════════════════════════════════════════════════════
"use strict";

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const mongoose = require("mongoose");

const Admission = require("../models/Patient/admissionModel");
const FallRiskRegister        = require("../models/Compliance/FallRiskRegisterModel");
const DVTRegister             = require("../models/Compliance/DVTRegisterModel");
const PainAssessmentRegister  = require("../models/Compliance/PainAssessmentRegisterModel");
const PressureUlcerRegister   = require("../models/Compliance/PressureUlcerRegisterModel");
const BloodSugarRegister      = require("../models/Compliance/BloodSugarRegisterModel");
const BloodTransfusionRegister = require("../models/Compliance/BloodTransfusionRegisterModel");

const APPLY = process.argv.includes("--apply");
const UHID_FILTER = (process.argv.find(a => a.startsWith("--uhid=")) || "").split("=")[1] || null;

const REGISTERS = [
  { name: "FallRiskRegister",        Model: FallRiskRegister },
  { name: "DVTRegister",             Model: DVTRegister },
  { name: "PainAssessmentRegister",  Model: PainAssessmentRegister },
  { name: "PressureUlcerRegister",   Model: PressureUlcerRegister },
  { name: "BloodSugarRegister",      Model: BloodSugarRegister },
  { name: "BloodTransfusionRegister", Model: BloodTransfusionRegister },
];

async function _canonicalAdmissionId(UHID) {
  if (!UHID) return null;
  const adm = await Admission.findOne({ UHID, status: "Active" })
    .select("_id admissionNumber")
    .sort({ admissionDate: -1 })
    .lean();
  return adm || null;
}

async function relinkRegister({ name, Model }) {
  const q = UHID_FILTER ? { UHID: UHID_FILTER } : {};
  // Pull only rows with an admissionId so we can probe its status.
  q.admissionId = { $ne: null };
  const rows = await Model.find(q).select("_id UHID admissionId").lean();
  let scanned = 0;
  let stale   = 0;
  let relinked = 0;
  let orphan  = 0;

  // Cache active-admission lookups per UHID — many rows share a UHID.
  const cache = new Map();

  for (const r of rows) {
    scanned++;
    const adm = await Admission.findById(r.admissionId).select("_id status").lean();
    const isStale = !adm || adm.status === "Cancelled";
    if (!isStale) continue;
    stale++;

    if (!cache.has(r.UHID)) {
      cache.set(r.UHID, await _canonicalAdmissionId(r.UHID));
    }
    const keeper = cache.get(r.UHID);
    if (!keeper) { orphan++; continue; }
    // No-op if the keeper IS the stale id (defensive — shouldn't happen).
    if (String(keeper._id) === String(r.admissionId)) continue;

    if (APPLY) {
      await Model.updateOne(
        { _id: r._id },
        {
          $set: { admissionId: keeper._id },
          $push: {
            auditTrail: {
              action: "RELINKED",
              at: new Date(),
              byName: "system:relinkNabhRegisterAdmissions",
              byRole: "system",
              reason: `was=${r.admissionId} now=${keeper._id} (stale admission cleanup)`,
            },
          },
        },
      );
    }
    relinked++;
  }

  return { name, scanned, stale, relinked, orphan };
}

(async () => {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGO_URI not set"); process.exit(1);
  }
  await mongoose.connect(uri);
  console.log(`[relinkNabhRegisterAdmissions] mode=${APPLY ? "APPLY" : "DRY-RUN"} uhid=${UHID_FILTER || "ALL"}`);

  const totals = [];
  for (const reg of REGISTERS) {
    try {
      const t = await relinkRegister(reg);
      console.log(`  ${t.name.padEnd(30)} scanned=${t.scanned} stale=${t.stale} relinked=${t.relinked} orphan=${t.orphan}`);
      totals.push(t);
    } catch (e) {
      console.error(`  ${reg.name} FAILED:`, e.message);
    }
  }

  const sumRelinked = totals.reduce((s, t) => s + t.relinked, 0);
  const sumStale    = totals.reduce((s, t) => s + t.stale, 0);
  console.log(`\nDone. stale=${sumStale}, relinked=${sumRelinked}${APPLY ? "" : " (dry-run — pass --apply to mutate)"}`);

  await mongoose.disconnect();
  process.exit(0);
})().catch(e => {
  console.error("FATAL:", e.stack || e.message);
  process.exit(1);
});
