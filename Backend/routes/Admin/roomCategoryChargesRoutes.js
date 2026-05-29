/**
 * roomCategoryChargesRoutes.js — R7en
 *
 * Mounts the per-room-category daily-charges matrix endpoints at
 * /api/admin/room-charges. The route file mirrors the convention
 * used by doctorRoutes.js (R7dp) — reads gated on billing.read so
 * Receptionist / Accountant can see the matrix on the IPD Live
 * Ledger, writes gated on doctors.write (Admin only) for the
 * master-data edits. The single legitimate "Accountant edits a
 * room price" workflow goes through a separate masters.write
 * action in a later cycle; for now an Admin needs to apply the
 * change.
 *
 * Mounted from routes/index.js (added in this same cycle).
 */
"use strict";
const express = require("express");
const router = express.Router();
const { requireAction } = require("../../middleware/auth");
const ctrl = require("../../controllers/Admin/roomCategoryChargesController");

// ── Reads (Admin / Accountant / Receptionist / TPA) ─────────────
router.get("/",          requireAction("billing.read"),  ctrl.list);
// R7ep — Auto-discover MUST sit above the `/:id` route or Express
// would route "/discover" into getOne(req.params.id = "discover").
router.get("/discover",  requireAction("billing.read"),  ctrl.discover);
router.get("/:id",       requireAction("billing.read"),  ctrl.getOne);

// ── Writes (Admin only, mirrors doctors.write) ──────────────────
router.post("/",             requireAction("doctors.write"), ctrl.create);
router.put("/:id",           requireAction("doctors.write"), ctrl.update);
router.delete("/:id",        requireAction("doctors.write"), ctrl.remove);
router.post("/seed",         requireAction("doctors.write"), ctrl.seedDefaults);
// R7ep — bulk-create matrix rows for discovered missing categories.
router.post("/auto-import",  requireAction("doctors.write"), ctrl.autoImport);

module.exports = router;
