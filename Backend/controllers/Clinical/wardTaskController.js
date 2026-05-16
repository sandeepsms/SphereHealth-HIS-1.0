/**
 * wardTaskController.js — Ward Boy task board.
 *
 * Surface:
 *   GET    /ward-tasks                  list (filterable)
 *   GET    /ward-tasks/stats            counts for badges
 *   POST   /ward-tasks                  create (any clinical role)
 *   PATCH  /ward-tasks/:id/accept       Ward Boy claims an open task
 *   PATCH  /ward-tasks/:id/start        mark "in-progress"
 *   PATCH  /ward-tasks/:id/complete     mark "done" + completion notes
 *   PATCH  /ward-tasks/:id/cancel       requester / admin can void
 *   PATCH  /ward-tasks/:id              free-form edit (priority, notes)
 *
 * RBAC:
 *   • read:    ward.read   — Nurse, Doctor, Receptionist, Ward Boy, Admin
 *   • create:  ward.create — Nurse, Doctor, Receptionist, Admin
 *   • fulfill: ward.fulfill— Ward Boy, Admin (accept/start/complete)
 *   • cancel:  open to requester OR Admin (controller-side check)
 */
const WardTask = require("../../models/Clinical/WardTaskModel");
const resolveUserName = require("../../utils/userName");

/* ── LIST ────────────────────────────────────────────────────── */
exports.list = async (req, res) => {
  try {
    const { status, assignedTo, type, priority, UHID, mine, limit = 100 } = req.query;
    const q = {};
    if (status)     q.status = status;
    if (type)       q.type = type;
    if (priority)   q.priority = priority;
    if (UHID)       q.UHID = UHID;
    if (assignedTo) q.assignedTo = assignedTo;
    // Convenience flag: ?mine=true returns tasks the current user owns.
    if (mine === "true" && req.user?.id) q.assignedTo = req.user.id;
    const rows = await WardTask.find(q)
      .sort({ priority: 1, requestedAt: -1 })
      .limit(Math.min(Number(limit) || 100, 500))
      .lean();
    res.json({ success: true, count: rows.length, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

/* ── STATS — quick counts for KPI / sidebar badges ───────────── */
exports.stats = async (req, res) => {
  try {
    const today = new Date(); today.setHours(0,0,0,0);
    const myId = req.user?.id;
    const [openCount, assignedCount, inProgressCount, doneToday, myActive] = await Promise.all([
      WardTask.countDocuments({ status: "open" }),
      WardTask.countDocuments({ status: "assigned" }),
      WardTask.countDocuments({ status: "in-progress" }),
      WardTask.countDocuments({ status: "done", completedAt: { $gte: today } }),
      myId ? WardTask.countDocuments({ assignedTo: myId, status: { $in: ["assigned", "in-progress"] } }) : 0,
    ]);
    res.json({
      success: true,
      data: {
        open: openCount,                       // unclaimed
        assigned: assignedCount,               // claimed but not started
        inProgress: inProgressCount,
        doneToday,                             // completed today (all ward boys)
        myActive,                              // assigned to me + in-progress
      },
    });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

/* ── CREATE ──────────────────────────────────────────────────── */
exports.create = async (req, res) => {
  try {
    const body = req.body || {};
    body.requestedBy     = req.user?.id;
    body.requestedByName = await resolveUserName(req);
    body.requestedByRole = req.user?.role || "";
    body.requestedAt     = new Date();
    body.status          = "open";
    if (!body.title || !body.type) {
      return res.status(400).json({ success: false, message: "title and type are required" });
    }
    const t = await WardTask.create(body);
    res.status(201).json({ success: true, data: t });
  } catch (e) { res.status(400).json({ success: false, message: e.message }); }
};

/* ── ACCEPT (Ward Boy claims) ─────────────────────────────────
   Race-safe via findOneAndUpdate with a status="open" predicate so two
   ward boys clicking accept on the same task at the same moment can't
   both win — the second one gets 409. */
exports.accept = async (req, res) => {
  try {
    const myId   = req.user?.id;
    const myName = await resolveUserName(req, "Ward Boy");
    const t = await WardTask.findOneAndUpdate(
      { _id: req.params.id, status: "open" },
      { $set: { status: "assigned", assignedTo: myId, assignedToName: myName, acceptedAt: new Date() } },
      { new: true }
    ).lean();
    if (!t) return res.status(409).json({ success: false, message: "Task already taken or not open." });
    res.json({ success: true, data: t });
  } catch (e) { res.status(400).json({ success: false, message: e.message }); }
};

/* ── START ─────────────────────────────────────────────────── */
exports.start = async (req, res) => {
  try {
    const t = await WardTask.findOneAndUpdate(
      { _id: req.params.id, assignedTo: req.user?.id, status: "assigned" },
      { $set: { status: "in-progress", startedAt: new Date() } },
      { new: true }
    ).lean();
    if (!t) return res.status(409).json({ success: false, message: "Task not in 'assigned' state or not yours." });
    res.json({ success: true, data: t });
  } catch (e) { res.status(400).json({ success: false, message: e.message }); }
};

/* ── COMPLETE ──────────────────────────────────────────────── */
exports.complete = async (req, res) => {
  try {
    const t = await WardTask.findOneAndUpdate(
      { _id: req.params.id, assignedTo: req.user?.id, status: { $in: ["assigned", "in-progress"] } },
      { $set: { status: "done", completedAt: new Date(), completionNotes: req.body?.completionNotes || "" } },
      { new: true }
    ).lean();
    if (!t) return res.status(409).json({ success: false, message: "Task not in a completable state or not yours." });
    res.json({ success: true, data: t });
  } catch (e) { res.status(400).json({ success: false, message: e.message }); }
};

/* ── CANCEL — requester or Admin can void ──────────────────── */
exports.cancel = async (req, res) => {
  try {
    const t = await WardTask.findById(req.params.id).lean();
    if (!t) return res.status(404).json({ success: false, message: "Task not found" });
    if (t.status === "done") return res.status(409).json({ success: false, message: "Already completed." });
    const canCancel = String(t.requestedBy) === String(req.user?.id) || req.user?.role === "Admin";
    if (!canCancel) return res.status(403).json({ success: false, message: "Only the requester or an Admin can cancel a task." });
    const updated = await WardTask.findByIdAndUpdate(
      req.params.id,
      { $set: { status: "cancelled", cancelledAt: new Date(), cancelReason: req.body?.cancelReason || "" } },
      { new: true }
    ).lean();
    res.json({ success: true, data: updated });
  } catch (e) { res.status(400).json({ success: false, message: e.message }); }
};

/* ── PATCH free-form (priority / title / description) ───────── */
exports.update = async (req, res) => {
  try {
    const allow = ["title", "description", "priority", "fromLocation", "toLocation", "type", "UHID", "patientName", "admissionId"];
    const update = {};
    for (const k of allow) if (k in req.body) update[k] = req.body[k];
    const t = await WardTask.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true }).lean();
    if (!t) return res.status(404).json({ success: false, message: "Task not found" });
    res.json({ success: true, data: t });
  } catch (e) { res.status(400).json({ success: false, message: e.message }); }
};
