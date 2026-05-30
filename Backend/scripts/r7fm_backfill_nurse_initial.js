// R7fm — Backfill: copy historical IPD_INITIAL DoctorNotes that contain
// nursing-section content into NurseNotes, so the Nursing Notes timeline
// stops showing "0 entries" for patients whose nurse Initial Assessment
// was filed before the dual-write fix shipped.
//
// Idempotent — skips any (ipdNo, noteType:"initial") that already has a
// NurseNote row. Safe to re-run.
//
// Usage:  cd Backend && node scripts/r7fm_backfill_nurse_initial.js
const mongoose = require("mongoose");
require("dotenv").config();

(async function main() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI || "mongodb://localhost:27017/spherehealth";
  console.log("Mongo:", uri);
  await mongoose.connect(uri);

  const DoctorNotes = require("../models/Doctor/DoctorNotesModel");
  const NurseNotes  = require("../models/Nurse/NurseNotesModel");

  // Pick every DoctorNote that came from the IPD Initial Assessment page
  // and has any nursing payload (older saves used either nursing or
  // nursingNabh — guard for both).
  const docs = await DoctorNotes.find({
    $or: [
      { noteType:  "initial" },
      { visitType: "IPD_INITIAL" },
    ],
  }).lean();

  let created = 0, skipped = 0, errored = 0;
  for (const d of docs) {
    const nursingBlock = d?.noteDetails?.nursing || d?.noteDetails?.nursingNabh;
    if (!nursingBlock) { skipped++; continue; }
    if (!d.ipdNo)      { skipped++; continue; }

    // Idempotency guard — already have a NurseNote.initial for this ipdNo?
    const existing = await NurseNotes.findOne({ ipdNo: d.ipdNo, noteType: "initial" }).select("_id").lean();
    if (existing) { skipped++; continue; }

    // Build minimal NurseNote payload from the DoctorNote.
    const nurseDoc = {
      patient:        d.patient || d.patientId,
      patientName:    d.patientName,
      patientUHID:    d.patientUHID,
      ipdNo:          d.ipdNo,
      noteDate:       d.assessmentDate || d.createdAt || new Date(),
      shift:          "general",
      nurseName:      nursingBlock?.nurseName
                       || nursingBlock?.identification?.verifiedBy
                       || d?.noteDetails?.nursing?.nurseName
                       || "Nurse",
      noteType:       "initial",
      status:         d.status === "signed" ? "submitted" : "draft",
      submittedAt:    d.status === "signed" ? (d.signedAt || d.updatedAt) : undefined,
      painScore:      Number(d?.noteDetails?.nursing?.painScore) || 0,
      remarks:        `Backfilled from DoctorNote ${d._id} (R7fm). NABH AAC.1 / COP.2 initial assessment.`,
      tags:           ["initial-assessment", "nabh-aac1", "nabh-cop2", "backfilled-r7fm"],
      signedByName:   d.signedByName,
      noteData: {
        nursing:     d.noteDetails?.nursing,
        nursingNabh: d.noteDetails?.nursingNabh,
        section:     "nursing",
        linkedDoctorNoteId: d._id,
        assessmentDate: d.assessmentDate || d.createdAt,
      },
    };

    try {
      const nn = await NurseNotes.create(nurseDoc);
      console.log(`  + NurseNote ${nn._id}  ipdNo=${d.ipdNo}  patient=${d.patientName}`);
      created++;
    } catch (e) {
      console.error(`  ! Failed for DoctorNote ${d._id}:`, e.message);
      errored++;
    }
  }

  console.log(`\nBackfill done — created:${created}  skipped(already-have-or-no-nurse-block):${skipped}  errored:${errored}`);
  await mongoose.disconnect();
})().catch(e => { console.error(e); process.exit(1); });
