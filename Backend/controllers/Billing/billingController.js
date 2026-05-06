// controllers/billingController.js
// ═══════════════════════════════════════════════════════════════
// Controller sirf karta hai:
//   1. Request validate karo (required fields check)
//   2. Service call karo
//   3. HTTP response bhejo
// Koi bhi DB access, calculation, ya business rule yahan nahi
// ═══════════════════════════════════════════════════════════════

const billingService = require("../../services/Billing/billingService");
const aiSuggestService = require("../../services/AI/aiSuggestService");

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

// ── POST /api/billing/:billId/ai-suggest ─────────────────────
exports.aiSuggest = async (req, res) => {
  try {
    const suggestions = await aiSuggestService.suggestCharges(req.params.billId);
    res.json({ success: true, data: suggestions });
  } catch (e) {
    const status = e.message === "Bill not found" ? 404 : 500;
    res.status(status).json({ success: false, message: e.message });
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
