const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET;

// R7as-FIX-10: per-process LRU for User.fullName resolution. Loaded
// lazily on first authenticate() so most requests hit cache (5min TTL).
let _fullNameCache = null;

/* ── Verify JWT token ──
   Supports both the Authorization: Bearer header (preferred) and
   a `?token=` query parameter — the latter is required for
   EventSource / SSE streams, which can't set custom headers. */
const authenticate = async (req, res, next) => {
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
    // Revocation list check (audit B-10). A logged-out / compromised
    // token still parses cleanly until `exp`, so we look it up by
    // `jti`. Pre-B-10 tokens lack the jti claim — those bypass the
    // check (graceful upgrade; they'll expire within 8h anyway).
    if (decoded.jti) {
      try {
        const TokenRevocation = require("../models/Auth/TokenRevocationModel");
        const revoked = await TokenRevocation.exists({ jti: decoded.jti });
        if (revoked) {
          return res.status(401).json({ message: "Session revoked. Please login again." });
        }
      } catch (e) {
        // Lookup failed (e.g. Mongo blip) — fail open so a transient DB
        // problem doesn't lock the entire hospital out. Log loud.
        console.error("[auth] revocation lookup failed:", e.message);
      }
    }
    // R7ar-P0-1/D3-aq-01: JWT payload uses `id` (set at sign-time in
    // authRoutes.js) but many controllers were written using `req.user._id`
    // (mongoose convention). Expose BOTH keys so neither convention misfires
    // — undefined `_id` previously broke F20 CashierSession (every cashier
    // shared one row), and zeroed `receivedById` on every payment audit.
    req.user = { ...decoded, _id: decoded.id }; // { id, _id, role, employeeId, jti, iat, exp }

    // R7as-FIX-10/D3-high: JWT payload doesn't include `fullName`, so
    // ~15 controllers reading `req.user.fullName` always fell through to
    // hard-coded defaults ("Reception", "TPA Desk", "Cashier") — every
    // audit row lost the real cashier name. Load it lazily from the User
    // collection on first auth in a short-lived in-process LRU cache so
    // it doesn't add 1ms per request. Cache TTL is short (5 min) so a
    // mid-session profile rename surfaces quickly.
    if (decoded.id && !req.user.fullName) {
      try {
        if (!_fullNameCache) _fullNameCache = require("../utils/lruCache")({ max: 500, ttlMs: 5 * 60_000 });
        let name = _fullNameCache.get(String(decoded.id));
        if (name === undefined) {
          const User = require("../models/User/userModel");
          const u = await User.findById(decoded.id).select("fullName employeeId").lean();
          name = u?.fullName || u?.employeeId || decoded.employeeId || "";
          _fullNameCache.set(String(decoded.id), name);
        }
        req.user.fullName = name;
      } catch (e) {
        // best-effort — if user-collection lookup fails, fall through to
        // the existing behaviour (hard-coded defaults in callers).
        console.warn("[auth] fullName resolve skipped:", e.message);
      }
    }
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
    const _decoded = jwt.verify(authHeader.split(" ")[1], JWT_SECRET);
    req.user = { ..._decoded, _id: _decoded.id };  // R7ar-P0-1: expose both id + _id
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

/* ── R7i: Read-only role write-blocker ──
   Defense-in-depth for the MRD (Medical Records Department) role.
   MRD is a paperless-archive role: its members can READ every patient
   file but must never WRITE anything. The clean way to enforce that
   would be to put `requireAction(...)` on every mutating endpoint in
   the codebase, but the audit found 15+ clinical write endpoints
   (nurse notes, doctor notes, MAR, discharge summary, consents, …)
   that don't yet have action gates. Adding gates one-by-one risks
   breaking existing role flows that depend on the current loose
   behaviour.
   This middleware fixes the MRD-specific hole without touching any
   other role: if the authenticated user is MRD and the request uses
   a mutating verb (POST/PUT/PATCH/DELETE), reject it with 403.
   Mount it globally AFTER `authenticate` so req.user is populated.

   Exceptions (allow-list): MRD users still need to write a few
   harmless "I viewed this file" audit-log entries. Those paths
   are whitelisted below — they create read-only audit records
   that *describe* MRD access, not patient data.
*/
const READ_ONLY_ROLES = new Set(["MRD"]);
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
// Each entry is { method, suffix } — suffix is matched against the
// END of req.originalUrl (so /api prefix is implicit). Keep this
// list TINY and audit-friendly.
const READ_ONLY_WRITE_ALLOWLIST = [
  // Activity logger — patient-file viewing events. Audit trail of
  // who looked at what. Records MRD activity, not patient data.
  { method: "POST", regex: /\/patient-file\/[^/]+\/log\/?$/ },
];
const blockReadOnlyRoleWrites = (req, res, next) => {
  if (!req.user) return next();
  if (!READ_ONLY_ROLES.has(req.user.role)) return next();
  if (!WRITE_METHODS.has(req.method)) return next();
  // Match the allow-list on req.originalUrl (preserves the /api prefix).
  const url = req.originalUrl.split("?")[0];
  for (const rule of READ_ONLY_WRITE_ALLOWLIST) {
    if (rule.method === req.method && rule.regex.test(url)) return next();
  }
  return res.status(403).json({
    message: `Access denied. Role '${req.user.role}' is read-only.`,
    role: req.user.role,
    method: req.method,
    url,
  });
};

module.exports = {
  authenticate,
  authorize,
  adminOnly,
  requireAction,
  attemptAuth,
  attachDoctorProfile,
  restrictToOwnDoctorPatients,
  blockReadOnlyRoleWrites,
};
