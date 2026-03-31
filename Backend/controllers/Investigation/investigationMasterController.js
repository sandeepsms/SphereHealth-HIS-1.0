const svc = require("../../services/Investigation/investigationMasterService");

exports.getAll = async (req, res) => {
  try {
    const result = await svc.getAll(req.query);
    res.json({ success: true, ...result, data: result.investigations });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.getGrouped = async (req, res) => {
  try {
    const data = await svc.getGrouped();
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.getById = async (req, res) => {
  try {
    const data = await svc.getById(req.params.id);
    res.json({ success: true, data });
  } catch (e) {
    res
      .status(e.message === "Investigation not found" ? 404 : 500)
      .json({ success: false, message: e.message });
  }
};

exports.create = async (req, res) => {
  try {
    const data = await svc.create(req.body);
    res.status(201).json({ success: true, data });
  } catch (e) {
    const msg = e.code === 11000 ? "Investigation already exists" : e.message;
    res.status(400).json({ success: false, message: msg });
  }
};

exports.update = async (req, res) => {
  try {
    const data = await svc.update(req.params.id, req.body);
    res.json({ success: true, data });
  } catch (e) {
    res
      .status(e.message === "Investigation not found" ? 404 : 400)
      .json({ success: false, message: e.message });
  }
};

exports.remove = async (req, res) => {
  try {
    await svc.deactivate(req.params.id);
    res.json({ success: true, message: "Investigation deactivated" });
  } catch (e) {
    res
      .status(e.message === "Investigation not found" ? 404 : 500)
      .json({ success: false, message: e.message });
  }
};

exports.getPricing = async (req, res) => {
  try {
    const data = await svc.getPricing(req.params.id);
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.setPricing = async (req, res) => {
  try {
    const data = await svc.upsertPricing(req.params.id, req.body);
    res.json({ success: true, data });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
};

exports.getEffectivePrice = async (req, res) => {
  try {
    const { tariffType = "CASH", tpaId = null } = req.query;
    const data = await svc.getEffectivePrice(req.params.id, tariffType, tpaId);
    res.json({ success: true, data });
  } catch (e) {
    res
      .status(e.message === "Investigation not found" ? 404 : 500)
      .json({ success: false, message: e.message });
  }
};

exports.seed = async (req, res) => {
  try {
    const data = await svc.seed();
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};
