// controllers/MRD/mrdController.js
// ════════════════════════════════════════════════════════════════════
// R7bb-FIX-E-12 / D6-HIGH-2: Medical Records Department endpoints.
//
// retentionReview — list patient files past their retainUntil floor.
//   NABH IPSG.6: clinical records 5 yrs, accounts 7 yrs. The audit
//   collection already carries `retainUntil`; MRD's job is to walk
//   anything older than that and recommend release (paper shredded
//   or off-site cold storage migrated).
//
// releaseFile — record that a file has been released (paper shredded,
//   digital archived). Admin-only because it's a permanent custody
//   change that removes the file from the active register.
//
// Pre-R7bb the MRD console only listed discharges; there was no path
// to track retention-due records or sign off on release.
//
// R7bj-F8 / R7bi-3-CRIT-1: envelope normalised via utils/apiEnvelope so
// every response shares the { success, data, meta? } / { success, message,
// code } contract. `total` and `count` moved into `meta`.
// ════════════════════════════════════════════════════════════════════

const mongoose = require("mongoose");
const BillingAudit = require("../../models/Billing/BillingAudit");
const Admission = require("../../models/Patient/admissionModel");
// Lazy import keeps load order tolerant if the helper isn't ready yet.
let _env;
function env() {
  if (!_env) _env = require("../../utils/apiEnvelope");
  return _env;
}

// Lightweight collection for the release-log. One row per release event.
const ReleaseLogSchema = new mongoose.Schema({
  fileType:      { type: String, enum: ["AUDIT_ROW", "ADMISSION", "DISCHARGE_SUMMARY", "OTHER"], default: "OTHER" },
  fileId:        { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  fileRef:       { type: String, trim: true, default: "" },  // human-readable id
  UHID:          { type: String, trim: true, default: "" },
  reason:        { type: String, trim: true, required: true },
  retainUntilAt: { type: Date, default: null },
  // NABH IMS (release of information) + DPDP lawful-disclosure — who asked,
  // why, to whom, and under what authorisation. Previously the log recorded
  // only who RELEASED, not the requestor / purpose / recipient / consent.
  requestedBy:          { type: String, trim: true, default: "" },
  requestorRelationship:{ type: String, trim: true, default: "" }, // Patient / Kin / Insurer / Court / Police / Other
  purpose:              { type: String, trim: true, default: "" },
  releasedToName:       { type: String, trim: true, default: "" },
  releasedToAgency:     { type: String, trim: true, default: "" },
  consentReference:     { type: String, trim: true, default: "" }, // signed authorisation / ConsentForm id
  releasedBy:    { type: String, trim: true, default: "" },
  releasedById:  { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  releasedByRole:{ type: String, trim: true, default: "" },
  releasedAt:    { type: Date, default: Date.now },
}, { timestamps: true });
const MrdReleaseLog = mongoose.models.MrdReleaseLog ||
  mongoose.model("MrdReleaseLog", ReleaseLogSchema);

// GET /api/mrd/retention-due?limit=50&offset=0
// Lists BillingAudit rows where retainUntil < now AND no MrdReleaseLog
// has been filed for them yet. The MRD reviewer signs off; admin
// finalises via releaseFile.
exports.retentionReview = async (req, res) => {
  const { sendOk, sendErr } = env();
  try {
    const limit  = Math.min(500, Math.max(1, parseInt(req.query.limit) || 50));
    const offset = Math.max(0, parseInt(req.query.offset) || 0);
    const now = new Date();
    // Find released ids first so we can exclude.
    const released = await MrdReleaseLog.find({ fileType: "AUDIT_ROW" }).select("fileId").lean();
    const releasedIds = released.map((r) => r.fileId);
    const q = { retainUntil: { $lt: now } };
    if (releasedIds.length) q._id = { $nin: releasedIds };
    const rows = await BillingAudit.find(q)
      .sort({ retainUntil: 1 })
      .skip(offset)
      .limit(limit)
      .select("_id event UHID billNumber retainUntil createdAt actorName")
      .lean();
    const total = await BillingAudit.countDocuments(q);
    return sendOk(res, rows, { count: rows.length, total, limit, offset });
  } catch (e) {
    return sendErr(res, e);
  }
};

// POST /api/mrd/files/:id/release  { reason, fileType? }
// Records a release event. Admin only — the route layer enforces.
exports.releaseFile = async (req, res) => {
  const { sendOk, sendErr } = env();
  try {
    if (req.user?.role !== "Admin" && req.user?.role !== "MRD") {
      // MRD can flag for release but Admin must finalise. We allow both
      // for the MVP; Admin still records as releasedBy.
      return sendErr(res, "Admin or MRD role required", "FORBIDDEN", 403);
    }
    const fileId = req.params.id;
    if (!mongoose.isValidObjectId(fileId)) {
      return sendErr(res, "Invalid file id", "VALIDATION", 400);
    }
    const reason = String(req.body?.reason || "").trim();
    if (!reason) return sendErr(res, "reason is required", "VALIDATION", 400);

    // Confirm the file actually exists in the audit collection (default
    // file type for the MVP).
    let fileType = req.body?.fileType || "AUDIT_ROW";
    let UHID = "", fileRef = "", retainUntilAt = null;
    if (fileType === "AUDIT_ROW") {
      const row = await BillingAudit.findById(fileId).select("UHID billNumber retainUntil").lean();
      if (!row) return sendErr(res, "Audit row not found", "NOT_FOUND", 404);
      UHID = row.UHID || "";
      fileRef = row.billNumber || String(row._id);
      retainUntilAt = row.retainUntil || null;
    } else if (fileType === "ADMISSION") {
      const a = await Admission.findById(fileId).select("UHID admissionNumber actualDischargeDate").lean();
      if (!a) return sendErr(res, "Admission not found", "NOT_FOUND", 404);
      UHID = a.UHID;
      fileRef = a.admissionNumber || String(a._id);
    } else if (fileType === "DISCHARGE_SUMMARY") {
      const DischargeSummary = require("../../models/Clinical/DischargeSummaryModel");
      const d = await DischargeSummary.findById(fileId).select("UHID admissionId patientName").lean();
      if (!d) return sendErr(res, "Discharge summary not found", "NOT_FOUND", 404);
      UHID = d.UHID || "";
      fileRef = String(d._id);
    } else {
      // Never silently release an unknown/unresolved artefact type.
      return sendErr(res, `Unsupported fileType "${fileType}" — expected AUDIT_ROW / ADMISSION / DISCHARGE_SUMMARY`, "VALIDATION", 400);
    }

    const b = req.body || {};
    const entry = await MrdReleaseLog.create({
      fileType,
      fileId,
      fileRef,
      UHID,
      reason,
      retainUntilAt,
      // NABH IMS / DPDP release-of-information capture.
      requestedBy:           String(b.requestedBy || "").trim(),
      requestorRelationship: String(b.requestorRelationship || "").trim(),
      purpose:               String(b.purpose || "").trim(),
      releasedToName:        String(b.releasedToName || "").trim(),
      releasedToAgency:      String(b.releasedToAgency || "").trim(),
      consentReference:      String(b.consentReference || "").trim(),
      releasedBy:     req.user.fullName || req.user.employeeId || "MRD",
      releasedById:   req.user._id || req.user.id || null,
      releasedByRole: req.user.role,
    });
    return sendOk(res, entry, undefined, 201);
  } catch (e) {
    return sendErr(res, e, e.code || "VALIDATION", 400);
  }
};

// POST /api/mrd/legal-hold  { recordType, recordId, hold, reason }
//
// NABH IMS.3 (#138) — set / clear a retention LEGAL HOLD on a clinical
// record so services/MRD/retentionEnforcer.js excludes it from the
// purge-candidate sweep (open litigation / MLC / insurance dispute /
// court order). Pre-fix `legalHold` was declared on Admission /
// DischargeSummary / MLCReport and READ by the enforcer, but no write
// path existed — a record could never actually be put on hold.
//
// recordType ∈ ADMISSION | DISCHARGE_SUMMARY | MLC (the three legalHold-
// aware TARGETS in retentionEnforcer). Both set and clear require a
// documented reason; the actor + timestamp are stamped on the record
// (legalHoldBy / legalHoldByName / legalHoldAt) for the IMS.3 trail.
// Admin / MRD only — route-gated on compliance.legal-hold.write.
exports.setLegalHold = async (req, res) => {
  const { sendOk, sendErr } = env();
  try {
    // Defence-in-depth: the route gate already restricts to Admin / MRD;
    // re-assert here so a mis-wired mount can't widen the custodian set.
    if (req.user?.role !== "Admin" && req.user?.role !== "MRD") {
      return sendErr(res, "Admin or MRD role required", "FORBIDDEN", 403);
    }
    const recordType = String(req.body?.recordType || "").trim().toUpperCase();
    const recordId   = req.body?.recordId;
    const hold       = req.body?.hold === true || req.body?.hold === "true";
    const reason     = String(req.body?.reason || "").trim();

    if (!mongoose.isValidObjectId(recordId)) {
      return sendErr(res, "A valid recordId is required", "VALIDATION", 400);
    }
    // A hold — and a release — must carry a reason for the audit trail,
    // mirroring the release-of-information capture on releaseFile.
    if (!reason) {
      return sendErr(res, "reason is required to set or clear a legal hold", "VALIDATION", 400);
    }

    const TARGETS = {
      ADMISSION:         { model: require("../../models/Patient/admissionModel"),        label: "Admission" },
      DISCHARGE_SUMMARY: { model: require("../../models/Clinical/DischargeSummaryModel"), label: "DischargeSummary" },
      MLC:               { model: require("../../models/MLC/MLCReportModel"),             label: "MLCReport" },
    };
    const target = TARGETS[recordType];
    if (!target) {
      return sendErr(res, `Unsupported recordType "${recordType}" — expected ADMISSION / DISCHARGE_SUMMARY / MLC`, "VALIDATION", 400);
    }

    // legalHold* are whitelisted past the DischargeSummary finalized-
    // immutability guard, so a hold can be applied even to a signed
    // (finalized) summary — a legal-custody flag is a permitted post-
    // finalize write. Admission / MLCReport have no such guard.
    const patch = {
      legalHold:       hold,
      legalHoldReason: reason,
      legalHoldBy:     req.user._id || req.user.id || null,
      legalHoldByName: req.user.fullName || req.user.employeeId || "MRD",
      legalHoldAt:     new Date(),
    };
    const doc = await target.model.findByIdAndUpdate(
      recordId,
      { $set: patch },
      { new: true, runValidators: true },
    ).select("_id UHID legalHold legalHoldReason legalHoldByName legalHoldAt").lean();
    if (!doc) {
      return sendErr(res, `${target.label} not found`, "NOT_FOUND", 404);
    }

    // NABH IMS.3 custody-change audit (7y floor). Non-blocking — the hold
    // write above has already committed.
    try {
      const { emitClinicalAudit } = require("../../services/Compliance/clinicalAuditService");
      emitClinicalAudit({
        req,
        event: "LEGAL_HOLD_UPDATED",
        UHID: doc.UHID || "",
        targetType: target.label,
        targetId: doc._id,
        after: { legalHold: doc.legalHold, legalHoldReason: doc.legalHoldReason, legalHoldByName: doc.legalHoldByName, legalHoldAt: doc.legalHoldAt },
        reason,
      });
    } catch (_) { /* silent */ }

    return sendOk(res, doc, { held: doc.legalHold });
  } catch (e) {
    return sendErr(res, e, e.code || "VALIDATION", 400);
  }
};
