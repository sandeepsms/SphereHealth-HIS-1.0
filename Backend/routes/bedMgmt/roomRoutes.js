const express = require("express");
const router = express.Router();
const RoomController = require("../../controllers/bedMgmt/roomController");
const { requireAction } = require("../../middleware/auth");

// Room master — Admin-only writes.
// R7bb-B/D4-MED-S1: reads now gated on `ipd.read`.
router.get("/",            requireAction("ipd.read"), RoomController.getAllRooms);
router.get("/details/:id", requireAction("ipd.read"), RoomController.getRoomDetails);
router.get("/:id",         requireAction("ipd.read"), RoomController.getRoomById);
router.post("/",     requireAction("departments.write"), RoomController.createRoom);
router.put("/:id",   requireAction("departments.write"), RoomController.updateRoom);
router.delete("/:id",requireAction("departments.write"), RoomController.deleteRoom);

router.get("/availability/low",  requireAction("ipd.read"), RoomController.getRoomsWithLowAvailability);
router.get("/availability/full", requireAction("ipd.read"), RoomController.getFullyOccupiedRooms);

router.get("/category/:categoryId",           requireAction("ipd.read"), RoomController.getRoomsByCategory);
router.get("/category/:categoryId/available", requireAction("ipd.read"), RoomController.getAvailableRoomsByCategory);
router.get("/category/:categoryId/stats",     requireAction("ipd.read"), RoomController.getRoomStatsByCategory);

// Per-room service config / occupancy override — Admin only.
router.put("/:id/services",  requireAction("departments.write"), RoomController.updateRoomServices);
router.put("/:id/occupancy", requireAction("departments.write"), RoomController.updateBedOccupancy);

module.exports = router;
