const express = require("express");
const router = express.Router();
const RoomCategoryController = require("../../controllers/bedMgmt/roomCategoryController");

router.post("/seed", RoomCategoryController.seedDefaultCategories);
router.post("/", RoomCategoryController.createCategory);
router.get("/", RoomCategoryController.getAllCategories);
router.get("/:id", RoomCategoryController.getCategoryById);
router.put("/:id", RoomCategoryController.updateCategory);
router.delete("/:id", RoomCategoryController.deleteCategory);

module.exports = router;
