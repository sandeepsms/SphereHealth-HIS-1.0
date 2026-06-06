// scripts/freshDemoAdmit.js
// ════════════════════════════════════════════════════════════════════
// R7hr-93 — Wipe ALL IPD data + register a fresh demo patient and
// admit them to Male General Ward Bed 01 under Dr. Sandeep, Medicine
// department, with admissionDate = now.
//
// User asked: "sare IPD clear kro or ek demo patient new add kro IPD
// me medicine dr sandeep k under; male genereal ward bed 01 pr".
//
// This is two operations in one atomic-ish run:
//   1. Wipe every IPD-touching collection (no UH01 preservation).
//   2. Create Patient + Admission + assign bed.
//
// Catalog (drugs, services, hospital settings, users, doctors, ward/
// bed master) is untouched. The bed gets flipped to Occupied with
// the new patientId.
// ════════════════════════════════════════════════════════════════════

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const mongoose = require("mongoose");

// Demo identity
const DEMO_PATIENT = {
  title: "Mr.",
  fullName: "Ramesh Kumar",
  gender: "Male",
  dateOfBirth: new Date("1979-08-15"),
  age: 46,
  contactNumber: "9810099999",
  email: "ramesh.demo@example.com",
  bloodGroup: "B+",
  address: { addressLine1: "Demo IPD admission", city: "Delhi", state: "Delhi", pincode: "110001" },
  knownAllergies: [],
  paymentType: "CASH",
};
const TARGET_BED_NUMBER_PATTERNS = [/MGW.*B0?1$/i, /Male.*Bed.*1$/i, /MGW-B01$/i];

(async () => {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || "mongodb://127.0.0.1:27017/spherehealth";
  console.log(`[freshDemoAdmit] connecting to ${uri}`);
  await mongoose.connect(uri);

  // Register every model so mongoose.models is populated.
  const MODEL_PATHS = [
    "../models/Patient/patientModel",
    "../models/Patient/admissionModel",
    "../models/Patient/bedTransferModel",
    "../models/Patient/emergencyModel",
    "../models/Patient/OPDModels",
    "../models/PatientBillModel/PatientBillModel",
    "../models/PatientBillModel/PatientAdvanceModel",
    "../models/PatientBillModel/AutoBilledItemsModel",
    "../models/Billing/BillingTrigger",
    "../models/Billing/BillingAudit",
    "../models/Billing/CashierSession",
    "../models/Billing/CreditNote",
    "../models/Billing/PrintAuditModel",
    "../models/Doctor/DoctorNotesModel",
    "../models/Doctor/DoctorOrderModel",
    "../models/Doctor/prescription",
    "../models/Doctor/treatmentChartModel",
    "../models/Nurse/NurseNotesModel",
    "../models/Nurse/NursingAssessmentModel",
    "../models/Nurse/shiftHandoverModel",
    "../models/Pharmacy/PharmacyIndentModel",
    "../models/Pharmacy/PharmacySaleModel",
    "../models/Clinical/ConsentFormModel",
    "../models/Clinical/DischargeSummaryModel",
    "../models/Clinical/IntakeOutputEntryModel",
    "../models/Clinical/MARModel",
    "../models/Clinical/MedReconciliationModel",
    "../models/Clinical/PatientActivityLogModel",
    "../models/Clinical/WardTaskModel",
    "../models/Vitals/vitalSheetModel",
    "../models/VisitorPass/visitorPassModel",
    "../models/Investigation/InvestigationOrderModel",
    "../models/Appointment/appointmentModel",
    "../models/Compliance/EmergencyRegisterModel",
    "../models/Compliance/MortalityRegisterModel",
    "../models/Compliance/AntimicrobialUseRegisterModel",
    "../models/Compliance/ASARegisterModel",
    "../models/Compliance/BloodSugarRegisterModel",
    "../models/Compliance/BloodTransfusionRegisterModel",
    "../models/Compliance/BmwTransportManifestModel",
    "../models/Compliance/DVTRegisterModel",
    "../models/Compliance/FallRiskRegisterModel",
    "../models/Compliance/OTRegisterModel",
    "../models/Compliance/PainAssessmentRegisterModel",
    "../models/Compliance/PressureUlcerRegisterModel",
    "../models/Compliance/ReadmissionRegisterModel",
    "../models/Compliance/RestraintRegisterModel",
    "../models/Compliance/CodeResponseEventModel",
    "../models/Compliance/ClinicalAuditModel",
    "../models/bedMgmt/bedsModel",
    "../models/CounterModel",
  ];
  for (const p of MODEL_PATHS) {
    try { require(p); } catch (_) { /* skip */ }
  }

  // ── Step 1 — wipe ALL patient-touching collections.
  console.log("\n[Step 1] Wiping all IPD / OPD / billing / pharmacy / clinical rows…");
  const knownNames = Object.keys(mongoose.models);
  let wiped = 0;
  for (const name of knownNames) {
    // skip catalog / settings / user / Doctor (profile) / Drug / Service / Bed master / Counter
    if (/User|Role|Permission|Settings|HospitalSettings|Drug(?!Order)|DrugMaster|Service|Doctor(?!Notes|Order|Charges)|Counter|Brand|Manufacturer|Vendor(?!Return)|Bed(?!Transfer)|Room|Ward|Department|Holiday|Inventory|Stock(?!Take)|GRN|PO|PurchaseOrder|Tariff|Pricing|HSN|Email|SMS|Cron|Schedule(?!XEntry|XBalance)/i.test(name)) continue;
    try {
      const res = await mongoose.models[name].deleteMany({});
      if (res.deletedCount) {
        console.log(`  ${name.padEnd(36)} deleted ${res.deletedCount}`);
        wiped += res.deletedCount;
      }
    } catch (_) {}
  }
  console.log(`  TOTAL wiped: ${wiped}`);

  // Free every Bed (set to Available, clear patient reference)
  if (mongoose.models.Bed) {
    const Bed = mongoose.models.Bed;
    const freed = await Bed.updateMany({}, { $set: { status: "Available" }, $unset: { currentPatient: "", currentPatientId: "", currentAdmissionId: "", currentAdmission: "" } });
    console.log(`  Bed master       reset ${freed.modifiedCount} bed(s) to Available`);
  }

  // ── Step 2 — find Male General Ward Bed 01.
  const Bed = mongoose.models.Bed;
  let targetBed = null;
  if (Bed) {
    targetBed = await Bed.findOne({
      $or: TARGET_BED_NUMBER_PATTERNS.map(re => ({ bedNumber: { $regex: re.source, $options: "i" } })),
    });
    if (!targetBed) {
      // fall back: find any bed where wardName contains "Male General" and bedNumber ends in 01
      const beds = await Bed.find({ wardName: /Male General/i });
      targetBed = beds.find(b => /0?1$/.test(b.bedNumber)) || beds[0];
    }
  }
  if (!targetBed) {
    console.error("[freshDemoAdmit] FATAL — Male General Ward Bed 01 not found. Available wards/beds:");
    if (Bed) {
      const sample = await Bed.find().limit(15).select("bedNumber wardName status").lean();
      console.error(sample);
    }
    process.exit(1);
  }
  console.log(`\n[Step 2] Target bed: ${targetBed.bedNumber}  (${targetBed.wardName})`);

  // ── Step 3 — create Patient.
  const Patient = mongoose.models.Patient;
  const Counter = mongoose.models.Counter;
  // mint UHID via Counter (or fall back to UH${rand})
  let UHID = "UH02";
  if (Counter) {
    try {
      const c = await Counter.findOneAndUpdate({ _id: "uhid" }, { $inc: { seq: 1 } }, { upsert: true, new: true });
      UHID = `UH${String(c.seq).padStart(2, "0")}`;
    } catch (_) {}
  }
  const patient = await Patient.create({
    UHID,
    title: DEMO_PATIENT.title,
    fullName: DEMO_PATIENT.fullName,
    patientName: DEMO_PATIENT.fullName,
    gender: DEMO_PATIENT.gender,
    dob: DEMO_PATIENT.dateOfBirth,
    dateOfBirth: DEMO_PATIENT.dateOfBirth,
    age: DEMO_PATIENT.age,
    contactNumber: DEMO_PATIENT.contactNumber,
    phone: DEMO_PATIENT.contactNumber,
    email: DEMO_PATIENT.email,
    bloodGroup: DEMO_PATIENT.bloodGroup,
    address: DEMO_PATIENT.address,
    knownAllergies: DEMO_PATIENT.knownAllergies,
    allergies: DEMO_PATIENT.knownAllergies,
    paymentType: DEMO_PATIENT.paymentType,
    isActive: true,
  });
  console.log(`\n[Step 3] Patient created: ${patient.fullName} · UHID=${patient.UHID} · _id=${patient._id}`);

  // ── Step 4 — create Admission.
  const Admission = mongoose.models.Admission;
  // mint IPD number
  let ipdNo = "IPD-26-01";
  if (Counter) {
    try {
      const c = await Counter.findOneAndUpdate({ _id: "ipd-26" }, { $inc: { seq: 1 } }, { upsert: true, new: true });
      ipdNo = `IPD-26-${String(c.seq).padStart(2, "0")}`;
    } catch (_) {}
  }
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
    bedId: targetBed._id,
    bedNumber: targetBed.bedNumber,
    wardName: targetBed.wardName,
    roomCategory: targetBed.roomCategory || "GENW",
    status: "Active",
    provisionalDiagnosis: "",
    age: patient.age,
    gender: patient.gender,
    contactNumber: patient.contactNumber,
  });
  console.log(`\n[Step 4] Admission created: ${ipdNo} · ${targetBed.bedNumber} · Dr. Sandeep · Medicine`);

  // ── Step 5 — occupy the bed.
  targetBed.status = "Occupied";
  targetBed.currentPatient = patient._id;
  targetBed.currentPatientId = patient._id;
  targetBed.currentAdmissionId = admission._id;
  targetBed.currentAdmission = admission._id;
  await targetBed.save();
  console.log(`\n[Step 5] Bed ${targetBed.bedNumber} flipped to Occupied → ${patient.fullName}`);

  console.log(`\n────────────────────────────────────────────────────────`);
  console.log(`✓ DEMO ADMISSION COMPLETE`);
  console.log(`  Patient    : ${patient.title} ${patient.fullName}`);
  console.log(`  UHID       : ${patient.UHID}`);
  console.log(`  IPD No     : ${ipdNo}`);
  console.log(`  Bed        : ${targetBed.bedNumber}  (${targetBed.wardName})`);
  console.log(`  Doctor     : Dr. Sandeep`);
  console.log(`  Department : General Medicine`);
  console.log(`  Admitted at: ${now.toLocaleString("en-IN")} IST`);
  console.log(`────────────────────────────────────────────────────────`);

  await mongoose.disconnect();
})().catch(err => {
  console.error("[freshDemoAdmit] FATAL:", err);
  process.exit(1);
});
