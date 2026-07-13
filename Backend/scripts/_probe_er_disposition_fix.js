/**
 * _probe_er_disposition_fix.js — proves the ER register disposition enum-mismatch fix.
 *
 * BEFORE the fix, emitEmergencyDisposition wrote the ER *visit* disposition
 * ("Expired" / "Left Against Medical Advice") straight onto the *register* row,
 * whose enum only allows "Death" / "DAMA" — so save() threw a Mongoose enum
 * ValidationError that the emitter's catch swallowed, and the NABH Emergency
 * Register was NEVER updated or locked for the two most legally-sensitive exits.
 *
 * This drives the REAL emitter against the REAL register model + Mongo and
 * asserts each mapping persists + locks (or, for a non-terminal value, no-ops).
 *
 * Run:  MONGO_URI=mongodb://127.0.0.1:27017/spherehealth node scripts/_probe_er_disposition_fix.js
 */
"use strict";

const mongoose = require("mongoose");
const EmergencyRegister = require("../models/Compliance/EmergencyRegisterModel");
const emitter = require("../services/Compliance/nabhRegisterEmitter");

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/spherehealth";
let pass = 0, fail = 0;
const check = (name, ok, detail) => { (ok ? pass++ : fail++); console.log(`${ok ? "✅ PASS" : "❌ FAIL"} | ${name}${detail ? " | " + detail : ""}`); };

async function makeRow(tag) {
  // Minimal valid, unlocked register row (a fresh ObjectId stands in for the visit).
  const emergencyId = new mongoose.Types.ObjectId();
  const patientId = new mongoose.Types.ObjectId();
  const row = await EmergencyRegister.create({
    erNumber: `ER-PROBE-${tag}-${emergencyId.toString().slice(-6)}`,
    patientId,
    UHID: "UHPROBE1",
    emergencyId,
    arrivalAt: new Date(Date.now() - 45 * 60 * 1000), // 45 min ago
    triageCategory: "Emergency",
    disposition: "",
    locked: false,
  });
  return { row, visit: { _id: emergencyId, disposition: tag } };
}

async function run(visitDisposition, expectRegister, expectLock) {
  const { row, visit } = await makeRow(visitDisposition.replace(/[^A-Za-z]/g, "").slice(0, 8));
  await emitter.emitEmergencyDisposition({ visit, disposition: visitDisposition, actor: { fullName: "Dr Probe", role: "Doctor" } });
  const after = await EmergencyRegister.findById(row._id).lean();
  const okDisp = after.disposition === expectRegister;
  const okLock = after.locked === expectLock;
  check(
    `visit "${visitDisposition}" → register "${expectRegister}" (locked=${expectLock})`,
    okDisp && okLock,
    `got disposition="${after.disposition}", locked=${after.locked}, dispAt=${after.dispositionAt ? "set" : "null"}`,
  );
  await EmergencyRegister.deleteOne({ _id: row._id });
}

(async () => {
  await mongoose.connect(MONGO_URI);
  console.log("[probe] connected\n");

  // The two legally-critical exits that were silently dropped before the fix:
  await run("Expired", "Death", true);
  await run("Left Against Medical Advice", "DAMA", true);
  // Pass-through values that already matched must still work:
  await run("Discharged", "Discharged", true);
  await run("Admitted", "Admitted", true);
  await run("Referred", "Referred", true);
  await run("Absconded", "Absconded", true);
  await run("Observation", "Observation", true);
  // A non-terminal / unknown value must NOT lock the register (stays "", unlocked):
  await run("Pending", "", false);

  console.log(`\n${"─".repeat(52)}\nER disposition fix probe: ${pass}/${pass + fail} checks passed`);
  await mongoose.disconnect();
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error("[probe] error:", e); process.exit(1); });
