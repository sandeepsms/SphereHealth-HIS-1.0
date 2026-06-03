/**
 * antibiogramRegisterRoutes.js — R7gw-B10-T01 / NABH HIC.6
 *
 * Antibiogram register write + read surface.
 *
 * Endpoints under /api/registers/nabh/antibiogram:
 *   GET  /            — list rows with q (free-text) / organism / ward /
 *                       period / sampleType filters + date-range
 *   GET  /:id         — single row
 *   POST /            — AMSC / IC officer manual entry (one row per
 *                       organism × period × ward × sampleType cohort)
 *
 * Permissions:
 *   reads gated on `compliance.nabh.read` (Admin + Doctor + Nurse + MRD +
 *                                          ComplianceOfficer + ICOfficer);
 *   writes gated on `compliance.nabh.write` (Admin + ComplianceOfficer +
 *                                            ICOfficer / Microbiologist).
 *
 * Writes call emitAntibiogram from nabhRegisterEmitter so the row goes
 * through the same idempotency / audit-trail path as auto-generated rows.
 */
"use strict";

const express = require("express");
const router = express.Router();
const { requireAction } = require("../../../middleware/auth");
const { validateObjectIdParam } = require("../../../utils/queryGuards");
const AntibiogramRegister = require("../../../models/Compliance/AntibiogramRegisterModel");
const { emitAntibiogram } = require("../../../services/Compliance/nabhRegisterEmitter");

// ── GET / — list with filters ─────────────────────────────────────
router.get(
  "/",
  requireAction("compliance.nabh.read"),
  async (req, res) => {
    try {
      const {
        q = "",
        status = "",
        organism = "",
        ward = "",
        period = "",
        sampleType = "",
        startDate = "",
        endDate = "",
        limit = "200",
      } = req.query || {};

      const filter = {};
      if (status) filter.status = status;
      if (organism) filter.organism = organism;
      if (ward) filter.ward = ward;
      if (period) filter.period = period;
      if (sampleType) filter.sampleType = sampleType;

      if (startDate || endDate) {
        filter.isolatedAt = {};
        if (startDate) filter.isolatedAt.$gte = new Date(startDate);
        if (endDate) {
          const end = new Date(endDate);
          end.setHours(23, 59, 59, 999);
          filter.isolatedAt.$lte = end;
        }
      }

      if (q) {
        const qre = new RegExp(String(q).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
        filter.$or = [
          { organism: qre },
          { ward: qre },
          { period: qre },
          { notes: qre },
          { sampleType: qre },
        ];
      }

      const cap = Math.max(1, Math.min(Number(limit) || 200, 1000));
      const rows = await AntibiogramRegister
        .find(filter)
        .sort({ isolatedAt: -1, createdAt: -1 })
        .limit(cap)
        .lean();

      return res.json({ data: rows, count: rows.length });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[antibiogramRegisterRoutes] list failed:", e.message);
      return res.status(500).json({ message: e.message || "Failed to list antibiogram register" });
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
      const row = await AntibiogramRegister.findById(req.params.id).lean();
      if (!row) return res.status(404).json({ message: "Not found" });
      return res.json({ data: row });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[antibiogramRegisterRoutes] getById failed:", e.message);
      return res.status(500).json({ message: e.message || "Failed to load row" });
    }
  },
);

// ── POST / — manual AMSC / IC officer entry ───────────────────────
router.post(
  "/",
  requireAction("compliance.nabh.write"),
  async (req, res) => {
    try {
      const body = req.body || {};
      if (!body.organism || !String(body.organism).trim()) {
        return res.status(400).json({ message: "organism is required" });
      }

      const row = await emitAntibiogram({
        organism: body.organism,
        isolatedAt: body.isolatedAt || null,
        ward: body.ward || "",
        sampleType: body.sampleType || "Other",
        sensitivityProfile: body.sensitivityProfile || {},
        recommendedFirstLine: Array.isArray(body.recommendedFirstLine) ? body.recommendedFirstLine : [],
        recommendedSecondLine: Array.isArray(body.recommendedSecondLine) ? body.recommendedSecondLine : [],
        period: body.period || "",
        totalIsolates: body.totalIsolates || 0,
        notes: body.notes || "",
        status: body.status || "Closed",
        sourceRef: body.sourceRef || "",   // empty → emitter generates UUID
        sourceType: "Manual",
        hospitalId: body.hospitalId || null,
        actor: req.user || {},
      });

      if (!row) return res.status(400).json({ message: "Failed to record antibiogram row" });
      return res.status(201).json({ data: row });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[antibiogramRegisterRoutes] create failed:", e.message);
      return res.status(500).json({ message: e.message || "Failed to create row" });
    }
  },
);

module.exports = router;
