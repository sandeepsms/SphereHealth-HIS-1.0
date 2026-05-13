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
    const { phone, purpose } = req.body || {};
    const allowed = ["sign-dnr", "sign-lama", "sign-death", "controlled-rx", "blood-tx", "sign-amendment"];
    if (!purpose || !allowed.includes(purpose)) {
      return res.status(400).json({ success: false, message: "Invalid purpose" });
    }
    const u = req.user || {};
    const phoneToUse = phone || u.phone || u.contactNumber;
    if (!phoneToUse) {
      return res.status(400).json({ success: false, message: "Phone number required for OTP" });
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

    // ── SMS send — pluggable. If no provider configured, log to stdout
    // so QA can still test the gate in dev.
    if (process.env.SMS_PROVIDER) {
      // TODO: wire actual SMS gateway (Twilio / MSG91 / AWS SNS).
      console.log(`[2FA] send via ${process.env.SMS_PROVIDER} → ${phoneToUse}`);
    } else {
      console.log(`[2FA-DEV] purpose=${purpose} phone=${phoneToUse} otp=${otp} token=${token}`);
    }

    return res.json({
      success:   true,
      token,
      expiresAt: Date.now() + OTP_TTL_MS,
      // expose in dev only so the UI can auto-fill during testing
      ...(process.env.SMS_PROVIDER ? {} : { devOtp: otp }),
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
    if (!row || row.used)                      return res.status(401).json({ success: false, message: "OTP expired or already used" });
    if (row.expiresAt < Date.now())            return res.status(401).json({ success: false, message: "OTP expired" });
    if (row.hash !== hash(String(otp)))        return res.status(401).json({ success: false, message: "Invalid OTP" });
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
  if (!n) return res.status(401).json({ success: false, message: "2FA nonce required" });
  const row = nonceStore.get(n);
  if (!row || row.used || row.expiresAt < Date.now()) {
    return res.status(401).json({ success: false, message: "2FA nonce invalid or expired" });
  }
  if (purpose && row.purpose !== purpose) {
    return res.status(403).json({ success: false, message: `2FA was for ${row.purpose}, this action requires ${purpose}` });
  }
  row.used = true; // single-use
  req.twoFactor = { purpose: row.purpose, userId: row.userId };
  next();
};
