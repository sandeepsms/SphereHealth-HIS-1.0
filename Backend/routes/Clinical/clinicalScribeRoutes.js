// routes/Clinical/clinicalScribeRoutes.js
// AI Clinical Documentation Assistant (ambient scribe). Turns a consult
// transcript into a structured clinical-note DRAFT for the doctor to review +
// apply. Feature-flagged by the presence of ANTHROPIC_API_KEY (the /status
// endpoint reports it so the UI can hide itself on stock deployments).
"use strict";

const express = require("express");
const router = express.Router();
const { requireAction } = require("../../middleware/auth");
const ctrl = require("../../controllers/Clinical/clinicalScribeController");

// Gated on clinical.scribe = [Admin, Doctor]. The service never writes a
// clinical record — the doctor saves/signs via the normal note flow.
router.get("/status", requireAction("clinical.scribe"), ctrl.status);
router.post("/structure", requireAction("clinical.scribe"), ctrl.structure);

module.exports = router;
