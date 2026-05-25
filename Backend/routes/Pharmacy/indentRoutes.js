// Backend/routes/Pharmacy/indentRoutes.js — Nurse-to-pharmacy drug indent
// workflow. Each endpoint is gated by a specific action token mirrored
// in Frontend/src/config/permissions.js so the UI hides what the API
// will reject.
//
// R7bh-F4 / R7bg-3-CRIT-2: every :id route now runs through
// validateObjectIdParam so a malformed id surfaces as a uniform 400
// before hitting the controller (previously some paths CastError'd 500).
const express = require("express");
const router  = express.Router();
const ctrl    = require("../../controllers/Pharmacy/indentController");
const { attemptAuth, requireAction } = require("../../middleware/auth");
const { validateObjectIdParam } = require("../../utils/queryGuards");
const { requireHospitalMode } = require("../../config/pharmacyMode");

router.use(attemptAuth);
// R7cs — Indents are an admission-coupled feature (nurse raises against
// an active IPD admission, pharmacist fulfils against the patient's
// auto-bill). In a standalone retail pharmacy deployment there are no
// admissions, so the entire indents surface returns 404 (defence-in-
// depth alongside the frontend tab being hidden when VITE_PHARMACY_MODE
// === standalone).
router.use(requireHospitalMode);

// Nurse / Doctor raise an indent for an admitted patient
router.post("/",                  requireAction("indent.raise"),    ctrl.create);
// List endpoint serves both the nurse's "my raised indents" view and
// the pharmacist's live queue — auth tier is the loose "indent.read" so
// any clinician/desk role can pull it; query params drive scoping.
router.get ("/",                  requireAction("indent.read"),     ctrl.list);
router.get ("/:id",               validateObjectIdParam("id"), requireAction("indent.read"),     ctrl.getOne);
// Pharmacist acknowledges + releases — full pharmacy tier
router.post("/:id/acknowledge",   validateObjectIdParam("id"), requireAction("indent.fulfill"),  ctrl.acknowledge);
router.post("/:id/release",       validateObjectIdParam("id"), requireAction("indent.fulfill"),  ctrl.release);
// Cancel is shared — either side (nurse raised it in error / pharmacist
// rejects). Permission lets both through; controller logs who did it.
router.post("/:id/cancel",        validateObjectIdParam("id"), requireAction("indent.cancel"),   ctrl.cancel);

module.exports = router;
