/**
 * wardOpsController.js — Ward Boy operations suite controller.
 *
 * Endpoints exposed via /api/ward-ops:
 *   Shift     start / end / break-start / break-end / current / history
 *   Equipment list / issue / return
 *   Supplies  upsert (today's row) / week
 *   CodeBlue  list / create / addResponder / close
 *   Mortuary  list / declareDeath / shiftToMortuary / handover
 *   Manager   stats — per-ward-boy KPIs (admin/nurse-in-charge view)
 */
const {
  WardShift, EquipmentLog, WardSupplyLog, CodeBlueEvent, MortuaryRecord,
} = require("../../models/Clinical/wardOpsModels");
const WardTask = require("../../models/Clinical/WardTaskModel");

const userName = (req) =>
  req.user?.fullName ||
  `${req.user?.firstName || ""} ${req.user?.lastName || ""}`.trim() ||
  "Unknown";

/* ── SHIFT ─────────────────────────────────────────────────── */
exports.shiftCurrent = async (req, res) => {
  try {
    const s = await WardShift.findOne({ user: req.user.id, endedAt: null }).lean();
    res.json({ success: true, data: s });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.shiftStart = async (req, res) => {
  try {
    // Guard against double-open shifts for the same user.
    const open = await WardShift.findOne({ user: req.user.id, endedAt: null }).lean();
    if (open) return res.status(409).json({ success: false, message: "A shift is already open. Close it first.", data: open });
    const s = await WardShift.create({
      user: req.user.id, userName: userName(req),
      ward: req.body?.ward || "",
      startedAt: new Date(),
    });
    res.status(201).json({ success: true, data: s });
  } catch (e) { res.status(400).json({ success: false, message: e.message }); }
};

exports.shiftEnd = async (req, res) => {
  try {
    const s = await WardShift.findOne({ user: req.user.id, endedAt: null });
    if (!s) return res.status(404).json({ success: false, message: "No open shift" });
    // Close any open break first.
    const lastBreak = s.breaks?.[s.breaks.length - 1];
    if (lastBreak && !lastBreak.endedAt) lastBreak.endedAt = new Date();
    s.endedAt        = new Date();
    s.shiftNotes     = req.body?.shiftNotes     || "";
    s.handoverNotes  = req.body?.handoverNotes  || "";
    await s.save();   // pre-save computes totalActiveMin
    res.json({ success: true, data: s.toObject() });
  } catch (e) { res.status(400).json({ success: false, message: e.message }); }
};

exports.shiftBreakStart = async (req, res) => {
  try {
    const s = await WardShift.findOne({ user: req.user.id, endedAt: null });
    if (!s) return res.status(404).json({ success: false, message: "No open shift" });
    const last = s.breaks?.[s.breaks.length - 1];
    if (last && !last.endedAt) return res.status(409).json({ success: false, message: "Already on break" });
    s.breaks.push({ startedAt: new Date(), reason: req.body?.reason || "" });
    await s.save();
    res.json({ success: true, data: s });
  } catch (e) { res.status(400).json({ success: false, message: e.message }); }
};

exports.shiftBreakEnd = async (req, res) => {
  try {
    const s = await WardShift.findOne({ user: req.user.id, endedAt: null });
    if (!s) return res.status(404).json({ success: false, message: "No open shift" });
    const last = s.breaks?.[s.breaks.length - 1];
    if (!last || last.endedAt) return res.status(409).json({ success: false, message: "No active break" });
    last.endedAt = new Date();
    await s.save();
    res.json({ success: true, data: s });
  } catch (e) { res.status(400).json({ success: false, message: e.message }); }
};

exports.shiftHistory = async (req, res) => {
  try {
    const filter = { user: req.user.id };
    if (req.query?.from) filter.startedAt = { ...(filter.startedAt || {}), $gte: new Date(req.query.from) };
    if (req.query?.to)   filter.startedAt = { ...(filter.startedAt || {}), $lte: new Date(req.query.to) };
    const rows = await WardShift.find(filter).sort({ startedAt: -1 }).limit(50).lean();
    res.json({ success: true, count: rows.length, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

/* ── EQUIPMENT ─────────────────────────────────────────────── */
exports.equipmentList = async (req, res) => {
  try {
    const { status, q, limit = 100 } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (q) {
      filter.$or = [
        { equipmentName: new RegExp(q, "i") },
        { category:      new RegExp(q, "i") },
        { serialNumber:  new RegExp(q, "i") },
        { issuedToName:  new RegExp(q, "i") },
      ];
    }
    const rows = await EquipmentLog.find(filter).sort({ issuedAt: -1 }).limit(Math.min(Number(limit) || 100, 500)).lean();
    res.json({ success: true, count: rows.length, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.equipmentIssue = async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.equipmentName) return res.status(400).json({ success: false, message: "equipmentName required" });
    body.issuedBy     = req.user.id;
    body.issuedByName = userName(req);
    body.issuedAt     = new Date();
    body.status       = "issued";
    const row = await EquipmentLog.create(body);
    res.status(201).json({ success: true, data: row });
  } catch (e) { res.status(400).json({ success: false, message: e.message }); }
};

exports.equipmentReturn = async (req, res) => {
  try {
    const row = await EquipmentLog.findById(req.params.id);
    if (!row) return res.status(404).json({ success: false, message: "Not found" });
    if (row.status !== "issued") return res.status(409).json({ success: false, message: `Already ${row.status}` });
    row.returnedAt         = new Date();
    row.returnedToBy       = req.user.id;
    row.returnedToName     = userName(req);
    row.conditionOnReturn  = req.body?.conditionOnReturn || "OK";
    row.status             = row.conditionOnReturn === "Lost" ? "lost" : "returned";
    if (req.body?.notes) row.notes = (row.notes ? row.notes + " · " : "") + req.body.notes;
    await row.save();
    res.json({ success: true, data: row });
  } catch (e) { res.status(400).json({ success: false, message: e.message }); }
};

/* ── SUPPLIES (Linen + BMW) ────────────────────────────────── */
exports.supplyUpsert = async (req, res) => {
  try {
    const dateStr = req.body?.date || new Date().toISOString().slice(0, 10);
    const date = new Date(`${dateStr}T00:00:00`);
    const ward = req.body?.ward || "Main";
    const update = {
      $set: {
        date, ward,
        recordedBy: req.user.id,
        recordedByName: userName(req),
        linen: req.body?.linen || {},
        bmw:   req.body?.bmw   || {},
        notes: req.body?.notes || "",
      },
    };
    const row = await WardSupplyLog.findOneAndUpdate(
      { date, ward }, update, { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();
    res.json({ success: true, data: row });
  } catch (e) { res.status(400).json({ success: false, message: e.message }); }
};

exports.supplyRecent = async (req, res) => {
  try {
    const days = Number(req.query?.days) || 7;
    const from = new Date(); from.setDate(from.getDate() - days); from.setHours(0,0,0,0);
    const rows = await WardSupplyLog.find({ date: { $gte: from } }).sort({ date: -1 }).lean();
    res.json({ success: true, count: rows.length, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

/* ── CODE BLUE ─────────────────────────────────────────────── */
exports.codeBlueList = async (req, res) => {
  try {
    const filter = {};
    if (req.query?.outcome) filter.outcome = req.query.outcome;
    const days = Number(req.query?.days) || 30;
    const from = new Date(); from.setDate(from.getDate() - days);
    filter.alertedAt = { $gte: from };
    const rows = await CodeBlueEvent.find(filter).sort({ alertedAt: -1 }).limit(200).lean();
    res.json({ success: true, count: rows.length, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.codeBlueCreate = async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.location) return res.status(400).json({ success: false, message: "location required" });
    body.alertedBy     = req.user.id;
    body.alertedByName = userName(req);
    body.alertedAt     = new Date();
    body.outcome       = "ongoing";
    const row = await CodeBlueEvent.create(body);
    res.status(201).json({ success: true, data: row });
  } catch (e) { res.status(400).json({ success: false, message: e.message }); }
};

exports.codeBlueAddResponder = async (req, res) => {
  try {
    const row = await CodeBlueEvent.findById(req.params.id);
    if (!row) return res.status(404).json({ success: false, message: "Not found" });
    const arrivedAt = new Date();
    row.responders.push({
      user: req.user.id,
      name: userName(req),
      role: req.user.role || "",
      arrivedAt,
    });
    if (row.arrivalDelaySec == null) {
      row.arrivalDelaySec = Math.round((arrivedAt - row.alertedAt) / 1000);
    }
    await row.save();
    res.json({ success: true, data: row });
  } catch (e) { res.status(400).json({ success: false, message: e.message }); }
};

exports.codeBlueClose = async (req, res) => {
  try {
    const row = await CodeBlueEvent.findByIdAndUpdate(
      req.params.id,
      {
        $set: {
          outcome:  req.body?.outcome || "resuscitated",
          notes:    req.body?.notes   || "",
          closedAt: new Date(),
        },
      },
      { new: true }
    ).lean();
    if (!row) return res.status(404).json({ success: false, message: "Not found" });
    res.json({ success: true, data: row });
  } catch (e) { res.status(400).json({ success: false, message: e.message }); }
};

/* ── MORTUARY ──────────────────────────────────────────────── */
exports.mortuaryList = async (req, res) => {
  try {
    const filter = {};
    if (req.query?.status) filter.status = req.query.status;
    const rows = await MortuaryRecord.find(filter).sort({ deathDeclaredAt: -1 }).limit(100).lean();
    res.json({ success: true, count: rows.length, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.mortuaryDeclare = async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.UHID || !body.patientName) return res.status(400).json({ success: false, message: "UHID + patientName required" });
    body.deathDeclaredAt     = body.deathDeclaredAt ? new Date(body.deathDeclaredAt) : new Date();
    body.deathDeclaredBy     = req.user.id;
    body.deathDeclaredByName = userName(req);
    body.status              = "declared";
    const row = await MortuaryRecord.create(body);
    res.status(201).json({ success: true, data: row });
  } catch (e) { res.status(400).json({ success: false, message: e.message }); }
};

exports.mortuaryShift = async (req, res) => {
  try {
    const row = await MortuaryRecord.findByIdAndUpdate(
      req.params.id,
      {
        $set: {
          shiftedToMortuaryAt: new Date(),
          shiftedBy:           req.user.id,
          shiftedByName:       userName(req),
          bodyTagId:           req.body?.bodyTagId || "",
          status:              "in-mortuary",
        },
      },
      { new: true }
    ).lean();
    if (!row) return res.status(404).json({ success: false, message: "Not found" });
    res.json({ success: true, data: row });
  } catch (e) { res.status(400).json({ success: false, message: e.message }); }
};

exports.mortuaryHandover = async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.receivedBy || !body.relationship) {
      return res.status(400).json({ success: false, message: "receivedBy + relationship required" });
    }
    const row = await MortuaryRecord.findByIdAndUpdate(
      req.params.id,
      {
        $set: {
          handoverAt:       new Date(),
          handoverBy:       req.user.id,
          handoverByName:   userName(req),
          receivedBy:       body.receivedBy,
          relationship:     body.relationship,
          receiverPhone:    body.receiverPhone || "",
          receiverIdProof:  body.receiverIdProof || "",
          receiverIdNumber: body.receiverIdNumber || "",
          vehicleDetails:   body.vehicleDetails || "",
          notes:            body.notes || "",
          status:           "handed-over",
        },
      },
      { new: true }
    ).lean();
    if (!row) return res.status(404).json({ success: false, message: "Not found" });
    res.json({ success: true, data: row });
  } catch (e) { res.status(400).json({ success: false, message: e.message }); }
};

/* ── MANAGER KPI DASHBOARD ─────────────────────────────────── */
exports.managerStats = async (req, res) => {
  try {
    const days = Number(req.query?.days) || 7;
    const from = new Date(); from.setDate(from.getDate() - days); from.setHours(0,0,0,0);

    // Per-ward-boy task completion stats over the window.
    const tasks = await WardTask.find({
      assignedTo: { $ne: null },
      completedAt: { $gte: from },
      status: "done",
    }).select("assignedTo assignedToName type acceptedAt completedAt priority").lean();

    const byUser = {};
    for (const t of tasks) {
      const uid = String(t.assignedTo);
      if (!byUser[uid]) byUser[uid] = {
        userId: uid, name: t.assignedToName || "Ward Boy",
        completed: 0, totalMinutes: 0, urgent: 0,
        byType: {},
      };
      byUser[uid].completed += 1;
      if (t.acceptedAt && t.completedAt) {
        byUser[uid].totalMinutes += (new Date(t.completedAt) - new Date(t.acceptedAt)) / 60000;
      }
      if (t.priority === "urgent") byUser[uid].urgent += 1;
      byUser[uid].byType[t.type] = (byUser[uid].byType[t.type] || 0) + 1;
    }
    const leaderboard = Object.values(byUser)
      .map(u => ({
        ...u,
        avgMinutes: u.completed > 0 ? Math.round(u.totalMinutes / u.completed) : 0,
      }))
      .sort((a, b) => b.completed - a.completed);

    // Active shifts right now
    const activeShifts = await WardShift.find({ endedAt: null })
      .select("user userName ward startedAt breaks").lean();

    // Equipment outstanding
    const equipmentOutstanding = await EquipmentLog.countDocuments({ status: "issued" });
    const equipmentOverdue = await EquipmentLog.countDocuments({
      status: "issued",
      expectedReturnAt: { $lt: new Date(), $ne: null },
    });

    // Code blue rolling
    const codeBlueLast7d = await CodeBlueEvent.find({ alertedAt: { $gte: from } })
      .select("alertedAt outcome arrivalDelaySec location").lean();

    // Mortuary pending
    const mortuaryPending = await MortuaryRecord.countDocuments({ status: { $in: ["declared", "in-mortuary"] } });

    res.json({
      success: true,
      window: { days, from: from.toISOString().slice(0,10) },
      leaderboard,
      activeShifts,
      kpis: {
        tasksDone:               tasks.length,
        activeShiftCount:        activeShifts.length,
        equipmentOutstanding,
        equipmentOverdue,
        codeBlueCount:           codeBlueLast7d.length,
        avgCodeBlueDelaySec:     codeBlueLast7d.filter(e => e.arrivalDelaySec != null).length
          ? Math.round(
              codeBlueLast7d.filter(e => e.arrivalDelaySec != null).reduce((s, e) => s + e.arrivalDelaySec, 0) /
              codeBlueLast7d.filter(e => e.arrivalDelaySec != null).length
            )
          : null,
        mortuaryPending,
      },
      codeBlueRecent: codeBlueLast7d.slice(0, 10),
    });
  } catch (e) {
    console.error("[wardOps] managerStats error:", e);
    res.status(500).json({ success: false, message: e.message });
  }
};
