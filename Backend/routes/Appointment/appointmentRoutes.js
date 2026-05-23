// R7au-FIX-12/D3-HIGH: appointment writes gated on `reception.register`.
// Pre-R7au any authenticated user could book/check-in/cancel any
// appointment. Reads stay open (front-desk needs the slot grid for
// every role).
const express = require("express");
const router  = express.Router();
const ctrl    = require("../../controllers/Appointment/appointmentController");
const { requireAction } = require("../../middleware/auth");
// R7bm-F9: 400 on a malformed :id before findById throws CastError -> 500.
const { validateObjectIdParam } = require("../../utils/queryGuards");

// R7bb-B/D4-HIGH-S1: reads now gated. Appointment list exposes patient
// name + phone + visit reason — desk-staff-only data. Slot grid is
// queried from the same surface so its gate follows the list.
router.post("/",                  requireAction("reception.register"), ctrl.book);
router.get ("/",                  requireAction("reception.register"), ctrl.list);
router.get ("/slots",             requireAction("reception.register"), ctrl.getSlots);
// R7az-A/audit point: check-in is the explicit appointment-confirm flow —
// gated on `appointment.confirm` (Admin/Receptionist) which is identical
// to reception.register in practice but flagged separately so the audit
// surface can distinguish "the receptionist confirmed appointment #X" from
// "the receptionist created a new walk-in registration".
router.post("/:id/check-in",      validateObjectIdParam("id"), requireAction("appointment.confirm"), ctrl.checkIn);
router.post("/:id/cancel",        validateObjectIdParam("id"), requireAction("reception.register"),  ctrl.cancel);

module.exports = router;
