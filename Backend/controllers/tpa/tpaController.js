const TPAService = require("../../services/tpa/tpaService");

exports.createTPA = async (req, res) => {
  try {
    const tpa = await TPAService.createTPA(req.body);
    res.status(201).json({
      success: true,
      message: "TPA created successfully (20% discount validated)",
      data: tpa,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

exports.getAllTPAs = async (req, res) => {
  try {
    const tpAs = await TPAService.getAllTPAs(req.query);
    res.status(200).json({
      success: true,
      count: tpAs.length,
      data: tpAs,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.getTPAById = async (req, res) => {
  try {
    const tpa = await TPAService.getTPAById(req.params.id);
    res.status(200).json({
      success: true,
      data: tpa,
    });
  } catch (error) {
    res.status(404).json({
      success: false,
      message: error.message,
    });
  }
};

exports.updateTPA = async (req, res) => {
  try {
    const tpa = await TPAService.updateTPA(req.params.id, req.body);
    res.status(200).json({
      success: true,
      message: "TPA updated successfully (20% discount validated)",
      data: tpa,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

exports.deleteTPA = async (req, res) => {
  try {
    await TPAService.deleteTPA(req.params.id);
    res.status(200).json({
      success: true,
      message: "TPA deactivated successfully",
    });
  } catch (error) {
    res.status(404).json({
      success: false,
      message: error.message,
    });
  }
};

exports.getChargesByRoomCategory = async (req, res) => {
  try {
    const charges = await TPAService.getChargesByRoomCategory(
      req.params.tpaId,
      req.params.roomCategoryId,
    );

    if (!charges) {
      return res.status(404).json({
        success: false,
        message: "Charges not found for this TPA and room category",
      });
    }

    res.status(200).json({
      success: true,
      data: charges,
      dailyTotal: charges.calculateDailyTotal?.() || 0,
    });
  } catch (error) {
    res.status(404).json({
      success: false,
      message: error.message,
    });
  }
};

// BONUS: Get TPA by code (TPA desk use karega)
exports.getTPAByCode = async (req, res) => {
  try {
    const { code } = req.params;
    const tpa = await TPAService.TPA.findByCode(code);

    if (!tpa) {
      return res.status(404).json({
        success: false,
        message: "TPA not found",
      });
    }

    res.status(200).json({
      success: true,
      data: tpa,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
