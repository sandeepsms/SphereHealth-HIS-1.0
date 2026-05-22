/**
 * vitalRanges.js — R7az-D5-CRIT-4 / D5-HIGH-1
 *
 * Single source of truth for "what is a normal / warn / danger vital
 * reading for THIS patient". Pre-R7az, three different vital surfaces
 * disagreed:
 *
 *   - NursePatientPanel had RANGES.pulse = { min: 60, max: 100 }
 *     and rendered red borders on anything outside that band.
 *   - NursePatientPanel's vitalState() helper used a "danger if <50 OR
 *     >120, warn if <60 OR >100" three-tier band — so a pulse of 102
 *     showed warn in one place and danger in another.
 *   - IntegratedVitalsPanel still hardcoded adult bands even when the
 *     patient was a 6-month-old neonate (HR < 100 = "low" → false alarm).
 *
 * This module exposes:
 *   - bands.adult / bands.paediatric / bands.neonate — three age-banded
 *     reference dictionaries (normal / warn / danger boundaries per
 *     vital). Source: ALS adult + APLS paediatric + NRP neonatal.
 *   - bandFor(patient, vital) — selector. Returns the correct band dict
 *     for a given patient.dob age slice.
 *   - tier(patient, vital, value) — returns "normal" / "warn" / "danger"
 *     so any surface (header chip, table cell, sparkline marker) can
 *     consume one consistent state.
 *
 * Keys for `vital`:
 *   bp_sys, bp_dia, pulse, spo2, temp, rr, gcs, blood_sugar
 *
 * TODO: R7az-followup — per-patient overrides (COPD SpO2 baseline 88-92,
 * CCF target SpO2 94-98, beta-blocker patient pulse 50-90, etc). For
 * now those have to be eyeballed by the nurse against the adult band.
 */

// ── Reference bands ────────────────────────────────────────────────────
// Each entry: { warnLow, dangerLow, warnHigh, dangerHigh }.
// "normal" is everything between warnLow and warnHigh (inclusive).
// "warn"   is between dangerLow..warnLow OR warnHigh..dangerHigh.
// "danger" is below dangerLow OR above dangerHigh.
//
// When a vital has only an upper concern (e.g. fever) the lower bound
// uses very forgiving values so tier() falls through to "normal".
// When a vital has only a lower concern (e.g. SpO2 / GCS) the upper
// bound is set above the max physiological value.

/** Adult bands (≥ 18 years) — ALS / NEWS2 derived. */
const adult = {
  // Blood pressure — split into systolic and diastolic so callers can
  // colour the two halves of "120/80" independently if they want.
  bp_sys:      { dangerLow: 80,  warnLow: 100, warnHigh: 140, dangerHigh: 180 },
  bp_dia:      { dangerLow: 50,  warnLow: 60,  warnHigh: 90,  dangerHigh: 110 },
  // Pulse — NEWS2 danger thresholds.
  pulse:       { dangerLow: 40,  warnLow: 50,  warnHigh: 90,  dangerHigh: 130 },
  // SpO2 — upper limit unused (no such thing as "too high SpO2").
  spo2:        { dangerLow: 88,  warnLow: 92,  warnHigh: 101, dangerHigh: 999 },
  // Temperature °C.
  temp:        { dangerLow: 35,  warnLow: 36,  warnHigh: 37.5, dangerHigh: 39 },
  // Respiratory rate per minute.
  rr:          { dangerLow: 8,   warnLow: 12,  warnHigh: 20,  dangerHigh: 25 },
  // Glasgow coma score 3-15 — lower = worse, upper unused.
  gcs:         { dangerLow: 8,   warnLow: 14,  warnHigh: 16,  dangerHigh: 17 },
  // Random blood sugar mg/dL — fasting equivalent will tier differently
  // but for ward-level alerts this is the working band.
  blood_sugar: { dangerLow: 60,  warnLow: 80,  warnHigh: 180, dangerHigh: 250 },
};

/** Paediatric bands (1-17y) — APLS-derived, averaged across ages. */
const paediatric = {
  bp_sys:      { dangerLow: 70,  warnLow: 90,  warnHigh: 120, dangerHigh: 140 },
  bp_dia:      { dangerLow: 40,  warnLow: 50,  warnHigh: 80,  dangerHigh: 100 },
  pulse:       { dangerLow: 60,  warnLow: 80,  warnHigh: 140, dangerHigh: 180 },
  spo2:        { dangerLow: 90,  warnLow: 94,  warnHigh: 101, dangerHigh: 999 },
  temp:        { dangerLow: 35,  warnLow: 36,  warnHigh: 37.5, dangerHigh: 39 },
  rr:          { dangerLow: 15,  warnLow: 20,  warnHigh: 30,  dangerHigh: 40 },
  gcs:         { dangerLow: 8,   warnLow: 14,  warnHigh: 16,  dangerHigh: 17 },
  blood_sugar: { dangerLow: 60,  warnLow: 80,  warnHigh: 180, dangerHigh: 250 },
};

/** Neonatal bands (<1y) — NRP-derived, term-baby reference. */
const neonate = {
  bp_sys:      { dangerLow: 50,  warnLow: 60,  warnHigh: 90,  dangerHigh: 110 },
  bp_dia:      { dangerLow: 30,  warnLow: 35,  warnHigh: 60,  dangerHigh: 80 },
  pulse:       { dangerLow: 90,  warnLow: 110, warnHigh: 160, dangerHigh: 200 },
  spo2:        { dangerLow: 90,  warnLow: 95,  warnHigh: 101, dangerHigh: 999 },
  temp:        { dangerLow: 36,  warnLow: 36.5, warnHigh: 37.5, dangerHigh: 38.5 },
  rr:          { dangerLow: 25,  warnLow: 30,  warnHigh: 55,  dangerHigh: 70 },
  // GCS uncommon in neonates; same scale used.
  gcs:         { dangerLow: 8,   warnLow: 14,  warnHigh: 16,  dangerHigh: 17 },
  blood_sugar: { dangerLow: 45,  warnLow: 60,  warnHigh: 150, dangerHigh: 200 },
};

export const bands = { adult, paediatric, neonate };

/**
 * Pick the right band dict for a patient.
 *
 * Falls back to adult when DOB isn't on the patient record (most common
 * for legacy walk-ins) — safer to use adult thresholds for an unknown
 * age than to mis-flag a child's vitals.
 *
 * @param {Object} patient — { dob } shape; may be null
 * @param {string} vital   — bp_sys / pulse / spo2 / …
 * @returns {{dangerLow, warnLow, warnHigh, dangerHigh}} the band entry
 */
export function bandFor(patient, vital) {
  if (!vital) return adult.pulse;
  const ageY = ageYears(patient?.dob || patient?.dateOfBirth);
  const dict = ageY == null   ? adult
              : ageY < 1      ? neonate
              : ageY < 18     ? paediatric
                              : adult;
  // TODO: R7az-followup — per-patient overrides (COPD baseline SpO2,
  // CCF target SpO2, beta-blocker resting pulse, hypertension goal BP)
  // should override the age-bucketed default here.
  return dict[vital] || adult[vital] || adult.pulse;
}

/**
 * Three-tier classification for any (patient, vital, value) tuple.
 * Returns "normal" | "warn" | "danger" | "unknown" (when value missing).
 *
 * Callers can map the tier into colour: normal=#059669 / warn=#d97706 /
 * danger=#dc2626. This is the single helper every vital surface should
 * use so the colours match across header, table, modal, and chart.
 */
export function tier(patient, vital, value) {
  if (value == null || value === "" || Number.isNaN(Number(value))) return "unknown";
  const v = Number(value);
  const b = bandFor(patient, vital);
  if (v < b.dangerLow || v > b.dangerHigh) return "danger";
  if (v < b.warnLow   || v > b.warnHigh)   return "warn";
  return "normal";
}

/**
 * Convenience — returns true when `value` is outside the normal band
 * for this patient/vital. Matches the old NursePatientPanel `isAbn()`
 * helper signature so existing callers can be migrated in one swap.
 */
export function isAbnormal(patient, vital, value) {
  const t = tier(patient, vital, value);
  return t === "warn" || t === "danger";
}

// ── Internal: age in years from a DOB string / Date ────────────────────
function ageYears(dob) {
  if (!dob) return null;
  try {
    const d = new Date(dob);
    if (Number.isNaN(d.getTime())) return null;
    const diff = Date.now() - d.getTime();
    const yr = diff / (365.25 * 86400000);
    return yr;
  } catch {
    return null;
  }
}

export default { bands, bandFor, tier, isAbnormal };
