const User = require("../../models/User/userModel");
const Department = require("../../models/Department/department");
const userActivity = require("./userActivityLogger");
const { checkPasswordReuse } = require("../../utils/passwordPolicy");

class UserService {
  async createUser(userData, actor = null) {
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

      // R7bb-FIX-A-3: every admin-created user lands on the forced-rotation
      // screen on first login. Caller can override (e.g. seed script sets
      // false on day-zero seeds explicitly), but the default is always true.
      if (userData.mustChangePassword === undefined) {
        userData.mustChangePassword = true;
      }

      const user = await User.create(userData);

      // R7bb-FIX-A-12/D10-CRIT-4/S8: auto-create the linked Doctor document
      // when role === "Doctor" so OPD/IPD/ER list-scoping (which looks up
      // `Doctor.loginUserId === req.user.id`) finds a match the first time
      // the doctor logs in. Pre-R7bb a freshly-created doctor user saw an
      // empty patient list until the seed script was re-run.
      if (user.role === "Doctor") {
        try {
          const Doctor = require("../../models/Doctor/doctorModel");
          const exists = await Doctor.findOne({ loginUserId: user._id }).lean();
          if (!exists) {
            // Build a minimal Doctor doc. The Doctor schema requires
            // personalInfo.firstName/lastName/gender, contact.email/mobile,
            // professional.specialization+registrationNumber, department.
            // If any required field is missing we LOG and flag — but never
            // fail the user creation.
            await Doctor.create({
              personalInfo: {
                firstName: user.firstName,
                lastName:  user.lastName,
                fullName:  user.fullName || `${user.firstName} ${user.lastName}`,
                gender:    user.gender || "Other",
              },
              contact: {
                mobileNumber: user.phone,
                email:        user.email,
              },
              professional: {
                specialization:     user.doctorDetails?.specialization,
                qualifications:     user.doctorDetails?.qualifications || [],
                experience:         user.doctorDetails?.experienceYears || 0,
                registrationNumber: user.doctorDetails?.registrationNumber,
              },
              department:      user.department,
              consultationFee: user.doctorDetails?.consultationFee || { opd: 0, emergency: 0 },
              loginUserId:     user._id,
              isActive:        true,
            });
          }
        } catch (e) {
          // Best-effort — Doctor profile creation must NEVER fail user
          // creation. Flag for the operator + emit a side-channel audit.
          console.error("[userService] auto-create Doctor profile failed:", e.message);
          try {
            await userActivity.emit({
              event: "USER_CREATED",
              targetUser: user,
              actor,
              metadata: { warning: "Doctor profile auto-create FAILED — run seedRoleUsers", error: e.message },
            });
          } catch (_) { /* swallow */ }
        }
      }

      const userObj = user.toObject();
      delete userObj.password;
      delete userObj.passwordHistory;

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
      .select("-password -passwordHistory")
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
      .select("-password -passwordHistory")
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
      .select("-password -passwordHistory")
      .populate("department ward");

    if (!user) {
      throw new Error("User not found");
    }

    return user;
  }

  // Update user
  async updateUser(id, updateData, updatedBy) {
    // Don't allow these fields to be updated via the generic endpoint —
    // password goes through change-password, email/employeeId are immutable
    // identifiers, tokenVersion / passwordHistory / lockUntil are auth
    // internals.
    delete updateData.password;
    delete updateData.passwordHistory;
    delete updateData.email;
    delete updateData.employeeId;
    delete updateData.tokenVersion;
    delete updateData.lockUntil;
    delete updateData.failedLoginAttempts;
    // R7bb-FIX-A-4: role IS allowed to be updated here (Admin can re-assign
    // role) but the controller MUST detect the diff and emit ROLE_CHANGED +
    // bump tokenVersion. Leave the field in updateData.

    updateData.updatedBy = updatedBy;

    const user = await User.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    })
      .select("-password -passwordHistory")
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
      { isActive: false, status: "Inactive", $inc: { tokenVersion: 1 } },
      { new: true }
    ).select("-password -passwordHistory");

    if (!user) {
      throw new Error("User not found");
    }

    return user;
  }

  // Activate user
  //
  // R7bf-I / A7-CRIT-5 — block Terminated → Active without explicit
  // re-onboarding flow. Pre-R7bf any caller with user-admin permission
  // could flip a Terminated employee back to Active in one PATCH. That
  // bypassed:
  //   • Background re-check (HRD.3 credentialing — privileges revoked
  //     on termination must be re-issued explicitly)
  //   • Document re-verification (PRE expired ID proofs, lapsed PG
  //     registration, etc.)
  //   • Access-review boards (a terminated user keeps their tokenVersion
  //     bumped but role-grants from the prior tenure persisted; only a
  //     fresh onboarding flow guarantees those are re-validated)
  //
  // Re-onboarding is implemented as a separate `reonboardTerminatedUser`
  // service method (Agent owns later) that takes a checklist payload.
  // Until then, the only escape is `{ force: true, adminUserId, reason }`
  // — Admin override + audit row + reason text. Without all three the
  // service throws RE_ONBOARDING_REQUIRED.
  //
  // Allowed paths via this method (no force):
  //   Inactive  → Active        (regular reactivate)
  //   Suspended → Active        (suspension lifted)
  // Blocked without force:
  //   Terminated → Active       (must re-onboard)
  //   Any → Active when current already Active (no-op idempotent)
  async activateUser(id, opts = {}) {
    const current = await User.findById(id).select("status fullName employeeId").lean();
    if (!current) throw new Error("User not found");

    const force = !!opts.force;
    const adminUserId = opts.adminUserId || null;
    const reason = (opts.reason || "").trim();

    if (current.status === "Terminated" && !force) {
      const err = new Error(
        `User ${current.employeeId || current.fullName || id} is in Terminated state. ` +
        `Re-onboarding required — terminated employees cannot be reactivated via the standard activate flow. ` +
        `Use the re-onboarding workflow (HRD.3) or pass { force:true, adminUserId, reason } for an admin-audited override.`,
      );
      err.code = "RE_ONBOARDING_REQUIRED";
      err.statusCode = 409;
      err.status = 409;
      throw err;
    }
    if (current.status === "Terminated" && force) {
      if (!adminUserId) {
        const err = new Error("Force-activate of a Terminated user requires adminUserId");
        err.code = "MISSING_ADMIN_ACTOR";
        err.statusCode = 422;
        err.status = 422;
        throw err;
      }
      if (!reason || reason.length < 5) {
        const err = new Error("Force-activate of a Terminated user requires a reason (≥ 5 chars)");
        err.code = "MISSING_OVERRIDE_REASON";
        err.statusCode = 422;
        err.status = 422;
        throw err;
      }
      // Audit (best-effort) — BillingAudit is the catch-all activity log
      // in this codebase; UserActivityLog also exists but is patient-scoped.
      try {
        const { emit } = require("../../models/Billing/BillingAudit");
        await emit({
          event:     "ITEM_CANCELLED",    // closest existing enum — TODO add USER_FORCE_ACTIVATE
          UHID:      null,
          actorId:   adminUserId,
          actorName: "Admin (force-activate)",
          actorRole: "Admin",
          reason:    `FORCE_ACTIVATE_TERMINATED_USER — userId=${id}, reason: ${reason}`,
          before:    { status: "Terminated" },
          after:     { status: "Active", forced: true },
        });
      } catch (_) { /* audit best-effort */ }
    }

    const user = await User.findByIdAndUpdate(
      id,
      { isActive: true, status: "Active" },
      { new: true }
    ).select("-password -passwordHistory");

    if (!user) {
      throw new Error("User not found");
    }

    return user;
  }

  // R7bb-FIX-A-10/D10-CRIT-2: Terminate user. Persists status + departure
  // metadata, bumps tokenVersion (kills every live JWT), clears any pending
  // mustChangePassword flag (a terminated user can't log in to clear it
  // anyway, so leaving it set would be a confusing footprint).
  async terminateUser(id, { reason, departureDate } = {}) {
    const update = {
      isActive: false,
      status: "Terminated",
      terminationReason: reason || "",
      departureDate: departureDate ? new Date(departureDate) : new Date(),
      $inc: { tokenVersion: 1 },
    };
    const user = await User.findByIdAndUpdate(id, update, { new: true }).select("-password -passwordHistory");
    if (!user) throw new Error("User not found");

    // ── R7bd-A-10 / A1-HIGH-11 — Reassign or flag active admissions ──
    // Pre-R7bd terminating a doctor User left every Active admission with
    // `attendingDoctorUserId = <terminated User._id>` quietly broken:
    // JWT-based access checks failed (terminated user can't auth), nurse
    // UI showed "Doctor: <Name (Terminated)>", and downstream billing
    // continued to fire doctor-round charges against a non-existent
    // attending. We never block the admission — clinical continuity wins
    // — but we either auto-reassign to a documented co-consultant or
    // raise `requiresReassignment:true` for reception to handle.
    //
    // STRATEGY (per admission, in order):
    //   1. If admission.treatmentTeam has any non-terminated Active member,
    //      promote them (the first one) — they're already on the team.
    //   2. Else flag requiresReassignment:true + emit BillingAudit.
    //
    // Best-effort: any failure here is logged and swallowed; the
    // termination of the user itself has already succeeded.
    try {
      const Admission = require("../../models/Patient/admissionModel");
      const liveAdmissions = await Admission.find({
        attendingDoctorUserId: id,
        status: "Active",
      });
      let emit = null;
      try { ({ emit } = require("../../models/Billing/BillingAudit")); } catch (_) {}
      for (const adm of liveAdmissions) {
        // 1. Pick a documented co-consultant from the treatment team.
        const candidate = (adm.treatmentTeam || []).find((m) =>
          m.status === "Active" && m.doctorId && String(m.doctorId) !== String(id),
        );
        if (candidate?.doctorId) {
          adm.attendingDoctor       = candidate.doctorName || adm.attendingDoctor || "";
          adm.attendingDoctorId     = candidate.doctorId;
          // Try to resolve a User._id for the new attending (lazy lookup
          // — these tend to be Doctor._id refs from the team picker).
          try {
            const Doctor = require("../../models/Doctor/doctorModel");
            const docRow = await Doctor.findById(candidate.doctorId).select("loginUserId").lean();
            adm.attendingDoctorUserId = docRow?.loginUserId || null;
          } catch (_) { adm.attendingDoctorUserId = null; }
          adm.requiresReassignment       = false;
          adm.requiresReassignmentReason = "";
          try { await adm.save(); } catch (e) {
            console.warn("[terminateUser cascade] reassign-save failed for", adm._id, e.message);
            continue;
          }
        } else {
          // 2. No team member — flag for manual reassignment.
          adm.requiresReassignment       = true;
          adm.requiresReassignmentReason = `Attending doctor terminated: ${reason || "(no reason)"}`;
          adm.requiresReassignmentAt     = new Date();
          try { await adm.save(); } catch (e) {
            console.warn("[terminateUser cascade] flag-save failed for", adm._id, e.message);
            continue;
          }
          if (emit) {
            try {
              await emit({
                event:       "ITEM_CANCELLED", // closest enum value — no dedicated DOCTOR_TERMINATED yet
                UHID:        adm.UHID,
                patientId:   adm.patientId,
                admissionId: adm._id,
                actorId:     null,
                actorName:   "System (terminateUser cascade)",
                actorRole:   "System",
                reason:      `DOCTOR_TERMINATED_NEEDS_REASSIGN — User ${id} terminated; admission flagged for reassignment.`,
                before:      { requiresReassignment: false },
                after:       { requiresReassignment: true, terminatedDoctorUserId: String(id) },
              });
            } catch (_) {}
          }
        }
      }
    } catch (e) {
      console.warn("[terminateUser] admission-reassignment cascade skipped:", e.message);
    }

    return user;
  }

  // Get all doctors (paginated — previously returned the entire active-doctor
  // list which could grow unbounded on multi-branch hospitals)
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

    const page  = Math.max(1, parseInt(query.page) || 1);
    const limit = Math.min(500, Math.max(1, parseInt(query.limit) || 100));
    const skip  = (page - 1) * limit;

    const [doctors, total] = await Promise.all([
      User.find(filter)
        .select("-password -passwordHistory")
        .populate("department", "name code category")
        .sort({ "doctorDetails.experienceYears": -1 })
        .skip(skip)
        .limit(limit),
      User.countDocuments(filter),
    ]);

    return {
      doctors,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
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
      .select("-password -passwordHistory")
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
      .select("-password -passwordHistory")
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
      .select("-password -passwordHistory")
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
      .select("-password -passwordHistory")
      .populate("department", "name code")
      .limit(20);

    return users;
  }

  // Change password
  // R7bb-FIX-A-3: legacy users.* surface. Adds reuse-block + tokenVersion
  // bump + best-effort audit emit. The new canonical surface lives at
  // POST /api/auth/change-password (authRoutes.js).
  async changePassword(userId, oldPassword, newPassword, req = null) {
    const user = await User.findById(userId);

    if (!user) {
      throw new Error("User not found");
    }

    const isMatch = await user.comparePassword(oldPassword);
    if (!isMatch) {
      throw new Error("Current password is incorrect");
    }

    // Reuse check — block the last 5 hashes.
    const reuse = await checkPasswordReuse(newPassword, user.passwordHistory || []);
    if (reuse.reused) {
      throw new Error("Cannot reuse a recent password");
    }

    user.archivePriorHash();
    user.password = newPassword;
    user.mustChangePassword = false;
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save();

    try {
      await userActivity.emit({
        event: "USER_PASSWORD_CHANGED",
        targetUser: user,
        actor: req?.user || user,
        ip: req?.ip,
        metadata: { source: "users.changePassword" },
      });
    } catch (_) { /* best-effort */ }

    return { message: "Password changed successfully" };
  }

  // Admin-initiated password reset (bypasses old-password check)
  // R7bb-FIX-A-15: bumps tokenVersion (kills every live session) and sets
  // mustChangePassword:true so the user is force-rotated on first login.
  async adminResetPassword(userId, newPassword, actor = null) {
    const user = await User.findById(userId);
    if (!user) throw new Error("User not found");
    // Reuse check + can't repeat current password.
    const reuse = await checkPasswordReuse(newPassword, user.passwordHistory || []);
    if (reuse.reused) {
      throw new Error("Cannot reuse a recent password");
    }
    user.archivePriorHash();
    user.password = newPassword;
    user.mustChangePassword = true;
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    user.failedLoginAttempts = 0;
    user.lockUntil = null;
    await user.save();

    try {
      await userActivity.emit({
        event: "USER_PASSWORD_RESET",
        targetUser: user,
        actor,
        metadata: { source: "userService.adminResetPassword" },
      });
    } catch (_) { /* best-effort */ }

    return { message: "Password reset successfully. User must change password on next login. All existing sessions revoked." };
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
