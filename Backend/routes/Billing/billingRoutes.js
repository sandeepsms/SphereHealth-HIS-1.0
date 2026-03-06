// routes/billingRoutes.js
const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/Billing/billingController");

// ── Static / non-ID routes first ─────────────────────────────
router.get("/summary", ctrl.getSummary); // GET  /api/billing/summary
router.get("/uhid/:UHID", ctrl.getBillsByUHID); // GET  /api/billing/uhid/UH00000001
router.get("/price/:serviceId", ctrl.getServicePrice); // GET  /api/billing/price/:id?tariffType=TPA&tpaId=xxx
router.get("/daycare-check/:admissionId", ctrl.checkDaycare); // GET  /api/billing/daycare-check/:admissionId

// ── Bill CRUD & actions ───────────────────────────────────────
router.get("/:billId", ctrl.getBillById); // GET  /api/billing/:billId
router.post("/create", ctrl.getOrCreateBill); // POST /api/billing/create  {UHID, visitType, admissionId?}
router.post("/:billId/add-service", ctrl.addService); // POST /api/billing/:id/add-service  {serviceId, quantity}
router.post("/:billId/generate", ctrl.generateBill); // POST /api/billing/:id/generate
router.post("/:billId/payment", ctrl.recordPayment); // POST /api/billing/:id/payment  {amount, paymentMode}
router.post("/:billId/tpa-claim", ctrl.setTPAClaimStatus); // POST /api/billing/:id/tpa-claim
router.put("/:billId/items/:itemId", ctrl.updateItemQty); // PUT  /api/billing/:id/items/:itemId  {quantity}
router.delete("/:billId/items/:itemId", ctrl.removeItem); // DELETE /api/billing/:id/items/:itemId

module.exports = router;
