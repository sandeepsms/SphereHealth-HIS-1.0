const RoomService = require("../../services/bedMgmt/roomService");

class RoomController {
  async createRoom(req, res) {
    try {
      const room = await RoomService.createRoom(req.body);
      res.status(201).json({
        success: true,
        message: "Room created successfully",
        data: room,
      });
    } catch (error) {
      res.status(400).json({ success: false, message: error.message });
    }
  }

  async getAllRooms(req, res) {
    try {
      const rooms = await RoomService.getAllRooms(req.query);
      res.json({
        success: true,
        count: rooms.length,
        data: rooms,
      });
    } catch (error) {
      res.status(400).json({ success: false, message: error.message });
    }
  }

  async getRoomById(req, res) {
    try {
      const room = await RoomService.getRoomById(req.params.id);
      res.json({ success: true, data: room });
    } catch (error) {
      res.status(404).json({ success: false, message: error.message });
    }
  }

  async getRoomDetails(req, res) {
    try {
      const details = await RoomService.getRoomDetails(req.params.id);
      res.json({ success: true, data: details });
    } catch (error) {
      res.status(404).json({ success: false, message: error.message });
    }
  }

  async updateRoom(req, res) {
    try {
      const room = await RoomService.updateRoom(req.params.id, req.body);
      res.json({
        success: true,
        message: "Room updated successfully",
        data: room,
      });
    } catch (error) {
      res.status(400).json({ success: false, message: error.message });
    }
  }

  async deleteRoom(req, res) {
    try {
      await RoomService.deleteRoom(req.params.id);
      res.json({ success: true, message: "Room deleted successfully" });
    } catch (error) {
      res.status(404).json({ success: false, message: error.message });
    }
  }
}

module.exports = new RoomController();
