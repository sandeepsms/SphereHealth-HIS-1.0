const BedService = require("../../services/bedMgmt/bedService");
const { predictLOS } = require("../../services/bedMgmt/losPredictionService");

class BedController {
  async createBeds(req, res) {
    try {
      const result = await BedService.createBeds(req.body);
      res.status(201).json({
        success: true,
        message: `${result.created} bed(s) created successfully`,
        data: result,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  async getAllBeds(req, res) {
    try {
      const beds = await BedService.getAllBeds(req.query);
      res.json({
        success: true,
        count: beds.length,
        data: beds,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  async getBedById(req, res) {
    try {
      const bed = await BedService.getBedById(req.params.id);
      res.json({
        success: true,
        data: bed,
      });
    } catch (error) {
      res.status(404).json({
        success: false,
        message: error.message,
      });
    }
  }

  async getBedPricing(req, res) {
    try {
      const pricing = await BedService.getBedPricing(req.params.id);
      res.json({
        success: true,
        data: pricing,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  async bookBed(req, res) {
    try {
      const bed = await BedService.bookBed(req.params.id, req.body);
      res.json({
        success: true,
        message: "Bed booked successfully",
        data: bed,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  async dischargeBed(req, res) {
    try {
      const result = await BedService.dischargeBed(
        req.params.id,
        req.body.dischargeDate
      );
      res.json({
        success: true,
        message: "Bed discharged successfully",
        data: result,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  async estimateCharges(req, res) {
    try {
      const estimate = await BedService.estimateCharges(req.params.id);
      res.json({
        success: true,
        data: estimate,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  async updateBedStatus(req, res) {
    try {
      const bed = await BedService.updateBedStatus(
        req.params.id,
        req.body.status
      );
      res.json({
        success: true,
        message: "Bed status updated successfully",
        data: bed,
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
      res.json({
        success: true,
        message: "Bed updated successfully",
        data: bed,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  async deleteBed(req, res) {
    try {
      const bed = await BedService.deleteBed(req.params.id);
      res.json({
        success: true,
        message: "Bed deleted successfully",
        data: bed,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  async checkRoomCapacity(req, res) {
    try {
      const capacity = await BedService.getRoomBedCapacity(req.params.roomId);
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

  /* ── Housekeeping (NABH IPC.6) ── */
  async updateHousekeeping(req, res) {
    try {
      const bed = await BedService.updateHousekeeping(req.params.id, req.body);
      res.json({ success: true, data: bed });
    } catch (error) {
      res.status(400).json({ success: false, message: error.message });
    }
  }

  async getHousekeepingQueue(req, res) {
    try {
      const beds = await BedService.getHousekeepingQueue();
      res.json({ success: true, count: beds.length, data: beds });
    } catch (error) {
      res.status(400).json({ success: false, message: error.message });
    }
  }

  /* ── Reservation auto-expiry (P2 #10) ── */
  async expireStaleReservations(req, res) {
    try {
      const result = await BedService.expireStaleReservations();
      res.json({ success: true, ...result });
    } catch (error) {
      res.status(400).json({ success: false, message: error.message });
    }
  }

  /* ── Predictive LOS (P2 #11) ──
       Query: ?diagnosis=...&age=...&department=...&isCritical=true
       Returns median days + basis. Rule-based for now; same shape
       when we plug in an ML model later. */
  predictLOS(req, res) {
    try {
      const { diagnosis = "", age = 0, department = "", isCritical } = req.query;
      const result = predictLOS({
        diagnosis,
        age: Number(age),
        department,
        isCritical: isCritical === "true" || isCritical === true,
      });
      res.json({ success: true, data: result });
    } catch (error) {
      res.status(400).json({ success: false, message: error.message });
    }
  }

  async checkWardCapacity(req, res) {
    try {
      const capacity = await BedService.getWardBedCapacity(req.params.wardId);
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

  async getAvailableBeds(req, res) {
    try {
      const beds = await BedService.getAvailableBeds(req.query);
      res.json({
        success: true,
        count: beds.length,
        data: beds,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }
}

module.exports = new BedController();
