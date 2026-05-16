/**
 * GateLogModel — every entry/exit at any of the hospital gates.
 *
 * Captured by Security at the gate desk. Optionally linked to a
 * VisitorPass when the person on the way in is an attendant for an
 * admitted patient.
 */
const mongoose = require("mongoose");

const GateLogSchema = new mongoose.Schema(
  {
    direction: {
      type: String,
      enum: ["in", "out"],
      required: true,
      index: true,
    },
    gate: {
      type: String,
      enum: ["Main", "Emergency", "Service", "Pharmacy", "Other"],
      default: "Main",
      index: true,
    },
    personType: {
      type: String,
      enum: ["Visitor", "Patient", "Staff", "Vendor", "Ambulance", "Other"],
      default: "Visitor",
      index: true,
    },
    personName:     { type: String, required: true, trim: true },
    contactNumber:  { type: String, default: "" },
    idProofType: {
      type: String,
      enum: ["Aadhaar", "PAN", "Voter ID", "Driving License", "Passport", "Employee ID", "Other", null],
      default: null,
    },
    idProofNumber:  { type: String, default: "" },
    purpose:        { type: String, default: "" },
    vehicleNumber:  { type: String, default: "" },

    // Optional VisitorPass linkage — set when the gate desk scans an
    // existing attendant pass instead of capturing fresh ID details.
    visitorPassId:  { type: mongoose.Schema.Types.ObjectId, ref: "VisitorPass", default: null, index: true },
    linkedPassNumber: { type: String, default: "" },

    // Audit
    recordedBy:     { type: String, required: true, trim: true },
    recordedById:   { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    recordedByRole: { type: String, default: "Security" },

    notes:          { type: String, default: "" },
  },
  { timestamps: true },
);

GateLogSchema.index({ createdAt: -1 });
GateLogSchema.index({ direction: 1, createdAt: -1 });
GateLogSchema.index({ personName: 1 });

module.exports =
  mongoose.models.GateLog || mongoose.model("GateLog", GateLogSchema);
