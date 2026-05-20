// routes/Nursing/shiftHandoverRoutes.js
//
// R7au-FIX-12/D3-HIGH: nurse shift-handover writes gated on `mar.write`
// (Admin / Nurse). Pre-R7au any authenticated user could create or
// verify a handover — NABH MOM.2 (transfer of care) audit record.

const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/Nurse//shiftHandoverController");
const validate = require("../../middleware/validateRequest");
const { requireAction } = require("../../middleware/auth");

router.post(
  "/",
  requireAction("mar.write"),
  validate([
    "admissionId",
    "uhid",
    "fromShift",
    "toShift",
    "date",
    "outgoingNurse",
    "incomingNurse",
    "patientStatus",
  ]),
  ctrl.createHandover,
);
router.get  ("/by-admission",          validate(["admissionId"]), ctrl.getByAdmission);
router.get  ("/latest",                validate(["uhid"]),        ctrl.getLatest);
router.patch("/:id/verify",            requireAction("mar.write"), ctrl.verifyHandover);

module.exports = router;
