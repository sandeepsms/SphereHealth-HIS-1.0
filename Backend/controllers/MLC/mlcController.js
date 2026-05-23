/**
 * mlcController — REST surface for /api/mlc
 *
 * Doctor scope: a Doctor user only sees their own MLCs (filtered via
 * `req.doctorProfile._id`). Admin / Receptionist / Nurse see everything so
 * the front-desk and admin dashboards work too.
 */
const mlcService = require("../../services/MLC/mlcService");
const MLC = require("../../models/MLC/MLCReportModel");
const Doctor = require("../../models/Doctor/doctorModel");
const User = require("../../models/User/userModel");

// R7az-D9-HIGH-4: Doctor users cannot override the doctorId scope by
// passing `?doctorId=<some-other-doctor>` in the query string — we
// always force their own profile _id. The previous spread order
// already overwrote whatever was in `filters`, but be explicit + drop
// the override key first so future readers can't accidentally re-order
// and reintroduce the bypass.
const scopeFilters = (req, filters = {}) => {
  if (req.user?.role === "Doctor" && req.doctorProfile?._id) {
    const { doctorId: _ignoredQueryDoctorId, ...rest } = filters;
    return { ...rest, doctorId: String(req.doctorProfile._id) };
  }
  return filters;
};

const actorFrom = (req) => ({
  fullName: req.user?.fullName || req.user?.firstName || "",
  role:     req.user?.role || "",
  // R7bb-FIX-E-5: forward the actor id to the service so MLC.createdById
  // is populated — required for the finalize / close SoD check.
  id:       req.user?._id || req.user?.id || null,
});

exports.createMLC = async (req, res) => {
  try {
    // Doctor users default to themselves; admin/reception must pass an
    // explicit doctorId.
    let doctorId = req.body.doctorId;
    if (req.user?.role === "Doctor" && req.doctorProfile?._id) {
      doctorId = String(req.doctorProfile._id);
    }
    if (!doctorId) {
      return res.status(400).json({ success: false, message: "doctorId is required" });
    }
    const doc = await mlcService.createMLC(
      { ...req.body, doctorId },
      actorFrom(req),
    );

    // R7bn-1 / D9-fix + D1-fix: MLC creation is a high-stakes medico-
    // legal event. Emit ClinicalAudit row with the 7y retention floor so
    // surveyors + police inquiries can trace who/when/where.
    try {
      const { emitClinicalAudit } = require("../../services/Compliance/clinicalAuditService");
      emitClinicalAudit({
        req,
        event: "MLC_CREATED",
        UHID: doc.UHID,
        admissionId: doc.admissionId,
        patientId: doc.patientId,
        patientName: doc.patientName,
        targetType: "MLC",
        targetId: doc._id,
        after: { mlrNumber: doc.mlrNumber, allegedHistory: (doc.allegedHistory || "").slice(0, 200) },
      });
    } catch (_) { /* silent */ }

    res.status(201).json({ success: true, data: doc });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
};

exports.listMLC = async (req, res) => {
  try {
    const data = await mlcService.listMLC(scopeFilters(req, req.query));
    res.status(200).json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.getMLC = async (req, res) => {
  try {
    const doc = await mlcService.getMLC(req.params.idOrMlr);
    if (!doc) return res.status(404).json({ success: false, message: "MLC not found" });
    // Enforce doctor scope on read too
    if (req.user?.role === "Doctor" && req.doctorProfile?._id &&
        String(doc.doctorId?._id || doc.doctorId) !== String(req.doctorProfile._id)) {
      return res.status(403).json({ success: false, message: "Not your MLC" });
    }
    res.status(200).json({ success: true, data: doc });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// Shared ownership check: a Doctor user may only mutate their own MLCs.
// Admin / Receptionist / Nurse bypass this. Returns the existing doc on
// success, or sends a 404/403 response and returns null on failure.
async function loadAndAuthorize(req, res) {
  const existing = await mlcService.getMLC(req.params.idOrMlr);
  if (!existing) {
    res.status(404).json({ success: false, message: "MLC not found" });
    return null;
  }
  if (req.user?.role === "Doctor" && req.doctorProfile?._id &&
      String(existing.doctorId?._id || existing.doctorId) !== String(req.doctorProfile._id)) {
    res.status(403).json({ success: false, message: "Not your MLC" });
    return null;
  }
  return existing;
}

exports.updateMLC = async (req, res) => {
  try {
    const existing = await loadAndAuthorize(req, res);
    if (!existing) return; // response already sent
    const doc = await mlcService.updateMLC(req.params.idOrMlr, req.body, actorFrom(req));
    if (!doc) return res.status(404).json({ success: false, message: "MLC not found" });
    res.status(200).json({ success: true, data: doc });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
};

exports.deleteMLC = async (req, res) => {
  try {
    const existing = await loadAndAuthorize(req, res);
    if (!existing) return;
    const doc = await mlcService.deleteMLC(req.params.idOrMlr);
    if (!doc) return res.status(404).json({ success: false, message: "MLC not found" });
    res.status(200).json({ success: true });
  } catch (e) {
    // Service raises a 409 (Conflict) for "Finalized/Closed MLC may not be
    // deleted" — surface that distinct status instead of a blanket 500.
    const code = e.statusCode || 500;
    res.status(code).json({ success: false, message: e.message });
  }
};

// R7bb-FIX-E-5 / D3-CRIT-5: MLC finalize + close demand chain-of-custody.
// The actor finalizing or closing MUST be a DIFFERENT user than the
// original creator AND must be a Doctor with designation Consultant or
// HOD (the senior tier authorised to attest a medico-legal document).
//
// POST /api/mlc/:idOrMlr/finalize  { coSignedBy?, opinion? }
//   coSignedBy is the actor themselves — we derive from req.user. The
//   field on the request body is reserved for an optional name override
//   (e.g. "Dr. R. Singh acting for self") but the id is always req.user.
exports.finalize = async (req, res) => {
  try {
    const existing = await loadAndAuthorize(req, res);
    if (!existing) return; // response already sent
    if (existing.status === "Closed") {
      return res.status(409).json({ success: false, message: `MLC ${existing.mlrNumber} is already Closed.` });
    }
    if (existing.status === "Finalized") {
      return res.status(409).json({ success: false, message: `MLC ${existing.mlrNumber} is already Finalized.` });
    }
    // SoD — actor must differ from createdById.
    const actorId = String(req.user?._id || req.user?.id || "");
    if (existing.createdById && String(existing.createdById) === actorId) {
      return res.status(409).json({
        success: false,
        code: "SAME_ACTOR",
        message: "SAME_ACTOR — MLC finalize must be done by a different user than the creator",
      });
    }
    // Senior-tier: Doctor + designation Consultant / HOD.
    if (req.user?.role !== "Doctor" && req.user?.role !== "Admin") {
      return res.status(403).json({ success: false, message: "Only Doctor / Admin can finalize an MLC" });
    }
    if (req.user?.role === "Doctor") {
      const u = await User.findById(req.user._id || req.user.id)
        .select("doctorDetails.designation").lean();
      const desig = u?.doctorDetails?.designation || "";
      const SENIOR = new Set(["Consultant", "HOD"]);
      if (!SENIOR.has(desig)) {
        return res.status(403).json({
          success: false,
          code: "DESIGNATION_REQUIRED",
          message: `Finalize requires Consultant / HOD designation; your designation is '${desig || "—"}'.`,
        });
      }
    }
    const patch = {
      status: "Finalized",
      finalizedAt: new Date(),
      finalizedBy:    req.user.fullName || req.user.employeeId || "",
      finalizedById:  req.user._id || req.user.id || null,
      coSignedBy:     req.user._id || req.user.id || null,
      coSignedByName: req.body?.coSignedBy || req.user.fullName || "",
      coSignedAt:     new Date(),
      ...(req.body?.opinion ? { opinion: req.body.opinion } : {}),
    };
    const doc = await MLC.findOneAndUpdate(
      { _id: existing._id, status: { $ne: "Closed" } },
      { $set: patch },
      { new: true, runValidators: true },
    );

    // R7bn-1 / D9-fix: ClinicalAudit emit on MLC finalize (high-stakes).
    try {
      const { emitClinicalAudit } = require("../../services/Compliance/clinicalAuditService");
      emitClinicalAudit({
        req,
        event: "MLC_FINALIZED",
        UHID: doc.UHID,
        admissionId: doc.admissionId,
        patientId: doc.patientId,
        patientName: doc.patientName,
        targetType: "MLC",
        targetId: doc._id,
        after: { mlrNumber: doc.mlrNumber, finalizedBy: patch.finalizedBy, opinion: (patch.opinion || "").slice(0, 200) },
      });
    } catch (_) { /* silent */ }

    res.json({ success: true, data: doc });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
};

// POST /api/mlc/:idOrMlr/close  { closedReason }
exports.close = async (req, res) => {
  try {
    const existing = await loadAndAuthorize(req, res);
    if (!existing) return;
    if (existing.status === "Closed") {
      return res.status(409).json({ success: false, message: `MLC ${existing.mlrNumber} is already Closed.` });
    }
    if (!String(req.body?.closedReason || "").trim()) {
      return res.status(400).json({ success: false, message: "closedReason is required" });
    }
    const actorId = String(req.user?._id || req.user?.id || "");
    if (existing.createdById && String(existing.createdById) === actorId) {
      return res.status(409).json({
        success: false,
        code: "SAME_ACTOR",
        message: "SAME_ACTOR — MLC close must be done by a different user than the creator",
      });
    }
    if (req.user?.role !== "Doctor" && req.user?.role !== "Admin") {
      return res.status(403).json({ success: false, message: "Only Doctor / Admin can close an MLC" });
    }
    if (req.user?.role === "Doctor") {
      const u = await User.findById(req.user._id || req.user.id)
        .select("doctorDetails.designation").lean();
      const desig = u?.doctorDetails?.designation || "";
      const SENIOR = new Set(["Consultant", "HOD"]);
      if (!SENIOR.has(desig)) {
        return res.status(403).json({
          success: false,
          code: "DESIGNATION_REQUIRED",
          message: `Close requires Consultant / HOD designation; your designation is '${desig || "—"}'.`,
        });
      }
    }
    const patch = {
      status: "Closed",
      closedAt: new Date(),
      closedBy:   req.user.fullName || req.user.employeeId || "",
      closedById: req.user._id || req.user.id || null,
      closedReason: String(req.body.closedReason).trim(),
    };
    const doc = await MLC.findByIdAndUpdate(existing._id, { $set: patch }, { new: true });
    res.json({ success: true, data: doc });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
};

// GET /api/mlc/preview-prefix/:doctorId — show the candidate prefixes for a
// doctor before they cut their first MLC. Used by the doctor profile UI.
exports.previewPrefix = async (req, res) => {
  try {
    const doctor = await Doctor.findById(req.params.doctorId);
    if (!doctor) return res.status(404).json({ success: false, message: "Doctor not found" });
    res.status(200).json({
      success: true,
      data: {
        currentPrefix: doctor.mlcPrefix || null,
        candidates: mlcService.previewPrefixCandidates(doctor),
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};
