const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/Investigation/investigationOrderController");
const { attemptAuth, requireAction } = require("../../middleware/auth");
// R7bm-F9: 400 on a malformed :id before findById throws CastError -> 500.
const { validateObjectIdParam } = require("../../utils/queryGuards");

// Soft-auth so lab/radiology results carry the technician's user record.
router.use(attemptAuth);

// Reads — any clinical role
router.get("/summary",        requireAction("lab.records.read"), ctrl.getSummary);
router.get("/patient/:UHID",  requireAction("lab.records.read"), ctrl.getByUHID);
router.get("/",               requireAction("lab.records.read"), ctrl.getAll);
router.get("/:id",            requireAction("lab.records.read"), validateObjectIdParam("id"), ctrl.getById);

// Writes — gated by action.
// Order entry: Doctor / Receptionist (per ACTIONS.lab.order).
router.post("/",                       requireAction("lab.order"),         ctrl.create);
router.post("/:id/add-test",           validateObjectIdParam("id"), requireAction("lab.order"),         ctrl.addTest);

// Sample collection: Lab Technician / Nurse.
router.post("/:id/collect-sample",     validateObjectIdParam("id"), requireAction("lab.collect"),       ctrl.collectSample);

// Result entry: Lab Technician only (Radiologist verifies separately).
router.post("/:id/enter-results",          validateObjectIdParam("id"), requireAction("lab.result-entry"), ctrl.enterResults);
router.post("/:id/enter-external-result",  validateObjectIdParam("id"), requireAction("lab.result-entry"), ctrl.enterExternalResult);

// Verification: Radiologist / Doctor.
router.post("/:id/verify",  validateObjectIdParam("id"), requireAction("lab.verify"),   ctrl.verify);

// Dispatch (Lab Tech) vs cancel (Doctor/Admin). R7z: cancel splits off
// from dispatch — Lab Tech mustn't be able to wipe a doctor's order or
// reverse line-item billing without the ordering clinician's call.
router.post("/:id/print",   validateObjectIdParam("id"), requireAction("lab.dispatch"), ctrl.markPrinted);
router.post("/:id/cancel",  validateObjectIdParam("id"), requireAction("lab.cancel"),   ctrl.cancel);
// R7bb-FIX-E-13 / D6-HIGH-3: lab retest — clones the order's items into
// a fresh InvestigationOrder linked via parentOrderId. Gate at lab.order
// because retests are a clinical decision (same gate as the original).
router.post("/:id/retest",  validateObjectIdParam("id"), requireAction("lab.order"),    ctrl.requestRetest);

module.exports = router;
