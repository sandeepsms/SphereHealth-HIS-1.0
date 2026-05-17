/**
 * SphereHealth HIS — JaiBhagwan IPD Seed
 * Clears ALL patient data and creates a fresh IPD admission for:
 *   Mr. JaiBhagwan, 56 yrs Male, Acute Gastroenteritis
 *
 * Run: node Backend/scripts/seedJaiBhagwan.js
 */

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const mongoose = require("mongoose");

const Patient    = require("../models/Patient/patientModel");
const Admission  = require("../models/Patient/admissionModel");
const OPD        = require("../models/Patient/OPDModels");
const DoctorOrder = require("../models/Doctor/DoctorOrderModel");
const NurseNotes  = require("../models/Nurse/NurseNotesModel");
const Department  = require("../models/Department/department");
const Doctor      = require("../models/Doctor/doctorModel");
const User        = require("../models/User/userModel");
const Beds        = require("../models/bedMgmt/bedsModel");
// Register bed-related models so Beds.populate() works
require("../models/bedMgmt/roomModel");
require("../models/bedMgmt/wardModel");
require("../models/bedMgmt/floorModel");
require("../models/bedMgmt/buildingModel");

// Fail-fast on missing MONGO_URI (security audit D-02). The previous
// silent localhost fallback meant a misconfigured dev box would seed
// against an unintended DB. Same env contract as the application
// server: MONGO_URI is REQUIRED.
if (!process.env.MONGO_URI) {
  console.error("FATAL: MONGO_URI is not set in Backend/.env — refusing to seed.");
  process.exit(1);
}
const MONGO_URI = process.env.MONGO_URI;

async function run() {
  await mongoose.connect(MONGO_URI);
  // Don't echo the full URI to stdout — it may contain credentials
  // (security audit D-02 / G-02 follow-up).
  console.log("✅ Connected to MongoDB");

  // ── 1. CLEAR ALL PATIENT DATA ───────────────────────────────────────────────
  console.log("\n🗑️  Clearing all patient data...");
  await Promise.all([
    Patient.deleteMany({}),
    Admission.deleteMany({}),
    OPD.deleteMany({}),
    DoctorOrder.deleteMany({}),
    NurseNotes.deleteMany({}),
  ]);
  // Also clear doctor notes and vitals if models exist
  try {
    const DoctorNotes = require("../models/Doctor/DoctorNotesModel");
    await DoctorNotes.deleteMany({});
  } catch (_) {}
  try {
    const VitalSheet = require("../models/Vitals/vitalSheetModel");
    await VitalSheet.deleteMany({});
  } catch (_) {}
  console.log("✅ All patient data cleared.");

  // ── 2. FIND DEPT + DOCTOR (created by previous seeds) ───────────────────────
  let dept = await Department.findOne({ departmentCode: "GM" }).lean()
           || await Department.findOne().lean();
  if (!dept) {
    dept = await Department.create({
      departmentName: "General Medicine",
      departmentCode: "GM",
      category: "Clinical",
    });
  }
  console.log("🏥 Department:", dept.departmentName || dept.departmentCode);

  let doctor = await Doctor.findOne({ department: dept._id }).lean()
             || await Doctor.findOne().lean();
  if (!doctor) {
    doctor = await Doctor.create({
      personalInfo: { firstName: "Rajesh", lastName: "Kumar", fullName: "Dr. Rajesh Kumar", gender: "Male" },
      contact: { mobileNumber: "9876543210", email: "dr.rajesh@spherehealth.com" },
      professional: { specialization: "General Physician", qualification: "MBBS, MD", experience: 10, registrationNumber: "MCI-12345" },
      department: dept._id, status: "Active",
    });
  }
  console.log("👨‍⚕️ Doctor:", doctor.personalInfo?.fullName || doctor._id);

  const doctorUser = await User.findOne({ role: "Doctor" }).lean();

  // ── 3. FIND A BED ────────────────────────────────────────────────────────────
  const bed = await Beds.findOne({ status: "Available", isActive: true })
    .populate("room").populate("ward").lean();

  // ── 4. CREATE JAIBHAGWAN PATIENT ────────────────────────────────────────────
  // DOB for 56 years: born 1970-04-27 (approx)
  const dob = new Date("1968-04-27");

  const patient = await Patient.create({
    registrationType: "IPD",
    title: "Mr.",
    fullName: "JaiBhagwan",
    gender: "Male",
    dateOfBirth: dob,
    maritalStatus: "Married",
    contactNumber: "9876500010",
    email: "jaibhagwan@example.com",
    address: {
      completeAddress: "A-14, Sector 5, Rohini, Delhi",
      city: "Delhi",
      district: "North West Delhi",
      state: "Delhi",
      pincode: "110085",
    },
    bloodGroup: "O+",
    knownAllergies: "None known",
    department: dept._id,
    doctor: doctor._id,
    paymentType: "GENERAL",
    totalIPDVisits: 1,
    lastVisitDate: new Date(),
  });
  // UHID masked even in seed logs — re-audit G-03b. Last 4 chars exposed for
  // operator cross-reference; rest redacted so log aggregators can't snapshot.
  const maskUHID = (u) => (u ? `${"*".repeat(Math.max(0, String(u).length - 4))}${String(u).slice(-4)}` : "(none)");
  console.log(`\n✅ Created patient: Mr. JaiBhagwan | UHID: ${maskUHID(patient.UHID)} | Age: ${patient.age}`);

  // ── 5. CREATE IPD ADMISSION ──────────────────────────────────────────────────
  const now = new Date();
  const year = now.getFullYear();
  const seq  = String(1).padStart(4, "0");
  const admissionNumber = `ADM-${year}-${seq}`;

  const admissionData = {
    UHID: patient.UHID,
    patientId: patient._id,
    patientName: "Mr. JaiBhagwan",
    contactNumber: patient.contactNumber,
    admissionType: "Emergency",
    admissionDate: now,
    admissionNumber,
    department: dept.departmentName || "General Medicine",
    departmentId: dept._id,
    attendingDoctor: doctor.personalInfo?.fullName || "Dr. Rajesh Kumar",
    attendingDoctorId: doctorUser?._id || null,
    reasonForAdmission: "Acute Gastroenteritis — vomiting, loose stools, dehydration",
    status: "Active",
    paymentType: "GENERAL",
    estimatedCost: 8000,
    hasBed: !!bed,
    // initialAssessment gate — both must be false initially
    initialAssessment: {
      doctorCompleted: false,
      nurseCompleted:  false,
    },
  };

  if (bed) {
    admissionData.bedId     = bed._id;
    admissionData.bedNumber = bed.bedNumber;
    admissionData.roomId    = bed.room?._id || null;
    admissionData.wardId    = bed.ward?._id || null;
    // Mark bed occupied
    await Beds.findByIdAndUpdate(bed._id, { status: "Occupied", currentPatient: patient._id });
    console.log(`🛏️  Assigned bed: ${bed.bedNumber}`);
  } else {
    console.log("⚠️  No available bed — admission created without bed.");
  }

  const admission = await Admission.create(admissionData);
  console.log(`✅ Admission created: ${admission.admissionNumber} | Status: ${admission.status}`);
  console.log(`   initialAssessment.doctorCompleted: ${admission.initialAssessment.doctorCompleted}`);
  console.log(`   initialAssessment.nurseCompleted:  ${admission.initialAssessment.nurseCompleted}`);

  // ── 6. SEED AGE TREATMENT CHART ORDERS ──────────────────────────────────────
  // Skipped — doctor will fill via Initial Assessment to test the full flow.
  console.log("\n💊 Skipping pre-seeded orders — doctor will fill via Initial Assessment.");
  if (false) {
  console.log("\n💊 Seeding Acute Gastroenteritis treatment orders...");

  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const UHID  = patient.UHID;
  const patientName = "Mr. JaiBhagwan";
  const visitId = admission._id.toString();
  const createdBy = doctor.personalInfo?.fullName || "Dr. Rajesh Kumar";

  const orders = [
    // ── IV Fluids ────────────────────────────────────────────────────────────
    {
      UHID, patientName, visitId, visitType: "IPD", orderType: "IV_Fluid", priority: "Urgent",
      orderedBy: createdBy, orderedAt: new Date(now - 3600000 * 1),
      orderDetails: {
        medicineName: "Ringer's Lactate",
        displayName: "Ringer's Lactate 1L",
        dose: "1000ml", route: "IV Infusion", frequency: "Q8H", duration: "48 hours",
        rate: "125", totalVolume: "1000",
        titrationGoal: "Maintain adequate hydration — urine output > 30 ml/hr",
        notes: "Through 18G IV cannula, right forearm. Monitor for signs of overload.",
      },
      scheduledTimes: ["06:00", "14:00", "22:00"],
      currentRate: "125",
      administrationRecord: [
        { scheduledTime: "06:00", scheduledDate: today, status: "given", givenAt: new Date(today.getTime() + 6*3600000), givenBy: "Sr. Priya Sharma", fiveRightsChecked: true, notes: "Patient comfortable" },
      ],
      status: "InProgress",
    },
    // ── Antiemetic ──────────────────────────────────────────────────────────
    {
      UHID, patientName, visitId, visitType: "IPD", orderType: "Medication", priority: "STAT",
      orderedBy: createdBy, orderedAt: new Date(now - 3600000 * 1),
      orderDetails: {
        medicineName: "Inj. Ondansetron",
        dose: "4mg", route: "IV", frequency: "TDS", duration: "3 days",
        indication: "Nausea / vomiting — acute gastroenteritis",
        dilution: "NS 0.9%", totalVolume: "50",
        notes: "Dilute in 50ml NS, give over 15 min. Monitor for QT prolongation.",
      },
      scheduledTimes: ["08:00", "14:00", "20:00"],
      administrationRecord: [
        { scheduledTime: "08:00", scheduledDate: today, status: "given", givenAt: new Date(today.getTime() + 8*3600000), givenBy: "Sr. Priya Sharma", fiveRightsChecked: true, notes: "Vomiting reduced after dose" },
      ],
      status: "InProgress",
    },
    // ── Antibiotic ──────────────────────────────────────────────────────────
    {
      UHID, patientName, visitId, visitType: "IPD", orderType: "Medication", priority: "Routine",
      orderedBy: createdBy, orderedAt: new Date(now - 3600000 * 1),
      orderDetails: {
        medicineName: "Inj. Metronidazole",
        dose: "500mg", route: "IV", frequency: "TDS", duration: "5 days",
        indication: "Empirical antibiotics for bacterial gastroenteritis",
        totalVolume: "100",
        notes: "Infuse over 30 min. Check for tingling/metallic taste.",
      },
      scheduledTimes: ["08:00", "16:00", "00:00"],
      administrationRecord: [
        { scheduledTime: "08:00", scheduledDate: today, status: "given", givenAt: new Date(today.getTime() + 8.5*3600000), givenBy: "Sr. Kavita R.", fiveRightsChecked: true },
      ],
      status: "InProgress",
    },
    // ── GI Protector ────────────────────────────────────────────────────────
    {
      UHID, patientName, visitId, visitType: "IPD", orderType: "Medication", priority: "Routine",
      orderedBy: createdBy, orderedAt: new Date(now - 3600000 * 1),
      orderDetails: {
        medicineName: "Inj. Pantoprazole",
        dose: "40mg", route: "IV", frequency: "OD", duration: "5 days",
        indication: "GI mucosal protection",
        dilution: "NS 0.9%", totalVolume: "100",
        notes: "Dilute in 100ml NS, give over 15 min.",
      },
      scheduledTimes: ["08:00"],
      administrationRecord: [
        { scheduledTime: "08:00", scheduledDate: today, status: "given", givenAt: new Date(today.getTime() + 8*3600000), givenBy: "Sr. Priya Sharma", fiveRightsChecked: true },
      ],
      status: "InProgress",
    },
    // ── Antispasmodic ────────────────────────────────────────────────────────
    {
      UHID, patientName, visitId, visitType: "IPD", orderType: "Medication", priority: "Routine",
      orderedBy: createdBy, orderedAt: new Date(now - 3600000 * 1),
      orderDetails: {
        medicineName: "Inj. Hyoscine Butylbromide",
        dose: "20mg", route: "IV", frequency: "BD", duration: "3 days",
        indication: "Abdominal cramps / spasm relief",
        notes: "Give slow IV push over 1 min. Monitor BP.",
      },
      scheduledTimes: ["08:00", "20:00"],
      administrationRecord: [
        { scheduledTime: "08:00", scheduledDate: today, status: "given", givenAt: new Date(today.getTime() + 9*3600000), givenBy: "Sr. Kavita R.", fiveRightsChecked: true },
      ],
      status: "InProgress",
    },
    // ── Electrolyte Replacement ──────────────────────────────────────────────
    {
      UHID, patientName, visitId, visitType: "IPD", orderType: "Medication", priority: "Routine",
      orderedBy: createdBy, orderedAt: new Date(now - 3600000 * 0.5),
      orderDetails: {
        medicineName: "Inj. Potassium Chloride (KCl)",
        dose: "20 mEq", route: "IV Infusion", frequency: "BD", duration: "48 hours",
        indication: "Hypokalaemia correction — K⁺ 3.1 mEq/L",
        dilution: "NS 0.9%", totalVolume: "500",
        notes: "Add 20 mEq KCl to 500ml NS. Infuse over 4 hrs. NEVER give IV push. Monitor ECG.",
      },
      scheduledTimes: ["10:00", "18:00"],
      hamFlag: true, twoNurseRequired: true, highRisk: true,
      administrationRecord: [
        { scheduledTime: "10:00", scheduledDate: today, status: "pending" },
      ],
      status: "InProgress",
    },
    // ── Diet ────────────────────────────────────────────────────────────────
    {
      UHID, patientName, visitId, visitType: "IPD", orderType: "Diet", priority: "Routine",
      orderedBy: createdBy, orderedAt: new Date(now - 3600000 * 0.5),
      orderDetails: {
        medicineName: "Diet",
        displayName: "ORS + Clear Liquid Diet",
        frequency: "Every 2 hrs", duration: "48 hrs",
        notes: "ORS 200ml every 2 hrs orally. Clear liquids — rice water, coconut water, thin dal water. No solid food for 48 hrs. Advance as tolerated.",
      },
      status: "InProgress",
    },
    // ── Probiotic ───────────────────────────────────────────────────────────
    {
      UHID, patientName, visitId, visitType: "IPD", orderType: "Medication", priority: "Routine",
      orderedBy: createdBy, orderedAt: new Date(now - 3600000 * 0.5),
      orderDetails: {
        medicineName: "Tab. Saccharomyces boulardii",
        displayName: "Probiotic (Econorm / Sachet)",
        dose: "250mg", route: "Oral", frequency: "BD", duration: "7 days",
        indication: "Restore gut flora — post-infective gastroenteritis",
        notes: "Give with ORS. Store in cool place.",
      },
      scheduledTimes: ["08:00", "20:00"],
      administrationRecord: [
        { scheduledTime: "08:00", scheduledDate: today, status: "given", givenAt: new Date(today.getTime() + 9.5*3600000), givenBy: "Sr. Priya Sharma", fiveRightsChecked: true },
      ],
      status: "InProgress",
    },
    // ── Nursing Order ────────────────────────────────────────────────────────
    {
      UHID, patientName, visitId, visitType: "IPD", orderType: "Nursing", priority: "Routine",
      orderedBy: createdBy, orderedAt: new Date(now - 3600000 * 0.5),
      orderDetails: {
        medicineName: "Strict I/O Chart",
        displayName: "Intake / Output Monitoring",
        frequency: "Q4H", duration: "48 hours",
        notes: "Monitor and record all oral and IV intake. Record all urine output, stool frequency and consistency. Alert if urine output < 30 ml/hr or stool > 5/hr.",
      },
      status: "InProgress",
    },
  ];

  const created = await DoctorOrder.insertMany(orders, { ordered: false });
  console.log(`✅ Created ${created.length} treatment orders for Acute Gastroenteritis`);
  } // end if(false)

  // ── 7. SUMMARY ──────────────────────────────────────────────────────────────
  console.log("\n══════════════════════════════════════════════════════");
  console.log("  JAIBHAGWAN IPD — SEED COMPLETE");
  console.log("══════════════════════════════════════════════════════");
  console.log(`  Patient   : Mr. JaiBhagwan, 56 yrs Male`);
  console.log(`  UHID      : ${maskUHID(patient.UHID)}`);
  console.log(`  Diagnosis : Acute Gastroenteritis`);
  console.log(`  Admission : ${admission.admissionNumber}`);
  console.log(`  Bed       : ${bed ? bed.bedNumber : "Not assigned"}`);
  console.log(`  Status    : Active`);
  console.log(`\n  ⚠️  INITIAL ASSESSMENT REQUIRED:`);
  console.log(`  Doctor must complete initial assessment first.`);
  console.log(`  Nurse must complete initial assessment first.`);
  console.log("══════════════════════════════════════════════════════\n");

  await mongoose.disconnect();
}

run().catch(err => {
  console.error("❌ Seed failed:", err.message);
  process.exit(1);
});
