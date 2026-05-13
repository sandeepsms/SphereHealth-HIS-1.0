/**
 * resetPatientData.js
 *
 * Wipes ALL patient-facing transactional data so you can start the
 * end-to-end workflow from a clean slate. Master data (users, doctors,
 * beds, rooms, room categories, service master, hospital settings, TPAs,
 * investigation master, departments) is PRESERVED.
 *
 * Run:  node Backend/scripts/resetPatientData.js
 * Add --confirm to skip the 5-second safety pause:
 *       node Backend/scripts/resetPatientData.js --confirm
 *
 * After running, also free up bed occupancy so admissions can re-use beds:
 *   the script flips every Bed back to status="Available" and clears its
 *   currentPatient / currentAdmission refs.
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const mongoose = require("mongoose");
const connectDB = require("../config/db");

const COLLECTIONS_TO_WIPE = [
  // ── Patient core ──
  ["../models/Patient/patientModel",          "Patient"],
  ["../models/Patient/admissionModel",        "Admission"],
  ["../models/Patient/OPDModels",             "OPDVisit"],          // module exports OPDVisit
  ["../models/Patient/emergencyModel",        "Emergency"],
  ["../models/Patient/bedTransferModel",      "BedTransfer"],
  ["../models/OpdrModel",                     "Opdr"],

  // ── Clinical notes / charts / plans ──
  ["../models/Doctor/DoctorNotesModel",       "DoctorNote"],
  ["../models/Doctor/DoctorOrderModel",       "DoctorOrder"],
  ["../models/Doctor/treatmentChartModel",    "TreatmentChart"],
  ["../models/Nurse/NurseNotesModel",         "NurseNote"],
  ["../models/Nurse/NursingCarePlanModel",    "NursingCarePlan"],
  ["../models/Nurse/NursingAssessmentModel",  "NursingAssessment"],
  ["../models/Nurse/shiftHandoverModel",      "ShiftHandover"],
  ["../models/Vitals/vitalSheetModel",        "VitalSheet"],
  ["../models/Clinical/MARModel",             "MAR"],
  ["../models/Clinical/DischargeSummaryModel","DischargeSummary"],
  ["../models/Clinical/ConsentFormModel",     "ConsentForm"],
  ["../models/Clinical/MedReconciliationModel","MedReconciliation"],
  ["../models/Clinical/PatientActivityLogModel","PatientActivityLog"],

  // ── Investigations (orders + transactional, NOT master) ──
  ["../models/Investigation/InvestigationOrderModel", "InvestigationOrder"],

  // ── Billing transactional ──
  ["../models/PatientBillModel/PatientBillModel",  "PatientBill"],
  ["../models/PatientBillModel/AutoBilledItemsModel","AutoBilledItem"],
  ["../models/Billing/BillingTrigger",             "BillingTrigger"],

  // ── Nursing charges (entries, not master) ──
  // NursingChargeEntry — keep NursingConsumableItem (master)
  // module loaded lazily below to avoid path issues

  // ── MLC + Visitor Pass ──
  ["../models/MLC/MLCReportModel",            "MLCReport"],
  ["../models/VisitorPass/visitorPassModel",  "VisitorPass"],

  // ── Appointments + presence (sessions only) ──
  ["../models/Appointment/appointmentModel",  "Appointment"],
  ["../models/Presence/presenceModel",        "Presence"],
];

// Master collections that are PRESERVED (listed for clarity):
//   User, Doctor, NurseStaff, Bed, Ward, Room, Floor, Building,
//   RoomCategory, ServiceMaster, ServicePricing, HospitalCharges,
//   HospitalSettings, Tpa, TPAServices, InvestigationMaster,
//   InvestigationPricing, NursingConsumableItem, Counter, Department.

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

(async () => {
  console.log("┌─────────────────────────────────────────────────────────");
  console.log("│  Patient Data Reset");
  console.log("│  This will DELETE every patient-facing record. Masters");
  console.log("│  (users, doctors, beds, rooms, services, hospital");
  console.log("│   settings, TPAs, etc.) will be KEPT.");
  console.log("└─────────────────────────────────────────────────────────");

  if (!process.argv.includes("--confirm")) {
    console.log("\nStarting in 5 seconds — Ctrl-C to abort. (Pass --confirm to skip.)\n");
    await wait(5000);
  }

  await connectDB();

  let totalDeleted = 0;
  for (const [path, label] of COLLECTIONS_TO_WIPE) {
    try {
      const Model = require(path);
      const M = typeof Model === "function" ? Model : (Model.default || Object.values(Model)[0]);
      if (!M?.deleteMany) {
        console.warn(`  ! ${label.padEnd(22)} skipped (model not loadable)`);
        continue;
      }
      const r = await M.deleteMany({});
      totalDeleted += r.deletedCount || 0;
      console.log(`  ✓ ${label.padEnd(22)}  ${String(r.deletedCount || 0).padStart(6)} docs deleted`);
    } catch (e) {
      console.warn(`  ! ${label.padEnd(22)} error: ${e.message}`);
    }
  }

  // ── Nursing charge entries (separate path) ──
  try {
    const NursingChargeEntry = require("../models/nursing/NursingChargeEntry");
    const r = await NursingChargeEntry.deleteMany({});
    totalDeleted += r.deletedCount || 0;
    console.log(`  ✓ NursingChargeEntry      ${String(r.deletedCount || 0).padStart(6)} docs deleted`);
  } catch (e) {
    console.warn("  ! NursingChargeEntry skipped:", e.message);
  }

  // ── Free up every Bed: set Available + clear refs ──
  try {
    const Bed = require("../models/bedMgmt/bedsModel");
    const r = await Bed.updateMany({}, {
      $set: { status: "Available" },
      $unset: { currentPatient: "", currentAdmission: "", currentUHID: "", lastOccupiedAt: "" },
    });
    console.log(`  ✓ Bed occupancy reset      ${String(r.modifiedCount || 0).padStart(6)} beds set to Available`);
  } catch (e) {
    console.warn("  ! Bed occupancy reset error:", e.message);
  }

  // ── Reset patient/admission/bill counters so new UHIDs start from #1 ──
  try {
    const Counter = require("../models/CounterModel");
    const COUNTER_KEYS = [
      "patientUHID", "patientId", "uhid",
      "admissionNumber", "ipdNumber",
      "billNumber", "receiptNumber", "invoiceNumber",
      "opdVisit", "opdNumber",
      "investigationOrder", "consentForm",
      "dischargeSummary", "mlcNumber", "visitorPass",
    ];
    const r = await Counter.deleteMany({ name: { $in: COUNTER_KEYS } });
    console.log(`  ✓ Counters reset           ${String(r.deletedCount || 0).padStart(6)} counters cleared`);
  } catch (e) {
    console.warn("  ! Counter reset skipped:", e.message);
  }

  console.log(`\n  Total docs deleted: ${totalDeleted}\n`);
  await mongoose.connection.close();
  process.exit(0);
})().catch((e) => {
  console.error("Reset failed:", e);
  process.exit(1);
});
