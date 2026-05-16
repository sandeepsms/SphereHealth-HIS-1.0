/**
 * IncidentReportModel — Security incident log.
 *
 * Every notable event at the hospital that isn't a clinical record:
 * theft, trespass, disturbance, fire, fall-with-injury (non-patient),
 * vandalism, vehicle accidents in the campus, etc. Each report carries
 * a unique IR-YYYYMMDD-NNNN number minted via utils/counter.
 */
const mongoose = require("mongoose");

const PersonInvolvedSchema = new mongoose.Schema(
  {
    name:    { type: String, trim: true, default: "" },
    role:    { type: String, default: "" },   // e.g. "Visitor", "Vendor", "Patient attendant"
    contact: { type: String, default: "" },
    notes:   { type: String, default: "" },
  },
  { _id: false },
);

const IncidentReportSchema = new mongoose.Schema(
  {
    incidentNumber: { type: String, unique: true, sparse: true, index: true },

    type: {
      type: String,
      enum: ["Theft", "Trespass", "Disturbance", "Medical-Emergency", "Fire", "Vandalism", "Accident", "Other"],
      required: true,
      index: true,
    },
    severity: {
      type: String,
      enum: ["Low", "Medium", "High", "Critical"],
      default: "Medium",
      index: true,
    },
    location:    { type: String, required: true, trim: true },
    occurredAt:  { type: Date, default: Date.now },
    description: { type: String, required: true, trim: true },

    personsInvolved: { type: [PersonInvolvedSchema], default: [] },
    actionTaken:     { type: String, default: "" },

    status: {
      type: String,
      enum: ["Open", "Investigating", "Resolved", "Escalated", "Closed"],
      default: "Open",
      index: true,
    },
    resolvedAt:   Date,
    resolvedBy:   { type: String, default: "" },
    escalatedTo:  { type: String, default: "" },     // e.g. "Police", "Admin", "Fire Dept"

    // Audit
    recordedBy:     { type: String, required: true, trim: true },
    recordedById:   { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    recordedByRole: { type: String, default: "Security" },

    // Stub for attachments — image / PDF / police FIR copy etc. The
    // upload pipeline isn't wired here; this field lets the UI render
    // links when content lands later via S3 / disk.
    attachments: { type: [String], default: [] },
  },
  { timestamps: true },
);

IncidentReportSchema.index({ createdAt: -1 });
IncidentReportSchema.index({ status: 1, severity: 1 });

module.exports =
  mongoose.models.IncidentReport ||
  mongoose.model("IncidentReport", IncidentReportSchema);
