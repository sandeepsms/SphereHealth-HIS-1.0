/**
 * feedbackRoutes — authenticated staff surface for patient feedback.
 * Mounted at /api/feedback (after the global JWT wall).
 */
const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/Quality/feedbackController");
const { authenticate, requireAction } = require("../../middleware/auth");

router.use(authenticate);

// Read — dashboard + list (Admin / Quality / Receptionist / MRD)
router.get("/stats",         requireAction("feedback.read"), ctrl.stats);
// NABH PRE.6 / QPS — month-bucketed PROM/PREM experience indicator for the CQI
// committee's quality dashboard (satisfaction rate + NPS trend over time).
router.get("/cqi-indicator", requireAction("feedback.read"), ctrl.cqiIndicator);
router.get("/",              requireAction("feedback.read"), ctrl.list);

// Write — staff entry + mint a patient link
router.post("/",              requireAction("feedback.write"), ctrl.staffCreate);
router.post("/generate-link", requireAction("feedback.write"), ctrl.generateLink);

module.exports = router;
