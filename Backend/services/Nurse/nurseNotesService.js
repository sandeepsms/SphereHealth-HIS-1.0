// services/Nurse/nurseNotesService.js

const mongoose = require("mongoose");
const NurseNotes = require("../../models/Nurse/nurseNotesModel");
const NurseStaff = require("../../models/Nurse/nurseStaffModel");
const DoctorNotes = require("../../models/Doctor/doctorNotesModel");
const Patient = require("../../models/Patient/patientModel");
const TreatmentChart = require("../../models/Doctor/treatmentChartModel");

/* ─────────────────────────────────────────────────────────────
   Create / Submit nurse note
───────────────────────────────────────────────────────────── */
const createNurseNote = async (data, nurseUserId) => {
  const {
    patientId,
    ipdNo,
    noteDate,
    shift,
    doctorId,
    generalCondition,
    vitals,
    painScore,
    painAssessment,
    ivLine,
    intakeOutput,
    ordersExecuted,
    nursingCare,
    remarks,
    status,
  } = data;

  // ── Patient ──
  const patient = await Patient.findById(patientId);
  if (!patient) {
    const e = new Error("Patient not found");
    e.statusCode = 404;
    throw e;
  }

  // ── Nurse ──
  const nurse = await NurseStaff.findById(nurseUserId);
  if (!nurse) {
    const e = new Error(`Nurse staff not found — id: ${nurseUserId}`);
    e.statusCode = 404;
    throw e;
  }
  if (!nurse.isActive) {
    const e = new Error("Nurse account is inactive");
    e.statusCode = 403;
    throw e;
  }

  const noteStatus = status || "submitted";

  const note = await NurseNotes.create({
    patient: patientId,
    patientName: patient.fullName,
    patientUHID: patient.UHID,
    ipdNo: ipdNo || patient.UHID,
    noteDate: noteDate || new Date(),
    shift,
    nurse: nurse._id, // ✅ required field
    nurseName:
      nurse.personalInfo?.fullName ||
      `${nurse.personalInfo?.firstName} ${nurse.personalInfo?.lastName}`,
    nurseStaffId: nurse.staffId,
    nurseDesignation: nurse.professional?.designation,
    doctor: doctorId || patient.doctor || null,
    department: patient.department || null,
    generalCondition: generalCondition || {},
    vitals: vitals || {},
    painScore: painScore || 0,
    painAssessment: painAssessment || "",
    ivLine: ivLine || {},
    intakeOutput: intakeOutput || {},
    ordersExecuted: ordersExecuted || [],
    nursingCare: nursingCare || {},
    remarks: remarks || "",
    status: noteStatus,
    submittedAt: noteStatus === "submitted" ? new Date() : undefined,
    createdBy: nurse._id,
  });

  // Update TreatmentChart executions
  if (note.status === "submitted" && ordersExecuted?.length) {
    for (const exec of ordersExecuted) {
      if (!exec.orderId) continue;
      try {
        await TreatmentChart.recordNurseExecution(
          note.ipdNo,
          {
            orderId: exec.orderId,
            status: exec.status || "done",
            remarks: exec.remarks || "",
            executedAt: exec.executedAt || new Date(),
            shift: note.shift,
            nurseNoteId: note._id,
          },
          {
            _id: nurse._id,
            name: nurse.personalInfo?.fullName || nurse.nurseName,
          },
        );
      } catch (e) {
        console.error("TreatmentChart recordNurseExecution error:", e.message);
      }
    }
  }

  return NurseNotes.findById(note._id)
    .populate("patient", "fullName UHID age gender")
    .populate("nurse", "personalInfo.fullName staffId professional.designation")
    .populate("doctor", "personalInfo.fullName doctorId")
    .populate("department", "departmentName")
    .lean();
};

/* ─────────────────────────────────────────────────────────────
   Get notes by patient
───────────────────────────────────────────────────────────── */
const getNotesByPatient = async (patientId, query) => {
  const { page = 1, limit = 20, shift, date } = query;
  const filter = { patient: patientId };
  if (shift) filter.shift = shift;
  if (date) _applyDateFilter(filter, date);

  const [notes, total] = await Promise.all([
    NurseNotes.find(filter)
      .populate(
        "nurse",
        "personalInfo.fullName staffId professional.designation",
      )
      .populate("doctor", "personalInfo.fullName doctorId")
      .populate("department", "departmentName")
      .sort({ noteDate: -1 })
      .skip((+page - 1) * +limit)
      .limit(+limit)
      .lean(),
    NurseNotes.countDocuments(filter),
  ]);

  return { notes, total, page: +page, pages: Math.ceil(total / +limit) };
};

/* ─────────────────────────────────────────────────────────────
   Get notes by ipdNo
───────────────────────────────────────────────────────────── */
const getNotesByIPD = async (ipdNo, query = {}) => {
  const { shift, date } = query;
  const filter = { ipdNo };
  if (shift) filter.shift = shift;
  if (date) _applyDateFilter(filter, date);

  return NurseNotes.find(filter)
    .populate("nurse", "personalInfo.fullName staffId professional.designation")
    .populate("doctor", "personalInfo.fullName doctorId")
    .sort({ noteDate: -1 })
    .lean();
};

/* ─────────────────────────────────────────────────────────────
   Get today's notes grouped by shift
───────────────────────────────────────────────────────────── */
const getTodayNotes = async (ipdNo) => {
  const filter = { ipdNo };
  _applyDateFilter(filter, new Date().toISOString());

  const notes = await NurseNotes.find(filter)
    .populate("nurse", "personalInfo.fullName staffId professional.designation")
    .sort({ shift: 1 })
    .lean();

  return notes.reduce((acc, n) => {
    acc[n.shift] = n;
    return acc;
  }, {});
};

/* ─────────────────────────────────────────────────────────────
   Get single note
───────────────────────────────────────────────────────────── */
const getNoteById = async (id) => {
  const note = await NurseNotes.findById(id)
    .populate("patient", "fullName UHID age gender dateOfBirth")
    .populate(
      "nurse",
      "personalInfo.fullName staffId professional.designation ward shift",
    )
    .populate(
      "doctor",
      "personalInfo.fullName doctorId professional.registrationNumber",
    )
    .populate("department", "departmentName");

  if (!note) {
    const e = new Error("Note not found");
    e.statusCode = 404;
    throw e;
  }
  return note;
};

/* ─────────────────────────────────────────────────────────────
   Update draft note
───────────────────────────────────────────────────────────── */
const updateNurseNote = async (id, data, nurseUserId) => {
  const note = await NurseNotes.findById(id);
  if (!note) {
    const e = new Error("Note not found");
    e.statusCode = 404;
    throw e;
  }
  if (note.status === "submitted") {
    const e = new Error("Cannot edit submitted note");
    e.statusCode = 400;
    throw e;
  }
  if (note.nurse.toString() !== nurseUserId.toString()) {
    const e = new Error("Not authorised");
    e.statusCode = 403;
    throw e;
  }

  const allowed = [
    "generalCondition",
    "vitals",
    "painScore",
    "painAssessment",
    "ivLine",
    "intakeOutput",
    "ordersExecuted",
    "nursingCare",
    "remarks",
  ];
  allowed.forEach((f) => {
    if (data[f] !== undefined) note[f] = data[f];
  });
  note.updatedBy = nurseUserId;
  await note.save();
  return note;
};

/* ─────────────────────────────────────────────────────────────
   Confirm single order
───────────────────────────────────────────────────────────── */
const confirmSingleOrder = async (data, nurseUserId) => {
  const { orderId, doctorNoteId, status, remarks, shift } = data;
  if (!orderId || !doctorNoteId) {
    const e = new Error("orderId and doctorNoteId are required");
    e.statusCode = 400;
    throw e;
  }

  const nurse = await NurseStaff.findById(nurseUserId);
  if (!nurse) {
    const e = new Error("Nurse not found");
    e.statusCode = 404;
    throw e;
  }

  const result = await DoctorNotes.updateOne(
    {
      _id: new mongoose.Types.ObjectId(doctorNoteId),
      "orders._id": new mongoose.Types.ObjectId(orderId),
    },
    {
      $set: {
        "orders.$.nurseStatus": status || "done",
        "orders.$.nurseConfirmedBy": nurse._id,
        "orders.$.nurseConfirmedAt": new Date(),
        "orders.$.nurseRemarks": remarks || "",
      },
    },
  );
  if (result.matchedCount === 0) {
    const e = new Error("Order not found");
    e.statusCode = 404;
    throw e;
  }

  const doctorNote = await DoctorNotes.findById(doctorNoteId).lean();
  if (doctorNote) {
    await TreatmentChart.recordNurseExecution(
      doctorNote.ipdNo,
      {
        orderId,
        status: status || "done",
        remarks: remarks || "",
        executedAt: new Date(),
        shift: shift || "morning",
      },
      { _id: nurse._id, name: nurse.personalInfo?.fullName },
    );
  }

  return {
    confirmedBy: nurse.personalInfo?.fullName,
    status: status || "done",
  };
};

/* ─────────────────────────────────────────────────────────────
   Delete draft
───────────────────────────────────────────────────────────── */
const deleteNurseNote = async (id, nurseUserId) => {
  const note = await NurseNotes.findById(id);
  if (!note) {
    const e = new Error("Note not found");
    e.statusCode = 404;
    throw e;
  }
  if (note.status === "submitted") {
    const e = new Error("Cannot delete submitted note");
    e.statusCode = 400;
    throw e;
  }
  if (note.nurse.toString() !== nurseUserId.toString()) {
    const e = new Error("Not authorised");
    e.statusCode = 403;
    throw e;
  }
  await note.deleteOne();
  return true;
};

/* ─────────────────────────────────────────────────────────────
   Internal helper
───────────────────────────────────────────────────────────── */
function _applyDateFilter(filter, dateStr) {
  const d = new Date(dateStr);
  filter.noteDate = {
    $gte: new Date(new Date(d).setHours(0, 0, 0, 0)),
    $lte: new Date(new Date(d).setHours(23, 59, 59, 999)),
  };
}

module.exports = {
  createNurseNote,
  getNotesByPatient,
  getNotesByIPD,
  getTodayNotes,
  getNoteById,
  updateNurseNote,
  confirmSingleOrder,
  deleteNurseNote,
};
