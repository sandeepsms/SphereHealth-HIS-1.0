/**
 * adrRoutes.js  (R7bf-G / A5-CRIT-4 / NABH MOM.7)
 *
 * Routes mounted at /api/adr-reports. Reads share `pharmacy.adr.read`
 * with the wider clinical team (Doctor / Nurse / Pharmacist / Admin)
 * because adverse-drug-reaction history is treatment-relevant. Writes
 * gated on `pharmacy.adr.write` (same role set today; separated for
 * future SOD splits when a dedicated pharmacovigilance role is added).
 */
const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/Pharmacy/adrReportController");
const { requireAction } = require("../../middleware/auth");

router.get("/",                       requireAction("pharmacy.adr.read"),  ctrl.list);
router.get("/:id",                    requireAction("pharmacy.adr.read"),  ctrl.getOne);

router.post("/",                      requireAction("pharmacy.adr.write"), ctrl.create);
router.put("/:id",                    requireAction("pharmacy.adr.write"), ctrl.update);
router.put("/:id/submit",             requireAction("pharmacy.adr.write"), ctrl.submit);
router.put("/:id/file-pvpi",          requireAction("pharmacy.adr.write"), ctrl.filePvPI);
router.put("/:id/reopen",             requireAction("pharmacy.adr.write"), ctrl.reopen);

module.exports = router;
