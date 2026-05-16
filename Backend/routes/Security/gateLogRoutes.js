const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/Security/gateLogController");
const { requireAction } = require("../../middleware/auth");

// All gate-log surfaces are gated by the security.gate-log permission so
// only the Security role (and Admin / Reception, which the permissions
// matrix grants) can touch them.
router.use(requireAction("security.gate-log"));

router.post("/",       ctrl.create);
router.get ("/",       ctrl.list);
router.get ("/stats",  ctrl.stats);

module.exports = router;
