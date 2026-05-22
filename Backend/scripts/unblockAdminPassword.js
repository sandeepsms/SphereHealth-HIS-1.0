/**
 * Backend/scripts/unblockAdminPassword.js
 *
 * R7bc one-off helper. R7bb's forced-password-change feature requires the
 * admin to set a new password before doing anything else, but if the
 * modal misbehaves (R7bc-FIX-1 fixed it) the operator can be locked out.
 *
 * What this script does:
 *   1. Sets admin@spherehealth.com `mustChangePassword: false`
 *   2. Sets admin's password to a known value that satisfies the policy
 *      (Welcome@123 — 11 chars, upper/lower/digit/special, no spaces)
 *   3. Bumps tokenVersion so any current session is invalidated cleanly
 *   4. Clears failedLoginAttempts + lockUntil
 *
 * Usage:
 *   cd Backend && node scripts/unblockAdminPassword.js
 *   # then login with admin@spherehealth.com / Welcome@123
 *
 * Idempotent. Safe to re-run.
 */
require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const TARGET_EMAIL = "admin@spherehealth.com";
const NEW_PASSWORD = "Welcome@123";

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const Users = mongoose.connection.collection("users");

  const hashed = await bcrypt.hash(NEW_PASSWORD, 12);
  const result = await Users.findOneAndUpdate(
    { email: TARGET_EMAIL },
    {
      $set: {
        password: hashed,
        mustChangePassword: false,
        passwordChangedAt: new Date(),
        failedLoginAttempts: 0,
        lockUntil: null,
        isActive: true,
        status: "Active",
      },
      $inc: { tokenVersion: 1 },
    },
    { returnDocument: "after" }
  );

  const u = result?.value || result;
  if (!u || !u._id) {
    console.error(`[unblock] ✗ no user with email ${TARGET_EMAIL}`);
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log(`[unblock] ✓ ${TARGET_EMAIL} reset.`);
  console.log(`  Password:           ${NEW_PASSWORD}`);
  console.log(`  mustChangePassword: false`);
  console.log(`  tokenVersion:       ${u.tokenVersion ?? "(bumped)"}`);
  console.log(`\nLogin → http://localhost:5174 → ${TARGET_EMAIL} / ${NEW_PASSWORD}`);

  await mongoose.disconnect();
})().catch((e) => {
  console.error("[unblock] error:", e.message);
  process.exit(2);
});
