const router = require("express").Router();
const DoctorOrder = require("../../models/Doctor/DoctorOrderModel");

// POST / — create single order
router.post("/", async (req, res) => {
  try {
    const order = await DoctorOrder.create(req.body);
    res.status(201).json({ success: true, data: order });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// POST /bulk — create multiple orders at once
router.post("/bulk", async (req, res) => {
  try {
    const { orders } = req.body;
    if (!Array.isArray(orders) || orders.length === 0)
      return res.status(400).json({ success: false, message: "orders array required" });
    const created = await DoctorOrder.insertMany(orders, { ordered: false });
    res.status(201).json({ success: true, data: created, count: created.length });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// GET / — fetch orders (nurse view). Query: UHID, visitId, status (comma-sep), orderType
router.get("/", async (req, res) => {
  try {
    const { UHID, visitId, status, orderType } = req.query;
    const filter = {};
    if (UHID) filter.UHID = UHID;
    if (visitId) filter.visitId = visitId;
    if (status) filter.status = { $in: status.split(",") };
    if (orderType) filter.orderType = orderType;
    const orders = await DoctorOrder.find(filter).sort({ orderedAt: -1, createdAt: -1 });
    res.json({ success: true, data: orders, count: orders.length });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /:id — single order
router.get("/:id", async (req, res) => {
  try {
    const order = await DoctorOrder.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: "Not found" });
    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH /:id — update status, consent data, nurse notes
router.patch("/:id", async (req, res) => {
  try {
    const order = await DoctorOrder.findByIdAndUpdate(
      req.params.id,
      { $set: req.body },
      { new: true, runValidators: true }
    );
    if (!order) return res.status(404).json({ success: false, message: "Not found" });
    res.json({ success: true, data: order });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// POST /:id/step — nurse completes one workflow step, appended to auditLog
// Body: { step, doneBy, notes, totalSteps }
// Automatically sets status to InProgress or Completed when last step is done
router.post("/:id/step", async (req, res) => {
  try {
    const { step, doneBy, notes, totalSteps } = req.body;
    if (!step || !doneBy) return res.status(400).json({ success: false, message: "step and doneBy required" });

    const logEntry = { step, doneBy, doneAt: new Date(), notes: notes || "" };

    // Pull current order to know how many steps are done
    const current = await DoctorOrder.findById(req.params.id);
    if (!current) return res.status(404).json({ success: false, message: "Not found" });

    const nextIndex = (current.currentStepIndex ?? -1) + 1;
    const isLastStep = totalSteps && nextIndex >= totalSteps - 1;

    const update = {
      $push: { auditLog: logEntry },
      $set: {
        currentStepIndex: nextIndex,
        status: isLastStep ? "Completed" : "InProgress",
      },
    };
    if (isLastStep) {
      update.$set.completedBy = doneBy;
      update.$set.completedAt = new Date();
    }

    const order = await DoctorOrder.findByIdAndUpdate(req.params.id, update, { new: true });
    res.json({ success: true, data: order });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// DELETE /:id — cancel order
router.delete("/:id", async (req, res) => {
  try {
    await DoctorOrder.findByIdAndUpdate(req.params.id, { status: "Cancelled" });
    res.json({ success: true, message: "Order cancelled" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
