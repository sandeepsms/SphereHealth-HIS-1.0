const AdmissionService = require("../../services/Patient/admissionService");

class AdmissionController {
  async createAdmission(req, res) {
    try {
      const admission = await AdmissionService.createAdmission(req.body);
      res.status(201).json({
        success: true,
        message: "Admission created successfully",
        data: admission,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  async getAllAdmissions(req, res) {
    try {
      const result = await AdmissionService.getAllAdmissions(req.query);
      res.json({
        success: true,
        ...result,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  async getAdmissionById(req, res) {
    try {
      const admission = await AdmissionService.getAdmissionById(req.params.id);
      res.json({
        success: true,
        data: admission,
      });
    } catch (error) {
      res.status(404).json({
        success: false,
        message: error.message,
      });
    }
  }

  async getActiveAdmissions(req, res) {
    try {
      const admissions = await AdmissionService.getActiveAdmissions(req.query);
      res.json({
        success: true,
        data: admissions,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  async getTodayAdmissions(req, res) {
    try {
      const admissions = await AdmissionService.getTodayAdmissions();
      res.json({
        success: true,
        data: admissions,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  async updateAdmission(req, res) {
    try {
      const admission = await AdmissionService.updateAdmission(
        req.params.id,
        req.body
      );
      res.json({
        success: true,
        message: "Admission updated successfully",
        data: admission,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  async transferBed(req, res) {
    try {
      const { newBedId, reason } = req.body;
      const admission = await AdmissionService.transferBed(
        req.params.id,
        newBedId,
        reason
      );
      res.json({
        success: true,
        message: "Bed transferred successfully",
        data: admission,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  async dischargePatient(req, res) {
    try {
      const admission = await AdmissionService.dischargePatient(
        req.params.id,
        req.body
      );
      res.json({
        success: true,
        message: "Patient discharged successfully",
        data: admission,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  async cancelAdmission(req, res) {
    try {
      const { reason } = req.body;
      const admission = await AdmissionService.cancelAdmission(
        req.params.id,
        reason
      );
      res.json({
        success: true,
        message: "Admission cancelled successfully",
        data: admission,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  async getAdmissionStatistics(req, res) {
    try {
      const { startDate, endDate } = req.query;
      const stats = await AdmissionService.getAdmissionStatistics(
        startDate,
        endDate
      );
      res.json({
        success: true,
        data: stats,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  async getPatientAdmissionHistory(req, res) {
    try {
      const admissions = await AdmissionService.getPatientAdmissionHistory(
        req.params.patientId
      );
      res.json({
        success: true,
        data: admissions,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  async searchAdmissions(req, res) {
    try {
      const { q } = req.query;
      if (!q) {
        return res.status(400).json({
          success: false,
          message: "Search term is required",
        });
      }

      const admissions = await AdmissionService.searchAdmissions(q);
      res.json({
        success: true,
        data: admissions,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  async deleteAdmission(req, res) {
    try {
      const result = await AdmissionService.deleteAdmission(req.params.id);
      res.json({
        success: true,
        ...result,
      });
    } catch (error) {
      res.status(404).json({
        success: false,
        message: error.message,
      });
    }
  }
}

module.exports = new AdmissionController();
