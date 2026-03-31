// models/treatmentChartModel.js
// Auto-built from doctorNotes + nurseNotes
// Shows all orders + nurse confirmations in one place
// Both Doctor and Nurse can view this
//
// Populated by:
//   doctorNotesService.js  → addDoctorOrders() when note is signed
//   nurseNotesService.js   → recordNurseExecution() when nurse confirms

const mongoose = require("mongoose");

// ── One execution entry per shift per day ─────────────────────
const ExecutionSchema = new mongoose.Schema(
  {
    shift: { type: String, enum: ["morning", "evening", "night"] },
    date: { type: Date },
    status: {
      type: String,
      enum: ["done", "skipped", "partial", "pending"],
      default: "pending",
    },
    executedBy: { type: mongoose.Schema.Types.ObjectId, ref: "NurseStaff" },
    executedByName: { type: String },
    executedAt: { type: Date },
    remarks: { type: String },
    nurseNoteId: { type: mongoose.Schema.Types.ObjectId, ref: "NurseNotes" },
  },
  { _id: true },
);

// ── One row in the treatment chart ───────────────────────────
const TreatmentEntrySchema = new mongoose.Schema(
  {
    // What doctor ordered
    instruction: { type: String, required: true },
    type: {
      type: String,
      enum: [
        "medication",
        "iv_fluid",
        "investigation",
        "procedure",
        "diet",
        "other",
      ],
    },
    route: { type: String },
    frequency: { type: String },
    duration: { type: String },

    // Who ordered
    orderedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor" },
    orderedByName: { type: String },
    orderedAt: { type: Date, required: true },

    // Source refs — to trace back to original note
    doctorNoteId: { type: mongoose.Schema.Types.ObjectId, ref: "DoctorNotes" },
    orderId: { type: mongoose.Schema.Types.ObjectId },

    // Nurse executions — one per shift
    executions: [ExecutionSchema],

    // Is this order still active?
    isActive: { type: Boolean, default: true },
    discontinuedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor" },
    discontinuedAt: { type: Date },
    discontinueReason: { type: String },
  },
  { _id: true },
);

// ── Main Treatment Chart ──────────────────────────────────────
const TreatmentChartSchema = new mongoose.Schema(
  {
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Patient",
      required: true,
      index: true,
    },
    ipdNo: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    admissionDate: { type: Date },
    dischargeDate: { type: Date },

    entries: [TreatmentEntrySchema],

    lastUpdatedBy: { type: mongoose.Schema.Types.ObjectId },
    lastUpdatedAt: { type: Date },
  },
  { timestamps: true, collection: "treatment_charts" },
);

// ── Static: add orders when doctor signs a note ───────────────
TreatmentChartSchema.statics.addDoctorOrders = async function (doctorNote) {
  // Upsert chart — create if not exists
  let chart = await this.findOne({ ipdNo: doctorNote.ipdNo });
  if (!chart) {
    chart = await this.create({
      patient: doctorNote.patient,
      ipdNo: doctorNote.ipdNo,
      admissionDate: new Date(),
    });
  }

  // Push each order as a new entry
  const newEntries = (doctorNote.orders || []).map((order) => ({
    instruction: order.instruction,
    type: order.type,
    route: order.route,
    frequency: order.frequency,
    duration: order.duration,
    orderedBy: doctorNote.doctor,
    orderedByName: doctorNote.doctorName,
    orderedAt: doctorNote.visitDate || new Date(),
    doctorNoteId: doctorNote._id,
    orderId: order._id,
    executions: [],
    isActive: true,
  }));

  chart.entries.push(...newEntries);
  chart.lastUpdatedAt = new Date();
  chart.lastUpdatedBy = doctorNote.doctor;
  await chart.save();
  return chart;
};

// ── Static: record nurse execution ───────────────────────────
TreatmentChartSchema.statics.recordNurseExecution = async function (
  ipdNo,
  exec,
  nurse,
) {
  return this.updateOne(
    { ipdNo, "entries.orderId": exec.orderId },
    {
      $push: {
        "entries.$.executions": {
          shift: exec.shift,
          date: exec.executedAt || new Date(),
          status: exec.status,
          executedBy: nurse._id,
          executedByName: nurse.name,
          executedAt: exec.executedAt || new Date(),
          remarks: exec.remarks || "",
          nurseNoteId: exec.nurseNoteId,
        },
      },
      $set: {
        lastUpdatedAt: new Date(),
        lastUpdatedBy: nurse._id,
      },
    },
  );
};

// ── Static: discontinue an order ─────────────────────────────
TreatmentChartSchema.statics.discontinueOrder = async function (
  ipdNo,
  entryId,
  doctorId,
  reason,
) {
  return this.updateOne(
    { ipdNo, "entries._id": entryId },
    {
      $set: {
        "entries.$.isActive": false,
        "entries.$.discontinuedBy": doctorId,
        "entries.$.discontinuedAt": new Date(),
        "entries.$.discontinueReason": reason || "Discontinued by doctor",
      },
    },
  );
};

// ── Virtual: pending today ────────────────────────────────────
TreatmentChartSchema.virtual("pendingToday").get(function () {
  const today = new Date().toDateString();
  return this.entries.filter((e) => {
    if (!e.isActive) return false;
    return !e.executions.some(
      (ex) => new Date(ex.date).toDateString() === today,
    );
  });
});

module.exports =
  mongoose.models.TreatmentChart ||
  mongoose.model("TreatmentChart", TreatmentChartSchema);
