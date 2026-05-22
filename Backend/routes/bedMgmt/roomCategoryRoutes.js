const express = require("express");
const router = express.Router();
const RoomCategoryController = require("../../controllers/bedMgmt/roomCategoryController");
const { requireAction } = require("../../middleware/auth");
// R7bn-P1: 400 on a malformed :id before findById throws CastError -> 500.
const { validateObjectIdParam } = require("../../utils/queryGuards");

// Room-category master — Admin-only writes.
// R7bb-B/D4-MED-S1: reads now gated on `ipd.read`.
router.get("/",     requireAction("ipd.read"), RoomCategoryController.getAllCategories);
router.get("/:id",  validateObjectIdParam("id"), requireAction("ipd.read"), RoomCategoryController.getCategoryById);
router.post("/seed", requireAction("departments.write"), RoomCategoryController.seedDefaultCategories);
router.post("/",     requireAction("departments.write"), RoomCategoryController.createCategory);
router.put("/:id",   validateObjectIdParam("id"), requireAction("departments.write"), RoomCategoryController.updateCategory);
router.delete("/:id",validateObjectIdParam("id"), requireAction("departments.write"), RoomCategoryController.deleteCategory);

module.exports = router;
