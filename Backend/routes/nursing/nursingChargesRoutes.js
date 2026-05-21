const express = require("express");
const router  = express.Router();
const ctrl    = require("../../controllers/nursing/nursingChargesController");
// R7az-A/D1-CRIT: replace inline `authorize("Admin")` / `authorize("Nurse","Admin")`
// with action-based gates so the catalog mutates only via departments.write
// (Admin) and charge logging follows the same billing.manual-charge tier
// that the rest of the manual-charge surface uses. The global authenticate()
// in routes/index.js makes the per-route `authenticate` redundant.
const { requireAction } = require("../../middleware/auth");

// R7bb-B/D4-HIGH-S1: all reads now gated on `billing.read` (Admin /
// Accountant / Receptionist / TPA Coordinator). Pre-R7bb any
// authenticated role could pull the nursing-charges catalogue + every
// patient's running charges total — exposes tariff data + per-admission
// money trail.

// ── Master catalogue ───────────────────────────────────────
router.get   ("/items",            requireAction("billing.read"), ctrl.getItems);
router.post  ("/items",            requireAction("departments.write"), ctrl.createItem);
router.put   ("/items/:id",        requireAction("departments.write"), ctrl.updateItem);
router.delete("/items/:id",        requireAction("departments.write"), ctrl.deleteItem);

// ── Charge entries ────────────────────────────────────────────
router.post  ("/log",              requireAction("billing.manual-charge"), ctrl.logItems);
router.delete("/entry/:entryId",   requireAction("billing.manual-charge"), ctrl.voidEntry);

// ── Per-admission queries ─────────────────────────────────────
router.get("/:admissionId/today",        requireAction("billing.read"), ctrl.getTodayCharges);
router.get("/:admissionId/history",      requireAction("billing.read"), ctrl.getAllCharges);
router.get("/:admissionId/daily-totals", requireAction("billing.read"), ctrl.getDailyTotals);

module.exports = router;
