// Seed: give the Pharmacist + Admin users a current State
// Pharmacy Council practising registration (LICENCE shape #2 accepted by
// credentialExpiryBlocker PHARMACIST_REG) so the licensed pharmacy acts
// (GRN / dispense / release) are exercisable in dev. Mirrors the real
// onboarding step a hospital's HR does for its registered pharmacist.
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const mongoose = require("mongoose");

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const User = require("../models/User/userModel");
  const Credential = require("../models/HR/CredentialModel");

  const users = await User.find({ role: { $in: ["Pharmacist", "Admin"] } }).select("fullName email role").lean();
  console.log("target users:", users.map((u) => `${u.role}:${u.email}`).join(", "));

  for (const u of users) {
    const existing = await Credential.findOne({
      userId: u._id,
      $or: [
        { credentialType: "PHARMACIST_REG" },
        { credentialType: "LICENCE", councilName: /pharmacy\s*council|pci/i },
      ],
    }).lean();
    if (existing) { console.log(`  ${u.email}: already has pharmacist reg (${existing.status})`); continue; }
    await Credential.create({
      userId: u._id,
      credentialType: "LICENCE",
      title: "State Pharmacy Council Practising Registration",
      councilName: "Haryana State Pharmacy Council",
      registrationNo: `HSPC-DEV-${String(u._id).slice(-5).toUpperCase()}`,
      issuedOn: new Date("2024-04-01"),
      expiryDate: new Date("2027-12-31"),
      status: "VERIFIED",
      remarks: "Seeded — licensed pharmacy acts (D&C Rules 65) testable in dev",
    });
    console.log(`  ${u.email}: LICENCE (State Pharmacy Council) added, valid till 2027-12-31`);
  }
  await mongoose.disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
