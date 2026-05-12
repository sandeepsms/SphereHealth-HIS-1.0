const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/Investigation/investigationOrderController");
const { attemptAuth } = require("../../middleware/auth");

// Soft-auth so lab/radiology results carry the technician's user record.
router.use(attemptAuth);

router.get("/summary", ctrl.getSummary);
router.get("/patient/:UHID", ctrl.getByUHID);
router.get("/", ctrl.getAll);
router.post("/", ctrl.create);
router.get("/:id", ctrl.getById);
router.post("/:id/collect-sample", ctrl.collectSample);
router.post("/:id/enter-results", ctrl.enterResults);
router.post("/:id/enter-external-result", ctrl.enterExternalResult);
router.post("/:id/verify", ctrl.verify);
router.post("/:id/print", ctrl.markPrinted);
router.post("/:id/cancel", ctrl.cancel);
router.post("/:id/add-test", ctrl.addTest);

module.exports = router;
