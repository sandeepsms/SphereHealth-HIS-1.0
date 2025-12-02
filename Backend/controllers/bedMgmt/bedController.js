const BedService = require("../../services/bedMgmt/bedService");

class BedController {
  async createBeds(req, res) {
    try {
      const result = await BedService.createBedes(req.body);
      console.error("Controller Error:", req.body);
      res
        .status(201)
        .json({ success: true, message: "Beds created", data: result });
    } catch (err) {
      console.error("Controller Error:", err);
      res.status(400).json({ success: false, message: err.message });
    }
  }

  async getAllBeds(req, res) {
    try {
      const beds = await BedService.getAllBeds(req.query);
      res.json({ success: true, count: beds.length, data: beds });
    } catch (err) {
      res.status(400).json({ success: false, message: err.message });
    }
  }

  async getBedById(req, res) {
    try {
      const bed = await BedService.getBedById(req.params.id);
      res.json({ success: true, data: bed });
    } catch (err) {
      res.status(404).json({ success: false, message: err.message });
    }
  }

  async updateBedStatus(req, res) {
    try {
      const bed = await BedService.updateBedStatus(
        req.params.id,
        req.body.status
      );
      res.json({ success: true, message: "Status updated", data: bed });
    } catch (err) {
      res.status(400).json({ success: false, message: err.message });
    }
  }

  async checkRoomCapacity(req, res) {
    try {
      const { roomId } = req.params;
      const capacity = await BedService.getRoomBedCapacity(roomId);

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

  async checkWardCapacity(req, res) {
    try {
      const { wardId } = req.params;
      const capacity = await BedService.getWardBedCapacity(wardId);

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
  async updateBed(req, res) {
    try {
      const bed = await BedService.updateBed(req.params.id, req.body);
      res.json({ success: true, message: "Bed updated", data: bed });
    } catch (err) {
      res.status(400).json({ success: false, message: err.message });
    }
  }
}

module.exports = new BedController();
