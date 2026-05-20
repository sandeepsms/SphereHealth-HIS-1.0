// routes/Patient/bedTransferRoutes.js
const express = require("express");
const router  = express.Router();
const ctrl    = require("../../controllers/Patient/bedTransferController");
// R7q: ipd.transfer gate. Bed transfer is a clinical decision —
// only Admin / Doctor / Nurse can initiate, complete handover,
// or cancel.
const { requireAction } = require("../../middleware/auth");

router.post("/",            requireAction("ipd.transfer"), ctrl.createTransfer);   // Doctor initiates
router.get("/",                                            ctrl.getTransfers);     // List (filter by UHID/status)
router.put("/:id/handover", requireAction("ipd.transfer"), ctrl.completeHandover); // Nurse completes
router.put("/:id/cancel",   requireAction("ipd.transfer"), ctrl.cancelTransfer);   // Doctor cancels

module.exports = router;
