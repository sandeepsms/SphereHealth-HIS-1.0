/**
 * CostEstimateModel.js — NABH PRE.4 / access-to-information
 *
 * A numbered, itemized, retrievable pre-treatment cost estimate. Pre-fix the
 * admission carried only a single `estimatedCost` scalar — no line breakdown,
 * no document number, no history when the estimate was revised. Surveyors (and
 * patients) expect a written, itemized estimate they can hold and compare
 * against the final bill.
 *
 * One record per estimate; a revised estimate is a new numbered record (the
 * prior stays retrievable), linked by `supersedes`. Lines are built from the
 * service / room / investigation tariff masters (or entered directly), each
 * carrying category + unit price + qty so the total is transparent.
 *
 * Number: CE-YY-N (FY-keyed like BILL/ADV/CN), gap-less via the shared counter.
 */
"use strict";

const mongoose = require("mongoose");
const { nextSequence } = require("../../utils/counter");

const LineSchema = new mongoose.Schema(
  {
    _id: false,
    category: {
      type: String,
      enum: ["Consultation", "Room", "Investigation", "Procedure", "Pharmacy", "Consumable", "Package", "Other"],
      default: "Other",
    },
    description: { type: String, required: true, trim: true },
    serviceCode: { type: String, default: "", trim: true },  // links to ServiceMaster/InvestigationMaster when built from a master
    unitPrice: { type: Number, default: 0, min: 0 },
    quantity: { type: Number, default: 1, min: 0 },
    amount: { type: Number, default: 0, min: 0 },            // unitPrice × quantity (server-computed)
    estimatedDays: { type: Number, default: null },           // for Room lines
  },
);

const CostEstimateSchema = new mongoose.Schema(
  {
    estimateNumber: { type: String, unique: true, sparse: true, index: true },  // CE-YY-N

    // ── Patient / episode context ──
    UHID: { type: String, uppercase: true, trim: true, required: true, index: true },
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: "Patient", default: null },
    patientName: { type: String, default: "" },
    admissionId: { type: mongoose.Schema.Types.ObjectId, ref: "Admission", default: null, index: true },
    admissionNumber: { type: String, default: "" },
    visitType: { type: String, enum: ["OPD", "IPD", "Emergency", "Daycare", "Package"], default: "IPD" },

    // ── Clinical context ──
    provisionalDiagnosis: { type: String, default: "" },
    plannedProcedure: { type: String, default: "" },
    roomCategory: { type: String, default: "" },
    estimatedLengthOfStayDays: { type: Number, default: null },

    // ── Itemized lines ──
    lines: { type: [LineSchema], default: [] },

    // ── Totals (server-computed) ──
    subTotal: { type: Number, default: 0 },
    estimatedTaxes: { type: Number, default: 0 },
    packageDiscount: { type: Number, default: 0 },
    grandTotal: { type: Number, default: 0 },
    advanceRequested: { type: Number, default: 0 },
    currency: { type: String, default: "INR" },

    // ── Payer ──
    payerType: { type: String, enum: ["SELF", "TPA", "CGHS", "ESIC", "CORPORATE", "OTHER"], default: "SELF" },
    insurerOrTpa: { type: String, default: "" },

    // ── Lifecycle ──
    status: { type: String, enum: ["Draft", "Issued", "Superseded", "Cancelled"], default: "Issued", index: true },
    validUntil: { type: Date, default: null },
    supersedes: { type: mongoose.Schema.Types.ObjectId, ref: "CostEstimate", default: null },
    revisionOf: { type: String, default: "" },  // prior estimateNumber (denormalized for print)

    notes: { type: String, default: "" },
    disclaimer: {
      type: String,
      default: "This is an approximate estimate based on the planned course of treatment. Actual charges may vary with the patient's clinical condition, complications, and length of stay.",
    },

    // ── Attribution ──
    preparedBy: { type: String, default: "" },
    preparedById: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    preparedByRole: { type: String, default: "" },

    hospitalId: { type: mongoose.Schema.Types.ObjectId, ref: "Hospital", default: null },
  },
  { timestamps: true, collection: "cost_estimates" },
);

CostEstimateSchema.index({ UHID: 1, createdAt: -1 });
CostEstimateSchema.index({ status: 1, createdAt: -1 });

// Recompute line + document totals from the parts before every save so a
// tampered/absent `amount` can't drift from unitPrice × qty.
CostEstimateSchema.pre("validate", function (next) {
  let sub = 0;
  for (const ln of this.lines || []) {
    ln.amount = Math.round((Number(ln.unitPrice) || 0) * (Number(ln.quantity) || 0) * 100) / 100;
    sub += ln.amount;
  }
  this.subTotal = Math.round(sub * 100) / 100;
  this.grandTotal = Math.round((this.subTotal + (Number(this.estimatedTaxes) || 0) - (Number(this.packageDiscount) || 0)) * 100) / 100;
  next();
});

// Gap-less FY-keyed number CE-YY-N, minted once on first save.
CostEstimateSchema.pre("save", async function (next) {
  if (this.estimateNumber) return next();
  try {
    const now = new Date();
    // Indian FY starts April; YY = the year the FY starts in.
    const fyStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    const yy = String(fyStartYear).slice(-2);
    const seq = await nextSequence(`costestimate:${yy}`);
    this.estimateNumber = `CE-${yy}-${seq}`;
    next();
  } catch (e) { next(e); }
});

module.exports =
  mongoose.models.CostEstimate || mongoose.model("CostEstimate", CostEstimateSchema);
