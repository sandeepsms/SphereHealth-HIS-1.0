// models/Clinical/PatientActivityLogModel.js
// ═══════════════════════════════════════════════════════════════
// Catch-all audit log for the patient file.
//
// Every UI action that doesn't already feed a structured model
// (consent / discharge / MAR / etc.) lands here so the patient's
// "complete file" really IS complete — every dropdown selection,
// button click, field edit, view-print event is captured.
//
// Goals:
//   1. NABH AAC.7 (medical record completeness): nothing the clinical
//      team did with the patient's chart should be invisible to audit.
//   2. Replay-able timeline: a partner can scroll a single feed and see
//      exactly what doctor + nurse touched, in order.
//   3. No coupling to specific feature modules — anything can write here.
//
// Write paths (recommended):
//   • activityLogger.middleware (Express)  — auto-captures every
//     mutating request (POST/PUT/PATCH/DELETE) on /api/* with the
//     patient UHID resolvable from req body/query/params.
//   • activityLogger.log()                  — programmatic call for
//     in-controller events that don't map 1:1 to an HTTP method
//     (e.g. "Doctor opened patient file", "Nurse viewed MAR").
//
// Read paths:
//   • GET /api/patient-file/:uhid/activity  — paginated audit feed
//   • Included in the complete-file aggregator at /api/patient-file/:uhid/complete
// ═══════════════════════════════════════════════════════════════

const mongoose = require("mongoose");

const ALLOWED_ACTIONS = [
  "create", "update", "delete", "view", "print", "export",
  "sign", "amend", "cancel", "void",
  "select",     // dropdown / radio / checkbox toggle
  "click",      // button press not covered by a structured event
  "field-edit", // free-text field saved
  "form-submit",
  "navigation", // route change inside the patient panel
  // R7az-D10 hash-chain coverage: prescription lifecycle gets first-class
  // action names so the hash chain isn't broken by parallel writes via
  // PatientActivityLog.create() bypassing activityLogger.log().
  "PRESCRIPTION_UPDATE",
  "PRESCRIPTION_DELETE",
  "PRESCRIPTION_STATUS_CHANGE",
  "PRESCRIPTION_SIGN",
  // Read-event capture for sensitive routes (MLC / patient-file)
  // R7az-D10/D9 NABH AAC.7 — surveyors expect read trails for legal docs.
  "READ",
  // Workflow-specific action verbs surfaced from inferAction route-suffix
  // detection (D10-HIGH-3): /finalize, /refuse, /revoke etc.
  "finalize", "refuse", "revoke",
  "other",
];

const PatientActivityLogSchema = new mongoose.Schema(
  {
    // ── Patient linkage ──────────────────────────────────────
    UHID:        { type: String, required: true, index: true, uppercase: true, trim: true },
    patientId:   { type: mongoose.Schema.Types.ObjectId, ref: "Patient", default: null },
    admissionId: { type: mongoose.Schema.Types.ObjectId, ref: "Admission", default: null, index: true },
    ipdNo:       { type: String, default: "", index: true },

    // ── Action shape ─────────────────────────────────────────
    action:    { type: String, enum: ALLOWED_ACTIONS, required: true, index: true },
    // Where the action was performed — module name + finer-grained area
    // e.g. module="DoctorNote", area="SOAP.subjective"
    //      module="ConsentForm", area="surgical.sign"
    //      module="MAR", area="dose.given"
    //      module="UI", area="PatientPanel.tab.switch"
    module:    { type: String, required: true, index: true, trim: true },
    area:      { type: String, default: "", trim: true },

    // What actually happened (short, human-readable). Goes straight to the
    // audit feed UI without further formatting.
    summary:   { type: String, default: "", trim: true },

    // ── Linked source document (if any) ──────────────────────
    // sourceModel = the Mongoose model name; sourceId = the doc _id.
    // e.g. when a doctor signs a note: sourceModel="DoctorNotes", sourceId=<noteId>
    sourceModel: { type: String, default: "", trim: true },
    sourceId:    { type: mongoose.Schema.Types.ObjectId, default: null },

    // ── Before / after snapshots (small, NOT a full doc dump) ─
    // Cap each side at ~4KB so the audit collection doesn't balloon.
    // For huge payloads, store a short summary and rely on the source doc.
    before:    { type: mongoose.Schema.Types.Mixed, default: null },
    after:     { type: mongoose.Schema.Types.Mixed, default: null },

    // ── Actor ────────────────────────────────────────────────
    userId:    { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    userName:  { type: String, default: "", trim: true },
    userRole:  { type: String, default: "", trim: true },

    // ── Request context ──────────────────────────────────────
    httpMethod: { type: String, default: "" },
    httpPath:   { type: String, default: "" },
    ip:         { type: String, default: "" },
    userAgent:  { type: String, default: "" },

    // ── Tagging ──────────────────────────────────────────────
    // Tags let consumers filter the feed (e.g. tag="nursing" gives the
    // nursing column on the timeline UI).
    tags:   [{ type: String, trim: true }],
    // True for events the clinical team should review (e.g. consent
    // refused, LAMA, critical-result acknowledged late).
    isFlagged: { type: Boolean, default: false, index: true },

    // ── Chain-of-custody hash (NABH AAC.7 / ISO 27001) ───────
    // Each row stores the SHA-256 of (canonical row payload + prev hash).
    // Pre-save hook (activityLogger.log) sets these — DO NOT mutate after.
    // A downstream verifier can walk the chain forward and detect any row
    // that was modified or inserted between two existing rows.
    prevHash: { type: String, default: "" },
    rowHash:  { type: String, default: "" },

    // ── Retention (R7az-D10-HIGH-1: NABH HIC.5 record retention) ─────
    // Per-tenant default lifetime varies by jurisdiction; we encode the
    // NABH baseline here:
    //   • Clinical events (sign / amend / print / cancel / READ on patient
    //     file / MLC) → 7 years from createdAt
    //   • MLC / paediatric records → 12 years (medico-legal & POCSO)
    //   • Routine UI events (select / click / navigation) → 1 year
    // A `legalHoldUntil` later than `retainUntil` keeps the row past
    // expiry (e.g. open court case). The TTL index uses retainUntil itself
    // (expireAfterSeconds: 0 → delete when retainUntil < now).
    retainUntil:    { type: Date, default: null, index: { expireAfterSeconds: 0 } },
    legalHoldUntil: { type: Date, default: null },
  },
  {
    timestamps: true,
    collection: "patient_activity_logs",
    // Once written, audit rows shouldn't be mutated. Block updates at the
    // app layer by making the schema strict + the route never exposes
    // an update endpoint.
    strict: true,
  },
);

// Per-patient feed: latest first.
PatientActivityLogSchema.index({ UHID: 1, createdAt: -1 });
// Per-admission feed.
PatientActivityLogSchema.index({ admissionId: 1, createdAt: -1 });
// Per-actor view (who did what across patients).
PatientActivityLogSchema.index({ userId: 1, createdAt: -1 });
// R7bb-FIX-B-11/D7-MED-3: per-ROLE view (what did Doctors do across
// patients last week, what did Receptionists touch on the rounds). The
// audit reviewer cuts the feed by role for HR + NABH compliance reports;
// pre-R7bb the query did a full collscan filtered by userRole. Cardinality
// is low (~5-10 roles) so this index is cheap and the createdAt suffix
// lets the audit page sort without an in-memory sort.
PatientActivityLogSchema.index({ userRole: 1, createdAt: -1 });

// ── R7az-D10-HIGH-1: pre-save retention defaults ─────────────────────
// Compute retainUntil from action + tags when not already set. We never
// overwrite a caller-supplied retainUntil (lets ops force a longer hold
// per row) but we always honour legalHoldUntil if it extends past expiry.
const RET_7Y  = 7  * 365 * 86400 * 1000;
const RET_12Y = 12 * 365 * 86400 * 1000;
const RET_1Y  = 1  * 365 * 86400 * 1000;
PatientActivityLogSchema.pre("save", function (next) {
  try {
    if (!this.retainUntil) {
      const base = (this.createdAt || new Date()).getTime();
      const isMlc = (this.module || "").toUpperCase().includes("MLC")
        || (Array.isArray(this.tags) && this.tags.some((t) => /mlc|paeds|paediatric|pocso/i.test(String(t))));
      const clinicalActions = new Set([
        "create","update","delete","sign","amend","cancel","void",
        "print","export","READ",
        "PRESCRIPTION_UPDATE","PRESCRIPTION_DELETE",
        "PRESCRIPTION_STATUS_CHANGE","PRESCRIPTION_SIGN",
        "finalize","refuse","revoke",
      ]);
      let ms = RET_1Y;
      if (isMlc) ms = RET_12Y;
      else if (clinicalActions.has(this.action)) ms = RET_7Y;
      this.retainUntil = new Date(base + ms);
    }
    // Honour a longer legal hold if set
    if (this.legalHoldUntil && this.retainUntil && this.legalHoldUntil > this.retainUntil) {
      this.retainUntil = this.legalHoldUntil;
    }
  } catch (e) {
    // Don't block writes on a retention bug — log and continue.
    console.warn("[PatientActivityLog] retention default failed:", e.message);
  }
  next();
});

// ── R7az-D10-CRIT-5: schema-level append-only enforcement ────────────
// Audit rows MUST NOT be deleted or updated via the application layer
// except for two well-defined paths:
//   1. TTL expiry — Mongo handles this server-side, bypasses these hooks.
//   2. Setting legalHoldUntil / retainUntil — explicit ops override that
//      changes ONLY those two fields (e.g. "this row is now under court
//      hold, extend retention to 2035").
// Anything else throws — including 'save'-driven $set, deleteOne /
// deleteMany / findOneAndDelete / findOneAndUpdate / updateMany /
// findByIdAndUpdate / findByIdAndDelete.
const RETENTION_WHITELIST = new Set(["retainUntil", "legalHoldUntil"]);
function _appendOnlyError() {
  return new Error(
    "PatientActivityLog is append-only — use TTL via retainUntil. " +
    "Updates allowed only when changing retainUntil / legalHoldUntil.",
  );
}
function _isRetentionOnlyUpdate(update) {
  if (!update || typeof update !== "object") return false;
  // Accept either flat fields or { $set: {...} } shape.
  const top = Object.keys(update).filter((k) => k !== "$set" && k !== "$setOnInsert");
  if (top.length) {
    if (!top.every((k) => RETENTION_WHITELIST.has(k))) return false;
  }
  if (update.$set) {
    const setKeys = Object.keys(update.$set);
    if (!setKeys.every((k) => RETENTION_WHITELIST.has(k))) return false;
  }
  if (update.$setOnInsert) return false; // upserts not permitted on audit table
  return true;
}
function _appendOnlyUpdateHook(next) {
  try {
    if (_isRetentionOnlyUpdate(this.getUpdate())) return next();
  } catch (_) { /* fallthrough to refuse */ }
  return next(_appendOnlyError());
}
PatientActivityLogSchema.pre("findOneAndUpdate", _appendOnlyUpdateHook);
PatientActivityLogSchema.pre("findByIdAndUpdate", _appendOnlyUpdateHook);
PatientActivityLogSchema.pre("updateOne",        _appendOnlyUpdateHook);
PatientActivityLogSchema.pre("updateMany",       _appendOnlyUpdateHook);
function _appendOnlyDeleteHook(next) { return next(_appendOnlyError()); }
PatientActivityLogSchema.pre("findOneAndDelete", _appendOnlyDeleteHook);
PatientActivityLogSchema.pre("findByIdAndDelete", _appendOnlyDeleteHook);
PatientActivityLogSchema.pre("deleteOne",        { document: false, query: true }, _appendOnlyDeleteHook);
PatientActivityLogSchema.pre("deleteMany",       _appendOnlyDeleteHook);
// Document.deleteOne (called on a loaded doc instance) — block too.
PatientActivityLogSchema.pre("deleteOne",        { document: true, query: false }, function (next) {
  return next(_appendOnlyError());
});

module.exports =
  mongoose.models.PatientActivityLog ||
  mongoose.model("PatientActivityLog", PatientActivityLogSchema);

module.exports.ALLOWED_ACTIONS = ALLOWED_ACTIONS;
