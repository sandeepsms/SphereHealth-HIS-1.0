/**
 * allergyCheck.js — R7az D7-CRIT-1 / D7-CRIT-2
 *
 * Centralised drug-vs-patient-allergy gate used by every dispense /
 * release / administration path:
 *
 *   1. Pharmacy counter dispense (controllers/Pharmacy/pharmacyController.dispense)
 *   2. Pharmacy indent create     (services/Pharmacy/indentService.createIndent)
 *   3. Pharmacy indent release    (services/Pharmacy/indentService.releaseIndent)
 *   4. MAR administration         (controllers/Clinical/marController.recordAdministration — Agent B)
 *
 * Pre-R7az the only gate lived inside the Prescription model's pre-save
 * hook — meaning a nurse / pharmacist could still issue a known-allergic
 * drug as long as the prescription itself was created before the allergy
 * was recorded, or via a Manual indent line that bypasses the Rx. This
 * helper is intentionally substring-based (matches the audit F-08 logic
 * extracted from models/Doctor/prescription.js) so the four call sites
 * see identical behaviour.
 *
 * Patient.allergies handling
 * ──────────────────────────
 * The Patient master historically stored allergies as
 * `knownAllergies: Mixed` (comma-/semicolon-separated string). R7az-CRIT-2
 * adds a typed `allergyList: [{allergen,severity,type}]` field with a
 * virtual `allergies` that returns the typed list (falling back to a
 * parsed view of the legacy string). This helper accepts either the
 * virtual output (array of {allergen, severity?, type?} objects) OR
 * raw strings OR the legacy mixed payload, so the call sites don't have
 * to know which generation of the patient document they're working with.
 *
 * Exports:
 *   normaliseAllergies(input)           → string[] of allergen names
 *   checkDrugAgainstAllergies(drug, allergies)
 *                                       → { collision, allergen?, drugProbe? }
 *   assertDrugSafeOrOverride(drug, allergies, { overrideReason, label })
 *                                       → throws err.code = "ALLERGY_COLLISION" with .allergen, .drugName
 */

// Sentinel allergen strings that the receptionist may have typed to
// indicate "no allergies known". We don't want these treated as a real
// allergen and false-positive against random drug names.
const NEGATION_RX = /^\s*(none|nil|nka|no known|n\/a|na)\s*$/i;

// Drop allergens shorter than this — "no" / "ok" / "ny" would otherwise
// false-positive against most drug names that happen to contain those
// letters as a substring. Mirrors the audit F-08 threshold.
const MIN_ALLERGEN_LEN = 3;

/**
 * Coerce a wide variety of input shapes into a deduplicated string[] of
 * allergen names. Accepts:
 *
 *   - undefined / null / ""                          → []
 *   - "Penicillin, Sulfa"  (legacy string)           → ["Penicillin","Sulfa"]
 *   - "Penicillin;Sulfa\nIbuprofen"  (legacy string) → ["Penicillin","Sulfa","Ibuprofen"]
 *   - ["Penicillin","Sulfa"]                          → ["Penicillin","Sulfa"]
 *   - [{ allergen: "Penicillin", type: "DRUG" }, ...] → ["Penicillin", ...]
 *   - { allergen: "Penicillin" }                      → ["Penicillin"]
 *
 * Negation sentinels (NKA / none / nil) are filtered out — the patient
 * has no real allergens. Sub-3-char tokens are also filtered.
 */
function normaliseAllergies(input) {
  if (input == null || input === "") return [];

  const out = [];
  const push = (raw) => {
    if (raw == null) return;
    const s = String(raw).trim();
    if (!s) return;
    if (NEGATION_RX.test(s)) return;
    out.push(s);
  };

  if (Array.isArray(input)) {
    for (const el of input) {
      if (el == null) continue;
      if (typeof el === "string") {
        push(el);
      } else if (typeof el === "object") {
        // Typed allergy row from allergyList[] / virtual
        push(el.allergen || el.name || el.value || "");
      }
    }
  } else if (typeof input === "object") {
    // Single typed-allergy object
    push(input.allergen || input.name || input.value || "");
  } else if (typeof input === "string") {
    // Legacy mixed-string form — split on common separators
    for (const tok of input.split(/[,;\n|/]/)) push(tok);
  } else {
    push(input);
  }

  // Dedupe (case-insensitive) and drop sub-3-char noise tokens.
  const seen = new Set();
  return out
    .map((s) => s.trim())
    .filter((s) => s.length >= MIN_ALLERGEN_LEN)
    .filter((s) => {
      const k = s.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

/**
 * Build the drug-probe string we'll substring-match against allergens.
 * Accepts a drug object (the dispense/release/MAR payload row) OR a
 * plain string. The probe joins drugName + genericName + brandName + form
 * so a "Tablet Augmentin" vs "Penicillin" allergy hits via the generic.
 */
function _drugProbe(drug) {
  if (!drug) return "";
  if (typeof drug === "string") return drug.toLowerCase();
  const parts = [
    drug.drugName,
    drug.medicineName,
    drug.name,
    drug.genericName,
    drug.brandName,
  ].filter(Boolean);
  return parts.join(" ").toLowerCase();
}

/**
 * Core gate. Pure function — no DB, no side-effects. Returns
 *   { collision: false }                                  → safe
 *   { collision: true, allergen, drugProbe, drugName }    → collision
 *
 * The caller decides what to do with the collision (throw 409, ask for
 * override reason, log, etc.). We do NOT throw here so unit tests can
 * exercise both branches without try/catch noise.
 */
function checkDrugAgainstAllergies(drug, patientAllergies) {
  const allergens = normaliseAllergies(patientAllergies);
  if (allergens.length === 0) return { collision: false };

  const probe = _drugProbe(drug);
  if (!probe) return { collision: false };

  for (const a of allergens) {
    const needle = a.toLowerCase();
    // Length guard already enforced in normaliseAllergies but re-check
    // here defensively in case caller built the allergens list by hand.
    if (needle.length < MIN_ALLERGEN_LEN) continue;
    if (probe.includes(needle)) {
      return {
        collision: true,
        allergen: a,
        drugProbe: probe,
        drugName: typeof drug === "string" ? drug : (drug.drugName || drug.medicineName || drug.name || ""),
      };
    }
  }
  return { collision: false };
}

/**
 * Throwing wrapper for call sites that want a single line at the top of
 * a dispense/release function. Honours an explicit override reason
 * (matching the prescription model's `_allergyOverrideReason` semantics)
 * — when present, the collision is logged but NOT thrown, so a senior
 * clinician can knowingly issue a desensitisation dose.
 *
 *   try { assertDrugSafeOrOverride(it, patient.allergies, { label: "indent" }) }
 *   catch (e) { return res.status(409).json({ message: e.message }) }
 */
function assertDrugSafeOrOverride(drug, patientAllergies, { overrideReason, label = "drug" } = {}) {
  const r = checkDrugAgainstAllergies(drug, patientAllergies);
  if (!r.collision) return r;
  if (overrideReason && String(overrideReason).trim()) {
    // Documented bypass — same audit story as the Rx hook.
    console.warn(
      `[allergyCheck] OVERRIDE (${label}): ${r.drugName} prescribed against "${r.allergen}" allergy — reason: ${overrideReason}`,
    );
    return { ...r, overridden: true };
  }
  const err = new Error(
    `Allergy alert: ${r.drugName} matches patient's "${r.allergen}" allergy. ` +
    `Pass an override reason to proceed or remove the item.`,
  );
  err.code     = "ALLERGY_COLLISION";
  err.status   = 409;
  err.allergen = r.allergen;
  err.drugName = r.drugName;
  throw err;
}

module.exports = {
  normaliseAllergies,
  checkDrugAgainstAllergies,
  assertDrugSafeOrOverride,
};
