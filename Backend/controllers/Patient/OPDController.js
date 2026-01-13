const opdService = require("../../services/Patient/OPDService");
class OPDController {
  async createOPDVisit(req, res) {
    try {
      const visit = await opdService.createOPDVisit(req.body);
      res.status(201).json({
        success: true,
        message: "OPD visit created successfully",
        data: visit,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  async getAllOPDVisits(req, res) {
    try {
      const { page = 1, limit = 10, ...filters } = req.query;
      const result = await opdService.getAllOPDVisits(
        parseInt(page),
        parseInt(limit),
        filters
      );
      res.status(200).json({
        success: true,
        data: result.visits,
        pagination: result.pagination,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  async getOPDVisitById(req, res) {
    try {
      const visit = await opdService.getOPDVisitById(req.params.visitNumber);
      if (!visit) {
        return res.status(404).json({
          success: false,
          message: "Visit not found",
        });
      }
      res.status(200).json({
        success: true,
        data: visit,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  async getPatientOPDHistory(req, res) {
    try {
      const history = await opdService.getPatientOPDHistory(
        req.params.patientId
      );
      res.status(200).json({
        success: true,
        data: history,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  async updateOPDVisit(req, res) {
    try {
      const visit = await opdService.updateOPDVisit(
        req.params.visitNumber,
        req.body
      );
      if (!visit) {
        return res.status(404).json({
          success: false,
          message: "Visit not found",
        });
      }
      res.status(200).json({
        success: true,
        message: "Visit updated successfully",
        data: visit,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  async deleteOPDVisit(req, res) {
    try {
      const visit = await opdService.deleteOPDVisit(req.params.visitNumber);
      if (!visit) {
        return res.status(404).json({
          success: false,
          message: "Visit not found",
        });
      }
      res.status(200).json({
        success: true,
        message: "Visit deleted successfully",
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  async addInvestigation(req, res) {
    try {
      const visit = await opdService.addInvestigation(
        req.params.visitNumber,
        req.body
      );
      res.status(200).json({
        success: true,
        message: "Investigation added successfully",
        data: visit,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  async updateInvestigationStatus(req, res) {
    try {
      const { investigationId, status } = req.body;
      const visit = await opdService.updateInvestigationStatus(
        req.params.visitNumber,
        investigationId,
        status
      );
      res.status(200).json({
        success: true,
        message: "Investigation status updated",
        data: visit,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  async addPrescription(req, res) {
    try {
      const visit = await opdService.addPrescription(
        req.params.visitNumber,
        req.body
      );
      res.status(200).json({
        success: true,
        message: "Prescription added successfully",
        data: visit,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  async completeVisit(req, res) {
    try {
      const visit = await opdService.completeVisit(
        req.params.visitNumber,
        req.body
      );
      res.status(200).json({
        success: true,
        message: "Visit completed successfully",
        data: visit,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  async getTodayVisits(req, res) {
    try {
      const visits = await opdService.getTodayVisits();
      res.status(200).json({
        success: true,
        data: visits,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  async getFollowUpDue(req, res) {
    try {
      const { date = new Date() } = req.query;
      const visits = await opdService.getFollowUpDue(date);
      res.status(200).json({
        success: true,
        data: visits,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  async getVisitsByDepartment(req, res) {
    try {
      const visits = await opdService.getVisitsByDepartment(
        req.params.department
      );
      res.status(200).json({
        success: true,
        data: visits,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  async getVisitsByDoctor(req, res) {
    try {
      const visits = await opdService.getVisitsByDoctor(
        req.params.consultantName
      );
      res.status(200).json({
        success: true,
        data: visits,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }
}

module.exports = new OPDController();
