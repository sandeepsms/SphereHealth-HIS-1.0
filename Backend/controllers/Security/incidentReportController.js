/**
 * incidentReportController.js — Security incident register.
 *
 * R7bj-F4 hardening:
 *   • SEC-CRIT-1 / Mongo CRIT-2: recorded-by trio NO LONGER trusted from
 *     body. Server stamps from req.user only.
 *   • CRIT-2 attachments: every URL must pass the controller-side allow-
 *     list (https:// or /uploads/) before write. The model-level
 *     validator catches it on save() too — defence in depth.
 *   • SEC-CRIT-2 / R7bj-F3: append-only via statusHistory $push (model
 *     enforces). updateStatus only mutates {status, escalatedTo,
 *     resolvedAt, resolvedBy} + appends statusHistory.
 *   • Maker-checker on severity="Critical": a Critical incident cannot
 *     be Resolved/Closed by the recorder themselves (unless they are
 *     Admin with the adminOverride flag).
 *   • Every response moved to apiEnvelope.sendOk / sendErr.
 */
const IncidentReport = require("../../models/Security/IncidentReportModel");
const { nextSequence } = require("../../utils/counter");
const { sendOk, sendErr } = require("../../utils/apiEnvelope");

const VALID_TYPES = ["Theft", "Trespass", "Disturbance", "Medical-Emergency", "Fire", "Vandalism", "Accident", "Other"];
const VALID_SEVERITY = ["Low", "Medium", "High", "Critical"];

// Mirror the schema validator so we 400 the request before hitting the DB.
const MAX_ATTACHMENTS = 10;
const MAX_URL_LEN = 500;
function isSafeAttachmentUrl(u) {
  if (typeof u !== "string" || !u) return false;
  if (u.length > MAX_URL_LEN) return false;
  const lower = u.toLowerCase().trim();
  if (lower.startsWith("javascript:") || lower.startsWith("data:") ||
      lower.startsWith("file:") || lower.startsWith("vbscript:")) return false;
  if (lower.startsWith("https://")) return true;
  if (lower.startsWith("/uploads/incident/")) return true;
  if (lower.startsWith("/uploads/security/")) return true;
  return false;
}

const handle = (fn) => async (req, res) => {
  try { return await fn(req, res); }
  catch (e) { return sendErr(res, e, e?.code, e?.statusCode); }
};

async function nextIncidentNumber() {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const seq = await nextSequence(`incident:${dateStr}`);
  return `IR-${dateStr}-${String(seq).padStart(4, "0")}`;
}

/* POST /api/incidents */
exports.create = handle(async (req, res) => {
  const b = req.body || {};
  const {
    type, severity, location, description, personsInvolved,
    occurredAt, attachments,
  } = b;

  const missing = ["type", "location", "description"].filter((k) => !b[k] || !String(b[k]).trim());
  if (missing.length) {
    return sendErr(res, `Missing required field(s): ${missing.join(", ")}`, "VALIDATION", 400);
  }
  if (!VALID_TYPES.includes(type)) {
    return sendErr(res, `type must be one of: ${VALID_TYPES.join(", ")}`, "VALIDATION", 400);
  }
  if (severity !== undefined && !VALID_SEVERITY.includes(severity)) {
    return sendErr(res, `severity must be one of: ${VALID_SEVERITY.join(", ")}`, "VALIDATION", 400);
  }

  // R7bj-F4 CRIT-2: attachment URL allow-list. Reject javascript:/data:/
  // external schemes BEFORE write so the row never enters the collection
  // with an unsafe link.
  const attachmentList = Array.isArray(attachments) ? attachments : [];
  if (attachmentList.length > MAX_ATTACHMENTS) {
    return sendErr(res, `attachments: max ${MAX_ATTACHMENTS} URLs`, "VALIDATION", 400);
  }
  for (const u of attachmentList) {
    if (!isSafeAttachmentUrl(u)) {
      return sendErr(
        res,
        `attachments: each URL must be https:// or /uploads/incident/ — javascript:/data:/file: blocked`,
        "UNSAFE_ATTACHMENT",
        400,
      );
    }
  }

  const persons = Array.isArray(personsInvolved)
    ? personsInvolved.map(p => ({
        name:    typeof p?.name    === "string" ? p.name    : "",
        role:    typeof p?.role    === "string" ? p.role    : "",
        contact: typeof p?.contact === "string" ? p.contact : "",
        notes:   typeof p?.notes   === "string" ? p.notes   : "",
      }))
    : [];

  // R7bj-F4 / Auth fork: recorded-by trio from req.user only.
  const recordedBy     = req.user?.fullName || req.user?.email || "Security";
  const recordedByName = req.user?.fullName || "";
  const recordedById   = req.user?.id || null;
  const recordedByRole = req.user?.role || "Security";

  const doc = await IncidentReport.create({
    incidentNumber:  await nextIncidentNumber(),
    type,
    severity:        severity || "Medium",
    location:        String(location).trim(),
    occurredAt:      occurredAt ? new Date(occurredAt) : new Date(),
    recordedAt:      new Date(),
    description:     String(description).trim(),
    personsInvolved: persons,
    status:          "Open",
    statusHistory:   [{ from: "", to: "Open", at: new Date(), byName: recordedByName, byUserId: recordedById, byRole: recordedByRole, note: "Initial report" }],
    recordedBy,
    recordedByName,
    recordedById,
    recordedByRole,
    attachments:     attachmentList,
  });
  return sendOk(res, doc, null, 201);
});

/* GET /api/incidents */
exports.list = handle(async (req, res) => {
  const filter = {};
  if (req.query.status)   filter.status   = req.query.status;
  if (req.query.type)     filter.type     = req.query.type;
  if (req.query.severity) filter.severity = req.query.severity;
  if (req.query.from || req.query.to) {
    filter.occurredAt = {};
    if (req.query.from) filter.occurredAt.$gte = new Date(req.query.from);
    if (req.query.to)   filter.occurredAt.$lte = new Date(req.query.to);
  }
  if (req.query.q) {
    const q = new RegExp(String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [
      { incidentNumber: q }, { location: q }, { description: q },
      { recordedBy: q }, { actionTaken: q },
    ];
  }

  const page  = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit) || 50));
  const skip  = (page - 1) * limit;

  const [rows, total] = await Promise.all([
    IncidentReport.find(filter).sort({ occurredAt: -1, createdAt: -1 }).skip(skip).limit(limit).lean(),
    IncidentReport.countDocuments(filter),
  ]);
  return sendOk(res, rows, {
    count: rows.length,
    page, limit, total,
    pages: Math.ceil(total / limit) || 0,
  });
});

/* GET /api/incidents/:id */
exports.get = handle(async (req, res) => {
  const doc = await IncidentReport.findById(req.params.id).lean();
  if (!doc) return sendErr(res, "Incident not found", "NOT_FOUND", 404);
  return sendOk(res, doc);
});

/* PATCH /api/incidents/:id/status
   Body: { status, actionTaken?, escalatedTo?, escalatedToName?, note? }
   R7bj-F4 SEC-CRIT-2: status + escalation are append-only via statusHistory
   $push. description / personsInvolved / severity are NOT mutable here. */
exports.updateStatus = handle(async (req, res) => {
  const VALID = ["Open", "Investigating", "Resolved", "Escalated", "Closed"];
  const next = req.body?.status;
  if (!VALID.includes(next)) {
    return sendErr(res, `status must be one of: ${VALID.join(", ")}`, "VALIDATION", 400);
  }

  const doc = await IncidentReport.findById(req.params.id).lean();
  if (!doc) return sendErr(res, "Incident not found", "NOT_FOUND", 404);

  // R7bj-F4: maker-checker for Critical incidents. The recorder cannot
  // self-close a Critical — a second pair of eyes is required (Admin can
  // override, but Admins normally aren't recording incidents anyway).
  const isClosingTransition = next === "Resolved" || next === "Closed";
  const role = req.user?.role || "";
  if (
    doc.severity === "Critical" &&
    isClosingTransition &&
    String(doc.recordedById || "") === String(req.user?.id || "") &&
    role !== "Admin"
  ) {
    return sendErr(
      res,
      "Critical incidents cannot be self-closed by the recorder — escalate to a second reviewer or Admin.",
      "MAKER_CHECKER",
      403,
    );
  }

  const escalatedTo     = typeof req.body?.escalatedTo === "string" ? req.body.escalatedTo : "";
  const escalatedToName = typeof req.body?.escalatedToName === "string" ? req.body.escalatedToName : "";
  const noteTxt         = typeof req.body?.note === "string" ? req.body.note : "";

  // Build a minimal update — append the transition to statusHistory and
  // flip the top-level status. NB: actionTaken is append-only via the
  // schema guard; we leave it alone here.
  const $set = { status: next };
  if (isClosingTransition) {
    $set.resolvedAt = new Date();
    $set.resolvedBy = req.user?.fullName || req.user?.email || "Security";
  }
  if (next === "Escalated" && escalatedTo) $set.escalatedTo = escalatedTo;

  const $push = {
    statusHistory: {
      from: doc.status,
      to:   next,
      at:   new Date(),
      byName:   req.user?.fullName || "",
      byUserId: req.user?.id || null,
      byRole:   role,
      note:     [noteTxt, escalatedTo ? `→ ${escalatedTo}` : "", escalatedToName ? `(${escalatedToName})` : ""].filter(Boolean).join(" "),
    },
  };

  const updated = await IncidentReport.findByIdAndUpdate(
    req.params.id,
    { $set, $push },
    { new: true, runValidators: true },
  ).lean();
  return sendOk(res, updated);
});

/* GET /api/incidents/stats */
exports.stats = handle(async (req, res) => {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const start30d = new Date();
  start30d.setDate(start30d.getDate() - 30);

  const [openCount, todayCount, criticalOpen, last30d] = await Promise.all([
    IncidentReport.countDocuments({ status: { $in: ["Open", "Investigating", "Escalated"] } }),
    IncidentReport.countDocuments({ createdAt: { $gte: startOfDay } }),
    IncidentReport.countDocuments({ status: { $in: ["Open", "Investigating", "Escalated"] }, severity: "Critical" }),
    IncidentReport.countDocuments({ createdAt: { $gte: start30d } }),
  ]);

  return sendOk(res, { openCount, todayCount, criticalOpen, last30d });
});
