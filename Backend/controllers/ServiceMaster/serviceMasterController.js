// controllers/serviceMasterController.js
// ═══════════════════════════════════════════════════════════════
// Controller sirf karta hai:
//   1. Request se data extract karo
//   2. Service call karo
//   3. Response bhejo
// Koi bhi business logic, DB query, ya data manipulation yahan nahi
// ═══════════════════════════════════════════════════════════════

const serviceMasterService = require("../../services/ServiceMaster/Servicemasterservice");

// ── GET /api/services ─────────────────────────────────────────
exports.getAll = async (req, res) => {
  try {
    const result = await serviceMasterService.getAllServices(req.query);
    res.json({ success: true, ...result, data: result.services });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ── GET /api/services/grouped ─────────────────────────────────
exports.getGrouped = async (req, res) => {
  try {
    const data = await serviceMasterService.getGroupedServices(req.query);
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ── GET /api/services/:id ─────────────────────────────────────
exports.getById = async (req, res) => {
  try {
    const data = await serviceMasterService.getServiceById(req.params.id);
    res.json({ success: true, data });
  } catch (e) {
    const status = e.message === "Service not found" ? 404 : 500;
    res.status(status).json({ success: false, message: e.message });
  }
};

// ── POST /api/services ────────────────────────────────────────
// R7bb-C / S6: forward req.user as the `actor` arg so the service-
// layer audit emit carries the operator's identity. Pre-R7bb master-
// data writes had no audit trail at all.
exports.create = async (req, res) => {
  try {
    const data = await serviceMasterService.createService(req.body, req.user);
    res.status(201).json({ success: true, data });
  } catch (e) {
    const status = e.code === 11000 ? 400 : 400;
    const message =
      e.code === 11000 ? "Service code already exists" : e.message;
    res.status(status).json({ success: false, message });
  }
};

// ── PUT /api/services/:id ─────────────────────────────────────
//
// R7bb-FIX-E-16 / D3-HIGH-3: maker-checker on price changes. Pricing
// edits ≥ ₹500 or >10% delta route through a PriceChangeRequest doc
// that needs a DIFFERENT Admin to approve. Direct mutation only for
// small low-risk corrections. The previous (sub-threshold) path stays
// open so routine tweaks aren't slowed down.
exports.update = async (req, res) => {
  try {
    const ServiceMaster = require("../../models/ServiceMaster/serviceMasterModel");
    const PriceChangeRequest = require("../../models/ServiceMaster/priceChangeRequestModel");

    // Inspect whether a price field is being changed.
    const body = req.body || {};
    const hasFlat = Object.prototype.hasOwnProperty.call(body, "defaultPrice");
    const hasTier = Object.prototype.hasOwnProperty.call(body, "tierPricing");
    if (hasFlat || hasTier) {
      const prior = await ServiceMaster.findById(req.params.id).lean();
      if (!prior) return res.status(404).json({ success: false, message: "Service not found" });
      const beforePrice = Number(prior.defaultPrice || 0);
      const afterPrice  = hasFlat ? Number(body.defaultPrice) : beforePrice;
      const delta = Math.abs(afterPrice - beforePrice);
      const deltaPercent = beforePrice > 0
        ? Math.abs((afterPrice - beforePrice) / beforePrice) * 100
        : 100;
      const NEEDS_APPROVAL = delta >= 500 || deltaPercent > 10 || hasTier;
      if (NEEDS_APPROVAL) {
        // Don't apply the change — file a request instead.
        const reqDoc = await PriceChangeRequest.create({
          serviceMaster:    prior._id,
          serviceCode:      prior.serviceCode,
          serviceName:      prior.serviceName,
          before: {
            defaultPrice: beforePrice,
            tierPricing:  prior.tierPricing || {},
          },
          after: {
            defaultPrice: afterPrice,
            tierPricing:  hasTier ? body.tierPricing : (prior.tierPricing || {}),
          },
          delta,
          deltaPercent: +deltaPercent.toFixed(2),
          reason:            String(body.reason || "").trim(),
          requestedBy:       req.user?.fullName || req.user?.employeeId || "",
          requestedById:     req.user?._id || req.user?.id || null,
          requestedByRole:   req.user?.role || "",
          status:            "PENDING_APPROVAL",
        });
        return res.status(202).json({
          success: true,
          code:    "PRICE_CHANGE_PENDING_APPROVAL",
          message: `Price change Δ ₹${delta.toFixed(2)} (${deltaPercent.toFixed(1)}%) requires a second Admin approval.`,
          data:    reqDoc,
        });
      }
    }

    const data = await serviceMasterService.updateService(
      req.params.id,
      req.body,
      req.user,
    );
    res.json({ success: true, data });
  } catch (e) {
    const status = e.message === "Service not found" ? 404 : 400;
    res.status(status).json({ success: false, message: e.message });
  }
};

// R7bb-FIX-E-16 / D3-HIGH-3: GET /api/services/price-change-requests
exports.listPriceChangeRequests = async (req, res) => {
  try {
    const PriceChangeRequest = require("../../models/ServiceMaster/priceChangeRequestModel");
    const q = {};
    if (req.query.status) q.status = req.query.status;
    if (req.query.serviceMaster) q.serviceMaster = req.query.serviceMaster;
    const rows = await PriceChangeRequest.find(q).sort({ createdAt: -1 }).limit(200).lean();
    res.json({ success: true, count: rows.length, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// R7bb-FIX-E-16: POST /api/services/price-change-requests/:id/approve
exports.approvePriceChangeRequest = async (req, res) => {
  try {
    const PriceChangeRequest = require("../../models/ServiceMaster/priceChangeRequestModel");
    const reqDoc = await PriceChangeRequest.findById(req.params.id);
    if (!reqDoc) return res.status(404).json({ success: false, message: "Request not found" });
    if (reqDoc.status !== "PENDING_APPROVAL") {
      return res.status(409).json({ success: false, message: `Request is ${reqDoc.status}` });
    }
    if (String(reqDoc.requestedById) === String(req.user?._id || req.user?.id)) {
      return res.status(409).json({
        success: false, code: "SAME_ACTOR",
        message: "SAME_ACTOR — price change must be approved by a different Admin than the requester",
      });
    }
    // Apply the change.
    const patch = { defaultPrice: reqDoc.after.defaultPrice };
    if (reqDoc.after.tierPricing && Object.keys(reqDoc.after.tierPricing).length) {
      patch.tierPricing = reqDoc.after.tierPricing;
    }
    const data = await serviceMasterService.updateService(reqDoc.serviceMaster, patch, req.user);
    reqDoc.status         = "APPROVED";
    reqDoc.approvedBy     = req.user?.fullName || req.user?.employeeId || "";
    reqDoc.approvedById   = req.user?._id || req.user?.id || null;
    reqDoc.approvedByRole = req.user?.role || "";
    reqDoc.approvedAt     = new Date();
    await reqDoc.save();
    res.json({ success: true, data: { request: reqDoc, service: data } });
  } catch (e) { res.status(400).json({ success: false, message: e.message }); }
};

// POST /api/services/price-change-requests/:id/reject  { reason }
exports.rejectPriceChangeRequest = async (req, res) => {
  try {
    const PriceChangeRequest = require("../../models/ServiceMaster/priceChangeRequestModel");
    const reqDoc = await PriceChangeRequest.findById(req.params.id);
    if (!reqDoc) return res.status(404).json({ success: false, message: "Request not found" });
    if (reqDoc.status !== "PENDING_APPROVAL") {
      return res.status(409).json({ success: false, message: `Request is ${reqDoc.status}` });
    }
    reqDoc.status          = "REJECTED";
    reqDoc.rejectionReason = String(req.body?.reason || "").trim();
    reqDoc.approvedBy      = req.user?.fullName || req.user?.employeeId || "";
    reqDoc.approvedById    = req.user?._id || req.user?.id || null;
    reqDoc.approvedAt      = new Date();
    await reqDoc.save();
    res.json({ success: true, data: reqDoc });
  } catch (e) { res.status(400).json({ success: false, message: e.message }); }
};

// ── DELETE /api/services/:id ──────────────────────────────────
exports.remove = async (req, res) => {
  try {
    await serviceMasterService.deactivateService(req.params.id, req.user);
    res.json({ success: true, message: "Service deactivated" });
  } catch (e) {
    const status = e.message === "Service not found" ? 404 : 500;
    res.status(status).json({ success: false, message: e.message });
  }
};

// ── GET /api/services/:id/pricing ────────────────────────────
exports.getPricing = async (req, res) => {
  try {
    const data = await serviceMasterService.getPricingForService(req.params.id);
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ── POST /api/services/:id/pricing ───────────────────────────
exports.setPricing = async (req, res) => {
  try {
    const data = await serviceMasterService.upsertServicePricing(
      req.params.id,
      req.body,
      req.user,
    );
    res.json({ success: true, data });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
};

// ── POST /api/services/seed ───────────────────────────────────
exports.seed = async (req, res) => {
  try {
    const data = await serviceMasterService.seedDefaultServices();
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};
