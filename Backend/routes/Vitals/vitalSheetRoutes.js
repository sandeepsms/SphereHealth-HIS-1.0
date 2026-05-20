// routes/vitalSheetRoutes.js
//
// R7as-FIX-3/D3-crit: vital-sheet writes gated on `vitals.write` (Admin,
// Doctor, Nurse). Pre-R7as any authenticated user — Pharmacist, Lab Tech,
// Receptionist — could POST/PUT/DELETE vital observations on any patient.
// Reads gated on `vitals.write` too so only clinical roles can see the
// vital chart (PHI minimisation per DPDP purpose-limitation).

const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/Vitals/vitalSheetController");
const validate = require("../../middleware/validateRequest");
const { requireAction } = require("../../middleware/auth");

// Create / Upsert
router.post(
  "/",
  requireAction("vitals.write"),
  validate(["uhid", "date", "tableData", "activeVitals"]),
  ctrl.saveVitalSheet,
);

// Get all sheets for UHID — read-allowed for the same clinical roles.
router.get("/", requireAction("vitals.write"), validate(["uhid"]), ctrl.getVitalSheet);

// Update
router.put(
  "/update",
  requireAction("vitals.write"),
  validate(["uhid", "date"]),
  ctrl.updateVitalSheet,
);

// Delete
router.delete(
  "/delete",
  requireAction("vitals.write"),
  validate(["uhid", "date"]),
  ctrl.deleteVitalSheet,
);

module.exports = router;
