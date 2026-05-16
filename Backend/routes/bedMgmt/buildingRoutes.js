const express = require("express");
const router = express.Router();
const BuildingController = require("../../controllers/bedMgmt/buildingController");
const { requireAction } = require("../../middleware/auth");

// Building master — Admin only.
router.get("/",            BuildingController.getAllBuildings);
router.get("/details/:id", BuildingController.getBuildingDetails);
router.get("/:id",         BuildingController.getBuildingById);
router.post("/",     requireAction("departments.write"), BuildingController.createBuilding);
router.put("/:id",   requireAction("departments.write"), BuildingController.updateBuilding);
router.delete("/:id",requireAction("departments.write"), BuildingController.deleteBuilding);

module.exports = router;
