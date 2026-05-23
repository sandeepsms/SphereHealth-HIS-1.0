/**
 * fssaiAllergens.js  (R7bj-F6 / NABH KI-CRIT-1 + DT-CRIT-1 / FSSAI Schedule IV)
 *
 * Canonical 14-item allergen vocabulary aligned with FSSAI's Food
 * Safety and Standards (Labelling and Display) Regulations, 2020 and
 * the FSSAI Schedule IV food-allergen list. Replaces the prior
 * free-text `allergies[]` and the ad-hoc `allergens[]` enum on
 * PatientDietPlan/KitchenIndent.
 *
 * Why a single source of truth:
 *   • Dietician → Kitchen indent copies allergens; if both sides spell
 *     "pea-nut" differently the cook misses the warning.
 *   • FSSAI inspection audits require the labelling vocabulary to match
 *     the regulation.  Free-text fails the audit.
 *   • KI-CRIT-1 — the adverse-food-reaction loop (ADRReport for food)
 *     keys off the same enum so the count of reactions per allergen is
 *     comparable across plans, indents, and ADR rows.
 *
 * Values are uppercase, underscore-delimited.  Helper `isFssaiAllergen`
 * is case-insensitive on input to make schema validators forgiving for
 * legacy lowercase data during migration.
 */
const FSSAI_ALLERGENS = Object.freeze([
  "MILK",
  "EGG",
  "FISH",
  "CRUSTACEAN_SHELLFISH",
  "MOLLUSCS",
  "TREE_NUTS",
  "PEANUTS",
  "WHEAT_GLUTEN",
  "SOYBEAN",
  "ADDED_SULPHITES",
  "CELERY",
  "MUSTARD",
  "SESAME",
  "LUPIN",
]);

const _SET = new Set(FSSAI_ALLERGENS);

function isFssaiAllergen(s) {
  if (s == null) return false;
  return _SET.has(String(s).toUpperCase().trim());
}

module.exports = { FSSAI_ALLERGENS, isFssaiAllergen };
