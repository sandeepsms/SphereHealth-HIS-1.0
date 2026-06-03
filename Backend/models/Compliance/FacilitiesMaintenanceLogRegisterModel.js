/**
 * FacilitiesMaintenanceLogRegisterModel.js — R7gw-B10-T06 / NABH FMS.5
 *
 * Facilities & Equipment Maintenance Log register. Engineering / Biomedical /
 * Facilities team logs scheduled (PPM) and corrective (breakdown) maintenance
 * jobs for plant-and-machinery NABH cares about under FMS.5:
 *   • Building Management System (BMS)
 *   • Diesel Generator (DG-set)
 *   • Fire-detection / Fire-fighting systems
 *   • Lifts / elevators
 *   • Biomedical equipment (ventilators, monitors, IABP, dialysis…)
 *   • HVAC / AHU / chiller plant
 *   • Medical-gas plant (LMO, manifold, vacuum, compressed-air)
 *   • UPS / inverter banks
 *   • Steam-boiler / CSSD steam plant
 *
 * One row per maintenance event (scheduled job, corrective ticket, or AMC
 * visit). Surveyors look for: PPM frequency adherence, mean-time-to-restore,
 * outstanding overdue jobs, AMC-vendor signoff trail.
 *
 * UHID is NOT applicable here — these are facility/equipment events, not
 * patient-attributed.
 */
"use strict";

const mongoose = require("mongoose");
const { Schema } = mongoose;

const AuditSchema = new Schema({
  _id: false,
  action: { type: String, enum: ["CREATED", "UPDATED", "CLOSED"], required: true },
  at: { type: Date, default: Date.now },
  byName: { type: String, default: "" },
  byRole: { type: String, default: "" },
  byUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  notes: { type: String, default: "" },
});

const FacilitiesMaintenanceLogRegisterSchema = new Schema({
  // ── Equipment identity ──────────────────────────────────────────
  equipmentType: {
    type: String,
    enum: [
      "BMS",
      "Generator",
      "Fire-System",
      "Lift",
      "Biomedical",
      "HVAC",
      "MedGas",
      "UPS",
      "Steam-Boiler",
    ],
    required: true,
    index: true,
  },
  equipmentId:   { type: String, required: true, trim: true, index: true }, // asset tag / serial
  equipmentName: { type: String, default: "" },                              // human-friendly label
  location:      { type: String, default: "" },                              // plant-room / ward / floor

  // ── Schedule vs Execution ───────────────────────────────────────
  scheduledAt:   { type: Date, required: true, index: true },
  performedAt:   { type: Date, default: null, index: true },

  // ── Workforce ───────────────────────────────────────────────────
  performedByEmpId: { type: String, default: "", index: true },
  performedByName:  { type: String, default: "" },
  performedByUserId:{ type: Schema.Types.ObjectId, ref: "User", default: null },
  vendor:           { type: String, default: "" },     // AMC-vendor name when outsourced
  amcContractRef:   { type: String, default: "" },     // AMC PO / contract no.

  // ── What happened ───────────────────────────────────────────────
  jobType: {
    type: String,
    enum: ["PPM", "Corrective", "Calibration", "AMC", "Breakdown", "Inspection"],
    default: "PPM",
    index: true,
  },
  findings:         { type: String, default: "" },
  correctiveAction: { type: String, default: "" },
  partsReplaced:    { type: String, default: "" },
  downtimeMinutes:  { type: Number, default: 0 },

  // ── Next service window ─────────────────────────────────────────
  nextDueDate:      { type: Date, default: null, index: true },

  // ── Lifecycle ───────────────────────────────────────────────────
  status: {
    type: String,
    enum: ["Scheduled", "Done", "Overdue", "Cancelled"],
    default: "Scheduled",
    index: true,
  },

  // ── Idempotency / source ────────────────────────────────────────
  sourceRef:        { type: String, default: () => require("crypto").randomUUID(), unique: true, index: true },
  sourceType:       { type: String, default: "Manual" },

  emittedAt:        { type: Date, default: Date.now, index: true },

  auditTrail:       { type: [AuditSchema], default: [] },

  hospitalId:       { type: Schema.Types.ObjectId, ref: "Hospital", default: null },
}, { timestamps: true, collection: "facilities_maintenance_logs" });

// Composite indexes for surveyor-style filters
FacilitiesMaintenanceLogRegisterSchema.index({ equipmentType: 1, scheduledAt: -1 });
FacilitiesMaintenanceLogRegisterSchema.index({ equipmentId: 1, scheduledAt: -1 });
FacilitiesMaintenanceLogRegisterSchema.index({ status: 1, nextDueDate: 1 });
FacilitiesMaintenanceLogRegisterSchema.index({ jobType: 1, performedAt: -1 });
FacilitiesMaintenanceLogRegisterSchema.index({ performedByEmpId: 1, performedAt: -1 });

module.exports =
  mongoose.models.FacilitiesMaintenanceLogRegister ||
  mongoose.model("FacilitiesMaintenanceLogRegister", FacilitiesMaintenanceLogRegisterSchema);
