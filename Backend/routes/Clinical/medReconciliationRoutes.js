// routes/Clinical/medReconciliationRoutes.js
//
// R7au-FIX-12/D3-HIGH: medication-reconciliation writes gated on
// `rx.write` (Admin / Doctor). NABH MOM.4d-mandated home-meds vs
// admission-orders reconciliation — pre-R7au any authenticated user
// could rewrite the record.
const router = require("express").Router();
const ctrl = require("../../controllers/Clinical/medReconciliationController");
const { requireAction } = require("../../middleware/auth");

// R7bb-B/D4-CRIT-S1: med-reconciliation read now gated on `rx.read`
// (Admin / Doctor / Nurse / Pharmacist / Accountant). Pre-R7bb any
// authenticated role could pull the home-meds vs admission-orders
// reconciliation = patient's full med history including outside Rx.
router.get  ("/admission/:admissionId",                  requireAction("rx.read"), ctrl.getReconciliation);
router.post ("/admission/:admissionId/seed",             requireAction("rx.write"), ctrl.seedReconciliation);
router.put  ("/admission/:admissionId",                  requireAction("rx.write"), ctrl.updateReconciliation);
router.patch("/admission/:admissionId/row/:rowId",       requireAction("rx.write"), ctrl.updateRow);
router.post ("/admission/:admissionId/review/admit",     requireAction("rx.write"), ctrl.reviewAdmit);
router.post ("/admission/:admissionId/review/discharge", requireAction("rx.write"), ctrl.reviewDischarge);

module.exports = router;
