/**
 * services/Clinical/medicationSafety.js — NABH MOM.4 / MOM.5
 *
 * Two point-of-order medication-safety linters:
 *
 *   1. Dangerous-abbreviation scan (#164) — the ISMP / NABH "Do-Not-Use" list.
 *      Free-text on an order (drug name, dose, frequency, instructions) is
 *      scanned for abbreviations that have caused fatal errors (U → unit,
 *      QD → daily, trailing/absent decimal zeros, MS ambiguity, …). Each hit
 *      returns the safer alternative the prescriber should use.
 *
 *   2. LASA collision + tall-man (#166) — look-alike / sound-alike drug pairs.
 *      When the ordered drug matches a known LASA partner, the linter warns and
 *      returns the tall-man rendering (e.g. hydrALAZINE vs hydrOXYzine) so the
 *      prescriber / pharmacist confirms the intended drug before dispense.
 *
 * Both are ADVISORY (non-blocking) — they return warnings; the caller decides
 * whether to surface, require an override note, or persist them. Pure functions,
 * no I/O, so they're cheap to call at every keystroke via the screen endpoint
 * and safe to run in a pre-save hook.
 */
"use strict";

// ── 1. Do-Not-Use abbreviations ────────────────────────────────────
// Each rule: a regex (word-boundary, case as noted) + the safer alternative.
// caseSensitive rules matter for "U" vs "u" — both are unsafe but we keep the
// match tight so "μg" style tokens aren't double-counted.
const DO_NOT_USE = [
  { id: "U",     re: /\b[Uu]\b/,                     recommend: 'write "unit"',                         why: '"U" read as 0, 4, or cc' },
  { id: "IU",    re: /\bIU\b/,                       recommend: 'write "international unit"',           why: '"IU" read as IV or 10' },
  { id: "QD",    re: /\bq\.?\s?d\.?\b/i,             recommend: 'write "daily"',                        why: '"QD" read as QID' },
  { id: "QOD",   re: /\bq\.?\s?o\.?\s?d\.?\b/i,      recommend: 'write "every other day"',              why: '"QOD" read as QD/QID' },
  { id: "QHS",   re: /\bq\.?h\.?s\.?\b/i,            recommend: 'write "at bedtime"',                   why: '"qhs" read as every hour' },
  { id: "TRAIL0",re: /\b\d+\.0\s*(mg|g|ml|mcg|unit)?/i, recommend: "drop the trailing zero (5 mg, not 5.0 mg)", why: "decimal missed → 10× dose" },
  { id: "NAKED", re: /(^|[\s(])\.\d+\s*(mg|g|ml|mcg|unit)?/i, recommend: "add a leading zero (0.5 mg, not .5 mg)", why: "decimal missed → 10× dose" },
  { id: "MS",    re: /\bMS\b/,                        recommend: 'write "morphine sulfate" / "magnesium sulfate"', why: '"MS" is ambiguous' },
  { id: "MSO4",  re: /\bMSO4\b/i,                     recommend: 'write "morphine sulfate"',            why: '"MSO4" confused with MgSO4' },
  { id: "MGSO4", re: /\bMgSO4\b/i,                    recommend: 'write "magnesium sulfate"',           why: '"MgSO4" confused with MSO4' },
  { id: "SC",    re: /\b(SC|SQ|sub\s?q)\b/i,          recommend: 'write "subcut" or "subcutaneously"',  why: '"SC/SQ" read as SL or "5 every"' },
  { id: "TIW",   re: /\bTIW\b/i,                      recommend: 'write "3 times weekly"',              why: '"TIW" read as 3/day or 2/week' },
  { id: "DC",    re: /\bD\/?C\b/,                     recommend: 'write "discharge" or "discontinue"',  why: '"D/C" is ambiguous' },
  { id: "CC",    re: /\bcc\b/,                        recommend: 'write "mL"',                            why: '"cc" read as U (units)' },
  { id: "UG",    re: /\b[uµ]g\b/,                     recommend: 'write "mcg"',                            why: '"µg/ug" read as mg → 1000×' },
  { id: "AT",    re: /@/,                              recommend: 'write "at"',                            why: '"@" read as 2' },
  { id: "OD_EYE",re: /\b(OD|OS|OU|AD|AS|AU)\b/,        recommend: 'write "right/left/both eye(s)/ear(s)"', why: "eye/ear abbreviations confused" },
  { id: "HS",    re: /\bHS\b/,                         recommend: 'write "half-strength" or "at bedtime"', why: '"HS" is ambiguous' },
];

// Scan free text; returns [{id, match, recommend, why}]. De-duped by rule id.
function scanDangerousAbbreviations(text) {
  const s = String(text || "");
  if (!s.trim()) return [];
  const out = [];
  const seen = new Set();
  for (const rule of DO_NOT_USE) {
    const m = s.match(rule.re);
    if (m && !seen.has(rule.id)) {
      seen.add(rule.id);
      out.push({ id: rule.id, match: m[0].trim(), recommend: rule.recommend, why: rule.why });
    }
  }
  return out;
}

// ── 2. LASA (look-alike / sound-alike) pairs with tall-man forms ────
// Each entry: the two confusable drugs and their tall-man renderings. The
// generic (lower-cased, non-alpha-stripped) key is what we match an order's
// drug name against. Curated from the ISMP LASA list ∩ common Indian formulary.
const LASA_PAIRS = [
  ["hydralazine", "hydroxyzine", "hydrALAZINE", "hydrOXYzine"],
  ["prednisone", "prednisolone", "predniSONE", "prednisoLONE"],
  ["dopamine", "dobutamine", "DOPamine", "DOBUTamine"],
  ["clonazepam", "clonidine", "clonazePAM", "cloNIDine"],
  ["lorazepam", "alprazolam", "LORazepam", "ALPRAZolam"],
  ["vinblastine", "vincristine", "vinBLAStine", "vinCRIStine"],
  ["metformin", "metronidazole", "metFORMIN", "metroNIDAZOLE"],
  ["cefazolin", "ceftriaxone", "ceFAZolin", "cefTRIAXone"],
  ["amlodipine", "amiloride", "amLODIPine", "aMILoride"],
  ["carbamazepine", "oxcarbazepine", "carBAMazepine", "OXcarbazepine"],
  ["chlorpromazine", "chlorpropamide", "chlorproMAZINE", "chlorproPAMIDE"],
  ["glipizide", "glimepiride", "glipiZIDE", "glimePIRIDE"],
  ["nifedipine", "nicardipine", "NIFEdipine", "niCARdipine"],
  ["risperidone", "ropinirole", "risperiDONE", "rOPINIRole"],
  ["sumatriptan", "sitagliptin", "SUMAtriptan", "SITagliptin"],
  ["tramadol", "trazodone", "traMADol", "traZODone"],
  ["cefotaxime", "cefuroxime", "cefoTAXime", "cefUROXime"],
  ["azithromycin", "erythromycin", "aZIThromycin", "erythromycin"],
  ["fluoxetine", "fluvoxamine", "FLUoxetine", "FLUVOXamine"],
  ["dixarit", "diamicron", "Dixarit", "Diamicron"],
  ["losartan", "valsartan", "LOSartan", "VALsartan"],
  ["labetalol", "lamotrigine", "labETALOL", "lamoTRIgine"],
];

// Build a lookup: normalizedName → { partner, tallSelf, tallPartner }
const _LASA_INDEX = new Map();
for (const [a, b, ta, tb] of LASA_PAIRS) {
  _LASA_INDEX.set(a, { partner: b, tallSelf: ta, tallPartner: tb });
  _LASA_INDEX.set(b, { partner: a, tallSelf: tb, tallPartner: ta });
}

function _normDrug(name) {
  // First alphabetic token, lower-cased (strips strength/brand suffixes).
  const first = String(name || "").trim().toLowerCase().match(/[a-z]+/);
  return first ? first[0] : "";
}

// Returns null or {drug, tallMan, confusableWith, confusableTallMan}.
function lasaCollision(drugName) {
  const key = _normDrug(drugName);
  if (!key) return null;
  const hit = _LASA_INDEX.get(key);
  if (!hit) return null;
  return {
    drug: key,
    tallMan: hit.tallSelf,
    confusableWith: hit.partner,
    confusableTallMan: hit.tallPartner,
  };
}

// ── Combined screen ────────────────────────────────────────────────
// Returns { warnings: [...], count }. Each warning:
//   { type: "DANGEROUS_ABBREVIATION" | "LASA", severity, message, ...detail }
function screenMedication({ medicineName = "", genericName = "", instructions = "", dose = "", frequency = "", route = "" } = {}) {
  const warnings = [];

  const freeText = [medicineName, dose, frequency, route, instructions].filter(Boolean).join(" ");
  for (const a of scanDangerousAbbreviations(freeText)) {
    warnings.push({
      type: "DANGEROUS_ABBREVIATION",
      severity: "warning",
      token: a.match,
      message: `Do-Not-Use abbreviation "${a.match}" — ${a.recommend} (${a.why}).`,
      recommend: a.recommend,
    });
  }

  const lasa = lasaCollision(medicineName) || lasaCollision(genericName);
  if (lasa) {
    warnings.push({
      type: "LASA",
      severity: "warning",
      message: `LASA alert: "${lasa.tallMan}" can be confused with "${lasa.confusableTallMan}". Confirm the intended drug.`,
      tallMan: lasa.tallMan,
      confusableWith: lasa.confusableTallMan,
    });
  }

  return { warnings, count: warnings.length };
}

module.exports = {
  DO_NOT_USE,
  LASA_PAIRS,
  scanDangerousAbbreviations,
  lasaCollision,
  screenMedication,
};
