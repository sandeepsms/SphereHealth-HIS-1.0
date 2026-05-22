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

router.get("/",                requireAction("compliance.firedrill.read"),  ctrl.list);
router.get("/:id",             requireAction("compliance.firedrill.read"),  ctrl.getOne);

router.post("/",               requireAction("compliance.firedrill.write"), ctrl.create);
router.put("/:id",             requireAction("compliance.firedrill.write"), ctrl.update);
router.put("/:id/complete",    requireAction("compliance.firedrill.write"), ctrl.complete);
router.put("/:id/cancel",      requireAction("compliance.firedrill.write"), ctrl.cancel);

module.exports = router;
