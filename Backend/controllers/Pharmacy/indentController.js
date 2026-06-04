/**
 * indentController.js — thin HTTP layer over indentService.
 *
 * R7bh-F4 / R7bg-3-CRIT-12: envelope normalised via utils/apiEnvelope so
 * every response shares the { success, data, meta? } / { success, message,
 * code } contract. `meta.count` carries the array length.
 */
const svc = require("../../services/Pharmacy/indentService");
const { sendOk, sendErr } = require("../../utils/apiEnvelope");
// R7hr-12-S2 (D5-04): immutable clinical audit on every indent transition.
// Emits from the controller (not the service) so the Express `req` —
// which carries actor identity + IP + UA — is in scope without
// threading it through every service signature. Per refinement on
// finding D5-04 verdict: emitting here mirrors marController's pattern
// (recordAdministration) and keeps the service signature stable.
const { emitClinicalAudit } = require("../../services/Compliance/clinicalAuditService");

function mapStatus(code) {
  if (code === "ARG_MISSING" || code === "INVALID_QTY" || code === "NOTHING_TO_RELEASE") return 400;
  if (code === "ALREADY_CLOSED" || code === "ALREADY_RELEASED" || code === "ALREADY_ACKED") return 409;
  if (code === "ACK_OWNERSHIP_MISMATCH" || code === "NOT_ACKNOWLEDGED") return 409;
  if (code === "NOT_RELEASED" || code === "NOTHING_TO_RETURN" || code === "EXCEEDS_ISSUED") return 409;
  return 500;
}

// R7hr-12-S2 (D5-04): shared snapshot helper. Keeps each emit-site small
// and lifts an opinionated subset of the indent doc into the audit `after`
// payload — surveyors care about ward / urgency / item summary, not the
// full subdoc tree. Items collapse to {drugName, qty} pairs so the row
// stays under the 16MB Mongo doc cap even for 50-line indents.
function _indentAuditSnapshot(doc) {
  if (!doc) return null;
  const items = Array.isArray(doc.items) ? doc.items.map((it) => ({
    drugName:     it.drugName,
    drugCode:     it.drugCode || "",
    requestedQty: Number(it.requestedQty || 0),
    issuedQty:    Number(it.issuedQty || 0),
    sourceType:   it.sourceType,
  })) : [];
  return {
    indentNumber:    doc.indentNumber,
    status:          doc.status,
    urgency:         doc.urgency,
    wardName:        doc.wardName,
    bedNumber:       doc.bedNumber,
    admissionNumber: doc.admissionNumber,
    itemCount:       items.length,
    items,
  };
}

// POST /api/indents
exports.create = async (req, res, next) => {
  try {
    const doc = await svc.createIndent({
      admissionId: req.body?.admissionId,
      items:       req.body?.items,
      urgency:     req.body?.urgency,
      notes:       req.body?.notes,
      user:        req.user || {},
    });
    // R7hr-12-S2 (D5-04): INDENT_RAISED audit row.
    try {
      await emitClinicalAudit({
        req,
        event:       "INDENT_RAISED",
        UHID:        doc.UHID,
        admissionId: doc.admissionId,
        patientId:   doc.patientId,
        patientName: doc.patientName,
        targetType:  "PharmacyIndent",
        targetId:    doc._id,
        after:       _indentAuditSnapshot(doc),
      });
    } catch (_) { /* silent — audit is non-blocking */ }
    return sendOk(res, doc, undefined, 201);
  } catch (e) {
    const status = e.status || mapStatus(e.code);
    if (status !== 500) return sendErr(res, e, e.code, status);
    next(e);
  }
};

// GET /api/indents
exports.list = async (req, res, next) => {
  try {
    const list = await svc.listIndents(req.query || {});
    return sendOk(res, list, { count: list.length });
  } catch (e) { next(e); }
};

// GET /api/indents/:id
exports.getOne = async (req, res, next) => {
  try {
    const doc = await svc.getIndent(req.params.id);
    return sendOk(res, doc);
  } catch (e) {
    if (e.status === 404) return sendErr(res, e, "NOT_FOUND", 404);
    next(e);
  }
};

// POST /api/indents/:id/acknowledge
exports.acknowledge = async (req, res, next) => {
  try {
    const doc = await svc.acknowledgeIndent(req.params.id, req.user || {});
    // R7hr-12-S2 (D5-04): INDENT_ACKNOWLEDGED audit row. CAS ack flow
    // is idempotent — a network-flapped retry on an already-Acknowledged
    // indent returns the same doc; we emit anyway so the audit shows
    // every attempt (surveyors care if a second pharmacist tried).
    try {
      await emitClinicalAudit({
        req,
        event:       "INDENT_ACKNOWLEDGED",
        UHID:        doc.UHID,
        admissionId: doc.admissionId,
        patientId:   doc.patientId,
        patientName: doc.patientName,
        targetType:  "PharmacyIndent",
        targetId:    doc._id,
        after:       _indentAuditSnapshot(doc),
      });
    } catch (_) { /* silent — audit is non-blocking */ }
    return sendOk(res, doc);
  } catch (e) {
    const status = e.status || mapStatus(e.code);
    if (status !== 500) return sendErr(res, e, e.code, status);
    next(e);
  }
};

// POST /api/indents/:id/release  { items: [{ itemId, issuedQty, batchNumber, ... }] }
exports.release = async (req, res, next) => {
  try {
    const doc = await svc.releaseIndent(req.params.id, {
      items: req.body?.items,
      user:  req.user || {},
    });
    // R7hr-12-S2 (D5-04): INDENT_RELEASED audit row. Carries the
    // FEFO pick ledger (item.picked[]) so a recall can later reach
    // every batch dispensed against this indent without re-walking
    // BillingTrigger rows. Also captures the release vector (which
    // items were issued in this call vs prior PartiallyReleased
    // passes) via the request body — surveyors can reconstruct a
    // multi-call release ordering even if the indent doc later
    // moves to Released.
    try {
      const releasedThisCall = Array.isArray(req.body?.items)
        ? req.body.items.map((r) => ({ itemId: String(r.itemId || ""), issuedQty: Number(r.issuedQty || 0) }))
        : [];
      const picksByItem = Array.isArray(doc.items) ? doc.items.map((it) => ({
        itemId:   String(it._id),
        drugName: it.drugName,
        picked:   Array.isArray(it.picked) ? it.picked.map((p) => ({
          batchId:    p.batchId,
          batchNo:    p.batchNo,
          qty:        Number(p.qty || 0),
          expiryDate: p.expiryDate,
        })) : [],
      })) : [];
      await emitClinicalAudit({
        req,
        event:       "INDENT_RELEASED",
        UHID:        doc.UHID,
        admissionId: doc.admissionId,
        patientId:   doc.patientId,
        patientName: doc.patientName,
        targetType:  "PharmacyIndent",
        targetId:    doc._id,
        after: {
          ..._indentAuditSnapshot(doc),
          releasedThisCall,
          picksByItem,
        },
      });
    } catch (_) { /* silent — audit is non-blocking */ }
    return sendOk(res, doc);
  } catch (e) {
    const status = e.status || mapStatus(e.code);
    if (status !== 500) return sendErr(res, e, e.code, status);
    next(e);
  }
};

// POST /api/indents/:id/cancel  { reason }
exports.cancel = async (req, res, next) => {
  try {
    const doc = await svc.cancelIndent(req.params.id, {
      reason: req.body?.reason,
      user:   req.user || {},
    });
    // R7hr-12-S2 (D5-04): INDENT_CANCELLED audit row.
    try {
      await emitClinicalAudit({
        req,
        event:       "INDENT_CANCELLED",
        UHID:        doc.UHID,
        admissionId: doc.admissionId,
        patientId:   doc.patientId,
        patientName: doc.patientName,
        targetType:  "PharmacyIndent",
        targetId:    doc._id,
        reason:      doc.cancelReason || req.body?.reason || "",
        after:       _indentAuditSnapshot(doc),
      });
    } catch (_) { /* silent — audit is non-blocking */ }
    return sendOk(res, doc);
  } catch (e) {
    const status = e.status || mapStatus(e.code);
    if (status !== 500) return sendErr(res, e, e.code, status);
    next(e);
  }
};

// R7hr-12-S2 (D3-03): POST /api/indents/:id/return  { items, reason }
// Reverses stock + voids the matching MAR_RESERVATION trigger when a
// ward returns unused drug (patient discharged/transferred/refused
// before MAR-administer). Pre-R7hr-12-S2 cancelIndent refused the
// transition for Released indents and pointed operators at a
// "returnIndent / void-sale flow" that did not exist anywhere in
// the codebase. This is that flow.
exports.return = async (req, res, next) => {
  try {
    const doc = await svc.returnIndent(req.params.id, {
      items:  req.body?.items,
      reason: req.body?.reason,
      user:   req.user || {},
    });
    // INDENT_RETURNED audit row — same per-batch reverse-FEFO trail
    // the service stamps on the indent. Reason is required for any
    // ward return so the audit row carries a documented justification.
    try {
      const returnedThisCall = Array.isArray(req.body?.items)
        ? req.body.items.map((r) => ({
          itemId:    String(r.itemId || ""),
          returnQty: Number(r.returnQty || 0),
        }))
        : [];
      await emitClinicalAudit({
        req,
        event:       "INDENT_RETURNED",
        UHID:        doc.UHID,
        admissionId: doc.admissionId,
        patientId:   doc.patientId,
        patientName: doc.patientName,
        targetType:  "PharmacyIndent",
        targetId:    doc._id,
        reason:      req.body?.reason || "",
        after: {
          ..._indentAuditSnapshot(doc),
          returnedThisCall,
        },
      });
    } catch (_) { /* silent — audit is non-blocking */ }
    return sendOk(res, doc);
  } catch (e) {
    const status = e.status || mapStatus(e.code);
    if (status !== 500) return sendErr(res, e, e.code, status);
    next(e);
  }
};
