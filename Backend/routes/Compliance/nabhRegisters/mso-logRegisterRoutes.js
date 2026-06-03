/**
 * mso-logRegisterRoutes.js — R7gw-B10-T02 / NABH PRE.1
 *
 * Medical Social Officer (MSO) session log register — write + read surface.
 *
 * Endpoints under /api/nabh-registers/mso-log:
 *   GET  /            — list rows with q (free-text) / sessionType / outcome
 *                       / followUpNeeded / status / dateRange filters
 *   GET  /:id         — single row
 *   POST /            — MSO manual session entry (post-encounter)
 *
 * Permissions:
 *   reads gated on `compliance.nabh.read` (Admin / Doctor / Nurse / MRD /
 *                                           ComplianceOfficer / MSO);
 *   writes gated on `compliance.nabh.write` (Admin / ComplianceOfficer / MSO).
 *
 * Writes call emitMSOLog from nabhRegisterEmitter so the row goes through
 * the same idempotency / audit-trail path as auto-emitted register rows.
 */
"use strict";

const express = require("express");
const router = express.Router();
const { requireAction } = require("../../../middleware/auth");
const { validateObjectIdParam } = require("../../../utils/queryGuards");
const MSOLogRegister = require("../../../models/Compliance/MSOLogRegisterModel");
const { emitMSOLog } = require("../../../services/Compliance/nabhRegisterEmitter");

// ── GET / — list with filters ─────────────────────────────────────
router.get(
  "/",
  requireAction("compliance.nabh.read"),
  async (req, res) => {
    try {
      const {
        q = "",
        status = "",
        sessionType = "",
        outcome = "",
        followUpNeeded = "",
        socialWorkerEmpId = "",
        startDate = "",
        endDate = "",
        UHID = "",
        limit = "200",
      } = req.query || {};

      const filter = {};
      if (status) filter.status = status;
      if (sessionType) filter.sessionType = sessionType;
      if (outcome) filter.outcome = outcome;
      if (followUpNeeded === "true") filter.followUpNeeded = true;
      else if (followUpNeeded === "false") filter.followUpNeeded = false;
      if (socialWorkerEmpId) filter.socialWorkerEmpId = socialWorkerEmpId;
      if (UHID) filter.UHID = String(UHID).toUpperCase();

      if (startDate || endDate) {
        filter.sessionDate = {};
        if (startDate) filter.sessionDate.$gte = new Date(startDate);
        if (endDate) {
          const end = new Date(endDate);
          end.setHours(23, 59, 59, 999);
          filter.sessionDate.$lte = end;
        }
      }

      if (q) {
        const qre = new RegExp(String(q).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
        filter.$or = [
          { concernAddressed: qre },
          { notes: qre },
          { referredTo: qre },
          { socialWorkerName: qre },
          { socialWorkerEmpId: qre },
          { patientName: qre },
          { UHID: qre },
          { admissionNumber: qre },
        ];
      }

      const cap = Math.max(1, Math.min(Number(limit) || 200, 1000));
      const rows = await MSOLogRegister
        .find(filter)
        .sort({ sessionDate: -1 })
        .limit(cap)
        .lean();

      return res.json({ data: rows, count: rows.length });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[mso-logRegisterRoutes] list failed:", e.message);
      return res.status(500).json({ message: e.message || "Failed to list MSO log register" });
    }
  },
);

// ── GET /:id ──────────────────────────────────────────────────────
router.get(
  "/:id",
  validateObjectIdParam("id"),
  requireAction("compliance.nabh.read"),
  async (req, res) => {
    try {
      const row = await MSOLogRegister.findById(req.params.id).lean();
      if (!row) return res.status(404).json({ message: "Not found" });
      return res.json({ data: row });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[mso-logRegisterRoutes] getById failed:", e.message);
      return res.status(500).json({ message: e.message || "Failed to load row" });
    }
  },
);

// ── POST / — manual MSO session entry ─────────────────────────────
router.post(
  "/",
  requireAction("compliance.nabh.write"),
  async (req, res) => {
    try {
      const body = req.body || {};
      if (!body.UHID) {
        return res.status(400).json({ message: "UHID is required" });
      }
      if (!body.sessionType) {
        return res.status(400).json({ message: "sessionType is required" });
      }
      if (!body.outcome) {
        return res.status(400).json({ message: "outcome is required" });
      }

      const row = await emitMSOLog({
        session: {
          UHID: body.UHID,
          patientId: body.patientId || null,
          patientName: body.patientName || "",
          admissionId: body.admissionId || null,
          admissionNumber: body.admissionNumber || "",
          sessionDate: body.sessionDate || new Date(),
          sessionType: body.sessionType,
          duration: body.duration,
          concernAddressed: body.concernAddressed || "",
          outcome: body.outcome,
          followUpNeeded: !!body.followUpNeeded,
          followUpDate: body.followUpDate || null,
          referredTo: body.referredTo || "",
          socialWorkerEmpId: body.socialWorkerEmpId || "",
          socialWorkerName: body.socialWorkerName || "",
          notes: body.notes || "",
          status: body.status || "Closed",
          sourceRef: body.sourceRef || "",
          sourceType: "Manual",
          hospitalId: body.hospitalId || null,
        },
        actor: req.user || {},
      });

      if (!row) return res.status(400).json({ message: "Failed to record MSO session" });
      return res.status(201).json({ data: row });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[mso-logRegisterRoutes] create failed:", e.message);
      return res.status(500).json({ message: e.message || "Failed to create row" });
    }
  },
);

module.exports = router;
