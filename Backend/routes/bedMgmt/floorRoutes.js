const express = require("express");
const router = express.Router();
const FloorController = require("../../controllers/bedMgmt/floorController");
const { requireAction } = require("../../middleware/auth");

// Floor master — Admin-only writes.
// R7bb-B/D4-MED-S1: reads now gated on `ipd.read`.
router.get("/",            requireAction("ipd.read"), FloorController.getAllFloors);
router.get("/details/:id", requireAction("ipd.read"), FloorController.getFloorDetails);
router.get("/:id",         requireAction("ipd.read"), FloorController.getFloorById);
router.post("/",     requireAction("departments.write"), FloorController.createFloor);
router.put("/:id",   requireAction("departments.write"), FloorController.updateFloor);
router.delete("/:id",requireAction("departments.write"), FloorController.deleteFloor);

module.exports = router;
