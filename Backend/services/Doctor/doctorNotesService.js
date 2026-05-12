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
const signDoctorNote = async (noteId, doctorUserId) => {
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
  // Only enforce ownership check if note has a doctor assigned
  if (note.doctor && doctorUserId && note.doctor.toString() !== doctorUserId.toString()) {
    const error = new Error("Not authorised to sign this note");
    error.statusCode = 403;
    throw error;
  }

  note.status = "signed";
  note.signedAt = new Date();
  note.updatedBy = doctorUserId;
  await note.save();

  // Push signed orders to TreatmentChart
  if (note.orders?.length) {
    await TreatmentChart.addDoctorOrders(note);
  }

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
