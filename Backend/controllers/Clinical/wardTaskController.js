/**
 * wardTaskController.js — Ward Boy task board.
 *
 * R7bj-F4 hardening:
 *   • Replaced `req.body` spreads with explicit per-endpoint allow-lists
 *     (Mongo CRIT-2 / WB-CRIT-1 mass-assignment).
 *   • Server stamps the actor trio + audit fields on every write — never
 *     trusted from body.
 *   • Every response now flows through apiEnvelope.sendOk / sendErr so the
 *     wire shape is one canonical {success, data, meta} envelope.
 *   • list IDOR — Ward Boys can no longer pivot `?assignedTo=<peer>` to
 *     read another ward boy's tasks (Mongo IDOR finding WB-CRIT-2).
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
const { sendOk, sendErr } = require("../../utils/apiEnvelope");

/* ── LIST ──────────────────────────────────────────────────────
   R7bj-F4 IDOR: a Ward Boy must not be able to filter by another Ward
   Boy's assignedTo and read peer tasks (PHI by association — UHID +
   patientName). Roles in the privileged set see all; Ward Boy is
   scoped to their own assignments regardless of query. */
exports.list = async (req, res) => {
  try {
    const { status, assignedTo, type, priority, UHID, mine, limit = 100 } = req.query;
    const q = {};
    if (status)     q.status = status;
    if (type)       q.type = type;
    if (priority)   q.priority = priority;
    if (UHID)       q.UHID = UHID;

    const role   = req.user?.role || "";
    const myId   = req.user?.id;
    const PRIVILEGED = ["Admin", "Doctor", "Nurse", "Receptionist"];

    if (PRIVILEGED.includes(role)) {
      // Privileged roles may freely pivot the board.
      if (assignedTo) q.assignedTo = assignedTo;
      if (mine === "true" && myId) q.assignedTo = myId;
    } else {
      // Non-privileged (Ward Boy / Housekeeping / etc): force scope to self,
      // regardless of the URL param.
      if (myId) q.assignedTo = myId;
    }

    const rows = await WardTask.find(q)
      .sort({ priority: 1, requestedAt: -1 })
      .limit(Math.min(Number(limit) || 100, 500))
      .lean();
    return sendOk(res, rows, { count: rows.length });
  } catch (e) { return sendErr(res, e); }
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
    return sendOk(res, {
      open: openCount,
      assigned: assignedCount,
      inProgress: inProgressCount,
      doneToday,
      myActive,
    });
  } catch (e) { return sendErr(res, e); }
};

/* ── CREATE ────────────────────────────────────────────────────
   R7bj-F4: explicit destructure of allowed fields, then server-stamp
   the actor trio + status. Body fields outside the allow-list are
   silently dropped (no 400 to keep dumb clients happy). */
exports.create = async (req, res) => {
  try {
    const b = req.body || {};
    const {
      title, description, type, priority,
      fromLocation, toLocation,
      UHID, patientName, admissionId,
    } = b;
    if (!title || !type) {
      return sendErr(res, "title and type are required", "VALIDATION", 400);
    }
    const doc = {
      title:        String(title).trim(),
      description:  description ? String(description).trim() : "",
      type,
      priority:     priority || "normal",
      fromLocation: fromLocation || "",
      toLocation:   toLocation   || "",
      UHID:         UHID || "",
      patientName:  patientName || "",
      admissionId:  admissionId || undefined,
      // Server stamps — never from body.
      requestedBy:     req.user?.id,
      requestedByName: await resolveUserName(req),
      requestedByRole: req.user?.role || "",
      requestedAt:     new Date(),
      status:          "open",
    };
    const t = await WardTask.create(doc);
    return sendOk(res, t, null, 201);
  } catch (e) { return sendErr(res, e, "CREATE_FAILED", 400); }
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
      { new: true, runValidators: true }
    ).lean();
    if (!t) return sendErr(res, "Task already taken or not open.", "ILLEGAL_TRANSITION", 409);
    return sendOk(res, t);
  } catch (e) { return sendErr(res, e, null, 400); }
};

/* ── START ─────────────────────────────────────────────────── */
exports.start = async (req, res) => {
  try {
    const t = await WardTask.findOneAndUpdate(
      { _id: req.params.id, assignedTo: req.user?.id, status: "assigned" },
      { $set: { status: "in-progress", startedAt: new Date() } },
      { new: true, runValidators: true }
    ).lean();
    if (!t) return sendErr(res, "Task not in 'assigned' state or not yours.", "ILLEGAL_TRANSITION", 409);
    return sendOk(res, t);
  } catch (e) { return sendErr(res, e, null, 400); }
};

/* ── COMPLETE ──────────────────────────────────────────────── */
exports.complete = async (req, res) => {
  try {
    const notes = typeof req.body?.completionNotes === "string" ? req.body.completionNotes : "";
    const t = await WardTask.findOneAndUpdate(
      { _id: req.params.id, assignedTo: req.user?.id, status: { $in: ["assigned", "in-progress"] } },
      { $set: { status: "done", completedAt: new Date(), completionNotes: notes } },
      { new: true, runValidators: true }
    ).lean();
    if (!t) return sendErr(res, "Task not in a completable state or not yours.", "ILLEGAL_TRANSITION", 409);
    return sendOk(res, t);
  } catch (e) { return sendErr(res, e, null, 400); }
};

/* ── CANCEL — requester or Admin can void ──────────────────── */
exports.cancel = async (req, res) => {
  try {
    const t = await WardTask.findById(req.params.id).lean();
    if (!t) return sendErr(res, "Task not found", "NOT_FOUND", 404);
    if (t.status === "done") return sendErr(res, "Already completed.", "ILLEGAL_TRANSITION", 409);
    const canCancel = String(t.requestedBy) === String(req.user?.id) || req.user?.role === "Admin";
    if (!canCancel) return sendErr(res, "Only the requester or an Admin can cancel a task.", "FORBIDDEN", 403);
    const reason = typeof req.body?.cancelReason === "string" ? req.body.cancelReason : "";
    const updated = await WardTask.findByIdAndUpdate(
      req.params.id,
      { $set: { status: "cancelled", cancelledAt: new Date(), cancelReason: reason } },
      { new: true, runValidators: true }
    ).lean();
    return sendOk(res, updated);
  } catch (e) { return sendErr(res, e, null, 400); }
};

/* ── PATCH free-form (priority / title / description) ─────────
   R7bj-F4: explicit allow-list. Lifecycle fields (status, assignedTo,
   completedAt, etc.) cannot be flipped here — those have dedicated
   endpoints. Mass-assignment was forging same-day completed stats. */
exports.update = async (req, res) => {
  try {
    const ALLOW = [
      "title", "description", "priority", "fromLocation", "toLocation",
      "type", "UHID", "patientName", "admissionId",
    ];
    const update = {};
    for (const k of ALLOW) if (k in (req.body || {})) update[k] = req.body[k];
    const t = await WardTask.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true }).lean();
    if (!t) return sendErr(res, "Task not found", "NOT_FOUND", 404);
    return sendOk(res, t);
  } catch (e) { return sendErr(res, e, null, 400); }
};
