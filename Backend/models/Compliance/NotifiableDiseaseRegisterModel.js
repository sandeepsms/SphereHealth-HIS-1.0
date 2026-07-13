/**
 * NotifiableDiseaseRegisterModel.js — NABH HIC/IMS + IDSP statutory reporting
 *
 * One row per notifiable-disease case. Auto-raised when a coded diagnosis
 * matching the notifiable ICD-10 list is recorded (discharge finalize hook),
 * or entered manually by the IC officer. Tracks the statutory notification to
 * the district / IDSP authority: due-by (from the disease's reporting window),
 * whether/when notified, the reference number, and the reporting officer.
 *
 * Number: ND-YY-N (FY-keyed, gap-less via the shared counter).
 */
"use strict";

const mongoose = require("mongoose");
const { nextSequence } = require("../../utils/counter");
const { Schema } = mongoose;

const AuditSchema = new Schema({
  _id: false,
  action: { type: String, enum: ["CREATED", "NOTIFIED", "UPDATED", "CLOSED"], default: "CREATED" },
  at: { type: Date, default: Date.now },
  byName: { type: String, default: "" },
  byRole: { type: String, default: "" },
  byUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  notes: { type: String, default: "" },
});

const NotifiableDiseaseRegisterSchema = new Schema(
  {
    caseNumber: { type: String, unique: true, sparse: true, index: true }, // ND-YY-N

    // ── Patient ──
    UHID: { type: String, uppercase: true, trim: true, default: "", index: true },
    patientId: { type: Schema.Types.ObjectId, ref: "Patient", default: null },
    patientName: { type: String, default: "" },
    age: { type: Number, default: null },
    sex: { type: String, default: "" },
    address: { type: String, default: "" },
    admissionId: { type: Schema.Types.ObjectId, ref: "Admission", default: null, index: true },

    // ── Disease ──
    disease: { type: String, required: true, trim: true, index: true },
    icdCode: { type: String, default: "" },
    diagnosisDate: { type: Date, default: Date.now, index: true },
    labConfirmed: { type: Boolean, default: false },

    // ── Statutory notification ──
    reportingWindowHours: { type: Number, default: 24 },
    notificationDueBy: { type: Date, default: null, index: true },
    notifiedToAuthority: { type: Boolean, default: false, index: true },
    notifiedAt: { type: Date, default: null },
    authorityName: { type: String, default: "" },       // District Surveillance Officer / IDSP unit
    notificationReference: { type: String, default: "" },
    reportingOfficerName: { type: String, default: "" },

    status: { type: String, enum: ["Pending-Notification", "Notified", "Closed"], default: "Pending-Notification", index: true },
    // Idempotency for the auto-raise hook (per admission + disease).
    // (Index declared via schema.index({sourceRef:1},{sparse:true}) below.)
    sourceRef: { type: String, default: "" },
    sourceType: { type: String, default: "Manual" },
    remarks: { type: String, default: "" },

    auditTrail: { type: [AuditSchema], default: [] },
    hospitalId: { type: Schema.Types.ObjectId, ref: "Hospital", default: null },
    createdByName: { type: String, default: "" },
  },
  { timestamps: true, collection: "notifiable_disease_registers" },
);

NotifiableDiseaseRegisterSchema.index({ status: 1, notificationDueBy: 1 });
NotifiableDiseaseRegisterSchema.index({ disease: 1, diagnosisDate: -1 });
NotifiableDiseaseRegisterSchema.index({ sourceRef: 1 }, { sparse: true });

NotifiableDiseaseRegisterSchema.pre("save", async function (next) {
  // Derive the notification due-by from diagnosis date + reporting window.
  if (this.isNew && !this.notificationDueBy && this.diagnosisDate) {
    this.notificationDueBy = new Date(new Date(this.diagnosisDate).getTime() + (this.reportingWindowHours || 24) * 3600 * 1000);
  }
  if (this.caseNumber) return next();
  try {
    const now = new Date();
    const fyStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    const yy = String(fyStartYear).slice(-2);
    const seq = await nextSequence(`notifiable:${yy}`);
    this.caseNumber = `ND-${yy}-${seq}`;
    next();
  } catch (e) { next(e); }
});

module.exports =
  mongoose.models.NotifiableDiseaseRegister ||
  mongoose.model("NotifiableDiseaseRegister", NotifiableDiseaseRegisterSchema);
