// scripts/stampRegistrationType.js
// R7hr-94 — Stamp `registrationType` on Patient records that were
// created by the demo admit scripts without setting it. Defaults to
// the patient's current/most-recent admission type (IPD / Emergency /
// Daycare). Without this, the patient-search left-list filters by
// `registrationType` and a directly-IPD-admitted patient surfaces
// under the OPD pill with an "OPD" badge — confusing the user.
//
// Safe to re-run — idempotent: only writes when the resolved value
// differs from the existing one.

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const mongoose = require("mongoose");

(async () => {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || "mongodb://127.0.0.1:27017/spherehealth";
  await mongoose.connect(uri);

  require("../models/Patient/patientModel");
  require("../models/Patient/admissionModel");
  const Patient   = mongoose.models.Patient;
  const Admission = mongoose.models.Admission;

  // Pull all Active admissions + their patient docs
  const adms = await Admission.find({ status: "Active" })
    .select("UHID patientUHID patientId admissionType admissionNumber ipdNo")
    .lean();

  let changed = 0, skipped = 0;
  for (const a of adms) {
    const desired = a.admissionType === "Emergency" ? "Emergency"
                  : a.admissionType === "Day Care" || a.admissionType === "Daycare" ? "Daycare"
                  : "IPD";
    const uhid = a.UHID || a.patientUHID;
    const p = uhid
      ? await Patient.findOne({ UHID: uhid }).select("UHID registrationType fullName").lean()
      : await Patient.findById(a.patientId).select("UHID registrationType fullName").lean();
    if (!p) { skipped++; continue; }
    if (p.registrationType === desired) { skipped++; continue; }
    await Patient.updateOne({ _id: p._id }, { $set: { registrationType: desired } });
    console.log(`  ${p.UHID || "?"} · ${p.fullName} · ${p.registrationType || "—"} → ${desired}`);
    changed++;
  }

  console.log(`\n[stampRegistrationType] ✓ updated ${changed} patient(s), skipped ${skipped}`);
  await mongoose.disconnect();
})().catch(err => { console.error("[stampRegistrationType] FATAL:", err); process.exit(1); });
