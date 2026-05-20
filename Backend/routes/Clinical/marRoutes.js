const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/Clinical/marController");
const { attemptAuth, requireAction } = require("../../middleware/auth");

// Soft-auth so administer/record actions carry req.user (audit trail).
router.use(attemptAuth);

// R7q: Apply mar.write gate to every mutation. MAR records are clinical
// NABH-audit documents — only Admin/Nurse can create or modify them.
// Doctors discontinue via the doctor-orders / doctor-action flow instead.
router.get("/ipd/:ipdNo", ctrl.getByIPD);
router.get("/ipd/:ipdNo/date/:date", ctrl.getByIPDAndDate);
router.get("/uhid/:uhid", ctrl.getByUHID);
router.post("/",                                       requireAction("mar.write"), ctrl.createOrGet);
router.get("/:id", ctrl.getById);
router.put("/:id",                                     requireAction("mar.write"), ctrl.update);
router.post("/:id/medication",                         requireAction("mar.write"), ctrl.addMedication);
router.patch("/:id/medication/:medId/administer",      requireAction("mar.write"), ctrl.recordAdministration);
router.patch("/:id/medication/:medId/discontinue",     requireAction("mar.write"), ctrl.discontinueMedication);

module.exports = router;
