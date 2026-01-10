// services/bedMgmt/bedService.js
const Bed = require("../../models/bedMgmt/bedsModel");
const Room = require("../../models/bedMgmt/roomModel");
const Ward = require("../../models/bedMgmt/wardModel");
const Building = require("../../models/bedMgmt/buildingModel");
const Floor = require("../../models/bedMgmt/floorModel");

class BedService {
  async createBeds(data) {
    const { roomId, beds } = data;

    if (!roomId) {
      throw new Error("Room ID is required");
    }

    if (!beds || beds.length === 0) {
      throw new Error("At least one bed is required");
    }

    const room = await Room.findById(roomId)
      .populate("building")
      .populate("floor")
      .populate("ward")
      .populate({
        path: "roomCategory",
        select: "categoryName roomType defaultPricing",
      })
      .populate("services.service");

    if (!room) {
      throw new Error("Room not found");
    }

    const existingBedsInRoom = await Bed.countDocuments({
      room: roomId,
      isActive: true,
    });

    const totalAfterCreation = existingBedsInRoom + beds.length;

    if (totalAfterCreation > room.totalBeds) {
      throw new Error(
        `Cannot create ${beds.length} beds. Room has ${
          room.totalBeds - existingBedsInRoom
        } slots available.`
      );
    }

    const createdBeds = [];
    const errors = [];

    for (let b of beds) {
      try {
        const exists = await Bed.findOne({
          room: roomId,
          bedNumber: b.bedNumber,
          isActive: true,
        });

        if (exists) {
          errors.push({
            bedNumber: b.bedNumber,
            error: "Bed already exists in this room",
          });
          continue;
        }

        const bedData = {
          bedNumber: b.bedNumber,
          building: room.building._id,
          buildingName: room.buildingName,
          floor: room.floor._id,
          floorNumber: room.floorNumber,
          room: room._id,
          roomNumber: room.roomNumber,
          roomCode: room.roomCode,
          status: b.status || "Available",
          isActive: true,
        };

        if (room.ward) {
          bedData.ward = room.ward._id;
          bedData.wardName = room.wardName;
          bedData.wardCode = room.wardCode;
        } else {
          bedData.ward = undefined;
          bedData.wardName = null;
          bedData.wardCode = null;
        }

        if (room.pricing) {
          bedData.pricing = {
            perBedDailyRate: room.pricing.perBedDailyRate || 0,
            nursingCharges: room.pricing.nursingCharges || 0,
            equipmentCharges: room.pricing.equipmentCharges || 0,
            securityDeposit: room.pricing.securityDeposit || 0,
            currency: room.pricing.currency || "INR",
          };
        } else if (room.roomCategory?.defaultPricing) {
          const categoryPricing = room.roomCategory.defaultPricing;
          bedData.pricing = {
            perBedDailyRate: categoryPricing.perBedDailyRate || 0,
            nursingCharges: categoryPricing.nursingCharges || 0,
            equipmentCharges: categoryPricing.equipmentCharges || 0,
            securityDeposit: categoryPricing.securityDeposit || 0,
            currency: categoryPricing.currency || "INR",
          };
        }

        if (room.services && room.services.length > 0) {
          bedData.services = room.services.map((s) => ({
            service: s.service._id || s.service,
            serviceName: s.service.serviceName || "",
            price: s.price || 0,
            isIncluded: s.isIncluded || false,
          }));
        }

        const newBed = await Bed.create(bedData);
        createdBeds.push(newBed);
      } catch (err) {
        console.error("Error creating bed:", err);
        errors.push({ bedNumber: b.bedNumber, error: err.message });
      }
    }

    if (createdBeds.length > 0) {
      await this._updateRoomAvailability(roomId);
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

    return await Bed.find(query)
      .populate("building", "buildingName buildingCode")
      .populate("ward", "wardName wardCode")
      .populate("floor", "floorNumber floorName")
      .populate({
        path: "room",
        select: "roomNumber roomName roomCode",
        populate: {
          path: "roomCategory",
          select: "categoryName roomType",
        },
      })
      .populate("patient", "firstName lastName patientId")
      .populate("services.service", "serviceName serviceCode")
      .sort({ bedNumber: 1 });
  }

  async getBedById(id) {
    const bed = await Bed.findById(id)
      .populate("building")
      .populate("ward")
      .populate("floor")
      .populate({
        path: "room",
        populate: {
          path: "roomCategory",
          select: "categoryName roomType defaultPricing",
        },
      })
      .populate("patient", "firstName lastName patientId")
      .populate("admission")
      .populate("services.service");

    if (!bed) {
      throw new Error("Bed not found");
    }

    return bed;
  }

  async getBedPricing(id) {
    const bed = await this.getBedById(id);

    const includedServices = bed.services.filter((s) => s.isIncluded);
    const optionalServices = bed.services.filter((s) => !s.isIncluded);

    return {
      bedNumber: bed.bedNumber,
      roomCode: bed.roomCode,
      wardCode: bed.wardCode || null,
      categoryName: bed.room?.roomCategory?.categoryName,

      pricing: {
        perBedDailyRate: bed.pricing.perBedDailyRate,
        nursingCharges: bed.pricing.nursingCharges,
        equipmentCharges: bed.pricing.equipmentCharges,
        securityDeposit: bed.pricing.securityDeposit,
        currency: bed.pricing.currency,
      },

      dailyCharges: {
        baseCharges: bed.dailyBaseCharges,
        includedServices: bed.includedServicesTotal,
        total: bed.totalDailyRate,
      },

      includedServices: includedServices.map((s) => ({
        name: s.serviceName,
        price: s.price,
      })),

      optionalServices: optionalServices.map((s) => ({
        name: s.serviceName,
        price: s.price,
      })),
    };
  }

  async bookBed(bedId, bookingData) {
    const { patientId, admissionId, admittedDate, expectedDischargeDate } =
      bookingData;

    if (!patientId || !admissionId || !admittedDate) {
      throw new Error("Patient, admission, and admitted date are required");
    }

    const bed = await Bed.findById(bedId);
    if (!bed) {
      throw new Error("Bed not found");
    }

    if (bed.status !== "Available") {
      throw new Error(`Bed is ${bed.status}. Cannot book.`);
    }

    bed.status = "Occupied";
    bed.patient = patientId;
    bed.admission = admissionId;
    bed.currentBooking = {
      admittedDate: new Date(admittedDate),
      expectedDischargeDate: expectedDischargeDate
        ? new Date(expectedDischargeDate)
        : null,
      actualDischargeDate: null,
      totalDays: 0,
    };

    await bed.save();
    await this._updateRoomAvailability(bed.room);

    return await this.getBedById(bedId);
  }

  async dischargeBed(bedId, dischargeDate) {
    const bed = await Bed.findById(bedId);
    if (!bed) {
      throw new Error("Bed not found");
    }

    if (bed.status !== "Occupied") {
      throw new Error("Bed is not occupied");
    }

    const admitDate = new Date(bed.currentBooking.admittedDate);
    const disDate = new Date(dischargeDate);
    const days = Math.ceil((disDate - admitDate) / (1000 * 60 * 60 * 24)) || 1;

    const dailyBaseCharges = bed.dailyBaseCharges;
    const dailyServicesCharges = bed.includedServicesTotal;

    bed.status = "Available";
    bed.patient = null;
    bed.admission = null;
    bed.currentBooking.actualDischargeDate = disDate;
    bed.currentBooking.totalDays = days;

    await bed.save();
    await this._updateRoomAvailability(bed.room);

    const baseCharges = dailyBaseCharges * days;
    const servicesCharges = dailyServicesCharges * days;
    const total = baseCharges + servicesCharges;

    return {
      bed: await this.getBedById(bedId),
      finalCharges: {
        admittedDate: admitDate,
        dischargeDate: disDate,
        totalDays: days,
        breakdown: {
          baseCharges: {
            perDay: dailyBaseCharges,
            total: baseCharges,
          },
          includedServices: {
            perDay: dailyServicesCharges,
            total: servicesCharges,
          },
        },
        grandTotal: total,
        securityDeposit: bed.pricing.securityDeposit,
      },
    };
  }

  async estimateCharges(bedId) {
    const bed = await Bed.findById(bedId);
    if (!bed) {
      throw new Error("Bed not found");
    }

    if (bed.status !== "Occupied") {
      throw new Error("Bed is not occupied");
    }

    const days = bed.daysOccupied;
    const dailyRate = bed.totalDailyRate;

    return {
      bedNumber: bed.bedNumber,
      admittedDate: bed.currentBooking.admittedDate,
      currentDate: new Date(),
      daysOccupied: days,
      dailyRate: dailyRate,
      breakdown: {
        baseCharges: bed.dailyBaseCharges * days,
        includedServices: bed.includedServicesTotal * days,
      },
      estimatedTotal: dailyRate * days,
      securityDeposit: bed.pricing.securityDeposit,
    };
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

    const bed = await Bed.findById(id);
    if (!bed) {
      throw new Error("Bed not found");
    }

    if (bed.status === "Occupied" && status !== "Occupied") {
      throw new Error("Cannot change status of occupied bed. Discharge first.");
    }

    bed.status = status;
    await bed.save();

    await this._updateRoomAvailability(bed.room);

    return await this.getBedById(id);
  }

  async updateBed(id, data) {
    const bed = await Bed.findById(id);
    if (!bed) {
      throw new Error("Bed not found");
    }

    const allowedUpdates = ["bedNumber", "status", "notes"];
    const updates = {};

    allowedUpdates.forEach((field) => {
      if (data[field] !== undefined) {
        updates[field] = data[field];
      }
    });

    Object.assign(bed, updates);
    await bed.save();

    return await this.getBedById(id);
  }

  async deleteBed(id) {
    const bed = await Bed.findById(id);
    if (!bed) {
      throw new Error("Bed not found");
    }

    if (bed.status === "Occupied") {
      throw new Error("Cannot delete occupied bed");
    }

    bed.isActive = false;
    await bed.save();

    await this._updateRoomAvailability(bed.room);

    return bed;
  }

  async getRoomBedCapacity(roomId) {
    const room = await Room.findById(roomId)
      .populate("ward")
      .populate("roomCategory", "categoryName roomType");

    if (!room) {
      throw new Error("Room not found");
    }

    const existingBeds = await Bed.countDocuments({
      room: roomId,
      isActive: true,
    });

    const bedsByStatus = await Bed.aggregate([
      {
        $match: {
          room: new require("mongoose").Types.ObjectId(roomId),
          isActive: true,
        },
      },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]);

    return {
      roomName: room.roomName,
      roomCode: room.roomCode,
      roomType: room.roomCategory?.roomType,
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

  async getWardBedCapacity(wardId) {
    const ward = await Ward.findById(wardId);
    if (!ward) {
      throw new Error("Ward not found");
    }

    const existingBeds = await Bed.countDocuments({
      ward: wardId,
      isActive: true,
    });

    const bedsByStatus = await Bed.aggregate([
      {
        $match: {
          ward: new require("mongoose").Types.ObjectId(wardId),
          isActive: true,
        },
      },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]);

    return {
      wardName: ward.wardName,
      wardCode: ward.wardCode,
      wardType: ward.wardType,
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

  async getAvailableBeds(filters = {}) {
    const query = {
      status: "Available",
      isActive: true,
    };

    if (filters.wardId) query.ward = filters.wardId;
    if (filters.roomId) query.room = filters.roomId;
    if (filters.buildingId) query.building = filters.buildingId;
    if (filters.floorId) query.floor = filters.floorId;

    return await Bed.find(query)
      .populate("building", "buildingName")
      .populate("floor", "floorNumber")
      .populate("ward", "wardName wardCode")
      .populate({
        path: "room",
        select: "roomNumber roomCode",
        populate: {
          path: "roomCategory",
          select: "categoryName",
        },
      })
      .sort({ bedNumber: 1 });
  }

  async _updateRoomAvailability(roomId) {
    if (!roomId) return;

    const occupiedBeds = await Bed.countDocuments({
      room: roomId,
      status: "Occupied",
      isActive: true,
    });

    const totalBeds = await Bed.countDocuments({
      room: roomId,
      isActive: true,
    });

    await Room.findByIdAndUpdate(roomId, {
      occupiedBeds: occupiedBeds,
      availableBeds: totalBeds - occupiedBeds,
    });
  }
}

module.exports = new BedService();
