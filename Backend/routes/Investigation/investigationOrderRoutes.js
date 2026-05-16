const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/Investigation/investigationOrderController");
const { attemptAuth, requireAction } = require("../../middleware/auth");

// Soft-auth so lab/radiology results carry the technician's user record.
router.use(attemptAuth);

// Reads — any clinical role
router.get("/summary",        ctrl.getSummary);
router.get("/patient/:UHID",  ctrl.getByUHID);
router.get("/",               ctrl.getAll);
router.get("/:id",            ctrl.getById);

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

// Dispatch + cancel: Lab Technician.
router.post("/:id/print",   requireAction("lab.dispatch"), ctrl.markPrinted);
router.post("/:id/cancel",  requireAction("lab.dispatch"), ctrl.cancel);

module.exports = router;
