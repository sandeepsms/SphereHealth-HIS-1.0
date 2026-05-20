const express = require("express");
const router  = express.Router();
const ctrl    = require("../../controllers/VisitorPass/visitorPassController");
const { requireAction } = require("../../middleware/auth");

// R7ab: writes now gated on reception.visitor-pass (Admin/Receptionist/
// Security). Pre-R7ab any authenticated role could issue or revoke
// visitor passes — Pharmacist, Lab Tech, Dietician, etc. The reads
// stay open to the receptionist's broader workflow.
router.post("/",                  requireAction("reception.visitor-pass"), ctrl.issuePass);
router.get ("/",                  ctrl.listPasses);
router.get ("/active-count",      ctrl.activeCount);
router.get ("/stats",             ctrl.stats);
router.post("/:id/return",        requireAction("reception.visitor-pass"), ctrl.returnPass);
router.post("/:id/revoke",        requireAction("reception.visitor-pass"), ctrl.revokePass);

module.exports = router;
