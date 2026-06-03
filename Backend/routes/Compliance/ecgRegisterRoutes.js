/**
 * ecgRegisterRoutes.js — R7en / NABH AAC.4 + IPSG.2 + COP.7
 *
 * Endpoints under /api/ecg-register:
 *   POST   /                  — Manual entry (gated on vitals.write)
 *   GET    /                  — List with date-range, ?critical, ?UHID
 *   GET    /:id               — Single row
 *   PATCH  /:id/report        — File report (vitals.write)
 *   PATCH  /:id/review        — Cardiologist sign-off (doctor-orders.write)
 *
 * Reads gated on compliance.read (surveyor + clinical roles). Writes mirror
 * the BloodSugar manual-entry pattern (vitals.write — same tier that
 * captures the underlying vital).
 */
"use strict";

const express = require("express");
const router = express.Router();
const { requireAction } = require("../../middleware/auth");
const { validateObjectIdParam } = require("../../utils/queryGuards");
const ctrl = require("../../controllers/Compliance/ecgRegisterController");

// List + create
router.get("/", requireAction("compliance.read"), ctrl.listECG);
router.post("/", requireAction("vitals.write"), ctrl.createECG);

// Single row
router.get("/:id", validateObjectIdParam("id"), requireAction("compliance.read"), ctrl.getECGById);

// File report — same tier as manual entry; nurse/tech reads the strip
router.patch("/:id/report", validateObjectIdParam("id"), requireAction("vitals.write"), ctrl.reportECG);

// Cardiologist sign-off — doctor-only
router.patch("/:id/review", validateObjectIdParam("id"), requireAction("doctor-orders.write"), ctrl.reviewECG);

module.exports = router;
