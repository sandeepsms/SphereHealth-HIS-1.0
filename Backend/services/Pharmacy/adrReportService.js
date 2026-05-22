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
 *
 * R7bh-F5: maker-checker SoD — the original reporter cannot reopen
 * their own report unless `options.force` is true AND an admin reason
 * is supplied. This closes R7bg-2-HIGH-3 (silent rewrite of a
 * regulator-facing record by the same actor).
 */
async function reopen(id, actor = {}, reason = "", options = {}) {
  const existing = await ADRReport.findById(id).lean();
  if (!existing) throw _err("NOT_FOUND", "ADR report not found", 404);

  const actorId = String(actor._id || actor.id || "");
  const reporterId = String(existing.reportedBy || "");
  if (actorId && reporterId && actorId === reporterId && !options.force) {
    throw _err("SAME_ACTOR_REJECT", "Same actor as original reporter cannot reopen — maker-checker required (admin force only with reason)", 409);
  }

  const auditEntry = _audit("REOPENED", actor, options.force ? `force=true reason=${reason || "admin override"}` : reason);
  const updated = await ADRReport.findOneAndUpdate(
    { _id: id, status: { $in: ["SUBMITTED", "PVPI_FILED"] } },
    {
      $set: { status: "DRAFT", submittedAt: null, pvpiFiledAt: null },
      $push: { auditTrail: auditEntry },
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

/**
 * R7bh-F5: PvPI Form 1 (Suspected ADR Reporting Form) JSON payload.
 * Maps the stored ADR record onto the IPC Vigiflow field set so the
 * report can be (eventually) auto-submitted via the PvPI API or
 * exported as a paper form.
 */
async function generatePvPIForm1(adrId) {
  const adr = await ADRReport.findById(adrId).populate("suspectedDrug").lean();
  if (!adr) throw _err("NOT_FOUND", "ADR report not found", 404);
  return {
    formVersion: "PvPI-Form-1.0",
    reportedAt: adr.createdAt,
    reporter: {
      name: adr.reportedByName || "",
      role: adr.reportedByRole || "Healthcare Professional",
    },
    patient: {
      UHID: adr.patientUHID,
      name: adr.patientName || null,
    },
    drug: {
      name: adr.suspectedDrug?.name || adr.suspectedDrugName || null,
      brand: adr.suspectedDrug?.brandName || null,
      generic: adr.suspectedDrug?.genericName || null,
      manufacturer: adr.suspectedDrug?.manufacturer || null,
      batch: adr.batchNumber || null,
      expiry: adr.expiryDate || null,
      route: adr.route || null,
      dose: adr.dose || null,
    },
    reaction: {
      description: adr.reactionDescription,
      severity: adr.severity,
      onsetDate: adr.onsetDate,
      duration: adr.duration || null,
    },
    dechallenge: adr.dechallenge || null,
    rechallenge: adr.rechallenge || null,
    actionTaken: adr.actionTaken || null,
    outcome: adr.outcome || null,
    concomitantMeds: adr.concomitantMeds || [],
    relevantHistory: adr.relevantHistory || null,
    causalityAssessment: adr.causalityAssessment || null,
    attachments: adr.attachments || [],
  };
}

/**
 * R7bh-F5: submit ADR to PvPI.
 *
 * R7bn — branched on submitter result.
 *   - success=true: status → PVPI_FILED, persist pvpiReferenceNumber,
 *     write success audit row.
 *   - success=false: status → PVPI_FAILED, persist error, write failure
 *     audit row. Caller (route handler) can replay later. Pre-R7bn this
 *     code-path optimistically wrote PVPI_FILED with a null reference,
 *     poisoning the audit trail on transport failure.
 */
async function submitToPvPI(adrId, actor = {}) {
  const payload = await generatePvPIForm1(adrId);
  const submitter = require("./pvpiSubmitter");
  const result = await submitter.send(payload);
  const now = new Date();
  const succeeded = result && result.success === true && result.pvpiReference;

  const $inc = { pvpiAttemptCount: 1 };
  const $set = {
    pvpiSubmissionAttemptedAt: now,
    pvpiLastAttemptedAt: now,
  };
  let auditAction;
  let auditDetail;

  if (succeeded) {
    Object.assign($set, {
      status: "PVPI_FILED",
      pvpiReferenceNumber: result.pvpiReference,
      pvpiFiledAt: now,
      pvpiFiledBy: actor._id || actor.id || null,
      pvpiFiledByName: actor.fullName || actor.name || "",
      pvpiLastErrorMessage: "",
      pvpiLastErrorCode: "",
    });
    auditAction = "PVPI_SUBMITTED";
    auditDetail = `transport=${result.transport || "stub"} ref=${result.pvpiReference}`;
  } else {
    Object.assign($set, {
      status: "PVPI_FAILED",
      pvpiLastErrorMessage: String(result?.errorMessage || result?.message || "Unknown PvPI transport error").slice(0, 500),
      pvpiLastErrorCode: String(result?.errorCode || result?.statusCode || "TRANSPORT_FAIL").slice(0, 64),
    });
    auditAction = "PVPI_SUBMIT_FAILED";
    auditDetail = `transport=${result?.transport || "unknown"} err=${$set.pvpiLastErrorMessage}`;
  }

  const updated = await ADRReport.findByIdAndUpdate(
    adrId,
    { $set, $inc, $push: { auditTrail: _audit(auditAction, actor, auditDetail) } },
    { new: true }
  );
  return { report: updated, submission: result, succeeded };
}

module.exports = {
  create,
  update,
  submit,
  filePvPI,
  reopen,
  getById,
  list,
  // R7bh-F5
  generatePvPIForm1,
  submitToPvPI,
};
