const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const User = require("../../models/User/userModel");
const TokenRevocation = require("../../models/Auth/TokenRevocationModel");

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES = process.env.JWT_EXPIRES || "8h";

// Pre-computed bcrypt hash used when the user lookup misses, so the response
// time stays constant and an attacker can't enumerate valid emails by timing.
const TIMING_DUMMY_HASH =
  "$2a$10$CwTycUXWue0Thq9StjUM0uJ8.OQXxa3GqVbzqo0TQk0JqLZw3pPYK";

const INVALID_CREDENTIALS = "Invalid email or password";

/* ── POST /api/auth/login ── */
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ message: "Email and password are required" });

    const user = await User.findOne({ email: email.toLowerCase().trim() });

    // Always run a bcrypt compare — dummy hash on miss — to keep timing flat.
    const passwordHash = user ? user.password : TIMING_DUMMY_HASH;
    const isMatch = await bcrypt.compare(password, passwordHash);

    const inactive =
      user &&
      (!user.isActive ||
        user.status === "Inactive" ||
        user.status === "Terminated" ||
        user.status === "Suspended");

    // Collapse all failure modes (no user / wrong password / inactive) into a
    // single generic response so the auth surface doesn't leak account state.
    if (!user || !isMatch || inactive)
      return res.status(401).json({ message: INVALID_CREDENTIALS });

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    // jti = unique token ID for the revocation list (audit B-10). Without
    // it, a logged-out / compromised token stays valid until exp. The
    // authenticate middleware checks TokenRevocation by jti on every
    // request; logout writes the jti there with TTL = exp.
    const jti = crypto.randomUUID();
    const token = jwt.sign(
      { id: user._id, role: user.role, employeeId: user.employeeId, jti },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES }
    );

    res.json({
      token,
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
      },
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ message: "Server error during login" });
  }
});

/* ── GET /api/auth/me ── (requires token) */
router.get("/me", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer "))
      return res.status(401).json({ message: "No token provided" });

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, JWT_SECRET);

    const user = await User.findById(decoded.id).select("-password");
    if (!user)
      return res.status(404).json({ message: "User not found" });

    res.json({ user });
  } catch (err) {
    res.status(401).json({ message: "Invalid or expired token" });
  }
});

/* ── PATCH /api/auth/signature ── save user's digital signature */
router.patch("/signature", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer "))
      return res.status(401).json({ message: "No token provided" });

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, JWT_SECRET);

    const { signature } = req.body;
    if (!signature) return res.status(400).json({ message: "Signature data required" });

    const user = await User.findByIdAndUpdate(
      decoded.id,
      { signature },
      { new: true, select: "-password" }
    );
    if (!user) return res.status(404).json({ message: "User not found" });

    res.json({ message: "Signature saved", signature: user.signature });
  } catch (err) {
    res.status(401).json({ message: "Invalid or expired token" });
  }
});

/* ── GET /api/auth/signature ── get user's digital signature */
router.get("/signature", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer "))
      return res.status(401).json({ message: "No token provided" });

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, JWT_SECRET);

    const user = await User.findById(decoded.id).select("signature fullName firstName lastName role");
    if (!user) return res.status(404).json({ message: "User not found" });

    res.json({ signature: user.signature || null });
  } catch (err) {
    res.status(401).json({ message: "Invalid or expired token" });
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
    } catch (e) {
      // Invalid / already-expired token — nothing to revoke, still 200
    }
    res.json({ message: "Logged out successfully" });
  } catch (err) {
    console.error("[auth] logout error:", err.message);
    res.status(500).json({ message: "Logout failed" });
  }
});

module.exports = router;
