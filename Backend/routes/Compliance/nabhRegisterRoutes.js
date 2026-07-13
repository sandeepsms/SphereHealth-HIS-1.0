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
// NABH COP.13 — progressive monitoring workflow (cross-match → start →
// intra-vitals → complete → reaction). Nursing/doctor write.
router.patch("/blood-transfusion/:id/cross-match", requireAction("doctor-orders.write"), ctrl.crossMatchBloodTransfusion);
router.patch("/blood-transfusion/:id/start",       requireAction("doctor-orders.write"), ctrl.startBloodTransfusion);
router.patch("/blood-transfusion/:id/intra-vitals",requireAction("doctor-orders.write"), ctrl.addIntraVitalsBloodTransfusion);
router.patch("/blood-transfusion/:id/complete",    requireAction("doctor-orders.write"), ctrl.completeBloodTransfusion);
router.patch("/blood-transfusion/:id/reaction",    requireAction("doctor-orders.write"), ctrl.reactionBloodTransfusion);

// R7bp — auto-populated from NursingAssessment saves
router.get("/pain",            requireAction("compliance.read"), ctrl.listPain);
router.get("/fall-risk",       requireAction("compliance.read"), ctrl.listFallRisk);
router.get("/pressure-ulcer",  requireAction("compliance.read"), ctrl.listPressureUlcer);
router.get("/dvt",             requireAction("compliance.read"), ctrl.listDVT);

// R7bx — six new NABH registers (COP.10/13/16/17/18 + MOM.7)
// All gated on compliance.read (Admin + Doctor + Nurse + MRD) to match
// the surveyor-access policy used by the other NABH register endpoints.
router.get("/ot-register",            requireAction("compliance.read"), ctrl.listOT);
router.get("/asa-register",           requireAction("compliance.read"), ctrl.listASA);
router.get("/readmission-register",   requireAction("compliance.read"), ctrl.listReadmission);
router.get("/mortality-register",     requireAction("compliance.read"), ctrl.listMortality);
// NABH COP.18 — record the mortality-review committee's decision (write tier).
router.patch("/mortality-register/:id", validateObjectIdParam("id"), requireAction("compliance.nabh.write"), ctrl.reviewMortality);
router.get("/restraint-register",     requireAction("compliance.read"), ctrl.listRestraint);
router.get("/antimicrobial-register", requireAction("compliance.read"), ctrl.listAntimicrobial);

module.exports = router;
