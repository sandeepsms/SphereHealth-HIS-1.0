// services/tpaService.js - WITH 20% DISCOUNT VALIDATION
const TPA = require("../../models/tpa/tpaModel");
const RoomCategory = require("../../models/bedMgmt/roomCategoryModel");

class TPAService {
  static async createTPA(data) {
    const {
      tpaName,
      tpaCode,
      contactPerson,
      phone,
      email,
      address,
      roomCharges = [],
    } = data;

    const finalCode =
      tpaCode ||
      `${tpaName.slice(0, 4).toUpperCase()}${Date.now().toString().slice(-4)}`;

    // 🚨 NEW: Get RoomCategories WITH default pricing for discount validation
    const ids = roomCharges.map((rc) => rc.roomCategory);
    const categories = await RoomCategory.find({
      _id: { $in: ids },
      isActive: true,
    })
      .select("categoryName defaultPricing.perBedDailyRate")
      .lean();

    if (categories.length !== ids.length) {
      throw new Error("One or more room categories not found / inactive");
    }

    // 🚨 NEW: Create category map with pricing
    const categoryMap = {};
    categories.forEach((c) => {
      categoryMap[c._id.toString()] = {
        name: c.categoryName,
        baseRate: c.defaultPricing?.perBedDailyRate || 0,
      };
    });

    // 🚨 NEW: Validate MAX 20% DISCOUNT for each room charge
    for (let i = 0; i < roomCharges.length; i++) {
      const rc = roomCharges[i];
      const cat = categoryMap[rc.roomCategory.toString()];

      if (cat.baseRate > 0) {
        const tpaTotalCharge =
          (rc.doctorVisit || 0) +
          (rc.nursingCharge || 0) +
          (rc.roomRent || 0) +
          (rc.rmoCharge || 0);

        const discountPercent =
          ((cat.baseRate - tpaTotalCharge) / cat.baseRate) * 100;

        if (discountPercent > 20) {
          throw new Error(
            `Room "${cat.name}" discount (${discountPercent.toFixed(1)}%) exceeds 20% limit. Base: ₹${cat.baseRate}, TPA: ₹${tpaTotalCharge}`,
          );
        }
      }
    }

    const tpa = new TPA({
      tpaName,
      tpaCode: finalCode,
      contactPerson,
      phone,
      email,
      address,
      roomCharges: roomCharges.map((rc) => {
        const cat = categoryMap[rc.roomCategory.toString()];
        return {
          roomCategory: rc.roomCategory,
          categoryName: cat.name,
          doctorVisit: rc.doctorVisit,
          nursingCharge: rc.nursingCharge,
          roomRent: rc.roomRent,
          rmoCharge: rc.rmoCharge,
        };
      }),
    });

    const saved = await tpa.save();
    return saved.populate("roomCharges.roomCategory");
  }

  // UpdateTPA me bhi same validation
  static async updateTPA(id, data) {
    const tpa = await TPA.findById(id);
    if (!tpa || !tpa.isActive) throw new Error("TPA not found or inactive");

    if (data.roomCharges) {
      // Same validation logic as createTPA
      const ids = data.roomCharges.map((rc) => rc.roomCategory);
      const categories = await RoomCategory.find({
        _id: { $in: ids },
        isActive: true,
      })
        .select("categoryName defaultPricing.perBedDailyRate")
        .lean();

      if (categories.length !== ids.length) {
        throw new Error("One or more room categories not found / inactive");
      }

      const categoryMap = {};
      categories.forEach((c) => {
        categoryMap[c._id.toString()] = {
          name: c.categoryName,
          baseRate: c.defaultPricing?.perBedDailyRate || 0,
        };
      });

      // 🚨 20% DISCOUNT VALIDATION
      for (let i = 0; i < data.roomCharges.length; i++) {
        const rc = data.roomCharges[i];
        const cat = categoryMap[rc.roomCategory.toString()];

        if (cat.baseRate > 0) {
          const tpaTotalCharge =
            (rc.doctorVisit || 0) +
            (rc.nursingCharge || 0) +
            (rc.roomRent || 0) +
            (rc.rmoCharge || 0);

          const discountPercent =
            ((cat.baseRate - tpaTotalCharge) / cat.baseRate) * 100;

          if (discountPercent > 20) {
            throw new Error(
              `Room "${cat.name}" discount (${discountPercent.toFixed(1)}%) exceeds 20% limit`,
            );
          }
        }
      }

      data.roomCharges = data.roomCharges.map((rc) => {
        const cat = categoryMap[rc.roomCategory.toString()];
        return {
          roomCategory: rc.roomCategory,
          categoryName: cat.name,
          doctorVisit: rc.doctorVisit,
          nursingCharge: rc.nursingCharge,
          roomRent: rc.roomRent,
          rmoCharge: rc.rmoCharge,
        };
      });
    }

    const updated = await TPA.findByIdAndUpdate(id, data, {
      new: true,
      runValidators: true,
    }).populate("roomCharges.roomCategory");

    return updated;
  }

  // Baaki methods same...
  static async getAllTPAs(filters = {}) {
    const query = { isActive: true };
    if (filters.tpaName) {
      query.tpaName = { $regex: filters.tpaName, $options: "i" };
    }
    if (filters.tpaCode) {
      query.tpaCode = filters.tpaCode.toUpperCase();
    }
    return TPA.find(query)
      .populate("roomCharges.roomCategory", "categoryName roomType color")
      .sort({ createdAt: -1 });
  }

  static async getTPAById(id) {
    const tpa = await TPA.findById(id).populate(
      "roomCharges.roomCategory",
      "categoryName roomType color",
    );
    if (!tpa || !tpa.isActive) throw new Error("TPA not found or inactive");
    return tpa;
  }

  static async deleteTPA(id) {
    const tpa = await TPA.findByIdAndUpdate(
      id,
      { isActive: false },
      { new: true },
    );
    if (!tpa) throw new Error("TPA not found");
    return tpa;
  }

  static async getChargesByRoomCategory(tpaId, roomCategoryId) {
    const tpa = await TPA.findOne({ _id: tpaId, isActive: true });
    if (!tpa) throw new Error("TPA not found");
    return tpa.getRoomCharges(roomCategoryId);
  }
}

module.exports = TPAService;
