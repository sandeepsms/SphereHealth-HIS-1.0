/**
 * codeResponseRoutes.js  (R7bj-F6 / NABH SEC-CRIT-1 / FMS.5 + COP.18)
 *
 * Routes mounted at /api/code-response. The write gate is broad
 * because any clinician or security staffer on shift can call a code;
 * the read gate covers the same cohort + MRD (audit evidence).
 *
 * Note: /stats is registered BEFORE /:id so "stats" doesn't get parsed
 * as a Mongo ObjectId by getOne.
 */
const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/Compliance/codeResponseController");
const { requireAction } = require("../../middleware/auth");
// R7bm-F9: 400 on a malformed :id before findById throws CastError -> 500.
const { validateObjectIdParam } = require("../../utils/queryGuards");

router.get("/stats",              requireAction("compliance.code-response.read"),  ctrl.stats);
router.get("/",                   requireAction("compliance.code-response.read"),  ctrl.list);
router.get("/:id",                validateObjectIdParam("id"), requireAction("compliance.code-response.read"),  ctrl.getOne);

router.post("/",                  requireAction("compliance.code-response.write"), ctrl.create);
router.put("/:id/responder",      validateObjectIdParam("id"), requireAction("compliance.code-response.write"), ctrl.addResponder);
router.put("/:id/resolve",        validateObjectIdParam("id"), requireAction("compliance.code-response.write"), ctrl.resolve);

module.exports = router;
