// services/serviceMasterService.js
// ═══════════════════════════════════════════════════════════════
// SERVICE MASTER SERVICE LAYER
// Sabhi business logic yahan hogi — controllers sirf req/res handle karenge
// ═══════════════════════════════════════════════════════════════

const ServiceMaster = require("../../models/ServiceMaster/serviceMasterModel");
const ServicePricing = require("../../models/ServicePricing/ServicePricingModel");
const { seedServices } = require("../../seeders/serviceMasterSeeder");

class ServiceMasterService {
  // ── 1. List services with filters + pagination ────────────────
  async getAllServices({
    category,
    domain,
    applicableTo,
    isActive = "true",
    search,
    page = 1,
    limit = 100,
  }) {
    const q = {};

    if (isActive !== undefined) q.isActive = isActive === "true";
    if (category) q.category = category;
    if (domain) q.domain = domain;
    if (applicableTo) q.applicableTo = { $in: [applicableTo, "ALL"] };
    if (search) q.$text = { $search: search };

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [services, total] = await Promise.all([
      ServiceMaster.find(q)
        .sort({ domain: 1, category: 1, displayOrder: 1 })
        .limit(parseInt(limit))
        .skip(skip),
      ServiceMaster.countDocuments(q),
    ]);

    return {
      services,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit)),
    };
  }

  // ── 2. Services grouped by domain + category ──────────────────
  // Used by billing UI to show service picker (domain → category → services)
  async getGroupedServices({ applicableTo, domain } = {}) {
    const q = { isActive: true };
    if (applicableTo) q.applicableTo = { $in: [applicableTo, "ALL"] };
    if (domain) q.domain = domain;

    const services = await ServiceMaster.find(q).sort({
      category: 1,
      displayOrder: 1,
    });

    // Group: { "IPD___ROOM": { domain, category, services[] } }
    const grouped = services.reduce((acc, s) => {
      const key = `${s.domain}___${s.category}`;
      if (!acc[key])
        acc[key] = { domain: s.domain, category: s.category, services: [] };
      acc[key].services.push(s);
      return acc;
    }, {});

    return Object.values(grouped);
  }

  // ── 3. Single service by ID ───────────────────────────────────
  async getServiceById(id) {
    const service = await ServiceMaster.findById(id);
    if (!service) throw new Error("Service not found");
    return service;
  }

  // ── 4. Create new service + auto-create CASH pricing ─────────
  async createService(data) {
    const service = await ServiceMaster.create(data);

    // Whenever a new service is created, automatically set up its CASH tariff
    if (data.defaultPrice) {
      await ServicePricing.create({
        serviceId: service._id,
        tariffType: "CASH",
        price: data.defaultPrice,
        discount: 0,
        finalPrice: data.defaultPrice,
      });
    }

    return service;
  }

  // ── 5. Update existing service ────────────────────────────────
  async updateService(id, data) {
    const service = await ServiceMaster.findByIdAndUpdate(
      id,
      { $set: data },
      { new: true, runValidators: true },
    );
    if (!service) throw new Error("Service not found");
    return service;
  }

  // ── 6. Soft delete (isActive: false) ──────────────────────────
  async deactivateService(id) {
    const service = await ServiceMaster.findByIdAndUpdate(
      id,
      { $set: { isActive: false } },
      { new: true },
    );
    if (!service) throw new Error("Service not found");
    return service;
  }

  // ── 7. Get all pricing records for a service ──────────────────
  async getPricingForService(serviceId) {
    return ServicePricing.find({ serviceId, isActive: true }).populate(
      "tpaId",
      "tpaName tpaCode",
    );
  }

  // ── 8. Upsert pricing for a service (add or update tariff) ────
  // Agar CASH ya specific TPA ka record pehle se hai → update
  // Nahi hai → create
  async upsertServicePricing(
    serviceId,
    { tariffType, tpaId, price, discount = 0, tpaApprovedLimit },
  ) {
    // Find existing active record for this serviceId + tariffType (+ tpaId if TPA)
    const query = { serviceId, tariffType, isActive: true };
    if (tariffType === "TPA" && tpaId) query.tpaId = tpaId;

    const finalPrice = price - (price * discount) / 100;

    let pricing = await ServicePricing.findOne(query);

    if (pricing) {
      // Update existing
      pricing.price = price;
      pricing.discount = discount;
      pricing.finalPrice = finalPrice;
      pricing.tpaApprovedLimit = tpaApprovedLimit || null;
      await pricing.save();
    } else {
      // Create new
      pricing = await ServicePricing.create({
        serviceId,
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

  // ── 9. Get effective price for a service (with TPA→CASH fallback) ──
  async getEffectivePrice(serviceId, tariffType = "CASH", tpaId = null) {
    const [pricing, service] = await Promise.all([
      ServicePricing.getPriceFor(serviceId, tariffType, tpaId),
      ServiceMaster.findById(serviceId),
    ]);

    if (!service) throw new Error("Service not found");

    return {
      service,
      pricing,
      effectivePrice: pricing ? pricing.finalPrice : service.defaultPrice,
    };
  }

  // ── 10. Seed all default services ────────────────────────────
  async seedDefaultServices() {
    return seedServices();
  }
}

module.exports = new ServiceMasterService();
