const ServiceMaster = require("../../models/bedMgmt/serviceMasterModel");

class ServiceMasterService {
  async seedDefaultServices() {
    const defaultServices = [
      {
        serviceName: "AC Facility",
        serviceCode: "AC-001",
        category: "Room Facilities",
        basePrice: 500,
        unit: "Per Day",
        isSystemService: true,
      },
      {
        serviceName: "Television",
        serviceCode: "TV-001",
        category: "Room Facilities",
        basePrice: 200,
        unit: "Per Day",
        isSystemService: true,
      },
      {
        serviceName: "WiFi",
        serviceCode: "WIFI-001",
        category: "Room Facilities",
        basePrice: 100,
        unit: "Per Day",
        isSystemService: true,
      },
      {
        serviceName: "Oxygen Support",
        serviceCode: "OXY-001",
        category: "Medical Equipment",
        basePrice: 500,
        unit: "Per Day",
        isSystemService: true,
      },
      {
        serviceName: "Ventilator",
        serviceCode: "VENT-001",
        category: "Medical Equipment",
        basePrice: 3000,
        unit: "Per Day",
        isSystemService: true,
      },
      {
        serviceName: "Patient Monitor",
        serviceCode: "MON-001",
        category: "Medical Equipment",
        basePrice: 1000,
        unit: "Per Day",
        isSystemService: true,
      },
      {
        serviceName: "Special Nursing",
        serviceCode: "NURS-001",
        category: "Nursing Services",
        basePrice: 1500,
        unit: "Per Day",
        isSystemService: true,
      },
      {
        serviceName: "Standard Diet",
        serviceCode: "DIET-001",
        category: "Dietary",
        basePrice: 300,
        unit: "Per Day",
        isSystemService: true,
      },
      {
        serviceName: "Special Diet",
        serviceCode: "DIET-002",
        category: "Dietary",
        basePrice: 500,
        unit: "Per Day",
        isSystemService: true,
      },
      {
        serviceName: "Complete Blood Count (CBC)",
        serviceCode: "LAB-CBC",
        category: "Laboratory",
        basePrice: 300,
        unit: "Per Unit",
        isSystemService: true,
      },
      {
        serviceName: "Blood Sugar Test",
        serviceCode: "LAB-BS",
        category: "Laboratory",
        basePrice: 150,
        unit: "Per Unit",
        isSystemService: true,
      },
      {
        serviceName: "X-Ray",
        serviceCode: "RAD-XRAY",
        category: "Radiology",
        basePrice: 400,
        unit: "Per Unit",
        isSystemService: true,
      },
      {
        serviceName: "CT Scan",
        serviceCode: "RAD-CT",
        category: "Radiology",
        basePrice: 3500,
        unit: "Per Unit",
        isSystemService: true,
      },
    ];

    const results = {
      success: [],
      skipped: [],
      failed: [],
    };

    for (const service of defaultServices) {
      try {
        const existing = await ServiceMaster.findOne({
          serviceCode: service.serviceCode,
        });

        if (existing) {
          results.skipped.push({
            serviceName: service.serviceName,
            message: "Already exists",
          });
          continue;
        }

        const newService = await ServiceMaster.create(service);
        results.success.push(newService);
      } catch (error) {
        results.failed.push({
          serviceName: service.serviceName,
          error: error.message,
        });
      }
    }

    return results;
  }

  async createService(data) {
    const existing = await ServiceMaster.findOne({
      $or: [
        { serviceName: data.serviceName },
        { serviceCode: data.serviceCode },
      ],
    });

    if (existing) {
      throw new Error("Service already exists");
    }

    const service = await ServiceMaster.create(data);
    return service;
  }

  async getAllServices(filters = {}) {
    const query = {};

    if (filters.isActive !== undefined) {
      query.isActive = filters.isActive === "true";
    }

    if (filters.category) {
      query.category = filters.category;
    }

    return await ServiceMaster.find(query).sort({
      category: 1,
      serviceName: 1,
    });
  }

  async getServiceById(id) {
    const service = await ServiceMaster.findById(id);
    if (!service) {
      throw new Error("Service not found");
    }
    return service;
  }

  async updateService(id, data) {
    const service = await ServiceMaster.findByIdAndUpdate(id, data, {
      new: true,
      runValidators: true,
    });

    if (!service) {
      throw new Error("Service not found");
    }

    return service;
  }

  async deleteService(id) {
    const service = await ServiceMaster.findById(id);
    if (!service) {
      throw new Error("Service not found");
    }

    if (service.isSystemService) {
      throw new Error("Cannot delete system service");
    }

    service.isActive = false;
    await service.save();

    return service;
  }

  async getServicesByCategory(category) {
    return await ServiceMaster.find({
      category,
      isActive: true,
    }).sort({ serviceName: 1 });
  }
}

module.exports = new ServiceMasterService();
