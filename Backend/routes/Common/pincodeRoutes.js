// routes/Common/pincodeRoutes.js
// R7dn — Pincode lookup endpoint. Public (no auth) since it's just
// postal data, not PHI. Rate-limited to 60/min/IP to prevent abuse.
const express     = require("express");
const rateLimit   = require("express-rate-limit");
const router      = express.Router();
const ctrl        = require("../../controllers/Common/pincodeController");

const pincodeRateLimit = rateLimit({
  windowMs: 60 * 1000,        // 1 minute
  limit:    60,               // 60 lookups/min/IP — plenty for a busy reception
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { success: false, message: "Too many pincode lookups — slow down." },
});

router.get("/:pincode", pincodeRateLimit, ctrl.getPincodeLookup);

module.exports = router;
