const express = require("express");
const router  = express.Router();
const ctrl    = require("../../controllers/Clinical/dietitianController");
const { requireAction } = require("../../middleware/auth");

/* ── Templates ──
   Reads open to Admin, Dietician, Doctor, Nurse (they all consult on
   diet). Writes restricted to Dietician + Admin via diet.write. */
router.get   ("/templates",        requireAction("diet.read"),  ctrl.listTemplates);
router.get   ("/templates/:id",    requireAction("diet.read"),  ctrl.getTemplate);
router.post  ("/templates",        requireAction("diet.write"), ctrl.createTemplate);
router.put   ("/templates/:id",    requireAction("diet.write"), ctrl.updateTemplate);
router.delete("/templates/:id",    requireAction("diet.write"), ctrl.deleteTemplate);

/* ── Referred patients (active IPD + flagged OPD) ── */
router.get   ("/patients",         requireAction("diet.read"),  ctrl.referredPatients);

/* ── Per-patient diet plans ── */
router.get   ("/patient/:uhid/plans", requireAction("diet.read"),  ctrl.patientPlans);
router.get   ("/plan/:id",            requireAction("diet.read"),  ctrl.getPlan);
router.post  ("/plan",                requireAction("diet.write"), ctrl.createPlan);
router.put   ("/plan/:id",            requireAction("diet.write"), ctrl.updatePlan);
// R7bb-FIX-E-9 / D6-CRIT-6: dietitian → kitchen indent push.
router.post  ("/plan/:id/kitchen-indent", requireAction("diet.write"), ctrl.pushKitchenIndent);

/* ── Dashboard stats ── */
router.get   ("/stats",            requireAction("diet.read"),  ctrl.stats);

module.exports = router;
