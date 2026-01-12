const doctorService = require("../../services/Doctor/doctorService");

class DoctorController {
  handleDuplicateKeyError(error) {
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
  }

  async createDoctor(req, res) {
    try {
      const doctor = await doctorService.createDoctor(req.body);

      res.status(201).json({
        success: true,
        message: "Doctor registered successfully",
        data: doctor,
      });
    } catch (error) {
      console.error("❌ Error creating doctor:", error);

      if (error.code === 11000) {
        return res.status(400).json({
          success: false,
          message: this.handleDuplicateKeyError(error),
        });
      }

      if (error.name === "ValidationError") {
        const errors = Object.values(error.errors).map((err) => err.message);
        return res.status(400).json({
          success: false,
          message: "Validation failed. Please check all required fields.",
          errors: errors,
        });
      }

      res.status(400).json({
        success: false,
        message: error.message || "Failed to create doctor",
      });
    }
  }

  async getAllDoctors(req, res) {
    try {
      const { page = 1, limit = 10, ...filters } = req.query;
      console.log("📋 Fetching doctors - Page:", page, "Limit:", limit);

      const result = await doctorService.getAllDoctors(
        parseInt(page),
        parseInt(limit),
        filters
      );

      res.status(200).json({
        success: true,
        data: result.doctors,
        pagination: result.pagination,
      });
    } catch (error) {
      console.error("❌ Error fetching doctors:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to fetch doctors",
      });
    }
  }

  async getDoctorById(req, res) {
    try {
      const { doctorId } = req.params;
      console.log("🔍 Fetching doctor by ID:", doctorId);

      const doctor = await doctorService.getDoctorById(doctorId);

      if (!doctor) {
        console.log("❌ Doctor not found:", doctorId);
        return res.status(404).json({
          success: false,
          message: "Doctor not found",
        });
      }

      console.log("✅ Doctor found:", doctor.doctorId);
      res.status(200).json({
        success: true,
        data: doctor,
      });
    } catch (error) {
      console.error("❌ Error fetching doctor:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to fetch doctor",
      });
    }
  }

  async updateDoctor(req, res) {
    try {
      const { doctorId } = req.params;
      console.log("📝 Updating doctor:", doctorId);

      const doctor = await doctorService.updateDoctor(doctorId, req.body);

      if (!doctor) {
        return res.status(404).json({
          success: false,
          message: "Doctor not found",
        });
      }

      console.log("✅ Doctor updated:", doctor.doctorId);
      res.status(200).json({
        success: true,
        message: "Doctor updated successfully",
        data: doctor,
      });
    } catch (error) {
      console.error("❌ Error updating doctor:", error);

      if (error.code === 11000) {
        return res.status(400).json({
          success: false,
          message: this.handleDuplicateKeyError(error),
        });
      }

      if (error.name === "ValidationError") {
        const errors = Object.values(error.errors).map((err) => err.message);
        return res.status(400).json({
          success: false,
          message: "Validation failed. Please check all required fields.",
          errors: errors,
        });
      }

      res.status(400).json({
        success: false,
        message: error.message || "Failed to update doctor",
      });
    }
  }

  async deleteDoctor(req, res) {
    try {
      const { doctorId } = req.params;
      console.log("🗑️ Deleting doctor:", doctorId);

      const doctor = await doctorService.deleteDoctor(doctorId);

      if (!doctor) {
        return res.status(404).json({
          success: false,
          message: "Doctor not found",
        });
      }

      console.log("✅ Doctor deactivated:", doctor.doctorId);
      res.status(200).json({
        success: true,
        message: "Doctor deactivated successfully",
        data: doctor,
      });
    } catch (error) {
      console.error("❌ Error deleting doctor:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to delete doctor",
      });
    }
  }

  async getDoctorsByDepartment(req, res) {
    try {
      const doctors = await doctorService.getDoctorsByDepartment(
        req.params.department
      );
      res.status(200).json({
        success: true,
        data: doctors,
      });
    } catch (error) {
      console.error("❌ Error fetching doctors by department:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to fetch doctors",
      });
    }
  }

  async getDoctorsBySpecialization(req, res) {
    try {
      const doctors = await doctorService.getDoctorsBySpecialization(
        req.params.specialization
      );
      res.status(200).json({
        success: true,
        data: doctors,
      });
    } catch (error) {
      console.error("❌ Error fetching doctors by specialization:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to fetch doctors",
      });
    }
  }

  async searchDoctors(req, res) {
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
      console.error("❌ Error searching doctors:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to search doctors",
      });
    }
  }

  async getActiveDoctors(req, res) {
    try {
      const doctors = await doctorService.getActiveDoctors();
      res.status(200).json({
        success: true,
        data: doctors,
      });
    } catch (error) {
      console.error("❌ Error fetching active doctors:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to fetch doctors",
      });
    }
  }

  async updateConsultationFee(req, res) {
    try {
      const { opdFee, emergencyFee } = req.body;
      const doctor = await doctorService.updateConsultationFee(
        req.params.doctorId,
        opdFee,
        emergencyFee
      );
      res.status(200).json({
        success: true,
        message: "Consultation fee updated successfully",
        data: doctor,
      });
    } catch (error) {
      console.error("❌ Error updating consultation fee:", error);
      res.status(400).json({
        success: false,
        message: error.message || "Failed to update fee",
      });
    }
  }

  async getDoctorStats(req, res) {
    try {
      const stats = await doctorService.getDoctorStats(req.params.doctorId);
      res.status(200).json({
        success: true,
        data: stats,
      });
    } catch (error) {
      console.error("❌ Error fetching doctor stats:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to fetch stats",
      });
    }
  }

  async getDoctorsByExperience(req, res) {
    try {
      const { minExperience = 0 } = req.query;
      const doctors = await doctorService.getDoctorsByExperience(
        parseInt(minExperience)
      );
      res.status(200).json({
        success: true,
        data: doctors,
      });
    } catch (error) {
      console.error("❌ Error fetching doctors by experience:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to fetch doctors",
      });
    }
  }
}

module.exports = new DoctorController();
