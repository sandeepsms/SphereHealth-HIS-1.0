// routes/Clinical/medicalCertificateRoutes.js
// ════════════════════════════════════════════════════════════════════
// R7fu — Medical Certificate routes.
//
// All paths are reached after the global `authenticate` mount in
// Backend/routes/index.js, so req.user is guaranteed populated.
//
// Permission gates use the existing action catalog:
//   reads  → patient-file.read      (Admin/Doctor/Nurse/MRD) — R7hr-225 security
//            audit: a certificate carries clinical PHI (diagnosis, ICD-10,
//            cause-of-death/WHO Form-4, disability %, sterilization), so the
//            reads were tightened off the broad demographics-only patient.read
//            (which admitted Pharmacist/Lab/Dietician/TPA/Accountant/Reception)
//            onto the clinical-file token, matching discharge-summary.read.
//            The only consumers are the Doctor/Nurse patient panels (clinical).
//   writes → patient.write-clinical (Admin/Doctor/Nurse)
// ════════════════════════════════════════════════════════════════════

const express = require("express");
const router = express.Router();

const ctrl = require("../../controllers/Clinical/medicalCertificateController");
const { requireAction } = require("../../middleware/auth");
const { validateObjectIdParam } = require("../../utils/queryGuards");

// Create / list
router.post("/",  requireAction("patient.write-clinical"), ctrl.create);
router.get("/",   requireAction("patient-file.read"),           ctrl.list);

// Patient lookups
router.get("/by-uhid/:uhid",
  requireAction("patient-file.read"),
  ctrl.getByUHID);

// Single fetch + revoke (with ObjectId guard for clean 400s)
router.get("/:id",
  validateObjectIdParam("id"),
  requireAction("patient-file.read"),
  ctrl.getById);

router.patch("/:id/revoke",
  validateObjectIdParam("id"),
  requireAction("patient.write-clinical"),
  ctrl.revoke);

module.exports = router;
