// Backend/routes/Pharmacy/indentRoutes.js — Nurse-to-pharmacy drug indent
// workflow. Each endpoint is gated by a specific action token mirrored
// in Frontend/src/config/permissions.js so the UI hides what the API
// will reject.
const express = require("express");
const router  = express.Router();
const ctrl    = require("../../controllers/Pharmacy/indentController");
const { attemptAuth, requireAction } = require("../../middleware/auth");

router.use(attemptAuth);

// Nurse / Doctor raise an indent for an admitted patient
router.post("/",                  requireAction("indent.raise"),    ctrl.create);
// List endpoint serves both the nurse's "my raised indents" view and
// the pharmacist's live queue — auth tier is the loose "indent.read" so
// any clinician/desk role can pull it; query params drive scoping.
router.get ("/",                  requireAction("indent.read"),     ctrl.list);
router.get ("/:id",               requireAction("indent.read"),     ctrl.getOne);
// Pharmacist acknowledges + releases — full pharmacy tier
router.post("/:id/acknowledge",   requireAction("indent.fulfill"),  ctrl.acknowledge);
router.post("/:id/release",       requireAction("indent.fulfill"),  ctrl.release);
// Cancel is shared — either side (nurse raised it in error / pharmacist
// rejects). Permission lets both through; controller logs who did it.
router.post("/:id/cancel",        requireAction("indent.cancel"),   ctrl.cancel);

module.exports = router;
