const Room = require("../../models/bedMgmt/roomModel");
const WardService = require("./WardService");
const Bed = require("../../models/bedMgmt/bedsModel");

class RoomService {
  async createRoom(data) {
    const ward = await WardService.getWardById(data.wardId);

    const existingRoomsCount = await Room.countDocuments({
      ward: data.wardId,
      isActive: true,
    });

    if (existingRoomsCount >= ward.totalRooms) {
      throw new Error(
        `Cannot create room. Ward "${ward.wardName}" has reached maximum capacity of ${ward.totalRooms} rooms. Currently ${existingRoomsCount} rooms exist.`
      );
    }

    const roomCode = `${ward.wardCode}-${data.roomNumber}`;
    const existing = await Room.findOne({
      roomCode,
      isActive: true,
    });
    if (existing) throw new Error("Room already exists");

    const duplicateRoomNumber = await Room.findOne({
      ward: data.wardId,
      roomNumber: data.roomNumber,
      isActive: true,
    });
    if (duplicateRoomNumber) {
      throw new Error(
        `Room number ${data.roomNumber} already exists in this ward`
      );
    }

    const newRoom = await Room.create({
      building: ward.building,
      buildingName: ward.buildingName,
      floor: ward.floor,
      floorNumber: ward.floorNumber,
      ward: data.wardId,
      wardName: ward.wardName,
      wardCode: ward.wardCode,
      roomNumber: data.roomNumber,
      roomName: data.roomName || `Room ${data.roomNumber}`,
      roomCode,
      totalBeds: data.totalBeds,
      bedRange: data.bedRange || "",
      isActive: data.isActive !== undefined ? data.isActive : true,
    });

    return newRoom;
  }

  async getAllRooms(filters = {}) {
    let query = { isActive: true };
    if (filters.wardId) query.ward = filters.wardId;
    if (filters.buildingId) query.building = filters.buildingId;
    if (filters.floorId) query.floor = filters.floorId;

    return await Room.find(query)
      .populate("ward", "wardName wardCode totalRooms")
      .populate("building", "buildingName")
      .populate("floor", "floorNumber floorName")
      .sort({ buildingName: 1, floorNumber: 1, wardName: 1, roomNumber: 1 });
  }

  async getRoomById(id) {
    const room = await Room.findById(id)
      .populate("ward")
      .populate("building")
      .populate("floor");
    if (!room) throw new Error("Room not found");
    return room;
  }

  async getRoomDetails(id) {
    const room = await Room.findById(id)
      .populate("ward")
      .populate("building")
      .populate("floor");
    if (!room) throw new Error("Room not found");

    const beds = await Bed.find({ room: id, isActive: true }).sort({
      bedNumber: 1,
    });

    const stats = {
      totalBeds: beds.length,
      availableBeds: beds.filter((b) => b.status === "Available").length,
      occupiedBeds: beds.filter((b) => b.status === "Occupied").length,
      maintenanceBeds: beds.filter((b) => b.status === "Maintenance").length,
      reservedBeds: beds.filter((b) => b.status === "Reserved").length,
      occupancyRate:
        beds.length > 0
          ? (
              (beds.filter((b) => b.status === "Occupied").length /
                beds.length) *
              100
            ).toFixed(2) + "%"
          : "0%",
    };

    return { room, beds, statistics: stats };
  }

  async updateRoom(id, data) {
    const room = await Room.findByIdAndUpdate(id, data, {
      new: true,
      runValidators: true,
    });
    if (!room) throw new Error("Room not found");
    return room;
  }

  async deleteRoom(id) {
    const room = await Room.findByIdAndUpdate(
      id,
      { isActive: false },
      { new: true }
    );
    if (!room) throw new Error("Room not found");
    return room;
  }
}

module.exports = new RoomService();
