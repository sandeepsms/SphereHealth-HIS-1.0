// Doctor/routes/doctorNotesRoutes.js
const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/Doctor/doctorNotesController");

router.get("/pending-orders/:ipdNo", ctrl.getPendingOrders);
router.get("/patient/:patientId", ctrl.getNotesByPatient);
router.get("/ipd/:ipdNo", ctrl.getNotesByIPD);
router.post("/", ctrl.createNote);
router.get("/:id", ctrl.getNoteById);
router.put("/:id", ctrl.updateNote);
router.patch("/:id/sign", ctrl.signNote);
router.patch("/:id/diagnosis", ctrl.updateDiagnosis);
router.delete("/:id", ctrl.deleteNote);

module.exports = router;
