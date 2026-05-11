// controllers/billingController.js
// ═══════════════════════════════════════════════════════════════
// Controller sirf karta hai:
//   1. Request validate karo (required fields check)
//   2. Service call karo
//   3. HTTP response bhejo
// Koi bhi DB access, calculation, ya business rule yahan nahi
// ═══════════════════════════════════════════════════════════════

const billingService = require("../../services/Billing/billingService");
const BillingService = require("../../services/Billing/billingService");

// ── GET /api/billing/uhid/:UHID ───────────────────────────────
exports.getBillsByUHID = async (req, res) => {
  try {
    const data = await billingService.getPatientWithBills(req.params.UHID);
    res.json({ success: true, data });
  } catch (e) {
    const status = e.message.includes("not found") ? 404 : 500;
    res.status(status).json({ success: false, message: e.message });
  }
};

// ── POST /api/billing/create ──────────────────────────────────
exports.getOrCreateBill = async (req, res) => {
  try {
    const { UHID, visitType, admissionId } = req.body;
    if (!UHID || !visitType) {
      return res
        .status(400)
        .json({ success: false, message: "UHID and visitType required" });
    }

    const data = await billingService.getDraftBillPopulated(
      UHID,
      visitType,
      admissionId,
    );
    res.json({ success: true, data });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
};

// ── GET /api/billing/:billId ──────────────────────────────────
exports.getBillById = async (req, res) => {
  try {
    const data = await billingService.getBillById(req.params.billId);
    res.json({ success: true, data });
  } catch (e) {
    const status = e.message === "Bill not found" ? 404 : 500;
    res.status(status).json({ success: false, message: e.message });
  }
};

// ── POST /api/billing/:billId/add-service ─────────────────────
exports.addService = async (req, res) => {
  try {
    const { serviceId, quantity = 1, chargeDate, remarks } = req.body;
    if (!serviceId) {
      return res
        .status(400)
        .json({ success: false, message: "serviceId required" });
    }

    const data = await billingService.addServiceToBill(
      req.params.billId,
      serviceId,
      quantity,
      chargeDate ? new Date(chargeDate) : new Date(),
      remarks,
    );
    res.json({ success: true, data });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
};

// ── DELETE /api/billing/:billId/items/:itemId ─────────────────
exports.removeItem = async (req, res) => {
  try {
    const data = await billingService.removeItemFromBill(
      req.params.billId,
      req.params.itemId,
    );
    res.json({ success: true, data });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
};

// ── PUT /api/billing/:billId/items/:itemId ────────────────────
exports.updateItemQty = async (req, res) => {
  try {
    if (!req.body.quantity) {
      return res
        .status(400)
        .json({ success: false, message: "quantity required" });
    }

    const data = await billingService.updateItemQuantity(
      req.params.billId,
      req.params.itemId,
      req.body.quantity,
    );
    res.json({ success: true, data });
  } catch (e) {
    const status = e.message.includes("not found") ? 404 : 400;
    res.status(status).json({ success: false, message: e.message });
  }
};

// ── POST /api/billing/:billId/generate ───────────────────────
exports.generateBill = async (req, res) => {
  try {
    const data = await billingService.generateFinalBill(
      req.params.billId,
      req.body.generatedBy || "Staff",
    );
    res.json({
      success: true,
      data,
      message: `Bill ${data.billNumber} generated successfully`,
    });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
};

// ── POST /api/billing/:billId/payment ────────────────────────
exports.recordPayment = async (req, res) => {
  try {
    const { amount, paymentMode } = req.body;
    if (!amount || !paymentMode) {
      return res
        .status(400)
        .json({ success: false, message: "amount and paymentMode required" });
    }

    const data = await billingService.recordPayment(
      req.params.billId,
      req.body,
    );
    res.json({ success: true, data });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
};

// ── POST /api/billing/:billId/tpa-claim ──────────────────────
exports.setTPAClaimStatus = async (req, res) => {
  try {
    if (!req.body.status) {
      return res
        .status(400)
        .json({ success: false, message: "status required" });
    }

    const data = await billingService.updateTPAClaimStatus(
      req.params.billId,
      req.body,
    );
    res.json({ success: true, data });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
};

// ── GET /api/billing/price/:serviceId ────────────────────────
exports.getServicePrice = async (req, res) => {
  try {
    const { tariffType = "CASH", tpaId } = req.query;
    const data = await billingService.getEffectivePrice(
      req.params.serviceId,
      tariffType,
      tpaId,
    );
    res.json({ success: true, data });
  } catch (e) {
    const status = e.message.includes("not found") ? 404 : 500;
    res.status(status).json({ success: false, message: e.message });
  }
};

// ── GET /api/billing/daycare-check/:admissionId ───────────────
exports.checkDaycare = async (req, res) => {
  try {
    const data = await billingService.checkAndHandleDaycareConversion(
      req.params.admissionId,
    );
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ── GET /api/billing/summary ──────────────────────────────────
exports.getSummary = async (req, res) => {
  try {
    const data = await billingService.getBillingSummary();
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ── POST /api/billing/ai-suggest ──────────────────────────────
exports.aiSuggest = async (req, res, next) => {
  try {
    const { billId, diagnosis, patientType, additionalContext } = req.body;
    if (!billId || !diagnosis) {
      return res
        .status(400)
        .json({ success: false, message: "billId and diagnosis are required" });
    }
    const aiSvc = require("../../services/Billing/aiChargeService");
    const result = await aiSvc.suggestMissedCharges({
      billId,
      diagnosis,
      patientType: patientType || "IPD",
      additionalContext,
    });
    res.json({ success: true, data: result });
  } catch (e) {
    next(e);
  }
};

// ── POST /api/billing/ai-confirm ──────────────────────────────
exports.aiConfirm = async (req, res, next) => {
  try {
    const { billId, serviceIds, confirmedBy } = req.body;
    if (!billId || !Array.isArray(serviceIds)) {
      return res
        .status(400)
        .json({ success: false, message: "billId and serviceIds[] required" });
    }
    const aiSvc = require("../../services/Billing/aiChargeService");
    const result = await aiSvc.confirmAISuggestions(
      billId,
      serviceIds,
      confirmedBy || "Staff",
    );
    res.json({ success: true, data: result });
  } catch (e) {
    next(e);
  }
};

// ── POST /api/billing/:billId/nurse-charge ────────────────────
exports.addNurseCharge = async (req, res, next) => {
  try {
    const { serviceId, quantity, nurseName, shift, remarks } = req.body;
    if (!serviceId) {
      return res
        .status(400)
        .json({ success: false, message: "serviceId required" });
    }
    const bill = await BillingService.addNurseCharge(
      req.params.billId,
      serviceId,
      quantity || 1,
      { nurseName, shift, remarks },
    );
    res.json({ success: true, data: bill });
  } catch (e) {
    next(e);
  }
};

// ── GET /api/billing/nurse-services?patientType=IPD ───────────
exports.getNurseChargeableServices = async (req, res, next) => {
  try {
    const services = await BillingService.getNurseChargeableServices(
      req.query.patientType || "IPD",
    );
    res.json({ success: true, data: services });
  } catch (e) {
    next(e);
  }
};

// GET /api/billing/audit-trail/:admissionId
exports.getAuditTrail = async (req, res, next) => {
  try {
    const autoBilling = require("../../services/Billing/autoBillingService");
    const result = await autoBilling.getAuditTrail(req.params.admissionId, req.query);
    res.json({ success: true, ...result });
  } catch (e) { next(e); }
};

// GET /api/billing/audit-summary/:admissionId
exports.getAuditSummary = async (req, res, next) => {
  try {
    const autoBilling = require("../../services/Billing/autoBillingService");
    const result = await autoBilling.getAdmissionBillingSummary(req.params.admissionId);
    res.json({ success: true, data: result });
  } catch (e) { next(e); }
};

// POST /api/billing/audit/:triggerId/confirm-bill
exports.confirmTriggerBill = async (req, res, next) => {
  try {
    const autoBilling = require("../../services/Billing/autoBillingService");
    const { confirmedBy, confirmedByRole } = req.body;
    const result = await autoBilling.confirmAndBillTrigger(req.params.triggerId, { confirmedBy, confirmedByRole });
    res.json({ success: true, data: result });
  } catch (e) { next(e); }
};
