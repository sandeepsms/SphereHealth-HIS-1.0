// Doctor/models/doctorNotesModel.js
// References: Patient, Doctor, Department, NurseStaff models

const mongoose = require("mongoose");

const OrderSchema = new mongoose.Schema(
  {
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
      required: true,
    },
    instruction: { type: String, required: true, trim: true },
    route: {
      type: String,
      enum: ["IV", "IM", "Oral", "SC", "SL", "Topical", "Inhalation", ""],
    },
    frequency: { type: String },
    duration: { type: String },
    notes: { type: String },

    // Written back by nurseNotesService when nurse confirms
    nurseStatus: {
      type: String,
      enum: ["pending", "done", "skipped", "partial"],
      default: "pending",
    },
    nurseConfirmedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "NurseStaff",
    },
    nurseConfirmedAt: { type: Date },
    nurseRemarks: { type: String },
  },
  { _id: true },
);

const VitalsSchema = new mongoose.Schema(
  {
    bp: { systolic: Number, diastolic: Number },
    pulse: Number,
    temp: Number,
    rr: Number,
    spo2: Number,
  },
  { _id: false },
);

const DoctorNotesSchema = new mongoose.Schema(
  {
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Patient",
      required: true,
      index: true,
    },
    patientName: { type: String },
    patientUHID: { type: String },
    ipdNo: { type: String, required: true, index: true },

    visitDate: { type: Date, required: true, default: Date.now },
    shift: {
      type: String,
      enum: ["morning", "afternoon", "evening", "night"],
      default: "morning",
    },

    doctor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Doctor",
      required: true,
    },
    doctorName: { type: String },
    doctorId: { type: String },
    doctorRegNo: { type: String },
    consultantName: { type: String },

    department: { type: mongoose.Schema.Types.ObjectId, ref: "Department" },

    soap: {
      subjective: { type: String },
      objective: { type: String },
      assessment: { type: String },
      plan: { type: String },
    },

    vitals: VitalsSchema,
    investigations: [{ type: String }],
    orders: [OrderSchema],
    provisionalDiagnosis: { type: String },
    finalDiagnosis: { type: String },

    status: {
      type: String,
      enum: ["draft", "signed", "amended"],
      default: "draft",
    },
    signedAt: { type: Date },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor" },
  },
  { timestamps: true, collection: "doctor_notes" },
);

DoctorNotesSchema.index({ patient: 1, visitDate: -1 });
DoctorNotesSchema.index({ ipdNo: 1, visitDate: -1 });
DoctorNotesSchema.index({ doctor: 1, visitDate: -1 });
DoctorNotesSchema.index({ "orders.nurseStatus": 1 });

// All pending orders for a patient — used by nurse
DoctorNotesSchema.statics.getAllPendingOrders = async function (ipdNo) {
  const notes = await this.find({
    ipdNo,
    "orders.nurseStatus": "pending",
    status: "signed",
  })
    .populate("doctor", "personalInfo doctorId")
    .lean();

  const pending = [];
  notes.forEach((n) => {
    n.orders
      .filter((o) => o.nurseStatus === "pending")
      .forEach((o) => {
        pending.push({
          ...o,
          noteId: n._id,
          visitDate: n.visitDate,
          doctorName: n.doctorName,
          doctorId: n.doctorId,
        });
      });
  });
  return pending;
};

DoctorNotesSchema.virtual("pendingOrdersCount").get(function () {
  return this.orders.filter((o) => o.nurseStatus === "pending").length;
});

module.exports = mongoose.model("DoctorNotes", DoctorNotesSchema);
