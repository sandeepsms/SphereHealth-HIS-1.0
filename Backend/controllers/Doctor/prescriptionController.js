const PrescriptionService = require("../../services/Doctor/PrescriptionService");
exports.createPrescription = async (req, res) => {
  try {
    const prescription = await PrescriptionService.createPrescription(req.body);

    res.status(201).json({
      success: true,
      message: "Prescription created successfully",
      data: prescription,
    });
  } catch (error) {
    console.error("Error creating prescription:", error);
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

// Get All Prescriptions
exports.getAllPrescriptions = async (req, res) => {
  try {
    const prescriptions = await PrescriptionService.getAllPrescriptions(
      req.query,
    );

    res.status(200).json({
      success: true,
      count: prescriptions.length,
      data: prescriptions,
    });
  } catch (error) {
    console.error("Error fetching prescriptions:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Get Prescription by ID
exports.getPrescriptionById = async (req, res) => {
  try {
    const prescription = await PrescriptionService.getPrescriptionById(
      req.params.id,
    );

    res.status(200).json({
      success: true,
      data: prescription,
    });
  } catch (error) {
    console.error("Error fetching prescription:", error);
    res.status(error.message === "Prescription not found" ? 404 : 500).json({
      success: false,
      message: error.message,
    });
  }
};

// Get Prescriptions by Patient (UHID or ID)
exports.getPrescriptionsByPatient = async (req, res) => {
  try {
    const prescriptions = await PrescriptionService.getPrescriptionsByPatient(
      req.params.patientIdentifier,
    );

    res.status(200).json({
      success: true,
      count: prescriptions.length,
      data: prescriptions,
    });
  } catch (error) {
    console.error("Error fetching patient prescriptions:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Get Prescriptions by Doctor
exports.getPrescriptionsByDoctor = async (req, res) => {
  try {
    const prescriptions = await PrescriptionService.getPrescriptionsByDoctor(
      req.params.doctorId,
    );

    res.status(200).json({
      success: true,
      count: prescriptions.length,
      data: prescriptions,
    });
  } catch (error) {
    console.error("Error fetching doctor prescriptions:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Update Prescription
exports.updatePrescription = async (req, res) => {
  try {
    const prescription = await PrescriptionService.updatePrescription(
      req.params.id,
      req.body,
    );

    res.status(200).json({
      success: true,
      message: "Prescription updated successfully",
      data: prescription,
    });
  } catch (error) {
    console.error("Error updating prescription:", error);
    res.status(error.message === "Prescription not found" ? 404 : 400).json({
      success: false,
      message: error.message,
    });
  }
};

// Delete Prescription
exports.deletePrescription = async (req, res) => {
  try {
    await PrescriptionService.deletePrescription(req.params.id);

    res.status(200).json({
      success: true,
      message: "Prescription deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting prescription:", error);
    res.status(error.message === "Prescription not found" ? 404 : 500).json({
      success: false,
      message: error.message,
    });
  }
};

// Update Prescription Status
exports.updatePrescriptionStatus = async (req, res) => {
  try {
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({
        success: false,
        message: "Status is required",
      });
    }

    const prescription = await PrescriptionService.updatePrescriptionStatus(
      req.params.id,
      status,
    );

    res.status(200).json({
      success: true,
      message: "Prescription status updated successfully",
      data: prescription,
    });
  } catch (error) {
    console.error("Error updating prescription status:", error);
    res.status(error.message === "Prescription not found" ? 404 : 400).json({
      success: false,
      message: error.message,
    });
  }
};

// Get Prescription Statistics
exports.getPrescriptionStats = async (req, res) => {
  try {
    const stats = await PrescriptionService.getPrescriptionStats(req.query);

    res.status(200).json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error("Error fetching prescription stats:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

module.exports = exports;
