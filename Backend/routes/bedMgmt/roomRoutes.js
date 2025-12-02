const express = require("express");
const router = express.Router();
const RoomController = require("../../controllers/bedMgmt/roomController");

router.post("/", RoomController.createRoom);
router.get("/", RoomController.getAllRooms);
router.get("/details/:id", RoomController.getRoomDetails);
router.get("/:id", RoomController.getRoomById);
router.put("/:id", RoomController.updateRoom);
router.delete("/:id", RoomController.deleteRoom);

module.exports = router;
