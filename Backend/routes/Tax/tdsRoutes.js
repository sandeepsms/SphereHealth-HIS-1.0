/**
 * routes/Tax/tdsRoutes.js  (R7bh-F6 / R7bg CRIT-A2)
 *
 * Mounted at `/api/tds`. Form 16A workflow only — the underlying
 * `tdsAmount` capture lives on PatientBill.payments[] (R7ap-F28).
 */
const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/Tax/tdsController");
const { requireAction } = require("../../middleware/auth");

// Form 16A
router.get("/16a/preview", requireAction("tax.tds.read"), ctrl.previewForm16A);
router.post("/16a/preview", requireAction("tax.tds.read"), ctrl.previewForm16A);
router.post("/16a/generate", requireAction("tax.tds.write"), ctrl.generateForm16A);
router.put("/16a/:id/issue", requireAction("tax.tds.write"), ctrl.issue);
router.put("/16a/:id/mark-filed", requireAction("tax.tds.write"), ctrl.markFiled);
router.get("/16a", requireAction("tax.tds.read"), ctrl.list);
router.get("/16a/:id", requireAction("tax.tds.read"), ctrl.getOne);

module.exports = router;
