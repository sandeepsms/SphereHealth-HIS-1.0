/**
 * handhygieneRegisterRoutes.js — R7gw-B9-B9-T06 / NABH HIC.3
 *
 * Hand Hygiene Compliance register write + read surface.
 *
 * Endpoints under /api/registers/nabh/handhygiene:
 *   GET  /            — list rows with q (free-text) / status / dateRange filters
 *   GET  /:id         — single row
 *   POST /            — IC officer manual entry (mobile-friendly observation form)
 *
 * Permissions:
 *   reads gated on `compliance.nabh.read` (Admin + Doctor + Nurse + MRD +
 *                                          ComplianceOfficer — falls back to
 *                                          `compliance.read` on permission systems
 *                                          that don't have the nabh-specific token);
 *   writes gated on `compliance.nabh.write` (Admin + ComplianceOfficer + IC Nurse).
 *
 * Writes call emitHandHygiene from nabhRegisterEmitter so the row goes
 * through the same idempotency / audit-trail path as auto-emitted rows.
 */
"use strict";

const express = require("express");
const router = express.Router();
const { requireAction } = require("../../../middleware/auth");
const { validateObjectIdParam } = require("../../../utils/queryGuards");
const HandHygieneRegister = require("../../../models/Compliance/HandHygieneRegisterModel");
const { emitHandHygiene } = require("../../../services/Compliance/nabhRegisterEmitter");

// ── GET / — list with filters ─────────────────────────────────────
router.get(
  "/",
  requireAction("compliance.nabh.read"),
  async (req, res) => {
    try {
      const {
        q = "",
        status = "",
        ward = "",
        role = "",
        moment = "",
        compliedOnly = "",
        startDate = "",
        endDate = "",
        UHID = "",
        limit = "200",
      } = req.query || {};

      const filter = {};
      if (status) filter.status = status;
      if (ward) filter.ward = ward;
      if (role) filter.role = role;
      if (moment) filter.moment = moment;
      if (compliedOnly === "true") filter.complied = true;
      if (UHID) filter.UHID = String(UHID).toUpperCase();

      if (startDate || endDate) {
        filter.observedAt = {};
        if (startDate) filter.observedAt.$gte = new Date(startDate);
        if (endDate) {
          const end = new Date(endDate);
          end.setHours(23, 59, 59, 999);
          filter.observedAt.$lte = end;
        }
      }

      if (q) {
        const qre = new RegExp(String(q).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
        filter.$or = [
          { ward: qre },
          { notes: qre },
          { observedByName: qre },
          { observedByEmpId: qre },
          { patientName: qre },
          { UHID: qre },
        ];
      }

      const cap = Math.max(1, Math.min(Number(limit) || 200, 1000));
      const rows = await HandHygieneRegister
        .find(filter)
        .sort({ observedAt: -1 })
        .limit(cap)
        .lean();

      return res.json({ data: rows, count: rows.length });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[handhygieneRegisterRoutes] list failed:", e.message);
      return res.status(500).json({ message: e.message || "Failed to list hand-hygiene register" });
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
      const row = await HandHygieneRegister.findById(req.params.id).lean();
      if (!row) return res.status(404).json({ message: "Not found" });
      return res.json({ data: row });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[handhygieneRegisterRoutes] getById failed:", e.message);
      return res.status(500).json({ message: e.message || "Failed to load row" });
    }
  },
);

// ── POST / — manual IC officer entry ──────────────────────────────
router.post(
  "/",
  requireAction("compliance.nabh.write"),
  async (req, res) => {
    try {
      const body = req.body || {};
      if (!body.role || !body.moment) {
        return res.status(400).json({ message: "role and moment are required" });
      }
      if (typeof body.complied !== "boolean") {
        return res.status(400).json({ message: "complied (boolean) is required" });
      }

      const row = await emitHandHygiene({
        observation: {
          UHID: body.UHID || "",
          patientId: body.patientId || null,
          patientName: body.patientName || "",
          admissionId: body.admissionId || null,
          observedAt: body.observedAt || new Date(),
          observedByEmpId: body.observedByEmpId || "",
          observedByName: body.observedByName || "",
          ward: body.ward || "",
          role: body.role,
          moment: body.moment,
          complied: !!body.complied,
          technique: body.technique || "",
          notes: body.notes || "",
          status: body.status || "Closed",
          sourceRef: body.sourceRef || "",   // empty → emit will generate UUID
          sourceType: "Manual",
          hospitalId: body.hospitalId || null,
        },
        actor: req.user || {},
      });

      if (!row) return res.status(400).json({ message: "Failed to record observation" });
      return res.status(201).json({ data: row });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[handhygieneRegisterRoutes] create failed:", e.message);
      return res.status(500).json({ message: e.message || "Failed to create row" });
    }
  },
);

module.exports = router;
