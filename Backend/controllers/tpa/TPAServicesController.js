/**
 * controllers/tpa/TPAServicesController.js
 * ────────────────────────────────────────────────────────────────────
 * R7bh-F8 — full rewrite onto the canonical apiEnvelope.
 *
 * Closes (from AUDIT_R7bg):
 *   • R7bg-3-CRIT-8  — stack-trace leak via
 *       `error: process.env.NODE_ENV === "development" ? error.stack : undefined`
 *      DROPPED. Never expose stack regardless of env (staging mirrors prod
 *      data + the `=== "development"` literal was a bug because NODE_ENV
 *      isn't always set, falling through to `undefined` which JSON.stringify
 *      omits — but the key was still defined in dev with a stack).
 *   • R7bg-5-HIGH-4  — `console.log("Incoming request body:", req.body)` on
 *      every TPA service create. DROPPED — leaks PII (insurance card numbers,
 *      patient identifiers in audit logs).
 *   • R7bg-3-CRIT-12 — envelope unified onto `{success,data,meta?}`.
 *
 * NEVER emits console.log. NEVER returns error.stack. The remaining
 * `console.error` lines are kept (server-side only, not in response payload)
 * because they help on-call diagnose 500s — but the error object alone, no
 * req.body, no PII.
 */

"use strict";

const TPAServiceService = require("../../services/tpa/tpaServiceService");
const { sendOk, sendErr } = require("../../utils/apiEnvelope");

function _classify(e) {
  const msg = e?.message || "";
  if (e?.code === 11000) {
    return { status: 409, code: "DUPLICATE", message: "This TPA service already exists" };
  }
  if (/already\s*exist/i.test(msg)) return { status: 400, code: "DUPLICATE", message: msg };
  if (/not\s*found/i.test(msg))     return { status: 404, code: "NOT_FOUND", message: msg };
  if (/required/i.test(msg))        return { status: 400, code: "VALIDATION", message: msg };
  return { status: 500, code: "SERVER_ERROR", message: msg || "Internal server error" };
}

// Create TPA Service
exports.createTPAService = async (req, res) => {
  try {
    const result = await TPAServiceService.createTPAService(req.body);
    const meta = result._duplicateWarning ? { warning: result._duplicateWarning } : undefined;
    return sendOk(res, result, meta, 201);
  } catch (e) {
    console.error("createTPAService error:", e?.message);
    const c = _classify(e);
    return sendErr(res, c.message, c.code, c.status);
  }
};

// Get All TPA Services
exports.getAllTPAServices = async (req, res) => {
  try {
    const tpaServices = await TPAServiceService.getAllTPAServices(req.query);
    return sendOk(res, tpaServices, { count: tpaServices.length });
  } catch (e) {
    console.error("getAllTPAServices error:", e?.message);
    return sendErr(res, e, "SERVER_ERROR", 500);
  }
};

// Get TPA Service by ID
exports.getTPAServiceById = async (req, res) => {
  try {
    const tpaService = await TPAServiceService.getTPAServiceByTPAId(req.params.id);
    return sendOk(res, tpaService);
  } catch (e) {
    console.error("getTPAServiceById error:", e?.message);
    const c = _classify(e);
    return sendErr(res, c.message, c.code, c.status);
  }
};

// Get TPA Services by TPA ID
exports.getTPAServicesByTPAId = async (req, res) => {
  try {
    const tpaService = await TPAServiceService.getTPAServiceByTPAId(req.params.tpaId);
    return sendOk(res, tpaService);
  } catch (e) {
    console.error("getTPAServicesByTPAId error:", e?.message);
    const c = _classify(e);
    return sendErr(res, c.message, c.code, c.status);
  }
};

// Update TPA Service
exports.updateTPAService = async (req, res) => {
  try {
    const tpaService = await TPAServiceService.updateTPAService(req.params.id, req.body);
    return sendOk(res, tpaService);
  } catch (e) {
    console.error("updateTPAService error:", e?.message);
    const c = _classify(e);
    return sendErr(res, c.message, c.code, c.status);
  }
};

// Delete TPA Service
exports.deleteTPAService = async (req, res) => {
  try {
    await TPAServiceService.deleteTPAService(req.params.id);
    return sendOk(res, { deleted: true });
  } catch (e) {
    console.error("deleteTPAService error:", e?.message);
    const c = _classify(e);
    return sendErr(res, c.message, c.code, c.status);
  }
};

// Add Service
exports.addService = async (req, res) => {
  try {
    const tpaService = await TPAServiceService.addService(req.params.id, req.body);
    return sendOk(res, tpaService, undefined, 201);
  } catch (e) {
    console.error("addService error:", e?.message);
    const c = _classify(e);
    return sendErr(res, c.message, c.code, c.status);
  }
};

// Remove Service
exports.removeService = async (req, res) => {
  try {
    const { serviceId } = req.params;
    const tpaService = await TPAServiceService.removeService(req.params.id, serviceId);
    return sendOk(res, tpaService);
  } catch (e) {
    console.error("removeService error:", e?.message);
    const c = _classify(e);
    return sendErr(res, c.message, c.code, c.status);
  }
};

// Toggle Active Status
exports.toggleActiveStatus = async (req, res) => {
  try {
    const tpaService = await TPAServiceService.toggleActiveStatus(req.params.id);
    return sendOk(res, tpaService, { isActive: !!tpaService.isActive });
  } catch (e) {
    console.error("toggleActiveStatus error:", e?.message);
    const c = _classify(e);
    return sendErr(res, c.message, c.code, c.status);
  }
};

// Search TPA Services
exports.searchTPAServices = async (req, res) => {
  try {
    const { search } = req.query;
    if (!search || String(search).trim() === "") {
      return sendErr(res, "Search term is required", "VALIDATION", 400);
    }
    const tpaServices = await TPAServiceService.searchTPAServices(search);
    return sendOk(res, tpaServices, { count: tpaServices.length });
  } catch (e) {
    console.error("searchTPAServices error:", e?.message);
    return sendErr(res, e, "SERVER_ERROR", 500);
  }
};

// Get Services by Type
exports.getServicesByType = async (req, res) => {
  try {
    const { serviceType } = req.params;
    if (!["fixed", "quantity", "hourly"].includes(serviceType)) {
      return sendErr(res,
        "Invalid service type. Must be: fixed, quantity, or hourly",
        "VALIDATION", 400);
    }
    const tpaServices = await TPAServiceService.getServicesByType(serviceType);
    return sendOk(res, tpaServices, { count: tpaServices.length });
  } catch (e) {
    console.error("getServicesByType error:", e?.message);
    return sendErr(res, e, "SERVER_ERROR", 500);
  }
};

// Get TPA Service Stats
exports.getTPAServiceStats = async (req, res) => {
  try {
    const stats = await TPAServiceService.getTPAServiceStats(req.params.tpaId);
    return sendOk(res, stats);
  } catch (e) {
    console.error("getTPAServiceStats error:", e?.message);
    const c = _classify(e);
    return sendErr(res, c.message, c.code, c.status);
  }
};

// Get All Services
exports.getAllServices = async (_req, res) => {
  try {
    const services = await TPAServiceService.getAllServices();
    return sendOk(res, services, { count: services.length });
  } catch (e) {
    console.error("getAllServices error:", e?.message);
    return sendErr(res, e, "SERVER_ERROR", 500);
  }
};

module.exports = exports;
