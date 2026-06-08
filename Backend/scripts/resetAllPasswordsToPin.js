/**
 * resetAllPasswordsToPin.js
 *
 * One-off dev utility. Resets every User's password to a simple PIN
 * ("1234" by default — override via PIN env var). The User schema's
 * `minlength: 6` validator would reject this on save, so we go around
 * mongoose and write the bcrypt hash directly via the native MongoDB
 * driver. The actual login flow uses `bcrypt.compare(candidate, hash)`
 * which has no length check, so a 4-char PIN works once the hash is in
 * place.
 *
 * Side-effects per user:
 *   • password           ← bcrypt.hash(PIN, 10)
 *   • failedLoginAttempts ← 0
 *   • lockUntil          ← null         (clear any active lockout)
 *   • mustChangePassword ← false        (do NOT force-rotate on login)
 *   • passwordChangedAt  ← now()
 *   • tokenVersion       ← +1           (invalidate all existing JWTs)
 *
 * Usage:
 *   PIN=1234 node Backend/scripts/resetAllPasswordsToPin.js
 *   node Backend/scripts/resetAllPasswordsToPin.js          (defaults to 1234)
 */
"use strict";

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const mongoose = require("mongoose");
const bcrypt   = require("bcryptjs");

const PIN = String(process.env.PIN || "1234");

async function main() {
  const uri = process.env.MONGO_URI || "mongodb://localhost:27017/spherehealth";
  console.log(`[reset-pin] connecting → ${uri}`);
  await mongoose.connect(uri);

  // Bypass the User schema's pre-save bcrypt hook + minlength validator
  // by writing directly to the underlying collection. We hash here.
  const hash = await bcrypt.hash(PIN, 10);
  const now  = new Date();

  const coll = mongoose.connection.collection("users");
  const before = await coll.countDocuments({});
  console.log(`[reset-pin] ${before} users in collection`);

  const r = await coll.updateMany(
    {},
    {
      $set: {
        password: hash,
        failedLoginAttempts: 0,
        lockUntil: null,
        mustChangePassword: false,
        passwordChangedAt: now,
      },
      $inc: { tokenVersion: 1 },
    },
  );
  console.log(`[reset-pin] matched=${r.matchedCount} modified=${r.modifiedCount}`);
  console.log(`[reset-pin] new PIN for every user: "${PIN}"`);

  // Show a small sample so the user knows which accounts they can sign in with
  const sample = await coll
    .find({}, { projection: { email: 1, employeeId: 1, firstName: 1, roles: 1, role: 1 } })
    .limit(10)
    .toArray();
  console.log(`[reset-pin] sample accounts (first 10):`);
  for (const u of sample) {
    console.log(`  • ${u.email}  ·  ${u.employeeId || "—"}  ·  ${u.firstName || ""}  ·  ${u.role || (u.roles && u.roles[0]) || ""}`);
  }

  await mongoose.disconnect();
  console.log(`[reset-pin] done.`);
}

main().catch((err) => {
  console.error("[reset-pin] FAILED:", err);
  process.exit(1);
});
