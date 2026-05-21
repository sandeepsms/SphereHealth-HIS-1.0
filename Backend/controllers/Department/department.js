const departmentService = require("../../services/Department/departmentService");
// R7bb-FIX-B-5/D7-CRIT-6: master-data audit — Department write surfaces
// emit MASTER_DEPARTMENT_* BillingAudit rows on every create / update /
// deactivate. Before R7bb a hospital reorg could rename / remove a
// department with zero audit trail, breaking the chain back to
// historical bills that referenced the old name.
const Department = require("../../models/Department/department");
const { logMasterDataEvent } = require("../../services/Clinical/activityLogger");
function _deptSnapshot(doc) {
  if (!doc) return null;
  const o = doc.toObject ? doc.toObject() : doc;
  return {
    _id:                o._id,
    departmentName:     o.departmentName,
    departmentCode:     o.departmentCode,
    category:           o.category,
    headOfDepartment:   o.headOfDepartment,
    opdAvailable:       o.opdAvailable,
    ipdAvailable:       o.ipdAvailable,
    emergencyAvailable: o.emergencyAvailable,
    isActive:           o.isActive,
  };
}

class DepartmentController {
  async createDepartment(req, res) {
    try {
      const department = await departmentService.createDepartment(req.body);
      // R7bb-FIX-B-5/D7-CRIT-6
      logMasterDataEvent({
        event:    "MASTER_DEPARTMENT_CREATED",
        model:    "Department",
        before:   null,
        after:    _deptSnapshot(department),
        actorReq: req,
        reason:   req.body?.reason || "Department row created",
        docId:    department?._id,
      });
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
      // R7bb-FIX-B-5/D7-CRIT-6: capture BEFORE snapshot for audit.
      const before = _deptSnapshot(
        await Department.findById(req.params.id).lean().catch(() => null),
      );
      const department = await departmentService.updateDepartment(
        req.params.id,
        req.body
      );
      logMasterDataEvent({
        event:    "MASTER_DEPARTMENT_UPDATED",
        model:    "Department",
        before,
        after:    _deptSnapshot(department),
        actorReq: req,
        reason:   req.body?.reason || "Department row updated",
        docId:    department?._id,
      });
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
      // R7bb-FIX-B-5/D7-CRIT-6: capture before-state. Soft-delete = isActive
      // flip; the prior snapshot lets reviewers undo accidentally-deactivated
      // departments by walking the audit chain.
      const before = _deptSnapshot(
        await Department.findById(req.params.id).lean().catch(() => null),
      );
      const department = await departmentService.deleteDepartment(
        req.params.id
      );
      logMasterDataEvent({
        event:    "MASTER_DEPARTMENT_UPDATED",   // soft-delete = isActive flip
        model:    "Department",
        before,
        after:    _deptSnapshot(department) || (before ? { ...before, isActive: false } : null),
        actorReq: req,
        reason:   req.body?.reason || "Department row deactivated",
        docId:    req.params.id,
      });
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
