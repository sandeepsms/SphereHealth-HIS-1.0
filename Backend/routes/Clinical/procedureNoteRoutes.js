/**
 * procedureNoteRoutes.js — NABH COP.10 evidence
 *
 * Routes mounted at /api/procedure-notes. Writes are restricted to
 * the doctor-orders cohort (`doctor-orders.write` — Admin + Doctor)
 * since a procedure note finalises a previously authored OT order.
 * Reads are open to the surveyor-facing compliance.read cohort
 * (Admin + Doctor + Nurse + MRD) so the OT Register page can
 * drill-into the underlying note for audit evidence.
 */
"use strict";

const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/Clinical/procedureNoteController");
const { requireAction } = require("../../middleware/auth");
const { validateObjectIdParam } = require("../../utils/queryGuards");

// Reads
router.get("/",                                requireAction("compliance.read"),     ctrl.list);
router.get("/order/:orderId",
  validateObjectIdParam("orderId"),            requireAction("compliance.read"),     ctrl.getByOrder);
router.get("/:id",
  validateObjectIdParam("id"),                 requireAction("compliance.read"),     ctrl.getOne);

// Writes — Admin + Doctor only (matches doctor-orders.write cohort)
router.post("/",                               requireAction("doctor-orders.write"), ctrl.create);

module.exports = router;
