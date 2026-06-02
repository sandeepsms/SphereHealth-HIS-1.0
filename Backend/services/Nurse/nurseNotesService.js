// services/Nurse/nurseNotesService.js

const mongoose = require("mongoose");
// FIX (audit P13-B1): actual filenames are PascalCase (NurseNotesModel,
// NurseStaffModel, DoctorNotesModel). Windows-case-insensitive lookups
// hid this, but Linux production would 404 these requires at boot.
const NurseNotes = require("../../models/Nurse/NurseNotesModel");
const NurseStaff = require("../../models/Nurse/NurseStaffModel");
const DoctorNotes = require("../../models/Doctor/DoctorNotesModel");
const Patient = require("../../models/Patient/patientModel");
const TreatmentChart = require("../../models/Doctor/treatmentChartModel");
// R7az-D10 hash-chained audit for amend / addendum rows.
const activityLogger = require("../Clinical/activityLogger");

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
    // Late-entry / retroactive note metadata — reserved so it lands in
    // dedicated schema columns instead of being swept into noteData.
    "lateEntry","lateEntryReason","lateEntryBy","lateEntryByRole",
  ]);

  // ── Late-entry validation (NABH HIC.6) ─────────────────────────
  // If the caller marks this as a retroactive entry against a
  // discharged admission, a non-empty reason is mandatory. We reject
  // the save here so the audit log is never polluted with a flagged
  // entry that has no justification.
  if (data.lateEntry) {
    const reason = String(data.lateEntryReason || "").trim();
    if (!reason) {
      const err = new Error("Late-entry note requires a reason (NABH HIC.6 — backdated entry justification)");
      err.statusCode = 400;
      throw err;
    }
  }

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
  // R7az-D2-HIGH-5: orphan-write closure. A nurse note must attach to a
  // resolved Patient ObjectId OR carry a non-empty UHID/admissionNumber
  // — otherwise we'd silently create floating notes nobody can ever
  // surface in the patient file. NABH AAC.7 (record completeness).
  const finalPatientId = patient?._id || (mongoose.isValidObjectId(String(resolvedPatientId)) ? resolvedPatientId : null);
  const finalUHID = data.patientUHID || data.UHID || patient?.UHID || "";
  const finalIPD  = ipdNo || data.admissionNumber || "";
  if (!finalPatientId && !finalUHID && !finalIPD) {
    const e = new Error("Nurse note must reference a patient (patientId / UHID / ipdNo) — refusing orphaned write (NABH AAC.7)");
    e.statusCode = 400;
    throw e;
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

  // R7go — Resolve the actor's User record so we can stamp the canonical
  // hospital employee ID (User.employeeId, e.g. NUR-26-00001 / ADM-26-00001)
  // on every signed note. Surfaced next to the signer's name in the patient
  // panel + Complete File print. NurseStaff.staffId stays as the nursing-
  // service-internal identifier; User.employeeId is the cross-role canonical
  // one the user wants on every audit row.
  let actorUserEmpId = "";
  let actorUserName  = "";
  if (nurseUserId && mongoose.isValidObjectId(String(nurseUserId))) {
    try {
      const User = require("../../models/User/userModel");
      const userDoc = await User.findById(nurseUserId).select("employeeId fullName firstName lastName").lean();
      if (userDoc) {
        actorUserEmpId = userDoc.employeeId || "";
        actorUserName  = userDoc.fullName ||
          `${userDoc.firstName || ""} ${userDoc.lastName || ""}`.trim();
      }
    } catch (_) { /* non-fatal */ }
  }

  // R7bv — Resolve the patient's active admission and stamp the
  // admission-derived ipdNo (admissionNumber) when the caller didn't pass
  // one. Pre-R7bv the fallback chain fell THROUGH to data.patientUHID /
  // data.UHID, which poisoned the nurse_notes collection with rows
  // carrying ipdNo:"UH00000029" — the aggregator's `{ipdNo}` filter
  // (which expects the admissionNumber) then silently dropped them.
  // NEVER fall back to the UHID for ipdNo.
  let admForLinkage = null;
  const uhidForLookup = data.patientUHID || data.UHID || patient?.UHID || null;
  if (uhidForLookup && (!ipdNo || !data.admissionNumber)) {
    try {
      const Admission = require("../../models/Patient/admissionModel");
      admForLinkage = await Admission.findOne({
        UHID: uhidForLookup, status: "Active",
      }).select("_id admissionNumber").lean();
    } catch (_) { /* non-fatal */ }
  }
  const resolvedIpdNo =
    ipdNo ||
    data.admissionNumber ||
    admForLinkage?.admissionNumber ||
    "";

  const noteStatus = status || "submitted";

  const note = await NurseNotes.create({
    patient: patient?._id || resolvedPatientId || undefined,
    patientName: data.patientName || patient?.fullName || "",
    patientUHID: data.patientUHID || data.UHID || patient?.UHID || "",
    ipdNo: resolvedIpdNo,
    noteDate: noteDate || new Date(),
    shift: shift || "general",
    nurse: nurse?._id || undefined,
    nurseName: data.nurseName || nurse?.personalInfo?.fullName || nurse?.nurseName || actorUserName || "",
    nurseStaffId: nurse?.staffId || "",
    // R7go — Prefer User.employeeId (canonical hospital ID) over the
    // request-supplied value or NurseStaff.staffId. Falls back through the
    // legacy chain so older callers still work.
    nurseEmployeeId: actorUserEmpId || data.nurseEmployeeId || nurse?.staffId || "",
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
    signedByName: signedByName || actorUserName || "",
    // R7go — Persist the signer's User.employeeId so the panel + print
    // can show "Emp ID: NUR-26-00001" without a User join. When admin/
    // charge-nurse signs another nurse's note this captures the actual
    // pen-holder (not the original author).
    signedByEmpId: actorUserEmpId || "",
    remarks: remarks || "",
    status: noteStatus,
    submittedAt: noteStatus === "submitted" ? new Date() : undefined,
    createdBy: nurse?._id || undefined,
    // Late-entry stamps — only persisted when caller opts in. lateEntryAt
    // is always "now" (when the entry was actually typed); noteDate is
    // the clinical date being documented. Both together give NABH
    // surveyors an unambiguous timeline on the audit replay.
    lateEntry:       !!data.lateEntry,
    lateEntryReason: data.lateEntry ? String(data.lateEntryReason || "").trim() : undefined,
    lateEntryAt:     data.lateEntry ? new Date() : undefined,
    lateEntryBy:     data.lateEntry ? (data.lateEntryBy || data.nurseName || nurse?.personalInfo?.fullName || "") : undefined,
    lateEntryByRole: data.lateEntry ? (data.lateEntryByRole || data.nurseDesignation || "Nurse") : undefined,
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
   Update nurse note — drafts mutate; SUBMITTED notes spawn an
   append-only ADDENDUM (R7az-D2-HIGH-4 / NABH HIC.7).
───────────────────────────────────────────────────────────── */
const updateNurseNote = async (id, data, nurseUserId) => {
  const note = await NurseNotes.findById(id);
  if (!note) {
    const e = new Error("Note not found");
    e.statusCode = 404;
    throw e;
  }
  // R7az-D2-HIGH-5: legacy nurse-null notes shouldn't be editable by
  // arbitrary nurses — refuse rather than fall through to a free-for-all.
  if (!note.nurse) {
    const e = new Error("Cannot edit legacy note with no nurse owner — create an addendum via a new note instead");
    e.statusCode = 403;
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

  if (note.status === "submitted") {
    // ── ADDENDUM path ──
    const base = note.toObject();
    delete base._id;
    delete base.__v;
    delete base.createdAt;
    delete base.updatedAt;
    delete base.submittedAt;
    base.signature = undefined;
    allowed.forEach((f) => {
      if (data[f] !== undefined) base[f] = data[f];
    });
    base.status = "draft"; // addendum starts as a fresh draft the nurse can submit
    base.isAddendum = true;
    base.originalNoteId   = note.originalNoteId || note._id;
    base.supersedesNoteId = note._id;
    base.updatedBy = nurseUserId;
    const addendum = await NurseNotes.create(base);

    activityLogger.log({
      UHID: note.patientUHID || "",
      patientId: note.patient || null,
      ipdNo: note.ipdNo || "",
      action: "amend",
      module: "NurseNote",
      sourceModel: "NurseNotes",
      sourceId: addendum._id,
      summary: `Addendum to nurse note ${note._id} (submitted → amended draft)`,
      userId: nurseUserId || null,
      before: { _id: note._id, status: note.status },
      after:  { _id: addendum._id, supersedesNoteId: note._id, originalNoteId: addendum.originalNoteId, status: "draft" },
    }).catch((e) => console.error("[nurseNotes] amend audit failed:", e.message));

    return addendum;
  }

  // ── DRAFT path ──
  allowed.forEach((f) => {
    if (data[f] !== undefined) note[f] = data[f];
  });
  note.updatedBy = nurseUserId;
  await note.save();
  return note;
};

/* ─────────────────────────────────────────────────────────────
   Confirm single order
   R7az-D2-MED-8: each confirmation pushes onto a history array on the
   matching open nurse note (if any) so the legacy "last confirmer wins"
   pattern is replaced with an append-only audit trail. The DoctorNotes
   "orders[].nurseStatus" still reflects the latest state (downstream
   filters depend on it), but every confirmer is now traceable.
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

    // R7az-D2-MED-8: push the confirmation history onto the most recent
    // open (draft) nurse note for this admission/shift if one exists.
    // No-op if nothing matches — the DoctorNotes order array still
    // carries the latest state and the activity log captures actor.
    try {
      const targetNote = await NurseNotes.findOne({
        ipdNo: doctorNote.ipdNo,
        shift: shift || "morning",
        status: "draft",
      }).sort({ createdAt: -1 });
      if (targetNote) {
        targetNote.nurseConfirmations = targetNote.nurseConfirmations || [];
        targetNote.nurseConfirmations.push({
          nurseId:      nurse._id,
          nurseName:    nurse.personalInfo?.fullName || nurse.nurseName || "",
          orderId:      new mongoose.Types.ObjectId(orderId),
          doctorNoteId: new mongoose.Types.ObjectId(doctorNoteId),
          ts:           new Date(),
          status:       status || "done",
          remarks:      remarks || "",
        });
        await targetNote.save();
      }
    } catch (e) {
      console.error("[nurseNotes] confirm history push failed:", e.message);
    }
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
  // R7az-D2-HIGH-5: legacy null-nurse notes refuse delete too — only the
  // recorded nurse owner can drop a draft.
  if (!note.nurse) {
    const e = new Error("Cannot delete legacy note with no nurse owner");
    e.statusCode = 403;
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
   Blood transfusion helpers (audit P13-B2 — controller references
   these but they didn't exist in the legacy service, so the two
   PATCH endpoints always threw TypeError).
───────────────────────────────────────────────────────────── */
// R7az-S3 / D7-CRIT-4: refuse mutations when the parent nurse note is
// already SUBMITTED — append-only invariant. Monitoring entries are
// appended (never edited / removed in place); status updates only land
// on a still-draft note. NABH MOM.4-style append-only on blood-product
// administration records.
const addBloodMonitoringEntry = async (noteId, entry) => {
  const note = await NurseNotes.findById(noteId);
  if (!note) throw new Error("Nurse note not found");
  if (note.status === "submitted") {
    const e = new Error("Cannot append blood-monitoring entry on a submitted note — create an addendum");
    e.statusCode = 400;
    throw e;
  }
  const path = (note.noteData && note.noteData.bloodTransfusion) || {};
  const monitoring = Array.isArray(path.monitoring) ? path.monitoring.slice() : [];
  monitoring.push({
    at: entry?.at || new Date(),
    pulse: entry?.pulse,
    bp:    entry?.bp,
    temp:  entry?.temp,
    spo2:  entry?.spo2,
    rr:    entry?.rr,
    observation: entry?.observation || "",
    reaction:    entry?.reaction    || "",
    recordedBy:  entry?.recordedBy  || "",
  });
  note.noteData = {
    ...note.noteData,
    bloodTransfusion: { ...path, monitoring },
  };
  note.markModified("noteData");
  return note.save();
};

const updateBloodTransfusionStatus = async (noteId, status, notes = "") => {
  const note = await NurseNotes.findById(noteId);
  if (!note) throw new Error("Nurse note not found");
  if (note.status === "submitted") {
    const e = new Error("Cannot change blood-transfusion status on a submitted note — create an addendum");
    e.statusCode = 400;
    throw e;
  }
  // Accept either a string or an object body — the legacy controller
  // sometimes passes a status payload.
  const finalStatus = typeof status === "string" ? status : status?.status;
  const finalNotes  = typeof notes  === "string" ? notes  : (status?.notes || "");
  const path = (note.noteData && note.noteData.bloodTransfusion) || {};
  note.noteData = {
    ...note.noteData,
    bloodTransfusion: {
      ...path,
      status: finalStatus,
      statusNotes: finalNotes,
      statusUpdatedAt: new Date(),
    },
  };
  note.markModified("noteData");
  return note.save();
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
  addBloodMonitoringEntry,
  updateBloodTransfusionStatus,
};
