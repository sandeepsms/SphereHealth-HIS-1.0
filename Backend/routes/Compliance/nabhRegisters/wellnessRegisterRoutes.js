/**
 * wellnessRegisterRoutes.js — R7gw-B10-T04 / NABH HRM.6
 *
 * Staff Wellness Programme register write + read surface.
 *
 * Endpoints under /api/nabh-registers/wellness:
 *   GET  /            — list rows with q (free-text) / type / status / dateRange filters
 *   GET  /:id         — single row
 *   POST /            — HR / Wellness committee manual entry from page UI
 *
 * Permissions:
 *   reads gated on `compliance.nabh.read`;
 *   writes gated on `compliance.nabh.write`.
 *
 * Writes call emitWellnessProgram from nabhRegisterEmitter so the row goes
 * through the same idempotency / audit-trail path as any future auto-emit.
 */
"use strict";

const express = require("express");
const router = express.Router();
const { requireAction } = require("../../../middleware/auth");
const { validateObjectIdParam } = require("../../../utils/queryGuards");
const WellnessProgramRegister = require("../../../models/Compliance/WellnessProgramRegisterModel");
const { emitWellnessProgram } = require("../../../services/Compliance/nabhRegisterEmitter");

// ── GET / — list with filters ─────────────────────────────────────
router.get(
  "/",
  requireAction("compliance.nabh.read"),
  async (req, res) => {
    try {
      const {
        q = "",
        status = "",
        type = "",
        facilitator = "",
        startDate = "",
        endDate = "",
        limit = "200",
      } = req.query || {};

      const filter = {};
      if (status) filter.status = status;
      if (type) filter.type = type;
      if (facilitator) filter.facilitator = facilitator;

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
          { programName: qre },
          { topic: qre },
          { facilitator: qre },
          { notes: qre },
        ];
      }

      const cap = Math.max(1, Math.min(Number(limit) || 200, 1000));
      const rows = await WellnessProgramRegister
        .find(filter)
        .sort({ sessionDate: -1 })
        .limit(cap)
        .lean();

      return res.json({ data: rows, count: rows.length });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[wellnessRegisterRoutes] list failed:", e.message);
      return res.status(500).json({ message: e.message || "Failed to list wellness-program register" });
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
      const row = await WellnessProgramRegister.findById(req.params.id).lean();
      if (!row) return res.status(404).json({ message: "Not found" });
      return res.json({ data: row });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[wellnessRegisterRoutes] getById failed:", e.message);
      return res.status(500).json({ message: e.message || "Failed to load row" });
    }
  },
);

// ── POST / — manual HR/Wellness committee entry ──────────────────
router.post(
  "/",
  requireAction("compliance.nabh.write"),
  async (req, res) => {
    try {
      const body = req.body || {};
      if (!body.programName) {
        return res.status(400).json({ message: "programName is required" });
      }
      if (!body.type) {
        return res.status(400).json({ message: "type is required" });
      }
      if (!body.sessionDate) {
        return res.status(400).json({ message: "sessionDate is required" });
      }
      if (!body.topic) {
        return res.status(400).json({ message: "topic is required" });
      }
      if (!body.facilitator) {
        return res.status(400).json({ message: "facilitator is required" });
      }

      // Coerce participantEmpIds — may arrive as a CSV string from a textarea
      let participants = body.participantEmpIds;
      if (typeof participants === "string") {
        participants = participants.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
      } else if (!Array.isArray(participants)) {
        participants = [];
      }

      const row = await emitWellnessProgram({
        session: {
          programName: body.programName,
          type: body.type,
          sessionDate: body.sessionDate,
          participantEmpIds: participants,
          topic: body.topic,
          facilitator: body.facilitator,
          feedbackScore: body.feedbackScore,
          notes: body.notes || "",
          status: body.status || "Completed",
          sourceRef: body.sourceRef || "",   // empty → emit will generate UUID
          sourceType: "Manual",
          hospitalId: body.hospitalId || null,
        },
        actor: req.user || {},
      });

      if (!row) return res.status(400).json({ message: "Failed to record wellness session" });
      return res.status(201).json({ data: row });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[wellnessRegisterRoutes] create failed:", e.message);
      return res.status(500).json({ message: e.message || "Failed to create row" });
    }
  },
);

module.exports = router;
