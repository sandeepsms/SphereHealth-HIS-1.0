/**
 * housekeepingController.js — Housekeeping module API.
 *
 * Endpoints under /api/housekeeping/:
 *   Task board  list / stats / create / accept / start / complete /
 *               cancel / update
 *   Spillage    list / report / contain / clean
 *   Inventory   list / upsert / receive
 *   Checklist   today / log / history
 *   Pest        list / schedule / complete
 *   Manager     stats — aggregated KPIs for ward manager / admin
 */
const {
  CleaningTask, SpillageIncident, ChemicalInventory,
  AreaCleaningLog, PestControlSchedule,
} = require("../../models/Clinical/housekeepingModels");
const userName = require("../../utils/userName");

/* ── TASK BOARD ──────────────────────────────────────────── */
exports.taskList = async (req, res) => {
  try {
    const { status, type, priority, mine, limit = 100 } = req.query;
    const q = {};
    if (status) q.status = status;
    if (type) q.type = type;
    if (priority) q.priority = priority;
    if (mine === "true" && req.user?.id) q.assignedTo = req.user.id;
    const rows = await CleaningTask.find(q).sort({ priority: 1, requestedAt: -1 }).limit(Math.min(Number(limit) || 100, 500)).lean();
    res.json({ success: true, count: rows.length, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.taskStats = async (req, res) => {
  try {
    const today = new Date(); today.setHours(0,0,0,0);
    const myId = req.user?.id;
    const [open, assigned, inProgress, doneToday, myActive] = await Promise.all([
      CleaningTask.countDocuments({ status: "open" }),
      CleaningTask.countDocuments({ status: "assigned" }),
      CleaningTask.countDocuments({ status: "in-progress" }),
      CleaningTask.countDocuments({ status: "done", completedAt: { $gte: today } }),
      myId ? CleaningTask.countDocuments({ assignedTo: myId, status: { $in: ["assigned", "in-progress"] } }) : 0,
    ]);
    res.json({ success: true, data: { open, assigned, inProgress, doneToday, myActive } });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.taskCreate = async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.title || !body.type) return res.status(400).json({ success: false, message: "title + type required" });
    body.requestedBy     = req.user?.id;
    body.requestedByName = await userName(req);
    body.requestedByRole = req.user?.role || "";
    body.requestedAt     = new Date();
    body.status          = "open";
    const t = await CleaningTask.create(body);
    res.status(201).json({ success: true, data: t });
  } catch (e) { res.status(400).json({ success: false, message: e.message }); }
};

exports.taskAccept = async (req, res) => {
  try {
    const name = await userName(req, "Housekeeping");
    const t = await CleaningTask.findOneAndUpdate(
      { _id: req.params.id, status: "open" },
      { $set: { status: "assigned", assignedTo: req.user.id, assignedToName: name, acceptedAt: new Date() } },
      { new: true, runValidators: true }
    ).lean();
    if (!t) return res.status(409).json({ success: false, message: "Task already taken or not open." });
    res.json({ success: true, data: t });
  } catch (e) { res.status(400).json({ success: false, message: e.message }); }
};

exports.taskStart = async (req, res) => {
  try {
    const t = await CleaningTask.findOneAndUpdate(
      { _id: req.params.id, assignedTo: req.user.id, status: "assigned" },
      { $set: { status: "in-progress", startedAt: new Date() } },
      { new: true, runValidators: true }
    ).lean();
    if (!t) return res.status(409).json({ success: false, message: "Not in 'assigned' state or not yours." });
    res.json({ success: true, data: t });
  } catch (e) { res.status(400).json({ success: false, message: e.message }); }
};

exports.taskComplete = async (req, res) => {
  try {
    const t = await CleaningTask.findOneAndUpdate(
      { _id: req.params.id, assignedTo: req.user.id, status: { $in: ["assigned", "in-progress"] } },
      { $set: {
          status: "done",
          completedAt: new Date(),
          completionNotes: req.body?.completionNotes || "",
          protocolFollowed: req.body?.protocolFollowed || "",
          productsUsed: req.body?.productsUsed || [],
      } },
      { new: true, runValidators: true }
    ).lean();
    if (!t) return res.status(409).json({ success: false, message: "Task not completable or not yours." });

    // ── Bed cleaning round-trip ────────────────────────────────
    // When a discharge-clean / bed-turnover / terminal task completes
    // AND it's linked to a specific bed (bedId set), flip the bed's
    // housekeeping.state to "Idle" so the bed shows as Available + clean
    // on the Live Bed Map. Failure to update the bed is non-fatal —
    // task is already saved; we log and continue.
    if (t.bedId && ["discharge-clean", "bed-turnover", "terminal"].includes(t.type)) {
      try {
        const bedService = require("../../services/bedMgmt/bedService");
        await bedService.updateHousekeeping(t.bedId, { state: "Idle" });
      } catch (e) {
        console.error("[Housekeeping] post-complete bed update failed:", e.message);
      }
    }

    res.json({ success: true, data: t });
  } catch (e) { res.status(400).json({ success: false, message: e.message }); }
};

exports.taskCancel = async (req, res) => {
  try {
    const t = await CleaningTask.findById(req.params.id).lean();
    if (!t) return res.status(404).json({ success: false, message: "Not found" });
    if (t.status === "done") return res.status(409).json({ success: false, message: "Already completed." });
    const canCancel = String(t.requestedBy) === String(req.user?.id) || req.user?.role === "Admin";
    if (!canCancel) return res.status(403).json({ success: false, message: "Only requester or Admin can cancel." });
    const updated = await CleaningTask.findByIdAndUpdate(req.params.id,
      { $set: { status: "cancelled", cancelledAt: new Date(), cancelReason: req.body?.cancelReason || "" } },
      { new: true, runValidators: true }).lean();
    res.json({ success: true, data: updated });
  } catch (e) { res.status(400).json({ success: false, message: e.message }); }
};

/* ── SPILLAGE ───────────────────────────────────────────── */
exports.spillageList = async (req, res) => {
  try {
    const days = Number(req.query?.days) || 30;
    const from = new Date(); from.setDate(from.getDate() - days);
    const rows = await SpillageIncident.find({ reportedAt: { $gte: from } }).sort({ reportedAt: -1 }).limit(200).lean();
    res.json({ success: true, count: rows.length, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.spillageReport = async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.area || !body.type) return res.status(400).json({ success: false, message: "area + type required" });
    body.reportedBy     = req.user?.id;
    body.reportedByName = await userName(req);
    body.reportedByRole = req.user?.role || "";
    body.reportedAt     = new Date();
    body.status         = "reported";
    const row = await SpillageIncident.create(body);
    res.status(201).json({ success: true, data: row });
  } catch (e) { res.status(400).json({ success: false, message: e.message }); }
};

exports.spillageContain = async (req, res) => {
  try {
    const row = await SpillageIncident.findByIdAndUpdate(req.params.id,
      { $set: { containedAt: new Date(), status: "contained" } }, { new: true }).lean();
    if (!row) return res.status(404).json({ success: false, message: "Not found" });
    res.json({ success: true, data: row });
  } catch (e) { res.status(400).json({ success: false, message: e.message }); }
};

exports.spillageClean = async (req, res) => {
  try {
    const body = req.body || {};
    const cleanedByName = await userName(req);
    const row = await SpillageIncident.findByIdAndUpdate(req.params.id,
      { $set: {
          cleanedAt: new Date(),
          cleanedBy: req.user?.id,
          cleanedByName,
          productsUsed: body.productsUsed || [],
          protocolFollowed: body.protocolFollowed || "spillage",
          reportedToInfectionControl: !!body.reportedToInfectionControl,
          notes: body.notes || "",
          status: "cleaned",
      } }, { new: true }).lean();
    if (!row) return res.status(404).json({ success: false, message: "Not found" });
    res.json({ success: true, data: row });
  } catch (e) { res.status(400).json({ success: false, message: e.message }); }
};

/* ── INVENTORY ─────────────────────────────────────────── */
exports.inventoryList = async (req, res) => {
  try {
    const q = { isActive: true };
    if (req.query?.lowStock === "true") q.$expr = { $lte: ["$currentStock", "$reorderLevel"] };
    const rows = await ChemicalInventory.find(q).sort({ productName: 1 }).lean();
    res.json({ success: true, count: rows.length, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.inventoryUpsert = async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.productName) return res.status(400).json({ success: false, message: "productName required" });
    const row = await ChemicalInventory.findOneAndUpdate(
      { productName: body.productName },
      { $set: body },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();
    res.json({ success: true, data: row });
  } catch (e) { res.status(400).json({ success: false, message: e.message }); }
};

exports.inventoryReceive = async (req, res) => {
  // Add stock — used when a new delivery arrives.
  try {
    const qty = Number(req.body?.qty || 0);
    if (qty <= 0) return res.status(400).json({ success: false, message: "qty must be > 0" });
    const row = await ChemicalInventory.findByIdAndUpdate(req.params.id,
      { $inc: { currentStock: qty },
        $set: { lastReceivedAt: new Date(), lastReceivedQty: qty } },
      { new: true }).lean();
    if (!row) return res.status(404).json({ success: false, message: "Not found" });
    res.json({ success: true, data: row });
  } catch (e) { res.status(400).json({ success: false, message: e.message }); }
};

exports.inventoryConsume = async (req, res) => {
  try {
    const qty = Number(req.body?.qty || 0);
    if (qty <= 0) return res.status(400).json({ success: false, message: "qty must be > 0" });
    const row = await ChemicalInventory.findByIdAndUpdate(req.params.id,
      { $inc: { currentStock: -qty } },
      { new: true }).lean();
    if (!row) return res.status(404).json({ success: false, message: "Not found" });
    res.json({ success: true, data: row });
  } catch (e) { res.status(400).json({ success: false, message: e.message }); }
};

/* ── CHECKLIST ─────────────────────────────────────────── */
const DEFAULT_CHECKS = [
  { item: "Floor mopped with disinfectant", done: false },
  { item: "Walls / doors / handles wiped", done: false },
  { item: "Beds / mattresses / pillows wiped", done: false },
  { item: "Toilet / washbasin scrubbed",     done: false },
  { item: "BMW bags removed + replaced",     done: false },
  { item: "Linen changed (where applicable)", done: false },
  { item: "Dustbins emptied + relined",      done: false },
  { item: "Cobwebs / dust on fixtures",      done: false },
];

exports.checklistToday = async (req, res) => {
  try {
    const today = new Date(); today.setHours(0,0,0,0);
    const rows = await AreaCleaningLog.find({ date: today }).sort({ shift: 1, area: 1 }).lean();
    res.json({ success: true, count: rows.length, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.checklistLog = async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.area || !body.shift) return res.status(400).json({ success: false, message: "area + shift required" });
    const date = body.date ? new Date(`${body.date}T00:00:00`) : new Date();
    date.setHours(0,0,0,0);
    const checks = (body.checks && body.checks.length) ? body.checks : DEFAULT_CHECKS;
    const allDone = checks.every(c => c.done);
    const someDone = checks.some(c => c.done);
    const status = allDone ? "done" : someDone ? "partial" : "pending";
    const performedByName = await userName(req);
    const update = {
      $set: {
        date, area: body.area, shift: body.shift,
        cleaningType: body.cleaningType || "routine",
        performedBy: req.user?.id,
        performedByName,
        checks, status,
        productsUsed: body.productsUsed || [],
        protocolFollowed: body.protocolFollowed || "",
        supervisedByName: body.supervisedByName || "",
        remarks: body.remarks || "",
      },
    };
    const row = await AreaCleaningLog.findOneAndUpdate(
      { date, area: body.area, shift: body.shift },
      update,
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();
    res.json({ success: true, data: row });
  } catch (e) { res.status(400).json({ success: false, message: e.message }); }
};

exports.checklistHistory = async (req, res) => {
  try {
    const days = Number(req.query?.days) || 7;
    const from = new Date(); from.setDate(from.getDate() - days); from.setHours(0,0,0,0);
    const rows = await AreaCleaningLog.find({ date: { $gte: from } }).sort({ date: -1, shift: 1 }).limit(200).lean();
    res.json({ success: true, count: rows.length, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.checklistDefaults = (req, res) => res.json({ success: true, data: DEFAULT_CHECKS });

/* ── PEST CONTROL ─────────────────────────────────────── */
exports.pestList = async (req, res) => {
  try {
    const filter = {};
    if (req.query?.status) filter.status = req.query.status;
    const rows = await PestControlSchedule.find(filter).sort({ scheduledDate: -1 }).limit(200).lean();
    // Mark overdue inline (no DB write).
    const now = new Date();
    for (const r of rows) {
      if (r.status === "scheduled" && new Date(r.scheduledDate) < now) r.status = "overdue";
    }
    res.json({ success: true, count: rows.length, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.pestSchedule = async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.scheduledDate || !body.area) return res.status(400).json({ success: false, message: "scheduledDate + area required" });
    body.loggedBy     = req.user?.id;
    body.loggedByName = await userName(req);
    body.status       = "scheduled";
    const row = await PestControlSchedule.create(body);
    res.status(201).json({ success: true, data: row });
  } catch (e) { res.status(400).json({ success: false, message: e.message }); }
};

exports.pestComplete = async (req, res) => {
  try {
    const body = req.body || {};
    const row = await PestControlSchedule.findByIdAndUpdate(req.params.id,
      { $set: {
          performedAt: new Date(),
          performedByName: body.performedByName || "",
          productsUsed: body.productsUsed || [],
          durationHr: body.durationHr || null,
          notes: body.notes || "",
          nextScheduled: body.nextScheduled ? new Date(body.nextScheduled) : null,
          status: "completed",
      } }, { new: true }).lean();
    if (!row) return res.status(404).json({ success: false, message: "Not found" });
    res.json({ success: true, data: row });
  } catch (e) { res.status(400).json({ success: false, message: e.message }); }
};

/* ── MANAGER KPI ────────────────────────────────────── */
exports.managerStats = async (req, res) => {
  try {
    const days = Number(req.query?.days) || 7;
    const from = new Date(); from.setDate(from.getDate() - days); from.setHours(0,0,0,0);

    // Per-housekeeper task completion stats.
    const tasks = await CleaningTask.find({
      assignedTo: { $ne: null }, completedAt: { $gte: from }, status: "done",
    }).select("assignedTo assignedToName type acceptedAt completedAt priority").lean();
    const byUser = {};
    for (const t of tasks) {
      const uid = String(t.assignedTo);
      if (!byUser[uid]) byUser[uid] = {
        userId: uid, name: t.assignedToName || "Housekeeping",
        completed: 0, totalMinutes: 0, urgent: 0, byType: {},
      };
      byUser[uid].completed += 1;
      if (t.acceptedAt && t.completedAt) byUser[uid].totalMinutes += (new Date(t.completedAt) - new Date(t.acceptedAt)) / 60000;
      if (t.priority === "urgent") byUser[uid].urgent += 1;
      byUser[uid].byType[t.type] = (byUser[uid].byType[t.type] || 0) + 1;
    }
    const leaderboard = Object.values(byUser).map(u => ({
      ...u, avgMinutes: u.completed > 0 ? Math.round(u.totalMinutes / u.completed) : 0,
    })).sort((a, b) => b.completed - a.completed);

    // Inventory low stock
    const lowStock = await ChemicalInventory.find({
      isActive: true, $expr: { $lte: ["$currentStock", "$reorderLevel"] },
    }).select("productName currentStock reorderLevel unit").lean();

    // Spillage stats
    const spillageRecent = await SpillageIncident.find({ reportedAt: { $gte: from } })
      .select("reportedAt area type volumeEst status").lean();

    // Pest control overdue
    const pestOverdue = await PestControlSchedule.countDocuments({
      status: "scheduled", scheduledDate: { $lt: new Date() },
    });

    // Checklist compliance — count of partial/pending in window
    const checklistRecent = await AreaCleaningLog.find({ date: { $gte: from } })
      .select("date shift area status").lean();
    const compliant = checklistRecent.filter(r => r.status === "done").length;
    const compliancePct = checklistRecent.length > 0 ? Math.round((compliant / checklistRecent.length) * 100) : null;

    res.json({
      success: true,
      window: { days, from: from.toISOString().slice(0,10) },
      leaderboard,
      kpis: {
        tasksDone: tasks.length,
        lowStockCount: lowStock.length,
        spillageCount: spillageRecent.length,
        pestOverdue,
        checklistCompliancePct: compliancePct,
        checklistTotal: checklistRecent.length,
      },
      lowStock,
      spillageRecent: spillageRecent.slice(0, 10),
    });
  } catch (e) {
    console.error("[housekeeping] managerStats error:", e);
    res.status(500).json({ success: false, message: e.message });
  }
};
