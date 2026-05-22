/**
 * adrReportService.js  (R7bf-G / A5-CRIT-4 / NABH MOM.7)
 *
 * Service-layer for the ADR (Adverse Drug Reaction) register. Encapsulates
 * lifecycle transitions and append-only audit so the controller stays
 * thin.
 */
const ADRReport = require("../../models/Pharmacy/ADRReportModel");

function _audit(action, actor = {}, reason = "") {
  return {
    action,
    at:       new Date(),
    byName:   actor.fullName || actor.name || "",
    byRole:   actor.role || "",
    byUserId: actor._id || actor.id || null,
    reason,
  };
}

function _err(code, message, status) {
  const e = new Error(message);
  e.code = code; e.status = status;
  return e;
}

/**
 * Create a DRAFT ADR report.
 */
async function create(payload, actor = {}) {
  if (!payload?.patientUHID) throw _err("ARG_MISSING", "patientUHID is required", 400);
  if (!payload?.reactionDescription) throw _err("ARG_MISSING", "reactionDescription is required", 400);
  if (!payload?.severity) throw _err("ARG_MISSING", "severity is required", 400);

  const doc = await ADRReport.create({
    ...payload,
    patientUHID: String(payload.patientUHID).toUpperCase().trim(),
    reportedBy:     actor._id || actor.id || null,
    reportedByName: actor.fullName || actor.name || "",
    reportedByRole: actor.role || "",
    status: "DRAFT",
    auditTrail: [_audit("CREATED", actor, `Severity=${payload.severity}`)],
  });
  return doc;
}

/**
 * Edit a DRAFT report. Submitted / PvPI-filed reports are read-only —
 * use submit() / filePvPI() / reopen() for state transitions.
 */
async function update(id, payload, actor = {}) {
  const doc = await ADRReport.findById(id);
  if (!doc) throw _err("NOT_FOUND", "ADR report not found", 404);
  if (doc.status !== "DRAFT") {
    throw _err("ALREADY_SUBMITTED", `Cannot edit a ${doc.status} report — only DRAFT accepts edits`, 409);
  }
  const body = { ...(payload || {}) };
  delete body.auditTrail;
  delete body.status;
  delete body.submittedAt;
  delete body.pvpiReferenceNumber;
  delete body.pvpiFiledAt;
  for (const [k, v] of Object.entries(body)) {
    if (k === "patientUHID") doc.set(k, String(v).toUpperCase().trim());
    else doc.set(k, v);
  }
  doc.auditTrail.push(_audit("UPDATED", actor));
  await doc.save();
  return doc;
}

/**
 * Submit (DRAFT → SUBMITTED). Once submitted the report locks for
 * routine edits — only PvPI filing or reopen can re-open it.
 */
async function submit(id, actor = {}) {
  const updated = await ADRReport.findOneAndUpdate(
    { _id: id, status: "DRAFT" },
    {
      $set: { status: "SUBMITTED", submittedAt: new Date() },
      $push: { auditTrail: _audit("SUBMITTED", actor) },
    },
    { new: true },
  );
  if (!updated) {
    const existing = await ADRReport.findById(id).lean();
    if (!existing) throw _err("NOT_FOUND", "ADR report not found", 404);
    throw _err("NOT_DRAFT", `Cannot submit a ${existing.status} report`, 409);
  }
  return updated;
}

/**
 * File with PvPI (SUBMITTED → PVPI_FILED). Captures the PvPI ticket
 * reference returned by the central form.
 */
async function filePvPI(id, payload = {}, actor = {}) {
  if (!payload?.pvpiReferenceNumber) throw _err("ARG_MISSING", "pvpiReferenceNumber is required", 400);
  const updated = await ADRReport.findOneAndUpdate(
    { _id: id, status: "SUBMITTED" },
    {
      $set: {
        status: "PVPI_FILED",
        pvpiReferenceNumber: payload.pvpiReferenceNumber,
        pvpiFiledAt: new Date(),
        pvpiFiledBy: actor._id || actor.id || null,
        pvpiFiledByName: actor.fullName || actor.name || "",
      },
      $push: { auditTrail: _audit("PVPI_FILED", actor, `Ref=${payload.pvpiReferenceNumber}`) },
    },
    { new: true },
  );
  if (!updated) {
    const existing = await ADRReport.findById(id).lean();
    if (!existing) throw _err("NOT_FOUND", "ADR report not found", 404);
    throw _err("NOT_SUBMITTED", `Cannot file PvPI for a ${existing.status} report`, 409);
  }
  return updated;
}

/**
 * Reopen a SUBMITTED / PVPI_FILED report back to DRAFT — typically used
 * if the PvPI desk asks for an amendment.
 */
async function reopen(id, actor = {}, reason = "") {
  const updated = await ADRReport.findOneAndUpdate(
    { _id: id, status: { $in: ["SUBMITTED", "PVPI_FILED"] } },
    {
      $set: { status: "DRAFT", submittedAt: null, pvpiFiledAt: null },
      $push: { auditTrail: _audit("REOPENED", actor, reason) },
    },
    { new: true },
  );
  if (!updated) throw _err("NOT_FOUND", "ADR report not found or already DRAFT", 404);
  return updated;
}

async function getById(id) {
  if (!id) return null;
  return ADRReport.findById(id).lean();
}

async function list({ uhid, status, severity, limit = 100 } = {}) {
  const q = {};
  if (uhid) q.patientUHID = String(uhid).toUpperCase().trim();
  if (status) q.status = status;
  if (severity) q.severity = severity;
  return ADRReport.find(q).sort({ createdAt: -1 }).limit(Math.min(500, Math.max(1, limit))).lean();
}

module.exports = { create, update, submit, filePvPI, reopen, getById, list };
