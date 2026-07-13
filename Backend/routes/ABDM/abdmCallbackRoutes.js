/**
 * routes/ABDM/abdmCallbackRoutes.js — inbound ABDM gateway callbacks.
 *
 * Mounted PRE-auth-wall at /api/abdm/v0.5 (the ABDM gateway calls these
 * directly, not via our JWT). Router-level guards: requireAbdmEnabled (503s
 * the whole surface when ABDM is off) + abdmSignature (HMAC verification of
 * the raw callback body). Mounting at the /v0.5 prefix keeps these guards off
 * the authed admin routes mounted at /api/abdm.
 *
 * ABDM async contract: each handler ACKs 202 then replies out-of-band on the
 * matching /on-* endpoint.
 */
"use strict";

const express = require("express");
const router = express.Router();
const { requireAbdmEnabled } = require("../../config/abdm");
const abdmSignature = require("../../middleware/abdmSignature");
const ctrl = require("../../controllers/Abdm/abdmController");

router.use(requireAbdmEnabled, abdmSignature);

// M1 — discovery
router.post("/care-contexts/discover", ctrl.careContextsDiscover);
// M2 — linking
router.post("/links/link/init", ctrl.linkInit);
router.post("/links/link/confirm", ctrl.linkConfirm);
// M3 — consent
router.post("/consents/hip/notify", ctrl.consentHipNotify);
// M4 — health information
router.post("/health-information/hip/request", ctrl.healthInfoHipRequest);

module.exports = router;
