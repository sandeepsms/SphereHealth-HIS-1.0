// controllers/Patient/patientController.js
const patientService = require("../../services/Patient/patientService");

// R7hr-171 — `visitType` ↔ `registrationType` defensive alias. Two
// upstream callers (a Frontend SDK helper that mirrors visit-side
// terminology and an external lab-integration POST) historically sent
// `visitType:"IPD"` instead of the canonical `registrationType:"IPD"`.
// Pre-fix the service silently fell back to the default `"OPD"` and the
// IPD patient ended up with an OPD-2026-NNN patientId — a data
// integrity drift that NABH would flag at audit time. We now normalise
// at the controller edge: if `visitType` is present and a valid
// `registrationType` is missing, copy it across. Live receptionist UI
// (ReceptionConsole.jsx) already sends the canonical field, so this
// branch fires only on the off-contract paths. Additive.
const _RT_ALIASES = new Set(["OPD", "IPD", "Emergency", "Daycare"]);
function _normaliseRegistrationType(body) {
  if (!body || typeof body !== "object") return body;
  if (!body.registrationType && body.visitType) {
    const v = String(body.visitType).trim();
    if (_RT_ALIASES.has(v)) body.registrationType = v;
  }
  return body;
}

exports.createPatient = async (req, res) => {
  try {
    _normaliseRegistrationType(req.body);
    const patient = await patientService.createPatient(req.body);
    res
      .status(201)
      .json({
        success: true,
        message: "Patient registered successfully",
        data: patient,
      });
  } catch (error) {
    if (error.code === 11000) {
      // Report the ACTUAL conflicting field, not "contact number".
      // Patient only has unique indexes on patientId, UHID — never on
      // contactNumber. Misleading messages confuse the receptionist.
      const conflictField = Object.keys(error.keyPattern || {})[0]
        || Object.keys(error.keyValue || {})[0]
        || "unique field";
      return res.status(400).json({
        success: false,
        message: `Patient with this ${conflictField} already exists`,
        conflictField,
      });
    }
    const statusCode = error.message.includes("not found") ? 404 : 400;
    res.status(statusCode).json({ success: false, message: error.message });
  }
};

exports.getAllPatients = async (req, res) => {
  try {
    const result = await patientService.getAllPatients(req.query);
    res.status(200).json({
      success: true,
      data: result.patients,
      totalPages: result.totalPages,
      currentPage: result.currentPage,
      totalPatients: result.totalPatients,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ✅ NEW: Search patients endpoint
// GET /api/patients/search?q=rahul&limit=10
exports.searchPatients = async (req, res) => {
  try {
    const { q, limit = 10 } = req.query;

    if (!q || q.trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: "Search term must be at least 2 characters",
        data: [],
      });
    }

    const patients = await patientService.searchPatients(q.trim(), limit);

    // Frontend ke liye clean format
    // const formatted = patients.map((p) => ({
    //   _id: p._id,
    //   UHID: p.UHID,
    //   title:p.title,
    //   fullName: p.fullName,
    //   contactNumber: p.contactNumber,
    //   email: p.email || "",
    //   gender: p.gender,
    //   dateOfBirth: p.dateOfBirth,
    //   bloodGroup: p.bloodGroup,
    //   department: p.department,
    //   doctor: p.doctor,
    //   tpa: p.tpa,
    //   registrationType: p.registrationType,
    //   address: p.address,
    //   // Dropdown ke liye label/value
    //   label: `${p.fullName} | ${p.UHID} | ${p.contactNumber}`,
    //   value: p._id,
    // }));


    const formatted = patients.map((p) => ({
  _id: p._id,
  UHID: p.UHID,

  // Basic Info
  registrationType: p.registrationType || "OPD",
  title: p.title ?? "",
  fullName: p.fullName || "",
  gender: p.gender || "",
  dateOfBirth: p.dateOfBirth || null,
  maritalStatus: p.maritalStatus || "",

  // Contact
  contactNumber: p.contactNumber || "",
  email: p.email || "",

  // Age (agar backend nahi de raha)
  age: p.age || "",

  // Address (safe nested)
  address: {
    completeAddress: p.address?.completeAddress || "",
    pincode: p.address?.pincode || "",
    city: p.address?.city || "",
    state: p.address?.state || "",
    district: p.address?.district || "",
  },

  // Medical
  bloodGroup: p.bloodGroup || "",
  knownAllergies: p.knownAllergies || "",

  // Hospital Info
  tpa: p.tpa || null,
  department: p.department || "",
  doctor: p.doctor || "",

  // MLC
  isMLC: p.isMLC || false,
  mlcNumber: p.mlcNumber || "",

  // Companion
  companionName: p.companionName || "",
  companionRelationship: p.companionRelationship || "",
  companionContact: p.companionContact || "",

  // Appointment
  hasAppointment: p.hasAppointment || false,
  appointmentDate: p.appointmentDate || null,
  appointmentTime: p.appointmentTime || null,

  // Dropdown ke liye
  label: `${p.fullName} | ${p.UHID} | ${p.contactNumber}`,
  value: p._id,
}));

    res.status(200).json({
      success: true,
      data: formatted,
      count: formatted.length,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message, data: [] });
  }
};

exports.getPatientById = async (req, res) => {
  try {
    const patient = await patientService.getPatientById(req.params.id);
    res.status(200).json({ success: true, data: patient });
  } catch (error) {
    const statusCode = error.message === "Patient not found" ? 404 : 500;
    res.status(statusCode).json({ success: false, message: error.message });
  }
};

exports.getPatientByUHID = async (req, res) => {
  try {
    const patient = await patientService.getPatientByUHID(req.params.uhid);
    res.status(200).json({ success: true, data: patient });
  } catch (error) {
    const statusCode = error.message === "Patient not found" ? 404 : 500;
    res.status(statusCode).json({ success: false, message: error.message });
  }
};

// Fields that affect clinical decisions (transfusion compatibility, paediatric
// dosing, drug-allergy alerts). Edits touching ANY of these — at any nesting
// depth — require the patient.write-clinical role; any other field falls
// under the looser patient.write-demographics gate. Security audit
// 2026-05-17 A-12 (initial fix) + re-audit H-01 / H-02 (move identity
// fields back to demographics; deep-scan to defeat the
// `{ wrapper: { bloodGroup: "X" } }` nested-object bypass).
//
// R7hr-45 split: allergies are NABH AAC.2 registration-capture data and
// must be writable by Receptionist at intake. They now live in
// ALLERGY_FIELDS and gate against the lighter `patient.write-allergies`
// action. HARD_CLINICAL_FIELDS keep the strict `patient.write-clinical`
// gate (transfusion-, dosing-, sex-assay-relevant).
const HARD_CLINICAL_FIELDS = new Set([
  "bloodGroup",
  "dateOfBirth",
  "age",
  "gender",
]);
const ALLERGY_FIELDS = new Set([
  "knownAllergies",
  // R7fl: Typed allergyList[] is the source of truth for the `allergies`
  // virtual (banners, drug-allergy gate, MAR cross-check). IPD Initial
  // Assessment writes here at sign-off.
  "allergyList",
]);

// R7hr-45: deep-equal helper used to distinguish "field present in form
// re-submit but unchanged from current value" from "field actually edited."
// Receptionists re-POST the full patient body on every save; without this
// diff, a receptionist who only edited the allergies row would still trip
// the hard-clinical gate because DOB/gender/bloodGroup are echoed back.
function _valuesEqual(a, b) {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  // Date stored on the doc vs ISO/date-string in body
  if (a instanceof Date) return a.toISOString().slice(0, 10) === String(b).slice(0, 10);
  if (b instanceof Date) return b.toISOString().slice(0, 10) === String(a).slice(0, 10);
  if (typeof a === "object" || typeof b === "object") {
    try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
  }
  // Coerce numeric strings (age may come as "20" vs 20)
  return String(a) === String(b);
}

// Recursively scan request body and classify which gate must fire. Returns
// {hard, allergy} flags. A field counts as a write only if its VALUE differs
// from the corresponding field on the existing patient document — this lets
// idempotent form re-submits (full patient body echo) pass without escalating
// to a higher permission. Defeats nested-object bypasses like
// `{ wrapper: { bloodGroup: "AB+" } }`. Bounded depth (8) prevents stack abuse.
function classifyClinicalWrites(body, existing, depth = 0, found = { hard: false, allergy: false }) {
  if (!body || typeof body !== "object" || depth > 8) return found;
  if (Array.isArray(body)) {
    body.forEach((item) => classifyClinicalWrites(item, existing, depth + 1, found));
    return found;
  }
  for (const [k, v] of Object.entries(body)) {
    if (HARD_CLINICAL_FIELDS.has(k)) {
      const existingVal = existing ? existing[k] : undefined;
      if (!_valuesEqual(v, existingVal)) found.hard = true;
    } else if (ALLERGY_FIELDS.has(k)) {
      const existingVal = existing ? existing[k] : undefined;
      if (!_valuesEqual(v, existingVal)) found.allergy = true;
    }
    if (v && typeof v === "object") classifyClinicalWrites(v, existing, depth + 1, found);
  }
  return found;
}

exports.updatePatient = async (req, res) => {
  try {
    const { roleCan } = require("../../config/permissions");
    const role = req.user?.role;
    if (!role) {
      return res.status(401).json({ success: false, message: "Not authenticated" });
    }

    // R7hr-45: fetch existing so we can diff — only truly-changed clinical
    // or allergy fields trigger the higher gate. Form re-submits that echo
    // unchanged DOB/gender/bloodGroup no longer lock receptionists out of
    // legitimate demographic + allergy edits.
    let existing = null;
    try { existing = await patientService.getPatientById(req.params.id); } catch (e) { /* falls through; controller will 404 below if truly missing */ }
    if (!existing) {
      return res.status(404).json({ success: false, message: "Patient not found" });
    }

    const { hard, allergy } = classifyClinicalWrites(req.body, existing);
    let requiredAction;
    if (hard) requiredAction = "patient.write-clinical";
    else if (allergy) requiredAction = "patient.write-allergies";
    else requiredAction = "patient.write-demographics";

    if (!roleCan(role, requiredAction)) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Action '${requiredAction}' is not permitted for role '${role}'.`,
        action: requiredAction,
        role,
      });
    }

    const patient = await patientService.updatePatient(req.params.id, req.body);
    res
      .status(200)
      .json({
        success: true,
        message: "Patient updated successfully",
        data: patient,
      });
  } catch (error) {
    const statusCode = error.message === "Patient not found" ? 404 : 400;
    res.status(statusCode).json({ success: false, message: error.message });
  }
};

exports.deletePatient = async (req, res) => {
  // R7bd-A-1 / A1-CRIT-1 — soft-delete with dependency guard.
  // ?force=true cascades through active admissions / open bills / open
  // advances. Force-cascade requires the Admin role (the route already
  // gates `patient.delete` to a permission, but cascade is a much
  // stronger action — we narrow that sub-action to Admin only).
  try {
    const force = String(req.query.force || "").toLowerCase() === "true";
    if (force && req.user?.role !== "Admin") {
      return res.status(403).json({
        success: false,
        message: "Only Admin can force-cascade delete a patient with active dependencies.",
        code: "FORCE_REQUIRES_ADMIN",
      });
    }
    const actor = {
      id:   req.user?.id || req.user?._id,
      name: req.user?.fullName || req.user?.employeeId || "",
      role: req.user?.role || "",
    };
    await patientService.deletePatient(req.params.id, { force, actor });
    res
      .status(200)
      .json({ success: true, message: force ? "Patient archived (cascade)" : "Patient archived" });
  } catch (error) {
    const explicit = Number(error.status || error.statusCode);
    const statusCode = Number.isInteger(explicit) && explicit >= 400 && explicit < 600
      ? explicit
      : (error.message === "Patient not found" ? 404 : 500);
    res.status(statusCode).json({
      success: false,
      message: error.message,
      ...(error.code ? { code: error.code } : {}),
    });
  }
};

exports.getPatientStats = async (req, res) => {
  try {
    const stats = await patientService.getPatientStats();
    res.status(200).json({ success: true, data: stats });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getPatientsByTPA = async (req, res) => {
  try {
    const result = await patientService.getPatientsByTPA(
      req.params.tpaId,
      req.query,
    );
    res.status(200).json({
      success: true,
      data: result.patients,
      totalPages: result.totalPages,
      currentPage: result.currentPage,
      totalPatients: result.totalPatients,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
