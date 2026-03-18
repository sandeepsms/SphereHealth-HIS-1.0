// services/investigationMasterService.js
const InvestigationMaster = require("../../models/Investigation/InvestigationMasterModel");
const InvestigationPricing = require("../../models/Investigation/InvestigationPricingModel");

class InvestigationMasterService {
  // ── 1. List with filters ──────────────────────────────────────
  async getAll({
    category,
    isPackage,
    isActive = "true",
    search,
    page = 1,
    limit = 200,
  }) {
    const q = {};
    if (isActive !== undefined) q.isActive = isActive === "true";
    if (category) q.category = category;
    if (isPackage !== undefined && isPackage !== null)
      q.isPackage = isPackage === "true";
    if (search) q.$text = { $search: search };

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [investigations, total] = await Promise.all([
      InvestigationMaster.find(q)
        .populate(
          "packageTests.investigationId",
          "investigationName investigationCode defaultPrice",
        )
        .sort({ category: 1, displayOrder: 1, investigationName: 1 })
        .limit(parseInt(limit))
        .skip(skip),
      InvestigationMaster.countDocuments(q),
    ]);
    return {
      investigations,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit)),
    };
  }

  // ── 2. Grouped by category ────────────────────────────────────
  async getGrouped() {
    const items = await InvestigationMaster.find({ isActive: true }).sort({
      category: 1,
      displayOrder: 1,
      investigationName: 1,
    });
    const grouped = items.reduce((acc, inv) => {
      if (!acc[inv.category])
        acc[inv.category] = { category: inv.category, items: [] };
      acc[inv.category].items.push(inv);
      return acc;
    }, {});
    return Object.values(grouped);
  }

  // ── 3. Single by ID ───────────────────────────────────────────
  async getById(id) {
    const inv = await InvestigationMaster.findById(id).populate(
      "packageTests.investigationId",
      "investigationName defaultPrice",
    );
    if (!inv) throw new Error("Investigation not found");
    return inv;
  }

  // ── 4. Create + auto CASH pricing ────────────────────────────
  async create(data) {
    const inv = await InvestigationMaster.create(data);
    if (data.defaultPrice && data.defaultPrice > 0) {
      await InvestigationPricing.create({
        investigationId: inv._id,
        tariffType: "CASH",
        price: data.defaultPrice,
        discount: 0,
        finalPrice: data.defaultPrice,
      });
    }
    return inv;
  }

  // ── 5. Update ─────────────────────────────────────────────────
  async update(id, data) {
    const inv = await InvestigationMaster.findByIdAndUpdate(
      id,
      { $set: data },
      { new: true, runValidators: true },
    );
    if (!inv) throw new Error("Investigation not found");

    // Sync CASH pricing with new defaultPrice
    if (data.defaultPrice !== undefined) {
      await InvestigationPricing.findOneAndUpdate(
        { investigationId: id, tariffType: "CASH", isActive: true },
        {
          price: data.defaultPrice,
          finalPrice: data.defaultPrice,
          discount: 0,
        },
        { upsert: true, new: true },
      );
    }
    return inv;
  }

  // ── 6. Soft delete ────────────────────────────────────────────
  async deactivate(id) {
    const inv = await InvestigationMaster.findByIdAndUpdate(
      id,
      { $set: { isActive: false } },
      { new: true },
    );
    if (!inv) throw new Error("Investigation not found");
    return inv;
  }

  // ── 7. Get pricing ────────────────────────────────────────────
  async getPricing(investigationId) {
    return InvestigationPricing.find({ investigationId, isActive: true })
      .populate("tpaId", "tpaName tpaCode")
      .sort({ tariffType: 1 });
  }

  // ── 8. Upsert pricing (TPA / CORPORATE only — CASH auto) ─────
  async upsertPricing(
    investigationId,
    { tariffType, tpaId, price, discount = 0, tpaApprovedLimit },
  ) {
    const query = { investigationId, tariffType, isActive: true };
    if (tariffType === "TPA" && tpaId) query.tpaId = tpaId;

    const finalPrice = price - (price * discount) / 100;
    let pricing = await InvestigationPricing.findOne(query);

    if (pricing) {
      pricing.price = price;
      pricing.discount = discount;
      pricing.finalPrice = finalPrice;
      pricing.tpaApprovedLimit = tpaApprovedLimit || null;
      await pricing.save();
    } else {
      pricing = await InvestigationPricing.create({
        investigationId,
        tariffType,
        tpaId: tpaId || null,
        price,
        discount,
        finalPrice,
        tpaApprovedLimit: tpaApprovedLimit || null,
      });
    }
    return pricing;
  }

  // ── 9. Get effective price ────────────────────────────────────
  async getEffectivePrice(investigationId, tariffType = "CASH", tpaId = null) {
    const inv = await InvestigationMaster.findById(investigationId);
    if (!inv) throw new Error("Investigation not found");
    const pricing = await InvestigationPricing.getPriceFor(
      investigationId,
      tariffType,
      tpaId,
    );
    return {
      investigation: inv,
      pricing,
      effectivePrice: pricing ? pricing.finalPrice : inv.defaultPrice,
    };
  }

  // ── 10. Seed default investigations ──────────────────────────
  async seed() {
    const DEFAULT_INVESTIGATIONS = [
      // PATHOLOGY
      {
        investigationCode: "PATH-001",
        investigationName: "Complete Blood Count (CBC)",
        shortName: "CBC",
        category: "PATHOLOGY",
        subCategory: "Haematology",
        sampleType: "Blood",
        defaultPrice: 300,
        tatHours: 4,
        displayOrder: 1,
      },
      {
        investigationCode: "PATH-002",
        investigationName: "Liver Function Test (LFT)",
        shortName: "LFT",
        category: "PATHOLOGY",
        subCategory: "Clinical Biochemistry",
        sampleType: "Blood",
        defaultPrice: 600,
        tatHours: 6,
        displayOrder: 2,
      },
      {
        investigationCode: "PATH-003",
        investigationName: "Kidney Function Test (KFT)",
        shortName: "KFT",
        category: "PATHOLOGY",
        subCategory: "Clinical Biochemistry",
        sampleType: "Blood",
        defaultPrice: 500,
        tatHours: 6,
        displayOrder: 3,
      },
      {
        investigationCode: "PATH-004",
        investigationName: "Blood Sugar Fasting",
        shortName: "BSF",
        category: "PATHOLOGY",
        subCategory: "Clinical Biochemistry",
        sampleType: "Blood",
        defaultPrice: 80,
        tatHours: 2,
        displayOrder: 4,
      },
      {
        investigationCode: "PATH-005",
        investigationName: "Blood Sugar PP",
        shortName: "BSPP",
        category: "PATHOLOGY",
        subCategory: "Clinical Biochemistry",
        sampleType: "Blood",
        defaultPrice: 80,
        tatHours: 2,
        displayOrder: 5,
      },
      {
        investigationCode: "PATH-006",
        investigationName: "HbA1c",
        shortName: "HbA1c",
        category: "PATHOLOGY",
        subCategory: "Endocrinology",
        sampleType: "Blood",
        defaultPrice: 400,
        tatHours: 6,
        displayOrder: 6,
      },
      {
        investigationCode: "PATH-007",
        investigationName: "Thyroid Function Test (TFT)",
        shortName: "TFT",
        category: "PATHOLOGY",
        subCategory: "Endocrinology",
        sampleType: "Blood",
        defaultPrice: 700,
        tatHours: 12,
        displayOrder: 7,
      },
      {
        investigationCode: "PATH-008",
        investigationName: "Urine Routine Examination",
        shortName: "URE",
        category: "PATHOLOGY",
        subCategory: "Clinical Pathology",
        sampleType: "Urine",
        defaultPrice: 100,
        tatHours: 2,
        displayOrder: 8,
      },
      {
        investigationCode: "PATH-009",
        investigationName: "Serum Creatinine",
        shortName: "Creatinine",
        category: "PATHOLOGY",
        subCategory: "Clinical Biochemistry",
        sampleType: "Blood",
        defaultPrice: 150,
        tatHours: 4,
        displayOrder: 9,
      },
      {
        investigationCode: "PATH-010",
        investigationName: "Lipid Profile",
        shortName: "Lipid",
        category: "PATHOLOGY",
        subCategory: "Clinical Biochemistry",
        sampleType: "Blood",
        defaultPrice: 500,
        tatHours: 6,
        displayOrder: 10,
      },
      {
        investigationCode: "PATH-011",
        investigationName: "Serum Electrolytes",
        shortName: "Electrolytes",
        category: "PATHOLOGY",
        subCategory: "Clinical Biochemistry",
        sampleType: "Blood",
        defaultPrice: 400,
        tatHours: 4,
        displayOrder: 11,
      },
      {
        investigationCode: "PATH-012",
        investigationName: "Dengue NS1 Antigen",
        shortName: "Dengue NS1",
        category: "PATHOLOGY",
        subCategory: "Serology",
        sampleType: "Blood",
        defaultPrice: 700,
        tatHours: 4,
        displayOrder: 12,
      },
      {
        investigationCode: "PATH-013",
        investigationName: "Malaria Antigen Test",
        shortName: "Malaria",
        category: "PATHOLOGY",
        subCategory: "Serology",
        sampleType: "Blood",
        defaultPrice: 300,
        tatHours: 2,
        displayOrder: 13,
      },
      {
        investigationCode: "PATH-014",
        investigationName: "HIV Test",
        shortName: "HIV",
        category: "PATHOLOGY",
        subCategory: "Serology",
        sampleType: "Blood",
        defaultPrice: 200,
        tatHours: 4,
        displayOrder: 14,
      },
      {
        investigationCode: "PATH-015",
        investigationName: "HBsAg (Hepatitis B)",
        shortName: "HBsAg",
        category: "PATHOLOGY",
        subCategory: "Serology",
        sampleType: "Blood",
        defaultPrice: 250,
        tatHours: 4,
        displayOrder: 15,
      },
      {
        investigationCode: "PATH-016",
        investigationName: "Widal Test",
        shortName: "Widal",
        category: "PATHOLOGY",
        subCategory: "Serology",
        sampleType: "Blood",
        defaultPrice: 200,
        tatHours: 4,
        displayOrder: 16,
      },
      {
        investigationCode: "PATH-017",
        investigationName: "PT/INR",
        shortName: "PT/INR",
        category: "PATHOLOGY",
        subCategory: "Coagulation",
        sampleType: "Blood",
        defaultPrice: 250,
        tatHours: 4,
        displayOrder: 17,
      },
      {
        investigationCode: "PATH-018",
        investigationName: "Stool Routine Examination",
        shortName: "Stool RE",
        category: "PATHOLOGY",
        subCategory: "Clinical Pathology",
        sampleType: "Stool",
        defaultPrice: 100,
        tatHours: 4,
        displayOrder: 18,
      },
      {
        investigationCode: "PATH-019",
        investigationName: "Blood Culture & Sensitivity",
        shortName: "Blood Culture",
        category: "MICROBIOLOGY",
        subCategory: "Microbiology",
        sampleType: "Blood",
        defaultPrice: 800,
        tatHours: 72,
        displayOrder: 1,
      },
      {
        investigationCode: "PATH-020",
        investigationName: "Urine Culture & Sensitivity",
        shortName: "Urine Culture",
        category: "MICROBIOLOGY",
        subCategory: "Microbiology",
        sampleType: "Urine",
        defaultPrice: 600,
        tatHours: 48,
        displayOrder: 2,
      },
      // RADIOLOGY
      {
        investigationCode: "RAD-001",
        investigationName: "X-Ray Chest PA View",
        shortName: "X-Ray Chest",
        category: "RADIOLOGY",
        subCategory: "Plain X-Ray",
        defaultPrice: 200,
        tatHours: 1,
        displayOrder: 1,
      },
      {
        investigationCode: "RAD-002",
        investigationName: "X-Ray Abdomen",
        shortName: "X-Ray Abdomen",
        category: "RADIOLOGY",
        subCategory: "Plain X-Ray",
        defaultPrice: 200,
        tatHours: 1,
        displayOrder: 2,
      },
      {
        investigationCode: "RAD-003",
        investigationName: "X-Ray Spine Cervical",
        shortName: "X-Ray Spine C",
        category: "RADIOLOGY",
        subCategory: "Plain X-Ray",
        defaultPrice: 250,
        tatHours: 1,
        displayOrder: 3,
      },
      {
        investigationCode: "RAD-004",
        investigationName: "CT Scan Head (Plain)",
        shortName: "CT Head",
        category: "RADIOLOGY",
        subCategory: "CT Scan",
        defaultPrice: 2500,
        tatHours: 2,
        displayOrder: 4,
      },
      {
        investigationCode: "RAD-005",
        investigationName: "CT Scan Abdomen (Contrast)",
        shortName: "CT Abdomen",
        category: "RADIOLOGY",
        subCategory: "CT Scan",
        defaultPrice: 4500,
        tatHours: 3,
        displayOrder: 5,
      },
      {
        investigationCode: "RAD-006",
        investigationName: "MRI Brain (Plain)",
        shortName: "MRI Brain",
        category: "RADIOLOGY",
        subCategory: "MRI",
        defaultPrice: 6000,
        tatHours: 4,
        displayOrder: 6,
      },
      {
        investigationCode: "RAD-007",
        investigationName: "MRI Spine Lumbar",
        shortName: "MRI Spine",
        category: "RADIOLOGY",
        subCategory: "MRI",
        defaultPrice: 7000,
        tatHours: 4,
        displayOrder: 7,
      },
      // USG
      {
        investigationCode: "USG-001",
        investigationName: "USG Abdomen (Whole)",
        shortName: "USG Abdomen",
        category: "ULTRASONOGRAPHY",
        subCategory: "USG",
        defaultPrice: 700,
        tatHours: 1,
        displayOrder: 1,
      },
      {
        investigationCode: "USG-002",
        investigationName: "USG Pelvis",
        shortName: "USG Pelvis",
        category: "ULTRASONOGRAPHY",
        subCategory: "USG",
        defaultPrice: 600,
        tatHours: 1,
        displayOrder: 2,
      },
      {
        investigationCode: "USG-003",
        investigationName: "USG Obstetric",
        shortName: "USG OB",
        category: "ULTRASONOGRAPHY",
        subCategory: "USG Obstetric",
        defaultPrice: 800,
        tatHours: 1,
        displayOrder: 3,
      },
      {
        investigationCode: "USG-004",
        investigationName: "Doppler Study (Peripheral)",
        shortName: "Doppler",
        category: "ULTRASONOGRAPHY",
        subCategory: "Doppler",
        defaultPrice: 1500,
        tatHours: 2,
        displayOrder: 4,
      },
      // CARDIOLOGY
      {
        investigationCode: "CARD-001",
        investigationName: "ECG 12 Lead",
        shortName: "ECG",
        category: "CARDIOLOGY",
        subCategory: "ECG",
        defaultPrice: 150,
        tatHours: 0,
        displayOrder: 1,
      },
      {
        investigationCode: "CARD-002",
        investigationName: "2D Echo with Doppler",
        shortName: "2D Echo",
        category: "CARDIOLOGY",
        subCategory: "Echo",
        defaultPrice: 2000,
        tatHours: 1,
        displayOrder: 2,
      },
      {
        investigationCode: "CARD-003",
        investigationName: "Holter Monitoring (24hr)",
        shortName: "Holter",
        category: "CARDIOLOGY",
        subCategory: "Holter",
        defaultPrice: 2500,
        tatHours: 24,
        displayOrder: 3,
      },
      {
        investigationCode: "CARD-004",
        investigationName: "Treadmill Test (TMT)",
        shortName: "TMT",
        category: "CARDIOLOGY",
        subCategory: "Stress Test",
        defaultPrice: 1500,
        tatHours: 1,
        displayOrder: 4,
      },
      // ENDOSCOPY
      {
        investigationCode: "ENDO-001",
        investigationName: "Upper GI Endoscopy (OGD)",
        shortName: "OGD",
        category: "ENDOSCOPY",
        subCategory: "GI Endoscopy",
        defaultPrice: 3000,
        tatHours: 1,
        displayOrder: 1,
      },
      {
        investigationCode: "ENDO-002",
        investigationName: "Colonoscopy",
        shortName: "Colonoscopy",
        category: "ENDOSCOPY",
        subCategory: "GI Endoscopy",
        defaultPrice: 4000,
        tatHours: 1,
        displayOrder: 2,
      },
    ];

    let created = 0,
      skipped = 0,
      errors = [];
    for (const inv of DEFAULT_INVESTIGATIONS) {
      try {
        const existing = await InvestigationMaster.findOne({
          investigationCode: inv.investigationCode,
        });
        if (existing) {
          skipped++;
          continue;
        }
        const newInv = await InvestigationMaster.create(inv);
        await InvestigationPricing.create({
          investigationId: newInv._id,
          tariffType: "CASH",
          price: inv.defaultPrice,
          discount: 0,
          finalPrice: inv.defaultPrice,
        });
        created++;
      } catch (err) {
        errors.push({ code: inv.investigationCode, error: err.message });
      }
    }
    return { created, skipped, errors, total: DEFAULT_INVESTIGATIONS.length };
  }
}

module.exports = new InvestigationMasterService();
