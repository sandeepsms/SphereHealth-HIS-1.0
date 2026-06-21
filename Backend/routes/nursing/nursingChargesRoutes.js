const express = require("express");
const router  = express.Router();
const ctrl    = require("../../controllers/nursing/nursingChargesController");
// R7az-A/D1-CRIT: replace inline `authorize("Admin")` / `authorize("Nurse","Admin")`
// with action-based gates so the catalog mutates only via departments.write
// (Admin) and charge logging follows the same billing.manual-charge tier
// that the rest of the manual-charge surface uses. The global authenticate()
// in routes/index.js makes the per-route `authenticate` redundant.
const { requireAction, requireAnyAction } = require("../../middleware/auth");
// R7bm-F9: 400 on a malformed :id before findById throws CastError -> 500.
const { validateObjectIdParam } = require("../../utils/queryGuards");

// R7bb-B/D4-HIGH-S1: all reads now gated on `billing.read` (Admin /
// Accountant / Receptionist / TPA Coordinator). Pre-R7bb any
// authenticated role could pull the nursing-charges catalogue + every
// patient's running charges total — exposes tariff data + per-admission
// money trail.
// R7hr-166: extend reads to ALSO allow `billing.manual-charge` (Nurse).
// The nurse-side "Equipment Used This Shift" tile on NursingNotes is
// the primary consumer of GET /items — without the catalogue, the tile
// shows "No equipment items configured" even when 32 items are seeded.
// Mutations (POST/PUT/DELETE /items) STAY gated by departments.write
// (Admin only) — only the read paths open up.

// ── Master catalogue ───────────────────────────────────────
router.get   ("/items",            requireAnyAction("billing.read", "billing.manual-charge"), ctrl.getItems);
router.post  ("/items",            requireAction("departments.write"), ctrl.createItem);
router.put   ("/items/:id",        validateObjectIdParam("id"), requireAction("departments.write"), ctrl.updateItem);
router.delete("/items/:id",        validateObjectIdParam("id"), requireAction("departments.write"), ctrl.deleteItem);

// ── Charge entries ────────────────────────────────────────────
router.post  ("/log",              requireAction("billing.manual-charge"), ctrl.logItems);
router.delete("/entry/:entryId",   validateObjectIdParam("entryId"), requireAction("billing.manual-charge"), ctrl.voidEntry);

// ── Per-admission queries (nurse needs /today for dedup display) ──
router.get("/:admissionId/today",        validateObjectIdParam("admissionId"), requireAnyAction("billing.read", "billing.manual-charge"), ctrl.getTodayCharges);
router.get("/:admissionId/history",      validateObjectIdParam("admissionId"), requireAction("billing.read"), ctrl.getAllCharges);
router.get("/:admissionId/daily-totals", validateObjectIdParam("admissionId"), requireAction("billing.read"), ctrl.getDailyTotals);

module.exports = router;
