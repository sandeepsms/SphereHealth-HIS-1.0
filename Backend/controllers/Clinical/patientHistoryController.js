// controllers/Clinical/patientHistoryController.js
// ═══════════════════════════════════════════════════════════════
// Patient History — two read-only views that the user has been
// asking for:
//
//   1. OPD History per UHID
//      Every OPDRegistration document for a patient, sorted by
//      visitDate DESC, with full assessment payload (HOPI, vitals,
//      examination, diagnosis, prescriptions, advice, follow-up).
//      Used by the "OPD History" tab on /patient-history-view/:uhid.
//
//   2. IPD File per admission (ipdNo OR admissionId OR Mongo _id)
//      Every clinical artefact (doctor notes, nurse notes, vitals,
//      MAR doses, doctor orders, intake/output, consents, MLC,
//      discharge summary, billing triggers) belonging to ONE
//      admission, merged into a single chronological feed sorted
//      ASCENDING (admission day first → discharge last).
//
// Both endpoints are read-only, lean(), safe-fetched (a single
// missing model never blows the whole response), and gated on
// `patient.read` so any clinical role can call them.
// ═══════════════════════════════════════════════════════════════

const Patient            = require("../../models/Patient/patientModel");
const Admission          = require("../../models/Patient/admissionModel");
const OPDRegistration    = require("../../models/Patient/OPDModels");
const DoctorNotes        = require("../../models/Doctor/DoctorNotesModel");
const DoctorOrder        = require("../../models/Doctor/DoctorOrderModel");
const NurseNotes         = require("../../models/Nurse/NurseNotesModel");
const NursingAssessment  = require("../../models/Nurse/NursingAssessmentModel");
const NursingCarePlan    = require("../../models/Nurse/NursingCarePlanModel");
const ShiftHandover      = require("../../models/Nurse/shiftHandoverModel");
const ConsentForm        = require("../../models/Clinical/ConsentFormModel");
const DischargeSummary   = require("../../models/Clinical/DischargeSummaryModel");
const InvestigationOrder = require("../../models/Investigation/InvestigationOrderModel");
const BillingTrigger     = require("../../models/Billing/BillingTrigger");
const PatientBill        = require("../../models/PatientBillModel/PatientBillModel");
const PatientActivityLog = require("../../models/Clinical/PatientActivityLogModel");

// Optional models (legacy deployments may not have these)
const MAR                = (() => { try { return require("../../models/Clinical/MARModel"); } catch { return null; } })();
const VitalSheet         = (() => { try { return require("../../models/Vitals/vitalSheetModel"); } catch { return null; } })();
const MLCReport          = (() => { try { return require("../../models/MLC/MLCReportModel"); } catch { return null; } })();
const BedTransfer        = (() => { try { return require("../../models/Patient/bedTransferModel"); } catch { return null; } })();
const IntakeOutputEntry  = (() => { try { return require("../../models/Clinical/IntakeOutputEntryModel"); } catch { return null; } })();
const DietitianModels    = (() => { try { return require("../../models/Clinical/DietitianModels"); } catch { return null; } })();
const PatientDietPlan    = DietitianModels?.PatientDietPlan || null;

// ── R7bu — clinical artefacts that the original aggregator silently
// dropped. Each model is wrapped in an optional require so a legacy
// deploy without one of these collections still serves the rest of
// the IPD file without erroring. Loaders below `safe()`-fetch each.
const PharmacyIndent           = (() => { try { return require("../../models/Pharmacy/PharmacyIndentModel"); } catch { return null; } })();
const DiabeticChart            = (() => { try { return require("../../models/Clinical/DiabeticChartModel"); } catch { return null; } })();
const ClinicalAudit            = (() => { try { return require("../../models/Compliance/ClinicalAuditModel"); } catch { return null; } })();
const BloodTransfusionRegister = (() => { try { return require("../../models/Compliance/BloodTransfusionRegisterModel"); } catch { return null; } })();
const PainAssessmentRegister   = (() => { try { return require("../../models/Compliance/PainAssessmentRegisterModel"); } catch { return null; } })();
const FallRiskRegister         = (() => { try { return require("../../models/Compliance/FallRiskRegisterModel"); } catch { return null; } })();
const DVTRegister              = (() => { try { return require("../../models/Compliance/DVTRegisterModel"); } catch { return null; } })();
const PressureUlcerRegister    = (() => { try { return require("../../models/Compliance/PressureUlcerRegisterModel"); } catch { return null; } })();
const BloodSugarRegister       = (() => { try { return require("../../models/Compliance/BloodSugarRegisterModel"); } catch { return null; } })();
const CriticalValueAlert       = (() => { try { return require("../../models/Clinical/CriticalValueAlertModel"); } catch { return null; } })();
const ADRReport                = (() => { try { return require("../../models/Pharmacy/ADRReportModel"); } catch { return null; } })();
const AdverseFoodReaction      = (() => { try { return require("../../models/Clinical/AdverseFoodReactionModel"); } catch { return null; } })();

const mongoose = require("mongoose");

// ── Safe collection fetch — never let a single model failure
// break the whole aggregator.
async function safe(label, fn) {
  try { return await fn(); }
  catch (e) {
    console.warn(`[patientHistory] ${label} fetch failed:`, e.message);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────
// GET /api/patient-history/:uhid/opd?from=...&to=...
// Returns: { success, data: { patient, visits: [...], count } }
//
// Each visit row carries the FULL OPDRegistration document — every
// assessment field the doctor or nurse touched (HOPI, OBG, vitals,
// genExam, sysExam, diagnoses, prescriptions, advice, follow-up,
// SOAP notes). Sorted by visitDate DESC (newest first) so the UI's
// timeline renders top-down latest-first.
// ─────────────────────────────────────────────────────────────
exports.getOPDHistory = async (req, res) => {
  try {
    const UHID = String(req.params.uhid || "").toUpperCase();
    if (!UHID) {
      return res.status(400).json({ success: false, message: "UHID required" });
    }

    const patient = await Patient.findOne({ UHID }).lean();
    if (!patient) {
      return res.status(404).json({ success: false, message: "Patient not found" });
    }

    // Optional time window. Default = ALL visits (no upper bound) so
    // the "complete history per UHID" promise holds.
    const filter = { UHID };
    if (req.query.from || req.query.to) {
      filter.visitDate = {};
      if (req.query.from) filter.visitDate.$gte = new Date(req.query.from);
      if (req.query.to)   filter.visitDate.$lte = new Date(req.query.to);
    }

    // Doctor-scope filter — if the caller is a Doctor, only show visits
    // they conducted (mirrors OPDController.getPatientOPDHistory). Other
    // roles see every department's visits.
    if (req.user?.role === "Doctor" && req.doctorProfile?._id) {
      filter.doctorId = req.doctorProfile._id;
    }

    const visits = await OPDRegistration.find(filter)
      .populate("doctorId", "personalInfo")
      .populate("departmentId", "departmentName")
      .sort({ visitDate: -1, createdAt: -1 })
      .lean();

    // R7bu / R7bw — DoctorOrder + PatientBill linkage per OPD visit.
    //
    // Pre-R7bu the OPD aggregator joined DoctorNotes/NurseNotes via a
    // `visitNumber` field that never existed on either model — every
    // visit got `linkedDoctorNotes: []` + `linkedNurseNotes: []`. Audit
    // confirmed (Grep across models/) that no DoctorNote / NurseNote
    // carries a visitNumber column in this codebase: OPD encounters live
    // directly on OPDRegistration (chief complaint, SOAP, prescriptions,
    // advice all on the visit row itself). The dead branch is dropped.
    //
    // What WAS missing and patients actually asked for:
    //   1. DoctorOrders raised during an OPD visit (lab/radiology/Rx) —
    //      DoctorOrderModel carries { UHID, visitType:"OPD", visitId },
    //      where visitId = the OPD visitNumber. Join is exact.
    //   2. OPD bill items — pre-R7bw PatientBill had NO per-visit FK so
    //      we matched by same-day proximity (chargeDate ≅ visitDate),
    //      which mis-pooled bill items whenever a patient had > 1 OPD
    //      visit on the same calendar day. R7bw added a stable `visitId`
    //      column on PatientBill that mirrors OPDRegistration.visitNumber;
    //      the join is now exact for any bill stamped post-R7bw or
    //      backfilled via Backend/scripts/backfillOpdBillVisitLink.js.
    //
    //      Legacy bills that the backfill couldn't resolve (visitId still
    //      null — typically multi-visit-same-day or pre-OPD bills) still
    //      fall back to the same-day proximity branch, so no row that
    //      USED to surface goes missing. The fallback is restricted to
    //      visitId:null rows so a successfully-backfilled bill never
    //      double-attaches to a different visit by date.
    const visitNumbers = visits.map((v) => v.visitNumber).filter(Boolean);
    let ordersByVisit = {};
    let opdBills = [];
    if (visitNumbers.length) {
      const [ordersRows, billsRows] = await Promise.all([
        safe("opd-orders-by-visit", () =>
          DoctorOrder.find({
            UHID,
            visitType: "OPD",
            visitId: { $in: visitNumbers },
          }).sort({ orderedAt: -1, createdAt: -1 }).lean()),
        safe("opd-bills-by-uhid", () =>
          PatientBill.find({ UHID, visitType: "OPD" })
            .sort({ createdAt: -1 }).lean()),
      ]);
      for (const o of ordersRows) {
        (ordersByVisit[o.visitId] ||= []).push(o);
      }
      opdBills = billsRows || [];
    }

    // Attach per-visit linked orders + bill items. Two pass approach:
    //   1. Exact match — every bill with `visitId === visit.visitNumber`
    //      contributes ALL its line items to that visit. Stamped via
    //      R7bw `getOrCreateDraftBill` on new bills + backfill script for
    //      pre-R7bw data.
    //   2. Same-day fallback — for bills whose `visitId` is still null
    //      (backfill couldn't resolve), restore the legacy proximity match
    //      so the row keeps surfacing. We deliberately restrict the
    //      fallback to visitId:null rows so a successfully-linked bill
    //      isn't also pulled into a different visit by same-day chance.
    const sameDay = (a, b) => {
      try {
        const da = new Date(a), db = new Date(b);
        return da.getUTCFullYear() === db.getUTCFullYear()
            && da.getUTCMonth()    === db.getUTCMonth()
            && da.getUTCDate()     === db.getUTCDate();
      } catch { return false; }
    };
    for (const v of visits) {
      v.linkedOrders = ordersByVisit[v.visitNumber] || [];
      v.linkedBillItems = [];
      if (!opdBills.length) continue;
      for (const bill of opdBills) {
        // Pass 1 — exact visitId match. Take all items.
        if (bill.visitId && bill.visitId === v.visitNumber) {
          for (const it of (bill.billItems || [])) {
            v.linkedBillItems.push({
              ...it,
              _billId:     bill._id,
              _billNumber: bill.billNumber,
              _billStatus: bill.billStatus,
              _linkedBy:   "visitId",
            });
          }
          continue;
        }
        // Pass 2 — fallback for bills without visitId (legacy / unresolved
        // by backfill). Same-day proximity on the line item's chargeDate.
        if (!bill.visitId && v.visitDate) {
          const matched = (bill.billItems || []).filter((it) =>
            sameDay(it.chargeDate || bill.createdAt, v.visitDate));
          for (const it of matched) {
            v.linkedBillItems.push({
              ...it,
              _billId:     bill._id,
              _billNumber: bill.billNumber,
              _billStatus: bill.billStatus,
              _linkedBy:   "sameDayFallback",
            });
          }
        }
      }
    }

    return res.json({
      success: true,
      data: {
        patient: {
          UHID: patient.UHID,
          patientId: patient.patientId,
          fullName: patient.fullName,
          age: patient.age,
          gender: patient.gender,
          bloodGroup: patient.bloodGroup,
          contactNumber: patient.contactNumber,
        },
        visits,
        count: visits.length,
      },
    });
  } catch (e) {
    console.error("[patientHistory] getOPDHistory error:", e);
    return res.status(500).json({ success: false, message: e.message });
  }
};

// ─────────────────────────────────────────────────────────────
// GET /api/patient-history/:idOrUhid/file
// Returns chronological merged IPD file for ONE admission.
//
// `idOrUhid` resolves in this priority order:
//   1. If looks like a Mongo ObjectId → treat as Admission._id
//   2. If matches `^ADM` → treat as admissionNumber (a.k.a. ipdNo)
//   3. If matches `^IPD-` → treat as ipdNo
//   4. Otherwise → treat as UHID, return the current active admission
//      (or the latest if no Active exists).
//
// Response: {
//   admission: { ...Admission },
//   patient:   { UHID, name, age, gender, bloodGroup },
//   timeline:  [{ when, kind, label, payload, source }],  // ASC
//   counts:    { doctorNotes, nurseNotes, ... },
// }
// ─────────────────────────────────────────────────────────────
exports.getIPDFile = async (req, res) => {
  try {
    const raw = String(req.params.idOrUhid || "").trim();
    if (!raw) {
      return res.status(400).json({ success: false, message: "id or UHID required" });
    }

    // ── Resolve the admission. Multiple lookup keys supported. ──
    let admission = null;
    if (mongoose.Types.ObjectId.isValid(raw) && raw.length === 24) {
      admission = await Admission.findById(raw).lean();
    }
    if (!admission && /^ADM/i.test(raw)) {
      admission = await Admission.findOne({ admissionNumber: raw }).lean();
    }
    if (!admission && /^IPD-/i.test(raw)) {
      // ipdNo column may live on Admission as admissionNumber or as a
      // denormalised `ipdNo` field — try both for safety.
      admission = await Admission.findOne({
        $or: [{ admissionNumber: raw }, { ipdNo: raw }],
      }).lean();
    }
    if (!admission) {
      // Fall back to UHID lookup — pick current Active admission or the
      // latest one on file.
      const UHID = raw.toUpperCase();
      admission =
        await Admission.findOne({ UHID, status: "Active" }).sort({ admissionDate: -1 }).lean() ||
        await Admission.findOne({ UHID }).sort({ admissionDate: -1 }).lean();
    }
    if (!admission) {
      return res.status(404).json({ success: false, message: "Admission not found" });
    }

    const UHID = admission.UHID;
    const admissionId = admission._id;
    const ipdNo = admission.admissionNumber || admission.ipdNo || "";
    const admNumber = admission.admissionNumber || "";

    const patient = await Patient.findOne({ UHID }).lean();

    // ── Build the per-admission query helpers. Most models carry both
    // ipdNo + admissionId; we OR them so denormalisation drift doesn't
    // hide rows.
    const byAdmission = {
      $or: [
        admissionId ? { admissionId } : null,
        ipdNo ? { ipdNo } : null,
      ].filter(Boolean),
    };

    // R7bu — DoctorOrder linkage. Pre-R7bu the DoctorOrder schema didn't
    // carry admissionId/ipdNo (Agent A is adding them); orders saved on
    // legacy paths are tied to the admission ONLY by `{ UHID, visitId }`
    // where visitId = the admission number. We OR all three so both
    // backfilled rows AND legacy rows surface.
    const orderQuery = {
      $or: [
        admissionId ? { admissionId } : null,
        ipdNo ? { ipdNo } : null,
        admNumber ? { UHID, visitId: admNumber } : null,
      ].filter(Boolean),
    };

    // R7bu — VitalSheet uses `uhid` (lowercase) + `admission` (not the
    // canonical admissionId), per schema:
    //   models/Vitals/vitalSheetModel.js → fields: uhid, admission, ipdNo
    // The pre-R7bu query keyed `{ UHID, ipdNo, admissionId, recordedAt }`
    // matched nothing (recordedAt isn't even a top-level field — vitals
    // live inside tableData[]). Each tableData entry has its own time +
    // values, iterated below in the push() loop.
    //
    // Legacy nurseService writes `ipdNo: UHID` for IPD vital sheets
    // (the model comment literally says "UHID or admission number") —
    // so the ipdNo fallback must also accept the raw UHID, otherwise
    // existing vital sheets are invisible until a backfill stamps the
    // ADM number into ipdNo.
    const vitalQuery = {
      $or: [
        admissionId ? { uhid: UHID, admission: admissionId } : null,
        ipdNo ? { uhid: UHID, ipdNo } : null,
        { uhid: UHID, ipdNo: UHID },
      ].filter(Boolean),
    };

    // R7bu — DoctorNotes: surface legacy rows whose `ipdNo` linkage is
    // corrupted (e.g. carries an OPD visitNumber instead of an admission
    // number) by OR-ing patientUHID. Notes for the active admission still
    // dominate via the ipdNo branch; the UHID branch is the safety net
    // until Agent A's backfill replaces every stale linkage.
    const doctorNotesQuery = {
      $or: [
        ...(byAdmission.$or || []),
        { patientUHID: UHID },
      ],
    };

    // ── Parallel fetch every clinical artefact tied to this admission ──
    //
    // BillingTrigger gets countDocuments() in addition to the capped
    // find() so the response surfaces honest { returned, total } stats
    // (not a misleading single integer that hides truncation).
    const billingTriggerCap = 500;
    const [
      doctorNotes, nurseNotes, doctorOrders, mar, vitals,
      nursingAssessments, nursingCarePlans, shiftHandovers, bedTransfers,
      consents, dischargeSummary, mlc, investigations,
      bills, billingTriggers, billingTriggerTotal, intakeOutput, dietPlans, activityLog,
      pharmacyIndents, diabeticCharts, clinicalAudit,
      bloodTransfusions, painAssessments, fallRisks, dvtRows, pressureUlcers, bloodSugars,
      criticalAlerts, adrReports, foodReactions,
    ] = await Promise.all([
      safe("doctorNotes",        () => DoctorNotes.find(doctorNotesQuery).sort({ visitDate: 1, createdAt: 1 }).lean()),
      safe("nurseNotes",         () => NurseNotes.find(byAdmission).sort({ noteDate: 1, createdAt: 1 }).lean()),
      safe("doctorOrders",       () => DoctorOrder.find(orderQuery).sort({ orderedAt: 1, createdAt: 1 }).lean()),
      safe("mar",                () => MAR ? MAR.find(byAdmission).sort({ date: 1, createdAt: 1 }).lean() : []),
      safe("vitals",             () => VitalSheet ? VitalSheet.find(vitalQuery).sort({ date: 1, createdAt: 1 }).lean() : []),
      safe("nursingAssessments", () => NursingAssessment.find(byAdmission).sort({ createdAt: 1 }).lean()),
      safe("nursingCarePlans",   () => NursingCarePlan.find(byAdmission).sort({ createdAt: 1 }).lean()),
      safe("shiftHandovers",     () => ShiftHandover.find(byAdmission).sort({ createdAt: 1 }).lean()),
      safe("bedTransfers",       () => BedTransfer ? BedTransfer.find({ $or: [byAdmission, { UHID }] }).sort({ createdAt: 1 }).lean() : []),
      safe("consents",           () => ConsentForm.find(byAdmission).sort({ createdAt: 1 }).lean()),
      safe("dischargeSummary",   () => DischargeSummary.find(byAdmission).sort({ createdAt: 1 }).lean()),
      safe("mlc",                () => MLCReport ? MLCReport.find({ $or: [byAdmission, { UHID }] }).sort({ createdAt: 1 }).lean() : []),
      safe("investigations",     () => InvestigationOrder.find(byAdmission).sort({ createdAt: 1 }).lean()),
      safe("bills",              () => PatientBill.find({ $or: [byAdmission, { UHID }] }).sort({ createdAt: 1 }).lean()),
      // BillingTrigger fires on every chargeable event (room rent per hour,
      // each MAR dose, consumables). Long IPD stays generate tens of
      // thousands of rows that would flood the timeline. Cap at the most
      // recent 500 for the chronological feed — counts.billingTriggers
      // exposes { returned, total } so the UI can disclose truncation
      // honestly. The dedicated billing section still has the full bills
      // list above.
      safe("billingTriggers",    () => BillingTrigger.find(byAdmission).sort({ createdAt: -1 }).limit(billingTriggerCap).lean()),
      // countDocuments returns a Number, not an array — wrap manually
      // so `safe()` (which defaults to []) doesn't disguise the value.
      // Returns -1 on failure so the counts object can flag "unknown".
      (async () => { try { return await BillingTrigger.countDocuments(byAdmission); }
                     catch (e) { console.warn("[patientHistory] billingTriggerTotal failed:", e.message); return -1; } })(),
      safe("intakeOutput",       () => IntakeOutputEntry ? IntakeOutputEntry.find({ $or: [{ admissionId }, { UHID }], voided: { $ne: true } }).sort({ ts: 1 }).lean() : []),
      safe("dietPlans",          () => PatientDietPlan ? PatientDietPlan.find({ $or: [byAdmission, { UHID }] }).sort({ assignedAt: 1, createdAt: 1 }).lean() : []),
      safe("activityLog",        () => PatientActivityLog.find({ UHID, $or: [{ ipdNo }, { admissionId }] }).sort({ createdAt: 1 }).limit(1000).lean()),
      // ── R7bu — clinical artefacts the pre-R7bu aggregator silently
      // dropped. PharmacyIndent (4 rows / admission typical), DiabeticChart
      // (1 sheet / day), ClinicalAudit (state-change log, NABH AAC.7
      // evidence). Each query OR-fallbacks to UHID so legacy rows
      // without admissionId still surface.
      safe("pharmacyIndents",    () => PharmacyIndent ? PharmacyIndent.find({
        $or: [
          admissionId ? { admissionId } : null,
          admNumber ? { UHID, admissionNumber: admNumber } : null,
        ].filter(Boolean),
      }).sort({ raisedAt: 1, createdAt: 1 }).lean() : []),
      safe("diabeticCharts",     () => DiabeticChart ? DiabeticChart.find({
        $or: [
          admissionId ? { admissionId } : null,
          { UHID },
        ],
      }).sort({ date: 1, createdAt: 1 }).lean() : []),
      safe("clinicalAudit",      () => ClinicalAudit ? ClinicalAudit.find({
        $or: [
          admissionId ? { admissionId } : null,
          { UHID },
        ],
      }).sort({ createdAt: -1 }).limit(1000).lean() : []),
      // ── R7bu — NABH per-patient registers. Each one is small per
      // admission (3-50 rows); load them all to keep the timeline honest.
      safe("bloodTransfusions",  () => BloodTransfusionRegister ? BloodTransfusionRegister.find({
        $or: [
          admissionId ? { admissionId } : null,
          { UHID },
        ],
      }).sort({ startedAt: 1, createdAt: 1 }).lean() : []),
      safe("painAssessments",    () => PainAssessmentRegister ? PainAssessmentRegister.find({
        $or: [
          admissionId ? { admissionId } : null,
          { UHID },
        ],
      }).sort({ assessedAt: 1 }).lean() : []),
      safe("fallRisks",          () => FallRiskRegister ? FallRiskRegister.find({
        $or: [
          admissionId ? { admissionId } : null,
          { UHID },
        ],
      }).sort({ assessedAt: 1 }).lean() : []),
      safe("dvtRows",            () => DVTRegister ? DVTRegister.find({
        $or: [
          admissionId ? { admissionId } : null,
          { UHID },
        ],
      }).sort({ assessedAt: 1 }).lean() : []),
      safe("pressureUlcers",     () => PressureUlcerRegister ? PressureUlcerRegister.find({
        $or: [
          admissionId ? { admissionId } : null,
          { UHID },
        ],
      }).sort({ assessedAt: 1 }).lean() : []),
      safe("bloodSugars",        () => BloodSugarRegister ? BloodSugarRegister.find({
        $or: [
          admissionId ? { admissionId } : null,
          { UHID },
        ],
      }).sort({ takenAt: 1 }).lean() : []),
      // CriticalValueAlert + ADRReport + AdverseFoodReaction key on
      // `patientUHID` (not the canonical UHID column) per their schemas;
      // load by that field.
      safe("criticalAlerts",     () => CriticalValueAlert ? CriticalValueAlert.find({ patientUHID: UHID })
        .sort({ emittedAt: 1 }).lean() : []),
      safe("adrReports",         () => ADRReport ? ADRReport.find({ patientUHID: UHID })
        .sort({ createdAt: 1 }).lean() : []),
      safe("foodReactions",      () => AdverseFoodReaction ? AdverseFoodReaction.find({ patientUHID: UHID })
        .sort({ reportedAt: 1, createdAt: 1 }).lean() : []),
    ]);

    // ── Build the merged ASC timeline ──
    // Each entry shape: { when, kind, label, ref, payload, source }.
    //
    // R7bu — pre-R7bu the push() helper silently dropped any event with
    // a falsy `when` (forgot to stamp createdAt, missing scheduledTime,
    // assessment imported without timestamps). Those events become
    // invisible — bad outcome for an aggregator advertising the
    // "complete file". Now we fall back through createdAtFallback →
    // admissionDate → epoch and flag the entry with `whenIsSynthetic:
    // true` so the UI can show a warning marker. Events still surface
    // at the end of the timeline (epoch fallback sorts last).
    const admissionAnchor = admission.admissionDate || admission.createdAt || null;
    const timeline = [];
    const push = (when, kind, label, ref, payload = {}, source = "", createdAtFallback = null) => {
      const safeWhen = when || createdAtFallback || admissionAnchor || new Date(0);
      const synthetic = !when;
      timeline.push({
        when: new Date(safeWhen).toISOString(),
        kind, label, ref, payload, source,
        ...(synthetic ? { whenIsSynthetic: true } : {}),
      });
    };

    // Admission itself — first event in the file
    push(admission.admissionDate || admission.createdAt, "admission",
      `Admitted — ${admission.admissionType || "IPD"}${admission.bedNumber ? " — Bed " + admission.bedNumber : ""}${admission.reasonForAdmission ? " — " + admission.reasonForAdmission : ""}`,
      { id: admission._id, model: "Admission" },
      { admissionType: admission.admissionType, bedNumber: admission.bedNumber, attendingDoctor: admission.attendingDoctor },
    );

    doctorNotes.forEach((n) => push(n.visitDate || n.createdAt, "doctor-note",
      `Dr ${n.doctorName || ""} — ${n.noteType || "progress"} note`,
      { id: n._id, model: "DoctorNotes" },
      n, "doctor"));

    nurseNotes.forEach((n) => push(n.noteDate || n.createdAt, "nurse-note",
      `Nurse ${n.nurseName || ""} — ${n.noteType || "general"}`,
      { id: n._id, model: "NurseNotes" },
      n, "nurse"));

    doctorOrders.forEach((o) => push(o.orderedAt || o.createdAt, "order",
      `${o.orderType || "Order"} — ${o.orderDetails?.medicineName || o.orderDetails?.displayName || ""}`,
      { id: o._id, model: "DoctorOrder" },
      o, "doctor"));

    mar.forEach((m) => push(m.administeredAt || m.scheduledTime || m.date || m.createdAt, "mar",
      `MAR — ${m.drugName || m.medication || "dose"} ${m.status || ""}`.trim(),
      { id: m._id, model: "MAR" },
      m, "nurse"));

    // R7bu — VitalSheet stores one row per UHID per day with multiple
    // tableData[] entries (each carrying its own HH:MM time + values
    // map). Pre-R7bu we read flat `v.bp` / `v.pulse` / `v.recordedAt`
    // (none of which exist on the schema) so every vital sheet
    // contributed a useless "BP —/—" entry stamped at createdAt.
    // Now we iterate tableData[] and push one timeline event per
    // recorded time-slot, with a sensible label assembled from the
    // values map (which uses Mongoose Map<{ value, unit }>).
    vitals.forEach((v) => {
      const sheetDate = v.date || "";            // "YYYY-MM-DD"
      const sheetCreated = v.createdAt || null;
      const entries = Array.isArray(v.tableData) ? v.tableData : [];
      if (!entries.length) {
        // Sheet without recorded slots still gets one timeline row so
        // the UI can show "empty sheet — slot 06:00 expected" warnings.
        push(sheetCreated, "vital",
          `Vitals — sheet ${sheetDate} (no entries)`,
          { id: v._id, model: "VitalSheet" },
          v, "nurse");
        return;
      }
      for (const entry of entries) {
        // Mongoose Map -> plain object on lean(). Iterate to build label.
        const rawVals = entry.values && typeof entry.values === "object" ? entry.values : {};
        const parts = [];
        for (const key of Object.keys(rawVals)) {
          const cell = rawVals[key];
          if (cell == null || typeof cell !== "object") continue;
          const value = cell.value ?? cell.v ?? null;
          const unit  = cell.unit  ?? "";
          if (value === null || value === undefined || value === "") continue;
          parts.push(`${key} ${value}${unit ? " " + unit : ""}`);
        }
        const label = parts.length
          ? `Vitals ${entry.time || ""} — ${parts.slice(0, 4).join(", ")}`
          : `Vitals ${entry.time || ""} (slot ${sheetDate})`;
        // Stitch entry.time (HH:MM) onto sheet date for the chronology.
        let when = null;
        if (sheetDate && entry.time && /^\d{2}:\d{2}$/.test(entry.time)) {
          // Build local-zone Date from YYYY-MM-DD + HH:MM; falls back
          // to sheetCreated if parsing fails.
          const iso = `${sheetDate}T${entry.time}:00`;
          const d = new Date(iso);
          if (!Number.isNaN(d.getTime())) when = d;
        }
        push(when || sheetCreated, "vital", label,
          { id: v._id, model: "VitalSheet", entryId: entry._id },
          { sheetId: v._id, date: sheetDate, time: entry.time, values: rawVals, notes: entry.notes, nurseName: entry.nurseName },
          "nurse", sheetCreated);
      }
    });

    nursingAssessments.forEach((a) => push(a.createdAt, "nursing-assessment",
      `Nursing Assessment — ${a.assessmentType || a.type || "Assessment"}`,
      { id: a._id, model: "NursingAssessment" },
      a, "nurse"));

    nursingCarePlans.forEach((c) => push(c.createdAt, "care-plan",
      `Care Plan — ${c.problem || c.title || "Plan"}`,
      { id: c._id, model: "NursingCarePlan" },
      c, "nurse"));

    shiftHandovers.forEach((h) => push(h.createdAt, "handover",
      `Shift Handover — ${h.outgoingShift || ""} → ${h.incomingShift || ""}`,
      { id: h._id, model: "ShiftHandover" },
      h, "nurse"));

    bedTransfers.forEach((t) => push(t.createdAt, "bed-transfer",
      `Bed Transfer — ${t.fromBed || ""} → ${t.toBed || ""} (${t.status || "—"})`,
      { id: t._id, model: "BedTransfer" },
      t, "system"));

    consents.forEach((c) => push(c.createdAt, "consent",
      `Consent — ${c.consentTitle || c.consentType} (${c.status})`,
      { id: c._id, model: "ConsentForm" },
      c, "doctor"));

    mlc.forEach((m) => push(m.createdAt, "mlc",
      `MLC — ${m.mlrSeq || ""} (${m.status})`,
      { id: m._id, model: "MLCReport" },
      m, "doctor"));

    investigations.forEach((i) => push(i.createdAt, "investigation",
      `Investigation — ${(i.items || []).map((x) => x.investigationName).slice(0, 3).join(", ") || "—"} (${i.orderStatus})`,
      { id: i._id, model: "InvestigationOrder" },
      i, "doctor"));

    intakeOutput.forEach((io) => push(io.ts || io.createdAt, "intake-output",
      `${io.direction === "IN" ? "IN" : "OUT"} ${io.volumeML} mL — ${io.fluidType || io.label || ""}`,
      { id: io._id, model: "IntakeOutputEntry" },
      io, "nurse"));

    dietPlans.forEach((d) => push(d.assignedAt || d.createdAt, "diet-plan",
      `Diet Plan — ${d.plan?.templateName || "Custom"} (${d.status})`,
      { id: d._id, model: "PatientDietPlan" },
      d, "dietician"));

    bills.forEach((b) => push(b.createdAt, "bill",
      `Bill ${b.billNumber || "(draft)"} — ${b.billStatus}`,
      { id: b._id, model: "PatientBill" },
      b, "accounts"));

    billingTriggers.forEach((b) => push(b.createdAt, "billing-trigger",
      `Charge — ${b.triggerType || ""} ₹${b.amount || 0}`,
      { id: b._id, model: "BillingTrigger" },
      b, "system"));

    // ── R7bu — newly surfaced clinical artefacts ────────────────────

    pharmacyIndents.forEach((p) => push(p.raisedAt || p.createdAt, "pharmacy-indent",
      `Pharmacy Indent ${p.indentNumber || ""} — ${(p.items || []).length} item(s) — ${p.status || "Raised"}`,
      { id: p._id, model: "PharmacyIndent" },
      p, "nurse", p.createdAt));

    diabeticCharts.forEach((d) => push(d.createdAt, "diabetic-chart",
      `Diabetic Chart — ${d.date || ""} (${(d.entries || []).length} reading${(d.entries || []).length === 1 ? "" : "s"})`,
      { id: d._id, model: "DiabeticChart" },
      d, "nurse"));

    clinicalAudit.forEach((a) => push(a.createdAt, "audit",
      `${a.event} — ${a.actorName || a.actorRole || "system"}${a.reason ? " — " + a.reason : ""}`,
      { id: a._id, model: "ClinicalAudit" },
      a, "system"));

    // ── NABH registers — each emits a `nabh-register` kind with a
    // distinguishing label so the UI can group by `payload.register`
    // without re-mapping the kind enum.
    bloodTransfusions.forEach((b) => push(b.startedAt || b.requestedAt || b.createdAt, "nabh-register",
      `Blood Transfusion — ${b.btNumber || ""} (${b.status || "—"})${b.bloodGroup ? " — " + b.bloodGroup : ""}`,
      { id: b._id, model: "BloodTransfusionRegister" },
      { ...b, register: "BloodTransfusion" }, "doctor", b.createdAt));

    painAssessments.forEach((p) => push(p.assessedAt || p.createdAt, "nabh-register",
      `Pain Assessment — score ${p.painScale}/10 (${p.severity || "—"})${p.site ? " — " + p.site : ""}`,
      { id: p._id, model: "PainAssessmentRegister" },
      { ...p, register: "PainAssessment" }, "nurse", p.createdAt));

    fallRisks.forEach((f) => push(f.assessedAt || f.createdAt, "nabh-register",
      `Fall Risk — Morse ${f.morseScore} (${f.riskTier || "—"})`,
      { id: f._id, model: "FallRiskRegister" },
      { ...f, register: "FallRisk" }, "nurse", f.createdAt));

    dvtRows.forEach((d) => push(d.assessedAt || d.createdAt, "nabh-register",
      `DVT — Caprini ${d.capriniScore} (${d.capriniTier || "—"})${d.recommendedProphylaxis ? " — " + d.recommendedProphylaxis : ""}`,
      { id: d._id, model: "DVTRegister" },
      { ...d, register: "DVT" }, "nurse", d.createdAt));

    pressureUlcers.forEach((u) => push(u.assessedAt || u.createdAt, "nabh-register",
      `Pressure Ulcer — Braden ${u.bradenScore} (${u.riskTier || "—"})${u.ulcerPresent ? " — ulcer stage " + (u.ulcerStage || "?") : ""}`,
      { id: u._id, model: "PressureUlcerRegister" },
      { ...u, register: "PressureUlcer" }, "nurse", u.createdAt));

    bloodSugars.forEach((s) => push(s.takenAt || s.createdAt, "nabh-register",
      `Blood Sugar — ${s.readingValue} ${s.readingUnit || "mg/dL"} (${s.readingType || "RBS"})${s.criticalFlag ? " — CRITICAL" : ""}`,
      { id: s._id, model: "BloodSugarRegister" },
      { ...s, register: "BloodSugar" }, "nurse", s.createdAt));

    criticalAlerts.forEach((c) => push(c.emittedAt || c.createdAt, "nabh-register",
      `Critical Value (${c.kind || "—"}) — ${c.valueLabel || "—"} — ${c.status || "OPEN"}`,
      { id: c._id, model: "CriticalValueAlert" },
      { ...c, register: "CriticalValueAlert" }, "system", c.createdAt));

    adrReports.forEach((a) => push(a.createdAt, "nabh-register",
      `ADR — ${a.suspectedDrugName || "—"} (${a.severity || "—"}, ${a.status || "DRAFT"})`,
      { id: a._id, model: "ADRReport" },
      { ...a, register: "ADRReport" }, "doctor"));

    foodReactions.forEach((f) => push(f.reportedAt || f.createdAt, "nabh-register",
      `Adverse Food Reaction — ${f.suspectedAllergen || f.mealItem || "—"} (${f.severity || "—"})`,
      { id: f._id, model: "AdverseFoodReaction" },
      { ...f, register: "AdverseFoodReaction" }, "nurse", f.createdAt));

    dischargeSummary.forEach((d) => push(d.finalizedAt || d.createdAt, "discharge",
      `Discharge Summary — ${d.status}`,
      { id: d._id, model: "DischargeSummary" },
      d, "doctor"));

    // Admission terminal events
    if (admission.dischargeDate || admission.actualDischargeDate) {
      const dischargedAt = admission.actualDischargeDate || admission.dischargeDate;
      push(dischargedAt, "discharge-event",
        `Discharged — ${admission.dischargeStatus || "Complete"}`,
        { id: admission._id, model: "Admission" },
        { dischargeStatus: admission.dischargeStatus, dischargeNotes: admission.dischargeNotes },
        "system");
    }

    // Sort ASCENDING — admission day first, discharge last. This is the
    // chronological "complete file" the user asked for.
    timeline.sort((a, b) => new Date(a.when) - new Date(b.when));

    return res.json({
      success: true,
      data: {
        admission,
        patient: patient ? {
          UHID: patient.UHID,
          patientId: patient.patientId,
          fullName: patient.fullName,
          age: patient.age,
          gender: patient.gender,
          bloodGroup: patient.bloodGroup,
          contactNumber: patient.contactNumber,
        } : null,
        timeline,
        counts: {
          doctorNotes: doctorNotes.length,
          nurseNotes: nurseNotes.length,
          doctorOrders: doctorOrders.length,
          mar: mar.length,
          vitals: vitals.length,
          nursingAssessments: nursingAssessments.length,
          nursingCarePlans: nursingCarePlans.length,
          shiftHandovers: shiftHandovers.length,
          bedTransfers: bedTransfers.length,
          consents: consents.length,
          mlc: mlc.length,
          investigations: investigations.length,
          intakeOutput: intakeOutput.length,
          dietPlans: dietPlans.length,
          bills: bills.length,
          // R7bu — honest count: `returned` is what was fetched (capped
          // at billingTriggerCap), `total` is the true row count from
          // countDocuments. Consumers that previously read
          // counts.billingTriggers as an integer must switch to
          // counts.billingTriggers.returned. UI can show "showing X of
          // Y" when total > returned. `truncated` is a convenience
          // boolean. `total: -1` means countDocuments failed — show
          // returned as best-effort.
          billingTriggers: {
            returned: billingTriggers.length,
            total:    typeof billingTriggerTotal === "number" && billingTriggerTotal >= 0
                        ? billingTriggerTotal
                        : billingTriggers.length,
            truncated: typeof billingTriggerTotal === "number" && billingTriggerTotal > billingTriggers.length,
          },
          dischargeSummary: dischargeSummary.length,
          // R7bu — newly surfaced sections (pre-R7bu invisible).
          pharmacyIndents:   pharmacyIndents.length,
          diabeticCharts:    diabeticCharts.length,
          clinicalAudit:     clinicalAudit.length,
          nabhRegisters:
            bloodTransfusions.length +
            painAssessments.length +
            fallRisks.length +
            dvtRows.length +
            pressureUlcers.length +
            bloodSugars.length +
            criticalAlerts.length +
            adrReports.length +
            foodReactions.length,
          nabhRegistersByKind: {
            bloodTransfusion:    bloodTransfusions.length,
            painAssessment:      painAssessments.length,
            fallRisk:            fallRisks.length,
            dvt:                 dvtRows.length,
            pressureUlcer:       pressureUlcers.length,
            bloodSugar:          bloodSugars.length,
            criticalValueAlert:  criticalAlerts.length,
            adrReport:           adrReports.length,
            adverseFoodReaction: foodReactions.length,
          },
          totalEvents: timeline.length,
        },
      },
    });
  } catch (e) {
    console.error("[patientHistory] getIPDFile error:", e);
    return res.status(500).json({ success: false, message: e.message });
  }
};

// ─────────────────────────────────────────────────────────────
// GET /api/patient-history/:uhid/admissions
// Helper — list every admission for a UHID (with key fields) so
// the UI can present a picker if the patient has multiple
// admissions and the user wants to choose which IPD file to load.
// ─────────────────────────────────────────────────────────────
exports.listAdmissions = async (req, res) => {
  try {
    const UHID = String(req.params.uhid || "").toUpperCase();
    if (!UHID) {
      return res.status(400).json({ success: false, message: "UHID required" });
    }

    const admissions = await Admission.find({ UHID })
      .sort({ admissionDate: -1 })
      .lean();

    return res.json({
      success: true,
      data: admissions.map((a) => ({
        _id: a._id,
        admissionNumber: a.admissionNumber,
        admissionType: a.admissionType,
        admissionDate: a.admissionDate,
        dischargeDate: a.dischargeDate || a.actualDischargeDate,
        bedNumber: a.bedNumber,
        wardName: a.wardName,
        attendingDoctor: a.attendingDoctor,
        reasonForAdmission: a.reasonForAdmission,
        status: a.status,
        hasBed: a.hasBed,
      })),
      count: admissions.length,
    });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
};
