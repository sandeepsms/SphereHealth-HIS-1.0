// routes/serviceMasterRoutes.js
//
// R7as-FIX-3/D3-crit: every write on the service-master catalogue is
// now behind `departments.write` (Admin only by default) and the seed
// path requires admin. Pre-R7as any authenticated user could POST a new
// service, mutate pricing, or DELETE the catalogue — the financial blast
// radius of "any Pharmacist can wipe the chargeable services table" is
// the highest in the audit. Reads remain `billing.read` so cashiers /
// accountants can still see the catalogue.
const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/ServiceMaster/serviceMasterController");
const { requireAction, adminOnly } = require("../../middleware/auth");

// ── Service catalog routes ────────────────────────────────────
router.get("/grouped",        requireAction("billing.read"), ctrl.getGrouped); // GET  /api/services/grouped?domain=IPD&applicableTo=IPD
router.get("/",               requireAction("billing.read"), ctrl.getAll); // GET  /api/services?category=ROOM&domain=IPD
router.get("/:id/pricing",    requireAction("billing.read"), ctrl.getPricing); // GET  /api/services/:id/pricing
router.get("/:id",            requireAction("billing.read"), ctrl.getById); // GET  /api/services/:id
// Write gates — tariff mutation is admin-only.
router.post("/seed",          adminOnly,                          ctrl.seed); // POST /api/services/seed  ← initial data
router.post("/:id/pricing",   requireAction("departments.write"), ctrl.setPricing); // POST /api/services/:id/pricing
router.post("/",              requireAction("departments.write"), ctrl.create); // POST /api/services
router.put("/:id",            requireAction("departments.write"), ctrl.update); // PUT  /api/services/:id
router.delete("/:id",         requireAction("departments.write"), ctrl.remove); // DELETE /api/services/:id

module.exports = router;
