const express = require("express");
const router = express.Router();
const FloorController = require("../../controllers/bedMgmt/floorController");

router.post("/", FloorController.createFloor);
router.get("/", FloorController.getAllFloors);
router.get("/details/:id", FloorController.getFloorDetails);
router.get("/:id", FloorController.getFloorById);
router.put("/:id", FloorController.updateFloor);
router.delete("/:id", FloorController.deleteFloor);

module.exports = router;
