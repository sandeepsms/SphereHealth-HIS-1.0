/**
 * wardOpsController.js — Ward Boy operations suite controller.
 *
 * R7bj-F4 hardening:
 *   • Replaced every `req.body` spread on writes with explicit allow-lists
 *     (Mongo CRIT-2 / WB-CRIT-1).
 *   • Server stamps actor trio + timestamps for issue / return / declare /
 *     handover — never trusted from body.
 *   • Mortuary declare: explicit role gate — Ward Boy may NOT declare a
 *     death (Auth 2-WB-CRIT-2). Must be Doctor or Admin.
 *   • Mortuary handover: now requires BOTH `receivedBy` AND `witnessName`
 *     (NABH AAC 2-signature attestation — Auth 2-WB-CRIT-1).
 *   • managerStats: 6 sequential awaits collapsed into a single Promise.all
 *     (API 3-CRIT envelope normalisation: KPIs nested under data).
 *   • Every response moved to apiEnvelope.sendOk / sendErr.
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
const userName = require("../../utils/userName");
const { sendOk, sendErr } = require("../../utils/apiEnvelope");

/* ── SHIFT ─────────────────────────────────────────────────── */
exports.shiftCurrent = async (req, res) => {
  try {
    const s = await WardShift.findOne({ user: req.user.id, endedAt: null }).lean();
    return sendOk(res, s);
  } catch (e) { return sendErr(res, e); }
};

exports.shiftStart = async (req, res) => {
  try {
    // Guard against double-open shifts for the same user.
    const open = await WardShift.findOne({ user: req.user.id, endedAt: null }).lean();
    if (open) return sendErr(res, "A shift is already open. Close it first.", "ILLEGAL_TRANSITION", 409);
    const ward = typeof req.body?.ward === "string" ? req.body.ward : "";
    const s = await WardShift.create({
      user:      req.user.id,
      userName:  await userName(req),
      ward,
      startedAt: new Date(),
    });
    return sendOk(res, s, null, 201);
  } catch (e) { return sendErr(res, e, null, 400); }
};

exports.shiftEnd = async (req, res) => {
  try {
    const s = await WardShift.findOne({ user: req.user.id, endedAt: null });
    if (!s) return sendErr(res, "No open shift", "NOT_FOUND", 404);
    // Close any open break first.
    const lastBreak = s.breaks?.[s.breaks.length - 1];
    if (lastBreak && !lastBreak.endedAt) lastBreak.endedAt = new Date();
    s.endedAt        = new Date();
    s.shiftNotes     = typeof req.body?.shiftNotes    === "string" ? req.body.shiftNotes    : "";
    s.handoverNotes  = typeof req.body?.handoverNotes === "string" ? req.body.handoverNotes : "";
    await s.save();   // pre-save computes totalActiveMin
    return sendOk(res, s.toObject());
  } catch (e) { return sendErr(res, e, null, 400); }
};

exports.shiftBreakStart = async (req, res) => {
  try {
    const s = await WardShift.findOne({ user: req.user.id, endedAt: null });
    if (!s) return sendErr(res, "No open shift", "NOT_FOUND", 404);
    const last = s.breaks?.[s.breaks.length - 1];
    if (last && !last.endedAt) return sendErr(res, "Already on break", "ILLEGAL_TRANSITION", 409);
    const reason = typeof req.body?.reason === "string" ? req.body.reason : "";
    s.breaks.push({ startedAt: new Date(), reason });
    await s.save();
    return sendOk(res, s);
  } catch (e) { return sendErr(res, e, null, 400); }
};

exports.shiftBreakEnd = async (req, res) => {
  try {
    const s = await WardShift.findOne({ user: req.user.id, endedAt: null });
    if (!s) return sendErr(res, "No open shift", "NOT_FOUND", 404);
    const last = s.breaks?.[s.breaks.length - 1];
    if (!last || last.endedAt) return sendErr(res, "No active break", "ILLEGAL_TRANSITION", 409);
    last.endedAt = new Date();
    await s.save();
    return sendOk(res, s);
  } catch (e) { return sendErr(res, e, null, 400); }
};

exports.shiftHistory = async (req, res) => {
  try {
    const filter = { user: req.user.id };
    if (req.query?.from) filter.startedAt = { ...(filter.startedAt || {}), $gte: new Date(req.query.from) };
    if (req.query?.to)   filter.startedAt = { ...(filter.startedAt || {}), $lte: new Date(req.query.to) };
    const rows = await WardShift.find(filter).sort({ startedAt: -1 }).limit(50).lean();
    return sendOk(res, rows, { count: rows.length });
  } catch (e) { return sendErr(res, e); }
};

/* ── EQUIPMENT ─────────────────────────────────────────────── */
exports.equipmentList = async (req, res) => {
  try {
    const { status, q, limit = 100 } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (q) {
      const { safeRegex } = require("../../utils/queryGuards");
      const re = safeRegex(q);
      filter.$or = [
        { equipmentName: re },
        { category:      re },
        { serialNumber:  re },
        { issuedToName:  re },
      ];
    }
    const rows = await EquipmentLog.find(filter).sort({ issuedAt: -1 }).limit(Math.min(Number(limit) || 100, 500)).lean();
    return sendOk(res, rows, { count: rows.length });
  } catch (e) { return sendErr(res, e); }
};

exports.equipmentIssue = async (req, res) => {
  try {
    const b = req.body || {};
    const {
      equipmentName, category, serialNumber,
      issuedToName, issuedTo: issuedToId, issuedToWard,
      expectedReturnAt, notes,
    } = b;
    if (!equipmentName) return sendErr(res, "equipmentName required", "VALIDATION", 400);
    const doc = {
      equipmentName: String(equipmentName).trim(),
      category:      category || "",
      serialNumber:  serialNumber || "",
      issuedTo:      issuedToId   || undefined,
      issuedToName:  issuedToName || "",
      issuedToWard:  issuedToWard || "",
      expectedReturnAt: expectedReturnAt ? new Date(expectedReturnAt) : null,
      notes:         notes || "",
      // Server-stamped actor + time + status.
      issuedBy:      req.user.id,
      issuedByName:  await userName(req),
      issuedAt:      new Date(),
      status:        "issued",
    };
    const row = await EquipmentLog.create(doc);
    return sendOk(res, row, null, 201);
  } catch (e) { return sendErr(res, e, null, 400); }
};

exports.equipmentReturn = async (req, res) => {
  try {
    const row = await EquipmentLog.findById(req.params.id);
    if (!row) return sendErr(res, "Not found", "NOT_FOUND", 404);
    if (row.status !== "issued") return sendErr(res, `Already ${row.status}`, "ILLEGAL_TRANSITION", 409);

    const conditionOnReturn = typeof req.body?.conditionOnReturn === "string" ? req.body.conditionOnReturn : "OK";
    const extraNote         = typeof req.body?.notes === "string" ? req.body.notes : "";

    row.returnedAt        = new Date();
    row.returnedToBy      = req.user.id;
    row.returnedToName    = await userName(req);
    row.conditionOnReturn = conditionOnReturn;
    row.status            = conditionOnReturn === "Lost" ? "lost" : "returned";
    if (extraNote) row.notes = (row.notes ? row.notes + " · " : "") + extraNote;
    await row.save();
    return sendOk(res, row);
  } catch (e) { return sendErr(res, e, null, 400); }
};

/* ── SUPPLIES (Linen + BMW) ──────────────────────────────────
   R7bj-F4: linen + bmw sub-docs are now schema-shape filtered before
   write (was raw spread). Server stamps recorder. */
function pickLinen(src) {
  const s = src && typeof src === "object" ? src : {};
  return {
    issued:   Number(s.issued)   || 0,
    returned: Number(s.returned) || 0,
    soiled:   Number(s.soiled)   || 0,
    lost:     Number(s.lost)     || 0,
  };
}
function pickBmw(src) {
  const s = src && typeof src === "object" ? src : {};
  return {
    yellow: Number(s.yellow) || 0,
    red:    Number(s.red)    || 0,
    blue:   Number(s.blue)   || 0,
    white:  Number(s.white)  || 0,
    black:  Number(s.black)  || 0,
  };
}

exports.supplyUpsert = async (req, res) => {
  try {
    const b = req.body || {};
    const dateStr = b.date || new Date().toISOString().slice(0, 10);
    const date = new Date(`${dateStr}T00:00:00`);
    const ward = typeof b.ward === "string" && b.ward.trim() ? b.ward.trim() : "Main";
    const recordedByName = await userName(req);
    const update = {
      $set: {
        date, ward,
        recordedBy:     req.user.id,
        recordedByName,
        linen:          pickLinen(b.linen),
        bmw:            pickBmw(b.bmw),
        notes:          typeof b.notes === "string" ? b.notes : "",
      },
    };
    const row = await WardSupplyLog.findOneAndUpdate(
      { date, ward }, update, { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();
    return sendOk(res, row);
  } catch (e) { return sendErr(res, e, null, 400); }
};

exports.supplyRecent = async (req, res) => {
  try {
    const days = Number(req.query?.days) || 7;
    const from = new Date(); from.setDate(from.getDate() - days); from.setHours(0,0,0,0);
    const rows = await WardSupplyLog.find({ date: { $gte: from } }).sort({ date: -1 }).lean();
    return sendOk(res, rows, { count: rows.length });
  } catch (e) { return sendErr(res, e); }
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
    return sendOk(res, rows, { count: rows.length });
  } catch (e) { return sendErr(res, e); }
};

exports.codeBlueCreate = async (req, res) => {
  try {
    const b = req.body || {};
    const { location, bedNumber, UHID, patientName } = b;
    if (!location || !String(location).trim()) return sendErr(res, "location required", "VALIDATION", 400);
    const doc = {
      location:      String(location).trim(),
      bedNumber:     bedNumber   || "",
      UHID:          UHID        || "",
      patientName:   patientName || "",
      // Server-stamped actor + time + outcome.
      alertedBy:     req.user.id,
      alertedByName: await userName(req),
      alertedAt:     new Date(),
      outcome:       "ongoing",
    };
    const row = await CodeBlueEvent.create(doc);
    return sendOk(res, row, null, 201);
  } catch (e) { return sendErr(res, e, null, 400); }
};

exports.codeBlueAddResponder = async (req, res) => {
  try {
    const row = await CodeBlueEvent.findById(req.params.id);
    if (!row) return sendErr(res, "Not found", "NOT_FOUND", 404);
    const arrivedAt = new Date();
    row.responders.push({
      user: req.user.id,
      name: await userName(req),
      role: req.user.role || "",
      arrivedAt,
    });
    if (row.arrivalDelaySec == null) {
      row.arrivalDelaySec = Math.round((arrivedAt - row.alertedAt) / 1000);
    }
    await row.save();
    return sendOk(res, row);
  } catch (e) { return sendErr(res, e, null, 400); }
};

exports.codeBlueClose = async (req, res) => {
  try {
    const outcome = typeof req.body?.outcome === "string" ? req.body.outcome : "resuscitated";
    const notes   = typeof req.body?.notes   === "string" ? req.body.notes   : "";
    const row = await CodeBlueEvent.findByIdAndUpdate(
      req.params.id,
      { $set: { outcome, notes, closedAt: new Date() } },
      { new: true }
    ).lean();
    if (!row) return sendErr(res, "Not found", "NOT_FOUND", 404);
    return sendOk(res, row);
  } catch (e) { return sendErr(res, e, null, 400); }
};

/* ── MORTUARY ────────────────────────────────────────────────
   Auth 2-WB-CRIT-2: Ward Boy must NOT be allowed to declare a death.
   The route guard `ward.mortuary` includes Ward Boy (for body-shift +
   handover assist) so we *additionally* gate declare here at the
   controller level. */
exports.mortuaryList = async (req, res) => {
  try {
    const filter = {};
    if (req.query?.status) filter.status = req.query.status;
    const rows = await MortuaryRecord.find(filter).sort({ deathDeclaredAt: -1 }).limit(100).lean();
    return sendOk(res, rows, { count: rows.length });
  } catch (e) { return sendErr(res, e); }
};

exports.mortuaryDeclare = async (req, res) => {
  try {
    // R7bj-F4 Auth 2-WB-CRIT-2: explicit role gate. Ward Boy can shift
    // a body & assist handover, but declaring death is Doctor / Admin
    // only. NABH AAC.16 requires a registered medical practitioner.
    const role = req.user?.role || "";
    const ALLOWED_DECLARERS = ["Doctor", "Admin"];
    if (!ALLOWED_DECLARERS.includes(role)) {
      return sendErr(
        res,
        "Only a Doctor or Admin may declare a death. Ward Boy / Nurse can shift/handover.",
        "FORBIDDEN_ROLE",
        403,
      );
    }

    const b = req.body || {};
    const {
      UHID, patientName, admissionId, age, gender,
      deathDeclaredAt, causeOfDeath, isMLC, mlcNumber, notes,
    } = b;
    if (!UHID || !patientName) {
      return sendErr(res, "UHID + patientName required", "VALIDATION", 400);
    }
    const doc = {
      UHID:        String(UHID).toUpperCase().trim(),
      patientName: String(patientName).trim(),
      admissionId: admissionId || undefined,
      age:         age != null ? Number(age) : null,
      gender:      gender || "",
      // Death event — server stamps declarer trio + now (if not provided).
      deathDeclaredAt:     deathDeclaredAt ? new Date(deathDeclaredAt) : new Date(),
      deathDeclaredBy:     req.user.id,
      deathDeclaredByName: await userName(req),
      causeOfDeath:        causeOfDeath || "",
      isMLC:               !!isMLC,
      mlcNumber:           mlcNumber || "",
      notes:               notes || "",
      status:              "declared",
    };
    const row = await MortuaryRecord.create(doc);
    return sendOk(res, row, null, 201);
  } catch (e) { return sendErr(res, e, null, 400); }
};

exports.mortuaryShift = async (req, res) => {
  try {
    const shiftedByName = await userName(req);
    const bodyTagId = typeof req.body?.bodyTagId === "string" ? req.body.bodyTagId : "";
    const row = await MortuaryRecord.findByIdAndUpdate(
      req.params.id,
      {
        $set: {
          shiftedToMortuaryAt: new Date(),
          shiftedBy:           req.user.id,
          shiftedByName,
          bodyTagId,
          status:              "in-mortuary",
        },
      },
      { new: true }
    ).lean();
    if (!row) return sendErr(res, "Not found", "NOT_FOUND", 404);
    return sendOk(res, row);
  } catch (e) { return sendErr(res, e, null, 400); }
};

exports.mortuaryHandover = async (req, res) => {
  try {
    // R7bj-F4 Auth 2-WB-CRIT-1: handover requires BOTH the family member
    // who collects the body AND a hospital witness (2-signature NABH AAC
    // attestation). One actor as both signer + receiver is the loophole.
    const b = req.body || {};
    const {
      receivedBy, relationship, receiverPhone, receiverIdProof, receiverIdNumber,
      vehicleDetails, witnessName, witnessId, notes,
    } = b;
    if (!receivedBy || !relationship) {
      return sendErr(res, "receivedBy + relationship required", "VALIDATION", 400);
    }
    if (!witnessName || !String(witnessName).trim()) {
      return sendErr(
        res,
        "witnessName is required — NABH 2-signature handover attestation",
        "WITNESS_REQUIRED",
        400,
      );
    }
    if (String(witnessName).trim().toLowerCase() === String(receivedBy).trim().toLowerCase()) {
      return sendErr(res, "Witness and receiver must be different people", "WITNESS_INVALID", 400);
    }

    // Pre-load to enforce state transition (must be in-mortuary or declared).
    const existing = await MortuaryRecord.findById(req.params.id).lean();
    if (!existing) return sendErr(res, "Not found", "NOT_FOUND", 404);
    if (existing.status === "handed-over") {
      return sendErr(res, "Body already handed over", "ILLEGAL_TRANSITION", 409);
    }

    const handoverByName = await userName(req);
    const witnessTag = `witness:${String(witnessName).trim()}` +
      (witnessId ? ` (id:${String(witnessId).trim()})` : "");
    const combinedNotes = [
      typeof notes === "string" ? notes : "",
      witnessTag,
    ].filter(Boolean).join(" · ");

    const row = await MortuaryRecord.findByIdAndUpdate(
      req.params.id,
      {
        $set: {
          handoverAt:       new Date(),
          handoverBy:       req.user.id,
          handoverByName,
          receivedBy:       String(receivedBy).trim(),
          relationship:     String(relationship).trim(),
          receiverPhone:    receiverPhone    || "",
          receiverIdProof:  receiverIdProof  || "",
          receiverIdNumber: receiverIdNumber || "",
          vehicleDetails:   vehicleDetails   || "",
          notes:            combinedNotes,
          status:           "handed-over",
        },
      },
      { new: true }
    ).lean();
    return sendOk(res, row);
  } catch (e) { return sendErr(res, e, null, 400); }
};

/* ── MANAGER KPI DASHBOARD ─────────────────────────────────── */
exports.managerStats = async (req, res) => {
  try {
    const days = Number(req.query?.days) || 7;
    const from = new Date(); from.setDate(from.getDate() - days); from.setHours(0,0,0,0);
    const now  = new Date();

    // R7bj-F4 / API 3-CRIT-: 6 sequential awaits collapsed into one
    // Promise.all so the manager dashboard loads in one round-trip.
    const [
      tasks,
      activeShifts,
      equipmentOutstanding,
      equipmentOverdue,
      codeBlueLast,
      mortuaryPending,
    ] = await Promise.all([
      WardTask.find({
        assignedTo: { $ne: null },
        completedAt: { $gte: from },
        status: "done",
      }).select("assignedTo assignedToName type acceptedAt completedAt priority").lean(),
      WardShift.find({ endedAt: null })
        .select("user userName ward startedAt breaks").lean(),
      EquipmentLog.countDocuments({ status: "issued" }),
      EquipmentLog.countDocuments({
        status: "issued",
        expectedReturnAt: { $lt: now, $ne: null },
      }),
      CodeBlueEvent.find({ alertedAt: { $gte: from } })
        .select("alertedAt outcome arrivalDelaySec location").lean(),
      MortuaryRecord.countDocuments({ status: { $in: ["declared", "in-mortuary"] } }),
    ]);

    // Per-ward-boy task completion leaderboard.
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

    const cbWithDelay = codeBlueLast.filter(e => e.arrivalDelaySec != null);
    const avgCodeBlueDelaySec = cbWithDelay.length
      ? Math.round(cbWithDelay.reduce((s, e) => s + e.arrivalDelaySec, 0) / cbWithDelay.length)
      : null;

    return sendOk(res, {
      window: { days, from: from.toISOString().slice(0,10) },
      leaderboard,
      activeShifts,
      kpis: {
        tasksDone:               tasks.length,
        activeShiftCount:        activeShifts.length,
        equipmentOutstanding,
        equipmentOverdue,
        codeBlueCount:           codeBlueLast.length,
        avgCodeBlueDelaySec,
        mortuaryPending,
      },
      codeBlueRecent: codeBlueLast.slice(0, 10),
    });
  } catch (e) {
    console.error("[wardOps] managerStats error:", e);
    return sendErr(res, e);
  }
};
