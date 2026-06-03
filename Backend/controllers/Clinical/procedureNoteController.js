/**
 * procedureNoteController.js — NABH COP.10 evidence
 *
 * Captures the post-op completion note for an OT-bound DoctorOrder.
 * Side effect on POST: transitions the corresponding OTRegister row
 * from "Scheduled" → "Completed" (or calls nabhRegisterEmitter.emitOT
 * to create the Completed row if the Scheduled row is missing — e.g.
 * a legacy order that pre-dated R7bx-3 wiring).
 *
 * Endpoints (mounted at /api/procedure-notes by routes/index.js):
 *   POST /            — create a new procedure note
 *   GET  /            — list (filter by doctorOrderId / UHID /
 *                       admissionId / from / to)
 *   GET  /:id         — single note by _id
 *   GET  /order/:id   — single note by source doctorOrderId
 */
"use strict";

const mongoose = require("mongoose");
const ProcedureNote = require("../../models/Clinical/ProcedureNoteModel");
const DoctorOrder   = require("../../models/Doctor/DoctorOrderModel");
const Patient       = require("../../models/Patient/patientModel");
const Admission     = require("../../models/Patient/admissionModel");
const OTRegister    = require("../../models/Compliance/OTRegisterModel");
const { emitOT }    = require("../../services/Compliance/nabhRegisterEmitter");

const actor = (req) => ({
  _id:      req.user?._id || req.user?.id || null,
  fullName: req.user?.fullName || req.user?.name || req.user?.username || "",
  role:     req.user?.role || "",
});

function _asObjectId(v) {
  if (!v) return null;
  if (mongoose.isValidObjectId(v)) return new mongoose.Types.ObjectId(v);
  return null;
}

function _diffMinutes(later, earlier) {
  if (!later || !earlier) return null;
  const ms = new Date(later).getTime() - new Date(earlier).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.round(ms / 60000);
}

// ─────────────────────────────────────────────────────────────────────
// POST /api/procedure-notes
//
// Body (all timestamps ISO):
//   doctorOrderId            (required — source OT-bound DoctorOrder)
//   startTime, endTime       (required)
//   actualProcedure          (required, text)
//   surgeryName              (optional — defaults from order.orderDetails)
//   surgeon                  (optional)
//   assistantSurgeons[]      (optional)
//   anaesthetistName         (optional)
//   anaesthesiaType          (optional enum)
//   asaGrade                 (optional enum)
//   complications            (optional)
//   bloodLossMl              (optional number)
//   specimensSent[]          (optional array of { name, sentTo, sentAt })
//   postOpDestination        (optional enum, default "Recovery")
// ─────────────────────────────────────────────────────────────────────
exports.create = async (req, res, next) => {
  try {
    const body = req.body || {};
    const me   = actor(req);

    // ── Validation ─────────────────────────────────────────────
    if (!body.doctorOrderId || !mongoose.isValidObjectId(body.doctorOrderId)) {
      return res.status(400).json({ success: false, code: "ARG_MISSING", message: "doctorOrderId is required" });
    }
    if (!body.startTime) {
      return res.status(400).json({ success: false, code: "ARG_MISSING", message: "startTime is required" });
    }
    if (!body.endTime) {
      return res.status(400).json({ success: false, code: "ARG_MISSING", message: "endTime is required" });
    }
    if (!body.actualProcedure || !String(body.actualProcedure).trim()) {
      return res.status(400).json({ success: false, code: "ARG_MISSING", message: "actualProcedure is required" });
    }
    const startTime = new Date(body.startTime);
    const endTime   = new Date(body.endTime);
    if (!Number.isFinite(startTime.getTime()) || !Number.isFinite(endTime.getTime())) {
      return res.status(400).json({ success: false, code: "ARG_INVALID", message: "startTime / endTime must be valid timestamps" });
    }
    if (endTime < startTime) {
      return res.status(400).json({ success: false, code: "ARG_INVALID", message: "endTime cannot be before startTime" });
    }

    // ── Look up source order + patient + admission ─────────────
    const order = await DoctorOrder.findById(body.doctorOrderId).lean();
    if (!order) {
      return res.status(404).json({ success: false, code: "NOT_FOUND", message: "Source DoctorOrder not found" });
    }
    if (order.orderType !== "Procedure") {
      return res.status(409).json({ success: false, code: "NOT_PROCEDURE_ORDER", message: "Source order is not a Procedure order" });
    }

    // Idempotency: refuse a second note for the same order. Surgeons
    // who need to amend should use a future PUT /:id route.
    const dup = await ProcedureNote.findOne({ doctorOrderId: order._id }).lean();
    if (dup) {
      return res.status(409).json({
        success: false,
        code: "ALREADY_EXISTS",
        message: "A procedure note already exists for this order",
        data: dup,
      });
    }

    const patient = order.patientId
      ? await Patient.findById(order.patientId).select("_id UHID fullName name age gender sex").lean()
      : null;
    const admission = order.admissionId
      ? await Admission.findById(order.admissionId).select("_id admissionNumber wardName ward").lean()
      : null;

    // ── Build + persist the note ───────────────────────────────
    const details = order.orderDetails || {};
    const noteDoc = new ProcedureNote({
      patientId:        patient?._id || order.patientId || null,
      UHID:             (patient?.UHID || order.UHID || "").toUpperCase(),
      patientName:      patient?.fullName || patient?.name || order.patientName || "",
      admissionId:      admission?._id || order.admissionId || null,
      admissionNumber:  admission?.admissionNumber || order.admissionNumber || order.ipdNo || "",

      doctorOrderId:    order._id,

      surgeryName:      body.surgeryName
                         || details.surgeryName
                         || details.procedureName
                         || details.displayName
                         || "Procedure",
      actualProcedure:  String(body.actualProcedure).trim(),

      startTime,
      endTime,
      // durationMinutes auto-derived in pre-save hook

      surgeon:           body.surgeon || details.surgeonName || order.orderedBy || "",
      surgeonId:         _asObjectId(body.surgeonId) || _asObjectId(details.surgeonId),
      assistantSurgeons: Array.isArray(body.assistantSurgeons) ? body.assistantSurgeons : [],

      anaesthetistName:  body.anaesthetistName || details.anaesthetistName || "",
      anaesthetistId:    _asObjectId(body.anaesthetistId) || _asObjectId(details.anaesthetistId),
      anaesthesiaType:   body.anaesthesiaType || details.anaesthesiaType || "",
      asaGrade:          body.asaGrade || details.asaGrade || "",

      complications:     body.complications || "",
      bloodLossMl:       body.bloodLossMl != null && body.bloodLossMl !== ""
                          ? Number(body.bloodLossMl)
                          : null,
      specimensSent:     Array.isArray(body.specimensSent)
                          ? body.specimensSent
                              .filter((s) => s && (s.name || s.sentTo))
                              .map((s) => ({
                                name:   String(s.name || "").trim(),
                                sentTo: String(s.sentTo || "").trim(),
                                sentAt: s.sentAt ? new Date(s.sentAt) : new Date(),
                              }))
                          : [],

      postOpDestination: body.postOpDestination || "Recovery",

      createdBy:        _asObjectId(me._id),
      createdByName:    me.fullName,
      createdByRole:    me.role,
      auditTrail: [{
        action:   "CREATED",
        at:       new Date(),
        byUserId: _asObjectId(me._id),
        byName:   me.fullName,
        byRole:   me.role,
        notes:    `procedure-note for orderId=${order._id}`,
      }],
      hospitalId:       req.user?.hospitalId || null,
    });

    await noteDoc.save();

    // ── Side effect: transition the OT register Scheduled → Completed ──
    // Pre-R7bx-3 (legacy) orders may not have a Scheduled row at all; in
    // that case fall back to emitOT which creates a Completed row from
    // scratch. Either path is best-effort: surveyor evidence (the note
    // itself) is already persisted above, so register-update failures
    // never roll back the primary write.
    try {
      const existing = await OTRegister.findOne({ doctorOrderId: order._id });
      if (existing) {
        // Update in place so the OT row keeps its otNumber + scheduledAt.
        existing.status            = "Completed";
        existing.startTime         = startTime;
        existing.endTime           = endTime;
        existing.durationMinutes   = _diffMinutes(endTime, startTime);
        existing.actualProcedure   = noteDoc.actualProcedure;
        if (noteDoc.anaesthetistName && !existing.anaesthetistName) {
          existing.anaesthetistName = noteDoc.anaesthetistName;
        }
        if (noteDoc.anaesthesiaType && !existing.anaesthesiaType) {
          existing.anaesthesiaType = noteDoc.anaesthesiaType;
        }
        if (noteDoc.asaGrade && !existing.asaGrade) {
          existing.asaGrade = noteDoc.asaGrade;
        }
        existing.complications     = noteDoc.complications || existing.complications;
        if (noteDoc.bloodLossMl != null) existing.bloodLossMl = noteDoc.bloodLossMl;
        if (Array.isArray(noteDoc.specimensSent) && noteDoc.specimensSent.length) {
          // OTRegister stores specimensSent as a [String] — flatten names
          existing.specimensSent = noteDoc.specimensSent.map(
            (s) => [s.name, s.sentTo].filter(Boolean).join(" → ")
          );
        }
        existing.procedureNoteId   = noteDoc._id;
        existing.locked            = true;
        existing.lockedAt          = new Date();
        existing.auditTrail.push({
          action: "COMPLETED",
          at:     new Date(),
          byUserId: _asObjectId(me._id),
          byName:   me.fullName,
          byRole:   me.role,
          notes:   `transition Scheduled→Completed via procedureNoteId=${noteDoc._id}`,
        });
        await existing.save();
      } else {
        // No Scheduled row found — fall back to emit, which writes a
        // Completed row by sourceRef=procedureNote._id.
        emitOT({
          procedureNote: noteDoc.toObject(),
          patient:       patient || {},
          admission,
          actor:         req.user || {},
        }).catch((e) => {
          // eslint-disable-next-line no-console
          console.error("[procedure-notes] fallback emitOT error:", e?.message);
        });
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[procedure-notes] OT register transition FAILED:", e?.message, "— noteId:", noteDoc._id);
    }

    return res.status(201).json({ success: true, data: noteDoc });
  } catch (e) {
    if (e?.code === 11000) {
      return res.status(409).json({
        success: false,
        code: "ALREADY_EXISTS",
        message: "A procedure note already exists for this order",
      });
    }
    if (e?.name === "ValidationError") {
      return res.status(400).json({ success: false, code: "ARG_INVALID", message: e.message });
    }
    next(e);
  }
};

// ─────────────────────────────────────────────────────────────────────
// GET /api/procedure-notes
//   ?doctorOrderId= | ?UHID= | ?admissionId= | ?from= | ?to= | ?limit=
// ─────────────────────────────────────────────────────────────────────
exports.list = async (req, res, next) => {
  try {
    const q = {};
    if (req.query?.doctorOrderId && mongoose.isValidObjectId(req.query.doctorOrderId)) {
      q.doctorOrderId = req.query.doctorOrderId;
    }
    if (req.query?.UHID)        q.UHID = String(req.query.UHID).toUpperCase();
    if (req.query?.admissionId && mongoose.isValidObjectId(req.query.admissionId)) {
      q.admissionId = req.query.admissionId;
    }
    if (req.query?.from || req.query?.to) {
      q.createdAt = {};
      if (req.query.from) q.createdAt.$gte = new Date(req.query.from);
      if (req.query.to)   q.createdAt.$lte = new Date(req.query.to);
    }
    const limit = Math.min(Number(req.query?.limit) || 100, 500);
    const data = await ProcedureNote.find(q).sort({ createdAt: -1 }).limit(limit).lean();
    return res.json({ success: true, data, meta: { count: data.length } });
  } catch (e) { next(e); }
};

// ─────────────────────────────────────────────────────────────────────
// GET /api/procedure-notes/:id
// ─────────────────────────────────────────────────────────────────────
exports.getOne = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, code: "ARG_INVALID", message: "Invalid id" });
    }
    const doc = await ProcedureNote.findById(req.params.id).lean();
    if (!doc) return res.status(404).json({ success: false, code: "NOT_FOUND", message: "Procedure note not found" });
    return res.json({ success: true, data: doc });
  } catch (e) { next(e); }
};

// ─────────────────────────────────────────────────────────────────────
// GET /api/procedure-notes/order/:orderId
//   Convenience lookup — returns the (at most one) note for a given
//   DoctorOrder. 404 if none exists (the OT case is still Scheduled).
// ─────────────────────────────────────────────────────────────────────
exports.getByOrder = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.orderId)) {
      return res.status(400).json({ success: false, code: "ARG_INVALID", message: "Invalid orderId" });
    }
    const doc = await ProcedureNote.findOne({ doctorOrderId: req.params.orderId }).lean();
    if (!doc) return res.status(404).json({ success: false, code: "NOT_FOUND", message: "No procedure note for this order" });
    return res.json({ success: true, data: doc });
  } catch (e) { next(e); }
};
