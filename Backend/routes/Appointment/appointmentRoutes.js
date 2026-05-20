// R7au-FIX-12/D3-HIGH: appointment writes gated on `reception.register`.
// Pre-R7au any authenticated user could book/check-in/cancel any
// appointment. Reads stay open (front-desk needs the slot grid for
// every role).
const express = require("express");
const router  = express.Router();
const ctrl    = require("../../controllers/Appointment/appointmentController");
const { requireAction } = require("../../middleware/auth");

router.post("/",                  requireAction("reception.register"), ctrl.book);
router.get ("/",                  ctrl.list);
router.get ("/slots",             ctrl.getSlots);
router.post("/:id/check-in",      requireAction("reception.register"), ctrl.checkIn);
router.post("/:id/cancel",        requireAction("reception.register"), ctrl.cancel);

module.exports = router;
