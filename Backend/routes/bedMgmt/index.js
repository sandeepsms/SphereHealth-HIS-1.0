const express = require("express");
const router = express.Router();

// Import all route modules
const buildingRoutes = require("./buildingRoutes");
const floorRoutes = require("./floorRoutes");
const wardRoutes = require("./wardRoutes");
const roomRoutes = require("./roomRoutes");
const bedRoutes = require("./bedRoutes");

// Mount all  the routes
router.use("/buildings", buildingRoutes);
router.use("/floors", floorRoutes);
router.use("/wards", wardRoutes);
router.use("/rooms", roomRoutes);
router.use("/bedss", bedRoutes);

module.exports = router;
