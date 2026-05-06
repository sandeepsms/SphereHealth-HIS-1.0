const express = require("express");
const router  = express.Router();
const ctrl    = require("../../controllers/nursing/nursingChargesController");
const { authenticate, authorize } = require("../../middleware/auth");

// ── Master catalogue (Admin only for write) ───────────────────
router.get   ("/items",            ctrl.getItems);
router.post  ("/items",            authenticate, authorize("Admin"), ctrl.createItem);
router.put   ("/items/:id",        authenticate, authorize("Admin"), ctrl.updateItem);
router.delete("/items/:id",        authenticate, authorize("Admin"), ctrl.deleteItem);

// ── Charge entries ────────────────────────────────────────────
router.post  ("/log",              authenticate, authorize("Nurse","Admin"), ctrl.logItems);
router.delete("/entry/:entryId",   authenticate, authorize("Nurse","Admin"), ctrl.voidEntry);

// ── Per-admission queries ─────────────────────────────────────
router.get("/:admissionId/today",        ctrl.getTodayCharges);
router.get("/:admissionId/history",      ctrl.getAllCharges);
router.get("/:admissionId/daily-totals", ctrl.getDailyTotals);

module.exports = router;
