/**
 * SphereHealth HIS — Patient / OPD / IPD Seed Script
 * Run: node Backend/scripts/seedPatients.js
 *
 * What it does:
 *  1. Finds or creates a Department and Doctor (needed for patient refs)
 *  2. Finds an available Bed (from previously seeded BIMS structure)
 *  3. Creates 2 sample patients — one OPD, one IPD
 *  4. Creates 1 OPD visit record
 *  5. Creates 1 IPD admission record
 *
 * Prerequisites:
 *  - node Backend/scripts/seedBIMS.js  (beds must exist)
 *  - node Backend/scripts/seedUsers.js (optional, for doctor user link)
 */

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const mongoose = require("mongoose");

const Patient    = require("../models/Patient/patientModel");
const OPD        = require("../models/Patient/OPDModels");
const Admission  = require("../models/Patient/admissionModel");
const Department = require("../models/Department/department");
const Doctor     = require("../models/Doctor/doctorModel");
const Beds       = require("../models/bedMgmt/bedsModel");

// UHID is PHI under DPDP §8 — masking even in seed scripts so log
// aggregators / shared dev terminals can't snapshot it (re-audit G-03b).
const maskUHID = (u) => (u ? `${"*".repeat(Math.max(0, String(u).length - 4))}${String(u).slice(-4)}` : "(none)");
const User       = require("../models/User/userModel");

// Fail-fast on missing MONGO_URI (audit D-02). No silent localhost fallback.
if (!process.env.MONGO_URI) {
  console.error("FATAL: MONGO_URI is not set in Backend/.env — refusing to seed.");
  process.exit(1);
}
const MONGO_URI = process.env.MONGO_URI;

// ── UHID generator (mirrors patient service logic) ───────────────────────────
async function genUHID() {
  const year = new Date().getFullYear().toString().slice(-2);
  const last  = await Patient.findOne({ UHID: { $regex: `^SH-${year}` } })
    .sort({ UHID: -1 }).lean();
  const seq = last ? (parseInt(last.UHID.split("-")[2], 10) || 0) + 1 : 1;
  return `SH-${year}-${String(seq).padStart(6, "0")}`;
}

// ── Visit number generator ───────────────────────────────────────────────────
async function genVisitNumber() {
  const year = new Date().getFullYear();
  const last  = await OPD.findOne({ visitNumber: { $regex: `^OPD-${year}` } })
    .sort({ visitNumber: -1 }).lean();
  const seq = last ? (parseInt(last.visitNumber.split("-")[2], 10) || 0) + 1 : 1;
  return `OPD-${year}-${String(seq).padStart(6, "0")}`;
}

async function seed() {
  await mongoose.connect(MONGO_URI);
  // URI redacted from log — credentials risk (audit D-02 / G-02).
  console.log("✅ Connected to MongoDB");

  // ── 1. Find or create Department ────────────────────────────────────────────
  let dept = await Department.findOne().lean();
  if (!dept) {
    dept = await Department.create({
      departmentName: "General Medicine",
      departmentCode: "GM",
      category: "Clinical",
      description: "General Medicine department",
    });
    console.log("🏥 Created department:", dept.departmentName);
  } else {
    console.log("🏥 Using existing department:", dept.departmentName || dept.departmentCode);
  }

  // ── 2. Find or create Doctor ─────────────────────────────────────────────────
  let doctor = await Doctor.findOne({ department: dept._id }).lean();
  if (!doctor) {
    // Try any doctor
    doctor = await Doctor.findOne().lean();
  }
  if (!doctor) {
    doctor = await Doctor.create({
      personalInfo: {
        firstName: "Rajesh",
        lastName: "Kumar",
        fullName: "Dr. Rajesh Kumar",
        gender: "Male",
      },
      contact: {
        mobileNumber: "9876543210",
        email: "dr.rajesh@spherehealth.com",
      },
      professional: {
        specialization: "General Physician",
        qualification: "MBBS, MD",
        experience: 10,
        registrationNumber: "MCI-12345",
      },
      department: dept._id,
      status: "Active",
    });
    console.log("👨‍⚕️ Created doctor:", doctor.personalInfo?.fullName);
  } else {
    console.log("👨‍⚕️ Using existing doctor:", doctor.personalInfo?.fullName || doctor._id);
  }

  // Also find the User with role Doctor (for attendingDoctorId on admission)
  const doctorUser = await User.findOne({ role: "Doctor" }).lean();
  if (doctorUser) {
    console.log("👤 Found doctor User:", doctorUser.fullName || doctorUser.email);
  }

  // ── 3. Find an available Bed ─────────────────────────────────────────────────
  const bed = await Beds.findOne({ status: "Available", isActive: true })
    .populate("room").populate("ward").populate("floor").lean();
  if (bed) {
    console.log(`🛏️  Found available bed: ${bed.bedNumber} (Ward: ${bed.wardName || "—"})`);
  } else {
    console.log("⚠️  No available beds found — IPD admission will be created without a bed.");
    console.log("   Run: node Backend/scripts/seedBIMS.js to create beds first.");
  }

  // ── 4. Create OPD Patient ───────────────────────────────────────────────────
  const opdUHID = await genUHID();
  let opdPatient = await Patient.findOne({ contactNumber: "9876500001" }).lean();
  if (!opdPatient) {
    opdPatient = await Patient.create({
      UHID: opdUHID,
      patientId: opdUHID,
      registrationType: "OPD",
      title: "Mr.",
      fullName: "Mr. Arjun Mehta",
      gender: "Male",
      dateOfBirth: new Date("1990-06-15"),
      age: 35,
      maritalStatus: "Married",
      contactNumber: "9876500001",
      email: "arjun.mehta@example.com",
      address: {
        completeAddress: "12 MG Road, Bhopal",
        city: "Bhopal",
        district: "Bhopal",
        state: "Madhya Pradesh",
        pincode: "462001",
      },
      bloodGroup: "B+",
      knownAllergies: "Penicillin",
      department: dept._id,
      doctor: doctor._id,
      paymentType: "GENERAL",
      totalOPDVisits: 1,
      lastVisitDate: new Date(),
    });
    console.log(`✅ Created OPD patient: ${opdPatient.fullName} | UHID: ${maskUHID(opdPatient.UHID)}`);
  } else {
    console.log(`ℹ️  OPD patient already exists: ${opdPatient.fullName} | UHID: ${maskUHID(opdPatient.UHID)}`);
  }

  // ── 5. Create OPD Visit ─────────────────────────────────────────────────────
  const existing = await OPD.findOne({ UHID: opdPatient.UHID }).lean();
  if (!existing) {
    const visitNumber = await genVisitNumber();
    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    // Token number = how many OPD visits today + 1
    const todayCount = await OPD.countDocuments({ visitDate: { $gte: todayStart } });

    const opdVisit = await OPD.create({
      patientId: opdPatient._id.toString(),
      UHID: opdPatient.UHID,
      visitNumber,
      patientVisitSeq: 1,
      tokenNumber: todayCount + 1,
      visitDate: new Date(),
      visitType: "First Visit",
      departmentId: dept._id,
      department: dept.departmentName || "General Medicine",
      doctorId: doctor._id,
      consultantName: "Dr. Rajesh Kumar",
      chiefComplaint: "Fever with cough and cold for 3 days",
      complaintDuration: "3 days",
      historyOfPresentIllness: "Patient presents with high grade fever (102°F), dry cough, runny nose. No vomiting or diarrhea.",
      pastMedicalHistory: "No significant past history",
      vitalsStatus: "Pending",
      status: "Waiting",
    });
    console.log(`✅ Created OPD visit: ${opdVisit.visitNumber} | Token: #${opdVisit.tokenNumber}`);
  } else {
    console.log(`ℹ️  OPD visit already exists for UHID: ${opdPatient.UHID}`);
  }

  // ── 6. Create IPD Patient ───────────────────────────────────────────────────
  const ipdUHID = await genUHID();
  let ipdPatient = await Patient.findOne({ contactNumber: "9876500002" }).lean();
  if (!ipdPatient) {
    ipdPatient = await Patient.create({
      UHID: ipdUHID,
      patientId: ipdUHID,
      registrationType: "IPD",
      title: "Mrs.",
      fullName: "Mrs. Sunita Patel",
      gender: "Female",
      dateOfBirth: new Date("1978-03-22"),
      age: 47,
      maritalStatus: "Married",
      contactNumber: "9876500002",
      email: "sunita.patel@example.com",
      address: {
        completeAddress: "45 Nehru Nagar, Indore",
        city: "Indore",
        district: "Indore",
        state: "Madhya Pradesh",
        pincode: "452001",
      },
      bloodGroup: "O+",
      knownAllergies: "",
      department: dept._id,
      doctor: doctor._id,
      paymentType: "GENERAL",
      totalIPDVisits: 1,
      lastVisitDate: new Date(),
    });
    console.log(`✅ Created IPD patient: ${ipdPatient.fullName} | UHID: ${maskUHID(ipdPatient.UHID)}`);
  } else {
    console.log(`ℹ️  IPD patient already exists: ${ipdPatient.fullName} | UHID: ${maskUHID(ipdPatient.UHID)}`);
  }

  // ── 7. Create IPD Admission ─────────────────────────────────────────────────
  const existingAdm = await Admission.findOne({ patientId: ipdPatient._id, status: "Active" }).lean();
  if (!existingAdm) {
    const admData = {
      UHID: ipdPatient.UHID,
      patientId: ipdPatient._id,
      patientName: ipdPatient.fullName,
      contactNumber: ipdPatient.contactNumber,
      admissionType: "Planned",
      admissionDate: new Date(),
      department: dept.departmentName || "General Medicine",
      departmentId: dept._id,
      attendingDoctor: "Dr. Rajesh Kumar",
      attendingDoctorId: doctorUser?._id || null,
      reasonForAdmission: "Abdominal pain with nausea and vomiting. Suspected acute appendicitis.",
      expectedDischargeDate: new Date(Date.now() + 5 * 86400000),
      estimatedCost: 25000,
      advancePaid: 5000,
      status: "Active",
      hasBed: !!bed,
    };

    if (bed) {
      admData.bedId      = bed._id;
      admData.bedNumber  = bed.bedNumber;
      admData.roomNumber = bed.roomNumber || bed.room?.roomNumber || "";
      admData.roomId     = bed.room?._id || bed.roomId || null;
      admData.wardId     = bed.ward?._id || bed.wardId || null;
      admData.wardName   = bed.wardName || bed.ward?.wardName || "";
      admData.floorId    = bed.floor?._id || bed.floorId || null;

      // Mark bed occupied
      await Beds.findByIdAndUpdate(bed._id, {
        status: "Occupied",
        patient: ipdPatient._id,
      });
      console.log(`🛏️  Bed ${bed.bedNumber} marked as Occupied`);
    }

    const admission = await Admission.create(admData);
    console.log(`✅ Created IPD admission: ${admission._id} | Patient: ${ipdPatient.fullName}`);
    if (bed) {
      console.log(`   Bed: ${bed.bedNumber} | Ward: ${admData.wardName || "—"}`);
    }
  } else {
    console.log(`ℹ️  IPD admission already exists for patient: ${ipdPatient.fullName}`);
  }

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log("\n══════════════════════════════════════════");
  console.log("  SEED COMPLETE");
  console.log("══════════════════════════════════════════");
  const opdCount = await OPD.countDocuments();
  const admCount = await Admission.countDocuments({ status: "Active" });
  const ptCount  = await Patient.countDocuments({ isActive: true });
  console.log(`  Patients   : ${ptCount}`);
  console.log(`  OPD visits : ${opdCount}`);
  console.log(`  IPD active : ${admCount}`);
  console.log("══════════════════════════════════════════\n");

  await mongoose.disconnect();
}

seed().catch(err => {
  console.error("❌ Seed failed:", err.message);
  process.exit(1);
});
