const express = require("express");
const router = express.Router();
const RoomController = require("../../controllers/bedMgmt/roomController");
const { requireAction } = require("../../middleware/auth");

// Room master — Admin only for create/update/delete.
router.get("/",            RoomController.getAllRooms);
router.get("/details/:id", RoomController.getRoomDetails);
router.get("/:id",         RoomController.getRoomById);
router.post("/",     requireAction("departments.write"), RoomController.createRoom);
router.put("/:id",   requireAction("departments.write"), RoomController.updateRoom);
router.delete("/:id",requireAction("departments.write"), RoomController.deleteRoom);

router.get("/availability/low", RoomController.getRoomsWithLowAvailability);
router.get("/availability/full", RoomController.getFullyOccupiedRooms);

router.get("/category/:categoryId", RoomController.getRoomsByCategory);
router.get("/category/:categoryId/available", RoomController.getAvailableRoomsByCategory);
router.get("/category/:categoryId/stats",     RoomController.getRoomStatsByCategory);

// Per-room service config / occupancy override — Admin only.
router.put("/:id/services",  requireAction("departments.write"), RoomController.updateRoomServices);
router.put("/:id/occupancy", requireAction("departments.write"), RoomController.updateBedOccupancy);

module.exports = router;
