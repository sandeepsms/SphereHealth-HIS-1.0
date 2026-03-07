const AdmissionService = require("../../services/Patient/admissionService");

const handle = (fn) => async (req, res) => {
  try {
    const result = await fn(req, res);
    return result;
  } catch (err) {
    const status = err.message?.includes("not found") ? 404 : 400;
    return res.status(status).json({ success: false, message: err.message });
  }
};

class AdmissionController {
  createAdmission = handle(async (req, res) => {
    const admission = await AdmissionService.createAdmission(req.body);
    return res.status(201).json({
      success: true,
      message: "Patient admitted successfully",
      data: admission,
    });
  });

  getAllAdmissions = handle(async (req, res) => {
    const result = await AdmissionService.getAllAdmissions(req.query);
    return res.json({ success: true, ...result });
  });

  getAdmissionById = handle(async (req, res) => {
    const admission = await AdmissionService.getAdmissionById(req.params.id);
    return res.json({ success: true, data: admission });
  });

  getActiveAdmissions = handle(async (req, res) => {
    const admissions = await AdmissionService.getActiveAdmissions(req.query);
    return res.json({ success: true, data: admissions });
  });

  getTodayAdmissions = handle(async (req, res) => {
    const admissions = await AdmissionService.getTodayAdmissions();
    return res.json({ success: true, data: admissions });
  });

  getTodayDischarges = handle(async (req, res) => {
    const admissions = await AdmissionService.getTodayDischarges();
    return res.json({ success: true, data: admissions });
  });

  getExpectedDischarges = handle(async (req, res) => {
    const { date } = req.query;
    const admissions = await AdmissionService.getExpectedDischarges(date);
    return res.json({ success: true, data: admissions });
  });

  getAdmissionStatistics = handle(async (req, res) => {
    const { startDate, endDate } = req.query;
    const stats = await AdmissionService.getAdmissionStatistics(
      startDate,
      endDate,
    );
    return res.json({ success: true, data: stats });
  });

  searchAdmissions = handle(async (req, res) => {
    const { q } = req.query;
    if (!q)
      return res
        .status(400)
        .json({ success: false, message: "Search term q is required" });
    const admissions = await AdmissionService.searchAdmissions(q);
    return res.json({ success: true, data: admissions });
  });

  getPatientByUHID = handle(async (req, res) => {
    const patient = await AdmissionService.getPatientByUHID(req.params.uhid);
    return res.json({ success: true, data: patient });
  });

  getPatientAdmissionHistory = handle(async (req, res) => {
    const admissions = await AdmissionService.getPatientAdmissionHistory(
      req.params.patientId,
    );
    return res.json({ success: true, data: admissions });
  });

  // GET /api/admissions/doctor/:doctorName
  getAdmissionsByDoctor = handle(async (req, res) => {
    const admissions = await AdmissionService.getAdmissionsByDoctor(
      req.params.doctorName,
    );
    return res.json({ success: true, data: admissions });
  });

  updateAdmission = handle(async (req, res) => {
    const admission = await AdmissionService.updateAdmission(
      req.params.id,
      req.body,
    );
    return res.json({
      success: true,
      message: "Admission updated",
      data: admission,
    });
  });

  // POST /api/admissions/:id/discharge
  // Body: { actualDischargeDate?, dischargeNotes?, dischargeSummary?,
  //         conditionOnDischarge?, followUpInstructions?, totalCost? }
  dischargePatient = handle(async (req, res) => {
    const admission = await AdmissionService.dischargePatient(
      req.params.id,
      req.body,
    );
    return res.json({
      success: true,
      message: "Patient discharged successfully. Bed is now available.",
      data: admission,
    });
  });

  cancelAdmission = handle(async (req, res) => {
    const { reason } = req.body;
    const admission = await AdmissionService.cancelAdmission(
      req.params.id,
      reason,
    );
    return res.json({
      success: true,
      message: "Admission cancelled",
      data: admission,
    });
  });

  transferBed = handle(async (req, res) => {
    const { newBedId, reason } = req.body;
    if (!newBedId)
      return res
        .status(400)
        .json({ success: false, message: "newBedId is required" });
    const admission = await AdmissionService.transferBed(
      req.params.id,
      newBedId,
      reason,
    );
    return res.json({
      success: true,
      message: "Bed transferred successfully",
      data: admission,
    });
  });

  deleteAdmission = handle(async (req, res) => {
    const result = await AdmissionService.deleteAdmission(req.params.id);
    return res.json({ success: true, message: result.message });
  });
}

module.exports = new AdmissionController();
