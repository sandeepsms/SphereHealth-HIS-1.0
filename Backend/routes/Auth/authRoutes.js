const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const User = require("../../models/User/userModel");
const TokenRevocation = require("../../models/Auth/TokenRevocationModel");
const userActivity = require("../../services/User/userActivityLogger");
const { validatePassword, checkPasswordReuse } = require("../../utils/passwordPolicy");
// R7at-FIX-10: route /me, PATCH /signature, GET /signature, POST
// /change-password, POST /logout-all-devices all go through the global
// authenticate middleware so revocation + token-version checks run on every
// hit. Import lifted to module scope so route handlers below can reference
// `authenticate` at module-load time.
const { authenticate } = require("../../middleware/auth");
// R7bz — IP-based brute-force throttle in front of POST /login. Defends
// against username-rotation attacks that sidestep the per-user 5-strike
// lockout below by hitting many usernames once each from the same IP.
const { loginRateLimit } = require("../../middleware/rateLimitAuth");

// R7bb-FIX-A-16: JWT_SECRET rotation procedure needs a SECONDARY_JWT_SECRETS
// env array for graceful rollover. Today every node verifies against a single
// secret — rotating the secret invalidates every issued token, forcing a
// global re-login. Future work: accept tokens signed by either the current
// or the previous secret for the duration of the rotation window.
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES = process.env.JWT_EXPIRES || "8h";

// Pre-computed bcrypt hash used when the user lookup misses, so the response
// time stays constant and an attacker can't enumerate valid emails by timing.
const TIMING_DUMMY_HASH =
  "$2a$10$CwTycUXWue0Thq9StjUM0uJ8.OQXxa3GqVbzqo0TQk0JqLZw3pPYK";

const INVALID_CREDENTIALS = "Invalid email or password";

/* ── POST /api/auth/login ── */
// R7bz: loginRateLimit (10 req / 15 min / IP, skipSuccessfulRequests)
// is applied BEFORE the handler so botnet-driven username spraying gets
// 429'd without ever hitting bcrypt. Other endpoints in this router
// (logout, /me, signature, change-password, logout-all-devices) are
// NOT rate-limited here.
router.post("/login", loginRateLimit, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ message: "Email and password are required" });

    const user = await User.findOne({ email: email.toLowerCase().trim() });

    // R7bb-FIX-A-2: NABH HIC.5 account lockout. If the account is currently
    // locked, refuse even with the right password — and short-circuit BEFORE
    // bcrypt so we don't waste cycles. 423 Locked is the IANA-correct status.
    // We emit a USER_LOGIN_LOCKED audit row so the SOC can see lockout
    // attempts (potential brute-force in progress).
    if (user && user.lockUntil && user.lockUntil.getTime() > Date.now()) {
      try {
        await userActivity.emit({
          event: "USER_LOGIN_LOCKED",
          targetUser: user,
          actor: null,
          ip: req.ip,
          metadata: { email: user.email, lockUntil: user.lockUntil },
        });
      } catch (_) { /* best-effort */ }
      return res.status(423).json({ message: "Account locked. Try again later." });
    }

    // Always run a bcrypt compare — dummy hash on miss — to keep timing flat.
    const passwordHash = user ? user.password : TIMING_DUMMY_HASH;
    const isMatch = await bcrypt.compare(password, passwordHash);

    const inactive =
      user &&
      (!user.isActive ||
        user.status === "Inactive" ||
        user.status === "Terminated" ||
        user.status === "Suspended");

    // R7bb-FIX-A-2: on a real user with a wrong password, increment the
    // failure counter; after 5 strikes lock for 30 minutes and reset the
    // counter. Use $inc / $set so the password pre-save hook doesn't re-fire.
    if (user && !isMatch) {
      const nextFails = (user.failedLoginAttempts || 0) + 1;
      if (nextFails >= 5) {
        const lockUntil = new Date(Date.now() + 30 * 60_000);
        await User.updateOne(
          { _id: user._id },
          { $set: { failedLoginAttempts: 0, lockUntil } }
        );
        try {
          await userActivity.emit({
            event: "USER_LOCKED",
            targetUser: user,
            actor: null,
            ip: req.ip,
            metadata: { reason: "5 failed login attempts", lockUntil },
          });
        } catch (_) { /* best-effort */ }
      } else {
        await User.updateOne(
          { _id: user._id },
          { $set: { failedLoginAttempts: nextFails } }
        );
      }
      // R7bb-FIX-A-9: best-effort LOGIN_FAILED audit row. We emit even when
      // the user lookup misses (using a synthetic null targetUser) so the
      // SOC can see credential-spray patterns against non-existent emails.
      try {
        await userActivity.emit({
          event: "USER_LOGIN_FAILED",
          targetUser: user,
          actor: null,
          ip: req.ip,
          metadata: { email: user.email, attempts: nextFails },
        });
      } catch (_) { /* best-effort */ }
    }

    // Collapse all failure modes (no user / wrong password / inactive) into a
    // single generic response so the auth surface doesn't leak account state.
    // R7au-4: add `code: INVALID_CREDENTIALS`. The frontend interceptor
    // already excludes /auth/login from the transient counter, but a tagged
    // code is hygiene — surfaces cleanly in audit logs + future analytics.
    if (!user || !isMatch || inactive)
      return res.status(401).json({ success: false, code: "INVALID_CREDENTIALS", message: INVALID_CREDENTIALS });

    // R7bb-FIX-A-2: successful login — clear lockout counters via $set so we
    // don't trigger the password pre-save hook (which would re-hash on every
    // login and bump bcrypt cost on each touch).
    await User.updateOne(
      { _id: user._id },
      { $set: { failedLoginAttempts: 0, lockUntil: null, lastLogin: new Date() } }
    );
    user.lastLogin = new Date();

    // jti = unique token ID for the revocation list (audit B-10). Without
    // it, a logged-out / compromised token stays valid until exp. The
    // authenticate middleware checks TokenRevocation by jti on every
    // request; logout writes the jti there with TTL = exp.
    const jti = crypto.randomUUID();
    // R7bb-FIX-A-5: JWT payload extended with the full claim set the
    // downstream middleware (restrictToOwnNurseWard / restrictToOwnDoctor*
    // /requireAction) reads — tokenVersion (stale-token detection), wards
    // (multi-ward shift cover), specializations (doctor-specialty gates),
    // designation (HOD-only writes). The middleware still re-checks DB-
    // fresh values per request, so the JWT is the fast-path / fallback.
    const token = jwt.sign(
      {
        id: user._id,
        role: user.role,
        employeeId: user.employeeId,
        jti,
        tokenVersion: user.tokenVersion || 0,
        // R7bb-FIX-A-3: mustChangePassword in the JWT so middleware can
        // short-circuit any write attempt before the forced-rotation modal
        // is dismissed on the frontend — defense in depth.
        mustChangePassword: user.mustChangePassword === true,
        designation: user.doctorDetails?.designation || null,
        ward: user.ward || null,
        wards: (user.wards || []).map(String),
        specializations: user.specializations || [],
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES }
    );

    // R7bb-FIX-A-9: LOGIN_SUCCESS audit row — HR / SOC trail.
    try {
      await userActivity.emit({
        event: "USER_LOGIN_SUCCESS",
        targetUser: user,
        actor: user,
        ip: req.ip,
        metadata: { jti, userAgent: req.headers["user-agent"] },
      });
    } catch (_) { /* best-effort */ }

    res.json({
      token,
      // R7bb-FIX-A-3: surface mustChangePassword so the frontend can pop the
      // forced-rotation modal on first login after an admin reset.
      mustChangePassword: user.mustChangePassword === true,
      user: {
        _id: user._id,
        employeeId: user.employeeId,
        fullName: user.fullName || `${user.firstName} ${user.lastName}`,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
        phone: user.phone,
        profilePhoto: user.profilePhoto,
        lastLogin: user.lastLogin,
        doctorDetails: user.doctorDetails,
        nurseDetails: user.nurseDetails,
        signature: user.signature || null,
        mustChangePassword: user.mustChangePassword === true,
        // R7bc — include tokenVersion + isActive so the frontend's
        // refreshIfStale focus-poll can compare them against /auth/me's
        // fresh values without a false-positive mismatch. Pre-R7bc the
        // login response omitted tokenVersion entirely, so for any user
        // whose tokenVersion was > 0 (admin password reset, prior
        // logout-all-devices, etc.), the very first focus event after
        // login compared `0 ?? 0` (frontend) against `1` (DB) and force-
        // logged them out — symptomatic in tab switch, alt-tab, AND
        // screenshot-tool focus loss/regain cycles.
        tokenVersion: user.tokenVersion || 0,
        isActive: user.isActive !== false,
      },
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ message: "Server error during login" });
  }
});

/* ── POST /api/auth/change-password ──
   R7bb-FIX-A-3: forced first-login + voluntary password rotation. The
   request takes { currentPassword, newPassword }. On success: bumps
   tokenVersion (kills every other live session for this user), clears
   mustChangePassword, stamps passwordChangedAt, archives the old hash
   into passwordHistory. Returns a new JWT so the caller's current
   session stays valid without re-login.
*/
router.post("/change-password", authenticate, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: "currentPassword and newPassword are required" });
    }

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    // Verify the current password — even on a forced-rotation flow the
    // user must prove they hold the admin-issued one-time password.
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      // R7au-4: code `WRONG_CURRENT_PASSWORD` so the frontend transient
      // counter can ignore this on the user-facing change-password modal
      // (we extend the auth-form exemption list in axiosInterceptor.js).
      // Two typos within 12s previously force-logged-out the very user
      // who was actively typing into the modal.
      return res.status(401).json({ success: false, code: "WRONG_CURRENT_PASSWORD", message: "Current password is incorrect" });
    }

    // R7bb-FIX-A-14: enforce NABH-grade complexity on the NEW password.
    const v = validatePassword(newPassword);
    if (!v.ok) {
      return res.status(400).json({ success: false, message: "Password does not meet policy", reasons: v.reasons });
    }
    // Reuse-blocker: reject any of the last 5 hashes.
    const reuse = await checkPasswordReuse(newPassword, user.passwordHistory || []);
    if (reuse.reused) {
      return res.status(400).json({ success: false, message: "Cannot reuse a recent password" });
    }
    // Also reject "same as current" even when history is empty.
    if (await bcrypt.compare(newPassword, user.password)) {
      return res.status(400).json({ success: false, message: "New password must differ from current" });
    }

    // Archive the soon-to-be-overwritten hash, then set the new plaintext.
    // The pre-save hook hashes + bumps passwordChangedAt automatically.
    user.archivePriorHash();
    user.password = newPassword;
    user.mustChangePassword = false;
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save();

    // R7bb-FIX-A-9: PASSWORD_CHANGED audit row.
    try {
      await userActivity.emit({
        event: "USER_PASSWORD_CHANGED",
        targetUser: user,
        actor: user,
        ip: req.ip,
        metadata: { firstLogin: req.user.mustChangePassword === true },
      });
    } catch (_) { /* best-effort */ }

    // Re-mint a JWT with the bumped tokenVersion so the caller's current
    // session doesn't auto-eject on the next request. Other sessions DO
    // eject because their JWT carries the old tokenVersion.
    const jti = crypto.randomUUID();
    const token = jwt.sign(
      {
        id: user._id,
        role: user.role,
        employeeId: user.employeeId,
        jti,
        tokenVersion: user.tokenVersion,
        mustChangePassword: false,
        designation: user.doctorDetails?.designation || null,
        ward: user.ward || null,
        wards: (user.wards || []).map(String),
        specializations: user.specializations || [],
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES }
    );

    return res.json({ success: true, message: "Password changed successfully", token });
  } catch (err) {
    console.error("[auth] change-password error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ── GET /api/auth/me ── (requires token)
 * R7f: when role === "Doctor", also resolve and attach the linked Doctor
 * collection profile (id + doctorId code). The Admission model stores
 * `attendingDoctorId` as the Doctor collection's _id (not the User _id),
 * so the frontend needs this to compute "am I the consultant of record?"
 * — otherwise every doctor falsely sees "Read-only — not your patient".
 */
// R7at-FIX-10/D3-NEW-CRIT: `/me`, PATCH `/signature`, GET `/signature`
// previously re-implemented JWT verification inline — bypassing the
// global `authenticate` middleware (which checks the TokenRevocation
// collection). A revoked / logged-out token kept hitting these
// endpoints (the routes most clients use for "am I still logged in"
// checks) until natural exp (up to 8h). Now they go through
// `authenticate` so revocation is enforced.
// (R7bb-FIX-A-3: import lifted to module top so POST /change-password
//  registered above can reference it.)

router.get("/me", authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password").lean();
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    let doctorProfile = null;
    if (user.role === "Doctor") {
      try {
        const Doctor = require("../../models/Doctor/doctorModel");
        doctorProfile = await Doctor.findOne({ loginUserId: user._id })
          .select("_id doctorId personalInfo.fullName")
          .lean();
      } catch (_) { /* Doctor model not loaded — skip silently */ }
    }
    res.json({ user, doctorProfile });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/* ── PATCH /api/auth/signature ── save user's digital signature */
router.patch("/signature", authenticate, async (req, res) => {
  try {
    const { signature } = req.body;
    if (!signature) return res.status(400).json({ success: false, message: "Signature data required" });

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { signature },
      { new: true, select: "-password" }
    );
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    res.json({ message: "Signature saved", signature: user.signature });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/* ── GET /api/auth/signature ── get user's digital signature */
router.get("/signature", authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("signature fullName firstName lastName role");
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    res.json({ signature: user.signature || null });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/* ── POST /api/auth/logout ──
   Server-side token revocation. The frontend already drops the token
   from localStorage on logout, but a copy could still live in DevTools
   or a leaked file. This endpoint writes the jti to TokenRevocation
   with TTL = the token's exp, so the authenticate middleware rejects
   any later use within the 8-hour validity window. Audit B-10. */
router.post("/logout", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      // Idempotent — already logged out / never had a token
      return res.json({ message: "Logged out successfully" });
    }
    const token = authHeader.split(" ")[1];
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      if (decoded.jti && decoded.exp) {
        // Best-effort upsert — duplicate-key on jti (already revoked) is
        // a no-op success.
        await TokenRevocation.updateOne(
          { jti: decoded.jti },
          {
            $setOnInsert: {
              jti: decoded.jti,
              userId: decoded.id || null,
              reason: "logout",
              expiresAt: new Date(decoded.exp * 1000),
            },
          },
          { upsert: true },
        );
      }
      // R7bb-FIX-A-9: LOGOUT audit row. Best-effort — never fail the
      // logout flow on logging trouble.
      if (decoded.id) {
        try {
          await userActivity.emit({
            event: "USER_LOGOUT",
            targetUser: { _id: decoded.id, employeeId: decoded.employeeId },
            actor:      { _id: decoded.id, role: decoded.role },
            ip: req.ip,
            metadata: { jti: decoded.jti },
          });
        } catch (_) { /* best-effort */ }
      }
    } catch (e) {
      // Invalid / already-expired token — nothing to revoke, still 200
    }
    res.json({ message: "Logged out successfully" });
  } catch (err) {
    console.error("[auth] logout error:", err.message);
    res.status(500).json({ message: "Logout failed" });
  }
});

/* ── POST /api/auth/logout-all-devices ──
   R7bb-FIX-A-11/D9-HIGH-6: bumps user.tokenVersion → invalidates every JWT
   issued before the bump on every node within the 60s cache TTL. Used when
   the user suspects a device was lost / stolen, or after a password change.
*/
router.post("/logout-all-devices", authenticate, async (req, res) => {
  try {
    const updated = await User.findByIdAndUpdate(
      req.user.id,
      { $inc: { tokenVersion: 1 } },
      { new: true, select: "_id employeeId tokenVersion role" }
    );
    try {
      await userActivity.emit({
        event: "USER_TOKEN_REVOKED_ALL",
        targetUser: updated,
        actor: req.user,
        ip: req.ip,
        metadata: { reason: "user requested logout-all-devices", newTokenVersion: updated?.tokenVersion },
      });
    } catch (_) { /* best-effort */ }
    res.json({ success: true, message: "All sessions on all devices revoked." });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
