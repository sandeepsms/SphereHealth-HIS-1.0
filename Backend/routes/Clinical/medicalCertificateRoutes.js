// routes/Clinical/medicalCertificateRoutes.js
// ════════════════════════════════════════════════════════════════════
// R7fu — Medical Certificate routes.
//
// All paths are reached after the global `authenticate` mount in
// Backend/routes/index.js, so req.user is guaranteed populated.
//
// Permission gates use the existing action catalog:
//   reads  → patient.read           (Admin/Receptionist/Doctor/Nurse/Lab/Pharm/Dietician/TPA/Accountant)
//   writes → patient.write-clinical (Admin/Doctor/Nurse)
// `clinical.read` / `clinical.write` actions do NOT exist in
// Backend/config/permissions.js — spec hint #7 said to fall through to
// the closest available action when that's the case.
// ════════════════════════════════════════════════════════════════════

const express = require("express");
const router = express.Router();

const ctrl = require("../../controllers/Clinical/medicalCertificateController");
const { requireAction } = require("../../middleware/auth");
const { validateObjectIdParam } = require("../../utils/queryGuards");

// Create / list
router.post("/",  requireAction("patient.write-clinical"), ctrl.create);
router.get("/",   requireAction("patient.read"),           ctrl.list);

// Patient lookups
router.get("/by-uhid/:uhid",
  requireAction("patient.read"),
  ctrl.getByUHID);

// Single fetch + revoke (with ObjectId guard for clean 400s)
router.get("/:id",
  validateObjectIdParam("id"),
  requireAction("patient.read"),
  ctrl.getById);

router.patch("/:id/revoke",
  validateObjectIdParam("id"),
  requireAction("patient.write-clinical"),
  ctrl.revoke);

module.exports = router;
