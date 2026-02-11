const TPAServiceModel = require("../../models/tpa/TPAServicesModel");
const TPA = require("../../models/tpa/tpaModel");

class TPAServiceService {
  static async createTPAService(data) {
    const { tpaId, services } = data;
    if (!tpaId) {
      throw new Error("tpaId is required");
    }

    if (!services || !Array.isArray(services) || services.length === 0) {
      throw new Error("services array is required and cannot be empty");
    }

    const tpa = await TPA.findOne({ _id: tpaId, isActive: true });
    if (!tpa) {
      throw new Error("TPA not found or inactive");
    }

    // ✅ Validate each service (Capital case fields)
    services.forEach((service, index) => {
      if (!service.Name) {
        // ✅ Capital N
        throw new Error(`Service at index ${index}: Name is required`);
      }
      if (!service.serviceType) {
        throw new Error(`Service at index ${index}: serviceType is required`);
      }
      if (!["fixed", "quantity", "hourly"].includes(service.serviceType)) {
        throw new Error(
          `Service at index ${index}: Invalid serviceType. Must be fixed, quantity, or hourly`,
        );
      }
      if (service.Amount === undefined || service.Amount === null) {
        // ✅ Capital A
        throw new Error(`Service at index ${index}: Amount is required`);
      }
      if (service.Totalamount === undefined || service.Totalamount === null) {
        // ✅ Capital T
        throw new Error(`Service at index ${index}: Totalamount is required`);
      }
    });

    // ✅ Find existing TPA Service
    let tpaService = await TPAServiceModel.findOne({
      tpa: tpaId,
      isActive: true,
    });

    if (tpaService) {
      // Check for duplicate service names
      services.forEach((newService) => {
        const exists = tpaService.services.some(
          (s) => s.Name.toLowerCase() === newService.Name.toLowerCase(), // ✅ Capital N
        );
        if (exists) {
          throw new Error(
            `Service "${newService.Name}" already exists for this TPA`,
          );
        }
      });

      // Push new services
      tpaService.services.push(...services);
      await tpaService.save();

      return tpaService.populate("tpa", "tpaName tpaCode");
    } else {
      // Create new TPA Service
      tpaService = new TPAServiceModel({
        tpa: tpaId,
        services: services,
      });

      const saved = await tpaService.save();
      return saved.populate("tpa", "tpaName tpaCode");
    }
  }

  // Get All TPA Services
  static async getAllTPAServices(filters = {}) {
    const query = { isActive: true };

    if (filters.tpaId) {
      query.tpa = filters.tpaId;
    }

    return TPAServiceModel.find(query)
      .populate("tpa", "tpaName tpaCode")
      .sort({ createdAt: -1 });
  }

  // Get TPA Service by TPA ID
  static async getTPAServiceByTPAId(tpaId) {
    const tpaService = await TPAServiceModel.findOne({
      tpa: tpaId,
      isActive: true,
    }).populate("tpa", "tpaName tpaCode");

    if (!tpaService) {
      throw new Error("TPA Service not found");
    }

    return tpaService;
  }

  // Update TPA Service
  static async updateTPAService(id, data) {
    const tpaService = await TPAServiceModel.findOne({
      _id: id,
      isActive: true,
    });
    if (!tpaService) {
      throw new Error("TPA Service not found");
    }

    const updated = await TPAServiceModel.findByIdAndUpdate(id, data, {
      new: true,
      runValidators: true,
    }).populate("tpa", "tpaName tpaCode");

    return updated;
  }

  // Delete TPA Service (Soft delete)
  static async deleteTPAService(id) {
    const tpaService = await TPAServiceModel.findByIdAndUpdate(
      id,
      { isActive: false },
      { new: true },
    );

    if (!tpaService) {
      throw new Error("TPA Service not found");
    }

    return tpaService;
  }

  // Add Service to TPA Service
  static async addService(id, serviceData) {
    const tpaService = await TPAServiceModel.findOne({
      _id: id,
      isActive: true,
    });
    if (!tpaService) {
      throw new Error("TPA Service not found");
    }

    // Validate service data
    if (!serviceData.serviceName) {
      throw new Error("serviceName is required");
    }
    if (!serviceData.serviceType) {
      throw new Error("serviceType is required");
    }
    if (!["fixed", "quantity", "hourly"].includes(serviceData.serviceType)) {
      throw new Error(
        "Invalid serviceType. Must be fixed, quantity, or hourly",
      );
    }

    // Check if service already exists
    const exists = tpaService.services.some(
      (s) =>
        s.serviceName.toLowerCase() === serviceData.serviceName.toLowerCase(),
    );

    if (exists) {
      throw new Error("Service already exists in this TPA Service");
    }

    tpaService.services.push(serviceData);
    await tpaService.save();

    return tpaService.populate("tpa", "tpaName tpaCode");
  }

  // Remove Service from TPA Service
  static async removeService(id, serviceId) {
    const tpaService = await TPAServiceModel.findOne({
      _id: id,
      isActive: true,
    });
    if (!tpaService) {
      throw new Error("TPA Service not found");
    }

    const initialLength = tpaService.services.length;
    tpaService.services = tpaService.services.filter(
      (s) => s._id.toString() !== serviceId,
    );

    if (tpaService.services.length === initialLength) {
      throw new Error("Service not found in TPA Service");
    }

    await tpaService.save();
    return tpaService.populate("tpa", "tpaName tpaCode");
  }

  // Toggle Active Status
  static async toggleActiveStatus(id) {
    const tpaService = await TPAServiceModel.findById(id);
    if (!tpaService) {
      throw new Error("TPA Service not found");
    }

    tpaService.isActive = !tpaService.isActive;
    await tpaService.save();

    return tpaService.populate("tpa", "tpaName tpaCode");
  }

  // Search TPA Services
  static async searchTPAServices(searchTerm) {
    const tpas = await TPA.find({
      $or: [
        { tpaName: { $regex: searchTerm, $options: "i" } },
        { tpaCode: { $regex: searchTerm, $options: "i" } },
      ],
      isActive: true,
    }).select("_id");

    const tpaIds = tpas.map((t) => t._id);

    return TPAServiceModel.find({
      $or: [
        { tpa: { $in: tpaIds } },
        { "services.serviceName": { $regex: searchTerm, $options: "i" } },
      ],
      isActive: true,
    }).populate("tpa", "tpaName tpaCode");
  }

  // Get Services by Type
  static async getServicesByType(serviceType) {
    return TPAServiceModel.find({
      "services.serviceType": serviceType,
      isActive: true,
    }).populate("tpa", "tpaName tpaCode");
  }

  // Get TPA Service Stats
  static async getTPAServiceStats(tpaId) {
    const tpaService = await TPAServiceModel.findOne({
      tpa: tpaId,
      isActive: true,
    });

    if (!tpaService) {
      throw new Error("TPA Service not found");
    }

    const stats = {
      totalServices: tpaService.services.length,
      fixedServices: tpaService.services.filter(
        (s) => s.serviceType === "fixed",
      ).length,
      quantityServices: tpaService.services.filter(
        (s) => s.serviceType === "quantity",
      ).length,
      hourlyServices: tpaService.services.filter(
        (s) => s.serviceType === "hourly",
      ).length,
    };

    return stats;
  }

  // Get All Services (Flattened)
  static async getAllServices() {
    const allTPAServices = await TPAServiceModel.find({
      isActive: true,
    }).populate("tpa", "tpaName tpaCode");

    const flattenedServices = [];

    allTPAServices.forEach((tpaService) => {
      tpaService.services.forEach((service) => {
        flattenedServices.push({
          tpaServiceId: tpaService._id,
          tpaId: tpaService.tpa._id,
          tpaName: tpaService.tpa.tpaName,
          tpaCode: tpaService.tpa.tpaCode,
          serviceId: service._id,
          ...service.toObject(),
        });
      });
    });

    return flattenedServices;
  }
}

// ✅ OBJECT EXPORT
module.exports = {
  createTPAService: TPAServiceService.createTPAService.bind(TPAServiceService),
  getAllTPAServices:
    TPAServiceService.getAllTPAServices.bind(TPAServiceService),
  getTPAServiceByTPAId:
    TPAServiceService.getTPAServiceByTPAId.bind(TPAServiceService),
  updateTPAService: TPAServiceService.updateTPAService.bind(TPAServiceService),
  deleteTPAService: TPAServiceService.deleteTPAService.bind(TPAServiceService),
  addService: TPAServiceService.addService.bind(TPAServiceService),
  removeService: TPAServiceService.removeService.bind(TPAServiceService),
  toggleActiveStatus:
    TPAServiceService.toggleActiveStatus.bind(TPAServiceService),
  searchTPAServices:
    TPAServiceService.searchTPAServices.bind(TPAServiceService),
  getServicesByType:
    TPAServiceService.getServicesByType.bind(TPAServiceService),
  getTPAServiceStats:
    TPAServiceService.getTPAServiceStats.bind(TPAServiceService),
  getAllServices: TPAServiceService.getAllServices.bind(TPAServiceService),
};
