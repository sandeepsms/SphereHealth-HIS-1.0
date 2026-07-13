/**
 * routes/ABDM/abdmAdminRoutes.js — ABDM admin / ops surface.
 * Mounted POST-auth-wall at /api/abdm (JWT + abdm.* tokens).
 *   GET  /status               config + counts (works even when ABDM disabled)
 *   POST /link-abha            link an ABHA to a UHID + materialise care contexts
 *   GET  /care-contexts/:uhid  list a patient's linked care contexts
 *   GET  /fhir-preview/:uhid   preview the FHIR R4 document bundle (local gen)
 *   GET  /transactions         gateway transaction journal
 */
"use strict";

const express = require("express");
const router = express.Router();
const { requireAction } = require("../../middleware/auth");
const ctrl = require("../../controllers/Abdm/abdmController");

router.get("/status",              requireAction("abdm.read"),  ctrl.getStatus);
router.get("/care-contexts/:uhid", requireAction("abdm.read"),  ctrl.listCareContexts);
router.get("/fhir-preview/:uhid",  requireAction("abdm.read"),  ctrl.fhirPreview);
router.get("/transactions",        requireAction("abdm.read"),  ctrl.listTransactions);
router.post("/link-abha",          requireAction("abdm.write"), ctrl.linkAbha);

module.exports = router;
