// controllers/Clinical/patientFileController.js
// ═══════════════════════════════════════════════════════════════
// Patient File — Complete Aggregator
//
// One endpoint pulls EVERY clinical record for a patient (across
// every active model) into a single response. The Complete Patient
// File page consumes this directly so the front-end stays dumb
// and we never miss a model in the UI.
//
// Read-only. Every model is `lean()` for speed; ordering is
// chronological where it matters (notes, orders, audit feed).
// ═══════════════════════════════════════════════════════════════

const Patient            = require("../../models/Patient/patientModel");
const Admission          = require("../../models/Patient/admissionModel");
const DoctorNotes        = require("../../models/Doctor/DoctorNotesModel");
const DoctorOrder        = require("../../models/Doctor/DoctorOrderModel");
const NurseNotes         = require("../../models/Nurse/NurseNotesModel");
const NursingAssessment  = require("../../models/Nurse/NursingAssessmentModel");
const NursingCarePlan    = require("../../models/Nurse/NursingCarePlanModel");
const ShiftHandover      = require("../../models/Nurse/shiftHandoverModel");
const ConsentForm        = require("../../models/Clinical/ConsentFormModel");
const DischargeSummary   = require("../../models/Clinical/DischargeSummaryModel");
const MAR                = (() => { try { return require("../../models/Clinical/MARModel"); } catch { return null; } })();
const VitalSheet         = (() => { try { return require("../../models/Vitals/vitalSheetModel"); } catch { return null; } })();
const MLCReport          = (() => { try { return require("../../models/MLC/MLCReportModel"); } catch { return null; } })();
const InvestigationOrder = require("../../models/Investigation/InvestigationOrderModel");
const PatientBill        = require("../../models/PatientBillModel/PatientBillModel");
const BillingTrigger     = require("../../models/Billing/BillingTrigger");
const BedTransfer        = (() => { try { return require("../../models/Patient/bedTransferModel"); } catch { return null; } })();
const PatientActivityLog = require("../../models/Clinical/PatientActivityLogModel");

// ── Helper: safe collection fetch — never let a single model failure
// break the whole aggregator. If a query throws (missing model, schema
// mismatch on legacy data), we log + return []. The UI still gets
// every OTHER section.
async function safe(label, fn) {
  try {
    return await fn();
  } catch (e) {
    console.warn(`[patientFile] ${label} fetch failed:`, e.message);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────
// GET /api/patient-file/:uhid/complete
// Returns: {
//   patient, admissions, currentAdmission,
//   doctorNotes, nurseNotes, doctorOrders, mar, vitals,
//   nursingAssessments, nursingCarePlans, shiftHandovers, bedTransfers,
//   consents, dischargeSummary, mlc, investigations,
//   bills, billingTriggers,
//   activityLog (last 500),
//   timeline (merged chronological feed)
// }
// ─────────────────────────────────────────────────────────────
exports.getCompleteFile = async (req, res) => {
  try {
    const UHID = String(req.params.uhid || "").toUpperCase();
    if (!UHID) {
      return res.status(400).json({ success: false, message: "UHID required" });
    }

    const patient = await Patient.findOne({ UHID })
      .populate("tpa", "tpaName tpaCode")
      .populate("department", "departmentName")
      .lean();
    if (!patient) {
      return res.status(404).json({ success: false, message: "Patient not found" });
    }

    // Parallel fetch — every section is independent, so blast them all at once.
    const [
      admissions, doctorNotes, nurseNotes, doctorOrders,
      consents, dischargeSummary,
      nursingAssessments, nursingCarePlans, shiftHandovers, bedTransfers,
      mar, vitals, mlc,
      investigations, bills, billingTriggers, activityLog,
    ] = await Promise.all([
      safe("admissions",       () => Admission.find({ UHID }).sort({ admissionDate: -1 }).lean()),
      safe("doctorNotes",      () => DoctorNotes.find({ patientUHID: UHID }).sort({ visitDate: -1, createdAt: -1 }).lean()),
      safe("nurseNotes",       () => NurseNotes.find({ patientUHID: UHID }).sort({ createdAt: -1 }).lean()),
      safe("doctorOrders",     () => DoctorOrder.find({ UHID }).sort({ orderedAt: -1, createdAt: -1 }).lean()),
      safe("consents",         () => ConsentForm.find({ UHID }).sort({ createdAt: -1 }).lean()),
      safe("dischargeSummary", () => DischargeSummary.find({ UHID }).sort({ createdAt: -1 }).lean()),
      safe("nursingAssessments", () => NursingAssessment.find({ UHID }).sort({ createdAt: -1 }).lean()),
      safe("nursingCarePlans",   () => NursingCarePlan.find({ UHID }).sort({ createdAt: -1 }).lean()),
      safe("shiftHandovers",     () => ShiftHandover.find({ UHID }).sort({ createdAt: -1 }).lean()),
      safe("bedTransfers",       () => BedTransfer ? BedTransfer.find({ UHID }).sort({ createdAt: -1 }).lean() : []),
      safe("mar",                () => MAR ? MAR.find({ UHID }).sort({ createdAt: -1 }).lean() : []),
      safe("vitals",             () => VitalSheet ? VitalSheet.find({ UHID }).sort({ recordedAt: -1 }).lean() : []),
      safe("mlc",                () => MLCReport ? MLCReport.find({ UHID }).sort({ createdAt: -1 }).lean() : []),
      safe("investigations",     () => InvestigationOrder.find({ UHID }).sort({ createdAt: -1 }).lean()),
      safe("bills",              () => PatientBill.find({ UHID }).sort({ createdAt: -1 }).lean()),
      safe("billingTriggers",    () => BillingTrigger.find({ UHID }).sort({ createdAt: -1 }).limit(500).lean()),
      safe("activityLog",        () => PatientActivityLog.find({ UHID }).sort({ createdAt: -1 }).limit(500).lean()),
    ]);

    const currentAdmission =
      admissions.find((a) => a.status === "Active") || admissions[0] || null;

    // ── Build a unified chronological timeline. Each entry has a stable
    // shape the UI can render without knowing the source model.
    const timeline = [];
    const push = (when, kind, label, ref, extra = {}) => {
      if (!when) return;
      timeline.push({
        when: new Date(when).toISOString(),
        kind,            // "doctor-note" | "nurse-note" | "order" | "consent" | "mar" | "vital" | "transfer" | "investigation" | "bill" | "audit" | "admission" | "discharge"
        label,           // human-readable headline
        ref,             // { id, model }
        ...extra,
      });
    };

    admissions.forEach((a) => push(a.admissionDate || a.createdAt, "admission",
      `Admitted — ${a.admissionType || "IPD"} — ${a.reasonForAdmission || ""}`,
      { id: a._id, model: "Admission" },
      { dischargedAt: a.dischargeDate }));

    doctorNotes.forEach((n) => push(n.visitDate || n.createdAt, "doctor-note",
      `Dr ${n.doctorName || ""} — ${n.noteType || "progress"} note`,
      { id: n._id, model: "DoctorNotes" },
      { signed: n.status === "signed" }));

    nurseNotes.forEach((n) => push(n.createdAt, "nurse-note",
      `Nurse ${n.nurseName || ""} — ${n.noteType || "general"}`,
      { id: n._id, model: "NurseNotes" }));

    doctorOrders.forEach((o) => push(o.orderedAt || o.createdAt, "order",
      `${o.orderType || "Order"} — ${o.orderDetails?.medicineName || o.orderDetails?.displayName || ""}`,
      { id: o._id, model: "DoctorOrder" },
      { status: o.status }));

    consents.forEach((c) => push(c.createdAt, "consent",
      `Consent — ${c.consentTitle || c.consentType} (${c.status})`,
      { id: c._id, model: "ConsentForm" }));

    dischargeSummary.forEach((d) => push(d.finalizedAt || d.createdAt, "discharge",
      `Discharge summary — ${d.status}`,
      { id: d._id, model: "DischargeSummary" }));

    bedTransfers.forEach((t) => push(t.createdAt, "transfer",
      `Bed transfer — ${t.status}`,
      { id: t._id, model: "BedTransfer" }));

    investigations.forEach((i) => push(i.createdAt, "investigation",
      `Investigation — ${(i.items || []).map((x) => x.investigationName).slice(0, 3).join(", ") || "—"} (${i.orderStatus})`,
      { id: i._id, model: "InvestigationOrder" }));

    bills.forEach((b) => push(b.createdAt, "bill",
      `Bill ${b.billNumber || "(draft)"} — ${b.billStatus}`,
      { id: b._id, model: "PatientBill" }));

    vitals.forEach((v) => push(v.recordedAt || v.createdAt, "vital",
      `Vitals recorded — BP ${v.bp?.systolic || "—"}/${v.bp?.diastolic || "—"}, P ${v.pulse || "—"}`,
      { id: v._id, model: "VitalSheet" }));

    activityLog.forEach((a) => push(a.createdAt, "audit",
      `${a.userName || "System"} — ${a.module}/${a.action}${a.area ? ` (${a.area})` : ""}`,
      { id: a._id, model: "PatientActivityLog" },
      { tags: a.tags, summary: a.summary }));

    timeline.sort((a, b) => new Date(b.when) - new Date(a.when));

    // ── Section completeness map — UI shows a green check / amber warn
    // next to each section depending on whether the patient has data
    // captured. NABH inspectors find missing-section gaps fast this way.
    const completeness = {
      admission:           !!currentAdmission,
      doctorInitialNote:   doctorNotes.some((n) => /initial/i.test(n.noteType || "")),
      nurseInitialNote:    nurseNotes.some((n)  => /initial/i.test(n.noteType || "")),
      orders:              doctorOrders.length > 0,
      consents:            consents.length > 0,
      investigations:      investigations.length > 0,
      vitalsRecorded:      vitals.length > 0 || nurseNotes.some((n) => n.vitals),
      dischargeFinalized:  dischargeSummary.some((d) => d.status === "finalized"),
      handoverDone:        shiftHandovers.length > 0 || bedTransfers.some((t) => t.status === "Complete"),
    };

    return res.json({
      success: true,
      data: {
        patient,
        admissions,
        currentAdmission,
        doctorNotes,
        nurseNotes,
        doctorOrders,
        mar,
        vitals,
        nursingAssessments,
        nursingCarePlans,
        shiftHandovers,
        bedTransfers,
        consents,
        dischargeSummary,
        mlc,
        investigations,
        bills,
        billingTriggers,
        activityLog,
        timeline,
        completeness,
      },
    });
  } catch (e) {
    console.error("[patientFile] getCompleteFile error:", e);
    return res.status(500).json({ success: false, message: e.message });
  }
};

// ─────────────────────────────────────────────────────────────
// GET /api/patient-file/:uhid/activity?limit=200&module=...&action=...
// Paginated audit feed — used by the activity-log drawer in the UI.
// ─────────────────────────────────────────────────────────────
exports.getActivityFeed = async (req, res) => {
  try {
    const UHID = String(req.params.uhid || "").toUpperCase();
    const limit = Math.min(Number(req.query.limit) || 200, 1000);
    const page  = Math.max(1, Number(req.query.page) || 1);
    const filter = { UHID };
    if (req.query.module) filter.module = req.query.module;
    if (req.query.action) filter.action = req.query.action;
    if (req.query.userId) filter.userId = req.query.userId;
    if (req.query.from || req.query.to) {
      filter.createdAt = {};
      if (req.query.from) filter.createdAt.$gte = new Date(req.query.from);
      if (req.query.to)   filter.createdAt.$lte = new Date(req.query.to);
    }
    const [rows, total] = await Promise.all([
      PatientActivityLog.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      PatientActivityLog.countDocuments(filter),
    ]);
    return res.json({ success: true, data: rows, pagination: { page, limit, total } });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

// ─────────────────────────────────────────────────────────────
// POST /api/patient-file/:uhid/log
// Body: { module, action, area, summary, sourceModel, sourceId, before, after, tags }
// Frontend-driven event logger — used for "click" and "select"
// actions that don't otherwise hit a mutating endpoint.
// ─────────────────────────────────────────────────────────────
exports.logEvent = async (req, res) => {
  try {
    const UHID = String(req.params.uhid || "").toUpperCase();
    const { module: mod, action, area, summary, sourceModel, sourceId, before, after, tags, ipdNo, admissionId } = req.body || {};
    if (!mod || !action) {
      return res.status(400).json({ success: false, message: "module and action are required" });
    }
    const activityLogger = require("../../services/Clinical/activityLogger");
    const user = req.user || {};
    const row = await activityLogger.log({
      UHID, ipdNo: ipdNo || "", admissionId: admissionId || null,
      module: mod, action, area: area || "", summary: summary || "",
      sourceModel: sourceModel || "", sourceId: sourceId || null,
      before, after, tags: Array.isArray(tags) ? tags : [],
      userId:   user._id || user.id || null,
      userName: user.fullName || user.firstName || user.userName || "",
      userRole: user.role || user.userRole || "",
      httpMethod: req.method,
      httpPath:   req.originalUrl,
      ip:         req.ip || "",
      userAgent:  req.headers["user-agent"] || "",
    });
    return res.json({ success: true, data: row });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
};
