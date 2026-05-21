// R7au-FIX-12/D3-HIGH: nursing care-plan writes gated on `mar.write`
// (Admin / Nurse). Pre-R7au any authenticated user could create / edit
// / complete / delete a care plan. NABH IPSG-mandated record.
const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/Nurse/nursingCarePlanController");
const { requireAction } = require("../../middleware/auth");

// R7bb-B/D4-CRIT-S1: nursing-care-plan reads now gated on `nurse-notes.read`
// (Admin / Doctor / Nurse / MRD). Pre-R7bb any authenticated role could
// pull NABH-IPSG nursing care plans (problem list + interventions + plan
// of care = full clinical narrative).
router.get   ("/uhid/:uhid",                          requireAction("nurse-notes.read"), ctrl.getByUHID);
router.get   ("/ipd/:ipdNo",                          requireAction("nurse-notes.read"), ctrl.getByIPD);
router.get   ("/admission/:admissionId",              requireAction("nurse-notes.read"), ctrl.getByAdmission);
router.post  ("/",                                    requireAction("mar.write"), ctrl.create);
router.get   ("/:id",                                 requireAction("nurse-notes.read"), ctrl.getById);
router.put   ("/:id",                                 requireAction("mar.write"), ctrl.update);
router.patch ("/:id/problem/:problemId/status",       requireAction("mar.write"), ctrl.updateProblemStatus);
router.patch ("/:id/complete",                        requireAction("mar.write"), ctrl.complete);
router.delete("/:id",                                 requireAction("mar.write"), ctrl.delete);

module.exports = router;
