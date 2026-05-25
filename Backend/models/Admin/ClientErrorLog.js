/**
 * ClientErrorLog.js — R7bz
 *
 * Stores client-side render crashes captured by the React ErrorBoundary at
 * /Frontend/src/Components/ErrorBoundary.jsx. The frontend POSTs a small
 * sanitised payload to POST /api/client-errors (see
 * routes/Admin/clientErrorRoutes.js); this collection is the durable sink
 * so admins can group / inspect production crashes on the System Health
 * page.
 *
 * Retention: rows auto-purge after 90 days via a TTL index on
 * `occurredAt`. We never need older data for ops triage, and keeping it
 * indefinitely would slowly fill a collection that nobody is actively
 * pruning.
 *
 * PHI safety: the frontend already truncates message/stack/componentStack
 * to 2000 chars and explicitly excludes localStorage / sessionStorage /
 * cookies / tokens. The route handler runs a second pass through the
 * errorLogger.redactPHI helper before saving — defense in depth.
 *
 * Collection name `client_error_logs` (snake_case) matches the
 * antimicrobial_use_registers / vital_signs convention used elsewhere in
 * this codebase. Without an explicit collection option Mongoose would
 * pluralise the model name to `clienterrorlogs` which is ugly and
 * inconsistent with the rest of the schema set.
 */
"use strict";
const mongoose = require("mongoose");
const { Schema } = mongoose;

const ClientErrorLogSchema = new Schema(
  {
    // Required — the route handler rejects requests where this is missing.
    // 2000 char cap matches the frontend truncation; we also enforce it
    // here so a misbehaving client can't bypass the limit.
    message: { type: String, required: true, maxlength: 2000 },

    // Both stacks are optional — older browsers / minified bundles may
    // omit one or both. Same 2000 char ceiling.
    stack: { type: String, maxlength: 2000, default: "" },
    componentStack: { type: String, maxlength: 2000, default: "" },

    // Which ErrorBoundary caught the crash — useful for grouping (the
    // per-tab boundaries in AccountsConsole pass labels like "Revenue
    // tab"; the app-root mount in main.jsx passes "App root").
    label: { type: String, default: "" },

    // Page context.
    url: { type: String, maxlength: 500, default: "" },
    userAgent: { type: String, maxlength: 500, default: "" },

    // User fingerprint — both nullable so anonymous crashes (login page,
    // expired-session redirect) still get captured. Captured via soft-auth
    // in the route handler, so a missing/invalid token doesn't drop the
    // entire report.
    userId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    userRole: { type: String, default: null },

    // Source IP — set by the route handler from req.ip. Useful for
    // correlating a crash to a specific workstation when multiple users
    // share a role.
    ip: { type: String, default: "" },

    // When the crash actually happened (client clock). Used for the TTL
    // index below and for the System Health "last seen" column.
    occurredAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
    collection: "client_error_logs",
  },
);

// TTL index — Mongo auto-deletes rows older than 90 days. expireAfterSeconds
// is computed in seconds; 60 * 60 * 24 * 90 = 7,776,000.
ClientErrorLogSchema.index(
  { occurredAt: 1 },
  { expireAfterSeconds: 60 * 60 * 24 * 90 },
);

// Compound index for dedup grouping — the /grouped aggregation buckets by
// `message` and sorts by occurredAt desc to surface the most recent
// occurrence. This index makes that query an index-scan instead of a
// collection scan.
ClientErrorLogSchema.index({ message: 1, occurredAt: -1 });

module.exports = mongoose.model("ClientErrorLog", ClientErrorLogSchema);
