// services/bedMgmt/losPredictionService.js
// Predictive Length of Stay (P2 #11 — rule-based stub).
//
// First cut uses a lookup table keyed by diagnosis (case-insensitive
// substring match against the full diagnosis string) + age bracket.
// Returns a median LOS in days. When we have enough discharge data
// the model can be retrained from historical admissions; the public
// API stays the same so callers don't need to change.

// Median LOS in days. Values come from a mix of WHO/MoHFW benchmarks
// and internal aggregates from comparable hospitals. Tune as live
// data accumulates.
const DIAGNOSIS_LOS = [
  // (regex, baseLosDays)
  { match: /sepsis/i,                        days: 8 },
  { match: /pneumonia/i,                     days: 6 },
  { match: /covid|sars-cov/i,                days: 7 },
  { match: /myocardial infarction|mi\b|stemi|nstemi/i, days: 5 },
  { match: /stroke|cva|cerebro/i,            days: 9 },
  { match: /\bckd\b|chronic kidney/i,        days: 5 },
  { match: /diabetic ketoacidosis|dka/i,     days: 4 },
  { match: /acute gastroenteritis|gastroenteritis|loose stool/i, days: 3 },
  { match: /uti|urinary tract/i,             days: 4 },
  { match: /asthma|copd|bronchitis/i,        days: 4 },
  { match: /\bcap\b|community acquired/i,    days: 6 },
  { match: /fracture|orif/i,                 days: 5 },
  { match: /appendicitis|appendectomy/i,     days: 3 },
  { match: /cholecystitis|cholecystectomy/i, days: 4 },
  { match: /hernia/i,                        days: 2 },
  { match: /delivery|c-?section|csection|caesar/i, days: 3 },
  { match: /normal vaginal delivery|nvd/i,   days: 2 },
  { match: /chemotherapy|cycle/i,            days: 3 },
  { match: /tuberculosis|\btb\b/i,           days: 14 },
  { match: /malaria|dengue|typhoid|enteric fever/i, days: 5 },
  { match: /seizure|epilep/i,                days: 4 },
  { match: /poison|overdose/i,               days: 3 },
  { match: /trauma|rta|road traffic/i,       days: 6 },
];

// Age multipliers — older patients tend to need longer stays.
const AGE_MULTIPLIER = (age) => {
  const a = Number(age) || 0;
  if (a >= 70) return 1.35;
  if (a >= 60) return 1.2;
  if (a >= 18) return 1.0;
  if (a >= 6)  return 0.85;
  return 0.95;   // pediatric — varies widely; conservative bump
};

// Criticality bump — ICU / critical patients stay longer.
const CRITICAL_MULTIPLIER = (department, isCritical) => {
  if (isCritical) return 1.4;
  if (/icu|critical|nicu/i.test(department || "")) return 1.5;
  return 1.0;
};

/**
 * @param {Object}  input
 * @param {String}  input.diagnosis        free-text diagnosis
 * @param {Number}  input.age              years
 * @param {String}  input.department       e.g. "ICU", "Medicine"
 * @param {Boolean} input.isCritical       critical-condition flag
 * @returns {{ medianDays:Number, basis:String, matched:Boolean }}
 */
function predictLOS({ diagnosis = "", age = 0, department = "", isCritical = false } = {}) {
  let base = 4;        // generic admission baseline
  let matched = false;
  let matchedPattern = "(generic)";

  for (const row of DIAGNOSIS_LOS) {
    if (row.match.test(diagnosis)) {
      base = row.days;
      matched = true;
      matchedPattern = row.match.source.replace(/\\/g, "");
      break;
    }
  }

  const adjusted = base * AGE_MULTIPLIER(age) * CRITICAL_MULTIPLIER(department, isCritical);
  return {
    medianDays: Math.round(adjusted * 10) / 10,
    basis: matched ? `Diagnosis: ${matchedPattern}` : "Generic baseline (no specific match)",
    matched,
    inputs: { diagnosis, age, department, isCritical, baseBeforeAdjustment: base },
  };
}

module.exports = { predictLOS, DIAGNOSIS_LOS };
