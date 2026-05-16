// services/Clinical/activityLogger.js
// ═══════════════════════════════════════════════════════════════
// Activity-logging facade for the patient-file audit feed.
//
// Two surfaces:
//   1. log()         — call from anywhere with structured fields.
//   2. middleware()  — Express middleware that auto-captures
//                       POST/PUT/PATCH/DELETE on patient-scoped routes.
//
// Writes go async — failures never block the request that triggered
// them. Every error is console.warn'd; the patient action still
// succeeds even if audit fails. (We never want audit to be the
// reason a doctor can't save a note.)
// ═══════════════════════════════════════════════════════════════

const crypto = require("crypto");
const PatientActivityLog = require("../../models/Clinical/PatientActivityLogModel");
const { redact } = require("../../utils/phiRedactor");

// ── Truncate large payloads so audit collection stays cheap ─────
const MAX_SNAPSHOT_BYTES = 4096; // 4 KB per before/after slot
function compact(value) {
  if (value == null) return null;
  try {
    let s = typeof value === "string" ? value : JSON.stringify(value);
    if (s.length > MAX_SNAPSHOT_BYTES) {
      s = s.slice(0, MAX_SNAPSHOT_BYTES - 24) + "…[truncated]";
    }
    return typeof value === "string" ? s : JSON.parse(s);
  } catch {
    return typeof value === "string" ? String(value).slice(0, MAX_SNAPSHOT_BYTES) : null;
  }
}

// ── Pull UHID + admission identifiers out of a request body/query/params
function resolvePatientKeys(req) {
  const src = { ...(req.params || {}), ...(req.query || {}), ...(req.body || {}) };
  const UHID =
    src.UHID || src.uhid || src.patientUHID || src.PatientUHID || null;
  const admissionId = src.admissionId || src.AdmissionId || null;
  const ipdNo = src.ipdNo || src.IPDNo || src.admissionNumber || "";
  return {
    UHID: UHID ? String(UHID).toUpperCase() : null,
    admissionId: admissionId || null,
    ipdNo: ipdNo || "",
  };
}

// ── Decide which module the request belongs to from req.path ────
function inferModule(req) {
  // Strip /api prefix if present
  const p = (req.baseUrl || "") + (req.path || "");
  // /nurse-notes/... → "NurseNote"; /doctor-notes/... → "DoctorNote"
  const map = [
    ["nurse-notes", "NurseNote"],
    ["nursing-notes", "NurseNote"],
    ["doctor-notes", "DoctorNote"],
    ["doctor-orders", "DoctorOrder"],
    ["mar", "MAR"],
    ["vitalsheet", "VitalSheet"],
    ["consent-forms", "ConsentForm"],
    ["discharge-summary", "DischargeSummary"],
    ["nursing-care-plans", "NursingCarePlan"],
    ["nursing-assessments", "NursingAssessment"],
    ["bed-transfers", "BedTransfer"],
    ["admissions", "Admission"],
    ["mlc", "MLC"],
    ["investigation-orders", "InvestigationOrder"],
    ["investigations", "Investigation"],
    ["billing", "Billing"],
    ["visitor-passes", "VisitorPass"],
    ["appointments", "Appointment"],
    ["opd", "OPD"],
    ["emergency", "Emergency"],
  ];
  for (const [needle, label] of map) {
    if (p.includes(needle)) return label;
  }
  return "Other";
}

function inferAction(req) {
  const m = (req.method || "").toUpperCase();
  if (m === "POST")   return "create";
  if (m === "PUT")    return "update";
  if (m === "PATCH")  return "update";
  if (m === "DELETE") return "delete";
  return "other";
}

// ── Public: structured log call ─────────────────────────────────
// FIX (roadmap D13): two upgrades to the audit row:
//  1. before/after snapshots run through PHI redactor first — Aadhaar /
//     PAN / phone numbers in free-text are replaced with hash-tagged
//     placeholders so the audit collection stops being a leak risk.
//  2. Each row records prevHash (SHA-256 of the previous row for this
//     UHID) + rowHash (SHA-256 of the canonical payload || prevHash).
//     A downstream verifier can walk the chain forward and detect any
//     row that was tampered with or inserted out of order.
async function log(fields = {}) {
  try {
    if (!fields.UHID || !fields.action || !fields.module) {
      return null; // soft-fail: missing critical key
    }
    const UHID = String(fields.UHID).toUpperCase();
    // Pull the most recent row's hash so we can chain to it.
    let prevHash = "";
    try {
      const last = await PatientActivityLog
        .findOne({ UHID })
        .sort({ createdAt: -1 })
        .select({ rowHash: 1 })
        .lean();
      prevHash = last?.rowHash || "";
    } catch { /* first row — leave prevHash empty */ }

    const doc = {
      UHID,
      patientId:   fields.patientId   || null,
      admissionId: fields.admissionId || null,
      ipdNo:       fields.ipdNo || "",
      action:      fields.action,
      module:      fields.module,
      area:        fields.area || "",
      summary:     fields.summary || "",
      sourceModel: fields.sourceModel || "",
      sourceId:    fields.sourceId    || null,
      before:      redact(compact(fields.before)),
      after:       redact(compact(fields.after)),
      userId:      fields.userId   || null,
      userName:    fields.userName || "",
      userRole:    fields.userRole || "",
      httpMethod:  fields.httpMethod || "",
      httpPath:    fields.httpPath   || "",
      ip:          fields.ip || "",
      userAgent:   fields.userAgent || "",
      tags:        Array.isArray(fields.tags) ? fields.tags : [],
      isFlagged:   !!fields.isFlagged,
      prevHash,
    };

    // Canonicalise + hash. JSON.stringify with sorted keys keeps the
    // output deterministic so re-running the chain on a backup yields
    // the same hashes.
    const canonical = JSON.stringify(doc, Object.keys(doc).sort());
    doc.rowHash = crypto
      .createHash("sha256")
      .update(canonical + "|" + prevHash)
      .digest("hex");

    const row = await PatientActivityLog.create(doc);
    // FIX (roadmap E20): broadcast on the SSE bus so any patient-file
    // tab currently subscribed to /api/live-updates/:uhid sees the new
    // event in real time. Soft-fail — the bus may not be loaded yet.
    try {
      const { bus } = require("../../routes/Clinical/liveUpdatesRoutes");
      bus.emit("activity", row.toObject ? row.toObject() : row);
    } catch { /* SSE optional */ }
    return row;
  } catch (e) {
    console.warn("[activityLogger] log failed:", e.message);
    return null;
  }
}

// ── Public: Express middleware (auto-capture mutating requests) ─
// Mount globally AFTER `authenticate` so req.user is available.
// We capture on `res.on("finish")` so only successful 2xx responses
// get logged — failed validations never pollute the audit feed.
function middleware() {
  return function activityLoggerMiddleware(req, res, next) {
    const method = (req.method || "").toUpperCase();
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(method)) return next();
    // Capture the snapshot BEFORE the handler runs because some
    // controllers mutate req.body.
    const snapshot = {
      keys: resolvePatientKeys(req),
      module: inferModule(req),
      action: inferAction(req),
      body: compact(req.body),
      httpMethod: method,
      httpPath: (req.baseUrl || "") + (req.path || ""),
      ip: req.ip || req.headers["x-forwarded-for"] || "",
      userAgent: req.headers["user-agent"] || "",
    };

    res.on("finish", () => {
      // Only log successful mutations; failed ones leave no patient-file footprint.
      if (res.statusCode < 200 || res.statusCode >= 300) return;
      if (!snapshot.keys.UHID) return; // patient unknown → not a per-patient action

      const user = req.user || {};
      log({
        ...snapshot.keys,
        action: snapshot.action,
        module: snapshot.module,
        area: snapshot.httpPath,
        summary: `${snapshot.httpMethod} ${snapshot.httpPath}`,
        after: snapshot.body,
        userId: user._id || user.id || null,
        userName: user.fullName || user.firstName || user.userName || "",
        userRole: user.role || user.userRole || "",
        httpMethod: snapshot.httpMethod,
        httpPath: snapshot.httpPath,
        ip: snapshot.ip,
        userAgent: snapshot.userAgent,
      });
    });

    next();
  };
}

module.exports = { log, middleware };
