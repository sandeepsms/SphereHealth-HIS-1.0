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

router.get("/",                  requireAction("compliance.bmw.read"),  ctrl.list);
router.get("/:id",               requireAction("compliance.bmw.read"),  ctrl.getOne);

router.post("/",                 requireAction("compliance.bmw.write"), ctrl.create);
router.put("/:id/handover",      requireAction("compliance.bmw.write"), ctrl.handover);
router.put("/:id/pcb-filed",     requireAction("compliance.bmw.write"), ctrl.markPcbFiled);

module.exports = router;
