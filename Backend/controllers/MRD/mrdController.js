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
    }

    const entry = await MrdReleaseLog.create({
      fileType,
      fileId,
      fileRef,
      UHID,
      reason,
      retainUntilAt,
      releasedBy:     req.user.fullName || req.user.employeeId || "MRD",
      releasedById:   req.user._id || req.user.id || null,
      releasedByRole: req.user.role,
    });
    return sendOk(res, entry, undefined, 201);
  } catch (e) {
    return sendErr(res, e, e.code || "VALIDATION", 400);
  }
};
