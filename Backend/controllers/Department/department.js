const departmentService = require("../../services/Department/departmentService");
class DepartmentController {
  async createDepartment(req, res) {
    try {
      const department = await departmentService.createDepartment(req.body);
      res.status(201).json({
        success: true,
        message: "Department created successfully",
        data: department,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  async getAllDepartments(req, res) {
    try {
      const departments = await departmentService.getAllDepartments(req.query);
      res.status(200).json({
        success: true,
        data: departments,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  async getDepartmentById(req, res) {
    try {
      const department = await departmentService.getDepartmentById(
        req.params.id
      );
      res.status(200).json({
        success: true,
        data: department,
      });
    } catch (error) {
      res.status(404).json({
        success: false,
        message: error.message,
      });
    }
  }

  async getDepartmentByCode(req, res) {
    try {
      const department = await departmentService.getDepartmentByCode(
        req.params.code
      );
      res.status(200).json({
        success: true,
        data: department,
      });
    } catch (error) {
      res.status(404).json({
        success: false,
        message: error.message,
      });
    }
  }

  async updateDepartment(req, res) {
    try {
      const department = await departmentService.updateDepartment(
        req.params.id,
        req.body
      );
      res.status(200).json({
        success: true,
        message: "Department updated successfully",
        data: department,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  async deleteDepartment(req, res) {
    try {
      const department = await departmentService.deleteDepartment(
        req.params.id
      );
      res.status(200).json({
        success: true,
        message: "Department deactivated successfully",
        data: department,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  async getActiveDepartments(req, res) {
    try {
      const departments = await departmentService.getActiveDepartments();
      res.status(200).json({
        success: true,
        data: departments,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  async getDepartmentsByCategory(req, res) {
    try {
      const departments = await departmentService.getDepartmentsByCategory(
        req.params.category
      );
      res.status(200).json({
        success: true,
        data: departments,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  async getOPDDepartments(req, res) {
    try {
      const departments = await departmentService.getOPDDepartments();
      res.status(200).json({
        success: true,
        data: departments,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  async getIPDDepartments(req, res) {
    try {
      const departments = await departmentService.getIPDDepartments();
      res.status(200).json({
        success: true,
        data: departments,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  async getEmergencyDepartments(req, res) {
    try {
      const departments = await departmentService.getEmergencyDepartments();
      res.status(200).json({
        success: true,
        data: departments,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  async assignHOD(req, res) {
    try {
      const { doctorId } = req.body;
      const department = await departmentService.assignHOD(
        req.params.id,
        doctorId
      );
      res.status(200).json({
        success: true,
        message: "HOD assigned successfully",
        data: department,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  async removeHOD(req, res) {
    try {
      const department = await departmentService.removeHOD(req.params.id);
      res.status(200).json({
        success: true,
        message: "HOD removed successfully",
        data: department,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
      
    }
  }

  async getDepartmentStats(req, res) {
    try {
      const stats = await departmentService.getDepartmentStats();
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

  async searchDepartments(req, res) {
    try {
      const { q } = req.query;
      if (!q) {
        return res.status(400).json({
          success: false,
          message: "Search term is required",
        });
      }
      const departments = await departmentService.searchDepartments(q);
      res.status(200).json({
        success: true,
        data: departments,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }
}

module.exports = new DepartmentController();
