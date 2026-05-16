const express = require("express");
const router = express.Router();
const RoomCategoryController = require("../../controllers/bedMgmt/roomCategoryController");
const { requireAction } = require("../../middleware/auth");

// Room-category master — Admin only.
router.get("/",     RoomCategoryController.getAllCategories);
router.get("/:id",  RoomCategoryController.getCategoryById);
router.post("/seed", requireAction("departments.write"), RoomCategoryController.seedDefaultCategories);
router.post("/",     requireAction("departments.write"), RoomCategoryController.createCategory);
router.put("/:id",   requireAction("departments.write"), RoomCategoryController.updateCategory);
router.delete("/:id",requireAction("departments.write"), RoomCategoryController.deleteCategory);

module.exports = router;
