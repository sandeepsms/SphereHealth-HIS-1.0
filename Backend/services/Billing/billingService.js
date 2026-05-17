// services/billingService.js
const PatientBill = require("../../models/PatientBillModel/PatientBillModel");
const Admission = require("../../models/Patient/admissionModel");
const ServiceMaster = require("../../models/ServiceMaster/serviceMasterModel");
const ServicePricing = require("../../models/ServicePricing/ServicePricingModel");
const AutoBilledItems = require("../../models/PatientBillModel/AutoBilledItemsModel");
const { toNum } = require("../../utils/money");

async function generateBillNumber() {
  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, "");
  const prefix = `BILL-${dateStr}-`;
  const count = await PatientBill.countDocuments({
    billNumber: { $regex: `^${prefix}` },
  });
  const serial = String(count + 1).padStart(5, "0");
  return `${prefix}${serial}`;
}

class BillingService {
  // ── 1. Patient + all bills by UHID ───────────────────────────
  async getPatientWithBills(UHID) {
    const Patient = require("../../models/Patient/patientModel");

    const [bills, patient] = await Promise.all([
      this.getBillsByUHID(UHID),
      Patient.findOne({ UHID })
        .populate("tpa", "tpaName tpaCode")
        .populate("department", "departmentName")
        .populate("doctor", "personalInfo"),
    ]);

    if (!patient) throw new Error(`Patient not found: ${UHID}`);
    return { patient, bills };
  }

  // ── 2. Get existing DRAFT bill or create new one ──────────────
  async getOrCreateDraftBill(UHID, visitType, admissionId = null) {
    const Patient = require("../../models/Patient/patientModel");

    const patient = await Patient.findOne({ UHID }).populate("tpa");
    if (!patient) throw new Error(`Patient not found: ${UHID}`);

    const filter = { UHID, visitType, billStatus: "DRAFT" };
    if (admissionId) filter.admission = admissionId;

    let bill = await PatientBill.findOne(filter);
    if (bill) {
      // Existing DRAFT bill — top up any missed days/visits (e.g. today's
      // bed + nursing if the nightly cron hasn't fired yet). Idempotent
      // via dailyDedup, so safe to call on every open.
      if (admissionId) {
        try {
          const adm = await Admission.findById(admissionId).lean();
          if (adm && (adm.status === "Active" || adm.status === "Transferred")) {
            const autoBilling = require("./autoBillingService");
            const r = await autoBilling.backfillAdmissionCharges(adm);
            console.log(
              `[Billing] top-up backfill for ADM ${adm.admissionNumber}:`,
              `bed=${r.bedFired} nursing=${r.nurseFired}`,
              `doctor=${r.doctorFired} consumables=${r.consumableFired}`,
              `skipped=${r.skipped} errors=${r.errors}`,
            );
            const refreshed = await PatientBill.findById(bill._id);
            if (refreshed) bill = refreshed;
          }
        } catch (e) {
          console.error("[Billing] top-up backfill failed:", e.message);
        }
      }
      return bill;
    }

    const billData = {
      patient: patient._id,
      UHID,
      visitType,
      paymentType: patient.tpa ? "TPA" : "CASH",
      tpa: patient.tpa?._id || null,
      tpaName: patient.tpa?.tpaName || null,
      billStatus: "DRAFT",
      billItems: [],
    };

    if (admissionId) {
      const adm = await Admission.findById(admissionId);
      if (adm) {
        billData.admission = admissionId;
        billData.admissionNumber = adm.admissionNumber;
      }
    }

    try {
      bill = new PatientBill(billData);
      await bill.save();
      // Newly-created bill for an active admission — backfill bed, nursing
      // and any orphaned doctor-note / consumable charges that piled up
      // before the auto-billing engine had a bill to write to. Idempotent
      // (createTrigger dedup guards make repeat calls a no-op).
      if (admissionId) {
        try {
          const adm = await Admission.findById(admissionId).lean();
          if (adm && (adm.status === "Active" || adm.status === "Transferred")) {
            const autoBilling = require("./autoBillingService");
            const r = await autoBilling.backfillAdmissionCharges(adm);
            console.log(
              `[Billing] backfill for ADM ${adm.admissionNumber}:`,
              `bed=${r.bedFired} nursing=${r.nurseFired}`,
              `doctor=${r.doctorFired} consumables=${r.consumableFired}`,
              `skipped=${r.skipped} errors=${r.errors}`,
            );
            // Re-fetch so the freshly-billed items are returned to caller
            const refreshed = await PatientBill.findById(bill._id);
            if (refreshed) bill = refreshed;
          }
        } catch (e) {
          console.error("[Billing] backfill failed (bill still created):", e.message);
        }
      }
      return bill;
    } catch (err) {
      if (err.code === 11000) {
        const existing = await PatientBill.findOne(filter);
        if (existing) return existing;
      }
      throw err;
    }
  }

  // ── 3. Get single bill (fully populated) ─────────────────────
  async getBillById(billId) {
    const bill = await PatientBill.findById(billId)
      .populate("patient")
      .populate("tpa")
      .populate("admission")
      .populate("billItems.serviceId");

    if (!bill) throw new Error("Bill not found");
    return bill;
  }

  // ── 4. Get draft bill (populated) ────────────────────────────
  async getDraftBillPopulated(UHID, visitType, admissionId) {
    const bill = await this.getOrCreateDraftBill(UHID, visitType, admissionId);
    return PatientBill.findById(bill._id)
      .populate("patient", "fullName title UHID contactNumber gender tpa")
      .populate("tpa", "tpaName tpaCode")
      .populate("admission");
  }

  // ── 5. All bills for a UHID ───────────────────────────────────
  async getBillsByUHID(UHID) {
    return PatientBill.find({ UHID })
      .populate("patient", "fullName title contactNumber gender dateOfBirth")
      .populate("tpa", "tpaName tpaCode")
      .populate(
        "admission",
        "admissionNumber bedNumber roomCategory status admissionDateTime",
      )
      .sort({ createdAt: -1 });
  }

  // ── 6. Add service to bill ────────────────────────────────────
  async addServiceToBill(
    billId,
    serviceId,
    quantity = 1,
    chargeDate = new Date(),
    remarks = "",
  ) {
    const bill = await PatientBill.findById(billId);
    if (!bill) throw new Error("Bill not found");
    // Bill-edit freeze (business audit F-05). Originally only PAID /
    // CANCELLED bills were locked — that left PARTIAL bills (some payment
    // already received) editable, so a receptionist could add new line
    // items and inflate what the patient still owed AFTER the cashier
    // had counted money. Locking from GENERATED onward stops the leak;
    // legitimate "patient consumed more services" goes through the
    // dedicated `recordPayment` / `amendItem` (Accountant) path instead.
    if (["GENERATED", "PARTIAL", "PAID", "CANCELLED", "REFUNDED"].includes(bill.billStatus)) {
      const err = new Error(
        `Cannot modify a ${bill.billStatus} bill — use the amendment workflow.`,
      );
      err.status = 409;
      throw err;
    }

    const service = await ServiceMaster.findById(serviceId);
    if (!service) throw new Error("Service not found");

    const pricing = await ServicePricing.getPriceFor(
      serviceId,
      bill.paymentType,
      bill.tpa,
    );

    const unitPrice = pricing ? pricing.finalPrice : service.defaultPrice;
    const grossAmount = unitPrice * quantity;
    const discountPct = pricing?.discount || 0;
    const discountAmt = (grossAmount * discountPct) / 100;
    const netAmount = grossAmount - discountAmt;
    const taxAmount = service.isTaxable
      ? (netAmount * (service.taxPercentage || 0)) / 100
      : 0;
    const lineTotal = netAmount + taxAmount;

    let tpaPayableAmount = 0;
    if (bill.paymentType === "TPA") {
      tpaPayableAmount = pricing?.tpaApprovedLimit
        ? Math.min(pricing.tpaApprovedLimit * quantity, lineTotal)
        : lineTotal;
    }

    bill.billItems.push({
      serviceId: service._id,
      serviceCode: service.serviceCode,
      serviceName: service.serviceName,
      category: service.category,
      billingType: service.billingType,
      quantity,
      unitPrice,
      grossAmount,
      discountPercent: discountPct,
      discountAmount: discountAmt,
      netAmount,
      tpaPayableAmount,
      patientPayableAmount: lineTotal - tpaPayableAmount,
      isTaxable: service.isTaxable,
      taxPercent: service.taxPercentage || 0,
      taxAmount,
      appliedTariff: bill.paymentType,
      chargeDate,
      remarks,
    });

    await bill.save();
    return bill;
  }

  // ── 7. Remove item from bill ──────────────────────────────────
  async removeItemFromBill(billId, itemId) {
    const bill = await PatientBill.findById(billId);
    if (!bill) throw new Error("Bill not found");
    // Bill-edit freeze (business audit F-05). Originally only PAID /
    // CANCELLED bills were locked — that left PARTIAL bills (some payment
    // already received) editable, so a receptionist could add new line
    // items and inflate what the patient still owed AFTER the cashier
    // had counted money. Locking from GENERATED onward stops the leak;
    // legitimate "patient consumed more services" goes through the
    // dedicated `recordPayment` / `amendItem` (Accountant) path instead.
    if (["GENERATED", "PARTIAL", "PAID", "CANCELLED", "REFUNDED"].includes(bill.billStatus)) {
      const err = new Error(
        `Cannot modify a ${bill.billStatus} bill — use the amendment workflow.`,
      );
      err.status = 409;
      throw err;
    }

    bill.billItems = bill.billItems.filter(
      (i) => i._id.toString() !== itemId.toString(),
    );
    await bill.save();
    return bill;
  }

  // ── 8. Update item quantity ───────────────────────────────────
  async updateItemQuantity(billId, itemId, quantity) {
    if (quantity <= 0) throw new Error("Quantity must be greater than 0");

    const bill = await PatientBill.findById(billId);
    if (!bill) throw new Error("Bill not found");
    // Bill-edit freeze (business audit F-05). Originally only PAID /
    // CANCELLED bills were locked — that left PARTIAL bills (some payment
    // already received) editable, so a receptionist could add new line
    // items and inflate what the patient still owed AFTER the cashier
    // had counted money. Locking from GENERATED onward stops the leak;
    // legitimate "patient consumed more services" goes through the
    // dedicated `recordPayment` / `amendItem` (Accountant) path instead.
    if (["GENERATED", "PARTIAL", "PAID", "CANCELLED", "REFUNDED"].includes(bill.billStatus)) {
      const err = new Error(
        `Cannot modify a ${bill.billStatus} bill — use the amendment workflow.`,
      );
      err.status = 409;
      throw err;
    }

    const item = bill.billItems.id(itemId);
    if (!item) throw new Error("Bill item not found");

    // Money fields are Decimal128 — do the math in Number space, then assign.
    // Mongoose auto-casts Number → Decimal128 on assignment, and the bill
    // pre-save hook will recompute everything (so even if we missed a field
    // here, the persisted state stays consistent).
    const unit = toNum(item.unitPrice);
    const grossAmount = unit * quantity;
    const discountAmount = (grossAmount * (toNum(item.discountPercent) || 0)) / 100;
    const netAmount = grossAmount - discountAmount;
    const taxAmount = item.isTaxable
      ? (netAmount * (toNum(item.taxPercent) || 0)) / 100
      : 0;
    const lineTotal = netAmount + taxAmount;

    item.quantity = quantity;
    item.grossAmount = grossAmount;
    item.discountAmount = discountAmount;
    item.netAmount = netAmount;
    item.taxAmount = taxAmount;

    if (bill.paymentType === "TPA") {
      const tpaLimit = item.tpaApprovedLimitPerUnit
        ? toNum(item.tpaApprovedLimitPerUnit) * quantity
        : lineTotal;
      item.tpaPayableAmount = Math.min(tpaLimit, lineTotal);
      item.patientPayableAmount = lineTotal - item.tpaPayableAmount;
    } else {
      item.tpaPayableAmount = 0;
      item.patientPayableAmount = lineTotal;
    }

    await bill.save();
    return bill;
  }

  // ── 8a. Settlement-time adjustment (GENERATED / PARTIAL bills) ─
  //
  // The receptionist at the counter can negotiate a final settlement
  // with the patient — e.g. waive a portion of the bill, drop a
  // procedure that wasn't actually performed, or recalibrate a unit
  // price. F-05 normally freezes a bill the moment it's generated so
  // nobody can silently inflate the total AFTER cash was counted;
  // this endpoint is the audited escape hatch.
  //
  // Every adjustment requires (1) a human-readable reason and (2) the
  // staff name making the change, and a before/after snapshot is
  // pushed onto bill.adjustmentLog so we can reconstruct any past
  // state for NABH audit.
  //
  // Payload shape:
  //   { extraDiscount, extraDiscountReason, items, adjustedBy, reason }
  //   items: [{ itemId, quantity?, unitPrice?, discountPercent? }]
  //
  // The pre-save hook re-derives every total from the (possibly-edited)
  // items + extraDiscount, so the caller never has to do math here.
  async settlementAdjust(billId, payload = {}) {
    const { extraDiscount, extraDiscountReason, items, adjustedBy, reason } = payload;

    if (!adjustedBy || !String(adjustedBy).trim()) {
      const err = new Error("adjustedBy (staff name) is required for audit");
      err.status = 400;
      throw err;
    }
    if (!reason || !String(reason).trim()) {
      const err = new Error("Reason is required for audit");
      err.status = 400;
      throw err;
    }

    const bill = await PatientBill.findById(billId);
    if (!bill) {
      const err = new Error("Bill not found");
      err.status = 404;
      throw err;
    }
    // Only post-generation bills (where a patient might already have
    // paid a partial amount) need this audited path. DRAFT bills use
    // the regular updateItemQuantity / removeItemFromBill endpoints
    // and PAID/CANCELLED/REFUNDED bills are permanently sealed.
    if (!["GENERATED", "PARTIAL"].includes(bill.billStatus)) {
      const err = new Error(
        `Cannot adjust a ${bill.billStatus} bill — only GENERATED / PARTIAL bills can be settled.`,
      );
      err.status = 409;
      throw err;
    }

    // Snapshot BEFORE state for audit.
    const beforeSnap = {
      netAmount:     toNum(bill.netAmount),
      totalDiscount: toNum(bill.totalDiscount),
      extraDiscount: toNum(bill.extraDiscount) || 0,
      balanceAmount: toNum(bill.balanceAmount),
      items: bill.billItems.map((it) => ({
        _id:             it._id.toString(),
        serviceName:     it.serviceName,
        quantity:        toNum(it.quantity),
        unitPrice:       toNum(it.unitPrice),
        discountPercent: it.discountPercent || 0,
        netAmount:       toNum(it.netAmount),
      })),
    };

    let touchedLines = false;
    let touchedDiscount = false;

    // Apply per-item edits.
    if (Array.isArray(items) && items.length > 0) {
      for (const upd of items) {
        if (!upd?.itemId) continue;
        const it = bill.billItems.id(upd.itemId);
        if (!it) continue;
        if (upd.quantity != null && Number(upd.quantity) > 0) {
          it.quantity = Number(upd.quantity);
          touchedLines = true;
        }
        if (upd.unitPrice != null && Number(upd.unitPrice) >= 0) {
          it.unitPrice = Number(upd.unitPrice);  // pre-save will toDec it
          touchedLines = true;
        }
        if (
          upd.discountPercent != null &&
          Number(upd.discountPercent) >= 0 &&
          Number(upd.discountPercent) <= 100
        ) {
          it.discountPercent = Number(upd.discountPercent);
          touchedLines = true;
        }
      }
    }

    // Apply bill-level extra discount. A 0 value is only "touched" when
    // the bill previously HAD a non-zero extra discount (i.e. the cashier
    // is clearing it). Otherwise a stray 0 doesn't count as an adjustment.
    if (extraDiscount != null && Number(extraDiscount) >= 0) {
      const newAmt    = Number(extraDiscount);
      const prevAmt   = toNum(bill.extraDiscount) || 0;
      if (newAmt > 0 || prevAmt > 0) {
        bill.extraDiscount       = newAmt;
        bill.extraDiscountReason = String(extraDiscountReason || reason).trim();
        bill.extraDiscountBy     = String(adjustedBy).trim();
        touchedDiscount = true;
      }
    }

    if (!touchedLines && !touchedDiscount) {
      const err = new Error("Nothing to adjust — no item edits or extra discount provided");
      err.status = 400;
      throw err;
    }

    bill.adjustmentLog.push({
      at:     new Date(),
      by:     String(adjustedBy).trim(),
      type:   touchedLines && touchedDiscount ? "BOTH" : (touchedLines ? "LINE_EDIT" : "EXTRA_DISCOUNT"),
      reason: String(reason).trim(),
      before: beforeSnap,
      after:  null,  // filled below from the saved doc
    });

    await bill.save();

    // Capture AFTER snap so the log row stands on its own without needing
    // to read both itself and the next entry.
    const lastIdx = bill.adjustmentLog.length - 1;
    bill.adjustmentLog[lastIdx].after = {
      netAmount:     toNum(bill.netAmount),
      totalDiscount: toNum(bill.totalDiscount),
      extraDiscount: toNum(bill.extraDiscount) || 0,
      balanceAmount: toNum(bill.balanceAmount),
      items: bill.billItems.map((it) => ({
        _id:             it._id.toString(),
        serviceName:     it.serviceName,
        quantity:        toNum(it.quantity),
        unitPrice:       toNum(it.unitPrice),
        discountPercent: it.discountPercent || 0,
        netAmount:       toNum(it.netAmount),
      })),
    };
    await bill.save();

    return bill;
  }

  // ── 8b. Bulk collect across all outstanding bills for a UHID ───
  //
  // Front-desk shortcut: patient hands over one lump-sum and says
  // "clear everything." Backend distributes the amount FIFO across
  // every GENERATED / PARTIAL bill for the UHID (oldest first),
  // capping each leg at that bill's balance so we never overshoot.
  // A single parent transactionId (caller-supplied or generated) is
  // attached to every per-bill payment row so the audit trail joins
  // the legs back together — receipt printing, reconciliation, etc.
  //
  // Returns { totalCollected, billsTouched, allocations: [{billId, billNumber, amount}], parentTransactionId }
  async bulkCollectByUHID(UHID, { amount, paymentMode, transactionId, receivedBy, remarks }) {
    if (!UHID || !String(UHID).trim()) throw new Error("UHID required");
    const amt = Number(amount);
    if (!amt || amt <= 0) throw new Error("Valid amount required");
    const mode = String(paymentMode || "").toUpperCase();
    if (!["CASH", "CARD", "UPI", "CHEQUE", "ONLINE"].includes(mode)) {
      throw new Error("Invalid paymentMode");
    }

    // Pull every outstanding bill, FIFO by createdAt. We only touch
    // GENERATED / PARTIAL — DRAFT can't take a payment yet, PAID has
    // no balance, CANCELLED / REFUNDED are sealed.
    const bills = await PatientBill.find({
      UHID,
      billStatus: { $in: ["GENERATED", "PARTIAL"] },
    }).sort({ createdAt: 1 });

    if (bills.length === 0) {
      throw new Error("No outstanding bills found for this UHID");
    }

    const totalDue = bills.reduce((s, b) => s + toNum(b.balanceAmount), 0);
    if (amt > totalDue + 0.5) {
      throw new Error(
        `Amount ₹${amt} exceeds total outstanding ₹${totalDue.toFixed(2)} — use per-bill flow or advance deposit for over-payments`,
      );
    }

    // Parent transaction id — links every per-bill payment row back to
    // a single counter event. If the cashier supplied a real txn id
    // (e.g. UPI ref), use it verbatim so the bank statement matches.
    const parentTxn = transactionId && String(transactionId).trim()
      ? String(transactionId).trim()
      : `BULK-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

    const allocations = [];
    let remaining = amt;

    for (const bill of bills) {
      if (remaining <= 0.005) break;
      const bal = toNum(bill.balanceAmount);
      if (bal <= 0) continue;
      const leg = Math.min(remaining, bal);

      bill.payments.push({
        amount: leg,
        paymentMode: mode,
        transactionId: parentTxn,
        receivedBy: receivedBy ? String(receivedBy).trim() : undefined,
        remarks: remarks
          ? `${String(remarks).trim()} (bulk-collect)`
          : `Bulk collect across UHID — parent ${parentTxn}`,
        paidAt: new Date(),
      });

      // Recompute via pre-save (also flips DRAFT/GENERATED → PARTIAL / PAID).
      const newPaid =
        bill.payments.reduce((s, p) => s + toNum(p.amount), 0);
      const newBal = Math.max(0, toNum(bill.patientPayableAmount) - newPaid);
      bill.billStatus = newBal <= 0.005 ? "PAID" : "PARTIAL";
      if (newBal <= 0.005) bill.paidAt = new Date();

      await bill.save();
      allocations.push({
        billId:    bill._id.toString(),
        billNumber: bill.billNumber,
        amount:     Number(leg.toFixed(2)),
        newStatus:  bill.billStatus,
      });
      remaining -= leg;
    }

    return {
      totalCollected:    Number((amt - remaining).toFixed(2)),
      billsTouched:      allocations.length,
      allocations,
      parentTransactionId: parentTxn,
    };
  }

  // ── 8c. Bulk settlement-time adjustment across all outstanding ─
  //
  // The receptionist negotiates a single courtesy discount with the
  // patient (e.g. "5% off the whole stay") and wants it spread across
  // every outstanding bill in one click. Two distribution modes:
  //
  //   PERCENT — same % applied to each bill's current balance. So a
  //             5% on a ₹1000 bill = ₹50, on a ₹500 bill = ₹25, etc.
  //
  //   AMOUNT  — flat ₹ amount distributed PROPORTIONALLY to each
  //             bill's share of total outstanding. So a ₹200 discount
  //             on bills owing ₹600 + ₹400 (60/40) splits 120/80.
  //
  // Each bill gets its own audit log entry (type: EXTRA_DISCOUNT,
  // reason: shared) so per-bill review still works downstream.
  async bulkSettleByUHID(UHID, { mode, value, adjustedBy, reason }) {
    if (!UHID || !String(UHID).trim()) throw new Error("UHID required");
    const m = String(mode || "").toUpperCase();
    if (!["PERCENT", "AMOUNT"].includes(m)) throw new Error("mode must be PERCENT or AMOUNT");
    const v = Number(value);
    if (!v || v <= 0) throw new Error("Valid value required");
    if (m === "PERCENT" && v > 100) throw new Error("Percent cannot exceed 100");
    if (!adjustedBy || !String(adjustedBy).trim()) throw new Error("adjustedBy required");
    if (!reason || !String(reason).trim())         throw new Error("Reason required");

    const bills = await PatientBill.find({
      UHID,
      billStatus: { $in: ["GENERATED", "PARTIAL"] },
    }).sort({ createdAt: 1 });

    if (bills.length === 0) throw new Error("No outstanding bills for this UHID");

    const totalDue = bills.reduce((s, b) => s + toNum(b.balanceAmount), 0);
    const flatPool = m === "AMOUNT" ? v : null;
    if (flatPool != null && flatPool > totalDue + 0.5) {
      throw new Error(`Discount ₹${flatPool} exceeds total outstanding ₹${totalDue.toFixed(2)}`);
    }

    const adjustments = [];

    for (const bill of bills) {
      const bal = toNum(bill.balanceAmount);
      if (bal <= 0) continue;

      // Compute this bill's share.
      let billDisc;
      if (m === "PERCENT") {
        // % applied to balance, but the schema stores extra discount
        // against patient share — so it directly reduces this bill.
        billDisc = (bal * v) / 100;
      } else {
        billDisc = (flatPool * bal) / totalDue;  // proportional
      }
      billDisc = Math.min(billDisc, bal);  // never overshoot
      if (billDisc <= 0.005) continue;

      const beforeSnap = {
        netAmount:     toNum(bill.netAmount),
        extraDiscount: toNum(bill.extraDiscount) || 0,
        balanceAmount: bal,
      };

      // Add to existing extra discount (cumulative).
      const prev = toNum(bill.extraDiscount) || 0;
      bill.extraDiscount       = prev + billDisc;
      bill.extraDiscountReason = String(reason).trim();
      bill.extraDiscountBy     = String(adjustedBy).trim();

      bill.adjustmentLog.push({
        at: new Date(),
        by: String(adjustedBy).trim(),
        type: "EXTRA_DISCOUNT",
        reason: `[BULK-${m}] ${String(reason).trim()}`,
        before: beforeSnap,
        after: null,  // filled below
      });

      await bill.save();

      const lastIdx = bill.adjustmentLog.length - 1;
      bill.adjustmentLog[lastIdx].after = {
        netAmount:     toNum(bill.netAmount),
        extraDiscount: toNum(bill.extraDiscount) || 0,
        balanceAmount: toNum(bill.balanceAmount),
      };
      await bill.save();

      adjustments.push({
        billId:        bill._id.toString(),
        billNumber:    bill.billNumber,
        discountApplied: Number(billDisc.toFixed(2)),
        newBalance:    Number(toNum(bill.balanceAmount).toFixed(2)),
      });
    }

    const newTotalDue = adjustments.reduce((s, a) => s + a.newBalance, 0);
    const totalDiscount = adjustments.reduce((s, a) => s + a.discountApplied, 0);

    return {
      billsTouched:     adjustments.length,
      totalDiscount:    Number(totalDiscount.toFixed(2)),
      newTotalDue:      Number(newTotalDue.toFixed(2)),
      adjustments,
    };
  }

  // ── 9. Generate final bill (DRAFT → GENERATED) ────────────────
  async generateFinalBill(billId, generatedBy = "Staff") {
    const bill = await PatientBill.findById(billId);
    if (!bill) throw new Error("Bill not found");
    if (bill.billStatus !== "DRAFT") {
      throw new Error("Only DRAFT bills can be generated");
    }
    if (!bill.billItems || bill.billItems.length === 0) {
      throw new Error("Cannot generate empty bill — pehle services add karo");
    }

    bill.billNumber = await generateBillNumber();
    bill.billStatus = "GENERATED";
    bill.billGeneratedAt = new Date();
    bill.generatedBy = generatedBy;

    if (bill.paymentType === "TPA") {
      bill.tpaClaimStatus = "PENDING";
    }

    await bill.save();
    return bill;
  }

  // ── 10. Record payment ────────────────────────────────────────
  // FIX (audit P6-B2): two cashiers receiving payment for the same bill at
  // the same instant used to race — both read the same snapshot, both pushed
  // a payment row, the second save() clobbered the first. The schema now has
  // optimisticConcurrency enabled (rejects stale __v with VersionError); here
  // we retry the load-modify-save up to 5 times before giving up. Net effect:
  // concurrent payments serialise correctly and no row is ever lost.
  async recordPayment(
    billId,
    { amount, paymentMode, transactionId, receivedBy, remarks },
  ) {
    if (!amount || amount <= 0) throw new Error("Valid amount required");

    const MAX_RETRIES = 5;
    let lastErr;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const bill = await PatientBill.findById(billId);
      if (!bill) throw new Error("Bill not found");

      if (bill.billStatus === "DRAFT") {
        throw new Error(
          "Bill abhi DRAFT hai — pehle generateFinalBill() karo, tab payment lo",
        );
      }
      if (bill.billStatus === "PAID") throw new Error("Bill already fully paid");
      if (bill.billStatus === "CANCELLED")
        throw new Error("Cancelled bill pe payment nahi ho sakti");
      if (bill.billStatus === "REFUNDED")
        throw new Error("Refunded bill — no further payments allowed");

      bill.payments.push({
        amount,
        paymentMode,
        transactionId,
        receivedBy,
        remarks,
        paidAt: new Date(),
      });

      const totalPaid = bill.payments.reduce((s, p) => s + toNum(p.amount), 0);
      const balance = Math.max(0, toNum(bill.patientPayableAmount) - totalPaid);
      bill.advancePaid   = totalPaid;
      bill.balanceAmount = balance;
      bill.billStatus    = balance === 0 ? "PAID" : "PARTIAL";
      if (bill.billStatus === "PAID") bill.paidAt = new Date();

      try {
        await bill.save();
        return bill;
      } catch (err) {
        // VersionError → another writer hit save() between our read and write.
        // Retry with a fresh snapshot.
        if (err?.name === "VersionError") {
          lastErr = err;
          continue;
        }
        throw err;
      }
    }
    throw new Error(
      `Payment concurrency conflict after ${MAX_RETRIES} retries: ${lastErr?.message || "unknown"}`,
    );
  }

  // ── 11. Update TPA claim status ───────────────────────────────
  async updateTPAClaimStatus(billId, { status, claimNumber, approvedAmount }) {
    const bill = await PatientBill.findById(billId);
    if (!bill) throw new Error("Bill not found");

    bill.tpaClaimStatus = status;
    if (claimNumber) bill.tpaClaimNumber = claimNumber;
    if (approvedAmount) bill.tpaApprovedAmount = approvedAmount;
    await bill.save();
    return bill;
  }

  // ── 12. Billing dashboard summary ────────────────────────────
  async getBillingSummary() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [todayCount, pendingCount, paidToday, tpaPending] = await Promise.all(
      [
        PatientBill.countDocuments({ createdAt: { $gte: today } }),
        PatientBill.countDocuments({
          billStatus: { $in: ["GENERATED", "PARTIAL"] },
        }),
        PatientBill.aggregate([
          { $match: { billStatus: "PAID", paidAt: { $gte: today } } },
          { $group: { _id: null, total: { $sum: "$advancePaid" } } },
        ]),
        PatientBill.countDocuments({
          paymentType: "TPA",
          tpaClaimStatus: "PENDING",
        }),
      ],
    );

    return {
      todayBills: todayCount,
      pendingBills: pendingCount,
      todayRevenue: paidToday[0]?.total || 0,
      tpaPending,
    };
  }

  // ── 13. Setup daily auto-charges on admission ─────────────────
  async setupAutoChargesForAdmission(admission, patient) {
    const ROOM_MAP = {
      GENERAL_WARD: { room: "IPD-RM-001", nursing: "IPD-NUR-001" },
      SEMI_PRIVATE: { room: "IPD-RM-002", nursing: "IPD-NUR-001" },
      PRIVATE: { room: "IPD-RM-003", nursing: "IPD-NUR-002" },
      DELUXE: { room: "IPD-RM-004", nursing: "IPD-NUR-002" },
      SUITE: { room: "IPD-RM-005", nursing: "IPD-NUR-003" },
      ICU: { room: "IPD-ICU-001", nursing: "IPD-ICU-005" },
      DAYCARE_BED: { room: "IPD-RM-008", nursing: null },
      EMERGENCY_BED: { room: "ER-OBS-001", nursing: "ER-NUR-001" },
    };

    const mapping =
      ROOM_MAP[admission.roomCategory] || ROOM_MAP["GENERAL_WARD"];
    const codes = [mapping.room, mapping.nursing].filter(Boolean);
    const tariff = patient.tpa ? "TPA" : "CASH";

    for (const code of codes) {
      const service = await ServiceMaster.findOne({
        serviceCode: code,
        isActive: true,
      });
      if (!service) continue;

      const alreadyExists = await AutoBilledItems.findOne({
        admission: admission._id,
        service: service._id,
        isActive: true,
      });
      if (alreadyExists) continue;

      const pricing = await ServicePricing.getPriceFor(
        service._id,
        tariff,
        patient.tpa?._id,
      );
      const unitPrice = pricing ? pricing.finalPrice : service.defaultPrice;

      await AutoBilledItems.create({
        admission: admission._id,
        admissionNumber: admission.admissionNumber,
        UHID: admission.UHID,
        patient: admission.patient,
        service: service._id,
        serviceCode: service.serviceCode,
        serviceName: service.serviceName,
        billingType: "PER_DAY",
        unitPrice,
        startDate: admission.admissionDateTime,
        appliedTariff: tariff,
        tpaId: patient.tpa?._id || null,
      });
    }
  }

  // ── 14. Daycare → IPD conversion ──────────────────────────────
  async checkAndHandleDaycareConversion(admissionId) {
    const admission = await Admission.findById(admissionId).populate("patient");
    // Admission.admissionType enum is mixed-case — "Daycare" or "Day Care".
    // The legacy "DAYCARE" string never matched, so this endpoint always
    // short-circuited to null and the auto-conversion to IPD never fired.
    const isDaycare = admission &&
      ["Daycare", "Day Care"].includes(admission.admissionType);
    if (!isDaycare) return null;

    // Derive hours since admission — `totalHoursAdmitted` is not a schema
    // field, so compute on the fly. Default max-hours window is 24h unless
    // the admission carries an explicit override.
    const admittedAt = admission.admissionDate || admission.createdAt;
    const hours = admittedAt
      ? (Date.now() - new Date(admittedAt).getTime()) / (1000 * 60 * 60)
      : 0;
    const maxHours = admission.daycareMaxHours || 24;
    const exceeded = hours > maxHours;

    if (exceeded && !admission.isConvertedToIPD) {
      admission.isConvertedToIPD = true;
      admission.convertedToIPDAt = new Date();
      admission.conversionReason = `Exceeded ${maxHours}hr daycare limit`;
      // "Planned" is the closest valid enum value for a converted IPD stay
      // ("IPD" itself isn't in the admissionType enum).
      admission.admissionType = "Planned";
      await admission.save();

      await PatientBill.updateMany(
        { admission: admissionId, billStatus: "DRAFT" },
        { $set: { visitType: "IPD" } },
      );

      await AutoBilledItems.updateMany(
        { admission: admissionId, isActive: true },
        { $set: { isActive: false } },
      );

      if (admission.patient) {
        const Patient = require("../../models/Patient/patientModel");
        const patient = await Patient.findById(admission.patient).populate(
          "tpa",
        );
        if (patient)
          await this.setupAutoChargesForAdmission(admission, patient);
      }

      return {
        converted: true,
        hours,
        message: `Patient converted to IPD after ${hours.toFixed(1)} hours`,
      };
    }

    return {
      converted: false,
      hours,
      remaining: Math.max(0, maxHours - hours),
    };
  }

  // ── 16. Add a charge via nurse ────────────────────────────────
  // Validates that the service has chargeableBy: ["Nurse"] before adding.
  // Round-3 re-audit (F-05 follow-up): aligned with the unified freeze
  // policy applied to addServiceToBill / removeItemFromBill /
  // updateItemQuantity — only DRAFT bills accept new charges, even from
  // nursing. A GENERATED bill (printed for the patient) or anything
  // beyond must go through the amendment workflow.
  async addNurseCharge(billId, serviceId, quantity, { nurseName, shift, remarks } = {}) {
    const bill = await PatientBill.findById(billId);
    if (!bill) throw new Error("Bill not found");
    if (["GENERATED", "PARTIAL", "PAID", "CANCELLED", "REFUNDED"].includes(bill.billStatus)) {
      const err = new Error(
        `Cannot add a nurse charge to a ${bill.billStatus} bill — use the amendment workflow.`,
      );
      err.status = 409;
      throw err;
    }

    const service = await ServiceMaster.findById(serviceId);
    if (!service) throw new Error("Service not found");
    if (!service.chargeableBy?.includes("Nurse")) {
      throw new Error("This service cannot be added by nursing staff");
    }

    const pricing = await ServicePricing.getPriceFor(
      serviceId,
      bill.paymentType,
      bill.tpa?.toString(),
    );
    const unitPrice = pricing?.finalPrice ?? service.defaultPrice ?? 0;
    const gross = unitPrice * (quantity || 1);

    const item = {
      serviceId: service._id,
      serviceCode: service.serviceCode,
      serviceName: service.serviceName,
      category: service.category,
      billingType: service.billingType,
      quantity: quantity || 1,
      unitPrice,
      grossAmount: gross,
      discountPercent: 0,
      discountAmount: 0,
      netAmount: gross,
      tpaPayableAmount: bill.paymentType === "TPA" ? gross : 0,
      patientPayableAmount: bill.paymentType === "TPA" ? 0 : gross,
      chargeDate: new Date(),
      appliedTariff: bill.paymentType,
      remarks: remarks || `Added by nurse: ${shift || ""}`,
      addedBySource: "Nurse",
      addedBy: nurseName || "Nursing Staff",
      addedByRole: "Nurse",
    };

    bill.billItems.push(item);
    await bill.save();
    return bill;
  }

  // ── 17. Get services a nurse can add ─────────────────────────
  async getNurseChargeableServices(patientType = "IPD") {
    const services = await ServiceMaster.find({
      isActive: true,
      chargeableBy: "Nurse",
      $or: [{ applicableTo: patientType }, { applicableTo: "ALL" }],
    })
      .select(
        "_id serviceName serviceCode category serviceType defaultPrice billingType aiTags applicableTo",
      )
      .lean();
    return services;
  }

  // ── 15. Daily auto-charge cron job ────────────────────────────
  async runDailyAutoCharges() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const items = await AutoBilledItems.find({
      isActive: true,
      $or: [{ lastBilledDate: null }, { lastBilledDate: { $lt: today } }],
    }).populate("admission");

    const results = [];
    const failed = [];

    // Map Admission.admissionType → PatientBill.visitType enum
    // (enum: ["OPD","IPD","DAYCARE","EMERGENCY"]).
    const admTypeToVisitType = {
      "Planned":   "IPD",
      "Transfer":  "IPD",
      "Emergency": "EMERGENCY",
      "Day Care":  "DAYCARE",
      "Daycare":   "DAYCARE",
      "OPD":       "OPD",
      "Services":  "OPD",
    };

    for (const item of items) {
      try {
        // Admission.status enum is ["Active","Discharged","Transferred","Cancelled"].
        // The legacy check against "ADMITTED" stopped EVERY active admission's
        // daily auto-charges on the first cron run.
        if (!item.admission || item.admission.status !== "Active") {
          item.isActive = false;
          await item.save();
          results.push({
            UHID: item.UHID,
            service: item.serviceName,
            status: "stopped",
          });
          continue;
        }

        const visitType = admTypeToVisitType[item.admission.admissionType] || "IPD";
        const bill = await this.getOrCreateDraftBill(
          item.UHID,
          visitType,
          item.admission._id,
        );

        await this.addServiceToBill(
          bill._id,
          item.service,
          1,
          new Date(),
          "Auto-charged daily",
        );

        item.lastBilledDate = new Date();
        item.lastBilledBillId = bill._id;
        item.totalBilledCount += 1;
        item.totalBilledAmount += item.unitPrice;
        await item.save();

        results.push({
          UHID: item.UHID,
          service: item.serviceName,
          status: "billed",
        });
      } catch (err) {
        const failEntry = {
          UHID: item.UHID,
          service: item.serviceName,
          status: "error",
          error: err.message,
        };
        results.push(failEntry);
        failed.push(failEntry);
      }
    }

    return {
      processed: results.length,
      successCount: results.filter((r) => r.status === "billed").length,
      failedCount: failed.length,
      failed,
      results,
    };
  }
}

module.exports = new BillingService();
