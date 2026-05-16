const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/Security/incidentReportController");
const { requireAction } = require("../../middleware/auth");

router.use(requireAction("security.incident-report"));

router.post ("/",              ctrl.create);
router.get  ("/",              ctrl.list);
router.get  ("/stats",         ctrl.stats);
router.get  ("/:id",           ctrl.get);
router.patch("/:id/status",    ctrl.updateStatus);

module.exports = router;
