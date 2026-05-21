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

// Test endpoint
router.get("/test", (req, res) => {
  res.json({ message: "TPA routes working perfectly!" });
});

// Reads — any role allowed to file pre-auth or read billing
router.get("/active",                                  requireAction("billing.read"), getAllTPAs);
router.get("/code/:code",                              requireAction("billing.read"), getTPAByCode);
router.get("/",                                        requireAction("billing.read"), getAllTPAs);
router.get("/:id",                             vId,    requireAction("billing.read"), getTPAById);
router.get("/:tpaId/charges/:roomCategoryId",
  vTpaId, vRoom,                                       requireAction("billing.read"), getChargesByRoomCategory);

// Writes — TPA master only mutated by TPA Coordinator / Admin
router.post("/",              requireAction("tpa.pre-auth"), createTPA);
router.put("/:id",     vId,   requireAction("tpa.pre-auth"), updateTPA);
router.delete("/:id",  vId,   requireAction("tpa.claim"),    deleteTPA);

module.exports = router;
