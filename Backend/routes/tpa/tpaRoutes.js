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

router.get("/", getAllTPAs);
router.post("/", createTPA);

router.get("/:id", getTPAById);
router.put("/:id", updateTPA);
router.delete("/:id", deleteTPA);

// Billing helpers
router.get("/:tpaId/charges/:roomCategoryId", getChargesByRoomCategory);

router.get("/code/:code", getTPAByCode);

module.exports = router;
