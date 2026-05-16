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
 */
const mongoose = require("mongoose");

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
}, { timestamps: true });

// Compound indexes for the most-frequent queries.
WardTaskSchema.index({ status: 1, priority: 1, requestedAt: -1 });
WardTaskSchema.index({ assignedTo: 1, status: 1, requestedAt: -1 });

module.exports = mongoose.model("WardTask", WardTaskSchema);
