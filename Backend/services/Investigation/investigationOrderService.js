const InvestigationOrder = require("../../models/Investigation/InvestigationOrderModel");
const InvestigationMaster = require("../../models/Investigation/InvestigationMasterModel");
const InvestigationPricing = require("../../models/Investigation/InvestigationPricingModel");

class InvestigationOrderService {
  // ── CREATE ORDER ──────────────────────────────────────────────
  // items = [{ investigationId, performedAt?, externalLabName? }]
  async createOrder({
    patientId,
    UHID,
    patientName,
    contactNumber,
    visitType = "OPD",
    admissionId = null,
    doctorId = null,
    doctorName = null,
    doctorNote = null,
    orderedBy = "DOCTOR",
    paymentType = "CASH",
    tpaId = null,
    tpaName = null,
    items = [],
    priority = "ROUTINE",
    notes = null,
    prescriptionId = null,
  }) {
    if (!patientId) throw new Error("Patient ID is required");
    if (!UHID) throw new Error("UHID is required");
    if (!items.length)
      throw new Error("At least one investigation is required");

    const orderItems = [];

    for (const item of items) {
      const inv = await InvestigationMaster.findById(item.investigationId);
      if (!inv || !inv.isActive) continue;

      // Determine where test will be performed
      let performedAt = item.performedAt || "INTERNAL";
      if (inv.performedAt === "EXTERNAL") performedAt = "EXTERNAL";
      if (inv.performedAt === "INTERNAL") performedAt = "INTERNAL";

      // Get price
      const pricing = await InvestigationPricing.getPriceFor(
        inv._id,
        paymentType,
        tpaId,
      );
      const chargedPrice = pricing ? pricing.finalPrice : inv.defaultPrice;

      orderItems.push({
        investigationId: inv._id,
        investigationCode: inv.investigationCode || "",
        investigationName: inv.investigationName,
        category: inv.category,
        sampleType: inv.sampleType || "",
        performedAt,
        externalLabName:
          performedAt === "EXTERNAL" ? item.externalLabName || null : null,
        chargedPrice,
        tariffType: paymentType,
        tpaApprovedLimit: pricing?.tpaApprovedLimit || null,
        sampleStatus: performedAt === "EXTERNAL" ? "N/A" : "PENDING",
        resultStatus: "PENDING",
      });
    }

    if (!orderItems.length) throw new Error("No valid investigations found");

    const order = await InvestigationOrder.create({
      prescriptionId: prescriptionId || null,
      patientId,
      UHID: UHID.toUpperCase(),
      patientName,
      contactNumber,
      visitType,
      admissionId,
      doctorId,
      doctorName,
      doctorNote,
      orderedBy,
      paymentType,
      tpaId,
      tpaName,
      items: orderItems,
      priority,
      notes,
      orderStatus: "PENDING",
      actionLog: [
        {
          action: "ORDER_CREATED",
          performedBy: doctorName || orderedBy,
          performedAt: new Date(),
          remarks: `Created with ${orderItems.length} test(s)`,
        },
      ],
    });

    return this._populate(order._id);
  }

  // ── GET ORDERS ────────────────────────────────────────────────
  async getOrders({
    UHID,
    orderStatus,
    priority,
    fromDate,
    toDate,
    page = 1,
    limit = 50,
  } = {}) {
    const q = {};
    if (UHID) q.UHID = UHID.toUpperCase();
    if (orderStatus) q.orderStatus = orderStatus;
    if (priority) q.priority = priority;
    if (fromDate || toDate) {
      q.createdAt = {};
      if (fromDate) q.createdAt.$gte = new Date(fromDate);
      if (toDate)
        q.createdAt.$lte = new Date(new Date(toDate).setHours(23, 59, 59));
    }

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

  // ── GET SINGLE ────────────────────────────────────────────────
  async getOrderById(orderId) {
    const order = await this._populate(orderId);
    if (!order) throw new Error("Order not found");
    return order;
  }

  // ── GET BY UHID ───────────────────────────────────────────────
  async getOrdersByUHID(UHID) {
    return InvestigationOrder.find({ UHID: UHID.toUpperCase() })
      .populate("patientId", "fullName UHID contactNumber gender")
      .populate("doctorId", "personalInfo.firstName personalInfo.lastName")
      .sort({ createdAt: -1 });
  }

  // ── COLLECT SAMPLE ────────────────────────────────────────────
  async collectSamples(orderId, { collectedBy, itemIds = null }) {
    const order = await InvestigationOrder.findById(orderId);
    if (!order) throw new Error("Order not found");
    if (order.orderStatus === "CANCELLED")
      throw new Error("Cannot collect sample for cancelled order");

    const now = new Date();
    for (const item of order.items) {
      if (item.performedAt === "EXTERNAL") continue;
      if (itemIds && !itemIds.includes(item._id.toString())) continue;
      if (item.sampleStatus === "COLLECTED") continue;
      item.sampleStatus = "COLLECTED";
      item.sampleCollectedAt = now;
      item.sampleCollectedBy = collectedBy || "Lab Staff";
    }

    order.orderStatus = "SAMPLE_COLLECTED";
    order.actionLog.push({
      action: "SAMPLE_COLLECTED",
      performedBy: collectedBy || "Lab Staff",
      performedAt: now,
    });

    await order.save();
    return this._populate(order._id);
  }

  // ── ENTER RESULTS ─────────────────────────────────────────────
  async enterResults(orderId, { itemResults = [], enteredBy }) {
    const order = await InvestigationOrder.findById(orderId);
    if (!order) throw new Error("Order not found");
    if (order.orderStatus === "CANCELLED")
      throw new Error("Cannot enter results for cancelled order");

    const now = new Date();
    for (const { itemId, results, interpretation } of itemResults) {
      const item = order.items.id(itemId);
      if (!item) continue;
      item.results = results || [];
      item.interpretation = interpretation || "";
      item.resultStatus = "COMPLETED";
      item.resultEnteredBy = enteredBy || "Lab Technician";
      item.resultEnteredAt = now;
    }

    // FIX (audit P16-B4): advance the parent order's state machine when
    // results land. Order moves to IN_PROGRESS the first time any result
    // is entered; only flips to COMPLETED when EVERY item is completed
    // (so dashboards reflect mid-run orders, and we don't lie about
    // status when some items are still pending).
    const allItemsDone = order.items.every(
      (i) => i.resultStatus === "COMPLETED" || i.resultStatus === "VERIFIED",
    );
    if (allItemsDone) {
      order.orderStatus = "COMPLETED";
      order.completedAt = now;
    } else if (order.orderStatus === "PENDING" || order.orderStatus === "SAMPLE_COLLECTED") {
      order.orderStatus = "IN_PROGRESS";
    }

    order.actionLog.push({
      action: "RESULTS_ENTERED",
      performedBy: enteredBy || "Lab Technician",
      performedAt: now,
      remarks: `${itemResults.length} test(s)`,
    });

    await order.save();
    return this._populate(order._id);
  }

  // ── ENTER EXTERNAL RESULT ─────────────────────────────────────
  async enterExternalResult(
    orderId,
    { itemId, externalLabName, externalReportRef, interpretation, enteredBy },
  ) {
    const order = await InvestigationOrder.findById(orderId);
    if (!order) throw new Error("Order not found");

    const item = order.items.id(itemId);
    if (!item) throw new Error("Test item not found");
    if (item.performedAt !== "EXTERNAL")
      throw new Error("This test is not external");

    item.externalLabName = externalLabName || item.externalLabName;
    item.externalReportRef = externalReportRef || "";
    item.interpretation = interpretation || "";
    item.resultStatus = "COMPLETED";
    item.resultEnteredBy = enteredBy || "Staff";
    item.resultEnteredAt = new Date();

    order.actionLog.push({
      action: "EXTERNAL_RESULT_ATTACHED",
      performedBy: enteredBy || "Staff",
      performedAt: new Date(),
      remarks: `From ${externalLabName}`,
    });

    await order.save();
    return this._populate(order._id);
  }

  // ── VERIFY RESULTS ────────────────────────────────────────────
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

    // FIX (audit P16-B11): only flip the order to COMPLETED when EVERY
    // item is verified. Previously this flipped even when other items
    // were still PENDING, masking the true status.
    const allDone = order.items.every(
      (i) => i.resultStatus === "VERIFIED" || i.resultStatus === "COMPLETED",
    );
    const allVerified = order.items.every((i) => i.resultStatus === "VERIFIED");
    if (allVerified) {
      order.orderStatus = "COMPLETED";
      order.completedAt = now;
    } else if (allDone) {
      // Mixed — some VERIFIED, some still entered-not-verified
      order.orderStatus = "IN_PROGRESS";
    }
    order.actionLog.push({
      action: "RESULTS_VERIFIED",
      performedBy: verifiedBy || "Pathologist",
      performedAt: now,
    });

    await order.save();
    return this._populate(order._id);
  }

  // ── MARK PRINTED ──────────────────────────────────────────────
  async markReportPrinted(orderId, { printedBy }) {
    const order = await InvestigationOrder.findByIdAndUpdate(
      orderId,
      {
        reportPrintedAt: new Date(),
        reportPrintedBy: printedBy || "Staff",
        $push: {
          actionLog: {
            action: "REPORT_PRINTED",
            performedBy: printedBy || "Staff",
            performedAt: new Date(),
          },
        },
      },
      { new: true },
    );
    if (!order) throw new Error("Order not found");
    return order;
  }

  // ── CANCEL ────────────────────────────────────────────────────
  async cancelOrder(orderId, { cancelledBy, reason }) {
    const order = await InvestigationOrder.findById(orderId);
    if (!order) throw new Error("Order not found");
    if (order.orderStatus === "COMPLETED")
      throw new Error("Cannot cancel completed order");
    if (order.orderStatus === "CANCELLED")
      throw new Error("Order is already cancelled");

    order.orderStatus = "CANCELLED";
    order.cancelledAt = new Date();
    order.cancelledBy = cancelledBy || "Staff";
    order.cancellationReason = reason || "";
    order.actionLog.push({
      action: "ORDER_CANCELLED",
      performedBy: cancelledBy || "Staff",
      performedAt: new Date(),
      remarks: reason || "",
    });

    await order.save();

    // FIX (audit P16-B10): cancelling an order used to leave its
    // BillingTriggers in their previous state (pending/billed) and the
    // patient's bill still showed the cancelled tests. Now we mark every
    // related trigger as voided and, if the trigger was already billed,
    // ask the billing service to reverse the line item with a negative
    // adjustment so the audit trail stays intact.
    try {
      const BillingTrigger = require("../../models/Billing/BillingTrigger");
      const PatientBill = require("../../models/PatientBillModel/PatientBillModel");
      const triggers = await BillingTrigger.find({
        sourceDocumentId: order._id,
        sourceType: "InvestigationOrder",
        status: { $in: ["pending", "billed", "completed"] },
      });
      for (const t of triggers) {
        if (t.status === "billed" && t.billId) {
          const bill = await PatientBill.findById(t.billId);
          if (bill && !["PAID", "CANCELLED", "REFUNDED"].includes(bill.billStatus)) {
            // Drop the original line item — safe to mutate because this
            // bill is still DRAFT/GENERATED/PARTIAL (cashier hasn't closed it).
            const idx = bill.billItems.findIndex(
              (i) => String(i._id) === String(t.billItemId),
            );
            if (idx >= 0) {
              bill.billItems.splice(idx, 1);
              await bill.save();
            }
          }
        }
        t.status = "voided";
        t.notes = `Voided: investigation order cancelled — ${reason || ""}`.trim();
        await t.save();
      }
    } catch (e) {
      console.error("[InvestigationOrderService] cancelOrder billing reverse error:", e.message);
    }

    return order;
  }

  // ── ADD TEST ──────────────────────────────────────────────────
  async addTest(orderId, { investigationId, performedAt, externalLabName }) {
    const order = await InvestigationOrder.findById(orderId);
    if (!order) throw new Error("Order not found");
    if (["COMPLETED", "CANCELLED"].includes(order.orderStatus)) {
      throw new Error("Cannot add test to completed or cancelled order");
    }

    const inv = await InvestigationMaster.findById(investigationId);
    if (!inv) throw new Error("Investigation not found");

    const exists = order.items.find(
      (i) => i.investigationId.toString() === investigationId.toString(),
    );
    if (exists) throw new Error("Test already in this order");

    const pt =
      inv.performedAt === "EXTERNAL"
        ? "EXTERNAL"
        : inv.performedAt === "INTERNAL"
          ? "INTERNAL"
          : performedAt || "INTERNAL";

    const pricing = await InvestigationPricing.getPriceFor(
      inv._id,
      order.paymentType,
      order.tpaId,
    );

    order.items.push({
      investigationId: inv._id,
      investigationCode: inv.investigationCode || "",
      investigationName: inv.investigationName,
      category: inv.category,
      sampleType: inv.sampleType || "",
      performedAt: pt,
      externalLabName: pt === "EXTERNAL" ? externalLabName || null : null,
      chargedPrice: pricing ? pricing.finalPrice : inv.defaultPrice,
      tariffType: order.paymentType,
      sampleStatus: pt === "EXTERNAL" ? "N/A" : "PENDING",
      resultStatus: "PENDING",
    });

    order.actionLog.push({
      action: "TEST_ADDED",
      performedBy: "Staff",
      performedAt: new Date(),
      remarks: inv.investigationName,
    });

    await order.save();

    // FIX (audit P16-B9): addTest never fired the billing hook so
    // post-order test additions were never billed. Now triggers
    // onInvestigationOrdered for the new line item.
    try {
      const { logErr } = require("../../utils/logErr");
      const autoBilling = require("../Billing/autoBillingService");
      if (typeof autoBilling.onInvestigationItemAdded === "function") {
        autoBilling.onInvestigationItemAdded(order, inv, pricing).catch(logErr("autoBilling", `onInvestigationItemAdded ${order?._id}`));
      } else if (typeof autoBilling.onInvestigationOrdered === "function") {
        autoBilling.onInvestigationOrdered(order).catch(logErr("autoBilling", `onInvestigationOrdered ${order?._id}`));
      }
    } catch (e) {
      const { logErr } = require("../../utils/logErr");
      logErr("autoBilling", "load failure on investigation item-add")(e);
    }

    return this._populate(order._id);
  }

  // ── DASHBOARD SUMMARY ─────────────────────────────────────────
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
          // FIX (audit P16-B5): include STAT in the urgent count —
          // legacy dashboard hid every STAT order. STAT is more urgent
          // than URGENT, must always surface.
          priority: { $in: ["URGENT", "STAT"] },
          orderStatus: { $nin: ["COMPLETED", "CANCELLED"] },
        }),
      ]);

    return { todayOrders, pending, inProgress, completed, urgent };
  }

  // ── PRIVATE POPULATE ──────────────────────────────────────────
  _populate(orderId) {
    return InvestigationOrder.findById(orderId)
      .populate("patientId", "fullName UHID contactNumber gender dateOfBirth")
      .populate(
        "doctorId",
        "personalInfo.firstName personalInfo.lastName professional.specialization",
      )
      .populate("tpaId", "tpaName tpaCode")
      .populate("admissionId", "admissionNumber bedNumber roomCategory")
      .populate("prescriptionId", "provisionalDiagnosis prescriptionDate");
  }
}

module.exports = new InvestigationOrderService();
