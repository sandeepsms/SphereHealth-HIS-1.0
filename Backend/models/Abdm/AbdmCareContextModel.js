/**
 * AbdmCareContextModel.js — ABDM M2 (care-context linking)
 *
 * A "care context" is one discoverable episode of care (an OPD visit / IPD
 * admission) that a patient can link to their ABHA so it becomes fetchable by
 * a consented HIU. One row per (ABHA, encounter). `careContextReference` is
 * the opaque id the HIP hands the gateway; the gateway echoes it in later
 * discovery / consent / health-information requests.
 */
"use strict";

const mongoose = require("mongoose");
const { Schema } = mongoose;

const AbdmCareContextSchema = new Schema(
  {
    // Patient linkage (local).
    UHID: { type: String, uppercase: true, trim: true, required: true, index: true },
    patientId: { type: Schema.Types.ObjectId, ref: "Patient", default: null },
    abhaAddress: { type: String, trim: true, default: "", index: true },
    abhaNumber: { type: String, trim: true, default: "" },

    // Encounter this care context represents.
    encounterType: { type: String, enum: ["OPD", "IPD", "Emergency", "Daycare", "Other"], default: "OPD" },
    admissionId: { type: Schema.Types.ObjectId, ref: "Admission", default: null, index: true },
    visitRef: { type: String, default: "" },              // visitNumber / admissionNumber

    // ABDM identifiers.
    careContextReference: { type: String, required: true }, // opaque id given to the CM (unique index below)
    display: { type: String, default: "" },               // human label ("OPD visit 12-Jul-2026")
    // HI Types this context can serve (ABDM enum).
    hiTypes: {
      type: [String],
      default: [],
      // OPConsultation / DischargeSummary / Prescription / DiagnosticReport /
      // WellnessRecord / ImmunizationRecord / HealthDocumentRecord
    },

    // Link lifecycle.
    linkStatus: { type: String, enum: ["UNLINKED", "LINK_INIT", "LINKED", "FAILED"], default: "UNLINKED", index: true },
    linkRefNumber: { type: String, default: "" },         // returned by link/on-init
    transactionId: { type: String, default: "" },
    linkedAt: { type: Date, default: null },
    error: { type: String, default: "" },

    hospitalId: { type: Schema.Types.ObjectId, ref: "Hospital", default: null },
  },
  { timestamps: true, collection: "abdm_care_contexts" },
);

// One care-context reference per encounter (idempotent linking).
AbdmCareContextSchema.index({ careContextReference: 1 }, { unique: true });
AbdmCareContextSchema.index({ abhaAddress: 1, linkStatus: 1 });
AbdmCareContextSchema.index({ UHID: 1, admissionId: 1 });

module.exports =
  mongoose.models.AbdmCareContext || mongoose.model("AbdmCareContext", AbdmCareContextSchema);
