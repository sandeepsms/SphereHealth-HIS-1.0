const TPAServiceModel = require("../../models/tpa/TPAServicesModel");
const TPA = require("../../models/tpa/tpaModel");

class TPAServiceService {
  static async createTPAService(data) {
    console.log("=== CREATE TPA SERVICE DEBUG ===");
    console.log("1. Incoming data:", JSON.stringify(data, null, 2));

    try {
      const { tpaId, tpaName, services, service } = data;

      let finalTpaId = tpaId;

      if (!finalTpaId && tpaName) {
        console.log("2. Finding TPA by name:", tpaName);
        const tpa = await TPA.findOne({ tpaName: tpaName, isActive: true });
        if (!tpa) {
          throw new Error("TPA not found with this name");
        }
        finalTpaId = tpa._id;
        console.log("3. Found TPA ID:", finalTpaId);
      }

      if (!finalTpaId) {
        throw new Error("tpaId or tpaName is required");
      }

      const finalServices = services || service;

      if (
        !finalServices ||
        !Array.isArray(finalServices) ||
        finalServices.length === 0
      ) {
        throw new Error("services array is required and cannot be empty");
      }

      console.log("4. Final TPA ID:", finalTpaId);
      console.log("5. Final Services:", JSON.stringify(finalServices, null, 2));

      const tpa = await TPA.findOne({ _id: finalTpaId, isActive: true });
      if (!tpa) {
        throw new Error("TPA not found or inactive");
      }

      console.log("6. TPA verified:", tpa.tpaName);

      finalServices.forEach((service, index) => {
        if (!service.Name) {
          throw new Error(`Service at index ${index}: Name is required`);
        }
        if (service.Amount === undefined || service.Amount === null) {
          throw new Error(`Service at index ${index}: Amount is required`);
        }
        if (service.Totalamount === undefined || service.Totalamount === null) {
          throw new Error(`Service at index ${index}: Totalamount is required`);
        }
      });

      console.log("7. Checking for existing TPA Service...");
      let tpaService = await TPAServiceModel.findOne({
        tpaId: finalTpaId,
      });

      console.log("8. Existing TPA Service found:", tpaService ? "YES" : "NO");

      if (tpaService) {
        console.log("9. Updating existing TPA Service");

        const duplicateTests = [];
        const newTests = [];

        finalServices.forEach((newService) => {
          const exists = tpaService.services.some(
            (s) => s.Name.toLowerCase() === newService.Name.toLowerCase(),
          );

          if (exists) {
            duplicateTests.push(newService.Name);
            console.log(
              `Service "${newService.Name}" already exists, skipping`,
            );
          } else {
            newTests.push(newService);
          }
        });

        if (duplicateTests.length > 0 && newTests.length === 0) {
          throw new Error(
            `All tests already exist for this TPA: ${duplicateTests.join(", ")}`,
          );
        }

        if (duplicateTests.length > 0) {
          console.log(
            `Warning: Skipping duplicate tests: ${duplicateTests.join(", ")}`,
          );
        }

        if (newTests.length > 0) {
          if (!tpaService.isActive) {
            tpaService.isActive = true;
          }

          tpaService.services.push(...newTests);
          console.log("10. Saving updated TPA Service...");
          await tpaService.save();
          console.log("11. TPA Service saved successfully");
        }

        const result = await tpaService.populate("tpaId", "tpaName tpaCode");

        if (duplicateTests.length > 0 && newTests.length > 0) {
          result._duplicateWarning = `Added ${newTests.length} new test(s). Skipped ${duplicateTests.length} duplicate test(s): ${duplicateTests.join(", ")}`;
        }

        return result;
      } else {
        console.log("12. Creating new TPA Service");
        tpaService = new TPAServiceModel({
          tpaId: finalTpaId,
          services: finalServices,
        });

        console.log("13. Saving new TPA Service...");
        const saved = await tpaService.save();
        console.log("14. TPA Service created successfully");
        return saved.populate("tpaId", "tpaName tpaCode");
      }
    } catch (error) {
      console.error("=== ERROR IN CREATE TPA SERVICE ===");
      console.error("Error name:", error.name);
      console.error("Error message:", error.message);
      console.error("Error code:", error.code);

      if (error.code === 11000) {
        console.error("Duplicate key error!");
        console.error("Key pattern:", error.keyPattern);
        console.error("Key value:", error.keyValue);
        const field = Object.keys(error.keyPattern)[0];
        throw new Error(`Duplicate ${field}: ${error.keyValue[field]}`);
      }
      throw error;
    }
  }

  static async getAllTPAServices(filters = {}) {
    try {
      const query = { isActive: true };

      if (filters.tpaId) {
        query.tpaId = filters.tpaId;
      }

      return TPAServiceModel.find(query)
        .populate("tpaId", "tpaName tpaCode")
        .sort({ createdAt: -1 });
    } catch (error) {
      throw new Error(`Failed to fetch TPA services: ${error.message}`);
    }
  }

  static async getTPAServiceByTPAId(tpaId) {
    try {
      const tpaService = await TPAServiceModel.findOne({
        tpaId: tpaId,
        isActive: true,
      }).populate("tpaId", "tpaName tpaCode");

      if (!tpaService) {
        throw new Error("TPA Service not found");
      }

      return tpaService;
    } catch (error) {
      throw new Error(`Failed to fetch TPA service: ${error.message}`);
    }
  }

  static async updateTPAService(id, data) {
    try {
      const { tpaName, tpaId, services, service } = data;

      const tpaService = await TPAServiceModel.findOne({
        _id: id,
        isActive: true,
      });

      if (!tpaService) {
        throw new Error("TPA Service not found");
      }

      if (tpaName && !tpaId) {
        const tpa = await TPA.findOne({ tpaName: tpaName, isActive: true });
        if (!tpa) {
          throw new Error("TPA not found with this name");
        }
        data.tpaId = tpa._id;
        delete data.tpaName;
      }

      if (service && !services) {
        data.services = service;
        delete data.service;
      }

      const updated = await TPAServiceModel.findByIdAndUpdate(id, data, {
        new: true,
        runValidators: true,
      }).populate("tpaId", "tpaName tpaCode");

      return updated;
    } catch (error) {
      if (error.code === 11000) {
        throw new Error("Duplicate entry detected during update.");
      }
      throw new Error(`Failed to update TPA service: ${error.message}`);
    }
  }

  static async deleteTPAService(id) {
    try {
      const tpaService = await TPAServiceModel.findByIdAndUpdate(
        id,
        { isActive: false },
        { new: true },
      );

      if (!tpaService) {
        throw new Error("TPA Service not found");
      }

      return tpaService;
    } catch (error) {
      throw new Error(`Failed to delete TPA service: ${error.message}`);
    }
  }

  static async addService(id, serviceData) {
    try {
      const tpaService = await TPAServiceModel.findOne({
        _id: id,
        isActive: true,
      });
      if (!tpaService) {
        throw new Error("TPA Service not found");
      }

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

      const exists = tpaService.services.some(
        (s) =>
          s.serviceName.toLowerCase() === serviceData.serviceName.toLowerCase(),
      );

      if (exists) {
        throw new Error("Service already exists in this TPA Service");
      }

      tpaService.services.push(serviceData);
      await tpaService.save();

      return tpaService.populate("tpaId", "tpaName tpaCode");
    } catch (error) {
      throw new Error(`Failed to add service: ${error.message}`);
    }
  }

  static async removeService(id, serviceId) {
    try {
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
      return tpaService.populate("tpaId", "tpaName tpaCode");
    } catch (error) {
      throw new Error(`Failed to remove service: ${error.message}`);
    }
  }

  static async toggleActiveStatus(id) {
    try {
      const tpaService = await TPAServiceModel.findById(id);
      if (!tpaService) {
        throw new Error("TPA Service not found");
      }

      tpaService.isActive = !tpaService.isActive;
      await tpaService.save();

      return tpaService.populate("tpaId", "tpaName tpaCode");
    } catch (error) {
      throw new Error(`Failed to toggle status: ${error.message}`);
    }
  }

  static async searchTPAServices(searchTerm) {
    try {
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
          { tpaId: { $in: tpaIds } },
          { "services.Name": { $regex: searchTerm, $options: "i" } },
        ],
        isActive: true,
      }).populate("tpaId", "tpaName tpaCode");
    } catch (error) {
      throw new Error(`Failed to search TPA services: ${error.message}`);
    }
  }

  static async getServicesByType(serviceType) {
    try {
      return TPAServiceModel.find({
        "services.serviceType": serviceType,
        isActive: true,
      }).populate("tpaId", "tpaName tpaCode");
    } catch (error) {
      throw new Error(`Failed to fetch services by type: ${error.message}`);
    }
  }

  static async getTPAServiceStats(tpaId) {
    try {
      const tpaService = await TPAServiceModel.findOne({
        tpaId: tpaId,
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
    } catch (error) {
      throw new Error(`Failed to fetch stats: ${error.message}`);
    }
  }

  static async getAllServices() {
    try {
      const allTPAServices = await TPAServiceModel.find({
        isActive: true,
      }).populate("tpaId", "tpaName tpaCode");

      const flattenedServices = [];

      allTPAServices.forEach((tpaService) => {
        tpaService.services.forEach((service) => {
          flattenedServices.push({
            tpaServiceId: tpaService._id,
            tpaId: tpaService.tpaId._id,
            tpaName: tpaService.tpaId.tpaName,
            tpaCode: tpaService.tpaId.tpaCode,
            serviceId: service._id,
            ...service.toObject(),
          });
        });
      });

      return flattenedServices;
    } catch (error) {
      throw new Error(`Failed to fetch all services: ${error.message}`);
    }
  }
}

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
