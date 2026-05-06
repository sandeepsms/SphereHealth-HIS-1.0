const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/Clinical/dischargeSummaryController");

router.get("/uhid/:uhid", ctrl.getByUHID);
router.get("/admission/:admissionId", ctrl.getByAdmission);
router.get("/", ctrl.getAll);
router.post("/", ctrl.create);
router.get("/:id", ctrl.getById);
router.put("/:id", ctrl.update);
router.patch("/:id/finalize", ctrl.finalize);
router.delete("/:id", ctrl.delete);

module.exports = router;
