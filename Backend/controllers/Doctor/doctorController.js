const doctorService = require("../../services/Doctor/doctorService");

/* ---------------------------------- */
/* Duplicate Key Error Handler */
/* ---------------------------------- */

const handleDuplicateKeyError = (error) => {
  if (error.code === 11000) {
    const field = Object.keys(error.keyPattern)[0];
    const value = error.keyValue[field];

    const fieldNames = {
      doctorId: "Doctor ID",
      "professional.registrationNumber": "Registration Number",
      "contact.email": "Email Address",
      "contact.mobileNumber": "Mobile Number",
    };

    const friendlyField = fieldNames[field] || field;

    return `${friendlyField} "${value}" is already registered. Please use a different ${friendlyField.toLowerCase()}.`;
  }

  return error.message;
};

/* ---------------------------------- */
/* Create Doctor */
/* ---------------------------------- */

exports.createDoctor = async (req, res) => {
  try {
    const doctor = await doctorService.createDoctor(req.body);

    res.status(201).json({
      success: true,
      message: "Doctor registered successfully",
      data: doctor,
    });
  } catch (error) {
    console.error("Error creating doctor:", error);

    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: handleDuplicateKeyError(error),
      });
    }

    if (error.name === "ValidationError") {
      const errors = Object.values(error.errors).map((err) => err.message);

      return res.status(400).json({
        success: false,
        message: "Validation failed. Please check all required fields.",
        errors,
      });
    }

    res.status(400).json({
      success: false,
      message: error.message || "Failed to create doctor",
    });
  }
};

/* ---------------------------------- */
/* Get All Doctors */
/* ---------------------------------- */

exports.getAllDoctors = async (req, res) => {
  try {
    const { page = 1, limit = 10, ...filters } = req.query;

    const result = await doctorService.getAllDoctors(
      parseInt(page),
      parseInt(limit),
      filters,
    );

    res.status(200).json({
      success: true,
      data: result.doctors,
      pagination: result.pagination,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/* ---------------------------------- */
/* Get Doctor By ID */
/* ---------------------------------- */

exports.getDoctorById = async (req, res) => {
  try {
    const doctor = await doctorService.getDoctorById(req.params.doctorId);

    if (!doctor) {
      return res.status(404).json({
        success: false,
        message: "Doctor not found",
      });
    }

    res.status(200).json({
      success: true,
      data: doctor,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/* ---------------------------------- */
/* Update Doctor */
/* ---------------------------------- */

exports.updateDoctor = async (req, res) => {
  try {
    const doctor = await doctorService.updateDoctor(
      req.params.doctorId,
      req.body,
    );

    if (!doctor) {
      return res.status(404).json({
        success: false,
        message: "Doctor not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Doctor updated successfully",
      data: doctor,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: handleDuplicateKeyError(error),
      });
    }

    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

/* ---------------------------------- */
/* Delete Doctor */
/* ---------------------------------- */

exports.deleteDoctor = async (req, res) => {
  try {
    const doctor = await doctorService.deleteDoctor(req.params.doctorId);

    if (!doctor) {
      return res.status(404).json({
        success: false,
        message: "Doctor not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Doctor deactivated successfully",
      data: doctor,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/* ---------------------------------- */
/* Remaining Methods */
/* ---------------------------------- */

exports.getActiveDoctors = async (req, res) => {
  try {
    const doctors = await doctorService.getActiveDoctors();
    res.status(200).json({ success: true, data: doctors });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.searchDoctors = async (req, res) => {
  try {
    const { q } = req.query;

    if (!q) {
      return res.status(400).json({
        success: false,
        message: "Search term is required",
      });
    }

    const doctors = await doctorService.searchDoctors(q);

    res.status(200).json({
      success: true,
      data: doctors,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getDoctorsByDepartment = async (req, res) => {
  try {
    const doctors = await doctorService.getDoctorsByDepartment(
      req.params.department,
    );

    res.status(200).json({ success: true, data: doctors });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getDoctorsBySpecialization = async (req, res) => {
  try {
    const doctors = await doctorService.getDoctorsBySpecialization(
      req.params.specialization,
    );

    res.status(200).json({ success: true, data: doctors });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getDoctorsByExperience = async (req, res) => {
  try {
    const { minExperience = 0 } = req.query;

    const doctors = await doctorService.getDoctorsByExperience(
      parseInt(minExperience),
    );

    res.status(200).json({ success: true, data: doctors });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateConsultationFee = async (req, res) => {
  try {
    const { opdFee, emergencyFee } = req.body;

    const doctor = await doctorService.updateConsultationFee(
      req.params.doctorId,
      opdFee,
      emergencyFee,
    );

    res.status(200).json({
      success: true,
      message: "Consultation fee updated successfully",
      data: doctor,
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.getDoctorStats = async (req, res) => {
  try {
    const stats = await doctorService.getDoctorStats(req.params.doctorId);

    res.status(200).json({ success: true, data: stats });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
