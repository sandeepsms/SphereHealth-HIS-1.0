// R7au-FIX-12/D3-HIGH: insulin sliding-scale + BG chart writes gated on
// `mar.write` (Admin / Nurse). Pre-R7au any authenticated user could
// rewrite the insulin scale or BG entries — patient-safety critical.
const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/Clinical/diabeticChartController");
const { requireAction } = require("../../middleware/auth");

// List of dates for a patient
router.get("/:uhid",        ctrl.listByUhid);
// Get sheet for a date
router.get("/:uhid/:date",  ctrl.getByUhidDate);

// Upsert sheet (admissionId + date)
router.post("/",                            requireAction("mar.write"), ctrl.upsertSheet);

// Sliding-scale CRUD.
// R7az-A/D9-HIGH: scale is a prescribing decision — the threshold
// values dictate dosing. Doctor-only via `diabetic.scale.write`
// (Admin+Doctor). Pre-R7az this sat on mar.write (Admin+Nurse) which
// let nurses rewrite the dose table.
router.put("/:id/scale",                    requireAction("diabetic.scale.write"), ctrl.updateScale);

// Entries — nurse charts a BG reading + administers per scale.
router.post  ("/:id/entry",                 requireAction("mar.write"), ctrl.addOrReplaceEntry);
router.put   ("/:id/entry/:entryId",        requireAction("mar.write"), ctrl.patchEntry);
router.delete("/:id/entry/:entryId",        requireAction("mar.write"), ctrl.deleteEntry);

// Helper — given a sheet and a BG value, return recommended dose
router.get("/:id/recommend",                ctrl.recommendDose);

module.exports = router;
