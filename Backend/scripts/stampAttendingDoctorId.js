// R7hr-99 — Backfill attendingDoctorId on Active admissions whose
// attendingDoctor is a free-text name but doctorProfile exists.
// Without this, GET /admissions?uhid=... auto-scopes by attendingDoctorId
// for Doctor-role callers and Ramesh's admission disappears from the
// patient panel (Admission Details box shows all "—").
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const mongoose = require("mongoose");

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/spherehealth");
  require("../models/Patient/admissionModel");
  require("../models/Doctor/doctorModel");
  const Admission = mongoose.models.Admission;
  const Doctor    = mongoose.models.Doctor;

  const toFix = await Admission.find({
    status: "Active",
    attendingDoctor: { $type: "string", $ne: "" },
    $or: [{ attendingDoctorId: null }, { attendingDoctorId: { $exists: false } }],
  }).select("_id UHID admissionNumber attendingDoctor attendingDoctorId").lean();

  console.log(`[stampAttendingDoctorId] ${toFix.length} candidate(s):`);
  let fixed = 0, unmatched = [];
  for (const a of toFix) {
    const nameTrim = (a.attendingDoctor || "").trim();
    // Try multiple match shapes: personalInfo.fullName, doctorName, full text variant
    const d = await Doctor.findOne({
      $or: [
        { "personalInfo.fullName": { $regex: `^${nameTrim}$`, $options: "i" } },
        { fullName: { $regex: `^${nameTrim}$`, $options: "i" } },
        { name: { $regex: `^${nameTrim}$`, $options: "i" } },
        // Doctor names often have "Dr. " prefix in admission but bare in profile
        { "personalInfo.fullName": { $regex: nameTrim.replace(/^Dr\.?\s*/i, ""), $options: "i" } },
      ],
    }).select("_id doctorId personalInfo.fullName").lean();
    if (d) {
      await Admission.updateOne({ _id: a._id }, { $set: { attendingDoctorId: d._id } });
      console.log(`  ✓ ${a.UHID} ${a.admissionNumber}: "${nameTrim}" → ${d.doctorId} (${d._id})`);
      fixed++;
    } else {
      unmatched.push({ UHID: a.UHID, ipd: a.admissionNumber, name: nameTrim });
    }
  }
  console.log(`\n[stampAttendingDoctorId] ✓ fixed ${fixed} | unmatched ${unmatched.length}`);
  if (unmatched.length) console.log("  unmatched:", unmatched);
  await mongoose.disconnect();
})().catch(e => { console.error("FATAL:", e); process.exit(1); });
