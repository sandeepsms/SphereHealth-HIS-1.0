// routes/Clinical/admissionInvestigationsRoutes.js
// ════════════════════════════════════════════════════════════════════
// R7hr-229 — read-only aggregator: ALL of a patient's investigations across
// an admission (InvestigationOrder results + LabTrend daily readings +
// LabReport narrative reports) as a day-wise + trend paragraph + structured
// days/trends. Consumed by the discharge-summary auto-fill and the new
// Doctor/Nurse "Investigations" panel tab.
//
//   GET /api/admission-investigations?uhid=&admissionId=
//
// Clinical-gated on patient-file.read [Admin, Doctor, Nurse, MRD] — the same
// audience that may read the patient file / dr-nurse panels (the discharge
// page runs as Doctor, the panels as Doctor/Nurse).
// ════════════════════════════════════════════════════════════════════
const express = require("express");
const router = express.Router();
const { requireAction } = require("../../middleware/auth");
const { getAdmissionInvestigations } = require("../../services/Investigation/admissionInvestigationsService");

router.get("/", requireAction("patient-file.read"), async (req, res) => {
  try {
    const data = await getAdmissionInvestigations({
      uhid: req.query.uhid,
      admissionId: req.query.admissionId,
    });
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
