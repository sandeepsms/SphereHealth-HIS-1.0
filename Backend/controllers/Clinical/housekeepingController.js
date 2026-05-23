/**
 * housekeepingController.js — Housekeeping module API.
 *
 * R7bj-F4 hardening:
 *   • Replaced every `req.body` spread on writes with per-endpoint
 *     allow-lists (Mongo CRIT-2 / HK-CRIT-1).
 *   • Spillage contain / clean now enforce state-machine guards
 *     (HK-CRIT-2 — was a missing predicate that let any actor jump a
 *     reported spill straight to "cleaned", forging infection-control
 *     trail).
 *   • inventoryConsume atomic via findOneAndUpdate with currentStock-gte
 *     predicate → no negative stock under concurrent writes (HIGH-2).
 *   • inventoryUpsert NEVER touches currentStock — receive / consume are
 *     the only paths to mutate the running total.
 *   • managerStats: 5 sequential awaits collapsed into one Promise.all
 *     and the response normalised to apiEnvelope.
 *   • Every endpoint responds via sendOk / sendErr.
 *
 * Endpoints under /api/housekeeping/:
 *   Task board  list / stats / create / accept / start / complete /
 *               cancel / update
 *   Spillage    list / report / contain / clean
 *   Inventory   list / upsert / receive / consume
 *   Checklist   today / log / history
 *   Pest        list / schedule / complete
 *   Manager     stats — aggregated KPIs for ward manager / admin
 */
const {
  CleaningTask, SpillageIncident, ChemicalInventory,
  AreaCleaningLog, PestControlSchedule,
} = require("../../models/Clinical/housekeepingModels");
const userName = require("../../utils/userName");
const { sendOk, sendErr } = require("../../utils/apiEnvelope");

/* ── TASK BOARD ──────────────────────────────────────────── */
exports.taskList = async (req, res) => {
  try {
    const { status, type, priority, mine, limit = 100 } = req.query;
    const q = {};
    if (status) q.status = status;
    if (type) q.type = type;
    if (priority) q.priority = priority;

    // R7bj-F4: IDOR scope — Housekeeping staff only see their own
    // assignments; Admin / Supervisor / Nurse roles see all.
    const role = req.user?.role || "";
    const myId = req.user?.id;
    const PRIVILEGED = ["Admin", "Doctor", "Nurse", "Receptionist"];
    if (!PRIVILEGED.includes(role) && myId) {
      q.assignedTo = myId;
    } else if (mine === "true" && myId) {
      q.assignedTo = myId;
    }

    const rows = await CleaningTask.find(q).sort({ priority: 1, requestedAt: -1 }).limit(Math.min(Number(limit) || 100, 500)).lean();
    return sendOk(res, rows, { count: rows.length });
  } catch (e) { return sendErr(res, e); }
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
    return sendOk(res, { open, assigned, inProgress, doneToday, myActive });
  } catch (e) { return sendErr(res, e); }
};

exports.taskCreate = async (req, res) => {
  try {
    const b = req.body || {};
    const {
      title, description, type, priority,
      ward, area, roomNumber, bedNumber, bedId, admissionId,
      UHID, patientName,
    } = b;
    if (!title || !type) return sendErr(res, "title + type required", "VALIDATION", 400);
    const doc = {
      title:        String(title).trim(),
      description:  description ? String(description).trim() : "",
      type,
      priority:     priority || "normal",
      ward:         ward       || "",
      area:         area       || "",
      roomNumber:   roomNumber || "",
      bedNumber:    bedNumber  || "",
      bedId:        bedId       || undefined,
      admissionId:  admissionId || undefined,
      UHID:         UHID        || "",
      patientName:  patientName || "",
      // Server-stamped actor + time + status.
      requestedBy:     req.user?.id,
      requestedByName: await userName(req),
      requestedByRole: req.user?.role || "",
      requestedAt:     new Date(),
      status:          "open",
    };
    const t = await CleaningTask.create(doc);
    return sendOk(res, t, null, 201);
  } catch (e) { return sendErr(res, e, null, 400); }
};

exports.taskAccept = async (req, res) => {
  try {
    const name = await userName(req, "Housekeeping");
    const t = await CleaningTask.findOneAndUpdate(
      { _id: req.params.id, status: "open" },
      { $set: { status: "assigned", assignedTo: req.user.id, assignedToName: name, acceptedAt: new Date() } },
      { new: true, runValidators: true }
    ).lean();
    if (!t) return sendErr(res, "Task already taken or not open.", "ILLEGAL_TRANSITION", 409);
    return sendOk(res, t);
  } catch (e) { return sendErr(res, e, null, 400); }
};

exports.taskStart = async (req, res) => {
  try {
    const t = await CleaningTask.findOneAndUpdate(
      { _id: req.params.id, assignedTo: req.user.id, status: "assigned" },
      { $set: { status: "in-progress", startedAt: new Date() } },
      { new: true, runValidators: true }
    ).lean();
    if (!t) return sendErr(res, "Not in 'assigned' state or not yours.", "ILLEGAL_TRANSITION", 409);
    return sendOk(res, t);
  } catch (e) { return sendErr(res, e, null, 400); }
};

exports.taskComplete = async (req, res) => {
  try {
    const b = req.body || {};
    const completionNotes  = typeof b.completionNotes  === "string" ? b.completionNotes  : "";
    const protocolFollowed = typeof b.protocolFollowed === "string" ? b.protocolFollowed : "";
    const productsUsed     = Array.isArray(b.productsUsed) ? b.productsUsed.filter(x => typeof x === "string") : [];

    const t = await CleaningTask.findOneAndUpdate(
      { _id: req.params.id, assignedTo: req.user.id, status: { $in: ["assigned", "in-progress"] } },
      { $set: {
          status: "done",
          completedAt: new Date(),
          completionNotes,
          protocolFollowed,
          productsUsed,
      } },
      { new: true, runValidators: true }
    ).lean();
    if (!t) return sendErr(res, "Task not completable or not yours.", "ILLEGAL_TRANSITION", 409);

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

    return sendOk(res, t);
  } catch (e) { return sendErr(res, e, null, 400); }
};

exports.taskCancel = async (req, res) => {
  try {
    const t = await CleaningTask.findById(req.params.id).lean();
    if (!t) return sendErr(res, "Not found", "NOT_FOUND", 404);
    if (t.status === "done") return sendErr(res, "Already completed.", "ILLEGAL_TRANSITION", 409);
    const canCancel = String(t.requestedBy) === String(req.user?.id) || req.user?.role === "Admin";
    if (!canCancel) return sendErr(res, "Only requester or Admin can cancel.", "FORBIDDEN", 403);
    const reason = typeof req.body?.cancelReason === "string" ? req.body.cancelReason : "";
    const updated = await CleaningTask.findByIdAndUpdate(req.params.id,
      { $set: { status: "cancelled", cancelledAt: new Date(), cancelReason: reason } },
      { new: true, runValidators: true }).lean();
    return sendOk(res, updated);
  } catch (e) { return sendErr(res, e, null, 400); }
};

/* ── SPILLAGE ─────────────────────────────────────────────
   R7bj-F4 HK-CRIT-2: contain / clean now have explicit state guards
   so the trail goes reported → contained → cleaned in order. Without
   this an attacker can $set status=cleaned on a freshly-reported spill
   bypassing infection-control evidence. */
exports.spillageList = async (req, res) => {
  try {
    const days = Number(req.query?.days) || 30;
    const from = new Date(); from.setDate(from.getDate() - days);
    const rows = await SpillageIncident.find({ reportedAt: { $gte: from } }).sort({ reportedAt: -1 }).limit(200).lean();
    return sendOk(res, rows, { count: rows.length });
  } catch (e) { return sendErr(res, e); }
};

exports.spillageReport = async (req, res) => {
  try {
    const b = req.body || {};
    const {
      area, location, roomNumber, bedNumber,
      type, volumeEst, patientUHID, notes,
    } = b;
    if (!area || !type) return sendErr(res, "area + type required", "VALIDATION", 400);

    const ALLOWED_TYPES = ["blood", "body-fluid", "chemical", "vomit", "urine", "stool", "other"];
    if (!ALLOWED_TYPES.includes(type)) {
      return sendErr(res, `type must be one of: ${ALLOWED_TYPES.join(", ")}`, "VALIDATION", 400);
    }

    const doc = {
      area:        String(area).trim(),
      location:    location  || "",
      roomNumber:  roomNumber || "",
      bedNumber:   bedNumber  || "",
      type,
      volumeEst:   ["small","medium","large"].includes(volumeEst) ? volumeEst : "small",
      patientUHID: patientUHID || "",
      notes:       notes       || "",
      // Server-stamped actor + time + status.
      reportedBy:     req.user?.id,
      reportedByName: await userName(req),
      reportedByRole: req.user?.role || "",
      reportedAt:     new Date(),
      status:         "reported",
    };
    const row = await SpillageIncident.create(doc);
    return sendOk(res, row, null, 201);
  } catch (e) { return sendErr(res, e, null, 400); }
};

exports.spillageContain = async (req, res) => {
  try {
    // R7bj-F4: state guard — only "reported" spills can be contained.
    const row = await SpillageIncident.findOneAndUpdate(
      { _id: req.params.id, status: "reported" },
      { $set: { containedAt: new Date(), status: "contained" } },
      { new: true }
    ).lean();
    if (!row) {
      const exists = await SpillageIncident.findById(req.params.id).select("status").lean();
      if (!exists) return sendErr(res, "Not found", "NOT_FOUND", 404);
      return sendErr(res, `Spill already ${exists.status}; only "reported" can be contained.`, "ILLEGAL_TRANSITION", 409);
    }
    return sendOk(res, row);
  } catch (e) { return sendErr(res, e, null, 400); }
};

exports.spillageClean = async (req, res) => {
  try {
    const b = req.body || {};
    const productsUsed     = Array.isArray(b.productsUsed) ? b.productsUsed.filter(x => typeof x === "string") : [];
    const notes            = typeof b.notes === "string" ? b.notes : "";
    const reportedToInfectionControl = !!b.reportedToInfectionControl;
    const cleanedByName = await userName(req);
    // R7bj-F4: state guard — only "contained" spills can be cleaned.
    const row = await SpillageIncident.findOneAndUpdate(
      { _id: req.params.id, status: "contained" },
      { $set: {
          cleanedAt: new Date(),
          cleanedBy: req.user?.id,
          cleanedByName,
          productsUsed,
          protocolFollowed: "spillage",
          reportedToInfectionControl,
          notes,
          status: "cleaned",
      } },
      { new: true }
    ).lean();
    if (!row) {
      const exists = await SpillageIncident.findById(req.params.id).select("status").lean();
      if (!exists) return sendErr(res, "Not found", "NOT_FOUND", 404);
      return sendErr(res, `Spill state is "${exists.status}"; must be "contained" before clean.`, "ILLEGAL_TRANSITION", 409);
    }
    return sendOk(res, row);
  } catch (e) { return sendErr(res, e, null, 400); }
};

/* ── INVENTORY ─────────────────────────────────────────── */
exports.inventoryList = async (req, res) => {
  try {
    const q = { isActive: true };
    if (req.query?.lowStock === "true") q.$expr = { $lte: ["$currentStock", "$reorderLevel"] };
    const rows = await ChemicalInventory.find(q).sort({ productName: 1 }).lean();
    return sendOk(res, rows, { count: rows.length });
  } catch (e) { return sendErr(res, e); }
};

exports.inventoryUpsert = async (req, res) => {
  try {
    const b = req.body || {};
    const { productName, category, unit, reorderLevel, vendor, notes, isActive } = b;
    if (!productName) return sendErr(res, "productName required", "VALIDATION", 400);

    // R7bj-F4: explicit allow-list. currentStock is NOT here — receive /
    // consume own that field. An upsert that set currentStock would let
    // the caller forge an inventory deposit without a receive ledger.
    const $set = {
      productName: String(productName).trim(),
    };
    if (category !== undefined)     $set.category     = category;
    if (unit !== undefined)         $set.unit         = unit || "L";
    if (reorderLevel !== undefined) $set.reorderLevel = Number(reorderLevel) || 0;
    if (vendor !== undefined)       $set.vendor       = vendor || "";
    if (notes !== undefined)        $set.notes        = notes || "";
    if (isActive !== undefined)     $set.isActive     = !!isActive;

    const row = await ChemicalInventory.findOneAndUpdate(
      { productName: $set.productName },
      { $set, $setOnInsert: { currentStock: 0 } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();
    return sendOk(res, row);
  } catch (e) { return sendErr(res, e, null, 400); }
};

exports.inventoryReceive = async (req, res) => {
  // Add stock — used when a new delivery arrives.
  try {
    const qty = Number(req.body?.qty || 0);
    if (qty <= 0) return sendErr(res, "qty must be > 0", "VALIDATION", 400);
    const row = await ChemicalInventory.findByIdAndUpdate(req.params.id,
      { $inc: { currentStock: qty },
        $set: { lastReceivedAt: new Date(), lastReceivedQty: qty } },
      { new: true }).lean();
    if (!row) return sendErr(res, "Not found", "NOT_FOUND", 404);
    return sendOk(res, row);
  } catch (e) { return sendErr(res, e, null, 400); }
};

exports.inventoryConsume = async (req, res) => {
  try {
    const qty = Number(req.body?.qty || 0);
    if (qty <= 0) return sendErr(res, "qty must be > 0", "VALIDATION", 400);
    // R7bj-F4 HIGH-2: atomic check-and-decrement so concurrent consume
    // calls cannot both succeed and push stock negative. Null result
    // ⇒ either not-found OR insufficient stock; we differentiate below.
    const row = await ChemicalInventory.findOneAndUpdate(
      { _id: req.params.id, currentStock: { $gte: qty } },
      { $inc: { currentStock: -qty } },
      { new: true }
    ).lean();
    if (!row) {
      const exists = await ChemicalInventory.findById(req.params.id).select("currentStock productName").lean();
      if (!exists) return sendErr(res, "Not found", "NOT_FOUND", 404);
      return sendErr(
        res,
        `Insufficient stock — ${exists.productName} has ${exists.currentStock}, need ${qty}`,
        "INSUFFICIENT_STOCK",
        409,
      );
    }
    return sendOk(res, row);
  } catch (e) { return sendErr(res, e, null, 400); }
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
    return sendOk(res, rows, { count: rows.length });
  } catch (e) { return sendErr(res, e); }
};

exports.checklistLog = async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.area || !b.shift) return sendErr(res, "area + shift required", "VALIDATION", 400);
    const date = b.date ? new Date(`${b.date}T00:00:00`) : new Date();
    date.setHours(0,0,0,0);
    const rawChecks = Array.isArray(b.checks) && b.checks.length ? b.checks : DEFAULT_CHECKS;
    const checks = rawChecks.map(c => ({
      item: String(c?.item || "").trim(),
      done: !!c?.done,
      notes: typeof c?.notes === "string" ? c.notes : "",
    })).filter(c => c.item);
    const allDone  = checks.every(c => c.done);
    const someDone = checks.some(c => c.done);
    const status = allDone ? "done" : someDone ? "partial" : "pending";
    const performedByName = await userName(req);
    const normalisedArea = String(b.area).trim();
    const update = {
      $set: {
        date,
        area: normalisedArea,
        shift: b.shift,
        cleaningType:     ["routine","terminal","spot"].includes(b.cleaningType) ? b.cleaningType : "routine",
        performedBy:      req.user?.id,
        performedByName,
        checks,
        status,
        productsUsed:     Array.isArray(b.productsUsed) ? b.productsUsed.filter(x => typeof x === "string") : [],
        protocolFollowed: typeof b.protocolFollowed === "string" ? b.protocolFollowed : "",
        supervisedByName: typeof b.supervisedByName === "string" ? b.supervisedByName : "",
        remarks:          typeof b.remarks === "string" ? b.remarks : "",
      },
    };
    const row = await AreaCleaningLog.findOneAndUpdate(
      { date, area: normalisedArea, shift: b.shift },
      update,
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();
    return sendOk(res, row);
  } catch (e) { return sendErr(res, e, null, 400); }
};

exports.checklistHistory = async (req, res) => {
  try {
    const days = Number(req.query?.days) || 7;
    const from = new Date(); from.setDate(from.getDate() - days); from.setHours(0,0,0,0);
    const rows = await AreaCleaningLog.find({ date: { $gte: from } }).sort({ date: -1, shift: 1 }).limit(200).lean();
    return sendOk(res, rows, { count: rows.length });
  } catch (e) { return sendErr(res, e); }
};

exports.checklistDefaults = (req, res) => sendOk(res, DEFAULT_CHECKS);

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
    return sendOk(res, rows, { count: rows.length });
  } catch (e) { return sendErr(res, e); }
};

exports.pestSchedule = async (req, res) => {
  try {
    const b = req.body || {};
    const {
      scheduledDate, area, vendor, treatmentType,
      productsUsed, durationHr, nextScheduled, notes,
    } = b;
    if (!scheduledDate || !area) return sendErr(res, "scheduledDate + area required", "VALIDATION", 400);
    const doc = {
      scheduledDate: new Date(scheduledDate),
      area:          String(area).trim(),
      vendor:        vendor || "",
      treatmentType: ["cockroach","rodent","mosquito","fumigation","termite","general","other"].includes(treatmentType)
        ? treatmentType : "general",
      productsUsed:  Array.isArray(productsUsed) ? productsUsed.filter(x => typeof x === "string") : [],
      durationHr:    durationHr != null ? Number(durationHr) : null,
      nextScheduled: nextScheduled ? new Date(nextScheduled) : null,
      notes:         notes || "",
      // Server-stamped logger + status.
      loggedBy:      req.user?.id,
      loggedByName:  await userName(req),
      status:        "scheduled",
    };
    const row = await PestControlSchedule.create(doc);
    return sendOk(res, row, null, 201);
  } catch (e) { return sendErr(res, e, null, 400); }
};

exports.pestComplete = async (req, res) => {
  try {
    const b = req.body || {};
    const $set = {
      performedAt:     new Date(),
      performedByName: typeof b.performedByName === "string" ? b.performedByName : "",
      productsUsed:    Array.isArray(b.productsUsed) ? b.productsUsed.filter(x => typeof x === "string") : [],
      durationHr:      b.durationHr != null ? Number(b.durationHr) : null,
      notes:           typeof b.notes === "string" ? b.notes : "",
      nextScheduled:   b.nextScheduled ? new Date(b.nextScheduled) : null,
      status:          "completed",
    };
    const row = await PestControlSchedule.findByIdAndUpdate(req.params.id,
      { $set }, { new: true }).lean();
    if (!row) return sendErr(res, "Not found", "NOT_FOUND", 404);
    return sendOk(res, row);
  } catch (e) { return sendErr(res, e, null, 400); }
};

/* ── MANAGER KPI ──────────────────────────────────────
   R7bj-F4 / API 3-CRIT: 5 sequential awaits collapsed into one
   Promise.all and the response normalised under {data}. */
exports.managerStats = async (req, res) => {
  try {
    const days = Number(req.query?.days) || 7;
    const from = new Date(); from.setDate(from.getDate() - days); from.setHours(0,0,0,0);
    const now  = new Date();

    const [tasks, lowStock, spillageRecent, pestOverdue, checklistRecent] = await Promise.all([
      CleaningTask.find({
        assignedTo: { $ne: null }, completedAt: { $gte: from }, status: "done",
      }).select("assignedTo assignedToName type acceptedAt completedAt priority").lean(),
      ChemicalInventory.find({
        isActive: true, $expr: { $lte: ["$currentStock", "$reorderLevel"] },
      }).select("productName currentStock reorderLevel unit").lean(),
      SpillageIncident.find({ reportedAt: { $gte: from } })
        .select("reportedAt area type volumeEst status").lean(),
      PestControlSchedule.countDocuments({
        status: "scheduled", scheduledDate: { $lt: now },
      }),
      AreaCleaningLog.find({ date: { $gte: from } })
        .select("date shift area status").lean(),
    ]);

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

    const compliant = checklistRecent.filter(r => r.status === "done").length;
    const compliancePct = checklistRecent.length > 0 ? Math.round((compliant / checklistRecent.length) * 100) : null;

    return sendOk(res, {
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
    return sendErr(res, e);
  }
};
