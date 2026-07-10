/**
 * labRecordsModels.js — Lab Tech / Radiologist manual data-entry layer.
 *
 * Two collections:
 *   1. LabTrend   — the "trend sheet" grid view (rows = tests,
 *                   columns = days). One row per patient + panel.
 *                   The user-supplied HTML template was the design
 *                   reference. Each cell auto-classifies
 *                   normal / borderline / critical against the
 *                   test's reference range (NABH POE.5 evidence).
 *
 *   2. LabReport  — single-instance reports for imaging (X-ray /
 *                   USG / CT / MRI), microbiology cultures,
 *                   histopath, cytology, and other narrative
 *                   reports that don't fit a daily grid.
 *
 * Both keyed on UHID + admissionId. Doctors view them in the
 * patient file aggregator; Lab Tech / Radiologist write via the
 * /lab-records routes.
 */
const mongoose = require("mongoose");
const { Schema } = mongoose;

/* ── A reading on one date for one test ───────────────────── */
const ReadingSchema = new Schema({
  date:   { type: Date, required: true },
  value:  { type: String, default: "" },          // string so "Trace", "Nil", "10⁵ CFU/mL" all fit
  status: { type: String, enum: ["normal", "borderline", "critical", ""], default: "" },
  notes:  { type: String, default: "" },
}, { _id: false });

/* ── One test row inside a trend sheet ────────────────────── */
const TestRowSchema = new Schema({
  name:   { type: String, required: true },        // "Hb", "Creatinine"
  unit:   { type: String, default: "" },           // "g/dL", "mg/dL"
  refMin: { type: Number, default: null },         // null = no range
  refMax: { type: Number, default: null },
  method: { type: String, default: "" },           // R7hr(LAB-P4) — NABL: examination method ("Photometry", "ELISA")
  readings: { type: [ReadingSchema], default: [] },
}, { _id: false });

/* ── LabTrend — multi-day grid ─────────────────────────────
   panelType identifies which preset (CBC / BIOCHEM / LFT / KFT /
   LIPID / THYROID / COAG / ABG / URINE / CUSTOM) was started from
   so the UI can re-load that preset on edit. */
const LabTrendSchema = new Schema({
  UHID:          { type: String, required: true, index: true },
  patientName:   { type: String, default: "" },
  admissionId:   { type: Schema.Types.ObjectId, ref: "Admission" },
  visitType:     { type: String, enum: ["IPD", "OPD", "ER", "DC"], default: "IPD" },
  ipdNumber:     { type: String, default: "" },

  panelType:     {
    type: String,
    enum: ["CBC", "BIOCHEM", "LFT", "KFT", "LIPID", "THYROID", "COAG", "ABG", "URINE", "MIXED", "CUSTOM"],
    default: "MIXED",
  },
  panelName:     { type: String, default: "" },     // human-friendly label
  tests:         { type: [TestRowSchema], default: [] },

  // The set of date columns this trend tracks. Keeps the UI rendering
  // independent from gaps in individual test rows.
  dates:         { type: [Date], default: [] },

  // R7hr(LAB-P4) — NABL / ISO 15189 report-content fields. A compliant
  // report must state the primary-sample identity, collection and lab-
  // receipt date+time, the requesting clinician and the analyser used —
  // none of which the grid captured before. All optional (old sheets and
  // quick entries still save); the print shows "—" for what's missing.
  sampleId:          { type: String, default: "" },   // barcode / lab accession no
  sampleCollectedAt: { type: Date, default: null },   // primary sample collection date+time
  sampleReceivedAt:  { type: Date, default: null },   // received in lab date+time
  referringDoctor:   { type: String, default: "" },   // requesting clinician
  equipmentId:       { type: String, default: "" },   // analyser / asset tag (sheet-level)

  notes:         { type: String, default: "" },
  status:        { type: String, enum: ["draft", "reported", "verified"], default: "draft", index: true },

  createdBy:     { type: Schema.Types.ObjectId, ref: "User" },
  createdByName: { type: String, default: "" },
  updatedBy:     { type: Schema.Types.ObjectId, ref: "User" },
  updatedByName: { type: String, default: "" },
  verifiedBy:    { type: Schema.Types.ObjectId, ref: "User" },
  verifiedByName:{ type: String, default: "" },       // R7hr(LAB-P4) — authorizing signatory shown on the NABL print
  verifiedAt:    { type: Date, default: null },
}, { timestamps: true });

LabTrendSchema.index({ UHID: 1, panelType: 1, createdAt: -1 });

/* ── LabReport — single point-in-time narrative ────────── */
const LabReportSchema = new Schema({
  UHID:         { type: String, required: true, index: true },
  patientName:  { type: String, default: "" },
  admissionId:  { type: Schema.Types.ObjectId, ref: "Admission" },
  visitType:    { type: String, enum: ["IPD", "OPD", "ER", "DC"], default: "OPD" },

  reportType: {
    type: String,
    enum: [
      "imaging-xray", "imaging-usg", "imaging-ct", "imaging-mri",
      "imaging-mammo", "imaging-bmd", "imaging-other",
      "microbiology", "histopath", "cytology",
      "ecg", "echo", "pft", "endoscopy", "other",
    ],
    required: true,
  },
  testName:     { type: String, required: true },    // "X-ray Chest PA", "USG Abdomen"
  bodyPart:     { type: String, default: "" },
  reportDate:   { type: Date, default: Date.now, index: true },

  // Narrative content
  clinicalDetails: { type: String, default: "" },     // referring clinical context
  findings:        { type: String, default: "" },     // long-form description
  impression:      { type: String, default: "" },     // diagnostic conclusion
  recommendations: { type: String, default: "" },

  // Specimen / source (for micro / histopath)
  specimen:        { type: String, default: "" },     // "Blood", "Urine", "Sputum", "Tissue from..."
  collectionDate:  { type: Date, default: null },
  organism:        { type: String, default: "" },     // microbiology
  sensitivity:     { type: String, default: "" },     // antibiotic sensitivity narrative

  attachments:     { type: [String], default: [] },   // URLs (DICOM viewer / scanned PDF)

  status:       { type: String, enum: ["draft", "reported", "verified"], default: "draft", index: true },

  reportedBy:   { type: Schema.Types.ObjectId, ref: "User" },
  reportedByName: { type: String, default: "" },
  verifiedBy:   { type: Schema.Types.ObjectId, ref: "User" },
  verifiedByName: { type: String, default: "" },      // R7hr(LAB-P4) — authorizing signatory on the print
  verifiedAt:   { type: Date, default: null },

  // R7bh-F1 / R7bg-7-CRIT-2: PrintAudit infrastructure $incs this on
  // every print/reprint. Pre-R7bh the LabReport collection had no
  // printCount field so the $inc silently no-op'd and DUPLICATE
  // watermarks never rendered on reprinted reports.
  printCount: { type: Number, default: 0 },
}, { timestamps: true });

LabReportSchema.index({ UHID: 1, reportType: 1, reportDate: -1 });

module.exports = {
  LabTrend:  mongoose.model("LabTrend",  LabTrendSchema),
  LabReport: mongoose.model("LabReport", LabReportSchema),
};
