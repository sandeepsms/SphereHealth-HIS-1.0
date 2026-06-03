/**
 * ECGRegisterModel.js — R7en / NABH AAC.4 + IPSG.2 + COP.7
 *
 * Chronological register of every 12-lead ECG performed in the facility:
 * Ward / ICU / ER / OPD / Cath Lab / Day Care. Append-only audit-grade log
 * — the canonical NABH "ECG register" surveyors ask for under cardiac care
 * (COP.7) and critical-findings escalation (IPSG.2).
 *
 * Auto-populated by nabhRegisterEmitter.emitECG from:
 *   - DoctorOrder with orderType === "Investigation" + ECG-keyworded name
 *     (creates a "PendingReport" row at order time)
 *   - Manual entry from the ECG Register page (nurse / tech triggered)
 *
 * Findings (rhythm / HR / intervals / ST-T) are filed via PATCH /report
 * once the strip is reviewed; criticalFlag auto-derives from VT / VF /
 * AV-Block-3 / Asystole rhythm OR ST-elevation, and cross-links to
 * CriticalValueAlert for the same escalation path BloodSugar uses.
 * 1-hour grace for typo edits; lockedAt freezes the row after that.
 */
"use strict";

const mongoose = require("mongoose");
const { Schema } = mongoose;

const AuditSchema = new Schema(
  {
    _id: false,
    action: {
      type: String,
      enum: ["CREATED", "REPORTED", "REVIEWED", "CRITICAL_FLAGGED", "CORRECTED", "LOCKED"],
      required: true,
    },
    at: { type: Date, default: Date.now },
    byName: { type: String, default: "" },
    byRole: { type: String, default: "" },
    byUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    reason: { type: String, default: "", maxlength: 500 },
  },
);

const ECGRegisterSchema = new Schema(
  {
    // ── Patient ──
    patientId: { type: Schema.Types.ObjectId, ref: "Patient", required: true, index: true },
    UHID: { type: String, required: true, uppercase: true, trim: true, index: true },
    patientName: { type: String, default: "" },
    age: { type: Number, default: null },
    sex: { type: String, default: "" },
    admissionId: { type: Schema.Types.ObjectId, ref: "Admission", default: null, index: true },
    admissionNumber: { type: String, default: "" },

    // ── ECG metadata ──
    // ECG-YYYY-000001 — gap-less per-year sequence via utils/counter.
    ecgNumber: { type: String, default: "", trim: true, index: true },
    performedAt: { type: Date, required: true, index: true },
    location: {
      type: String,
      enum: ["Ward", "ICU", "ER", "OPD", "Cath Lab", "Day Care"],
      default: "Ward",
    },
    leadType: {
      type: String,
      enum: ["12-lead", "3-lead", "Single-lead", "Holter"],
      default: "12-lead",
    },

    // ── Indication ──
    indication: { type: String, default: "", maxlength: 1000 },
    indicationCategory: {
      type: String,
      enum: [
        "Chest pain",
        "Pre-op",
        "Routine",
        "Follow-up",
        "Arrhythmia w/u",
        "Post-MI",
        "Pacemaker check",
        "Cardiotoxicity",
        "Other",
      ],
      default: "Other",
    },

    // ── Findings (filed via PATCH /report) ──
    rhythm: {
      type: String,
      enum: [
        "",
        "NSR",
        "AF",
        "AFL",
        "SVT",
        "VT",
        "VF",
        "AV-Block-1",
        "AV-Block-2",
        "AV-Block-3",
        "Junctional",
        "Paced",
        "Asystole",
        "Other",
      ],
      default: "",
    },
    heartRate: { type: Number, default: null, min: 0, max: 300 },
    prInterval: { type: Number, default: null },        // ms
    qrsDuration: { type: Number, default: null },       // ms
    qtInterval: { type: Number, default: null },        // ms
    qtcInterval: { type: Number, default: null },       // ms
    axis: {
      type: String,
      enum: ["", "Normal", "LAD", "RAD", "Extreme-RAD", "Indeterminate"],
      default: "",
    },
    stChanges: {
      type: String,
      enum: ["", "None", "STE", "STD", "Non-specific", "Inverted-T"],
      default: "",
    },
    leadsAffected: { type: [String], default: [] },     // ["V1","V2","aVF"]
    interpretation: { type: String, default: "", maxlength: 2000 },

    // ── Flags (auto-derived in emit / on /report) ──
    // abnormalFlag = rhythm != NSR OR HR <50 OR HR >100 OR stChanges != None OR QTc > 500
    abnormalFlag: { type: Boolean, default: false, index: true },
    // criticalFlag = rhythm in {VT, VF, AV-Block-3, Asystole} OR stChanges == STE
    criticalFlag: { type: Boolean, default: false, index: true },
    criticalValueAlertId: { type: Schema.Types.ObjectId, ref: "CriticalValueAlert", default: null },

    // ── TAT (NABH COP.7 — time to ECG, time to report) ──
    orderedAt: { type: Date, default: null },
    reportedAt: { type: Date, default: null },
    tatOrderToPerformedMin: { type: Number, default: null },
    tatPerformedToReportedMin: { type: Number, default: null },

    // ── Personnel ──
    performedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    performedByName: { type: String, default: "" },
    reportedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    reportedByName: { type: String, default: "" },
    reviewedBy: { type: Schema.Types.ObjectId, ref: "User", default: null }, // cardiologist
    reviewedByName: { type: String, default: "" },
    reviewedAt: { type: Date, default: null },
    reviewNotes: { type: String, default: "", maxlength: 1000 },

    // ── Source linkage ──
    doctorOrderId: { type: Schema.Types.ObjectId, ref: "DoctorOrder", default: null, index: true },
    sourceType: { type: String, enum: ["DoctorOrder", "Manual"], default: "Manual" },

    // ── Standard append-only lock ──
    lockedAt: { type: Date, default: null },
    isLocked: { type: Boolean, default: false, index: true },

    // ── Status (Pending / Reported / Reviewed) ──
    // Pending = order created but no report filed yet; Reported = strip read
    // and findings entered; Reviewed = cardiologist sign-off complete.
    status: {
      type: String,
      enum: ["PendingReport", "Reported", "Reviewed"],
      default: "PendingReport",
      index: true,
    },

    auditTrail: { type: [AuditSchema], default: [] },

    hospitalId: { type: Schema.Types.ObjectId, ref: "Hospital", default: null },
  },
  { timestamps: true, collection: "ecg_registers" },
);

// NABH inspection indexes
ECGRegisterSchema.index({ patientId: 1, performedAt: -1 });
ECGRegisterSchema.index({ UHID: 1, performedAt: -1 });
ECGRegisterSchema.index({ admissionId: 1, performedAt: -1 });
ECGRegisterSchema.index({ performedAt: -1 });
ECGRegisterSchema.index({ criticalFlag: 1, performedAt: -1 });
ECGRegisterSchema.index({ abnormalFlag: 1, performedAt: -1 });

module.exports =
  mongoose.models.ECGRegister ||
  mongoose.model("ECGRegister", ECGRegisterSchema);
