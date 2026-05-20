// routes/billingRoutes.js
const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/Billing/billingController");
const { attemptAuth, requireAction } = require("../../middleware/auth");

// Soft-auth — capture req.user when present so audit trail (who recorded
// each payment) is accurate, but don't 401 on legacy unauthenticated callers.
// NOTE: the global authenticate() in routes/index.js already populates
// req.user for every request — attemptAuth here is harmless redundancy.
router.use(attemptAuth);

// ── Static / non-ID routes first ─────────────────────────────
router.get("/",        ctrl.listBills);             // GET  /api/billing?page=1&limit=50&status=&visitType=&UHID=&startDate=&endDate=
router.get("/summary", ctrl.getSummary);            // GET  /api/billing/summary
router.get("/collection-summary", ctrl.getCollectionSummary); // GET /api/billing/collection-summary?date=YYYY-MM-DD
// Accountant-facing aggregators — gated by billing.read on the controller
// side via requireAction below; these are pure reads.
router.get("/revenue-breakdown",  requireAction("billing.read"), ctrl.getRevenueBreakdown);  // ?from=&to=
router.get("/aging",              requireAction("billing.read"), ctrl.getAging);             // ?asOf=

// ── TPA / Insurance workflow ─────────────────────────────────
router.get ("/tpa-cases",                ctrl.getTPACases);
// TPA workflow — moved behind a permission gate after the security audit
// caught these endpoints accepting any authenticated user. Pre-auth
// submit is the lighter action (sending the request to the TPA) so it
// stays on `tpa.pre-auth` which Receptionist + TPA Coordinator already
// have. Approve / deny actually shifts money — gated to TPA Coordinator
// or Admin via `tpa.claim`. (Both actions are mirrored in the frontend
// permissions config so the UI hides what the API rejects.)
router.post("/:billId/tpa-preauth-submit", requireAction("tpa.pre-auth"), ctrl.tpaPreAuthSubmit);
router.post("/:billId/tpa-approve",        requireAction("tpa.claim"),    ctrl.tpaApprove);
router.post("/:billId/tpa-deny",           requireAction("tpa.claim"),    ctrl.tpaDeny);
// R7z: short-pay reconciliation — TPA settles less than approved, this
// endpoint posts the actual remittance + handles the shortfall (default:
// bump patientPayableAmount; alt: write off via extraDiscount).
router.post("/:billId/tpa-settle",         requireAction("tpa.claim"),    ctrl.tpaSettle);
router.get("/uhid/:UHID", ctrl.getBillsByUHID); // GET  /api/billing/uhid/UH00000001
// Front-desk bulk actions across every outstanding bill for a UHID.
// collect-all distributes one lump-sum FIFO; bulk-settle applies a
// uniform % or proportional ₹ discount. Both writes are audited
// per-bill via bill.payments + bill.adjustmentLog respectively.
router.post("/uhid/:UHID/collect-all", ctrl.bulkCollectByUHID);
router.post("/uhid/:UHID/bulk-settle", ctrl.bulkSettleByUHID);
router.get("/price/:serviceId", ctrl.getServicePrice); // GET  /api/billing/price/:id?tariffType=TPA&tpaId=xxx
router.get("/daycare-check/:admissionId", ctrl.checkDaycare); // GET  /api/billing/daycare-check/:admissionId

// AI billing routes (/ai-suggest, /ai-confirm) removed along with
// BillingIntelligencePage.jsx — single Billing Counter page now
// handles the full receptionist flow without AI suggestions.
router.get("/nurse-services", ctrl.getNurseChargeableServices); // GET  /api/billing/nurse-services?patientType=IPD

// ── Nurse charge entry ────────────────────────────────────────
router.post("/:billId/nurse-charge", ctrl.addNurseCharge); // POST /api/billing/:billId/nurse-charge {serviceId, quantity, nurseName}

// ── Billing Audit Trail ───────────────────────────────────────────
router.get ("/audit-trail/:admissionId",      ctrl.getAuditTrail);
router.get ("/audit-summary/:admissionId",    ctrl.getAuditSummary);
router.post("/audit/:triggerId/confirm-bill", ctrl.confirmTriggerBill);

// ── IPD Live Ledger (Phase A) ─────────────────────────────────────
// Powers /billing/ipd/:admissionId on the frontend. Single read of the
// admission + bill + all triggers with permission-aware action flags.
// Tiered write endpoints sit on the same trigger so receptionists can
// undo (15-min auto-charges), accountants can override / cancel.
router.get ("/ipd/:admissionId/ledger",
  requireAction("billing.read"),          ctrl.getIPDLedger);
router.post("/ipd/:admissionId/manual-charge",
  requireAction("billing.manual-charge"), ctrl.addManualCharge);
router.post("/trigger/:triggerId/undo",
  requireAction("billing.undo"),          ctrl.undoTrigger);
router.post("/trigger/:triggerId/override",
  requireAction("billing.override"),      ctrl.overrideTrigger);
router.post("/trigger/:triggerId/cancel",
  requireAction("billing.cancel-charge"), ctrl.cancelTrigger);

// ── Bill CRUD & actions ───────────────────────────────────────
router.get("/:billId", ctrl.getBillById); // GET  /api/billing/:billId
router.post("/create", ctrl.getOrCreateBill); // POST /api/billing/create  {UHID, visitType, admissionId?}
router.post("/:billId/add-service", ctrl.addService); // POST /api/billing/:id/add-service  {serviceId, quantity}
router.post("/:billId/generate", ctrl.generateBill); // POST /api/billing/:id/generate
router.post("/:billId/payment", ctrl.recordPayment); // POST /api/billing/:id/payment  {amount, paymentMode}
// 15-min same-cashier payment-reversal (cashier-typo undo). Gated to
// billing.undo (Receptionist+) — controller enforces the time + ownership
// check on top.
router.post("/:billId/payment/:paymentId/void",
  requireAction("billing.undo"), ctrl.voidPayment);
// Audited settlement-time adjustment — extra discount + per-line price/qty edits
// on GENERATED/PARTIAL bills. Receptionist-accessible (front desk negotiates
// final settlement), but every change is logged with reason + staff name onto
// bill.adjustmentLog for NABH review.
router.post("/:billId/settlement-adjust", ctrl.settlementAdjust);
// Refunds and cancellations are the only billing writes restricted past
// the Receptionist tier — both require an Accountant (or Admin) per the
// central ACTIONS map. Receptionists can record charges and payments but
// cannot undo them.
router.post("/:billId/refund",   requireAction("billing.refund"), ctrl.refundPayment);
router.post("/:billId/cancel",   requireAction("billing.refund"), ctrl.cancelBill);
router.post("/:billId/tpa-claim", requireAction("tpa.claim"),     ctrl.setTPAClaimStatus);
router.put("/:billId/items/:itemId", ctrl.updateItemQty); // PUT  /api/billing/:id/items/:itemId  {quantity}
router.delete("/:billId/items/:itemId", ctrl.removeItem); // DELETE /api/billing/:id/items/:itemId

// ── Order lifecycle (NABH AAC.5) ──────────────────────────────
// Order-to-completion flow for lab / imaging / procedure lines added
// by doctors. The line is "Ordered" on add — NOT billable. The
// executing team flips it to "Completed" via /complete, at which point
// the charge lands on the bill. Cancel-order soft-cancels an active
// order (Ordered / InProgress) without removing the audit row.
// Permissions: deliberately permissive — any authenticated clinical
// user can complete or cancel an order they're executing. If finer
// gating is needed later (e.g. radiologist-only for imaging codes)
// it can be added at the service layer based on the service category.
router.patch("/:billId/items/:itemId/complete",     ctrl.completeItemOrder);
router.patch("/:billId/items/:itemId/cancel-order", ctrl.cancelItemOrder);

// ── Admin one-shot: backfill bills for historical patients whose
// receptionist registration never landed a billing trigger. Gated by
// billing.refund (Accountant/Admin only) — same tier as cancel/refund
// since it materially changes ledger state.
router.post("/backfill-registration", requireAction("billing.refund"), ctrl.backfillRegistrationBills);

// ── ANH package management ───────────────────────────────────────────
// Preview is a safe read — any authenticated user can call it. Attach
// and Detach change ledger state, so gated to billing.refund tier
// (Accountant / Admin / Receptionist with elevated permission).
router.post("/packages/preview", ctrl.previewPackageMatch);
router.post("/admissions/:admissionId/attach-package",
  requireAction("billing.refund"), ctrl.attachPackageToAdmission);
router.post("/admissions/:admissionId/detach-package",
  requireAction("billing.refund"), ctrl.detachPackageFromAdmission);

// ── Patient advance deposit ──────────────────────────────────────────
// Creating an advance is the receptionist's daily flow — any
// authenticated reception/admin/accountant can take a deposit at the
// desk. Refund is more sensitive (cash leaves the till) so gated to
// billing.refund. Listing is a read; apply changes ledger state but
// is part of the same desk-collection flow as create.
router.post("/advance",                          ctrl.createAdvance);
router.get ("/advance/uhid/:UHID",               ctrl.listAdvancesByUHID);
router.post("/advance/:advanceId/apply",         ctrl.applyAdvanceToBill);
router.post("/advance/:advanceId/refund",        requireAction("billing.refund"), ctrl.refundAdvance);

module.exports = router;
