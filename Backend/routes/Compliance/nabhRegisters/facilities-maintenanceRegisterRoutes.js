/**
 * facilities-maintenanceRegisterRoutes.js — R7gw-B10-T06 / NABH FMS.5
 *
 * Facilities & Equipment Maintenance Log register write + read surface.
 *
 * Endpoints under /api/nabh-registers/facilities-maintenance:
 *   GET  /            — list rows with q (free-text) / status / equipmentType
 *                       / jobType / equipmentId / date-range filters
 *   GET  /:id         — single row
 *   POST /            — engineering / biomedical / facilities staff manual entry
 *
 * Permissions:
 *   reads gated on `compliance.nabh.read`;
 *   writes gated on `compliance.nabh.write`.
 *
 * Writes call emitFacilitiesMaintenanceLog from nabhRegisterEmitter so the
 * row goes through the same idempotency / audit-trail path as auto-emitted
 * rows (no auto-trigger today; reserved for a future PPM-schedule cron).
 */
"use strict";

const express = require("express");
const router = express.Router();
const { requireAction } = require("../../../middleware/auth");
const { validateObjectIdParam } = require("../../../utils/queryGuards");
const FacilitiesMaintenanceLogRegister = require("../../../models/Compliance/FacilitiesMaintenanceLogRegisterModel");
const { emitFacilitiesMaintenanceLog } = require("../../../services/Compliance/nabhRegisterEmitter");

const EQUIPMENT_TYPES = [
  "BMS", "Generator", "Fire-System", "Lift", "Biomedical",
  "HVAC", "MedGas", "UPS", "Steam-Boiler",
];
const JOB_TYPES = ["PPM", "Corrective", "Calibration", "AMC", "Breakdown", "Inspection"];
const STATUSES = ["Scheduled", "Done", "Overdue", "Cancelled"];

// ── GET / — list with filters ─────────────────────────────────────
router.get(
  "/",
  requireAction("compliance.nabh.read"),
  async (req, res) => {
    try {
      const {
        q = "",
        status = "",
        equipmentType = "",
        equipmentId = "",
        jobType = "",
        overdueOnly = "",
        startDate = "",
        endDate = "",
        limit = "300",
      } = req.query || {};

      const filter = {};
      if (status && STATUSES.includes(status)) filter.status = status;
      if (equipmentType && EQUIPMENT_TYPES.includes(equipmentType)) filter.equipmentType = equipmentType;
      if (equipmentId) filter.equipmentId = String(equipmentId).trim();
      if (jobType && JOB_TYPES.includes(jobType)) filter.jobType = jobType;
      if (overdueOnly === "true") {
        // server-side "overdue": status not Done/Cancelled AND nextDueDate < now
        filter.status = { $nin: ["Done", "Cancelled"] };
        filter.nextDueDate = { $lt: new Date() };
      }

      if (startDate || endDate) {
        filter.scheduledAt = {};
        if (startDate) filter.scheduledAt.$gte = new Date(startDate);
        if (endDate) {
          const end = new Date(endDate);
          end.setHours(23, 59, 59, 999);
          filter.scheduledAt.$lte = end;
        }
      }

      if (q) {
        const qre = new RegExp(String(q).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
        filter.$or = [
          { equipmentId:      qre },
          { equipmentName:    qre },
          { location:         qre },
          { findings:         qre },
          { correctiveAction: qre },
          { vendor:           qre },
          { amcContractRef:   qre },
          { performedByName:  qre },
          { performedByEmpId: qre },
        ];
      }

      const cap = Math.max(1, Math.min(Number(limit) || 300, 1000));
      const rows = await FacilitiesMaintenanceLogRegister
        .find(filter)
        .sort({ scheduledAt: -1, createdAt: -1 })
        .limit(cap)
        .lean();

      return res.json({ data: rows, count: rows.length });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[facilities-maintenanceRegisterRoutes] list failed:", e.message);
      return res.status(500).json({ message: e.message || "Failed to list Facilities Maintenance register" });
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
      const row = await FacilitiesMaintenanceLogRegister.findById(req.params.id).lean();
      if (!row) return res.status(404).json({ message: "Not found" });
      return res.json({ data: row });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[facilities-maintenanceRegisterRoutes] getById failed:", e.message);
      return res.status(500).json({ message: e.message || "Failed to load row" });
    }
  },
);

// ── POST / — manual entry ─────────────────────────────────────────
router.post(
  "/",
  requireAction("compliance.nabh.write"),
  async (req, res) => {
    try {
      const body = req.body || {};
      if (!body.equipmentType || !EQUIPMENT_TYPES.includes(body.equipmentType)) {
        return res.status(400).json({
          message: `equipmentType is required and must be one of: ${EQUIPMENT_TYPES.join(", ")}`,
        });
      }
      if (!body.equipmentId || !String(body.equipmentId).trim()) {
        return res.status(400).json({ message: "equipmentId is required" });
      }
      if (!body.scheduledAt) {
        return res.status(400).json({ message: "scheduledAt is required" });
      }

      const row = await emitFacilitiesMaintenanceLog({
        entry: {
          equipmentType:    body.equipmentType,
          equipmentId:      body.equipmentId,
          equipmentName:    body.equipmentName || "",
          location:         body.location || "",
          scheduledAt:      body.scheduledAt,
          performedAt:      body.performedAt || null,
          performedByEmpId: body.performedByEmpId || "",
          performedByName:  body.performedByName || "",
          vendor:           body.vendor || "",
          amcContractRef:   body.amcContractRef || "",
          jobType:          body.jobType || "PPM",
          findings:         body.findings || "",
          correctiveAction: body.correctiveAction || "",
          partsReplaced:    body.partsReplaced || "",
          downtimeMinutes:  body.downtimeMinutes || 0,
          nextDueDate:      body.nextDueDate || null,
          status:           body.status || "",
          sourceRef:        body.sourceRef || "",
          sourceType:       "Manual",
          hospitalId:       body.hospitalId || null,
        },
        actor: req.user || {},
      });

      if (!row) return res.status(400).json({ message: "Failed to record maintenance log" });
      return res.status(201).json({ data: row });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[facilities-maintenanceRegisterRoutes] create failed:", e.message);
      return res.status(500).json({ message: e.message || "Failed to create row" });
    }
  },
);

module.exports = router;
