const express = require("express");
const router  = express.Router();
const ctrl    = require("../controllers/hospitalSettingsController");
const { requireAction } = require("../middleware/auth");

// Read — every authenticated staff member can read identity / print config
// (sidebar, print headers, register footers all depend on this).
router.get("/",  ctrl.getSettings);

// Write — Admin only.
router.put("/",  requireAction("settings.write"), ctrl.updateSettings);

module.exports = router;
