const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/Clinical/diabeticChartController");

// List of dates for a patient
router.get("/:uhid",        ctrl.listByUhid);
// Get sheet for a date
router.get("/:uhid/:date",  ctrl.getByUhidDate);

// Upsert sheet (admissionId + date)
router.post("/", ctrl.upsertSheet);

// Sliding-scale CRUD
router.put("/:id/scale",          ctrl.updateScale);

// Entries
router.post("/:id/entry",                   ctrl.addOrReplaceEntry);
router.put("/:id/entry/:entryId",           ctrl.patchEntry);
router.delete("/:id/entry/:entryId",        ctrl.deleteEntry);

// Helper — given a sheet and a BG value, return recommended dose
router.get("/:id/recommend",                ctrl.recommendDose);

module.exports = router;
