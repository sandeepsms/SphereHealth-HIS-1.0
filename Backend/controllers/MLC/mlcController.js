/**
 * mlcController — REST surface for /api/mlc
 *
 * Doctor scope: a Doctor user only sees their own MLCs (filtered via
 * `req.doctorProfile._id`). Admin / Receptionist / Nurse see everything so
 * the front-desk and admin dashboards work too.
 */
const mlcService = require("../../services/MLC/mlcService");
const Doctor = require("../../models/Doctor/doctorModel");

const scopeFilters = (req, filters = {}) => {
  if (req.user?.role === "Doctor" && req.doctorProfile?._id) {
    return { ...filters, doctorId: String(req.doctorProfile._id) };
  }
  return filters;
};

const actorFrom = (req) => ({
  fullName: req.user?.fullName || req.user?.firstName || "",
  role:     req.user?.role || "",
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
