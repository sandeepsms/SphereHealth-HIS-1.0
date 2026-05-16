const express = require("express");
const router  = express.Router();
const ctrl    = require("../../controllers/Clinical/wardTaskController");
const { requireAction } = require("../../middleware/auth");

// Reads — broad: anyone in the IPD/Reception/Ward Boy circle can see
// the task board so a nurse can verify their request was claimed.
router.get   ("/",      requireAction("ward.read"),    ctrl.list);
router.get   ("/stats", requireAction("ward.read"),    ctrl.stats);

// Create — Nurse / Doctor / Receptionist (clinical staff who'd raise a
// transport / equipment / sample request). Ward Boys themselves can also
// create — e.g. logging an ad-hoc errand they were verbally asked to do.
router.post  ("/",      requireAction("ward.create"),  ctrl.create);

// Lifecycle transitions — Ward Boy only (plus Admin for override). The
// controller also checks `assignedTo === req.user.id` so one ward boy
// can't accidentally close another's task.
router.patch ("/:id/accept",    requireAction("ward.fulfill"), ctrl.accept);
router.patch ("/:id/start",     requireAction("ward.fulfill"), ctrl.start);
router.patch ("/:id/complete",  requireAction("ward.fulfill"), ctrl.complete);

// Cancel — requester (any role) or Admin (controller-side check). Gated
// by ward.create so the surface is "anyone who could have made the
// request" plus Admin.
router.patch ("/:id/cancel",    requireAction("ward.create"),  ctrl.cancel);

// Free-form edit — Admin only for now; downgrade later if needed.
router.patch ("/:id",           requireAction("ward.admin"),   ctrl.update);

module.exports = router;
