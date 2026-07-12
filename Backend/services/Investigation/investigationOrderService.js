const InvestigationOrder = require("../../models/Investigation/InvestigationOrderModel");
const InvestigationMaster = require("../../models/Investigation/InvestigationMasterModel");
const InvestigationPricing = require("../../models/Investigation/InvestigationPricingModel");

// NABL / ISO 15189 7.4.1 — compute the biological flag SERVER-SIDE from the
// numeric reference interval + critical thresholds carried on the result, so
// the H/L/critical flag is derived, not a manually-typed isAbnormal. Returns
// { flag, isAbnormal, critical, severity } — critical drives the auto-alert.
// (Age/sex-stratified interval SELECTION from a reference-range master is a
// separate follow-up; here the interval is supplied on the result payload.)
function _classifyResult(r) {
  const out = { flag: "", isAbnormal: false, critical: false, severity: null };
  const v = parseFloat(r.value);
  const fin = (x) => typeof x === "number" && Number.isFinite(x);
  if (!Number.isFinite(v)) {
    out.isAbnormal = !!r.isAbnormal;
    out.flag = r.isAbnormal ? "A" : "";
    return out;
  }
  if (fin(r.criticalLow) && v <= r.criticalLow)   { return { flag: "LL", isAbnormal: true, critical: true, severity: "PANIC" }; }
  if (fin(r.criticalHigh) && v >= r.criticalHigh) { return { flag: "HH", isAbnormal: true, critical: true, severity: "PANIC" }; }
  if (fin(r.refLow) && v < r.refLow)   { return { flag: "L", isAbnormal: true, critical: false, severity: null }; }
  if (fin(r.refHigh) && v > r.refHigh) { return { flag: "H", isAbnormal: true, critical: false, severity: null }; }
  if (fin(r.refLow) || fin(r.refHigh)) { return { flag: "N", isAbnormal: false, critical: false, severity: null }; }
  // No interval supplied — fall back to the manually-supplied isAbnormal.
  out.isAbnormal = !!r.isAbnormal;
  out.flag = r.isAbnormal ? "A" : "";
  return out;
}

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

  // ── REJECT SAMPLE ─────────────────────────────────────────────
  // NABL / ISO 15189 7.2.6 — pre-analytical sample rejection with a structured
  // reason. A rejected item's sampleStatus → REJECTED and result entry is
  // blocked (enterResults throws SAMPLE_REJECTED) until the sample is recollected.
  static get REJECTION_REASONS() {
    return ["Hemolysed", "Clotted", "Insufficient-quantity", "Mislabelled", "Wrong-container", "Contaminated", "Delayed-transport", "Improper-storage", "Other"];
  }

  async rejectSample(orderId, { itemIds = null, rejectionReason, rejectedBy }) {
    const valid = InvestigationOrderService.REJECTION_REASONS;
    if (!rejectionReason || !valid.includes(rejectionReason)) {
      const err = new Error(`rejectionReason is required and must be one of: ${valid.join(", ")}`);
      err.code = "INVALID_REJECTION_REASON"; err.status = 400; throw err;
    }
    const order = await InvestigationOrder.findById(orderId);
    if (!order) throw new Error("Order not found");
    if (order.orderStatus === "CANCELLED") throw new Error("Cannot reject sample for a cancelled order");

    const now = new Date();
    let n = 0;
    for (const item of order.items) {
      if (item.performedAt === "EXTERNAL") continue;
      if (itemIds && !itemIds.includes(item._id.toString())) continue;
      if (item.resultStatus === "VERIFIED") continue; // never reject an already-released result
      item.sampleStatus   = "REJECTED";
      item.rejectionReason = rejectionReason;
      item.rejectedBy     = rejectedBy || "Lab Staff";
      item.rejectedAt     = now;
      item.resultStatus   = "PENDING";
      n++;
    }
    if (!n) { const err = new Error("No eligible sample items to reject"); err.status = 400; throw err; }

    order.actionLog.push({ action: "SAMPLE_REJECTED", performedBy: rejectedBy || "Lab Staff", performedAt: now, remarks: `${n} item(s): ${rejectionReason}` });
    await order.save();
    return this._populate(order._id);
  }

  // ── AMEND VERIFIED RESULT ─────────────────────────────────────
  // NABL / ISO 15189 7.4.1.7 — a released (VERIFIED) result may only be
  // corrected through a recorded amendment: the old→new value + reason are
  // kept in an append-only trail, never a silent overwrite.
  async amendResult(orderId, { itemId, amendments = [], amendedBy }) {
    const order = await InvestigationOrder.findById(orderId);
    if (!order) throw new Error("Order not found");
    const item = order.items.id(itemId);
    if (!item) throw new Error("Test item not found");
    if (item.resultStatus !== "VERIFIED") {
      const err = new Error("Amendment applies only to a VERIFIED (released) result — edit the draft directly otherwise");
      err.code = "NOT_VERIFIED"; err.status = 409; throw err;
    }
    if (!Array.isArray(amendments) || !amendments.length) {
      const err = new Error("amendments[] with { parameterName, newValue, reason } is required"); err.status = 400; throw err;
    }
    const now = new Date();
    for (const am of amendments) {
      if (!am.reason || !String(am.reason).trim()) { const e = new Error("Each amendment needs a reason (ISO 15189 7.4.1.7)"); e.status = 400; throw e; }
      const r = item.results.find((x) => x.parameterName === am.parameterName);
      if (!r) { const e = new Error(`Parameter "${am.parameterName}" not found on this result`); e.status = 400; throw e; }
      const oldVal = r.value;
      item.amendments.push({ field: `${am.parameterName}.value`, oldValue: String(oldVal), newValue: String(am.newValue), reason: String(am.reason).trim(), amendedBy: amendedBy || "Pathologist", amendedAt: now });
      r.value = String(am.newValue);
      const c = _classifyResult(r); r.flag = c.flag; r.isAbnormal = c.isAbnormal;
    }
    // Re-attest the amended report.
    item.verifiedBy = amendedBy || item.verifiedBy;
    item.verifiedAt = now;
    order.actionLog.push({ action: "RESULTS_AMENDED", performedBy: amendedBy || "Pathologist", performedAt: now, remarks: `${amendments.length} field(s) on ${item.investigationName}` });
    // Sanctioned amendment path — bypass the post-verification result lock
    // (the old→new value + reason is preserved in item.amendments[] above).
    order._amendmentInProgress = true;
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
    const criticalHits = []; // { item, r, severity } → auto-alert after save
    for (const { itemId, results, interpretation, analyser } of itemResults) {
      const item = order.items.id(itemId);
      if (!item) continue;
      if (analyser) item.analyser = String(analyser).trim(); // NABL — drives the QC-release gate at verify
      // NABL 7.2.6 — a REJECTED sample cannot carry results; recollect first.
      if (item.sampleStatus === "REJECTED") {
        const err = new Error(`Sample for "${item.investigationName}" was REJECTED (${item.rejectionReason || "no reason"}) — recollect before entering results`);
        err.code = "SAMPLE_REJECTED"; err.status = 409; throw err;
      }
      // NABL 7.4.1.7 — a VERIFIED (released) result is locked; corrections
      // must go through the amend endpoint, never a silent re-entry.
      if (item.resultStatus === "VERIFIED") {
        const err = new Error(`Results for "${item.investigationName}" are VERIFIED and locked — use /amend to correct a released result`);
        err.code = "RESULT_VERIFIED_LOCKED"; err.status = 409; throw err;
      }
      const rows = (results || []).map((r) => {
        const c = _classifyResult(r);
        r.flag = c.flag;
        r.isAbnormal = c.isAbnormal;
        if (!r.normalRange && (typeof r.refLow === "number" || typeof r.refHigh === "number")) {
          r.normalRange = `${r.refLow ?? ""} - ${r.refHigh ?? ""}`.trim();
        }
        if (c.critical) criticalHits.push({ item, r, severity: c.severity });
        return r;
      });
      item.results = rows;
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
      remarks: `${itemResults.length} test(s)${criticalHits.length ? ` · ${criticalHits.length} critical` : ""}`,
    });

    await order.save();

    // NABL / ISO 15189 7.4.1(h) + IPSG.2 — auto-fire a critical-value alert for
    // every panic result the moment it is charted (the clinician read-back is
    // captured on the alert's acknowledge). Best-effort; never blocks the save.
    if (criticalHits.length) {
      try {
        const alerter = require("../Notification/criticalValueAlerter");
        for (const h of criticalHits) {
          await alerter.emit({
            kind: "LAB",
            patientUHID: order.UHID,
            patientName: order.patientName || "",
            sourceRef: order._id,
            sourceKind: "InvestigationOrder",
            valueLabel: `${h.r.parameterName} ${h.r.value}${h.r.unit ? " " + h.r.unit : ""} (${h.r.flag})`,
            severity: h.severity === "PANIC" ? "PANIC" : "CRITICAL",
            emittedBy: enteredBy || "Lab",
            notes: `Test: ${h.item.investigationName}; order ${order.orderNumber || order._id}`,
          });
        }
        order.actionLog.push({ action: "CRITICAL_VALUE_ALERTED", performedBy: enteredBy || "Lab", performedAt: new Date(), remarks: `${criticalHits.length} panic value(s)` });
        await order.save();
      } catch (e) {
        try { require("../../utils/logErr").logErr("criticalValueAlerter", `emit on lab results ${order._id}`)(e); }
        catch { console.error("[investigationOrderService] critical-alert emit failed:", e?.message); }
      }
    }

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

    // NABL / ISO 15189 7.3.7 — QC-release gate. Any item run on an analyser
    // whose LATEST QC control FAILED must not be released until a passing
    // control is logged. Items with no analyser verify as before (parity with
    // the LabTrend verify gate).
    const analysers = [...new Set(
      order.items
        .filter((i) => (!itemIds || itemIds.includes(i._id.toString())) && i.analyser && i.resultStatus === "COMPLETED")
        .map((i) => i.analyser.trim()),
    )];
    if (analysers.length) {
      const LabQCLog = require("../../models/Lab/LabQCLogModel");
      const { escapeRegex } = require("../../utils/queryGuards");
      for (const a of analysers) {
        const lastQc = await LabQCLog.findOne({ equipmentName: new RegExp(`^${escapeRegex(a)}$`, "i") }).sort({ performedAt: -1 }).lean();
        if (lastQc && lastQc.result === "FAIL") {
          const err = new Error(`Release blocked — latest QC on ${a} FAILED (${new Date(lastQc.performedAt).toLocaleString("en-IN")}). Log a passing control, then verify.`);
          err.code = "QC_FAILED"; err.status = 409; throw err;
        }
      }
    }

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
