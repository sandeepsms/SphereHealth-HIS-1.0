const tpaService = require("../../services/tpa/tpaService");

exports.createTPA = async (req, res) => {
  try {
    const tpa = await tpaService.createTPA(req.body);

    res.status(201).json({
      success: true,
      message: "TPA created successfully",
      data: tpa,
    });
  } catch (error) {
    const statusCode = error.message.includes("already exists") ? 400 : 500;
    res.status(statusCode).json({
      success: false,
      message: error.message,
    });
  }
};

exports.getAllTPAs = async (req, res) => {
  try {
    const tpas = await tpaService.getAllTPAs(req.query);

    res.status(200).json({
      success: true,
      count: tpas.length,
      data: tpas,
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
    const tpa = await tpaService.getTPAById(req.params.id);

    res.status(200).json({
      success: true,
      data: tpa,
    });
  } catch (error) {
    const statusCode = error.message === "TPA not found" ? 404 : 500;
    res.status(statusCode).json({
      success: false,
      message: error.message,
    });
  }
};

exports.updateTPA = async (req, res) => {
  try {
    const tpa = await tpaService.updateTPA(req.params.id, req.body);

    res.status(200).json({
      success: true,
      message: "TPA updated successfully",
      data: tpa,
    });
  } catch (error) {
    const statusCode = error.message === "TPA not found" ? 404 : 400;
    res.status(statusCode).json({
      success: false,
      message: error.message,
    });
  }
};

exports.deleteTPA = async (req, res) => {
  try {
    const tpa = await tpaService.deleteTPA(req.params.id);

    res.status(200).json({
      success: true,
      message: "TPA deactivated successfully",
      data: tpa,
    });
  } catch (error) {
    const statusCode = error.message === "TPA not found" ? 404 : 500;
    res.status(statusCode).json({
      success: false,
      message: error.message,
    });
  }
};

exports.getActiveTPAs = async (req, res) => {
  try {
    const tpas = await tpaService.getActiveTPAs();

    res.status(200).json({
      success: true,
      count: tpas.length,
      data: tpas,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.searchTPAs = async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) {
      return res.status(400).json({
        success: false,
        message: "Search term is required",
      });
    }

    const tpas = await tpaService.searchTPAs(q);

    res.status(200).json({
      success: true,
      count: tpas.length,
      data: tpas,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
