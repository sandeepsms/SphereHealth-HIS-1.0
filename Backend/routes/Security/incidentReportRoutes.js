/**
 * incidentReportRoutes.js — Security incident register.
 *
 * R7bj-F4: validateObjectIdParam on every :id surface.
 */
const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/Security/incidentReportController");
const { requireAction } = require("../../middleware/auth");
const { validateObjectIdParam } = require("../../utils/queryGuards");

router.use(requireAction("security.incident-report"));

router.post ("/",              ctrl.create);
router.get  ("/",              ctrl.list);
router.get  ("/stats",         ctrl.stats);
router.get  ("/:id",           validateObjectIdParam("id"), ctrl.get);
router.patch("/:id/status",    validateObjectIdParam("id"), ctrl.updateStatus);

module.exports = router;
