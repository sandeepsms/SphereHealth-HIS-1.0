// routes/MRD/mrdRoutes.js
// R7bb-FIX-E-12 / D6-HIGH-2: MRD retention-review + file-release endpoints.
const express = require("express");
const router  = express.Router();
const ctrl    = require("../../controllers/MRD/mrdController");
const { requireAction } = require("../../middleware/auth");

// MRD list of retention-due files — Admin / MRD / Doctor.
router.get ("/retention-due",        requireAction("mrd.read"),       ctrl.retentionReview);
// Release file — Admin-controlled (controller also accepts MRD role).
router.post("/files/:id/release",    requireAction("admission.reactivate"), ctrl.releaseFile);

module.exports = router;
