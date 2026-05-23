// routes/serviceMasterRoutes.js
//
// R7as-FIX-3/D3-crit: every write on the service-master catalogue is
// now behind `departments.write` (Admin only by default) and the seed
// path requires admin. Pre-R7as any authenticated user could POST a new
// service, mutate pricing, or DELETE the catalogue — the financial blast
// radius of "any Pharmacist can wipe the chargeable services table" is
// the highest in the audit.
//
// R7az-A/D9-HIGH: reads moved from `billing.read` (Admin/Accountant/
// Receptionist/TPA Coordinator) to `services.read` so Doctor/Nurse/
// Pharmacist/Lab Tech can pull the catalogue for ServiceAutocomplete
// when attaching an order line. Pre-R7az these roles 403'd on every
// service lookup which broke the order-entry surface.
const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/ServiceMaster/serviceMasterController");
const { requireAction, adminOnly } = require("../../middleware/auth");
// R7bm-F9: 400 on a malformed :id before findById throws CastError -> 500.
const { validateObjectIdParam } = require("../../utils/queryGuards");

// ── Service catalog routes ────────────────────────────────────
router.get("/grouped",        requireAction("services.read"), ctrl.getGrouped); // GET  /api/services/grouped?domain=IPD&applicableTo=IPD
// R7bb-FIX-E-16: price-change requests must be registered BEFORE
// the generic /:id GET so the literal segment doesn't get swallowed.
router.get ("/price-change-requests",          requireAction("departments.write"), ctrl.listPriceChangeRequests);
router.post("/price-change-requests/:id/approve", validateObjectIdParam("id"), requireAction("departments.write"), ctrl.approvePriceChangeRequest);
router.post("/price-change-requests/:id/reject",  validateObjectIdParam("id"), requireAction("departments.write"), ctrl.rejectPriceChangeRequest);
router.get("/",               requireAction("services.read"), ctrl.getAll); // GET  /api/services?category=ROOM&domain=IPD
router.get("/:id/pricing",    validateObjectIdParam("id"), requireAction("services.read"), ctrl.getPricing); // GET  /api/services/:id/pricing
router.get("/:id",            validateObjectIdParam("id"), requireAction("services.read"), ctrl.getById); // GET  /api/services/:id
// Write gates — tariff mutation is admin-only.
router.post("/seed",          adminOnly,                          ctrl.seed); // POST /api/services/seed  ← initial data
router.post("/:id/pricing",   validateObjectIdParam("id"), requireAction("departments.write"), ctrl.setPricing); // POST /api/services/:id/pricing
router.post("/",              requireAction("departments.write"), ctrl.create); // POST /api/services
router.put("/:id",            validateObjectIdParam("id"), requireAction("departments.write"), ctrl.update); // PUT  /api/services/:id
router.delete("/:id",         validateObjectIdParam("id"), requireAction("departments.write"), ctrl.remove); // DELETE /api/services/:id

module.exports = router;
