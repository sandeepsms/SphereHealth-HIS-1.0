/**
 * R7hr-90 verifier — confirms the one-IA-per-admission constraint via
 * paired POSTs (1st succeeds, 2nd 409s) for BOTH doctor + nurse paths.
 *
 * Run:
 *   HIS_TOKEN=<token> node Backend/scripts/verifyIaUniqueness.js
 *
 * Exit code 0 on PASS, 1 on FAIL.
 *
 * Idempotency: if step 3's IA already exists from a prior run, the
 * verifier treats it as "first-IA-already-present" and still validates
 * the 409 from the second POST — so re-running this script after a
 * deploy is safe.
 */

const BASE = process.env.HIS_BASE_URL || "http://localhost:5050/api";
const TOKEN = process.env.HIS_TOKEN;

if (!TOKEN) {
  console.error("Missing HIS_TOKEN. Run with: HIS_TOKEN=<jwt> node Backend/scripts/verifyIaUniqueness.js");
  process.exit(1);
}

const h = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };
const log = (...a) => console.log(...a);

async function jsonOrText(r) {
  const t = await r.text();
  try { return JSON.parse(t); } catch { return t; }
}

async function get(path) {
  const r = await fetch(`${BASE}${path}`, { headers: h });
  return { status: r.status, body: await jsonOrText(r) };
}

async function post(path, body) {
  const r = await fetch(`${BASE}${path}`, { method: "POST", headers: h, body: JSON.stringify(body) });
  return { status: r.status, body: await jsonOrText(r) };
}

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  log(`  ${ok ? "✓ PASS" : "✗ FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}

(async () => {
  log("\nR7hr-90 verifier — one-IA-per-admission contract\n");

  // Step 1 — pick an active admission
  const admReq = await get("/admissions/active");
  const admList = admReq.body?.data || admReq.body || [];
  if (admReq.status !== 200 || !admList?.length) {
    log("Could not pull active admissions. status=", admReq.status);
    process.exit(1);
  }
  const adm = admList[0];
  log(`  Active admission picked: UHID=${adm.UHID} ipdNo=${adm.admissionNumber || adm.ipdNo} _id=${adm._id}\n`);

  const docBody = {
    UHID: adm.UHID, patientUHID: adm.UHID,
    ipdNo: adm.admissionNumber || adm.ipdNo,
    admissionId: adm._id,
    noteType: "initial",
    provisionalDiagnosis: "R7hr-90 verifier test",
    status: "signed",
  };
  const nurseBody = {
    UHID: adm.UHID, patientUHID: adm.UHID,
    ipdNo: adm.admissionNumber || adm.ipdNo,
    admissionId: adm._id,
    noteType: "initial",
    vitals: { temp: 98.6 },
    status: "submitted",
  };

  // Step 2 — Doctor IA POST #1
  log("Doctor IA — POST #1");
  const dr1 = await post("/doctor-notes", docBody);
  const drFirstAlreadyExisted = dr1.status === 409 && dr1.body?.code === "DUPLICATE_INITIAL_ASSESSMENT";
  if (drFirstAlreadyExisted) {
    log("    (a Doctor IA already exists for this admission — proceeding to verify the 2nd-POST 409)");
    check("Doctor IA #1 — pre-existing (idempotent)", true);
  } else {
    check("Doctor IA #1 — POST 201/200", [200, 201].includes(dr1.status), `status=${dr1.status} body=${JSON.stringify(dr1.body).slice(0, 200)}`);
  }

  // Step 3 — Doctor IA POST #2 (should 409)
  log("Doctor IA — POST #2 (expect 409)");
  const dr2 = await post("/doctor-notes", docBody);
  check("Doctor IA #2 — 409 DUPLICATE_INITIAL_ASSESSMENT",
    dr2.status === 409 && dr2.body?.code === "DUPLICATE_INITIAL_ASSESSMENT",
    `status=${dr2.status} code=${dr2.body?.code}`);

  if (dr2.body?.existing?._id) {
    check("Doctor IA #2 — existing._id payload present", true, `existing=${dr2.body.existing._id}`);
  } else {
    check("Doctor IA #2 — existing._id payload present", false, "missing existing._id in 409 body");
  }

  // Step 4 — Nurse IA POST #1
  log("\nNurse IA — POST #1");
  const nr1 = await post("/nurse-notes", nurseBody);
  const nrFirstAlreadyExisted = nr1.status === 409 && nr1.body?.code === "DUPLICATE_INITIAL_ASSESSMENT";
  if (nrFirstAlreadyExisted) {
    log("    (a Nurse IA already exists for this admission — proceeding to verify the 2nd-POST 409)");
    check("Nurse IA #1 — pre-existing (idempotent)", true);
  } else {
    check("Nurse IA #1 — POST 201/200", [200, 201].includes(nr1.status), `status=${nr1.status} body=${JSON.stringify(nr1.body).slice(0, 200)}`);
  }

  // Step 5 — Nurse IA POST #2 (should 409)
  log("Nurse IA — POST #2 (expect 409)");
  const nr2 = await post("/nurse-notes", nurseBody);
  check("Nurse IA #2 — 409 DUPLICATE_INITIAL_ASSESSMENT",
    nr2.status === 409 && nr2.body?.code === "DUPLICATE_INITIAL_ASSESSMENT",
    `status=${nr2.status} code=${nr2.body?.code}`);

  if (nr2.body?.existing?._id) {
    check("Nurse IA #2 — existing._id payload present", true, `existing=${nr2.body.existing._id}`);
  } else {
    check("Nurse IA #2 — existing._id payload present", false, "missing existing._id in 409 body");
  }

  // Final scoreboard
  const passed = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;
  log(`\n────  SCOREBOARD: ${passed} passed / ${failed} failed  ────`);
  if (failed) {
    log("FAIL");
    process.exit(1);
  } else {
    log("PASS");
    process.exit(0);
  }
})().catch(err => {
  console.error("[verifyIaUniqueness] FATAL:", err);
  process.exit(1);
});
