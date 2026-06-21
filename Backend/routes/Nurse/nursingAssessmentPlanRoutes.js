// routes/Nurse/nursingAssessmentPlanRoutes.js
// ════════════════════════════════════════════════════════════════════
// R7hr-231 — the doctor-set nursing assessment plan for an admission.
//   GET /api/nursing-assessment-plan?admissionId=&uhid=
//        → { items:[{type,label,perDayMin}], todayCounts:{type:n}, assignedByName }
//        gated mar.read [Admin, Doctor, Nurse, MRD] — doctor + nurse both read.
//   PUT /api/nursing-assessment-plan  { admissionId|uhid, ipdNo, items:[…] }
//        → upsert the plan; gated doctor-orders.write [Admin, Doctor] — only the
//        doctor assigns which assessments + per-day minimums the nurse must do.
// ════════════════════════════════════════════════════════════════════
const express = require("express");
const router = express.Router();
const { requireAction } = require("../../middleware/auth");
const svc = require("../../services/Nurse/nursingAssessmentPlanService");

router.get("/", requireAction("mar.read"), async (req, res) => {
  try {
    const data = await svc.getPlan({ admissionId: req.query.admissionId, uhid: req.query.uhid });
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

router.put("/", requireAction("doctor-orders.write"), async (req, res) => {
  try {
    const plan = await svc.setPlan({
      admissionId: req.body.admissionId,
      uhid: req.body.uhid,
      ipdNo: req.body.ipdNo,
      items: req.body.items,
      actor: { id: req.user?.id, fullName: req.user?.fullName },
    });
    res.json({ success: true, data: plan });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
