/**
 * Admin operational endpoints — daily-accrual run, billing audit fixes,
 * data reset entry points. All require admin role.
 */
const express = require("express");
const router  = express.Router();
const autoBilling = require("../../services/Billing/autoBillingService");
const { adminOnly } = require("../../middleware/auth");

// R7au-FIX-14/D3-HIGH: replaced the ad-hoc inline `requireAdmin` (which
// matched on case-insensitive role names including "superadmin"/"owner"
// that don't exist in the enum) with the shared `adminOnly` middleware.
// Single source of truth → no drift if the enum changes.

// POST /api/admin-ops/run-daily-accrual
// Force-runs the daily bed-charge accrual sweep. Safe to call repeatedly —
// dailyDedup prevents double-charging the same admission on the same day.
router.post("/run-daily-accrual", adminOnly, async (req, res) => {
  try {
    const result = await autoBilling.runDailyBedChargeAccrual();
    res.json({ success: true, result });
  } catch (e) {
    console.error("run-daily-accrual error:", e);
    res.status(500).json({ success: false, message: e.message });
  }
});

// GET /api/admin-ops/health
// Lightweight health probe that includes the next scheduled accrual hint.
router.get("/health", adminOnly, (req, res) => {
  res.json({
    success: true,
    bootedAt: process.env.BOOT_AT || "—",
    uptime: Math.round(process.uptime()),
    nextAccrualHint: "Runs ~6h after each invocation; manually trigger via POST /run-daily-accrual",
  });
});

module.exports = router;
