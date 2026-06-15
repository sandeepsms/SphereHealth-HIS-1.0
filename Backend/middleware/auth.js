const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET;

// R7as-FIX-10: per-process LRU for User.fullName resolution. Loaded
// lazily on first authenticate() so most requests hit cache (5min TTL).
let _fullNameCache = null;

// R7bb-A: per-process LRU for the per-request User status/tokenVersion
// re-check. 60s TTL — short enough that a terminate/role-change/logout-all
// takes effect within a minute on every node, long enough that the hot
// auth path doesn't hammer Mongo.
let _userStatusCache = null;

// R7bb-FIX-A-6/S14: tokens in `?token=` query strings end up in proxy
// access logs, browser history, and Referer headers. Restrict the practice
// to the SSE endpoints that genuinely need it (SSE — can't set Authorization
// header):
//   /api/bedss/events           — bed live-update SSE stream
//   /api/live-updates/*         — generic SSE channel
//   /api/billing/audit/stream   — billing-audit SSE channel
// Everywhere else, the query token is silently dropped.
const QUERY_TOKEN_ALLOWED_REGEX = [
  /^\/api\/live-updates\//,
  /^\/api\/bedss\/events/,
  /^\/api\/billing\/audit\/stream/,
];
function _queryTokenAllowed(reqPath) {
  return QUERY_TOKEN_ALLOWED_REGEX.some(rx => rx.test(reqPath));
}

/* ── Verify JWT token ──
   Supports both the Authorization: Bearer header (preferred) and
   a `?token=` query parameter — the latter is required for
   EventSource / SSE streams, which can't set custom headers. */
const authenticate = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  let token = null;

  if (authHeader && authHeader.startsWith("Bearer ")) {
    // R7br: trim + split on whitespace so "Bearer  token" (double space) or
    // "Bearer\ttoken" doesn't yield an empty token slot.
    token = authHeader.trim().split(/\s+/)[1] || null;
  } else if (req.query && req.query.token && _queryTokenAllowed(req.originalUrl || req.path)) {
    // R7bb-A: query-token only honored on whitelisted SSE prefixes; anywhere
    // else it's ignored so tokens don't leak into proxy logs / browser history.
    token = String(req.query.token);
  }

  if (!token)
    // R7br: include `code: NO_TOKEN` so the frontend interceptor classifies
    // this as a deliberate session-end (HARD_LOGOUT_CODES) — not a transient
    // blip. Pre-R7br this was a code-less 401 that ticked the transient
    // counter and intermittently held the user on the page for one more
    // request before redirecting.
    return res.status(401).json({ success: false, code: "NO_TOKEN", message: "Authentication required. Please login." });

  try {
    // R7bb-followup/FIX-A-16: JWT_SECRET rotation procedure needs a
    // SECONDARY_JWT_SECRETS env array for graceful rollover. Today every
    // node verifies against a single secret — rotating the secret forces
    // every active user to re-login (8h validity window). Future: try the
    // current secret, then fall back to each secondary secret for the
    // duration of the rotation window. Tokens signed by retired secrets
    // are rejected once their grace period passes.
    // R7br: clockTolerance:10 absorbs ≤10s skew between the Node server
    // clock and the JWT iat claim. Pre-R7br any drift (even 1s in the
    // future) immediately threw and forced a logout. Default is 0 (zero
    // tolerance). 10s matches typical NTP drift on production hosts.
    const decoded = jwt.verify(token, JWT_SECRET, { clockTolerance: 10 });

    // R7bb-A: per-request user re-check. Without this, a token issued at
    // 09:00 stays valid until exp even if the user is terminated at 09:05,
    // their role is changed, or they hit logout-all-devices on another
    // device. 60s LRU keeps Mongo load flat. Failures here are AUTHN
    // rejections, so they precede the (best-effort) revocation lookup.
    if (decoded.id) {
      try {
        if (!_userStatusCache) {
          _userStatusCache = require("../utils/lruCache")({ max: 500, ttlMs: 60_000 });
        }
        const u = await _userStatusCache.get(String(decoded.id), async () => {
          const User = require("../models/User/userModel");
          // R7bb-FIX-A-4/D9-CRIT-1: include `phone` so the 2FA controller
          // (req.user.phone) can issue OTPs without a second Mongo round-
          // trip per request. Also include `mustChangePassword` so any
          // mutating endpoint can refuse writes until the forced-rotation
          // modal is dismissed on the frontend (defense in depth).
          return await User.findById(decoded.id)
            .select("isActive status tokenVersion ward wards designation specializations role phone mustChangePassword fullName employeeId doctorDetails.designation")
            .lean();
        });
        if (!u) {
          return res.status(401).json({ success: false, code: "USER_DELETED", message: "Account no longer exists." });
        }
        const inactive = u.isActive === false
          || u.status === "Terminated"
          || u.status === "Suspended"
          || u.status === "Inactive";
        if (inactive) {
          return res.status(401).json({ success: false, code: "ACCOUNT_INACTIVE", message: "Account is not active. Contact admin." });
        }
        if ((decoded.tokenVersion || 0) !== (u.tokenVersion || 0)) {
          return res.status(401).json({ success: false, code: "TOKEN_STALE", message: "Session no longer valid. Please login again." });
        }
        // Stash DB-fresh fields onto decoded so the req.user augmentation
        // below pulls from Mongo (not the possibly-stale JWT payload).
        decoded._dbWard           = u.ward || null;
        decoded._dbWards          = u.wards || [];
        decoded._dbDesignation    = u.designation || u.doctorDetails?.designation || null;
        decoded._dbSpecializations = u.specializations || [];
        decoded._dbPhone          = u.phone || null;
        decoded._dbMustChangePw   = u.mustChangePassword === true;
        decoded._dbFullName       = u.fullName || null;
      } catch (e) {
        // Mongo blip — fail open (don't lock the hospital out); log loud.
        console.error("[auth] user re-check failed:", e.message);
      }
    }

    // Revocation list check (audit B-10). A logged-out / compromised
    // token still parses cleanly until `exp`, so we look it up by
    // `jti`. Pre-B-10 tokens lack the jti claim — those bypass the
    // check (graceful upgrade; they'll expire within 8h anyway).
    if (decoded.jti) {
      try {
        const TokenRevocation = require("../models/Auth/TokenRevocationModel");
        const revoked = await TokenRevocation.exists({ jti: decoded.jti });
        if (revoked) {
          // R7br: TOKEN_REVOKED is already a HARD_LOGOUT_CODE on the
          // frontend; tag the response so the interceptor logs the user
          // out immediately (no transient-counter delay).
          return res.status(401).json({ success: false, code: "TOKEN_REVOKED", message: "Session revoked. Please login again." });
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
    // R7bb-FIX-A-4: surface DB-fresh ward/designation/specializations/phone
    // so middlewares and controllers (esp. nurse-ward scope, doctor-
    // designation gates, 2FA OTP target) read the CURRENT value — not
    // whatever was true when the JWT was issued. Fields are named without
    // the `_db` prefix on req.user for backward-compatible controller code
    // (e.g. restrictToOwnNurseWard reads req.user.ward, twoFactorController
    // reads req.user.phone).
    if (decoded._dbWard           !== undefined) req.user.ward           = decoded._dbWard;
    if (decoded._dbWards          !== undefined) req.user.wards          = decoded._dbWards;
    if (decoded._dbDesignation    !== undefined) req.user.designation    = decoded._dbDesignation;
    if (decoded._dbSpecializations!== undefined) req.user.specializations = decoded._dbSpecializations;
    if (decoded._dbPhone          !== undefined) req.user.phone          = decoded._dbPhone;
    if (decoded._dbMustChangePw   !== undefined) req.user.mustChangePassword = decoded._dbMustChangePw;
    if (decoded._dbFullName       !== undefined && !req.user.fullName) req.user.fullName = decoded._dbFullName;

    // R7as-FIX-10/D3-high: ensure req.user.fullName is populated for the
    // ~15 audit-row callers that read it. The DB re-check above already
    // returns fullName when present; this _fullNameCache fallback path
    // covers the (rare) case where the cached row lacked the field.
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
    // R7br: both paths now carry a `code` field so the frontend interceptor
    // classifies them as HARD_LOGOUT (deliberate session-end). Pre-R7br
    // these were code-less 401s that ticked the transient counter, holding
    // the user on a broken page for one extra request before redirecting.
    if (err.name === "TokenExpiredError")
      return res.status(401).json({ success: false, code: "TOKEN_EXPIRED", message: "Session expired. Please login again." });
    return res.status(401).json({ success: false, code: "TOKEN_INVALID", message: "Invalid token. Please login." });
  }
};

/* ── Role-based access: authorize(...roles) ── */
const authorize = (...roles) => (req, res, next) => {
  if (!req.user)
    // R7au-4: include `code: NOT_AUTHENTICATED`. Defense in depth — this
    // path is normally unreachable because `authenticate` runs first, but
    // if a route mounts authorize() WITHOUT authenticate() (or via the
    // wrong order), a naked 401 here would tick the frontend's transient
    // counter and randomly logout users. With a code present the
    // interceptor classifies this as INTERNAL_NO_USER-equivalent.
    return res.status(500).json({ success: false, code: "INTERNAL_NO_USER", message: "Internal error — req.user not set after authenticate" });
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
    // R7au-4: same defense-in-depth as authorize() — if this fires it
    // means a route forgot to mount authenticate() upstream. Return 500
    // with INTERNAL_NO_USER so it's loud in the logs and the frontend
    // doesn't punt the user mid-workflow.
    return res.status(500).json({ success: false, code: "INTERNAL_NO_USER", message: "Internal error — req.user not set after authenticate" });
  if (!roleCan(req.user.role, action))
    return res.status(403).json({
      message: `Access denied. Action '${action}' is not permitted for role '${req.user.role}'.`,
      action,
      role: req.user.role,
    });
  next();
};

/**
 * R7hr-114 — requireAnyAction: passes if the user's role has ANY ONE of the
 * listed actions. Used on endpoints serving multiple roles via different
 * section semantics — e.g. /doctor-notes accepts BOTH doctor IA writes
 * (gated by doctor-orders.write) AND nurse IA writes (gated by nursing.write)
 * since R26 split. A single requireAction would lock out one role
 * regardless of which section they're saving.
 *
 * Controller-level role validation still applies: the doctorNotesService
 * filters noteDetails by section so a nurse can't write doctor blocks
 * even if she reaches the controller. The OR gate just opens the door.
 */
const requireAnyAction = (...actions) => (req, res, next) => {
  if (!req.user)
    return res.status(500).json({ success: false, code: "INTERNAL_NO_USER", message: "Internal error — req.user not set after authenticate" });
  const allowed = actions.some(a => roleCan(req.user.role, a));
  if (!allowed)
    return res.status(403).json({
      message: `Access denied. None of the required actions [${actions.join(", ")}] are permitted for role '${req.user.role}'.`,
      actions,
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
  // R7gw-B1-T06 — once global authenticate has populated req.user with DB-fresh
  // phone / fullName / mustChangePassword / wards, attemptAuth must NOT clobber.
  // OPDRoutes.js removed attemptAuth entirely for this reason (R7bb-B/D4-CRIT-S1).
  if (req.user) return next();
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) return next();
  try {
    const _decoded = jwt.verify(authHeader.split(" ")[1], JWT_SECRET);
    req.user = { ..._decoded, _id: _decoded.id };  // R7ar-P0-1: expose both id + _id
  } catch (e) { /* ignore — leave req.user undefined */ }
  next();
};

/* ── R7gw-B1-T07: requirePasswordRotated ──
   authenticate() above stashes req.user.mustChangePassword from a fresh DB
   read (line ~113 / ~159) for defense-in-depth, but until now no callsite
   actually enforced it. A user whose admin reset their password could bypass
   the frontend "change password" modal via devtools / a raw axios call and
   continue writing.
   This gate sits right after the global authenticate mount and rejects any
   mutating verb (POST/PUT/PATCH/DELETE) from a user with mustChangePassword
   still true. GETs stay open so the app shell can boot. The change-password
   endpoint itself is allow-listed so the user has a way OUT of the lockout. */
const WRITE_METHODS_FOR_PWD = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const requirePasswordRotated = (req, res, next) => {
  if (!req.user) return next(); // attemptAuth-style routes
  if (!req.user.mustChangePassword) return next();
  if (!WRITE_METHODS_FOR_PWD.has(req.method)) return next();
  // Allow the password-change endpoint itself
  if (req.path.startsWith('/auth/change-password') || req.path.startsWith('/auth/password')) return next();
  return res.status(403).json({
    success: false,
    code: 'PASSWORD_RESET_REQUIRED',
    message: 'Password rotation pending. Change your password before performing writes.',
  });
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
// ── R7gw-B2: Resolver helpers for discharge-write gate ──────────────────
// Each rule below carries an optional async resolveAdmissionId(req) that
// returns the admission _id this request mutates. Pre-B2 the runner only
// inspected body.admissionId / params.admissionId / params.id — which broke
// for sub-resource endpoints whose params.id is actually the MAR / order /
// care-plan document id, not the admission id. The lookup silently failed
// and discharged patients were writable through those surfaces.
//
// Resolvers may be sync or async. They must return either a 24-char hex
// ObjectId string (admission), an ObjectId-like value with toString(), or
// null when no admission can be identified — in which case the runner soft-
// fails (NOOP) unless the rule sets enforceStrict:true (then we reject).
const defaultResolver = (req) =>
  req.body?.admissionId || req.params?.admissionId || null;

const admissionParamResolver = (req) => req.params?.id || null;

// Pull the resource id out of req.path directly — the global mount of this
// middleware sits ABOVE the feature routers, so req.params is still empty
// when we run. req.path is the post-/api path (e.g. "/mar/<id>/medication/…").
const marUrlResolver = async (req) => {
  const m = req.path.match(/^\/mar\/([^/]+)\/medication/);
  if (!m) return null;
  try {
    const MAR = require("../models/Clinical/MARModel");
    const doc = await MAR.findById(m[1]).select("admissionId").lean();
    return doc?.admissionId || null;
  } catch (e) {
    console.warn("[discharge-gate] marUrlResolver failed:", e.message);
    return null;
  }
};

const docOrderByIdResolver = async (req) => {
  const m = req.path.match(/^\/doctor-orders\/([^/]+)\//);
  if (!m) return req.body?.admissionId || null;
  try {
    const DoctorOrder = require("../models/Doctor/DoctorOrderModel");
    const doc = await DoctorOrder.findById(m[1]).select("admissionId").lean();
    return doc?.admissionId || req.body?.admissionId || null;
  } catch (e) {
    console.warn("[discharge-gate] docOrderByIdResolver failed:", e.message);
    return req.body?.admissionId || null;
  }
};

// Post-sign amend on a doctor note carries only the note id in the URL —
// resolve the admission via the DoctorNotes doc so the discharge gate
// can fire on a discharged admission's amendment attempt.
const doctorNoteByIdResolver = async (req) => {
  const m = req.path.match(/^\/doctor-notes\/([^/]+)\//);
  if (!m) return req.body?.admissionId || null;
  try {
    const DoctorNotes = require("../models/Doctor/DoctorNotesModel");
    const doc = await DoctorNotes.findById(m[1]).select("admissionId").lean();
    return doc?.admissionId || req.body?.admissionId || null;
  } catch (e) {
    console.warn("[discharge-gate] doctorNoteByIdResolver failed:", e.message);
    return req.body?.admissionId || null;
  }
};

const prescriptionByIdResolver = async (req) => {
  const m = req.path.match(/^\/prescriptions\/([^/]+)/);
  if (!m) return req.body?.admissionId || null;
  try {
    const Prescription = require("../models/Doctor/prescription");
    const doc = await Prescription.findById(m[1]).select("admissionId").lean();
    return doc?.admissionId || req.body?.admissionId || null;
  } catch (e) {
    console.warn("[discharge-gate] prescriptionByIdResolver failed:", e.message);
    return req.body?.admissionId || null;
  }
};

const carePlanByIdResolver = async (req) => {
  const m = req.path.match(/^\/nursing-care-plans\/([^/]+)/);
  if (!m) return req.body?.admissionId || null;
  try {
    const NursingCarePlan = require("../models/Nurse/NursingCarePlanModel");
    const doc = await NursingCarePlan.findById(m[1]).select("admissionId").lean();
    return doc?.admissionId || req.body?.admissionId || null;
  } catch (e) {
    console.warn("[discharge-gate] carePlanByIdResolver failed:", e.message);
    return req.body?.admissionId || null;
  }
};

const icuBundleByIdResolver = async (req) => {
  const m = req.path.match(/^\/icu-bundles\/([^/]+)/);
  if (!m) return req.body?.admissionId || null;
  try {
    const ICUBundle = require("../models/Clinical/ICUBundleModel");
    const doc = await ICUBundle.findById(m[1]).select("admissionId").lean();
    return doc?.admissionId || req.body?.admissionId || null;
  } catch (e) {
    console.warn("[discharge-gate] icuBundleByIdResolver failed:", e.message);
    return req.body?.admissionId || null;
  }
};

// Pharmacy admission-linked sales (IPD + Homecare) — saleType not in
// {IPD, Homecare} rows (OPD walk-in, vendor returns) bypass via the
// rule.condition predicate. R7hr-12-S3 (D6-08): name kept as
// pharmacyIpdResolver for git-blame stability; resolver logic itself
// (read body.admissionId) is identical for IPD and Homecare.
const pharmacyIpdResolver = (req) => req.body?.admissionId || null;

// R7hr-12-S2 (D6-01): /pharmacy/sales/:id/add-items mutates an EXISTING
// PharmacySale — items[] is consumed from inventory and the parent sale's
// balanceDue / supplementRecord is mutated. The body carries NO saleType
// and NO admissionId, so the existing pharmacyIpdResolver + saleType=IPD
// condition pair leaks the supplement past the discharge gate. We resolve
// admissionId by looking up the parent Sale doc (admissionId is indexed
// on PharmacySaleSchema L102). enforceStrict so an unresolvable parent
// (deleted/garbage id) fails closed rather than being waved through.
const pharmacySaleByIdResolver = async (req) => {
  const m = req.path.match(/^\/pharmacy\/sales\/([^/]+)\/add-items/);
  if (!m) return null;
  try {
    const PharmacySale = require("../models/Pharmacy/PharmacySaleModel");
    const doc = await PharmacySale.findById(m[1]).select("admissionId").lean();
    return doc?.admissionId || null;
  } catch (e) {
    console.warn("[discharge-gate] pharmacySaleByIdResolver failed:", e.message);
    return null;
  }
};

// B3-T09 / PART B — UHID-path resolver. Real frontend prescription &
// nursing-assessment writes hit /prescriptions/uhid/:uhid (and similar)
// rather than the bare /prescriptions form. Pre-T09 the rule used
// defaultResolver which never inspected the URL, so the discharge-write
// gate silently let writes through even when the targeted patient was
// discharged. This resolver extracts the UHID from the path and looks
// up the latest Active/Discharged admission, then hands the admission _id
// to the gate runner. Falls back to body.admissionId when no UHID path
// segment is present.
const uhidPathResolver = async (req) => {
  const m = req.path.match(/\/uhid\/([^/?]+)/);
  if (!m) return req.body?.admissionId || null;
  try {
    const Admission = require("../models/Patient/admissionModel");
    const adm = await Admission.findOne({
      UHID: m[1],
      status: { $in: ["Active", "Discharged"] },
    })
      .sort({ admissionDate: -1 })
      .select("_id status")
      .lean();
    return adm?._id || null;
  } catch (e) {
    console.warn("[discharge-gate] uhidPathResolver failed:", e.message);
    return null;
  }
};

// R7hr-197 Phase 4 — resolvers for the previously-unsealed clinical-write
// surfaces. req.params is empty at this global mount, so each extracts ids
// from req.path / req.body and resolves the admission _id.
const medReconPathResolver = (req) => {
  // /med-reconciliation/admission/<24-hex>/...  — admissionId is in the path.
  const m = req.path.match(/\/admission\/([a-f0-9]{24})/i);
  return m ? m[1] : null;
};
const patientDeviceByIdResolver = async (req) => {
  const m = req.path.match(/\/patient-devices\/([a-f0-9]{24})/i);
  if (!m) return null;
  try {
    const PatientDevice = require("../models/Clinical/PatientDeviceModel");
    const doc = await PatientDevice.findById(m[1]).select("admissionId ipdNo").lean();
    if (doc?.admissionId) return doc.admissionId;
    if (doc?.ipdNo) {
      const Admission = require("../models/Patient/admissionModel");
      const adm = await Admission.findOne({ admissionNumber: doc.ipdNo }).select("_id").lean();
      return adm?._id || null;
    }
    return null;
  } catch (e) { console.warn("[discharge-gate] patientDeviceByIdResolver failed:", e.message); return null; }
};
const procedureNoteOrderResolver = async (req) => {
  // procedure-note create carries body.doctorOrderId → order.admissionId.
  const oid = req.body?.doctorOrderId;
  if (!oid || !/^[a-f0-9]{24}$/i.test(String(oid))) return req.body?.admissionId || null;
  try {
    const DoctorOrder = require("../models/Doctor/DoctorOrderModel");
    const o = await DoctorOrder.findById(oid).select("admissionId").lean();
    return o?.admissionId || req.body?.admissionId || null;
  } catch (e) { console.warn("[discharge-gate] procedureNoteOrderResolver failed:", e.message); return req.body?.admissionId || null; }
};
const _noteDeleteResolver = (modelPath, pathRe) => async (req) => {
  const m = req.path.match(pathRe);
  if (!m) return null;
  try {
    const Model = require(modelPath);
    const doc = await Model.findById(m[1]).select("admissionId ipdNo").lean();
    if (doc?.admissionId) return doc.admissionId;
    if (doc?.ipdNo) {
      const Admission = require("../models/Patient/admissionModel");
      const adm = await Admission.findOne({ admissionNumber: doc.ipdNo }).select("_id").lean();
      return adm?._id || null;
    }
    return null;
  } catch (e) { console.warn("[discharge-gate] note-delete resolver failed:", e.message); return null; }
};
const doctorNoteDeleteResolver = _noteDeleteResolver("../models/Doctor/DoctorNotesModel", /^\/doctor-notes\/([a-f0-9]{24})(\/|$)/i);
const nurseNoteDeleteResolver  = _noteDeleteResolver("../models/Nurse/NurseNotesModel",  /^\/nurse-notes\/([a-f0-9]{24})(\/|$)/i);

const ENFORCE_DISCHARGE_WRITE_RULES = [
  // ── R7az-A original surfaces ────────────────────────────────────────
  // Doctor-note POST /:id/amend is matched ahead of the bare-POST create
  // rule so the resolver can pull admissionId off the note doc (the amend
  // body doesn't carry admissionId — only the clinical overlay fields).
  { method: "POST",   regex: /\/doctor-notes\/[^/]+\/amend(\/|$|\?)/,          resolveAdmissionId: doctorNoteByIdResolver },
  { method: "POST",   regex: /\/doctor-notes(\/|$|\?)/,                        resolveAdmissionId: defaultResolver },
  { method: "PUT",    regex: /\/doctor-notes\/[^/]+(\/|$|\?)/,                 resolveAdmissionId: defaultResolver },
  { method: "PATCH",  regex: /\/doctor-notes\/[^/]+\/[^/]+(\/|$|\?)/,          resolveAdmissionId: defaultResolver },
  { method: "POST",   regex: /\/nurse-notes(\/|$|\?)/,                         resolveAdmissionId: defaultResolver },
  { method: "PUT",    regex: /\/nurse-notes\/[^/]+(\/|$|\?)/,                  resolveAdmissionId: defaultResolver },
  { method: "PATCH",  regex: /\/nurse-notes\/[^/]+\/[^/]+(\/|$|\?)/,           resolveAdmissionId: defaultResolver },
  { method: "POST",   regex: /\/nursing-notes(\/|$|\?)/,                       resolveAdmissionId: defaultResolver },
  { method: "POST",   regex: /\/mar(\/|$|\?)/,                                 resolveAdmissionId: defaultResolver },
  { method: "PUT",    regex: /\/mar\/[^/]+(\/|$|\?)/,                          resolveAdmissionId: defaultResolver },
  { method: "PATCH",  regex: /\/mar\/[^/]+\/[^/]+(\/|$|\?)/,                   resolveAdmissionId: defaultResolver },
  { method: "POST",   regex: /\/vitalsheet(\/|$|\?)/,                          resolveAdmissionId: defaultResolver },
  { method: "PUT",    regex: /\/vitalsheet\/[^/]+(\/|$|\?)/,                   resolveAdmissionId: defaultResolver },
  { method: "POST",   regex: /\/consent-forms(\/|$|\?)/,                       resolveAdmissionId: defaultResolver },
  { method: "PUT",    regex: /\/consent-forms\/[^/]+(\/|$|\?)/,                resolveAdmissionId: defaultResolver },
  { method: "POST",   regex: /\/discharge-summary(\/|$|\?)/,                   resolveAdmissionId: defaultResolver },
  { method: "PUT",    regex: /\/discharge-summary\/[^/]+(\/|$|\?)/,            resolveAdmissionId: defaultResolver },

  // ── R7gw-B2 new surfaces (10 endpoint families) ─────────────────────
  // Doctor orders — base creates carry admissionId in body; sub-resource
  // verbs (administer / infusion-* / restart / doctor-action) carry only
  // the order id in the URL, so we have to resolve via DoctorOrder doc.
  { method: "POST",   regex: /\/doctor-orders(\/|$|\?)/,                       resolveAdmissionId: defaultResolver },
  { method: "POST",   regex: /\/doctor-orders\/bulk(\/|$|\?)/,                 resolveAdmissionId: defaultResolver },
  { method: "PATCH",  regex: /\/doctor-orders\/[^/]+\/(administer|infusion-rate|infusion-monitor|restart|doctor-action)(\/|$|\?)/, resolveAdmissionId: docOrderByIdResolver },
  { method: "POST",   regex: /\/doctor-orders\/[^/]+\/(administer|infusion-rate|infusion-monitor|restart|doctor-action|bulk)(\/|$|\?)/, resolveAdmissionId: docOrderByIdResolver },

  // Prescriptions — POST hits /prescriptions/uhid/:uhid (frontend shape);
  // regex covers both the bare /prescriptions form and the uhid sub-path
  // so the rule fires regardless of caller. Resolver pulls UHID from path
  // first, falling back to body.admissionId. PATCH on existing rx uses
  // url param and we have to resolve via Prescription doc.
  { method: "POST",   regex: /\/prescriptions(\/uhid\/[^/?]+)?(\/|$|\?)/,      resolveAdmissionId: uhidPathResolver },
  { method: "PATCH",  regex: /\/prescriptions\/[^/]+(\/|$|\?)/,                resolveAdmissionId: prescriptionByIdResolver },

  // Nursing care plan — POST carries admissionId in body; PUT/PATCH on
  // an existing plan only has the plan id in URL, resolve via doc.
  { method: "POST",   regex: /\/nursing-care-plans(\/|$|\?)/,                  resolveAdmissionId: defaultResolver },
  { method: "PUT",    regex: /\/nursing-care-plans\/[^/]+(\/|$|\?)/,           resolveAdmissionId: carePlanByIdResolver },
  { method: "PATCH",  regex: /\/nursing-care-plans\/[^/]+\/(problem\/[^/]+\/status|complete)(\/|$|\?)/, resolveAdmissionId: carePlanByIdResolver },

  // Nursing assessment / intake-output — POST /nursing-assessments/:type
  // (NOT :admissionId — the URL param is the assessment type slug:
  // "daily" | "fall-risk" | "pressure-area" | "pain" | "nutrition" |
  // "education" | "dvt"). admissionId lives in req.body; B3-T09 PART A
  // now also rejects 400 NURSING_ASSESSMENT_MISSING_PATIENT_CONTEXT at
  // the route level if it's missing.
  { method: "POST",   regex: /\/nursing-assessments\/[^/]+(\/|$|\?)/,          resolveAdmissionId: defaultResolver },
  { method: "POST",   regex: /\/intake-output(\/|$|\?)/,                       resolveAdmissionId: defaultResolver },

  // ICU bundles — POST has body.admissionId; finalize uses bundle id in URL.
  { method: "POST",   regex: /\/icu-bundles(\/|$|\?)/,                         resolveAdmissionId: defaultResolver },
  { method: "POST",   regex: /\/icu-bundles\/[^/]+\/finalize(\/|$|\?)/,        resolveAdmissionId: icuBundleByIdResolver },

  // Admission-scoped assessments (consultation, nurse-assessment, initial-
  // assessment) — the URL itself carries the admission id at :id.
  { method: "POST",   regex: /\/admissions\/[^/]+\/(consultation|nurse-assessment|initial-assessment)(\/|$|\?)/, resolveAdmissionId: admissionParamResolver },
  { method: "PUT",    regex: /\/admissions\/[^/]+\/(consultation|nurse-assessment|initial-assessment)(\/|$|\?)/, resolveAdmissionId: admissionParamResolver },

  // Bed transfers — body.admissionId.
  { method: "POST",   regex: /\/bed-transfers(\/|$|\?)/,                       resolveAdmissionId: defaultResolver },

  // R7hr-12-S2 (D6-01): Pharmacy sale supplements — POST /pharmacy/sales/:id/add-items
  // is a "supplement to an existing bill" verb. The body carries no saleType
  // and no admissionId, so the broad /pharmacy/sales rule below would either
  // (a) not fire at all because its condition predicate requires
  // body.saleType === "IPD", or (b) mis-resolve to null. We need a dedicated
  // rule that ALWAYS fires and resolves the admission via the parent Sale
  // doc. enforceStrict so an unresolvable parent fails closed. MUST be
  // placed BEFORE the /pharmacy/sales catch-all because ENFORCE_DISCHARGE_WRITE_RULES
  // uses Array.find — first regex+method match wins.
  { method: "POST",   regex: /\/pharmacy\/sales\/[^/]+\/add-items(\/|$|\?)/,   resolveAdmissionId: pharmacySaleByIdResolver, enforceStrict: true },

  // Pharmacy sales — only when saleType=IPD or Homecare (OPD walk-in sales
  // legitimately happen without an admission). enforceStrict:true so a malformed
  // IPD/Homecare request without admissionId is REJECTED rather than waved
  // through.
  // R7hr-12-S3 (D6-08): Extend discharge gate to Homecare sales — discharged-
  // admission Homecare sales would otherwise silently re-open the IPD credit
  // ledger. Same shape as D6-01.
  { method: "POST",   regex: /\/pharmacy\/sales(\/|$|\?)/,                     resolveAdmissionId: pharmacyIpdResolver,
    condition: (req) => ["IPD", "Homecare"].includes(req.body?.saleType), enforceStrict: true },

  // MAR per-medication administer/discontinue — URL is /mar/:marId/medication/:medId/<verb>,
  // resolve via MAR document. enforceStrict so an unresolved MAR fails closed
  // (these are pure clinical-time-stamped writes; a discharged admission
  // must never receive an "administered" record).
  { method: "PATCH",  regex: /\/mar\/[^/]+\/medication\/[^/]+\/(administer|discontinue)(\/|$|\?)/, resolveAdmissionId: marUrlResolver, enforceStrict: true },

  // ── R7hr-197 Phase 4 — previously-unsealed clinical-write surfaces ──
  // patient-devices: POST body carries ipdNo (runner's ipdNo fallback
  // resolves it); change/remove carry only the device id in the URL.
  { method: "POST",   regex: /\/patient-devices(\/|$|\?)/,                       resolveAdmissionId: defaultResolver },
  { method: "PATCH",  regex: /\/patient-devices\/[^/]+\/(change|remove)(\/|$|\?)/, resolveAdmissionId: patientDeviceByIdResolver },
  // procedure-notes: POST body carries doctorOrderId → order.admissionId.
  { method: "POST",   regex: /\/procedure-notes(\/|$|\?)/,                       resolveAdmissionId: procedureNoteOrderResolver },
  // med-reconciliation: admissionId is in the URL path (/admission/:id/...).
  { method: "POST",   regex: /\/med-reconciliation\/admission\/[^/]+\/(seed|review\/(admit|discharge))(\/|$|\?)/, resolveAdmissionId: medReconPathResolver },
  { method: "PUT",    regex: /\/med-reconciliation\/admission\/[^/]+(\/|$|\?)/,  resolveAdmissionId: medReconPathResolver },
  { method: "PATCH",  regex: /\/med-reconciliation\/admission\/[^/]+\/row\/[^/]+(\/|$|\?)/, resolveAdmissionId: medReconPathResolver },

  // ── R7hr-197 Phase 4 — DELETE backstop. WRITE_METHODS includes DELETE but
  // no rule had method:"DELETE", so deleting a clinical record on a sealed
  // (Discharged) admission slipped through. Cover the destroyable clinical
  // notes; resolve the admission off the doc being deleted.
  { method: "DELETE", regex: /\/doctor-notes\/[^/]+(\/|$|\?)/,                   resolveAdmissionId: doctorNoteDeleteResolver },
  { method: "DELETE", regex: /\/nurse-notes\/[^/]+(\/|$|\?)/,                    resolveAdmissionId: nurseNoteDeleteResolver },
];
const enforceActivePatientForClinicalWrites = async (req, res, next) => {
  try {
    if (!WRITE_METHODS.has(req.method)) return next();
    const url = req.originalUrl.split("?")[0];
    // Find the FIRST matching rule (rule order matters — keep the more
    // specific sub-resource rules above the catch-all base regexes).
    const rule = ENFORCE_DISCHARGE_WRITE_RULES.find(
      (r) => r.method === req.method && r.regex.test(url),
    );
    if (!rule) return next();
    // Optional gate — e.g. pharmacy sales rule only applies when
    // body.saleType === 'IPD'. condition returning false = bypass.
    if (typeof rule.condition === "function") {
      try { if (!rule.condition(req)) return next(); }
      catch (e) {
        console.warn("[discharge-gate] rule.condition threw:", e.message);
        return next();
      }
    }
    // R7hr-197 Phase 4 — the X-Late-Entry escape hatch used to short-circuit
    // here BEFORE resolving the admission, i.e. ANY authenticated write with
    // the header bypassed the seal entirely (and active-admission writes
    // never needed it). The bypass is now evaluated ONLY inside the
    // Discharged branch below, gated on a reason and logged for audit.

    const Admission = require("../models/Patient/admissionModel");

    // Resolve the admission id via the rule's helper (sync or async).
    let admissionId = null;
    try {
      const r = rule.resolveAdmissionId
        ? await rule.resolveAdmissionId(req)
        : (req.body?.admissionId || req.params?.admissionId || req.params?.id || null);
      admissionId = r ? String(r) : null;
    } catch (e) {
      console.warn("[discharge-gate] resolver threw:", e.message);
      admissionId = null;
    }

    let admission = null;
    if (admissionId && /^[a-f0-9]{24}$/i.test(admissionId)) {
      admission = await Admission.findById(admissionId).select("status").lean();
    }

    // Fallbacks for legacy callers that pass ipdNo or UHID instead of an
    // admission _id (keeps the original D9-HIGH-10 behaviour intact for
    // doctor-notes / nurse-notes / etc.).
    if (!admission) {
      const body = req.body || {};
      const params = req.params || {};
      const ipdNo = body.ipdNo || params.ipdNo;
      const uhid  = body.UHID || body.uhid || params.uhid;
      if (ipdNo) {
        admission = await Admission.findOne({ admissionNumber: ipdNo })
          .select("status").lean();
      }
      if (!admission && uhid) {
        admission = await Admission.findOne({ UHID: String(uhid).toUpperCase() })
          .sort({ admissionDate: -1 })
          .select("status").lean();
      }
    }

    // Soft-fail when nothing matched — UNLESS the rule is marked
    // enforceStrict (MAR administer + IPD pharmacy sales): those are
    // pure clinical/financial writes; an unresolvable admission means
    // the controller would have no audit anchor either.
    if (!admission) {
      if (rule.enforceStrict) {
        console.warn(
          "[discharge-gate] strict rule could not resolve admission for",
          req.method, url,
        );
        return res.status(409).json({
          success: false,
          code: "ADMISSION_UNRESOLVED",
          message:
            "Could not identify the admission this write targets. " +
            "Strict clinical surfaces (MAR administer, IPD pharmacy sale) " +
            "require a resolvable admissionId.",
        });
      }
      return next();
    }

    if (admission.status === "Discharged") {
      // R7hr-197 Phase 4 — late-entry addendum. The X-Late-Entry header now
      // applies ONLY here (a genuinely-sealed admission), requires a reason,
      // and is logged so the bypass is auditable rather than blind header-trust.
      const lateEntry  = String(req.headers["x-late-entry"] || "").toLowerCase() === "true";
      const lateReason = String(req.headers["x-late-entry-reason"] || req.body?.lateEntryReason || "").trim();
      if (lateEntry && lateReason) {
        console.warn(
          `[discharge-gate] LATE-ENTRY addendum on Discharged admission ${admission._id} — ` +
          `${req.method} ${url} — actor=${req.user?.id || req.user?._id || "?"} — reason="${lateReason}"`,
        );
        return next();
      }
      if (lateEntry && !lateReason) {
        return res.status(400).json({
          success: false,
          code: "LATE_ENTRY_REASON_REQUIRED",
          message:
            "A late-entry addendum on a discharged admission requires a reason " +
            "(X-Late-Entry-Reason header or lateEntryReason in the body).",
        });
      }
      return res.status(423).json({
        success: false,
        // R7gw-B2: code is ADMISSION_DISCHARGED_NO_WRITE for the new
        // rule families. Original D9-HIGH-10 surfaces continue to
        // observe the same blocker; the frontend interceptor maps
        // both PATIENT_DISCHARGED and ADMISSION_DISCHARGED_NO_WRITE
        // to the same toast.
        code: "ADMISSION_DISCHARGED_NO_WRITE",
        message:
          "This admission is Discharged — clinical writes are sealed. " +
          "Use an ADDENDUM with header X-Late-Entry: true (and X-Late-Entry-Reason) if a correction is required.",
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
  requireAnyAction,
  attemptAuth,
  requirePasswordRotated,
  attachDoctorProfile,
  restrictToOwnDoctorPatients,
  restrictToOwnNurseWard,
  blockReadOnlyRoleWrites,
  blockNonClinicalForDoctorNurse,
  enforceActivePatientForClinicalWrites,
};
