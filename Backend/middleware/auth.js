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
    // R7av-FIX-15/D2-HIGH-2: include `success:false` so the frontend
    // can distinguish 401 from server downtime via `response.data.success`.
    return res.status(401).json({ success: false, message: "Authentication required. Please login." });

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

    // R7as-FIX-10/D3-high (revised in R7at-FIX-7): JWT payload doesn't
    // include `fullName`, so ~15 controllers reading `req.user.fullName`
    // always fell through to hard-coded defaults ("Reception", "TPA Desk",
    // "Cashier") — every audit row lost the real cashier name. Load it
    // lazily via the read-through `lruCache.get(key, compute)` memoizer
    // so concurrent first-hits piggy-back on a single Mongo round-trip.
    //
    // R7at-FIX-7/D2-NEW-CRIT-1: pre-R7at this block called the non-
    // existent `_fullNameCache.set(key, value)` API — every request hit
    // the catch branch and FIX-10 silently no-op'd. Now uses the actual
    // read-through `get(key, compute)` shape exposed by `utils/lruCache.js`.
    if (decoded.id && !req.user.fullName) {
      try {
        if (!_fullNameCache) {
          _fullNameCache = require("../utils/lruCache")({ max: 500, ttlMs: 5 * 60_000 });
        }
        req.user.fullName = await _fullNameCache.get(String(decoded.id), async () => {
          const User = require("../models/User/userModel");
          const u = await User.findById(decoded.id).select("fullName employeeId").lean();
          return u?.fullName || u?.employeeId || decoded.employeeId || "";
        });
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
   R7az-A/D3-CRIT: doctor list-endpoint scope. Dual-mode: when called as a
   plain middleware (`router.use(restrictToOwnDoctorPatients)`) it attaches
   `req.scopeFilter = { attendingDoctorId: req.doctorProfile._id }` for
   downstream controllers to merge into their Mongo query. When called as
   a helper from inside a controller, `restrictToOwnDoctorPatients(req,
   filters, opts)` mutates and returns the filters object directly (legacy
   call shape used by admissionController). Both shapes NO-OP for non-
   Doctor roles. Default field is `attendingDoctorId` (the Admission/IPD
   convention) — pass `{ field: "doctorId" }` to scope an OPD/ER list. */
const restrictToOwnDoctorPatients = (...args) => {
  // Middleware shape: (req, res, next)
  if (args.length >= 2 && typeof args[args.length - 1] === "function") {
    const [req, _res, next] = args;
    if (req.user?.role === "Doctor" && req.doctorProfile?._id) {
      req.scopeFilter = Object.assign({}, req.scopeFilter, {
        attendingDoctorId: req.doctorProfile._id,
      });
    }
    return next();
  }
  // Helper shape: (req, filters, opts)
  const [req, filters = {}, opts = {}] = args;
  const { field = "attendingDoctorId" } = opts;
  if (req.user?.role === "Doctor" && req.doctorProfile?._id) {
    filters[field] = req.doctorProfile._id;
  }
  return filters;
};

/* ── Nurse-ward scope filter ──
   R7az-A/D9-CRIT: nurse list-endpoint scope. Attaches
   `req.nurseWard = req.user.ward` and `req.scopeFilter = { "bed.ward":
   req.user.ward }` for downstream controllers that page through
   admissions / MAR / vitals / nursing notes. NO-OP for non-Nurse roles
   and when the Nurse user has no `ward` set (legacy users — controller
   should fail open until that's backfilled). User.ward field already
   exists per D3-CRIT-5. */
const restrictToOwnNurseWard = (req, _res, next) => {
  if (req.user?.role === "Nurse" && req.user?.ward) {
    req.nurseWard = req.user.ward;
    req.scopeFilter = Object.assign({}, req.scopeFilter, {
      "bed.ward": req.user.ward,
    });
  }
  return next();
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

/* ── R7az-A/D9-HIGH: Block Doctor/Nurse on financial write paths ──
   Defense-in-depth wall. Doctor and Nurse have legitimate read access to
   billing surfaces (price-on-bill, advance balance shown on the patient
   header, charge-trigger feed) but should never POST money. Adding
   action-level gates everywhere is brittle — this single mount in
   routes/index.js after authenticate covers every existing money-write
   plus the next one a controller author forgets to gate. Reads remain
   allowed.
   Path matching is suffix-aware against req.originalUrl (preserves /api
   prefix). Each rule narrows on method too so a Doctor can still GET
   the cashier session list / refund history. */
const BLOCK_DOCTOR_NURSE_FINANCIAL_ROLES = new Set(["Doctor", "Nurse"]);
const BLOCK_DOCTOR_NURSE_FINANCIAL_RULES = [
  // POST /api/billing/* writes
  { method: "POST",   regex: /\/billing\/[^?]*\/payment(\/|$)/ },
  { method: "POST",   regex: /\/billing\/[^?]*\/payment\/[^/]+\/void(\/|$)/ },
  { method: "POST",   regex: /\/billing\/[^?]*\/refund(\/|$)/ },
  { method: "POST",   regex: /\/billing\/[^?]*\/cancel(\/|$)/ },
  { method: "POST",   regex: /\/billing\/[^?]*\/settlement-adjust(\/|$)/ },
  { method: "POST",   regex: /\/billing\/credit-notes(\/|$)/ },
  // Advance pool: only refund + apply are money-moving — list/read remain open.
  { method: "POST",   regex: /\/billing\/advance(\/|$)/ },                  // create new advance
  { method: "POST",   regex: /\/billing\/advance\/[^/]+\/apply(\/|$)/ },
  { method: "POST",   regex: /\/billing\/advance\/[^/]+\/refund(\/|$)/ },
  // Cashier session write surface — open/close/etc.
  { method: "POST",   regex: /\/cashier-sessions(\/|$)/ },
  { method: "POST",   regex: /\/cashier-sessions\/[^/]+\/close(\/|$)/ },
  // Bulk UHID money paths
  { method: "POST",   regex: /\/billing\/uhid\/[^/]+\/collect-all(\/|$)/ },
  { method: "POST",   regex: /\/billing\/uhid\/[^/]+\/bulk-settle(\/|$)/ },
];
const blockNonClinicalForDoctorNurse = (req, res, next) => {
  if (!req.user) return next();
  if (!BLOCK_DOCTOR_NURSE_FINANCIAL_ROLES.has(req.user.role)) return next();
  // Only POST/PUT/PATCH/DELETE — GET stays unblocked so the patient
  // header can still display amount-due, advance balance, etc.
  if (!WRITE_METHODS.has(req.method)) return next();
  const url = req.originalUrl.split("?")[0];
  for (const rule of BLOCK_DOCTOR_NURSE_FINANCIAL_RULES) {
    if (rule.method === req.method && rule.regex.test(url)) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Financial writes are not permitted for role '${req.user.role}'. Contact the cashier desk.`,
        role: req.user.role,
        method: req.method,
        url,
      });
    }
  }
  return next();
};

/* ── R7az-A/D9-HIGH-10: enforceActivePatientForClinicalWrites ──
   Clinical write paths (doctor-notes / nurse-notes / MAR / vitals /
   consent-forms / discharge-summary) must reject POST/PUT/PATCH when
   the linked admission has `status === "Discharged"`. Discharged
   admissions are NABH MOI.1 sealed records — late edits silently
   corrupt the audit trail and unbalance any retroactive billing.
   Exception: header `X-Late-Entry: true` lets a dedicated ADDENDUM
   action through (the controller still records it as a late entry).
   Lookup priority: admissionId in body > ipdNo in body > admissionId
   in :params > UHID-based latest-active-admission lookup.
   Failures: 409 with code `PATIENT_DISCHARGED`.
   Soft-fail: if no admission can be located the middleware NOOPs (the
   controller's own validation handles missing-link errors). */
const ENFORCE_DISCHARGE_WRITE_RULES = [
  { method: "POST",   regex: /\/doctor-notes(\/|$|\?)/ },
  { method: "PUT",    regex: /\/doctor-notes\/[^/]+(\/|$|\?)/ },
  { method: "PATCH",  regex: /\/doctor-notes\/[^/]+\/[^/]+(\/|$|\?)/ },
  { method: "POST",   regex: /\/nurse-notes(\/|$|\?)/ },
  { method: "PUT",    regex: /\/nurse-notes\/[^/]+(\/|$|\?)/ },
  { method: "PATCH",  regex: /\/nurse-notes\/[^/]+\/[^/]+(\/|$|\?)/ },
  { method: "POST",   regex: /\/nursing-notes(\/|$|\?)/ },
  { method: "POST",   regex: /\/mar(\/|$|\?)/ },
  { method: "PUT",    regex: /\/mar\/[^/]+(\/|$|\?)/ },
  { method: "PATCH",  regex: /\/mar\/[^/]+\/[^/]+(\/|$|\?)/ },
  { method: "POST",   regex: /\/vitalsheet(\/|$|\?)/ },
  { method: "PUT",    regex: /\/vitalsheet\/[^/]+(\/|$|\?)/ },
  { method: "POST",   regex: /\/consent-forms(\/|$|\?)/ },
  { method: "PUT",    regex: /\/consent-forms\/[^/]+(\/|$|\?)/ },
  { method: "POST",   regex: /\/discharge-summary(\/|$|\?)/ },
  { method: "PUT",    regex: /\/discharge-summary\/[^/]+(\/|$|\?)/ },
];
const enforceActivePatientForClinicalWrites = async (req, res, next) => {
  try {
    if (!WRITE_METHODS.has(req.method)) return next();
    const url = req.originalUrl.split("?")[0];
    const matched = ENFORCE_DISCHARGE_WRITE_RULES.some(
      (r) => r.method === req.method && r.regex.test(url),
    );
    if (!matched) return next();
    // Late-entry escape hatch — controller must still record the addendum
    // explicitly. Per spec, an "ADDENDUM" action with X-Late-Entry: true.
    if (String(req.headers["x-late-entry"] || "").toLowerCase() === "true") {
      return next();
    }

    const body = req.body || {};
    const params = req.params || {};
    const Admission = require("../models/Patient/admissionModel");

    let admission = null;
    const admId = body.admissionId || params.admissionId || params.id;
    const ipdNo = body.ipdNo || params.ipdNo;
    const uhid  = body.UHID || body.uhid || params.uhid;

    // Prefer the most specific identifier the request actually carries.
    if (admId && typeof admId === "string" && /^[a-f0-9]{24}$/i.test(admId)) {
      admission = await Admission.findById(admId).select("status").lean();
    }
    if (!admission && ipdNo) {
      admission = await Admission.findOne({ admissionNumber: ipdNo })
        .select("status").lean();
    }
    if (!admission && uhid) {
      // Fall back to the most recent admission on this UHID — if it's
      // discharged we still block (per design, late edits on the last
      // admission are exactly the case D9-HIGH-10 was raised for).
      admission = await Admission.findOne({ UHID: String(uhid).toUpperCase() })
        .sort({ admissionDate: -1 })
        .select("status").lean();
    }
    // Soft-fail when nothing matched — controller-level validation will
    // catch the missing reference and the gate stays out of the way for
    // truly UHID-less clinical surfaces (e.g. OPD that doesn't carry an
    // admission link).
    if (!admission) return next();

    if (admission.status === "Discharged") {
      return res.status(409).json({
        success: false,
        code: "PATIENT_DISCHARGED",
        message:
          "This admission is Discharged — clinical writes are sealed. " +
          "Use an ADDENDUM with header X-Late-Entry: true if a correction is required.",
      });
    }
    return next();
  } catch (e) {
    // Never block the request on a middleware lookup failure — the
    // controller's own checks will still gate the write.
    console.warn("[enforceActivePatientForClinicalWrites] skipped:", e.message);
    return next();
  }
};

module.exports = {
  authenticate,
  authorize,
  adminOnly,
  requireAction,
  attemptAuth,
  attachDoctorProfile,
  restrictToOwnDoctorPatients,
  restrictToOwnNurseWard,
  blockReadOnlyRoleWrites,
  blockNonClinicalForDoctorNurse,
  enforceActivePatientForClinicalWrites,
};
