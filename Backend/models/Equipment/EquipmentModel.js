/**
 * EquipmentModel.js
 *
 * Single source of truth for every reusable equipment unit the hospital
 * owns — ventilators, BiPAP, oxygen concentrators, wheelchairs, cardiac
 * monitors, infusion pumps, suction machines, etc.
 *
 * Each unit's CURRENT location is one of:
 *   WAREHOUSE  → idle, in stores
 *   BED        → attached to a bed in-house
 *   HOMECARE   → loaned to a patient at home
 *   SERVICE    → out for maintenance / repair
 *   RETIRED    → end of life
 *
 * Every move is appended to `assignments[]` for audit; every service
 * event to `serviceHistory[]`. Status + nextServiceDue let the
 * maintenance dashboard surface overdue units.
 */
const mongoose = require("mongoose");

const ASSIGNMENT = new mongoose.Schema(
  {
    locationType: {
      type: String,
      enum: ["WAREHOUSE", "BED", "HOMECARE", "SERVICE", "RETIRED"],
      required: true,
    },
    // Generic ref — could be Bed._id, Patient._id, vendor record id, etc.
    refId:    { type: mongoose.Schema.Types.ObjectId, default: null },
    refModel: { type: String, default: "" },
    refLabel: { type: String, default: "" },        // human-readable label

    // For HOMECARE assignments:
    patientId:   { type: mongoose.Schema.Types.ObjectId, ref: "Patient", default: null },
    patientUHID: { type: String, default: "" },
    patientName: { type: String, default: "" },
    contactNumber:{ type: String, default: "" },
    homeAddress: { type: String, default: "" },
    expectedReturn:{ type: Date, default: null },
    dailyRentalCharge: { type: Number, default: 0 },

    assignedAt:  { type: Date, default: Date.now },
    assignedBy:  { type: String, default: "" },
    returnedAt:  { type: Date, default: null },
    returnedBy:  { type: String, default: "" },
    returnedCondition: { type: String, default: "" }, // Good / Damaged / Lost
    notes:       { type: String, default: "" },
  },
  { _id: true, timestamps: true }
);

const SERVICE_LOG = new mongoose.Schema(
  {
    serviceType: {
      type: String,
      enum: ["Routine", "Repair", "Calibration", "Cleaning", "Recall", "Other"],
      default: "Routine",
    },
    performedBy: { type: String, default: "" },    // technician / vendor name
    vendor:      { type: String, default: "" },
    cost:        { type: Number, default: 0 },
    serviceDate: { type: Date,   default: Date.now },
    nextDueDate: { type: Date,   default: null },
    notes:       { type: String, default: "" },
    attachments: [{ type: String }],                // optional invoice URLs
  },
  { _id: true, timestamps: true }
);

const EquipmentSchema = new mongoose.Schema(
  {
    // ── Identity ──
    name:       { type: String, required: true, trim: true },
    category: {
      type: String,
      enum: ["Respiratory", "Mobility", "Monitoring", "Therapy", "Diagnostic", "Other"],
      default: "Other",
      index: true,
    },
    assetTag:   { type: String, default: "", trim: true },  // hospital tag — indexed below
    serialNo:   { type: String, default: "", trim: true },
    manufacturer:{ type: String, default: "" },
    model:      { type: String, default: "" },

    purchaseDate: { type: Date, default: null },
    warrantyEnd:  { type: Date, default: null },
    costPrice:    { type: Number, default: 0 },

    // ── Current state ──
    status: {
      type: String,
      enum: ["Available", "In-use", "On-loan", "Under-service", "Out-of-service", "Retired"],
      default: "Available",
      index: true,
    },

    currentLocation: {
      type: {
        type: String,
        enum: ["WAREHOUSE", "BED", "HOMECARE", "SERVICE", "RETIRED"],
        default: "WAREHOUSE",
      },
      refId:    { type: mongoose.Schema.Types.ObjectId, default: null },
      refModel: { type: String, default: "" },
      refLabel: { type: String, default: "" },
      since:    { type: Date,   default: Date.now },
    },

    // ── Service tracking ──
    lastService:   { type: Date, default: null },
    nextServiceDue:{ type: Date, default: null, index: true },
    servicePolicyDays: { type: Number, default: 90 },   // recurring service cadence
    serviceHistory: { type: [SERVICE_LOG], default: [] },

    // ── Assignment audit trail (every move appended) ──
    assignments: { type: [ASSIGNMENT], default: [] },

    // ── Billing ──
    dailyRentalCharge: { type: Number, default: 0 },

    // ── Soft delete ──
    isActive: { type: Boolean, default: true, index: true },

    // ── Audit ──
    createdBy: { type: String, default: "" },
    updatedBy: { type: String, default: "" },
  },
  { timestamps: true }
);

// Auto-compute next service date when lastService is set.
EquipmentSchema.pre("save", function (next) {
  if (this.isModified("lastService") && this.lastService && this.servicePolicyDays > 0) {
    this.nextServiceDue = new Date(
      new Date(this.lastService).getTime() + this.servicePolicyDays * 86400000
    );
  }
  next();
});

// Indexes
EquipmentSchema.index({ "currentLocation.type": 1 });
EquipmentSchema.index({ assetTag: 1 }, { unique: true, partialFilterExpression: { assetTag: { $type: "string", $gt: "" } } });

module.exports = mongoose.model("Equipment", EquipmentSchema);
