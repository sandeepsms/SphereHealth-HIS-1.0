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

// Test endpoint
router.get("/test", (req, res) => {
  res.json({ message: "TPA routes working perfectly!" });
});

// ✅ GET active TPAs - MUST BE BEFORE /:id route
router.get("/active", getAllTPAs);

// ✅ GET TPA by code - MUST BE BEFORE /:id route
router.get("/code/:code", getTPAByCode);

// General routes
router.get("/", getAllTPAs);
router.post("/", createTPA);

// ID-based routes (THESE MUST BE LAST)
router.get("/:id", getTPAById);
router.put("/:id", updateTPA);
router.delete("/:id", deleteTPA);

// Billing helpers
router.get("/:tpaId/charges/:roomCategoryId", getChargesByRoomCategory);

module.exports = router;
