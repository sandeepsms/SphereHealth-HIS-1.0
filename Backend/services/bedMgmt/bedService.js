const Beds = require("../../models/bedMgmt/bedsModel");
const Ward = require("../../models/bedMgmt/wardModel");
const Room = require("../../models/bedMgmt/roomModel");
const Floor = require("../../models/bedMgmt/floorModel");

class BedService {
  async createBedes(data) {
    const { wardId, roomId, beds } = data;

    // ✅ STEP 1: Ward validation
    const ward = await Ward.findById(wardId)
      .populate("building")
      .populate("floor");

    if (!ward) throw new Error("Ward not found");
    if (!ward.floor) throw new Error("Floor not found in ward");

    const floor = await Floor.findById(ward.floor._id);
    if (floor.totalWards === 0) {
      throw new Error("Cannot create beds: Floor has no wards assigned");
    }

    const buildingId = ward.building?._id || ward.floor.building;
    const buildingName = ward.buildingName || ward.floor.buildingName;

    if (!buildingId) throw new Error("Building not found");

    // ✅ STEP 2: Room validation (if roomId provided)
    let room = null;
    if (roomId) {
      room = await Room.findById(roomId);
      if (!room) throw new Error("Room not found");

      // ✅ Check room belongs to the ward
      if (room.ward.toString() !== wardId.toString()) {
        throw new Error("Room does not belong to this ward");
      }

      // ✅ CRITICAL: Check room bed capacity
      const existingBedsInRoom = await Beds.countDocuments({
        room: roomId,
        isActive: true,
      });

      const newBedsCount = beds.length;
      const totalAfterCreation = existingBedsInRoom + newBedsCount;

      if (totalAfterCreation > room.totalBeds) {
        throw new Error(
          `Cannot create ${newBedsCount} beds. Room "${
            room.roomName
          }" has capacity of ${
            room.totalBeds
          } beds. Currently ${existingBedsInRoom} beds exist. Only ${
            room.totalBeds - existingBedsInRoom
          } slots available.`
        );
      }
    }

    // ✅ STEP 3: Ward bed capacity validation
    const existingBedsInWard = await Beds.countDocuments({
      ward: wardId,
      isActive: true,
    });

    const newBedsCount = beds.length;
    const totalAfterCreation = existingBedsInWard + newBedsCount;

    if (totalAfterCreation > ward.totalBeds) {
      throw new Error(
        `Cannot create ${newBedsCount} beds. Ward "${
          ward.wardName
        }" has capacity of ${
          ward.totalBeds
        } beds. Currently ${existingBedsInWard} beds exist. Only ${
          ward.totalBeds - existingBedsInWard
        } slots available.`
      );
    }

    // ✅ STEP 4: Create beds
    const createdBeds = [];
    const errors = [];

    for (let b of beds) {
      try {
        // Check duplicate bed number in room (if room exists)
        if (roomId) {
          const existsInRoom = await Beds.findOne({
            room: roomId,
            bedNumber: b.bedNumber,
            isActive: true,
          });
          if (existsInRoom) {
            errors.push({
              bedNumber: b.bedNumber,
              error: "Bed number already exists in this room",
            });
            continue;
          }
        } else {
          // Check duplicate bed number in ward (no room)
          const existsInWard = await Beds.findOne({
            ward: wardId,
            bedNumber: b.bedNumber,
            room: null,
            isActive: true,
          });
          if (existsInWard) {
            errors.push({
              bedNumber: b.bedNumber,
              error: "Bed number already exists in this ward",
            });
            continue;
          }
        }

        const bedData = {
          bedNumber: b.bedNumber,
          building: buildingId,
          buildingName: buildingName,
          floor: ward.floor._id,
          floorNumber: ward.floor?.floorNumber,
          ward: wardId,
          wardName: ward.wardName,
          wardCode: ward.wardCode,
          room: room?._id || null,
          roomNumber: room?.roomNumber || null,
          roomCode: room?.roomCode || null,
          status: b.status || "Available",
          bedType: b.bedType || "General",
          isActive: true,
        };

        const newBed = await Beds.create(bedData);
        createdBeds.push(newBed);
      } catch (err) {
        console.error("Error creating bed:", err);
        errors.push({ bedNumber: b.bedNumber, error: err.message });
      }
    }

    return {
      success: createdBeds.length > 0,
      created: createdBeds.length,
      failed: errors.length,
      createdBeds,
      errors,
    };
  }

  async getAllBeds(filters = {}) {
    const query = { isActive: true };
    if (filters.wardId) query.ward = filters.wardId;
    if (filters.roomId) query.room = filters.roomId;
    if (filters.status) query.status = filters.status;
    if (filters.buildingId) query.building = filters.buildingId;
    if (filters.floorId) query.floor = filters.floorId;

    return await Beds.find(query)
      .populate("building", "buildingName buildingCode")
      .populate("ward", "wardName wardCode totalBeds")
      .populate("floor", "floorNumber floorName")
      .populate("room", "roomNumber roomName totalBeds")
      .sort({ bedNumber: 1 });
  }

  async getBedById(id) {
    const bed = await Beds.findById(id)
      .populate("building")
      .populate("ward")
      .populate("floor")
      .populate("room");

    if (!bed) throw new Error("Bed not found");
    return bed;
  }

  async updateBedStatus(id, status) {
    const validStatuses = [
      "Available",
      "Occupied",
      "Maintenance",
      "Blocked",
      "Reserved",
    ];
    if (!validStatuses.includes(status)) {
      throw new Error(
        `Invalid status. Must be one of: ${validStatuses.join(", ")}`
      );
    }

    const bed = await Beds.findByIdAndUpdate(
      id,
      { status },
      { new: true, runValidators: true }
    );

    if (!bed) throw new Error("Bed not found");
    return bed;
  }

  async updateBed(id, data) {
    const bed = await Beds.findByIdAndUpdate(id, data, {
      new: true,
      runValidators: true,
    });
    if (!bed) throw new Error("Bed not found");
    return bed;
  }

  async deleteBed(id) {
    const bed = await Beds.findByIdAndUpdate(
      id,
      { isActive: false },
      { new: true }
    );
    if (!bed) throw new Error("Bed not found");
    return bed;
  }

  // ✅ BONUS: Get room bed capacity
  async getRoomBedCapacity(roomId) {
    const room = await Room.findById(roomId).populate("ward");
    if (!room) throw new Error("Room not found");

    const existingBeds = await Beds.countDocuments({
      room: roomId,
      isActive: true,
    });

    const bedsByStatus = await Beds.aggregate([
      { $match: { room: room._id, isActive: true } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]);

    return {
      roomName: room.roomName,
      roomCode: room.roomCode,
      totalCapacity: room.totalBeds,
      currentBeds: existingBeds,
      availableSlots: room.totalBeds - existingBeds,
      isFull: existingBeds >= room.totalBeds,
      bedsByStatus: bedsByStatus.reduce((acc, item) => {
        acc[item._id] = item.count;
        return acc;
      }, {}),
    };
  }

  // ✅ Get ward bed capacity
  async getWardBedCapacity(wardId) {
    const ward = await Ward.findById(wardId);
    if (!ward) throw new Error("Ward not found");

    const existingBeds = await Beds.countDocuments({
      ward: wardId,
      isActive: true,
    });

    const bedsByStatus = await Beds.aggregate([
      { $match: { ward: ward._id, isActive: true } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]);

    return {
      wardName: ward.wardName,
      wardCode: ward.wardCode,
      totalCapacity: ward.totalBeds,
      currentBeds: existingBeds,
      availableSlots: ward.totalBeds - existingBeds,
      isFull: existingBeds >= ward.totalBeds,
      bedsByStatus: bedsByStatus.reduce((acc, item) => {
        acc[item._id] = item.count;
        return acc;
      }, {}),
    };
  }
}

module.exports = new BedService();
