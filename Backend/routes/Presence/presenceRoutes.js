// R7au-FIX-12/D3-MED: presence heartbeat is harmless from any role
// (just shows "X is online"); the `/clear` admin-style reset is now
// `adminOnly` so a logged-in pharmacist can't wipe another user's
// presence indicator.
const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/Presence/presenceController");
const { adminOnly } = require("../../middleware/auth");

router.post("/heartbeat", ctrl.heartbeat);
router.get ("/active",    ctrl.getActive);
router.post("/clear",     adminOnly, ctrl.clear);

module.exports = router;
