const FloorService = require("../../services/bedMgmt/floorService");

class FloorController {
  async createFloor(req, res) {
    try {
      const floor = await FloorService.createFloor(req.body);
      res.status(201).json({
        success: true,
        message: "Floor created successfully",
        data: floor,
      });
    } catch (error) {
      res.status(400).json({ success: false, message: error.message });
    }
  }

  async getAllFloors(req, res) {
    try {
      const floors = await FloorService.getAllFloors(req.query);
      res.json({
        success: true,
        count: floors.length,
        data: floors,
      });
    } catch (error) {
      res.status(400).json({ success: false, message: error.message });
    }
  }

  async getFloorById(req, res) {
    try {
      const floor = await FloorService.getFloorById(req.params.id);
      res.json({ success: true, data: floor });
    } catch (error) {
      res.status(404).json({ success: false, message: error.message });
    }
  }

  async getFloorDetails(req, res) {
    try {
      const details = await FloorService.getFloorDetails(req.params.id);
      res.json({ success: true, data: details });
    } catch (error) {
      res.status(404).json({ success: false, message: error.message });
    }
  }

  async updateFloor(req, res) {
    try {
      const floor = await FloorService.updateFloor(req.params.id, req.body);
      res.json({
        success: true,
        message: "Floor updated successfully",
        data: floor,
      });
    } catch (error) {
      res.status(400).json({ success: false, message: error.message });
    }
  }

  async deleteFloor(req, res) {
    try {
      await FloorService.deleteFloor(req.params.id);
      res.json({ success: true, message: "Floor deleted successfully" });
    } catch (error) {
      res.status(404).json({ success: false, message: error.message });
    }
  }
}

module.exports = new FloorController();
