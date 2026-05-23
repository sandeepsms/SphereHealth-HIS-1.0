/**
 * physioRoutes.js — R7bj-F1.
 *
 * Mounted at /api/physio by Backend/routes/index.js. Read endpoints gate
 * on `physio.plan.read` / `physio.session.read`; write endpoints gate on
 * `physio.plan.write` / `physio.session.write`. The wiring agent (parent)
 * owns the permissions.js entries — see the wiring contract at the bottom
 * of the agent brief.
 *
 * URL design intentionally mirrors the Diet module: plans live at /plans,
 * sessions are nested under /plans/:planId/sessions for the create path
 * (sessions inherit context from their parent plan) and at the flat
 * /sessions/:id for transitions / lookups.
 */
"use strict";

const express = require("express");
const router  = express.Router();
const ctrl    = require("../../controllers/Clinical/physioController");
const { requireAction } = require("../../middleware/auth");
const { credentialExpiryBlocker } = require("../../middleware/credentialExpiryBlocker");
const { validateObjectIdParam } = require("../../utils/queryGuards");

// ── Plans ────────────────────────────────────────────────────
router.get   ("/plans",
  requireAction("physio.plan.read"),
  ctrl.listPlans);

router.post  ("/plans",
  requireAction("physio.plan.write"),
  ctrl.createPlan);

router.put   ("/plans/:id",
  validateObjectIdParam("id"),
  requireAction("physio.plan.write"),
  ctrl.updatePlan);

router.put   ("/plans/:id/complete",
  validateObjectIdParam("id"),
  requireAction("physio.plan.write"),
  ctrl.completePlan);

router.put   ("/plans/:id/cancel",
  validateObjectIdParam("id"),
  requireAction("physio.plan.write"),
  ctrl.cancelPlan);

// ── Sessions ─────────────────────────────────────────────────
router.post  ("/plans/:planId/sessions",
  validateObjectIdParam("planId"),
  requireAction("physio.session.write"),
  ctrl.createSession);

// R7bm-F8 / R7bl close-out: completing a physio session is a licensed
// clinical act under NABH HRD.3 — the therapist's IAP (Indian Association
// of Physiotherapists) registration MUST be current. credentialExpiryBlocker
// runs AFTER requireAction so the role gate fires first; on missing /
// expired IAP_REG it 403s with code CREDENTIAL_MISSING|CREDENTIAL_EXPIRED.
router.put   ("/sessions/:id/complete",
  validateObjectIdParam("id"),
  requireAction("physio.session.write"),
  credentialExpiryBlocker("IAP_REG"),
  ctrl.completeSession);

router.put   ("/sessions/:id/cancel",
  validateObjectIdParam("id"),
  requireAction("physio.session.write"),
  ctrl.cancelSession);

router.get   ("/sessions",
  requireAction("physio.session.read"),
  ctrl.listSessions);

// ── Dashboard / stats ────────────────────────────────────────
router.get   ("/stats",
  requireAction("physio.plan.read"),
  ctrl.stats);

module.exports = router;
