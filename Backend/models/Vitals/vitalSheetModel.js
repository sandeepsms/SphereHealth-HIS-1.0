// models/vitals/vitalSheetModel.js
// References: Patient, Doctor, NurseStaff models

const mongoose = require("mongoose");

const VitalEntrySchema = new mongoose.Schema(
  {
    time: { type: String, required: true }, // e.g. "06:00", "14:00"
    values: {
      type: Map,
      of: new mongoose.Schema(
        {
          value: { type: Number, default: 0 },
          unit: { type: String, required: true },
        },
        { _id: false },
      ),
    },
    notes: { type: String, default: "" },

    // ✅ Nurse reference — who recorded this entry
    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: "NurseStaff" },
    nurseName: { type: String, default: "" }, // denormalized
  },
  { _id: true },
);

const VitalSheetSchema = new mongoose.Schema(
  {
    // ── Patient Reference ──────────────────────────────────
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Patient",
      required: true,
      index: true,
    },
    uhid: {
      type: String,
      required: true,
      index: true,
    },
    patientName: String, // denormalized for quick display

    // ── Date ──────────────────────────────────────────────
    date: {
      type: String, // "2026-03-24"
      required: true,
    },

    // ── Admission Reference (optional — for IPD) ──────────
    admission: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admission",
      default: null,
    },
    ipdNo: { type: String, default: "" }, // UHID or admission number

    // ── Doctor Reference ───────────────────────────────────
    doctor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Doctor",
      default: null,
    },
    doctorName: { type: String, default: "" }, // denormalized

    // ── Department ─────────────────────────────────────────
    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Department",
      default: null,
    },
    departmentName: { type: String, default: "" },

    // ── Vitals Config ──────────────────────────────────────
    activeVitals: [
      {
        name: { type: String, required: true }, // "Blood Pressure", "Pulse" etc.
      },
    ],

    // ── Vital Entries (multiple per day) ───────────────────
    tableData: [VitalEntrySchema],
  },
  { timestamps: true },
);

// Unique per patient per date
VitalSheetSchema.index({ uhid: 1, date: 1 }, { unique: true });
VitalSheetSchema.index({ patient: 1, date: 1 });
VitalSheetSchema.index({ admission: 1, date: 1 });

module.exports =
  mongoose.models.VitalSheet || mongoose.model("VitalSheet", VitalSheetSchema);
