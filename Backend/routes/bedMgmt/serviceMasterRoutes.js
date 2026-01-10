const express = require("express");
const router = express.Router();
const ServiceMasterController = require("../../controllers/bedMgmt/serviceMasterController");

router.post("/seed", ServiceMasterController.seedDefaultServices);
router.post("/", ServiceMasterController.createService);
router.get("/", ServiceMasterController.getAllServices);
router.get(
  "/category/:category",
  ServiceMasterController.getServicesByCategory
);
router.get("/:id", ServiceMasterController.getServiceById);
router.put("/:id", ServiceMasterController.updateService);
router.delete("/:id", ServiceMasterController.deleteService);

module.exports = router;
