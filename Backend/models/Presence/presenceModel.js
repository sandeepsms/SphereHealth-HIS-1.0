/**
 * Presence — lightweight "who's online and what they're doing" record.
 *
 * One document per active user. A heartbeat updates `lastHeartbeatAt` +
 * `currentResource`. Stale documents (no heartbeat in 5 min) are filtered
 * out by the controller — TTL index also removes them server-side after
 * 10 min so the collection stays small.
 *
 * Used by the Reception Dashboard to show "Receptionist 1 is currently
 * registering Mr. Sharma · 30s ago" — so the 2nd receptionist doesn't
 * pick up the same patient.
 */
const mongoose = require("mongoose");

const PresenceSchema = new mongoose.Schema(
  {
    userId:   { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    userName: { type: String, default: "User" },
    userRole: { type: String, default: "Unknown" },

    currentResource: {
      type:  { type: String,  default: "idle" }, // 'patient' | 'admission' | 'opdVisit' | 'idle'
      id:    { type: String,  default: null },
      label: { type: String,  default: "" },     // human-readable: "Mr. Sharma"
    },
    action: { type: String, default: "idle" },    // 'registering' | 'editing' | 'viewing' | 'idle'

    lastHeartbeatAt: { type: Date, default: Date.now, expires: 600 }, // TTL: 10 min
  },
  { timestamps: true }
);

PresenceSchema.index({ lastHeartbeatAt: -1 });

module.exports =
  mongoose.models.Presence || mongoose.model("Presence", PresenceSchema);
