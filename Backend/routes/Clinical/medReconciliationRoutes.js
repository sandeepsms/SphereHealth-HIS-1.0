// routes/Clinical/medReconciliationRoutes.js
const router = require("express").Router();
const ctrl = require("../../controllers/Clinical/medReconciliationController");

router.get  ("/admission/:admissionId",                ctrl.getReconciliation);
router.post ("/admission/:admissionId/seed",           ctrl.seedReconciliation);
router.put  ("/admission/:admissionId",                ctrl.updateReconciliation);
router.patch("/admission/:admissionId/row/:rowId",     ctrl.updateRow);
router.post ("/admission/:admissionId/review/admit",     ctrl.reviewAdmit);
router.post ("/admission/:admissionId/review/discharge", ctrl.reviewDischarge);

module.exports = router;
