// services/Billing/patientAdvanceService.js
// ════════════════════════════════════════════════════════════════════
// Business logic for the PatientAdvance ledger — create, list, apply,
// refund. Mirrors the optimistic-concurrency pattern used by
// billingService.recordPayment so two cashiers can't double-spend the
// same advance row.
// ════════════════════════════════════════════════════════════════════

const mongoose = require("mongoose");
const { Decimal128 } = mongoose.Types;                           // R7ap-F7: atomic Decimal128 writes
const PatientAdvance = require("../../models/PatientBillModel/PatientAdvanceModel");
const PatientBill    = require("../../models/PatientBillModel/PatientBillModel");
const Patient        = require("../../models/Patient/patientModel");
const Admission      = require("../../models/Patient/admissionModel");

const toNum = (v) =>
  v == null ? 0 : Number(v?.toString?.() ?? v) || 0;

const MAX_RETRIES = 5;

class PatientAdvanceService {
  // ── 1. Create an advance deposit ──────────────────────────────
  // Called when a patient pays before any bill exists. Returns the
  // created PatientAdvance with auto-generated receiptNumber.
  async createAdvance(data) {
    const {
      UHID,
      admission = null,
      amount,
      paymentMode,
      transactionId = null,
      bankName = null,
      receivedBy,
      receivedById = null,
      receivedByRole = null,
      remarks = null,
    } = data;

    if (!UHID)         throw new Error("UHID required");
    if (!amount || Number(amount) <= 0) throw new Error("Valid amount required");
    if (!paymentMode)  throw new Error("Payment mode required");
    if (!receivedBy)   throw new Error("Received-by name required for audit");

    const patient = await Patient.findOne({ UHID: String(UHID).toUpperCase() });
    if (!patient) throw new Error(`Patient ${UHID} not found`);

    const ALLOWED_MODES = ["CASH", "CARD", "UPI", "CHEQUE", "ONLINE"];
    if (!ALLOWED_MODES.includes(String(paymentMode).toUpperCase())) {
      throw new Error(`Invalid payment mode "${paymentMode}". Allowed: ${ALLOWED_MODES.join(", ")}`);
    }

    // Soft validation: non-cash modes should have a transactionId. We
    // warn but don't block — the cashier may legitimately not have it
    // (e.g. cheque-pending-clearance taken at the desk).
    if (paymentMode !== "CASH" && !transactionId) {
      console.warn(`[advance] ${paymentMode} advance taken without transactionId for UHID=${UHID}`);
    }

    // If admission is referenced, validate it belongs to the same UHID
    // (prevents accidentally tagging an advance to another patient's
    // admission via the API).
    let admissionRef = null;
    if (admission) {
      const adm = await Admission.findById(admission).lean();
      if (!adm) throw new Error(`Admission ${admission} not found`);
      if (String(adm.UHID).toUpperCase() !== String(UHID).toUpperCase()) {
        throw new Error(`Admission ${admission} belongs to UHID ${adm.UHID}, not ${UHID}`);
      }
      admissionRef = adm._id;
    }

    const advance = await PatientAdvance.create({
      UHID: String(UHID).toUpperCase(),
      patientId: patient._id,
      admission: admissionRef,
      amount, paymentMode: String(paymentMode).toUpperCase(),
      transactionId, bankName,
      receivedBy, receivedById, receivedByRole,
      paidAt: new Date(),
      remarks,
    });
    // R7ar-P1-7: invalidate Day Book cache so deposit shows immediately.
    try {
      const ctrl = require("../../controllers/Billing/billingController");
      ctrl.invalidateDayBookCache?.();
    } catch (_) { /* best-effort */ }
    // R7ap-F15: emit audit row for deposit creation.
    try {
      const { emit } = require("../../models/Billing/BillingAudit");
      await emit({
        event:                "ADVANCE_CREATED",
        UHID:                 advance.UHID,
        patientId:            advance.patientId,
        advanceId:            advance._id,
        advanceReceiptNumber: advance.receiptNumber,
        admissionId:          advance.admission,
        amount,
        paymentMode:          String(paymentMode).toUpperCase(),
        transactionId,
        actorName:            receivedBy,
        actorId:              receivedById,
        actorRole:            receivedByRole,
        reason:               remarks || "Patient advance deposit",
      });
    } catch (_) { /* audit best-effort */ }
    return advance;
  }

  // ── 2. List advances for a patient ────────────────────────────
  // Returns advances sorted newest-first with the virtual
  // `remainingAmount` populated. Optional filter to show only those
  // with unspent balance (for the "Apply Advance" picker).
  async listAdvancesForUHID(UHID, { unspentOnly = false } = {}) {
    if (!UHID) throw new Error("UHID required");
    const q = { UHID: String(UHID).toUpperCase() };
    if (unspentOnly) q.status = { $in: ["ACTIVE", "PARTIALLY_APPLIED"] };
    const rows = await PatientAdvance.find(q).sort({ paidAt: -1 });
    return rows.map((r) => {
      const o = r.toObject({ virtuals: true });
      // Force-cast Decimal128 strings → numbers for the API consumer.
      // R7ao: include refundedAmount so the UI can compute the correct
      // remaining balance (= amount − applied − refunded).
      o.amount          = toNum(o.amount);
      o.appliedAmount   = toNum(o.appliedAmount);
      o.refundedAmount  = toNum(o.refundedAmount);
      o.remainingAmount = Math.max(0, +(o.amount - o.appliedAmount - o.refundedAmount).toFixed(2));
      return o;
    });
  }

  // ── 3. Aggregate: total unspent balance on a UHID ─────────────
  // Used by the patient-lookup UI to surface "₹X advance on file".
  async getUnspentBalance(UHID) {
    if (!UHID) return 0;
    const rows = await PatientAdvance.find({
      UHID: String(UHID).toUpperCase(),
      status: { $in: ["ACTIVE", "PARTIALLY_APPLIED"] },
    }).lean();
    // R7ao: refunded portion is no longer available (a REFUNDED row is
    // already excluded by the status filter above, but defensive-subtract
    // refundedAmount in case a row's status hook hasn't caught up).
    return rows.reduce(
      (s, r) => s + Math.max(0, toNum(r.amount) - toNum(r.appliedAmount) - toNum(r.refundedAmount)),
      0,
    );
  }

  // ── 4. Apply an advance row to a bill ─────────────────────────
  // Inserts a Bill.payments[] row with mode ADVANCE_ADJUSTMENT and
  // updates the PatientAdvance.appliedAmount + appliedTo[]. Both
  // writes are wrapped in a transaction when the connection supports
  // it (replica set / mongos). On standalone Mongo a safer-order
  // sequential write is used so a mid-step failure leaves NO money
  // double-counted: advance is updated FIRST, then the bill payment
  // is pushed (if step 2 fails, the cashier sees the bill unchanged
  // but the advance is locked — easier to reconcile than the inverse).
  async applyAdvanceToBill(advanceId, billId, { amount, appliedBy, appliedById = null } = {}) {
    if (!advanceId || !billId) throw new Error("advanceId and billId required");

    const session = await mongoose.startSession().catch(() => null);
    const useTx = !!session && !!(
      session.client?.s?.options?.replicaSet ||
      session.client?.options?.replicaSet
    );

    try {
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        const work = async (s) => {
          const adv  = await PatientAdvance.findById(advanceId).session(s || undefined);
          const bill = await PatientBill.findById(billId).session(s || undefined);
          if (!adv)  throw new Error("Advance not found");
          if (!bill) throw new Error("Bill not found");

          if (adv.status === "REFUNDED" || adv.status === "CANCELLED") {
            throw new Error(`Advance is ${adv.status}; cannot apply`);
          }
          if (String(adv.UHID).toUpperCase() !== String(bill.UHID).toUpperCase()) {
            throw new Error(`Advance UHID ${adv.UHID} does not match bill UHID ${bill.UHID}`);
          }
          if (bill.billStatus === "DRAFT") {
            throw new Error("Bill abhi DRAFT hai — pehle generateFinalBill() karo, tab advance apply ho");
          }
          if (bill.billStatus === "PAID")
            throw new Error("Bill already fully paid");
          if (bill.billStatus === "CANCELLED")
            throw new Error("Cancelled bill pe advance apply nahi ho sakti");
          if (bill.billStatus === "REFUNDED")
            throw new Error("Refunded bill — no further payments allowed");

          const remainingAdv  = Math.max(0, toNum(adv.amount) - toNum(adv.appliedAmount));
          // R7am: compute the bill's effective balance using the LARGER
          // of stored `patientPayableAmount` vs `sum(billItems.netAmount)`.
          // Some bills have stale patentPayable=0 because recalcTotals
          // never ran (R7aa root cause) but their billItems still hold
          // real money. Without this fallback, /apply would always say
          // "Nothing to apply" for those bills and the cashier sees a
          // success toast with zero effect.
          const itemsNet      = (bill.billItems || []).reduce((s, i) => s + toNum(i.netAmount), 0);
          const paidPositive  = bill.payments.reduce((s, p) => {
            const v = toNum(p.amount);
            return s + (v > 0 ? v : 0);
          }, 0);
          const referenceNet  = Math.max(toNum(bill.patientPayableAmount), itemsNet);
          const billBalance   = Math.max(0, referenceNet - paidPositive);
          // Default to MIN(advance remaining, bill balance) — covers the
          // most common case where the cashier wants to consume as much
          // of the advance as the bill allows. Caller can override.
          const requested = amount != null ? toNum(amount) : Math.min(remainingAdv, billBalance);
          if (requested <= 0) throw new Error("Nothing to apply (bill balance or advance remaining is zero)");
          if (requested > remainingAdv) throw new Error(`Advance only has ₹${remainingAdv} remaining; cannot apply ₹${requested}`);
          if (requested > billBalance)  throw new Error(`Bill balance is only ₹${billBalance}; cannot apply ₹${requested}`);

          // R7am: if patientPayableAmount was stale (0) but items have
          // value, repair it before the payment row goes in. Without
          // this, the bill's totals would still report ₹0 after apply.
          if (toNum(bill.patientPayableAmount) <= 0 && itemsNet > 0) {
            bill.patientPayableAmount = itemsNet;
            bill.markModified("patientPayableAmount");
          }
          if (toNum(bill.netAmount) <= 0 && itemsNet > 0) {
            bill.netAmount = itemsNet;
            bill.markModified("netAmount");
          }
          if (toNum(bill.grossAmount) <= 0 && itemsNet > 0) {
            // Conservative — itemsNet already includes per-item discounts/tax,
            // but if grossAmount is empty too, use itemsNet as the floor so
            // the UI shows something coherent.
            bill.grossAmount = itemsNet;
            bill.markModified("grossAmount");
          }

          // 1. Push a Bill.payments[] row of mode ADVANCE_ADJUSTMENT.
          //    transactionId carries the advance receipt number for the
          //    audit trail. We do not double-charge — this is an
          //    in-system credit transfer.
          bill.payments.push({
            amount: requested,
            paymentMode: "ADVANCE_ADJUSTMENT",
            transactionId: adv.receiptNumber,
            receivedBy: appliedBy || adv.receivedBy || "System",
            paidAt: new Date(),
            remarks: `Applied from advance ${adv.receiptNumber}`,
          });
          const newPayment = bill.payments[bill.payments.length - 1];

          const totalPaid = bill.payments.reduce((s, p) => s + toNum(p.amount), 0);
          const balance   = Math.max(0, toNum(bill.patientPayableAmount) - totalPaid);
          bill.advancePaid   = totalPaid;
          bill.balanceAmount = balance;
          bill.billStatus    = balance === 0 ? "PAID" : "PARTIAL";
          if (bill.billStatus === "PAID") bill.paidAt = new Date();

          // 2. Update the advance row: bump appliedAmount, push an
          //    appliedTo[] entry. The pre-save hook auto-flips status
          //    from ACTIVE → PARTIALLY_APPLIED → FULLY_APPLIED.
          adv.appliedAmount = toNum(adv.appliedAmount) + requested;
          adv.appliedTo.push({
            billId: bill._id,
            billNumber: bill.billNumber,
            amount: requested,
            appliedAt: new Date(),
            appliedBy: appliedBy || "System",
            appliedById,
            billPaymentId: newPayment._id,
          });

          await adv.save({ session: s || undefined });
          await bill.save({ session: s || undefined });
          // R7ap-F15: emit audit row for advance application to bill.
          try {
            const { emit } = require("../../models/Billing/BillingAudit");
            await emit({
              event:                "ADVANCE_APPLIED",
              UHID:                 adv.UHID,
              patientId:            adv.patientId,
              advanceId:            adv._id,
              advanceReceiptNumber: adv.receiptNumber,
              billId:               bill._id,
              billNumber:           bill.billNumber,
              admissionId:          adv.admission,
              amount:               requested,
              paymentMode:          "ADVANCE_ADJUSTMENT",
              actorName:            appliedBy,
              actorId:              appliedById,
              reason:               `Applied ${requested} from advance ${adv.receiptNumber} to ${bill.billNumber}`,
            });
          } catch (_) { /* audit best-effort */ }
          // R7av-FIX-9/D5-MED-1: invalidate Day Book cache so the
          // accountant's tile reflects the ADVANCE_ADJUSTMENT row
          // within milliseconds, not 30s. Pre-R7av the apply flow
          // skipped this — applied amounts stayed off the dashboard
          // until next cache rotation.
          try {
            const ctrl = require("../../controllers/Billing/billingController");
            ctrl.invalidateDayBookCache?.();
          } catch (_) {}
          return { advance: adv, bill, appliedAmount: requested };
        };

        try {
          if (useTx) {
            let result;
            await session.withTransaction(async () => { result = await work(session); });
            return result;
          }
          return await work(null);
        } catch (err) {
          if (err?.name === "VersionError") continue;
          throw err;
        }
      }
      throw new Error("Advance apply concurrency conflict after retries");
    } finally {
      if (session) session.endSession();
    }
  }

  // ── 5. Refund the unspent portion of an advance ──────────────
  // R7ao: refunds the remainingAmount (amount − appliedAmount). Allowed
  // when status is ACTIVE or PARTIALLY_APPLIED — applied-to-bills history
  // is preserved untouched, only the unspent remainder is returned to
  // the patient. FULLY_APPLIED / REFUNDED / CANCELLED rows are rejected.
  //
  // R7ap-F7/D7-02: ATOMIC via `findOneAndUpdate` with status predicate.
  // Pre-R7ap two concurrent refund calls each passed the read-time status
  // check then both saved last-writer-wins — patient could walk out with
  // double the unspent amount in cash. The predicate-filter version
  // guarantees only ONE write wins; the loser sees the post-update doc
  // already in REFUNDED state and throws 409.
  // R7bb-C / S5 (D7-CRIT-1): controller forwards req.user identity
  // (refundedById, refundedByRole). Pre-R7bb body's refundedBy was
  // accepted directly so a forged body could attribute the refund
  // to any operator (a critical money out-flow).
  async refundAdvance(advanceId, { refundedBy, refundedById, refundedByRole, refundReason, mode, transactionId, approverOverride }) {
    if (!advanceId) throw new Error("advanceId required");
    if (!refundedBy)   throw new Error("refundedBy name required for audit");
    if (!refundReason) throw new Error("refundReason required for audit");

    // Pre-read for amount validation + invariant computation (read-side fine
    // because the actual write is the atomic findOneAndUpdate).
    const adv = await PatientAdvance.findById(advanceId).lean();
    if (!adv) throw new Error("Advance not found");
    if (adv.status === "REFUNDED" || adv.status === "CANCELLED") {
      throw new Error(`Already ${adv.status} — nothing more to refund.`);
    }
    if (adv.status === "FULLY_APPLIED") {
      throw new Error("Advance fully applied to bills — no remaining balance to refund.");
    }

    // R7bb-FIX-E-3 / D3-CRIT-3: Segregation of Duties — the cashier
    // who collected the advance can't be the one who refunds it. An
    // Admin can second-sign via approverOverride=true; the original
    // collector stays on refundedById for trail.
    if (refundedById && adv.receivedById &&
        String(refundedById) === String(adv.receivedById) &&
        !approverOverride) {
      const err = new Error(
        "SAME_ACTOR — advance refund must be initiated by a different cashier or admin",
      );
      err.code = "SAME_ACTOR"; err.status = 409; throw err;
    }
    const total    = toNum(adv.amount);
    const applied  = toNum(adv.appliedAmount);
    const refunded = toNum(adv.refundedAmount);
    const remaining = +(total - applied - refunded).toFixed(2);
    if (remaining <= 0) throw new Error("No remaining balance to refund.");

    const validModes = ["CASH", "UPI", "BANK_TRANSFER", "CARD", "ONLINE"];
    const refundMode = mode && validModes.includes(mode) ? mode : "CASH";

    // CAS write: only proceed if the status is still ACTIVE/PARTIALLY_APPLIED
    // AND appliedAmount hasn't moved since our read. If a concurrent apply
    // landed in the meantime, appliedAmount changed and we lose the race
    // — caller should retry with the freshly computed `remaining`.
    const PatientAdvanceModel = require("../../models/PatientBillModel/PatientAdvanceModel");
    const updated = await PatientAdvanceModel.findOneAndUpdate(
      {
        _id:           advanceId,
        status:        { $in: ["ACTIVE", "PARTIALLY_APPLIED"] },
        appliedAmount: adv.appliedAmount,             // snapshot guard
      },
      {
        $set: {
          refundedAmount:      Decimal128.fromString(remaining.toFixed(2)),
          status:              "REFUNDED",
          refundedAt:          new Date(),
          refundedBy,
          refundedById:        refundedById || null,
          refundReason,
          refundMode,
          refundTransactionId: transactionId || null,
          // R7bb-FIX-E-3: Admin override audit anchor.
          ...(approverOverride && refundedById ? {
            approvedById: refundedById,
            approvedBy:   refundedBy,
            approvedAt:   new Date(),
          } : {}),
        },
      },
      { new: true },
    );
    if (!updated) {
      throw new Error("Refund race detected — advance state changed between read and write. Please retry.");
    }
    // R7ar-P1-7: invalidate Day Book cache on refund.
    try {
      const ctrl = require("../../controllers/Billing/billingController");
      ctrl.invalidateDayBookCache?.();
    } catch (_) { /* best-effort */ }
    // R7ap-F15: emit audit row. Best-effort — never block the refund on
    // audit-collection failure.
    try {
      const { emit } = require("../../models/Billing/BillingAudit");
      await emit({
        event:                "ADVANCE_REFUNDED",
        UHID:                 updated.UHID,
        patientId:            updated.patientId,
        advanceId:            updated._id,
        advanceReceiptNumber: updated.receiptNumber,
        admissionId:          updated.admission,
        amount:               remaining,
        paymentMode:          refundMode,
        transactionId:        transactionId || null,
        // R7bb-C / D7-HIGH-4: actorId on the audit row — listing audit
        // by actor (`?actorId=…`) now works for advance refunds too.
        actorId:              refundedById || null,
        actorRole:            refundedByRole || null,
        actorName:            refundedBy,
        reason:               refundReason,
        before:               { status: adv.status, refundedAmount: refunded, remainingAmount: remaining },
        after:                { status: "REFUNDED", refundedAmount: remaining, remainingAmount: 0 },
      });
    } catch (_) { /* audit best-effort */ }
    return updated;
  }
}

module.exports = new PatientAdvanceService();
