const express = require("express");
const router = express.Router();
const BedController = require("../../controllers/bedMgmt/bedController");

router.post("/", BedController.createBeds);
router.get("/", BedController.getAllBeds);
router.get("/:id", BedController.getBedById);
router.put("/:id/status", BedController.updateBedStatus);
router.put("/:id", BedController.updateBed);
router.get("/capacity/room/:roomId", BedController.checkRoomCapacity);
router.get("/capacity/ward/:wardId", BedController.checkWardCapacity);
module.exports = router;
