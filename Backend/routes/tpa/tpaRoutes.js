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

// Test endpoint
router.get("/test", (req, res) => {
  res.json({ message: "TPA routes working perfectly!" });
});

// Reads — any role allowed to file pre-auth or read billing
router.get("/active",                          requireAction("billing.read"), getAllTPAs);
router.get("/code/:code",                      requireAction("billing.read"), getTPAByCode);
router.get("/",                                requireAction("billing.read"), getAllTPAs);
router.get("/:id",                             requireAction("billing.read"), getTPAById);
router.get("/:tpaId/charges/:roomCategoryId",  requireAction("billing.read"), getChargesByRoomCategory);

// Writes — TPA master only mutated by TPA Coordinator / Admin
router.post("/",       requireAction("tpa.pre-auth"), createTPA);
router.put("/:id",     requireAction("tpa.pre-auth"), updateTPA);
router.delete("/:id",  requireAction("tpa.claim"),    deleteTPA);

module.exports = router;
