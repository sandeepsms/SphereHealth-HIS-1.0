const express = require("express");
const router = express.Router();
const billingController = require("../../controllers/Billing/billingController");

// 🎯 Create bill from prescription
router.post("/from-prescription", billingController.createBillFromPrescription);

// 📄 Get single bill
router.get("/:id", billingController.getBillById);

// 📋 Get all bills with filters
router.get("/", billingController.getAllBills);

// ✏️ Update bill (draft only)
router.put("/:id", billingController.updateBill);

// 🎫 Generate final bill
router.post("/:id/generate", billingController.generateBill);

// 🔄 Toggle investigation (in-house vs outside)
router.patch(
  "/:billId/investigation/:investigationId/toggle",
  billingController.toggleInvestigation,
);

// 💳 Add payment
router.post("/:id/payment", billingController.addPayment);

// ❌ Cancel bill
router.delete("/:id/cancel", billingController.cancelBill);

// 📊 Get statistics
router.get("/stats/summary", billingController.getBillStats);

// 🏥 Get bills by TPA
router.get("/tpa/:tpaId", billingController.getBillsByTPA);

// 📝 Get outside investigations
router.get(
  "/:id/outside-investigations",
  billingController.getOutsideInvestigations,
);

// 🧮 Recalculate bill
router.post("/:id/recalculate", billingController.recalculateBill);

module.exports = router;
