// scripts/backfillClinicalLinkage.js
// ════════════════════════════════════════════════════════════════════
// R7bv: one-off cleanup for clinical records that pre-date the
// schema-level linkage between DoctorOrder / DoctorNotes / NurseNotes
// and the parent Admission.
//
// Three classes of legacy data this script repairs:
//
//   1. DoctorOrder rows where visitType:"IPD" but admissionId is null
//      (pre-R7bv the schema didn't even define admissionId — Mongoose
//      strict-mode silently stripped it on every save). Resolve the
//      active admission by UHID; if that fails, try matching by
//      visitId === admissionNumber.
//
//   2. DoctorNote rows where ipdNo starts with "UH" (i.e. the pre-R7bv
//      doctorNotesService fallback wrote UHID into ipdNo when the
//      caller didn't pass admissionNumber). Re-derive ipdNo from the
//      active or latest admission for that UHID.
//
//   3. NurseNote rows with the same UHID-in-ipdNo poisoning (same
//      fallback bug existed in nurseNotesService).
//
// USAGE:
//   node Backend/scripts/backfillClinicalLinkage.js              (DRY RUN — default)
//   node Backend/scripts/backfillClinicalLinkage.js --apply      (write to DB)
//
// Idempotent: re-running on an already-backfilled row is a no-op.
// ════════════════════════════════════════════════════════════════════

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const mongoose = require("mongoose");

function isUhid(s) {
  return typeof s === "string" && /^UH/i.test(s.trim());
}

async function findAdmissionForUHID(Admission, uhid) {
  if (!uhid) return null;
  // 1. Active admission — the strongest match.
  let adm = await Admission.findOne({ UHID: uhid, status: "Active" })
    .select("_id admissionNumber UHID status").lean();
  if (adm) return adm;
  // 2. Most recent admission (any status) as a fallback for legacy /
  //    already-discharged records. Sort by createdAt desc.
  adm = await Admission.findOne({ UHID: uhid })
    .sort({ createdAt: -1 })
    .select("_id admissionNumber UHID status").lean();
  return adm || null;
}

async function findAdmissionForVisitId(Admission, visitId) {
  if (!visitId) return null;
  return Admission.findOne({ admissionNumber: visitId })
    .select("_id admissionNumber UHID status").lean();
}

async function backfillDoctorOrders(DoctorOrder, Admission, apply) {
  const candidates = await DoctorOrder.find({
    visitType: "IPD",
    $or: [
      { admissionId: { $exists: false } },
      { admissionId: null },
      { ipdNo: null },
      { ipdNo: { $exists: false } },
    ],
  }).select("_id UHID visitId admissionId ipdNo admissionNumber").lean();

  let touched = 0, unresolved = 0;
  for (const o of candidates) {
    // Already has both? skip.
    if (o.admissionId && o.ipdNo && o.admissionNumber) continue;

    let adm = await findAdmissionForUHID(Admission, o.UHID);
    if (!adm && o.visitId) adm = await findAdmissionForVisitId(Admission, o.visitId);

    if (!adm) {
      unresolved++;
      continue;
    }
    const $set = {};
    if (!o.admissionId)     $set.admissionId     = adm._id;
    if (!o.ipdNo)           $set.ipdNo           = adm.admissionNumber || o.visitId || null;
    if (!o.admissionNumber) $set.admissionNumber = adm.admissionNumber || null;
    if (!Object.keys($set).length) continue;

    if (apply) {
      await DoctorOrder.collection.updateOne({ _id: o._id }, { $set });
    }
    touched++;
  }
  return { candidates: candidates.length, touched, unresolved };
}

async function backfillDoctorNotes(DoctorNotes, Admission, apply) {
  // Two kinds of broken rows:
  //   (a) ipdNo starts with "UH"  — UHID was written into ipdNo.
  //   (b) admissionId is missing (always true pre-R7bv) AND we have
  //       enough info (patientUHID or ipdNo===admissionNumber) to fix it.
  const candidates = await DoctorNotes.find({
    $or: [
      { ipdNo: { $regex: "^UH", $options: "i" } },
      { admissionId: { $exists: false } },
      { admissionId: null },
    ],
  }).select("_id patientUHID UHID ipdNo admissionId").lean();

  let touched = 0, unresolved = 0;
  for (const n of candidates) {
    const uhid = n.patientUHID || n.UHID || (isUhid(n.ipdNo) ? n.ipdNo : null);
    let adm = await findAdmissionForUHID(Admission, uhid);
    if (!adm && n.ipdNo && !isUhid(n.ipdNo)) {
      adm = await findAdmissionForVisitId(Admission, n.ipdNo);
    }
    if (!adm) {
      unresolved++;
      continue;
    }
    const $set = {};
    // Fix UHID-in-ipdNo
    if (isUhid(n.ipdNo) && adm.admissionNumber) {
      $set.ipdNo = adm.admissionNumber;
    }
    if (!n.admissionId) {
      $set.admissionId = adm._id;
    }
    if (!Object.keys($set).length) continue;

    if (apply) {
      await DoctorNotes.collection.updateOne({ _id: n._id }, { $set });
    }
    touched++;
  }
  return { candidates: candidates.length, touched, unresolved };
}

async function backfillNurseNotes(NurseNotes, Admission, apply) {
  // Only the UHID-in-ipdNo case for nurse notes; admissionId isn't on
  // the schema yet (out of scope for this round).
  const candidates = await NurseNotes.find({
    ipdNo: { $regex: "^UH", $options: "i" },
  }).select("_id patientUHID UHID ipdNo").lean();

  let touched = 0, unresolved = 0;
  for (const n of candidates) {
    const uhid = n.patientUHID || n.UHID || n.ipdNo;
    const adm = await findAdmissionForUHID(Admission, uhid);
    if (!adm || !adm.admissionNumber) {
      unresolved++;
      continue;
    }
    if (apply) {
      await NurseNotes.collection.updateOne(
        { _id: n._id },
        { $set: { ipdNo: adm.admissionNumber } },
      );
    }
    touched++;
  }
  return { candidates: candidates.length, touched, unresolved };
}

async function main() {
  const apply = process.argv.includes("--apply");
  const uri = process.env.MONGO_URI || "mongodb://localhost:27017/spherehealth";
  await mongoose.connect(uri);

  const DoctorOrder = require("../models/Doctor/DoctorOrderModel");
  const DoctorNotes = require("../models/Doctor/DoctorNotesModel");
  const NurseNotes  = require("../models/Nurse/NurseNotesModel");
  const Admission   = require("../models/Patient/admissionModel");

  console.log(`[backfillClinicalLinkage] mode=${apply ? "APPLY" : "DRY-RUN"} uri=${uri}`);

  const ordersResult = await backfillDoctorOrders(DoctorOrder, Admission, apply);
  console.log(`[backfillClinicalLinkage] DoctorOrder:  candidates=${ordersResult.candidates}  touched=${ordersResult.touched}  unresolved=${ordersResult.unresolved}`);

  const notesResult = await backfillDoctorNotes(DoctorNotes, Admission, apply);
  console.log(`[backfillClinicalLinkage] DoctorNotes:  candidates=${notesResult.candidates}  touched=${notesResult.touched}  unresolved=${notesResult.unresolved}`);

  const nurseResult = await backfillNurseNotes(NurseNotes, Admission, apply);
  console.log(`[backfillClinicalLinkage] NurseNotes:   candidates=${nurseResult.candidates}  touched=${nurseResult.touched}  unresolved=${nurseResult.unresolved}`);

  console.log(`[backfillClinicalLinkage] done. ${apply ? "Wrote to DB." : "DRY RUN — pass --apply to commit."}`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("[backfillClinicalLinkage] FAILED:", err);
  process.exit(1);
});
