// routes/billingRoutes.js
const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/Billing/billingController");
const { attemptAuth, requireAction } = require("../../middleware/auth");
const { validateObjectIdParam } = require("../../utils/queryGuards");
// R7bh-F10 / R7bg-10-CRIT-3: Idempotency-Key guard on money-touching
// POSTs. Cashier double-click, mobile+desktop dual post, network retry
// → all replay the cached response instead of posting twice. Header
// must be supplied by the client (`Idempotency-Key: <uuid>`); legacy
// clients without the header keep their existing behaviour and rely
// on the controller-level duplicate-transactionId check.
const idempotencyGuard = require("../../middleware/idempotencyGuard");

// R7ap-F25/D3-03: shorthand for the ObjectId guards. Catches malformed
// params and 400s BEFORE the controller's findById throws CastError →
// 500. Same module already exports validateObjectIdParam.
const vBill   = validateObjectIdParam("billId");
const vAdv    = validateObjectIdParam("advanceId");
const vAdm    = validateObjectIdParam("admissionId");
const vTrig   = validateObjectIdParam("triggerId");
const vItem   = validateObjectIdParam("itemId");
const vPay    = validateObjectIdParam("paymentId");
// B4-T08: the stuck-trigger retry endpoint uses `:id` (per spec) rather
// than the existing `:triggerId` convention, so it needs its own guard.
const vId     = validateObjectIdParam("id");

// Soft-auth — capture req.user when present so audit trail (who recorded
// each payment) is accurate, but don't 401 on legacy unauthenticated callers.
// NOTE: the global authenticate() in routes/index.js already populates
// req.user for every request — attemptAuth here is harmless redundancy.
router.use(attemptAuth);

// ── Static / non-ID routes first ─────────────────────────────
// R7ap-F5/D3-01/D3-02/D6-14: all read endpoints touching PHI/money now
// gated on `billing.read` — Admin / Accountant / Receptionist / TPA
// Coordinator. Pre-R7ap any authenticated user (Pharmacist, Lab Tech,
// Ward Boy, Housekeeping, MRD) could pull every bill + advance ledger
// for any UHID. NABH AAC.7 / DPDP purpose-limitation violation.
router.get("/",        requireAction("billing.read"), ctrl.listBills);
router.get("/summary", requireAction("billing.read"), ctrl.getSummary);
router.get("/collection-summary", requireAction("billing.read"), ctrl.getCollectionSummary);
router.get("/revenue-breakdown",  requireAction("billing.read"), ctrl.getRevenueBreakdown);
router.get("/aging",              requireAction("billing.read"), ctrl.getAging);
// R7ap-F13: hospital-service GST aggregator (CGST/SGST per tax slab)
router.get("/gst-register",       requireAction("billing.read"), ctrl.getHospitalGstRegister);
// R7ar-P1-23/D6-aq-06: frozen monthly GST snapshots + lock toggle.
router.get ("/gst-snapshots",                requireAction("billing.read"),  ctrl.listGstSnapshots);
router.post("/gst-snapshots/:period/lock",   requireAction("reports.audit"), ctrl.lockGstSnapshot);
// R7ar-P1-15/D6-aq-08: credit-note listing for the Refunds tab + audit.
router.get ("/credit-notes",                 requireAction("billing.read"),  ctrl.listCreditNotes);
// R7bb-FIX-E-2 / D3-CRIT-2: second-approver gate on high-value /
// tax-bearing CNs. Issuer cannot approve their own note.
router.post("/credit-notes/:id/approve",     requireAction("billing.refund"), ctrl.approveCreditNote);
// R7ap-F15: unified billing-audit listing (every money event in one feed).
router.get("/audit",              requireAction("reports.audit"), ctrl.listBillingAudit);
// R7ap-F34: gap-detector for BILL-* / ADV-* / CN-* sequences (Income-Tax §44AB).
router.get("/sequence-audit",     requireAction("reports.audit"), ctrl.sequenceAudit);

// ── TPA / Insurance workflow ─────────────────────────────────
router.get ("/tpa-cases",                requireAction("billing.read"), ctrl.getTPACases);
// TPA workflow — moved behind a permission gate after the security audit
// caught these endpoints accepting any authenticated user. Pre-auth
// submit is the lighter action (sending the request to the TPA) so it
// stays on `tpa.pre-auth` which Receptionist + TPA Coordinator already
// have. Approve / deny actually shifts money — gated to TPA Coordinator
// or Admin via `tpa.claim`. (Both actions are mirrored in the frontend
// permissions config so the UI hides what the API rejects.)
router.post("/:billId/tpa-preauth-submit", vBill, requireAction("tpa.pre-auth"), ctrl.tpaPreAuthSubmit);
router.post("/:billId/tpa-approve",        vBill, requireAction("tpa.claim"),    ctrl.tpaApprove);
router.post("/:billId/tpa-deny",           vBill, requireAction("tpa.claim"),    ctrl.tpaDeny);
// R7hr(TPA-P2) — insurer query loop: raise (OPEN) + reply (REPLIED); a
// REJECTED claim re-submits via tpa-preauth-submit (ALLOWED_FROM covers it).
router.post("/:billId/tpa-query",                vBill, requireAction("tpa.claim"), ctrl.tpaQueryRaise);
router.post("/:billId/tpa-query/:queryId/reply", vBill, requireAction("tpa.claim"), ctrl.tpaQueryReply);
// R7z: short-pay reconciliation — TPA settles less than approved, this
// endpoint posts the actual remittance + handles the shortfall (default:
// bump patientPayableAmount; alt: write off via extraDiscount).
router.post("/:billId/tpa-settle",         vBill, requireAction("tpa.claim"),    ctrl.tpaSettle);
// UHID-wide by default; OPTIONAL ?visitId / ?admissionId / ?visitType narrow
// the bills[] to one encounter server-side (R7hr billing-audit R1c, additive).
router.get("/uhid/:UHID", requireAction("billing.read"), ctrl.getBillsByUHID); // R7ap-F5
// R7ap-F17: canonical UHID totals endpoint — single source of truth for
// every page showing per-patient money KPIs.
router.get("/uhid/:UHID/summary", requireAction("billing.read"), ctrl.getUhidSummary);
// R7hr(billing-audit P1.3) — previous PENDING dues (rule 1: surface prior
// billing at the next visit only when still unpaid).
router.get("/uhid/:UHID/previous-dues", requireAction("billing.read"), ctrl.getPreviousDues);
// Front-desk bulk actions across every outstanding bill for a UHID.
// collect-all distributes one lump-sum FIFO; bulk-settle applies a
// uniform % or proportional ₹ discount. Both writes are audited
// per-bill via bill.payments + bill.adjustmentLog respectively.
// R7ar-P0-2/D3-aq-02: gate the bulk write paths. Pre-R7ar any logged-in
// user could post a lump-sum cash collection or apply a discount across
// every bill on a UHID.
router.post("/uhid/:UHID/collect-all", requireAction("billing.write"),  idempotencyGuard("bulkCollectByUHID"), ctrl.bulkCollectByUHID);
// R7hr(NABH-P1.3): bulk-settle is pure discount distribution — moved to the
// billing.discount token (same Admin+Accountant set as billing.refund today)
// + service-level tiered cap on the % / flat pool for non-Admin actors.
router.post("/uhid/:UHID/bulk-settle", requireAction("billing.discount"), idempotencyGuard("bulkSettleByUHID"), ctrl.bulkSettleByUHID);
router.get("/price/:serviceId", requireAction("billing.read"), ctrl.getServicePrice); // R7ap-F5
router.get("/daycare-check/:admissionId", requireAction("billing.read"), ctrl.checkDaycare); // R7ap-F5

// AI billing routes (/ai-suggest, /ai-confirm) removed along with
// BillingIntelligencePage.jsx — single Billing Counter page now
// handles the full receptionist flow without AI suggestions.
router.get("/nurse-services", requireAction("billing.read"), ctrl.getNurseChargeableServices); // R7ap-F5

// ── Nurse charge entry ────────────────────────────────────────
// R7ar-P0-2: nurse-charge endpoint is a write — gate on billing.manual-charge
router.post("/:billId/nurse-charge", vBill, requireAction("billing.manual-charge"), ctrl.addNurseCharge);

// ── Billing Audit Trail ───────────────────────────────────────────
// R7ap-F5: audit trail exposes admission-level financial detail — gate at
// `reports.audit` (Admin/Accountant). Reception confirm-bill stays open
// because the controller has its own ownership check on the trigger.
router.get ("/audit-trail/:admissionId",      requireAction("reports.audit"), ctrl.getAuditTrail);
router.get ("/audit-summary/:admissionId",    requireAction("reports.audit"), ctrl.getAuditSummary);
// R7ar-P0-2: confirm-bill is a write that flips trigger → bill — gate.
router.post("/audit/:triggerId/confirm-bill", vTrig, requireAction("billing.write"), ctrl.confirmTriggerBill);

// ── IPD Live Ledger (Phase A) ─────────────────────────────────────
// Powers /billing/ipd/:admissionId on the frontend. Single read of the
// admission + bill + all triggers with permission-aware action flags.
// Tiered write endpoints sit on the same trigger so receptionists can
// undo (15-min auto-charges), accountants can override / cancel.
router.get ("/ipd/:admissionId/ledger",
  vAdm, requireAction("billing.read"),          ctrl.getIPDLedger);
router.post("/ipd/:admissionId/manual-charge",
  vAdm, requireAction("billing.manual-charge"), ctrl.addManualCharge);
router.post("/trigger/:triggerId/undo",
  vTrig, requireAction("billing.undo"),          ctrl.undoTrigger);
router.post("/trigger/:triggerId/override",
  vTrig, requireAction("billing.override"),      ctrl.overrideTrigger);
router.post("/trigger/:triggerId/cancel",
  vTrig, requireAction("billing.cancel-charge"), ctrl.cancelTrigger);
// B4-T08: stuck-trigger re-fire — Receptionist/Accountant/Admin can press
// Retry from the IPD Live Ledger's Stuck Triggers tile to re-run the
// accrual logic on a pending-review trigger. billing.write gate matches
// addManualCharge (same write surface — a retry can land a new bill line).
router.post("/triggers/:id/retry",
  vId, requireAction("billing.write"),           ctrl.retryStuckTrigger);

// ── Bill CRUD & actions ───────────────────────────────────────
router.get("/:billId", vBill, requireAction("billing.read"), ctrl.getBillById); // R7ap-F5/F25
// R7ar-P0-2/D3-aq-03: gate every cashier write on billing.write. Pre-R7ar
// any authenticated user could POST a payment / create a draft / add a
// service / generate / adjust settlement — only refund/cancel/TPA were gated.
router.post("/create",                     requireAction("billing.write"),  ctrl.getOrCreateBill);
router.post("/:billId/add-service",        vBill, requireAction("billing.write"),  ctrl.addService);
router.post("/:billId/generate",           vBill, requireAction("billing.write"),  ctrl.generateBill);
router.post("/:billId/payment",            vBill, requireAction("billing.write"),  idempotencyGuard("recordPayment"), ctrl.recordPayment);
// 15-min same-cashier payment-reversal (cashier-typo undo).
router.post("/:billId/payment/:paymentId/void",
  vBill, vPay, requireAction("billing.undo"), ctrl.voidPayment);
// Audited settlement-time adjustment — extra discount + per-line price/qty edits
// on GENERATED/PARTIAL bills. Every change is logged with reason + staff name
// onto bill.adjustmentLog for NABH review.
// R7hr(NABH-P1.3): gate on billing.discount — the concession action finally
// enforced on its own token (was billing.refund; both map Admin+Accountant
// today, so no role loses access, but a hospital can now tune discount vs
// refund independently). The service additionally applies the tiered cap:
// non-Admin net reductions bounded by BILLING_DISCOUNT_CAP_PCT (default 10%).
router.post("/:billId/settlement-adjust", vBill, requireAction("billing.discount"), ctrl.settlementAdjust);
// Refunds and cancellations are the only billing writes restricted past
// the Receptionist tier — both require an Accountant (or Admin) per the
// central ACTIONS map. Receptionists can record charges and payments but
// cannot undo them.
router.post("/:billId/refund",    vBill, requireAction("billing.refund"), idempotencyGuard("refundPayment"), ctrl.refundPayment);
router.post("/:billId/cancel",    vBill, requireAction("billing.refund"), ctrl.cancelBill);
router.post("/:billId/tpa-claim", vBill, requireAction("tpa.claim"),     ctrl.setTPAClaimStatus);
// R7ar-P0-2: item CRUD is a billing write. Edit gate on override, delete on cancel-charge.
router.put("/:billId/items/:itemId",    vBill, vItem, requireAction("billing.override"),      ctrl.updateItemQty);
router.delete("/:billId/items/:itemId", vBill, vItem, requireAction("billing.cancel-charge"), ctrl.removeItem);

// R7ci — Hard-delete a DRAFT bill. Strictly gated: only DRAFT status, zero
// collected payments. Items go with the bill (subdoc array). Any
// BillingTriggers that referenced this bill are flipped to status="voided"
// so the audit trail keeps the trail without an orphan link. Receptionist
// can do this themselves — a DRAFT was never billed to a patient, so
// scrapping it doesn't need accountant-level approval.
router.post("/:billId/delete", vBill, requireAction("billing.write"), ctrl.deleteDraftBill);

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
// R7ar-P0-2: order lifecycle writes — clinical user only.
router.patch("/:billId/items/:itemId/complete",     vBill, vItem, requireAction("billing.write"), ctrl.completeItemOrder);
router.patch("/:billId/items/:itemId/cancel-order", vBill, vItem, requireAction("billing.cancel-charge"), ctrl.cancelItemOrder);

// ── Admin one-shot: backfill bills for historical patients whose
// receptionist registration never landed a billing trigger. Gated by
// billing.refund (Accountant/Admin only) — same tier as cancel/refund
// since it materially changes ledger state.
router.post("/backfill-registration", requireAction("billing.refund"), ctrl.backfillRegistrationBills);

// ── ANH package management ───────────────────────────────────────────
// Preview is a safe read — any authenticated user can call it. Attach
// and Detach change ledger state, so gated to billing.refund tier
// (Accountant / Admin / Receptionist with elevated permission).
router.post("/packages/preview", requireAction("billing.read"), ctrl.previewPackageMatch);
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
// R7ab: createAdvance + applyAdvanceToBill now action-gated on
// billing.write. Pre-R7ab any authenticated role could post cash into
// a patient's advance pool. Refund stays on billing.refund (Admin/
// Accountant only).
router.post("/advance",                          requireAction("billing.write"),  idempotencyGuard("createAdvance"), ctrl.createAdvance);
router.get ("/advance/uhid/:UHID",               requireAction("billing.read"),   ctrl.listAdvancesByUHID); // R7ap-F5
// R7ap-F11: register BEFORE /advance/:advanceId/apply so /advance/refunds
// doesn't get caught by the :advanceId param.
router.get ("/advance/refunds",                  requireAction("billing.read"),   ctrl.listAdvanceRefunds);
router.post("/advance/:advanceId/apply",         vAdv, requireAction("billing.write"),  idempotencyGuard("applyAdvanceToBill"), ctrl.applyAdvanceToBill);
// R7hr-261 (sprint-review SoD fix): advance-deposit refund is the one refund a
// Receptionist may perform, so it gates on the narrow billing.advance-refund
// (Admin/Accountant/Receptionist) — NOT the broad billing.refund tier that also
// covers bill refund/cancel + credit-note approval.
router.post("/advance/:advanceId/refund",        vAdv, requireAction("billing.advance-refund"), idempotencyGuard("refundAdvance"),      ctrl.refundAdvance);

module.exports = router;
