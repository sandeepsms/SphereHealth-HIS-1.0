/**
 * icuBundleService.js — R7eg
 *
 * Frontend wrapper around /api/icu-bundles. Uses authFetch so JWT goes
 * through on every call. Mirrors diabeticChartService shape so the UI
 * layer can apply the same loading / error patterns.
 *
 * Exports BUNDLE_DEFS so the page can render checkboxes from the
 * canonical definition without a backend round-trip on first paint.
 * Keep this list byte-identical to ICUBundleModel.DEFAULT_ITEMS — if
 * they drift, the server seeds the docs but the UI labels may not
 * match until the doc is re-fetched.
 */
import authFetch from "../utils/authFetch";
import { API_ENDPOINTS } from "../config/api";

const BASE = `${API_ENDPOINTS.BASE}/icu-bundles`;

async function _json(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || `HTTP ${res.status}`);
  return data;
}

export async function getList(uhid) {
  const r = await authFetch(`${BASE}/${encodeURIComponent(uhid)}`);
  return _json(r);
}

// R7eg2 — Full admission-scoped fetch used by the Patient File / Treatment
// Chart prints. Unlike getList(uhid) this is not 30-day-windowed and returns
// the full items[] for each bundle in each shift sheet, pre-sorted by
// (date asc, shift M→E→N) for direct iteration.
export async function getByAdmission(admissionId) {
  const r = await authFetch(`${BASE}/admission/${encodeURIComponent(admissionId)}`);
  return _json(r);
}

export async function getByDateShift(uhid, date, shift) {
  const r = await authFetch(
    `${BASE}/${encodeURIComponent(uhid)}/${encodeURIComponent(date)}/${encodeURIComponent(shift)}`,
  );
  return _json(r);
}

export async function upsertSheet(payload) {
  const r = await authFetch(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return _json(r);
}

export async function toggleItem(id, bundleKey, itemKey, checked, notes) {
  const body = { checked };
  if (typeof notes === "string") body.notes = notes;
  const r = await authFetch(
    `${BASE}/${id}/${encodeURIComponent(bundleKey)}/${encodeURIComponent(itemKey)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  return _json(r);
}

export async function finalize(id) {
  const r = await authFetch(`${BASE}/${id}/finalize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  return _json(r);
}

// ─────────────────────────────────────────────────────────────────────
// Canonical bundle definitions — kept in sync with
// Backend/models/Clinical/ICUBundleModel.js → statics.DEFAULT_ITEMS.
// ─────────────────────────────────────────────────────────────────────
export const BUNDLE_DEFS = [
  {
    key: "vap",
    title: "VAP — Ventilator-Associated Pneumonia",
    subtitle: "Applies when patient is intubated / on ventilator",
    icon: "pi-cloud",
    items: [
      { key: "hob_30_45",             label: "HOB elevation 30°–45°" },
      { key: "sedation_interruption", label: "Daily sedation interruption + readiness-to-extubate assessment" },
      { key: "peptic_ulcer_prophy",   label: "Peptic ulcer prophylaxis (PPI/H2-blocker)" },
      { key: "dvt_prophy",            label: "DVT prophylaxis ordered" },
      { key: "oral_chlorhex",         label: "Oral care with 0.12% chlorhexidine q6h" },
      { key: "subglottic_suction",    label: "Subglottic suctioning q4h (if subglottic-port ETT)" },
    ],
  },
  {
    key: "cauti",
    title: "CAUTI — Catheter-Associated UTI",
    subtitle: "Applies when Foley catheter is in place",
    icon: "pi-filter",
    items: [
      { key: "daily_review",      label: "Daily review of catheter necessity — remove ASAP" },
      { key: "hand_hygiene",      label: "Hand hygiene before/after every manipulation" },
      { key: "closed_system",     label: "Closed drainage system maintained — never disconnect" },
      { key: "bag_below_bladder", label: "Drainage bag below bladder level + off floor" },
      { key: "aseptic_insertion", label: "Aseptic insertion technique + securement" },
      { key: "perineal_care",     label: "Perineal care BD with soap + water" },
    ],
  },
  {
    key: "clabsi",
    title: "CLABSI — Central Line BSI",
    subtitle: "Applies when central venous line is in place",
    icon: "pi-share-alt",
    items: [
      { key: "hand_hygiene",    label: "Hand hygiene before any line manipulation" },
      { key: "maximal_barrier", label: "Maximal sterile barrier precautions at insertion" },
      { key: "chlorhex_skin",   label: "Chlorhexidine 2% skin antisepsis" },
      { key: "optimal_site",    label: "Optimal site (subclavian > IJV > femoral)" },
      { key: "daily_review",    label: "Daily review of line necessity — remove ASAP" },
      { key: "dressing_intact", label: "Dressing intact, dated, occlusive" },
      { key: "scrub_hub",       label: "Scrub the hub 15s before each access" },
    ],
  },
  {
    key: "dvt",
    title: "DVT Prophylaxis",
    subtitle: "Applies to all ICU patients by default",
    icon: "pi-shield",
    items: [
      { key: "risk_assessment",   label: "Caprini/Padua risk score documented" },
      { key: "mechanical_prophy", label: "Mechanical: TED stockings or SCD applied" },
      { key: "pharma_prophy",     label: "Pharmacological: LMWH/UFH ordered + given" },
      { key: "contra_documented", label: "If not given, contraindications documented" },
    ],
  },
  {
    key: "sepsis",
    title: "Sepsis — Hour-1 Bundle",
    subtitle: "Applies when sepsis suspected / confirmed",
    icon: "pi-exclamation-triangle",
    items: [
      { key: "lactate_measured",     label: "Lactate measured" },
      { key: "cultures_pre_abx",     label: "Blood cultures drawn BEFORE antibiotics" },
      { key: "broad_spec_abx_1h",    label: "Broad-spectrum antibiotics within 1 hour" },
      { key: "crystalloid_30ml_kg",  label: "30 mL/kg crystalloid bolus for hypotension or lactate ≥4" },
      { key: "vasopressors_if_hypo", label: "Vasopressors if hypotensive after fluid resuscitation" },
      { key: "reassessment",         label: "Re-assessment of perfusion status documented" },
    ],
  },
  {
    key: "sup",
    title: "SUP — Stress Ulcer Prophylaxis",
    subtitle: "Applies to high-risk ICU patients",
    icon: "pi-heart",
    items: [
      { key: "risk_factors_assessed", label: "Risk factors assessed (mechanical vent ≥48h, coagulopathy, etc.)" },
      { key: "ppi_or_h2",             label: "PPI or H2-blocker ordered + given" },
      { key: "daily_deescalation",    label: "Daily review for de-escalation" },
    ],
  },
];

export const SHIFTS = ["Morning", "Evening", "Night"];

export default {
  getList, getByAdmission, getByDateShift, upsertSheet, toggleItem, finalize,
  BUNDLE_DEFS, SHIFTS,
};
