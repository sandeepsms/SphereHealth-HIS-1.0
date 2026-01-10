const Department = require("../../models/Department/department");

class DepartmentService {
  async createDepartment(departmentData) {
    const existing = await Department.findOne({
      $or: [
        { departmentName: departmentData.departmentName },
        { departmentCode: departmentData.departmentCode },
      ],
    });

    if (existing) {
      throw new Error("Department with this name or code already exists");
    }

    const department = new Department(departmentData);
    await department.save();

    return await this.getDepartmentById(department._id);
  }

  async getAllDepartments(filters = {}) {
    const query = {};

    if (filters.isActive !== undefined) {
      query.isActive = filters.isActive === "true" || filters.isActive === true;
    }

    if (filters.category) {
      query.category = filters.category;
    }

    if (filters.opdAvailable !== undefined) {
      query.opdAvailable =
        filters.opdAvailable === "true" || filters.opdAvailable === true;
    }

    if (filters.ipdAvailable !== undefined) {
      query.ipdAvailable =
        filters.ipdAvailable === "true" || filters.ipdAvailable === true;
    }

    if (filters.emergencyAvailable !== undefined) {
      query.emergencyAvailable =
        filters.emergencyAvailable === "true" ||
        filters.emergencyAvailable === true;
    }

    return await Department.find(query)
      .populate("headOfDepartment", "personalInfo doctorId")
      .sort({ displayOrder: 1, departmentName: 1 });
  }

  async getDepartmentById(id) {
    const department = await Department.findById(id).populate(
      "headOfDepartment",
      "personalInfo doctorId contact"
    );

    if (!department) {
      throw new Error("Department not found");
    }

    return department;
  }

  async getDepartmentByCode(code) {
    const department = await Department.findOne({
      departmentCode: code.toUpperCase(),
    }).populate("headOfDepartment", "personalInfo doctorId contact");

    if (!department) {
      throw new Error("Department not found");
    }

    return department;
  }

  async updateDepartment(id, updateData) {
    const department = await Department.findById(id);
    if (!department) {
      throw new Error("Department not found");
    }

    if (updateData.departmentName || updateData.departmentCode) {
      const existing = await Department.findOne({
        _id: { $ne: id },
        $or: [
          { departmentName: updateData.departmentName },
          { departmentCode: updateData.departmentCode },
        ],
      });

      if (existing) {
        throw new Error("Department with this name or code already exists");
      }
    }

    const updatedDepartment = await Department.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    ).populate("headOfDepartment", "personalInfo doctorId");

    return updatedDepartment;
  }

  async deleteDepartment(id) {
    const department = await Department.findById(id);
    if (!department) {
      throw new Error("Department not found");
    }

    department.isActive = false;
    await department.save();

    return department;
  }

  async getActiveDepartments() {
    return await Department.find({ isActive: true })
      .populate("headOfDepartment", "personalInfo doctorId")
      .sort({ displayOrder: 1, departmentName: 1 });
  }

  async getDepartmentsByCategory(category) {
    return await Department.find({ category, isActive: true })
      .populate("headOfDepartment", "personalInfo doctorId")
      .sort({ displayOrder: 1, departmentName: 1 });
  }

  async getOPDDepartments() {
    return await Department.find({ opdAvailable: true, isActive: true })
      .populate("headOfDepartment", "personalInfo doctorId")
      .sort({ displayOrder: 1, departmentName: 1 });
  }

  async getIPDDepartments() {
    return await Department.find({ ipdAvailable: true, isActive: true })
      .populate("headOfDepartment", "personalInfo doctorId")
      .sort({ displayOrder: 1, departmentName: 1 });
  }

  async getEmergencyDepartments() {
    return await Department.find({ emergencyAvailable: true, isActive: true })
      .populate("headOfDepartment", "personalInfo doctorId")
      .sort({ displayOrder: 1, departmentName: 1 });
  }

  async assignHOD(departmentId, doctorId) {
    const department = await Department.findById(departmentId);
    if (!department) {
      throw new Error("Department not found");
    }

    department.headOfDepartment = doctorId;
    await department.save();

    return await this.getDepartmentById(departmentId);
  }

  async removeHOD(departmentId) {
    const department = await Department.findById(departmentId);
    if (!department) {
      throw new Error("Department not found");
    }

    department.headOfDepartment = null;
    await department.save();

    return await this.getDepartmentById(departmentId);
  }

  async getDepartmentStats() {
    const totalDepartments = await Department.countDocuments();
    const activeDepartments = await Department.countDocuments({
      isActive: true,
    });
    const opdDepartments = await Department.countDocuments({
      opdAvailable: true,
      isActive: true,
    });
    const ipdDepartments = await Department.countDocuments({
      ipdAvailable: true,
      isActive: true,
    });
    const emergencyDepartments = await Department.countDocuments({
      emergencyAvailable: true,
      isActive: true,
    });

    const byCategory = await Department.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: "$category", count: { $sum: 1 } } },
    ]);

    return {
      totalDepartments,
      activeDepartments,
      opdDepartments,
      ipdDepartments,
      emergencyDepartments,
      byCategory: byCategory.reduce((acc, item) => {
        acc[item._id] = item.count;
        return acc;
      }, {}),
    };
  }

  async searchDepartments(searchTerm) {
    const regex = new RegExp(searchTerm, "i");
    return await Department.find({
      isActive: true,
      $or: [
        { departmentName: regex },
        { departmentCode: regex },
        { description: regex },
      ],
    })
      .populate("headOfDepartment", "personalInfo doctorId")
      .sort({ displayOrder: 1, departmentName: 1 })
      .limit(20);
  }
}

module.exports = new DepartmentService();
