const express = require("express");
const router = express.Router();
const hospitalChargesController = require("../../controllers/charges/hospitalChargesController");
const { requireAction } = require("../../middleware/auth");
const { validateObjectIdParam } = require("../../utils/queryGuards");

// TPA tariff sheets — same ACL as departments: read for anyone who bills,
// write for Admin only (tariff sheets are contractual).
router.get("/",                  requireAction("billing.read"),  hospitalChargesController.getAllHospitalCharges);
router.get("/document/:id",      validateObjectIdParam("id"), requireAction("billing.read"),  hospitalChargesController.getHospitalChargesById);
// NOTE: /tpa/:tpaId is intentionally NOT guarded — service accepts the literal
// string "normal" (and other non-ObjectId values) as a sentinel that returns the
// "Normal" TPA tariff sheet. See services/charges/hospitalChargesService.js
// getHospitalChargesByTPA() — the `tpaId === "normal"` short-circuit.
router.get("/tpa/:tpaId",        requireAction("billing.read"),  hospitalChargesController.getHospitalChargesByTPA);

router.post("/create",           requireAction("departments.write"), hospitalChargesController.createHospitalCharges);
router.put("/:id",               validateObjectIdParam("id"), requireAction("departments.write"), hospitalChargesController.updateHospitalCharges);
router.delete("/:id",            validateObjectIdParam("id"), requireAction("departments.write"), hospitalChargesController.deleteHospitalCharges);
router.patch("/:id/toggle-status", validateObjectIdParam("id"), requireAction("departments.write"), hospitalChargesController.toggleActiveStatus);

module.exports = router;
