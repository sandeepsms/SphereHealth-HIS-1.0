// R7au-FIX-12/D3-HIGH: nursing care-plan writes gated on `mar.write`
// (Admin / Nurse). Pre-R7au any authenticated user could create / edit
// / complete / delete a care plan. NABH IPSG-mandated record.
const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/Nurse/nursingCarePlanController");
const { requireAction } = require("../../middleware/auth");

router.get   ("/uhid/:uhid",                          ctrl.getByUHID);
router.get   ("/ipd/:ipdNo",                          ctrl.getByIPD);
router.get   ("/admission/:admissionId",              ctrl.getByAdmission);
router.post  ("/",                                    requireAction("mar.write"), ctrl.create);
router.get   ("/:id",                                 ctrl.getById);
router.put   ("/:id",                                 requireAction("mar.write"), ctrl.update);
router.patch ("/:id/problem/:problemId/status",       requireAction("mar.write"), ctrl.updateProblemStatus);
router.patch ("/:id/complete",                        requireAction("mar.write"), ctrl.complete);
router.delete("/:id",                                 requireAction("mar.write"), ctrl.delete);

module.exports = router;
