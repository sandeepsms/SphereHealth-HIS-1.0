const patientService = require("../../services/patient/patientService");

exports.createPatient = async (req, res) => {
  try {
    const patient = await patientService.createPatient(req.body);

    res.status(201).json({
      success: true,
      message: "Patient registered successfully",
      data: patient,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "Patient with this contact number already exists",
      });
    }

    const statusCode = error.message.includes("not found") ? 404 : 400;
    res.status(statusCode).json({
      success: false,
      message: error.message,
    });
  }
};

exports.getAllPatients = async (req, res) => {
  try {
    const result = await patientService.getAllPatients(req.query);

    res.status(200).json({
      success: true,
      data: result.patients,
      totalPages: result.totalPages,
      currentPage: result.currentPage,
      totalPatients: result.totalPatients,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.getPatientById = async (req, res) => {
  try {
    const patient = await patientService.getPatientById(req.params.id);

    res.status(200).json({
      success: true,
      data: patient,
    });
  } catch (error) {
    const statusCode = error.message === "Patient not found" ? 404 : 500;
    res.status(statusCode).json({
      success: false,
      message: error.message,
    });
  }
};

exports.getPatientByUHID = async (req, res) => {
  try {
    const patient = await patientService.getPatientByUHID(req.params.uhid);

    res.status(200).json({
      success: true,
      data: patient,
    });
  } catch (error) {
    const statusCode = error.message === "Patient not found" ? 404 : 500;
    res.status(statusCode).json({
      success: false,
      message: error.message,
    });
  }
};

exports.updatePatient = async (req, res) => {
  try {
    const patient = await patientService.updatePatient(req.params.id, req.body);

    res.status(200).json({
      success: true,
      message: "Patient updated successfully",
      data: patient,
    });
  } catch (error) {
    const statusCode = error.message === "Patient not found" ? 404 : 400;
    res.status(statusCode).json({
      success: false,
      message: error.message,
    });
  }
};

exports.deletePatient = async (req, res) => {
  try {
    await patientService.deletePatient(req.params.id);

    res.status(200).json({
      success: true,
      message: "Patient deleted successfully",
    });
  } catch (error) {
    const statusCode = error.message === "Patient not found" ? 404 : 500;
    res.status(statusCode).json({
      success: false,
      message: error.message,
    });
  }
};

exports.getPatientStats = async (req, res) => {
  try {
    const stats = await patientService.getPatientStats();

    res.status(200).json({
      success: true,
      data: stats,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ⭐ New endpoint: Get patients by TPA
exports.getPatientsByTPA = async (req, res) => {
  try {
    const patients = await patientService.getPatientsByTPA(
      req.params.tpaId,
      req.query,
    );

    res.status(200).json({
      success: true,
      count: patients.length,
      data: patients,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
