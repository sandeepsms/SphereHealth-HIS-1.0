/**
 * restraintController.js — R7du / NABH COP.17
 *
 * Thin write surface for the Restraint Register. The data model
 * (RestraintRegisterModel) and the emit helper
 * (nabhRegisterEmitter.emitRestraint) were scaffolded in R7bu; this
 * controller finally hooks them up to a callable route so the nurse-
 * side UI can record an episode.
 *
 * Endpoints (mounted at /api/restraints):
 *   POST /                 — Record a new restraint episode. Looks up
 *                            patient + admission by UHID and calls
 *                            emitRestraint(). Returns the created row.
 *   GET  /:uhid            — List restraint episodes for a UHID
 *                            (Active + history). Used by the nurse-side
 *                            page's "Active restraints" + "History" panels.
 *   PATCH /:id/remove      — Mark an active restraint as Removed.
 *                            Body: { removedAt, removedReason }
 *   POST /:id/monitor      — Append a monitoring entry to monitoringLog.
 *                            Body: { status, notes }
 *
 * Discovery: explicit emitRestraint() call from this controller. Mirrors
 * the patterns in fireDrillController + the auto-emit calls from
 * nursingAssessmentsRoutes (DVT / Pain / Fall fan-out).
 *
 * Permission: writes gated on `mar.write` (Admin + Nurse) — restraint
 * application is a bedside-nurse action triggered by a doctor's plain-
 * text nursing-communication order. Reads on `mar.read` so MRD + cross-
 * cover Doctor see the trail.
 */
"use strict";

const mongoose = require("mongoose");
const crypto = require("crypto");
const RestraintRegister = require("../../models/Compliance/RestraintRegisterModel");
const Patient = require("../../models/Patient/patientModel");
const Admission = require("../../models/Patient/admissionModel");
const { emitRestraint } = require("../../services/Compliance/nabhRegisterEmitter");

const _actor = (req) => ({
  _id:      req.user?._id || req.user?.id || null,
  fullName: req.user?.fullName || req.user?.name || "",
  role:     req.user?.role || "",
});

/**
 * POST /api/restraints
 * Body: {
 *   UHID, restraintType, restraintDevice[], chemicalAgent,
 *   reason, reasonCategory, startTime, monitoringFrequency,
 *   orderingDoctor, alternativesTried[], consentObtained,
 *   consentFrom, appliedBy
 * }
 */
exports.create = async (req, res) => {
  try {
    const body = req.body || {};
    const sourceRef = req.body.sourceRef || crypto.randomUUID();
    const UHID = String(body.UHID || "").trim().toUpperCase();
    if (!UHID) return res.status(400).json({ success: false, message: "UHID is required" });
    if (!body.restraintType) return res.status(400).json({ success: false, message: "restraintType is required (physical/chemical/both)" });
    if (!body.reason || !String(body.reason).trim()) return res.status(400).json({ success: false, message: "reason is required" });
    if (!body.startTime) return res.status(400).json({ success: false, message: "startTime is required" });

    // Lookup patient (required for emitRestraint to fire)
    const patient = await Patient.findOne({ UHID }).select("_id UHID fullName firstName lastName gender age").lean();
    if (!patient) return res.status(404).json({ success: false, message: `No patient found for UHID ${UHID}` });

    // Lookup the patient's CURRENT active admission. emitRestraint will
    // canonicalise again internally — we pass our best guess so the
    // emitter has something to attach.
    const admission = await Admission.findOne({ UHID, status: "Active" })
      .select("_id admissionNumber ward wardName")
      .sort({ admissionDate: -1 })
      .lean();
    if (!admission) return res.status(404).json({ success: false, message: `No active admission for UHID ${UHID}` });

    // Prepare the restraint payload in the shape emitRestraint expects.
    const restraintPayload = {
      type: String(body.restraintType).toLowerCase(),                // physical / chemical / both
      device: Array.isArray(body.restraintDevice) ? body.restraintDevice : (body.restraintDevice ? [body.restraintDevice] : []),
      chemicalAgent: body.chemicalAgent || "",
      reason: String(body.reason).trim(),
      reasonCategory: body.reasonCategory || "Safety",
      startTime: body.startTime,
      endTime: body.endTime || null,
      monitoringFrequency: body.monitoringFrequency || (body.restraintType === "chemical" ? "q15min" : "q30min"),
      orderingDoctor: body.orderingDoctor || "",
      orderingDoctorId: body.orderingDoctorId || null,
      orderingDoctorRole: body.orderingDoctorRole || "Doctor",
      appliedBy: body.appliedBy || _actor(req).fullName,
      consentObtained: !!body.consentObtained,
      consentFrom: body.consentFrom || "",
      sourceType: "NurseEntry",
      // R7gv / B6-T09-A — sourceRef now always present (client-supplied or
      // server-generated UUID). emitRestraint dedups on (sourceType,
      // sourceRef) so double-submits from a flaky network or an over-eager
      // submit button no longer create duplicate Active rows.
      sourceRef,
    };

    const row = await emitRestraint({
      restraint: restraintPayload,
      patient,
      admission,
      actor: req.user || {},
    });

    if (!row) {
      // emitRestraint returns null on validation failure or DB error; it
      // already logged to stderr. Surface a 400 so the form shows an
      // actionable error rather than a silent no-op.
      return res.status(400).json({
        success: false,
        message: "Failed to record restraint episode — check that type, reason, and startTime are valid",
      });
    }

    // R7du — capture the alternativesTried + adverseEvent fields on the row
    // post-create. emitRestraint() doesn't write these because the model
    // schema doesn't include alternativesTried — we stash it inside
    // adverseEventNotes prefix to keep surveyor trace without a schema
    // migration. (Treat as a documentation freeform.)
    if (Array.isArray(body.alternativesTried) && body.alternativesTried.length) {
      try {
        await RestraintRegister.updateOne(
          { _id: row._id },
          { $set: { adverseEventNotes: `Alternatives tried before restraint: ${body.alternativesTried.join(", ")}` } },
        );
      } catch (_) { /* non-fatal */ }
    }

    return res.status(201).json({ success: true, data: row });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

/**
 * GET /api/restraints/:uhid
 * List restraint episodes for a UHID, newest first. Used by the
 * nurse-side page's "Active restraints" + "History" panels.
 */
exports.listByUhid = async (req, res) => {
  try {
    const uhid = String(req.params.uhid || "").trim().toUpperCase();
    if (!uhid) return res.status(400).json({ success: false, message: "UHID is required" });

    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const rows = await RestraintRegister.find({ UHID: uhid })
      .sort({ startTime: -1, createdAt: -1 })
      .limit(limit)
      .lean();
    return res.json({ success: true, count: rows.length, data: rows });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

/**
 * PATCH /api/restraints/:id/remove
 * Mark an active restraint as Removed.
 * Body: { removedAt?, removalReason }
 */
exports.markRemoved = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }
    const doc = await RestraintRegister.findById(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: "Restraint episode not found" });
    if (doc.status !== "Active") {
      return res.status(409).json({ success: false, message: `Cannot remove — current status is ${doc.status}` });
    }

    const u = _actor(req);
    const removedAt = req.body?.removedAt ? new Date(req.body.removedAt) : new Date();
    const removalReason = String(req.body?.removalReason || "No longer indicated").slice(0, 500);

    doc.removedAt = removedAt;
    doc.removedBy = req.body?.removedBy || u.fullName;
    doc.removedByUserId = u._id;
    doc.removalReason = removalReason;
    doc.endTime = removedAt;
    if (doc.startTime) {
      const mins = Math.max(0, Math.round((removedAt.getTime() - new Date(doc.startTime).getTime()) / 60000));
      doc.durationMinutes = mins;
    }
    doc.status = "Removed";
    doc.auditTrail.push({
      action: "REMOVED",
      at: removedAt,
      byUserId: u._id,
      byName: u.fullName,
      byRole: u.role,
      notes: removalReason,
    });
    await doc.save();
    return res.json({ success: true, data: doc });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

/**
 * POST /api/restraints/:id/monitor
 * Append a monitoring entry to monitoringLog.
 * Body: { status, notes }
 */
exports.addMonitoringEntry = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }
    const doc = await RestraintRegister.findById(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: "Restraint episode not found" });
    if (doc.status !== "Active") {
      return res.status(409).json({ success: false, message: `Cannot add monitoring — status is ${doc.status}` });
    }

    const u = _actor(req);
    doc.monitoringLog.push({
      at: new Date(),
      status: String(req.body?.status || "").slice(0, 200),
      byUserId: u._id,
      byName: u.fullName,
      notes: String(req.body?.notes || "").slice(0, 500),
    });
    doc.auditTrail.push({
      action: "MONITORED",
      at: new Date(),
      byUserId: u._id,
      byName: u.fullName,
      byRole: u.role,
      notes: String(req.body?.status || "").slice(0, 200),
    });
    await doc.save();
    return res.json({ success: true, data: doc });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
};
