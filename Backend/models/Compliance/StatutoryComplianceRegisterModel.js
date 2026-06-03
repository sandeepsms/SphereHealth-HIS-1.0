/**
 * StatutoryComplianceRegisterModel.js — R7gw-B10-T07 / NABH AAC.16
 *
 * Statutory licence / authorisation register. Surveyors (NABH AAC.16) require
 * the hospital to maintain a living register of every statutory licence in
 * force — Hospital registration, Pharmacy, Blood-Bank, Fire NOC, PCB Consent,
 * BMW Authorisation, Atomic Energy (radiology), PNDT (ultrasound), CTL (clinical
 * trials), PRA (private radiology), Drug Licence, Lift Inspection — with their
 * issue dates, expiry dates, renewal application status, and a pointer to the
 * scanned PDF on the file store.
 *
 * One row per licence per validity-period. When a licence is renewed a new row
 * is added (the previous row stays for audit). Compliance Officer is the
 * primary writer; Admin can amend.
 *
 * No auto-emit upstream — every row is a manual POST from the compliance page.
 * sourceRef defaults to crypto.randomUUID() so repeat submits coalesce.
 */
"use strict";

const mongoose = require("mongoose");
const crypto = require("crypto");
const { Schema } = mongoose;

const AuditSchema = new Schema({
  _id: false,
  action: { type: String, enum: ["CREATED", "UPDATED", "RENEWED", "CLOSED"], required: true },
  at: { type: Date, default: Date.now },
  byName: { type: String, default: "" },
  byRole: { type: String, default: "" },
  byUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  notes: { type: String, default: "" },
});

const StatutoryComplianceRegisterSchema = new Schema({
  // ── Licence identification ──────────────────────────────────────
  licenseType: {
    type: String,
    enum: [
      "Hospital",
      "Pharmacy",
      "BloodBank",
      "Fire-NOC",
      "PCB-Consent",
      "BMW-Authorization",
      "Atomic-Energy",
      "PNDT",
      "CTL",
      "PRA",
      "Drug-License",
      "Lift-Inspection",
    ],
    required: true,
    index: true,
  },
  licenseNo:        { type: String, required: true, trim: true, index: true },
  issuedBy:         { type: String, default: "" },
  issuedDate:       { type: Date, default: null },
  expiryDate:       { type: Date, default: null, index: true },

  // ── Renewal tracking ────────────────────────────────────────────
  renewalAppliedDate: { type: Date, default: null },
  renewalStatus: {
    type: String,
    enum: ["Pending", "Approved", "Rejected", "NotStarted"],
    default: "NotStarted",
    index: true,
  },

  // ── Document store pointer + free-form ──────────────────────────
  documentPath:     { type: String, default: "" },
  notes:            { type: String, default: "" },

  // ── Lifecycle ───────────────────────────────────────────────────
  status: {
    type: String,
    enum: ["Active", "Expired", "Superseded", "Closed"],
    default: "Active",
    index: true,
  },

  // ── Idempotency / source ────────────────────────────────────────
  // crypto.randomUUID() default so repeat POSTs coalesce.
  sourceRef:        { type: String, default: () => crypto.randomUUID(), unique: true, index: true },
  sourceType:       { type: String, default: "Manual" },

  emittedAt:        { type: Date, default: Date.now, index: true },

  auditTrail:       { type: [AuditSchema], default: [] },

  hospitalId:       { type: Schema.Types.ObjectId, ref: "Hospital", default: null },
}, { timestamps: true, collection: "statutory_compliance_registers" });

StatutoryComplianceRegisterSchema.index({ licenseType: 1, expiryDate: 1 });
StatutoryComplianceRegisterSchema.index({ expiryDate: 1, status: 1 });
StatutoryComplianceRegisterSchema.index({ renewalStatus: 1, expiryDate: 1 });
StatutoryComplianceRegisterSchema.index({ status: 1, createdAt: -1 });

module.exports =
  mongoose.models.StatutoryComplianceRegister ||
  mongoose.model("StatutoryComplianceRegister", StatutoryComplianceRegisterSchema);
