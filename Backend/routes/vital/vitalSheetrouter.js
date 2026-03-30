const express = require("express");
const router = express.Router();

const {
  saveVitalSheet,
  getVitalSheet,
  updateVitalSheet,
  deleteVitalSheet
} = require("../../controllers/vital/vitalSheetController");

const validate = require("../middleware/validateRequest");

// Create / Insert / Upsert
router.post(
  "/",
  validate(["uhid", "date", "tableData", "activeVitals"]),
  saveVitalSheet
);

// Get all sheets for UHID
router.get(
  "/",
  validate(["uhid"]),  
  getVitalSheet
);

// Update vital sheet using date + uhid
router.put(
  "/update",
  validate(["uhid", "date"]),
  updateVitalSheet
);

// Delete vital sheet using date + uhid
router.delete(
  "/delete",
  validate(["uhid", "date"]),
  deleteVitalSheet
);

module.exports = router;
