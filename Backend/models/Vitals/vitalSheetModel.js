// models/vitals/vitalSheetModel.js
// References: Patient, Doctor, NurseStaff models

const mongoose = require("mongoose");

const VitalEntrySchema = new mongoose.Schema(
  {
    // "06:00", "14:00" — strict HH:MM format. The previous bare String
    // accepted "99:99" / "-1:00" / "abc" silently (patient-safety audit
    // A-05). Validator anchors a 24-hour wall clock.
    time: {
      type: String,
      required: true,
      validate: {
        validator: (v) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v || ""),
        message: (p) => `time "${p.value}" is not a valid HH:MM (24h)`,
      },
    },
    values: {
      type: Map,
      of: new mongoose.Schema(
        {
          // Cap the value field to physiologically plausible bounds. The
          // sheet collects mixed units (BP, pulse, temp, glucose, weight)
          // so the envelope is intentionally wide — but no negatives, no
          // unbounded upper. Patient-safety audit A-05.
          value: { type: Number, default: 0, min: 0, max: 100000 },
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
