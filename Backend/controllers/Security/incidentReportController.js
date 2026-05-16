const IncidentReport = require("../../models/Security/IncidentReportModel");
const { nextSequence } = require("../../utils/counter");

const handle = (fn) => async (req, res) => {
  try { return await fn(req, res); }
  catch (e) { res.status(e.statusCode || 500).json({ success: false, message: e.message }); }
};

async function nextIncidentNumber() {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const seq = await nextSequence(`incident:${dateStr}`);
  return `IR-${dateStr}-${String(seq).padStart(4, "0")}`;
}

/* POST /api/incidents */
exports.create = handle(async (req, res) => {
  const b = req.body || {};
  const missing = ["type", "location", "description"].filter((k) => !b[k] || !String(b[k]).trim());
  if (missing.length) {
    return res.status(400).json({
      success: false,
      message: `Missing required field(s): ${missing.join(", ")}`,
    });
  }

  const doc = await IncidentReport.create({
    incidentNumber: await nextIncidentNumber(),
    type:            b.type,
    severity:        b.severity || "Medium",
    location:        b.location,
    occurredAt:      b.occurredAt ? new Date(b.occurredAt) : new Date(),
    description:     b.description,
    personsInvolved: Array.isArray(b.personsInvolved) ? b.personsInvolved : [],
    actionTaken:     b.actionTaken || "",
    status:          b.status || "Open",
    escalatedTo:     b.escalatedTo || "",
    recordedBy:      b.recordedBy || req.user?.fullName || "Security",
    recordedById:    req.user?.id || null,
    recordedByRole:  req.user?.role || "Security",
    attachments:     Array.isArray(b.attachments) ? b.attachments : [],
  });
  return res.status(201).json({ success: true, data: doc });
});

/* GET /api/incidents */
exports.list = handle(async (req, res) => {
  const filter = {};
  if (req.query.status)   filter.status   = req.query.status;
  if (req.query.type)     filter.type     = req.query.type;
  if (req.query.severity) filter.severity = req.query.severity;
  if (req.query.from || req.query.to) {
    filter.occurredAt = {};
    if (req.query.from) filter.occurredAt.$gte = new Date(req.query.from);
    if (req.query.to)   filter.occurredAt.$lte = new Date(req.query.to);
  }
  if (req.query.q) {
    const q = new RegExp(String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [
      { incidentNumber: q }, { location: q }, { description: q },
      { recordedBy: q }, { actionTaken: q },
    ];
  }

  const page  = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit) || 50));
  const skip  = (page - 1) * limit;

  const [rows, total] = await Promise.all([
    IncidentReport.find(filter).sort({ occurredAt: -1, createdAt: -1 }).skip(skip).limit(limit).lean(),
    IncidentReport.countDocuments(filter),
  ]);
  return res.json({
    success: true,
    data: rows,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
});

/* GET /api/incidents/:id */
exports.get = handle(async (req, res) => {
  const doc = await IncidentReport.findById(req.params.id).lean();
  if (!doc) return res.status(404).json({ success: false, message: "Incident not found" });
  return res.json({ success: true, data: doc });
});

/* PATCH /api/incidents/:id/status
   Body: { status, resolvedBy?, escalatedTo?, actionTaken? } */
exports.updateStatus = handle(async (req, res) => {
  const VALID = ["Open", "Investigating", "Resolved", "Escalated", "Closed"];
  const next = req.body?.status;
  if (!VALID.includes(next)) {
    return res.status(400).json({ success: false, message: `status must be one of: ${VALID.join(", ")}` });
  }
  const doc = await IncidentReport.findById(req.params.id);
  if (!doc) return res.status(404).json({ success: false, message: "Incident not found" });

  doc.status = next;
  if (next === "Resolved" || next === "Closed") {
    doc.resolvedAt = new Date();
    doc.resolvedBy = req.body?.resolvedBy || req.user?.fullName || doc.resolvedBy;
  }
  if (next === "Escalated" && req.body?.escalatedTo) doc.escalatedTo = req.body.escalatedTo;
  if (req.body?.actionTaken) doc.actionTaken = req.body.actionTaken;

  await doc.save();
  return res.json({ success: true, data: doc });
});

/* GET /api/incidents/stats */
exports.stats = handle(async (req, res) => {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const start30d = new Date();
  start30d.setDate(start30d.getDate() - 30);

  const [openCount, todayCount, criticalOpen, last30d] = await Promise.all([
    IncidentReport.countDocuments({ status: { $in: ["Open", "Investigating", "Escalated"] } }),
    IncidentReport.countDocuments({ createdAt: { $gte: startOfDay } }),
    IncidentReport.countDocuments({ status: { $in: ["Open", "Investigating", "Escalated"] }, severity: "Critical" }),
    IncidentReport.countDocuments({ createdAt: { $gte: start30d } }),
  ]);

  return res.json({
    success: true,
    data: { openCount, todayCount, criticalOpen, last30d },
  });
});
