const express = require("express");
const router = express.Router();
const RoomController = require("../../controllers/bedMgmt/roomController");

router.post("/", RoomController.createRoom);
router.get("/", RoomController.getAllRooms);
router.get("/details/:id", RoomController.getRoomDetails);
router.get("/:id", RoomController.getRoomById);
router.put("/:id", RoomController.updateRoom);
router.delete("/:id", RoomController.deleteRoom);

router.get("/availability/low", RoomController.getRoomsWithLowAvailability);
router.get("/availability/full", RoomController.getFullyOccupiedRooms);

router.get("/category/:categoryId", RoomController.getRoomsByCategory);
router.get(
  "/category/:categoryId/available",
  RoomController.getAvailableRoomsByCategory
);
router.get(
  "/category/:categoryId/stats",
  RoomController.getRoomStatsByCategory
);

router.put("/:id/services", RoomController.updateRoomServices);
router.put("/:id/occupancy", RoomController.updateBedOccupancy);

module.exports = router;
