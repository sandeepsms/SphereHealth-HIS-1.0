const InvestigationMaster = require("../../models/Investigation/InvestigationMasterModel");
const InvestigationPricing = require("../../models/Investigation/InvestigationPricingModel");
const { tpaService } = require("../tpa/tpaService"); // adjust path if needed

class InvestigationMasterService {
  // ── GET all ───────────────────────────────────────────────────
  async getAll({
    category,
    performedAt,
    isPackage,
    isActive = "true",
    search,
    page = 1,
    limit = 200,
  }) {
    const q = {};
    if (isActive !== undefined) q.isActive = isActive === "true";
    if (category) q.category = category;
    if (performedAt) q.performedAt = performedAt;
    if (isPackage !== undefined && isPackage !== null)
      q.isPackage = isPackage === "true";
    if (search) q.$text = { $search: search };

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [investigations, total] = await Promise.all([
      InvestigationMaster.find(q)
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

  // ── GET grouped ───────────────────────────────────────────────
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

  // ── GET single ────────────────────────────────────────────────
  async getById(id) {
    const inv = await InvestigationMaster.findById(id);
    if (!inv) throw new Error("Investigation not found");
    return inv;
  }

  // ── CREATE — auto pricing for CASH + all TPAs ─────────────────
  async create(data) {
    const inv = await InvestigationMaster.create(data);
    await this._createAllPricings(inv);
    return inv;
  }

  // ── UPDATE ────────────────────────────────────────────────────
  async update(id, data) {
    const inv = await InvestigationMaster.findByIdAndUpdate(
      id,
      { $set: data },
      { new: true, runValidators: true },
    );
    if (!inv) throw new Error("Investigation not found");

    // Sync CASH if defaultPrice changed
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

  // ── DEACTIVATE ────────────────────────────────────────────────
  async deactivate(id) {
    const inv = await InvestigationMaster.findByIdAndUpdate(
      id,
      { $set: { isActive: false } },
      { new: true },
    );
    if (!inv) throw new Error("Investigation not found");
    return inv;
  }

  // ── GET pricing ───────────────────────────────────────────────
  async getPricing(investigationId) {
    return InvestigationPricing.find({ investigationId, isActive: true })
      .populate("tpaId", "tpaName tpaCode")
      .sort({ tariffType: 1, tpaName: 1 });
  }

  // ── UPSERT pricing manually ───────────────────────────────────
  async upsertPricing(
    investigationId,
    { tariffType, tpaId, tpaName, price, discount = 0, tpaApprovedLimit },
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
      if (tpaName) pricing.tpaName = tpaName;
      await pricing.save();
    } else {
      pricing = await InvestigationPricing.create({
        investigationId,
        tariffType,
        tpaId: tpaId || null,
        tpaName: tpaName || null,
        price,
        discount,
        finalPrice,
        tpaApprovedLimit: tpaApprovedLimit || null,
      });
    }
    return pricing;
  }

  // ── GET effective price ───────────────────────────────────────
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

  // ── SEED ──────────────────────────────────────────────────────
  async seed() {
    const DEFAULT = [
      {
        investigationName: "Complete Blood Count (CBC)",
        shortName: "CBC",
        category: "PATHOLOGY",
        subCategory: "Haematology",
        performedAt: "INTERNAL",
        sampleType: "Blood",
        defaultPrice: 300,
        tatHours: 4,
        displayOrder: 1,
      },
      {
        investigationName: "Liver Function Test (LFT)",
        shortName: "LFT",
        category: "PATHOLOGY",
        subCategory: "Clinical Biochemistry",
        performedAt: "INTERNAL",
        sampleType: "Blood",
        defaultPrice: 600,
        tatHours: 6,
        displayOrder: 2,
      },
      {
        investigationName: "Kidney Function Test (KFT)",
        shortName: "KFT",
        category: "PATHOLOGY",
        subCategory: "Clinical Biochemistry",
        performedAt: "INTERNAL",
        sampleType: "Blood",
        defaultPrice: 500,
        tatHours: 6,
        displayOrder: 3,
      },
      {
        investigationName: "Blood Sugar Fasting",
        shortName: "BSF",
        category: "PATHOLOGY",
        subCategory: "Clinical Biochemistry",
        performedAt: "INTERNAL",
        sampleType: "Blood",
        defaultPrice: 80,
        tatHours: 2,
        displayOrder: 4,
      },
      {
        investigationName: "Blood Sugar PP",
        shortName: "BSPP",
        category: "PATHOLOGY",
        subCategory: "Clinical Biochemistry",
        performedAt: "INTERNAL",
        sampleType: "Blood",
        defaultPrice: 80,
        tatHours: 2,
        displayOrder: 5,
      },
      {
        investigationName: "HbA1c",
        shortName: "HbA1c",
        category: "PATHOLOGY",
        subCategory: "Endocrinology",
        performedAt: "INTERNAL",
        sampleType: "Blood",
        defaultPrice: 400,
        tatHours: 6,
        displayOrder: 6,
      },
      {
        investigationName: "Thyroid Function Test",
        shortName: "TFT",
        category: "PATHOLOGY",
        subCategory: "Endocrinology",
        performedAt: "INTERNAL",
        sampleType: "Blood",
        defaultPrice: 700,
        tatHours: 12,
        displayOrder: 7,
      },
      {
        investigationName: "Urine Routine Examination",
        shortName: "URE",
        category: "PATHOLOGY",
        subCategory: "Clinical Pathology",
        performedAt: "INTERNAL",
        sampleType: "Urine",
        defaultPrice: 100,
        tatHours: 2,
        displayOrder: 8,
      },
      {
        investigationName: "Lipid Profile",
        shortName: "Lipid",
        category: "PATHOLOGY",
        subCategory: "Clinical Biochemistry",
        performedAt: "INTERNAL",
        sampleType: "Blood",
        defaultPrice: 500,
        tatHours: 6,
        displayOrder: 9,
      },
      {
        investigationName: "Serum Creatinine",
        shortName: "Creatinine",
        category: "PATHOLOGY",
        subCategory: "Clinical Biochemistry",
        performedAt: "INTERNAL",
        sampleType: "Blood",
        defaultPrice: 150,
        tatHours: 4,
        displayOrder: 10,
      },
      {
        investigationName: "Serum Electrolytes",
        shortName: "Electrolyte",
        category: "PATHOLOGY",
        subCategory: "Clinical Biochemistry",
        performedAt: "INTERNAL",
        sampleType: "Blood",
        defaultPrice: 400,
        tatHours: 4,
        displayOrder: 11,
      },
      {
        investigationName: "Dengue NS1 Antigen",
        shortName: "Dengue NS1",
        category: "PATHOLOGY",
        subCategory: "Serology",
        performedAt: "INTERNAL",
        sampleType: "Blood",
        defaultPrice: 700,
        tatHours: 4,
        displayOrder: 12,
      },
      {
        investigationName: "Malaria Antigen Test",
        shortName: "Malaria",
        category: "PATHOLOGY",
        subCategory: "Serology",
        performedAt: "INTERNAL",
        sampleType: "Blood",
        defaultPrice: 300,
        tatHours: 2,
        displayOrder: 13,
      },
      {
        investigationName: "HIV Test",
        shortName: "HIV",
        category: "PATHOLOGY",
        subCategory: "Serology",
        performedAt: "INTERNAL",
        sampleType: "Blood",
        defaultPrice: 200,
        tatHours: 4,
        displayOrder: 14,
      },
      {
        investigationName: "HBsAg (Hepatitis B)",
        shortName: "HBsAg",
        category: "PATHOLOGY",
        subCategory: "Serology",
        performedAt: "INTERNAL",
        sampleType: "Blood",
        defaultPrice: 250,
        tatHours: 4,
        displayOrder: 15,
      },
      {
        investigationName: "Widal Test",
        shortName: "Widal",
        category: "PATHOLOGY",
        subCategory: "Serology",
        performedAt: "INTERNAL",
        sampleType: "Blood",
        defaultPrice: 200,
        tatHours: 4,
        displayOrder: 16,
      },
      {
        investigationName: "PT/INR",
        shortName: "PT/INR",
        category: "PATHOLOGY",
        subCategory: "Coagulation",
        performedAt: "INTERNAL",
        sampleType: "Blood",
        defaultPrice: 250,
        tatHours: 4,
        displayOrder: 17,
      },
      {
        investigationName: "Stool Routine Examination",
        shortName: "Stool RE",
        category: "PATHOLOGY",
        subCategory: "Clinical Pathology",
        performedAt: "INTERNAL",
        sampleType: "Stool",
        defaultPrice: 100,
        tatHours: 4,
        displayOrder: 18,
      },
      {
        investigationName: "Blood Culture & Sensitivity",
        shortName: "Blood Cx",
        category: "MICROBIOLOGY",
        subCategory: "Microbiology",
        performedAt: "INTERNAL",
        sampleType: "Blood",
        defaultPrice: 800,
        tatHours: 72,
        displayOrder: 1,
      },
      {
        investigationName: "Urine Culture & Sensitivity",
        shortName: "Urine Cx",
        category: "MICROBIOLOGY",
        subCategory: "Microbiology",
        performedAt: "INTERNAL",
        sampleType: "Urine",
        defaultPrice: 600,
        tatHours: 48,
        displayOrder: 2,
      },
      {
        investigationName: "X-Ray Chest PA View",
        shortName: "X-Ray Chest",
        category: "RADIOLOGY",
        subCategory: "Plain X-Ray",
        performedAt: "INTERNAL",
        defaultPrice: 200,
        tatHours: 1,
        displayOrder: 1,
      },
      {
        investigationName: "X-Ray Abdomen",
        shortName: "X-Ray Abd",
        category: "RADIOLOGY",
        subCategory: "Plain X-Ray",
        performedAt: "INTERNAL",
        defaultPrice: 200,
        tatHours: 1,
        displayOrder: 2,
      },
      {
        investigationName: "CT Scan Head (Plain)",
        shortName: "CT Head",
        category: "RADIOLOGY",
        subCategory: "CT Scan",
        performedAt: "BOTH",
        defaultPrice: 2500,
        tatHours: 2,
        displayOrder: 3,
      },
      {
        investigationName: "CT Scan Abdomen (Contrast)",
        shortName: "CT Abdomen",
        category: "RADIOLOGY",
        subCategory: "CT Scan",
        performedAt: "BOTH",
        defaultPrice: 4500,
        tatHours: 3,
        displayOrder: 4,
      },
      {
        investigationName: "MRI Brain (Plain)",
        shortName: "MRI Brain",
        category: "RADIOLOGY",
        subCategory: "MRI",
        performedAt: "BOTH",
        defaultPrice: 6000,
        tatHours: 4,
        displayOrder: 5,
      },
      {
        investigationName: "MRI Spine Lumbar",
        shortName: "MRI Spine",
        category: "RADIOLOGY",
        subCategory: "MRI",
        performedAt: "BOTH",
        defaultPrice: 7000,
        tatHours: 4,
        displayOrder: 6,
      },
      {
        investigationName: "PET Scan",
        shortName: "PET Scan",
        category: "RADIOLOGY",
        subCategory: "Nuclear Medicine",
        performedAt: "EXTERNAL",
        defaultPrice: 15000,
        tatHours: 8,
        displayOrder: 7,
      },
      {
        investigationName: "USG Abdomen (Whole)",
        shortName: "USG Abd",
        category: "ULTRASONOGRAPHY",
        performedAt: "INTERNAL",
        defaultPrice: 700,
        tatHours: 1,
        displayOrder: 1,
      },
      {
        investigationName: "USG Pelvis",
        shortName: "USG Pelvis",
        category: "ULTRASONOGRAPHY",
        performedAt: "INTERNAL",
        defaultPrice: 600,
        tatHours: 1,
        displayOrder: 2,
      },
      {
        investigationName: "USG Obstetric",
        shortName: "USG OB",
        category: "ULTRASONOGRAPHY",
        performedAt: "INTERNAL",
        defaultPrice: 800,
        tatHours: 1,
        displayOrder: 3,
      },
      {
        investigationName: "Doppler Study",
        shortName: "Doppler",
        category: "ULTRASONOGRAPHY",
        performedAt: "INTERNAL",
        defaultPrice: 1500,
        tatHours: 2,
        displayOrder: 4,
      },
      {
        investigationName: "ECG 12 Lead",
        shortName: "ECG",
        category: "CARDIOLOGY",
        performedAt: "INTERNAL",
        defaultPrice: 150,
        tatHours: 0,
        displayOrder: 1,
      },
      {
        investigationName: "2D Echo with Doppler",
        shortName: "2D Echo",
        category: "CARDIOLOGY",
        performedAt: "INTERNAL",
        defaultPrice: 2000,
        tatHours: 1,
        displayOrder: 2,
      },
      {
        investigationName: "Holter Monitoring 24hr",
        shortName: "Holter",
        category: "CARDIOLOGY",
        performedAt: "INTERNAL",
        defaultPrice: 2500,
        tatHours: 24,
        displayOrder: 3,
      },
      {
        investigationName: "Treadmill Test (TMT)",
        shortName: "TMT",
        category: "CARDIOLOGY",
        performedAt: "INTERNAL",
        defaultPrice: 1500,
        tatHours: 1,
        displayOrder: 4,
      },
      {
        investigationName: "Upper GI Endoscopy (OGD)",
        shortName: "OGD",
        category: "ENDOSCOPY",
        performedAt: "INTERNAL",
        defaultPrice: 3000,
        tatHours: 1,
        displayOrder: 1,
      },
      {
        investigationName: "Colonoscopy",
        shortName: "Colonoscopy",
        category: "ENDOSCOPY",
        performedAt: "INTERNAL",
        defaultPrice: 4000,
        tatHours: 1,
        displayOrder: 2,
      },
    ];

    let created = 0,
      skipped = 0,
      errors = [];

    for (const data of DEFAULT) {
      try {
        // Check by shortName to avoid duplicates
        const existing = await InvestigationMaster.findOne({
          shortName: data.shortName,
        });
        if (existing) {
          skipped++;
          continue;
        }

        const inv = await InvestigationMaster.create(data);
        await this._createAllPricings(inv);
        created++;
      } catch (err) {
        errors.push({ name: data.investigationName, error: err.message });
      }
    }

    return { created, skipped, errors, total: DEFAULT.length };
  }

  // ── PRIVATE: Create CASH + all TPA pricings ───────────────────
  async _createAllPricings(inv) {
    const price = inv.defaultPrice || 0;

    // 1. CASH pricing
    await InvestigationPricing.findOneAndUpdate(
      { investigationId: inv._id, tariffType: "CASH", isActive: true },
      { price, discount: 0, finalPrice: price },
      { upsert: true, new: true },
    );

    // 2. TPA pricing for all active TPAs
    if (inv.availableForTPA !== false) {
      try {
        // Try to load TPA model dynamically
        let TPA = null;
        const paths = [
          "../../models/tpa/tpaModel",
          "../../models/TPA/tpaModel",
          "../../models/tpa/TPA",
          "../../models/TPA/TPA",
        ];
        for (const p of paths) {
          try {
            TPA = require(p);
            break;
          } catch {}
        }

        if (TPA) {
          const allTPAs = await TPA.find({ isActive: true }).select(
            "_id tpaName tpaCode",
          );
          for (const tpa of allTPAs) {
            const exists = await InvestigationPricing.findOne({
              investigationId: inv._id,
              tariffType: "TPA",
              tpaId: tpa._id,
              isActive: true,
            });
            if (!exists) {
              await InvestigationPricing.create({
                investigationId: inv._id,
                tariffType: "TPA",
                tpaId: tpa._id,
                tpaName: tpa.tpaName,
                price,
                discount: 0,
                finalPrice: price,
                tpaApprovedLimit: null,
              });
            }
          }
        }
      } catch (e) {
        // TPA model not found — skip TPA pricing silently
        console.log("TPA pricing skipped:", e.message);
      }
    }
  }
}

module.exports = new InvestigationMasterService();
