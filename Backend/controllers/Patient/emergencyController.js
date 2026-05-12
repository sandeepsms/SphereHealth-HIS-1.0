const emergencyService = require("../../services/Patient/emergencyService");

/* ── Role-scope helper ───────────────────────────────────────────
   Restrict ER list output to the logged-in doctor's own cases. ER records
   carry `attendingDoctorId` (ObjectId) and `consultantIncharge` (name) —
   match either so legacy rows without the ObjectId still resolve.        */
function scopeERByDoctor(req, list) {
  if (!(req.user?.role === "Doctor" && req.doctorProfile?._id)) return list;
  const docId   = String(req.doctorProfile._id);
  const docName = req.doctorProfile.personalInfo?.fullName || "";
  return list.filter(e =>
    String(e.attendingDoctorId || "") === docId ||
    (docName && e.consultantIncharge && e.consultantIncharge.includes(docName))
  );
}

class EmergencyController {
  async createEmergencyVisit(req, res) {
    try {
      const visit = await emergencyService.createEmergencyVisit(req.body);

      // ── Auto-billing: fire ER triage charge ──
      try {
        const autoBilling = require("../../services/Billing/autoBillingService");
        const Admission   = require("../../models/Patient/admissionModel");
        const admission =
          (visit.UHID && (await Admission.findOne({ UHID: visit.UHID, admissionType: "Emergency" }).sort({ createdAt: -1 })))
          || { _id: visit._id, UHID: visit.UHID, patientId: visit.patientId, department: null };
        autoBilling.onEmergencyVisitCreated(visit, admission).catch((e) =>
          console.error("ER auto-billing error:", e.message)
        );
      } catch (e) { /* don't block visit creation */ }

      res.status(201).json({
        success: true,
        message: "Emergency visit created successfully",
        data: visit,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  async getAllEmergencyVisits(req, res) {
    try {
      const { page = 1, limit = 10, ...filters } = req.query;
      const result = await emergencyService.getAllEmergencyVisits(
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

  async getEmergencyVisitById(req, res) {
    try {
      const visit = await emergencyService.getEmergencyVisitById(
        req.params.emergencyNumber
      );
      if (!visit) {
        return res.status(404).json({
          success: false,
          message: "Emergency visit not found",
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

  async getPatientEmergencyHistory(req, res) {
    try {
      const history = await emergencyService.getPatientEmergencyHistory(
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

  async updateEmergencyVisit(req, res) {
    try {
      const visit = await emergencyService.updateEmergencyVisit(
        req.params.emergencyNumber,
        req.body
      );
      if (!visit) {
        return res.status(404).json({
          success: false,
          message: "Emergency visit not found",
        });
      }
      res.status(200).json({
        success: true,
        message: "Emergency visit updated successfully",
        data: visit,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  async deleteEmergencyVisit(req, res) {
    try {
      const visit = await emergencyService.deleteEmergencyVisit(
        req.params.emergencyNumber
      );
      if (!visit) {
        return res.status(404).json({
          success: false,
          message: "Emergency visit not found",
        });
      }
      res.status(200).json({
        success: true,
        message: "Emergency visit deleted successfully",
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
      const visit = await emergencyService.addInvestigation(
        req.params.emergencyNumber,
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
      const { investigationId, status, result } = req.body;
      const visit = await emergencyService.updateInvestigationStatus(
        req.params.emergencyNumber,
        investigationId,
        status,
        result
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

  async addMedication(req, res) {
    try {
      const visit = await emergencyService.addMedication(
        req.params.emergencyNumber,
        req.body
      );
      res.status(200).json({
        success: true,
        message: "Medication added successfully",
        data: visit,
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
      const visit = await emergencyService.addProcedure(
        req.params.emergencyNumber,
        req.body
      );
      res.status(200).json({
        success: true,
        message: "Procedure added successfully",
        data: visit,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  async addNursingNote(req, res) {
    try {
      const { note, recordedBy } = req.body;
      const visit = await emergencyService.addNursingNote(
        req.params.emergencyNumber,
        note,
        recordedBy
      );
      res.status(200).json({
        success: true,
        message: "Nursing note added successfully",
        data: visit,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  async updateDisposition(req, res) {
    try {
      const visit = await emergencyService.updateDisposition(
        req.params.emergencyNumber,
        req.body
      );
      res.status(200).json({
        success: true,
        message: "Disposition updated successfully",
        data: visit,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  async getActiveEmergencies(req, res) {
    try {
      const all = await emergencyService.getActiveEmergencies();
      res.status(200).json({ success: true, data: scopeERByDoctor(req, all) });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async getEmergenciesByTriage(req, res) {
    try {
      const all = await emergencyService.getEmergenciesByTriage(req.params.triageCategory);
      res.status(200).json({ success: true, data: scopeERByDoctor(req, all) });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async getTodayEmergencies(req, res) {
    try {
      const all = await emergencyService.getTodayEmergencies();
      res.status(200).json({ success: true, data: scopeERByDoctor(req, all) });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async getMLCCases(req, res) {
    try {
      const cases = await emergencyService.getMLCCases();
      res.status(200).json({
        success: true,
        data: scopeERByDoctor(req, cases),
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  async updateTriageCategory(req, res) {
    try {
      const { triageCategory } = req.body;
      const visit = await emergencyService.updateTriageCategory(
        req.params.emergencyNumber,
        triageCategory
      );
      res.status(200).json({
        success: true,
        message: "Triage category updated successfully",
        data: visit,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }
}

module.exports = new EmergencyController();
