/**
 * routes/Reports/reportsRoutes.js
 * ────────────────────────────────────────────────────────────────────
 * R7bf-H — Reports + dashboards endpoint surface.
 *
 *   GET /api/reports/hospital-register?from=&to=     (A6-CRIT-2)
 *   GET /api/reports/refunds?from=&to=               (A6-CRIT-4)
 *   GET /api/reports/today-revenue                   (A6-CRIT-7)
 *   GET /api/reports/day-book?date=                  (A6-CRIT-6)
 *   GET /api/reports/gst-monthly?period=             (A6-CRIT-1)
 *   GET /api/reports/patient-census                  (A6-HIGH-1)
 *   GET /api/reports/pharmacy-revenue-trend?days=    (A6-HIGH-2)
 *   GET /api/reports/doctor-performance?from=&to=    (A6-HIGH-3 + 9)
 *   GET /api/reports/bed-occupancy                   (A6-HIGH-4)
 *   GET /api/reports/lab-tat?from=&to=               (A6-HIGH-5)
 *   GET /api/reports/inventory/abc-analysis?months=  (A6-HIGH-6)
 *   GET /api/reports/ar-aging?asOf=                  (A6-HIGH-7)
 *   GET /api/reports/daily-collection?date=&mode=    (A6-HIGH-8)
 *   GET /api/reports/diagnosis-frequency?from=&to=   (A6-HIGH-10)
 *
 * RBAC: every route requires reports.financial (financial cuts) or
 * reports.clinical (clinical cuts). Patient census / bed occupancy /
 * lab TAT / diagnosis-frequency lean clinical; everything else lives in
 * Accountant + Admin's reports.financial role.
 */

"use strict";

const express = require("express");
const router  = express.Router();
const { authenticate, requireAction } = require("../../middleware/auth");

const hospitalRegister = require("../../controllers/Reports/hospitalRegisterController");
const refunds          = require("../../controllers/Reports/refundsController");
const dash             = require("../../controllers/Reports/dashboardsController");

router.use(authenticate);

// ── Financial ────────────────────────────────────────────────────
router.get("/hospital-register",       requireAction("reports.financial"), hospitalRegister.getHospitalRegister);
router.get("/refunds",                 requireAction("reports.financial"), refunds.getRefunds);
router.get("/today-revenue",           requireAction("reports.financial"), dash.getTodayRevenue);
router.get("/day-book",                requireAction("reports.financial"), dash.getDayBook);
router.get("/gst-monthly",             requireAction("reports.financial"), dash.getMonthlyGst);
router.get("/ar-aging",                requireAction("reports.financial"), dash.getArAging);
router.get("/daily-collection",        requireAction("reports.financial"), dash.getDailyCollection);
router.get("/doctor-performance",      requireAction("reports.financial"), dash.getDoctorPerformance);
router.get("/pharmacy-revenue-trend",  requireAction("reports.financial"), dash.getPharmacyRevenueTrend);
router.get("/inventory/abc-analysis",  requireAction("reports.financial"), dash.getAbcAnalysis);

// ── Clinical ─────────────────────────────────────────────────────
router.get("/patient-census",          requireAction("reports.clinical"),  dash.getPatientCensus);
router.get("/bed-occupancy",           requireAction("reports.clinical"),  dash.getBedOccupancy);
// R7hr(LAB-TAT tile): gate widened reports.clinical → lab.read so the lab
// desk's own roles (Lab Technician / Radiologist / Nurse / MRD) can see
// their TAT CQI on /investigation-orders. lab.read still includes
// Admin + Doctor, so nobody lost access.
router.get("/lab-tat",                 requireAction("lab.read"),          dash.getLabTat);
// R7hr(NABH-P2.5) — IPD discharge TAT (doctor-approve → bill-clear →
// gate-pass), the NABH CQI discharge-process indicator. FY/date-ranged.
router.get("/discharge-tat",           requireAction("reports.clinical"),  dash.getDischargeTat);
// R7hr(ER-P2) — ER door-to-triage/doctor/disposition TAT (NABH AAC.1 CQI).
router.get("/er-tat",                  requireAction("reports.clinical"),  dash.getErTat);
// NABH HIC.5 — HAI rate per 1000 device-days (CAUTI/CLABSI/VAP) + SSI per-100-surgeries.
router.get("/hai-rate",                requireAction("reports.clinical"),  dash.getHaiRate);
// R7hr(ER-P3/DC-P3) — statutory attendance registers (printable sources).
router.get("/er-register",             requireAction("reports.clinical"),  dash.getErRegister);
router.get("/dc-register",             requireAction("reports.clinical"),  dash.getDcRegister);
// R7hr(TPA-P1) — TPA MIS: TAT, approval %, realization, stale-claims ageing.
router.get("/tpa-mis",                 requireAction("tpa.claim"),         dash.getTpaMis);
router.get("/diagnosis-frequency",     requireAction("reports.clinical"),  dash.getDiagnosisFrequency);

module.exports = router;
