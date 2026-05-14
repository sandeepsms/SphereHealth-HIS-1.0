const express = require("express");
const router  = express.Router();
const ctrl    = require("../../controllers/Pharmacy/pharmacyController");

// Drugs
router.get   ("/drugs",          ctrl.listDrugs);
router.get   ("/drugs/search",   ctrl.searchDrugs);
router.post  ("/drugs",          ctrl.createDrug);
router.put   ("/drugs/:id",      ctrl.updateDrug);
router.delete("/drugs/:id",      ctrl.deleteDrug);

// Suppliers
router.get   ("/suppliers",      ctrl.listSuppliers);
router.post  ("/suppliers",      ctrl.createSupplier);
router.put   ("/suppliers/:id",  ctrl.updateSupplier);
router.delete("/suppliers/:id",  ctrl.deleteSupplier);

// GRN + batches + stock
router.post  ("/grn",            ctrl.recordGRN);
router.get   ("/batches",        ctrl.listBatches);
router.get   ("/stock",          ctrl.stockRollup);

// Sales
router.post  ("/sales",          ctrl.dispense);
router.get   ("/sales",          ctrl.listSales);
router.get   ("/sales/:id",      ctrl.getSale);
router.post  ("/sales/:id/cancel", ctrl.cancelSale);

// Dashboard
router.get   ("/stats",          ctrl.stats);
router.get   ("/alerts",         ctrl.alerts);

// Registers (D&C Rules + GST)
router.get   ("/registers/sales",      ctrl.salesRegister);
router.get   ("/registers/purchase",   ctrl.purchaseRegister);
router.get   ("/registers/stock",      ctrl.stockRegister);
router.get   ("/registers/schedule-h", ctrl.scheduleHRegister);
router.get   ("/registers/expiry",     ctrl.expiryRegister);
router.get   ("/registers/gst",        ctrl.gstSummary);

module.exports = router;
