// scripts/admitDemoBed.js
// R7hr-93 follow-on — only the admission step (the wipe already ran).
// Picks Male General Ward Bed 01 from the Beds master and admits a
// fresh Patient + Admission record under Dr. Sandeep.

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const mongoose = require("mongoose");

(async () => {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || "mongodb://127.0.0.1:27017/spherehealth";
  await mongoose.connect(uri);

  require("../models/Patient/patientModel");
  require("../models/Patient/admissionModel");
  require("../models/bedMgmt/bedsModel");
  try { require("../models/CounterModel"); } catch (_) {}

  const Patient   = mongoose.models.Patient;
  const Admission = mongoose.models.Admission;
  const Beds      = mongoose.models.Beds;     // ← plural
  const Counter   = mongoose.models.Counter;

  if (!Beds) {
    console.error("Beds model not registered. Available:", Object.keys(mongoose.models).filter(n=>/bed/i.test(n)));
    process.exit(1);
  }

  // Find Male General Ward Bed 01
  let bed = await Beds.findOne({
    wardName: /Male General/i,
    bedNumber: /(MGW.*B?0?1|B0?1)$/i,
  });
  if (!bed) {
    const cands = await Beds.find({ wardName: /Male General/i }).sort({ bedNumber: 1 }).limit(5);
    bed = cands[0];
  }
  if (!bed) {
    console.error("No Male General Ward bed found. Sample:", await Beds.find().limit(10).select("bedNumber wardName status").lean());
    process.exit(1);
  }
  console.log(`Target bed: ${bed.bedNumber}  (${bed.wardName}) · status=${bed.status}`);

  // Mint UHID + IPD
  let UHID = "UH02";
  let ipdNo = "IPD-26-02";
  if (Counter) {
    try { const c = await Counter.findOneAndUpdate({ _id: "uhid" }, { $inc: { seq: 1 } }, { upsert: true, new: true });
      UHID = `UH${String(c.seq).padStart(2,"0")}`; } catch(_) {}
    try { const c = await Counter.findOneAndUpdate({ _id: "ipd-26" }, { $inc: { seq: 1 } }, { upsert: true, new: true });
      ipdNo = `IPD-26-${String(c.seq).padStart(2,"0")}`; } catch(_) {}
  }

  const patient = await Patient.create({
    UHID,
    title: "Mr.",
    fullName: "Ramesh Kumar",
    patientName: "Ramesh Kumar",
    gender: "Male",
    dateOfBirth: new Date("1979-08-15"),
    age: 46,
    contactNumber: "9810099999",
    phone: "9810099999",
    email: "ramesh.demo@example.com",
    bloodGroup: "B+",
    address: { addressLine1: "Demo IPD admission", city: "Delhi", state: "Delhi", pincode: "110001" },
    paymentType: "Cash",
    isActive: true,
  });
  console.log(`Patient: ${patient.fullName} · UHID=${patient.UHID}`);

  const now = new Date();
  const admission = await Admission.create({
    UHID: patient.UHID,
    patientUHID: patient.UHID,
    patientId: patient._id,
    patientName: patient.fullName,
    admissionNumber: ipdNo,
    ipdNo,
    admissionDate: now,
    admissionType: "Planned",
    department: "General Medicine",
    departmentName: "General Medicine",
    attendingDoctor: "Dr. Sandeep",
    doctorName: "Dr. Sandeep",
    consultantName: "Dr. Sandeep",
    bedId: bed._id,
    bedNumber: bed.bedNumber,
    wardName: bed.wardName,
    roomCategory: bed.roomCategory || "GENW",
    status: "Active",
    age: patient.age,
    gender: patient.gender,
    contactNumber: patient.contactNumber,
  });
  console.log(`Admission: ${ipdNo} · ${bed.bedNumber}`);

  bed.status = "Occupied";
  bed.currentPatient = patient._id;
  bed.currentPatientId = patient._id;
  bed.currentAdmissionId = admission._id;
  bed.currentAdmission = admission._id;
  await bed.save();
  console.log(`Bed ${bed.bedNumber} → Occupied`);

  console.log(`\n────────────────────────────────────────────────────────`);
  console.log(`✓ DEMO ADMISSION COMPLETE`);
  console.log(`  Patient    : Mr. ${patient.fullName}`);
  console.log(`  UHID       : ${patient.UHID}`);
  console.log(`  IPD No     : ${ipdNo}`);
  console.log(`  Bed        : ${bed.bedNumber}  (${bed.wardName})`);
  console.log(`  Doctor     : Dr. Sandeep`);
  console.log(`  Department : General Medicine`);
  console.log(`  Admitted   : ${now.toLocaleString("en-IN")} IST`);
  console.log(`────────────────────────────────────────────────────────`);

  await mongoose.disconnect();
})().catch(err => { console.error("FATAL:", err); process.exit(1); });
