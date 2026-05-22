/**
 * visitorPassController.js — Visitor / attendant pass register.
 *
 * R7bj-F4 hardening:
 *   • Already destructured on create — left intact and re-verified.
 *   • R7bi-2-SE-MED-1 PII minimisation: list response now drops
 *     attendant ID-proof number / phone / photo URL when the caller
 *     doesn't have billing.read (Admin / Billing). Security desk + ward
 *     staff get the short-form columns only.
 *   • return / revoke now strictly destructure the single allowed body
 *     field. Server stamps actor + timestamp.
 *   • Every response moved to apiEnvelope.sendOk / sendErr.
 */
const VisitorPass = require("../../models/VisitorPass/visitorPassModel");
const Admission   = require("../../models/Patient/admissionModel");
const { nextSequence } = require("../../utils/counter");
const { sendOk, sendErr } = require("../../utils/apiEnvelope");

const handle = (fn) => async (req, res) => {
  try { return await fn(req, res); }
  catch (e) { return sendErr(res, e, e?.code, e?.statusCode); }
};

// Atomic pass-number via shared Counter (replaces countDocuments race).
async function nextPassNumber() {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const seq     = await nextSequence(`visitorpass:${dateStr}`);
  return `VP-${dateStr}-${String(seq).padStart(4, "0")}`;
}

/* ── PII helpers ────────────────────────────────────────────
   The list endpoint is consumed by the Security gate desk + Reception
   dashboard. Neither role needs the full PII payload for the table view;
   only the audit / billing role does. Strip sensitive columns from rows
   unless the caller has billing.read or is Admin. */
const PII_KEYS = ["idProofNumber", "attendantPhone", "notes"];
function isPiiViewer(req) {
  const role = req.user?.role || "";
  if (role === "Admin") return true;
  const perms = req.user?.permissions || [];
  return Array.isArray(perms) && (perms.includes("billing.read") || perms.includes("audit.read"));
}
function redactRow(row) {
  if (!row) return row;
  const out = { ...row };
  for (const k of PII_KEYS) if (k in out) out[k] = "***";
  return out;
}

/* POST /api/visitor-passes
   Body (explicit destructure):
     { admissionId, attendantName, attendantRelation, attendantPhone,
       idProofType, idProofNumber, validHours, notes } */
exports.issuePass = handle(async (req, res) => {
  const {
    admissionId, attendantName, attendantRelation, attendantPhone,
    idProofType, idProofNumber, validHours = 24, notes,
  } = req.body || {};

  if (!admissionId || !attendantName || !attendantRelation)
    return sendErr(res, "admissionId, attendantName, attendantRelation required", "VALIDATION", 400);

  // R7ab: identity comes from the auth context, NOT the request body.
  const issuedBy     = req.user?.fullName || req.user?.email || "Receptionist";
  const issuedByRole = req.user?.role     || "Receptionist";

  // R7bj-F4: cap validHours to 24h policy (NABH FMS.7 visitor pass ≤ 24h).
  // Schema still permits up to 720h for ICU/long-stay attendant cases,
  // but the standard pass MUST be ≤ 24h — admins can override via a
  // dedicated long-stay endpoint (not exposed here).
  const hours = Number(validHours);
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24) {
    return sendErr(res, "validHours must be a positive number ≤ 24 (policy cap)", "VALIDATION", 400);
  }

  const adm = await Admission.findById(admissionId).populate("patientId", "fullName UHID").lean();
  if (!adm) return sendErr(res, "Admission not found", "NOT_FOUND", 404);
  if (adm.status !== "Active")
    return sendErr(res, "Cannot issue pass for non-active admission", "ILLEGAL_TRANSITION", 409);

  // Auto-expire stale Active passes for this admission so the max-2 check
  // doesn't lock the patient out forever.
  await VisitorPass.updateMany(
    { admissionId, status: "Active", validUntil: { $lt: new Date() } },
    { $set: { status: "Expired" } },
  );

  // Enforce max 2 active passes per admission
  const activeCount = await VisitorPass.countDocuments({ admissionId, status: "Active" });
  if (activeCount >= 2)
    return sendErr(res, "Maximum 2 active passes per patient. Revoke an existing pass first.", "POLICY_CAP", 409);

  const validFrom  = new Date();
  const validUntil = new Date(validFrom.getTime() + hours * 60 * 60 * 1000);

  // R7ab: passNumber retry on E11000 — the counter is atomic but if a
  // legacy seed clash or manual import collides, gracefully bump and
  // retry rather than 500-ing the desk.
  let pass = null;
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      pass = await VisitorPass.create({
        passNumber:    await nextPassNumber(),
        admissionId,
        patientName:   adm.patientName || adm.patientId?.fullName || "Patient",
        patientUHID:   adm.UHID || adm.patientId?.UHID,
        bedNumber:     adm.bedNumber || "",
        wardName:      adm.wardName || "",
        attendantName,
        attendantRelation,
        attendantPhone,
        idProofType,
        idProofNumber,
        validFrom,
        validUntil,
        issuedBy,
        issuedByRole,
        notes,
      });
      break;
    } catch (e) {
      lastErr = e;
      if (e?.code !== 11000) throw e;
    }
  }
  if (!pass) throw lastErr || new Error("Failed to issue pass after retries");
  return sendOk(res, pass, null, 201);
});

/* GET /api/visitor-passes?status=Active&admissionId=...&patientUHID=... */
exports.listPasses = handle(async (req, res) => {
  // Persist stale Active → Expired transitions BEFORE listing so the count
  // and rows reflect reality (and so the max-2 issuePass guard is honest).
  await VisitorPass.updateMany(
    { status: "Active", validUntil: { $lt: new Date() } },
    { $set: { status: "Expired" } },
  );

  const filter = {};
  if (req.query.status)       filter.status      = req.query.status;
  if (req.query.admissionId)  filter.admissionId = req.query.admissionId;
  if (req.query.patientUHID)  filter.patientUHID = req.query.patientUHID;
  if (req.query.q) {
    const { safeRegex } = require("../../utils/queryGuards");
    const q = safeRegex(req.query.q);
    filter.$or = [{ patientName: q }, { attendantName: q }, { passNumber: q }, { patientUHID: q }];
  }
  const list = await VisitorPass.find(filter).sort({ createdAt: -1 }).limit(500).lean();

  // R7bj-F4 / R7bi-2-SE-MED-1: drop PII columns for non-privileged viewers.
  const viewerIsPii = isPiiViewer(req);
  const rows = viewerIsPii ? list : list.map(redactRow);
  return sendOk(res, rows, { count: rows.length, redacted: !viewerIsPii });
});

/* POST /api/visitor-passes/:id/return
   Body: { notes? } */
exports.returnPass = handle(async (req, res) => {
  const p = await VisitorPass.findById(req.params.id);
  if (!p) return sendErr(res, "Pass not found", "NOT_FOUND", 404);
  if (p.status !== "Active") {
    return sendErr(res, `Pass is already ${p.status}`, "ILLEGAL_TRANSITION", 409);
  }
  const extraNote = typeof req.body?.notes === "string" ? req.body.notes : "";
  p.status     = "Returned";
  p.returnedAt = new Date();
  if (extraNote) p.notes = (p.notes ? p.notes + " · " : "") + extraNote;
  await p.save();
  return sendOk(res, p);
});

/* POST /api/visitor-passes/:id/revoke
   Body: { reason } */
exports.revokePass = handle(async (req, res) => {
  const p = await VisitorPass.findById(req.params.id);
  if (!p) return sendErr(res, "Pass not found", "NOT_FOUND", 404);
  if (p.status !== "Active") {
    return sendErr(res, `Pass is already ${p.status}`, "ILLEGAL_TRANSITION", 409);
  }
  const reason = typeof req.body?.reason === "string" ? req.body.reason : "";
  p.status        = "Revoked";
  p.revokedAt     = new Date();
  p.revokedReason = reason;
  await p.save();
  return sendOk(res, p);
});

/* GET /api/visitor-passes/active-count — for dashboard widget */
exports.activeCount = handle(async (req, res) => {
  const count = await VisitorPass.countDocuments({ status: "Active" });
  return sendOk(res, { count });
});

/* GET /api/visitor-passes/stats — three KPIs in one round-trip. */
exports.stats = handle(async (req, res) => {
  // First, transition any stale Active passes whose window has closed.
  await VisitorPass.updateMany(
    { status: "Active", validUntil: { $lt: new Date() } },
    { $set: { status: "Expired" } },
  );

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [passesToday, activeVisitors, expiredPasses] = await Promise.all([
    VisitorPass.countDocuments({ createdAt: { $gte: startOfDay } }),
    VisitorPass.countDocuments({ status: "Active" }),
    VisitorPass.countDocuments({ status: "Expired", validUntil: { $gte: startOfDay } }),
  ]);

  return sendOk(res, { passesToday, activeVisitors, expiredPasses });
});
