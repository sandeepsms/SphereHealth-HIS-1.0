const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/Investigation/investigationMasterController");

router.get("/grouped", ctrl.getGrouped);
router.post("/seed", ctrl.seed);
router.get("/", ctrl.getAll);
router.post("/", ctrl.create);
router.get("/:id", ctrl.getById);
router.put("/:id", ctrl.update);
router.delete("/:id", ctrl.remove);
router.get("/:id/pricing", ctrl.getPricing);
router.post("/:id/pricing", ctrl.setPricing);
router.get("/:id/effective-price", ctrl.getEffectivePrice);

module.exports = router;
