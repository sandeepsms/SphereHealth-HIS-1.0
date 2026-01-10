const RoomCategory = require("../../models/bedMgmt/roomCategoryModel");

class RoomCategoryService {
  async seedDefaultCategories() {
    const defaultCategories = [
      {
        categoryName: "General Ward",
        categoryCode: "GEN",
        roomType: "General Ward",
        description: "Multi-bed ward for general patients",
        defaultPricing: {
          perBedDailyRate: 1000,
          nursingCharges: 300,
          equipmentCharges: 0,
          securityDeposit: 5000,
          currency: "INR",
        },
        minBeds: 4,
        maxBeds: 10,
        defaultAmenities: ["Shared Bathroom", "Locker"],
        classification: "Economy",
        displayOrder: 1,
      },
      {
        categoryName: "Semi-Private Room",
        categoryCode: "SEMI-PVT",
        roomType: "Semi-Private",
        description: "Room with 2-3 beds",
        defaultPricing: {
          perBedDailyRate: 2000,
          nursingCharges: 500,
          equipmentCharges: 0,
          securityDeposit: 8000,
          currency: "INR",
        },
        minBeds: 2,
        maxBeds: 3,
        defaultAmenities: ["AC", "TV", "Attached Bathroom"],
        classification: "Standard",
        displayOrder: 2,
      },
      {
        categoryName: "Private Room",
        categoryCode: "PVT",
        roomType: "Private Room",
        description: "Single occupancy room",
        defaultPricing: {
          perBedDailyRate: 3000,
          nursingCharges: 700,
          equipmentCharges: 0,
          securityDeposit: 10000,
          currency: "INR",
        },
        minBeds: 1,
        maxBeds: 1,
        defaultAmenities: [
          "AC",
          "TV",
          "Refrigerator",
          "Attached Bathroom",
          "WiFi",
        ],
        classification: "Standard",
        displayOrder: 3,
      },
      {
        categoryName: "Deluxe Room",
        categoryCode: "DELUXE",
        roomType: "Deluxe",
        description: "Premium single room with extra amenities",
        defaultPricing: {
          perBedDailyRate: 5000,
          nursingCharges: 1000,
          equipmentCharges: 500,
          securityDeposit: 20000,
          currency: "INR",
        },
        minBeds: 1,
        maxBeds: 1,
        defaultAmenities: [
          "AC",
          "Smart TV",
          "Sofa",
          "Refrigerator",
          "Microwave",
          "WiFi",
        ],
        classification: "Premium",
        displayOrder: 4,
      },
      {
        categoryName: "Suite",
        categoryCode: "SUITE",
        roomType: "Suite",
        description: "Luxury suite with separate living area",
        defaultPricing: {
          perBedDailyRate: 8000,
          nursingCharges: 1500,
          equipmentCharges: 1000,
          securityDeposit: 30000,
          currency: "INR",
        },
        minBeds: 1,
        maxBeds: 1,
        defaultAmenities: [
          "AC",
          "Smart TV",
          "Living Area",
          "Kitchenette",
          "Jacuzzi",
          "WiFi",
        ],
        classification: "VIP",
        displayOrder: 5,
      },
      {
        categoryName: "ICU",
        categoryCode: "ICU",
        roomType: "ICU",
        description: "Intensive Care Unit with 24/7 monitoring",
        defaultPricing: {
          perBedDailyRate: 10000,
          nursingCharges: 2500,
          equipmentCharges: 3000,
          securityDeposit: 50000,
          currency: "INR",
        },
        minBeds: 1,
        maxBeds: 2,
        defaultAmenities: ["Ventilator", "Monitor", "AC", "Oxygen", "Suction"],
        classification: "Premium",
        displayOrder: 6,
      },
      {
        categoryName: "NICU",
        categoryCode: "NICU",
        roomType: "NICU",
        description: "Neonatal Intensive Care Unit",
        defaultPricing: {
          perBedDailyRate: 15000,
          nursingCharges: 3500,
          equipmentCharges: 5000,
          securityDeposit: 70000,
          currency: "INR",
        },
        minBeds: 1,
        maxBeds: 1,
        defaultAmenities: [
          "Incubator",
          "Phototherapy",
          "Monitor",
          "Oxygen",
          "Warmer",
        ],
        classification: "Premium",
        displayOrder: 7,
      },
      {
        categoryName: "CCU",
        categoryCode: "CCU",
        roomType: "CCU",
        description: "Cardiac Care Unit",
        defaultPricing: {
          perBedDailyRate: 12000,
          nursingCharges: 3000,
          equipmentCharges: 3500,
          securityDeposit: 60000,
          currency: "INR",
        },
        minBeds: 1,
        maxBeds: 2,
        defaultAmenities: ["Cardiac Monitor", "Defibrillator", "AC", "Oxygen"],
        classification: "Premium",
        displayOrder: 8,
      },
      {
        categoryName: "HDU",
        categoryCode: "HDU",
        roomType: "HDU",
        description: "High Dependency Unit",
        defaultPricing: {
          perBedDailyRate: 8000,
          nursingCharges: 2000,
          equipmentCharges: 2000,
          securityDeposit: 40000,
          currency: "INR",
        },
        minBeds: 1,
        maxBeds: 4,
        defaultAmenities: ["Monitor", "AC", "Oxygen"],
        classification: "Standard",
        displayOrder: 9,
      },
      {
        categoryName: "Emergency Room",
        categoryCode: "ER",
        roomType: "Emergency",
        description: "Emergency observation and stabilization",
        defaultPricing: {
          perBedDailyRate: 2000,
          nursingCharges: 800,
          equipmentCharges: 500,
          securityDeposit: 10000,
          currency: "INR",
        },
        minBeds: 1,
        maxBeds: 6,
        defaultAmenities: ["Monitor", "Oxygen", "Crash Cart"],
        classification: "Standard",
        displayOrder: 10,
      },
      {
        categoryName: "Day Care",
        categoryCode: "DAYCARE",
        roomType: "Daycare",
        description: "Same-day procedure and recovery",
        defaultPricing: {
          perBedDailyRate: 3000,
          nursingCharges: 800,
          equipmentCharges: 500,
          securityDeposit: 15000,
          currency: "INR",
        },
        minBeds: 1,
        maxBeds: 4,
        defaultAmenities: ["AC", "TV", "Recliner"],
        classification: "Standard",
        displayOrder: 11,
      },
      {
        categoryName: "Isolation Room",
        categoryCode: "ISOL",
        roomType: "Isolation",
        description: "Infection control room",
        defaultPricing: {
          perBedDailyRate: 4000,
          nursingCharges: 1000,
          equipmentCharges: 1000,
          securityDeposit: 20000,
          currency: "INR",
        },
        minBeds: 1,
        maxBeds: 1,
        defaultAmenities: ["HEPA Filter", "AC", "Attached Bathroom", "Monitor"],
        classification: "Standard",
        displayOrder: 12,
      },
      {
        categoryName: "Maternity Room",
        categoryCode: "MAT",
        roomType: "Maternity",
        description: "Labor and delivery room",
        defaultPricing: {
          perBedDailyRate: 3500,
          nursingCharges: 1000,
          equipmentCharges: 1500,
          securityDeposit: 15000,
          currency: "INR",
        },
        minBeds: 1,
        maxBeds: 1,
        defaultAmenities: ["Delivery Bed", "Baby Warmer", "Monitor", "AC"],
        classification: "Standard",
        displayOrder: 13,
      },
      {
        categoryName: "Pediatric Room",
        categoryCode: "PEDI",
        roomType: "Pediatric",
        description: "Children's ward",
        defaultPricing: {
          perBedDailyRate: 2500,
          nursingCharges: 700,
          equipmentCharges: 300,
          securityDeposit: 10000,
          currency: "INR",
        },
        minBeds: 1,
        maxBeds: 4,
        defaultAmenities: ["AC", "TV", "Play Area", "Attached Bathroom"],
        classification: "Standard",
        displayOrder: 14,
      },
      {
        categoryName: "Operation Theatre",
        categoryCode: "OT",
        roomType: "Operation Theatre",
        description: "Surgical operation room",
        defaultPricing: {
          perBedDailyRate: 0,
          nursingCharges: 0,
          equipmentCharges: 15000,
          securityDeposit: 50000,
          currency: "INR",
        },
        minBeds: 1,
        maxBeds: 1,
        defaultAmenities: [
          "OT Table",
          "Lights",
          "Anesthesia Machine",
          "Monitor",
        ],
        classification: "Premium",
        displayOrder: 15,
      },
      {
        categoryName: "Recovery Room",
        categoryCode: "RR",
        roomType: "Recovery Room",
        description: "Post-operative recovery",
        defaultPricing: {
          perBedDailyRate: 2000,
          nursingCharges: 600,
          equipmentCharges: 500,
          securityDeposit: 10000,
          currency: "INR",
        },
        minBeds: 1,
        maxBeds: 4,
        defaultAmenities: ["Monitor", "Oxygen", "AC"],
        classification: "Standard",
        displayOrder: 16,
      },
    ];

    const results = {
      success: [],
      skipped: [],
      failed: [],
    };

    for (const category of defaultCategories) {
      try {
        const existing = await RoomCategory.findOne({
          categoryCode: category.categoryCode,
        });

        if (existing) {
          results.skipped.push({
            categoryName: category.categoryName,
            message: "Already exists",
          });
          continue;
        }

        const newCategory = await RoomCategory.create(category);
        results.success.push(newCategory);
      } catch (error) {
        results.failed.push({
          categoryName: category.categoryName,
          error: error.message,
        });
      }
    }

    return results;
  }

  async createCategory(data) {
    const existing = await RoomCategory.findOne({
      $or: [
        { categoryName: data.categoryName },
        { categoryCode: data.categoryCode },
      ],
    });

    if (existing) {
      throw new Error("Category with this name or code already exists");
    }

    if (!data.defaultPricing?.currency) {
      data.defaultPricing = data.defaultPricing || {};
      data.defaultPricing.currency = "INR";
    }

    const category = await RoomCategory.create(data);
    return category;
  }

  async getAllCategories(filters = {}) {
    const query = {};

    if (filters.isActive !== undefined) {
      query.isActive = filters.isActive === "true" || filters.isActive === true;
    }

    if (filters.roomType) {
      query.roomType = filters.roomType;
    }

    if (filters.classification) {
      query.classification = filters.classification;
    }

    return await RoomCategory.find(query).sort({
      displayOrder: 1,
      categoryName: 1,
    });
  }

  async getCategoryById(id) {
    const category = await RoomCategory.findById(id);
    if (!category) {
      throw new Error("Category not found");
    }
    return category;
  }

  async updateCategory(id, data) {
    const category = await RoomCategory.findById(id);
    if (!category) {
      throw new Error("Category not found");
    }

    if (data.categoryName || data.categoryCode) {
      const existing = await RoomCategory.findOne({
        _id: { $ne: id },
        $or: [
          { categoryName: data.categoryName },
          { categoryCode: data.categoryCode },
        ],
      });

      if (existing) {
        throw new Error("Category with this name or code already exists");
      }
    }

    const updatedCategory = await RoomCategory.findByIdAndUpdate(id, data, {
      new: true,
      runValidators: true,
    });

    return updatedCategory;
  }

  async deleteCategory(id) {
    const category = await RoomCategory.findById(id);
    if (!category) {
      throw new Error("Category not found");
    }

    category.isActive = false;
    await category.save();

    return category;
  }

  async getCriticalCareCategories() {
    return await RoomCategory.find({
      roomType: { $in: ["ICU", "NICU", "CCU", "HDU"] },
      isActive: true,
    }).sort({ displayOrder: 1 });
  }

  async getCategoriesByClassification(classification) {
    return await RoomCategory.find({
      classification,
      isActive: true,
    }).sort({ displayOrder: 1 });
  }

  async getStatistics() {
    const categories = await RoomCategory.find({ isActive: true });

    const totalCategories = categories.length;
    const criticalCare = categories.filter((c) =>
      ["ICU", "NICU", "CCU", "HDU"].includes(c.roomType)
    ).length;

    const avgPrice =
      categories.reduce((sum, c) => {
        return sum + (c.defaultPricing?.perBedDailyRate || 0);
      }, 0) / (totalCategories || 1);

    const byClassification = categories.reduce((acc, c) => {
      acc[c.classification] = (acc[c.classification] || 0) + 1;
      return acc;
    }, {});

    return {
      totalCategories,
      criticalCareCategories: criticalCare,
      standardCategories: totalCategories - criticalCare,
      averagePrice: Math.round(avgPrice),
      byClassification,
    };
  }
}

module.exports = new RoomCategoryService();
