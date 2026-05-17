const svc = require("../../services/Investigation/investigationOrderService");
const { logErr } = require("../../utils/logErr");

exports.create = async (req, res) => {
  try {
    const data = await svc.createOrder(req.body);
    // ── Auto-billing hook ──────────────────────────────────────
    // Fire-and-forget but no longer silent (audit D-01). If the
    // billing trigger fails we still want the order to succeed —
    // billing has its own retry mechanism — but the failure now
    // surfaces in container logs so SOC can spot a stuck queue.
    try {
      const autoBilling = require("../../services/Billing/autoBillingService");
      autoBilling.onInvestigationOrdered(data).catch(logErr("autoBilling", `onInvestigationOrdered ${data?._id}`));
    } catch (e) {
      logErr("autoBilling", "load failure on investigation.create")(e);
    }
    res.status(201).json({ success: true, data });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
};

exports.getAll = async (req, res) => {
  try {
    const result = await svc.getOrders(req.query);
    res.json({ success: true, ...result, data: result.orders });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.getSummary = async (req, res) => {
  try {
    const data = await svc.getDashboardSummary();
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.getByUHID = async (req, res) => {
  try {
    const data = await svc.getOrdersByUHID(req.params.UHID);
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.getById = async (req, res) => {
  try {
    const data = await svc.getOrderById(req.params.id);
    res.json({ success: true, data });
  } catch (e) {
    res
      .status(e.message === "Order not found" ? 404 : 500)
      .json({ success: false, message: e.message });
  }
};

exports.collectSample = async (req, res) => {
  try {
    const data = await svc.collectSamples(req.params.id, req.body);
    res.json({ success: true, data });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
};

exports.enterResults = async (req, res) => {
  try {
    const data = await svc.enterResults(req.params.id, req.body);
    // ── Auto-billing hook ──────────────────────────────────────
    try {
      const autoBilling = require("../../services/Billing/autoBillingService");
      autoBilling.onInvestigationResulted(data).catch(logErr("autoBilling", `onInvestigationResulted ${data?._id}`));
    } catch (e) {
      logErr("autoBilling", "load failure on investigation.result")(e);
    }
    res.json({ success: true, data });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
};

exports.enterExternalResult = async (req, res) => {
  try {
    const data = await svc.enterExternalResult(req.params.id, req.body);
    res.json({ success: true, data });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
};

exports.verify = async (req, res) => {
  try {
    const data = await svc.verifyResults(req.params.id, req.body);
    // ── Auto-billing hook ──────────────────────────────────────
    try {
      const autoBilling = require("../../services/Billing/autoBillingService");
      autoBilling.onInvestigationResulted(data).catch(logErr("autoBilling", `onInvestigationResulted ${data?._id}`));
    } catch (e) {
      logErr("autoBilling", "load failure on investigation.result")(e);
    }
    res.json({ success: true, data });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
};

exports.markPrinted = async (req, res) => {
  try {
    const data = await svc.markReportPrinted(req.params.id, req.body);
    res.json({ success: true, data });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
};

exports.cancel = async (req, res) => {
  try {
    const data = await svc.cancelOrder(req.params.id, req.body);
    res.json({ success: true, data });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
};

exports.addTest = async (req, res) => {
  try {
    const data = await svc.addTest(req.params.id, req.body);
    res.json({ success: true, data });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
};
