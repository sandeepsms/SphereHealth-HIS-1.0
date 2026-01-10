const express = require("express");
const router = express.Router();
const tpaController = require("./../../controllers/tpa/tpaController");

// Create TPA
router.post("/", tpaController.createTPA);

// Get all TPAs
router.get("/", tpaController.getAllTPAs);

// Get active TPAs (for dropdown)
router.get("/active", tpaController.getActiveTPAs);

// Search TPAs
router.get("/search", tpaController.searchTPAs);

// Get TPA by ID
router.get("/:id", tpaController.getTPAById);

// Update TPA
router.put("/:id", tpaController.updateTPA);

// Delete TPA (soft delete)
router.delete("/:id", tpaController.deleteTPA);

module.exports = router;
