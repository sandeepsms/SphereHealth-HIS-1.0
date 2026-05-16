const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/Clinical/marController");
const { attemptAuth } = require("../../middleware/auth");

// Soft-auth so administer/record actions carry req.user (audit trail).
router.use(attemptAuth);

router.get("/ipd/:ipdNo", ctrl.getByIPD);
router.get("/ipd/:ipdNo/date/:date", ctrl.getByIPDAndDate);
router.get("/uhid/:uhid", ctrl.getByUHID);
router.post("/", ctrl.createOrGet);
router.get("/:id", ctrl.getById);
router.put("/:id", ctrl.update);
router.post("/:id/medication", ctrl.addMedication);
router.patch("/:id/medication/:medId/administer", ctrl.recordAdministration);
router.patch("/:id/medication/:medId/discontinue", ctrl.discontinueMedication);

module.exports = router;
