const Floor = require("../../models/bedMgmt/floorModel");
const BuildingService = require("./BuildingService");
const Ward = require("../../models/bedMgmt/wardModel");

class FloorService {
  async createFloor(data) {
    const buildingId = data.buildingId || data.building;

    if (!buildingId) {
      throw new Error("Building ID is required");
    }

    const building = await BuildingService.getBuildingById(buildingId);

    const existingFloorsCount = await Floor.countDocuments({
      building: buildingId,
      isActive: true,
    });

    if (existingFloorsCount >= building.totalFloors) {
      throw new Error(
        `Cannot create floor. Building has reached maximum capacity of ${building.totalFloors} floors. Currently ${existingFloorsCount} floors exist.`
      );
    }

    const existing = await Floor.findOne({
      building: buildingId,
      floorNumber: data.floorNumber,
      isActive: true,
    });

    if (existing) {
      throw new Error("Floor already exists in this building");
    }

    const newFloor = await Floor.create({
      building: buildingId,
      buildingName: building.buildingName,
      floorNumber: data.floorNumber,
      floorName: data.floorName,
      totalWards: data.totalWards || 0,
      isActive: data.isActive !== undefined ? data.isActive : true,
      notes: data.notes || "",
    });

    return newFloor;
  }

  async getAllFloors(filters = {}) {
    let query = { isActive: true };
    const buildingId = filters.buildingId || filters.building;
    if (buildingId) query.building = buildingId;

    return await Floor.find(query)
      .populate("building", "buildingName buildingCode totalFloors")
      .sort({ buildingName: 1, floorNumber: 1 });
  }

  async getFloorById(id) {
    const floor = await Floor.findById(id).populate("building");
    if (!floor) throw new Error("Floor not found");
    return floor;
  }

  async getFloorDetails(id) {
    const floor = await Floor.findById(id).populate("building");
    if (!floor) throw new Error("Floor not found");

    const wards = await Ward.find({ floor: id, isActive: true });
    const stats = {
      totalWards: wards.length,
      activeWards: wards.filter((w) => w.isActive).length,
    };

    return { floor, wards, statistics: stats };
  }

  async updateFloor(id, data) {
    if (data.totalWards !== undefined) {
      const existingWardsCount = await Ward.countDocuments({
        floor: id,
        isActive: true,
      });

      if (data.totalWards < existingWardsCount) {
        throw new Error(
          `Cannot reduce total wards to ${data.totalWards}. Floor currently has ${existingWardsCount} active wards.`
        );
      }
    }

    const floor = await Floor.findByIdAndUpdate(id, data, {
      new: true,
      runValidators: true,
    });

    if (!floor) throw new Error("Floor not found");
    return floor;
  }

  async deleteFloor(id) {
    const floor = await Floor.findByIdAndUpdate(
      id,
      { isActive: false },
      { new: true }
    );
    if (!floor) throw new Error("Floor not found");
    return floor;
  }

  async getBuildingFloorCapacity(buildingId) {
    const building = await BuildingService.getBuildingById(buildingId);
    const existingFloors = await Floor.countDocuments({
      building: buildingId,
      isActive: true,
    });

    return {
      totalCapacity: building.totalFloors,
      currentFloors: existingFloors,
      availableSlots: building.totalFloors - existingFloors,
      isFull: existingFloors >= building.totalFloors,
    };
  }
}

module.exports = new FloorService();
