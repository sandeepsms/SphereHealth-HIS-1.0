// services/User/userActivityLogger.js
// ════════════════════════════════════════════════════════════════════
// R7bb-C/D7-HIGH-3: thin emitter for UserActivityLog rows. Mirrors
// BillingAudit.emit() — best-effort, never throws to the caller because
// losing an audit row is never worse than failing the originating user
// operation. Agent D consumes this from userController + userService
// for every USER_* lifecycle event.
//
// Usage:
//   const userActivity = require("../../services/User/userActivityLogger");
//   await userActivity.emit({
//     event: "USER_CREATED",
//     targetUser: newUser,                           // any doc with _id + employeeId
//     actor: req.user,                               // { _id, role, fullName }
//     ip: req.ip,
//     before: null,
//     after: { fullName, role, department },         // do NOT include password
//     metadata: { reason: "Onboarding new resident" },
//   });
// ════════════════════════════════════════════════════════════════════
const UserActivityLog = require("../../models/User/UserActivityLog");

exports.emit = async function({ event, targetUser, actor, before, after, metadata, ip }) {
  try {
    await UserActivityLog.create({
      event,
      targetUserId: targetUser?._id,
      targetUserEmployeeId: targetUser?.employeeId,
      actorUserId: actor?._id || actor?.id,
      actorRole: actor?.role,
      actorName: actor?.fullName,
      actorIp: ip,
      before, after, metadata,
    });
  } catch (e) { console.error("[userActivityLogger]", e.message); }
};
