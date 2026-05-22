/**
 * fireDrillController.js  (R7bf-G / A5-CRIT-7 / NABH FMS.4)
 *
 * Fire-drill register CRUD. Implemented in-controller (no separate
 * service-layer) because the workflow is straightforward and there is
 * no shared in-process call surface. The ticket-number counter, the
 * status transitions, and validation all live here.
 */
const mongoose = require("mongoose");
const FireDrill = require("../../models/Compliance/FireDrillModel");
const { nextSequence, formatId } = require("../../utils/counter");

const actor = (req) => ({
  _id:        req.user?._id || req.user?.id,
  fullName:   req.user?.fullName || req.user?.name || "",
  role:       req.user?.role || "",
  hospitalId: req.user?.hospitalId || null,
});

// POST /api/fire-drills
exports.create = async (req, res, next) => {
  try {
    const u = actor(req);
    const body = req.body || {};
    if (!body.scheduledDate) return res.status(400).json({ success: false, message: "scheduledDate is required" });
    if (!body.type) return res.status(400).json({ success: false, message: "type is required" });

    const seq = await nextSequence("firedrill");
    const drillNumber = formatId("FDR", seq, 5); // FDR-00001

    const doc = await FireDrill.create({
      drillNumber,
      scheduledDate:    new Date(body.scheduledDate),
      actualDate:       body.actualDate ? new Date(body.actualDate) : null,
      type:             body.type,
      area:             body.area || "",
      conductedBy:      body.conductedBy || null,
      conductedByName:  body.conductedByName || "",
      participantCount: Number.isFinite(body.participantCount) ? body.participantCount : 0,
      durationMinutes:  Number.isFinite(body.durationMinutes) ? body.durationMinutes : 0,
      observations:     body.observations || "",
      deficienciesFound: Array.isArray(body.deficienciesFound) ? body.deficienciesFound : [],
      correctiveActions: Array.isArray(body.correctiveActions) ? body.correctiveActions : [],
      nextDrillDue:     body.nextDrillDue ? new Date(body.nextDrillDue) : null,
      status:           "SCHEDULED",
      notes:            body.notes || "",
      hospitalId:       u.hospitalId,
    });
    res.status(201).json({ success: true, data: doc });
  } catch (e) { next(e); }
};

// PUT /api/fire-drills/:id
exports.update = async (req, res, next) => {
  try {
    const doc = await FireDrill.findById(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: "Fire drill not found" });
    if (doc.status === "COMPLETED") {
      return res.status(409).json({ success: false, message: "Cannot edit a COMPLETED drill — use a new drill entry instead" });
    }
    const body = { ...(req.body || {}) };
    delete body.drillNumber;
    delete body.status;
    for (const [k, v] of Object.entries(body)) {
      if ((k === "scheduledDate" || k === "actualDate" || k === "nextDrillDue") && v) {
        doc.set(k, new Date(v));
      } else {
        doc.set(k, v);
      }
    }
    await doc.save();
    res.json({ success: true, data: doc });
  } catch (e) { next(e); }
};

// PUT /api/fire-drills/:id/complete
//   body: { actualDate?, participantCount?, durationMinutes?, observations?, deficienciesFound?, correctiveActions?, nextDrillDue? }
exports.complete = async (req, res, next) => {
  try {
    const body = req.body || {};
    const updated = await FireDrill.findOneAndUpdate(
      { _id: req.params.id, status: { $in: ["SCHEDULED"] } },
      {
        $set: {
          status:           "COMPLETED",
          actualDate:       body.actualDate ? new Date(body.actualDate) : new Date(),
          participantCount: Number.isFinite(body.participantCount) ? body.participantCount : undefined,
          durationMinutes:  Number.isFinite(body.durationMinutes) ? body.durationMinutes : undefined,
          observations:     body.observations || undefined,
          deficienciesFound: Array.isArray(body.deficienciesFound) ? body.deficienciesFound : undefined,
          correctiveActions: Array.isArray(body.correctiveActions) ? body.correctiveActions : undefined,
          nextDrillDue:     body.nextDrillDue ? new Date(body.nextDrillDue) : undefined,
          notes:            body.notes || undefined,
        },
      },
      { new: true },
    );
    if (!updated) return res.status(409).json({ success: false, message: "Drill not in SCHEDULED state — cannot complete" });
    res.json({ success: true, data: updated });
  } catch (e) { next(e); }
};

// PUT /api/fire-drills/:id/cancel
exports.cancel = async (req, res, next) => {
  try {
    const updated = await FireDrill.findOneAndUpdate(
      { _id: req.params.id, status: "SCHEDULED" },
      { $set: { status: "CANCELLED", notes: req.body?.reason || "Cancelled" } },
      { new: true },
    );
    if (!updated) return res.status(409).json({ success: false, message: "Drill not in SCHEDULED state — cannot cancel" });
    res.json({ success: true, data: updated });
  } catch (e) { next(e); }
};

// GET /api/fire-drills/:id
exports.getOne = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }
    const doc = await FireDrill.findById(req.params.id).lean();
    if (!doc) return res.status(404).json({ success: false, message: "Fire drill not found" });
    res.json({ success: true, data: doc });
  } catch (e) { next(e); }
};

// GET /api/fire-drills?status=&type=
exports.list = async (req, res, next) => {
  try {
    const q = {};
    if (req.query?.status) q.status = req.query.status;
    if (req.query?.type) q.type = req.query.type;
    const data = await FireDrill.find(q)
      .sort({ scheduledDate: -1 })
      .limit(Math.min(500, Math.max(1, Number(req.query?.limit) || 100)))
      .lean();
    res.json({ success: true, data, count: data.length });
  } catch (e) { next(e); }
};
