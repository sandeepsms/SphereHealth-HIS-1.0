const express = require("express");
const router = express.Router();
const RoomCategoryController = require("../../controllers/bedMgmt/roomCategoryController");
const { requireAction } = require("../../middleware/auth");

// Room-category master — Admin-only writes.
// R7bb-B/D4-MED-S1: reads now gated on `ipd.read`.
router.get("/",     requireAction("ipd.read"), RoomCategoryController.getAllCategories);
router.get("/:id",  requireAction("ipd.read"), RoomCategoryController.getCategoryById);
router.post("/seed", requireAction("departments.write"), RoomCategoryController.seedDefaultCategories);
router.post("/",     requireAction("departments.write"), RoomCategoryController.createCategory);
router.put("/:id",   requireAction("departments.write"), RoomCategoryController.updateCategory);
router.delete("/:id",requireAction("departments.write"), RoomCategoryController.deleteCategory);

module.exports = router;
