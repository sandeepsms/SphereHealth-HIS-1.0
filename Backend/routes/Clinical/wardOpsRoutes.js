/**
 * wardOpsRoutes.js — Ward Boy operations suite.
 *
 * R7bj-F4: validateObjectIdParam on every :id surface.
 */
const express = require("express");
const router  = express.Router();
const ctrl    = require("../../controllers/Clinical/wardOpsController");
const { requireAction } = require("../../middleware/auth");
const { validateObjectIdParam } = require("../../utils/queryGuards");

/* ── Shift attendance — Ward Boy + Admin ───────────────────── */
router.get   ("/shift/current",     requireAction("ward.shift"),    ctrl.shiftCurrent);
router.get   ("/shift/history",     requireAction("ward.shift"),    ctrl.shiftHistory);
router.post  ("/shift/start",       requireAction("ward.shift"),    ctrl.shiftStart);
router.post  ("/shift/end",         requireAction("ward.shift"),    ctrl.shiftEnd);
router.post  ("/shift/break/start", requireAction("ward.shift"),    ctrl.shiftBreakStart);
router.post  ("/shift/break/end",   requireAction("ward.shift"),    ctrl.shiftBreakEnd);

/* ── Equipment issue / return — any Ward Boy or clinical staff */
router.get   ("/equipment",         requireAction("ward.read"),     ctrl.equipmentList);
router.post  ("/equipment/issue",   requireAction("ward.equipment"),ctrl.equipmentIssue);
router.patch ("/equipment/:id/return",
  validateObjectIdParam("id"), requireAction("ward.equipment"), ctrl.equipmentReturn);

/* ── Supplies / linen / BMW — daily upsert ──────────────────── */
router.get   ("/supplies",          requireAction("ward.read"),     ctrl.supplyRecent);
router.post  ("/supplies",          requireAction("ward.supplies"), ctrl.supplyUpsert);

/* ── Code Blue — any clinical role can alert; only doctor/nurse close */
router.get   ("/code-blue",         requireAction("ward.read"),     ctrl.codeBlueList);
router.post  ("/code-blue",         requireAction("ward.code-blue"),ctrl.codeBlueCreate);
router.post  ("/code-blue/:id/respond",
  validateObjectIdParam("id"), requireAction("ward.code-blue.respond"), ctrl.codeBlueAddResponder);
router.post  ("/code-blue/:id/close",
  validateObjectIdParam("id"), requireAction("ward.code-blue.respond"), ctrl.codeBlueClose);

/* ── Mortuary register — sensitive; tighter audience ──────── */
router.get   ("/mortuary",          requireAction("ward.mortuary"), ctrl.mortuaryList);
router.post  ("/mortuary/declare",  requireAction("ward.mortuary"), ctrl.mortuaryDeclare);
router.patch ("/mortuary/:id/shift",
  validateObjectIdParam("id"), requireAction("ward.mortuary"), ctrl.mortuaryShift);
router.patch ("/mortuary/:id/handover",
  validateObjectIdParam("id"), requireAction("ward.mortuary"), ctrl.mortuaryHandover);

/* ── Manager KPI dashboard — Admin + Nurse-in-charge ──────── */
router.get   ("/manager-stats",     requireAction("ward.manage"),   ctrl.managerStats);

module.exports = router;
