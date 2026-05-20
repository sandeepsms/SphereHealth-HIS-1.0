// R7as-FIX-11/D3-high: MLC (medico-legal case) write gating. MLCs are
// PHI + police-relevant — they cannot be created/edited/deleted by any
// authenticated role. Writes now gate on `consent.write` (Doctor/Admin
// per Backend/config/permissions.js). Reads keep soft-auth + per-doctor
// filtering.
const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/MLC/mlcController");
const { attemptAuth, attachDoctorProfile, requireAction } = require("../../middleware/auth");

// Soft-auth + doctor profile resolver — list / read endpoints auto-restrict
// to the logged-in doctor's MLCs. Non-doctor roles see everything.
router.use(attemptAuth, attachDoctorProfile);

// Literal routes BEFORE param routes to avoid /:idOrMlr swallowing them.
router.get   ("/preview-prefix/:doctorId", ctrl.previewPrefix);

router.get   ("/",            ctrl.listMLC);
router.post  ("/",            requireAction("consent.write"), ctrl.createMLC);
router.get   ("/:idOrMlr",    ctrl.getMLC);
router.put   ("/:idOrMlr",    requireAction("consent.write"), ctrl.updateMLC);
router.delete("/:idOrMlr",    requireAction("consent.write"), ctrl.deleteMLC);

module.exports = router;
