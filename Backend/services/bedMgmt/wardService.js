const Ward = require("../../models/bedMgmt/wardModel");
const BuildingService = require("./BuildingService");
const FloorService = require("./FloorService");
const Room = require("../../models/bedMgmt/roomModel");
const Beds = require("../../models/bedMgmt/bedsModel");

class WardService {
  async createWard(data) {
    const building = await BuildingService.getBuildingById(data.buildingId);
    const floor = await FloorService.getFloorById(data.floorId);
    const existingWardsCount = await Ward.countDocuments({
      floor: data.floorId,
      isActive: true,
    });
    if (existingWardsCount >= floor.totalWards) {
      throw new Error(
        `Cannot create ward. Floor "${floor.floorName}" has reached maximum capacity of ${floor.totalWards} wards. Currently ${existingWardsCount} wards exist.`
      );
    }
    const existing = await Ward.findOne({
      wardCode: data.wardCode,
      isActive: true,
    });
    if (existing) throw new Error("Ward code already exists");
    const newWard = await Ward.create({
      building: data.buildingId,
      buildingName: building.buildingName,
      floor: data.floorId,
      floorNumber: floor.floorNumber,
      floorName: floor.floorName,
      wardName: data.wardName,
      wardCode: data.wardCode,
      wardType: data.wardType,
      totalRooms: data.totalRooms || 0,
      totalBeds: data.totalBeds,
      hourlyCharge: data.hourlyCharge || 0,
      dailyCharge: data.dailyCharge || 0,
      facilities: data.facilities || [],
      isActive: data.isActive !== undefined ? data.isActive : true,
    });

    return newWard;
  }

  async getAllWards(filters = {}) {
    let query = { isActive: true };
    if (filters.buildingId) query.building = filters.buildingId;
    if (filters.floorId) query.floor = filters.floorId;

    return await Ward.find(query)
      .populate("building", "buildingName buildingCode")
      .populate("floor", "floorNumber floorName totalWards")
      .sort({ buildingName: 1, floorNumber: 1, wardName: 1 });
  }

  async getWardById(id) {
    const ward = await Ward.findById(id).populate("building").populate("floor");
    if (!ward) throw new Error("Ward not found");
    return ward;
  }

  async getWardDetails(id) {
    const ward = await Ward.findById(id).populate("building").populate("floor");
    if (!ward) throw new Error("Ward not found");

    let rooms = [],
      beds = [];

    rooms = await Room.find({ ward: id, isActive: true }).sort({
      roomNumber: 1,
    });

    beds = await Beds.find({ ward: id, isActive: true })
      .populate("room")
      .sort({ bedNumber: 1 });

    const stats = {
      totalRooms: rooms.length,
      totalBeds: beds.length,
      availableBeds: beds.filter((b) => b.status === "Available").length,
      occupiedBeds: beds.filter((b) => b.status === "Occupied").length,
      maintenanceBeds: beds.filter((b) => b.status === "Maintenance").length,
      occupancyRate:
        beds.length > 0
          ? (
              (beds.filter((b) => b.status === "Occupied").length /
                beds.length) *
              100
            ).toFixed(2) + "%"
          : "0%",
    };

    return { ward, rooms, beds, statistics: stats };
  }

  async updateWard(id, data) {
    if (data.totalRooms !== undefined) {
      const existingRoomsCount = await Room.countDocuments({
        ward: id,
        isActive: true,
      });

      if (data.totalRooms < existingRoomsCount) {
        throw new Error(
          `Cannot reduce total rooms to ${data.totalRooms}. Ward currently has ${existingRoomsCount} active rooms.`
        );
      }
    }

    const ward = await Ward.findByIdAndUpdate(id, data, {
      new: true,
      runValidators: true,
    });

    if (!ward) throw new Error("Ward not found");
    return ward;
  }
  async deleteWard(id) {
    const ward = await Ward.findByIdAndUpdate(
      id,
      { isActive: false },
      { new: true }
    );
    if (!ward) throw new Error("Ward not found");
    return ward;
  }
}

module.exports = new WardService();
