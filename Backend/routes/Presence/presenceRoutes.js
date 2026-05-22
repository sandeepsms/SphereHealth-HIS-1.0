// R7bb-B/D4-HIGH-S1: presence endpoints gated on the new `presence.read`
// action (Admin-only). The active-user roster is operational telemetry —
// it reveals who is online, which department they belong to and what
// they are currently serving. Outside of Admin (Mission Control) no
// other role has a UI for this surface.
//
// Earlier (R7au-FIX-12/D3-MED) the `/clear` admin-style reset was
// `adminOnly`; heartbeat + active were ungated. Now everything is
// uniformly gated through `presence.read` so the audit map has a single
// permission for the surface.
const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/Presence/presenceController");
const { adminOnly, requireAction } = require("../../middleware/auth");

router.post("/heartbeat", requireAction("presence.read"), ctrl.heartbeat);
router.get ("/active",    requireAction("presence.read"), ctrl.getActive);
router.post("/clear",     adminOnly, ctrl.clear);

module.exports = router;
