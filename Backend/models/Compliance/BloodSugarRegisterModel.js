/**
 * BloodSugarRegisterModel.js — R7bo / NABH AAC.4 + COP.1.b
 *
 * Chronological register of every blood-glucose reading in the facility:
 * capillary BG, lab RBS/FBS/PPBS, glucometer, HbA1c. Append-only audit
 * register — the canonical NABH "RBS register" surveyors ask for.
 *
 * Auto-populated by nabhRegisterEmitter.emitBloodSugar from:
 *   - Nursing vitals save (vitals.bloodSugar)
 *   - Diabetic chart entries (per-slot bgValue)
 *   - Lab record save for RBS/FBS/PPBS panels
 *   - Manual entry (location=Lab/Field/OPD where the reading isn't from the
 *     above sources)
 *
 * Critical-value (<70 or >300 mg/dL) auto-flagged and cross-linked to
 * CriticalValueAlert. 1-hour grace for typo edits; lockedAt freezes the
 * row after that.
 */
"use strict";

const mongoose = require("mongoose");
const { Schema } = mongoose;

const AuditSchema = new Schema(
  {
    _id: false,
    action: { type: String, enum: ["CREATED", "CORRECTED", "LOCKED", "CRITICAL_FLAGGED"], required: true },
    at: { type: Date, default: Date.now },
    byName: { type: String, default: "" },
    byRole: { type: String, default: "" },
    byUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    reason: { type: String, default: "", maxlength: 500 },
  },
);

const BloodSugarRegisterSchema = new Schema(
  {
    // ── Patient ──
    patientId: { type: Schema.Types.ObjectId, ref: "Patient", required: true, index: true },
    UHID: { type: String, required: true, uppercase: true, trim: true, index: true },
    patientName: { type: String, default: "" },
    age: { type: Number, default: null },
    sex: { type: String, default: "" },

    // OPD readings leave admissionId null
    admissionId: { type: Schema.Types.ObjectId, ref: "Admission", default: null, index: true },
    admissionNumber: { type: String, default: "" },

    // ── Reading ──
    readingValue: { type: Number, required: true, min: 0, max: 1500 },
    readingUnit: { type: String, default: "mg/dL", enum: ["mg/dL", "mmol/L"] },
    readingType: {
      type: String,
      enum: ["RBS", "FBS", "PPBS", "GRBS", "HbA1c", "RANDOM"],
      required: true,
      index: true,
    },
    sampleType: {
      type: String,
      enum: ["capillary", "venous", "arterial", "unknown"],
      default: "capillary",
    },
    takenAt: { type: Date, required: true, index: true },

    // ── Insulin context (if given alongside the reading) ──
    insulinGiven: { type: Boolean, default: false },
    insulinType: { type: String, default: "" },
    insulinDose: { type: Number, default: null, min: 0, max: 500 },
    insulinRoute: { type: String, enum: ["SC", "IV", "IM", ""], default: "" },
    marId: { type: Schema.Types.ObjectId, ref: "MAR", default: null },

    // ── Location ──
    location: {
      type: String,
      enum: ["Ward", "OPD", "ER", "ICU", "Lab", "Field", "Home"],
      default: "Ward",
    },

    // ── Critical-value flag ──
    // Auto-set if <70 or >300 mg/dL (NABH threshold). Cross-link to the
    // existing CriticalValueAlert system so escalation runs the same path.
    criticalFlag: { type: Boolean, default: false, index: true },
    criticalValueAlertId: { type: Schema.Types.ObjectId, ref: "CriticalValueAlert", default: null },

    // ── Personnel ──
    takenBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    takenByName: { type: String, default: "" },
    takenByRole: { type: String, default: "" },

    // ── Source linkage ──
    sourceRef: { type: Schema.Types.ObjectId, default: null },
    sourceType: {
      type: String,
      enum: ["VitalSheet", "NurseNotes", "DiabeticChart", "LabRecord", "MAR", "Manual"],
      default: "Manual",
    },

    // ── Append-only lock (1 hour grace for typo edits) ──
    lockedAt: { type: Date, default: null },
    isLocked: { type: Boolean, default: false, index: true },

    notes: { type: String, default: "", maxlength: 1000 },

    auditTrail: { type: [AuditSchema], default: [] },

    hospitalId: { type: Schema.Types.ObjectId, ref: "Hospital", default: null },
  },
  { timestamps: true, collection: "blood_sugar_registers" },
);

// NABH inspection indexes
BloodSugarRegisterSchema.index({ patientId: 1, takenAt: -1 });
BloodSugarRegisterSchema.index({ UHID: 1, takenAt: -1 });
BloodSugarRegisterSchema.index({ admissionId: 1, takenAt: -1 });
BloodSugarRegisterSchema.index({ takenAt: -1 });
BloodSugarRegisterSchema.index({ criticalFlag: 1, takenAt: -1 });

module.exports =
  mongoose.models.BloodSugarRegister ||
  mongoose.model("BloodSugarRegister", BloodSugarRegisterSchema);
