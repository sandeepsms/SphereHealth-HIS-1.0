const mongoose = require("mongoose");

const DoctorOrderSchema = new mongoose.Schema({
  UHID: { type: String, required: true, index: true },
  patientId: { type: mongoose.Schema.Types.ObjectId, ref: "Patient" },
  patientName: String,
  visitId: String,   // visitNumber for OPD, ipdNo for IPD
  visitType: { type: String, enum: ["OPD","IPD","Emergency","DayCare"], default: "OPD" },

  orderType: {
    type: String,
    enum: [
      "Medication",       // oral/IM/SC/SL drugs
      "IV_Fluid",         // IV infusions, TPN, additives
      "Lab",              // laboratory investigations
      "Radiology",        // imaging — X-Ray, USG, CT, MRI
      "Investigation",    // generic / non-lab investigations (legacy)
      "Procedure",        // bedside/surgical procedures
      "BloodTransfusion", // packed cells, FFP, platelets, etc.
      "Diet",             // dietary / nutritional orders
      "Oxygen",           // oxygen therapy / HFNC / CPAP
      "Physiotherapy",    // PT / respiratory PT
      "Activity",         // mobility / activity restrictions
      "Nursing",          // nursing care instructions
      "Consultation",     // referral to another speciality
    ],
    required: true,
  },
  priority: { type: String, enum: ["Routine","Urgent","STAT"], default: "Routine" },

  orderDetails: {
    // Medication / IV Fluid / Blood fields
    medicineName: String, dose: String, frequency: String, duration: String, route: String,
    rate: String, accessSite: String, additives: String,
    // Blood Transfusion
    bloodGroup: String, crossMatchDone: String, premeds: String, monitoring: String,
    // Investigation / Radiology fields
    testName: String, urgency: String, instructions: String,
    sampleType: String, fasting: String,
    region: String, contrast: String, sedation: String, laterality: String,
    // Procedure fields
    procedureName: String,
    procedureType: { type: String, enum: ["Minor","Major","Diagnostic","Therapeutic","Bedside"] },
    indication: String, estimatedDuration: String, anaesthesia: String, position: String,
    consentRequired: { type: Boolean, default: false },
    // Diet fields
    dietType: String, calories: String, protein: String, fluidRestriction: String, consistency: String,
    // Oxygen fields
    deliveryDevice: String, flowRate: String, fio2: String, targetSpo2: String, hfncFlow: String,
    // Physiotherapy fields
    ptType: String, goals: String, precautions: String,
    // Activity fields
    activityLevel: String, assistanceLevel: String, restrictions: String,
    // Nursing fields
    instruction: String, careCategory: String,
    // Consultation fields
    speciality: String, consultantName: String, reason: String, referredBy: String,
    // Common
    notes: String, displayName: String,
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

  // Step-based audit trail (matches NABH order workflow)
  auditLog: [{
    step:   { type: String, required: true },   // e.g. "Sample Collected"
    doneBy: { type: String, required: true },   // nurse name
    doneAt: { type: Date,   default: Date.now },
    notes:  { type: String },
  }],

  // Tracks which step index has been completed (0 = none started)
  currentStepIndex: { type: Number, default: -1 },

}, { timestamps: true, collection: "doctor_orders" });

DoctorOrderSchema.index({ UHID: 1, status: 1 });
DoctorOrderSchema.index({ visitId: 1, status: 1 });
DoctorOrderSchema.index({ UHID: 1, orderType: 1 });

module.exports = mongoose.models.DoctorOrder || mongoose.model("DoctorOrder", DoctorOrderSchema);
