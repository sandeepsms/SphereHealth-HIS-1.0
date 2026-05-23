// routes/Pharmacy/kitchenIndentRoutes.js
// ════════════════════════════════════════════════════════════════════
// R7bj-F2 — KitchenIndent close-loop routes (mounted at
// /api/kitchen-indent in routes/index.js by the F-coordinator).
//
// Permission gates (F-coordinator wires the role map in permissions.js):
//   kitchen.indent.read     — read the kitchen worklist + a single indent
//                             (Admin / Dietician / Kitchen / Ward Boy)
//   kitchen.indent.write    — flip PENDING→PREPARED→SERVED + cancel
//                             (Admin / Dietician / Kitchen)
//   kitchen.delivery.write  — flip SERVED→DELIVERED at the bed
//                             (Admin / Ward Boy / Kitchen)
//
// Every :id route runs through validateObjectIdParam so a malformed id
// surfaces as a uniform 400 instead of a CastError 500.
// ════════════════════════════════════════════════════════════════════

"use strict";

const express = require("express");
const router  = express.Router();

const ctrl = require("../../controllers/Pharmacy/kitchenIndentController");
const { requireAction } = require("../../middleware/auth");
const { credentialExpiryBlocker } = require("../../middleware/credentialExpiryBlocker");
const { validateObjectIdParam } = require("../../utils/queryGuards");

// ── Reads ──────────────────────────────────────────────────────────
router.get("/",
  requireAction("kitchen.indent.read"),
  ctrl.listForKitchen,
);
router.get("/wardboy-queue",
  requireAction("kitchen.indent.read"),
  ctrl.listForWardBoy,
);
router.get("/:id",
  validateObjectIdParam("id"),
  requireAction("kitchen.indent.read"),
  ctrl.getOne,
);

// ── Lifecycle writes ───────────────────────────────────────────────
router.put("/:id/mark-prepared",
  validateObjectIdParam("id"),
  requireAction("kitchen.indent.write"),
  ctrl.markPrepared,
);
router.put("/:id/mark-served",
  validateObjectIdParam("id"),
  requireAction("kitchen.indent.write"),
  ctrl.markServed,
);
router.put("/:id/cancel",
  validateObjectIdParam("id"),
  requireAction("kitchen.indent.write"),
  ctrl.cancel,
);

// Delivery handover is a separate permission so a Ward Boy can mark
// DELIVERED at the bed without holding the wider kitchen.indent.write.
//
// R7bm-F8 / R7bl close-out: FSSAI Schedule IV mandates that any staff
// member handing over a meal tray at the bed holds a current
// food-handler training certificate. credentialExpiryBlocker runs AFTER
// the role gate; on missing/expired FSSAI_FOOD_HANDLER it 403s with code
// CREDENTIAL_MISSING | CREDENTIAL_EXPIRED.
router.put("/:id/mark-delivered",
  validateObjectIdParam("id"),
  requireAction("kitchen.delivery.write"),
  credentialExpiryBlocker("FSSAI_FOOD_HANDLER"),
  ctrl.markDelivered,
);

module.exports = router;
