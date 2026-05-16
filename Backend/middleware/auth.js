const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET;

/* ── Verify JWT token ──
   Supports both the Authorization: Bearer header (preferred) and
   a `?token=` query parameter — the latter is required for
   EventSource / SSE streams, which can't set custom headers. */
const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;
  let token = null;

  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.split(" ")[1];
  } else if (req.query && req.query.token) {
    token = String(req.query.token);
  }

  if (!token)
    return res.status(401).json({ message: "Authentication required. Please login." });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // { id, role, employeeId }
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError")
      return res.status(401).json({ message: "Session expired. Please login again." });
    return res.status(401).json({ message: "Invalid token. Please login." });
  }
};

/* ── Role-based access: authorize(...roles) ── */
const authorize = (...roles) => (req, res, next) => {
  if (!req.user)
    return res.status(401).json({ message: "Not authenticated" });
  if (!roles.includes(req.user.role))
    return res.status(403).json({
      message: `Access denied. Required role: ${roles.join(" or ")}. Your role: ${req.user.role}`,
    });
  next();
};

/* ── Admin only shorthand ── */
const adminOnly = authorize("Admin");

/* ── Fine-grained action gate ──
   requireAction("pharmacy.dispense") — checks Backend/config/permissions.js.
   This is the server-side mirror of the frontend `can(action)` helper.
   Use this for any sensitive write endpoint; the action key MUST match the
   token defined in both Backend/config/permissions.js and
   Frontend/src/config/permissions.js (they are intentionally identical). */
const { roleCan } = require("../config/permissions");
const requireAction = (action) => (req, res, next) => {
  if (!req.user)
    return res.status(401).json({ message: "Not authenticated" });
  if (!roleCan(req.user.role, action))
    return res.status(403).json({
      message: `Access denied. Action '${action}' is not permitted for role '${req.user.role}'.`,
      action,
      role: req.user.role,
    });
  next();
};

/* ── Soft authentication ──
   Try to verify the token but never block the request — if no/invalid
   token, req.user is left undefined and the request proceeds. Use this
   on endpoints that want to APPLY role-based filtering when a doctor is
   logged in, but still serve broader data to reception/admin. */
const attemptAuth = (req, _res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) return next();
  try {
    req.user = jwt.verify(authHeader.split(" ")[1], JWT_SECRET);
  } catch (e) { /* ignore — leave req.user undefined */ }
  next();
};

/* ── Resolve the doctor profile for the logged-in user ──
   Looks up the Doctor doc whose loginUserId === req.user.id and attaches
   it to req.doctorProfile. Used by OPD/IPD/ER list endpoints so they can
   auto-restrict to "only this doctor's patients" when role === "Doctor".
   No-op for non-Doctor roles. */
const attachDoctorProfile = async (req, _res, next) => {
  try {
    if (req.user?.role === "Doctor" && req.user?.id) {
      const Doctor = require("../models/Doctor/doctorModel");
      const doc = await Doctor.findOne({ loginUserId: req.user.id })
        .select("_id doctorId personalInfo professional department")
        .lean();
      if (doc) req.doctorProfile = doc;
    }
    next();
  } catch (e) { next(e); }
};

/* ── Doctor-scope filter helper ──
   Given the existing filters object (Mongo query), inject the appropriate
   doctor predicate when the caller is a Doctor user, so list endpoints
   only return that doctor's patients. Returns the (possibly mutated)
   filters. NO-OP for any other role. */
const restrictToOwnDoctorPatients = (req, filters = {}, opts = {}) => {
  const { field = "doctorId" } = opts;
  if (req.user?.role === "Doctor" && req.doctorProfile?._id) {
    filters[field] = req.doctorProfile._id;
  }
  return filters;
};

module.exports = {
  authenticate,
  authorize,
  adminOnly,
  requireAction,
  attemptAuth,
  attachDoctorProfile,
  restrictToOwnDoctorPatients,
};
