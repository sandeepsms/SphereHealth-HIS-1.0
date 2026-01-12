const TPA = require("../../models/tpa/tpaModel");

class TPAService {
  async createTPA(tpaData) {
    // Check if TPA code already exists
    const existing = await TPA.findOne({ tpaCode: tpaData.tpaCode });
    if (existing) {
      throw new Error("TPA with this code already exists");
    }

    const tpa = new TPA(tpaData);
    await tpa.save();
    return tpa;
  }

  async getAllTPAs(filters = {}) {
    const query = {};

    if (filters.isActive !== undefined) {
      query.isActive = filters.isActive === "true" || filters.isActive === true;
    }

    if (filters.search) {
      query.$or = [
        { tpaName: { $regex: filters.search, $options: "i" } },
        { tpaCode: { $regex: filters.search, $options: "i" } },
      ];
    }

    return await TPA.find(query).sort({ tpaName: 1 });
  }

  async getTPAById(id) {
    const tpa = await TPA.findById(id);
    if (!tpa) {
      throw new Error("TPA not found");
    }
    return tpa;
  }

  async updateTPA(id, updateData) {
    // Check if updating to an existing code
    if (updateData.tpaCode) {
      const existing = await TPA.findOne({
        _id: { $ne: id },
        tpaCode: updateData.tpaCode,
      });
      if (existing) {
        throw new Error("TPA with this code already exists");
      }
    }

    const tpa = await TPA.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    });

    if (!tpa) {
      throw new Error("TPA not found");
    }

    return tpa;
  }

  async deleteTPA(id) {
    const tpa = await TPA.findByIdAndUpdate(
      id,
      { isActive: false },
      { new: true }
    );

    if (!tpa) {
      throw new Error("TPA not found");
    }

    return tpa;
  }

  async getActiveTPAs() {
    return await TPA.find({ isActive: true }).sort({ tpaName: 1 });
  }

  async searchTPAs(searchTerm) {
    const regex = new RegExp(searchTerm, "i");
    return await TPA.find({
      isActive: true,
      $or: [{ tpaName: regex }, { tpaCode: regex }],
    })
      .sort({ tpaName: 1 })
      .limit(20);
  }
}

module.exports = new TPAService();
