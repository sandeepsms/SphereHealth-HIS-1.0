/**
 * SphereHealth HIS — Default User Seed Script
 * Run: node Backend/scripts/seedUsers.js
 *
 * Creates one default user per role if they don't already exist.
 */

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const mongoose = require("mongoose");
const User = require("../models/User/userModel");
const Department = require("../models/Department/department");

// Fail-fast on missing MONGO_URI (audit D-02). No silent localhost fallback.
if (!process.env.MONGO_URI) {
  console.error("FATAL: MONGO_URI is not set in Backend/.env — refusing to seed.");
  process.exit(1);
}
const MONGO_URI = process.env.MONGO_URI;

const SEED_USERS = [
  {
    employeeId: "ADM-001",
    firstName: "System",
    lastName: "Admin",
    fullName: "System Admin",
    email: "admin@spherehealth.com",
    password: "Admin@123",
    role: "Admin",
    phone: "9999900001",
    gender: "Male",
    status: "Active",
    isActive: true,
  },
  {
    employeeId: "REC-001",
    firstName: "Priya",
    lastName: "Sharma",
    fullName: "Priya Sharma",
    email: "receptionist@spherehealth.com",
    password: "Recept@123",
    role: "Receptionist",
    phone: "9999900002",
    gender: "Female",
    status: "Active",
    isActive: true,
  },
  {
    employeeId: "DOC-001",
    firstName: "Dr. Rajesh",
    lastName: "Kumar",
    fullName: "Dr. Rajesh Kumar",
    email: "doctor@spherehealth.com",
    password: "Doctor@123",
    role: "Doctor",
    phone: "9999900003",
    gender: "Male",
    status: "Active",
    isActive: true,
    doctorDetails: {
      designation: "Consultant",
      specialization: "General Medicine",
      registrationNumber: "MCI-12345",
    },
  },
  {
    employeeId: "NUR-001",
    firstName: "Sunita",
    lastName: "Patil",
    fullName: "Sunita Patil",
    email: "nurse@spherehealth.com",
    password: "Nurse@123",
    role: "Nurse",
    phone: "9999900004",
    gender: "Female",
    status: "Active",
    isActive: true,
    nurseDetails: {
      registrationNumber: "INC-67890",
      nursingType: "Staff Nurse",
    },
  },
  {
    employeeId: "DIT-001",
    firstName: "Anita",
    lastName: "Mehta",
    fullName: "Anita Mehta",
    email: "dietician@spherehealth.com",
    password: "Diet@123",
    role: "Dietician",
    phone: "9999900005",
    gender: "Female",
    status: "Active",
    isActive: true,
  },
  {
    employeeId: "TPA-001",
    firstName: "Vikram",
    lastName: "Singh",
    fullName: "Vikram Singh",
    email: "tpa@spherehealth.com",
    password: "Tpa@1234",
    role: "TPA Coordinator",
    phone: "9999900006",
    gender: "Male",
    status: "Active",
    isActive: true,
  },
];

async function seed() {
  try {
    await mongoose.connect(MONGO_URI);
    // URI redacted from log — may contain credentials (audit D-02 / G-02).
    console.log("✅ Connected to MongoDB");

    // Get or create a default General Medicine department for Doctor/Nurse seeds
    let defaultDept = await Department.findOne({ name: "General Medicine" });
    if (!defaultDept) {
      defaultDept = await Department.findOne({});
    }

    let created = 0;
    let skipped = 0;

    for (const userData of SEED_USERS) {
      const existing = await User.findOne({ email: userData.email });
      if (existing) {
        console.log(`⏭️  Skipped (exists): ${userData.email} [${userData.role}]`);
        skipped++;
        continue;
      }
      // Assign a department for roles that require it
      const needsDept = ["Doctor", "Nurse", "Lab Technician", "Radiologist"].includes(userData.role);
      if (needsDept && defaultDept) {
        userData.department = defaultDept._id;
      }
      const user = new User(userData);
      await user.save();
      // Password redacted from stdout (security audit B-07). Plain-text
      // creds in log aggregators / shared dev terminals are a CWE-532
      // disclosure even in dev. Operator can still look up the password
      // in this file's SEED_USERS array if they actually need to log in.
      console.log(`✅ Created: ${userData.email} [${userData.role}]`);
      created++;
    }

    console.log(`\n📋 Seed complete. Created: ${created}, Skipped: ${skipped}`);
    console.log("\n🔑 Login Credentials Listing:");
    console.log("   (passwords redacted from log — see SEED_USERS in this file)");
    console.log("┌─────────────────────────────────────────────────────────────┐");
    SEED_USERS.forEach(u => {
      console.log(`│  ${u.role.padEnd(18)} ${u.email.padEnd(35)} ******`);
    });
    console.log("└─────────────────────────────────────────────────────────────┘");
  } catch (err) {
    console.error("❌ Seed failed:", err.message);
  } finally {
    await mongoose.disconnect();
    console.log("\n🔌 Disconnected from MongoDB");
  }
}

seed();
