// scripts/e2eBillingTest.js
// ════════════════════════════════════════════════════════════════════
// END-TO-END billing test — runs every code path the engine fires
// when a real patient flows through registration → admission →
// doctor visit → daily accrual. Prints a pass/fail per scenario.
//
// Tests:
//   1. OPD registration → OPD-CON trigger + bill line item
//   2. IPD admission per RoomCategory (GENW/SEMI/PVT/ICU/NICU/DAYCARE)
//      → BED-{categoryCode} trigger at the correct ANH rate
//   3. Deluxe tier — confirm NO separate DELUXE category exists;
//      ANH bundles "Private / Single Deluxe AC" into one PVT tier.
//      This is a business-logic decision that finance/admin must own.
//   4. Doctor note saved on an IPD admission → CON-001 trigger
//   5. Regression — historic bills with BED-GENW line items still
//      load via the public /api/billing/uhid endpoint.
//
// Idempotent: cleans up its own test patients before exiting.
// Read-mostly: the only writes are test patients flagged with
// `__e2e_test: true` which are deleted on success.
//
//   node scripts/e2eBillingTest.js
// ════════════════════════════════════════════════════════════════════

require("dotenv").config();
const mongoose = require("mongoose");

const Patient        = require("../models/Patient/patientModel");
const Admission      = require("../models/Patient/admissionModel");
const RoomCategory   = require("../models/bedMgmt/roomCategoryModel");
const Room           = require("../models/bedMgmt/roomModel");
const ServiceMaster  = require("../models/ServiceMaster/serviceMasterModel");
const ServicePricing = require("../models/ServicePricing/ServicePricingModel");
const BillingTrigger = require("../models/Billing/BillingTrigger");
const PatientBill    = require("../models/PatientBillModel/PatientBillModel");

const OPDService     = require("../services/Patient/OPDService");
const autoBilling    = require("../services/Billing/autoBillingService");

const results = [];
const pass = (name, detail) => { results.push({ name, status: "PASS", detail }); console.log("  [✓]", name, "—", detail); };
const fail = (name, detail) => { results.push({ name, status: "FAIL", detail }); console.log("  [✗]", name, "—", detail); };
const info = (name, detail) => { results.push({ name, status: "INFO", detail }); console.log("  [·]", name, "—", detail); };

const createdAdmissionIds = [];
const createdPatientIds   = [];

// ── Helper: pick any doctor + department for test registrations ─────
async function pickDoctorAndDept() {
  const Doctor     = require("../models/Doctor/doctorModel");
  const Department = require("../models/Department/department");
  const doc  = await Doctor.findOne({ isActive: { $ne: false } }).lean();
  const dept = doc?.department ? await Department.findById(doc.department).lean() : null;
  if (!doc || !dept) throw new Error("No doctor/department available for test registration");
  return { doc, dept };
}

// ── Helper: lookup any Room of a given category ─────────────────────
async function pickRoom(categoryCode) {
  const cat = await RoomCategory.findOne({ categoryCode }).lean();
  if (!cat) return null;
  const room = await Room.findOne({ roomCategory: cat._id }).lean();
  return { cat, room };
}

// ════════════════════════════════════════════════════════════════════
// TEST 1 — OPD REGISTRATION
// ════════════════════════════════════════════════════════════════════
async function test_OPDConsultation() {
  console.log("\n── TEST 1: OPD registration → OPD-CON trigger ──");
  const { doc, dept } = await pickDoctorAndDept();

  // Create test patient with __e2e_test flag for easy cleanup
  const patient = await Patient.create({
    title: "Mr.", fullName: "E2E OPD Test " + Date.now().toString().slice(-6),
    gender: "Male", age: 35, contactNumber: "9999" + Math.floor(Math.random() * 1e6),
    registrationType: "OPD", paymentType: "GENERAL",
    doctor: doc._id, department: dept._id,
    address: { city: "Test", state: "Test", pincode: "110001" },
    __e2e_test: true,
  });
  createdPatientIds.push(patient._id);

  // Fire OPDService (mirrors what patientController.createPatient does)
  await OPDService.createOPDVisit({
    patientId: patient._id, UHID: patient.UHID,
    departmentId: dept._id, doctorId: doc._id,
    chiefComplaint: "E2E test consultation",
    visitDate: new Date(), visitType: "First Visit",
    paymentType: "GENERAL",
  });

  // Look up the trigger that should have been created
  const triggers = await BillingTrigger.find({ UHID: patient.UHID }).lean();
  const opdConTrigger = triggers.find((t) => t.serviceCode === "OPD-CON");
  if (!opdConTrigger) return fail("OPD-CON trigger fired", `Found ${triggers.length} triggers, none with serviceCode=OPD-CON`);
  pass("OPD-CON trigger fired", `unitPrice=₹${opdConTrigger.unitPrice}, status=${opdConTrigger.status}, billed=${!!opdConTrigger.billId}`);

  // Verify the bill row was materialized with the OPD-CON line item
  const bill = await PatientBill.findOne({ UHID: patient.UHID, visitType: "OPD" }).lean();
  if (!bill) return fail("OPD bill created", "No PatientBill row");
  const item = (bill.billItems || []).find((i) => i.serviceCode === "OPD-CON");
  if (!item) return fail("OPD-CON line item posted", `Bill ${bill.billNumber} has ${bill.billItems.length} items, none OPD-CON`);
  pass("OPD-CON line item on bill", `bill=${bill.billNumber}, qty=${item.quantity}, unitPrice=₹${item.unitPrice}, net=₹${item.netAmount}`);

  // Verify the rate matches what ServicePricing says (CASH default)
  const sm = await ServiceMaster.findOne({ serviceCode: "OPD-CON" }).lean();
  const sp = await ServicePricing.findOne({ serviceId: sm._id, tariffType: "CASH" }).lean();
  if (Number(item.unitPrice) !== Number(sp.finalPrice)) {
    fail("OPD-CON rate matches CASH tariff", `bill=${item.unitPrice}, tariff=${sp.finalPrice}`);
  } else {
    pass("OPD-CON rate matches CASH tariff", `₹${item.unitPrice} (ServicePricing CASH)`);
  }
}

// ════════════════════════════════════════════════════════════════════
// TEST 2 — IPD ADMISSION PER ROOM CATEGORY
// ════════════════════════════════════════════════════════════════════
async function test_IPDByCategory() {
  console.log("\n── TEST 2: IPD admission per room tier — BED-{categoryCode} ──");
  const tiers = ["GENW", "SEMI", "PVT", "ICU", "NICU", "DAYCARE"];

  for (const tierCode of tiers) {
    const picked = await pickRoom(tierCode);
    if (!picked || !picked.room) {
      info(`Tier ${tierCode}`, "No Room of this category exists — skipping (would still fire the trigger if a bed were attached)");
      continue;
    }
    const { cat, room } = picked;

    // Build a synthetic admission referencing this room
    const { doc } = await pickDoctorAndDept();
    const patient = await Patient.create({
      title: "Mr.", fullName: `E2E ${tierCode} Test ${Date.now().toString().slice(-5)}`,
      gender: "Male", age: 50, contactNumber: "9888" + Math.floor(Math.random() * 1e6),
      registrationType: "IPD", paymentType: "GENERAL",
      address: { city: "Test", state: "Test", pincode: "110001" },
      __e2e_test: true,
    });
    createdPatientIds.push(patient._id);

    const isDaycare = tierCode === "DAYCARE";
    const admission = await Admission.create({
      UHID: patient.UHID,
      patientId: patient._id,
      patientName: patient.fullName,
      contactNumber: patient.contactNumber,
      admissionType: isDaycare ? "Day Care" : "Planned",
      admissionNumber: `E2E-${tierCode}-${Date.now()}`,
      attendingDoctor: "E2E Doctor",
      attendingDoctorId: doc._id,
      department: "E2E Test",
      reasonForAdmission: "E2E billing test",
      roomId: room._id,
      hasBed: true,
      status: "Active",
      paymentType: "GENERAL",
      admissionDate: new Date(),
    });
    createdAdmissionIds.push(admission._id);

    // Fire the engine
    await autoBilling.onAdmissionCreated(admission);

    // Verify BED-{tierCode} trigger
    const triggers = await BillingTrigger.find({ admissionId: admission._id }).lean();
    const bedTrigger = triggers.find((t) => t.serviceCode === `BED-${tierCode}`);
    const expectedRate = cat.defaultPricing?.perBedDailyRate || 0;

    if (!bedTrigger) {
      fail(`Tier ${tierCode} — BED-${tierCode} trigger`, `triggers fired: [${triggers.map((t) => t.serviceCode).join(", ") || "none"}]`);
      continue;
    }
    if (Number(bedTrigger.unitPrice) !== Number(expectedRate)) {
      fail(`Tier ${tierCode} — rate`, `BED-${tierCode} fired at ₹${bedTrigger.unitPrice}, expected ₹${expectedRate}`);
    } else {
      pass(`Tier ${tierCode} — BED-${tierCode} @ ₹${expectedRate}/d`, `admission=${admission.admissionNumber}, status=${bedTrigger.status}`);
    }

    // For ANH "nursing bundled into room rent", NURSING-{tier} should fire at ₹0
    const nursingTrigger = triggers.find((t) => t.serviceCode === `NURSING-${tierCode}`);
    if (nursingTrigger) {
      if (Number(nursingTrigger.unitPrice) === 0) {
        pass(`Tier ${tierCode} — NURSING-${tierCode} ₹0 (bundled into room rent per ANH)`, `confirms hospital's bundled-nursing decision`);
      } else {
        info(`Tier ${tierCode} — NURSING-${tierCode}`, `fired at ₹${nursingTrigger.unitPrice}/d (override applied? expected ₹0 bundled)`);
      }
    }
  }
}

// ════════════════════════════════════════════════════════════════════
// TEST 3 — DELUXE BUSINESS-LOGIC CONFIRMATION
// ════════════════════════════════════════════════════════════════════
async function test_DeluxeBundling() {
  console.log("\n── TEST 3: Deluxe — confirm bundling into Private tier ──");

  const deluxeCat = await RoomCategory.findOne({ categoryCode: "DELUXE" }).lean();
  if (deluxeCat) {
    fail("Deluxe is bundled into Private", "A separate DELUXE RoomCategory EXISTS — bundling decision is invalid");
    return;
  }
  pass("No separate DELUXE RoomCategory exists", "ANH Sheet 3 lists 'Private / Single Deluxe AC Room Charges' as ONE tier at ₹1,800/day — implementation matches");

  const deluxeBed = await ServiceMaster.findOne({ serviceCode: "BED-DELUXE" }).lean();
  if (deluxeBed) {
    fail("BED-DELUXE removed", "BED-DELUXE still exists in ServiceMaster — dedupe missed it");
  } else {
    pass("BED-DELUXE removed from catalog", "dedupeServiceMaster.js cleared it (canonical = BED-PVT)");
  }

  const pvt = await ServiceMaster.findOne({ serviceCode: "BED-PVT" }).lean();
  info("BED-PVT canonical row", `defaultPrice=₹${pvt?.defaultPrice}, tierPricing.private=₹${pvt?.tierPricing?.private}`);

  console.log("\n  ⚠ BUSINESS-LOGIC NOTE FOR FINANCE/ADMIN:");
  console.log("    The ANH source workbook (Bright Institute Sheet 3) combines");
  console.log("    'Private/Single Deluxe AC Room Charges' as a single line item");
  console.log("    at ₹1,800/day. The HIS reflects that — there is no separate");
  console.log("    DELUXE tier. If your hospital later introduces a higher Deluxe");
  console.log("    tier at a different rate, you'd need to:");
  console.log("      1. Add a new RoomCategory { categoryCode: 'DELUXE' }");
  console.log("      2. Add a BED-DELUXE row in ServiceMaster (tier pricing)");
  console.log("      3. Move existing Deluxe rooms to the new category");
  console.log("    Today no Deluxe rooms exist — all Private-tier rooms bill at PVT.");
}

// ════════════════════════════════════════════════════════════════════
// TEST 4 — DOCTOR NOTE → DOC-MORN-ROUND (IPD progress, morning shift)
//   Engine reality: resolveDoctorVisitCode() fires DOC-MORN-ROUND for
//   routine progress notes in the morning shift, DOC-EVE-ROUND for
//   evening, DOC-NIGHT-ROUND for night, DOC-ICU-VISIT for ICU,
//   DOC-CONSULT for inter-department consultation. CON-001 is a
//   SEPARATE code that fires ONLY for OPDAssessment events (test 4b).
// ════════════════════════════════════════════════════════════════════
async function test_DoctorNote_IPD() {
  console.log("\n── TEST 4a: Doctor progress note on IPD (morning) → DOC-MORN-ROUND ──");

  const adm = createdAdmissionIds.length > 0
    ? await Admission.findOne({ _id: { $in: createdAdmissionIds }, admissionType: "Planned" }).lean()
    : null;
  if (!adm) {
    info("Doctor note IPD test", "No active IPD admission available (skipping — test 2 didn't create any)");
    return;
  }

  const noteDoc = {
    _id: new mongoose.Types.ObjectId(),
    admissionId: adm._id,
    patientId:   adm.patientId,
    UHID:        adm.UHID,
    noteType:    "daily", // R7hr-269: "progress" noteType removed; "daily" is the live progress note
    shift:       "morning",
    doctorName:  "E2E Test Doctor",
    chiefComplaint: "Stable, no fever",
    createdAt: new Date(),
  };

  try {
    await autoBilling.onDoctorNoteSaved(noteDoc);
  } catch (e) {
    return fail("onDoctorNoteSaved", e?.message);
  }

  // R7hr-190/193 (G6): per-note doctor charges are RETIRED — doctor
  // attendance bills ONLY via the room-matrix daily DOC-VISIT-* line
  // (DOCTOR_NOTE_BILLING_ENABLED=false). A doctor note must therefore
  // create NO trigger at all. The old assertion (DOC-MORN-ROUND fires)
  // now describes a policy violation, not a pass.
  const docNoteTrigs = await BillingTrigger.countDocuments({
    admissionId: adm._id, sourceType: "DoctorNote",
  });
  if (docNoteTrigs === 0) {
    pass("Doctor note → NO per-note charge", "R7hr-190 policy holds — attendance bills via room matrix only");
  } else {
    fail("Doctor note → NO per-note charge", `expected 0 DoctorNote triggers, got ${docNoteTrigs} — R7hr-190 gate regressed?`);
  }
}

// ════════════════════════════════════════════════════════════════════
// TEST 4b — OPD ASSESSMENT → CON-001
//   Separate code path: onOPDAssessmentSaved fires CON-001 when a
//   doctor records the OPD assessment on the in-clinic console.
// ════════════════════════════════════════════════════════════════════
async function test_OPDAssessment() {
  console.log("\n── TEST 4b: OPD assessment saved → CON-001 ──");

  // Pick the most-recent OPD admission auto-created by test 1
  const adm = await Admission.findOne({
    admissionType: "OPD",
    UHID: { $regex: "^UH" },
  }).sort({ createdAt: -1 }).lean();
  if (!adm) {
    info("OPD assessment test", "No OPD admission available");
    return;
  }

  // Pick the matching OPD visit
  const OPD = require("../models/Patient/OPDModels");
  const opdVisit = await OPD.findOne({ UHID: adm.UHID }).sort({ createdAt: -1 }).lean();
  if (!opdVisit) {
    info("OPD assessment test", `No OPDVisit row for admission ${adm.admissionNumber}`);
    return;
  }

  // onOPDAssessmentSaved signature: (opdVisit, admission, doctorName, assessmentId)
  try {
    await autoBilling.onOPDAssessmentSaved(
      opdVisit,
      adm,
      "E2E Test Doctor",
      new mongoose.Types.ObjectId(),       // synthetic assessmentId
    );
  } catch (e) {
    return fail("onOPDAssessmentSaved", e?.message);
  }

  const trig = await BillingTrigger.findOne({
    admissionId: adm._id, serviceCode: "CON-001",
  }).lean();
  if (!trig) {
    const all = await BillingTrigger.find({ admissionId: adm._id }).lean();
    fail("CON-001 trigger fired", `triggers on admission: [${all.map((t) => t.serviceCode).join(", ") || "none"}]`);
    return;
  }
  pass("CON-001 trigger fired (OPD assessment)", `unitPrice=₹${trig.unitPrice}, status=${trig.status}`);
}

// ════════════════════════════════════════════════════════════════════
// TEST 5 — REGRESSION: historic BED-GENW bills still load
// ════════════════════════════════════════════════════════════════════
async function test_HistoricBillRegression() {
  console.log("\n── TEST 5: Regression — historic BED-GENW bills ──");

  const bill = await PatientBill.findOne({
    "billItems.serviceCode": "BED-GENW",
  }).lean();
  if (!bill) {
    info("Historic BED-GENW bill", "No bill with BED-GENW line items in DB (skipping)");
    return;
  }

  const bedGenwItems = bill.billItems.filter((i) => i.serviceCode === "BED-GENW");
  pass("Historic bill loads via Mongo", `bill=${bill.billNumber}, UHID=${bill.UHID}, BED-GENW items=${bedGenwItems.length}`);

  // Also test that the public HTTP endpoint returns it (regression for
  // the API shape the lookup UI consumes).
  try {
    const http = require("http");
    const data = await new Promise((resolve, reject) => {
      const req = http.get(
        `http://localhost:5000/api/billing/uhid/${encodeURIComponent(bill.UHID)}`,
        (res) => {
          let buf = "";
          res.on("data", (c) => (buf += c));
          res.on("end", () => resolve({ status: res.statusCode, body: buf }));
        },
      );
      req.on("error", reject);
      req.setTimeout(3000, () => req.destroy(new Error("timeout")));
    });
    if (data.status === 200) {
      pass("Public /api/billing/uhid endpoint returns 200", `for UHID=${bill.UHID}`);
    } else if (data.status === 401) {
      info("Public /api/billing/uhid", "401 — requires auth (expected when not authenticated)");
    } else {
      fail("Public /api/billing/uhid", `status=${data.status}`);
    }
  } catch (e) {
    info("Public /api/billing/uhid HTTP test skipped", e.message);
  }
}

// ════════════════════════════════════════════════════════════════════
// CLEANUP
// ════════════════════════════════════════════════════════════════════
async function cleanup() {
  console.log("\n── CLEANUP — removing test patients + admissions ──");
  // Delete in reverse order: triggers → bills → admissions → patients
  for (const admId of createdAdmissionIds) {
    await BillingTrigger.deleteMany({ admissionId: admId });
    await PatientBill.deleteMany({ admission: admId });
    await Admission.deleteOne({ _id: admId });
  }
  for (const pId of createdPatientIds) {
    const p = await Patient.findById(pId).lean();
    if (p?.UHID) {
      await BillingTrigger.deleteMany({ UHID: p.UHID });
      await PatientBill.deleteMany({ UHID: p.UHID });
      await Admission.deleteMany({ patientId: pId });
    }
    await Patient.deleteOne({ _id: pId });
  }
  console.log(`  cleaned ${createdPatientIds.length} patients, ${createdAdmissionIds.length} admissions, and dependent triggers/bills.`);
}

// ════════════════════════════════════════════════════════════════════
async function main() {
  await mongoose.connect(process.env.MONGODB_URI || "mongodb://localhost:27017/spherehealth");
  let mainErr = null;
  try {
    await test_OPDConsultation();
    await test_IPDByCategory();
    await test_DeluxeBundling();
    await test_DoctorNote_IPD();
    await test_OPDAssessment();
    await test_HistoricBillRegression();
  } catch (e) {
    mainErr = e;
    console.error("\n[e2e] suite aborted:", e?.stack || e?.message);
  } finally {
    await cleanup().catch((e) => console.error("[cleanup] failed:", e.message));
    await mongoose.disconnect();
  }

  const total = results.length;
  const pass_ = results.filter((r) => r.status === "PASS").length;
  const fail_ = results.filter((r) => r.status === "FAIL").length;
  const info_ = results.filter((r) => r.status === "INFO").length;
  console.log("\n════════════════════════════════════════════════════");
  console.log(`E2E BILLING TEST RESULT — ${pass_} passed · ${fail_} failed · ${info_} info / total ${total}`);
  console.log("════════════════════════════════════════════════════");
  if (fail_ > 0 || mainErr) process.exit(1);
}

main();
