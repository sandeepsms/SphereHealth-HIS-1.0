const billingService = require("../../services/Billing/billingService");

/**
 * 🎯 Create Bill from Prescription
 * POST /api/billing/from-prescription
 */
exports.createBillFromPrescription = async (req, res) => {
  try {
    const { prescriptionId } = req.body;

    if (!prescriptionId) {
      return res.status(400).json({
        success: false,
        message: "Prescription ID is required",
      });
    }

    const bill = await billingService.createFromPrescription(prescriptionId);

    res.status(201).json({
      success: true,
      message: "Bill created successfully",
      data: bill,
    });
  } catch (error) {
    console.error("Error creating bill:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * 📄 Get Bill by ID
 * GET /api/billing/:id
 */
exports.getBillById = async (req, res) => {
  try {
    const bill = await billingService.getBillById(req.params.id);

    res.status(200).json({
      success: true,
      data: bill,
    });
  } catch (error) {
    console.error("Error fetching bill:", error);
    const statusCode = error.message === "Bill not found" ? 404 : 500;
    res.status(statusCode).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * 📋 Get All Bills with Filters
 * GET /api/billing?status=draft&page=1&limit=20
 */
exports.getAllBills = async (req, res) => {
  try {
    const { page = 1, limit = 20, ...filters } = req.query;

    const result = await billingService.getAllBills(
      filters,
      parseInt(page),
      parseInt(limit),
    );

    res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error("Error fetching bills:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * ✏️ Update Bill (Draft stage only)
 * PUT /api/billing/:id
 */
exports.updateBill = async (req, res) => {
  try {
    const bill = await billingService.updateBill(req.params.id, req.body);

    res.status(200).json({
      success: true,
      message: "Bill updated successfully",
      data: bill,
    });
  } catch (error) {
    console.error("Error updating bill:", error);
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * 🎫 Generate Final Bill (with Bill Number)
 * POST /api/billing/:id/generate
 */
exports.generateBill = async (req, res) => {
  try {
    const bill = await billingService.generateBill(req.params.id);

    res.status(200).json({
      success: true,
      message: "Bill generated successfully",
      data: bill,
    });
  } catch (error) {
    console.error("Error generating bill:", error);
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * 🔄 Toggle Investigation (In-house vs Outside)
 * PATCH /api/billing/:billId/investigation/:investigationId/toggle
 */
exports.toggleInvestigation = async (req, res) => {
  try {
    const { billId, investigationId } = req.params;
    const { performInHouse, outsideDetails } = req.body;

    const bill = await billingService.toggleInvestigation(
      billId,
      investigationId,
      performInHouse,
      outsideDetails,
    );

    res.status(200).json({
      success: true,
      message: performInHouse
        ? "Investigation marked as in-house"
        : "Investigation marked as outside",
      data: bill,
    });
  } catch (error) {
    console.error("Error toggling investigation:", error);
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * 💳 Add Payment to Bill
 * POST /api/billing/:id/payment
 */
exports.addPayment = async (req, res) => {
  try {
    const { amount, method, transactionId, status } = req.body;

    if (!amount || !method) {
      return res.status(400).json({
        success: false,
        message: "Amount and payment method are required",
      });
    }

    const bill = await billingService.addPayment(req.params.id, {
      amount,
      method,
      transactionId,
      status,
    });

    res.status(200).json({
      success: true,
      message: "Payment added successfully",
      data: bill,
    });
  } catch (error) {
    console.error("Error adding payment:", error);
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * ❌ Cancel Bill
 * DELETE /api/billing/:id/cancel
 */
exports.cancelBill = async (req, res) => {
  try {
    const { reason } = req.body;

    if (!reason) {
      return res.status(400).json({
        success: false,
        message: "Cancellation reason is required",
      });
    }

    const bill = await billingService.cancelBill(req.params.id, reason);

    res.status(200).json({
      success: true,
      message: "Bill cancelled successfully",
      data: bill,
    });
  } catch (error) {
    console.error("Error cancelling bill:", error);
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * 📊 Get Bill Statistics
 * GET /api/billing/stats/summary
 */
exports.getBillStats = async (req, res) => {
  try {
    const stats = await billingService.getBillStats(req.query);

    res.status(200).json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error("Error fetching bill stats:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * 🔍 Get Outside Investigations for a Bill
 * GET /api/billing/:id/outside-investigations
 */
exports.getOutsideInvestigations = async (req, res) => {
  try {
    const bill = await billingService.getBillById(req.params.id);

    const outsideTests = bill.investigations
      .filter((inv) => !inv.performedInHouse)
      .map((inv) => ({
        _id: inv._id,
        serviceName: inv.serviceName,
        baseAmount: inv.baseAmount,
        reason: inv.outsideDetails?.reason,
        suggestedLab: inv.outsideDetails?.suggestedLab,
        estimatedCost: inv.outsideDetails?.estimatedCost,
      }));

    res.status(200).json({
      success: true,
      count: outsideTests.length,
      data: outsideTests,
    });
  } catch (error) {
    console.error("Error fetching outside investigations:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * 🧮 Recalculate Bill Totals
 * POST /api/billing/:id/recalculate
 */
exports.recalculateBill = async (req, res) => {
  try {
    const bill = await billingService.getBillById(req.params.id);
    await bill.save();

    res.status(200).json({
      success: true,
      message: "Bill recalculated successfully",
      data: bill,
    });
  } catch (error) {
    console.error("Error recalculating bill:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * 🆕 Get Available Charges for this Bill
 * GET /api/billing/:id/available-charges
 * Returns all charges that can be manually added to this bill
 */
exports.getAvailableCharges = async (req, res) => {
  try {
    const charges = await billingService.getAvailableCharges(req.params.id);

    res.status(200).json({
      success: true,
      count: charges.length,
      data: charges,
    });
  } catch (error) {
    console.error("Error fetching available charges:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * 🆕 Add Charge to Existing Bill
 * POST /api/billing/:id/add-charge
 * Body: {
 *   chargeId: "...",
 *   chargeName: "Nurse Charge",
 *   chargeType: "NURSE",
 *   baseAmount: 500,
 *   discount: 10,
 *   finalAmount: 450,
 *   perUnit: "per day",
 *   quantity: 3
 * }
 */
exports.addChargeToBill = async (req, res) => {
  try {
    const {
      chargeId,
      chargeName,
      chargeType,
      baseAmount,
      discount,
      finalAmount,
      perUnit,
      quantity,
    } = req.body;

    if (!chargeName || !chargeType || !baseAmount) {
      return res.status(400).json({
        success: false,
        message: "Charge name, type, and amount are required",
      });
    }

    const bill = await billingService.addChargeToExistingBill(req.params.id, {
      chargeId,
      chargeName,
      chargeType,
      baseAmount,
      discount: discount || 0,
      finalAmount: finalAmount || baseAmount,
      perUnit: perUnit || "one time",
      quantity: quantity || 1,
    });

    res.status(200).json({
      success: true,
      message: "Charge added successfully",
      data: bill,
    });
  } catch (error) {
    console.error("Error adding charge:", error);
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * 🆕 Remove Charge from Bill
 * DELETE /api/billing/:id/remove-charge/:chargeIndex
 */

exports.getBillsByTPA = async (req, res) => {
  try {
    const { tpaId } = req.params;
    const Billing = require("../../models/Billing/billingModel");
    const bills = await Billing.find({ tpa: tpaId });
    res.json({ success: true, data: bills });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
exports.removeChargeFromBill = async (req, res) => {
  try {
    const { id, chargeIndex } = req.params;

    const bill = await billingService.removeChargeFromBill(
      id,
      parseInt(chargeIndex),
    );

    res.status(200).json({
      success: true,
      message: "Charge removed successfully",
      data: bill,
    });
  } catch (error) {
    console.error("Error removing charge:", error);
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};
