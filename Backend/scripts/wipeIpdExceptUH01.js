// scripts/wipeIpdExceptUH01.js
// ════════════════════════════════════════════════════════════════════
// R7hr-91 — Wipe all IPD data EXCEPT UH01 (Badal Sharma).
//
// Preserves UH01 patient + all linked admissions/notes/bills/etc.
// Wipes every IPD-touching row that does NOT point to UH01 or any of
// UH01's admissions. Catalog data (drugs, services, tariffs, hospital
// settings, users) is untouched.
//
// Default --dry. Pass --apply to actually delete.
// ════════════════════════════════════════════════════════════════════

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const mongoose = require("mongoose");

const APPLY = process.argv.includes("--apply");
const KEEP_UHID = "UH01";

// Lazy-load every model the existing wipe script touches; skip silently
// when a path is missing so the script doesn't crash on a project rename.
const MODEL_PATHS = [
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
  "../models/Doctor/DoctorNotesModel",
  "../models/Doctor/DoctorOrderModel",
  "../models/Doctor/prescription",
  "../models/Doctor/treatmentChartModel",
  "../models/Nurse/NurseNotesModel",
  "../models/Nurse/NursingAssessmentModel",
  "../models/Nurse/shiftHandoverModel",
  "../models/Pharmacy/PharmacyIndentModel",
  "../models/Pharmacy/PharmacySaleModel",
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
  "../models/MLC/MLCReportModel",
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
];

(async () => {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || "mongodb://127.0.0.1:27017/spherehealth";
  console.log(`[wipeIpdExceptUH01] mode=${APPLY ? "APPLY (will delete)" : "DRY-RUN (no writes)"}`);
  console.log(`[wipeIpdExceptUH01] keep UHID = ${KEEP_UHID}`);
  console.log(`[wipeIpdExceptUH01] connecting to ${uri}`);
  await mongoose.connect(uri);

  // Register every model so mongoose.models is populated.
  for (const p of MODEL_PATHS) {
    try { require(p); } catch (_) { /* skip missing */ }
  }

  // Resolve keeper IDs
  const Patient = mongoose.models.Patient;
  const Admission = mongoose.models.Admission;
  if (!Patient || !Admission) {
    console.error("[wipeIpdExceptUH01] FATAL — Patient or Admission model not registered. Aborting.");
    process.exit(1);
  }

  const keeperPatient = await Patient.findOne({ UHID: KEEP_UHID }).lean();
  if (!keeperPatient) {
    console.error(`[wipeIpdExceptUH01] FATAL — patient ${KEEP_UHID} not found. Aborting so we don't blanket-wipe.`);
    process.exit(1);
  }
  const keeperPatientId = keeperPatient._id;

  const keeperAdmissions = await Admission.find({
    $or: [
      { UHID: KEEP_UHID },
      { patientUHID: KEEP_UHID },
      { patientId: keeperPatientId },
    ],
  }).select("_id ipdNo admissionNumber").lean();
  const keeperAdmissionIds = keeperAdmissions.map(a => a._id);
  const keeperIpdNos = keeperAdmissions.map(a => a.ipdNo || a.admissionNumber).filter(Boolean);

  console.log(`\n  keeper patient _id  : ${keeperPatientId}`);
  console.log(`  keeper admissions    : ${keeperAdmissions.length}  (${keeperIpdNos.join(", ") || "—"})`);

  // Build a "kill UNLESS keeper" $nor filter for generic IPD rows.
  // A row survives if ANY of these match — kills the rest.
  function killFilter() {
    return {
      $nor: [
        { UHID: KEEP_UHID },
        { patientUHID: KEEP_UHID },
        { patientId: keeperPatientId },
        ...(keeperAdmissionIds.length ? [{ admissionId: { $in: keeperAdmissionIds } }] : []),
        ...(keeperIpdNos.length       ? [{ ipdNo: { $in: keeperIpdNos } }] : []),
      ],
    };
  }

  // Walk every registered model. For Patient and Admission, kill all
  // NOT pointing to the keeper. For everything else, use the $nor
  // filter — if any of the identifying fields don't exist on the
  // schema, MongoDB just ignores them (no match → row survives only
  // if it matched another keeper key).
  const report = [];
  const knownNames = Object.keys(mongoose.models);

  for (const name of knownNames) {
    const M = mongoose.models[name];
    let filter;
    if (name === "Patient") {
      filter = { _id: { $ne: keeperPatientId } };
    } else if (name === "Admission") {
      filter = { _id: { $nin: keeperAdmissionIds } };
    } else {
      // skip catalog / settings / user collections
      if (/User|Role|Permission|Settings|HospitalSettings|Drug(?!Order)|DrugMaster|Service|Doctor(?!Notes|Order|Charges)|Counter|Brand|Manufacturer|Vendor(?!Return)|Room|Bed(?!Transfer)|Ward|Department|Holiday|Inventory|Stock(?!Take)|GRN|PO|PurchaseOrder|Tariff|Pricing|HSN|Email|SMS|Audit|Cron|Log(?!Patient)/i.test(name)) {
        continue;
      }
      filter = killFilter();
    }
    try {
      const matchCount = await M.countDocuments(filter);
      if (matchCount === 0) continue;
      if (APPLY) {
        const res = await M.deleteMany(filter);
        report.push({ name, matched: matchCount, deleted: res.deletedCount });
      } else {
        report.push({ name, matched: matchCount, deleted: "(dry)" });
      }
    } catch (err) {
      report.push({ name, error: err.message });
    }
  }

  console.log("\n────────────────────────────────────────────────────────");
  console.log(`WIPE REPORT  (mode=${APPLY ? "APPLIED" : "DRY"}) — keep UHID=${KEEP_UHID}`);
  console.log("────────────────────────────────────────────────────────");
  let total = 0;
  for (const r of report) {
    if (r.error) {
      console.log(`  ${r.name.padEnd(36)}  ERROR  · ${r.error.slice(0,60)}`);
    } else {
      total += r.matched;
      console.log(`  ${r.name.padEnd(36)}  matched: ${String(r.matched).padStart(5)}   deleted: ${r.deleted}`);
    }
  }
  console.log("────────────────────────────────────────────────────────");
  console.log(`  TOTAL matched (would-be-deleted): ${total}`);

  if (!APPLY) {
    console.log("\nTo apply for real:  node Backend/scripts/wipeIpdExceptUH01.js --apply");
  } else {
    console.log("\nDone. UH01 (Badal Sharma) + every linked row preserved.");
  }

  await mongoose.disconnect();
})().catch(err => {
  console.error("[wipeIpdExceptUH01] FATAL:", err);
  process.exit(1);
});
