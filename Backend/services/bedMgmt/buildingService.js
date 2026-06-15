const Building = require("../../models/bedMgmt/buildingModel");
const Floor = require("../../models/bedMgmt/floorModel");

class BuildingService {
  async createBuilding(data) {
    const existing = await Building.findOne({
      $or: [
        { buildingName: data.buildingName },
        { buildingCode: data.buildingCode },
      ],
    });
    if (existing) throw new Error("Building already exists");
    return await Building.create(data);
  }

  async getAllBuildings(filters = {}) {
    let query = { isActive: true };
    return await Building.find(query).sort({ buildingName: 1 });
  }

  async getBuildingById(id) {
    const building = await Building.findById(id);
    if (!building) throw new Error("Building not found");
    return building;
  }

  async getBuildingDetails(id) {
    const building = await Building.findById(id);
    if (!building) throw new Error("Building not found");

    const floors = await Floor.find({ building: id, isActive: true });
    return { building, floors, totalFloors: floors.length };
  }

  async updateBuilding(id, data) {
    if (data.totalFloors !== undefined) {
      const existingFloorsCount = await Floor.countDocuments({
        building: id,
        isActive: true,
      });

      if (data.totalFloors < existingFloorsCount) {
        throw new Error(
          `Cannot reduce total floors to ${data.totalFloors}. Building currently has ${existingFloorsCount} active floors.`
        );
      }
    }

    const building = await Building.findByIdAndUpdate(id, data, {
      new: true,
      runValidators: true,
    });

    if (!building) throw new Error("Building not found");
    return building;
  }
  async deleteBuilding(id) {
    const building = await Building.findByIdAndUpdate(
      id,
      { isActive: false },
      { new: true }
    );
    if (!building) throw new Error("Building not found");
    return building;
  }
}

module.exports = new BuildingService();
