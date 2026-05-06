// routes/Patient/bedTransferRoutes.js
const express = require("express");
const router  = express.Router();
const ctrl    = require("../../controllers/Patient/bedTransferController");

router.post("/",               ctrl.createTransfer);   // Doctor initiates
router.get("/",                ctrl.getTransfers);     // List (filter by UHID/status)
router.put("/:id/handover",    ctrl.completeHandover); // Nurse completes
router.put("/:id/cancel",      ctrl.cancelTransfer);   // Doctor cancels

module.exports = router;
