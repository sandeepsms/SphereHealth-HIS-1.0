/**
 * R7hr-113 — PROM / PREM Survey controller
 * ─────────────────────────────────────────
 * CRUD + sign ceremony for paperless PROM / PREM forms.
 *
 * On sign:
 *   - patient signature (digital pad / biometric / verbal attest) must
 *     be present, OR an admin bypass with reason must be set
 *   - staff witness signature must be present
 *   - status flips DRAFT → SIGNED, signedAt + signedByName stamped
 *   - row mirrors into PROM/PREM NABH register (R7gw-B10-T05) so the
 *     compliance dashboard lights up automatically
 *   - clinical audit emitted (long-retention category)
 */
const PROMPREMSurvey = require("../../models/Clinical/PROMPREMSurveyModel");
const Admission = require("../../models/Patient/admissionModel");
const Patient = require("../../models/Patient/patientModel");
const mongoose = require("mongoose");

// Resolve patient + admission context from request (body or URL params).
async function _resolveContext(req) {
  const { UHID, admissionId } = req.body || {};
  if (!UHID && !admissionId) return null;
  let admission = null;
  if (admissionId && mongoose.isValidObjectId(admissionId)) {
    admission = await Admission.findById(admissionId)
      .select("_id admissionNumber UHID patientName patientId")
      .lean();
  }
  if (!admission && UHID) {
    admission = await Admission.findOne({ UHID, status: "Active" })
      .select("_id admissionNumber UHID patientName patientId")
      .lean();
  }
  if (!admission) return null;
  return {
    UHID: admission.UHID,
    admissionId: admission._id,
    admissionNumber: admission.admissionNumber,
    patientId: admission.patientId,
    patientName: admission.patientName,
  };
}

// CREATE — start a draft
exports.create = async (req, res) => {
  try {
    const ctx = await _resolveContext(req);
    if (!ctx) {
      return res.status(404).json({ success: false, code: "ADMISSION_NOT_FOUND", message: "No active admission for this UHID / admissionId." });
    }
    const { type, instrument, otherInstrumentLabel, responses, scores, comments, staffRecommendation, administeredAt, administeredAtLocation } = req.body || {};
    if (!["PROM", "PREM"].includes(type)) {
      return res.status(400).json({ success: false, code: "TYPE_INVALID", message: "type must be PROM or PREM" });
    }
    if (!instrument) {
      return res.status(400).json({ success: false, code: "INSTRUMENT_REQUIRED", message: "instrument is required" });
    }

    const sourceRef = `prom-prem:${ctx.admissionId}:${type}:${instrument}`;
    // If a draft with this sourceRef exists, return it (idempotent open)
    const existing = await PROMPREMSurvey.findOne({ sourceRef });
    if (existing) {
      return res.json({ success: true, data: existing, reopened: true });
    }

    const doc = await PROMPREMSurvey.create({
      ...ctx,
      type,
      instrument,
      otherInstrumentLabel: otherInstrumentLabel || "",
      responses: responses || {},
      scores: scores || {},
      comments: comments || "",
      staffRecommendation: staffRecommendation || "",
      administeredAt: administeredAt ? new Date(administeredAt) : new Date(),
      administeredAtLocation: administeredAtLocation || "Discharge desk",
      status: "DRAFT",
      sourceRef,
      auditLog: [{
        action: "CREATED",
        at: new Date(),
        byUserId: req.user?._id,
        byName: req.user?.fullName || req.user?.name,
        byRole: req.user?.role,
        notes: `Started ${type} survey (${instrument})`,
      }],
    });
    return res.status(201).json({ success: true, data: doc });
  } catch (err) {
    const { logErr } = require("../../utils/logErr");
    logErr("promPremSurvey.create", "")(err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// UPDATE — patch responses / scores / comments on a DRAFT
exports.update = async (req, res) => {
  try {
    const { id } = req.params;
    const draft = await PROMPREMSurvey.findById(id);
    if (!draft) {
      return res.status(404).json({ success: false, code: "NOT_FOUND", message: "Survey not found." });
    }
    if (draft.status !== "DRAFT") {
      return res.status(409).json({ success: false, code: "NOT_EDITABLE", message: "Survey is SIGNED — cannot modify. Open an amendment if a change is needed." });
    }
    const patchable = ["responses", "scores", "comments", "staffRecommendation", "administeredAtLocation", "instrument", "otherInstrumentLabel", "patientSignature", "staffWitness"];
    let changed = 0;
    for (const k of patchable) {
      if (req.body[k] !== undefined) { draft[k] = req.body[k]; changed++; }
    }
    if (changed > 0) {
      draft.auditLog.push({
        action: "UPDATED",
        at: new Date(),
        byUserId: req.user?._id,
        byName: req.user?.fullName || req.user?.name,
        byRole: req.user?.role,
        notes: `Updated ${changed} field(s)`,
      });
    }
    await draft.save();
    return res.json({ success: true, data: draft });
  } catch (err) {
    const { logErr } = require("../../utils/logErr");
    logErr("promPremSurvey.update", req.params?.id)(err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// SIGN — flip DRAFT → SIGNED + emit register
exports.sign = async (req, res) => {
  try {
    const { id } = req.params;
    const draft = await PROMPREMSurvey.findById(id);
    if (!draft) {
      return res.status(404).json({ success: false, code: "NOT_FOUND", message: "Survey not found." });
    }
    if (draft.status === "SIGNED") {
      return res.json({ success: true, data: draft, alreadySigned: true });
    }

    // Pre-condition gate — patient sig OR bypass + staff witness
    const ps = draft.patientSignature || {};
    const sw = draft.staffWitness || {};
    const by = draft.bypass || {};
    const hasPatient = !!(ps.method && ps.signedAt && (ps.signatureImage || ps.method === "VERBAL_ATTESTED" || ps.method === "BIOMETRIC"));
    const hasStaff = !!(sw.userName && sw.signedAt);
    const hasBypass = !!(by.enabled && by.reason && by.authorisedAt);

    if (!hasStaff) {
      return res.status(412).json({
        success: false,
        code: "STAFF_SIGNATURE_REQUIRED",
        message: "Staff witness signature is required to sign this survey.",
        missing: { staffWitness: true },
      });
    }
    if (!hasPatient && !hasBypass) {
      return res.status(412).json({
        success: false,
        code: "PATIENT_SIGNATURE_REQUIRED",
        message: "Patient signature (digital pad / biometric / verbal-attested) OR an admin bypass with reason is required.",
        missing: { patientSignature: !hasPatient, bypass: !hasBypass },
      });
    }

    draft.status = "SIGNED";
    draft.signedAt = new Date();
    draft.signedByName = sw.userName;
    draft.signedByEmpId = sw.employeeId || "";
    draft.auditLog.push({
      action: "SIGNED",
      at: new Date(),
      byUserId: req.user?._id,
      byName: sw.userName,
      byRole: sw.userRole || req.user?.role,
      notes: hasBypass ? `Signed via bypass — ${by.reason}` : `Signed (${ps.method || "DIGITAL_PAD"})`,
    });
    await draft.save();

    // Mirror into NABH PROM/PREM register (idempotent on sourceRef)
    try {
      const { emitPROMPREMReg } = require("../../services/Compliance/nabhRegisterEmitter");
      const row = await emitPROMPREMReg({
        UHID: draft.UHID,
        patientId: draft.patientId,
        patientName: draft.patientName,
        admissionId: draft.admissionId,
        admissionNumber: draft.admissionNumber,
        instrument: draft.instrument,
        administeredAt: draft.administeredAt || draft.signedAt,
        administeredByEmpId: sw.employeeId,
        administeredByName: sw.userName,
        administeredByUserId: sw.userId,
        scores: draft.scores || {},
        comments: draft.comments || "",
        recommendation: draft.staffRecommendation || "",
        dischargeContext: true,
        status: "Closed",
        sourceRef: draft.sourceRef,
        sourceType: "PROMPREMSurvey",
        actor: { _id: req.user?._id, fullName: sw.userName, role: sw.userRole },
      });
      if (row && row._id) {
        draft.registerRowId = row._id;
        await draft.save();
      }
    } catch (err) {
      // Non-blocking — register emit failure shouldn't block the sign
      const { logErr } = require("../../utils/logErr");
      logErr("promPremSurvey.emitRegister", id)(err);
    }

    // Clinical audit
    try {
      const { emitClinicalAudit } = require("../../services/Compliance/clinicalAuditService");
      emitClinicalAudit({
        req,
        event: "PROM_PREM_SIGNED",
        UHID: draft.UHID,
        admissionId: draft.admissionId,
        patientId: draft.patientId,
        patientName: draft.patientName,
        targetType: "PROMPREMSurvey",
        targetId: draft._id,
        after: { type: draft.type, instrument: draft.instrument, signedAt: draft.signedAt },
      });
    } catch (_) { /* silent */ }

    return res.json({ success: true, data: draft });
  } catch (err) {
    const { logErr } = require("../../utils/logErr");
    logErr("promPremSurvey.sign", req.params?.id)(err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// LIST — surveys for an admission / UHID
exports.list = async (req, res) => {
  try {
    const { admissionId, UHID, type, status } = req.query;
    const filter = {};
    if (admissionId && mongoose.isValidObjectId(admissionId)) filter.admissionId = admissionId;
    if (UHID) filter.UHID = String(UHID).toUpperCase();
    if (type) filter.type = type;
    if (status) filter.status = status;
    if (!filter.admissionId && !filter.UHID) {
      return res.status(400).json({ success: false, code: "FILTER_REQUIRED", message: "Provide admissionId or UHID." });
    }
    const rows = await PROMPREMSurvey.find(filter).sort({ createdAt: -1 }).limit(50).lean();
    // Quick discharge-readiness summary
    let readiness = null;
    if (filter.admissionId) {
      readiness = await PROMPREMSurvey.checkDischargeReadiness(filter.admissionId);
    }
    return res.json({ success: true, data: rows, readiness });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// GET single
exports.getById = async (req, res) => {
  try {
    const doc = await PROMPREMSurvey.findById(req.params.id).lean();
    if (!doc) return res.status(404).json({ success: false, code: "NOT_FOUND" });
    return res.json({ success: true, data: doc });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};
