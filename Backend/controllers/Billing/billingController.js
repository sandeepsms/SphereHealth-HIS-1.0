const billingService = require("../../services/Billing/BillingService");

class BillingController {
  async createBill(req, res) {
    try {
      const bill = await billingService.createBill(req.body);
      res.status(201).json({
        success: true,
        message: "Bill created successfully",
        data: bill,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  async getAllBills(req, res) {
    try {
      const { page = 1, limit = 10, ...filters } = req.query;
      const result = await billingService.getAllBills(
        parseInt(page),
        parseInt(limit),
        filters
      );
      res.status(200).json({
        success: true,
        data: result.bills,
        pagination: result.pagination,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  async getBillById(req, res) {
    try {
      const bill = await billingService.getBillById(req.params.id);
      res.status(200).json({
        success: true,
        data: bill,
      });
    } catch (error) {
      res.status(404).json({
        success: false,
        message: error.message,
      });
    }
  }

  async getBillByNumber(req, res) {
    try {
      const bill = await billingService.getBillByNumber(req.params.billNumber);
      res.status(200).json({
        success: true,
        data: bill,
      });
    } catch (error) {
      res.status(404).json({
        success: false,
        message: error.message,
      });
    }
  }

  async getBillByAdmission(req, res) {
    try {
      const bill = await billingService.getBillByAdmission(
        req.params.admissionId
      );
      if (!bill) {
        return res.status(404).json({
          success: false,
          message: "Bill not found for this admission",
        });
      }
      res.status(200).json({
        success: true,
        data: bill,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  async updateBill(req, res) {
    try {
      const bill = await billingService.updateBill(req.params.id, req.body);
      res.status(200).json({
        success: true,
        message: "Bill updated successfully",
        data: bill,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  async addService(req, res) {
    try {
      const bill = await billingService.addService(req.params.id, req.body);
      res.status(200).json({
        success: true,
        message: "Service added successfully",
        data: bill,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  async addInvestigation(req, res) {
    try {
      const bill = await billingService.addInvestigation(
        req.params.id,
        req.body
      );
      res.status(200).json({
        success: true,
        message: "Investigation added successfully",
        data: bill,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  async addMedication(req, res) {
    try {
      const bill = await billingService.addMedication(req.params.id, req.body);
      res.status(200).json({
        success: true,
        message: "Medication added successfully",
        data: bill,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  async addProcedure(req, res) {
    try {
      const bill = await billingService.addProcedure(req.params.id, req.body);
      res.status(200).json({
        success: true,
        message: "Procedure added successfully",
        data: bill,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  async applyDiscount(req, res) {
    try {
      const { discountAmount } = req.body;
      const bill = await billingService.applyDiscount(
        req.params.id,
        discountAmount
      );
      res.status(200).json({
        success: true,
        message: "Discount applied successfully",
        data: bill,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  async addPayment(req, res) {
    try {
      const bill = await billingService.addPayment(req.params.id, req.body);
      res.status(200).json({
        success: true,
        message: "Payment added successfully",
        data: bill,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  async cancelBill(req, res) {
    try {
      const bill = await billingService.cancelBill(req.params.id);
      res.status(200).json({
        success: true,
        message: "Bill cancelled successfully",
        data: bill,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  async getPendingBills(req, res) {
    try {
      const bills = await billingService.getPendingBills();
      res.status(200).json({
        success: true,
        data: bills,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  async getPaidBills(req, res) {
    try {
      const bills = await billingService.getPaidBills();
      res.status(200).json({
        success: true,
        data: bills,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  async getPatientBills(req, res) {
    try {
      const bills = await billingService.getPatientBills(req.params.patientId);
      res.status(200).json({
        success: true,
        data: bills,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  async getBillSummary(req, res) {
    try {
      const summary = await billingService.getBillSummary(req.params.id);
      res.status(200).json({
        success: true,
        data: summary,
      });
    } catch (error) {
      res.status(404).json({
        success: false,
        message: error.message,
      });
    }
  }

  async getRevenue(req, res) {
    try {
      const { startDate, endDate } = req.query;
      if (!startDate || !endDate) {
        return res.status(400).json({
          success: false,
          message: "Start date and end date are required",
        });
      }
      const revenue = await billingService.getRevenue(startDate, endDate);
      res.status(200).json({
        success: true,
        data: revenue,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  async deleteBill(req, res) {
    try {
      const bill = await billingService.deleteBill(req.params.id);
      res.status(200).json({
        success: true,
        message: "Bill deleted successfully",
        data: bill,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }
}

module.exports = new BillingController();
