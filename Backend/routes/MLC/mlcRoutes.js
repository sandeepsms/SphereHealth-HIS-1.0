// R7az-A/D1-CRIT: MLC reads were ungated pre-R7az (any logged-in role
// could list / fetch any medico-legal case, including police-relevant
// PHI). Writes now use the new `mlc.write` (Admin/Doctor only) — the
// previous gate of `consent.write` let Nurse write MLR records too,
// which is wrong (an MLR is a doctor's legal attestation). Reads use
// the new `mlc.read` (Admin/Doctor/Nurse) so a nurse on the treatment
// team can read but not author/edit/delete.
const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/MLC/mlcController");
const { attemptAuth, attachDoctorProfile, requireAction } = require("../../middleware/auth");

// Soft-auth + doctor profile resolver — list / read endpoints auto-restrict
// to the logged-in doctor's MLCs. Non-doctor roles see everything.
router.use(attemptAuth, attachDoctorProfile);

// Literal routes BEFORE param routes to avoid /:idOrMlr swallowing them.
router.get   ("/preview-prefix/:doctorId", requireAction("mlc.read"),  ctrl.previewPrefix);

router.get   ("/",            requireAction("mlc.read"),  ctrl.listMLC);
router.post  ("/",            requireAction("mlc.write"), ctrl.createMLC);
router.get   ("/:idOrMlr",    requireAction("mlc.read"),  ctrl.getMLC);
router.put   ("/:idOrMlr",    requireAction("mlc.write"), ctrl.updateMLC);
router.delete("/:idOrMlr",    requireAction("mlc.write"), ctrl.deleteMLC);

module.exports = router;
