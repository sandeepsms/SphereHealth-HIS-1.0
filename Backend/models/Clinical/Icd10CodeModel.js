// models/Clinical/Icd10CodeModel.js
// R7hr(ICD-P1.1) — ICD-10-CM diagnosis-code master. ~74k billable codes
// imported from the CMS/NCHS annual release (public domain), so doctors
// pick a coded diagnosis instead of hand-typing code + description
// (claim forms & discharge summaries then carry an auditable code).
//
// `code` is stored RAW (no dot, as in the CMS file: "A0100"); `dotted` is
// the display form ("A01.00" — dot after the 3rd character). Searches
// accept either. Annual updates re-import via scripts/importIcd10.js or
// POST /api/icd10/import — new codes upsert, removed codes deactivate
// (isActive:false) so historical records never dangle.

const mongoose = require("mongoose");

const Icd10CodeSchema = new mongoose.Schema(
  {
    code:        { type: String, required: true, unique: true, uppercase: true, trim: true },
    dotted:      { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    version:     { type: String, default: "" },      // e.g. "FY2026" — release the code came from
    isActive:    { type: Boolean, default: true },
  },
  { timestamps: true },
);

Icd10CodeSchema.index({ isActive: 1, code: 1 });
// Word-prefix regex search scans; this text index covers whole-word $text
// queries if we ever need scored search. Cheap to keep.
Icd10CodeSchema.index({ description: "text" });

// One-doc meta collection: which release is loaded + when (the "is my
// coding data current?" answer surfaced in the picker/admin UI).
const Icd10MetaSchema = new mongoose.Schema(
  {
    version:    { type: String, default: "" },
    source:     { type: String, default: "" },        // filename it was imported from
    count:      { type: Number, default: 0 },
    importedAt: { type: Date },
    importedBy: { type: String, default: "" },
  },
  { timestamps: true },
);

const Icd10Code = mongoose.models.Icd10Code || mongoose.model("Icd10Code", Icd10CodeSchema);
const Icd10Meta = mongoose.models.Icd10Meta || mongoose.model("Icd10Meta", Icd10MetaSchema);

module.exports = { Icd10Code, Icd10Meta };
