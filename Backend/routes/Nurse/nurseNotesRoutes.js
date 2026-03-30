// Nurse/routes/nurseNotesRoutes.js
const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/Nurse/nurseNotesController");

router.get("/today/:ipdNo", ctrl.getTodayNotes);
router.get("/patient/:patientId", ctrl.getNotesByPatient);
router.get("/ipd/:ipdNo", ctrl.getNotesByIPD);
router.post("/", ctrl.createNote);
router.get("/:id", ctrl.getNoteById);
router.put("/:id", ctrl.updateNote);
router.patch("/:id/confirm-order", ctrl.confirmOrder);
router.delete("/:id", ctrl.deleteNote);

module.exports = router;
