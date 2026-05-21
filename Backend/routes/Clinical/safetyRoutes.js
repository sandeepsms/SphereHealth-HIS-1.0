// routes/Clinical/safetyRoutes.js
//
// R7as-FIX-11/D3-high: patient-safety write gating.
//   • critical-result acknowledge — `vitals.write` (Doctor/Nurse)
//   • break-glass — `patient.export` (Admin/Doctor only; emergency PHI
//     unlock requires the strictest gate)
//   • two-ID-confirm / surgical-checklist / pain-reassessment — moved off
//     `mar.write` to `safety.write` per R7az-A so Doctors are included
//     (mar.write is Admin/Nurse-only and a doctor must be able to confirm
//     two-ID and sign the surgical checklist).
const router = require("express").Router();
const ctrl = require("../../controllers/Clinical/safetyController");
const { requireAction } = require("../../middleware/auth");

router.post("/critical-result/:id/acknowledge", requireAction("vitals.write"),     ctrl.acknowledgeCriticalResult);
router.post("/break-glass",                     requireAction("patient.export"),   ctrl.breakGlassAccess);
// R7az-A/D9-HIGH: safety.write = Admin/Doctor/Nurse (doctors must be
// able to two-ID-confirm and sign surgical checklists / pain
// reassessments — pre-R7az mar.write excluded them).
router.post("/two-id-confirm",                  requireAction("safety.write"),     ctrl.twoIdentifierConfirm);
router.post("/surgical-checklist",              requireAction("safety.write"),     ctrl.surgicalChecklist);
router.post("/pain-reassessment",               requireAction("safety.write"),     ctrl.painReassessment);

module.exports = router;
