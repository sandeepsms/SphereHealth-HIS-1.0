const service = require("../../services/charges/hospitalChargesService");

exports.createHospitalCharges = async (req, res) => {
  try {
    const data = await service.createHospitalCharges(req.body);
    res.status(201).json({
      success: true,
      message: "Hospital charges created successfully",
      data,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

exports.getAllHospitalCharges = async (req, res) => {
  try {
    const data = await service.getAllHospitalCharges(req.query);
    res.status(200).json({
      success: true,
      count: data.length,
      data,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ✅ NEW: Get by document ID
// controllers/charges/hospitalChargesController.js

exports.getHospitalChargesById = async (req, res) => {
  try {
    console.log("🔍 Searching for ID:", req.params.id); // ✅ ADD THIS

    const data = await service.getHospitalChargesById(req.params.id);

    console.log("📦 Data found:", data); // ✅ ADD THIS

    if (!data) {
      console.log("❌ No data found for ID:", req.params.id); // ✅ ADD THIS
      return res.status(404).json({
        success: false,
        message: "Hospital charges not found",
      });
    }

    res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("💥 Error:", error.message); // ✅ ADD THIS
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.getHospitalChargesByTPA = async (req, res) => {
  try {
    const data = await service.getHospitalChargesByTPA(req.params.tpaId);

    if (!data) {
      return res.status(404).json({
        success: false,
        message: "No charges found for this TPA",
      });
    }

    res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.updateHospitalCharges = async (req, res) => {
  try {
    const data = await service.updateHospitalCharges(
      req.params.id,
      req.body.charges,
    );

    if (!data) {
      return res.status(404).json({
        success: false,
        message: "Hospital charges not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Hospital charges updated successfully",
      data,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.deleteHospitalCharges = async (req, res) => {
  try {
    const data = await service.deleteHospitalCharges(req.params.id);

    if (!data) {
      return res.status(404).json({
        success: false,
        message: "Hospital charges not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Hospital charges deleted successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.toggleActiveStatus = async (req, res) => {
  try {
    const data = await service.toggleActiveStatus(req.params.id);
    res.status(200).json({
      success: true,
      message: `Hospital charges ${
        data.isActive ? "activated" : "deactivated"
      } successfully`,
      data,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};
