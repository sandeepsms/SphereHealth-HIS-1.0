/**
 * nabhRegisterRoutes.js — R7bo
 *
 * Read endpoints for the NABH compliance registers. Mount under
 * /api/registers/nabh in the main router.
 *
 * All reads gated on `compliance.read` (per existing pattern from
 * fireDrillRoutes etc.). Manual blood-sugar POST gated on `vitals.write`
 * since it's the same population creating the underlying vital.
 */
"use strict";

const express = require("express");
const router = express.Router();
const { requireAction } = require("../../middleware/auth");
const { validateObjectIdParam } = require("../../utils/queryGuards");
const ctrl = require("../../controllers/Compliance/nabhRegisterController");

// Dashboard summary — surveyor's NABH Inspection Dashboard
router.get("/dashboard-summary", requireAction("compliance.read"), ctrl.dashboardSummary);

// Blood Sugar (RBS) register
router.get("/blood-sugar", requireAction("compliance.read"), ctrl.listBloodSugar);
router.post("/blood-sugar", requireAction("vitals.write"), ctrl.createBloodSugar);

// Emergency register
router.get("/emergency", requireAction("compliance.read"), ctrl.listEmergency);

// Blood Transfusion register
router.get("/blood-transfusion", requireAction("compliance.read"), ctrl.listBloodTransfusion);
router.post("/blood-transfusion", requireAction("doctor-orders.write"), ctrl.createBloodTransfusion);

// R7bp — auto-populated from NursingAssessment saves
router.get("/pain",            requireAction("compliance.read"), ctrl.listPain);
router.get("/fall-risk",       requireAction("compliance.read"), ctrl.listFallRisk);
router.get("/pressure-ulcer",  requireAction("compliance.read"), ctrl.listPressureUlcer);
router.get("/dvt",             requireAction("compliance.read"), ctrl.listDVT);

module.exports = router;
