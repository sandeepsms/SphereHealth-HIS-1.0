/**
 * sharpsInjuryService.js  (R7bj-F6 / NABH HK-CRIT-1 / HIC.6)
 *
 * Service layer for the needle-stick / sharps-injury register.
 *
 *   1. create(payload, actor)
 *        ICN / nurse-in-charge / treating doctor files the incident.
 *        Auto-counter SI-YYYY-NNNN. Status: OPEN.
 *
 *   2. update(id, payload, actor)
 *        Free-form update for the pre-closure phase. Service strips
 *        keys that are managed by dedicated helpers.
 *
 *   3. markPepStarted(id, payload, actor)
 *        Flips pepStatus.{offered,started,startedAt,regimen}.
 *        Auto-promotes status → UNDER_FOLLOWUP.
 *
 *   4. recordSerologyResult(id, payload, actor)
 *        Pushes a row into followUpSerology[] (HIV/HBsAg/HCV w/ result).
 *
 *   5. close(id, payload, actor)
 *        Closes the case once 6-month serology is complete.
 *        Append-only thereafter (enforced by the model).
 */
const SharpsInjury = require("../../models/Clinical/SharpsInjuryModel");
const { nextSequence, formatId } = require("../../utils/counter");

function _err(code, message, status) {
  const e = new Error(message);
  e.code = code; e.status = status;
  return e;
}
function _istYear() {
  const tz = process.env.HOSPITAL_TZ || "Asia/Kolkata";
  return Number(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric" }).format(new Date()));
}

// R7bm-F7 — ICMR HIV-PEP guideline + IPC §269 + NABH HIC.6:
// every needle-stick / sharps-injury report should auto-schedule
// serology retests at 6 weeks, 3 months, and 6 months from the
// exposure date. Each follow-up window covers all three viruses
// (HIV / HBsAg / HCV). The rows seed `followUpSerology[]` with
// dueAt set; completedAt + result are filled in later via the
// dedicated `recordSerologyResult` helper.
const FOLLOWUP_OFFSETS_DAYS = [
  { label: "6W", days: 42  },   // 6 weeks
  { label: "3M", days: 90  },   // 3 months
  { label: "6M", days: 182 },   // ~6 months
];
const FOLLOWUP_TESTS = ["HIV", "HBsAg", "HCV"];

function _buildFollowupSchedule(injuryDate) {
  const base = new Date(injuryDate || Date.now());
  const out = [];
  for (const win of FOLLOWUP_OFFSETS_DAYS) {
    const due = new Date(base);
    due.setDate(due.getDate() + win.days);
    for (const test of FOLLOWUP_TESTS) {
      out.push({
        test,
        dueAt: due,
        completedAt: null,
        result: "PENDING",
        reportedById: null,
        reportedByName: "",
        notes: `Scheduled ${win.label} retest (ICMR HIV-PEP)`,
      });
    }
  }
  return out;
}

async function create(payload, actor = {}) {
  if (!payload) throw _err("ARG_MISSING", "payload is required", 400);
  if (!payload.injuredById) throw _err("ARG_MISSING", "injuredById is required", 400);
  if (!payload.injuredByName) throw _err("ARG_MISSING", "injuredByName is required", 400);
  if (!payload.device) throw _err("ARG_MISSING", "device is required", 400);

  const year = _istYear();
  const seq = await nextSequence(`sharps_injury:${year}`);
  const incidentNumber = formatId(`SI-${year}`, seq, 4);  // SI-2026-0001

  const injuryDate = payload.injuryDate ? new Date(payload.injuryDate) : new Date();
  // R7bm-F7 — if caller did not pre-seed followUpSerology, auto-build
  // the 6w / 3m / 6m × {HIV,HBsAg,HCV} schedule per ICMR HIV-PEP.
  const incomingFollowups = Array.isArray(payload.followUpSerology) ? payload.followUpSerology : [];
  const followUpSerology = incomingFollowups.length > 0
    ? incomingFollowups
    : _buildFollowupSchedule(injuryDate);

  const doc = await SharpsInjury.create({
    incidentNumber,
    injuredById:       payload.injuredById,
    injuredByName:     payload.injuredByName,
    injuredByRole:     payload.injuredByRole || "",
    injuryDate:        injuryDate,
    injuryLocation:    payload.injuryLocation || "",
    injuryDescription: payload.injuryDescription || "",
    device:            payload.device,
    source: {
      type:                 payload.source?.type || (payload.source?.patientUHID ? "KNOWN" : "UNKNOWN"),
      patientUHID:          payload.source?.patientUHID ? String(payload.source.patientUHID).toUpperCase().trim() : "",
      consentForSerology:   !!payload.source?.consentForSerology,
      serologyConsent_date: payload.source?.serologyConsent_date ? new Date(payload.source.serologyConsent_date) : null,
      hiv:   payload.source?.hiv   || "UNKNOWN",
      hbsag: payload.source?.hbsag || "UNKNOWN",
      hcv:   payload.source?.hcv   || "UNKNOWN",
    },
    pepStatus: {
      offered:     !!payload.pepStatus?.offered,
      offeredAt:   payload.pepStatus?.offeredAt ? new Date(payload.pepStatus.offeredAt) : null,
      started:     !!payload.pepStatus?.started,
      startedAt:   payload.pepStatus?.startedAt ? new Date(payload.pepStatus.startedAt) : null,
      regimen:     payload.pepStatus?.regimen || "",
      completed:   !!payload.pepStatus?.completed,
      completedAt: payload.pepStatus?.completedAt ? new Date(payload.pepStatus.completedAt) : null,
      declinedReason: payload.pepStatus?.declinedReason || "",
    },
    followUpSerology: followUpSerology,
    notes:            payload.notes || "",
    status:           "OPEN",
    hospitalId:       actor.hospitalId || payload.hospitalId || null,
  });
  return doc;
}

async function update(id, payload, actor = {}) {
  const doc = await SharpsInjury.findById(id);
  if (!doc) throw _err("NOT_FOUND", "Sharps-injury record not found", 404);
  if (doc.status === "CLOSED") throw _err("ALREADY_CLOSED", "Record is CLOSED — append-only", 409);

  const body = { ...(payload || {}) };
  // Lock keys that have dedicated helpers.
  delete body.incidentNumber;
  delete body.status;
  delete body.pepStatus;
  delete body.followUpSerology;
  delete body.closedAt; delete body.closedBy; delete body.closedByName;
  for (const [k, v] of Object.entries(body)) doc.set(k, v);
  await doc.save();
  return doc;
}

async function markPepStarted(id, payload = {}, actor = {}) {
  const doc = await SharpsInjury.findById(id);
  if (!doc) throw _err("NOT_FOUND", "Sharps-injury record not found", 404);
  if (doc.status === "CLOSED") throw _err("ALREADY_CLOSED", "Record is CLOSED", 409);

  doc.pepStatus.offered   = true;
  doc.pepStatus.offeredAt = doc.pepStatus.offeredAt || new Date();
  doc.pepStatus.started   = true;
  doc.pepStatus.startedAt = payload.startedAt ? new Date(payload.startedAt) : new Date();
  doc.pepStatus.regimen   = payload.regimen || doc.pepStatus.regimen || "";
  if (doc.status === "OPEN") doc.status = "UNDER_FOLLOWUP";
  await doc.save();
  return doc;
}

async function recordSerologyResult(id, payload = {}, actor = {}) {
  if (!payload.test) throw _err("ARG_MISSING", "test is required (HIV|HBsAg|HCV)", 400);
  if (!["HIV", "HBsAg", "HCV"].includes(payload.test)) {
    throw _err("ARG_INVALID", "test must be HIV, HBsAg, or HCV", 400);
  }
  const doc = await SharpsInjury.findById(id);
  if (!doc) throw _err("NOT_FOUND", "Sharps-injury record not found", 404);
  if (doc.status === "CLOSED") throw _err("ALREADY_CLOSED", "Record is CLOSED", 409);

  doc.followUpSerology.push({
    test:          payload.test,
    dueAt:         payload.dueAt ? new Date(payload.dueAt) : null,
    completedAt:   payload.completedAt ? new Date(payload.completedAt) : new Date(),
    result:        payload.result || "PENDING",
    reportedById:  actor._id || actor.id || null,
    reportedByName: actor.fullName || actor.name || "",
    notes:         payload.notes || "",
  });
  if (doc.status === "OPEN") doc.status = "UNDER_FOLLOWUP";
  await doc.save();
  return doc;
}

async function close(id, payload = {}, actor = {}) {
  const doc = await SharpsInjury.findById(id);
  if (!doc) throw _err("NOT_FOUND", "Sharps-injury record not found", 404);
  if (doc.status === "CLOSED") throw _err("ALREADY_CLOSED", "Record is already CLOSED", 409);

  doc.status       = "CLOSED";
  doc.closedAt     = new Date();
  doc.closedBy     = actor._id || actor.id || null;
  doc.closedByName = actor.fullName || actor.name || "";
  doc.closureNotes = payload.closureNotes || "";
  await doc.save();
  return doc;
}

async function getById(id) {
  if (!id) return null;
  return SharpsInjury.findById(id).lean();
}

async function list({ status, injuredById, uhid, from, to, limit = 100 } = {}) {
  const q = {};
  if (status) q.status = status;
  if (injuredById) q.injuredById = injuredById;
  if (uhid) q["source.patientUHID"] = String(uhid).toUpperCase().trim();
  if (from || to) {
    q.injuryDate = {};
    if (from) q.injuryDate.$gte = new Date(from);
    if (to)   q.injuryDate.$lte = new Date(to);
  }
  return SharpsInjury.find(q)
    .sort({ injuryDate: -1 })
    .limit(Math.min(500, Math.max(1, Number(limit) || 100)))
    .lean();
}

module.exports = { create, update, markPepStarted, recordSerologyResult, close, getById, list };
