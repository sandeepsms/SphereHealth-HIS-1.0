// routes/Clinical/twoFactorRoutes.js
//
// R7bb-B/D4-CRIT-S1: gated on `safety.write` (Admin / Doctor / Nurse).
// Pre-R7bb any authenticated role (Pharmacist / Ward Boy / Housekeeping /
// Security) could request OTPs and verify them — would let a non-clinical
// role complete a 2FA-gated safety action (override-MAR, surgical
// checklist, two-ID confirm) just because they have a valid JWT.
const router = require("express").Router();
const ctrl = require("../../controllers/Clinical/twoFactorController");
const { requireAction } = require("../../middleware/auth");

router.post("/request", requireAction("safety.write"), ctrl.requestOtp);
router.post("/verify",  requireAction("safety.write"), ctrl.verifyOtp);

module.exports = router;
