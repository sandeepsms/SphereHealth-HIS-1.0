// routes/investigationRoutes.js
const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/Investigation/investigationMasterController");

// ── Static routes first ───────────────────────────────────────
router.get("/grouped", ctrl.getGrouped); // GET  /api/investigations/grouped
router.post("/seed", ctrl.seed); // POST /api/investigations/seed

// ── Collection ────────────────────────────────────────────────
router.get("/", ctrl.getAll); // GET  /api/investigations
router.post("/", ctrl.create); // POST /api/investigations

// ── Single item ───────────────────────────────────────────────
router.get("/:id", ctrl.getById); // GET  /api/investigations/:id
router.put("/:id", ctrl.update); // PUT  /api/investigations/:id
router.delete("/:id", ctrl.remove); // DELETE /api/investigations/:id

// ── Pricing ───────────────────────────────────────────────────
router.get("/:id/pricing", ctrl.getPricing); // GET  /api/investigations/:id/pricing
router.post("/:id/pricing", ctrl.setPricing); // POST /api/investigations/:id/pricing

// ── Effective price ───────────────────────────────────────────
router.get("/:id/effective-price", ctrl.getEffectivePrice); // GET  /api/investigations/:id/effective-price?tariffType=TPA&tpaId=xxx&UHID=UH001

// ── Doctor override ───────────────────────────────────────────

module.exports = router;
