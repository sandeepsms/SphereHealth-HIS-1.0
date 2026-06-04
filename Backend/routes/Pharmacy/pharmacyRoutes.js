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
router.post  ("/grn",            requireAction("pharmacy.grn"),       ctrl.recordGRN);
router.get   ("/batches",        requireAction("rx.read"),            ctrl.listBatches);
router.get   ("/stock",          requireAction("rx.read"),            ctrl.stockRollup);

// Sales
router.post  ("/sales",                 requireAction("pharmacy.dispense"),  ctrl.dispense);
// R7hr-12-S2 (D6-03): scope-filter listSales by Doctor's panel / Nurse's
// ward when applicable. Helpers NO-OP for Admin/Pharmacist/Accountant.
router.get   ("/sales",                 requireAction("rx.read"),            attachDoctorProfile, restrictToOwnDoctorPatients, restrictToOwnNurseWard, ctrl.listSales);
router.get   ("/sales/:id",             requireAction("rx.read"),            ctrl.getSale);
router.post  ("/sales/:id/cancel",      requireAction("pharmacy.cancel"),    ctrl.cancelSale);
router.post  ("/sales/:id/return",      requireAction("pharmacy.return"),    ctrl.returnItems);
router.post  ("/sales/:id/add-items",   requireAction("pharmacy.add-items"), ctrl.addItems);

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
router.post  ("/sales/:id/collect-credit",      validateObjectIdParam("id"),          requireAction("pharmacy.dispense"),  ctrl.collectCredit);
// R7hr-5: apply patient advance pool against an outstanding sale —
// gated on pharmacy.dispense same as collectCredit (debits balance
// even though the cash flow is internal).
router.post  ("/sales/:id/apply-advance",       validateObjectIdParam("id"),          requireAction("pharmacy.dispense"),  ctrl.applyAdvanceToSale);
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
router.get   ("/vendor-returns", requireAction("pharmacy.return"),    ctrl.listVendorReturns);
router.post  ("/vendor-returns", requireAction("pharmacy.return"),    ctrl.recordVendorReturn);

// R7bb-FIX-E-14 / D6-HIGH-7: end-of-day cash close snapshot.
router.post  ("/close-day",      requireAction("pharmacy.settings"),  ctrl.closeDay);

// Registers (D&C Rules + GST) — read
router.get   ("/registers/sales",      requireAction("rx.read"),      ctrl.salesRegister);
router.get   ("/registers/purchase",   requireAction("rx.read"),      ctrl.purchaseRegister);
router.get   ("/registers/stock",      requireAction("rx.read"),      ctrl.stockRegister);
router.get   ("/registers/schedule-h", requireAction("rx.read"),      ctrl.scheduleHRegister);
router.get   ("/registers/expiry",     requireAction("rx.read"),      ctrl.expiryRegister);
router.get   ("/registers/gst",        requireAction("rx.read"),      ctrl.gstSummary);

module.exports = router;
