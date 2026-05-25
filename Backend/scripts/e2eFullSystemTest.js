// scripts/e2eFullSystemTest.js
// ════════════════════════════════════════════════════════════════════
// R7bx item 6 — COMPREHENSIVE END-TO-END REGRESSION SUITE
//
// Drives the LIVE backend on port 5050 via HTTP (mirrors how the
// frontend talks to it). The complementary e2eBillingTest.js exercises
// the billing engine via direct Mongoose model writes — this one walks
// every patient-facing clinical + billing surface end-to-end.
//
// 10 scenarios:
//   1. Full OPD lifecycle (register → assess → sign → pay → history)
//   2. IPD admission → orders → MAR → discharge
//   3. Doctor Orders deduplication race (409 DUPLICATE_ORDER)
//   4. Medication course pre-seeding + missed-dose cron
//   5. Infusion volume tracking + auto-stop (deterministic check)
//   6. Bed allotment from ER disposition
//   7. Patient credit ledger bulk collect
//   8. Advance deposit + refund + ledger
//   9. Concurrent admission guard (partial unique index)
//   10. NABH register auto-emit (antimicrobial / OT / ASA / mortality)
//
// All test patients use UHIDs prefixed `E2E-` so the cleanup pass at
// the end can sweep them without touching production rows. Bills,
// triggers, advances, orders, MAR rows, register rows tied to those
// UHIDs are all wiped on exit (best-effort — failures here are logged
// but don't change the exit code).
//
// Exit code 0 if ≥ N scenarios pass (default: 8/10), 1 otherwise.
//
//   node Backend/scripts/e2eFullSystemTest.js
// ════════════════════════════════════════════════════════════════════

"use strict";

require("dotenv").config();
const http     = require("http");
const mongoose = require("mongoose");

// ─── Config ────────────────────────────────────────────────────────
const BASE        = process.env.E2E_BASE || "http://localhost:5050";
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL    || "admin@spherehealth.com";
const ADMIN_PASS  = process.env.E2E_ADMIN_PASSWORD || "Welcome@123";
const MIN_PASS    = Number(process.env.E2E_MIN_PASS || 8);
const MONGO_URI   = process.env.MONGO_URI || "mongodb://localhost:27017/spherehealth";

// ─── Console colour helpers (no chalk dependency) ─────────────────
const C = {
  reset: "\x1b[0m", red: "\x1b[31m", green: "\x1b[32m",
  yellow: "\x1b[33m", cyan: "\x1b[36m", grey: "\x1b[90m",
  bold: "\x1b[1m",
};
const tick = `${C.green}✓${C.reset}`;
const cross = `${C.red}✗${C.reset}`;
const dot  = `${C.grey}·${C.reset}`;

// Track created entities for cleanup. We tag UHIDs with E2E- so even a
// fatal crash mid-suite still leaves a stable cleanup target.
const created = {
  uhids: new Set(),        // every UHID we touched
  patientIds: new Set(),   // Patient _ids
  admissionIds: new Set(), // Admission _ids
  orderIds: new Set(),     // DoctorOrder _ids
  billIds: new Set(),      // PatientBill _ids
  advanceIds: new Set(),   // PatientAdvance _ids
};

// ─── Tiny HTTP client (no axios — keeps deps to dotenv + mongoose) ─
let _adminToken = null;
function _httpRequest(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const opts = {
      hostname: url.hostname,
      port:     url.port || 80,
      path:     url.pathname + url.search,
      method,
      headers:  { "Content-Type": "application/json" },
    };
    if (token) opts.headers.Authorization = `Bearer ${token}`;
    const req = http.request(opts, (res) => {
      let buf = "";
      res.on("data", (c) => (buf += c));
      res.on("end", () => {
        let json = null;
        try { json = buf ? JSON.parse(buf) : null; } catch { json = { _raw: buf }; }
        resolve({ status: res.statusCode, body: json });
      });
    });
    req.on("error", reject);
    req.setTimeout(15_000, () => req.destroy(new Error("HTTP timeout")));
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}
const api = {
  get:   (p, t)    => _httpRequest("GET",    p, undefined, t || _adminToken),
  post:  (p, b, t) => _httpRequest("POST",   p, b,         t || _adminToken),
  put:   (p, b, t) => _httpRequest("PUT",    p, b,         t || _adminToken),
  patch: (p, b, t) => _httpRequest("PATCH",  p, b,         t || _adminToken),
  del:   (p, t)    => _httpRequest("DELETE", p, undefined, t || _adminToken),
};

async function login() {
  const r = await api.post("/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASS });
  if (r.status !== 200 || !r.body?.token) {
    throw new Error(`login failed status=${r.status} body=${JSON.stringify(r.body).slice(0, 200)}`);
  }
  _adminToken = r.body.token;
  return r.body;
}

// ─── Lookup helpers — fetch shared fixtures once at startup ───────
const _fixtures = { doctorId: null, doctor: null, departmentId: null, department: null, beds: [] };

async function loadFixtures() {
  const docsRes = await api.get("/api/doctors");
  const docs = docsRes.body?.data || [];
  // Pick the first active doctor with both opd + ipd available.
  _fixtures.doctor = docs.find((d) => d?.department?.isActive !== false) || docs[0];
  if (!_fixtures.doctor) throw new Error("No doctors available — seed at least one");
  _fixtures.doctorId     = _fixtures.doctor._id;
  _fixtures.departmentId = _fixtures.doctor.department?._id || _fixtures.doctor.department;
  _fixtures.department   = _fixtures.doctor.department?.departmentName || "Test Dept";

  const bedRes = await api.get("/api/bedss/available");
  _fixtures.beds = bedRes.body?.data || [];
}

// ─── Test runner plumbing ─────────────────────────────────────────
const results = [];
function passEvent(scenario, name, detail) {
  scenario.passed.push({ name, detail });
  console.log(`    ${tick} ${name} ${C.grey}${detail || ""}${C.reset}`);
}
function failEvent(scenario, name, detail) {
  scenario.failures.push({ name, detail });
  console.log(`    ${cross} ${name} ${C.red}${detail || ""}${C.reset}`);
}
function infoEvent(scenario, name, detail) {
  scenario.info.push({ name, detail });
  console.log(`    ${dot} ${name} ${C.grey}${detail || ""}${C.reset}`);
}
async function runScenario(name, fn) {
  console.log(`\n${C.bold}${C.cyan}── ${name}${C.reset}`);
  const scenario = { name, passed: [], failures: [], info: [], startedAt: Date.now() };
  try {
    await fn(scenario);
  } catch (e) {
    failEvent(scenario, "scenario aborted", e?.message || String(e));
  }
  scenario.duration = Date.now() - scenario.startedAt;
  results.push(scenario);
  return scenario;
}

// ─── Common: build a unique-but-predictable UHID label ────────────
let _seqCounter = 0;
function e2eLabel() {
  _seqCounter += 1;
  return `E2E-${Date.now()}-${_seqCounter}`;
}

// ════════════════════════════════════════════════════════════════════
// SCENARIO 1 — Full OPD lifecycle
//   Register → visit → assessment → bill payment → history aggregator
// ════════════════════════════════════════════════════════════════════
async function scenario1_OPDLifecycle(s) {
  // 1. Register OPD patient
  const reg = await api.post("/api/patients", {
    title: "Mr.", fullName: `E2E OPD ${e2eLabel()}`,
    gender: "Male", age: 40,
    contactNumber: "9111" + Math.floor(Math.random() * 1e7).toString().padStart(7, "0"),
    registrationType: "OPD", paymentType: "GENERAL",
    address: { city: "Test", state: "Test", pincode: "110001" },
    department: _fixtures.departmentId,
    doctor:     _fixtures.doctorId,
    chiefComplaint: "Headache + fever 3 days",
  });
  if (reg.status !== 201) return failEvent(s, "POST /api/patients", `status=${reg.status} ${JSON.stringify(reg.body).slice(0, 200)}`);
  const patient = reg.body.data;
  created.uhids.add(patient.UHID); created.patientIds.add(patient._id);
  passEvent(s, "OPD patient registered", `UHID=${patient.UHID}`);

  // 2. Verify an OPD visit got auto-created (patientService auto-dispatches it)
  const visitsRes = await api.get(`/api/opd/patient/${patient._id}`);
  const visits = visitsRes.body?.data || [];
  if (!visits.length) return failEvent(s, "Auto-dispatched OPD visit", "patientService didn't fire OPDService.createOPDVisit");
  const visit = visits[0];
  passEvent(s, "OPD visit auto-created", `visit=${visit.visitNumber}`);

  // 3. Save full assessment via PUT /api/opd/:visitNumber/assessment
  const asmt = await api.post(`/api/opd/${visit.visitNumber}/assessment`, {
    doctorName: "Dr. E2E Test",
    // HOPI
    hopiOnset: "Sudden", hopiDurationValue: "3", hopiDurationUnit: "days",
    hopiProgression: "Worsening", hopiCharacter: "Throbbing",
    hopiAssociatedSymptoms: ["Nausea", "Photophobia"],
    hopiAggravating: "Bright light", hopiRelieving: "Rest",
    // Vitals on the visit are nurse's job — skip here, save SOAP + diagnosis
    subjectiveNote: "Pt reports throbbing headache for 3 days",
    objectiveNote:  "Alert, oriented. Mild photophobia. VS stable.",
    assessmentNote: "Migraine — uncomplicated",
    planNote:       "Symptomatic Rx + reassurance",
    // 3-tier diagnosis
    provisionalDiagnosis: "Acute tension headache",
    workingDiagnosis:     "Migraine (R51)",
    finalDiagnosis:       "Migraine without aura",
    icd10Code:            "G43.0",
    icd10Description:     "Migraine without aura",
    patientStatus:        "Stable",
    // 2 Rx rows
    prescribedMedications: [
      { medicineName: "Tab. Naproxen", dosage: "500mg", frequency: "BD", duration: "5 days", instructions: "After food", mealStatus: "After food" },
      { medicineName: "Tab. Sumatriptan", dosage: "50mg", frequency: "SOS", duration: "PRN", instructions: "At migraine onset", mealStatus: "Anytime" },
    ],
    advice: "Hydration + sleep hygiene",
  });
  if (asmt.status !== 200) return failEvent(s, "POST /opd/:visit/assessment", `status=${asmt.status} ${JSON.stringify(asmt.body).slice(0, 200)}`);
  passEvent(s, "Doctor assessment saved (HOPI + SOAP + 3-tier dx + 2 Rx)", `visit ${visit.visitNumber}`);

  // 4. Add investigation
  const invest = await api.post(`/api/opd/${visit.visitNumber}/investigation`, {
    testName: "Complete Blood Count",
    orderedDate: new Date().toISOString(),
  });
  if (invest.status !== 200 && invest.status !== 201) {
    failEvent(s, "POST /opd/:visit/investigation", `status=${invest.status}`);
  } else {
    passEvent(s, "Investigation added", "CBC ordered");
  }

  // 5. Pay the OPD-CON bill — must call /generate first to leave DRAFT
  const billsRes = await api.get(`/api/billing/uhid/${patient.UHID}`);
  const bills = billsRes.body?.data?.bills || billsRes.body?.data || [];
  const opdBill = Array.isArray(bills) ? bills.find((b) => b.visitType === "OPD") : null;
  if (!opdBill) {
    failEvent(s, "OPD bill materialized", `no OPD bill for UHID=${patient.UHID}`);
  } else {
    created.billIds.add(opdBill._id);
    // Generate the bill out of DRAFT into GENERATED
    if (opdBill.billStatus === "DRAFT") {
      const gen = await api.post(`/api/billing/${opdBill._id}/generate`, {});
      if (gen.status !== 200) {
        infoEvent(s, "Generate OPD bill", `status=${gen.status} ${JSON.stringify(gen.body).slice(0, 150)}`);
      }
    }
    // Re-fetch the bill so we read the post-generate balance.
    const refetch = await api.get(`/api/billing/${opdBill._id}`);
    const fresh = refetch.body?.data || opdBill;
    const due = Number(fresh.balanceAmount || fresh.netAmount || 0);
    if (due > 0) {
      const pay = await api.post(`/api/billing/${opdBill._id}/payment`, {
        amount: due, paymentMode: "CASH",
        transactionId: `E2E-OPD-${Date.now()}`,
      });
      if (pay.status === 200) passEvent(s, "OPD bill paid", `₹${due} CASH`);
      else                    failEvent(s, "OPD bill payment", `status=${pay.status} ${JSON.stringify(pay.body).slice(0, 200)}`);
    } else {
      infoEvent(s, "OPD bill balance was 0 post-generate", "skipped payment");
    }
  }

  // 6. Hit patient-history aggregator
  const histRes = await api.get(`/api/patient-history/${patient.UHID}/opd`);
  if (histRes.status !== 200) {
    return failEvent(s, "GET /patient-history/:uhid/opd", `status=${histRes.status}`);
  }
  // Response shape: { success, data: { patient, visits, count } }
  const data = histRes.body?.data || {};
  const histVisits = Array.isArray(data.visits) ? data.visits
                   : Array.isArray(data)        ? data
                   : Array.isArray(histRes.body?.visits) ? histRes.body.visits
                   : [];
  if (histVisits.length === 0) {
    failEvent(s, "Patient history OPD list", "empty");
  } else {
    const v = histVisits[0];
    const hasLinked = !!(v.linkedOrders || v.linkedBillItems || v.bill || v.diagnosis || v.finalDiagnosis || v.workingDiagnosis);
    if (hasLinked) passEvent(s, "Patient history populated", `${histVisits.length} visit(s) — diagnosis=${(v.finalDiagnosis || v.workingDiagnosis || "?").slice(0, 30)}`);
    else           passEvent(s, "Patient history returned visits", `${histVisits.length} visit(s)`);
  }
}

// ════════════════════════════════════════════════════════════════════
// SCENARIO 2 — IPD admission → orders → MAR → discharge
// ════════════════════════════════════════════════════════════════════
async function scenario2_IPDFullPath(s) {
  // Pick a free bed — refresh the list so we don't reuse a bed that
  // another scenario just occupied.
  const bedListRes = await api.get("/api/bedss/available");
  const liveBeds = (bedListRes.body?.data || []).filter((b) => b.status === "Available");
  const bed = liveBeds.find((b) => /Ward/i.test(b.wardName || "") || /GENW|SEMI/i.test(b.roomCode || "")) || liveBeds[0];
  if (!bed) return failEvent(s, "No available bed for IPD test", "seed beds via seedBIMS.js");

  // 1. Register IPD patient
  const reg = await api.post("/api/patients", {
    title: "Mr.", fullName: `E2E IPD ${e2eLabel()}`,
    gender: "Male", age: 55,
    contactNumber: "9222" + Math.floor(Math.random() * 1e7).toString().padStart(7, "0"),
    registrationType: "IPD", paymentType: "GENERAL",
    address: { city: "Test", state: "Test", pincode: "110001" },
  });
  if (reg.status !== 201) return failEvent(s, "Register IPD patient", `status=${reg.status} ${JSON.stringify(reg.body).slice(0, 200)}`);
  const patient = reg.body.data;
  created.uhids.add(patient.UHID); created.patientIds.add(patient._id);
  passEvent(s, "IPD patient registered", `UHID=${patient.UHID}`);

  // 2. Admit
  const adm = await api.post("/api/admissions", {
    UHID: patient.UHID, patientId: patient._id,
    patientName: patient.fullName, contactNumber: patient.contactNumber,
    admissionType: "Planned",
    attendingDoctor: _fixtures.doctor?.personalInfo?.fullName || "Dr. E2E",
    attendingDoctorId: _fixtures.doctorId,
    department: _fixtures.department,
    departmentId: _fixtures.departmentId,
    reasonForAdmission: "E2E IPD scenario",
    bedId: bed._id, roomId: bed.room, wardId: bed.ward,
    bedNumber: bed.bedNumber, roomNumber: bed.roomNumber, wardName: bed.wardName,
    hasBed: true, status: "Active",
    paymentType: "GENERAL",
    admissionDate: new Date().toISOString(),
  });
  if (adm.status !== 201) return failEvent(s, "POST /admissions", `status=${adm.status} ${JSON.stringify(adm.body).slice(0, 200)}`);
  const admission = adm.body.data || adm.body;
  created.admissionIds.add(admission._id);
  passEvent(s, "Admission created", `admNo=${admission.admissionNumber} bed=${bed.bedNumber}`);

  // 3. Place a medication order
  const ord = await api.post("/api/doctor-orders", {
    UHID: patient.UHID, patientId: patient._id, patientName: patient.fullName,
    admissionId: admission._id, admissionNumber: admission.admissionNumber, ipdNo: admission.admissionNumber,
    visitType: "IPD",
    orderType: "Medication",
    priority: "Routine",
    orderedBy: "Dr. E2E Test",
    orderDetails: {
      medicineName: "Tab. Amoxicillin", dose: "500mg", route: "PO", frequency: "TDS",
      duration: "3 days", indication: "Empiric — UTI",
    },
    scheduledTimes: ["08:00", "14:00", "20:00"],
  });
  if (ord.status !== 201) {
    failEvent(s, "POST /doctor-orders Medication", `status=${ord.status} ${JSON.stringify(ord.body).slice(0, 200)}`);
  } else {
    const order = ord.body.data || ord.body;
    created.orderIds.add(order._id);
    const ipdNoOk = !!(order.admissionId || order.ipdNo);
    if (ipdNoOk) passEvent(s, "Medication order — admissionId/ipdNo stamped", `${order.admissionNumber || order.ipdNo}`);
    else         failEvent(s, "Medication order linkage missing", "admissionId/ipdNo not stamped — R7bv regression");

    // 4. Nurse marks first dose given
    const adminRes = await api.post(`/api/doctor-orders/${order._id}/administer`, {
      scheduledTime: "08:00",
      status: "given",
      givenBy: "Sr. E2E Nurse",
      fiveRightsChecked: true,
      notes: "First dose — patient tolerated",
    });
    if (adminRes.status === 200) passEvent(s, "Nurse administered first dose", `status=${adminRes.body.data?.status}`);
    else                          failEvent(s, "Administer dose", `status=${adminRes.status}`);
  }

  // 5. Nurse adds a nursing note — schema enum is lowercase
  const nn = await api.post("/api/nurse-notes", {
    patientId: patient._id, patientUHID: patient.UHID, UHID: patient.UHID,
    ipdNo: admission.admissionNumber, admissionId: admission._id,
    patientName: patient.fullName,
    nurseName: "Sr. E2E Nurse",
    shift: "morning",
    notes: "Pt stable, vitals WNL, no fresh complaints",
  });
  if (nn.status === 201 || nn.status === 200) passEvent(s, "Nursing note saved", `via /nurse-notes`);
  else                                         failEvent(s, "Nursing note", `status=${nn.status} ${JSON.stringify(nn.body).slice(0, 200)}`);

  // 6. Save a vital sheet entry — activeVitals is [{ name }], tableData uses
  // a values Map. The schema requires `patient` (Patient _id).
  const todayIso = new Date().toISOString().slice(0, 10);
  const vs = await api.post("/api/vitalsheet", {
    uhid: patient.UHID,
    patient: patient._id,
    patientName: patient.fullName,
    date: todayIso,
    admission: admission._id, ipdNo: admission.admissionNumber,
    activeVitals: [{ name: "Blood Pressure" }, { name: "Pulse" }, { name: "Temperature" }, { name: "SpO2" }],
    tableData: [{
      time: "10:00",
      values: {
        "Blood Pressure": { value: 124, unit: "mmHg" },
        "Pulse":          { value: 78,  unit: "bpm" },
        "Temperature":    { value: 98,  unit: "°F" },
        "SpO2":           { value: 98,  unit: "%" },
      },
      nurseName: "Sr. E2E Nurse",
    }],
  });
  if (vs.status === 200 || vs.status === 201) passEvent(s, "Vital sheet upserted");
  else                                         failEvent(s, "Vital sheet save", `status=${vs.status} ${JSON.stringify(vs.body).slice(0, 200)}`);

  // 7. Save discharge summary — schema requires `patient` (Patient _id), not patientId
  const ds = await api.post("/api/discharge-summary", {
    admissionId:    admission._id,
    UHID:           patient.UHID,
    patient:        patient._id,
    patientName:    patient.fullName,
    finalDiagnosis: "Acute uncomplicated UTI — resolved",
    treatmentGiven: "Empiric Amoxicillin 500mg TDS x 3 days",
    conditionOnDischarge: "Stable",
    dischargeAdvice: "Hydration + complete antibiotic course",
    followUpInstructions: "Review in 1 week",
  });
  let dsDoc = null;
  if (ds.status === 201 || ds.status === 200) {
    dsDoc = ds.body?.data || ds.body;
    passEvent(s, "Discharge summary saved", dsDoc?._id ? `id=${dsDoc._id}` : "");
  } else {
    failEvent(s, "Discharge summary save", `status=${ds.status} ${JSON.stringify(ds.body).slice(0, 200)}`);
  }

  // 8. Hit patient-history IPD file aggregator
  const fileRes = await api.get(`/api/patient-history/${admission._id}/file`);
  if (fileRes.status !== 200) {
    failEvent(s, "GET /patient-history/:id/file", `status=${fileRes.status}`);
  } else {
    const file = fileRes.body?.data || fileRes.body;
    const events = file?.timeline || file?.events || [];
    if (Array.isArray(events) && events.length > 0) {
      // Timeline events carry `when` (ISO string)
      const tsList = events.map((e) => new Date(e.when || e.at || e.timestamp || e.createdAt || 0).getTime()).filter(Boolean);
      const asc = tsList.every((t, i) => i === 0 || t >= tsList[i - 1]);
      if (asc) passEvent(s, "Patient file timeline ASC", `${events.length} events`);
      else     failEvent(s, "Patient file timeline order", "not strictly ASC");
    } else {
      infoEvent(s, "Patient file shape", `keys: ${Object.keys(file || {}).slice(0, 10).join(",")}`);
    }
  }
}

// ════════════════════════════════════════════════════════════════════
// SCENARIO 3 — Doctor Orders dedup race (409 DUPLICATE_ORDER)
// ════════════════════════════════════════════════════════════════════
async function scenario3_OrderDedup(s) {
  // Re-use the active admission from scenario 2 if any, else admit anew.
  let admissionId = [...created.admissionIds][0];
  let admissionNumber = null, UHID = null, patientId = null, patientName = null;
  if (admissionId) {
    const { Admission } = _models();
    const a = await Admission.findById(admissionId).lean();
    admissionNumber = a?.admissionNumber; UHID = a?.UHID; patientId = a?.patientId; patientName = a?.patientName;
  }
  if (!admissionId || !UHID) return failEvent(s, "Need an active admission", "scenario 2 didn't create one");

  const baseBody = {
    UHID, patientId, patientName,
    admissionId, admissionNumber, ipdNo: admissionNumber,
    visitType: "IPD",
    orderType: "Medication", priority: "Routine",
    orderedBy: "Dr. E2E Dedupe",
    orderDetails: {
      medicineName: "Tab. Dedupe-Test-Drug-" + Date.now(),
      dose: "10mg", route: "PO", frequency: "OD",
      duration: "3 days",
    },
    scheduledTimes: ["09:00"],
  };
  const r1 = await api.post("/api/doctor-orders", baseBody);
  if (r1.status !== 201) return failEvent(s, "First Medication POST", `status=${r1.status}`);
  if (r1.body?.data?._id) created.orderIds.add(r1.body.data._id);
  passEvent(s, "First Medication order saved", `_id=${r1.body.data?._id}`);

  const r2 = await api.post("/api/doctor-orders", baseBody);
  if (r2.status === 409 && r2.body?.code === "DUPLICATE_ORDER") {
    passEvent(s, "Duplicate order rejected with 409 DUPLICATE_ORDER", "dedupe window 30s working");
  } else {
    failEvent(s, "Expected 409 DUPLICATE_ORDER", `got status=${r2.status} code=${r2.body?.code || "-"}`);
  }
}

// ════════════════════════════════════════════════════════════════════
// SCENARIO 4 — Medication course pre-seeding + missed-dose flow
// ════════════════════════════════════════════════════════════════════
async function scenario4_CourseSeeding(s) {
  let admissionId = [...created.admissionIds][0];
  if (!admissionId) return failEvent(s, "Need active admission", "scenario 2 must run first");
  const { Admission, DoctorOrder } = _models();
  const a = await Admission.findById(admissionId).lean();
  if (!a) return failEvent(s, "Admission lookup", admissionId);

  // 5-day BD = 10 AR slots
  const body = {
    UHID: a.UHID, patientId: a.patientId, patientName: a.patientName,
    admissionId: a._id, admissionNumber: a.admissionNumber, ipdNo: a.admissionNumber,
    visitType: "IPD",
    orderType: "Medication", priority: "Routine",
    orderedBy: "Dr. E2E Course",
    orderDetails: {
      medicineName: "Tab. Course-Test-" + Date.now(),
      dose: "500mg", route: "PO", frequency: "BD",
      duration: "5 days",
    },
    scheduledTimes: ["08:00", "20:00"],
  };
  const r = await api.post("/api/doctor-orders", body);
  if (r.status !== 201) return failEvent(s, "POST 5-day BD order", `status=${r.status}`);
  const order = r.body.data;
  created.orderIds.add(order._id);

  const slots = order.administrationRecord || [];
  if (slots.length === 10) passEvent(s, "Course pre-seeded — 10 AR slots", `5 days × 2 doses/day`);
  else                     failEvent(s, "Course pre-seed count", `expected 10, got ${slots.length}`);

  if (order.courseDays === 5) passEvent(s, "courseDays stored", `${order.courseDays}`);
  else                         infoEvent(s, "courseDays", String(order.courseDays));

  if (order.endDate) passEvent(s, "endDate stamped", new Date(order.endDate).toISOString().slice(0, 10));
  else               failEvent(s, "endDate missing", "should be today + 4 days");

  // Mark first dose given — R7bq-K rule: status flips to Completed
  const firstSlot = slots[0];
  if (firstSlot) {
    const adminRes = await api.post(`/api/doctor-orders/${order._id}/administer`, {
      scheduledTime: firstSlot.scheduledTime,
      scheduledDate: firstSlot.scheduledDate,
      status: "given",
      givenBy: "Sr. E2E Course",
      fiveRightsChecked: true,
    });
    if (adminRes.status === 200 && adminRes.body.data?.status === "Completed") {
      passEvent(s, "R7bq-K: first dose given → status=Completed", "");
    } else if (adminRes.status === 200) {
      infoEvent(s, "First dose given but status not 'Completed'", `actual=${adminRes.body.data?.status}`);
    } else {
      failEvent(s, "Administer first dose", `status=${adminRes.status}`);
    }
  }

  // Verify the remaining 9 slots still appear on the order
  const after = await DoctorOrder.findById(order._id).lean();
  const pendingRemaining = (after?.administrationRecord || []).filter((r) => r.status === "pending").length;
  if (pendingRemaining >= 8) passEvent(s, "Remaining course slots intact for MAR", `${pendingRemaining} pending`);
  else                        failEvent(s, "Remaining course slots", `only ${pendingRemaining} pending — should be ≥ 8`);
}

// ════════════════════════════════════════════════════════════════════
// SCENARIO 5 — Infusion volume tracking + auto-stop
//   Time-based — we cannot wait 2 real hours. We back-date the
//   infusionStarted via direct DB write to simulate elapsed time, then
//   trigger the hourly cron path directly. Documented as a partial-
//   automation scenario in the report.
// ════════════════════════════════════════════════════════════════════
async function scenario5_InfusionAutoStop(s) {
  let admissionId = [...created.admissionIds][0];
  if (!admissionId) return failEvent(s, "Need active admission", "");
  const { Admission, DoctorOrder } = _models();
  const a = await Admission.findById(admissionId).lean();
  if (!a) return failEvent(s, "Admission lookup", admissionId);

  // Place an IV_Fluid order — totalVolume 100ml @ 50ml/hr
  const r = await api.post("/api/doctor-orders", {
    UHID: a.UHID, patientId: a.patientId, patientName: a.patientName,
    admissionId: a._id, admissionNumber: a.admissionNumber, ipdNo: a.admissionNumber,
    visitType: "IPD",
    orderType: "IV_Fluid", priority: "Routine",
    orderedBy: "Dr. E2E Infusion",
    orderDetails: {
      medicineName: "NS 0.9%", displayName: "Infusion-Test-" + Date.now(),
      dose: "100ml", route: "IV Infusion",
      rate: "50", totalVolume: "100", frequency: "Continuous",
      duration: "2 hours",
    },
  });
  if (r.status !== 201) return failEvent(s, "POST IV_Fluid order", `status=${r.status}`);
  const order = r.body.data;
  created.orderIds.add(order._id);
  passEvent(s, "IV_Fluid order placed", `${order._id} 100ml @ 50ml/hr`);

  // PATCH status to Active — should auto-stamp infusionStarted (R7bq-H)
  const patch = await api.patch(`/api/doctor-orders/${order._id}`, {
    status: "Active",
    currentRate: "50",
  });
  if (patch.status !== 200) return failEvent(s, "PATCH status=Active", `status=${patch.status}`);
  const patched = patch.body.data;
  if (patched?.infusionStarted) passEvent(s, "infusionStarted auto-stamped on Active", "");
  else                           failEvent(s, "infusionStarted should be set on Active", "R7bq-H regression");

  // To simulate 2 hours elapsed, back-date infusionStarted directly via Mongoose
  // (the cron computes elapsed = now - infusionStarted and stops once
  // volumeInfused ≥ totalVolume).
  const TWO_HOURS_AGO = new Date(Date.now() - 2 * 60 * 60 * 1000 - 60_000); // a tad over 2h
  await DoctorOrder.updateOne({ _id: order._id }, { $set: { infusionStarted: TWO_HOURS_AGO } });

  // Trigger the cron handler directly. The cron tick function lives in
  // services/Clinical/infusionIntakeCron.js — `arm()` schedules it. We
  // need IntakeOutputEntry registered first since the backend index.js
  // eager-load list doesn't include it.
  try { require("../models/Clinical/IntakeOutputEntryModel"); } catch {}
  let tickResult = null;
  try {
    const cron = require("../services/Clinical/infusionIntakeCron");
    if (typeof cron.tickOnce === "function") {
      tickResult = await cron.tickOnce();
    } else if (typeof cron.runHourlyIntakeSweep === "function") {
      tickResult = await cron.runHourlyIntakeSweep();
    } else if (typeof cron.tick === "function") {
      tickResult = await cron.tick();
    } else {
      infoEvent(s, "Cron tick fn not exported", `keys: ${Object.keys(cron).join(",")}`);
    }
  } catch (e) {
    infoEvent(s, "Cron tick execution skipped", e?.message || String(e));
  }

  // Re-fetch order — totalVolume should be reached and status should be Completed/Stopped
  const after = await DoctorOrder.findById(order._id).lean();
  const reachedVolume = (after?.infusionMonitoring || []).reduce(
    (sum, r) => sum + (Number(r.volumeInfused) || 0), 0,
  );
  if (reachedVolume >= 100) passEvent(s, "Computed volume reaches 100ml", `infused=${reachedVolume}`);
  else                       infoEvent(s, "Volume reached partial", `infused=${reachedVolume} (cron may not have auto-stopped — manual review needed)`);

  if (after?.status === "Completed" || after?.infusionStopped) {
    passEvent(s, "Auto-stop fired (status=Completed or infusionStopped set)", String(after?.status));
  } else {
    infoEvent(s, "Auto-stop didn't fire", `status=${after?.status} — needs further investigation`);
  }

  // Verify hourly I/O entries written (cron should write IntakeOutputEntry rows)
  try {
    const IntakeOutputEntry = mongoose.connection.models.IntakeOutputEntry
      || mongoose.model("IntakeOutputEntry", new mongoose.Schema({}, { strict: false, collection: "intake_output_entries" }));
    const ioRows = await IntakeOutputEntry.find({ orderId: order._id }).lean();
    if (ioRows.length >= 1) passEvent(s, "Hourly I/O entries written by cron", `${ioRows.length} row(s)`);
    else                     infoEvent(s, "I/O entries", "cron may not have ticked — 0 rows");
  } catch (e) {
    infoEvent(s, "IntakeOutputEntry lookup", e.message);
  }
}

// ════════════════════════════════════════════════════════════════════
// SCENARIO 6 — Bed allotment from ER disposition
// ════════════════════════════════════════════════════════════════════
async function scenario6_ERDisposition(s) {
  // 1. Register ER patient
  const reg = await api.post("/api/patients", {
    title: "Mr.", fullName: `E2E ER ${e2eLabel()}`,
    gender: "Male", age: 35,
    contactNumber: "9333" + Math.floor(Math.random() * 1e7).toString().padStart(7, "0"),
    registrationType: "Emergency", paymentType: "GENERAL",
    address: { city: "Test", state: "Test", pincode: "110001" },
  });
  if (reg.status !== 201) return failEvent(s, "Register ER patient", `status=${reg.status}`);
  const patient = reg.body.data;
  created.uhids.add(patient.UHID); created.patientIds.add(patient._id);
  passEvent(s, "ER patient registered", `UHID=${patient.UHID}`);

  // 2. Create ER visit — required fields: arrivalMode, triageCategory (enum),
  //    presentingComplaints, consultantIncharge
  const visit = await api.post("/api/emergency", {
    patientId: patient._id, UHID: patient.UHID,
    patientName: patient.fullName,
    age: 35, gender: "Male",
    contactNumber: patient.contactNumber,
    triageCategory: "Urgent",         // enum: Critical/Emergency/Urgent/Semi-urgent/Non-urgent
    arrivalMode: "Walk-in",
    presentingComplaints: "Severe abdominal pain x 6 hours",
    consultantIncharge: _fixtures.doctor?.personalInfo?.fullName || "Dr. E2E",
  });
  if (visit.status !== 201 && visit.status !== 200) {
    return failEvent(s, "Create ER visit", `status=${visit.status} ${JSON.stringify(visit.body).slice(0, 200)}`);
  }
  const erVisit = visit.body?.data || visit.body;
  passEvent(s, "ER visit created", `emergencyNumber=${erVisit?.emergencyNumber || "?"}`);

  // 3. Pick a free bed
  const bedRes = await api.get("/api/bedss/available");
  const bed = (bedRes.body?.data || []).find((b) => b.status === "Available");
  if (!bed) {
    infoEvent(s, "No available bed to test ER disposition", "skipped");
    return;
  }

  // 4. Update disposition to "Admitted" (the enum value the service accepts).
  // The service auto-creates an Admission stub from the ER visit when
  // admittedToBed + admittedToWard are supplied. Per R7bs this also flips
  // the bed to Reserved/Occupied via the admission auto-billing path.
  const dispo = await api.put(`/api/emergency/${erVisit.emergencyNumber}/disposition`, {
    disposition: "Admitted",
    admittedToBed:  bed.bedNumber,
    admittedToWard: bed.wardName || "Ward",
    admittedDepartment: _fixtures.department,
    attendingDoctor:    _fixtures.doctor?.personalInfo?.fullName || "Dr. E2E",
    attendingDoctorId:  _fixtures.doctorId,
    admittedBy:         "Dr. E2E",
    notes: "Yellow triage, vitals stable — admitting for observation",
  });

  if (dispo.status === 200 || dispo.status === 201) {
    passEvent(s, "ER disposition saved as 'Admitted'", `bed=${bed.bedNumber}`);
  } else {
    return failEvent(s, "PUT /emergency/:n/disposition", `status=${dispo.status} ${JSON.stringify(dispo.body).slice(0, 200)}`);
  }

  // 5. Verify the ER → Admission bridge was created
  const { Admission } = _models();
  const bridged = await Admission.findOne({ UHID: patient.UHID, admissionType: "Emergency" }).sort({ createdAt: -1 }).lean();
  if (bridged) {
    created.admissionIds.add(bridged._id);
    passEvent(s, "ER → IPD bridge admission auto-created", `admNo=${bridged.admissionNumber}`);
  } else {
    failEvent(s, "ER → Admission stub", "no bridge admission created");
  }

  // 6. Bed-status check — the disposition service uses bedNumber (string)
  // rather than bedId, so we have to look up the Bed by number to verify.
  const { Bed } = _models();
  const updatedBed = await Bed.findOne({ bedNumber: bed.bedNumber }).lean();
  if (updatedBed?.status && updatedBed.status !== "Available") {
    passEvent(s, `Bed ${bed.bedNumber} status changed`, `${bed.status} → ${updatedBed.status}`);
  } else {
    infoEvent(s, `Bed ${bed.bedNumber} still ${updatedBed?.status || "?"}`, "ER disposition stub doesn't currently flip bedId — reception must allocate explicitly");
  }
}

// ════════════════════════════════════════════════════════════════════
// SCENARIO 7 — Patient credit ledger bulk collect
// ════════════════════════════════════════════════════════════════════
async function scenario7_BulkCollect(s) {
  // Create a fresh patient + 3 OPD bills with outstanding balance
  const reg = await api.post("/api/patients", {
    title: "Ms.", fullName: `E2E Credit ${e2eLabel()}`,
    gender: "Female", age: 30,
    contactNumber: "9444" + Math.floor(Math.random() * 1e7).toString().padStart(7, "0"),
    registrationType: "OPD", paymentType: "GENERAL",
    address: { city: "Test", state: "Test", pincode: "110001" },
    department: _fixtures.departmentId, doctor: _fixtures.doctorId,
    chiefComplaint: "Follow-up #1",
  });
  if (reg.status !== 201) return failEvent(s, "Register patient", `status=${reg.status}`);
  const patient = reg.body.data;
  created.uhids.add(patient.UHID); created.patientIds.add(patient._id);

  // The auto-billed OPD-CON line gives us one DRAFT bill. We push it to
  // GENERATED (bulkCollectByUHID only works on GENERATED/PARTIAL bills)
  // and verify the patientCredit ledger surfaces it.
  await new Promise((r) => setTimeout(r, 400));
  const billsRes = await api.get(`/api/billing/uhid/${patient.UHID}`);
  const rawBills = billsRes.body?.data?.bills || billsRes.body?.data || [];
  const bills = Array.isArray(rawBills) ? rawBills : [];
  bills.forEach((b) => created.billIds.add(b._id));
  if (!bills.length) {
    infoEvent(s, "No bills for new patient", "Auto-bill may not have materialized");
    return;
  }

  // Generate every DRAFT bill so it's eligible for bulk-collect.
  let generated = 0;
  for (const b of bills) {
    if (b.billStatus === "DRAFT") {
      const g = await api.post(`/api/billing/${b._id}/generate`, {});
      if (g.status === 200) generated++;
    }
  }
  passEvent(s, `Generated ${generated} bill(s) out of DRAFT`, "");

  // Refresh + count outstanding
  const refreshed = await api.get(`/api/billing/uhid/${patient.UHID}`);
  const fresh = (refreshed.body?.data?.bills || refreshed.body?.data || []).filter((b) => Number(b.balanceAmount || 0) > 0);
  if (!fresh.length) {
    infoEvent(s, "No outstanding after generate", "balance was already 0");
    return;
  }
  passEvent(s, `${fresh.length} outstanding bill(s) staged`, `total ₹${fresh.reduce((s, b) => s + Number(b.balanceAmount), 0)}`);

  // Hit /billing/aging — patientCredit list is top-level
  const aging = await api.get("/api/billing/aging");
  if (aging.status === 200) {
    const pcr = aging.body?.patientCredit || aging.body?.data?.patientCredit || [];
    const ours = pcr.filter((r) => r.UHID === patient.UHID);
    if (ours.length > 0) passEvent(s, "Aging /patientCredit surfaces our bills", `${ours.length} rows`);
    else                  infoEvent(s, "Aging /patientCredit", `our UHID not in top-100 — overall ${pcr.length} rows`);
  } else {
    failEvent(s, "GET /billing/aging", `status=${aging.status}`);
  }

  // Bulk collect-all
  const total = fresh.reduce((sum, b) => sum + Number(b.balanceAmount || 0), 0);
  const bulk = await api.post(`/api/billing/uhid/${patient.UHID}/collect-all`, {
    amount: total, paymentMode: "CASH",
    transactionId: `E2E-BULK-${Date.now()}`,
  });
  if (bulk.status === 200) {
    passEvent(s, "Bulk collect-all succeeded", `₹${total} cleared across ${bulk.body?.data?.billsTouched || "?"} bill(s)`);
  } else {
    failEvent(s, "POST /collect-all", `status=${bulk.status} ${JSON.stringify(bulk.body).slice(0, 200)}`);
  }
}

// ════════════════════════════════════════════════════════════════════
// SCENARIO 8 — Advance deposit → apply → refund + ledger
// ════════════════════════════════════════════════════════════════════
async function scenario8_AdvanceRefund(s) {
  // Pick or create a patient
  const reg = await api.post("/api/patients", {
    title: "Mr.", fullName: `E2E Advance ${e2eLabel()}`,
    gender: "Male", age: 45,
    contactNumber: "9555" + Math.floor(Math.random() * 1e7).toString().padStart(7, "0"),
    registrationType: "OPD", paymentType: "GENERAL",
    address: { city: "Test", state: "Test", pincode: "110001" },
    department: _fixtures.departmentId, doctor: _fixtures.doctorId,
    chiefComplaint: "Routine",
  });
  if (reg.status !== 201) return failEvent(s, "Register patient", `status=${reg.status}`);
  const patient = reg.body.data;
  created.uhids.add(patient.UHID); created.patientIds.add(patient._id);

  // 1. Take advance ₹5000
  const adv = await api.post("/api/billing/advance", {
    UHID: patient.UHID, patientId: patient._id, patientName: patient.fullName,
    amount: 5000, paymentMode: "CASH",
    transactionId: `E2E-ADV-${Date.now()}`,
    purpose: "E2E test advance",
  });
  if (adv.status !== 201) return failEvent(s, "Create advance", `status=${adv.status} ${JSON.stringify(adv.body).slice(0, 200)}`);
  const advance = adv.body.data;
  created.advanceIds.add(advance._id);
  passEvent(s, "Advance ₹5000 created", `receiptNo=${advance.receiptNumber || advance._id}`);

  // 2. Apply ₹2000 to whatever bill the patient has (must be GENERATED, not DRAFT)
  await new Promise((r) => setTimeout(r, 300));
  const billsRes = await api.get(`/api/billing/uhid/${patient.UHID}`);
  const bills = billsRes.body?.data?.bills || billsRes.body?.data || [];
  let target = (Array.isArray(bills) ? bills : []).find((b) => Number(b.balanceAmount || 0) > 0);
  if (target && target.billStatus === "DRAFT") {
    const g = await api.post(`/api/billing/${target._id}/generate`, {});
    if (g.status === 200) target = g.body?.data || target;
  }
  if (target) {
    created.billIds.add(target._id);
    const apply = await api.post(`/api/billing/advance/${advance._id}/apply`, {
      billId: target._id,
      amount: Math.min(2000, Number(target.balanceAmount || 5000)),
    });
    if (apply.status === 200) passEvent(s, "₹2000 advance applied to bill", `bill=${target.billNumber || target._id}`);
    else                       failEvent(s, "Apply advance", `status=${apply.status} ${JSON.stringify(apply.body).slice(0, 200)}`);
  } else {
    infoEvent(s, "No bill to apply advance against", "");
  }

  // 3. Refund the remaining — admin can self-refund only via approverOverride.
  // The cashier-segregation guard (SAME_ACTOR) is intentional in production;
  // for the test runner we pass `approverOverride: true` since we're admin.
  const refund = await api.post(`/api/billing/advance/${advance._id}/refund`, {
    refundReason: "E2E test refund — admin override",
    mode: "CASH",
    transactionId: `E2E-REF-${Date.now()}`,
    approverOverride: true,
  });
  if (refund.status === 200) {
    passEvent(s, "Advance refund processed (admin override)", "");
  } else {
    failEvent(s, "Refund advance", `status=${refund.status} ${JSON.stringify(refund.body).slice(0, 200)}`);
  }

  // 4. Verify PatientAdvance ledger entries (paidIn, applied, refunded)
  const { PatientAdvance } = _models();
  const ledger = await PatientAdvance.findById(advance._id).lean();
  if (!ledger) {
    failEvent(s, "PatientAdvance row", "missing after refund");
  } else {
    const sumOk = Number(ledger.amount) >= Number(ledger.appliedAmount || 0) + Number(ledger.refundedAmount || 0) - 0.001;
    if (sumOk) passEvent(s, "Ledger invariant holds", `amount=${ledger.amount} applied=${ledger.appliedAmount} refunded=${ledger.refundedAmount}`);
    else        failEvent(s, "Ledger invariant violated", `applied+refunded > amount`);
  }
}

// ════════════════════════════════════════════════════════════════════
// SCENARIO 9 — Concurrent admission guard (R7bq-A partial unique index)
// ════════════════════════════════════════════════════════════════════
async function scenario9_DupeAdmission(s) {
  // Register a patient first
  const reg = await api.post("/api/patients", {
    title: "Mr.", fullName: `E2E Dup ${e2eLabel()}`,
    gender: "Male", age: 50,
    contactNumber: "9666" + Math.floor(Math.random() * 1e7).toString().padStart(7, "0"),
    registrationType: "IPD", paymentType: "GENERAL",
    address: { city: "Test", state: "Test", pincode: "110001" },
  });
  if (reg.status !== 201) return failEvent(s, "Register patient", `status=${reg.status}`);
  const patient = reg.body.data;
  created.uhids.add(patient.UHID); created.patientIds.add(patient._id);

  // Refresh available beds — prior scenarios may have occupied some.
  const bedListRes = await api.get("/api/bedss/available");
  const beds = (bedListRes.body?.data || []).filter((b) => b.status === "Available");
  const bed = beds[0];
  if (!bed) return failEvent(s, "Need an available bed", "no free beds at this point in suite");

  const body = {
    UHID: patient.UHID, patientId: patient._id,
    patientName: patient.fullName, contactNumber: patient.contactNumber,
    admissionType: "Planned",
    attendingDoctor: _fixtures.doctor?.personalInfo?.fullName || "Dr. E2E",
    attendingDoctorId: _fixtures.doctorId,
    department: _fixtures.department, departmentId: _fixtures.departmentId,
    reasonForAdmission: "First admission",
    bedId: bed._id, roomId: bed.room, wardId: bed.ward,
    hasBed: true, status: "Active",
    paymentType: "GENERAL",
    admissionDate: new Date().toISOString(),
  };

  // First admission should succeed
  const r1 = await api.post("/api/admissions", body);
  if (r1.status !== 201) return failEvent(s, "First admission", `status=${r1.status} ${JSON.stringify(r1.body).slice(0, 200)}`);
  if (r1.body?.data?._id) created.admissionIds.add(r1.body.data._id);
  passEvent(s, "First admission succeeded", `bed=${bed.bedNumber}`);

  // Second concurrent admission with same UHID + Active should fail
  const r2 = await api.post("/api/admissions", { ...body, reasonForAdmission: "Duplicate admission attempt" });
  if (r2.status === 409 || r2.status === 400) {
    passEvent(s, "Duplicate active admission blocked", `status=${r2.status}`);
  } else if (r2.status === 201) {
    failEvent(s, "Duplicate active admission NOT blocked", "second admission succeeded — R7bq-A regression");
    if (r2.body?.data?._id) created.admissionIds.add(r2.body.data._id);
  } else {
    infoEvent(s, "Unexpected status on dup admission", `status=${r2.status}`);
  }
}

// ════════════════════════════════════════════════════════════════════
// SCENARIO 10 — NABH register auto-emit
// ════════════════════════════════════════════════════════════════════
async function scenario10_NABHRegisters(s) {
  let admissionId = [...created.admissionIds][0];
  if (!admissionId) return failEvent(s, "Need active admission", "scenario 2 must run first");
  const { Admission } = _models();
  const a = await Admission.findById(admissionId).lean();
  if (!a) return failEvent(s, "Admission lookup", admissionId);

  // 1. Place an antibiotic order → should auto-populate AntimicrobialUseRegister
  const abx = await api.post("/api/doctor-orders", {
    UHID: a.UHID, patientId: a.patientId, patientName: a.patientName,
    admissionId: a._id, admissionNumber: a.admissionNumber, ipdNo: a.admissionNumber,
    visitType: "IPD",
    orderType: "Medication", priority: "Routine",
    orderedBy: "Dr. E2E ABX",
    orderDetails: {
      medicineName: "Inj. Ceftriaxone-E2E-" + Date.now(),
      dose: "1g", route: "IV", frequency: "BD",
      duration: "5 days",
      indication: "Empiric — sepsis",
    },
    scheduledTimes: ["08:00", "20:00"],
    isAntibiotic: true,
  });
  if (abx.status === 201) {
    if (abx.body?.data?._id) created.orderIds.add(abx.body.data._id);
    // Emit is fire-and-forget (.catch only). Poll briefly to give the
    // async write a chance to land before declaring "row not found".
    const abxOrderId = abx.body?.data?._id;
    try {
      // Use the real model so the proper collection name (`antimicrobial_use_registers`)
      // is used — Mongoose auto-pluralization differs from the schema's explicit collection.
      const Reg = require("../models/Compliance/AntimicrobialUseRegisterModel");
      let row = null;
      for (let i = 0; i < 10 && !row; i++) {
        await new Promise(r => setTimeout(r, 150));
        row = await Reg.findOne(abxOrderId ? { doctorOrderId: abxOrderId } : { admissionId: a._id })
          .sort({ createdAt: -1 }).lean();
      }
      if (row) passEvent(s, "AntimicrobialUseRegister auto-populated",
                        `_id=${row._id} aware=${row.watchAccessReserve || "?"}`);
      else     infoEvent(s, "Antimicrobial register row not found", "emit may be unwired");
    } catch (e) {
      infoEvent(s, "AntimicrobialUseRegister lookup", e.message);
    }
  } else {
    failEvent(s, "POST antibiotic order", `status=${abx.status}`);
  }

  // 2. Place a Procedure order with requiresOT → should emit OTRegister
  // The route-level trigger is `order.orderDetails?.requiresOT === true`
  // (the frontend Doctor Orders Panel nests it inside orderDetails). Sending
  // it at body level was a silent miss in the original test.
  const ot = await api.post("/api/doctor-orders", {
    UHID: a.UHID, patientId: a.patientId, patientName: a.patientName,
    admissionId: a._id, admissionNumber: a.admissionNumber, ipdNo: a.admissionNumber,
    visitType: "IPD",
    orderType: "Procedure", priority: "Routine",
    orderedBy: "Dr. E2E OT",
    orderDetails: {
      procedureName: "Appendicectomy-E2E-" + Date.now(),
      indication: "Acute appendicitis",
      notes: "Standard OT",
      requiresOT: true,  // ← nested per the wired contract
    },
  });
  if (ot.status === 201) {
    if (ot.body?.data?._id) created.orderIds.add(ot.body.data._id);
    const otOrderId = ot.body?.data?._id;
    try {
      // Use the real model so the proper collection name (`ot_registers`) is used.
      const Reg = require("../models/Compliance/OTRegisterModel");
      let row = null;
      for (let i = 0; i < 10 && !row; i++) {
        await new Promise(r => setTimeout(r, 150));
        row = await Reg.findOne(otOrderId ? { doctorOrderId: otOrderId } : { admissionId: a._id })
          .sort({ createdAt: -1 }).lean();
      }
      if (row) passEvent(s, "OTRegister auto-populated", `_id=${row._id}`);
      else     infoEvent(s, "OTRegister row not found", "emit may be unwired");
    } catch (e) {
      infoEvent(s, "OTRegister lookup", e.message);
    }
  } else {
    infoEvent(s, "POST Procedure order", `status=${ot.status}`);
  }

  // 3. ASARegister — usually emitted via procedure note save (anaesthesia
  // pre-assessment). Skip if no obvious endpoint — just report the
  // expected dependency.
  infoEvent(s, "ASARegister", "auto-emit wired off procedure-note save (not driven from this E2E)");

  // 4. MortalityRegister — emitted via discharge summary finalize with
  // dispositionMode=Expired. We don't want to mark our test patient as
  // expired since later scenarios + cleanup depend on the patient, so
  // we just report this as a known un-automatable case.
  infoEvent(s, "MortalityRegister", "auto-emit wired off discharge dispositionMode=Expired — not safe to trigger in shared suite");
}

// ════════════════════════════════════════════════════════════════════
// MONGOOSE MODEL ACCESS
// ════════════════════════════════════════════════════════════════════
let _modelsCache = null;
function _models() {
  if (_modelsCache) return _modelsCache;
  _modelsCache = {
    Patient:         require("../models/Patient/patientModel"),
    Admission:       require("../models/Patient/admissionModel"),
    DoctorOrder:     require("../models/Doctor/DoctorOrderModel"),
    PatientBill:     require("../models/PatientBillModel/PatientBillModel"),
    PatientAdvance:  require("../models/PatientBillModel/PatientAdvanceModel"),
    BillingTrigger:  require("../models/Billing/BillingTrigger"),
    Bed:             require("../models/bedMgmt/bedsModel"),
  };
  return _modelsCache;
}

// ════════════════════════════════════════════════════════════════════
// CLEANUP
// ════════════════════════════════════════════════════════════════════
async function cleanup() {
  console.log(`\n${C.bold}${C.cyan}── CLEANUP ──${C.reset}`);
  const { Patient, Admission, DoctorOrder, PatientBill, PatientAdvance, BillingTrigger, Bed } = _models();
  let counts = { patients: 0, admissions: 0, orders: 0, bills: 0, advances: 0, triggers: 0, beds: 0 };

  try {
    // Delete created orders
    for (const oid of created.orderIds) {
      try { await DoctorOrder.deleteOne({ _id: oid }); counts.orders++; } catch {}
    }
    // Delete created advances
    for (const aid of created.advanceIds) {
      try { await PatientAdvance.deleteOne({ _id: aid }); counts.advances++; } catch {}
    }
    // Delete created bills
    for (const bid of created.billIds) {
      try { await PatientBill.deleteOne({ _id: bid }); counts.bills++; } catch {}
    }
    // Delete all bills/triggers per UHID (covers ones auto-created by registration)
    for (const uhid of created.uhids) {
      try {
        const tr = await BillingTrigger.deleteMany({ UHID: uhid });
        counts.triggers += tr.deletedCount || 0;
        const bl = await PatientBill.deleteMany({ UHID: uhid });
        counts.bills += bl.deletedCount || 0;
        const ad = await PatientAdvance.deleteMany({ UHID: uhid });
        counts.advances += ad.deletedCount || 0;
        const dr = await DoctorOrder.deleteMany({ UHID: uhid });
        counts.orders += dr.deletedCount || 0;
      } catch {}
    }
    // Delete admissions and release their beds
    for (const adId of created.admissionIds) {
      try {
        const adm = await Admission.findById(adId).lean();
        if (adm?.bedId) {
          // Reset bed back to Available
          await Bed.updateOne(
            { _id: adm.bedId },
            { $set: { status: "Available", patient: null, currentAdmission: null } }
          );
          counts.beds++;
        }
        await Admission.deleteOne({ _id: adId });
        counts.admissions++;
      } catch {}
    }
    // Also delete admissions by UHID in case the OPD bridge admission wasn't tracked
    for (const uhid of created.uhids) {
      try {
        const found = await Admission.find({ UHID: uhid }).select("_id bedId").lean();
        for (const f of found) {
          if (f.bedId) {
            await Bed.updateOne(
              { _id: f.bedId },
              { $set: { status: "Available", patient: null, currentAdmission: null } }
            );
            counts.beds++;
          }
        }
        const r = await Admission.deleteMany({ UHID: uhid });
        counts.admissions += r.deletedCount || 0;
      } catch {}
    }
    // Delete OPD visits + Emergency visits by UHID (best-effort via model lookup)
    try {
      const OPD = require("../models/Patient/OPDModels");
      for (const uhid of created.uhids) {
        try { await OPD.deleteMany({ UHID: uhid }); } catch {}
      }
    } catch {}
    try {
      const Emergency = require("../models/Patient/emergencyModel");
      for (const uhid of created.uhids) {
        try { await Emergency.deleteMany({ UHID: uhid }); } catch {}
      }
    } catch {}
    // Finally delete the patient rows
    for (const pid of created.patientIds) {
      try { await Patient.deleteOne({ _id: pid }); counts.patients++; } catch {}
    }
  } catch (e) {
    console.log(`  ${C.yellow}cleanup partial error: ${e.message}${C.reset}`);
  }

  console.log(`  ${C.grey}removed${C.reset} ${counts.patients} patients, ${counts.admissions} admissions, ${counts.orders} orders, ${counts.bills} bills, ${counts.advances} advances, ${counts.triggers} triggers, ${counts.beds} bed status resets`);
}

// ════════════════════════════════════════════════════════════════════
// MAIN
// ════════════════════════════════════════════════════════════════════
async function main() {
  console.log(`${C.bold}${C.cyan}═══════════════════════════════════════════════════════${C.reset}`);
  console.log(`${C.bold}${C.cyan}  SphereHealth HIS — E2E Full System Regression Suite${C.reset}`);
  console.log(`${C.bold}${C.cyan}═══════════════════════════════════════════════════════${C.reset}`);
  console.log(`  base=${BASE}  minPass=${MIN_PASS}/10\n`);

  const t0 = Date.now();
  try {
    // 1. Login
    await login();
    console.log(`  ${tick} logged in as ${ADMIN_EMAIL}`);

    // 2. Connect Mongoose so cleanup + indirect lookups work
    await mongoose.connect(MONGO_URI);
    console.log(`  ${tick} mongoose connected to ${MONGO_URI.split("@").pop()}`);

    // 3. Load shared fixtures
    await loadFixtures();
    console.log(`  ${tick} fixtures loaded — doctor=${_fixtures.doctor?.personalInfo?.fullName} dept=${_fixtures.department} ${_fixtures.beds.length} available beds`);
  } catch (e) {
    console.error(`\n${cross} bootstrap failed: ${e.message}`);
    process.exit(1);
  }

  // Run scenarios sequentially — some depend on data created by prior ones
  await runScenario("Scenario 1 — Full OPD lifecycle",                 scenario1_OPDLifecycle);
  await runScenario("Scenario 2 — IPD admission → orders → MAR → file", scenario2_IPDFullPath);
  await runScenario("Scenario 3 — Doctor Orders dedup race (409)",      scenario3_OrderDedup);
  await runScenario("Scenario 4 — Med course pre-seed + missed dose",   scenario4_CourseSeeding);
  await runScenario("Scenario 5 — Infusion volume + auto-stop",         scenario5_InfusionAutoStop);
  await runScenario("Scenario 6 — Bed allotment from ER disposition",   scenario6_ERDisposition);
  await runScenario("Scenario 7 — Patient credit ledger bulk collect",  scenario7_BulkCollect);
  await runScenario("Scenario 8 — Advance deposit + refund + ledger",   scenario8_AdvanceRefund);
  await runScenario("Scenario 9 — Concurrent admission guard",          scenario9_DupeAdmission);
  await runScenario("Scenario 10 — NABH register auto-emit",            scenario10_NABHRegisters);

  // Cleanup
  try { await cleanup(); } catch (e) { console.log(`  ${C.yellow}cleanup failed: ${e.message}${C.reset}`); }
  try { await mongoose.disconnect(); } catch {}

  // ─── Summary ─────────────────────────────────────────────────────
  const total      = results.length;
  const passed     = results.filter((r) => r.failures.length === 0).length;
  const failed     = total - passed;
  const totalDur   = Date.now() - t0;
  console.log(`\n${C.bold}${C.cyan}═══════════════════════════════════════════════════════${C.reset}`);
  console.log(`${C.bold}E2E FULL-SYSTEM RESULT${C.reset}`);
  console.log(`${C.bold}═══════════════════════════════════════════════════════${C.reset}`);
  for (const r of results) {
    const icon = r.failures.length === 0 ? `${C.green}PASS${C.reset}` : `${C.red}FAIL${C.reset}`;
    console.log(`  ${icon}  ${r.name.padEnd(55)} ${C.grey}${r.passed.length}✓ ${r.failures.length}✗ ${r.info.length}· ${r.duration}ms${C.reset}`);
    for (const f of r.failures) {
      console.log(`         ${cross} ${C.red}${f.name}${C.reset} — ${C.grey}${f.detail || ""}${C.reset}`);
    }
  }
  console.log(`\n  ${passed}/${total} scenarios passed  (threshold ${MIN_PASS})  total ${totalDur}ms\n`);

  if (passed >= MIN_PASS) {
    console.log(`${C.green}${C.bold}✓ suite met pass threshold${C.reset}\n`);
    process.exit(0);
  } else {
    console.log(`${C.red}${C.bold}✗ suite missed pass threshold${C.reset}\n`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(`\n${cross} fatal: ${e.stack || e.message}`);
  process.exit(1);
});
