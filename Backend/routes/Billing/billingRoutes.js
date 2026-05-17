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
router.post("/:billId/tpa-preauth-submit", ctrl.tpaPreAuthSubmit);
router.post("/:billId/tpa-approve",       ctrl.tpaApprove);
router.post("/:billId/tpa-deny",          ctrl.tpaDeny);
router.get("/uhid/:UHID", ctrl.getBillsByUHID); // GET  /api/billing/uhid/UH00000001
router.get("/price/:serviceId", ctrl.getServicePrice); // GET  /api/billing/price/:id?tariffType=TPA&tpaId=xxx
router.get("/daycare-check/:admissionId", ctrl.checkDaycare); // GET  /api/billing/daycare-check/:admissionId

// ── AI Intelligence ───────────────────────────────────────────
router.post("/ai-suggest", ctrl.aiSuggest); // POST /api/billing/ai-suggest       {billId, diagnosis, patientType}
router.post("/ai-confirm", ctrl.aiConfirm); // POST /api/billing/ai-confirm       {billId, serviceIds[], confirmedBy}
router.get("/nurse-services", ctrl.getNurseChargeableServices); // GET  /api/billing/nurse-services?patientType=IPD

// ── Nurse charge entry ────────────────────────────────────────
router.post("/:billId/nurse-charge", ctrl.addNurseCharge); // POST /api/billing/:billId/nurse-charge {serviceId, quantity, nurseName}

// ── Billing Audit Trail ───────────────────────────────────────────
router.get ("/audit-trail/:admissionId",      ctrl.getAuditTrail);
router.get ("/audit-summary/:admissionId",    ctrl.getAuditSummary);
router.post("/audit/:triggerId/confirm-bill", ctrl.confirmTriggerBill);

// ── Bill CRUD & actions ───────────────────────────────────────
router.get("/:billId", ctrl.getBillById); // GET  /api/billing/:billId
router.post("/create", ctrl.getOrCreateBill); // POST /api/billing/create  {UHID, visitType, admissionId?}
router.post("/:billId/add-service", ctrl.addService); // POST /api/billing/:id/add-service  {serviceId, quantity}
router.post("/:billId/generate", ctrl.generateBill); // POST /api/billing/:id/generate
router.post("/:billId/payment", ctrl.recordPayment); // POST /api/billing/:id/payment  {amount, paymentMode}
// Refunds and cancellations are the only billing writes restricted past
// the Receptionist tier — both require an Accountant (or Admin) per the
// central ACTIONS map. Receptionists can record charges and payments but
// cannot undo them.
router.post("/:billId/refund",   requireAction("billing.refund"), ctrl.refundPayment);
router.post("/:billId/cancel",   requireAction("billing.refund"), ctrl.cancelBill);
router.post("/:billId/tpa-claim", requireAction("tpa.claim"),     ctrl.setTPAClaimStatus);
router.put("/:billId/items/:itemId", ctrl.updateItemQty); // PUT  /api/billing/:id/items/:itemId  {quantity}
router.delete("/:billId/items/:itemId", ctrl.removeItem); // DELETE /api/billing/:id/items/:itemId

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

module.exports = router;
