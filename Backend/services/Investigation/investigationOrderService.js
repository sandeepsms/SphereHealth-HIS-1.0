// services/investigationOrderService.js
const InvestigationOrder = require("../../models/Investigation/InvestigationOrderModel");
const InvestigationMaster = require("../../models/Investigation/InvestigationMasterModel");
const InvestigationPricing = require("../../models/Investigation/InvestigationPricingModel");

class InvestigationOrderService {
  // ── 1. Create new order ───────────────────────────────────────
  // Doctor ya counter se aata hai
  // investigationIds[] + patient + visitType
  async createOrder({
    patientId,
    UHID,
    patientName,
    contactNumber,
    visitType = "OPD",
    admissionId = null,
    opdVisitId = null,
    doctorId = null,
    doctorName = null,
    doctorNote = null,
    orderedBy = "DOCTOR",
    paymentType = "CASH",
    tpaId = null,
    tpaName = null,
    investigationIds = [], // array of investigationId
    priority = "ROUTINE",
    notes = null,
  }) {
    if (!investigationIds.length)
      throw new Error("Kam se kam ek investigation select karo");

    // Fetch all investigations + their prices
    const items = [];
    for (const invId of investigationIds) {
      const inv = await InvestigationMaster.findById(invId);
      if (!inv || !inv.isActive) continue;

      // Get effective price: TPA → CASH fallback
      const pricing = await InvestigationPricing.getPriceFor(
        invId,
        paymentType,
        tpaId,
      );
      const chargedPrice = pricing ? pricing.finalPrice : inv.defaultPrice;

      items.push({
        investigationId: inv._id,
        investigationCode: inv.investigationCode,
        investigationName: inv.investigationName,
        category: inv.category,
        sampleType: inv.sampleType || "",
        chargedPrice,
        tariffType: paymentType,
        tpaApprovedLimit: pricing?.tpaApprovedLimit || null,
        sampleStatus: "PENDING",
        resultStatus: "PENDING",
      });
    }

    if (!items.length)
      throw new Error("Selected investigations nahi mili ya inactive hain");

    const order = await InvestigationOrder.create({
      patientId,
      UHID,
      patientName,
      contactNumber,
      visitType,
      admissionId,
      opdVisitId,
      doctorId,
      doctorName,
      doctorNote,
      orderedBy,
      paymentType,
      tpaId,
      tpaName,
      items,
      priority,
      notes,
      orderStatus: "PENDING",
    });

    return this._populate(order);
  }

  // ── 2. Get orders list ────────────────────────────────────────
  async getOrders({
    UHID,
    orderStatus,
    resultStatus,
    priority,
    fromDate,
    toDate,
    page = 1,
    limit = 50,
  } = {}) {
    const q = {};
    if (UHID) q.UHID = UHID;
    if (orderStatus) q.orderStatus = orderStatus;
    if (priority) q.priority = priority;
    if (fromDate || toDate) {
      q.createdAt = {};
      if (fromDate) q.createdAt.$gte = new Date(fromDate);
      if (toDate)
        q.createdAt.$lte = new Date(new Date(toDate).setHours(23, 59, 59));
    }
    if (resultStatus) q["items.resultStatus"] = resultStatus;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [orders, total] = await Promise.all([
      InvestigationOrder.find(q)
        .populate("patientId", "fullName UHID contactNumber gender")
        .populate("doctorId", "personalInfo.firstName personalInfo.lastName")
        .populate("tpaId", "tpaName")
        .sort({ createdAt: -1 })
        .limit(parseInt(limit))
        .skip(skip),
      InvestigationOrder.countDocuments(q),
    ]);

    return {
      orders,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit)),
    };
  }

  // ── 3. Get single order ───────────────────────────────────────
  async getOrderById(orderId) {
    const order = await this._populate(
      await InvestigationOrder.findById(orderId),
    );
    if (!order) throw new Error("Order not found");
    return order;
  }

  // ── 4. Get orders for a patient ───────────────────────────────
  async getOrdersByUHID(UHID) {
    const orders = await InvestigationOrder.find({ UHID })
      .populate("doctorId", "personalInfo.firstName personalInfo.lastName")
      .sort({ createdAt: -1 });
    return orders;
  }

  // ── 5. Sample collection ──────────────────────────────────────
  // Lab assistant phlebotomist sample collect karta hai
  async collectSamples(
    orderId,
    { collectedBy, itemIds = null, barcode = null },
  ) {
    const order = await InvestigationOrder.findById(orderId);
    if (!order) throw new Error("Order not found");
    if (order.orderStatus === "CANCELLED")
      throw new Error("Cancelled order ka sample nahi le sakte");

    const now = new Date();
    for (const item of order.items) {
      // Agar itemIds specified hain to sirf unke liye, warna sab
      if (itemIds && !itemIds.includes(item._id.toString())) continue;
      if (item.sampleStatus === "COLLECTED") continue;

      item.sampleStatus = "COLLECTED";
      item.sampleCollectedAt = now;
      item.sampleCollectedBy = collectedBy || "Lab Staff";
      if (barcode) item.sampleBarcode = barcode;
    }

    order.orderStatus = "SAMPLE_COLLECTED";
    await order.save();
    return this._populate(order);
  }

  // ── 6. Mark sample received at lab ───────────────────────────
  async receiveAtLab(orderId, { receivedBy, itemIds = null }) {
    const order = await InvestigationOrder.findById(orderId);
    if (!order) throw new Error("Order not found");

    for (const item of order.items) {
      if (itemIds && !itemIds.includes(item._id.toString())) continue;
      if (item.sampleStatus !== "COLLECTED") continue;
      item.sampleStatus = "RECEIVED_AT_LAB";
      item.resultStatus = "IN_PROGRESS";
    }

    await order.save();
    return this._populate(order);
  }

  // ── 7. Enter results ──────────────────────────────────────────
  // Lab technician results enter karta hai
  // itemResults = [{ itemId, results: [{parameterName, value, unit, normalRange, isAbnormal}], interpretation }]
  async enterResults(orderId, { itemResults = [], enteredBy }) {
    const order = await InvestigationOrder.findById(orderId);
    if (!order) throw new Error("Order not found");
    if (order.orderStatus === "CANCELLED")
      throw new Error("Cancelled order ka result nahi enter kar sakte");

    const now = new Date();
    for (const { itemId, results, interpretation } of itemResults) {
      const item = order.items.id(itemId);
      if (!item) continue;

      item.results = results || [];
      item.interpretation = interpretation || "";
      item.resultStatus = "COMPLETED";
      item.resultEnteredBy = enteredBy || "Lab";
      item.resultEnteredAt = now;
    }

    await order.save();
    return this._populate(order);
  }

  // ── 8. Verify results (Senior/Pathologist) ───────────────────
  async verifyResults(orderId, { verifiedBy, itemIds = null }) {
    const order = await InvestigationOrder.findById(orderId);
    if (!order) throw new Error("Order not found");

    const now = new Date();
    for (const item of order.items) {
      if (itemIds && !itemIds.includes(item._id.toString())) continue;
      if (item.resultStatus !== "COMPLETED") continue;
      item.resultStatus = "VERIFIED";
      item.verifiedBy = verifiedBy;
      item.verifiedAt = now;
    }

    await order.save();
    return this._populate(order);
  }

  // ── 9. Mark report printed ────────────────────────────────────
  async markReportPrinted(orderId, { printedBy }) {
    const order = await InvestigationOrder.findByIdAndUpdate(
      orderId,
      { reportPrintedAt: new Date(), reportPrintedBy: printedBy || "Staff" },
      { new: true },
    );
    if (!order) throw new Error("Order not found");
    return order;
  }

  // ── 10. Cancel order ─────────────────────────────────────────
  async cancelOrder(orderId, { cancelledBy, reason }) {
    const order = await InvestigationOrder.findById(orderId);
    if (!order) throw new Error("Order not found");
    if (order.orderStatus === "COMPLETED")
      throw new Error("Completed order cancel nahi ho sakta");

    order.orderStatus = "CANCELLED";
    order.cancelledAt = new Date();
    order.cancelledBy = cancelledBy || "Staff";
    order.cancellationReason = reason || "";
    await order.save();
    return order;
  }

  // ── 11. Add test to existing order ───────────────────────────
  async addTestToOrder(orderId, { investigationId }) {
    const order = await InvestigationOrder.findById(orderId);
    if (!order) throw new Error("Order not found");
    if (["COMPLETED", "CANCELLED"].includes(order.orderStatus)) {
      throw new Error("Completed/Cancelled order mein test nahi add ho sakta");
    }

    const inv = await InvestigationMaster.findById(investigationId);
    if (!inv) throw new Error("Investigation not found");

    const alreadyExists = order.items.find(
      (i) => i.investigationId.toString() === investigationId.toString(),
    );
    if (alreadyExists) throw new Error("Yeh test already is order mein hai");

    const pricing = await InvestigationPricing.getPriceFor(
      investigationId,
      order.paymentType,
      order.tpaId,
    );
    const chargedPrice = pricing ? pricing.finalPrice : inv.defaultPrice;

    order.items.push({
      investigationId: inv._id,
      investigationCode: inv.investigationCode,
      investigationName: inv.investigationName,
      category: inv.category,
      sampleType: inv.sampleType || "",
      chargedPrice,
      tariffType: order.paymentType,
      tpaApprovedLimit: pricing?.tpaApprovedLimit || null,
      sampleStatus: "PENDING",
      resultStatus: "PENDING",
    });

    await order.save();
    return this._populate(order);
  }

  // ── 12. Dashboard summary ─────────────────────────────────────
  async getDashboardSummary() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [todayOrders, pending, inProgress, completed, urgent] =
      await Promise.all([
        InvestigationOrder.countDocuments({ createdAt: { $gte: today } }),
        InvestigationOrder.countDocuments({ orderStatus: "PENDING" }),
        InvestigationOrder.countDocuments({ orderStatus: "IN_PROGRESS" }),
        InvestigationOrder.countDocuments({
          orderStatus: "COMPLETED",
          createdAt: { $gte: today },
        }),
        InvestigationOrder.countDocuments({
          priority: "URGENT",
          orderStatus: { $nin: ["COMPLETED", "CANCELLED"] },
        }),
      ]);

    return { todayOrders, pending, inProgress, completed, urgent };
  }

  // ── Private: populate helper ──────────────────────────────────
  _populate(order) {
    if (!order) return null;
    return InvestigationOrder.findById(order._id)
      .populate("patientId", "fullName UHID contactNumber gender dateOfBirth")
      .populate(
        "doctorId",
        "personalInfo.firstName personalInfo.lastName professional.specialization",
      )
      .populate("tpaId", "tpaName tpaCode")
      .populate("admissionId", "admissionNumber bedNumber roomCategory")
      .populate(
        "items.investigationId",
        "investigationName investigationCode category sampleType tatHours",
      );
  }
}

module.exports = new InvestigationOrderService();
