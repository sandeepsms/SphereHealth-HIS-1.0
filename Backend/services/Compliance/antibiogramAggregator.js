/**
 * services/Compliance/antibiogramAggregator.js — NABH HIC.6
 *
 * Auto-aggregates per-isolate microbiology culture-&-sensitivity results
 * (MicroResultStep rows: ID → organism, SUSCEPTIBILITY → per-antibiotic
 * interpretation) into cumulative facility antibiogram rows —
 * organism × period × ward × sampleType, with %-susceptible per antibiotic.
 *
 * Pre-fix the AntibiogramRegister only accepted manual AMSC entry; the
 * stewardship committee had to hand-tally isolates from the lab worklist.
 * This service reads the SUSCEPTIBILITY steps (each carries
 * payload.antibiogram = [{antibiotic, mic, interpretation}]), joins the
 * organism from the ID step of the same order line, buckets by cohort, and
 * upserts one register row per cohort via emitAntibiogram (deterministic
 * sourceRef so re-runs coalesce instead of duplicating).
 *
 * Cumulative call rule: for each antibiotic the register's sensitivityProfile
 * cell is the *majority* interpretation across isolates (S if %S ≥ 50 else
 * R; ties → I). The exact %S / n breakdown is preserved in `notes` for the
 * AMSC. recommendedFirstLine = antibiotics with %S ≥ 80 (n ≥ 3), best first.
 *
 * Runs monthly (1st, aggregating the previous calendar month) via a cron in
 * index.js, and on-demand via POST /api/nabh-registers/antibiogram/aggregate.
 */
"use strict";

const { MicroResultStep } = require("../Lab/microbiologyAppender");
const { emitAntibiogram } = require("./nabhRegisterEmitter");
const AntibiogramRegister = require("../../models/Compliance/AntibiogramRegisterModel");

// Minimum isolates before a cohort's %S is trustworthy enough to drive an
// empiric recommendation. CLSI M39 says n < 30 is a caveat; for a small
// hospital we surface anything but only *recommend* at n ≥ 3.
const MIN_N_FOR_RECOMMENDATION = 3;

// ── period helpers ────────────────────────────────────────────────
function _monthKey(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

// Previous calendar month window [from, to) in UTC + its "YYYY-MM" key.
function previousMonthWindow(now) {
  const anchor = now instanceof Date ? now : new Date();
  const firstOfThis = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1, 0, 0, 0, 0));
  const firstOfPrev = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - 1, 1, 0, 0, 0, 0));
  return { from: firstOfPrev, to: firstOfThis, period: _monthKey(firstOfPrev) };
}

function _normInterp(v) {
  const s = String(v || "").trim().toUpperCase();
  if (s === "S" || s.startsWith("SUSCEPT") || s.startsWith("SENSIT")) return "S";
  if (s === "R" || s.startsWith("RESIST")) return "R";
  if (s === "I" || s.startsWith("INTERMED")) return "I";
  return null; // unknown / not-tested → ignored
}

const _SAMPLE_ENUM = ["Blood", "Urine", "Sputum", "Wound", "CSF", "Stool", "Other"];
function _normSample(v) {
  const s = String(v || "").trim();
  const hit = _SAMPLE_ENUM.find((k) => k.toLowerCase() === s.toLowerCase());
  if (hit) return hit;
  const l = s.toLowerCase();
  if (l.includes("blood")) return "Blood";
  if (l.includes("urine")) return "Urine";
  if (l.includes("sputum") || l.includes("resp")) return "Sputum";
  if (l.includes("wound") || l.includes("pus") || l.includes("swab")) return "Wound";
  if (l.includes("csf")) return "CSF";
  if (l.includes("stool") || l.includes("faec")) return "Stool";
  return "Other";
}

/**
 * Build cohort buckets from micro steps in a window.
 * Returns Map<cohortKey, {organism, ward, sampleType, isolates:Set, ab:Map<antibiotic,{S,I,R}>}>
 */
function _bucketize(susSteps, orgByItem, metaByItem) {
  const cohorts = new Map();
  for (const step of susSteps) {
    const itemId = String(step.orderItemId);
    const organism = String(orgByItem.get(itemId) || step.payload?.organism || "").trim();
    if (!organism) continue; // no ID step → cannot attribute; skip
    const meta = metaByItem.get(itemId) || {};
    const ward = String(step.payload?.ward || meta.ward || "").trim();
    const sampleType = _normSample(step.payload?.sampleType || meta.sampleType);

    const key = `${organism}||${ward}||${sampleType}`;
    let c = cohorts.get(key);
    if (!c) {
      c = { organism, ward, sampleType, isolates: new Set(), ab: new Map() };
      cohorts.set(key, c);
    }
    c.isolates.add(itemId);

    const panel = Array.isArray(step.payload?.antibiogram) ? step.payload.antibiogram : [];
    for (const cell of panel) {
      const ab = String(cell?.antibiotic || "").trim();
      const interp = _normInterp(cell?.interpretation ?? cell?.result ?? cell?.sir);
      if (!ab || !interp) continue;
      let tally = c.ab.get(ab);
      if (!tally) { tally = { S: 0, I: 0, R: 0 }; c.ab.set(ab, tally); }
      tally[interp] += 1;
    }
  }
  return cohorts;
}

// Majority S/I/R call + %S for one antibiotic tally.
function _call(tally) {
  const n = tally.S + tally.I + tally.R;
  if (n === 0) return null;
  const pctS = Math.round((tally.S / n) * 100);
  let cell;
  if (tally.S > tally.R && tally.S >= tally.I) cell = "S";
  else if (tally.R > tally.S && tally.R >= tally.I) cell = "R";
  else if (tally.I >= tally.S && tally.I >= tally.R) cell = "I";
  else cell = pctS >= 50 ? "S" : "R";
  return { cell, pctS, n };
}

/**
 * runAggregation({ from, to, period, actor })
 *   Aggregates all SUSCEPTIBILITY micro steps whose performedAt ∈ [from,to)
 *   into cumulative AntibiogramRegister rows. Defaults to the previous
 *   calendar month. Idempotent per (period, organism, ward, sampleType).
 *
 * @returns {Promise<{period, window, isolates, cohorts, written, rows}>}
 */
async function runAggregation({ from, to, period, actor, now } = {}) {
  let win;
  if (from && to && period) {
    win = { from: new Date(from), to: new Date(to), period: String(period) };
  } else {
    win = previousMonthWindow(now);
    if (from) win.from = new Date(from);
    if (to) win.to = new Date(to);
    if (period) win.period = String(period);
  }

  // Pull SUSCEPTIBILITY steps in-window, plus every ID step (any date) so we
  // can attribute organism to isolates whose ID landed on a different day.
  const susSteps = await MicroResultStep
    .find({ stepKind: "SUSCEPTIBILITY", performedAt: { $gte: win.from, $lt: win.to } })
    .select("orderItemId payload performedAt UHID")
    .limit(20000)
    .lean();

  if (susSteps.length === 0) {
    return { period: win.period, window: win, isolates: 0, cohorts: 0, written: 0, rows: [] };
  }

  // emitAntibiogram is find-or-create-by-sourceRef (returns existing without
  // updating). So a re-run after new isolates land would no-op on stale rows.
  // Clear this period's AUTO rows first → the aggregation is authoritative on
  // every run. Manual AMSC rows (sourceType !== AutoAggregation) are untouched.
  await AntibiogramRegister.deleteMany({ sourceType: "AutoAggregation", period: win.period });

  const itemIds = [...new Set(susSteps.map((s) => String(s.orderItemId)))];
  const idSteps = await MicroResultStep
    .find({ stepKind: "ID", orderItemId: { $in: itemIds } })
    .select("orderItemId payload")
    .limit(20000)
    .lean();

  const orgByItem = new Map();
  const metaByItem = new Map();
  for (const s of idSteps) {
    const k = String(s.orderItemId);
    if (s.payload?.organism && !orgByItem.has(k)) orgByItem.set(k, String(s.payload.organism).trim());
    metaByItem.set(k, { ward: s.payload?.ward || "", sampleType: s.payload?.sampleType || "" });
  }

  const cohorts = _bucketize(susSteps, orgByItem, metaByItem);

  const rows = [];
  let totalIsolates = 0;
  for (const c of cohorts.values()) {
    const n = c.isolates.size;
    totalIsolates += n;

    const profile = {};
    const breakdown = [];
    const recos = []; // {ab, pctS, n}
    for (const [ab, tally] of c.ab.entries()) {
      const call = _call(tally);
      if (!call) continue;
      profile[ab] = call.cell;
      breakdown.push(`${ab} ${call.pctS}%S (n=${call.n})`);
      if (call.pctS >= 80 && call.n >= MIN_N_FOR_RECOMMENDATION) recos.push({ ab, pctS: call.pctS, n: call.n });
    }
    recos.sort((a, b) => b.pctS - a.pctS || b.n - a.n);

    // Deterministic sourceRef → monthly re-runs update-or-skip, never dupe.
    const sourceRef = `antibiogram:auto:${win.period}:${c.organism}:${c.ward}:${c.sampleType}`;

    const row = await emitAntibiogram({
      organism: c.organism,
      isolatedAt: win.from,
      ward: c.ward,
      sampleType: c.sampleType,
      sensitivityProfile: profile,
      recommendedFirstLine: recos.slice(0, 3).map((r) => r.ab),
      recommendedSecondLine: recos.slice(3, 6).map((r) => r.ab),
      period: win.period,
      totalIsolates: n,
      notes: `Auto-aggregated ${win.period} — ${n} isolate(s). ${breakdown.join("; ")}`,
      status: "Closed",
      sourceRef,
      sourceType: "AutoAggregation",
      actor: actor || { name: "System (antibiogram-aggregator)" },
    });
    if (row) rows.push({ sourceRef, organism: c.organism, ward: c.ward, sampleType: c.sampleType, n, antibiotics: c.ab.size });
  }

  return {
    period: win.period,
    window: { from: win.from.toISOString(), to: win.to.toISOString() },
    isolates: totalIsolates,
    cohorts: cohorts.size,
    written: rows.length,
    rows,
  };
}

module.exports = { runAggregation, previousMonthWindow, _bucketize, _call };
