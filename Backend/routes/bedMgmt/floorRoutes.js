const express = require("express");
const router = express.Router();
const FloorController = require("../../controllers/bedMgmt/floorController");
const { requireAction } = require("../../middleware/auth");

// Floor master — Admin only.
router.get("/",            FloorController.getAllFloors);
router.get("/details/:id", FloorController.getFloorDetails);
router.get("/:id",         FloorController.getFloorById);
router.post("/",     requireAction("departments.write"), FloorController.createFloor);
router.put("/:id",   requireAction("departments.write"), FloorController.updateFloor);
router.delete("/:id",requireAction("departments.write"), FloorController.deleteFloor);

module.exports = router;
