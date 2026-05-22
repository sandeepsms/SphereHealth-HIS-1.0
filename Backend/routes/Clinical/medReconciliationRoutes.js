// routes/Clinical/medReconciliationRoutes.js
//
// R7au-FIX-12/D3-HIGH: medication-reconciliation writes gated on
// `rx.write` (Admin / Doctor). NABH MOM.4d-mandated home-meds vs
// admission-orders reconciliation — pre-R7au any authenticated user
// could rewrite the record.
//
// R7bb-FIX-C-1/S1 (D4-CRIT): read switched from `rx.read` (which was a
// pharmacy-stats / dispense-register read token, awkward fit) to the
// new explicit `med-recon.read` token (Admin / Doctor / Nurse /
// Pharmacist / MRD). Pharmacist included so they can sanity-check
// active orders against the home-med list when filling an indent;
// MRD included so the discharged-file aggregator can render it.
const router = require("express").Router();
const ctrl = require("../../controllers/Clinical/medReconciliationController");
const { requireAction } = require("../../middleware/auth");

router.get  ("/admission/:admissionId",                  requireAction("med-recon.read"), ctrl.getReconciliation);
router.post ("/admission/:admissionId/seed",             requireAction("rx.write"), ctrl.seedReconciliation);
router.put  ("/admission/:admissionId",                  requireAction("rx.write"), ctrl.updateReconciliation);
router.patch("/admission/:admissionId/row/:rowId",       requireAction("rx.write"), ctrl.updateRow);
router.post ("/admission/:admissionId/review/admit",     requireAction("rx.write"), ctrl.reviewAdmit);
router.post ("/admission/:admissionId/review/discharge", requireAction("rx.write"), ctrl.reviewDischarge);

module.exports = router;
