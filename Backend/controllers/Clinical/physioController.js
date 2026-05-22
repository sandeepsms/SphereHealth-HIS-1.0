/**
 * physioController.js — R7bj-F1.
 *
 * Thin HTTP layer over services/Clinical/physioService.js. Every response
 * goes through utils/apiEnvelope.sendOk / sendErr so the wire shape matches
 * the rest of the HIS (`{ success, data, meta? }` / `{ success, message,
 * code? }`).
 *
 * Endpoint map:
 *   POST   /plans                            201 → createPlan
 *   PUT    /plans/:id                        200 → updatePlan
 *   PUT    /plans/:id/complete               200 → completePlan
 *   PUT    /plans/:id/cancel                 200 → cancelPlan   (reason required)
 *   POST   /plans/:planId/sessions           201 → createSession
 *   PUT    /sessions/:id/complete            200 → completeSession (+ emits BillingTrigger)
 *   PUT    /sessions/:id/cancel              200 → cancelSession (reason required)
 *   GET    /plans?UHID&admissionId&status&from&to            list plans
 *   GET    /sessions?planId&UHID&status&from&to&page&limit   list sessions (paginated)
 *   GET    /stats?from&to&therapistId        dashboard KPIs
 */
"use strict";

const svc = require("../../services/Clinical/physioService");
const { sendOk, sendErr } = require("../../utils/apiEnvelope");

// ── Plans ────────────────────────────────────────────────────
exports.createPlan = async (req, res) => {
  try {
    const plan = await svc.createPlan(req.body || {}, req.user || {});
    return sendOk(res, plan, undefined, 201);
  } catch (e) { return sendErr(res, e); }
};

exports.updatePlan = async (req, res) => {
  try {
    const plan = await svc.updatePlan(req.params.id, req.body || {}, req.user || {});
    return sendOk(res, plan);
  } catch (e) { return sendErr(res, e); }
};

exports.completePlan = async (req, res) => {
  try {
    const plan = await svc.completePlan(req.params.id, req.user || {}, req.body?.reason || "");
    return sendOk(res, plan);
  } catch (e) { return sendErr(res, e); }
};

exports.cancelPlan = async (req, res) => {
  try {
    const plan = await svc.cancelPlan(req.params.id, req.user || {}, req.body?.reason || "");
    return sendOk(res, plan);
  } catch (e) { return sendErr(res, e); }
};

exports.listPlans = async (req, res) => {
  try {
    const rows = await svc.listPlans({
      admissionId: req.query.admissionId,
      UHID:        req.query.UHID || req.query.uhid,
      status:      req.query.status,
      from:        req.query.from,
      to:          req.query.to,
    });
    return sendOk(res, rows, { count: rows.length });
  } catch (e) { return sendErr(res, e); }
};

// ── Sessions ─────────────────────────────────────────────────
exports.createSession = async (req, res) => {
  try {
    const session = await svc.createSession(req.params.planId, req.body || {}, req.user || {});
    return sendOk(res, session, undefined, 201);
  } catch (e) { return sendErr(res, e); }
};

exports.completeSession = async (req, res) => {
  try {
    const session = await svc.completeSession(req.params.id, req.user || {});
    return sendOk(res, session);
  } catch (e) { return sendErr(res, e); }
};

exports.cancelSession = async (req, res) => {
  try {
    const session = await svc.cancelSession(req.params.id, req.user || {}, req.body?.reason || "");
    return sendOk(res, session);
  } catch (e) { return sendErr(res, e); }
};

exports.listSessions = async (req, res) => {
  try {
    const result = await svc.listSessions({
      planId: req.query.planId,
      UHID:   req.query.UHID || req.query.uhid,
      status: req.query.status,
      from:   req.query.from,
      to:     req.query.to,
      page:   req.query.page,
      limit:  req.query.limit,
    });
    return sendOk(res, result.rows, {
      count: result.rows.length,
      total: result.total,
      page:  result.page,
      limit: result.limit,
    });
  } catch (e) { return sendErr(res, e); }
};

// ── Stats ────────────────────────────────────────────────────
exports.stats = async (req, res) => {
  try {
    const data = await svc.statsForTherapist({
      from:        req.query.from,
      to:          req.query.to,
      therapistId: req.query.therapistId,
    });
    return sendOk(res, data);
  } catch (e) { return sendErr(res, e); }
};
