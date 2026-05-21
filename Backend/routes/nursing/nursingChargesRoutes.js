const express = require("express");
const router  = express.Router();
const ctrl    = require("../../controllers/nursing/nursingChargesController");
// R7az-A/D1-CRIT: replace inline `authorize("Admin")` / `authorize("Nurse","Admin")`
// with action-based gates so the catalog mutates only via departments.write
// (Admin) and charge logging follows the same billing.manual-charge tier
// that the rest of the manual-charge surface uses. The global authenticate()
// in routes/index.js makes the per-route `authenticate` redundant.
const { requireAction } = require("../../middleware/auth");

// ── Master catalogue ───────────────────────────────────────
router.get   ("/items",            ctrl.getItems);
router.post  ("/items",            requireAction("departments.write"), ctrl.createItem);
router.put   ("/items/:id",        requireAction("departments.write"), ctrl.updateItem);
router.delete("/items/:id",        requireAction("departments.write"), ctrl.deleteItem);

// ── Charge entries ────────────────────────────────────────────
router.post  ("/log",              requireAction("billing.manual-charge"), ctrl.logItems);
router.delete("/entry/:entryId",   requireAction("billing.manual-charge"), ctrl.voidEntry);

// ── Per-admission queries ─────────────────────────────────────
router.get("/:admissionId/today",        ctrl.getTodayCharges);
router.get("/:admissionId/history",      ctrl.getAllCharges);
router.get("/:admissionId/daily-totals", ctrl.getDailyTotals);

module.exports = router;
