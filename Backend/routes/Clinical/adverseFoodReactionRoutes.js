// routes/Clinical/adverseFoodReactionRoutes.js
// ════════════════════════════════════════════════════════════════════
// R7bj-F2 / R7bi-KI-CRIT-1 — food-ADR register routes
// (mounted at /api/food-reactions by the F-coordinator).
//
// Permission gates (F-coordinator wires the role map):
//   quality.food-reaction.read   — Admin / Doctor / Nurse / Dietician / MRD
//   quality.food-reaction.write  — Admin / Doctor / Nurse / Dietician
// ════════════════════════════════════════════════════════════════════

"use strict";

const express = require("express");
const router  = express.Router();

const ctrl = require("../../controllers/Clinical/adverseFoodReactionController");
const { requireAction } = require("../../middleware/auth");
const { validateObjectIdParam } = require("../../utils/queryGuards");

router.get("/",
  requireAction("quality.food-reaction.read"),
  ctrl.list,
);
router.get("/:id",
  validateObjectIdParam("id"),
  requireAction("quality.food-reaction.read"),
  ctrl.getOne,
);

router.post("/",
  requireAction("quality.food-reaction.write"),
  ctrl.create,
);
router.put("/:id",
  validateObjectIdParam("id"),
  requireAction("quality.food-reaction.write"),
  ctrl.update,
);
router.put("/:id/close",
  validateObjectIdParam("id"),
  requireAction("quality.food-reaction.write"),
  ctrl.close,
);
router.put("/:id/escalate",
  validateObjectIdParam("id"),
  requireAction("quality.food-reaction.write"),
  ctrl.escalate,
);
router.put("/:id/reopen",
  validateObjectIdParam("id"),
  requireAction("quality.food-reaction.write"),
  ctrl.reopen,
);

module.exports = router;
