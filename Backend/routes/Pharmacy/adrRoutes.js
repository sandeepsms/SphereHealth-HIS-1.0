/**
 * adrRoutes.js  (R7bf-G / A5-CRIT-4 / NABH MOM.7)
 *
 * Routes mounted at /api/adr-reports. Reads share `pharmacy.adr.read`
 * with the wider clinical team (Doctor / Nurse / Pharmacist / Admin)
 * because adverse-drug-reaction history is treatment-relevant. Writes
 * gated on `pharmacy.adr.write` (same role set today; separated for
 * future SOD splits when a dedicated pharmacovigilance role is added).
 */
// R7bh-F4 / R7bg-3-CRIT-2: every :id route now runs through
// validateObjectIdParam so a malformed id surfaces as a uniform 400.
const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/Pharmacy/adrReportController");
const { requireAction } = require("../../middleware/auth");
const { validateObjectIdParam } = require("../../utils/queryGuards");

router.get("/",                       requireAction("pharmacy.adr.read"),  ctrl.list);
router.get("/:id",                    validateObjectIdParam("id"), requireAction("pharmacy.adr.read"),  ctrl.getOne);

router.post("/",                      requireAction("pharmacy.adr.write"), ctrl.create);
router.put("/:id",                    validateObjectIdParam("id"), requireAction("pharmacy.adr.write"), ctrl.update);
router.put("/:id/submit",             validateObjectIdParam("id"), requireAction("pharmacy.adr.write"), ctrl.submit);
router.put("/:id/file-pvpi",          validateObjectIdParam("id"), requireAction("pharmacy.adr.write"), ctrl.filePvPI);
router.put("/:id/reopen",             validateObjectIdParam("id"), requireAction("pharmacy.adr.write"), ctrl.reopen);

module.exports = router;
