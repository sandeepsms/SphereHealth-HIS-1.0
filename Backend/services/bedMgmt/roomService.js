// services/bedMgmt/roomService.js
const Room = require("../../models/bedMgmt/roomModel");
const RoomCategory = require("../../models/bedMgmt/roomCategoryModel");
const ServiceMaster = require("../../models/bedMgmt/serviceMasterModel");
const Floor = require("../../models/bedMgmt/floorModel");
const Building = require("../../models/bedMgmt/buildingModel");
const Ward = require("../../models/bedMgmt/wardModel");

class RoomService {
  /**
   * Helper: Clean ward data
   */
  cleanWardData(data) {
    if (!data.ward || data.ward === null || data.ward === "") {
      data.ward = undefined;
      data.wardName = null;
      data.wardCode = null;
    }
    return data;
  }

  /**
   * Helper: Generate room code
   */
  async generateRoomCode(buildingCode, floorNumber, wardCode, roomNumber) {
    if (wardCode) {
      return `${buildingCode}-${floorNumber}-${wardCode}-${roomNumber}`;
    }
    return `${buildingCode}-${floorNumber}-${roomNumber}`;
  }

  /**
   * Helper: Validate pricing
   */
  validatePricing(pricing) {
    const validated = {
      perBedDailyRate: parseFloat(pricing.perBedDailyRate || 0),
      nursingCharges: parseFloat(pricing.nursingCharges || 0),
      equipmentCharges: parseFloat(pricing.equipmentCharges || 0),
      securityDeposit: parseFloat(pricing.securityDeposit || 0),
    };

    // Check for negative values
    Object.keys(validated).forEach((key) => {
      if (validated[key] < 0) {
        throw new Error(`${key} cannot be negative`);
      }
    });

    return validated;
  }

  /**
   * Create a new room with category integration
   */
  async createRoom(data) {
    try {
      // Input validation
      if (!data.roomNumber || !data.roomName) {
        throw new Error("Room number and name are required");
      }

      if (!data.totalBeds || data.totalBeds < 1) {
        throw new Error("Total beds must be at least 1");
      }

      // Normalize IDs
      const buildingId = data.building || data.buildingId;
      const floorId = data.floor || data.floorId;
      const wardId = data.ward || data.wardId;
      const categoryId = data.roomCategory || data.categoryId;

      if (!buildingId || !floorId || !categoryId) {
        throw new Error("Building, floor, and category are required");
      }

      // Validate room category
      const category = await RoomCategory.findById(categoryId);
      if (!category) {
        throw new Error("Room category not found");
      }

      // Validate building
      const building = await Building.findById(buildingId);
      if (!building) {
        throw new Error("Building not found");
      }

      // Validate floor
      const floor = await Floor.findById(floorId);
      if (!floor) {
        throw new Error("Floor not found");
      }

      // Validate and handle ward
      let wardCode = null;
      if (wardId && wardId !== null && wardId !== "") {
        const ward = await Ward.findById(wardId);
        if (!ward) {
          throw new Error("Ward not found");
        }

        // Ensure ward belongs to the specified floor
        if (ward.floor.toString() !== floorId.toString()) {
          throw new Error("Ward does not belong to the specified floor");
        }

        data.ward = wardId;
        data.wardName = ward.wardName;
        data.wardCode = ward.wardCode;
        wardCode = ward.wardCode;
      } else {
        // No ward - clean the data
        data.ward = undefined;
        data.wardName = null;
        data.wardCode = null;
      }

      // Set normalized IDs
      data.building = buildingId;
      data.floor = floorId;
      data.roomCategory = categoryId;

      // Generate room code
      data.roomCode = await this.generateRoomCode(
        building.buildingCode,
        floor.floorNumber,
        wardCode,
        data.roomNumber,
      );

      // Check for duplicate room code
      const existingRoomCode = await Room.findOne({
        roomCode: data.roomCode,
        isActive: true,
      });
      if (existingRoomCode) {
        throw new Error("Room code already exists");
      }

      // Check for duplicate room number on same floor/ward
      const duplicateQuery = {
        floor: floorId,
        roomNumber: data.roomNumber,
        isActive: true,
      };
      if (wardId) {
        duplicateQuery.ward = wardId;
      }
      const existingRoom = await Room.findOne(duplicateQuery);
      if (existingRoom) {
        throw new Error("Room number already exists in this location");
      }

      // Handle pricing
      if (!data.pricing || Object.keys(data.pricing).length === 0) {
        // Use category default pricing
        data.pricing = {
          perBedDailyRate: category.defaultPricing.perBedDailyRate || 0,
          nursingCharges: category.defaultPricing.nursingCharges || 0,
          equipmentCharges: category.defaultPricing.equipmentCharges || 0,
          securityDeposit: category.defaultPricing.securityDeposit || 0,
        };
      } else {
        // Validate and use custom pricing
        data.pricing = this.validatePricing(data.pricing);
      }

      // Validate and process services
      if (data.services && data.services.length > 0) {
        const serviceIds = data.services.map((s) => s.service);
        const validServices = await ServiceMaster.find({
          _id: { $in: serviceIds },
          isActive: true,
        });

        if (validServices.length !== serviceIds.length) {
          throw new Error("One or more services are invalid or inactive");
        }

        data.services = data.services.map((serviceData) => {
          const masterService = validServices.find(
            (s) => s._id.toString() === serviceData.service.toString(),
          );
          return {
            service: serviceData.service,
            price: serviceData.price || masterService.basePrice,
            isIncluded: serviceData.isIncluded || false,
          };
        });
      }

      // Set denormalized data
      data.buildingName = building.buildingName;
      data.floorNumber = floor.floorNumber;

      // Initialize bed availability
      data.availableBeds = data.totalBeds;
      data.occupiedBeds = 0;

      // Create room
      const room = await Room.create(data);
      return await this.getRoomById(room._id);
    } catch (error) {
      if (error.name === "ValidationError") {
        throw new Error(`Validation error: ${error.message}`);
      }
      if (error.code === 11000) {
        throw new Error("Duplicate entry: Room already exists");
      }
      throw error;
    }
  }

  /**
   * Get all rooms with filters
   */
  async getAllRooms(filters = {}) {
    const query = { isActive: true };

    if (filters.building) query.building = filters.building;
    if (filters.floor) query.floor = filters.floor;
    if (filters.ward) query.ward = filters.ward;
    if (filters.roomCategory) query.roomCategory = filters.roomCategory;
    if (filters.status) query.status = filters.status;

    if (filters.availability === "available") {
      query.availableBeds = { $gt: 0 };
    } else if (filters.availability === "occupied") {
      query.availableBeds = 0;
    }

    return await Room.find(query)
      .populate("building", "buildingName buildingCode")
      .populate("floor", "floorNumber floorName")
      .populate("ward", "wardName wardCode")
      .populate("roomCategory", "categoryName categoryCode roomType")
      .populate(
        "services.service",
        "serviceName serviceCode basePrice unit category",
      )
      .sort({ roomCode: 1 });
  }

  /**
   * Get room by ID
   */
  async getRoomById(id) {
    const room = await Room.findById(id)
      .populate("building", "buildingName buildingCode")
      .populate("floor", "floorNumber floorName")
      .populate("ward", "wardName wardCode")
      .populate(
        "roomCategory",
        "categoryName categoryCode roomType defaultPricing",
      )
      .populate(
        "services.service",
        "serviceName serviceCode basePrice unit category",
      );

    if (!room) {
      throw new Error("Room not found");
    }

    return room;
  }

  /**
   * Update room
   */
  async updateRoom(id, data) {
    try {
      const room = await Room.findById(id);
      if (!room) {
        throw new Error("Room not found");
      }

      // Validate category if being updated
      if (
        data.roomCategory &&
        data.roomCategory !== room.roomCategory.toString()
      ) {
        const category = await RoomCategory.findById(data.roomCategory);
        if (!category) {
          throw new Error("Room category not found");
        }
      }

      // Handle hierarchy changes
      let needsRoomCodeUpdate = false;
      const updates = {};

      if (data.building && data.building !== room.building.toString()) {
        const building = await Building.findById(data.building);
        if (!building) {
          throw new Error("Building not found");
        }
        updates.buildingName = building.buildingName;
        needsRoomCodeUpdate = true;
      }

      if (data.floor && data.floor !== room.floor.toString()) {
        const floor = await Floor.findById(data.floor);
        if (!floor) {
          throw new Error("Floor not found");
        }
        updates.floorNumber = floor.floorNumber;
        needsRoomCodeUpdate = true;
      }

      // Handle ward changes
      if (data.ward !== undefined) {
        if (!data.ward || data.ward === null || data.ward === "") {
          // Removing ward
          data.ward = undefined;
          data.wardName = null;
          data.wardCode = null;
          needsRoomCodeUpdate = true;
        } else if (data.ward !== room.ward?.toString()) {
          // Adding/changing ward
          const ward = await Ward.findById(data.ward);
          if (!ward) {
            throw new Error("Ward not found");
          }

          // Validate ward belongs to floor
          const targetFloor = data.floor || room.floor;
          if (ward.floor.toString() !== targetFloor.toString()) {
            throw new Error("Ward does not belong to the specified floor");
          }

          data.wardName = ward.wardName;
          data.wardCode = ward.wardCode;
          needsRoomCodeUpdate = true;
        }
      }

      // Regenerate room code if needed
      if (needsRoomCodeUpdate || data.roomNumber) {
        const building = await Building.findById(
          data.building || room.building,
        );
        const floor = await Floor.findById(data.floor || room.floor);
        const wardCode = data.wardCode || room.wardCode;
        const roomNumber = data.roomNumber || room.roomNumber;

        data.roomCode = await this.generateRoomCode(
          building.buildingCode,
          floor.floorNumber,
          wardCode,
          roomNumber,
        );

        // Check for duplicate room code
        const existingRoomCode = await Room.findOne({
          roomCode: data.roomCode,
          _id: { $ne: id },
          isActive: true,
        });
        if (existingRoomCode) {
          throw new Error("Room code already exists");
        }
      }

      // Validate pricing if provided
      if (data.pricing) {
        data.pricing = this.validatePricing(data.pricing);
      }

      // Validate services if being updated
      if (data.services) {
        const serviceIds = data.services.map((s) => s.service);
        const validServices = await ServiceMaster.find({
          _id: { $in: serviceIds },
          isActive: true,
        });

        if (validServices.length !== serviceIds.length) {
          throw new Error("One or more services are invalid or inactive");
        }
      }

      // Merge updates
      Object.assign(data, updates);

      const updatedRoom = await Room.findByIdAndUpdate(id, data, {
        new: true,
        runValidators: true,
      }).populate("building floor ward roomCategory services.service");

      return updatedRoom;
    } catch (error) {
      if (error.name === "ValidationError") {
        throw new Error(`Validation error: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Delete room (soft delete)
   */
  async deleteRoom(id) {
    const room = await Room.findById(id);
    if (!room) {
      throw new Error("Room not found");
    }

    if (room.occupiedBeds > 0) {
      throw new Error("Cannot delete room with occupied beds");
    }

    room.isActive = false;
    room.status = "Inactive";
    await room.save();

    return room;
  }

  /**
   * Add/Update services for a room
   */
  async updateRoomServices(roomId, services) {
    const room = await Room.findById(roomId);
    if (!room) {
      throw new Error("Room not found");
    }

    // Validate all services
    const serviceIds = services.map((s) => s.service);
    const validServices = await ServiceMaster.find({
      _id: { $in: serviceIds },
      isActive: true,
    });

    if (validServices.length !== serviceIds.length) {
      throw new Error("One or more services are invalid or inactive");
    }

    room.services = services;
    await room.save();

    return await this.getRoomById(roomId);
  }

  /**
   * Get rooms by category
   */
  async getRoomsByCategory(categoryId, filters = {}) {
    const query = {
      roomCategory: categoryId,
      isActive: true,
    };

    if (filters.status) query.status = filters.status;
    if (filters.availability === "available") {
      query.availableBeds = { $gt: 0 };
    }

    return await Room.find(query)
      .populate("building floor ward roomCategory services.service")
      .sort({ roomCode: 1 });
  }

  /**
   * Get available rooms by category
   */
  async getAvailableRoomsByCategory(categoryId) {
    return await Room.find({
      roomCategory: categoryId,
      isActive: true,
      status: "Active",
      availableBeds: { $gt: 0 },
    })
      .populate("building floor ward roomCategory services.service")
      .sort({ roomCode: 1 });
  }

  /**
   * Get room statistics by category
   */
  async getRoomStatsByCategory(categoryId) {
    const rooms = await Room.find({
      roomCategory: categoryId,
      isActive: true,
    });

    const totalRooms = rooms.length;
    const totalBeds = rooms.reduce((sum, room) => sum + room.totalBeds, 0);
    const occupiedBeds = rooms.reduce(
      (sum, room) => sum + room.occupiedBeds,
      0,
    );
    const availableBeds = rooms.reduce(
      (sum, room) => sum + room.availableBeds,
      0,
    );

    return {
      totalRooms,
      totalBeds,
      occupiedBeds,
      availableBeds,
      occupancyRate:
        totalBeds > 0 ? ((occupiedBeds / totalBeds) * 100).toFixed(2) : 0,
      activeRooms: rooms.filter((r) => r.status === "Active").length,
      maintenanceRooms: rooms.filter((r) => r.status === "Under Maintenance")
        .length,
    };
  }

  /**
   * Update bed occupancy
   */
  async updateBedOccupancy(roomId, occupiedCount) {
    const room = await Room.findById(roomId);
    if (!room) {
      throw new Error("Room not found");
    }

    if (occupiedCount < 0 || occupiedCount > room.totalBeds) {
      throw new Error("Invalid occupied bed count");
    }

    room.occupiedBeds = occupiedCount;
    room.availableBeds = room.totalBeds - occupiedCount;
    await room.save();

    return room;
  }

  /**
   * Get rooms with low availability
   */
  async getRoomsWithLowAvailability(threshold = 1) {
    return await Room.find({
      isActive: true,
      status: "Active",
      availableBeds: { $lte: threshold, $gt: 0 },
    })
      .populate("building floor ward roomCategory")
      .sort({ availableBeds: 1 });
  }

  /**
   * Get fully occupied rooms
   */
  async getFullyOccupiedRooms() {
    return await Room.find({
      isActive: true,
      availableBeds: 0,
      totalBeds: { $gt: 0 },
    })
      .populate("building floor ward roomCategory")
      .sort({ roomCode: 1 });
  }

  /**
   * Get room availability summary
   */
  async getAvailabilitySummary(filters = {}) {
    const query = { isActive: true };

    if (filters.building) query.building = filters.building;
    if (filters.floor) query.floor = filters.floor;
    if (filters.ward) query.ward = filters.ward;

    const rooms = await Room.find(query);

    return {
      totalRooms: rooms.length,
      totalBeds: rooms.reduce((sum, r) => sum + r.totalBeds, 0),
      occupiedBeds: rooms.reduce((sum, r) => sum + r.occupiedBeds, 0),
      availableBeds: rooms.reduce((sum, r) => sum + r.availableBeds, 0),
      fullyOccupied: rooms.filter((r) => r.availableBeds === 0).length,
      fullyAvailable: rooms.filter((r) => r.occupiedBeds === 0).length,
      partiallyOccupied: rooms.filter(
        (r) => r.availableBeds > 0 && r.occupiedBeds > 0,
      ).length,
    };
  }
}

module.exports = new RoomService();
