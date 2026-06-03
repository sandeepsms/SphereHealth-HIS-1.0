/**
 * medicationerrorRegisterRoutes.js — R7gw-B9-T04 / NABH MOM.4
 *
 * Surveyor + compliance-officer read/write surface for the Medication-Error
 * Register. Mounted at /api/registers/nabh/medication-error (see
 * Backend/routes/index.js wiring).
 *
 *   GET  /        — list rows; filters: q (text), status, startDate, endDate, UHID, severity
 *   GET  /:id     — single row
 *   POST /        — manual entry (Admin / Compliance Officer); pipes through
 *                   emitMedicationError so severity E-I auto-emits Sentinel
 *
 * Reads gated on compliance.read (Admin / Doctor / Nurse / MRD).
 * Writes gated on compliance.firedrill.write equivalent — but since no
 * compliance.nabh.write exists today, we use compliance.firedrill.write
 * (Admin + Security) until permissions.js gets a dedicated nabh.write
 * action. Manual entries from clinical roles flow via mar.write through
 * the MAR controller's emit chain.
 */
"use strict";

const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const { requireAction } = require("../../../middleware/auth");
const { validateObjectIdParam } = require("../../../utils/queryGuards");
const MedicationErrorRegister = require("../../../models/Compliance/MedicationErrorRegisterModel");
const { emitMedicationError } = require("../../../services/Compliance/nabhRegisterEmitter");

// ─────────────────────────────────────────────────────────────────────────
// GET / — list with filters
// ─────────────────────────────────────────────────────────────────────────
router.get(
  "/",
  requireAction("compliance.read"),
  async (req, res) => {
    try {
      const { q, status, startDate, endDate, UHID, severity, limit = 200 } = req.query;
      const filter = {};
      if (status) filter.status = status;
      if (severity) filter.severityNCC = String(severity).toUpperCase();
      if (UHID) filter.UHID = String(UHID).toUpperCase().trim();
      if (startDate || endDate) {
        filter.reportedAt = {};
        if (startDate) filter.reportedAt.$gte = new Date(startDate);
        if (endDate) {
          const end = new Date(endDate);
          end.setHours(23, 59, 59, 999);
          filter.reportedAt.$lte = end;
        }
      }
      if (q) {
        const rx = new RegExp(String(q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
        filter.$or = [
          { medicationName: rx },
          { patientName: rx },
          { actionTakenImmediate: rx },
          { rootCause: rx },
          { investigationNotes: rx },
        ];
      }
      const lim = Math.min(Number(limit) || 200, 500);
      const rows = await MedicationErrorRegister.find(filter)
        .sort({ reportedAt: -1, createdAt: -1 })
        .limit(lim)
        .lean();
      return res.json({ ok: true, data: rows, count: rows.length });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[medicationerrorRegisterRoutes] GET / failed:", e.message);
      return res.status(500).json({ ok: false, message: "Failed to list medication errors" });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────
// GET /:id — single row
// ─────────────────────────────────────────────────────────────────────────
router.get(
  "/:id",
  validateObjectIdParam("id"),
  requireAction("compliance.read"),
  async (req, res) => {
    try {
      const row = await MedicationErrorRegister.findById(req.params.id).lean();
      if (!row) return res.status(404).json({ ok: false, message: "Not found" });
      return res.json({ ok: true, data: row });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[medicationerrorRegisterRoutes] GET /:id failed:", e.message);
      return res.status(500).json({ ok: false, message: "Failed to load medication error" });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────
// POST / — manual entry (gated on mar.write — same tier that records
// administration. Surveyors and compliance officers also have it via
// their Admin role in permissions.js.)
// ─────────────────────────────────────────────────────────────────────────
router.post(
  "/",
  requireAction("mar.write"),
  async (req, res) => {
    try {
      const body = req.body || {};
      if (!body.UHID) {
        return res.status(400).json({ ok: false, message: "UHID is required" });
      }
      if (!body.errorPhase || !body.severityNCC) {
        return res.status(400).json({ ok: false, message: "errorPhase and severityNCC are required" });
      }
      const row = await emitMedicationError({
        patient: {
          _id: body.patientId || null,
          UHID: body.UHID,
          fullName: body.patientName || "",
        },
        admission: body.admissionId ? { _id: body.admissionId, admissionNumber: body.admissionNumber || "" } : null,
        error: {
          errorPhase: body.errorPhase,
          medicationName: body.medicationName,
          expectedDose: body.expectedDose,
          actualDose: body.actualDose,
          expectedRoute: body.expectedRoute,
          actualRoute: body.actualRoute,
          severityNCC: body.severityNCC,
          actionTakenImmediate: body.actionTakenImmediate,
          patientHarm: body.patientHarm,
          reportedByEmpId: body.reportedByEmpId,
          reportedByName: body.reportedByName,
          reportedAt: body.reportedAt,
          sourceType: body.sourceType || "Manual",
          sourceRef: body.sourceRef,
        },
        actor: req.user || {},
      });
      if (!row) {
        return res.status(500).json({ ok: false, message: "Failed to record medication error" });
      }
      return res.status(201).json({ ok: true, data: row });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[medicationerrorRegisterRoutes] POST / failed:", e.message);
      return res.status(500).json({ ok: false, message: "Failed to record medication error" });
    }
  },
);

module.exports = router;
