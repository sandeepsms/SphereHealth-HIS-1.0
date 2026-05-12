/**
 * Generic nursing-assessment endpoints. The six frontend pages
 * (Daily, Fall Risk, Pressure Area, Pain, Nutrition, Patient Education)
 * all POST to `/api/nursing-assessments/<type>` with a payload specific
 * to that assessment. Stored on the NursingAssessment model.
 */
const express = require("express");
const router  = express.Router();
const NursingAssessment = require("../../models/Nurse/NursingAssessmentModel");
const { attemptAuth } = require("../../middleware/auth");

router.use(attemptAuth);

const ALLOWED = ["daily", "fall-risk", "pressure-area", "pain", "nutrition", "education"];

/* POST /api/nursing-assessments/:type
   Body: any payload object. We split out UHID / admissionId / patientName
   / recordedBy so they index correctly; the rest goes into `data`. */
router.post("/:type", async (req, res) => {
  try {
    const { type } = req.params;
    if (!ALLOWED.includes(type)) {
      return res.status(400).json({ success: false, message: `Unknown assessment type: ${type}` });
    }
    const { UHID, patientName, admissionId, recordedBy, ...rest } = req.body || {};
    const doc = await NursingAssessment.create({
      type,
      UHID,
      patientName,
      admissionId: admissionId || undefined,
      recordedBy: recordedBy || req.user?.employeeId || "",
      recordedByUser: req.user?.id || null,
      data: rest,
    });
    return res.status(201).json({ success: true, data: doc });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

/* GET /api/nursing-assessments?type=&admissionId=&UHID=
   List recent assessments for a patient/admission. */
router.get("/", async (req, res) => {
  try {
    const filter = {};
    if (req.query.type)        filter.type        = req.query.type;
    if (req.query.admissionId) filter.admissionId = req.query.admissionId;
    if (req.query.UHID)        filter.UHID        = req.query.UHID;
    const list = await NursingAssessment.find(filter)
      .sort({ recordedAt: -1 })
      .limit(200)
      .lean();
    return res.json({ success: true, count: list.length, data: list });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

/* GET /api/nursing-assessments/:id — single record */
router.get("/:id", async (req, res) => {
  try {
    const doc = await NursingAssessment.findById(req.params.id).lean();
    if (!doc) return res.status(404).json({ success: false, message: "Not found" });
    return res.json({ success: true, data: doc });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
