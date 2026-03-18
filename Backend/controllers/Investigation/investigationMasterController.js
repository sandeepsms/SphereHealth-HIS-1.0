// controllers/investigationMasterController.js
const svc = require("../../services/Investigation/investigationMasterService");

// GET /api/investigations
exports.getAll = async (req, res) => {
  try {
    const result = await svc.getAll(req.query);
    res.json({ success: true, ...result, data: result.investigations });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/investigations/grouped
exports.getGrouped = async (req, res) => {
  try {
    const data = await svc.getGrouped();
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/investigations/:id
exports.getById = async (req, res) => {
  try {
    const data = await svc.getById(req.params.id);
    res.json({ success: true, data });
  } catch (e) {
    const status = e.message === "Investigation not found" ? 404 : 500;
    res.status(status).json({ success: false, message: e.message });
  }
};

// POST /api/investigations
exports.create = async (req, res) => {
  try {
    const data = await svc.create(req.body);
    res.status(201).json({ success: true, data });
  } catch (e) {
    const message =
      e.code === 11000 ? "Investigation code already exists" : e.message;
    res.status(400).json({ success: false, message });
  }
};

// PUT /api/investigations/:id
exports.update = async (req, res) => {
  try {
    const data = await svc.update(req.params.id, req.body);
    res.json({ success: true, data });
  } catch (e) {
    const status = e.message === "Investigation not found" ? 404 : 400;
    res.status(status).json({ success: false, message: e.message });
  }
};

// DELETE /api/investigations/:id
exports.remove = async (req, res) => {
  try {
    await svc.deactivate(req.params.id);
    res.json({ success: true, message: "Investigation deactivated" });
  } catch (e) {
    const status = e.message === "Investigation not found" ? 404 : 500;
    res.status(status).json({ success: false, message: e.message });
  }
};

// GET /api/investigations/:id/pricing
exports.getPricing = async (req, res) => {
  try {
    const data = await svc.getPricing(req.params.id);
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// POST /api/investigations/:id/pricing
exports.setPricing = async (req, res) => {
  try {
    const data = await svc.upsertPricing(req.params.id, req.body);
    res.json({ success: true, data });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
};

// GET /api/investigations/:id/effective-price
exports.getEffectivePrice = async (req, res) => {
  try {
    const { tariffType = "CASH", tpaId = null } = req.query;
    const data = await svc.getEffectivePrice(req.params.id, tariffType, tpaId);
    res.json({ success: true, data });
  } catch (e) {
    const status = e.message === "Investigation not found" ? 404 : 500;
    res.status(status).json({ success: false, message: e.message });
  }
};

// POST /api/investigations/seed
exports.seed = async (req, res) => {
  try {
    const data = await svc.seed();
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};
