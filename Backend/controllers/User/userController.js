const userService = require("../../services/User/userService");
const userActivity = require("../../services/User/userActivityLogger");
const User = require("../../models/User/userModel");
const { validatePassword } = require("../../utils/passwordPolicy");

// R7bb-FIX-A-9: helper — load a user (lean projection) without the password
// blob so we can attach `before` snapshots on UserActivityLog rows.
async function snapshotUser(id) {
  try {
    return await User.findById(id)
      .select("-password -passwordHistory -signature")
      .lean();
  } catch (_) { return null; }
}

class UserController {
  // Create user
  async createUser(req, res) {
    try {
      const user = await userService.createUser(req.body, req.user);
      // R7bb-FIX-A-9/D10-CRIT-3: HR event — onboarding trail.
      try {
        await userActivity.emit({
          event: "USER_CREATED",
          targetUser: user,
          actor: req.user,
          ip: req.ip,
          after: {
            role: user.role,
            email: user.email,
            employeeId: user.employeeId,
            department: user.department,
            ward: user.ward,
            status: user.status,
          },
          metadata: { source: "userController.createUser" },
        });
      } catch (_) { /* best-effort */ }

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
      const before = await snapshotUser(req.params.id);
      const user = await userService.updateUser(
        req.params.id,
        req.body,
        req.user?.id
      );
      // R7bb-FIX-A-9/D10-HIGH-7: diff-aware HR events. The base UPDATE row
      // always fires; specialized rows (ROLE_CHANGED / DEACTIVATED /
      // TERMINATED) fire in addition when the relevant fields flip, so an
      // HR reviewer can grep on the precise event type.
      try {
        await userActivity.emit({
          event: "USER_UPDATED",
          targetUser: user,
          actor: req.user,
          ip: req.ip,
          before,
          after: {
            role: user.role,
            department: user.department,
            ward: user.ward,
            status: user.status,
            isActive: user.isActive,
            designation: user.doctorDetails?.designation,
          },
        });
        // Role change?  (Spec: separate ROLE_CHANGE event.)
        if (before && before.role !== user.role) {
          await userActivity.emit({
            event: "USER_ROLE_CHANGED",
            targetUser: user,
            actor: req.user,
            ip: req.ip,
            before: { role: before.role },
            after:  { role: user.role },
          });
          // R7bb-FIX-A-4: bump tokenVersion on role change so any
          // existing sessions can't keep elevated privileges.
          await User.findByIdAndUpdate(user._id, { $inc: { tokenVersion: 1 } });
        }
        // isActive flipped to false?
        if (before && before.isActive === true && user.isActive === false) {
          await userActivity.emit({
            event: "USER_DEACTIVATED",
            targetUser: user,
            actor: req.user,
            ip: req.ip,
            before: { isActive: true, status: before.status },
            after:  { isActive: false, status: user.status },
          });
        }
        // Status flipped to Terminated?
        if (before && before.status !== "Terminated" && user.status === "Terminated") {
          await userActivity.emit({
            event: "USER_TERMINATED",
            targetUser: user,
            actor: req.user,
            ip: req.ip,
            before: { status: before.status },
            after:  { status: "Terminated", departureDate: user.departureDate, terminationReason: user.terminationReason },
          });
        }
      } catch (_) { /* best-effort */ }

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
      const before = await snapshotUser(req.params.id);
      const user = await userService.deactivateUser(req.params.id);
      try {
        await userActivity.emit({
          event: "USER_DEACTIVATED",
          targetUser: user,
          actor: req.user,
          ip: req.ip,
          before: { isActive: before?.isActive, status: before?.status },
          after:  { isActive: false, status: "Inactive" },
        });
      } catch (_) { /* best-effort */ }
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
      const before = await snapshotUser(req.params.id);
      const user = await userService.activateUser(req.params.id);
      try {
        await userActivity.emit({
          event: "USER_REACTIVATED",
          targetUser: user,
          actor: req.user,
          ip: req.ip,
          before: { isActive: before?.isActive, status: before?.status },
          after:  { isActive: true, status: "Active" },
        });
      } catch (_) { /* best-effort */ }
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

  // R7bb-FIX-A-10/D10-CRIT-2: dedicated terminate endpoint. Sets status to
  // `Terminated` + isActive:false, stamps departureDate / terminationReason,
  // and bumps tokenVersion (kills every active token for this user).
  async terminateUser(req, res) {
    try {
      const { reason, departureDate } = req.body || {};
      const before = await snapshotUser(req.params.id);
      const user = await userService.terminateUser(req.params.id, { reason, departureDate });
      try {
        await userActivity.emit({
          event: "USER_TERMINATED",
          targetUser: user,
          actor: req.user,
          ip: req.ip,
          before: { isActive: before?.isActive, status: before?.status },
          after: { isActive: false, status: "Terminated", departureDate: user.departureDate, terminationReason: user.terminationReason },
          metadata: { reason },
        });
      } catch (_) { /* best-effort */ }
      res.status(200).json({
        success: true,
        message: "User terminated. All active sessions revoked.",
        data: user,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Get all doctors (paginated)
  async getAllDoctors(req, res) {
    try {
      const { doctors, pagination } = await userService.getAllDoctors(req.query);
      res.status(200).json({
        success: true,
        count: doctors.length,
        pagination,
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
      try {
        await userActivity.emit({
          event: "USER_HOD_ASSIGNED",
          targetUser: user,
          actor: req.user,
          ip: req.ip,
          metadata: { departmentId },
        });
      } catch (_) { /* best-effort */ }
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
  // R7bb-FIX-A-15/D9-HIGH-7: revoke all existing sessions on reset and force
  // first-login rotation; enforce the NABH-grade complexity policy.
  async adminResetPassword(req, res) {
    try {
      const { password } = req.body;
      const v = validatePassword(password);
      if (!v.ok) {
        return res.status(400).json({
          success: false,
          message: "Password does not meet policy",
          reasons: v.reasons,
        });
      }
      const result = await userService.adminResetPassword(req.params.id, password, req.user);
      // The service handles the audit emit + tokenVersion bump.
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
      try {
        await userActivity.emit({
          event: "USER_SIGNATURE_UPDATED",
          targetUser: user,
          actor: req.user,
          ip: req.ip,
        });
      } catch (_) { /* best-effort */ }
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
  // R7bb-FIX-A-3: kept for backward-compat with the existing PUT
  // /api/users/change-password route. The new canonical surface is
  // POST /api/auth/change-password (authRoutes.js) which also bumps
  // tokenVersion and clears mustChangePassword.
  async changePassword(req, res) {
    try {
      const { oldPassword, newPassword } = req.body;

      if (!oldPassword || !newPassword) {
        return res.status(400).json({
          success: false,
          message: "Old password and new password are required",
        });
      }

      const v = validatePassword(newPassword);
      if (!v.ok) {
        return res.status(400).json({
          success: false,
          message: "Password does not meet policy",
          reasons: v.reasons,
        });
      }

      const result = await userService.changePassword(
        req.user.id,
        oldPassword,
        newPassword,
        req
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

  // GET /api/users/:id/activity
  // R7bb-FIX-B-8/D7-HIGH-6: cross-collection activity feed for a single
  // user. Aggregates the last N events from three sources:
  //   • BillingAudit       — every money-touching event the user performed
  //   • PatientActivityLog — every patient-file action
  //   • UserActivityLog    — every identity/access lifecycle event affecting
  //                          this user (their account was created, locked,
  //                          terminated, etc.)
  // Merged by createdAt desc, capped at 100 rows total. Route is gated by
  // `users.read` (per spec note "Agent C will gate"); the controller itself
  // does no additional check beyond requiring an authenticated viewer.
  async getUserActivity(req, res) {
    try {
      const mongoose = require("mongoose");
      const targetId = req.params.id;
      if (!mongoose.isValidObjectId(targetId)) {
        return res.status(400).json({ success: false, message: "User id must be a valid ObjectId" });
      }
      const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
      const BillingAudit    = require("../../models/Billing/BillingAudit");
      const PatientActivity = require("../../models/Clinical/PatientActivityLogModel");
      let UserActivityLog = null;
      try { UserActivityLog = require("../../models/User/UserActivityLog"); }
      catch (_) { UserActivityLog = null; }

      const oid = new mongoose.Types.ObjectId(targetId);

      // Three parallel reads — each capped at `limit` rows so the merge
      // remains bounded even when the user is highly active.
      const [billing, patient, userLog] = await Promise.all([
        BillingAudit.find({ actorId: oid })
          .sort({ createdAt: -1 })
          .limit(limit)
          .select({ before: 0, after: 0 })
          .lean()
          .catch(() => []),
        PatientActivity.find({ userId: oid })
          .sort({ createdAt: -1 })
          .limit(limit)
          .select({ before: 0, after: 0, prevHash: 0, rowHash: 0 })
          .lean()
          .catch(() => []),
        UserActivityLog
          ? UserActivityLog.find({ $or: [{ actorUserId: oid }, { targetUserId: oid }] })
              .sort({ createdAt: -1 })
              .limit(limit)
              .select({ before: 0, after: 0 })
              .lean()
              .catch(() => [])
          : Promise.resolve([]),
      ]);

      // Tag each row with its source so the UI can icon-code the feed.
      const merged = [
        ...billing.map((r) => ({ ...r, _source: "BillingAudit" })),
        ...patient.map((r) => ({ ...r, _source: "PatientActivityLog" })),
        ...userLog.map((r) => ({ ...r, _source: "UserActivityLog" })),
      ];
      merged.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
      const capped = merged.slice(0, limit);

      res.json({
        success: true,
        data:    capped,
        meta:    {
          count:   capped.length,
          limit,
          sources: {
            billing: billing.length,
            patient: patient.length,
            userLog: userLog.length,
          },
        },
      });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message || "User activity fetch failed" });
    }
  }
}

module.exports = new UserController();
