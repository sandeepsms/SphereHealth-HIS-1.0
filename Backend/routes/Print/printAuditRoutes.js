// routes/Print/printAuditRoutes.js
// R7bf-F / A4-CRIT-4: routes for the print-audit collection.
// Mounted at /api/print-audit by routes/index.js. The parent
// `authenticate` is applied at the index.js level, so every
// handler here already has req.user populated.
//
// Note on permissions: `print.audit.write` is a new permission key
// owned by Agent G (config/permissions.js). Until that lands, we
// gate on `requireAction("print.audit.write")` so the route is
// already wired and ready. If permissions.js doesn't yet define
// the key, the role gate will deny — at which point Agent G's
// permission patch unblocks this route in the same release window.
const express = require("express");
const router  = express.Router();

const { requireAction } = require("../../middleware/auth");
const ctrl = require("../../controllers/Print/printAuditController");

// POST /api/print-audit  — record a print event + bump entity printCount
router.post("/", requireAction("print.audit.write"), ctrl.recordPrint);

// GET /api/print-audit/count?entityType=...&entityId=... — probe count
router.get("/count", ctrl.getPrintCount);

// GET /api/print-audit?entityType=...&entityId=...&limit=50 — full list
router.get("/", ctrl.listPrintAudit);

module.exports = router;
