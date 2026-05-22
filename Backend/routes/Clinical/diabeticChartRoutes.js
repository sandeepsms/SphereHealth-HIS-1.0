// R7au-FIX-12/D3-HIGH: insulin sliding-scale + BG chart writes gated on
// `mar.write` (Admin / Nurse). Pre-R7au any authenticated user could
// rewrite the insulin scale or BG entries — patient-safety critical.
const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/Clinical/diabeticChartController");
const { requireAction } = require("../../middleware/auth");
// R7bm-F9: 400 on a malformed :id before findById throws CastError -> 500.
const { validateObjectIdParam } = require("../../utils/queryGuards");

// R7bb-B/D4-MED-S1: diabetic-chart reads now gated on `mar.read`
// (Admin / Doctor / Nurse / MRD). Pre-R7bb any authenticated role could
// pull every BG entry + insulin dose chart for any UHID — full medication
// administration record subset.
// List of dates for a patient
router.get("/:uhid",        requireAction("mar.read"), ctrl.listByUhid);
// Get sheet for a date
router.get("/:uhid/:date",  requireAction("mar.read"), ctrl.getByUhidDate);

// Upsert sheet (admissionId + date)
router.post("/",                            requireAction("mar.write"), ctrl.upsertSheet);

// Sliding-scale CRUD.
// R7az-A/D9-HIGH: scale is a prescribing decision — the threshold
// values dictate dosing. Doctor-only via `diabetic.scale.write`
// (Admin+Doctor). Pre-R7az this sat on mar.write (Admin+Nurse) which
// let nurses rewrite the dose table.
router.put("/:id/scale",                    validateObjectIdParam("id"), requireAction("diabetic.scale.write"), ctrl.updateScale);

// Entries — nurse charts a BG reading + administers per scale.
router.post  ("/:id/entry",                 requireAction("mar.write"), ctrl.addOrReplaceEntry);
router.put   ("/:id/entry/:entryId",        requireAction("mar.write"), ctrl.patchEntry);
router.delete("/:id/entry/:entryId",        validateObjectIdParam("id"), requireAction("mar.write"), ctrl.deleteEntry);

// Helper — given a sheet and a BG value, return recommended dose
router.get("/:id/recommend",                validateObjectIdParam("id"), requireAction("mar.read"), ctrl.recommendDose);

module.exports = router;
