const express = require("express");
const router = express.Router();
const RoomController = require("../../controllers/bedMgmt/roomController");
const { requireAction } = require("../../middleware/auth");
// R7bn-P1: 400 on a malformed :id (or :categoryId) before findById throws
// CastError -> 500.
const { validateObjectIdParam } = require("../../utils/queryGuards");

// Room master — Admin-only writes.
// R7bb-B/D4-MED-S1: reads now gated on `ipd.read`.
router.get("/",            requireAction("ipd.read"), RoomController.getAllRooms);
router.get("/details/:id", validateObjectIdParam("id"), requireAction("ipd.read"), RoomController.getRoomDetails);
router.get("/:id",         validateObjectIdParam("id"), requireAction("ipd.read"), RoomController.getRoomById);
router.post("/",     requireAction("departments.write"), RoomController.createRoom);
router.put("/:id",   validateObjectIdParam("id"), requireAction("departments.write"), RoomController.updateRoom);
router.delete("/:id",validateObjectIdParam("id"), requireAction("departments.write"), RoomController.deleteRoom);

router.get("/availability/low",  requireAction("ipd.read"), RoomController.getRoomsWithLowAvailability);
router.get("/availability/full", requireAction("ipd.read"), RoomController.getFullyOccupiedRooms);

router.get("/category/:categoryId",           validateObjectIdParam("categoryId"), requireAction("ipd.read"), RoomController.getRoomsByCategory);
router.get("/category/:categoryId/available", validateObjectIdParam("categoryId"), requireAction("ipd.read"), RoomController.getAvailableRoomsByCategory);
router.get("/category/:categoryId/stats",     validateObjectIdParam("categoryId"), requireAction("ipd.read"), RoomController.getRoomStatsByCategory);

// Per-room service config / occupancy override — Admin only.
router.put("/:id/services",  validateObjectIdParam("id"), requireAction("departments.write"), RoomController.updateRoomServices);
router.put("/:id/occupancy", validateObjectIdParam("id"), requireAction("departments.write"), RoomController.updateBedOccupancy);

module.exports = router;
