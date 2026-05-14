const express = require("express");
const router = express.Router();
const hospitalChargesController = require("../../controllers/charges/hospitalChargesController");
const { requireAction } = require("../../middleware/auth");

// TPA tariff sheets — same ACL as departments: read for anyone who bills,
// write for Admin only (tariff sheets are contractual).
router.get("/",                  requireAction("billing.read"),  hospitalChargesController.getAllHospitalCharges);
router.get("/document/:id",      requireAction("billing.read"),  hospitalChargesController.getHospitalChargesById);
router.get("/tpa/:tpaId",        requireAction("billing.read"),  hospitalChargesController.getHospitalChargesByTPA);

router.post("/create",           requireAction("departments.write"), hospitalChargesController.createHospitalCharges);
router.put("/:id",               requireAction("departments.write"), hospitalChargesController.updateHospitalCharges);
router.delete("/:id",            requireAction("departments.write"), hospitalChargesController.deleteHospitalCharges);
router.patch("/:id/toggle-status", requireAction("departments.write"), hospitalChargesController.toggleActiveStatus);

module.exports = router;
