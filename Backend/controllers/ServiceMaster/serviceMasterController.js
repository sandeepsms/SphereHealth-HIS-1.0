// controllers/serviceMasterController.js
// ═══════════════════════════════════════════════════════════════
// Controller sirf karta hai:
//   1. Request se data extract karo
//   2. Service call karo
//   3. Response bhejo
// Koi bhi business logic, DB query, ya data manipulation yahan nahi
// ═══════════════════════════════════════════════════════════════

const serviceMasterService = require("../../services/ServiceMaster/Servicemasterservice");

// ── GET /api/services ─────────────────────────────────────────
exports.getAll = async (req, res) => {
  try {
    const result = await serviceMasterService.getAllServices(req.query);
    res.json({ success: true, ...result, data: result.services });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ── GET /api/services/grouped ─────────────────────────────────
exports.getGrouped = async (req, res) => {
  try {
    const data = await serviceMasterService.getGroupedServices(req.query);
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ── GET /api/services/:id ─────────────────────────────────────
exports.getById = async (req, res) => {
  try {
    const data = await serviceMasterService.getServiceById(req.params.id);
    res.json({ success: true, data });
  } catch (e) {
    const status = e.message === "Service not found" ? 404 : 500;
    res.status(status).json({ success: false, message: e.message });
  }
};

// ── POST /api/services ────────────────────────────────────────
exports.create = async (req, res) => {
  try {
    const data = await serviceMasterService.createService(req.body);
    res.status(201).json({ success: true, data });
  } catch (e) {
    const status = e.code === 11000 ? 400 : 400;
    const message =
      e.code === 11000 ? "Service code already exists" : e.message;
    res.status(status).json({ success: false, message });
  }
};

// ── PUT /api/services/:id ─────────────────────────────────────
exports.update = async (req, res) => {
  try {
    const data = await serviceMasterService.updateService(
      req.params.id,
      req.body,
    );
    res.json({ success: true, data });
  } catch (e) {
    const status = e.message === "Service not found" ? 404 : 400;
    res.status(status).json({ success: false, message: e.message });
  }
};

// ── DELETE /api/services/:id ──────────────────────────────────
exports.remove = async (req, res) => {
  try {
    await serviceMasterService.deactivateService(req.params.id);
    res.json({ success: true, message: "Service deactivated" });
  } catch (e) {
    const status = e.message === "Service not found" ? 404 : 500;
    res.status(status).json({ success: false, message: e.message });
  }
};

// ── GET /api/services/:id/pricing ────────────────────────────
exports.getPricing = async (req, res) => {
  try {
    const data = await serviceMasterService.getPricingForService(req.params.id);
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ── POST /api/services/:id/pricing ───────────────────────────
exports.setPricing = async (req, res) => {
  try {
    const data = await serviceMasterService.upsertServicePricing(
      req.params.id,
      req.body,
    );
    res.json({ success: true, data });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
};

// ── POST /api/services/seed ───────────────────────────────────
exports.seed = async (req, res) => {
  try {
    const data = await serviceMasterService.seedDefaultServices();
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};
