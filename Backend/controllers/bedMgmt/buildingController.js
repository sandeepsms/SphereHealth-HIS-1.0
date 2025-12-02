const BuildingService = require("../../services/bedMgmt/buildingService");

class BuildingController {
  async createBuilding(req, res) {
    try {
      const building = await BuildingService.createBuilding(req.body);
      res.status(201).json({
        success: true,
        message: "Building created successfully",
        data: building,
      });
    } catch (error) {
      res.status(400).json({ success: false, message: error.message });
    }
  }

  async getAllBuildings(req, res) {
    try {
      const buildings = await BuildingService.getAllBuildings(req.query);
      res.json({
        success: true,
        count: buildings.length,
        data: buildings,
      });
    } catch (error) {
      res.status(400).json({ success: false, message: error.message });
    }
  }

  async getBuildingById(req, res) {
    try {
      const building = await BuildingService.getBuildingById(req.params.id);
      res.json({ success: true, data: building });
    } catch (error) {
      res.status(404).json({ success: false, message: error.message });
    }
  }

  async getBuildingDetails(req, res) {
    try {
      const details = await BuildingService.getBuildingDetails(req.params.id);
      res.json({ success: true, data: details });
    } catch (error) {
      res.status(404).json({ success: false, message: error.message });
    }
  }

  async updateBuilding(req, res) {
    try {
      const building = await BuildingService.updateBuilding(
        req.params.id,
        req.body
      );
      res.json({
        success: true,
        message: "Building updated successfully",
        data: building,
      });
    } catch (error) {
      res.status(400).json({ success: false, message: error.message });
    }
  }

  async checkBuildingCapaciTY(rq, res) {
    try {
      const { buildingId } = req.params;
      const capacity = await FloorService.getBuildingFloorCapacity(buildingId);

      res.json({
        success: true,
        data: capacity,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }
  async deleteBuilding(req, res) {
    try {
      await BuildingService.deleteBuilding(req.params.id);
      res.json({ success: true, message: "Building deleted successfully" });
    } catch (error) {
      res.status(404).json({ success: false, message: error.message });
    }
  }
}

module.exports = new BuildingController();
