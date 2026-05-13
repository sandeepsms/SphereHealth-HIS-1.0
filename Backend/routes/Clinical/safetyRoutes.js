// routes/Clinical/safetyRoutes.js
const router = require("express").Router();
const ctrl = require("../../controllers/Clinical/safetyController");

router.post("/critical-result/:id/acknowledge", ctrl.acknowledgeCriticalResult);
router.post("/break-glass",                       ctrl.breakGlassAccess);
router.post("/two-id-confirm",                   ctrl.twoIdentifierConfirm);
router.post("/surgical-checklist",               ctrl.surgicalChecklist);
router.post("/pain-reassessment",                ctrl.painReassessment);

module.exports = router;
