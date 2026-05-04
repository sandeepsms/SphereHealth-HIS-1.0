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
    patientId, patientUHID, patientName: pName,
    ipdNo, noteDate, shift, doctorId,
    generalCondition, vitals, painScore, painAssessment,
    ivLine, intakeOutput, ordersExecuted, nursingCare,
    remarks, status,
    // Extended fields from NursingNotesPage
    noteType, tags, isCriticalEvent, signature, signedByName,
    nurseEmployeeId,
    nurseSignature,
    // module-specific payloads
    ...rest
  } = data;

  // ── Nurse: resolve from User model (app uses User, not old NurseStaff) ──
  let nurseObjectId = null;
  let nurseName = data.nurseName || "";
  let nurseStaffId = nurseEmployeeId || "";
  let nurseDesignation = "";
  try {
    const User = require("../../models/User/userModel");
    const userDoc = await User.findById(nurseUserId).lean();
    if (userDoc) {
      nurseObjectId = userDoc._id;
      nurseName = userDoc.fullName || `${userDoc.firstName || ""} ${userDoc.lastName || ""}`.trim() || nurseName;
      nurseStaffId = userDoc.employeeId || nurseEmployeeId || "";
      nurseDesignation = userDoc.designation || "";
    }
  } catch (_) { /* use data from frontend */ }

  // ── Patient: accept reference if provided, don't block if not ──
  let patRef = patientId || undefined;
  let resolvedPatientName = pName || "";
  let resolvedPatientUHID = patientUHID || "";
  if (patRef) {
    try {
      const pat = await Patient.findById(patRef).lean();
      if (pat) {
        resolvedPatientName = pat.fullName || pName || "";
        resolvedPatientUHID = pat.UHID || patientUHID || "";
      }
    } catch (_) {}
  }

  const noteStatus = status || "submitted";

  // Capture ALL 15 module-specific payloads into moduleData (Mixed field)
  // so nothing is ever lost — every clinical module is fully preserved
  const MODULE_KEYS = [
    "vitals",              // vitals module (full BP/pulse/temp/spo2/gcs/bsl etc.)
    "neuroAssessment",     // neuro/GCS module
    "bloodTransfusion",    // blood transfusion module
    "ivInfusion",          // IV infusion module
    "intakeOutput",        // intake/output module (full object)
    "painAssessment",      // pain module (object — different from model's string field)
    "woundCare",           // wound/dressing module
    "skinAssessment",      // skin/pressure assessment module
    "fallRisk",            // Morse fall scale module
    "procedure",           // procedure/intervention module
    "discharge",           // discharge/handover module
    "mewsScore",           // MEWS score module
    "dailyAssessment",     // daily assessment module
    "initialAssessment",   // initial assessment module
    "carePlan",            // care plan module
    "nutritionalAssessment", // nutrition module
    "patientEducation",    // patient education module
  ];
  const moduleData = {};
  MODULE_KEYS.forEach(k => { if (data[k] !== undefined) moduleData[k] = data[k]; });

  const note = await NurseNotes.create({
    patient: patRef || undefined,
    patientName: resolvedPatientName,
    patientUHID: resolvedPatientUHID,
    ipdNo: ipdNo || resolvedPatientUHID || "N/A",
    noteDate: noteDate || new Date(),
    shift: shift || "morning",
    nurse: nurseObjectId || undefined,
    nurseName,
    nurseEmployeeId: nurseStaffId,
    nurseStaffId,
    nurseDesignation,
    nurseSignature: nurseSignature || undefined,
    noteType,
    tags: tags || [],
    isCriticalEvent: isCriticalEvent || false,
    signature: signature || undefined,
    signedByName: signedByName || nurseName || undefined,
    doctor: doctorId || undefined,
    generalCondition: generalCondition || {},
    vitals: vitals || {},
    painScore: painScore || 0,
    painAssessment: painAssessment || "",
    ivLine: ivLine || {},
    intakeOutput: intakeOutput || {},
    ordersExecuted: ordersExecuted || [],
    nursingCare: nursingCare || {},
    remarks: remarks || "",
    moduleData: Object.keys(moduleData).length ? moduleData : undefined,
    status: noteStatus,
    submittedAt: noteStatus === "submitted" ? new Date() : undefined,
    createdBy: nurseObjectId || undefined,
  });

  // Update TreatmentChart executions
  if (note.status === "submitted" && ordersExecuted?.length && nurseObjectId) {
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
          { _id: nurseObjectId, name: nurseName },
        );
      } catch (e) {
        console.error("TreatmentChart recordNurseExecution error:", e.message);
      }
    }
  }

  return NurseNotes.findById(note._id).lean();
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
  if (note.nurse && nurseUserId && note.nurse.toString() !== nurseUserId.toString()) {
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

  // Resolve nurse from User model (app uses User, not old NurseStaff)
  let nurseDoc = null;
  let nurseName = "";
  let nurseId = nurseUserId;
  try {
    const User = require("../../models/User/userModel");
    nurseDoc = await User.findById(nurseUserId).lean();
    if (nurseDoc) {
      nurseName = nurseDoc.fullName || `${nurseDoc.firstName || ""} ${nurseDoc.lastName || ""}`.trim();
      nurseId = nurseDoc._id;
    }
  } catch (_) {}

  const result = await DoctorNotes.updateOne(
    {
      _id: new mongoose.Types.ObjectId(doctorNoteId),
      "orders._id": new mongoose.Types.ObjectId(orderId),
    },
    {
      $set: {
        "orders.$.nurseStatus": status || "done",
        "orders.$.nurseConfirmedBy": nurseId,
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
  if (doctorNote && nurseId) {
    try {
      await TreatmentChart.recordNurseExecution(
        doctorNote.ipdNo,
        {
          orderId,
          status: status || "done",
          remarks: remarks || "",
          executedAt: new Date(),
          shift: shift || "morning",
        },
        { _id: nurseId, name: nurseName },
      );
    } catch (_) {}
  }

  return {
    confirmedBy: nurseName,
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
  if (note.nurse && nurseUserId && note.nurse.toString() !== nurseUserId.toString()) {
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
