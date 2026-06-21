// controllers/Clinical/twoFactorController.js
// ═══════════════════════════════════════════════════════════════
// Two-factor OTP gate for high-risk clinical actions.
//
// Use cases (NABH safety gates):
//   • Sign a DNR / LAMA / Death note
//   • Order a controlled substance (Schedule X, narcotic)
//   • Approve a blood transfusion
//
// Flow:
//   POST /api/2fa/request   → server generates 6-digit OTP, returns
//                             {token, expiresAt}, stores hash + token
//                             linkage in memory. SMS gateway is wired
//                             in via env vars; this scaffold logs to
//                             console if SMS provider isn't configured.
//   POST /api/2fa/verify    → client posts {token, otp}; server checks
//                             hash + expiry. On match, returns a short-
//                             lived JWT-like nonce the calling endpoint
//                             can require as proof.
//
// NOT a session 2FA — this is per-action MFA. The nonce lives 60s and
// is single-use. Keep this controller pure; never store the OTP itself,
// only its sha256.
//
// Storage: in-process Map. Multi-node would need Redis; ok for v1.
// ═══════════════════════════════════════════════════════════════

const crypto = require("crypto");

// token → { hash, expiresAt, used, purpose, userId }
const otpStore = new Map();
// nonce → { expiresAt, used, purpose, userId }
const nonceStore = new Map();

const OTP_TTL_MS   = 5 * 60_000;
const NONCE_TTL_MS = 60_000;

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of otpStore)   if (v.expiresAt < now) otpStore.delete(k);
  for (const [k, v] of nonceStore) if (v.expiresAt < now) nonceStore.delete(k);
}, 60_000).unref?.();

function hash(s) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

// POST /api/2fa/request
// Body: { phone, purpose }   purpose ∈ {"sign-dnr","sign-lama","sign-death","controlled-rx","blood-tx"}
exports.requestOtp = async (req, res) => {
  try {
    // R7bb-FIX-A-7/S15/D9-HIGH-8: do NOT destructure `phone` from the body —
    // the OTP target is always derived server-side from the authenticated
    // session. Pre-R7bb a caller could pass {phone:"my-attacker-number"}
    // and the OTP would race to the attacker's device. Phone now comes
    // from req.user.phone (populated by the authenticate middleware) with
    // a User.findById fallback for the rare case the cache row lacks it.
    const { purpose } = req.body || {};
    const allowed = ["sign-dnr", "sign-lama", "sign-death", "controlled-rx", "blood-tx", "sign-amendment"];
    if (!purpose || !allowed.includes(purpose)) {
      return res.status(400).json({ success: false, message: "Invalid purpose" });
    }
    const u = req.user || {};
    let phoneToUse = u.phone || null;
    if (!phoneToUse && (u.id || u._id)) {
      try {
        const User = require("../../models/User/userModel");
        const fresh = await User.findById(u.id || u._id).select("phone").lean();
        phoneToUse = fresh?.phone || null;
      } catch (_) { /* best-effort */ }
    }
    if (!phoneToUse) {
      return res.status(400).json({ success: false, message: "No phone on file" });
    }
    const otp   = String(Math.floor(100_000 + Math.random() * 900_000));
    const token = crypto.randomBytes(16).toString("hex");
    otpStore.set(token, {
      hash:      hash(otp),
      expiresAt: Date.now() + OTP_TTL_MS,
      used:      false,
      purpose,
      userId:    u._id || u.id || null,
    });

    // ── SMS send — pluggable. We never log the full phone, OTP, or token
    // to stdout (they appear in container logs, log aggregators, and on
    // shared dev terminals — CWE-532 / DPDP §8). The OTP is still returned
    // via the JSON response (in dev only) so QA can auto-fill; the JSON
    // payload stays inside the encrypted TLS channel.
    const maskedPhone = phoneToUse ? `${"*".repeat(Math.max(0, phoneToUse.length - 4))}${phoneToUse.slice(-4)}` : "(none)";
    if (process.env.SMS_PROVIDER) {
      // TODO: wire actual SMS gateway (Twilio / MSG91 / AWS SNS).
      console.log(`[2FA] send via ${process.env.SMS_PROVIDER} → ${maskedPhone}`);
    } else {
      console.log(`[2FA-DEV] purpose=${purpose} phone=${maskedPhone} (otp/token redacted — see response payload)`);
    }

    return res.json({
      success:   true,
      token,
      expiresAt: Date.now() + OTP_TTL_MS,
      // R7bb-A: expose devOtp ONLY in non-production AND when no SMS provider
      // is wired up. Pre-R7bb a production environment with a misconfigured
      // SMS_PROVIDER would happily echo the OTP back in the JSON response.
      ...(process.env.NODE_ENV !== "production" && !process.env.SMS_PROVIDER ? { devOtp: otp } : {}),
    });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

// POST /api/2fa/verify
// Body: { token, otp }   → returns { nonce } on success
exports.verifyOtp = async (req, res) => {
  try {
    const { token, otp } = req.body || {};
    if (!token || !otp) return res.status(400).json({ success: false, message: "token + otp required" });
    const row = otpStore.get(token);
    // R7au-4: code-tagged OTP failures. Pre-R7au these naked 401s ticked
    // the frontend transient counter — two mistyped OTPs within 12s
    // logged the user out of the 2FA flow they were trying to complete.
    // These codes are NOT in HARD_LOGOUT_CODES, and the global interceptor
    // now exempts /2fa/* routes from the transient counter (mirrors the
    // /auth/login exemption) so user-error here stays inline.
    if (!row || row.used)                      return res.status(401).json({ success: false, code: "OTP_USED", message: "OTP expired or already used" });
    if (row.expiresAt < Date.now())            return res.status(401).json({ success: false, code: "OTP_EXPIRED", message: "OTP expired" });
    if (row.hash !== hash(String(otp)))        return res.status(401).json({ success: false, code: "OTP_INVALID", message: "Invalid OTP" });
    row.used = true;

    const nonce = crypto.randomBytes(20).toString("hex");
    nonceStore.set(nonce, {
      expiresAt: Date.now() + NONCE_TTL_MS,
      used:      false,
      purpose:   row.purpose,
      userId:    row.userId,
    });
    return res.json({ success: true, nonce, expiresAt: Date.now() + NONCE_TTL_MS, purpose: row.purpose });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

// Middleware: routes that demand a 2FA nonce — check X-2FA-Nonce header.
exports.requireTwoFactor = (purpose) => (req, res, next) => {
  const n = req.headers["x-2fa-nonce"];
  // R7au-4: code-tag nonce failures. NONCE_REQUIRED / NONCE_INVALID are
  // user-recoverable (re-request OTP) — frontend treats them as 2FA-flow
  // errors via the /2fa exemption in axiosInterceptor, NOT as session-end.
  if (!n) return res.status(401).json({ success: false, code: "NONCE_REQUIRED", message: "2FA nonce required" });
  const row = nonceStore.get(n);
  if (!row || row.used || row.expiresAt < Date.now()) {
    return res.status(401).json({ success: false, code: "NONCE_INVALID", message: "2FA nonce invalid or expired" });
  }
  if (purpose && row.purpose !== purpose) {
    return res.status(403).json({ success: false, message: `2FA was for ${row.purpose}, this action requires ${purpose}` });
  }
  // R7hr-250 (audit: nonce not actor-bound) — the nonce must belong to the
  // authenticated caller, else user B could replay a nonce user A just minted
  // (same 60s window + purpose) and complete an action requiring A's 2FA.
  if (row.userId && req.user && String(row.userId) !== String(req.user._id || req.user.id)) {
    return res.status(403).json({ success: false, code: "NONCE_ACTOR_MISMATCH", message: "This 2FA nonce was issued to a different user." });
  }
  row.used = true; // single-use
  req.twoFactor = { purpose: row.purpose, userId: row.userId };
  next();
};
