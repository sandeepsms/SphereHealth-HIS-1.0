// routes/Compliance/assessmentComplianceRoutes.js
// ════════════════════════════════════════════════════════════════════
// R7bn-5 / D6-fix: AssessmentCompliance read API.
//
// Frontend reads this to render OVERDUE / DUE_SOON badges on the
// Nursing Notes + Doctor Notes patient header tiles.
// ════════════════════════════════════════════════════════════════════
const express = require("express");
const router = express.Router();
const { attemptAuth, requireAction } = require("../../middleware/auth");
const { validateObjectIdParam } = require("../../utils/queryGuards");
const {
  getStatusByAdmission,
} = require("../../services/Compliance/assessmentComplianceService");

router.use(attemptAuth);

/**
 * GET /api/compliance/assessment-status/:admissionId
 * Returns one row per (assessmentType, role) for this admission.
 * `mar.read` gates it because nurse + doctor + MRD all need this
 * view, and the rows don't contain raw PHI beyond UHID + patient name.
 */
router.get(
  "/assessment-status/:admissionId",
  validateObjectIdParam("admissionId"),
  requireAction("mar.read"),
  async (req, res) => {
    try {
      const rows = await getStatusByAdmission(req.params.admissionId);
      // Surface a single summary flag so the frontend can render one
      // red dot on the header without iterating server-side again.
      const overdueCount = rows.filter(r => r.status === "OVERDUE").length;
      const dueSoonCount = rows.filter(r => r.status === "DUE_SOON").length;
      return res.json({
        success: true,
        data: rows,
        summary: {
          total:    rows.length,
          overdue:  overdueCount,
          dueSoon:  dueSoonCount,
          worst:    overdueCount > 0 ? "OVERDUE" : dueSoonCount > 0 ? "DUE_SOON" : "OK",
        },
      });
    } catch (e) {
      return res.status(500).json({ success: false, message: e.message });
    }
  },
);

module.exports = router;
