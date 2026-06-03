// Doctor/routes/doctorNotesRoutes.js
const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/Doctor/DoctorNotesController");
// R7az-A/D1-CRIT: every endpoint now sits behind the global authenticate()
// (mounted in routes/index.js) AND an action gate. The old `attemptAuth`
// would silently pass through anonymous traffic — combined with the
// missing read gate, doctor notes were readable by ANY caller. Reads now
// require `doctor-notes.read` (Admin/Doctor/Nurse/MRD); writes stay on
// `doctor-orders.write` (Admin/Doctor) as before.
const { requireAction } = require("../../middleware/auth");
// B1-T08: write surfaces (create/sign/amend-diagnosis) are licensed clinical
// acts under NMC Regulations 2002 + NABH HRD.3 — block on missing/expired
// NMC_REG via the role-agnostic, type-specific middleware. Mounted AFTER
// requireAction so the role gate still runs first.
const { credentialExpiryBlocker } = require("../../middleware/credentialExpiryBlocker");
// R7bm-F9: 400 on a malformed :id before findById throws CastError -> 500.
const { validateObjectIdParam } = require("../../utils/queryGuards");

router.get("/pending-orders/:ipdNo",  requireAction("doctor-notes.read"),  ctrl.getPendingOrders);
router.get("/patient/:patientId",     requireAction("doctor-notes.read"),  ctrl.getNotesByPatient);
router.get("/ipd/:ipdNo",             requireAction("doctor-notes.read"),  ctrl.getNotesByIPD);
router.post("/",                      requireAction("doctor-orders.write"), credentialExpiryBlocker("NMC_REG"), ctrl.createNote);
router.get("/:id",                    validateObjectIdParam("id"), requireAction("doctor-notes.read"),  ctrl.getNoteById);
router.put("/:id",                    validateObjectIdParam("id"), requireAction("doctor-orders.write"), ctrl.updateNote);
router.patch("/:id/sign",             validateObjectIdParam("id"), requireAction("doctor-orders.write"), credentialExpiryBlocker("NMC_REG"), ctrl.signNote);
router.patch("/:id/diagnosis",        validateObjectIdParam("id"), requireAction("doctor-orders.write"), credentialExpiryBlocker("NMC_REG"), ctrl.updateDiagnosis);
router.delete("/:id",                 validateObjectIdParam("id"), requireAction("doctor-orders.write"), ctrl.deleteNote);

module.exports = router;
