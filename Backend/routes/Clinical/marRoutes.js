const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/Clinical/marController");
const { attemptAuth, requireAction } = require("../../middleware/auth");
// R7bm-F9: 400 on a malformed :id before findById throws CastError -> 500.
const { validateObjectIdParam } = require("../../utils/queryGuards");

// Soft-auth so administer/record actions carry req.user (audit trail).
router.use(attemptAuth);

// R7q: Apply mar.write gate to every mutation. MAR records are clinical
// NABH-audit documents — only Admin/Nurse can create or modify them.
// Doctors discontinue via the doctor-orders / doctor-action flow instead.
//
// R7az-A/D1-CRIT: read gates added. Pre-R7az every GET was open to any
// authenticated role — Pharmacist could enumerate the medication
// administration trail by IPD / UHID / id (PHI + drug-history leak).
// Now `mar.read` (Admin/Doctor/Nurse/MRD) on every GET.
router.get("/ipd/:ipdNo",                              requireAction("mar.read"),  ctrl.getByIPD);
router.get("/ipd/:ipdNo/date/:date",                   requireAction("mar.read"),  ctrl.getByIPDAndDate);
router.get("/uhid/:uhid",                              requireAction("mar.read"),  ctrl.getByUHID);
router.post("/",                                       requireAction("mar.write"), ctrl.createOrGet);
router.get("/:id",                                     validateObjectIdParam("id"), requireAction("mar.read"),  ctrl.getById);
router.put("/:id",                                     validateObjectIdParam("id"), requireAction("mar.write"), ctrl.update);
router.post("/:id/medication",                         validateObjectIdParam("id"), requireAction("mar.write"), ctrl.addMedication);
router.patch("/:id/medication/:medId/administer",      validateObjectIdParam("id"), requireAction("mar.write"), ctrl.recordAdministration);
router.patch("/:id/medication/:medId/discontinue",     validateObjectIdParam("id"), requireAction("mar.write"), ctrl.discontinueMedication);

module.exports = router;
