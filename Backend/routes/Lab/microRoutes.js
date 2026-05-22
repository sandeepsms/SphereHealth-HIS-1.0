// Backend/routes/Lab/microRoutes.js  (R7bd-E-4 / A3-HIGH-9)
//
// Microbiology multi-step appender endpoints. Mounted at
// /api/lab-records/micro/* in routes/index.js. We mount this BEFORE the
// existing /lab-records router so /api/lab-records/micro/* is captured
// here rather than falling through to Agent C's controller.
//
// Gate: `lab.write` (existing). If absent in permissions.js fallback to
// `lab.records.write` so the surface stays usable from day one.
const express = require("express");
const router  = express.Router();
const { requireAction } = require("../../middleware/auth");
const appender = require("../../services/Lab/microbiologyAppender");

// POST /api/lab-records/micro/step
router.post("/step", requireAction("lab.records.write"), async (req, res, next) => {
  try {
    const u = req.user || {};
    const b = req.body || {};
    const row = await appender.appendStep({
      orderItemId:   b.orderItemId,
      labReportId:   b.labReportId || null,
      UHID:          b.UHID || "",
      stepKind:      b.stepKind,
      payload:       b.payload || {},
      performedBy:   u.fullName || u.employeeId || "Lab",
      performedById: u._id || u.id,
      signedBy:      b.stepKind === "FINAL" ? (u.fullName || u.employeeId || "") : "",
      signedById:    b.stepKind === "FINAL" ? (u._id || u.id || null) : null,
    });
    res.status(201).json({ success: true, data: row });
  } catch (e) {
    if (e.status) {
      return res.status(e.status).json({ success: false, message: e.message, code: e.code });
    }
    next(e);
  }
});

// GET /api/lab-records/micro/:orderItemId — compiled timeline
router.get("/:orderItemId", requireAction("lab.records.read"), async (req, res, next) => {
  try {
    const list = await appender.compileSteps(req.params.orderItemId);
    res.json({ success: true, data: list, count: list.length });
  } catch (e) {
    if (e.status) {
      return res.status(e.status).json({ success: false, message: e.message, code: e.code });
    }
    next(e);
  }
});

module.exports = router;
