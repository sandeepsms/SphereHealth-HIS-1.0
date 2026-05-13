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
// TTL safety: nothing here is ever deleted, but if a tenant ever needs
// 7-year retention they can add a TTL via `db.collection.createIndex({...}, { expireAfterSeconds: 7*365*86400 })`
// — we deliberately don't auto-set one because NABH retention rules vary
// per jurisdiction.

module.exports =
  mongoose.models.PatientActivityLog ||
  mongoose.model("PatientActivityLog", PatientActivityLogSchema);

module.exports.ALLOWED_ACTIONS = ALLOWED_ACTIONS;
