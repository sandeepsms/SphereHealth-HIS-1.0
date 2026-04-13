const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/Nurse/nursingCarePlanController");

router.get("/uhid/:uhid", ctrl.getByUHID);
router.get("/ipd/:ipdNo", ctrl.getByIPD);
router.get("/admission/:admissionId", ctrl.getByAdmission);
router.post("/", ctrl.create);
router.get("/:id", ctrl.getById);
router.put("/:id", ctrl.update);
router.patch("/:id/problem/:problemId/status", ctrl.updateProblemStatus);
router.patch("/:id/complete", ctrl.complete);
router.delete("/:id", ctrl.delete);

module.exports = router;
