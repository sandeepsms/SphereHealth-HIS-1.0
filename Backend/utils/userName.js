/**
 * userName.js — async resolver for "who did this" name stamping.
 *
 * Background: the JWT issued by /auth/login only carries
 * `{ id, role, employeeId }`, so any controller that tried to read
 * `req.user.fullName / firstName / lastName` was silently coming up
 * empty and stamping "Unknown" into createdByName / requestedByName /
 * reportedByName audit fields.
 *
 * This helper does one User.findById() per write so the name fields
 * are populated correctly. The User model is required lazily to avoid
 * a circular dependency at boot time.
 *
 *   const resolveUserName = require("../../utils/userName");
 *   body.createdByName = await resolveUserName(req);
 *
 * Falls back to "Unknown" only when the user record genuinely cannot
 * be found.
 */
module.exports = async function resolveUserName(req, fallback = "Unknown") {
  if (req?.user?.fullName) return req.user.fullName;
  const composed = `${req?.user?.firstName || ""} ${req?.user?.lastName || ""}`.trim();
  if (composed) return composed;
  if (!req?.user?.id) return fallback;
  try {
    const User = require("../models/User/userModel");
    const u = await User.findById(req.user.id)
      .select("fullName firstName lastName")
      .lean();
    if (!u) return fallback;
    return u.fullName ||
      `${u.firstName || ""} ${u.lastName || ""}`.trim() ||
      fallback;
  } catch {
    return fallback;
  }
};
