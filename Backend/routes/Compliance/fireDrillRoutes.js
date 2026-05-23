/**
 * fireDrillRoutes.js  (R7bf-G / A5-CRIT-7 / NABH FMS.4)
 *
 * Routes mounted at /api/fire-drills. There is no formal "Safety Officer"
 * role in the User enum today — the Admin + Security cohort is the
 * closest organisational equivalent so writes are scoped to them under
 * `compliance.firedrill.write`. Reads share the same gate (the drill
 * register isn't broadly distributed material).
 */
const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/Compliance/fireDrillController");
const { requireAction } = require("../../middleware/auth");
// R7bm-F9: 400 on a malformed :id before findById throws CastError -> 500.
const { validateObjectIdParam } = require("../../utils/queryGuards");

router.get("/",                requireAction("compliance.firedrill.read"),  ctrl.list);
router.get("/:id",             validateObjectIdParam("id"), requireAction("compliance.firedrill.read"),  ctrl.getOne);

router.post("/",               requireAction("compliance.firedrill.write"), ctrl.create);
router.put("/:id",             validateObjectIdParam("id"), requireAction("compliance.firedrill.write"), ctrl.update);
router.put("/:id/complete",    validateObjectIdParam("id"), requireAction("compliance.firedrill.write"), ctrl.complete);
router.put("/:id/cancel",      validateObjectIdParam("id"), requireAction("compliance.firedrill.write"), ctrl.cancel);

module.exports = router;
