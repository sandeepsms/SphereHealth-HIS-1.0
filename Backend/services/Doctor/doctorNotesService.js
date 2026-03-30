// Doctor/Services/doctorNotesService.js
// Business logic — Controller calls these functions

const DoctorNotes = require("../../models/Doctor/doctorNotesModel");
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
    patientId,
    ipdNo,
    visitDate,
    shift,
    soap,
    vitals,
    investigations,
    orders,
    provisionalDiagnosis,
    finalDiagnosis,
    status,
  } = data;

  const patient = await Patient.findById(patientId)
    .populate("department", "departmentName")
    .populate(
      "doctor",
      "personalInfo doctorId professional.registrationNumber",
    );
  if (!patient) {
    const error = new Error("Patient not found");
    error.statusCode = 404;
    throw error;
  }

  const doctor = await Doctor.findById(doctorUserId);
  if (!doctor) {
    const error = new Error("Doctor profile not found");
    error.statusCode = 404;
    throw error;
  }

  const noteStatus = status || "draft";

  const note = await DoctorNotes.create({
    patient: patientId,
    patientName: patient.fullName,
    patientUHID: patient.UHID,
    ipdNo: ipdNo || patient.UHID,
    visitDate: visitDate || Date.now(),
    shift: shift || "morning",
    doctor: doctor._id,
    doctorName: doctor.personalInfo.fullName,
    doctorId: doctor.doctorId,
    doctorRegNo: doctor.professional.registrationNumber,
    department: patient.department?._id,
    soap,
    vitals,
    investigations: investigations || [],
    orders: (orders || []).map((o) => ({ ...o, nurseStatus: "pending" })),
    provisionalDiagnosis,
    finalDiagnosis,
    status: noteStatus,
    createdBy: doctor._id,
  });

  // If signed → push to TreatmentChart + update visit counter
  if (noteStatus === "signed") {
    await TreatmentChart.addDoctorOrders(note);
    const visitField = VISIT_FIELD_MAP[patient.registrationType];
    if (visitField) {
      await Patient.findByIdAndUpdate(patientId, {
        lastVisitDate: Date.now(),
        $inc: { [visitField]: 1 },
      });
    }
  }

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
  if (note.doctor.toString() !== doctorUserId.toString()) {
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
  if (note.doctor.toString() !== doctorUserId.toString()) {
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
    "finalDiagnosis",
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
  if (note.doctor.toString() !== doctorUserId.toString()) {
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
  deleteDoctorNote,
};
