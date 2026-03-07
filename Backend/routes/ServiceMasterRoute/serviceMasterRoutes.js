// routes/serviceMasterRoutes.js
const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/ServiceMaster/serviceMasterController");

// ── Service catalog routes ────────────────────────────────────
router.get("/grouped", ctrl.getGrouped); // GET  /api/services/grouped?domain=IPD&applicableTo=IPD
router.get("/", ctrl.getAll); // GET  /api/services?category=ROOM&domain=IPD
router.get("/:id/pricing", ctrl.getPricing); // GET  /api/services/:id/pricing
router.get("/:id", ctrl.getById); // GET  /api/services/:id
router.post("/seed", ctrl.seed); // POST /api/services/seed  ← run once for initial data
router.post("/:id/pricing", ctrl.setPricing); // POST /api/services/:id/pricing
router.post("/", ctrl.create); // POST /api/services
router.put("/:id", ctrl.update); // PUT  /api/services/:id
router.delete("/:id", ctrl.remove); // DELETE /api/services/:id

module.exports = router;
