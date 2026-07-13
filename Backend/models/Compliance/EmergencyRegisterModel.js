/**
 * EmergencyRegisterModel.js — R7bo / NABH AAC.1 + AAC.4
 *
 * Chronological ER log. Distinct from the existing Emergency *visit* model
 * (Backend/models/Patient/emergencyModel.js) which is a transactional row
 * the ER team works on. This register is an audit-grade append-only
 * record surveyors inspect for door-to-X timing compliance.
 *
 * Auto-populated by nabhRegisterEmitter.emitEmergency on every ER visit
 * creation, then updated as triage / disposition fields are filled.
 * Locked once disposition is set.
 */
"use strict";

const mongoose = require("mongoose");
const { Schema } = mongoose;

const AuditSchema = new Schema(
  {
    _id: false,
    action: { type: String, enum: ["CREATED", "TRIAGED", "SEEN_BY_DOCTOR", "DISPOSITION_SET", "MLC_FLAGGED", "LOCKED"], required: true },
    at: { type: Date, default: Date.now },
    byName: { type: String, default: "" },
    byRole: { type: String, default: "" },
    byUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    notes: { type: String, default: "", maxlength: 500 },
  },
);

const EmergencyRegisterSchema = new Schema(
  {
    // ── Auto-generated ER serial: ER-YYYY-NNNNNN ──
    erNumber: { type: String, required: true, unique: true, index: true },

    // ── Patient ──
    patientId: { type: Schema.Types.ObjectId, ref: "Patient", required: true, index: true },
    UHID: { type: String, required: true, uppercase: true, trim: true, index: true },
    patientName: { type: String, default: "" },
    age: { type: Number, default: null },
    sex: { type: String, default: "" },
    contactNumber: { type: String, default: "" },

    // ── Link to the underlying Emergency visit document ──
    emergencyId: { type: Schema.Types.ObjectId, ref: "Emergency", required: true, index: true },
    emergencyNumber: { type: String, default: "" },

    // ── Door-to-X timeline (NABH AAC.1) ──
    arrivalAt: { type: Date, required: true, index: true },
    triageAt: { type: Date, default: null },
    firstSeenByDoctorAt: { type: Date, default: null },
    dispositionAt: { type: Date, default: null },

    doorToTriageMinutes: { type: Number, default: null },
    doorToDoctorMinutes: { type: Number, default: null },
    doorToDispositionMinutes: { type: Number, default: null },

    // ── Triage ──
    triageCategory: {
      type: String,
      enum: ["Critical", "Emergency", "Urgent", "Semi-urgent", "Non-urgent"],
      required: true,
      index: true,
    },

    // ── Presentation ──
    presentingComplaint: { type: String, default: "" },
    modeOfArrival: {
      type: String,
      enum: ["Ambulance", "Walk-in", "Police", "Referred", "Other"],
      default: "Walk-in",
    },
    broughtBy: {
      type: String,
      enum: ["Self", "Relative", "Police", "Bystander", "Ambulance crew", "Other"],
      default: "Self",
    },
    preHospitalInterventions: { type: String, default: "" },

    // ── Personnel ──
    consultantIncharge: { type: String, default: "" },
    attendingDoctorId: { type: Schema.Types.ObjectId, ref: "Doctor", default: null },
    triageNurse: { type: String, default: "" },

    // ── Disposition (terminal — sets locked=true) ──
    disposition: {
      type: String,
      enum: ["", "Admitted", "Discharged", "DAMA", "Referred", "Death", "DOA", "Absconded", "Observation"],
      default: "",
      index: true,
    },
    dispositionNotes: { type: String, default: "" },
    admissionLinkId: { type: Schema.Types.ObjectId, ref: "Admission", default: null },
    referredTo: { type: String, default: "" },

    // ── MLC cross-link ──
    isMLC: { type: Boolean, default: false, index: true },
    mlcNumber: { type: String, default: "" },
    mlcCaseId: { type: Schema.Types.ObjectId, ref: "MLCReport", default: null },
    // R7hr(REG-V): emitEmergency has set these since day one, but strict
    // mode silently dropped them because the schema lacked the fields —
    // statutory MLC police details never persisted on the ER register.
    policeStation: { type: String, default: "" },
    policeOfficer: { type: String, default: "" },
    policeFIRNo:   { type: String, default: "" },

    // ── Append-only lock ──
    locked: { type: Boolean, default: false, index: true },
    lockedAt: { type: Date, default: null },

    auditTrail: { type: [AuditSchema], default: [] },

    hospitalId: { type: Schema.Types.ObjectId, ref: "Hospital", default: null },
  },
  { timestamps: true, collection: "emergency_registers" },
);

// Surveyor-inspection indexes
EmergencyRegisterSchema.index({ arrivalAt: -1 });
EmergencyRegisterSchema.index({ triageCategory: 1, arrivalAt: -1 });
EmergencyRegisterSchema.index({ isMLC: 1, arrivalAt: -1 });
EmergencyRegisterSchema.index({ disposition: 1, dispositionAt: -1 });

// ── D19 — NABH register tamper-evidence ─────────────────────
// Stamp a keyed HMAC-SHA256 integrity digest on every save so an out-of-band
// edit of this surveyor-inspected register row is detectable. Non-blocking +
// backward-compatible: legacy rows (no stored digest) verify as "unverified",
// never "tampered". Keyed by env REGISTER_HMAC_SECRET.
const { registerIntegrityPlugin } = require("../../utils/registerIntegrity");
EmergencyRegisterSchema.plugin(registerIntegrityPlugin);

module.exports =
  mongoose.models.EmergencyRegister ||
  mongoose.model("EmergencyRegister", EmergencyRegisterSchema);
