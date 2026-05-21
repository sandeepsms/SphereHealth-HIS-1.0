// routes/Patient/bedTransferRoutes.js
const express = require("express");
const router  = express.Router();
const ctrl    = require("../../controllers/Patient/bedTransferController");
// R7q: ipd.transfer gate. Bed transfer is a clinical decision —
// only Admin / Doctor / Nurse can initiate, complete handover,
// or cancel.
const { requireAction } = require("../../middleware/auth");
// R7aw-FIX-1/D2-HIGH-4: ObjectId guard on the :id param so a malformed
// transferId 400s here rather than blowing up as CastError → 500 inside
// the controller's findById.
const { validateObjectIdParam } = require("../../utils/queryGuards");
const vId = validateObjectIdParam("id");

router.post("/",                   requireAction("ipd.transfer"), ctrl.createTransfer);   // Doctor initiates
// R7az-A/D1-CRIT: list GET was ungated pre-R7az — Pharmacist /
// Housekeeping / Ward Boy could enumerate bed transfers (PHI: who is
// being moved where and why). Gated on `ipd.read` (new, mirrors
// ipd.write minus the strict write set).
router.get ("/",                   requireAction("ipd.read"),     ctrl.getTransfers);     // List
router.put ("/:id/handover", vId,  requireAction("ipd.transfer"), ctrl.completeHandover); // Nurse completes
router.put ("/:id/cancel",   vId,  requireAction("ipd.transfer"), ctrl.cancelTransfer);   // Doctor cancels

module.exports = router;
