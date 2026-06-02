/**
 * R7go_backfill_emp_ids.js
 *
 * One-off backfill: copies User.employeeId onto every DoctorNote and
 * NurseNote that already exists, so the panel + Complete File show the
 * hospital employee ID next to signer names without waiting for new
 * writes. Idempotent — re-runnable safely; only updates docs missing
 * the fields.
 *
 * Run:  node Backend/scripts/R7go_backfill_emp_ids.js
 */
require("dotenv").config({ path: __dirname + "/../.env" });
const mongoose = require("mongoose");
const User = require("../models/User/userModel");
const DoctorNotes = require("../models/Doctor/DoctorNotesModel");
const NurseNotes = require("../models/Nurse/NurseNotesModel");

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/spherehealth";

async function backfillDoctorNotes() {
  console.log("\n[Doctor] Scanning…");
  // Pull every signed/draft note that has a `doctor` ref but is missing
  // doctorEmpId. Project only the fields we need so the cursor stays small.
  const cursor = DoctorNotes.find({
    doctor: { $exists: true, $ne: null },
    $or: [{ doctorEmpId: { $exists: false } }, { doctorEmpId: "" }],
  }).select("_id doctor signedByName status").cursor();
  let scanned = 0, updated = 0, missed = 0;
  for await (const note of cursor) {
    scanned++;
    try {
      const user = await User.findById(note.doctor).select("employeeId fullName firstName lastName").lean();
      if (!user) { missed++; continue; }
      const empId = user.employeeId || "";
      if (!empId) { missed++; continue; }
      const set = { doctorEmpId: empId };
      // If signed and no signedByEmpId yet, assume self-sign and copy.
      if (note.status === "signed") set.signedByEmpId = empId;
      await DoctorNotes.updateOne({ _id: note._id }, { $set: set });
      updated++;
    } catch (e) {
      missed++;
      console.error("[Doctor] note", note._id, e.message);
    }
  }
  console.log(`[Doctor] scanned=${scanned} updated=${updated} missed=${missed}`);
}

async function backfillNurseNotes() {
  console.log("\n[Nurse] Scanning…");
  // Nurse notes were already storing nurseEmployeeId for newer writes;
  // older ones (before R7go) may have it blank. nurse_notes.nurse points
  // to NurseStaff (not User), so when nurse is missing or NurseStaff has
  // no link to a User, we cannot resolve a User.employeeId — leave those
  // alone and log.
  const cursor = NurseNotes.find({
    $or: [
      { nurseEmployeeId: { $exists: false } },
      { nurseEmployeeId: "" },
      { signedByEmpId: { $exists: false } },
    ],
  }).select("_id nurse createdBy signedByName status nurseName").cursor();
  let scanned = 0, updated = 0, missed = 0;
  for await (const note of cursor) {
    scanned++;
    try {
      // Try createdBy first (User._id), then nurse if it happens to BE a
      // User._id (some seed data uses the same id for both collections).
      let user = null;
      if (note.createdBy) {
        user = await User.findById(note.createdBy).select("employeeId").lean();
      }
      if (!user && note.nurse) {
        user = await User.findById(note.nurse).select("employeeId").lean();
      }
      if (!user || !user.employeeId) { missed++; continue; }
      await NurseNotes.updateOne(
        { _id: note._id },
        { $set: { nurseEmployeeId: user.employeeId, signedByEmpId: user.employeeId } },
      );
      updated++;
    } catch (e) {
      missed++;
      console.error("[Nurse] note", note._id, e.message);
    }
  }
  console.log(`[Nurse] scanned=${scanned} updated=${updated} missed=${missed}`);
}

(async () => {
  console.log("R7go — backfill employeeId on existing notes");
  await mongoose.connect(MONGO_URI);
  await backfillDoctorNotes();
  await backfillNurseNotes();
  await mongoose.disconnect();
  console.log("\nDone.");
  process.exit(0);
})().catch((e) => {
  console.error("Backfill failed:", e);
  process.exit(1);
});
