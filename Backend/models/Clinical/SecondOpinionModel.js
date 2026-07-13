/**
 * SecondOpinionModel.js — NABH PRE.1 (patient right to a second opinion)
 *
 * Tracks a patient/kin request for a second medical opinion — the request, who
 * it was referred to, and the outcome. Surveyors look for evidence the hospital
 * honours (and documents) this right rather than obstructing it.
 */
"use strict";

const mongoose = require("mongoose");
const { Schema } = mongoose;

const SecondOpinionSchema = new Schema(
  {
    UHID: { type: String, uppercase: true, trim: true, required: true, index: true },
    patientId: { type: Schema.Types.ObjectId, ref: "Patient", default: null },
    admissionId: { type: Schema.Types.ObjectId, ref: "Admission", default: null, index: true },
    patientName: { type: String, default: "" },

    requestedByName: { type: String, default: "" },       // patient or kin
    relationship: { type: String, default: "Self" },
    requestedAt: { type: Date, default: Date.now, index: true },

    primaryDoctorName: { type: String, default: "" },
    provisionalDiagnosis: { type: String, default: "" },
    reason: { type: String, default: "" },

    // Referral / outcome
    referredToName: { type: String, default: "" },        // second-opinion doctor / facility
    referredToFacility: { type: String, default: "" },
    external: { type: Boolean, default: false },
    opinionSummary: { type: String, default: "" },
    opinionAt: { type: Date, default: null },

    status: {
      type: String,
      enum: ["Requested", "Arranged", "Completed", "Declined", "Cancelled"],
      default: "Requested",
      index: true,
    },
    notes: { type: String, default: "" },

    capturedByName: { type: String, default: "" },
    capturedById: { type: Schema.Types.ObjectId, ref: "User", default: null },
    hospitalId: { type: Schema.Types.ObjectId, ref: "Hospital", default: null },
  },
  { timestamps: true, collection: "second_opinions" },
);

SecondOpinionSchema.index({ UHID: 1, requestedAt: -1 });

module.exports =
  mongoose.models.SecondOpinion || mongoose.model("SecondOpinion", SecondOpinionSchema);
