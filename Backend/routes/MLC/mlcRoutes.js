const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/MLC/mlcController");
const { attemptAuth, attachDoctorProfile } = require("../../middleware/auth");

// Soft-auth + doctor profile resolver — list / read endpoints auto-restrict
// to the logged-in doctor's MLCs. Non-doctor roles see everything.
router.use(attemptAuth, attachDoctorProfile);

// Literal routes BEFORE param routes to avoid /:idOrMlr swallowing them.
router.get("/preview-prefix/:doctorId", ctrl.previewPrefix);

router.get("/",            ctrl.listMLC);
router.post("/",           ctrl.createMLC);
router.get("/:idOrMlr",    ctrl.getMLC);
router.put("/:idOrMlr",    ctrl.updateMLC);
router.delete("/:idOrMlr", ctrl.deleteMLC);

module.exports = router;
