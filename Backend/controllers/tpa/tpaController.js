/**
 * controllers/tpa/tpaController.js
 * ────────────────────────────────────────────────────────────────────
 * R7bh-F8 — full rewrite onto the canonical apiEnvelope.
 *
 * Closes (from AUDIT_R7bg API section):
 *   • CRIT-12 — 6 distinct success shapes → 1 (`{success,data,meta?}`).
 *   • HIGH-5  — TPA master CRUD now consistent across 4 endpoints.
 *                deleteTPA now returns 200 with `{deleted:true}` (204 noBody
 *                breaks current axios consumers that read `r.data.message`,
 *                so we keep a tiny body but normalise the shape).
 *
 * Status codes:
 *   • create  → 201
 *   • get/update → 200
 *   • delete  → 200 with `{deleted:true}` body
 *   • not found → 404 `NOT_FOUND`
 *   • bad input → 400 `VALIDATION`
 *
 * NEVER emits `console.log`. NEVER returns `error.stack`. NEVER mixes
 * `msg` / `error` / `message` keys.
 */

"use strict";

const TPAService = require("../../services/tpa/tpaService");
const { sendOk, sendErr } = require("../../utils/apiEnvelope");

// "not found" semantic detection — the service throws plain Error with a
// message that includes the literal "not found". We surface 404 for these
// and 400 for other write-time validation failures.
function _isNotFound(e) {
  return /not\s*found/i.test(e?.message || "");
}

exports.createTPA = async (req, res) => {
  try {
    const tpa = await TPAService.createTPA(req.body);
    return sendOk(res, tpa, { created: true }, 201);
  } catch (e) {
    return sendErr(res, e, "VALIDATION", 400);
  }
};

exports.getAllTPAs = async (req, res) => {
  try {
    const tpAs = await TPAService.getAllTPAs(req.query);
    return sendOk(res, tpAs, { count: tpAs.length });
  } catch (e) {
    return sendErr(res, e, "SERVER_ERROR", 500);
  }
};

exports.getTPAById = async (req, res) => {
  try {
    const tpa = await TPAService.getTPAById(req.params.id);
    if (!tpa) return sendErr(res, "TPA not found", "NOT_FOUND", 404);
    return sendOk(res, tpa);
  } catch (e) {
    return sendErr(res, e, _isNotFound(e) ? "NOT_FOUND" : "SERVER_ERROR",
      _isNotFound(e) ? 404 : 500);
  }
};

exports.updateTPA = async (req, res) => {
  try {
    const tpa = await TPAService.updateTPA(req.params.id, req.body);
    return sendOk(res, tpa);
  } catch (e) {
    return sendErr(res, e, _isNotFound(e) ? "NOT_FOUND" : "VALIDATION",
      _isNotFound(e) ? 404 : 400);
  }
};

exports.deleteTPA = async (req, res) => {
  try {
    await TPAService.deleteTPA(req.params.id);
    return sendOk(res, { deleted: true });
  } catch (e) {
    return sendErr(res, e, _isNotFound(e) ? "NOT_FOUND" : "VALIDATION",
      _isNotFound(e) ? 404 : 400);
  }
};

exports.getChargesByRoomCategory = async (req, res) => {
  try {
    const charges = await TPAService.getChargesByRoomCategory(
      req.params.tpaId,
      req.params.roomCategoryId,
    );
    if (!charges) {
      return sendErr(res,
        "Charges not found for this TPA and room category",
        "NOT_FOUND", 404);
    }
    const dailyTotal = typeof charges.calculateDailyTotal === "function"
      ? Number(charges.calculateDailyTotal() || 0)
      : 0;
    return sendOk(res, charges, { dailyTotal });
  } catch (e) {
    return sendErr(res, e, _isNotFound(e) ? "NOT_FOUND" : "SERVER_ERROR",
      _isNotFound(e) ? 404 : 500);
  }
};

exports.getTPAByCode = async (req, res) => {
  try {
    const { code } = req.params;
    const tpa = await TPAService.TPA.findByCode(code);
    if (!tpa) return sendErr(res, "TPA not found", "NOT_FOUND", 404);
    return sendOk(res, tpa);
  } catch (e) {
    return sendErr(res, e, "SERVER_ERROR", 500);
  }
};
