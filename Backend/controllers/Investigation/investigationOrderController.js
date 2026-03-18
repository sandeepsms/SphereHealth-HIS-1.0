// controllers/investigationOrderController.js
const orderSvc = require("../../services/Investigation/investigationOrderService");

// POST /api/investigation-orders
exports.create = async (req, res) => {
  try {
    const data = await orderSvc.createOrder(req.body);
    res.status(201).json({ success: true, data });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
};

// GET /api/investigation-orders
exports.getAll = async (req, res) => {
  try {
    const result = await orderSvc.getOrders(req.query);
    res.json({ success: true, ...result, data: result.orders });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/investigation-orders/summary
exports.getSummary = async (req, res) => {
  try {
    const data = await orderSvc.getDashboardSummary();
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/investigation-orders/patient/:UHID
exports.getByUHID = async (req, res) => {
  try {
    const data = await orderSvc.getOrdersByUHID(req.params.UHID);
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/investigation-orders/:id
exports.getById = async (req, res) => {
  try {
    const data = await orderSvc.getOrderById(req.params.id);
    res.json({ success: true, data });
  } catch (e) {
    const status = e.message === "Order not found" ? 404 : 500;
    res.status(status).json({ success: false, message: e.message });
  }
};

// POST /api/investigation-orders/:id/collect-sample
exports.collectSample = async (req, res) => {
  try {
    const data = await orderSvc.collectSamples(req.params.id, req.body);
    res.json({ success: true, data });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
};

// POST /api/investigation-orders/:id/receive-at-lab
exports.receiveAtLab = async (req, res) => {
  try {
    const data = await orderSvc.receiveAtLab(req.params.id, req.body);
    res.json({ success: true, data });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
};

// POST /api/investigation-orders/:id/enter-results
exports.enterResults = async (req, res) => {
  try {
    const data = await orderSvc.enterResults(req.params.id, req.body);
    res.json({ success: true, data });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
};

// POST /api/investigation-orders/:id/verify
exports.verify = async (req, res) => {
  try {
    const data = await orderSvc.verifyResults(req.params.id, req.body);
    res.json({ success: true, data });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
};

// POST /api/investigation-orders/:id/print
exports.markPrinted = async (req, res) => {
  try {
    const data = await orderSvc.markReportPrinted(req.params.id, req.body);
    res.json({ success: true, data });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
};

// POST /api/investigation-orders/:id/cancel
exports.cancel = async (req, res) => {
  try {
    const data = await orderSvc.cancelOrder(req.params.id, req.body);
    res.json({ success: true, data });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
};

// POST /api/investigation-orders/:id/add-test
exports.addTest = async (req, res) => {
  try {
    const data = await orderSvc.addTestToOrder(req.params.id, req.body);
    res.json({ success: true, data });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
};
