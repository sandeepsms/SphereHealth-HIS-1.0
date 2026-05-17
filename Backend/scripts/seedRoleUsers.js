/*
 * seedRoleUsers.js
 *
 * Creates User accounts for every role in the system so each staff member
 * can log in. For every Doctor record seeded by `seedDeptDoctors.js`, this
 * creates a matching User and writes `Doctor.loginUserId = User._id` so
 * role-based filtering (OPD/IPD/ER/Daycare → only this doctor's patients)
 * works without further configuration.
 *
 * Login credentials (all): password = "Welcome@123"
 *   Doctors:
 *     rakesh.kumar@spherehealth.com
 *     priya.sharma@spherehealth.com
 *     anil.mehta@spherehealth.com
 *     sunita.reddy@spherehealth.com
 *     vikram.singh@spherehealth.com
 *     rohit.verma@spherehealth.com
 *     neha.agarwal@spherehealth.com
 *     arjun.iyer@spherehealth.com
 *     kavita.joshi@spherehealth.com
 *     meera.chaudhary@spherehealth.com
 *     dr.sandeep@spherehealth.com
 *   Other staff:
 *     reception@spherehealth.com     (Receptionist)
 *     nurse@spherehealth.com         (Nurse — all patients)
 *     accountant@spherehealth.com    (Accountant)
 *     tpa@spherehealth.com           (TPA Coordinator)
 *     pharmacy@spherehealth.com      (Pharmacist)
 *     lab@spherehealth.com           (Lab Technician)
 *     radio@spherehealth.com         (Radiologist)
 *     admin@spherehealth.com         (Admin)
 *
 * Idempotent — safe to re-run. Matches users by email.
 *
 * Run:
 *   node scripts/seedRoleUsers.js
 */
require("dotenv").config();
const mongoose = require("mongoose");
const User       = require("../models/User/userModel");
const Doctor     = require("../models/Doctor/doctorModel");
const Department = require("../models/Department/department");

const DEFAULT_PASSWORD = "Welcome@123"; // hashed by the User model's pre-save hook

/* Other-role users (no Doctor link) */
const STAFF_USERS = [
  { email: "admin@spherehealth.com",      role: "Admin",          firstName: "System",  lastName: "Admin",      phone: "9999900001", gender: "Other" },
  { email: "reception@spherehealth.com",  role: "Receptionist",   firstName: "Reception", lastName: "Desk",     phone: "9999900002", gender: "Female" },
  { email: "nurse@spherehealth.com",      role: "Nurse",          firstName: "Sunita",  lastName: "Patil",      phone: "9999900003", gender: "Female", deptCode: "GMED" },
  { email: "accountant@spherehealth.com", role: "Accountant",     firstName: "Vinay",   lastName: "Gupta",      phone: "9999900004", gender: "Male" },
  { email: "tpa@spherehealth.com",        role: "TPA Coordinator",firstName: "Ramesh",  lastName: "Khanna",     phone: "9999900005", gender: "Male" },
  { email: "pharmacy@spherehealth.com",   role: "Pharmacist",     firstName: "Asha",    lastName: "Pandey",     phone: "9999900006", gender: "Female" },
  { email: "lab@spherehealth.com",        role: "Lab Technician", firstName: "Mohit",   lastName: "Bansal",     phone: "9999900007", gender: "Male",   deptCode: "GMED" },
  { email: "radio@spherehealth.com",      role: "Radiologist",    firstName: "Pooja",   lastName: "Sehgal",     phone: "9999900008", gender: "Female", deptCode: "GMED" },
];

/* Role → employeeId prefix */
const ROLE_PREFIX = {
  Admin: "ADM", Doctor: "DOC", Nurse: "NUR", Receptionist: "REC",
  Pharmacist: "PHR", "Lab Technician": "LAB", Radiologist: "RAD",
  Accountant: "ACC", "TPA Coordinator": "TPA", Dietician: "DIT",
  "Ward Boy": "WBY", Physiotherapist: "PHY", Security: "SEC", Housekeeping: "HSE",
};

/* Generate a unique employeeId per role: <PREFIX>-<YEAR>-<NNNNN> */
async function generateEmployeeId(role) {
  const prefix = ROLE_PREFIX[role] || "EMP";
  const year = new Date().getFullYear();
  const re = new RegExp(`^${prefix}-${year}-`);
  const count = await User.countDocuments({ employeeId: re });
  return `${prefix}-${year}-${String(count + 1).padStart(5, "0")}`;
}

async function findOrCreateUser({ email, role, firstName, lastName, phone, gender, deptCode, doctorDetails, designation }) {
  let user = await User.findOne({ email });
  let department = null;
  if (deptCode) {
    department = await Department.findOne({ departmentCode: deptCode });
  }

  const payload = {
    firstName,
    lastName,
    email,
    phone,
    role,
    gender,
    dateOfBirth: new Date("1985-01-01"),
    status: "Active",
    isActive: true,
    ...(department && { department: department._id }),
    ...(doctorDetails && { doctorDetails }),
  };

  if (user) {
    // Refresh editable fields but leave password alone (so re-runs don't reset
    // a user's manually-changed password)
    Object.assign(user, payload);
    await user.save();
    return { user, created: false };
  } else {
    payload.employeeId = await generateEmployeeId(role);
    user = new User({ ...payload, password: DEFAULT_PASSWORD });
    await user.save();
    return { user, created: true };
  }
}

async function run() {
  // Fail-fast pattern aligned with the other seed scripts (audit D-02 +
  // R11 re-audit follow-up). No localhost fallback, no URI echo.
  if (!process.env.MONGO_URI) {
    console.error("FATAL: MONGO_URI is not set in Backend/.env — refusing to seed.");
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to MongoDB\n");

  /* ── 1. Doctor users + link to Doctor records ─────────────── */
  console.log("Doctor users:");
  const doctors = await Doctor.find({ isActive: true }).populate("department");
  let createdDocUsers = 0, updatedDocUsers = 0, linked = 0;

  for (const doc of doctors) {
    const email     = doc.contact?.email;
    const firstName = doc.personalInfo?.firstName || "";
    const lastName  = doc.personalInfo?.lastName  || "";
    const phone     = doc.contact?.mobileNumber || "0000000000";
    const gender    = doc.personalInfo?.gender   || "Other";
    if (!email) {
      console.warn(`  ⚠ Skipping doctor with no email (${firstName} ${lastName})`);
      continue;
    }

    // Compose doctorDetails subdoc for the User record
    const doctorDetails = {
      designation:        "Consultant",
      specialization:     doc.professional?.specialization || "",
      registrationNumber: doc.professional?.registrationNumber || "",
      qualifications:     doc.professional?.qualifications || [],
      experienceYears:    doc.professional?.experience || 0,
      consultationFee: {
        opd:       doc.consultationFee?.opd       || 0,
        emergency: doc.consultationFee?.emergency || 0,
        ipd:       0,
      },
    };

    const deptCode = doc.department?.departmentCode;
    const { user, created } = await findOrCreateUser({
      email,
      role: "Doctor",
      firstName: firstName.startsWith("Dr.") ? firstName : `Dr. ${firstName}`,
      lastName,
      phone, gender,
      deptCode,
      doctorDetails,
    });

    if (created) createdDocUsers++; else updatedDocUsers++;

    // Link Doctor → User (idempotent — only writes if changed)
    if (!doc.loginUserId || String(doc.loginUserId) !== String(user._id)) {
      doc.loginUserId = user._id;
      await doc.save();
      linked++;
    }
    console.log(`  ${created ? "✓" : "↺"} ${user.fullName.padEnd(28)}  ${email}  → ${doc.doctorId}`);
  }
  console.log(`\n  → ${createdDocUsers} created, ${updatedDocUsers} updated, ${linked} linked to Doctor records.\n`);

  /* ── 2. Other staff users ─────────────────────────────────── */
  console.log("Other staff users:");
  for (const staff of STAFF_USERS) {
    const { user, created } = await findOrCreateUser(staff);
    console.log(`  ${created ? "✓" : "↺"} ${user.fullName.padEnd(28)}  ${staff.email.padEnd(34)}  (${staff.role})`);
  }

  // Password not logged (security audit B-07). Operator can read
  // DEFAULT_PASSWORD from this file's top-level constant if needed.
  console.log(`\n  Default password is set on newly-created users — see DEFAULT_PASSWORD const in this script.`);
  console.log("  Existing users retain their old password.\n");

  await mongoose.disconnect();
  console.log("Done.");
}

run().catch(err => {
  console.error("Seed failed:", err);
  process.exit(1);
});
