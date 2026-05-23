/**
 * Generic nursing-assessment endpoints. The six frontend pages
 * (Daily, Fall Risk, Pressure Area, Pain, Nutrition, Patient Education)
 * all POST to `/api/nursing-assessments/<type>` with a payload specific
 * to that assessment. Stored on the NursingAssessment model.
 */
// R7as-FIX-11/D3-high: nursing-assessment write/read gating. Daily,
// fall-risk, pressure-area, pain, nutrition, education assessments are
// NABH IPSG records. Writes gated on `vitals.write` (Doctor/Nurse/Admin).
// Reads also gated — Pharmacist/Receptionist should not browse clinical
// observations they don't need (DPDP purpose-limitation).
const express = require("express");
const router  = express.Router();
const NursingAssessment = require("../../models/Nurse/NursingAssessmentModel");
const { attemptAuth, requireAction } = require("../../middleware/auth");
const { validateObjectIdParam } = require("../../utils/queryGuards");

router.use(attemptAuth);

const ALLOWED = ["daily", "fall-risk", "pressure-area", "pain", "nutrition", "education"];

/* POST /api/nursing-assessments/:type
   Body: any payload object. We split out UHID / admissionId / patientName
   / recordedBy so they index correctly; the rest goes into `data`. */
router.post("/:type", requireAction("vitals.write"), async (req, res) => {
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

    // R7bp — fan out to the NABH register matching this assessment type
    // (pain → PainAssessmentRegister, fall-risk → FallRiskRegister,
    // pressure-area → PressureUlcerRegister). Non-blocking: the assessment
    // is already saved; register write failures must not roll it back.
    try {
      const emitter = require("../../services/Compliance/nabhRegisterEmitter");
      emitter.emitFromNursingAssessment(doc, req.user).catch((e) =>
        console.error("NABH register emit error:", e.message),
      );
    } catch (_) { /* swallow */ }

    return res.status(201).json({ success: true, data: doc });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

/* GET /api/nursing-assessments?type=&admissionId=&UHID=
   List recent assessments for a patient/admission.
   R7az-A/D1-CRIT: read gated on `mar.read` (Admin/Doctor/Nurse/MRD) so
   the NABH IPSG assessment trail surfaces on MRD's discharged-patient
   view + cross-cover doctors see fall/pain assessments. Pre-R7az this
   was on `vitals.write` which conflated read+write into a write gate. */
router.get("/", requireAction("mar.read"), async (req, res) => {
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
router.get("/:id", validateObjectIdParam("id"), requireAction("mar.read"), async (req, res) => {
  try {
    const doc = await NursingAssessment.findById(req.params.id).lean();
    if (!doc) return res.status(404).json({ success: false, message: "Not found" });
    return res.json({ success: true, data: doc });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
