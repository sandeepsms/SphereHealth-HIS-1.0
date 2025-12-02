const express = require("express");
const router = express.Router();
const BuildingController = require("../../controllers/bedMgmt/buildingController");

router.post("/", BuildingController.createBuilding);
router.get("/", BuildingController.getAllBuildings);
router.get("/details/:id", BuildingController.getBuildingDetails);
router.get("/:id", BuildingController.getBuildingById);
router.put("/:id", BuildingController.updateBuilding);
router.delete("/:id", BuildingController.deleteBuilding);

module.exports = router;
