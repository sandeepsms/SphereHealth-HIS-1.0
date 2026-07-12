// models/Clinical/Icd10PcsCodeModel.js
// R7hr(PCS-P1) — ICD-10-PCS procedure-code master (owner decision
// 2026-07-12: PCS haan, NAMASTE skip). ~79k valid codes from the CMS
// FY annual release (public domain), so procedures on discharge
// summaries / claims carry an auditable code instead of free text.
//
// PCS codes are fixed 7-character alphanumerics with NO dot form
// (unlike ICD-10-CM), so there is no `dotted` field — `code` is the
// display form. Annual updates re-import via scripts/importIcd10Pcs.js
// or POST /api/icd10/pcs/import — new codes upsert, removed codes
// deactivate (isActive:false) so historical records never dangle.

const mongoose = require("mongoose");

const Icd10PcsCodeSchema = new mongoose.Schema(
  {
    code:        { type: String, required: true, unique: true, uppercase: true, trim: true },
    description: { type: String, required: true, trim: true },
    version:     { type: String, default: "" },      // e.g. "FY2026" — release the code came from
    isActive:    { type: Boolean, default: true },
  },
  { timestamps: true },
);

Icd10PcsCodeSchema.index({ isActive: 1, code: 1 });
// Word-prefix regex search scans; text index kept for optional scored $text.
Icd10PcsCodeSchema.index({ description: "text" });

// One-doc meta collection: which release is loaded + when.
const Icd10PcsMetaSchema = new mongoose.Schema(
  {
    version:    { type: String, default: "" },
    source:     { type: String, default: "" },        // filename it was imported from
    count:      { type: Number, default: 0 },
    importedAt: { type: Date },
    importedBy: { type: String, default: "" },
  },
  { timestamps: true },
);

const Icd10PcsCode = mongoose.models.Icd10PcsCode || mongoose.model("Icd10PcsCode", Icd10PcsCodeSchema);
const Icd10PcsMeta = mongoose.models.Icd10PcsMeta || mongoose.model("Icd10PcsMeta", Icd10PcsMetaSchema);

module.exports = { Icd10PcsCode, Icd10PcsMeta };
