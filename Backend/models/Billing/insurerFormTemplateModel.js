// models/Billing/insurerFormTemplateModel.js
// R7hr(CLAIM-P4.3) — the hospital's uploaded OFFICIAL blank claim PDF for a
// given insurer, plus the field-map that says where each system value lands.
//
// We do NOT ship insurers' copyrighted PDFs. Instead the hospital uploads each
// insurer's official blank form once (their TPA desk already has these), we
// store the bytes here with a field-map, and insurerFormService overlays the
// claim data onto it at print time. When no template exists for an insurer the
// engine falls back to the generated standard-format form.
//
// fieldMap entry:
//   { field, acroName?, page?, x?, y?, size? }
//   • field   — a system value key (see insurerFormService.claimFieldValues)
//   • acroName — the AcroForm text-field name to setText() (fillable PDFs)
//   • x/y/page/size — absolute overlay position (flat/scanned PDFs)
// A fillable PDF uses acroName; a flat PDF uses x/y. Both may coexist.

const mongoose = require("mongoose");

const FieldMapEntrySchema = new mongoose.Schema(
  {
    field:   { type: String, required: true, trim: true }, // system value key
    acroName:{ type: String, trim: true },                 // AcroForm field name
    page:    { type: Number, default: 0, min: 0 },
    x:       { type: Number },
    y:       { type: Number },
    size:    { type: Number, default: 9, min: 5, max: 24 },
  },
  { _id: false }
);

const InsurerFormTemplateSchema = new mongoose.Schema(
  {
    insurerCode: { type: String, required: true, uppercase: true, trim: true, index: true },
    insurerName: { type: String, trim: true },
    formType:    { type: String, enum: ["CLAIM", "PREAUTH"], default: "CLAIM", index: true },

    fileName:    { type: String, trim: true },
    mimeType:    { type: String, default: "application/pdf" },
    pdf:         { type: Buffer, required: true },          // the blank official form
    pageCount:   { type: Number, default: 0 },
    hasAcroForm: { type: Boolean, default: false },
    acroFields:  [{ type: String }],                        // detected fillable field names

    fieldMap:    { type: [FieldMapEntrySchema], default: [] },

    version:     { type: Number, default: 1 },
    isActive:    { type: Boolean, default: true, index: true },

    uploadedBy:     { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    uploadedByName: { type: String, trim: true },
    notes:          { type: String, trim: true },
  },
  { timestamps: true }
);

// One ACTIVE template per (insurer, formType) — newest version wins. Older
// versions stay (isActive:false) for audit/rollback.
InsurerFormTemplateSchema.index({ insurerCode: 1, formType: 1, isActive: 1, version: -1 });

module.exports =
  mongoose.models.InsurerFormTemplate ||
  mongoose.model("InsurerFormTemplate", InsurerFormTemplateSchema);
