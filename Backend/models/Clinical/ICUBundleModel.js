/**
 * ICUBundleModel.js — R7eg
 *
 * One document per (admissionId, date, shift) — i.e. one bundle sheet per
 * ICU nursing shift. Six standard care bundles per sheet:
 *   • VAP    — Ventilator-Associated Pneumonia (IHI 5-element bundle)
 *   • CAUTI  — Catheter-Associated Urinary Tract Infection
 *   • CLABSI — Central Line-Associated Blood-Stream Infection
 *   • DVT    — Deep Vein Thrombosis prophylaxis (all ICU patients)
 *   • Sepsis — Hour-1 sepsis bundle (Surviving Sepsis 2021)
 *   • SUP    — Stress Ulcer Prophylaxis
 *
 * Each bundle:
 *   - `applicable` flag — some bundles only apply when the patient has
 *     the device / condition (VAP only if intubated, CAUTI only if
 *     Foley in place, CLABSI only if central line, etc.). DVT and SUP
 *     apply to almost every ICU patient by default.
 *   - `items[]` checklist of standard interventions
 *   - per-bundle nurse signature on finalize
 *
 * Compliance % is computed pre-save on each bundle:
 *   compliancePct = (checked items / total items) * 100
 * overallCompliancePct = average across all *applicable* bundles.
 *
 * One sheet per shift per admission is enforced via a unique compound
 * index. Mirrors the DiabeticChart per-day pattern (R7eg).
 *
 * NABH mapping:
 *   • HIC.5 — Hospital Infection Control prevention bundles
 *   • COP.13 — ICU care standards
 *   • IPSG.5 — reduce risk of HAIs
 *
 * Audit: every save / finalize emits a ClinicalAudit row via
 *   services/Compliance/clinicalAuditService.emitClinicalAudit().
 *   Non-compliant VAP / CLABSI on finalize emits a dedicated event so
 *   the IC officer's daily report surfaces it without polling every
 *   sheet.
 */
const mongoose = require("mongoose");

const SHIFTS = ["Morning", "Evening", "Night"];
const STATUS = ["draft", "finalized"];

const BUNDLE_ITEM = new mongoose.Schema(
  {
    // Stable machine key — used by PATCH /:id/:bundleKey/:itemKey to
    // toggle a single checkbox without sending the whole sheet.
    key:     { type: String, required: true, trim: true },
    // Human label shown in the UI. Kept on the document (not lookup'd
    // from a constants table) so an admin can adjust phrasing without
    // a schema migration AND historical sheets keep their original
    // wording on print.
    label:   { type: String, required: true, trim: true },
    checked: { type: Boolean, default: false },
    notes:   { type: String, default: "", trim: true },
  },
  { _id: false }
);

const BUNDLE_SUBDOC = new mongoose.Schema(
  {
    // Some bundles only apply to specific devices/conditions. Nurse
    // toggles this. When false, items[] are ignored for the overall
    // compliance calc.
    applicable:     { type: Boolean, default: true },
    items:          { type: [BUNDLE_ITEM], default: [] },

    // Computed pre-save: ratio of checked / total items, 0–100.
    // -1 sentinel = "not applicable" (skipped in overall average).
    compliancePct:  { type: Number, default: 0, min: -1, max: 100 },

    // Per-bundle nurse signature. Captured on finalize so the
    // signature lives at the bundle level (audit can show "Nurse X
    // signed off VAP" separately from "Nurse Y signed off CAUTI"
    // when two nurses split the patient).
    nurseName:      { type: String, default: "", trim: true },
    nurseId:        { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    signedAt:       { type: Date, default: null },
  },
  { _id: false }
);

const ICUBundleSchema = new mongoose.Schema(
  {
    patientId:       { type: mongoose.Schema.Types.ObjectId, ref: "Patient", default: null },
    UHID:            { type: String, required: true, index: true, trim: true },
    admissionId:     { type: mongoose.Schema.Types.ObjectId, ref: "Admission", required: true },
    admissionNumber: { type: String, default: "", trim: true },
    patientName:     { type: String, default: "", trim: true },

    // YYYY-MM-DD string — matches DiabeticChart pattern so a unique
    // index on (admissionId, date, shift) is byte-comparable.
    date:            { type: String, required: true, index: true },
    shift:           { type: String, enum: SHIFTS, required: true },

    // The six bundles. Each defaults to applicable=true; the upsert
    // controller seeds default items[] from the schema statics on
    // first create.
    vap:    { type: BUNDLE_SUBDOC, default: () => ({}) },
    cauti:  { type: BUNDLE_SUBDOC, default: () => ({}) },
    clabsi: { type: BUNDLE_SUBDOC, default: () => ({}) },
    dvt:    { type: BUNDLE_SUBDOC, default: () => ({}) },
    sepsis: { type: BUNDLE_SUBDOC, default: () => ({}) },
    sup:    { type: BUNDLE_SUBDOC, default: () => ({}) },

    // Computed pre-save: average compliancePct across applicable bundles.
    overallCompliancePct: { type: Number, default: 0, min: 0, max: 100 },

    notes:           { type: String, default: "", trim: true },
    status:          { type: String, enum: STATUS, default: "draft", index: true },

    // Final shift sign-off (separate from per-bundle signatures).
    finalizedBy:     { type: String, default: "", trim: true },
    finalizedById:   { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    finalizedAt:     { type: Date, default: null },

    createdBy:       { type: String, default: "", trim: true },
    updatedBy:       { type: String, default: "", trim: true },
  },
  { timestamps: true, optimisticConcurrency: true }
);

// One sheet per admission per shift per day
ICUBundleSchema.index({ admissionId: 1, date: 1, shift: 1 }, { unique: true });
ICUBundleSchema.index({ UHID: 1, date: -1 });
ICUBundleSchema.index({ status: 1, date: -1 });

// ─────────────────────────────────────────────────────────────────────
// Static: default checklist items per bundle key. Sourced from
// IHI care-bundle PDFs + NABH HIC.5 + Surviving Sepsis 2021. Exposed
// as a static so both the upsert controller (seed on create) AND the
// frontend service can reach the same canonical list without drift.
// ─────────────────────────────────────────────────────────────────────
ICUBundleSchema.statics.BUNDLE_KEYS = ["vap", "cauti", "clabsi", "dvt", "sepsis", "sup"];
ICUBundleSchema.statics.SHIFTS = SHIFTS;
ICUBundleSchema.statics.DEFAULT_ITEMS = {
  vap: [
    { key: "hob_30_45",            label: "HOB elevation 30°–45°" },
    { key: "sedation_interruption", label: "Daily sedation interruption + readiness-to-extubate assessment" },
    { key: "peptic_ulcer_prophy",  label: "Peptic ulcer prophylaxis (PPI/H2-blocker)" },
    { key: "dvt_prophy",           label: "DVT prophylaxis ordered" },
    { key: "oral_chlorhex",        label: "Oral care with 0.12% chlorhexidine q6h" },
    { key: "subglottic_suction",   label: "Subglottic suctioning q4h (if subglottic-port ETT)" },
  ],
  cauti: [
    { key: "daily_review",      label: "Daily review of catheter necessity — remove ASAP" },
    { key: "hand_hygiene",      label: "Hand hygiene before/after every manipulation" },
    { key: "closed_system",     label: "Closed drainage system maintained — never disconnect" },
    { key: "bag_below_bladder", label: "Drainage bag below bladder level + off floor" },
    { key: "aseptic_insertion", label: "Aseptic insertion technique + securement" },
    { key: "perineal_care",     label: "Perineal care BD with soap + water" },
  ],
  clabsi: [
    { key: "hand_hygiene",    label: "Hand hygiene before any line manipulation" },
    { key: "maximal_barrier", label: "Maximal sterile barrier precautions at insertion" },
    { key: "chlorhex_skin",   label: "Chlorhexidine 2% skin antisepsis" },
    { key: "optimal_site",    label: "Optimal site (subclavian > IJV > femoral)" },
    { key: "daily_review",    label: "Daily review of line necessity — remove ASAP" },
    { key: "dressing_intact", label: "Dressing intact, dated, occlusive" },
    { key: "scrub_hub",       label: "Scrub the hub 15s before each access" },
  ],
  dvt: [
    { key: "risk_assessment",    label: "Caprini/Padua risk score documented" },
    { key: "mechanical_prophy",  label: "Mechanical: TED stockings or SCD applied" },
    { key: "pharma_prophy",      label: "Pharmacological: LMWH/UFH ordered + given" },
    { key: "contra_documented",  label: "If not given, contraindications documented" },
  ],
  sepsis: [
    { key: "lactate_measured",       label: "Lactate measured" },
    { key: "cultures_pre_abx",       label: "Blood cultures drawn BEFORE antibiotics" },
    { key: "broad_spec_abx_1h",      label: "Broad-spectrum antibiotics within 1 hour" },
    { key: "crystalloid_30ml_kg",    label: "30 mL/kg crystalloid bolus for hypotension or lactate ≥4" },
    { key: "vasopressors_if_hypo",   label: "Vasopressors if hypotensive after fluid resuscitation" },
    { key: "reassessment",           label: "Re-assessment of perfusion status documented" },
  ],
  sup: [
    { key: "risk_factors_assessed", label: "Risk factors assessed (mechanical vent ≥48h, coagulopathy, etc.)" },
    { key: "ppi_or_h2",             label: "PPI or H2-blocker ordered + given" },
    { key: "daily_deescalation",    label: "Daily review for de-escalation" },
  ],
};

// ─────────────────────────────────────────────────────────────────────
// Pre-save: recompute compliancePct on every bundle and the overall
// average. Sentinel -1 when applicable=false so the overall average
// can skip that bundle without dragging the score down.
// Kept inside the model so a stale frontend value cannot ship — the
// number is recomputed server-side from the items[] truth on every
// save.
// ─────────────────────────────────────────────────────────────────────
ICUBundleSchema.pre("save", function (next) {
  const BUNDLE_KEYS = ["vap", "cauti", "clabsi", "dvt", "sepsis", "sup"];
  let total = 0;
  let count = 0;
  for (const k of BUNDLE_KEYS) {
    const b = this[k];
    if (!b) continue;
    if (!b.applicable) {
      b.compliancePct = -1;
      continue;
    }
    const items = b.items || [];
    if (items.length === 0) {
      b.compliancePct = 0;
    } else {
      const checked = items.filter(i => i.checked).length;
      b.compliancePct = Math.round((checked / items.length) * 100);
    }
    total += b.compliancePct;
    count += 1;
  }
  this.overallCompliancePct = count > 0 ? Math.round(total / count) : 0;
  next();
});

module.exports =
  mongoose.models.ICUBundle ||
  mongoose.model("ICUBundle", ICUBundleSchema);
