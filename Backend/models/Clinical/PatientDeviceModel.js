// models/Clinical/PatientDeviceModel.js — R7hr-184
//
// Per-admission invasive-device registry. Doctor or Nurse records which
// devices the patient currently has (ET tube / Foley / IV cannula /
// central line / NG tube / …), WHEN each was placed, every CHANGE
// (re-site / replacement) with its own timestamp + actor, and removal.
//
// Downstream: ICU Bundles applicability is device-driven —
//   VAP    ← ET_TUBE | TRACHEOSTOMY active
//   CAUTI  ← URINARY_CATHETER active
//   CLABSI ← CENTRAL_LINE | PICC_LINE active
// (not intubated → VAP sheet not charted; not catheterized → CAUTI
// not charted — per NABH HIC.5 device-days denominator logic.)
const mongoose = require("mongoose");

// Canonical device types. `label` is the display name; `bundle` is the
// ICU bundle this device makes applicable (null = no bundle linkage).
const DEVICE_TYPES = {
  ET_TUBE:          { label: "Endotracheal Tube (Intubated)", bundle: "vap" },
  TRACHEOSTOMY:     { label: "Tracheostomy",                  bundle: "vap" },
  CENTRAL_LINE:     { label: "Central Line (CVC)",            bundle: "clabsi" },
  PICC_LINE:        { label: "PICC Line",                     bundle: "clabsi" },
  URINARY_CATHETER: { label: "Urinary Catheter (Foley)",      bundle: "cauti" },
  IV_CANNULA:       { label: "Peripheral IV Cannula",         bundle: null },
  ARTERIAL_LINE:    { label: "Arterial Line",                 bundle: null },
  NG_TUBE:          { label: "NG / Ryle's Tube",              bundle: null },
  CHEST_TUBE:       { label: "Chest Tube / ICD",              bundle: null },
  OTHER:            { label: "Other Device",                  bundle: null },
};

const ActorSchema = new mongoose.Schema(
  {
    name:       { type: String, default: "" },
    employeeId: { type: String, default: "" },
    role:       { type: String, default: "" },
  },
  { _id: false }
);

// One row per change event — re-site, article replacement, dressing
// change requiring re-fixation, etc. The original placedAt stays put;
// the latest change is what "current article since" reads from.
const ChangeSchema = new mongoose.Schema(
  {
    changedAt: { type: Date, default: Date.now },
    changedBy: { type: ActorSchema, default: () => ({}) },
    reason:    { type: String, default: "" },   // e.g. "Routine 72h re-site", "Blocked", "Phlebitis"
    site:      { type: String, default: "" },   // new site if re-sited
    size:      { type: String, default: "" },   // new article size if changed
    note:      { type: String, default: "" },
  },
  { _id: false }
);

const PatientDeviceSchema = new mongoose.Schema(
  {
    UHID:        { type: String, required: true, index: true, trim: true },
    admissionId: { type: mongoose.Schema.Types.ObjectId, ref: "Admission", index: true },
    ipdNo:       { type: String, index: true, trim: true },
    patientName: { type: String, default: "" },

    deviceType:  { type: String, required: true, enum: Object.keys(DEVICE_TYPES) },
    deviceLabel: { type: String, default: "" },   // snapshot of DEVICE_TYPES label (or custom for OTHER)
    site:        { type: String, default: "" },   // e.g. "Right forearm", "Right IJV"
    size:        { type: String, default: "" },   // e.g. "18G", "ET 7.5", "Foley 16Fr"

    status:      { type: String, enum: ["Active", "Removed"], default: "Active", index: true },

    placedAt:    { type: Date, default: Date.now },
    placedBy:    { type: ActorSchema, default: () => ({}) },

    changes:     { type: [ChangeSchema], default: [] },

    removedAt:      { type: Date, default: null },
    removedBy:      { type: ActorSchema, default: () => ({}) },
    removalReason:  { type: String, default: "" },

    notes:       { type: String, default: "" },
  },
  { timestamps: true }
);

// Active-devices-per-admission is THE hot query (banner strip + ICU
// bundle applicability both hit it on every page load).
PatientDeviceSchema.index({ admissionId: 1, status: 1 });
PatientDeviceSchema.index({ ipdNo: 1, status: 1 });

const PatientDevice = mongoose.model("PatientDevice", PatientDeviceSchema);
PatientDevice.DEVICE_TYPES = DEVICE_TYPES;

module.exports = PatientDevice;
