/**
 * Admin operational endpoints — daily-accrual run, billing audit fixes,
 * data reset entry points. All require admin role.
 */
const express = require("express");
const router  = express.Router();
const autoBilling = require("../../services/Billing/autoBillingService");

// ── Role gate ──────────────────────────────────────────────────────────────
// authenticate middleware runs upstream; here we check role manually so the
// daily-accrual button is only callable by admins.
function requireAdmin(req, res, next) {
  const role = (req.user?.role || "").toLowerCase();
  if (role === "admin" || role === "superadmin" || role === "owner") return next();
  return res.status(403).json({ success: false, message: "Admin role required" });
}

// POST /api/admin-ops/run-daily-accrual
// Force-runs the daily bed-charge accrual sweep. Safe to call repeatedly —
// dailyDedup prevents double-charging the same admission on the same day.
router.post("/run-daily-accrual", requireAdmin, async (req, res) => {
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
router.get("/health", requireAdmin, (req, res) => {
  res.json({
    success: true,
    bootedAt: process.env.BOOT_AT || "—",
    uptime: Math.round(process.uptime()),
    nextAccrualHint: "Runs ~6h after each invocation; manually trigger via POST /run-daily-accrual",
  });
});

module.exports = router;
