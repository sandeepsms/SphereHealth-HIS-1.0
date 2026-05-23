/**
 * housekeepingModels.js — Housekeeping module data layer.
 *
 * 5 sibling schemas covering A+B+C scope:
 *   • CleaningTask        task board (analogous to WardTask but for
 *                          cleaning — routine, terminal, spillage,
 *                          restroom, public-area, bed-turnover,
 *                          isolation-prep)
 *   • SpillageIncident    biohazard cleanup log (NABH HIC.6)
 *   • ChemicalInventory   disinfectant / detergent / sanitiser stock
 *   • AreaCleaningLog     per-area daily compliance checklist
 *   • PestControlSchedule scheduled treatments + audit history
 *
 * Shift attendance + linen/BMW supplies are intentionally REUSED from
 * the wardOpsModels (Ward Boy module already owns those collections —
 * housekeeping reads/writes them via shared /api/ward-ops endpoints).
 *
 * R7bj-F3 (1-CRIT-4 / 1-CRIT-5):
 *   • CleaningTask — added `isolation-prep` to type enum (R20 invariant);
 *     transitions[] ledger; pre-update guard rejecting backward state
 *     moves (cleaned→contained, done→in-progress).
 *   • SpillageIncident — transitions[] + reject backward moves.
 *   • ChemicalInventory — pre-save floor: currentStock < 0 rejected.
 *     Service layer must still use atomic findOneAndUpdate with $gte
 *     predicate (F4's controller fix).
 */
const mongoose = require("mongoose");
const { Schema } = mongoose;

/* ── Shared transition subdoc for CleaningTask + SpillageIncident ─ */
const CleaningTransitionSchema = new Schema({
  from:     { type: String, default: "" },
  to:       { type: String, required: true },
  at:       { type: Date,   default: Date.now },
  byUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  byName:   { type: String, default: "" },
  byRole:   { type: String, default: "" },
  notes:    { type: String, default: "" },
}, { _id: true });

/* ── 1. CLEANING TASK ───────────────────────────────────────── */
const CleaningTaskSchema = new Schema({
  type: {
    type: String,
    // R7bj-F3 / 1-CRIT-4 / R20: added `isolation-prep` for pre-admit
    // isolation cleans (NABH-HIGH-05).
    enum: ["routine", "routine-clean", "terminal", "terminal-clean", "spillage", "restroom", "public-area", "bed-turnover", "discharge-clean", "isolation-prep", "other"],
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
  // R7bj-F3: append-only state-transition history.
  transitions:      { type: [CleaningTransitionSchema], default: [] },
}, { timestamps: true });
CleaningTaskSchema.index({ status: 1, priority: 1, requestedAt: -1 });
CleaningTaskSchema.index({ assignedTo: 1, status: 1 });

// Status rank — used to reject backward moves. `cancelled` can be reached
// from any non-terminal state. `done` is terminal except for Admin override.
const CLEANING_TASK_RANK = { "open": 0, "assigned": 1, "in-progress": 2, "done": 3, "cancelled": 3 };

CleaningTaskSchema.post("init", function () { this._priorStatus = this.status; });

CleaningTaskSchema.pre("save", function (next) {
  try {
    if (this.isNew) {
      this.transitions = this.transitions || [];
      if (!this.transitions.length) {
        this.transitions.push({ from: "", to: this.status, at: new Date(), byName: this.requestedByName, byRole: this.requestedByRole, notes: "created" });
      }
    } else if (this.isModified("status")) {
      const prev = this._priorStatus ?? "";
      this.transitions = this.transitions || [];
      this.transitions.push({ from: prev, to: this.status, at: new Date() });
      this._priorStatus = this.status;
    }
    next();
  } catch (e) { next(e); }
});

CleaningTaskSchema.pre("findOneAndUpdate", async function (next) {
  try {
    const upd  = this.getUpdate() || {};
    const opts = this.getOptions() || {};
    const $set = upd.$set || {};
    const nextStatus = $set.status ?? upd.status;
    if (!nextStatus) return next();

    const current = await this.model.findOne(this.getQuery()).lean();
    if (!current) return next();
    const fromStatus = current.status;
    if (fromStatus === nextStatus) return next();

    const adminOverride = opts.adminOverride === true;
    const overrideReason = typeof opts.overrideReason === "string" && opts.overrideReason.trim().length > 0;

    // Reject backward moves (done → in-progress, in-progress → assigned, etc.)
    // `cancelled` is a final state — once cancelled, you can't un-cancel.
    if (fromStatus === "cancelled" || fromStatus === "done") {
      if (!(adminOverride && overrideReason)) {
        const err = new Error(`CleaningTask: terminal status "${fromStatus}" cannot transition without Admin override + reason`);
        err.statusCode = 409;
        err.code = "CLEANING_TASK_TERMINAL";
        return next(err);
      }
    }
    const fromRank = CLEANING_TASK_RANK[fromStatus] ?? 0;
    const toRank   = CLEANING_TASK_RANK[nextStatus] ?? 0;
    // Going backward in rank is rejected (cancelled is allowed as escape hatch).
    if (toRank < fromRank && nextStatus !== "cancelled" && !(adminOverride && overrideReason)) {
      const err = new Error(`CleaningTask: backward transition "${fromStatus}" → "${nextStatus}" rejected (rank ${fromRank}→${toRank})`);
      err.statusCode = 409;
      err.code = "CLEANING_TASK_BACKWARD";
      return next(err);
    }

    // Append transition row via $push.
    const meta = opts.transitionMeta || {};
    upd.$push = upd.$push || {};
    if (!upd.$push.transitions) {
      upd.$push.transitions = {
        from: fromStatus, to: nextStatus, at: new Date(),
        byUserId: meta.byUserId || null,
        byName:   meta.byName   || "",
        byRole:   meta.byRole   || "",
        notes:    meta.notes    || "",
      };
    }
    this.setUpdate(upd);
    next();
  } catch (e) { next(e); }
});

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
  // R7bj-F3: append-only transition history.
  transitions:      { type: [CleaningTransitionSchema], default: [] },
}, { timestamps: true });

// Status rank for spillage — strictly forward.
const SPILLAGE_RANK = { "reported": 0, "contained": 1, "cleaned": 2 };

SpillageIncidentSchema.post("init", function () { this._priorStatus = this.status; });

SpillageIncidentSchema.pre("save", function (next) {
  try {
    if (this.isNew) {
      this.transitions = this.transitions || [];
      if (!this.transitions.length) {
        this.transitions.push({ from: "", to: this.status, at: new Date(), byName: this.reportedByName, byRole: this.reportedByRole, notes: "reported" });
      }
    } else if (this.isModified("status")) {
      const prev = this._priorStatus ?? "";
      // Reject backward inside instance save.
      const fromRank = SPILLAGE_RANK[prev] ?? 0;
      const toRank   = SPILLAGE_RANK[this.status] ?? 0;
      if (toRank < fromRank) {
        const err = new Error(`SpillageIncident: backward transition "${prev}" → "${this.status}" rejected`);
        err.statusCode = 409;
        err.code = "SPILLAGE_BACKWARD";
        return next(err);
      }
      this.transitions = this.transitions || [];
      this.transitions.push({ from: prev, to: this.status, at: new Date() });
      this._priorStatus = this.status;
    }
    next();
  } catch (e) { next(e); }
});

SpillageIncidentSchema.pre("findOneAndUpdate", async function (next) {
  try {
    const upd  = this.getUpdate() || {};
    const opts = this.getOptions() || {};
    const $set = upd.$set || {};
    const nextStatus = $set.status ?? upd.status;
    if (!nextStatus) return next();

    const current = await this.model.findOne(this.getQuery()).lean();
    if (!current) return next();
    const fromStatus = current.status;
    if (fromStatus === nextStatus) return next();

    const fromRank = SPILLAGE_RANK[fromStatus] ?? 0;
    const toRank   = SPILLAGE_RANK[nextStatus] ?? 0;
    const adminOverride = opts.adminOverride === true;
    const overrideReason = typeof opts.overrideReason === "string" && opts.overrideReason.trim().length > 0;
    if (toRank < fromRank && !(adminOverride && overrideReason)) {
      const err = new Error(`SpillageIncident: backward transition "${fromStatus}" → "${nextStatus}" rejected (rank ${fromRank}→${toRank})`);
      err.statusCode = 409;
      err.code = "SPILLAGE_BACKWARD";
      return next(err);
    }

    const meta = opts.transitionMeta || {};
    upd.$push = upd.$push || {};
    if (!upd.$push.transitions) {
      upd.$push.transitions = {
        from: fromStatus, to: nextStatus, at: new Date(),
        byUserId: meta.byUserId || null,
        byName:   meta.byName   || "",
        byRole:   meta.byRole   || "",
        notes:    meta.notes    || "",
      };
    }
    this.setUpdate(upd);
    next();
  } catch (e) { next(e); }
});

/* ── 3. CHEMICAL INVENTORY ─────────────────────────────────── */
const ChemicalInventorySchema = new Schema({
  productName:   { type: String, required: true, trim: true },
  category: {
    type: String,
    enum: ["disinfectant", "detergent", "floor-cleaner", "sanitiser", "bleach", "deodoriser", "other"],
    default: "disinfectant",
  },
  unit:          { type: String, default: "L" },         // L / kg / piece
  currentStock:  { type: Number, default: 0, min: 0 },
  reorderLevel:  { type: Number, default: 10 },
  lastReceivedAt:{ type: Date, default: null },
  lastReceivedQty: { type: Number, default: 0 },
  vendor:        { type: String, default: "" },
  notes:         { type: String, default: "" },
  isActive:      { type: Boolean, default: true },
}, { timestamps: true });
ChemicalInventorySchema.index({ productName: 1, isActive: 1 });

// R7bj-F3 / 1-CRIT-5: hard floor on stock. Defensive guard — service
// layer should still use atomic findOneAndUpdate({_id, currentStock:{$gte:qty}}).
ChemicalInventorySchema.pre("save", function (next) {
  if (this.currentStock < 0) {
    const err = new Error(`ChemicalInventory.${this.productName || "?"}: currentStock cannot be negative (${this.currentStock})`);
    err.statusCode = 409;
    err.code = "CHEMICAL_NEGATIVE_STOCK";
    return next(err);
  }
  next();
});

// Mirror the floor for updateOne / findOneAndUpdate paths that
// use $set directly. ($inc with a negative number bypasses pre-save —
// but the service-layer atomic $gte predicate is the real defence.)
ChemicalInventorySchema.pre("findOneAndUpdate", function (next) {
  const upd = this.getUpdate() || {};
  const $set = upd.$set || {};
  if (typeof $set.currentStock === "number" && $set.currentStock < 0) {
    const err = new Error("ChemicalInventory: currentStock cannot be set negative");
    err.statusCode = 409;
    err.code = "CHEMICAL_NEGATIVE_STOCK";
    return next(err);
  }
  next();
});

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
