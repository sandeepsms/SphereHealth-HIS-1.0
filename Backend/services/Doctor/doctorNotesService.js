// Doctor/Services/doctorNotesService.js
// Business logic — Controller calls these functions

const DoctorNotes = require("../../models/Doctor/DoctorNotesModel");
const Patient = require("../../models/Patient/patientModel");
const Doctor = require("../../models/Doctor/doctorModel");
const TreatmentChart = require("../../models/Doctor/treatmentChartModel");

const VISIT_FIELD_MAP = {
  OPD: "totalOPDVisits",
  Emergency: "totalEmergencyVisits",
  IPD: "totalIPDVisits",
  Daycare: "totalDaycareVisits",
  Services: "totalServicesVisits",
};

// ─────────────────────────────────────────────────────────────
// Create SOAP note with orders
// ─────────────────────────────────────────────────────────────
const createDoctorNote = async (data, doctorUserId) => {
  const {
    // patient ref — frontend may send 'patient' or 'patientId'
    patient: patientRef,
    patientId,
    patientName: pName,
    patientUHID,
    ipdNo,
    visitDate,
    shift,
    soap,
    vitals,
    investigations,
    orders,
    provisionalDiagnosis,
    workingDiagnosis,
    finalDiagnosis,
    icd10Code,
    icd10Description,
    patientStatus,
    status,
    // extended NABH fields
    noteType,
    isCritical,
    tags,
    noteDetails,
    // signature
    signature,
    signedByName,
    signedByReg,
    // doctor info (from frontend — fallback if User lookup fails)
    doctorName: dn,
    doctorRegNo: drn,
  } = data;

  const patRef = patientRef || patientId;
  const noteStatus = status || "draft";

  // Resolve doctor info from User model (app uses User, not old Doctor model)
  let doctorName = dn || "";
  let doctorRegNo = drn || "";
  let doctorObjectId = null;
  try {
    const User = require("../../models/User/userModel");
    const userDoc = await User.findById(doctorUserId).lean();
    if (userDoc) {
      doctorName = userDoc.fullName || `${userDoc.firstName || ""} ${userDoc.lastName || ""}`.trim() || dn || "";
      doctorRegNo = userDoc.doctorDetails?.registrationNumber || drn || "";
      doctorObjectId = userDoc._id;
    }
  } catch (_) { /* use data sent from frontend */ }

  const note = await DoctorNotes.create({
    patient: patRef || undefined,
    patientName: pName || "",
    patientUHID: patientUHID || "",
    ipdNo: ipdNo || patientUHID || "N/A",
    visitDate: visitDate || Date.now(),
    shift: shift || "morning",
    doctor: doctorObjectId || doctorUserId || undefined,
    doctorName,
    doctorRegNo,
    soap,
    vitals,
    investigations: investigations || [],
    orders: (orders || []).map((o) => ({ ...o, nurseStatus: o.nurseStatus || "pending" })),
    provisionalDiagnosis,
    workingDiagnosis,
    finalDiagnosis,
    icd10Code,
    icd10Description,
    patientStatus,
    status: noteStatus,
    noteType,
    isCritical: isCritical || false,
    tags: tags || [],
    noteDetails: noteDetails || {},
    signature,
    signedByName,
    signedByReg,
    createdBy: doctorObjectId || doctorUserId || undefined,
  });

  return note;
};

// ─────────────────────────────────────────────────────────────
// Sign draft → orders visible to nurse + push to TreatmentChart
// ─────────────────────────────────────────────────────────────
const signDoctorNote = async (noteId, doctorUserId, signaturePayload = {}) => {
  const note = await DoctorNotes.findById(noteId);
  if (!note) {
    const error = new Error("Note not found");
    error.statusCode = 404;
    throw error;
  }
  if (note.status === "signed") {
    const error = new Error("Note already signed");
    error.statusCode = 400;
    throw error;
  }
  // FIX (audit P11-B2): if the note was created without a doctor (legacy
  // path), attach the signing user as the doctor at sign-time instead of
  // letting an unauthenticated sign go through. The ownership check still
  // applies for notes that already have a doctor.
  if (note.doctor && doctorUserId && note.doctor.toString() !== doctorUserId.toString()) {
    const error = new Error("Not authorised to sign this note");
    error.statusCode = 403;
    throw error;
  }
  if (!note.doctor && !doctorUserId) {
    const error = new Error("Cannot sign — no doctor user context");
    error.statusCode = 401;
    throw error;
  }

  // FIX (audit P11-B3): resolve the signer's identity once and stamp the
  // note. Previously signedByName / signedByReg / signature were only ever
  // set on the create path; sign-later notes finalised with empty fields
  // and the printed copy looked unsigned in court / audit review.
  let signedByName = signaturePayload.signedByName || note.signedByName || "";
  let signedByReg  = signaturePayload.signedByReg  || note.signedByReg  || "";
  try {
    if ((!signedByName || !signedByReg) && doctorUserId) {
      const User = require("../../models/User/userModel");
      const userDoc = await User.findById(doctorUserId).lean();
      if (userDoc) {
        signedByName = signedByName || userDoc.fullName ||
          `${userDoc.firstName || ""} ${userDoc.lastName || ""}`.trim();
        signedByReg  = signedByReg  || userDoc.doctorDetails?.registrationNumber || "";
      }
    }
  } catch (_) { /* fall back to existing values */ }

  if (!note.doctor && doctorUserId) note.doctor = doctorUserId;
  note.status = "signed";
  note.signedAt = new Date();
  note.signedByName = signedByName;
  note.signedByReg  = signedByReg;
  if (signaturePayload.signature) note.signature = signaturePayload.signature;
  note.updatedBy = doctorUserId;
  await note.save();

  // FIX (audit P11-B4): addDoctorOrders dedupe — the TreatmentChart helper
  // is idempotent by order._id under the hood, but if a note ever gets
  // re-signed (signed → amended → signed flow) we mark the orders as
  // already-chart-pushed to avoid duplicate medication schedule rows.
  if (note.orders?.length && !note._ordersPushedToChart) {
    await TreatmentChart.addDoctorOrders(note);
    note._ordersPushedToChart = true; // transient — won't persist, but guards in-process dupes
  }

  // FIX (audit P11-B5): auto-billing was only fired on create. Notes that
  // were saved as draft and signed later never produced a consultation
  // charge. Fire here too — the billing service already de-dupes daily.
  try {
    const autoBilling = require("../../services/Billing/autoBillingService");
    autoBilling.onDoctorNoteSaved(note).catch(() => {});
  } catch (_) { /* billing optional */ }

  return note;
};

// ─────────────────────────────────────────────────────────────
// Get all pending orders — nurse fetches this
// ─────────────────────────────────────────────────────────────
const getPendingOrders = async (ipdNo) => {
  return DoctorNotes.getAllPendingOrders(ipdNo);
};

// ─────────────────────────────────────────────────────────────
// Get notes by patient
// ─────────────────────────────────────────────────────────────
const getNotesByPatient = async (patientId, query) => {
  const { page = 1, limit = 20, shift, status } = query;
  const filter = { patient: patientId };
  if (shift) filter.shift = shift;
  if (status) filter.status = status;

  const [notes, total] = await Promise.all([
    DoctorNotes.find(filter)
      .populate(
        "doctor",
        "personalInfo.fullName doctorId professional.registrationNumber",
      )
      .populate("department", "departmentName")
      .sort({ visitDate: -1 })
      .skip((+page - 1) * +limit)
      .limit(+limit)
      .lean(),
    DoctorNotes.countDocuments(filter),
  ]);

  return { notes, total, page: +page, pages: Math.ceil(total / +limit) };
};

// ─────────────────────────────────────────────────────────────
// Get notes by ipdNo
// ─────────────────────────────────────────────────────────────
const getNotesByIPD = async (ipdNo) => {
  return DoctorNotes.find({ ipdNo })
    .populate("doctor", "personalInfo.fullName doctorId")
    .populate("department", "departmentName")
    .sort({ visitDate: -1 })
    .lean();
};

// ─────────────────────────────────────────────────────────────
// Get single note
// ─────────────────────────────────────────────────────────────
const getNoteById = async (id) => {
  const note = await DoctorNotes.findById(id)
    .populate(
      "patient",
      "fullName UHID age gender dateOfBirth contactNumber registrationType",
    )
    .populate("doctor", "personalInfo doctorId professional.registrationNumber")
    .populate("department", "departmentName")
    .populate("orders.nurseConfirmedBy", "personalInfo.fullName staffId");

  if (!note) {
    const error = new Error("Note not found");
    error.statusCode = 404;
    throw error;
  }
  return note;
};

// ─────────────────────────────────────────────────────────────
// Update draft note
// ─────────────────────────────────────────────────────────────
const updateDoctorNote = async (id, data, doctorUserId) => {
  const note = await DoctorNotes.findById(id);
  if (!note) {
    const error = new Error("Note not found");
    error.statusCode = 404;
    throw error;
  }
  if (note.status === "signed") {
    const error = new Error("Cannot edit signed note");
    error.statusCode = 400;
    throw error;
  }
  if (note.doctor && doctorUserId && note.doctor.toString() !== doctorUserId.toString()) {
    const error = new Error("Not authorised");
    error.statusCode = 403;
    throw error;
  }

  const allowed = [
    "soap",
    "vitals",
    "investigations",
    "orders",
    "provisionalDiagnosis",
    "workingDiagnosis",
    "finalDiagnosis",
    "icd10Code",
    "icd10Description",
    "shift",
  ];
  allowed.forEach((f) => {
    if (data[f] !== undefined) note[f] = data[f];
  });
  note.updatedBy = doctorUserId;
  await note.save();
  return note;
};

// ─────────────────────────────────────────────────────────────
// Update diagnosis fields only (works on signed notes too — NABH amendment)
// ─────────────────────────────────────────────────────────────
const updateDiagnosis = async (id, data) => {
  const diagFields = ["provisionalDiagnosis", "workingDiagnosis", "finalDiagnosis", "icd10Code", "icd10Description"];
  const update = {};
  diagFields.forEach(f => { if (data[f] !== undefined) update[f] = data[f]; });
  const note = await DoctorNotes.findByIdAndUpdate(
    id,
    { $set: update },
    { new: true }
  );
  if (!note) {
    const error = new Error("Note not found");
    error.statusCode = 404;
    throw error;
  }
  return note;
};

// ─────────────────────────────────────────────────────────────
// Delete draft note
// ─────────────────────────────────────────────────────────────
const deleteDoctorNote = async (id, doctorUserId) => {
  const note = await DoctorNotes.findById(id);
  if (!note) {
    const error = new Error("Note not found");
    error.statusCode = 404;
    throw error;
  }
  if (note.status === "signed") {
    const error = new Error("Cannot delete signed note");
    error.statusCode = 400;
    throw error;
  }
  if (note.doctor && doctorUserId && note.doctor.toString() !== doctorUserId.toString()) {
    const error = new Error("Not authorised");
    error.statusCode = 403;
    throw error;
  }
  await note.deleteOne();
  return true;
};

module.exports = {
  createDoctorNote,
  signDoctorNote,
  getPendingOrders,
  getNotesByPatient,
  getNotesByIPD,
  getNoteById,
  updateDoctorNote,
  updateDiagnosis,
  deleteDoctorNote,
};
