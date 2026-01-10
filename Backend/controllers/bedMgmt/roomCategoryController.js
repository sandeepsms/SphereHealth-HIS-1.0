const roomCategoryService = require("../../services/bedMgmt/roomCategoryService");

/**
 * Seed default room categories
 */
exports.seedDefaultCategories = async (req, res) => {
  try {
    const results = await roomCategoryService.seedDefaultCategories();

    res.status(200).json({
      success: true,
      message: "Default categories seeding completed",
      data: results,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * Create a new room category
 */
exports.createCategory = async (req, res) => {
  try {
    const category = await roomCategoryService.createCategory(req.body);

    res.status(201).json({
      success: true,
      message: "Room category created successfully",
      data: category,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * Get all room categories
 */
exports.getAllCategories = async (req, res) => {
  try {
    const categories = await roomCategoryService.getAllCategories(req.query);

    res.status(200).json({
      success: true,
      count: categories.length,
      data: categories,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * Get room category by ID
 */
exports.getCategoryById = async (req, res) => {
  try {
    const category = await roomCategoryService.getCategoryById(req.params.id);

    res.status(200).json({
      success: true,
      data: category,
    });
  } catch (error) {
    res.status(404).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * Update room category
 */
exports.updateCategory = async (req, res) => {
  try {
    const category = await roomCategoryService.updateCategory(
      req.params.id,
      req.body
    );

    res.status(200).json({
      success: true,
      message: "Room category updated successfully",
      data: category,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * Delete room category
 */
exports.deleteCategory = async (req, res) => {
  try {
    const category = await roomCategoryService.deleteCategory(req.params.id);

    res.status(200).json({
      success: true,
      message: "Room category deleted successfully",
      data: category,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};
