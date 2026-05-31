const express = require("express");
const router  = express.Router();
const ctrl    = require("../controllers/hospitalSettingsController");
const { authenticate, requireAction } = require("../middleware/auth");

// R7fs: GET is PUBLIC (no authenticate) so the login page + first-paint
// sidebar/header show the right hospital name+logo BEFORE the user
// signs in. Pre-R7fs the global `authenticate` middleware in
// routes/index.js rejected the unauthenticated call → frontend
// HospitalSettingsProvider fell through to DEFAULT_SETTINGS
// ("Hospital HIS" + generic logo) and only flipped to the real name
// after a hard refresh once the JWT was already in sessionStorage.
// Hospital identity (name / logo / address / phones / NABH badge)
// is public branding — none of it is PHI or financial. So this
// loosening is safe and is also how Sir Ganga Ram / Max / Tirath
// Ram's login screens behave.
router.get("/",  ctrl.getSettings);

// Write — Admin only. Local authenticate + requireAction (since the
// router is now mounted ABOVE the global authenticate in
// routes/index.js, we must auth ourselves on writes).
router.put("/",  authenticate, requireAction("settings.write"), ctrl.updateSettings);

module.exports = router;
