// R7au-FIX-12/D3-HIGH: nursing care-plan writes gated on `mar.write`
// (Admin / Nurse). Pre-R7au any authenticated user could create / edit
// / complete / delete a care plan. NABH IPSG-mandated record.
const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/Nurse/nursingCarePlanController");
const { requireAction } = require("../../middleware/auth");
// R7bm-F9: 400 on a malformed :id before findById throws CastError -> 500.
const { validateObjectIdParam } = require("../../utils/queryGuards");

// R7bb-FIX-C-1/S1 (D4-CRIT): nursing-care-plan reads now gated on the
// new explicit `nursing.care-plan.read` (Admin / Doctor / Nurse / MRD)
// instead of the generic `nurse-notes.read`. Same audience; the
// dedicated token makes audit-grep find every care-plan touch
// independently from the wider nurse-notes surface.
router.get   ("/uhid/:uhid",                          requireAction("nursing.care-plan.read"), ctrl.getByUHID);
router.get   ("/ipd/:ipdNo",                          requireAction("nursing.care-plan.read"), ctrl.getByIPD);
router.get   ("/admission/:admissionId",              requireAction("nursing.care-plan.read"), ctrl.getByAdmission);
router.post  ("/",                                    requireAction("mar.write"), ctrl.create);
router.get   ("/:id",                                 validateObjectIdParam("id"), requireAction("nursing.care-plan.read"), ctrl.getById);
router.put   ("/:id",                                 validateObjectIdParam("id"), requireAction("mar.write"), ctrl.update);
router.patch ("/:id/problem/:problemId/status",       validateObjectIdParam("id"), validateObjectIdParam("problemId"), requireAction("mar.write"), ctrl.updateProblemStatus);
router.patch ("/:id/complete",                        validateObjectIdParam("id"), requireAction("mar.write"), ctrl.complete);
router.delete("/:id",                                 validateObjectIdParam("id"), requireAction("mar.write"), ctrl.delete);

module.exports = router;
