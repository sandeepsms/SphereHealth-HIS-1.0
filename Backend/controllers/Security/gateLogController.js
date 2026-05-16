const GateLog = require("../../models/Security/GateLogModel");
const VisitorPass = require("../../models/VisitorPass/visitorPassModel");

const handle = (fn) => async (req, res) => {
  try { return await fn(req, res); }
  catch (e) { res.status(e.statusCode || 500).json({ success: false, message: e.message }); }
};

/* POST /api/gate-log
   Records one gate event. */
exports.create = handle(async (req, res) => {
  const b = req.body || {};
  if (!b.personName || !String(b.personName).trim()) {
    return res.status(400).json({ success: false, message: "personName is required" });
  }
  if (!["in", "out"].includes(b.direction)) {
    return res.status(400).json({ success: false, message: "direction must be 'in' or 'out'" });
  }

  // If the user passed a visitor pass number / id, denormalise pass info.
  let linked = {};
  if (b.visitorPassId) {
    const pass = await VisitorPass.findById(b.visitorPassId).lean();
    if (pass) linked = { visitorPassId: pass._id, linkedPassNumber: pass.passNumber };
  } else if (b.linkedPassNumber) {
    const pass = await VisitorPass.findOne({ passNumber: b.linkedPassNumber }).lean();
    if (pass) linked = { visitorPassId: pass._id, linkedPassNumber: pass.passNumber };
  }

  const entry = await GateLog.create({
    direction:      b.direction,
    gate:           b.gate || "Main",
    personType:     b.personType || "Visitor",
    personName:     b.personName,
    contactNumber:  b.contactNumber || "",
    idProofType:    b.idProofType || null,
    idProofNumber:  b.idProofNumber || "",
    purpose:        b.purpose || "",
    vehicleNumber:  b.vehicleNumber || "",
    ...linked,
    recordedBy:     b.recordedBy || req.user?.fullName || "Security",
    recordedById:   req.user?.id || null,
    recordedByRole: req.user?.role || "Security",
    notes:          b.notes || "",
  });
  return res.status(201).json({ success: true, data: entry });
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
  return res.json({
    success: true,
    data: rows,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
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

  return res.json({
    success: true,
    data: {
      todayIn,
      todayOut,
      // Cheap on-premises proxy: today's net delta. Not a true headcount
      // (people overnighting from yesterday aren't counted in), but it's
      // useful for "is the gate quieter than usual right now?".
      onPremisesDelta: Math.max(0, todayIn - todayOut),
    },
  });
});
