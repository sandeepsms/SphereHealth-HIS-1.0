/**
 * investigationOrderController.js — Lab/Radiology order HTTP layer.
 *
 * R7bj-F8 / R7bi-3-CRIT-1: envelope normalised via utils/apiEnvelope. The
 * legacy `getAll` spread `...result` (pagination) at the top level and
 * duplicated `data`; pagination now lives in `meta`.
 */
const svc = require("../../services/Investigation/investigationOrderService");
const { logErr } = require("../../utils/logErr");
// Lazy import keeps boot order tolerant.
let _env;
function env() {
  if (!_env) _env = require("../../utils/apiEnvelope");
  return _env;
}

exports.create = async (req, res) => {
  const { sendOk, sendErr } = env();
  try {
    const data = await svc.createOrder(req.body);
    // ── Auto-billing hook ──────────────────────────────────────
    // Fire-and-forget but no longer silent (audit D-01). If the
    // billing trigger fails we still want the order to succeed —
    // billing has its own retry mechanism — but the failure now
    // surfaces in container logs so SOC can spot a stuck queue.
    try {
      const autoBilling = require("../../services/Billing/autoBillingService");
      autoBilling.onInvestigationOrdered(data).catch(logErr("autoBilling", `onInvestigationOrdered ${data?._id}`));
    } catch (e) {
      logErr("autoBilling", "load failure on investigation.create")(e);
    }
    return sendOk(res, data, undefined, 201);
  } catch (e) {
    return sendErr(res, e, "VALIDATION", 400);
  }
};

exports.getAll = async (req, res) => {
  const { sendOk, sendErr } = env();
  try {
    const result = await svc.getOrders(req.query);
    const { orders = [], ...meta } = result || {};
    return sendOk(res, orders, { count: orders.length, ...meta });
  } catch (e) {
    return sendErr(res, e);
  }
};

exports.getSummary = async (req, res) => {
  const { sendOk, sendErr } = env();
  try {
    const data = await svc.getDashboardSummary();
    return sendOk(res, data);
  } catch (e) {
    return sendErr(res, e);
  }
};

exports.getByUHID = async (req, res) => {
  const { sendOk, sendErr } = env();
  try {
    const data = await svc.getOrdersByUHID(req.params.UHID);
    const arr = Array.isArray(data) ? data : (data?.orders || []);
    return sendOk(res, arr, { count: arr.length });
  } catch (e) {
    return sendErr(res, e);
  }
};

exports.getById = async (req, res) => {
  const { sendOk, sendErr } = env();
  try {
    const data = await svc.getOrderById(req.params.id);
    return sendOk(res, data);
  } catch (e) {
    const notFound = e.message === "Order not found";
    return sendErr(res, e, notFound ? "NOT_FOUND" : null, notFound ? 404 : 500);
  }
};

exports.collectSample = async (req, res) => {
  const { sendOk, sendErr } = env();
  try {
    const data = await svc.collectSamples(req.params.id, req.body);
    return sendOk(res, data);
  } catch (e) {
    return sendErr(res, e, "VALIDATION", 400);
  }
};

// NABL 7.2.6 — reject a pre-analytical sample with a structured reason.
// R9-FIX(R9-048): the NABL authorising-signatory identity (who rejected /
// entered / verified / amended) MUST be the authenticated actor, never a
// client-supplied string in the body. Override it here on every result path.
const _labActor = (req) => req.user?.fullName || req.user?.employeeId || req.user?.name || "Lab Staff";
exports.rejectSample = async (req, res) => {
  const { sendOk, sendErr } = env();
  try {
    const data = await svc.rejectSample(req.params.id, { ...req.body, rejectedBy: _labActor(req) });
    return sendOk(res, data);
  } catch (e) {
    return sendErr(res, e, e.code || "VALIDATION", e.status || 400);
  }
};

// NABL 7.4.1.7 — amend a VERIFIED (released) result via the append-only trail.
exports.amendResult = async (req, res) => {
  const { sendOk, sendErr } = env();
  try {
    const data = await svc.amendResult(req.params.id, { ...req.body, amendedBy: _labActor(req) }); // R9-FIX(R9-048)
    return sendOk(res, data);
  } catch (e) {
    return sendErr(res, e, e.code || "VALIDATION", e.status || 400);
  }
};

exports.enterResults = async (req, res) => {
  const { sendOk, sendErr } = env();
  try {
    const data = await svc.enterResults(req.params.id, { ...req.body, enteredBy: _labActor(req) }); // R9-FIX(R9-048)
    // ── Auto-billing hook ──────────────────────────────────────
    try {
      const autoBilling = require("../../services/Billing/autoBillingService");
      autoBilling.onInvestigationResulted(data).catch(logErr("autoBilling", `onInvestigationResulted ${data?._id}`));
    } catch (e) {
      logErr("autoBilling", "load failure on investigation.result")(e);
    }
    return sendOk(res, data);
  } catch (e) {
    // Honour typed conflicts: SAMPLE_REJECTED / RESULT_VERIFIED_LOCKED (409).
    return sendErr(res, e, e.code || "VALIDATION", e.status || 400);
  }
};

exports.enterExternalResult = async (req, res) => {
  const { sendOk, sendErr } = env();
  try {
    const data = await svc.enterExternalResult(req.params.id, { ...req.body, enteredBy: _labActor(req) }); // R9-FIX(R9-048)
    return sendOk(res, data);
  } catch (e) {
    return sendErr(res, e, "VALIDATION", 400);
  }
};

exports.verify = async (req, res) => {
  const { sendOk, sendErr } = env();
  try {
    const data = await svc.verifyResults(req.params.id, { ...req.body, verifiedBy: _labActor(req) }); // R9-FIX(R9-048)
    // ── Auto-billing hook ──────────────────────────────────────
    try {
      const autoBilling = require("../../services/Billing/autoBillingService");
      autoBilling.onInvestigationResulted(data).catch(logErr("autoBilling", `onInvestigationResulted ${data?._id}`));
    } catch (e) {
      logErr("autoBilling", "load failure on investigation.result")(e);
    }
    return sendOk(res, data);
  } catch (e) {
    // Honour the QC-release gate conflict (409 QC_FAILED).
    return sendErr(res, e, e.code || "VALIDATION", e.status || 400);
  }
};

exports.markPrinted = async (req, res) => {
  const { sendOk, sendErr } = env();
  try {
    const data = await svc.markReportPrinted(req.params.id, req.body);
    return sendOk(res, data);
  } catch (e) {
    return sendErr(res, e, "VALIDATION", 400);
  }
};

exports.cancel = async (req, res) => {
  const { sendOk, sendErr } = env();
  try {
    const data = await svc.cancelOrder(req.params.id, req.body);
    return sendOk(res, data);
  } catch (e) {
    return sendErr(res, e, "VALIDATION", 400);
  }
};

exports.addTest = async (req, res) => {
  const { sendOk, sendErr } = env();
  try {
    const data = await svc.addTest(req.params.id, req.body);
    return sendOk(res, data);
  } catch (e) {
    return sendErr(res, e, "VALIDATION", 400);
  }
};

// R7bb-FIX-E-13 / D6-HIGH-3: POST /api/investigation-orders/:id/retest
//   Body: { reason, items?, priority? }
// Re-run an investigation. Creates a NEW InvestigationOrder linked via
// parentOrderId to the source. The default `items` cloned from the
// source order, but caller can pass a subset.
exports.requestRetest = async (req, res) => {
  const { sendOk, sendErr } = env();
  try {
    const InvestigationOrder = require("../../models/Investigation/InvestigationOrderModel");
    const parent = await InvestigationOrder.findById(req.params.id).lean();
    if (!parent) return sendErr(res, "Source order not found", "NOT_FOUND", 404);
    if (!String(req.body?.reason || "").trim()) {
      return sendErr(res, "reason is required for a retest", "VALIDATION", 400);
    }
    // Pick the items to retest. Default to all items from the parent.
    const wantedIds = Array.isArray(req.body?.items) && req.body.items.length
      ? new Set(req.body.items.map((id) => String(id)))
      : null;
    const items = (parent.items || [])
      .filter((it) => !wantedIds || wantedIds.has(String(it.investigationId)) || wantedIds.has(String(it._id)))
      .map((it) => ({
        investigationId: it.investigationId,
        performedAt:     it.performedAt,
        externalLabName: it.externalLabName,
      }));
    if (!items.length) {
      return sendErr(res, "No items to retest", "VALIDATION", 400);
    }
    const data = await svc.createOrder({
      patientId:     parent.patientId,
      UHID:          parent.UHID,
      patientName:   parent.patientName,
      contactNumber: parent.contactNumber,
      visitType:     parent.visitType,
      admissionId:   parent.admissionId,
      doctorId:      parent.doctorId,
      doctorName:    parent.doctorName,
      doctorNote:    `RETEST of ${parent.orderNumber}: ${String(req.body.reason).trim()}`,
      orderedBy:     parent.orderedBy,
      paymentType:   parent.paymentType,
      tpaId:         parent.tpaId,
      tpaName:       parent.tpaName,
      items,
      priority:      req.body?.priority || "URGENT",
      notes:         `Linked retest of ${parent.orderNumber}`,
    });
    // Patch in the lineage fields (createOrder doesn't accept them).
    await InvestigationOrder.findByIdAndUpdate(data._id, {
      $set: { parentOrderId: parent._id, retestReason: String(req.body.reason).trim() },
    });
    return sendOk(res, data, undefined, 201);
  } catch (e) {
    return sendErr(res, e, "VALIDATION", 400);
  }
};
