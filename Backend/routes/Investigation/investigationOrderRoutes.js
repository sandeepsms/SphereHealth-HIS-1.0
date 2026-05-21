const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/Investigation/investigationOrderController");
const { attemptAuth, requireAction } = require("../../middleware/auth");

// Soft-auth so lab/radiology results carry the technician's user record.
router.use(attemptAuth);

// R7bb-B/D4-CRIT-S1: every GET on investigation orders now requires
// `lab.records.read` (Admin / Doctor / Nurse / Lab Technician /
// Radiologist / MRD). Pre-R7bb the reads were behind global authenticate
// but had NO per-action gate — Pharmacist / Ward Boy / Housekeeping /
// Security / Receptionist / Accountant could pull every lab + imaging
// order, sample status, and external report for any UHID.
router.get("/summary",        requireAction("lab.records.read"), ctrl.getSummary);
router.get("/patient/:UHID",  requireAction("lab.records.read"), ctrl.getByUHID);
router.get("/",               requireAction("lab.records.read"), ctrl.getAll);
router.get("/:id",            requireAction("lab.records.read"), ctrl.getById);

// Writes — gated by action.
// Order entry: Doctor / Receptionist (per ACTIONS.lab.order).
router.post("/",                       requireAction("lab.order"),         ctrl.create);
router.post("/:id/add-test",           requireAction("lab.order"),         ctrl.addTest);

// Sample collection: Lab Technician / Nurse.
router.post("/:id/collect-sample",     requireAction("lab.collect"),       ctrl.collectSample);

// Result entry: Lab Technician only (Radiologist verifies separately).
router.post("/:id/enter-results",          requireAction("lab.result-entry"), ctrl.enterResults);
router.post("/:id/enter-external-result",  requireAction("lab.result-entry"), ctrl.enterExternalResult);

// Verification: Radiologist / Doctor.
router.post("/:id/verify",  requireAction("lab.verify"),   ctrl.verify);

// Dispatch (Lab Tech) vs cancel (Doctor/Admin). R7z: cancel splits off
// from dispatch — Lab Tech mustn't be able to wipe a doctor's order or
// reverse line-item billing without the ordering clinician's call.
router.post("/:id/print",   requireAction("lab.dispatch"), ctrl.markPrinted);
router.post("/:id/cancel",  requireAction("lab.cancel"),   ctrl.cancel);

module.exports = router;
