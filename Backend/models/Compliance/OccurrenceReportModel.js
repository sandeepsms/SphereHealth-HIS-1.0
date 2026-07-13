/**
 * OccurrenceReportModel.js — NABH PSQ / QPS unified occurrence reporting
 *
 * A single front-door "occurrence / adverse-event" intake so any staff member
 * can report anything (fall, med error, near-miss, equipment failure, sentinel
 * event, complaint) from one form without knowing which specialised register
 * it belongs to. The triage/quality team classifies it and — when it maps to a
 * formal register — routes it there (routedRegister + routedRefId), keeping the
 * OccurrenceReport as the umbrella audit trail.
 *
 * Number: OCC-YY-N (FY-keyed, gap-less via the shared counter).
 */
"use strict";

const mongoose = require("mongoose");
const { nextSequence } = require("../../utils/counter");
const { Schema } = mongoose;

const AuditSchema = new Schema({
  _id: false,
  action: { type: String, enum: ["REPORTED", "CLASSIFIED", "ROUTED", "REVIEWED", "CLOSED", "REOPENED"], default: "REPORTED" },
  at: { type: Date, default: Date.now },
  byName: { type: String, default: "" },
  byRole: { type: String, default: "" },
  byUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  notes: { type: String, default: "" },
});

const OccurrenceReportSchema = new Schema(
  {
    occurrenceNumber: { type: String, unique: true, sparse: true, index: true }, // OCC-YY-N

    // ── What happened ──
    category: {
      type: String,
      enum: [
        "Adverse-Event", "Near-Miss", "Sentinel-Event", "Medication-Error",
        "Fall", "Equipment-Failure", "Needlestick", "Complaint", "Security", "Other",
      ],
      required: true,
      index: true,
    },
    occurredAt: { type: Date, required: true, index: true },
    location: { type: String, default: "" },
    description: { type: String, required: true, trim: true, maxlength: 4000 },
    immediateActionTaken: { type: String, default: "" },
    severity: { type: String, enum: ["", "None", "Minor", "Moderate", "Major", "Catastrophic"], default: "" },
    harmReached: { type: Boolean, default: false },

    // ── Optional patient linkage (occurrences can be patient-less) ──
    UHID: { type: String, uppercase: true, trim: true, default: "", index: true },
    patientId: { type: Schema.Types.ObjectId, ref: "Patient", default: null },
    admissionId: { type: Schema.Types.ObjectId, ref: "Admission", default: null },

    // ── Reporter (may be anonymous) ──
    reportedByName: { type: String, default: "" },
    reportedByRole: { type: String, default: "" },
    reportedById: { type: Schema.Types.ObjectId, ref: "User", default: null },
    anonymous: { type: Boolean, default: false },

    // ── Triage / routing ──
    routedRegister: {
      type: String,
      enum: ["", "SentinelEvent", "NearMiss", "MedicationError", "IncidentReport", "None"],
      default: "",
    },
    routedRefId: { type: Schema.Types.ObjectId, default: null }, // id in the routed register
    reviewNotes: { type: String, default: "" },

    status: { type: String, enum: ["Open", "Under-Review", "Routed", "Closed"], default: "Open", index: true },
    closedAt: { type: Date, default: null },

    auditTrail: { type: [AuditSchema], default: [] },
    hospitalId: { type: Schema.Types.ObjectId, ref: "Hospital", default: null },
  },
  { timestamps: true, collection: "occurrence_reports" },
);

OccurrenceReportSchema.index({ category: 1, occurredAt: -1 });
OccurrenceReportSchema.index({ status: 1, createdAt: -1 });

OccurrenceReportSchema.pre("save", async function (next) {
  if (this.occurrenceNumber) return next();
  try {
    const now = new Date();
    const fyStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    const yy = String(fyStartYear).slice(-2);
    const seq = await nextSequence(`occurrence:${yy}`);
    this.occurrenceNumber = `OCC-${yy}-${seq}`;
    next();
  } catch (e) { next(e); }
});

module.exports =
  mongoose.models.OccurrenceReport || mongoose.model("OccurrenceReport", OccurrenceReportSchema);
