// routes/Nursing/shiftHandoverRoutes.js

const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/Nurse//shiftHandoverController");
const validate = require("../../middleware/validateRequest");

router.post(
  "/",
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
router.get("/by-admission", validate(["admissionId"]), ctrl.getByAdmission);
router.get("/latest", validate(["uhid"]), ctrl.getLatest);
router.patch("/:id/verify", ctrl.verifyHandover);

module.exports = router;
