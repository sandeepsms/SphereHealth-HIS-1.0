/**
 * AbdmTransactionModel.js — ABDM gateway transaction log
 *
 * Every inbound gateway callback and outbound gateway call is journalled here
 * — the audit trail + idempotency backstop for the async ABDM protocol (each
 * request carries a REQUEST-ID / transactionId the counterpart echoes on the
 * matching /on-* response). Lets an operator trace a discovery → link →
 * consent → data-flow chain, and lets a callback safely no-op on a duplicate
 * requestId.
 */
"use strict";

const mongoose = require("mongoose");
const { Schema } = mongoose;

const AbdmTransactionSchema = new Schema(
  {
    requestId: { type: String, default: "", index: true },      // REQUEST-ID header (uuid)
    transactionId: { type: String, default: "", index: true },  // ABDM transactionId
    kind: {
      type: String,
      enum: [
        "SESSION", "DISCOVER", "LINK_INIT", "LINK_CONFIRM",
        "CONSENT_NOTIFY", "HI_REQUEST", "HI_TRANSFER", "ON_RESPONSE", "OTHER",
      ],
      required: true,
      index: true,
    },
    direction: { type: String, enum: ["INBOUND", "OUTBOUND"], required: true, index: true },
    status: { type: String, enum: ["RECEIVED", "ACK", "PROCESSED", "ERROR"], default: "RECEIVED", index: true },

    abhaAddress: { type: String, default: "", index: true },
    UHID: { type: String, default: "" },
    endpoint: { type: String, default: "" },       // the ABDM path
    httpStatus: { type: Number, default: null },   // for outbound calls

    requestPayload: { type: Schema.Types.Mixed, default: null },
    responsePayload: { type: Schema.Types.Mixed, default: null },
    error: { type: String, default: "" },

    hospitalId: { type: Schema.Types.ObjectId, ref: "Hospital", default: null },
  },
  { timestamps: true, collection: "abdm_transactions" },
);

AbdmTransactionSchema.index({ kind: 1, createdAt: -1 });
AbdmTransactionSchema.index({ requestId: 1, kind: 1 });

module.exports =
  mongoose.models.AbdmTransaction || mongoose.model("AbdmTransaction", AbdmTransactionSchema);
