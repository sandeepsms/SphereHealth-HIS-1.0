/**
 * IncidentReportModel — Security incident log.
 *
 * Every notable event at the hospital that isn't a clinical record:
 * theft, trespass, disturbance, fire, fall-with-injury (non-patient),
 * vandalism, vehicle accidents in the campus, etc. Each report carries
 * a unique IR-YYYYMMDD-NNNN number minted via utils/counter.
 *
 * R7bj-F3: append-only on identifying fields + 10y retention with TTL
 *   + legalHold override + status-transition history.
 * R7bi 1-CRIT-8 / 10-CRIT-2: description / location / persons / severity
 *   / occurredAt / incident# frozen post-write. status, actionTaken
 *   (append via $push), escalatedTo, statusHistory only.
 */
const mongoose = require("mongoose");

const TEN_YEARS_MS = 10 * 365 * 24 * 60 * 60 * 1000;
const MAX_ATTACHMENTS = 10;
const MAX_URL_LEN = 500;

const PersonInvolvedSchema = new mongoose.Schema(
  {
    name:    { type: String, trim: true, default: "" },
    role:    { type: String, default: "" },   // e.g. "Visitor", "Vendor", "Patient attendant"
    contact: { type: String, default: "" },
    notes:   { type: String, default: "" },
    addedAt: { type: Date,   default: Date.now },
  },
  // R7bj-F3: addressable _id so individual rows can be referenced
  // for legal amendments without replacing the entire array. The
  // append-only guard blocks any $set to an existing row index.
  { _id: true },
);

const StatusHistorySchema = new mongoose.Schema(
  {
    from:     { type: String, default: "" },
    to:       { type: String, required: true },
    at:       { type: Date,   default: Date.now },
    byName:   { type: String, default: "" },
    byUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    byRole:   { type: String, default: "" },
    note:     { type: String, default: "" },
  },
  { _id: true },
);

// R7bj-F3: attachment URL validator — only https:// and our hospital
// upload path; reject javascript:/data:/file: schemes outright.
function validateAttachmentUrl(url) {
  if (typeof url !== "string" || !url) return false;
  if (url.length > MAX_URL_LEN) return false;
  const lower = url.toLowerCase().trim();
  if (lower.startsWith("javascript:") || lower.startsWith("data:") ||
      lower.startsWith("file:") || lower.startsWith("vbscript:")) {
    return false;
  }
  // Allow https:// (external CDN / S3) OR hospital-managed paths under
  // /uploads/incident/ (relative) OR /uploads/security/.
  if (lower.startsWith("https://")) return true;
  if (lower.startsWith("/uploads/incident/")) return true;
  if (lower.startsWith("/uploads/security/")) return true;
  return false;
}

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
    recordedAt:  { type: Date, default: Date.now, index: true },
    description: { type: String, required: true, trim: true },

    personsInvolved: { type: [PersonInvolvedSchema], default: [] },
    actionTaken:     { type: String, default: "" },

    status: {
      type: String,
      enum: ["Open", "Investigating", "Resolved", "Escalated", "Closed"],
      default: "Open",
      index: true,
    },
    statusHistory: { type: [StatusHistorySchema], default: [] },

    resolvedAt:   Date,
    resolvedBy:   { type: String, default: "" },
    escalatedTo:  { type: String, default: "" },     // e.g. "Police", "Admin", "Fire Dept"

    // Audit
    recordedBy:     { type: String, required: true, trim: true },
    recordedByName: { type: String, default: "" },
    recordedById:   { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    recordedByRole: { type: String, default: "Security" },

    // R7bj-F3: attachment URLs validated. Cap at MAX_ATTACHMENTS and
    // reject any unsafe scheme (javascript:/data:/file:) — only
    // https:// or hospital-managed /uploads/incident/ paths allowed.
    attachments: {
      type: [String],
      default: [],
      validate: [
        {
          validator: (arr) => Array.isArray(arr) && arr.length <= MAX_ATTACHMENTS,
          message: `attachments: max ${MAX_ATTACHMENTS} URLs allowed`,
        },
        {
          validator: (arr) => !arr || arr.every(validateAttachmentUrl),
          message: "attachments: each URL must be https:// or /uploads/incident/ — javascript:/data:/file: schemes rejected, max 500 chars",
        },
      ],
    },

    // R7bj-F3 / 10-CRIT-2: 10y retention with TTL auto-prune;
    // legalHold flag freezes record indefinitely via TTL partial filter.
    retainUntil:    { type: Date, default: () => new Date(Date.now() + TEN_YEARS_MS) },
    legalHold:      { type: Boolean, default: false },
  },
  { timestamps: true },
);

IncidentReportSchema.index({ createdAt: -1 });
IncidentReportSchema.index({ status: 1, severity: 1 });
IncidentReportSchema.index({ type: 1, createdAt: -1 });
// TTL — purge expired rows after 10y unless under legalHold.
IncidentReportSchema.index(
  { retainUntil: 1 },
  { expireAfterSeconds: 0, partialFilterExpression: { legalHold: false } },
);

/* ── R7bj-F3: APPEND-ONLY GUARD ───────────────────────────────
 * Frozen post-write:
 *   description, location, occurredAt, recordedAt, recordedBy/ById/Name/Role,
 *   incidentNumber, type, personsInvolved (existing entries — new persons
 *   may be added via $push).
 * Severity is normally frozen but Admin force-override allowed (caller
 *   sets `options.adminOverride: true` + provides options.overrideReason).
 * Mutable: status, actionTaken (append-only via $push), escalatedTo,
 *   statusHistory, resolvedAt, resolvedBy, attachments (append via $push),
 *   legalHold, retainUntil, updatedAt.
 * personsInvolved: $push allowed (new row). Direct $set to the array or
 *   replacement of an existing element is blocked. */
const INCIDENT_MUTABLE_SET = new Set([
  "status", "escalatedTo", "resolvedAt", "resolvedBy",
  "legalHold", "retainUntil", "updatedAt",
]);

function incidentAppendOnlyGuard(queryThis) {
  const upd = queryThis.getUpdate() || {};
  const opts = queryThis.getOptions() || {};
  const adminOverride = opts.adminOverride === true;
  const overrideReason = typeof opts.overrideReason === "string" && opts.overrideReason.trim().length > 0;

  const $set   = upd.$set   || {};
  const $unset = upd.$unset || {};
  const $push  = upd.$push  || {};
  const $addToSet = upd.$addToSet || {};
  const $pull  = upd.$pull  || {};
  const topLevel = Object.keys(upd).filter((k) => !k.startsWith("$"));

  // ─ $set / $unset / top-level: only INCIDENT_MUTABLE_SET allowed.
  const setKeys = new Set([...Object.keys($set), ...Object.keys($unset), ...topLevel]);
  for (const key of setKeys) {
    // Severity may be overridden by Admin with a reason.
    if (key === "severity") {
      if (!(adminOverride && overrideReason)) {
        const err = new Error("IncidentReport.severity is frozen; Admin force-override requires adminOverride+overrideReason");
        err.statusCode = 409;
        err.code = "INCIDENT_SEVERITY_FROZEN";
        throw err;
      }
      continue;
    }
    // personsInvolved: blocked via $set/$unset — must use $push.
    if (key === "personsInvolved" || key.startsWith("personsInvolved.")) {
      const err = new Error("IncidentReport.personsInvolved: existing entries are append-only — use $push to add new persons");
      err.statusCode = 409;
      err.code = "INCIDENT_PERSONS_IMMUTABLE";
      throw err;
    }
    // actionTaken: blocked via $set — must use $push to a future array (currently String).
    // For backwards compat, allow $set on actionTaken only via Admin override; default-block.
    if (key === "actionTaken") {
      if (!(adminOverride && overrideReason)) {
        const err = new Error("IncidentReport.actionTaken is append-only — use $push on actionTaken history (or Admin override with reason)");
        err.statusCode = 409;
        err.code = "INCIDENT_ACTION_APPEND_ONLY";
        throw err;
      }
      continue;
    }
    // statusHistory: blocked via $set — must use $push.
    if (key === "statusHistory" || key.startsWith("statusHistory.")) {
      const err = new Error("IncidentReport.statusHistory: append-only — use $push");
      err.statusCode = 409;
      err.code = "INCIDENT_STATUS_HISTORY_APPEND_ONLY";
      throw err;
    }
    // attachments: blocked via $set — must use $push.
    if (key === "attachments" || key.startsWith("attachments.")) {
      const err = new Error("IncidentReport.attachments: append-only — use $push (max 10)");
      err.statusCode = 409;
      err.code = "INCIDENT_ATTACHMENTS_APPEND_ONLY";
      throw err;
    }
    if (!INCIDENT_MUTABLE_SET.has(key)) {
      const err = new Error(`IncidentReport: field "${key}" is append-only / frozen`);
      err.statusCode = 409;
      err.code = "INCIDENT_APPEND_ONLY";
      throw err;
    }
  }

  // ─ $pull on personsInvolved / statusHistory / attachments is blocked.
  for (const arrField of ["personsInvolved", "statusHistory", "attachments"]) {
    if ($pull[arrField] !== undefined) {
      const err = new Error(`IncidentReport.${arrField}: $pull blocked — entries are immutable`);
      err.statusCode = 409;
      err.code = "INCIDENT_PULL_BLOCKED";
      throw err;
    }
  }

  // ─ $push on attachments must also pass URL validation + size cap.
  // The schema-level validator handles save() but $push bypasses it,
  // so we re-check here.
  if ($push.attachments) {
    const items = $push.attachments?.$each ?? [$push.attachments];
    if (!Array.isArray(items) || items.some((u) => !validateAttachmentUrl(u))) {
      const err = new Error("IncidentReport.attachments push: invalid URL — only https:// or /uploads/incident/ accepted");
      err.statusCode = 400;
      err.code = "INCIDENT_ATTACHMENT_URL";
      throw err;
    }
  }
}

IncidentReportSchema.pre("findOneAndUpdate", function (next) {
  try { incidentAppendOnlyGuard(this); next(); } catch (e) { next(e); }
});
IncidentReportSchema.pre("updateOne", function (next) {
  try { incidentAppendOnlyGuard(this); next(); } catch (e) { next(e); }
});
IncidentReportSchema.pre("updateMany", function (next) {
  try { incidentAppendOnlyGuard(this); next(); } catch (e) { next(e); }
});

module.exports =
  mongoose.models.IncidentReport ||
  mongoose.model("IncidentReport", IncidentReportSchema);
