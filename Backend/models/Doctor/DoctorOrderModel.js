const mongoose = require("mongoose");

const DoctorOrderSchema = new mongoose.Schema({
  UHID: { type: String, required: true, index: true },
  patientId: { type: mongoose.Schema.Types.ObjectId, ref: "Patient" },
  patientName: String,
  visitId: String,   // visitNumber for OPD, ipdNo for IPD
  visitType: { type: String, enum: ["OPD","IPD","Emergency","DayCare"], default: "OPD" },

  orderType: { type: String, enum: ["Medication","Investigation","Procedure","Diet","Activity","Nursing"], required: true },
  priority: { type: String, enum: ["Routine","Urgent","STAT"], default: "Routine" },

  orderDetails: {
    // Medication fields
    medicineName: String, dose: String, frequency: String, duration: String, route: String,
    // Investigation fields
    testName: String, urgency: String, instructions: String,
    // Procedure fields
    procedureName: String,
    procedureType: { type: String, enum: ["Minor","Major","Diagnostic","Therapeutic"] },
    estimatedDuration: String,
    consentRequired: { type: Boolean, default: false },
    // Common
    notes: String,
    displayName: String,
  },

  orderedBy: String,
  orderedByRole: { type: String, default: "Doctor" },

  status: {
    type: String,
    enum: ["Pending","Acknowledged","InProgress","Completed","Cancelled","OnHold"],
    default: "Pending",
    index: true
  },

  acknowledgedBy: String,
  acknowledgedAt: Date,
  completedBy: String,
  completedAt: Date,
  nurseNotes: String,

  consentStatus: {
    type: String,
    enum: ["NotRequired","Pending","Obtained","Declined"],
    default: "NotRequired"
  },
  consentData: {
    obtainedAt: Date,
    obtainedBy: String,
    fingerprintHash: String,
    fingerprintVerified: { type: Boolean, default: false },
    webAuthnCredentialId: String,
    witnessName: String,
    guardianName: String,
    guardianRelation: String,
    notes: String,
  },

}, { timestamps: true, collection: "doctor_orders" });

DoctorOrderSchema.index({ UHID: 1, status: 1 });
DoctorOrderSchema.index({ visitId: 1, status: 1 });
DoctorOrderSchema.index({ UHID: 1, orderType: 1 });

module.exports = mongoose.models.DoctorOrder || mongoose.model("DoctorOrder", DoctorOrderSchema);
