const express = require("express");
const router  = express.Router();
const ctrl    = require("../controllers/hospitalSettingsController");

router.get("/",  ctrl.getSettings);    // GET  /api/hospital-settings
router.put("/",  ctrl.updateSettings); // PUT  /api/hospital-settings

module.exports = router;
