// models/Compliance/DayCareRegisterModel.js
// R7hr(DC-P2) — NABH Day Care register. One row per day-care admission,
// finalised at exit: same-day discharge (with the Aldrete-style readiness
// score as the objective fitness evidence) or conversion to IPD. Mirrors
// the EmergencyRegister pattern (idempotent by admissionId).
const mongoose = require("mongoose");

const DayCareRegisterSchema = new mongoose.Schema(
  {
    dcNumber:        { type: String, unique: true, sparse: true },   // DCR-YYYY-NNNN
    patientId:       { type: mongoose.Schema.Types.ObjectId, ref: "Patient" },
    UHID:            { type: String, uppercase: true, trim: true, index: true },
    patientName:     String,
    age:             Number,
    sex:             String,
    admissionId:     { type: mongoose.Schema.Types.ObjectId, ref: "Admission", index: true },
    admissionNumber: String,
    procedure:       String,
    doctor:          String,
    admittedAt:      Date,
    dischargedAt:    Date,
    checklistComplete: { type: Boolean, default: false },
    readinessScore:  { type: Number, min: 0, max: 10, default: null },
    outcome: {
      type: String,
      enum: ["SameDayDischarge", "ConvertedToIPD", "LAMA", "Referred", "Other"],
      default: "SameDayDischarge",
    },
    remarks:         String,
    recordedBy:      String,
    recordedByRole:  String,
  },
  { timestamps: true },
);

DayCareRegisterSchema.index({ createdAt: -1 });

module.exports =
  mongoose.models.DayCareRegister ||
  mongoose.model("DayCareRegister", DayCareRegisterSchema);
