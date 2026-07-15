/**
 * AbdmConsentArtefactModel.js — ABDM M3 (consent)
 *
 * A signed consent artefact the HIP receives on consent/hip/notify. It scopes
 * exactly which HI Types, over which date range, for which care contexts, a
 * named HIU may fetch — and until when. The data-flow service checks a GRANTED,
 * unexpired artefact before assembling and pushing any FHIR bundle.
 */
"use strict";

const mongoose = require("mongoose");
const { Schema } = mongoose;

const AbdmConsentArtefactSchema = new Schema(
  {
    consentId: { type: String, required: true },   // artefact id from the CM (unique index below)
    consentRequestId: { type: String, default: "" },

    // Subject.
    abhaAddress: { type: String, trim: true, default: "", index: true },
    UHID: { type: String, uppercase: true, trim: true, default: "", index: true },

    // Requester (HIU) + provider (this HIP).
    hiu: { id: { type: String, default: "" }, name: { type: String, default: "" } },
    hipId: { type: String, default: "" },
    requesterName: { type: String, default: "" },

    // Scope.
    hiTypes: { type: [String], default: [] },
    careContexts: {
      type: [{ _id: false, patientReference: String, careContextReference: String }],
      default: [],
    },
    permission: {
      accessMode: { type: String, default: "VIEW" },
      dateRange: { from: { type: Date, default: null }, to: { type: Date, default: null } },
      dataEraseAt: { type: Date, default: null },
      frequency: { unit: { type: String, default: "" }, value: { type: Number, default: 0 }, repeats: { type: Number, default: 0 } },
    },

    // Verifiable signature material from the CM (kept for audit / non-repudiation).
    signature: { type: String, default: "" },

    status: { type: String, enum: ["GRANTED", "DENIED", "REVOKED", "EXPIRED"], default: "GRANTED", index: true },
    grantedAt: { type: Date, default: Date.now },
    expiry: { type: Date, default: null, index: true },
    lastFetchedAt: { type: Date, default: null },
    fetchCount: { type: Number, default: 0 },
    // R8-FIX(#37) — sliding-window counters for permission.frequency enforcement.
    frequencyWindowStart: { type: Date, default: null },
    fetchCountInWindow: { type: Number, default: 0 },

    raw: { type: Schema.Types.Mixed, default: null },      // full notification payload (audit)
    hospitalId: { type: Schema.Types.ObjectId, ref: "Hospital", default: null },
  },
  { timestamps: true, collection: "abdm_consent_artefacts" },
);

AbdmConsentArtefactSchema.index({ consentId: 1 }, { unique: true });
AbdmConsentArtefactSchema.index({ status: 1, expiry: 1 });

/** True when this artefact currently authorises a data pull. */
AbdmConsentArtefactSchema.methods.isActive = function (now = new Date()) {
  return this.status === "GRANTED" && (!this.expiry || this.expiry > now);
};

module.exports =
  mongoose.models.AbdmConsentArtefact || mongoose.model("AbdmConsentArtefact", AbdmConsentArtefactSchema);
