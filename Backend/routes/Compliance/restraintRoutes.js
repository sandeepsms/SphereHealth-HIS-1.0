/**
 * restraintRoutes.js — R7du / NABH COP.17
 *
 * Mounted at /api/restraints. Thin write surface that the nurse-side
 * Restraint Register page (Frontend/src/pages/nursing/RestraintEntryPage.jsx)
 * uses to log a restraint episode. The actual row is written by
 * nabhRegisterEmitter.emitRestraint inside the controller — there is no
 * separate Restraint model write.
 *
 * Permission rationale: restraint application is a bedside-nurse action
 * triggered by a doctor's plain-text nursing-communication order, so the
 * write gate matches the rest of the nursing-assessment surface
 * (`mar.write` = Admin + Nurse). Reads use `mar.read` (Admin + Doctor +
 * Nurse + MRD) so cross-cover doctors and MRD audit see the trail
 * without holding write privilege.
 */
"use strict";

const express = require("express");
const router  = express.Router();
const { requireAction } = require("../../middleware/auth");
const { validateObjectIdParam } = require("../../utils/queryGuards");
const ctrl = require("../../controllers/Compliance/restraintController");

// POST /api/restraints — create a restraint episode
router.post("/", requireAction("mar.write"), ctrl.create);

// GET /api/restraints/:uhid — list episodes for a patient
router.get("/:uhid", requireAction("mar.read"), ctrl.listByUhid);

// PATCH /api/restraints/:id/remove — mark active episode as Removed
router.patch("/:id/remove", validateObjectIdParam("id"), requireAction("mar.write"), ctrl.markRemoved);

// POST /api/restraints/:id/monitor — append monitoring log entry
router.post("/:id/monitor", validateObjectIdParam("id"), requireAction("mar.write"), ctrl.addMonitoringEntry);

module.exports = router;
