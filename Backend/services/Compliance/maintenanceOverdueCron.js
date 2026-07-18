/**
 * services/Compliance/maintenanceOverdueCron.js — NABH FMS.5
 *
 * Preventive-maintenance (PPM) adherence sweep. Pre-fix, overdue equipment /
 * facility PPM jobs were only visible if a user opened the dashboard and
 * applied the overdue filter — a missed service could sit unflagged. This
 * cron (mirrors fireDrillOverdueCron):
 *   • Facilities log — flips SCHEDULED PPM jobs past nextDueDate to OVERDUE.
 *   • Equipment      — counts units whose nextServiceDue has passed (excluding
 *     units already Under-service / Out-of-service / Retired) and emits an
 *     audit summary so biomed sees the lapse without a dashboard visit.
 * Each run emits one idempotent BillingAudit summary row.
 */
"use strict";

const FacilitiesMaintenanceLog = require("../../models/Compliance/FacilitiesMaintenanceLogRegisterModel");
const Equipment = require("../../models/Equipment/EquipmentModel");

async function _audit(reason, after) {
  try {
    const { emitBillingAudit } = require("../../models/Billing/BillingAudit");
    await emitBillingAudit({ event: "CRON_RECONCILED", actorName: "System (maintenance-overdue)", reason, after });
  } catch (e) {
    console.warn("[maintenance-overdue] audit emit failed:", e.message);
  }
}

// #157 — Facilities PPM: Scheduled → Overdue when nextDueDate has passed.
async function runFacilitySweep() {
  const now = new Date();
  const r = await FacilitiesMaintenanceLog.updateMany(
    { status: "Scheduled", nextDueDate: { $ne: null, $lt: now } },
    { $set: { status: "Overdue" } },
  );
  const result = { matched: r.matchedCount, modified: r.modifiedCount, runAt: now.toISOString() };
  if (result.modified > 0) {
    await _audit(`Facilities PPM register: ${result.modified} scheduled job(s) past due flipped to Overdue.`, { kind: "FACILITY_PPM_OVERDUE", ...result });
  }
  return result;
}

// #156 — Equipment: surface units whose nextServiceDue has passed.
async function runEquipmentSweep() {
  const now = new Date();
  const overdue = await Equipment.find({
    nextServiceDue: { $ne: null, $lt: now },
    status: { $nin: ["Under-service", "Out-of-service", "Retired"] },
  }).select("assetTag serialNumber name nextServiceDue").limit(500).lean();
  const result = { overdueCount: overdue.length, runAt: now.toISOString() };
  if (overdue.length > 0) {
    await _audit(
      `Equipment PPM: ${overdue.length} unit(s) past nextServiceDue — service now.`,
      { kind: "EQUIPMENT_SERVICE_OVERDUE", ...result, sample: overdue.slice(0, 20).map((e) => e.assetTag || e.serialNumber || e.name) },
    );
  }
  return result;
}

async function runOverdueSweep() {
  const facility = await runFacilitySweep();
  const equipment = await runEquipmentSweep();
  return { facility, equipment };
}

module.exports = { runOverdueSweep, runFacilitySweep, runEquipmentSweep };
