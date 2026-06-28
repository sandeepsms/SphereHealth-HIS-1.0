// routes/backup/backupAdminRoutes.js
// R7hr-272 — Admin backup & recovery endpoints. The global authenticate() in
// routes/index.js runs before these; each route additionally requires the
// Admin-only backup.manage action. RESTORE is intentionally NOT here (CLI-only).
"use strict";

const express = require("express");
const router  = express.Router();
const { requireAction } = require("../../middleware/auth");
const ctrl = require("../../controllers/backup/backupAdminController");

router.get ("/status",          requireAction("backup.manage"), ctrl.getStatus);
router.post("/run",             requireAction("backup.manage"), ctrl.runNow);
router.get ("/download/:file",  requireAction("backup.manage"), ctrl.download);

module.exports = router;
