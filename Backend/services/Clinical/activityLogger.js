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

const mongoose = require("mongoose");
const crypto = require("crypto");
const PatientActivityLog = require("../../models/Clinical/PatientActivityLogModel");
const { redact } = require("../../utils/phiRedactor");

// ── Truncate large payloads so audit collection stays cheap ─────
const MAX_SNAPSHOT_BYTES = 4096; // 4 KB per before/after slot

// R7az-D10-CRIT-4: hash, don't truncate, signature payloads. A truncated
// 4KB slice of a base64 PNG looks meaningless but still leaks N pixels
// of clinician signature. Replace with sha256 + length so the audit
// row preserves identity uniqueness without storing PHI.
const SIGNATURE_KEY_RE = /^(signature(Url)?|signedSignature|esignature|digitalSignature)$/i;
const BASE64_PNG_RE    = /^data:image\/(?:png|jpe?g|webp);base64,/i;
function looksLikeSignature(key, value) {
  if (key && SIGNATURE_KEY_RE.test(key)) return true;
  if (typeof value === "string" && BASE64_PNG_RE.test(value)) return true;
  return false;
}
function hashSignature(value) {
  if (typeof value !== "string") return "[signature:non-string]";
  const sha = crypto.createHash("sha256").update(value).digest("hex");
  return `[signature:sha256=${sha.slice(0, 16)} len=${value.length}]`;
}
function _redactSignaturesDeep(obj, depth = 0) {
  if (obj == null) return obj;
  if (depth > 6) return obj;
  if (typeof obj === "string") return obj; // string-at-root handled by caller
  if (Array.isArray(obj)) return obj.map((v) => _redactSignaturesDeep(v, depth + 1));
  if (typeof obj !== "object") return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (looksLikeSignature(k, v)) {
      out[k] = hashSignature(typeof v === "string" ? v : JSON.stringify(v));
    } else if (typeof v === "string" && BASE64_PNG_RE.test(v)) {
      out[k] = hashSignature(v);
    } else {
      out[k] = _redactSignaturesDeep(v, depth + 1);
    }
  }
  return out;
}

function compact(value) {
  if (value == null) return null;
  try {
    // First pass: replace any signature-shaped fields with their hash.
    if (typeof value === "object") value = _redactSignaturesDeep(value);
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

// R7az-D10-HIGH-3: route-suffix → verb mapping so the audit feed shows
// "sign / finalize / refuse / revoke / amend / cancel" instead of a
// generic "update" for every workflow PATCH.
function inferAction(req) {
  const m = (req.method || "").toUpperCase();
  const p = ((req.baseUrl || "") + (req.path || "")).toLowerCase();
  const suffix = [
    ["/sign",        "sign"],
    ["/finalize",    "finalize"],
    ["/refuse",      "refuse"],
    ["/revoke",      "revoke"],
    ["/discontinue", "cancel"],
    ["/amend",       "amend"],
    ["/print",       "print"],
  ];
  for (const [needle, label] of suffix) {
    if (p.endsWith(needle) || p.includes(needle + "/") || p.includes(needle + "?")) return label;
  }
  if (m === "POST")   return "create";
  if (m === "PUT")    return "update";
  if (m === "PATCH")  return "update";
  if (m === "DELETE") return "delete";
  if (m === "GET")    return "view";
  return "other";
}

// R7az-D10-CRIT-2/3: route → Mongoose model name map. When the request
// doesn't carry UHID anywhere (params/query/body) but does carry an :id
// of a known resource, we can reverse-resolve UHID from the document.
// Also lets us load the pre-mutation snapshot for `before`.
const ROUTE_MODEL_MAP = [
  { needle: "/doctor-notes/",      modelName: "DoctorNotes",       uhidField: "patientUHID" },
  { needle: "/nurse-notes/",       modelName: "NurseNotes",        uhidField: "patientUHID" },
  { needle: "/nursing-notes/",     modelName: "NurseNotes",        uhidField: "patientUHID" },
  { needle: "/mar/",               modelName: "MAR",               uhidField: "UHID" },
  { needle: "/discharge-summary/", modelName: "DischargeSummary",  uhidField: "UHID" },
  { needle: "/consent-forms/",     modelName: "ConsentForm",       uhidField: "UHID" },
  { needle: "/nursing-care-plans/",modelName: "NursingCarePlan",   uhidField: "UHID" },
  { needle: "/nursing-assessments/", modelName: "NursingAssessment", uhidField: "UHID" },
  { needle: "/diabetic-chart/",    modelName: "DiabeticChart",     uhidField: "UHID" },
  { needle: "/bed-transfers/",     modelName: "BedTransfer",       uhidField: "UHID" },
];

function _matchRouteModel(req) {
  const p = ((req.baseUrl || "") + (req.path || "")).toLowerCase();
  return ROUTE_MODEL_MAP.find((m) => p.includes(m.needle));
}

async function _resolveUhidAndSnapshot(req) {
  // Returns { UHID, before } — best-effort, never throws.
  const out = { UHID: null, before: null, sourceModel: "", sourceId: null };
  try {
    const map = _matchRouteModel(req);
    if (!map) return out;
    out.sourceModel = map.modelName;
    // Try to pick the :id param — common patterns: req.params.id, req.params.noteId, req.params.formId
    const id = req.params?.id || req.params?.noteId || req.params?.formId || req.params?.marId || null;
    if (!id || !mongoose.isValidObjectId(String(id))) return out;
    out.sourceId = id;
    const Model = mongoose.models[map.modelName];
    if (!Model) return out;
    const doc = await Model.findById(id).lean().catch(() => null);
    if (!doc) return out;
    out.UHID = doc[map.uhidField] || doc.UHID || null;
    out.before = doc;
  } catch (e) {
    console.warn("[activityLogger] reverse-resolve failed:", e.message);
  }
  return out;
}

// R7az-D10-HIGH-4 / D9-MED-1: sensitive READ capture. We do NOT log
// every GET (cost + noise); just specific clinical-legal prefixes
// where NABH AAC.7 / MLC tracking requires a read trail.
const READ_CAPTURE_PREFIXES = ["/mlc/", "/patient-file/"];
function _isSensitiveRead(req) {
  if ((req.method || "").toUpperCase() !== "GET") return false;
  const p = ((req.baseUrl || "") + (req.path || "")).toLowerCase();
  return READ_CAPTURE_PREFIXES.some((prefix) => p.includes(prefix));
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
  return async function activityLoggerMiddleware(req, res, next) {
    const method = (req.method || "").toUpperCase();
    const isMutating = ["POST", "PUT", "PATCH", "DELETE"].includes(method);
    const isSensitiveRead = _isSensitiveRead(req);
    if (!isMutating && !isSensitiveRead) return next();

    // Capture the snapshot BEFORE the handler runs because some
    // controllers mutate req.body.
    const keys = resolvePatientKeys(req);
    const moduleName = inferModule(req);
    const action = isSensitiveRead ? "READ" : inferAction(req);
    const snapshot = {
      keys,
      module: moduleName,
      action,
      body: compact(req.body),
      httpMethod: method,
      httpPath: (req.baseUrl || "") + (req.path || ""),
      ip: req.ip || req.headers["x-forwarded-for"] || "",
      userAgent: req.headers["user-agent"] || "",
      sourceModel: "",
      sourceId: null,
      before: null,
    };

    // R7az-D10-CRIT-2/3: if UHID is missing, attempt reverse resolution
    // via :id + route→model map. Also pre-load the pre-mutation `before`
    // snapshot for UPDATE / DELETE so the audit row carries diff context.
    try {
      const needsReverse = !snapshot.keys.UHID && (isMutating || isSensitiveRead);
      const wantsBefore  = ["PUT", "PATCH", "DELETE"].includes(method);
      if (needsReverse || wantsBefore) {
        const resolved = await _resolveUhidAndSnapshot(req);
        if (resolved.UHID && !snapshot.keys.UHID) snapshot.keys.UHID = resolved.UHID;
        if (resolved.sourceModel) snapshot.sourceModel = resolved.sourceModel;
        if (resolved.sourceId)    snapshot.sourceId    = resolved.sourceId;
        if (wantsBefore && resolved.before) snapshot.before = compact(resolved.before);
      }
    } catch (e) {
      console.warn("[activityLogger] pre-resolve failed:", e.message);
    }

    res.on("finish", () => {
      // Only log successful responses; failed ones leave no patient-file footprint.
      if (res.statusCode < 200 || res.statusCode >= 300) return;
      if (!snapshot.keys.UHID) return; // patient unknown → not a per-patient action

      const user = req.user || {};
      log({
        ...snapshot.keys,
        action: snapshot.action,
        module: snapshot.module,
        area: snapshot.httpPath,
        summary: `${snapshot.httpMethod} ${snapshot.httpPath}`,
        sourceModel: snapshot.sourceModel || "",
        sourceId:    snapshot.sourceId    || null,
        before: snapshot.before,
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
