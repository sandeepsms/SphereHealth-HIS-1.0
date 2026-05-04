const User = require("../../models/User/userModel");
const Department = require("../../models/Department/department");

class UserService {
  async createUser(userData) {
    try {
      if (userData.department) {
        const dept = await Department.findById(userData.department);
        if (!dept || !dept.isActive) {
          throw new Error("Invalid or inactive department");
        }
      }

      if (userData.role === "Doctor") {
        if (!userData.doctorDetails?.registrationNumber) {
          throw new Error("Doctor registration number is required");
        }
        if (!userData.doctorDetails?.specialization) {
          throw new Error("Doctor specialization is required");
        }
      }

      if (userData.role === "Nurse") {
        if (!userData.nurseDetails?.nursingType) {
          throw new Error("Nursing type is required");
        }
      }

      const user = await User.create(userData);

      const userObj = user.toObject();
      delete userObj.password;

      return userObj;
    } catch (error) {
      if (error.code === 11000) {
        throw new Error("Email or Employee ID already exists");
      }
      throw error;
    }
  }
  async getAllUsers(query = {}) {
    const {
      role,
      department,
      status,
      page = 1,
      limit = 10,
      search,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = query;

    const filter = { isActive: true };

    if (role) filter.role = role;
    if (department) filter.department = department;
    if (status) filter.status = status;

    if (search) {
      filter.$or = [
        { fullName: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { employeeId: { $regex: search, $options: "i" } },
        { phone: { $regex: search, $options: "i" } },
      ];
    }

    const skip = (page - 1) * limit;
    const sort = { [sortBy]: sortOrder === "desc" ? -1 : 1 };

    const users = await User.find(filter)
      .select("-password")
      .populate("department", "name code category")
      .populate("ward", "name wardType")
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit));

    const total = await User.countDocuments(filter);

    return {
      users,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / limit),
        limit: parseInt(limit),
      },
    };
  }

  // Get user by ID
  async getUserById(id) {
    const user = await User.findById(id)
      .select("-password")
      .populate("department", "name code category description")
      .populate("ward", "name wardType")
      .populate("createdBy", "fullName employeeId")
      .populate("updatedBy", "fullName employeeId");

    if (!user) {
      throw new Error("User not found");
    }

    return user;
  }

  // Get user by employee ID
  async getUserByEmployeeId(employeeId) {
    const user = await User.findOne({ employeeId })
      .select("-password")
      .populate("department ward");

    if (!user) {
      throw new Error("User not found");
    }

    return user;
  }

  // Update user
  async updateUser(id, updateData, updatedBy) {
    // Don't allow these fields to be updated
    delete updateData.password;
    delete updateData.email;
    delete updateData.employeeId;
    delete updateData.role;

    updateData.updatedBy = updatedBy;

    const user = await User.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    })
      .select("-password")
      .populate("department ward");

    if (!user) {
      throw new Error("User not found");
    }

    return user;
  }

  // Deactivate user
  async deactivateUser(id) {
    const user = await User.findByIdAndUpdate(
      id,
      { isActive: false, status: "Inactive" },
      { new: true }
    ).select("-password");

    if (!user) {
      throw new Error("User not found");
    }

    return user;
  }

  // Activate user
  async activateUser(id) {
    const user = await User.findByIdAndUpdate(
      id,
      { isActive: true, status: "Active" },
      { new: true }
    ).select("-password");

    if (!user) {
      throw new Error("User not found");
    }

    return user;
  }

  // Get all doctors
  async getAllDoctors(query = {}) {
    const { department, specialization, designation } = query;

    const filter = {
      role: "Doctor",
      status: "Active",
      isActive: true,
    };

    if (department) filter.department = department;
    if (specialization) {
      filter["doctorDetails.specialization"] = specialization;
    }
    if (designation) {
      filter["doctorDetails.designation"] = designation;
    }

    const doctors = await User.find(filter)
      .select("-password")
      .populate("department", "name code category")
      .sort({ "doctorDetails.experienceYears": -1 });

    return doctors;
  }

  // Get all nurses
  async getAllNurses(query = {}) {
    const { department, ward, nursingType } = query;

    const filter = {
      role: "Nurse",
      status: "Active",
      isActive: true,
    };

    if (department) filter.department = department;
    if (ward) filter.ward = ward;
    if (nursingType) {
      filter["nurseDetails.nursingType"] = nursingType;
    }

    const nurses = await User.find(filter)
      .select("-password")
      .populate("department", "name code")
      .populate("ward", "name wardType")
      .sort({ "nurseDetails.experienceYears": -1 });

    return nurses;
  }

  // Get staff by department
  async getStaffByDepartment(departmentId, role = null) {
    const filter = {
      department: departmentId,
      status: "Active",
      isActive: true,
    };

    if (role) filter.role = role;

    const staff = await User.find(filter)
      .select("-password")
      .populate("department ward");

    return staff;
  }

  // Get doctors by specialization
  async getDoctorsBySpecialization(specialization) {
    const doctors = await User.findDoctorsBySpecialization(specialization);
    return doctors;
  }

  // Get HOD of department
  async getHOD(departmentId) {
    const hod = await User.findHOD(departmentId);

    if (!hod) {
      throw new Error("No HOD assigned for this department");
    }

    return hod;
  }

  // Assign HOD to department
  async assignHOD(userId, departmentId) {
    const user = await User.findById(userId);
    if (!user || user.role !== "Doctor") {
      throw new Error("User must be a doctor");
    }

    // Remove existing HOD
    await User.updateMany(
      {
        role: "Doctor",
        department: departmentId,
        "doctorDetails.designation": "HOD",
      },
      {
        $set: { "doctorDetails.designation": "Consultant" },
      }
    );

    // Assign new HOD
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      {
        department: departmentId,
        "doctorDetails.designation": "HOD",
      },
      { new: true }
    )
      .select("-password")
      .populate("department");

    return updatedUser;
  }

  // Get user statistics
  async getUserStats() {
    const stats = await User.aggregate([
      {
        $match: { isActive: true },
      },
      {
        $group: {
          _id: "$role",
          count: { $sum: 1 },
          active: {
            $sum: { $cond: [{ $eq: ["$status", "Active"] }, 1, 0] },
          },
          onLeave: {
            $sum: { $cond: [{ $eq: ["$status", "On Leave"] }, 1, 0] },
          },
        },
      },
      {
        $project: {
          role: "$_id",
          count: 1,
          active: 1,
          onLeave: 1,
          _id: 0,
        },
      },
    ]);

    const totalUsers = await User.countDocuments({ isActive: true });
    const totalActive = await User.countDocuments({
      isActive: true,
      status: "Active",
    });

    // Department-wise doctor count
    const departmentStats = await User.aggregate([
      {
        $match: { role: "Doctor", isActive: true },
      },
      {
        $lookup: {
          from: "departments",
          localField: "department",
          foreignField: "_id",
          as: "deptInfo",
        },
      },
      {
        $unwind: "$deptInfo",
      },
      {
        $group: {
          _id: "$department",
          departmentName: { $first: "$deptInfo.name" },
          count: { $sum: 1 },
        },
      },
    ]);

    return {
      total: totalUsers,
      active: totalActive,
      byRole: stats,
      departmentWise: departmentStats,
    };
  }

  // Search users
  async searchUsers(searchTerm) {
    const users = await User.find({
      isActive: true,
      $or: [
        { fullName: { $regex: searchTerm, $options: "i" } },
        { email: { $regex: searchTerm, $options: "i" } },
        { employeeId: { $regex: searchTerm, $options: "i" } },
        { phone: { $regex: searchTerm, $options: "i" } },
      ],
    })
      .select("-password")
      .populate("department", "name code")
      .limit(20);

    return users;
  }

  // Change password
  async changePassword(userId, oldPassword, newPassword) {
    const user = await User.findById(userId);

    if (!user) {
      throw new Error("User not found");
    }

    const isMatch = await user.comparePassword(oldPassword);
    if (!isMatch) {
      throw new Error("Current password is incorrect");
    }

    user.password = newPassword;
    await user.save();

    return { message: "Password changed successfully" };
  }

  // Admin-initiated password reset (bypasses old-password check)
  async adminResetPassword(userId, newPassword) {
    const user = await User.findById(userId);
    if (!user) throw new Error("User not found");
    user.password = newPassword;
    await user.save(); // triggers bcrypt pre-save hook
    return { message: "Password reset successfully" };
  }

  // Admin set/update a user's digital signature
  async adminSetSignature(userId, signature) {
    const user = await User.findByIdAndUpdate(
      userId,
      { signature },
      { new: true }
    ).select("fullName firstName lastName signature");
    if (!user) throw new Error("User not found");
    return user;
  }

  // Update last login
  async updateLastLogin(userId) {
    await User.findByIdAndUpdate(userId, {
      lastLogin: new Date(),
    });
  }
}

module.exports = new UserService();
