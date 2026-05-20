// routes/Clinical/safetyRoutes.js
//
// R7as-FIX-11/D3-high: patient-safety write gating.
//   • critical-result acknowledge — `vitals.write` (Doctor/Nurse)
//   • break-glass — `patient.export` (Admin/Doctor only; emergency PHI
//     unlock requires the strictest gate)
//   • two-ID-confirm / surgical-checklist / pain-reassessment — `mar.write`
// Pre-R7as any authenticated user (Pharmacist, Ward Boy, Dietician) could
// hit break-glass which is the worst hole in this audit.
const router = require("express").Router();
const ctrl = require("../../controllers/Clinical/safetyController");
const { requireAction } = require("../../middleware/auth");

router.post("/critical-result/:id/acknowledge", requireAction("vitals.write"),     ctrl.acknowledgeCriticalResult);
router.post("/break-glass",                     requireAction("patient.export"),   ctrl.breakGlassAccess);
router.post("/two-id-confirm",                  requireAction("mar.write"),        ctrl.twoIdentifierConfirm);
router.post("/surgical-checklist",              requireAction("mar.write"),        ctrl.surgicalChecklist);
router.post("/pain-reassessment",               requireAction("mar.write"),        ctrl.painReassessment);

module.exports = router;
