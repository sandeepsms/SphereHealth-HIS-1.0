const express = require("express");
const router  = express.Router();
const ctrl    = require("../../controllers/Appointment/appointmentController");

router.post("/",                  ctrl.book);
router.get ("/",                  ctrl.list);
router.get ("/slots",             ctrl.getSlots);
router.post("/:id/check-in",      ctrl.checkIn);
router.post("/:id/cancel",        ctrl.cancel);

module.exports = router;
