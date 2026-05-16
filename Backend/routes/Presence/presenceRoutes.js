const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/Presence/presenceController");

router.post("/heartbeat", ctrl.heartbeat);
router.get ("/active",    ctrl.getActive);
router.post("/clear",     ctrl.clear);

module.exports = router;
