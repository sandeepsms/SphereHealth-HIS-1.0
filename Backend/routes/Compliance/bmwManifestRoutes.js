/**
 * bmwManifestRoutes.js  (R7bj-F6 / NABH WB-CRIT-1 / BMW Rules 2016)
 *
 * Routes mounted at /api/bmw-manifest. Writes are scoped to the cohort
 * that physically handles bio-medical waste (Admin / Housekeeping /
 * Ward Boy). Reads add MRD because the manifest is part of the BMW
 * record-keeping evidence that auditors request.
 */
const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/Compliance/bmwManifestController");
const { requireAction } = require("../../middleware/auth");
const { credentialExpiryBlocker } = require("../../middleware/credentialExpiryBlocker");
const { validateObjectIdParam } = require("../../utils/queryGuards");

router.get("/",                  requireAction("compliance.bmw.read"),  ctrl.list);
router.get("/:id",               validateObjectIdParam("id"), requireAction("compliance.bmw.read"),  ctrl.getOne);

router.post("/",                 requireAction("compliance.bmw.write"), ctrl.create);

// R7bm-F8 / R7bl close-out: handover is the sign-off moment where the
// BMW Rules 2016 trained handler accepts the bio-medical-waste
// consignment for transport. The handler MUST hold current
// BMW-handler training. credentialExpiryBlocker runs AFTER the role
// gate; on missing / expired BMW_HANDLER it 403s with
// CREDENTIAL_MISSING | CREDENTIAL_EXPIRED.
router.put("/:id/handover",      validateObjectIdParam("id"), requireAction("compliance.bmw.write"),
                                 credentialExpiryBlocker("BMW_HANDLER"),
                                 ctrl.handover);
router.put("/:id/pcb-filed",     validateObjectIdParam("id"), requireAction("compliance.bmw.write"), ctrl.markPcbFiled);

module.exports = router;
