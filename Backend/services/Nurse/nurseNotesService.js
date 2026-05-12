// services/Nurse/nurseNotesService.js

const mongoose = require("mongoose");
const NurseNotes = require("../../models/Nurse/NurseNotesModel");
const NurseStaff = require("../../models/Nurse/NurseStaffModel");
const DoctorNotes = require("../../models/Doctor/DoctorNotesModel");
const Patient = require("../../models/Patient/patientModel");
const TreatmentChart = require("../../models/Doctor/treatmentChartModel");

/* ─────────────────────────────────────────────────────────────
   Create / Submit nurse note
───────────────────────────────────────────────────────────── */
const createNurseNote = async (data, nurseUserId) => {
  // ── Known base fields (stored in dedicated schema columns) ──
  const BASE_FIELDS = new Set([
    "patientId","patientUHID","patientName","UHID","admissionNumber",
    "ipdNo","noteDate","shift","doctorId","generalCondition","vitals",
    "painScore","painAssessment","ivLine","intakeOutput","ordersExecuted",
    "nursingCare","remarks","status","noteType","tags","isCriticalEvent",
    "signature","signedByName","nurseName","nurseEmployeeId","nurseId",
    "nurseDesignation","nurseStaffId",
  ]);

  const {
    patientId, ipdNo, noteDate, shift, doctorId,
    generalCondition, vitals, painScore, painAssessment,
    ivLine, intakeOutput, ordersExecuted, nursingCare, remarks, status,
    noteType, tags, isCriticalEvent, signature, signedByName,
  } = data;

  // Collect every extra key (module-specific payloads) into noteData
  // This preserves ALL data regardless of note type — checkboxes, dropdowns,
  // selected tabs, text inputs — nothing is lost.
  const noteData = {};
  for (const [key, val] of Object.entries(data)) {
    if (!BASE_FIELDS.has(key) && val !== undefined && val !== null) {
      noteData[key] = val;
    }
  }

  // ── Patient — resolve ObjectId from UHID or patientId ──
  let patient = null;
  const mongoose = require("mongoose");
  // Extract the actual patient ObjectId (patientId might be a populated object)
  const resolvedPatientId = patientId?._id || patientId;
  if (resolvedPatientId && mongoose.isValidObjectId(String(resolvedPatientId))) {
    patient = await Patient.findById(resolvedPatientId).catch(() => null);
  }
  // Fallback: find by UHID
  if (!patient && (data.patientUHID || data.UHID)) {
    patient = await Patient.findOne({ UHID: (data.patientUHID || data.UHID) }).catch(() => null);
  }

  // ── Nurse — try NurseStaff lookup but don't fail if not found ──
  let nurse = null;
  if (nurseUserId && mongoose.isValidObjectId(String(nurseUserId))) {
    nurse = await NurseStaff.findById(nurseUserId).catch(() => null);
  }
  // Fallback: find by staffId
  if (!nurse && data.nurseEmployeeId) {
    nurse = await NurseStaff.findOne({ staffId: data.nurseEmployeeId }).catch(() => null);
  }

  const noteStatus = status || "submitted";

  const note = await NurseNotes.create({
    patient: patient?._id || resolvedPatientId || undefined,
    patientName: data.patientName || patient?.fullName || "",
    patientUHID: data.patientUHID || data.UHID || patient?.UHID || "",
    ipdNo: ipdNo || data.admissionNumber || data.patientUHID || data.UHID || "",
    noteDate: noteDate || new Date(),
    shift: shift || "general",
    nurse: nurse?._id || undefined,
    nurseName: data.nurseName || nurse?.personalInfo?.fullName || nurse?.nurseName || "",
    nurseStaffId: nurse?.staffId || "",
    nurseEmployeeId: data.nurseEmployeeId || "",
    nurseDesignation: data.nurseDesignation || nurse?.professional?.designation || "",
    doctor: doctorId || patient?.doctor || null,
    department: patient?.department || null,
    noteType: noteType || "general",
    generalCondition: generalCondition || {},
    vitals: vitals || {},
    painScore: painScore || 0,
    painAssessment: painAssessment || "",
    ivLine: ivLine || {},
    intakeOutput: intakeOutput || {},
    ordersExecuted: ordersExecuted || [],
    nursingCare: nursingCare || {},
    noteData: Object.keys(noteData).length ? noteData : undefined,
    tags: tags || [],
    isCriticalEvent: isCriticalEvent || false,
    signature: signature || undefined,
    signedByName: signedByName || "",
    remarks: remarks || "",
    status: noteStatus,
    submittedAt: noteStatus === "submitted" ? new Date() : undefined,
    createdBy: nurse?._id || undefined,
  });

  // Update TreatmentChart executions
  if (note.status === "submitted" && ordersExecuted?.length && nurse) {
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

    // ── Auto-log diluent volume to Input chart ──
    // If the doctor specified a dilution (e.g. 100ml NS), add it to ivFluids
    // in the current shift's I/O record whenever nurse marks the order as done.
    const confirmedOrder = doctorNote.orders?.find(
      (o) => o._id?.toString() === orderId
    );
    if ((status === "done" || !status) && confirmedOrder?.dilutionVolume) {
      try {
        await _autoLogDilutionIO({
          ipdNo:          doctorNote.ipdNo,
          UHID:           doctorNote.patientUHID,
          patientName:    doctorNote.patientName,
          shift:          shift || "morning",
          dilutionVolume: confirmedOrder.dilutionVolume,
          dilutionFluid:  confirmedOrder.dilutionFluid || "NS",
          medicineName:   confirmedOrder.instruction || "medication",
          orderId:        confirmedOrder._id,
          nurseName:      nurse.personalInfo?.fullName || "",
        });
      } catch (ioErr) {
        console.error("Auto I/O dilution log error:", ioErr.message);
      }
    }
  }

  return {
    confirmedBy: nurse.personalInfo?.fullName,
    status: status || "done",
  };
};

/* ─────────────────────────────────────────────────────────────
   Auto-log diluent volume to I/O chart (internal helper)
   Upserts today's NurseNote for the given ipdNo+shift and:
     • increments intakeOutput.ivFluids by dilutionVolume
     • pushes one record into intakeOutput.ivFluidEntries
───────────────────────────────────────────────────────────── */
async function _autoLogDilutionIO({
  ipdNo, UHID, patientName, shift,
  dilutionVolume, dilutionFluid, medicineName, orderId, nurseName,
}) {
  const today    = new Date(); today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today.getTime() + 86_400_000);
  const entry = {
    time:      new Date(),
    volume:    dilutionVolume,
    fluid:     dilutionFluid,
    via:       medicineName,
    auto:      true,
    orderId,
    enteredBy: nurseName,
  };
  await NurseNotes.findOneAndUpdate(
    { ipdNo, shift, noteDate: { $gte: today, $lt: tomorrow } },
    {
      $inc:  { "intakeOutput.ivFluids": dilutionVolume },
      $push: { "intakeOutput.ivFluidEntries": entry },
      $setOnInsert: {
        ipdNo,
        patientUHID: UHID || "",
        patientName: patientName || "",
        noteDate:    new Date(),
        noteType:    "general",
        status:      "draft",
        shift,
      },
    },
    { upsert: true, new: true }
  );
}

/* ─────────────────────────────────────────────────────────────
   Add one monitoring log entry to an existing blood-transfusion note
   (submitted notes are intentionally updatable here — monitoring
    continues after the note is first saved)
───────────────────────────────────────────────────────────── */
const addBloodMonitoringEntry = async (noteId, entry) => {
  const note = await NurseNotes.findById(noteId);
  if (!note) {
    const e = new Error("Note not found");
    e.statusCode = 404;
    throw e;
  }
  if (note.noteType !== "blood") {
    const e = new Error("Note is not a blood-transfusion note");
    e.statusCode = 400;
    throw e;
  }

  // noteData is Mixed — create new object refs so Mongoose detects the change
  const bt = { ...(note.noteData?.bloodTransfusion || {}) };
  bt.monitoringLogs = [
    ...(Array.isArray(bt.monitoringLogs) ? bt.monitoringLogs : []),
    { ...entry, savedAt: new Date() },
  ];
  note.noteData = { ...(note.noteData || {}), bloodTransfusion: bt };
  note.markModified("noteData");
  await note.save();
  return note;
};

/* ─────────────────────────────────────────────────────────────
   Update blood-transfusion status (Completed / Stopped / Held / Reaction)
   + record end-time and post-transfusion vitals
───────────────────────────────────────────────────────────── */
const updateBloodTransfusionStatus = async (noteId, { status, endTime, reactionType, postVitals }) => {
  const note = await NurseNotes.findById(noteId);
  if (!note) {
    const e = new Error("Note not found");
    e.statusCode = 404;
    throw e;
  }
  if (note.noteType !== "blood") {
    const e = new Error("Note is not a blood-transfusion note");
    e.statusCode = 400;
    throw e;
  }

  const bt = { ...(note.noteData?.bloodTransfusion || {}) };
  if (status)                    bt.status      = status;
  if (endTime)                   bt.endTime     = endTime;
  if (reactionType !== undefined) bt.reactionType = reactionType;
  if (postVitals && typeof postVitals === "object") {
    // postBP_sys, postBP_dia, postPulse, postTemp, postSpO2
    Object.assign(bt, postVitals);
  }

  note.noteData = { ...(note.noteData || {}), bloodTransfusion: bt };
  note.markModified("noteData");
  await note.save();
  return note;
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
  addBloodMonitoringEntry,
  updateBloodTransfusionStatus,
  deleteNurseNote,
};
