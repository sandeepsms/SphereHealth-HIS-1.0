// scripts/wipePatientData.js
// ════════════════════════════════════════════════════════════════════
// R7dc — Full patient-data clean slate.
//
// CONTEXT:
//   For testing the pharmacy + IPD credit + reception workflows from
//   scratch, we need to wipe every patient-touching collection while
//   preserving the catalog (drugs, services, tariffs), users, and
//   hospital/pharmacy settings. After running this the system looks
//   like Day 0 — no patients, no admissions, no bills, no inventory
//   drain (batch.remaining restored to received qty), counters reset.
//
// SCOPE — WIPED (dropped to empty):
//   ┌─ Patient master ─────────────────────────────────────────
//   │ Patient
//   │
//   ├─ Visits / admissions ───────────────────────────────────
//   │ Admission, BedTransfer
//   │ OPDRegistration, Emergency
//   │ Appointment
//   │
//   ├─ Billing ledger ────────────────────────────────────────
//   │ PatientBill, AutoBilledItems, PatientAdvance
//   │ BillingTrigger, BillingAudit, CreditNote
//   │ CashierSession, GstMonthlySnapshot
//   │ PrintAudit, IdempotencyLog
//   │
//   ├─ Doctor / Nurse clinical ───────────────────────────────
//   │ DoctorOrder, DoctorNotes, Prescription, TreatmentChart
//   │ NurseNotes, NursingAssessment, ShiftHandover
//   │ MAR, IntakeOutputEntry, MedReconciliation
//   │ PhysioPlan, PhysioSession
//   │ ConsentForm, DischargeSummary
//   │ CriticalValueAlert, AdverseFoodReaction
//   │ PatientActivityLog
//   │ VitalSheet (legacy "Vital" too)
//   │ InvestigationOrder
//   │ MLCReport
//   │ VisitorPass
//   │
//   ├─ Pharmacy transactional ────────────────────────────────
//   │ PharmacyIndent, PharmacySale
//   │ PharmacyVendorReturn, PharmacyStockTake
//   │ PharmacyDayClose
//   │ ScheduleXEntry, ScheduleXBalance
//   │ ADRReport, IdempotencyMap
//   │
//   ├─ NABH / Compliance per-patient registers ──────────────
//   │ EmergencyRegister, MortalityRegister
//   │ AntimicrobialUseRegister, ASARegister
//   │ BloodSugarRegister, BloodTransfusionRegister
//   │ BmwTransportManifest, DVTRegister, FallRiskRegister
//   │ OTRegister, PainAssessmentRegister
//   │ PressureUlcerRegister, ReadmissionRegister
//   │ RestraintRegister, CodeResponseEvent
//   │ ClinicalAudit
//   │
//   └─ Ward / housekeeping per-patient ────────────────────────
//     WardTask, CleaningTask, SpillageIncident
//
// SCOPE — RESET (not deleted, but zero'd):
//   • Beds         — clear assignedPatient / patientName / assignedAt
//                    set status:"available"
//   • PharmacyDrugBatch — restore remaining = received (undo all dispense)
//   • Counter      — reset every counter doc.seq to 0 so the next bill
//                    number / admission number / sale number starts at 1
//
// SCOPE — PRESERVED (untouched):
//   • User, Doctor, NurseStaff, Emergency_doctor (staff accounts)
//   • PharmacyDrug, PharmacySupplier (drug catalog + suppliers)
//   • ServiceMaster, ServicePricing (service catalog + tariffs)
//   • TPA, TPAServices, Corporate (TPA + corporate master)
//   • HospitalSettings, PharmacySettings
//   • Departments, Ward, Building, Floor, RoomCategory, Room
//   • Beds rows themselves (just reset status/assignment fields)
//   • EquipmentLog, ChemicalInventory, AreaCleaningLog, PestControlSchedule
//   • InvestigationMaster, InvestigationPricing
//   • RolePermissions / Credential master data
//   • FireDrill, EquipmentModel
//   • GateLog, IncidentReport, SharpsInjury, Grievance (org-wide logs,
//     unrelated to specific patients)
//
// USAGE:
//   node Backend/scripts/wipePatientData.js          # DRY-RUN — counts only
//   node Backend/scripts/wipePatientData.js --apply  # actually wipe
//
// SAFETY:
//   • DRY-RUN is the default.
//   • A second confirmation prompt fires when --apply is set (reads
//     "YES" on stdin) unless --yes-i-am-sure is also passed.
//   • BACKUP YOUR DB FIRST. There is no soft-delete here — collections
//     are emptied via deleteMany({}). Run `mongodump` or use the
//     scripts/backup-mongo.sh helper before executing with --apply.
//   • Production DBs: refuse to run unless ALLOW_PROD_WIPE=1 env set
//     (no one should ever run this against prod; this guard is belt+
//     suspenders for the case where someone clones the script and
//     accidentally points DOTENV at a prod URI).
// ════════════════════════════════════════════════════════════════════

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const mongoose = require("mongoose");
const readline = require("readline");

const APPLY    = process.argv.includes("--apply");
const YES_SURE = process.argv.includes("--yes-i-am-sure");
const VERBOSE  = process.argv.includes("--verbose");

const log  = (...a) => console.log(...a);
const logv = (...a) => { if (VERBOSE) console.log(...a); };

// ── Mode banner ──────────────────────────────────────────────
const MODE = APPLY ? "APPLY" : "DRY-RUN";
const BANNER = APPLY
  ? "\x1b[1;41;37m  APPLY MODE — collections WILL be wiped  \x1b[0m"
  : "\x1b[1;42;30m  DRY-RUN MODE — no changes will be made  \x1b[0m";

// ── Production-DB guard ──────────────────────────────────────
function refuseIfProd(uri) {
  if (process.env.ALLOW_PROD_WIPE === "1") return;
  const u = String(uri || "");
  const looksProd =
    /(?:^|[^a-z])prod(?:uction)?(?:[^a-z]|$)/i.test(u)
    || /(?:^|[^a-z])(?:live|prd)(?:[^a-z]|$)/i.test(u);
  if (looksProd) {
    log("\x1b[1;41;37m  REFUSING TO RUN — MongoDB URI looks like production  \x1b[0m");
    log("  URI: " + u.replace(/:[^@]+@/, ":***@"));
    log("  Set ALLOW_PROD_WIPE=1 to override (you really shouldn't).");
    process.exit(2);
  }
}

// ── Models we'll touch. Loaded lazily so any missing model just
//    no-ops instead of crashing the whole wipe. ─────────────────
function loadModels() {
  // Side-effect requires — registers the models with mongoose.
  const requires = [
    "../models/Patient/patientModel",
    "../models/Patient/admissionModel",
    "../models/Patient/bedTransferModel",
    "../models/Patient/emergencyModel",
    "../models/Patient/OPDModels",
    "../models/PatientBillModel/PatientBillModel",
    "../models/PatientBillModel/PatientAdvanceModel",
    "../models/PatientBillModel/AutoBilledItemsModel",
    "../models/Billing/BillingTrigger",
    "../models/Billing/BillingAudit",
    "../models/Billing/CashierSession",
    "../models/Billing/CreditNote",
    "../models/Billing/PrintAuditModel",
    "../models/Billing/IdempotencyLogModel",
    "../models/Billing/GstMonthlySnapshot",
    "../models/Doctor/DoctorNotesModel",
    "../models/Doctor/DoctorOrderModel",
    "../models/Doctor/prescription",
    "../models/Doctor/treatmentChartModel",
    "../models/Nurse/NurseNotesModel",
    "../models/Nurse/NursingAssessmentModel",
    "../models/Nurse/shiftHandoverModel",
    "../models/Pharmacy/PharmacyIndentModel",
    "../models/Pharmacy/PharmacySaleModel",
    "../models/Pharmacy/PharmacyDayCloseModel",
    "../models/Pharmacy/PharmacyVendorReturnModel",
    "../models/Pharmacy/StockTakeModel",
    "../models/Pharmacy/ScheduleXEntryModel",
    "../models/Pharmacy/ScheduleXBalanceModel",
    "../models/Pharmacy/ADRReportModel",
    "../models/Pharmacy/IdempotencyMapModel",
    "../models/Pharmacy/DrugBatchModel",
    "../models/Pharmacy/DrugModel",
    "../models/Clinical/ConsentFormModel",
    "../models/Clinical/DischargeSummaryModel",
    "../models/Clinical/IntakeOutputEntryModel",
    "../models/Clinical/MARModel",
    "../models/Clinical/MedReconciliationModel",
    "../models/Clinical/PhysioPlanModel",
    "../models/Clinical/PhysioSessionModel",
    "../models/Clinical/CriticalValueAlertModel",
    "../models/Clinical/AdverseFoodReactionModel",
    "../models/Clinical/PatientActivityLogModel",
    "../models/Clinical/WardTaskModel",
    "../models/Clinical/housekeepingModels",
    "../models/MLC/MLCReportModel",
    "../models/CounterModel",
    "../models/Vitals/vitalSheetModel",
    "../models/vital/vital",
    "../models/VisitorPass/visitorPassModel",
    "../models/Investigation/InvestigationOrderModel",
    "../models/Appointment/appointmentModel",
    "../models/Compliance/EmergencyRegisterModel",
    "../models/Compliance/MortalityRegisterModel",
    "../models/Compliance/AntimicrobialUseRegisterModel",
    "../models/Compliance/ASARegisterModel",
    "../models/Compliance/BloodSugarRegisterModel",
    "../models/Compliance/BloodTransfusionRegisterModel",
    "../models/Compliance/BmwTransportManifestModel",
    "../models/Compliance/DVTRegisterModel",
    "../models/Compliance/FallRiskRegisterModel",
    "../models/Compliance/OTRegisterModel",
    "../models/Compliance/PainAssessmentRegisterModel",
    "../models/Compliance/PressureUlcerRegisterModel",
    "../models/Compliance/ReadmissionRegisterModel",
    "../models/Compliance/RestraintRegisterModel",
    "../models/Compliance/CodeResponseEventModel",
    "../models/Compliance/ClinicalAuditModel",
    "../models/bedMgmt/bedsModel",
  ];
  for (const path of requires) {
    try { require(path); }
    catch (e) { logv(`  (skip ${path}: ${e.message})`); }
  }
}

// ── Collection groups ────────────────────────────────────────
const WIPE_MODELS = [
  // Patient master + visits
  "Patient", "Admission", "BedTransfer", "Emergency", "OPDRegistration", "Appointment",
  // Billing
  "PatientBill", "PatientAdvance", "AutoBilledItems",
  "BillingTrigger", "BillingAudit", "CashierSession", "CreditNote",
  "PrintAudit", "IdempotencyLog", "GstMonthlySnapshot",
  // Doctor / Nurse clinical
  "DoctorOrder", "DoctorNotes", "Prescription", "TreatmentChart",
  "NurseNotes", "NursingAssessment", "ShiftHandover",
  "MAR", "IntakeOutputEntry", "MedReconciliation",
  "PhysioPlan", "PhysioSession",
  "ConsentForm", "DischargeSummary",
  "CriticalValueAlert", "AdverseFoodReaction",
  "PatientActivityLog",
  "VitalSheet",
  "InvestigationOrder",
  "MLCReport", "VisitorPass",
  // Pharmacy transactional
  "PharmacyIndent", "PharmacySale",
  "PharmacyVendorReturn", "PharmacyStockTake",
  "PharmacyDayClose",
  "ScheduleXEntry", "ScheduleXBalance",
  "ADRReport", "IdempotencyMap",
  // NABH / compliance per-patient
  "EmergencyRegister", "MortalityRegister",
  "AntimicrobialUseRegister", "ASARegister",
  "BloodSugarRegister", "BloodTransfusionRegister",
  "BmwTransportManifest", "DVTRegister", "FallRiskRegister",
  "OTRegister", "PainAssessmentRegister",
  "PressureUlcerRegister", "ReadmissionRegister",
  "RestraintRegister", "CodeResponseEvent",
  "ClinicalAudit",
  // Ward housekeeping per-patient
  "WardTask", "CleaningTask", "SpillageIncident",
];

const PRESERVED_HINT = [
  "User", "Doctor", "NurseStaff", "Emergency_doctor",
  "PharmacyDrug", "PharmacySupplier", "PharmacySettings",
  "ServiceMaster", "ServicePricing",
  "TPA", "TPAServices", "Corporate",
  "HospitalSettings", "Department",
  "Ward", "Building", "Floor", "RoomCategory", "Room",
  "InvestigationMaster", "InvestigationPricing",
];

async function main() {
  log("\n══════════════════════════════════════════════════");
  log("  R7dc — Wipe Patient Data — ", BANNER);
  log("══════════════════════════════════════════════════\n");

  const uri = process.env.MONGO_URI;
  if (!uri) {
    log("MONGO_URI not set. Aborting.");
    process.exit(1);
  }
  refuseIfProd(uri);

  log(`  URI: ${uri.replace(/:[^@]+@/, ":***@")}`);
  log(`  Mode: ${MODE}`);
  log("");

  // ── Confirmation prompt for --apply ──────────────────────
  if (APPLY && !YES_SURE) {
    log("\x1b[33m  This will PERMANENTLY DELETE every patient, admission,");
    log("  visit, bill, indent, sale, audit row in this database.\x1b[0m");
    log("\x1b[33m  Have you taken a mongodump backup?\x1b[0m");
    log("");
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise(r => rl.question("  Type the word \"WIPE\" to confirm: ", r));
    rl.close();
    if (String(answer).trim() !== "WIPE") {
      log("\n  Confirmation failed — exiting without changes.");
      process.exit(0);
    }
  }

  await mongoose.connect(uri);
  log(`  Connected to MongoDB.`);
  log("");

  loadModels();

  // ── Phase 1: Wipe counts (dry-run prints; apply deletes) ──
  log("─── Phase 1: Wipe transactional + patient master ───\n");
  let grandWiped = 0;
  for (const name of WIPE_MODELS) {
    const M = mongoose.models[name];
    if (!M) { logv(`  · ${name} — model not registered, skip`); continue; }
    let n;
    try { n = await M.estimatedDocumentCount(); }
    catch (e) { logv(`  · ${name} — count failed: ${e.message}`); continue; }
    if (n === 0) { logv(`  · ${name} — empty, skip`); continue; }
    if (APPLY) {
      const r = await M.deleteMany({});
      log(`  · ${name.padEnd(30)} wiped ${String(r.deletedCount).padStart(6)} rows`);
      grandWiped += r.deletedCount;
    } else {
      log(`  · ${name.padEnd(30)} would wipe ${String(n).padStart(6)} rows`);
      grandWiped += n;
    }
  }
  log(`\n  Total ${APPLY ? "wiped" : "would wipe"}: ${grandWiped} rows`);

  // ── Phase 2: Reset bed status to available ────────────────
  log("\n─── Phase 2: Reset bed status → available ───\n");
  const Beds = mongoose.models.Beds;
  if (Beds) {
    const occCount = await Beds.countDocuments({
      $or: [
        { status: { $in: ["Occupied", "Cleaning", "Reserved"] } },
        { assignedPatient: { $ne: null } },
        { patientName:     { $exists: true, $ne: null, $ne: "" } },
      ],
    });
    if (APPLY) {
      const r = await Beds.updateMany(
        {},
        {
          $set: {
            status: "Available",
            assignedPatient: null,
            patientName: "",
            patientUHID: "",
            patientGender: "",
            patientAge: null,
            admissionId: null,
            admissionDate: null,
            consultantDoctor: "",
            primaryConsultant: "",
            cleaningStartedAt: null,
            cleaningCompletedAt: null,
          },
          $unset: {
            currentPatient: "",
          },
        },
      );
      log(`  · Beds reset to Available — ${r.modifiedCount} rows`);
    } else {
      log(`  · ${occCount} beds would be reset to Available`);
    }
  } else {
    log("  · Beds model not registered, skip");
  }

  // ── Phase 3: Reset PharmacyDrugBatch.remaining = received ──
  log("\n─── Phase 3: Restore pharmacy stock (batch.remaining = received) ───\n");
  const DrugBatch = mongoose.models.PharmacyDrugBatch;
  if (DrugBatch) {
    const batchCount = await DrugBatch.estimatedDocumentCount();
    if (APPLY) {
      // received is a Number on the schema. We use updateMany with an
      // aggregation pipeline so each row sets remaining to its OWN
      // received qty (not a fixed value).
      const r = await DrugBatch.updateMany(
        {},
        [{ $set: { remaining: "$received" } }],
      );
      log(`  · DrugBatch remaining=received reset — ${r.modifiedCount}/${batchCount} rows`);
    } else {
      log(`  · ${batchCount} drug batches would have remaining reset to received`);
    }
  } else {
    log("  · PharmacyDrugBatch model not registered, skip");
  }

  // ── Phase 4: Reset Counter.seq to 0 ───────────────────────
  log("\n─── Phase 4: Reset bill/admission/visit/sale counters → 0 ───\n");
  const Counter = mongoose.models.Counter;
  if (Counter) {
    const counterCount = await Counter.estimatedDocumentCount();
    if (APPLY) {
      const r = await Counter.updateMany({}, { $set: { seq: 0 } });
      log(`  · Counter.seq reset to 0 — ${r.modifiedCount}/${counterCount} rows`);
    } else {
      // List which counters exist so the user can see what would reset
      const rows = await Counter.find({}).select("_id seq").lean();
      log(`  · ${rows.length} counter docs would reset to seq=0:`);
      for (const c of rows) log(`      ${String(c._id).padEnd(30)} seq ${c.seq} → 0`);
    }
  } else {
    log("  · Counter model not registered, skip");
  }

  // ── Phase 5: Preserved hint ──────────────────────────────
  log("\n─── Phase 5: Preserved (untouched) ───\n");
  log("  These collections were NOT modified by this script:");
  for (const name of PRESERVED_HINT) {
    const M = mongoose.models[name];
    if (!M) continue;
    let n;
    try { n = await M.estimatedDocumentCount(); }
    catch (_) { continue; }
    if (n > 0) log(`  · ${name.padEnd(30)} ${String(n).padStart(6)} rows preserved`);
  }

  log("\n══════════════════════════════════════════════════");
  if (APPLY) {
    log("\x1b[1;42;30m  COMPLETE — patient data wiped successfully  \x1b[0m");
    log("");
    log("  Next steps:");
    log("    1. Restart the backend (so all in-memory caches drop):");
    log("       Stop-Process -Id <node-pid>");
    log("       cd C:\\Spherehealth\\Backend && node index.js");
    log("    2. Hard-refresh the browser (Ctrl+Shift+R) — sessionStorage");
    log("       still holds the JWT but every entity it points at is gone.");
    log("    3. Register a fresh patient via Reception → Register.");
  } else {
    log("\x1b[1;42;30m  DRY-RUN COMPLETE — no changes made  \x1b[0m");
    log("");
    log("  To actually wipe, re-run with --apply:");
    log("    node Backend/scripts/wipePatientData.js --apply");
  }
  log("══════════════════════════════════════════════════\n");

  await mongoose.disconnect();
  process.exit(0);
}

main().catch(e => {
  console.error("\n\x1b[1;41;37m  FATAL  \x1b[0m", e);
  mongoose.disconnect().catch(() => {});
  process.exit(1);
});
