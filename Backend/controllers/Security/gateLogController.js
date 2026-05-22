/**
 * gateLogController.js — gate entry/exit register.
 *
 * R7bj-F4 hardening:
 *   • SEC-CRIT-1 / Auth fork / Mongo CRIT-9: `recordedBy` and recorded-by
 *     trio are NO LONGER trusted from body. They are derived from req.user
 *     exclusively. Pre-fix, any Security user could forge "recordedBy:
 *     Director" on a gate entry.
 *   • SEC-CRIT-3 / replay attack: when a visitor pass is linked we re-check
 *     status === "Active" AND validUntil > now BEFORE persisting the row.
 *     A spent / revoked / expired pass returns 409 INVALID_OR_EXPIRED_PASS
 *     so the attacker cannot re-use it at the gate after midnight.
 *   • Every response moved to apiEnvelope.sendOk / sendErr.
 */
const GateLog     = require("../../models/Security/GateLogModel");
const VisitorPass = require("../../models/VisitorPass/visitorPassModel");
const { sendOk, sendErr } = require("../../utils/apiEnvelope");

const handle = (fn) => async (req, res) => {
  try { return await fn(req, res); }
  catch (e) { return sendErr(res, e, e?.code, e?.statusCode); }
};

/* POST /api/gate-log
   Records one gate event. */
exports.create = handle(async (req, res) => {
  const b = req.body || {};
  const {
    direction, personType, personName, idProofType, idProofNumber,
    contactNumber, vehicleNumber, gate, linkedPassNumber, visitorPassId,
    purpose, notes,
  } = b;

  if (!personName || !String(personName).trim()) {
    return sendErr(res, "personName is required", "VALIDATION", 400);
  }
  if (!["in", "out"].includes(direction)) {
    return sendErr(res, "direction must be 'in' or 'out'", "VALIDATION", 400);
  }

  // SEC-CRIT-3 / R7bj-F4: replay protection — when a pass is linked we
  // require it to be Active + within its window. Spent passes cannot be
  // re-presented at the gate. Pre-fix, the controller would denormalise
  // a Revoked / Expired pass and persist the gate row anyway.
  let linked = {};
  if (visitorPassId) {
    const pass = await VisitorPass.findOne({
      _id: visitorPassId,
      status: "Active",
      validUntil: { $gt: new Date() },
    }).lean();
    if (!pass) {
      return sendErr(
        res,
        "Visitor pass is not active or has expired",
        "INVALID_OR_EXPIRED_PASS",
        409,
      );
    }
    linked = { visitorPassId: pass._id, linkedPassNumber: pass.passNumber };
  } else if (linkedPassNumber) {
    const pass = await VisitorPass.findOne({
      passNumber: linkedPassNumber,
      status: "Active",
      validUntil: { $gt: new Date() },
    }).lean();
    if (!pass) {
      return sendErr(
        res,
        "Visitor pass not found, not active, or expired",
        "INVALID_OR_EXPIRED_PASS",
        409,
      );
    }
    linked = { visitorPassId: pass._id, linkedPassNumber: pass.passNumber };
  }

  // R7bj-F4 / Auth fork: recorded-by trio derived ONLY from req.user.
  // We never read b.recordedBy / b.recordedById / b.recordedByRole.
  const recordedBy     = req.user?.fullName || req.user?.email || "Security";
  const recordedByName = req.user?.fullName || "";
  const recordedById   = req.user?.id || null;
  const recordedByRole = req.user?.role || "Security";

  const entry = await GateLog.create({
    direction,
    gate:           gate || "Main",
    personType:     personType || "Visitor",
    personName:     String(personName).trim(),
    contactNumber:  contactNumber || "",
    idProofType:    idProofType   || null,
    idProofNumber:  idProofNumber || "",
    purpose:        purpose || "",
    vehicleNumber:  vehicleNumber || "",
    ...linked,
    recordedAt:     new Date(),
    recordedBy,
    recordedByName,
    recordedById,
    recordedByRole,
    notes:          notes || "",
  });
  return sendOk(res, entry, null, 201);
});

/* GET /api/gate-log
   Listing — most-recent-first, paginated, optional filters. */
exports.list = handle(async (req, res) => {
  const filter = {};
  if (req.query.direction)  filter.direction  = req.query.direction;
  if (req.query.personType) filter.personType = req.query.personType;
  if (req.query.gate)       filter.gate       = req.query.gate;
  if (req.query.from || req.query.to) {
    filter.createdAt = {};
    if (req.query.from) filter.createdAt.$gte = new Date(req.query.from);
    if (req.query.to)   filter.createdAt.$lte = new Date(req.query.to);
  }
  if (req.query.q) {
    const q = new RegExp(String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [
      { personName: q }, { contactNumber: q }, { idProofNumber: q },
      { vehicleNumber: q }, { linkedPassNumber: q },
    ];
  }

  const page  = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit) || 100));
  const skip  = (page - 1) * limit;

  const [rows, total] = await Promise.all([
    GateLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    GateLog.countDocuments(filter),
  ]);
  return sendOk(res, rows, {
    count: rows.length,
    page, limit, total,
    pages: Math.ceil(total / limit) || 0,
  });
});

/* GET /api/gate-log/stats
   Snapshot for the Security dashboard: today's in / out / on-premises. */
exports.stats = handle(async (req, res) => {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [todayIn, todayOut] = await Promise.all([
    GateLog.countDocuments({ direction: "in",  createdAt: { $gte: startOfDay } }),
    GateLog.countDocuments({ direction: "out", createdAt: { $gte: startOfDay } }),
  ]);

  return sendOk(res, {
    todayIn,
    todayOut,
    // Cheap on-premises proxy: today's net delta. Not a true headcount
    // (people overnighting from yesterday aren't counted in), but it's
    // useful for "is the gate quieter than usual right now?".
    onPremisesDelta: Math.max(0, todayIn - todayOut),
  });
});
