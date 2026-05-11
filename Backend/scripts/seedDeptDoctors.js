/*
 * seedDeptDoctors.js
 *
 * Seeds 5 departments + 2 doctors per department (10 doctors)
 * + Dr. Sandeep as a General Physician with specific details:
 *     - Registration No.: HN23611
 *     - Age:              32 years
 *     - Mobile:           8950999765
 *
 * Idempotent — safe to run multiple times.
 *   - Departments are matched by departmentCode
 *   - Doctors are matched by registrationNumber
 *
 * Run:
 *   node scripts/seedDeptDoctors.js
 */
require("dotenv").config();
const mongoose = require("mongoose");
const Department = require("../models/Department/department");
const Doctor     = require("../models/Doctor/doctorModel");

/* ─────────── Department definitions ─────────── */
const DEPARTMENTS = [
  {
    departmentName: "General Medicine",
    departmentCode: "GMED",
    category:       "Clinical",
    description:    "Outpatient & inpatient general medical care, internal medicine, chronic disease management",
    opdAvailable:   true,
    ipdAvailable:   true,
    emergencyAvailable: true,
    displayOrder:   1,
  },
  {
    departmentName: "Cardiology",
    departmentCode: "CARD",
    category:       "Clinical",
    description:    "Heart and cardiovascular care, ECG, echo, angiography",
    opdAvailable:   true,
    ipdAvailable:   true,
    emergencyAvailable: true,
    displayOrder:   2,
  },
  {
    departmentName: "Orthopedics",
    departmentCode: "ORTH",
    category:       "Surgical",
    description:    "Bone, joint, ligament and spine — trauma & elective surgery",
    opdAvailable:   true,
    ipdAvailable:   true,
    emergencyAvailable: true,
    displayOrder:   3,
  },
  {
    departmentName: "Pediatrics",
    departmentCode: "PEDI",
    category:       "Clinical",
    description:    "Newborn to adolescent care, immunization, growth & development",
    opdAvailable:   true,
    ipdAvailable:   true,
    emergencyAvailable: true,
    displayOrder:   4,
  },
  {
    departmentName: "Gynecology & Obstetrics",
    departmentCode: "GYNE",
    category:       "Surgical",
    description:    "Women's health, antenatal & postnatal care, delivery, gynaec surgery",
    opdAvailable:   true,
    ipdAvailable:   true,
    emergencyAvailable: true,
    displayOrder:   5,
  },
];

/* ─────────── Doctor definitions (2 per dept) ─────────── */
const DOCTORS = [
  // ── General Medicine ──
  {
    deptCode: "GMED",
    firstName: "Rakesh",  lastName: "Kumar",   gender: "Male",
    mobile: "9810012001", email: "rakesh.kumar@spherehealth.com",
    specialization: "General Physician",
    qualifications: ["MBBS", "MD (Internal Medicine)"],
    experience: 14,
    registrationNumber: "DMC-IM-12001",
    consultOPD: 500, consultER: 1000,
  },
  {
    deptCode: "GMED",
    firstName: "Priya",   lastName: "Sharma",  gender: "Female",
    mobile: "9810012002", email: "priya.sharma@spherehealth.com",
    specialization: "General Physician",
    qualifications: ["MBBS", "DNB (Family Medicine)"],
    experience: 9,
    registrationNumber: "DMC-IM-12002",
    consultOPD: 500, consultER: 1000,
  },

  // ── Cardiology ──
  {
    deptCode: "CARD",
    firstName: "Anil",    lastName: "Mehta",   gender: "Male",
    mobile: "9810012003", email: "anil.mehta@spherehealth.com",
    specialization: "Cardiologist",
    qualifications: ["MBBS", "MD", "DM (Cardiology)"],
    experience: 18,
    registrationNumber: "DMC-CD-12003",
    consultOPD: 1000, consultER: 1800,
  },
  {
    deptCode: "CARD",
    firstName: "Sunita",  lastName: "Reddy",   gender: "Female",
    mobile: "9810012004", email: "sunita.reddy@spherehealth.com",
    specialization: "Cardiologist",
    qualifications: ["MBBS", "MD", "DM (Cardiology)"],
    experience: 12,
    registrationNumber: "DMC-CD-12004",
    consultOPD: 1000, consultER: 1800,
  },

  // ── Orthopedics ──
  {
    deptCode: "ORTH",
    firstName: "Vikram",  lastName: "Singh",   gender: "Male",
    mobile: "9810012005", email: "vikram.singh@spherehealth.com",
    specialization: "Orthopedic",
    qualifications: ["MBBS", "MS (Orthopedics)", "Fellowship (Joint Replacement)"],
    experience: 16,
    registrationNumber: "DMC-OR-12005",
    consultOPD: 800, consultER: 1500,
  },
  {
    deptCode: "ORTH",
    firstName: "Rohit",   lastName: "Verma",   gender: "Male",
    mobile: "9810012006", email: "rohit.verma@spherehealth.com",
    specialization: "Orthopedic",
    qualifications: ["MBBS", "MS (Orthopedics)"],
    experience: 8,
    registrationNumber: "DMC-OR-12006",
    consultOPD: 700, consultER: 1400,
  },

  // ── Pediatrics ──
  {
    deptCode: "PEDI",
    firstName: "Neha",    lastName: "Agarwal", gender: "Female",
    mobile: "9810012007", email: "neha.agarwal@spherehealth.com",
    specialization: "Pediatrician",
    qualifications: ["MBBS", "MD (Pediatrics)"],
    experience: 11,
    registrationNumber: "DMC-PD-12007",
    consultOPD: 600, consultER: 1200,
  },
  {
    deptCode: "PEDI",
    firstName: "Arjun",   lastName: "Iyer",    gender: "Male",
    mobile: "9810012008", email: "arjun.iyer@spherehealth.com",
    specialization: "Pediatrician",
    qualifications: ["MBBS", "DNB (Pediatrics)"],
    experience: 7,
    registrationNumber: "DMC-PD-12008",
    consultOPD: 600, consultER: 1200,
  },

  // ── Gynecology & Obstetrics ──
  {
    deptCode: "GYNE",
    firstName: "Kavita",  lastName: "Joshi",   gender: "Female",
    mobile: "9810012009", email: "kavita.joshi@spherehealth.com",
    specialization: "Gynecologist",
    qualifications: ["MBBS", "MD (Obstetrics & Gynecology)"],
    experience: 15,
    registrationNumber: "DMC-GY-12009",
    consultOPD: 800, consultER: 1500,
  },
  {
    deptCode: "GYNE",
    firstName: "Meera",   lastName: "Chaudhary", gender: "Female",
    mobile: "9810012010", email: "meera.chaudhary@spherehealth.com",
    specialization: "Gynecologist",
    qualifications: ["MBBS", "MS (Obstetrics & Gynecology)"],
    experience: 10,
    registrationNumber: "DMC-GY-12010",
    consultOPD: 800, consultER: 1500,
  },

  // ── Dr. Sandeep — special entry per user request ──
  {
    deptCode: "GMED",
    firstName: "Sandeep", lastName: "",        gender: "Male",
    mobile: "8950999765", email: "dr.sandeep@spherehealth.com",
    specialization: "General Physician",
    qualifications: ["MBBS"],
    // Age 32 → ~7 years post-MBBS practice as a reasonable estimate
    experience: 7,
    age: 32,
    registrationNumber: "HN23611",
    consultOPD: 500, consultER: 1000,
  },
];

/* ─────────── Run ─────────── */
async function run() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI not set in .env");
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to MongoDB\n");

  // 1) Seed departments (upsert by departmentCode)
  const deptByCode = {};
  for (const d of DEPARTMENTS) {
    const existing = await Department.findOne({ departmentCode: d.departmentCode });
    if (existing) {
      // Keep existing but refresh editable fields
      Object.assign(existing, d);
      await existing.save();
      deptByCode[d.departmentCode] = existing;
      console.log(`  ↺ Department updated  : ${d.departmentName} (${d.departmentCode})`);
    } else {
      const created = await Department.create(d);
      deptByCode[d.departmentCode] = created;
      console.log(`  ✓ Department created  : ${d.departmentName} (${d.departmentCode})`);
    }
  }
  console.log(`\n  → ${Object.keys(deptByCode).length} departments ready\n`);

  // 2) Seed doctors (upsert by registrationNumber)
  let createdDocs = 0, updatedDocs = 0;
  for (const doc of DOCTORS) {
    const dept = deptByCode[doc.deptCode];
    if (!dept) {
      console.warn(`  ⚠ Skipping ${doc.firstName} ${doc.lastName} — department ${doc.deptCode} not found`);
      continue;
    }

    const docPayload = {
      personalInfo: {
        firstName: doc.firstName,
        lastName:  doc.lastName || ".",  // schema requires lastName (single-name fallback)
        fullName:  `${doc.firstName}${doc.lastName ? " " + doc.lastName : ""}`,
        gender:    doc.gender,
      },
      contact: {
        mobileNumber: doc.mobile,
        email:        doc.email,
      },
      professional: {
        specialization:     doc.specialization,
        qualifications:     doc.qualifications,
        experience:         doc.experience,
        registrationNumber: doc.registrationNumber,
        ...(doc.age !== undefined && { age: doc.age }),  // schema doesn't have age; stays as virtual
      },
      department: dept._id,
      consultationFee: {
        opd:       doc.consultOPD,
        emergency: doc.consultER,
      },
      isActive: true,
    };

    const existing = await Doctor.findOne({ "professional.registrationNumber": doc.registrationNumber });
    if (existing) {
      existing.personalInfo    = docPayload.personalInfo;
      existing.contact         = docPayload.contact;
      existing.professional    = docPayload.professional;
      existing.department      = dept._id;
      existing.consultationFee = docPayload.consultationFee;
      existing.isActive        = true;
      await existing.save();
      updatedDocs++;
      console.log(`  ↺ Doctor updated      : Dr. ${doc.firstName}${doc.lastName ? " " + doc.lastName : ""} — ${doc.specialization} [${dept.departmentName}]`);
    } else {
      const created = await Doctor.create(docPayload);
      createdDocs++;
      console.log(`  ✓ Doctor created      : Dr. ${doc.firstName}${doc.lastName ? " " + doc.lastName : ""} (${created.doctorId}) — ${doc.specialization} [${dept.departmentName}]`);
    }
  }

  console.log(`\n  → ${createdDocs} doctors created, ${updatedDocs} updated\n`);

  // 3) Wire each department's HOD to the most experienced doctor in that dept
  for (const dept of Object.values(deptByCode)) {
    const hod = await Doctor.findOne({ department: dept._id, isActive: true })
      .sort({ "professional.experience": -1 })
      .lean();
    if (hod) {
      dept.headOfDepartment = hod._id;
      dept.hodContact = hod.contact.mobileNumber;
      await dept.save();
      console.log(`  ✓ HOD set for ${dept.departmentName.padEnd(28)}: Dr. ${hod.personalInfo.fullName}`);
    }
  }

  // 4) Summary
  console.log("\n═══════════════════════════════════════════════");
  console.log("SEEDING COMPLETE");
  console.log("═══════════════════════════════════════════════");
  const totalDepts = await Department.countDocuments();
  const totalDocs  = await Doctor.countDocuments();
  console.log(`  Total departments in DB : ${totalDepts}`);
  console.log(`  Total doctors in DB     : ${totalDocs}`);

  const sandeep = await Doctor.findOne({ "professional.registrationNumber": "HN23611" })
    .populate("department", "departmentName")
    .lean();
  if (sandeep) {
    console.log(`\n  ➤ Dr. Sandeep verified  :`);
    console.log(`      Reg No.       : ${sandeep.professional.registrationNumber}`);
    console.log(`      Specialization: ${sandeep.professional.specialization}`);
    console.log(`      Mobile        : ${sandeep.contact.mobileNumber}`);
    console.log(`      Department    : ${sandeep.department?.departmentName}`);
    console.log(`      Doctor ID     : ${sandeep.doctorId}`);
  }

  await mongoose.disconnect();
  console.log("\nDone.");
}

run().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
