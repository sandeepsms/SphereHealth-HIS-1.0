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
// R7hr-114 — After R26 (Doctor IA + Nurse IA = separate records, both via
// section="nursing"|"doctor" on this endpoint), the Nurse role MUST be
// able to POST/PUT/PATCH-sign her own initial note. requireAnyAction
// opens the route for nursing.write while keeping the doctor gate intact.
// Section-aware payload guards in buildPayload (R26 wrappers) still
// prevent a nurse from writing doctor.* noteDetails. Diagnosis + delete
// remain doctor-only.
const { requireAction, requireAnyAction } = require("../../middleware/auth");
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
// R7hr-114 — POST/PUT/sign/amend accept doctor-orders.write OR nursing.write
// so Nurse role can save her own IA section. Diagnosis + delete stay doctor-only.
router.post("/",                      requireAnyAction("doctor-orders.write", "nursing.write"), credentialExpiryBlocker("NMC_REG"), ctrl.createNote);
router.get("/:id",                    validateObjectIdParam("id"), requireAction("doctor-notes.read"),  ctrl.getNoteById);
router.put("/:id",                    validateObjectIdParam("id"), requireAnyAction("doctor-orders.write", "nursing.write"), ctrl.updateNote);
router.patch("/:id/sign",             validateObjectIdParam("id"), requireAnyAction("doctor-orders.write", "nursing.write"), credentialExpiryBlocker("NMC_REG"), ctrl.signNote);
router.patch("/:id/diagnosis",        validateObjectIdParam("id"), requireAction("doctor-orders.write"), credentialExpiryBlocker("NMC_REG"), ctrl.updateDiagnosis);
// Post-sign amendment of a SIGNED Initial Assessment / progress note.
// NABH IMS.2 + MCI Indian Medical Records Act 1956 §3: signed notes can
// only be corrected via a tracked amendment that preserves the original
// attestation. Controller pushes onto note.amendments[], flips status to
// 'amended', and emits ClinicalAudit (event DOCTOR_NOTE_AMENDED, 7y floor).
// Same write gates as /sign + /:id/diagnosis — action permission + NMC reg.
router.post("/:id/amend",             validateObjectIdParam("id"), requireAnyAction("doctor-orders.write", "nursing.write"), credentialExpiryBlocker("NMC_REG"), ctrl.amendNote);
router.delete("/:id",                 validateObjectIdParam("id"), requireAction("doctor-orders.write"), ctrl.deleteNote);

module.exports = router;
