/**
 * DiabeticChartModel.js
 *
 * One document per admission per calendar date. Holds:
 *  - the active sliding-scale policy for the patient
 *  - an entries[] array of slot rows (AC-Breakfast / PC-Breakfast /
 *    AC-Lunch / PC-Lunch / AC-Dinner / PC-Dinner / HS / Extra)
 *  - each row carries the BG reading + recommended dose + actual dose
 *    given + insulin type/route + administering nurse + optional link
 *    to the MAR administration record.
 *
 * Index on (admissionId, date) is unique so a single sheet per day
 * is enforced. Querying by UHID + date also works for legacy callers.
 */
const mongoose = require("mongoose");

const SLIDING_RULE = new mongoose.Schema(
  {
    // Inclusive BG range in mg/dL. lo=0 hi=70 = "hypo zone".
    lo: { type: Number, required: true, min: 0 },
    hi: { type: Number, required: true, min: 0 },
    // Recommended insulin dose (units) for this band.
    dose: { type: Number, required: true, min: 0, default: 0 },
    // Action label shown to the nurse in the chart cell. Free text
    // so a doctor can encode special handling — e.g.
    //   "Skip · call SR (hypo)" or "10 u + recheck in 1 hr".
    action: { type: String, default: "", trim: true },
  },
  { _id: false }
);

const SLIDING_SCALE = new mongoose.Schema(
  {
    insulinType: { type: String, default: "Regular (Actrapid)", trim: true },
    route:       { type: String, enum: ["SC", "IV", "IM"], default: "SC" },
    // Up to 8 bands is plenty; most charts use 5–7.
    rules:       { type: [SLIDING_RULE], default: [] },
    setBy:       { type: String, default: "", trim: true },
    setById:     { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    setAt:       { type: Date,   default: Date.now },
    notes:       { type: String, default: "", trim: true },
  },
  { _id: false }
);

const SLOT_ENUM = [
  "AC-Breakfast", "PC-Breakfast",
  "AC-Lunch",     "PC-Lunch",
  "AC-Dinner",    "PC-Dinner",
  "HS",
  "Extra",       // ad-hoc reading (e.g. patient symptomatic)
];

const ENTRY_SCHEMA = new mongoose.Schema(
  {
    slot:             { type: String, enum: SLOT_ENUM, required: true },
    scheduledTime:    { type: String, default: "" },   // "07:00"

    // BG reading
    // R7az-D2-MED-1: bound to physiological window. 0 = explicit "no
    // reading", upper bound 1500 mg/dL matches NurseVitalsSchema's
    // bloodSugar — anything above is a typo or sensor fault.
    bgValue:          { type: Number, default: null, min: 0, max: 1500 }, // mg/dL
    bgTime:           { type: String, default: "" },
    bgRecordedBy:     { type: String, default: "" },
    bgRecordedById:   { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    // Insulin
    // R7az-D2-MED-2: actualDose bounded — 500 IU is a realistic ceiling
    // for accidental DKA boluses; anything beyond is a fat-finger error.
    recommendedDose:  { type: Number, default: null, min: 0, max: 500 }, // units
    actualDose:       { type: Number, default: null, min: 0, max: 500 }, // units
    insulinType:      { type: String, default: "" },
    route:            { type: String, enum: ["SC", "IV", "IM", ""], default: "" },
    administeredAt:   { type: String, default: "" },   // "07:30"
    administeredBy:   { type: String, default: "" },
    administeredById: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    // Optional link to the MAR administration entry created by this row
    marId:            { type: mongoose.Schema.Types.ObjectId, ref: "MAR", default: null },
    marAdministrationId: { type: mongoose.Schema.Types.ObjectId, default: null },

    // Status drives chart pill colours
    status: {
      type: String,
      enum: ["pending", "bg-only", "given", "held", "refused", "hypo-flag"],
      default: "pending",
    },

    remarks:          { type: String, default: "" },
  },
  { _id: true, timestamps: true }
);

const DiabeticChartSchema = new mongoose.Schema(
  {
    patientId:    { type: mongoose.Schema.Types.ObjectId, ref: "Patient", required: true },
    UHID:         { type: String, required: true, index: true },
    admissionId:  { type: mongoose.Schema.Types.ObjectId, ref: "Admission", required: true },
    admissionNumber: { type: String, default: "" },

    // YYYY-MM-DD string for clean unique-per-day indexing.
    date:         { type: String, required: true, index: true },

    slidingScale: { type: SLIDING_SCALE, default: () => ({}) },

    entries:      { type: [ENTRY_SCHEMA], default: [] },

    // Audit
    createdBy:    { type: String, default: "" },
    updatedBy:    { type: String, default: "" },
  },
  { timestamps: true }
);

// One sheet per admission per day
DiabeticChartSchema.index({ admissionId: 1, date: 1 }, { unique: true });
DiabeticChartSchema.index({ UHID: 1, date: -1 });

DiabeticChartSchema.statics.SLOT_ENUM = SLOT_ENUM;
DiabeticChartSchema.statics.DEFAULT_SLIDING_SCALE = {
  insulinType: "Regular (Actrapid)",
  route: "SC",
  rules: [
    { lo: 0,   hi: 70,  dose: 0,  action: "Skip · oral glucose · call doctor (hypo)" },
    { lo: 71,  hi: 150, dose: 0,  action: "No insulin" },
    { lo: 151, hi: 200, dose: 2,  action: "2 units SC" },
    { lo: 201, hi: 250, dose: 4,  action: "4 units SC" },
    { lo: 251, hi: 300, dose: 6,  action: "6 units SC" },
    { lo: 301, hi: 350, dose: 8,  action: "8 units SC · recheck in 1 hr" },
    { lo: 351, hi: 999, dose: 10, action: "10 units SC + call doctor" },
  ],
  notes: "Sliding scale — Regular Insulin (Actrapid). Adjust per doctor.",
};

module.exports = mongoose.model("DiabeticChart", DiabeticChartSchema);
