// routes/investigationOrderRoutes.js
const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/Investigation/investigationOrderController");

// Static routes first
router.get("/summary", ctrl.getSummary); // GET  /api/investigation-orders/summary
router.get("/patient/:UHID", ctrl.getByUHID); // GET  /api/investigation-orders/patient/UH001

// CRUD
router.get("/", ctrl.getAll); // GET  /api/investigation-orders
router.post("/", ctrl.create); // POST /api/investigation-orders

// Single order
router.get("/:id", ctrl.getById); // GET  /api/investigation-orders/:id

// Workflow actions
router.post("/:id/collect-sample", ctrl.collectSample); // POST — sample collect
router.post("/:id/receive-at-lab", ctrl.receiveAtLab); // POST — sample lab mein aaya
router.post("/:id/enter-results", ctrl.enterResults); // POST — results enter karo
router.post("/:id/verify", ctrl.verify); // POST — verify by senior
router.post("/:id/print", ctrl.markPrinted); // POST — report printed
router.post("/:id/cancel", ctrl.cancel); // POST — cancel order
router.post("/:id/add-test", ctrl.addTest); // POST — test add karo

module.exports = router;
