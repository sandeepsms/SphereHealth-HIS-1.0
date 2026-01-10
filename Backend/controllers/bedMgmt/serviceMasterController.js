const serviceMasterService = require("../../services/bedMgmt/serviceMasterService");

exports.seedDefaultServices = async (req, res) => {
  try {
    const results = await serviceMasterService.seedDefaultServices();

    res.status(200).json({
      success: true,
      message: "Default services seeding completed",
      data: results,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.createService = async (req, res) => {
  try {
    const service = await serviceMasterService.createService(req.body);

    res.status(201).json({
      success: true,
      message: "Service created successfully",
      data: service,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

exports.getAllServices = async (req, res) => {
  try {
    const services = await serviceMasterService.getAllServices(req.query);

    res.status(200).json({
      success: true,
      count: services.length,
      data: services,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.getServiceById = async (req, res) => {
  try {
    const service = await serviceMasterService.getServiceById(req.params.id);

    res.status(200).json({
      success: true,
      data: service,
    });
  } catch (error) {
    res.status(404).json({
      success: false,
      message: error.message,
    });
  }
};

exports.updateService = async (req, res) => {
  try {
    const service = await serviceMasterService.updateService(
      req.params.id,
      req.body
    );

    res.status(200).json({
      success: true,
      message: "Service updated successfully",
      data: service,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

exports.deleteService = async (req, res) => {
  try {
    const service = await serviceMasterService.deleteService(req.params.id);

    res.status(200).json({
      success: true,
      message: "Service deleted successfully",
      data: service,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

exports.getServicesByCategory = async (req, res) => {
  try {
    const services = await serviceMasterService.getServicesByCategory(
      req.params.category
    );

    res.status(200).json({
      success: true,
      count: services.length,
      data: services,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
