// routes/Clinical/twoFactorRoutes.js
//
// R7bb-FIX-C-1/S1 (D4-CRIT): gated on the new `auth.2fa` token
// (Admin / Doctor / Nurse). Previously these sat on `safety.write` which
// conflated 2FA OTP request + verify with the two-ID-confirm /
// surgical-checklist / pain-reassessment surface. Splitting the gates
// gives audit-grep an explicit row per route and avoids the "Doctor
// requested an OTP" event hiding under a safety attestation log.
//
// Role set mirrors `safety.write` (same audience — anyone who can
// initiate an OTP-gated workflow can also request the OTP itself).
const router = require("express").Router();
const ctrl = require("../../controllers/Clinical/twoFactorController");
const { requireAction } = require("../../middleware/auth");

router.post("/request", requireAction("auth.2fa"), ctrl.requestOtp);
router.post("/verify",  requireAction("auth.2fa"), ctrl.verifyOtp);

module.exports = router;
