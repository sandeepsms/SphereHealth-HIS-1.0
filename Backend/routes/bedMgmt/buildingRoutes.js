const express = require("express");
const router = express.Router();
const BuildingController = require("../../controllers/bedMgmt/buildingController");
const { requireAction } = require("../../middleware/auth");

// Building master — Admin-only writes; reads are part of the bed-map
// drill-down.
// R7bb-B/D4-MED-S1: reads now gated on `ipd.read` (Admin / Doctor /
// Nurse / Receptionist). Pre-R7bb any authenticated role could pull the
// building / floor / ward topology + occupancy KPIs.
router.get("/",            requireAction("ipd.read"), BuildingController.getAllBuildings);
router.get("/details/:id", requireAction("ipd.read"), BuildingController.getBuildingDetails);
router.get("/:id",         requireAction("ipd.read"), BuildingController.getBuildingById);
router.post("/",     requireAction("departments.write"), BuildingController.createBuilding);
router.put("/:id",   requireAction("departments.write"), BuildingController.updateBuilding);
router.delete("/:id",requireAction("departments.write"), BuildingController.deleteBuilding);

module.exports = router;
