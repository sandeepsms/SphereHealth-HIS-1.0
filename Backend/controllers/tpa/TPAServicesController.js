const TPAServiceService = require("../../services/tpa/tpaServiceService");

// Create TPA Service
exports.createTPAService = async (req, res) => {
  try {
    const result = await TPAServiceService.createTPAService(req.body);

    res.status(201).json({
      success: true,
      message: "TPA Service created successfully",
      data: result,
    });
  } catch (error) {
    console.error("Error creating TPA Service:", error);

    if (error.message.includes("already exists")) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }

    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

// Get All TPA Services
exports.getAllTPAServices = async (req, res) => {
  try {
    const tpaServices = await TPAServiceService.getAllTPAServices(req.query);

    res.status(200).json({
      success: true,
      count: tpaServices.length,
      data: tpaServices,
    });
  } catch (error) {
    console.error("Error fetching TPA Services:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Get TPA Service by ID
exports.getTPAServiceById = async (req, res) => {
  try {
    const tpaService = await TPAServiceService.getTPAServiceByTPAId(
      req.params.id,
    );

    res.status(200).json({
      success: true,
      data: tpaService,
    });
  } catch (error) {
    console.error("Error fetching TPA Service by ID:", error);
    res.status(error.message === "TPA Service not found" ? 404 : 500).json({
      success: false,
      message: error.message,
    });
  }
};

// Get TPA Services by TPA ID
exports.getTPAServicesByTPAId = async (req, res) => {
  try {
    const tpaService = await TPAServiceService.getTPAServiceByTPAId(
      req.params.tpaId,
    );

    res.status(200).json({
      success: true,
      data: tpaService,
    });
  } catch (error) {
    console.error("Error fetching TPA Services by TPA ID:", error);
    res.status(error.message === "TPA Service not found" ? 404 : 500).json({
      success: false,
      message: error.message,
    });
  }
};

// Update TPA Service
exports.updateTPAService = async (req, res) => {
  try {
    const tpaService = await TPAServiceService.updateTPAService(
      req.params.id,
      req.body,
    );

    res.status(200).json({
      success: true,
      message: "TPA Service updated successfully",
      data: tpaService,
    });
  } catch (error) {
    console.error("Error updating TPA Service:", error);
    res.status(error.message === "TPA Service not found" ? 404 : 400).json({
      success: false,
      message: error.message,
    });
  }
};

// Delete TPA Service
exports.deleteTPAService = async (req, res) => {
  try {
    await TPAServiceService.deleteTPAService(req.params.id);

    res.status(200).json({
      success: true,
      message: "TPA Service deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting TPA Service:", error);
    res.status(error.message === "TPA Service not found" ? 404 : 500).json({
      success: false,
      message: error.message,
    });
  }
};

// Add Service
exports.addService = async (req, res) => {
  try {
    const tpaService = await TPAServiceService.addService(
      req.params.id,
      req.body,
    );

    res.status(200).json({
      success: true,
      message: "Service added successfully",
      data: tpaService,
    });
  } catch (error) {
    console.error("Error adding service:", error);
    res.status(error.message === "TPA Service not found" ? 404 : 400).json({
      success: false,
      message: error.message,
    });
  }
};

// Remove Service
exports.removeService = async (req, res) => {
  try {
    const { serviceId } = req.params;
    const tpaService = await TPAServiceService.removeService(
      req.params.id,
      serviceId,
    );

    res.status(200).json({
      success: true,
      message: "Service removed successfully",
      data: tpaService,
    });
  } catch (error) {
    console.error("Error removing service:", error);
    res.status(error.message === "TPA Service not found" ? 404 : 400).json({
      success: false,
      message: error.message,
    });
  }
};

// Toggle Active Status
exports.toggleActiveStatus = async (req, res) => {
  try {
    const tpaService = await TPAServiceService.toggleActiveStatus(
      req.params.id,
    );

    res.status(200).json({
      success: true,
      message: `TPA Service ${tpaService.isActive ? "activated" : "deactivated"} successfully`,
      data: tpaService,
    });
  } catch (error) {
    console.error("Error toggling active status:", error);
    res.status(error.message === "TPA Service not found" ? 404 : 500).json({
      success: false,
      message: error.message,
    });
  }
};

// Search TPA Services
exports.searchTPAServices = async (req, res) => {
  try {
    const { search } = req.query;

    if (!search || search.trim() === "") {
      return res.status(400).json({
        success: false,
        message: "Search term is required",
      });
    }

    const tpaServices = await TPAServiceService.searchTPAServices(search);

    res.status(200).json({
      success: true,
      count: tpaServices.length,
      data: tpaServices,
    });
  } catch (error) {
    console.error("Error searching TPA Services:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Get Services by Type
exports.getServicesByType = async (req, res) => {
  try {
    const { serviceType } = req.params;

    if (!["fixed", "quantity", "hourly"].includes(serviceType)) {
      return res.status(400).json({
        success: false,
        message: "Invalid service type. Must be: fixed, quantity, or hourly",
      });
    }

    const tpaServices = await TPAServiceService.getServicesByType(serviceType);

    res.status(200).json({
      success: true,
      count: tpaServices.length,
      data: tpaServices,
    });
  } catch (error) {
    console.error("Error fetching services by type:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Get TPA Service Stats
exports.getTPAServiceStats = async (req, res) => {
  try {
    const stats = await TPAServiceService.getTPAServiceStats(req.params.tpaId);

    res.status(200).json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error("Error fetching TPA Service stats:", error);
    res.status(error.message === "TPA Service not found" ? 404 : 500).json({
      success: false,
      message: error.message,
    });
  }
};

// Get All Services
exports.getAllServices = async (req, res) => {
  try {
    const services = await TPAServiceService.getAllServices();

    res.status(200).json({
      success: true,
      count: services.length,
      data: services,
    });
  } catch (error) {
    console.error("Error fetching all services:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

module.exports = exports;
