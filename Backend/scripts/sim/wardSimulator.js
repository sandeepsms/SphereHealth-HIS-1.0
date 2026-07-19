/**
 * scripts/sim/wardSimulator.js — hour-driven 5-day IPD ward activity simulator.
 *
 * Generates realistic "auto-tasks" for 2 IPD patients so something happens every
 * hour, like a real ward: doctor rounds (morning daily + evening alternate-day +
 * one afternoon emergency visit), nursing (vitals ×8/day, morning+evening notes,
 * order fulfilment: labs / nursing orders / blood transfusion, procedure notes
 * every 3rd day, bed-cleaning workflow), and reception billing (cash advance +
 * receipt, more advance, interim settlement from advance, final settlement).
 *
 * Timeline: simHour 0..119 (5 days × 24h). Each patient's events are a pure
 * function of (simDay, hourOfDay), so runs are deterministic + resumable.
 *
 *   node scripts/sim/wardSimulator.js --setup            # create 2 IPD patients
 *   node scripts/sim/wardSimulator.js --backfill         # run all 120 hours now
 *   node scripts/sim/wardSimulator.js --hour 8           # run just sim-hour 8
 *   node scripts/sim/wardSimulator.js --status           # show state + tallies
 *
 * State persists to the scratchpad so an hourly cron/loop can tick forward.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { call, D } = require("../_e2e_lib");

const STATE_FILE = path.join(
  process.env.SIM_STATE_DIR ||
  "C:/Users/Sandeep/AppData/Local/Temp/claude/D---claude/7b9bc577-1e33-4401-93ba-f8ed41efe717/scratchpad",
  "ward_sim_state.json",
);
const SIG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const HOURS = 120;                 // 5 days
const BASE = "2026-07-14";         // sim day-0 calendar date (back-date vitalsheet)
const pick = (a, ...k) => (Array.isArray(a) ? a : (k.map(x => a?.[x]).find(Array.isArray) || []));
const dateFor = (day) => { const d = new Date(BASE + "T00:00:00"); d.setDate(d.getDate() + day); return d.toISOString().slice(0, 10); };
const hhmm = (h) => `${String(h).padStart(2, "0")}:00`;

const load = () => { try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch { return null; } };
const save = (s) => fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
const tally = {};
const bugs = [];
const rec = (ok, label, detail) => {
  tally[label] = tally[label] || { ok: 0, fail: 0 };
  ok ? tally[label].ok++ : tally[label].fail++;
  if (!ok) bugs.push(`${label}: ${detail}`);
};

// ───────────────────────── SETUP ─────────────────────────
async function setup() {
  const docs = D(await call("admin", "GET", "/doctors?limit=3"));
  const doctor = docs[0]; const dn = doctor.personalInfo?.fullName || "Physician";
  const consultant = /^dr/i.test(dn) ? dn : `Dr. ${dn}`;
  const beds = pick(D(await call("admin", "GET", "/bedss/available")), "beds", "data");
  const depts = pick(D(await call("admin", "GET", "/department")), "departments", "data");
  const dept = depts.find(d => /medicine|general|gastro/i.test(d.departmentName)) || depts[0];

  const profiles = [
    { name: "Ramesh Gupta", age: 45, sex: "Male", dx: "Acute Gastroenteritis with moderate dehydration", phone: "9833100001", bg: "B+" },
    { name: "Sunita Devi", age: 52, sex: "Female", dx: "Anemia with upper GI bleed for evaluation", phone: "9833100002", bg: "O+" },
  ];
  const patients = [];
  for (let i = 0; i < profiles.length; i++) {
    const pr = profiles[i];
    const p = D(await call("reception", "POST", "/patients", { registrationType: "IPD", title: pr.sex === "Male" ? "Mr." : "Mrs.", fullName: pr.name, gender: pr.sex, age: pr.age, contactNumber: pr.phone, bloodGroup: pr.bg, paymentType: "Cash", forceCreate: true }));
    const adm = D(await call("reception", "POST", "/admissions", { UHID: p.UHID, bedId: beds[i]._id, admissionType: "Planned", department: dept.departmentName, departmentId: dept._id, attendingDoctor: consultant, attendingDoctorId: doctor._id, reasonForAdmission: pr.dx, provisionalDiagnosis: pr.dx, expectedStayDays: 5 }));
    patients.push({ UHID: p.UHID, pid: p._id, aid: adm._id, ipd: adm.admissionNumber, name: pr.name, dx: pr.dx, bed: adm.bedNumber, ward: adm.wardName, consultant, doctorId: doctor._id, orders: {}, billId: null, advanceIds: [], vitalsByDay: {} });
    console.log(`  admitted ${p.UHID} ${pr.name} → ${adm.admissionNumber} | bed ${adm.bedNumber} | ${pr.dx}`);
  }
  const state = { startedAt: new Date().toISOString(), lastHour: -1, patients };
  save(state);
  console.log(`\nSetup done. 2 IPD patients ready. State → ${STATE_FILE}`);
  return state;
}

// ───────────────────────── ACTIVITIES ─────────────────────────
async function actVitals(pt, day, hod) {
  const date = dateFor(day);
  pt.vitalsByDay[date] = pt.vitalsByDay[date] || [];
  const jitter = (b, r) => Math.round(b + (Math.random() * r - r / 2));
  // values must be numeric (the tableData embedded cast rejects a "118/76" string) — split BP into Systolic/Diastolic.
  pt.vitalsByDay[date].push({ time: hhmm(hod), values: {
    Pulse: { value: jitter(88, 16), unit: "bpm" }, Systolic: { value: jitter(118, 14), unit: "mmHg" }, Diastolic: { value: jitter(76, 8), unit: "mmHg" },
    Temperature: { value: Number((98 + Math.random() * 2.4).toFixed(1)), unit: "°F" }, RR: { value: jitter(18, 4), unit: "/min" }, SpO2: { value: jitter(97, 3), unit: "%" },
  } });
  const r = await call("nurse", "POST", "/vitalsheet", { uhid: pt.UHID, date, admissionId: pt.aid,
    activeVitals: [{ name: "Pulse", unit: "bpm" }, { name: "Systolic", unit: "mmHg" }, { name: "Diastolic", unit: "mmHg" }, { name: "Temperature", unit: "°F" }, { name: "RR", unit: "/min" }, { name: "SpO2", unit: "%" }],
    tableData: pt.vitalsByDay[date] });
  rec(r.status < 300, "vitals(nurse ×8/day)", `${r.status} ${JSON.stringify(r.data).slice(0, 80)}`);
}

async function actDoctorNote(pt, day, hod, kind) {
  // kind: "morning" | "evening" | "emergency"
  const label = kind === "emergency" ? "EMERGENCY afternoon visit" : `${kind} round`;
  const noteType = kind === "emergency" ? "emergency" : "daily";
  const body = {
    patient: pt.pid, patientUHID: pt.UHID, patientName: pt.name, ipdNo: pt.ipd, admissionId: pt.aid,
    visitType: "IPD", noteType, visitDate: `${dateFor(day)}T${hhmm(hod)}:00`, doctorName: pt.consultant,
    // back-dated to the simulated day → NABH HIC.6 requires a late-entry reason.
    lateEntryReason: `Retrospective ward documentation — Day ${day + 1} ${kind} round`,
    noteDetails: {
      subjective: { text: `Day ${day + 1} ${label} (${hhmm(hod)}). ${kind === "emergency" ? "Called for sudden vomiting + giddiness." : "Patient reviewed on round."}` },
      objective: { text: `Afebrile-to-low-grade, hemodynamically stable, hydration improving. Chest clear, P/A soft.` },
      assessment: { text: `${pt.dx} — ${kind === "emergency" ? "acute symptom, likely orthostatic; reassess." : "responding to treatment."}` },
      plan: { text: kind === "emergency" ? "IV bolus 250 ml, antiemetic stat, recheck vitals in 1h." : "Continue IV fluids, antiemetic, monitor I/O; step-down as tolerated." },
    },
  };
  const c = await call("doctor", "POST", "/doctor-notes", body);
  const note = D(c);
  let signed = false;
  if (note?._id) {
    const s = await call("doctor", "PATCH", `/doctor-notes/${note._id}/sign`, { signature: SIG, signedByName: pt.consultant, signedByReg: "NMC-MP-45123" });
    signed = s.status < 300;
  }
  rec(c.status < 300 && signed, `doctor ${kind === "emergency" ? "emergency visit" : "round note"}`, `create=${c.status} sign=${signed}`);
}

async function actNurseNote(pt, day, hod, shift) {
  const r = await call("nurse", "POST", "/nurse-notes", { UHID: pt.UHID, ipdNo: pt.ipd, admissionId: pt.aid, shift,
    generalCondition: `Day ${day + 1} ${shift} — stable, cooperative`, nursingCare: "Vitals monitored, IV site patent, oral/perineal hygiene done, I/O charted", remarks: "Patient comfortable, no fresh complaints", noteType: "general" });
  rec(r.status < 300, `nurse ${shift} note`, `${r.status}`);
}

async function actCreateOrders(pt) {
  const base = { patientId: pt.pid, UHID: pt.UHID, patientName: pt.name, admissionId: pt.aid, ipdNo: pt.ipd, visitType: "IPD", orderedBy: pt.consultant };
  const lab = await call("doctor", "POST", "/doctor-orders", { ...base, orderType: "Lab", priority: "Routine", orderDetails: { testName: "Serum Electrolytes + RFT" } });
  const nurse = await call("doctor", "POST", "/doctor-orders", { ...base, orderType: "Nursing", priority: "Routine", orderDetails: { instruction: "Strict intake/output charting", frequency: "Q6H" } });
  pt.orders.labId = D(lab)?._id; pt.orders.nurseOrderId = D(nurse)?._id;
  rec(lab.status < 300, "doctor order: Lab", `${lab.status}`);
  rec(nurse.status < 300, "doctor order: Nursing", `${nurse.status}`);
  // investigation order (structured lab that nursing fulfils)
  const invs = pick(D(await call("admin", "GET", "/investigations?limit=50&isActive=true")), "data");
  const elyte = invs.find(i => /Electrolyte/i.test(i.investigationName)) || invs[0];
  if (elyte) {
    const io = await call("doctor", "POST", "/investigation-orders", { patientId: pt.pid, UHID: pt.UHID, patientName: pt.name, visitType: "IPD", admissionId: pt.aid, items: [{ investigationId: elyte._id, performedAt: "INTERNAL" }] });
    pt.orders.invOrderId = D(io)?._id; pt.orders.invItemId = D(io)?.items?.[0]?._id;
    rec(io.status < 300, "investigation order (lab)", `${io.status}`);
  }
}

async function actFulfillLab(pt) {
  const id = pt.orders.invOrderId; if (!id) return;
  const col = await call("lab", "POST", `/investigation-orders/${id}/collect-sample`, { collectedBy: "Lab Tech" });
  const ent = await call("lab", "POST", `/investigation-orders/${id}/enter-results`, { enteredBy: "Lab Tech", itemResults: [{ itemId: pt.orders.invItemId, analyser: "Cobas c311", results: [{ parameterName: "Sodium", value: "138", unit: "mmol/L" }, { parameterName: "Potassium", value: "3.9", unit: "mmol/L" }] }] });
  const ver = await call("doctor", "POST", `/investigation-orders/${id}/verify`, { verifiedBy: pt.consultant });
  rec(col.status < 300 && ent.status < 300 && ver.status < 300, "nurse fulfils lab (collect→result→verify)", `collect=${col.status} enter=${ent.status} verify=${ver.status}`);
}

async function actNursingOrderExec(pt) {
  const id = pt.orders.nurseOrderId; if (!id) return;
  const r = await call("nurse", "POST", `/doctor-orders/${id}/step`, { step: "Executed — I/O charting initiated q6h", doneBy: "Sister Anita" });
  rec(r.status < 300, "nurse executes nursing order", `${r.status} ${r.status >= 300 ? JSON.stringify(r.data).slice(0, 70) : ""}`);
}

async function actBloodTransfusion(pt) {
  const bt = await call("doctor", "POST", "/registers/nabh/blood-transfusion", {
    patient: { _id: pt.pid, UHID: pt.UHID, fullName: pt.name }, admission: { _id: pt.aid, admissionNumber: pt.ipd },
    order: { component: "PRBC", units: 1, bloodGroup: "O+", indication: "Symptomatic anemia (Hb 6.8)", orderedBy: pt.consultant } });
  const id = D(bt)?._id; pt.orders.btId = id;
  let cm = { status: 0 }, st = { status: 0 }, iv = { status: 0 }, cp = { status: 0 };
  if (id) {
    // BT sub-steps are PATCH + gated to Admin/Doctor (doctor-orders.write) in this HIS.
    cm = await call("doctor", "PATCH", `/registers/nabh/blood-transfusion/${id}/cross-match`, { bagNumber: "BAG-77123", crossMatchBy: "Blood Bank", compatible: true });
    st = await call("doctor", "PATCH", `/registers/nabh/blood-transfusion/${id}/start`, { startedBy: "Sister Anita", witnessedBy: "Staff Nurse 2", startVitals: { bp: "120/78", pulse: "88", temp: "98.4" } });
    iv = await call("doctor", "PATCH", `/registers/nabh/blood-transfusion/${id}/intra-vitals`, { time: "15min", bp: "122/80", pulse: "86", temp: "98.6", observation: "No reaction" });
    cp = await call("doctor", "PATCH", `/registers/nabh/blood-transfusion/${id}/complete`, { completedBy: "Sister Anita", endVitals: { bp: "124/80", pulse: "84", temp: "98.5" }, outcome: "Completed uneventfully" });
  }
  rec(bt.status < 300 && cp.status < 300, "blood transfusion (order→crossmatch→start→monitor→complete)", `order=${bt.status} xm=${cm.status} start=${st.status} monitor=${iv.status} complete=${cp.status}`);
}

async function actProcedureNote(pt, day) {
  const c = await call("doctor", "POST", "/doctor-notes", {
    patient: pt.pid, patientUHID: pt.UHID, patientName: pt.name, ipdNo: pt.ipd, admissionId: pt.aid, visitType: "IPD",
    noteType: "procedure", visitDate: `${dateFor(day)}T16:00:00`, doctorName: pt.consultant,
    lateEntryReason: `Retrospective procedure documentation — Day ${day + 1}`,
    noteDetails: { procedure: { text: `Day ${day + 1}: peripheral venous access re-sited + extra sample drawn (blood culture ×2, stool sample) under aseptic precautions. No immediate complication.` } } });
  const note = D(c); let signed = false;
  if (note?._id) { const s = await call("doctor", "PATCH", `/doctor-notes/${note._id}/sign`, { signature: SIG, signedByName: pt.consultant, signedByReg: "NMC-MP-45123" }); signed = s.status < 300; }
  rec(c.status < 300 && signed, "procedure note (/3 days)", `create=${c.status} sign=${signed}`);
}

async function actBedCleaning(pt) {
  const t = await call("nurse", "POST", "/housekeeping/tasks", { title: `Bed cleaning — ${pt.bed} (post-soiling)`, type: "bed-turnover", priority: "normal", ward: pt.ward, bedNumber: pt.bed, admissionId: pt.aid, description: "Diarrhoeal soiling — clean + disinfect bed & side rails", requestedBy: "Sister Anita" });
  const id = D(t)?._id;
  let ac = { status: 0 }, st = { status: 0 }, cp = { status: 0 };
  if (id) {
    ac = await call("housekeeping", "PATCH", `/housekeeping/tasks/${id}/accept`, { acceptedBy: "HK Ramu" });
    st = await call("housekeeping", "PATCH", `/housekeeping/tasks/${id}/start`, {});
    cp = await call("housekeeping", "PATCH", `/housekeeping/tasks/${id}/complete`, { completedBy: "HK Ramu", remarks: "Cleaned + terminal disinfection done" });
  }
  rec(t.status < 300 && cp.status < 300, "bed-cleaning (nurse raise→HK accept→process)", `raise=${t.status} accept=${ac.status} start=${st.status} complete=${cp.status}`);
}

async function actReceptionAdvance(pt, amount, mode) {
  const a = await call("reception", "POST", "/billing/advance", { UHID: pt.UHID, amount, mode, paymentMode: mode });
  const id = D(a)?._id; if (id) pt.advanceIds.push(id);
  rec(a.status < 300, `reception advance deposit (${mode} ₹${amount}) + receipt`, `${a.status} receipt=${D(a)?.receiptNumber || "?"}`);
}

async function ensureBill(pt) {
  if (pt.billId) return pt.billId;
  const led = D(await call("reception", "GET", `/billing/ipd/${pt.aid}/ledger`));
  pt.billId = led?.bill?._id || null;
  return pt.billId;
}

async function actInterimSettle(pt) {
  const billId = await ensureBill(pt);
  if (!billId || !pt.advanceIds.length) { rec(false, "reception interim settle (from advance)", "no bill/advance"); return; }
  const bill = D(await call("reception", "GET", `/billing/${billId}`));
  const bal = Number(bill?.balanceAmount?.$numberDecimal ?? bill?.balanceAmount ?? 0);
  const amt = Math.min(3000, Math.round(bal));
  if (amt <= 0) { rec(true, "reception interim settle (advance→bill)", `balance ₹0 — nothing to settle yet (advance held)`); return; }
  const r = await call("reception", "POST", `/billing/advance/${pt.advanceIds[0]}/apply`, { billId, amount: amt });
  rec(r.status < 300, "reception interim settle (advance→bill)", `applied ₹${amt} → ${r.status} ${r.status >= 300 ? JSON.stringify(r.data).slice(0, 70) : ""}`);
}

async function actFinalSettle(pt) {
  const billId = await ensureBill(pt);
  if (!billId) { rec(false, "reception FINAL settlement (advance-first then other)", "no bill"); return; }
  // apply any remaining advance first
  for (const advId of pt.advanceIds) {
    await call("reception", "POST", `/billing/advance/${advId}/apply`, { billId }).catch(() => {});
  }
  const bill = D(await call("reception", "GET", `/billing/${billId}`));
  const bal = Number(bill?.balanceAmount?.$numberDecimal ?? bill?.balanceAmount ?? 0);
  let pay = { status: 200 };
  if (bal > 0.5) pay = await call("reception", "POST", `/billing/${billId}/payment`, { amount: bal, paymentMode: "UPI", transactionId: `UPI-FINAL-${pt.UHID}`, remarks: "Final settlement — balance after advance" });
  rec(pay.status < 300, "reception FINAL settlement (advance-first then UPI)", `remainingBalance=₹${bal} pay=${pay.status}`);
}

// ───────────────────────── TIMELINE ─────────────────────────
async function runHour(pt, h) {
  const day = Math.floor(h / 24), hod = h % 24;
  if ([0, 3, 6, 9, 12, 15, 18, 21].includes(hod)) await actVitals(pt, day, hod);   // 8/day
  if (hod === 7)  await actNurseNote(pt, day, hod, "morning");
  if (hod === 19) await actNurseNote(pt, day, hod, "evening");
  if (hod === 8)  await actDoctorNote(pt, day, hod, "morning");                     // morning round daily
  if (hod === 18 && day % 2 === 0) await actDoctorNote(pt, day, hod, "evening");    // evening round alternate-day
  if (day === 1 && hod === 14) await actDoctorNote(pt, day, hod, "emergency");      // one afternoon emergency visit
  if (day === 0 && hod === 10) await actCreateOrders(pt);
  if (day === 0 && hod === 13) { await actFulfillLab(pt); await actNursingOrderExec(pt); }
  if (day === 1 && hod === 9)  await actBedCleaning(pt);
  if (day === 1 && hod === 11 && /anemia|bleed/i.test(pt.dx)) await actBloodTransfusion(pt); // BT only for the anemia patient
  if ((day === 0 || day === 3) && hod === 16) await actProcedureNote(pt, day);      // procedure note /3 days
  if (day === 0 && hod === 11) await actReceptionAdvance(pt, 5000, "CASH");
  if (day === 2 && hod === 11) await actReceptionAdvance(pt, 5000, "CARD");
  if (day === 2 && hod === 17) await actInterimSettle(pt);
  if (day === 4 && hod === 15) await actFinalSettle(pt);
}

// ───────────────────────── RUNNER ─────────────────────────
(async () => {
  const arg = process.argv.slice(2);
  const has = (f) => arg.includes(f);
  const valOf = (f) => { const i = arg.indexOf(f); return i >= 0 ? Number(arg[i + 1]) : null; };

  if (has("--setup")) { await setup(); return; }

  let state = load();
  if (!state) { console.log("No state — running --setup first."); state = await setup(); }

  if (has("--status")) {
    console.log("patients:", state.patients.map(p => `${p.UHID}(${p.ipd}, ${p.dx.slice(0, 28)})`).join(" | "));
    console.log("lastHour:", state.lastHour);
    return;
  }

  const start = has("--hour") ? valOf("--hour") : (state.lastHour + 1);
  const end = has("--backfill") ? (valOf("--backfill") || HOURS - 1) : (has("--hour") ? valOf("--hour") : (state.lastHour + 1));

  console.log(`Running sim hours ${start}..${end} for ${state.patients.length} patients…\n`);
  for (let h = start; h <= end; h++) {
    for (const pt of state.patients) await runHour(pt, h);
    state.lastHour = h;
  }
  save(state);

  console.log("\n──────── ACTIVITY TALLY (both patients) ────────");
  for (const [k, v] of Object.entries(tally).sort()) console.log(`  ${v.fail ? "⚠️ " : "✅ "}${k.padEnd(52)} ok=${v.ok} fail=${v.fail}`);
  console.log(`\n  total events: ${Object.values(tally).reduce((a, b) => a + b.ok + b.fail, 0)} | failures: ${bugs.length}`);
  if (bugs.length) { console.log("\n──────── FAILURES / CANDIDATE BUGS ────────"); bugs.slice(0, 20).forEach(b => console.log("  •", b)); }
})().catch(e => console.log("FATAL", e.message, e.stack?.split("\n")[1]));
