/**
 * feedbackPublicRoutes — PUBLIC, no-login patient feedback surface.
 * Mounted at /api/public-feedback ABOVE the global `authenticate` wall so a
 * patient can open the link / QR on their phone without a JWT. Rate-limiting
 * (publicFeedbackRateLimit) is applied at the mount in routes/index.js.
 *
 * Only reachable with a valid, unexpired, unsubmitted `publicToken` — the
 * controller returns 404/410/409 otherwise, and never exposes full PHI (only
 * a first name for a friendly greeting).
 */
const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/Quality/feedbackController");

router.get("/:token", ctrl.publicGetForm);
router.post("/:token", ctrl.publicSubmit);

module.exports = router;
