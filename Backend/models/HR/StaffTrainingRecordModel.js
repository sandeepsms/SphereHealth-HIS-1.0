/**
 * StaffTrainingRecordModel.js — NABH HRM.4 / HRM.5
 *
 * Staff competency assessments + in-service training attendance. One row per
 * event (a competency check, an in-service session, an orientation, a BLS/ACLS
 * certification, etc.). `nextDueDate` drives periodic-reassessment reminders,
 * reusing the same expiry-sweep machinery as clinical credentials.
 *
 * Distinct from CredentialModel (statutory registrations / degrees) — this is
 * the ongoing skill-assessment + training record the surveyor inspects for
 * HRD.4/5 evidence.
 */
"use strict";

const mongoose = require("mongoose");
const { Schema } = mongoose;

const StaffTrainingRecordSchema = new Schema(
  {
    // ── Staff ──
    userId: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
    staffName: { type: String, required: true, trim: true },
    staffRole: { type: String, default: "" },
    employeeId: { type: String, default: "", index: true },
    department: { type: String, default: "" },

    // ── Record type ──
    recordType: {
      type: String,
      enum: ["COMPETENCY", "IN_SERVICE", "ORIENTATION", "CERTIFICATION", "SKILL_ASSESSMENT", "FIRE_SAFETY", "BLS_ACLS", "INFECTION_CONTROL"],
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true },   // "CPR competency", "Hand-hygiene in-service"
    category: { type: String, default: "" },
    description: { type: String, default: "" },

    // ── Assessment / delivery ──
    assessedByName: { type: String, default: "" },
    assessedById: { type: Schema.Types.ObjectId, ref: "User", default: null },
    trainerName: { type: String, default: "" },
    date: { type: Date, default: Date.now, index: true },      // when assessed / attended
    durationHours: { type: Number, default: null },
    result: { type: String, enum: ["", "Pass", "Fail", "Satisfactory", "Needs-Improvement", "Completed", "Attended"], default: "" },
    score: { type: Number, default: null },
    remarks: { type: String, default: "" },

    // ── Validity / re-assessment ──
    validFrom: { type: Date, default: null },
    nextDueDate: { type: Date, default: null, index: true },  // periodic reassessment due-by

    // ── Status (derived from nextDueDate on the sweep) ──
    status: { type: String, enum: ["Valid", "Due", "Overdue", "Failed"], default: "Valid", index: true },
    attachmentUrl: { type: String, default: "" },

    hospitalId: { type: Schema.Types.ObjectId, ref: "Hospital", default: null },
    createdByName: { type: String, default: "" },
  },
  { timestamps: true, collection: "staff_training_records" },
);

StaffTrainingRecordSchema.index({ userId: 1, recordType: 1, date: -1 });
StaffTrainingRecordSchema.index({ status: 1, nextDueDate: 1 });

module.exports =
  mongoose.models.StaffTrainingRecord ||
  mongoose.model("StaffTrainingRecord", StaffTrainingRecordSchema);
