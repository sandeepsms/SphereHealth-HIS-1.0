const express = require("express");
const router  = express.Router();
const ctrl    = require("../../controllers/Pharmacy/pharmacyController");
const {
  requireAction,
  // R7hr-12-S2 (D6-03): scope-filter middleware so Doctor / Nurse rx.read
  // holders only see their own panel / ward, not every patient in the
  // hospital. attachDoctorProfile loads req.doctorProfile; the two
  // restrictTo helpers attach req.scopeFilter for the controller to merge
  // into its Mongo where{}. Both NO-OP for Admin/Pharmacist/Accountant.
  attachDoctorProfile,
  restrictToOwnDoctorPatients,
  restrictToOwnNurseWard,
} = require("../../middleware/auth");
// R7bm-F9: 400 on a malformed :id before findById throws CastError -> 500.
const { validateObjectIdParam } = require("../../utils/queryGuards");
// R7hr-12-S3 (D4-06): Idempotency-Key replay guard for pharmacy money-touching
// POSTs (collect-credit, apply-advance) — mirrors billingRoutes L140/L155/
// L210/L215/L216. The middleware no-ops without the Idempotency-Key request
// header (header-required design — Backend/middleware/idempotencyGuard.js
// L65-L68), so adding it here is back-compat: legacy callers keep working
// while UUID-aware callers get double-debit protection on retry/double-click.
const idempotencyGuard = require("../../middleware/idempotencyGuard");
// R7hr-12-S3 (D6-11): PCI / State Pharmacy Council registration gate for
// licensed-act endpoints (GRN, dispense, cancel, return, vendor-return,
// add-items). D&C Rules 65 + NDPS Act §8 + NABH HRD.3 require the acting
// pharmacist to hold a current State Pharmacy Council practising
// registration on the date of the act. Mirrors the scheduleXRoutes.js
// PHARMACIST_REG mount (Sprint 2 / D6-06). PHARMACIST_REG is already
// wired in LOGICAL_TYPE_MAP (credentialExpiryBlocker.js L145-L167).
const { credentialExpiryBlocker } = require("../../middleware/credentialExpiryBlocker");

/* ── Reads ──
   Drug catalogue / stock / sales register: anyone in the pharmacy
   module (Admin, Pharmacist) can read. Doctors also need drug search
   for prescriptions. We use rx.read to cover both groups. */

// Drugs
router.get   ("/drugs",          requireAction("rx.read"),            ctrl.listDrugs);
router.get   ("/drugs/search",   requireAction("rx.read"),            ctrl.searchDrugs);
router.post  ("/drugs",          requireAction("pharmacy.settings"),  ctrl.createDrug);
router.put   ("/drugs/:id",      requireAction("pharmacy.settings"),  ctrl.updateDrug);
router.delete("/drugs/:id",      validateObjectIdParam("id"), requireAction("pharmacy.settings"),  ctrl.deleteDrug);

// Suppliers — pharmacist + admin
router.get   ("/suppliers",      requireAction("pharmacy.grn"),       ctrl.listSuppliers);
router.post  ("/suppliers",      requireAction("pharmacy.settings"),  ctrl.createSupplier);
router.put   ("/suppliers/:id",  requireAction("pharmacy.settings"),  ctrl.updateSupplier);
router.delete("/suppliers/:id",  validateObjectIdParam("id"), requireAction("pharmacy.settings"),  ctrl.deleteSupplier);

// GRN + batches + stock
// R7hr-12-S3 (D6-11): GRN signs the inventory ledger (controller bumps the
// Schedule-X balance on receipt at pharmacyController.js L368-L380), so the
// receiving pharmacist must hold a current PCI / State Pharmacy Council
// registration. Mounts AFTER requireAction so the role gate still runs first.
router.post  ("/grn",            requireAction("pharmacy.grn"),       credentialExpiryBlocker("PHARMACIST_REG"), ctrl.recordGRN);
router.get   ("/batches",        requireAction("rx.read"),            ctrl.listBatches);
router.get   ("/stock",          requireAction("rx.read"),            ctrl.stockRollup);

// Sales
// R7hr-12-S3 (D6-11): dispense / cancel / return / add-items are all
// licensed-pharmacist acts under D&C Rules 65 — mount credentialExpiryBlocker
// ("PHARMACIST_REG") AFTER requireAction so the role gate still fires first.
// Reads (GET /sales, GET /sales/:id) are intentionally NOT gated — register
// view is itself a compliance artefact and read access must not depend on
// the reader's own licence (Admin / Auditor / Surveyor parity with the
// scheduleXRoutes.js /register precedent).
router.post  ("/sales",                 requireAction("pharmacy.dispense"),  credentialExpiryBlocker("PHARMACIST_REG"), ctrl.dispense);
// R7hr-12-S2 (D6-03): scope-filter listSales by Doctor's panel / Nurse's
// ward when applicable. Helpers NO-OP for Admin/Pharmacist/Accountant.
router.get   ("/sales",                 requireAction("rx.read"),            attachDoctorProfile, restrictToOwnDoctorPatients, restrictToOwnNurseWard, ctrl.listSales);
router.get   ("/sales/:id",             requireAction("rx.read"),            ctrl.getSale);
router.post  ("/sales/:id/cancel",      requireAction("pharmacy.cancel"),    credentialExpiryBlocker("PHARMACIST_REG"), ctrl.cancelSale);
router.post  ("/sales/:id/return",      requireAction("pharmacy.return"),    credentialExpiryBlocker("PHARMACIST_REG"), ctrl.returnItems);
router.post  ("/sales/:id/add-items",   requireAction("pharmacy.add-items"), credentialExpiryBlocker("PHARMACIST_REG"), ctrl.addItems);

// R7cu — IPD pharmacy credit ledger.
// • GET  /credit/ipd-admissions          → admissions with outstanding > 0
// • GET  /credit/admission/:admissionId  → drill-down per admission
// • POST /sales/:id/collect-credit       → record a credit collection
// pharmacy.dispense covers Pharmacist + Admin (the two roles that run a
// pharmacy counter); both list endpoints use rx.read so Receptionist
// can also see outstanding totals before billing-counter discharge.
// R7hr-12-S2 (D6-03): IPD credit ledger endpoints surface patientName,
// UHID, drug items, and doctor-name across every admission. Doctor / Nurse
// rx.read holders must only see their own panel / ward, not every patient.
router.get   ("/credit/ipd-admissions",         requireAction("rx.read"),            attachDoctorProfile, restrictToOwnDoctorPatients, restrictToOwnNurseWard, ctrl.listIpdCreditAdmissions);
router.get   ("/credit/admission/:admissionId", validateObjectIdParam("admissionId"), requireAction("rx.read"),            attachDoctorProfile, restrictToOwnDoctorPatients, restrictToOwnNurseWard, ctrl.getCreditByAdmission);
// R7hr-12-S3 (D4-06): idempotencyGuard mirrors billingRoutes.js L210/L215/
// L216 — a mobile retry or proxy-retried POST on a flaky network would
// otherwise land twice on the server. Both controllers (collectCredit
// L1553, applyAdvanceToSale L1702) already 409 on ALREADY_PAID, so the
// common full-pay retry is blocked, but the partial-pay path (caller
// supplies an explicit amount < remaining balance on both attempts) can
// silently double-debit. Guard is header-required (no header → no-op),
// so this is back-compat with existing axios callers; once the Frontend
// rolls out a shared Idempotency-Key axios interceptor / helper the
// double-debit window closes for every money-touching POST in one pass.
router.post  ("/sales/:id/collect-credit",      validateObjectIdParam("id"),          requireAction("pharmacy.dispense"),  idempotencyGuard("pharmacyCollectCredit"), ctrl.collectCredit);
// R7hr-5: apply patient advance pool against an outstanding sale —
// gated on pharmacy.dispense same as collectCredit (debits balance
// even though the cash flow is internal).
// R7hr-12-S3 (D4-06): same idempotency rationale as collect-credit above.
router.post  ("/sales/:id/apply-advance",       validateObjectIdParam("id"),          requireAction("pharmacy.dispense"),  idempotencyGuard("pharmacyApplyAdvance"), ctrl.applyAdvanceToSale);
// R7cv — Day-wise audit log of every IPD credit sale (outstanding +
// already-cleared) — pharmacist needs to see "what went out on
// credit historically" not just "what's currently blocking".
router.get   ("/credit/ipd-history",            requireAction("rx.read"),            attachDoctorProfile, restrictToOwnDoctorPatients, restrictToOwnNurseWard, ctrl.getIpdCreditHistory);

// Settings (in-house vs outsourced print identity)
router.get   ("/settings",       requireAction("rx.read"),            ctrl.getSettings);
router.put   ("/settings",       requireAction("pharmacy.settings"),  ctrl.updateSettings);

// Dashboard (read for any pharmacy-eligible user)
router.get   ("/stats",          requireAction("rx.read"),            ctrl.stats);
router.get   ("/alerts",         requireAction("rx.read"),            ctrl.alerts);

// R7bb-FIX-E-11 / D6-HIGH-1: Vendor returns — record an expired /
// damaged / recalled batch return to the supplier.
// R7hr-12-S3 (D6-11): vendor-return WRITE signs the inventory ledger same
// as GRN — credentialExpiryBlocker on POST only; read stays open for audit.
router.get   ("/vendor-returns", requireAction("pharmacy.return"),    ctrl.listVendorReturns);
router.post  ("/vendor-returns", requireAction("pharmacy.return"),    credentialExpiryBlocker("PHARMACIST_REG"), ctrl.recordVendorReturn);

// R7bb-FIX-E-14 / D6-HIGH-7: end-of-day cash close snapshot.
router.post  ("/close-day",      requireAction("pharmacy.settings"),  ctrl.closeDay);

// Registers (D&C Rules + GST) — read
router.get   ("/registers/sales",      requireAction("rx.read"),      ctrl.salesRegister);
router.get   ("/registers/purchase",   requireAction("rx.read"),      ctrl.purchaseRegister);
router.get   ("/registers/stock",      requireAction("rx.read"),      ctrl.stockRegister);
router.get   ("/registers/schedule-h", requireAction("rx.read"),      ctrl.scheduleHRegister);
router.get   ("/registers/expiry",     requireAction("rx.read"),      ctrl.expiryRegister);
router.get   ("/registers/gst",        requireAction("rx.read"),      ctrl.gstSummary);

// R7hr-16: Parse supplier invoice (JSON or PDF) → pre-fill GRN form.
// memoryStorage so the buffer stays in RAM for hashing + parsing (no
// disk roundtrip). 5 MB ceiling matches safeUpload's default. We
// accept .json + .pdf only — controller does a second MIME/extension
// check before any work runs.
const multer = require("multer");
const _parseInvoiceUpload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const mt  = (file.mimetype || "").toLowerCase();
    const ext = (file.originalname || "").toLowerCase().split(".").pop();
    if (mt === "application/json" || mt === "application/pdf" ||
        ext === "json" || ext === "pdf") {
      return cb(null, true);
    }
    cb(null, false);   // silently drop; controller surfaces BAD_MIME 400
  },
});
router.post(
  "/grn/parse-invoice",
  requireAction("pharmacy.grn"),
  credentialExpiryBlocker("PHARMACIST_REG"),
  _parseInvoiceUpload.single("file"),
  ctrl.parseInvoice,
);

module.exports = router;
