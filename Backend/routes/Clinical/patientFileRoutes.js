// routes/Clinical/patientFileRoutes.js
const router = require("express").Router();
const ctrl = require("../../controllers/Clinical/patientFileController");

// Complete file aggregator — used by CompletePatientFilePage.jsx
router.get("/:uhid/complete", ctrl.getCompleteFile);

// Paginated activity feed (audit trail)
router.get("/:uhid/activity", ctrl.getActivityFeed);

// Frontend-driven event logger (clicks, dropdown selects, navigation)
router.post("/:uhid/log", ctrl.logEvent);

module.exports = router;
