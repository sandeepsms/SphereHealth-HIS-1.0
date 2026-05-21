// routes/tpaRoutes.js - INDIVIDUAL METHOD STYLE
const express = require("express");
const router = express.Router();
const {
  createTPA,
  getAllTPAs,
  getTPAById,
  updateTPA,
  deleteTPA,
  getChargesByRoomCategory,
  getTPAByCode,
} = require("../../controllers/tpa/tpaController");
const { requireAction } = require("../../middleware/auth");
// R7aw-FIX-1/D2-HIGH-4: ObjectId guards on R7as-gated TPA routes. The
// findById inside getTPAById / updateTPA / deleteTPA / getChargesByRoomCategory
// previously surfaced CastError → 500 for a non-ObjectId param. Now 400.
const { validateObjectIdParam } = require("../../utils/queryGuards");
const vId    = validateObjectIdParam("id");
const vTpaId = validateObjectIdParam("tpaId");
const vRoom  = validateObjectIdParam("roomCategoryId");

// R7bb-B/D4-HIGH-S1: removed the `/test` debug endpoint. Pre-R7bb it was
// reachable as `GET /api/tpa/test` to any authenticated user and returned
// "TPA routes working perfectly!" — leftover dev probe shipped to prod
// that confirmed the API surface to any attacker with a stolen JWT.

// Reads — any role allowed to file pre-auth or read billing
router.get("/active",                                  requireAction("billing.read"), getAllTPAs);
router.get("/code/:code",                              requireAction("billing.read"), getTPAByCode);
router.get("/",                                        requireAction("billing.read"), getAllTPAs);
router.get("/:id",                             vId,    requireAction("billing.read"), getTPAById);
router.get("/:tpaId/charges/:roomCategoryId",
  vTpaId, vRoom,                                       requireAction("billing.read"), getChargesByRoomCategory);

// Writes — TPA master only mutated by TPA Coordinator / Admin.
// R7bb-FIX-C-7/D2-CRIT-2: gated on the new `tpa.master-edit` (TPA
// Coordinator + Admin only). Pre-R7bb the gate was `tpa.pre-auth` which
// also includes Receptionist — the front desk should be able to FILE a
// pre-auth on an admission's bill (tpa.case-file) but must NOT be able
// to CRUD the TPA insurance-company master record (tariff sheets,
// allowed services, contact details, contractual data). Delete stays on
// tpa.claim (same audience as master-edit; identical TPA Coordinator +
// Admin tier — kept distinct so a future "claims-only" sub-role can
// drop one without the other).
router.post("/",              requireAction("tpa.master-edit"), createTPA);
router.put("/:id",     vId,   requireAction("tpa.master-edit"), updateTPA);
router.delete("/:id",  vId,   requireAction("tpa.claim"),       deleteTPA);

module.exports = router;
