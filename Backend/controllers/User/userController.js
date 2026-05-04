const userService = require("../../services/User/userService");

class UserController {
  // Create user
  async createUser(req, res) {
    try {
      const user = await userService.createUser(req.body);
      res.status(201).json({
        success: true,
        message: `${req.body.role} created successfully`,
        data: user,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Get all users
  async getAllUsers(req, res) {
    try {
      const result = await userService.getAllUsers(req.query);
      res.status(200).json({
        success: true,
        data: result.users,
        pagination: result.pagination,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Get user by ID
  async getUserById(req, res) {
    try {
      const user = await userService.getUserById(req.params.id);
      res.status(200).json({
        success: true,
        data: user,
      });
    } catch (error) {
      res.status(404).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Get user by employee ID
  async getUserByEmployeeId(req, res) {
    try {
      const user = await userService.getUserByEmployeeId(req.params.employeeId);
      res.status(200).json({
        success: true,
        data: user,
      });
    } catch (error) {
      res.status(404).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Update user
  async updateUser(req, res) {
    try {
      const user = await userService.updateUser(
        req.params.id,
        req.body,
        req.user?.id
      );
      res.status(200).json({
        success: true,
        message: "User updated successfully",
        data: user,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Deactivate user
  async deactivateUser(req, res) {
    try {
      const user = await userService.deactivateUser(req.params.id);
      res.status(200).json({
        success: true,
        message: "User deactivated successfully",
        data: user,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Activate user
  async activateUser(req, res) {
    try {
      const user = await userService.activateUser(req.params.id);
      res.status(200).json({
        success: true,
        message: "User activated successfully",
        data: user,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Get all doctors
  async getAllDoctors(req, res) {
    try {
      const doctors = await userService.getAllDoctors(req.query);
      res.status(200).json({
        success: true,
        count: doctors.length,
        data: doctors,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Get all nurses
  async getAllNurses(req, res) {
    try {
      const nurses = await userService.getAllNurses(req.query);
      res.status(200).json({
        success: true,
        count: nurses.length,
        data: nurses,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Get staff by department
  async getStaffByDepartment(req, res) {
    try {
      const { departmentId } = req.params;
      const { role } = req.query;
      const staff = await userService.getStaffByDepartment(departmentId, role);
      res.status(200).json({
        success: true,
        count: staff.length,
        data: staff,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Get doctors by specialization
  async getDoctorsBySpecialization(req, res) {
    try {
      const doctors = await userService.getDoctorsBySpecialization(
        req.params.specialization
      );
      res.status(200).json({
        success: true,
        count: doctors.length,
        data: doctors,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Get HOD of department
  async getHOD(req, res) {
    try {
      const hod = await userService.getHOD(req.params.departmentId);
      res.status(200).json({
        success: true,
        data: hod,
      });
    } catch (error) {
      res.status(404).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Assign HOD
  async assignHOD(req, res) {
    try {
      const { userId, departmentId } = req.body;
      const user = await userService.assignHOD(userId, departmentId);
      res.status(200).json({
        success: true,
        message: "HOD assigned successfully",
        data: user,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Get user statistics
  async getUserStats(req, res) {
    try {
      const stats = await userService.getUserStats();
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
  }

  // Search users
  async searchUsers(req, res) {
    try {
      const { q } = req.query;
      if (!q) {
        return res.status(400).json({
          success: false,
          message: "Search term is required",
        });
      }
      const users = await userService.searchUsers(q);
      res.status(200).json({
        success: true,
        count: users.length,
        data: users,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Admin reset password (no old-password required)
  async adminResetPassword(req, res) {
    try {
      const { password } = req.body;
      if (!password || password.length < 6) {
        return res.status(400).json({
          success: false,
          message: "Password must be at least 6 characters",
        });
      }
      const result = await userService.adminResetPassword(req.params.id, password);
      res.json({ success: true, message: result.message });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  // Admin set digital signature for any user
  async adminSetSignature(req, res) {
    try {
      const { signature } = req.body;
      if (!signature) {
        return res.status(400).json({
          success: false,
          message: "Signature data required",
        });
      }
      const user = await userService.adminSetSignature(req.params.id, signature);
      res.json({
        success: true,
        message: "Signature saved successfully",
        data: { signature: user.signature },
      });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  // Change password
  async changePassword(req, res) {
    try {
      const { oldPassword, newPassword } = req.body;

      if (!oldPassword || !newPassword) {
        return res.status(400).json({
          success: false,
          message: "Old password and new password are required",
        });
      }

      if (newPassword.length < 6) {
        return res.status(400).json({
          success: false,
          message: "Password must be at least 6 characters long",
        });
      }

      const result = await userService.changePassword(
        req.user.id,
        oldPassword,
        newPassword
      );

      res.status(200).json({
        success: true,
        message: result.message,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }
}

module.exports = new UserController();
