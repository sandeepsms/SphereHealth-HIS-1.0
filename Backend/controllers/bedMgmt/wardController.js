const WardService = require("../../services/bedMgmt/wardService");

class WardController {
  async createWard(req, res) {
    try {
      const ward = await WardService.createWard(req.body);
      res.status(201).json({
        success: true,
        message: "Ward created successfully",
        data: ward,
      });
    } catch (error) {
      res.status(400).json({ success: false, message: error.message });
    }
  }

  async getAllWards(req, res) {
    try {
      const wards = await WardService.getAllWards(req.query);
      res.json({
        success: true,
        count: wards.length,
        data: wards,
      });
    } catch (error) {
      res.status(400).json({ success: false, message: error.message });
    }
  }

  async getWardById(req, res) {
    try {
      const ward = await WardService.getWardById(req.params.id);
      res.json({ success: true, data: ward });
    } catch (error) {
      res.status(404).json({ success: false, message: error.message });
    }
  }

  async getWardDetails(req, res) {
    try {
      const details = await WardService.getWardDetails(req.params.id);
      res.json({ success: true, data: details });
    } catch (error) {
      res.status(404).json({ success: false, message: error.message });
    }
  }

  async updateWard(req, res) {
    try {
      const ward = await WardService.updateWard(req.params.id, req.body);
      res.json({
        success: true,
        message: "Ward updated successfully",
        data: ward,
      });
    } catch (error) {
      res.status(400).json({ success: false, message: error.message });
    }
  }

  async deleteWard(req, res) {
    try {
      await WardService.deleteWard(req.params.id);
      res.json({ success: true, message: "Ward deleted successfully" });
    } catch (error) {
      res.status(404).json({ success: false, message: error.message });
    }
  }
}

module.exports = new WardController();
