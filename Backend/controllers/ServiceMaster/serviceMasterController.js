// controllers/serviceMasterController.js
// ═══════════════════════════════════════════════════════════════
// Controller sirf karta hai:
//   1. Request se data extract karo
//   2. Service call karo
//   3. Response bhejo
// Koi bhi business logic, DB query, ya data manipulation yahan nahi
// ═══════════════════════════════════════════════════════════════

const serviceMasterService = require("../../services/ServiceMaster/Servicemasterservice");
const ServiceMaster = require("../../models/ServiceMaster/serviceMasterModel");

// R7hr-A2: doctor-order categorisation. Each ServiceMaster row optionally
// declares which doctor-order surface it belongs to so the IPD/OPD order
// pads can call /lookup?doctorOrderCategory=Lab (etc.) instead of fishing
// through the full catalogue. The enum mirrors the schema (Agent A1).
const DOCTOR_ORDER_CATEGORIES = [
  "Medication",
  "IV_Fluid",
  "Lab",
  "Radiology",
  "Procedure",
  "BloodTransfusion",
  "Diet",
  "Oxygen",
  "Physiotherapy",
  "Activity",
  "Nursing",
  "Consultation",
];

// Returns true when the value is "absent" (null/undefined/empty string) —
// the field is optional, so these three are valid no-ops.
function _doctorOrderCategoryIsAbsent(v) {
  return v === undefined || v === null || v === "";
}

// Escape a user-supplied string for safe use inside a RegExp literal.
// Prevents the q param from injecting regex metacharacters (`.*`, `[`, etc.).
function _escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── GET /api/services ─────────────────────────────────────────
//
// R7hr-A2: optional `?doctorOrderCategory=<value>` filter. When present
// and not in the enum we 400 — silently dropping a typo'd filter would
// return the entire catalogue and look like the filter "matched" everything.
// When the filter IS set we run a controller-side find against the model
// so pagination + total counts are accurate (post-filtering a page-window
// returned by the service would under-count).
exports.getAll = async (req, res) => {
  try {
    const doctorOrderCategory = req.query.doctorOrderCategory;
    if (
      !_doctorOrderCategoryIsAbsent(doctorOrderCategory) &&
      !DOCTOR_ORDER_CATEGORIES.includes(doctorOrderCategory)
    ) {
      return res.status(400).json({
        success: false,
        message: `Invalid doctorOrderCategory. Must be one of: ${DOCTOR_ORDER_CATEGORIES.join(", ")}`,
      });
    }

    if (!_doctorOrderCategoryIsAbsent(doctorOrderCategory)) {
      // Build a query that mirrors the service-layer shape but injects
      // the new filter. Keeps the existing filter semantics (category/
      // domain/applicableTo/search/isActive/page/limit) intact.
      const {
        category,
        domain,
        applicableTo,
        isActive = "true",
        search,
        page = 1,
        limit = 100,
      } = req.query;
      const q = { doctorOrderCategory };
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
      return res.json({
        success: true,
        services,
        total,
        page: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit)),
        data: services,
      });
    }

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
//
// R7hr-A2: validate `doctorOrderCategory` against the doctor-order enum
// before the Mongo round-trip — schema-level validation also catches it
// but a controller-side 400 is friendlier than Mongoose's stack trace.
exports.create = async (req, res) => {
  try {
    const doc = req.body?.doctorOrderCategory;
    if (
      !_doctorOrderCategoryIsAbsent(doc) &&
      !DOCTOR_ORDER_CATEGORIES.includes(doc)
    ) {
      return res.status(400).json({
        success: false,
        message: `Invalid doctorOrderCategory. Must be one of: ${DOCTOR_ORDER_CATEGORIES.join(", ")}`,
      });
    }
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
    const PriceChangeRequest = require("../../models/ServiceMaster/priceChangeRequestModel");

    // R7hr-A2: validate `doctorOrderCategory` before either the price-
    // change-request branch or the direct mutation runs. Reject typos at
    // the controller boundary rather than letting them ride into the doc.
    const doc = req.body?.doctorOrderCategory;
    if (
      Object.prototype.hasOwnProperty.call(req.body || {}, "doctorOrderCategory") &&
      !_doctorOrderCategoryIsAbsent(doc) &&
      !DOCTOR_ORDER_CATEGORIES.includes(doc)
    ) {
      return res.status(400).json({
        success: false,
        message: `Invalid doctorOrderCategory. Must be one of: ${DOCTOR_ORDER_CATEGORIES.join(", ")}`,
      });
    }

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

// ── GET /api/services/lookup ──────────────────────────────────
//
// R7hr-A2: thin endpoint for doctor-order pads (IPD/OPD Rx, Lab, Imaging,
// Procedure, etc.). The full catalogue endpoint returns billing/tariff
// metadata that the order pad doesn't need and that bloats the payload —
// this one strips down to the four fields the picker actually renders.
//   ?doctorOrderCategory  REQUIRED — must match the enum
//   ?q                    OPTIONAL — case-insensitive substring on
//                                    serviceName + serviceCode
//   ?limit                OPTIONAL — default 20, capped at 50 to stop
//                                    a single autocomplete keystroke
//                                    pulling the entire catalogue
exports.lookup = async (req, res) => {
  try {
    const doctorOrderCategory = req.query.doctorOrderCategory;
    if (_doctorOrderCategoryIsAbsent(doctorOrderCategory)) {
      return res.status(400).json({
        success: false,
        message: "doctorOrderCategory query param is required",
      });
    }
    if (!DOCTOR_ORDER_CATEGORIES.includes(doctorOrderCategory)) {
      return res.status(400).json({
        success: false,
        message: `Invalid doctorOrderCategory. Must be one of: ${DOCTOR_ORDER_CATEGORIES.join(", ")}`,
      });
    }

    let limit = parseInt(req.query.limit, 10);
    if (!Number.isFinite(limit) || limit <= 0) limit = 20;
    if (limit > 50) limit = 50;

    const filter = { isActive: true, doctorOrderCategory };
    const q = (req.query.q || "").trim();
    if (q) {
      // Regex (not $text) so partial substrings work mid-string and we
      // don't need a text index on serviceCode. Escape regex meta so a
      // stray "." or "[" can't blow up the query.
      const rx = new RegExp(_escapeRegex(q), "i");
      filter.$or = [{ serviceName: rx }, { serviceCode: rx }];
    }

    const rows = await ServiceMaster.find(filter)
      .select("_id serviceCode serviceName defaultPrice doctorOrderCategory")
      .sort({ serviceName: 1 })
      .limit(limit)
      .lean();

    res.json({ success: true, count: rows.length, data: rows });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};
