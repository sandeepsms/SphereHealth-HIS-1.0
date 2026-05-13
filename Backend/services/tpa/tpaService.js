const TPA = require("../../models/tpa/tpaModel");
const RoomCategory = require("../../models/bedMgmt/roomCategoryModel");

class TPAService {
  static async createTPA(data = {}) {
    const {
      tpaName,
      tpaCode,
      contactPerson,
      phone,
      email,
      address,
      roomCharges = [],
    } = data;

    // FIX (audit P7-B2): legacy code crashed with TypeError on empty body
    // because `tpaName.slice(...)` ran before any null check. Validate
    // up-front so the controller can return a clean 400.
    if (!tpaName || typeof tpaName !== "string" || !tpaName.trim()) {
      const err = new Error("tpaName is required");
      err.statusCode = 400;
      throw err;
    }

    const finalCode =
      tpaCode ||
      `${tpaName.slice(0, 4).toUpperCase()}${Date.now().toString().slice(-4)}`;
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

    const categoryMap = {};
    categories.forEach((c) => {
      categoryMap[c._id.toString()] = {
        name: c.categoryName,
        baseRate: c.defaultPricing?.perBedDailyRate || 0,
      };
    });

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

  static async updateTPA(id, data) {
    const tpa = await TPA.findById(id);
    if (!tpa) throw new Error("TPA not found");
    // FIX (audit P7-B3): old code rejected updates on inactive TPAs which
    // made restoration impossible. Allow updates regardless of isActive —
    // the body may itself flip isActive: true to restore a soft-deleted
    // TPA. If the caller is just toggling other fields on an inactive TPA
    // that's fine too (audit trail of why-inactive is preserved).

    if (data.roomCharges) {
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
