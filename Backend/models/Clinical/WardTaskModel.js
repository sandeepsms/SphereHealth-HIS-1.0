/**
 * WardTaskModel.js — task board between clinical staff (Nurse / Doctor /
 * Receptionist) and Ward Boys / Housekeeping.
 *
 * Workflow:
 *   1. Any clinical user requests a task — POST creates with status="open"
 *      and assignedTo=null.
 *   2. A Ward Boy claims it — PATCH /:id/accept → status="assigned",
 *      assignedTo=req.user.id, acceptedAt=now.
 *   3. Ward Boy starts the task — PATCH /:id/start → status="in-progress",
 *      startedAt=now.
 *   4. Ward Boy completes — PATCH /:id/complete → status="done",
 *      completedAt=now, optional completion notes.
 *   5. Cancellation — PATCH /:id/cancel (requester / Admin) → status="cancelled".
 *
 * Audit:
 *   • requestedBy / acceptedBy / completedBy ObjectIds + names snapshotted
 *     so the row is readable even if the user is later deactivated.
 *   • Time-stamps at each transition for response-time / SLA reporting.
 *   • R7bj-F3 / 1-CRIT-1: transitions[] ledger appended on every
 *     status change (save() or findOneAndUpdate()). Append-only.
 */
const mongoose = require("mongoose");

const TaskTransitionSchema = new mongoose.Schema({
  from:     { type: String, default: "" },
  to:       { type: String, required: true },
  at:       { type: Date,   default: Date.now },
  byUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  byName:   { type: String, default: "" },
  byRole:   { type: String, default: "" },
  reason:   { type: String, default: "" },
}, { _id: true });

const WardTaskSchema = new mongoose.Schema({
  // What kind of task
  type: {
    type: String,
    enum: ["transport", "equipment", "sample", "errand", "linen", "bmw", "other"],
    required: true,
    index: true,
  },
  // Free-text title — short imperative ("Wheelchair to OT-3", "Bring suction
  // machine to bed 14", "Lab sample drop — Pathology")
  title:        { type: String, required: true, trim: true },
  description:  { type: String, default: "", trim: true },

  // Patient context (optional — equipment fetches without a specific patient)
  UHID:         { type: String, default: "", index: true },
  patientName:  { type: String, default: "" },
  admissionId:  { type: mongoose.Schema.Types.ObjectId, ref: "Admission" },

  // Where it starts → where it ends. Free-text so callers can put
  // ward names, bed numbers, "central store", "blood bank", etc.
  fromLocation: { type: String, default: "" },
  toLocation:   { type: String, default: "" },

  // Priority — "urgent" jumps to top of the Available queue.
  priority: {
    type: String,
    enum: ["urgent", "high", "normal", "low"],
    default: "normal",
    index: true,
  },

  // Lifecycle
  status: {
    type: String,
    enum: ["open", "assigned", "in-progress", "done", "cancelled"],
    default: "open",
    index: true,
  },

  // Who asked, who's doing it
  requestedBy:     { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  requestedByName: { type: String, default: "" },
  requestedByRole: { type: String, default: "" },
  requestedAt:     { type: Date, default: Date.now },

  assignedTo:      { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  assignedToName:  { type: String, default: "" },
  acceptedAt:      { type: Date, default: null },
  startedAt:       { type: Date, default: null },
  completedAt:     { type: Date, default: null },
  cancelledAt:     { type: Date, default: null },

  // Notes added at completion — useful for "couldn't find suction, replaced
  // with manual one" kind of context.
  completionNotes: { type: String, default: "" },
  cancelReason:    { type: String, default: "" },

  // R7bj-F3: status-transition ledger; appended automatically.
  transitions:     { type: [TaskTransitionSchema], default: [] },
}, { timestamps: true });

// Compound indexes for the most-frequent queries.
WardTaskSchema.index({ status: 1, priority: 1, requestedAt: -1 });
WardTaskSchema.index({ assignedTo: 1, status: 1, requestedAt: -1 });

/* ── R7bj-F3: TRANSITION LEDGER ───────────────────────────────
 * pre("save") catches status changes on instance saves (controllers
 * that do `doc.status = X; doc.save()`). Initial creation gets a
 * single transition row ("" → initialStatus).
 * pre("findOneAndUpdate") captures controllers that use atomic
 * findOneAndUpdate({_id, status}, {$set:{status:X}}) — the
 * transition is appended via $push in the same update operator.
 */
WardTaskSchema.pre("save", function (next) {
  try {
    if (this.isNew) {
      // First-write transition row.
      this.transitions = this.transitions || [];
      if (!this.transitions.length) {
        this.transitions.push({
          from: "",
          to: this.status,
          at: new Date(),
          byUserId: this.requestedBy || null,
          byName: this.requestedByName || "",
          byRole: this.requestedByRole || "",
          reason: "created",
        });
      }
    } else if (this.isModified("status")) {
      const prev = this.$__.priorDoc?.status ?? this._priorStatus ?? "";
      this.transitions = this.transitions || [];
      this.transitions.push({
        from: prev,
        to: this.status,
        at: new Date(),
        byUserId: this._lastModifiedById || null,
        byName: this._lastModifiedByName || "",
        byRole: this._lastModifiedByRole || "",
        reason: this._lastModifiedReason || "",
      });
    }
    next();
  } catch (e) { next(e); }
});

// Snapshot priorStatus on init/post-find so save() can build the transition.
WardTaskSchema.post("init", function () {
  this._priorStatus = this.status;
});

WardTaskSchema.pre("findOneAndUpdate", async function (next) {
  try {
    const upd = this.getUpdate() || {};
    const $set = upd.$set || {};
    const nextStatus = $set.status ?? upd.status;
    if (!nextStatus) return next();

    // Read current to capture `from`.
    const current = await this.model.findOne(this.getQuery()).lean();
    const fromStatus = current?.status ?? "";
    if (fromStatus === nextStatus) return next(); // no actual change

    const opts = this.getOptions() || {};
    const meta = opts.transitionMeta || {};
    const transition = {
      from: fromStatus,
      to:   nextStatus,
      at:   new Date(),
      byUserId: meta.byUserId || null,
      byName:   meta.byName   || "",
      byRole:   meta.byRole   || "",
      reason:   meta.reason   || "",
    };
    upd.$push = upd.$push || {};
    if (upd.$push.transitions) {
      // If caller already pushed a transition, leave theirs; else add ours.
      // (No-op — they own the record.)
    } else {
      upd.$push.transitions = transition;
    }
    this.setUpdate(upd);
    next();
  } catch (e) { next(e); }
});

module.exports = mongoose.model("WardTask", WardTaskSchema);
