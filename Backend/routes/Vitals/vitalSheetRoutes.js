// routes/vitalSheetRoutes.js

const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/Vitals/vitalSheetController");
const validate = require("../../middleware/validateRequest");

// Create / Upsert
router.post(
  "/",
  validate(["uhid", "date", "tableData", "activeVitals"]),
  ctrl.saveVitalSheet,
);

// Get all sheets for UHID
router.get("/", validate(["uhid"]), ctrl.getVitalSheet);

// Update
router.put("/update", validate(["uhid", "date"]), ctrl.updateVitalSheet);

// Delete
router.delete("/delete", validate(["uhid", "date"]), ctrl.deleteVitalSheet);

module.exports = router;
