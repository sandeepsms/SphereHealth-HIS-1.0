const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/Clinical/consentFormController");

router.get("/uhid/:uhid", ctrl.getByUHID);
router.get("/admission/:admissionId", ctrl.getByAdmission);
router.post("/", ctrl.create);
router.get("/:id", ctrl.getById);
router.put("/:id", ctrl.update);
router.patch("/:id/sign", ctrl.sign);
router.patch("/:id/refuse", ctrl.refuse);
router.patch("/:id/revoke", ctrl.revoke);
router.delete("/:id", ctrl.delete);

module.exports = router;
