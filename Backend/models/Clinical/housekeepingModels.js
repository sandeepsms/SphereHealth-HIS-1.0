/**
 * housekeepingModels.js — Housekeeping module data layer.
 *
 * 5 sibling schemas covering A+B+C scope:
 *   • CleaningTask        task board (analogous to WardTask but for
 *                          cleaning — routine, terminal, spillage,
 *                          restroom, public-area, bed-turnover)
 *   • SpillageIncident    biohazard cleanup log (NABH HIC.6)
 *   • ChemicalInventory   disinfectant / detergent / sanitiser stock
 *   • AreaCleaningLog     per-area daily compliance checklist
 *   • PestControlSchedule scheduled treatments + audit history
 *
 * Shift attendance + linen/BMW supplies are intentionally REUSED from
 * the wardOpsModels (Ward Boy module already owns those collections —
 * housekeeping reads/writes them via shared /api/ward-ops endpoints).
 */
const mongoose = require("mongoose");
const { Schema } = mongoose;

/* ── 1. CLEANING TASK ───────────────────────────────────────── */
const CleaningTaskSchema = new Schema({
  type: {
    type: String,
    enum: ["routine", "terminal", "spillage", "restroom", "public-area", "bed-turnover", "discharge-clean", "other"],
    required: true, index: true,
  },
  title:        { type: String, required: true, trim: true },
  description:  { type: String, default: "" },
  // Where
  ward:         { type: String, default: "" },
  area:         { type: String, default: "" },    // OT-3 / Lab / Corridor-G1
  roomNumber:   { type: String, default: "" },
  bedNumber:    { type: String, default: "" },
  // Direct ref to the bed for discharge-clean / bed-turnover tasks —
  // lets the controller flip bed.housekeeping.state on completion without
  // a fuzzy bedNumber lookup. Optional for area/spillage tasks.
  bedId:        { type: Schema.Types.ObjectId, ref: "Bed", default: null, index: true },
  // Original admission whose discharge spawned this task — useful for
  // turnover-SLA reports + audit ("how long after Mr Patel's discharge
  // did Bed-204 become available again?").
  admissionId:  { type: Schema.Types.ObjectId, ref: "Admission", default: null },
  // Patient context (optional — discharge-clean / spillage from patient)
  UHID:         { type: String, default: "" },
  patientName:  { type: String, default: "" },
  // Priority
  priority: {
    type: String, enum: ["urgent", "high", "normal", "low"],
    default: "normal", index: true,
  },
  // Lifecycle
  status: {
    type: String,
    enum: ["open", "assigned", "in-progress", "done", "cancelled"],
    default: "open", index: true,
  },
  // Requester / assignee snapshots
  requestedBy:      { type: Schema.Types.ObjectId, ref: "User" },
  requestedByName:  { type: String, default: "" },
  requestedByRole:  { type: String, default: "" },
  requestedAt:      { type: Date, default: Date.now },
  assignedTo:       { type: Schema.Types.ObjectId, ref: "User" },
  assignedToName:   { type: String, default: "" },
  acceptedAt:       { type: Date, default: null },
  startedAt:        { type: Date, default: null },
  completedAt:      { type: Date, default: null },
  cancelledAt:      { type: Date, default: null },
  // NABH compliance
  protocolFollowed: {
    type: String,
    enum: ["standard", "terminal-icu", "isolation", "spillage", "discharge", ""],
    default: "",
  },
  productsUsed:     { type: [String], default: [] },   // chem names from inventory
  // Notes
  completionNotes:  { type: String, default: "" },
  cancelReason:     { type: String, default: "" },
}, { timestamps: true });
CleaningTaskSchema.index({ status: 1, priority: 1, requestedAt: -1 });
CleaningTaskSchema.index({ assignedTo: 1, status: 1 });

/* ── 2. SPILLAGE INCIDENT ──────────────────────────────────── */
const SpillageIncidentSchema = new Schema({
  reportedAt:       { type: Date, default: Date.now, index: true },
  reportedBy:       { type: Schema.Types.ObjectId, ref: "User" },
  reportedByName:   { type: String, default: "" },
  reportedByRole:   { type: String, default: "" },
  // Where
  area:             { type: String, required: true },          // ward / OT / lab / corridor
  location:         { type: String, default: "" },              // specific spot
  roomNumber:       { type: String, default: "" },
  bedNumber:        { type: String, default: "" },
  // What
  type: {
    type: String,
    enum: ["blood", "body-fluid", "chemical", "vomit", "urine", "stool", "other"],
    required: true,
  },
  volumeEst:        { type: String, enum: ["small", "medium", "large"], default: "small" },
  patientUHID:      { type: String, default: "" },
  // Response
  containedAt:      { type: Date, default: null },
  cleanedAt:        { type: Date, default: null },
  cleanedBy:        { type: Schema.Types.ObjectId, ref: "User" },
  cleanedByName:    { type: String, default: "" },
  productsUsed:     { type: [String], default: [] },
  protocolFollowed: { type: String, default: "spillage" },
  reportedToInfectionControl: { type: Boolean, default: false },
  status: { type: String, enum: ["reported", "contained", "cleaned"], default: "reported", index: true },
  notes:            { type: String, default: "" },
}, { timestamps: true });

/* ── 3. CHEMICAL INVENTORY ─────────────────────────────────── */
const ChemicalInventorySchema = new Schema({
  productName:   { type: String, required: true, trim: true },
  category: {
    type: String,
    enum: ["disinfectant", "detergent", "floor-cleaner", "sanitiser", "bleach", "deodoriser", "other"],
    default: "disinfectant",
  },
  unit:          { type: String, default: "L" },         // L / kg / piece
  currentStock:  { type: Number, default: 0 },
  reorderLevel:  { type: Number, default: 10 },
  lastReceivedAt:{ type: Date, default: null },
  lastReceivedQty: { type: Number, default: 0 },
  vendor:        { type: String, default: "" },
  notes:         { type: String, default: "" },
  isActive:      { type: Boolean, default: true },
}, { timestamps: true });
ChemicalInventorySchema.index({ productName: 1, isActive: 1 });

/* ── 4. AREA CLEANING LOG (NABH HIC.6 daily checklist) ─────── */
const ChecklistItemSchema = new Schema({
  item: { type: String, required: true },
  done: { type: Boolean, default: false },
  notes:{ type: String, default: "" },
}, { _id: false });

const AreaCleaningLogSchema = new Schema({
  date:         { type: Date, required: true, index: true },
  shift:        { type: String, enum: ["morning", "afternoon", "night"], required: true },
  area:         { type: String, required: true },   // OT-1, ICU, Ward-MGW
  cleaningType: { type: String, enum: ["routine", "terminal", "spot"], default: "routine" },
  performedBy:  { type: Schema.Types.ObjectId, ref: "User" },
  performedByName:{ type: String, default: "" },
  supervisedBy: { type: Schema.Types.ObjectId, ref: "User" },
  supervisedByName: { type: String, default: "" },
  checks:       { type: [ChecklistItemSchema], default: [] },
  protocolFollowed: { type: String, default: "" },
  productsUsed: { type: [String], default: [] },
  status: { type: String, enum: ["pending", "in-progress", "done", "partial"], default: "pending", index: true },
  remarks:      { type: String, default: "" },
}, { timestamps: true });
AreaCleaningLogSchema.index({ date: 1, area: 1, shift: 1 }, { unique: true });

/* ── 5. PEST CONTROL SCHEDULE ──────────────────────────────── */
const PestControlSchema = new Schema({
  scheduledDate:  { type: Date, required: true, index: true },
  area:           { type: String, required: true },
  vendor:         { type: String, default: "" },
  treatmentType: {
    type: String,
    enum: ["cockroach", "rodent", "mosquito", "fumigation", "termite", "general", "other"],
    default: "general",
  },
  performedAt:    { type: Date, default: null },
  performedByName:{ type: String, default: "" },         // vendor staff
  productsUsed:   { type: [String], default: [] },
  durationHr:     { type: Number, default: null },
  nextScheduled:  { type: Date, default: null },
  notes:          { type: String, default: "" },
  status: {
    type: String,
    enum: ["scheduled", "completed", "cancelled", "overdue"],
    default: "scheduled", index: true,
  },
  loggedBy:       { type: Schema.Types.ObjectId, ref: "User" },
  loggedByName:   { type: String, default: "" },
}, { timestamps: true });

module.exports = {
  CleaningTask:        mongoose.model("CleaningTask",        CleaningTaskSchema),
  SpillageIncident:    mongoose.model("SpillageIncident",    SpillageIncidentSchema),
  ChemicalInventory:   mongoose.model("ChemicalInventory",   ChemicalInventorySchema),
  AreaCleaningLog:     mongoose.model("AreaCleaningLog",     AreaCleaningLogSchema),
  PestControlSchedule: mongoose.model("PestControlSchedule", PestControlSchema),
};
