const express = require("express");
const router  = express.Router();
const ctrl    = require("../../controllers/VisitorPass/visitorPassController");
const { requireAction } = require("../../middleware/auth");

// R7ab: writes now gated on reception.visitor-pass (Admin/Receptionist/
// Security). Pre-R7ab any authenticated role could issue or revoke
// visitor passes — Pharmacist, Lab Tech, Dietician, etc.
//
// R7bb-B/D4-HIGH-S1: reads now also gated. The pass list exposes
// visitor name + photo URL + patient UHID being visited + relationship
// — PHI by association (visitor pattern can identify VIP / restricted-
// access patients). Same role set as the writes since the security desk
// and reception are the audience.
router.post("/",                  requireAction("reception.visitor-pass"), ctrl.issuePass);
router.get ("/",                  requireAction("reception.visitor-pass"), ctrl.listPasses);
router.get ("/active-count",      requireAction("reception.visitor-pass"), ctrl.activeCount);
router.get ("/stats",             requireAction("reception.visitor-pass"), ctrl.stats);
router.post("/:id/return",        requireAction("reception.visitor-pass"), ctrl.returnPass);
router.post("/:id/revoke",        requireAction("reception.visitor-pass"), ctrl.revokePass);

module.exports = router;
