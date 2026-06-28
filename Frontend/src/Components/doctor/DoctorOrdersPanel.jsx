/**
 * DoctorOrdersPanel.jsx
 * Comprehensive doctor order entry + full audit trail viewer
 * NABH COP.2 / MOM.3 / SRC.1 compliant
 * Supports 12 order types — each with dedicated form fields
 * Audit trail: who ordered (doctor) + each nurse step + completion timestamp
 */
import React, { useState, useEffect, useCallback, useRef } from "react";
import axios from "axios";
import { API_ENDPOINTS } from "../../config/api";
import { useAuth } from "../../context/AuthContext";
import { toast } from "react-toastify";
import SharedDrugAutocomplete, { parseStrength, drugDisplayName } from "../clinical/DrugAutocomplete";
import ServiceMasterAutocomplete from "../services/ServiceMasterAutocomplete";
// R7hr-179 (USER, 2026-06-11): Medication + IV Fluid entry adopt the SAME
// multi-row PrescriptionPanel / InfusionPanel the Doctor IPD Initial
// Assessment uses (R7hr-128 dilution, R7hr-71 auto-route, R7hr-68 fluid
// presets) — one batch of rows fans out to one DoctorOrder per row, same
// adapter shape R7hr-176 proved for verbal orders. Lab / Imaging get the
// IA-style catalog autocomplete + multi-pick chip flow (R7hr-69).
// The legacy single-order <OrderForm> stays untouched for the amend path
// (editingOrder) + every other order type.
import PrescriptionPanel from "../clinical/PrescriptionPanel";
import InfusionPanel from "../clinical/InfusionPanel";
import { confirm } from "../common/ConfirmDialog";
import { createProcedureNote } from "../../Services/procedureNoteService";

/* ── Design tokens ── */
const C = {
  bg: "#f8fafc", card: "#ffffff", border: "#e2e8f0", text: "#0f172a", muted: "#64748b",
  primary: "#4338ca", primaryL: "#eef2ff", primaryMid: "#4f46e5",
  green: "#16a34a", greenL: "#dcfce7", greenB: "#bbf7d0",
  amber: "#d97706", amberL: "#fffbeb", amberB: "#fde68a",
  red: "#dc2626", redL: "#fef2f2", redB: "#fecaca",
  blue: "#4f46e5", blueL: "#e0e7ff", blueB: "#93c5fd",
  purple: "#7c3aed", purpleL: "#f5f3ff", purpleB: "#c4b5fd",
  teal: "#0d9488", tealL: "#f0fdfa", tealB: "#99f6e4",
  orange: "#ea580c", orangeL: "#fff7ed", orangeB: "#fed7aa",
  pink: "#db2777", pinkL: "#fdf2f8", pinkB: "#fbcfe8",
  slate: "#1e293b", gray: "#9ca3af", grayL: "#f9fafb",
  indigo: "#4f46e5", indigoL: "#eef2ff",
  cyan: "#0891b2", cyanL: "#ecfeff", cyanB: "#a5f3fc",
  lime: "#65a30d", limeL: "#f7fee7", limeB: "#d9f99d",
};

/* ── Order types (12 NABH-compliant categories) ─────────────────
 * Restored 2026-05-13: the 768830a CSS refactor accidentally dropped
 * ORDER_TYPES / TYPE_MAP / STEPS, which crashed every Doctor Notes
 * load with "ORDER_TYPES is not defined" and produced a blank screen.
 */
const ORDER_TYPES = [
  { id: "Medication",      label: "Medication",          icon: "pi-tablets",        color: C.purple,  bg: C.purpleL, border: C.purpleB },
  { id: "IV_Fluid",        label: "IV Fluid",            icon: "pi-inbox",          color: C.blue,    bg: C.blueL,   border: C.blueB   },
  { id: "Lab",             label: "Lab Investigation",   icon: "pi-search",         color: C.teal,    bg: C.tealL,   border: C.tealB   },
  { id: "Radiology",       label: "Imaging / Radiology", icon: "pi-eye",            color: C.indigo,  bg: C.indigoL, border: "#a5b4fc" },
  { id: "Procedure",       label: "Procedure",           icon: "pi-cog",            color: C.orange,  bg: C.orangeL, border: C.orangeB },
  { id: "BloodTransfusion",label: "Blood Transfusion",   icon: "pi-heart",          color: C.red,     bg: C.redL,    border: C.redB    },
  { id: "Diet",            label: "Diet / Nutrition",    icon: "pi-star",           color: C.green,   bg: C.greenL,  border: C.greenB  },
  { id: "Oxygen",          label: "Oxygen Therapy",      icon: "pi-cloud",          color: C.cyan,    bg: C.cyanL,   border: C.cyanB   },
  { id: "Physiotherapy",   label: "Physiotherapy",       icon: "pi-user",           color: C.lime,    bg: C.limeL,   border: C.limeB   },
  { id: "Activity",        label: "Activity / Mobility", icon: "pi-arrows-alt",     color: C.amber,   bg: C.amberL,  border: C.amberB  },
  { id: "Nursing",         label: "Nursing Care",        icon: "pi-heart-fill",     color: C.pink,    bg: C.pinkL,   border: C.pinkB   },
  { id: "Consultation",    label: "Consultation Request",icon: "pi-users",          color: C.slate,   bg: "#f1f5f9", border: "#cbd5e1" },
];

const TYPE_MAP = Object.fromEntries(ORDER_TYPES.map(t => [t.id, t]));

/* ── R7hr-180 · ONE entry point for Lab + Imaging. The picker grid shows
   a single "Investigations" tile instead of two; each picked test still
   saves as its real orderType (Lab / Radiology) so the distinct nurse
   STEPS workflows (sample-collection vs scan-scheduling), the filter
   dropdown and every existing order card stay untouched.
   "Investigations" is a UI-only pseudo-type — never sent to the API. */
TYPE_MAP.Investigations = {
  id: "Investigations", label: "Investigations — Lab / Imaging",
  icon: "pi-search", color: C.teal, bg: C.tealL, border: C.tealB,
};
const TILE_TYPES = ORDER_TYPES.filter(t => t.id !== "Lab" && t.id !== "Radiology");
TILE_TYPES.splice(2, 0, TYPE_MAP.Investigations); // sits where the Lab tile was

/* ── R7hr-179 · Lab + Imaging catalogs for the IA-style multi-pick
   chip flow. Mirrors the R7hr-69 LAB_TESTS list in
   IPDInitialAssessmentPage.jsx, split by order type so the Lab tile
   doesn't suggest CT scans and vice-versa. Free-text entries still
   chip via Enter / "+ Add as custom" — catalog is a convenience,
   not a constraint. ─────────────────────────────────────────────── */
const ORDER_LAB_CATALOG = [
  "CBC (Complete Blood Count)", "ESR", "PT / INR", "aPTT", "D-Dimer",
  "Peripheral Smear", "Reticulocyte Count",
  "LFT (Liver Function Tests)", "RFT (Renal Function Tests)",
  "Electrolytes (Na / K / Cl)", "Serum Calcium", "Serum Magnesium",
  "Serum Phosphorus", "Lipid Profile", "Random Blood Sugar (RBS)",
  "Fasting Blood Sugar (FBS)", "Post-Prandial Blood Sugar (PPBS)",
  "HbA1c", "Uric Acid", "Amylase", "Lipase", "CPK", "CPK-MB",
  "Troponin I", "NT-proBNP", "Procalcitonin", "CRP", "Ferritin",
  "Serum Iron / TIBC", "Vitamin D (25-OH)", "Vitamin B12", "Folate",
  "TSH", "Free T3", "Free T4", "Cortisol (8 AM)", "PTH", "HCG (Beta)",
  "ABG (Arterial Blood Gas)", "VBG (Venous Blood Gas)", "Lactate",
  "Blood Culture & Sensitivity", "Urine Culture & Sensitivity",
  "Sputum Culture & Sensitivity", "Stool Culture", "Wound Swab Culture",
  "CSF Analysis", "Pleural Fluid Analysis", "Ascitic Fluid Analysis",
  "HIV ELISA", "HBsAg", "Anti-HCV", "VDRL", "Dengue NS1 + IgM / IgG",
  "Malaria Antigen (MP-MRDT)", "Typhi-Dot IgM", "Widal Test",
  "COVID-19 RT-PCR", "Leptospira IgM", "Scrub Typhus IgM",
  "Urine Routine & Microscopy", "Urine Albumin-Creatinine Ratio",
  "24-hr Urine Protein", "Stool Routine & Microscopy", "Stool Occult Blood",
];
const ORDER_IMAGING_CATALOG = [
  "Chest X-Ray PA", "Chest X-Ray AP", "X-Ray KUB", "X-Ray Abdomen Erect",
  "X-Ray (specify region)",
  "USG Abdomen", "USG KUB", "USG Pelvis", "USG Whole Abdomen",
  "USG Doppler — Lower Limb Venous", "USG Doppler — Carotid",
  "CECT Head", "NCCT Head", "CECT Chest", "CECT Abdomen + Pelvis",
  "HRCT Chest", "MRI Brain (Plain + Contrast)", "MRI Spine",
  "ECG (12-Lead)", "2D Echo", "Stress Test (TMT)", "Holter Monitoring",
  "PFT (Pulmonary Function Test)", "EEG", "EMG",
  "Nerve Conduction Study (NCS)",
];

/* ── R7hr-180 · Classifier for the merged Investigations picker —
   catalog membership first, keyword fallback for free-text customs.
   Drives the LAB / IMAGING tag on suggestions + chips AND the
   orderType split (Lab vs Radiology) at save time. */
const isImagingTest = (t) => ORDER_IMAGING_CATALOG.includes(t)
  || /x-?ray|usg|sonograph|doppler|\bct\b|cect|ncct|hrct|mri|2d echo|\becho\b|ecg|ekg|tmt|holter|eeg|emg|\bncs\b|nerve conduction|pft|spirometry|endoscop|colonoscop|bronchoscop|ercp|fnac|biopsy|scan/i.test(String(t || ""));

/* ── R7hr-179 · MultiTestPicker — IA-style autocomplete + multi-pick
   chips for Lab / Imaging batch ordering. Same UX contract as the
   R7hr-69 Investigations picker on the IPD Initial Assessment: type
   2-3 letters → suggestions → click/Enter chips it → "Add N Tests"
   commits the batch. Controlled: parent owns `value` (string[]).
   R7hr-180 — optional `kindOf(name)` prop renders a small kind tag
   (LAB / IMAGING) on each suggestion + chip for the merged picker. */
function MultiTestPicker({ catalog, value = [], onChange, color = C.teal, placeholder, kindOf }) {
  const [query, setQuery] = useState("");
  const [showSuggest, setShowSuggest] = useState(false);
  const [suggestIdx, setSuggestIdx] = useState(-1);

  const addPick = (pick) => {
    const p = String(pick || "").trim();
    if (!p) return;
    if (!value.includes(p)) onChange([...value, p]);
    setQuery(""); setSuggestIdx(-1); setShowSuggest(false);
  };
  const q = query.trim().toLowerCase();
  const matches = q ? catalog.filter(t => t.toLowerCase().includes(q)).slice(0, 8) : [];

  return (
    <div>
      <div style={{ position: "relative" }}>
        <input
          value={query}
          onChange={e => { setQuery(e.target.value); setShowSuggest(true); setSuggestIdx(-1); }}
          onFocus={() => setShowSuggest(true)}
          onBlur={() => setTimeout(() => setShowSuggest(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setSuggestIdx(i => Math.min(matches.length - 1, i + 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setSuggestIdx(i => Math.max(0, i - 1)); }
            else if (e.key === "Enter") {
              e.preventDefault();
              addPick(suggestIdx >= 0 && matches[suggestIdx] ? matches[suggestIdx] : query);
            } else if (e.key === "Escape") { setShowSuggest(false); setSuggestIdx(-1); }
          }}
          placeholder={placeholder || "Type to search — pick multiple…"}
          className="his-field"
        />
        {showSuggest && q && (
          <div style={{
            position: "absolute", top: "100%", left: 0, right: 0, marginTop: 4,
            background: "white", border: `1px solid ${C.border}`, borderRadius: 8,
            boxShadow: "0 8px 24px rgba(15,23,42,.12)",
            maxHeight: 280, overflowY: "auto", zIndex: 50,
          }}>
            {matches.length === 0 && (
              <div
                onMouseDown={(e) => { e.preventDefault(); addPick(query); }}
                style={{ padding: "10px 14px", fontSize: 12, color: C.muted, cursor: "pointer" }}>
                <span style={{ color, fontWeight: 700 }}>+ Add "{query.trim()}"</span> as custom entry
              </div>
            )}
            {matches.map((m, i) => (
              <div
                key={m}
                onMouseDown={(e) => { e.preventDefault(); addPick(m); }}
                onMouseEnter={() => setSuggestIdx(i)}
                style={{
                  padding: "9px 14px", fontSize: 12, cursor: "pointer",
                  background: suggestIdx === i ? `${color}12` : "white",
                  color: C.text, fontWeight: suggestIdx === i ? 700 : 500,
                  borderBottom: i < matches.length - 1 ? `1px solid ${C.border}40` : "none",
                  display: "flex", alignItems: "center", gap: 8,
                }}>
                <i className="pi pi-plus-circle" style={{ color, fontSize: 11 }} />
                {m}
                {kindOf && (
                  <span style={{
                    marginLeft: "auto", fontSize: 9, fontWeight: 800, letterSpacing: ".4px",
                    padding: "1px 6px", borderRadius: 4,
                    background: kindOf(m) === "IMAGING" ? "#eef2ff" : "#f0fdfa",
                    color: kindOf(m) === "IMAGING" ? C.indigo : C.teal,
                  }}>{kindOf(m)}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      {value.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
          {value.map(t => (
            <span key={t} style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              background: `${color}14`, color, border: `1px solid ${color}40`,
              borderRadius: 16, padding: "3px 6px 3px 11px", fontSize: 11.5, fontWeight: 700,
            }}>
              {t}
              {kindOf && (
                <span style={{
                  fontSize: 9, fontWeight: 800, letterSpacing: ".4px",
                  padding: "1px 5px", borderRadius: 4,
                  background: kindOf(t) === "IMAGING" ? "#eef2ff" : "#ffffffaa",
                  color: kindOf(t) === "IMAGING" ? C.indigo : C.teal,
                }}>{kindOf(t)}</span>
              )}
              <button
                type="button"
                onClick={() => onChange(value.filter(x => x !== t))}
                style={{
                  border: "none", background: `${color}22`, color, cursor: "pointer",
                  borderRadius: "50%", width: 16, height: 16, fontSize: 10, lineHeight: 1,
                  display: "flex", alignItems: "center", justifyContent: "center", padding: 0,
                }}>×</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Step definitions per order type (mirrors NurseOrdersPanel) ── */
const STEPS = {
  Medication:       ["Prepared", "Administered"],
  IV_Fluid:         ["Prepared", "Line Checked", "Infusion Started", "Completed"],
  Lab:              ["Sample Collected", "Sample Sent", "Report Received"],
  Radiology:        ["Scheduled", "Patient Sent", "Scan Done", "Report Received"],
  Procedure:        ["Consent Taken", "Patient Prepped", "Procedure Done", "Patient Returned"],
  BloodTransfusion: ["Cross-Match Verified", "Blood Issued", "Transfusion Started", "Transfusion Completed"],
  Diet:             ["Ordered", "Prepared", "Delivered"],
  Oxygen:           ["Equipment Set", "O₂ Started", "Target Achieved"],
  Physiotherapy:    ["Scheduled", "Session Started", "Session Completed"],
  Activity:         ["Instructed", "Started", "Goal Met"],
  Nursing:          ["Acknowledged", "In Progress", "Done"],
  Consultation:     ["Referral Sent", "Consultant Informed", "Consultation Done", "Advice Received"],
};

/* ── Priority colours ── */
const PRIO = {
  STAT:    { bg: C.redL,   color: C.red,   label: "STAT"    },
  Urgent:  { bg: C.amberL, color: C.amber, label: "Urgent"  },
  Routine: { bg: C.grayL,  color: C.muted, label: "Routine" },
};

/* ── Status pill styles ── */
const STAT_STYLE = {
  Pending:      { bg: "#fff7ed", color: C.amber  },
  Acknowledged: { bg: C.blueL,  color: C.blue   },
  InProgress:   { bg: C.tealL,  color: C.teal   },
  Completed:    { bg: C.greenL, color: C.green  },
  Cancelled:    { bg: C.redL,   color: C.red    },
  OnHold:       { bg: "#f1f5f9",color: C.muted  },
};

/* Shared grid row style — same victim of commit 768830a as `Field`.
   `g(cols)` below spreads this onto each grid wrapper so the form
   fields sit on a proper css grid with consistent gap + margin. */
const row = { display: "grid", gap: 10, marginBottom: 10 };

/* ══════════════════════════════════════════════════════════════
   Field — generic labelled input/select/textarea used everywhere in
   OrderForm. Originally lived as a closure inside OrderForm; the
   2026-05-13 CSS refactor (commit 768830a) lifted it out but the
   refactor accidentally dropped the definition, leaving every
   <Field ...> reference unresolved and crashing the Medication form
   the moment the doctor selected it. Restored here.

   Supports the variants the caller uses today:
     • plain text/number     (default)
     • select with options[] (options prop)
     • textarea              (type="textarea")
     • value + adjacent unit picker (unitOptions[] + unitName, OR a
       fixed unit string)
     • span={N} to widen the cell in a grid                          */
function Field({ form, set, label, name, placeholder, type = "text",
                 options, unitOptions, unitName, unit, span }) {
  const val = form[name] ?? "";
  const wrapStyle = span ? { gridColumn: `span ${span}` } : undefined;

  const renderInput = () => {
    if (Array.isArray(options)) {
      return (
        <select className="his-select" value={val} onChange={e => set(name, e.target.value)}>
          <option value="">— select —</option>
          {options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    }
    if (type === "textarea") {
      return (
        <textarea className="his-textarea" rows={2}
                  placeholder={placeholder} value={val}
                  onChange={e => set(name, e.target.value)} />
      );
    }
    const onChange = (e) => {
      const v = e.target.value;
      set(name, type === "number" && v !== "" ? Number(v) : v);
    };
    return (
      <input className="his-field" type={type}
             placeholder={placeholder} value={val} onChange={onChange} />
    );
  };

  return (
    <div style={wrapStyle}>
      <label className="his-label">{label}</label>
      {Array.isArray(unitOptions) ? (
        <div style={{ display: "flex", gap: 6 }}>
          <div style={{ flex: 1 }}>{renderInput()}</div>
          <select className="his-select" style={{ width: 90 }}
                  value={form[unitName] || unitOptions[0]}
                  onChange={e => set(unitName, e.target.value)}>
            {unitOptions.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
      ) : unit ? (
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {renderInput()}
          <span style={{ fontSize: 11, color: "#64748b" }}>{unit}</span>
        </div>
      ) : renderInput()}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   DrugAutocomplete (form-bound thin wrapper) — delegates the actual
   search/render UI to the shared <SharedDrugAutocomplete> in
   Components/clinical/DrugAutocomplete.jsx so OPDAssessmentPage,
   discharge summary, MAR, and this panel all share one source of
   truth. We just adapt the (form, set, name) shape this panel uses
   into the (value, onChange, onPick) shape the shared component
   exposes, and mirror the picked drug's strength + generic into
   `dose / doseUnit / genericName / dosageForm` for downstream
   audit + dispense.                                                */
function DrugAutocomplete({ form, set, label, name, placeholder }) {
  return (
    <SharedDrugAutocomplete
      label={label}
      placeholder={placeholder}
      value={form[name] ?? ""}
      onChange={(v) => set(name, v)}
      onPick={(d) => {
        // Form-prefixed canonical name in the visible Drug Name field
        // ("Tab Paracetamol 500mg" instead of bare "Paracetamol 500mg")
        // per Indian Rx convention. Structured fields (genericName /
        // dose / doseUnit / dosageForm) mirror separately so the order
        // service, MAR, and dispense flow all have machine-readable
        // values without parsing the display string.
        set(name, drugDisplayName(d));
        if (d.genericName) set("genericName", d.genericName);
        const { value, unit } = parseStrength(d.strength);
        if (value != null) set("dose", value);
        if (unit) set("doseUnit", unit);
        if (d.form) set("dosageForm", d.form);
      }}
    />
  );
}

/* ══════════════════════════════════════════════════════════════
   ServicePicker — form-bound wrapper around <ServiceMasterAutocomplete>.

   Replaces the free-text "Test name / Procedure name / Fluid /
   Speciality / Diet …" inputs across the 10 non-Medication tabs.
   When the doctor picks a row from the service catalogue we mirror
   the full {serviceMasterId, serviceCode, serviceName, unitPrice}
   onto the form AND copy serviceName into whatever bare-text key
   the existing payload + downstream prints expect (medicineName /
   testName / procedureName / dietType / deliveryDevice / ptType /
   activityLevel / instruction / speciality). The "Not in catalog?
   Type manually" toggle clears the 4 ServiceMaster fields and lets
   the existing free-text path stand untouched so legacy items still
   save. Inline price preview renders below when unitPrice is set.
══════════════════════════════════════════════════════════════ */
function ServicePicker({ form, set, label, category, nameField, placeholder }) {
  const manual = !!form.__manualEntry;
  const setManual = (v) => set("__manualEntry", v);

  const clearServiceFields = () => {
    set("serviceMasterId", "");
    set("serviceCode", "");
    set("serviceName", "");
    set("unitPrice", "");
  };

  const handlePick = (row) => {
    if (!row) return;
    const serviceMasterId = row._id || row.id || row.serviceMasterId;
    const serviceCode     = row.serviceCode || row.code || "";
    const serviceName     = row.serviceName || row.name || "";
    const unitPrice       = row.defaultPrice ?? row.unitPrice ?? row.price ?? "";
    set("serviceMasterId", serviceMasterId);
    set("serviceCode", serviceCode);
    set("serviceName", serviceName);
    set("unitPrice", unitPrice);
    // Mirror into the legacy bare-text field the existing payload expects
    if (nameField) set(nameField, serviceName);
  };

  return (
    <div>
      {!manual ? (
        <>
          <ServiceMasterAutocomplete
            label={label}
            category={category}
            value={form.serviceName || form[nameField] || ""}
            onChange={(v) => {
              set("serviceName", v);
              if (nameField) set(nameField, v);
            }}
            onPick={handlePick}
            placeholder={placeholder}
          />
          {form.unitPrice !== undefined && form.unitPrice !== "" && (
            <div style={{ marginTop: 4, fontSize: 11, color: C.primary, fontWeight: 700 }}>
              ₹{form.unitPrice}
            </div>
          )}
          <button
            type="button"
            onClick={() => { clearServiceFields(); setManual(true); }}
            style={{ marginTop: 4, padding: "2px 8px", border: `1px solid ${C.border}`, borderRadius: 6, background: "white", color: C.muted, fontSize: 10, cursor: "pointer" }}
          >
            Not in catalog? Type manually
          </button>
        </>
      ) : (
        <>
          <label className="his-label">{label}</label>
          <input
            className="his-field" type="text" placeholder={placeholder}
            value={form[nameField] || ""}
            onChange={(e) => set(nameField, e.target.value)}
          />
          <button
            type="button"
            onClick={() => setManual(false)}
            style={{ marginTop: 4, padding: "2px 8px", border: `1px solid ${C.border}`, borderRadius: 6, background: "white", color: C.muted, fontSize: 10, cursor: "pointer" }}
          >
            Pick from catalog
          </button>
        </>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   ORDER META — single fallback so OrderForm header + OrderCard
   chip stay in sync for unknown / legacy orderType values.
   Replaces the divergent Medication-purple (OrderForm) vs
   Nursing-pink (OrderCard) fallbacks that drifted silently.
══════════════════════════════════════════════════════════════ */
function getOrderMeta(type) {
  const meta = TYPE_MAP?.[type];
  if (meta) return meta;
  return { color: "#64748b" /* slate */, icon: "pi-list", label: type || "Order", bg: "#f1f5f9", border: "#cbd5e1" };
}

/* ══════════════════════════════════════════════════════════════
   ORDER FORM — dynamic fields per type
══════════════════════════════════════════════════════════════ */
function OrderForm({ typeId, form, set }) {
  const g = (cols) => ({ ...row, gridTemplateColumns: cols });

  if (typeId === "Medication") return (
    <>
      <div style={g("2fr 1fr")}>
        {/* Drug Name now auto-completes from the Pharmacy drug master so
            the doctor picks the exact SKU (avoids typos that desync from
            stock + dispense audit). Picking an entry also pre-fills dose
            + dose unit from the drug's strength field — doctor can still
            override either. */}
        <DrugAutocomplete form={form} set={set} label="Drug Name *" name="medicineName" placeholder="Start typing — e.g. Amox, Paracet, Aug…"/>
        <Field form={form} set={set} label="Dose *" name="dose" type="number" placeholder="e.g. 500"
          unitOptions={["mg","mcg","g","ml","units","IU","mEq"]} unitName="doseUnit"/>
      </div>
      <div style={g("1fr 1fr 1fr 1fr")}>
        <Field form={form} set={set} label="Route" name="route" options={["IV","IM","Oral","SC","SL","Topical","Inhalation","Rectal","NG Tube"]}/>
        <Field form={form} set={set} label="Frequency" name="frequency" options={["OD","BD","TDS","QID","6 Hourly","8 Hourly","12 Hourly","SOS","Stat","Weekly"]}/>
        <Field form={form} set={set} label="Duration" name="durationValue" type="number" placeholder="e.g. 5"
          unitOptions={["days","hrs","weeks"]} unitName="durationUnit"/>
        <Field form={form} set={set} label="Priority" name="priority" options={["Routine","Urgent","STAT"]}/>
      </div>
      <div style={g("1fr 1fr")}>
        <Field form={form} set={set} label="Meal Status" name="mealStatus" options={["BeforeFood","WithFood","AfterFood","EmptyStomach","NotApplicable"]}/>
      </div>
      {/* IV Dilution — shown for IV / IM routes; auto-logs to patient Input chart on each dose given.
          R7bq-1 — added `infuseOverMinutes` (give over N min) so the nurse knows the drip rate at which
          to push/infuse the diluted dose. Stored on orderDetails so MAR + Treatment Chart can render
          it and the auto-I/O hook (R7bq-3) can stamp the same duration on the intake row. */}
      {(form.route === "IV" || form.route === "IM") && (
        <div style={{ padding: "10px 12px", background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 8, marginBottom: 6 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#0369a1", textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 8 }}>
            💧 IV Dilution — optional · auto-logged to Input chart when nurse administers
          </div>
          <div style={g("120px 1fr 140px")}>
            <div>
              <label className="his-label">Volume (ml)</label>
              <input type="number" min="0" className="his-field" placeholder="e.g. 100"
                value={form.dilutionVolume || ""} onChange={e => set("dilutionVolume", e.target.value ? Number(e.target.value) : "")} />
            </div>
            <div>
              <label className="his-label">Diluent / Vehicle</label>
              <select className="his-select" value={form.dilutionFluid || "NS 0.9%"} onChange={e => set("dilutionFluid", e.target.value)}>
                <option value="NS 0.9%">NS 0.9% (Normal Saline)</option>
                <option value="DNS">DNS (Dextrose Normal Saline)</option>
                <option value="D5W">D5W (Dextrose 5% in Water)</option>
                <option value="RL">RL (Ringer's Lactate)</option>
                <option value="D10W">D10W (Dextrose 10%)</option>
                <option value="Sterile Water">Sterile Water for Injection</option>
                <option value="Isolyte-S">Isolyte-S</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div>
              <label className="his-label">Infuse Over (min)</label>
              <input type="number" min="0" className="his-field" placeholder="e.g. 30"
                value={form.infuseOverMinutes || ""} onChange={e => set("infuseOverMinutes", e.target.value ? Number(e.target.value) : "")} />
            </div>
          </div>
          {form.dilutionVolume > 0 && (
            <div style={{ marginTop: 6, fontSize: 11, color: "#0369a1" }}>
              📋 <strong>{form.medicineName || "Drug"}</strong> ko <strong>{form.dilutionVolume} ml {form.dilutionFluid || "NS 0.9%"}</strong> mein dilute karke
              {form.infuseOverMinutes > 0
                ? <> <strong>{form.infuseOverMinutes} min</strong> mein dena</>
                : " dena"} — har dose administration par Input chart mein auto-entry hogi.
            </div>
          )}
        </div>
      )}
      {/* Indication */}
      <Field form={form} set={set} label="Indication / Clinical Reason" name="indication" placeholder="e.g. Community-acquired pneumonia, Post-op pain, Type 2 DM" type="textarea"/>
      {/* HAM — High Alert Medication status */}
      {(() => {
        const HAM_KW = ["insulin","heparin","enoxaparin","warfarin","digoxin","amiodarone","kcl","potassium","magnesium sulphate","mgso4","morphine","fentanyl","pethidine","tramadol iv","noradrenaline","norepinephrine","adrenaline","epinephrine","dopamine","dobutamine","vasopressin","suxamethonium","succinylcholine","vecuronium","rocuronium","streptokinase","alteplase","methotrexate","cyclophosphamide","cisplatin","vincristine","oxytocin","nitroprusside","ketamine","propofol","midazolam iv","vancomycin iv","gentamicin iv","amikacin iv","dextrose 25%","dextrose 50%","concentrated sodium","hypertonic saline","fondaparinux","acenocoumarol","lidocaine","lignocaine"];
        const autoHAM = HAM_KW.some(k => (form.medicineName || "").toLowerCase().includes(k));
        const isHAM  = form.hamFlag || autoHAM;
        return (
          <div style={{ padding: "10px 12px", background: isHAM ? "#fef2f2" : "#f9fafb", border: `1.5px solid ${isHAM ? "#fca5a5" : C.border}`, borderRadius: 8, marginBottom: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer" }}>
                <input type="checkbox" checked={!!form.hamFlag || autoHAM}
                  onChange={e => set("hamFlag", e.target.checked)}
                  style={{ width: 15, height: 15, accentColor: "#dc2626" }}
                  disabled={autoHAM}/>
                <span style={{ fontWeight: 700, fontSize: 12, color: isHAM ? "#dc2626" : C.muted }}>
                  {autoHAM ? "⚠ HIGH ALERT MEDICATION — Auto-detected" : "Mark as High Alert Medication (HAM)"}
                </span>
              </label>
              {isHAM && (
                <span style={{ fontSize: 10, color: "#991b1b", background: "#fee2e2", border: "1px solid #fca5a5", padding: "2px 7px", borderRadius: 4, fontWeight: 700 }}>
                  NABH MOM.9 — Two-nurse verification on administration
                </span>
              )}
            </div>
            {isHAM && (
              <div style={{ display: "flex", gap: 16, marginTop: 8, flexWrap: "wrap" }}>
                <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "#dc2626", cursor: "pointer" }}>
                  <input type="checkbox" checked={!!form.twoNurseRequired || autoHAM}
                    onChange={e => set("twoNurseRequired", e.target.checked)} style={{ accentColor: "#dc2626" }}/>
                  Two-nurse verification required
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "#dc2626", cursor: "pointer" }}>
                  <input type="checkbox" checked={!!form.concentratedElectrolyte}
                    onChange={e => set("concentratedElectrolyte", e.target.checked)} style={{ accentColor: "#dc2626" }}/>
                  Concentrated electrolyte
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "#dc2626", cursor: "pointer" }}>
                  <input type="checkbox" checked={!!form.highRisk}
                    onChange={e => set("highRisk", e.target.checked)} style={{ accentColor: "#dc2626" }}/>
                  High risk / narrow therapeutic index
                </label>
              </div>
            )}
          </div>
        );
      })()}
      <Field form={form} set={set} label="Special Instructions" name="notes" placeholder="Pre/post food, monitoring, interactions…" type="textarea"/>
    </>
  );

  if (typeId === "IV_Fluid") return (
    <>
      <div style={g("2fr 1fr 1fr")}>
        <ServicePicker form={form} set={set} label="Fluid / Solution *" category="IV_Fluid"
          nameField="medicineName" placeholder="e.g. NS 0.9%, RL, DNS, Dextrose 5%"/>
        <Field form={form} set={set} label="Volume *" name="totalVolume" type="number" placeholder="500" unit="ml"/>
        <Field form={form} set={set} label="Rate" name="rate" type="number" placeholder="83" unit="ml / hr"/>
      </div>
      <div style={g("1fr 1fr 1fr 1fr")}>
        <Field form={form} set={set} label="Duration" name="durationValue" type="number" placeholder="6"
          unitOptions={["hrs","mins","days"]} unitName="durationUnit"/>
        <Field form={form} set={set} label="Access Site" name="accessSite" options={["Peripheral IV","Central Line (CVP)","PICC","Arterial Line","Intraosseous"]}/>
        <Field form={form} set={set} label="Additives" name="additives" placeholder="KCl 20mEq, MgSO4…"/>
        <Field form={form} set={set} label="Priority" name="priority" options={["Routine","Urgent","STAT"]}/>
      </div>
      {/* Infusion schedule preview */}
      {(form.totalVolume > 0 && form.rate > 0) && (() => {
        const hrs = form.durationValue > 0
          ? (form.durationUnit === "mins" ? form.durationValue / 60 : form.durationUnit === "days" ? form.durationValue * 24 : form.durationValue)
          : form.totalVolume / form.rate;
        return (
          <div style={{ padding: "10px 14px", background: "#f0fdf4", border: "1.5px solid #86efac", borderRadius: 8, marginBottom: 6, fontSize: 11, color: "#15803d" }}>
            📊 <strong>{form.totalVolume} ml</strong> at <strong>{form.rate} ml/hr</strong> → runs for <strong>~{Math.round(hrs * 10) / 10} hrs</strong>
            {Math.ceil(hrs) > 1 && <> · <strong>{Math.ceil(hrs)} hourly entries</strong> will be auto-created in the Input/Output chart when nurse starts the infusion</>}
          </div>
        );
      })()}
      <Field form={form} set={set} label="Instructions" name="notes" placeholder="Drip rate, monitoring, pump settings…" type="textarea"/>
    </>
  );

  if (typeId === "Lab") return (
    <>
      <div style={g("2fr 1fr")}>
        <ServicePicker form={form} set={set} label="Test Name(s) *" category="Lab"
          nameField="testName" placeholder="CBC, LFT, RFT, Blood Culture, Coagulation…"/>
        <Field form={form} set={set} label="Priority" name="priority" options={["Routine","Urgent","STAT"]}/>
      </div>
      <div style={g("1fr 1fr")}>
        <Field form={form} set={set} label="Sample Type" name="sampleType" options={["Venous Blood","Arterial Blood","Urine (Spot)","Urine (24hr)","Stool","Sputum","Swab","CSF","Pleural Fluid","Ascitic Fluid","Tissue Biopsy"]}/>
        <Field form={form} set={set} label="Fasting Required" name="fasting" options={["No","Yes — 8 hrs","Yes — 12 hrs"]}/>
      </div>
      <Field form={form} set={set} label="Clinical Details / Special Instructions" name="notes" placeholder="Pre-antibiotic, timing, paired samples…" type="textarea"/>
    </>
  );

  if (typeId === "Radiology") return (
    <>
      <div style={g("2fr 1fr 1fr")}>
        <ServicePicker form={form} set={set} label="Scan / Study *" category="Radiology"
          nameField="testName" placeholder="e.g. CECT Chest, USG Abdomen, MRI Brain, X-Ray PA"/>
        <Field form={form} set={set} label="Region / Body Part" name="region" placeholder="e.g. Chest, Abdomen-Pelvis"/>
        <Field form={form} set={set} label="Priority" name="priority" options={["Routine","Urgent","STAT"]}/>
      </div>
      <div style={g("1fr 1fr 1fr")}>
        <Field form={form} set={set} label="Contrast" name="contrast" options={["Plain (No Contrast)","With IV Contrast","With Oral Contrast","Both"]}/>
        <Field form={form} set={set} label="Sedation Required" name="sedation" options={["No","Yes"]}/>
        <Field form={form} set={set} label="Laterality" name="laterality" options={["—","Right","Left","Bilateral"]}/>
      </div>
      <Field form={form} set={set} label="Clinical Indication / History" name="notes" placeholder="Relevant clinical details, allergy to contrast, prior imaging…" type="textarea"/>
    </>
  );

  if (typeId === "Procedure") return (
    <>
      <div style={g("2fr 1fr")}>
        <ServicePicker form={form} set={set} label="Procedure Name *" category="Procedure"
          nameField="procedureName" placeholder="e.g. Chest Drain Insertion, Lumbar Puncture, IV Cannula"/>
        <Field form={form} set={set} label="Type" name="procedureType" options={["Minor","Major","Diagnostic","Therapeutic","Bedside"]}/>
      </div>
      <div style={g("1fr 1fr 1fr")}>
        <Field form={form} set={set} label="Indication *" name="indication" placeholder="e.g. Pleural Effusion, Raised ICP"/>
        <Field form={form} set={set} label="Estimated Duration" name="estimatedDuration" placeholder="e.g. 30 min"/>
        <Field form={form} set={set} label="Priority" name="priority" options={["Routine","Urgent","STAT"]}/>
      </div>
      <div style={g("1fr 1fr 1fr 1fr")}>
        <Field form={form} set={set} label="Consent Required" name="consentRequired" options={["Yes","No"]}/>
        <Field form={form} set={set} label="Anaesthesia" name="anaesthesia" options={["None","Local","Sedation","GA"]}/>
        <Field form={form} set={set} label="Position" name="position" options={["Supine","Lateral Decubitus","Sitting","Prone","Lithotomy"]}/>
        {/* B3-T06 — Will be conducted in OT?
            Auto-defaults to Yes when type is Major/Surgical OR anaesthesia is GA/Sedation,
            otherwise No. Doctor can override either way. The boolean lands on
            base.requiresOT in buildPayload so the OT scheduler / procedure register
            can pick it up downstream. */}
        <Field
          form={{ ...form, requiresOT: form.requiresOT
            || ((form.procedureType === "Major" || form.procedureType === "Surgical"
                 || form.anaesthesia   === "GA"    || form.anaesthesia   === "Sedation") ? "Yes" : "No") }}
          set={set}
          label="Will be conducted in OT?"
          name="requiresOT"
          options={["Yes","No"]}/>
      </div>
      <Field form={form} set={set} label="Pre-procedure Instructions / Equipment Needed" name="notes" placeholder="NPO, coagulation check, equipment list…" type="textarea"/>
    </>
  );

  if (typeId === "BloodTransfusion") return (
    <>
      <div style={g("2fr 1fr 1fr 1fr")}>
        <ServicePicker form={form} set={set} label="Blood Product *" category="BloodTransfusion"
          nameField="medicineName" placeholder="e.g. Packed Red Cells, FFP, Platelets, Cryoprecipitate"/>
        <Field form={form} set={set} label="Units / Volume" name="dose" placeholder="e.g. 2 units / 400ml"/>
        <Field form={form} set={set} label="Rate" name="rate" placeholder="e.g. 4 hrs/unit"/>
        <Field form={form} set={set} label="Priority" name="priority" options={["Routine","Urgent","STAT"]}/>
      </div>
      <div style={g("1fr 1fr 1fr")}>
        <Field form={form} set={set} label="Blood Group (Patient)" name="bloodGroup" placeholder="e.g. B+"/>
        <Field form={form} set={set} label="Cross-Match Done" name="crossMatchDone" options={["Yes","No — Emergency"]}/>
        <Field form={form} set={set} label="Consent for Transfusion" name="consentRequired" options={["Yes","No"]}/>
      </div>
      <div style={g("1fr 1fr")}>
        <Field form={form} set={set} label="Pre-medications" name="premeds" placeholder="e.g. Paracetamol 1g IV, Hydrocortisone 100mg IV"/>
        <Field form={form} set={set} label="Monitoring Frequency" name="monitoring" options={["Every 15 min (1st hr)","Every 30 min","Hourly","Continuous"]}/>
      </div>

      {/* R7du — Pre-Transfusion Checklist (NABH MOM.4)
          The BloodTransfusionRegister.preTransfusion sub-document was wired
          on the backend (emitBloodTransfusion reads order.preTransfusion.{
          consentSigned, consentFormId, bp, pulse, temp, spo2 }) but no UI
          ever populated it — every BT register row had blank consent + pre-tx
          vitals. This sub-card captures those at order time. buildPayload()
          collects these flat keys into a top-level `preTransfusion` object
          on the order POST so the route → emitter chain sees the data. */}
      <div style={{ padding: "10px 12px", background: "#fef2f2", border: "1.5px solid #fecaca", borderRadius: 8, marginBottom: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <i className="pi pi-check-circle" style={{ fontSize: 13, color: "#dc2626" }}/>
          <span style={{ fontWeight: 800, fontSize: 12, color: "#dc2626", letterSpacing: ".3px" }}>
            Pre-Transfusion Checklist
          </span>
          <span style={{ fontSize: 10, color: "#991b1b", background: "#fee2e2", border: "1px solid #fca5a5", padding: "2px 7px", borderRadius: 4, fontWeight: 700 }}>
            NABH MOM.4
          </span>
        </div>

        {/* Consent capture */}
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
            <input type="checkbox"
              checked={!!form.preTxConsentSigned}
              onChange={e => set("preTxConsentSigned", e.target.checked)}
              style={{ width: 15, height: 15, accentColor: "#dc2626" }}/>
            <span style={{ fontWeight: 700, fontSize: 12, color: "#7f1d1d" }}>
              Consent obtained from patient / relative
            </span>
          </label>
          <div style={{ flex: 1, minWidth: 200 }}>
            <input className="his-field" type="text"
              placeholder="Consent form ID / attachment ref (optional)"
              value={form.preTxConsentFormId || ""}
              onChange={e => set("preTxConsentFormId", e.target.value)}/>
          </div>
        </div>

        {/* Pre-transfusion vitals */}
        <div style={{ fontSize: 10, fontWeight: 700, color: "#7f1d1d", textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 6 }}>
          Pre-transfusion vitals (optional — recommended)
        </div>
        <div style={{ ...row, gridTemplateColumns: "1fr 1fr 1fr 1fr" }}>
          <Field form={form} set={set} label="BP" name="preTxBp" placeholder="e.g. 120/80"/>
          <Field form={form} set={set} label="Pulse" name="preTxPulse" type="number" placeholder="e.g. 78" unit="bpm"/>
          <Field form={form} set={set} label="Temp" name="preTxTemp" type="number" placeholder="e.g. 37" unit="°C"/>
          <Field form={form} set={set} label="SpO₂" name="preTxSpo2" type="number" placeholder="e.g. 98" unit="%"/>
        </div>

        {/* Warning banner — consent not obtained */}
        {!form.preTxConsentSigned && (
          <div style={{ marginTop: 10, padding: "8px 10px", background: "#fffbeb", border: "1.5px solid #fde68a", borderRadius: 6, fontSize: 11, color: "#92400e", display: "flex", alignItems: "center", gap: 6 }}>
            <i className="pi pi-exclamation-triangle" style={{ fontSize: 12 }}/>
            <span><strong>Consent should be obtained before transfusion starts</strong> — NABH MOM.4. You can save and add consent later, but the BT register row will flag this.</span>
          </div>
        )}
      </div>

      <Field form={form} set={set} label="Special Instructions / Transfusion Notes" name="notes" placeholder="Reaction plan, warmer required, irradiated blood…" type="textarea"/>
    </>
  );

  if (typeId === "Diet") return (
    <>
      <div style={g("2fr 1fr 1fr")}>
        <ServicePicker form={form} set={set} label="Diet Type *" category="Diet"
          nameField="dietType" placeholder="e.g. Regular, Diabetic, Renal, NPO, Enteral…"/>
        <Field form={form} set={set} label="Caloric Target (kcal)" name="calories" placeholder="e.g. 2000"/>
        <Field form={form} set={set} label="Protein Target (g)" name="protein" placeholder="e.g. 80"/>
      </div>
      <div style={g("1fr 1fr 1fr")}>
        <Field form={form} set={set} label="Fluid Restriction" name="fluidRestriction" placeholder="e.g. 1500ml/day"/>
        <Field form={form} set={set} label="Consistency" name="consistency" options={["Normal","Minced","Pureed","Thickened"]}/>
        <Field form={form} set={set} label="Priority" name="priority" options={["Routine","Urgent","STAT"]}/>
      </div>
      <Field form={form} set={set} label="Specific Instructions / Allergies / Supplements" name="notes" placeholder="Food allergies, supplements, tube feeding formula…" type="textarea"/>
    </>
  );

  if (typeId === "Oxygen") return (
    <>
      <div style={g("2fr 1fr 1fr 1fr")}>
        <ServicePicker form={form} set={set} label="Delivery Device *" category="Oxygen"
          nameField="deliveryDevice" placeholder="e.g. Nasal Prongs, HFNC, BiPAP, Venturi…"/>
        <Field form={form} set={set} label="Flow Rate (L/min)" name="flowRate" placeholder="e.g. 4"/>
        <Field form={form} set={set} label="FiO₂ (%)" name="fio2" placeholder="e.g. 40"/>
        <Field form={form} set={set} label="Target SpO₂ (%)" name="targetSpo2" placeholder="e.g. ≥95"/>
      </div>
      <div style={g("1fr 1fr 1fr 1fr")}>
        <Field form={form} set={set} label="HFNC Flow (L/min)" name="hfncFlow" placeholder="e.g. 40 (if HFNC)"/>
        <Field form={form} set={set} label="Duration" name="durationValue" type="number" placeholder="e.g. 6"
          unitOptions={["hrs","mins","days","Continuous","PRN"]} unitName="durationUnit"/>
        <Field form={form} set={set} label="Duration (free-text)" name="duration" placeholder="e.g. Continuous, PRN, 6 hrs"/>
        <Field form={form} set={set} label="Priority" name="priority" options={["Routine","Urgent","STAT"]}/>
      </div>
      <Field form={form} set={set} label="Weaning Instructions / Special Notes" name="notes" placeholder="Wean by 2 L/min every 4 hrs if SpO₂ stable…" type="textarea"/>
    </>
  );

  if (typeId === "Physiotherapy") return (
    <>
      <div style={g("2fr 1fr 1fr")}>
        <ServicePicker form={form} set={set} label="PT Type *" category="Physiotherapy"
          nameField="ptType" placeholder="e.g. Chest PT, Limb Exercises, Ambulation, Incentive Spirometry…"/>
        <Field form={form} set={set} label="Frequency" name="frequency" options={["Once Daily","Twice Daily","Three Times Daily","PRN","Every 4 hrs","Post Op (Immediately)"]}/>
        <Field form={form} set={set} label="Priority" name="priority" options={["Routine","Urgent","STAT"]}/>
      </div>
      <div style={g("1fr 1fr 1fr")}>
        <Field form={form} set={set} label="Sessions / Day" name="sessionsPerDay" type="number" placeholder="e.g. 2"/>
        <Field form={form} set={set} label="Duration" name="durationValue" type="number" placeholder="e.g. 5"
          unitOptions={["days","weeks","sessions"]} unitName="durationUnit"/>
        <Field form={form} set={set} label="Modality" name="modality" placeholder="e.g. Manual, Ultrasound, TENS"/>
      </div>
      <div style={g("1fr 1fr")}>
        <Field form={form} set={set} label="Goals" name="goals" placeholder="e.g. Improve sputum clearance, prevent DVT, restore ambulation"/>
        <Field form={form} set={set} label="Precautions / Contraindications" name="precautions" placeholder="e.g. Avoid vigorous chest PT if INR > 2.5"/>
      </div>
      <Field form={form} set={set} label="Instructions for Physiotherapist" name="notes" placeholder="Specific exercises, pain threshold, assistive devices…" type="textarea"/>
    </>
  );

  if (typeId === "Activity") return (
    <>
      <div style={g("2fr 1fr 1fr")}>
        <ServicePicker form={form} set={set} label="Activity Level *" category="Activity"
          nameField="activityLevel" placeholder="e.g. Bed Rest, Dangle, Chair Sit, Ambulate…"/>
        <Field form={form} set={set} label="Assistance Level" name="assistanceLevel" options={["Independent","Supervision Only","Minimum Assist (< 25%)","Moderate Assist (25–50%)","Maximum Assist (> 50%)","Dependent / Full Assist"]}/>
        <Field form={form} set={set} label="Priority" name="priority" options={["Routine","Urgent","STAT"]}/>
      </div>
      <div style={g("1fr 1fr")}>
        <Field form={form} set={set} label="Restrictions" name="restrictions" placeholder="e.g. No weight bearing left leg, no bending > 90°"/>
        <Field form={form} set={set} label="Goals" name="goals" placeholder="e.g. Prevent DVT, improve lung expansion"/>
      </div>
      <Field form={form} set={set} label="Nursing / Rehab Instructions" name="notes" placeholder="Fall precautions, assistive device, reassessment…" type="textarea"/>
    </>
  );

  if (typeId === "Nursing") return (
    <>
      <div style={g("2fr 1fr")}>
        <ServicePicker form={form} set={set} label="Nursing Instruction *" category="Nursing"
          nameField="instruction" placeholder="e.g. 2-hourly position change, hourly urine output, wound care"/>
        <Field form={form} set={set} label="Frequency" name="frequency" options={["Stat (Once)","Hourly","2-Hourly","4-Hourly","6-Hourly","8-Hourly","12-Hourly","Daily","BD","TDS","PRN","Continuous"]}/>
      </div>
      <div style={g("1fr 1fr 1fr 1fr")}>
        <Field form={form} set={set} label="Care Category" name="careCategory" options={["Wound Care","Catheter Care","NG Tube Care","Tracheostomy Care","Pressure Area Care","Oral Hygiene","Eye Care","IV Site Care","Drain Care","Monitoring","Medication-Related","Other"]}/>
        <Field form={form} set={set} label="Duration" name="durationValue" type="number" placeholder="e.g. 3"
          unitOptions={["days","hrs","weeks","Until DC"]} unitName="durationUnit"/>
        <Field form={form} set={set} label="Duration (free-text)" name="duration" placeholder="e.g. Until DC, 3 days"/>
        <Field form={form} set={set} label="Priority" name="priority" options={["Routine","Urgent","STAT"]}/>
      </div>
      <Field form={form} set={set} label="Detailed Instructions" name="notes" placeholder="Step-by-step nursing instructions, product to use, documentation required…" type="textarea"/>
    </>
  );

  if (typeId === "Consultation") return (
    <>
      <div style={g("2fr 1fr 1fr")}>
        <ServicePicker form={form} set={set} label="Speciality *" category="Consultation"
          nameField="speciality" placeholder="e.g. Cardiology, Neurology, Nephrology…"/>
        <Field form={form} set={set} label="Consultant Name" name="consultantName" placeholder="e.g. Dr. Sharma"/>
        <Field form={form} set={set} label="Priority" name="priority" options={["Routine","Urgent","STAT"]}/>
      </div>
      <div style={g("1fr")}>
        <Field form={form} set={set} label="Referred By" name="referredBy" placeholder="Referring doctor name"/>
      </div>
      <Field form={form} set={set} label="Reason for Referral / Clinical Summary *" name="reason" placeholder="Brief history, key findings, specific question for consultant…" type="textarea"/>
      <Field form={form} set={set} label="Investigations Shared" name="notes" placeholder="CBC, CT scan, ECG reports shared…" type="textarea"/>
    </>
  );

  return null;
}

/* ══════════════════════════════════════════════════════════════
   AUDIT TRAIL DISPLAY for one order
══════════════════════════════════════════════════════════════ */
function AuditTrail({ order }) {
  const steps = STEPS[order.orderType] || ["Acknowledged", "Done"];
  const done  = order.auditLog || [];
  const meta  = ORDER_TYPES.find(t => t.id === order.orderType) || ORDER_TYPES[0];

  const fmt = (d) => d ? new Date(d).toLocaleString("en-IN", { day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit", hour12:true }) : "—";

  return (
    <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 10, marginTop: 10 }}>
      {/* ── Initiation row ── */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 10 }}>
        <div style={{ width: 28, height: 28, borderRadius: "50%", background: meta.bg, border: `1.5px solid ${meta.border}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <i className={`pi ${meta.icon}`} style={{ fontSize: 12, color: meta.color }}/>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: meta.color }}>ORDER PLACED</div>
          <div style={{ fontSize: 12, color: C.text, fontWeight: 600 }}>Dr. {order.orderedBy || "—"}</div>
          <div style={{ fontSize: 11, color: C.muted }}>{fmt(order.createdAt)} · Role: {order.orderedByRole || "Doctor"}</div>
        </div>
        <div style={{ padding: "2px 8px", borderRadius: 12, background: PRIO[order.priority]?.bg || C.grayL, color: PRIO[order.priority]?.color || C.muted, fontSize: 10, fontWeight: 800, letterSpacing: ".5px" }}>
          {order.priority || "Routine"}
        </div>
      </div>

      {/* ── Step pipeline ── */}
      <div style={{ paddingLeft: 14, borderLeft: `2px dashed ${C.border}` }}>
        {steps.map((step, idx) => {
          const log = done[idx];
          const isDone = !!log;
          const isCurrent = !isDone && done.length === idx;
          return (
            <div key={step} style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 8, opacity: isDone ? 1 : isCurrent ? 0.75 : 0.35 }}>
              <div style={{ width: 22, height: 22, borderRadius: "50%", background: isDone ? C.greenL : isCurrent ? C.amberL : C.grayL, border: `1.5px solid ${isDone ? C.greenB : isCurrent ? C.amberB : C.border}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 }}>
                {isDone
                  ? <i className="pi pi-check" style={{ fontSize: 9, color: C.green, fontWeight: 900 }}/>
                  : isCurrent
                    ? <i className="pi pi-clock" style={{ fontSize: 9, color: C.amber }}/>
                    : <div style={{ width: 6, height: 6, borderRadius: "50%", background: C.gray }}/>
                }
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: isDone ? C.green : isCurrent ? C.amber : C.muted, textTransform: "uppercase", letterSpacing: ".4px" }}>{step}</div>
                {isDone && (
                  <div style={{ fontSize: 11, color: C.text }}>
                    <span style={{ fontWeight: 600 }}>{log.doneBy || "—"}</span>
                    <span style={{ color: C.muted }}> · {fmt(log.doneAt)}</span>
                    {log.notes && <span style={{ color: C.muted }}> · "{log.notes}"</span>}
                  </div>
                )}
                {isCurrent && <div style={{ fontSize: 11, color: C.amber }}>Awaiting execution</div>}
              </div>
            </div>
          );
        })}

        {/* Final completion row */}
        {order.status === "Completed" && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, padding: "6px 10px", borderRadius: 8, background: C.greenL, border: `1px solid ${C.greenB}` }}>
            <i className="pi pi-check-circle" style={{ fontSize: 13, color: C.green }}/>
            <div style={{ fontSize: 11 }}>
              <span style={{ fontWeight: 700, color: C.green }}>ORDER COMPLETED</span>
              {order.completedBy && <span style={{ color: C.muted }}> by {order.completedBy}</span>}
              {order.completedAt && <span style={{ color: C.muted }}> · {fmt(order.completedAt)}</span>}
            </div>
          </div>
        )}
        {order.status === "Cancelled" && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, padding: "6px 10px", borderRadius: 8, background: C.redL, border: `1px solid ${C.redB}` }}>
            <i className="pi pi-times-circle" style={{ fontSize: 13, color: C.red }}/>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.red }}>ORDER CANCELLED</div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   COMPLETE PROCEDURE MODAL — NABH COP.10 evidence

   Posts to /api/procedure-notes which transitions the underlying
   OTRegister row Scheduled → Completed. Renders for Procedure orders
   flagged requiresOT=true that have not yet been completed.

   Required fields: startTime, endTime, actualProcedure. Everything
   else (anaesthetist, complications, blood loss, specimens,
   destination) is optional but encouraged for surveyor evidence.
══════════════════════════════════════════════════════════════ */
function CompleteProcedureModal({ order, onClose, onSaved }) {
  const nowLocal = () => {
    const d = new Date();
    d.setSeconds(0, 0);
    // Format YYYY-MM-DDTHH:MM for <input type="datetime-local">. Use the
    // local-time getters (not toISOString) so the picker shows the user's
    // wall clock, not UTC.
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  // Pre-populate from the order so the surgeon doesn't retype known fields.
  const details = order.orderDetails || {};
  const defaultStart = details.scheduledAt
    ? new Date(details.scheduledAt).toISOString().slice(0, 16)
    : nowLocal();

  const [form, setForm] = useState({
    startTime:         defaultStart,
    endTime:           nowLocal(),
    actualProcedure:   details.procedureName || details.surgeryName || "",
    anaesthetistName:  details.anaesthetistName || "",
    anaesthesiaType:   details.anaesthesiaType || "",
    asaGrade:          details.asaGrade || "",
    complications:     "",
    bloodLossMl:       "",
    postOpDestination: "Recovery",
  });
  const [specimens, setSpecimens] = useState([]);  // [{ name, sentTo }]
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const addSpecimen = () => setSpecimens((p) => [...p, { name: "", sentTo: "Histopathology" }]);
  const updSpecimen = (idx, patch) => setSpecimens((p) => p.map((s, i) => i === idx ? { ...s, ...patch } : s));
  const delSpecimen = (idx) => setSpecimens((p) => p.filter((_, i) => i !== idx));

  const handleSave = async () => {
    if (saving) return;
    setError("");
    if (!form.startTime || !form.endTime) {
      setError("Start time and end time are required");
      return;
    }
    if (new Date(form.endTime) < new Date(form.startTime)) {
      setError("End time cannot be before start time");
      return;
    }
    if (!form.actualProcedure.trim()) {
      setError("Actual procedure is required");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        doctorOrderId:     order._id,
        startTime:         new Date(form.startTime).toISOString(),
        endTime:           new Date(form.endTime).toISOString(),
        actualProcedure:   form.actualProcedure.trim(),
        surgeryName:       details.surgeryName || details.procedureName || form.actualProcedure.trim(),
        anaesthetistName:  form.anaesthetistName || undefined,
        anaesthesiaType:   form.anaesthesiaType || undefined,
        asaGrade:          form.asaGrade || undefined,
        complications:     form.complications || undefined,
        bloodLossMl:       form.bloodLossMl !== "" ? Number(form.bloodLossMl) : undefined,
        postOpDestination: form.postOpDestination || "Recovery",
        specimensSent:     specimens
          .filter((s) => (s.name || "").trim() || (s.sentTo || "").trim())
          .map((s) => ({ name: s.name.trim(), sentTo: s.sentTo.trim() })),
      };
      const r = await createProcedureNote(payload);
      toast.success("Procedure note saved — OT register updated");
      onSaved?.(r.data);
      onClose?.();
    } catch (e) {
      const msg = e?.message || "Failed to save procedure note";
      setError(msg);
      toast.error(msg);
    } finally { setSaving(false); }
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 9000, padding: 16,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <div style={{
        background: C.card, borderRadius: 12, width: "min(720px, 100%)",
        maxHeight: "92vh", overflowY: "auto",
        boxShadow: "0 24px 48px rgba(15,23,42,.3)",
      }}>
        {/* Header */}
        <div style={{
          background: `linear-gradient(135deg, ${C.green} 0%, #15803d 100%)`,
          padding: "12px 16px", display: "flex", alignItems: "center", gap: 10,
        }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: "rgba(255,255,255,.18)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <i className="pi pi-check-circle" style={{ color: "white", fontSize: 15 }}/>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ color: "white", fontWeight: 800, fontSize: 14 }}>Complete Procedure</div>
            <div style={{ color: "rgba(255,255,255,.8)", fontSize: 11 }}>
              NABH COP.10 · {details.procedureName || details.surgeryName || "OT case"}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: "rgba(255,255,255,.15)", border: "none", borderRadius: 7, padding: "5px 8px", cursor: "pointer", color: "white" }}
          ><i className="pi pi-times" style={{ fontSize: 11 }}/></button>
        </div>

        {/* Body */}
        <div style={{ padding: 16, display: "grid", gap: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label className="his-label">Start Time *</label>
              <input
                className="his-field" type="datetime-local"
                value={form.startTime}
                onChange={(e) => set("startTime", e.target.value)}
              />
            </div>
            <div>
              <label className="his-label">End Time *</label>
              <input
                className="his-field" type="datetime-local"
                value={form.endTime}
                onChange={(e) => set("endTime", e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="his-label">Actual Procedure Performed *</label>
            <textarea
              className="his-textarea" rows={2}
              placeholder="e.g. Open cholecystectomy, no conversion. Liver bed coagulated."
              value={form.actualProcedure}
              onChange={(e) => set("actualProcedure", e.target.value)}
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <div>
              <label className="his-label">Anaesthetist</label>
              <input
                className="his-field" type="text"
                placeholder="Dr. …"
                value={form.anaesthetistName}
                onChange={(e) => set("anaesthetistName", e.target.value)}
              />
            </div>
            <div>
              <label className="his-label">Anaesthesia Type</label>
              <select
                className="his-select"
                value={form.anaesthesiaType}
                onChange={(e) => set("anaesthesiaType", e.target.value)}
              >
                <option value="">— select —</option>
                {["General","Spinal","Epidural","Regional","Local","MAC","Sedation","Combined"].map((x) => (
                  <option key={x} value={x}>{x}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="his-label">ASA Grade</label>
              <select
                className="his-select"
                value={form.asaGrade}
                onChange={(e) => set("asaGrade", e.target.value)}
              >
                <option value="">— select —</option>
                {["I","II","III","IV","V","VI"].map((x) => (
                  <option key={x} value={x}>{x}</option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10 }}>
            <div>
              <label className="his-label">Complications (if any)</label>
              <textarea
                className="his-textarea" rows={2}
                placeholder="Nil OR describe…"
                value={form.complications}
                onChange={(e) => set("complications", e.target.value)}
              />
            </div>
            <div>
              <label className="his-label">Blood Loss (mL)</label>
              <input
                className="his-field" type="number" min="0"
                placeholder="e.g. 150"
                value={form.bloodLossMl}
                onChange={(e) => set("bloodLossMl", e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="his-label">Post-Op Destination</label>
            <select
              className="his-select"
              value={form.postOpDestination}
              onChange={(e) => set("postOpDestination", e.target.value)}
            >
              {["Recovery","Ward","ICU","HDU","Discharge"].map((x) => (
                <option key={x} value={x}>{x}</option>
              ))}
            </select>
          </div>

          {/* Specimens — repeating rows */}
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <label className="his-label" style={{ margin: 0 }}>Specimens Sent</label>
              <button
                type="button"
                onClick={addSpecimen}
                style={{ padding: "3px 10px", border: `1px solid ${C.border}`, borderRadius: 7, background: "white", color: C.primary, fontSize: 11, fontWeight: 700, cursor: "pointer" }}
              >
                <i className="pi pi-plus" style={{ fontSize: 10, marginRight: 4 }}/>Add
              </button>
            </div>
            {specimens.length === 0 ? (
              <div style={{ fontSize: 11, color: C.muted, padding: "6px 0" }}>No specimens sent.</div>
            ) : (
              specimens.map((s, idx) => (
                <div key={idx} style={{ display: "grid", gridTemplateColumns: "2fr 1fr auto", gap: 6, marginBottom: 6 }}>
                  <input
                    className="his-field" type="text" placeholder="Specimen name"
                    value={s.name}
                    onChange={(e) => updSpecimen(idx, { name: e.target.value })}
                  />
                  <select
                    className="his-select"
                    value={s.sentTo}
                    onChange={(e) => updSpecimen(idx, { sentTo: e.target.value })}
                  >
                    {["Histopathology","Microbiology","Frozen Section","Cytology","Other"].map((x) => (
                      <option key={x} value={x}>{x}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => delSpecimen(idx)}
                    style={{ padding: "5px 10px", border: `1px solid ${C.redB}`, borderRadius: 7, background: C.redL, color: C.red, fontSize: 11, cursor: "pointer" }}
                  ><i className="pi pi-trash" style={{ fontSize: 10 }}/></button>
                </div>
              ))
            )}
          </div>

          {error && (
            <div style={{
              padding: "8px 10px", borderRadius: 7,
              background: C.redL, border: `1px solid ${C.redB}`,
              color: C.red, fontSize: 12, fontWeight: 600,
            }}>{error}</div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: 14, borderTop: `1px solid ${C.border}`, background: C.grayL,
          display: "flex", justifyContent: "flex-end", gap: 8,
        }}>
          <button
            onClick={onClose}
            disabled={saving}
            style={{ padding: "8px 18px", border: `1px solid ${C.border}`, borderRadius: 8, background: "white", color: C.muted, fontSize: 12, fontWeight: 600, cursor: saving ? "not-allowed" : "pointer" }}
          >Cancel</button>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{ padding: "8px 22px", border: "none", borderRadius: 8, background: `linear-gradient(135deg, ${C.green}, #15803d)`, color: "white", fontSize: 12, fontWeight: 800, cursor: saving ? "not-allowed" : "pointer", opacity: saving ? .7 : 1, display: "flex", alignItems: "center", gap: 6 }}
          >
            {saving
              ? <><i className="pi pi-spin pi-spinner" style={{ fontSize: 12 }}/> Saving…</>
              : <><i className="pi pi-check" style={{ fontSize: 11 }}/> Save & Complete</>}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   ORDER CARD
══════════════════════════════════════════════════════════════ */
function OrderCard({ order, onCancel, onComplete, onEdit }) {
  const [expanded, setExpanded] = useState(false);
  const meta   = TYPE_MAP[order.orderType] || ORDER_TYPES[10];
  const status = STAT_STYLE[order.status] || STAT_STYLE.Pending;
  const steps  = STEPS[order.orderType] || [];
  const done   = (order.auditLog || []).length;
  const pct    = steps.length ? Math.round((done / steps.length) * 100) : 0;

  const displayName = order.orderDetails?.medicineName
    || order.orderDetails?.testName
    || order.orderDetails?.procedureName
    || order.orderDetails?.instruction
    || order.orderDetails?.dietType
    || order.orderDetails?.ptType
    || order.orderDetails?.activityLevel
    || order.orderDetails?.deliveryDevice
    || order.orderDetails?.speciality
    || "—";

  // P1-6: orderType-aware subtitle composition. Medication / Investigation /
  // Procedure keep the canonical dose+route+frequency+duration shape; the
  // rest pick the fields their form actually populates so cards don't render
  // blank or generic "Routine · —" strings.
  const od = order.orderDetails || {};
  const subtitle = (() => {
    switch (order.orderType) {
      case "Diet":
        return [od.calories && `${od.calories} kcal`, od.restrictions, od.consistency].filter(Boolean).join(" · ");
      case "Activity":
        return [od.activityLevel, od.assistanceLevel].filter(Boolean).join(" · ");
      case "Oxygen":
        return [od.deliveryDevice, od.fio2 && `FiO2 ${od.fio2}`, od.targetSpo2 && `SpO2 ${od.targetSpo2}`, od.flowRate && `${od.flowRate} L/min`].filter(Boolean).join(" · ");
      case "Consultation":
        return [od.speciality, od.consultantName].filter(Boolean).join(" · ");
      case "Nursing":
        return [od.instruction, od.careCategory, od.frequency].filter(Boolean).join(" · ");
      case "Physiotherapy":
        return [od.ptType, od.sessionsPerDay && `${od.sessionsPerDay}/day`, od.modality, od.frequency].filter(Boolean).join(" · ");
      case "IV_Fluid":
        return [od.totalVolume && `${od.totalVolume} ml`, od.rate && `${od.rate} ml/hr`, od.accessSite, od.duration].filter(Boolean).join(" · ");
      default:
        return [
          od.dose,
          od.route,
          od.frequency,
          od.duration,
          od.priority && od.priority !== "Routine" ? od.priority : null,
          od.region,
          od.flowRate && `${od.flowRate} L/min`,
        ].filter(Boolean).join(" · ");
    }
  })();

  return (
    <div style={{ background: C.card, border: `1.5px solid ${expanded ? meta.border : C.border}`, borderRadius: 10, overflow: "hidden", marginBottom: 8, transition: "border-color .2s" }}>
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", cursor: "pointer" }} onClick={() => setExpanded(!expanded)}>
        {/* Type icon */}
        <div style={{ width: 32, height: 32, borderRadius: 8, background: meta.bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <i className={`pi ${meta.icon}`} style={{ fontSize: 13, color: meta.color }}/>
        </div>
        {/* Main info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: meta.color, background: meta.bg, padding: "1px 7px", borderRadius: 10, border: `1px solid ${meta.border}` }}>{meta.label}</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 260 }}>{displayName}</span>
          </div>
          {subtitle && <div style={{ fontSize: 11, color: C.muted, marginTop: 1 }}>{subtitle}</div>}
        </div>
        {/* Progress bar */}
        {steps.length > 0 && order.status !== "Cancelled" && (
          <div style={{ width: 64, flexShrink: 0, textAlign: "center" }}>
            <div style={{ height: 4, borderRadius: 4, background: "#e2e8f0", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${pct}%`, background: order.status === "Completed" ? C.green : C.teal, borderRadius: 4, transition: "width .4s" }}/>
            </div>
            <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>{done}/{steps.length} steps</div>
          </div>
        )}
        {/* Status + priority */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3, flexShrink: 0 }}>
          <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 10, background: status.bg, color: status.color }}>{order.status}</span>
          <span style={{ fontSize: 10, color: PRIO[order.priority]?.color || C.muted }}>{order.priority || "Routine"}</span>
        </div>
        {/* Expand */}
        <i className={`pi pi-chevron-${expanded ? "up" : "down"}`} style={{ fontSize: 10, color: C.muted, flexShrink: 0 }}/>
      </div>

      {/* Expanded audit trail */}
      {expanded && (
        <div style={{ padding: "0 14px 14px" }}>
          <AuditTrail order={order}/>
          <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
            {/* Complete Procedure button — appears for ANY Procedure order
                that hasn't finished yet. Backend procedureNoteController
                handles both OT and bedside procedures; OTRegister row only
                transitions when requiresOT===true (NABH COP.10). */}
            {order.orderType === "Procedure"
              && order.status !== "Completed"
              && order.status !== "Cancelled" && (
                <button
                  onClick={(e) => { e.stopPropagation(); onComplete?.(order); }}
                  style={{ padding: "5px 12px", border: `1px solid ${C.greenB}`, borderRadius: 7, background: C.greenL, color: C.green, fontSize: 11, fontWeight: 700, cursor: "pointer" }}
                >
                  <i className="pi pi-check-circle" style={{ marginRight: 5 }}/> Complete Procedure
                </button>
              )}
            {/* P1-5: Edit (modify) — NABH MOM.3 amend with reason. Only for
                still-actionable orders; once Completed/Cancelled, amendments
                are not allowed (would invalidate the audit trail). */}
            {order.status !== "Completed" && order.status !== "Cancelled" && onEdit && (
              <button
                onClick={(e) => { e.stopPropagation(); onEdit(order); }}
                style={{ padding: "5px 12px", border: `1px solid ${C.blueB}`, borderRadius: 7, background: C.blueL, color: C.blue, fontSize: 11, fontWeight: 700, cursor: "pointer" }}
              >
                <i className="pi pi-pencil" style={{ marginRight: 5 }}/> Edit
              </button>
            )}
            {order.status !== "Completed" && order.status !== "Cancelled" && (
              <button
                onClick={async (e) => {
                  e.stopPropagation();
                  // R7ax-FIX-CONFIRM: replaced window.confirm with themed ConfirmDialog
                  if (await confirm({
                    title: "Cancel this order?",
                    body: "The order will be marked Cancelled and will no longer appear in the active worklist.",
                    danger: true,
                    confirmLabel: "Cancel order",
                    cancelLabel: "Keep",
                  })) onCancel(order._id);
                }}
                style={{ padding: "5px 12px", border: `1px solid ${C.redB}`, borderRadius: 7, background: C.redL, color: C.red, fontSize: 11, fontWeight: 700, cursor: "pointer" }}
              >
                <i className="pi pi-times" style={{ marginRight: 5 }}/> Cancel Order
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   MAIN PANEL
══════════════════════════════════════════════════════════════ */
export default function DoctorOrdersPanel({ UHID, visitId, ipdNo, patientName, refreshSignal }) {
  const { user } = useAuth();
  const doctorName = user?.name || user?.username || "Dr.";
  const doctorId   = user?.id || user?._id || "000000000000000000000001";

  const [orders,     setOrders]     = useState([]);
  const [loading,    setLoading]    = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [showForm,   setShowForm]   = useState(false);
  const [selType,    setSelType]    = useState(null);   // chosen order type
  const [form,       setForm]       = useState({});
  const [filterType, setFilterType] = useState("All");
  const [filterStat, setFilterStat] = useState("Active");
  // OT procedure-completion modal — the order being completed lives here
  // so the modal can read its details / doctorOrderId.
  const [completeOrder, setCompleteOrder] = useState(null);
  // P1-5: edit-an-existing-order. When non-null, OrderForm is prefilled with
  // this order's data and the save handler POSTs to /doctor-action with
  // action=modify + amendReason (NABH MOM.3).
  const [editingOrder, setEditingOrder] = useState(null);

  // R7hr-179 — IA-panel batch entry state. Each array row fans out to one
  // DoctorOrder on save (R7hr-176 adapter pattern). Only used when placing
  // NEW orders of these 4 types; amend (editingOrder) keeps legacy OrderForm.
  const [batchMeds,  setBatchMeds]  = useState([]); // PrescriptionPanel rows
  const [batchInfs,  setBatchInfs]  = useState([]); // InfusionPanel rows
  // R7hr-180 — one combined list for Lab + Imaging; isImagingTest() splits
  // each name into its real orderType (Lab / Radiology) at save time.
  const [batchInvs,  setBatchInvs]  = useState([]); // investigation names (string[])
  const BATCH_TYPES = ["Medication", "IV_Fluid", "Investigations"];
  const isBatchMode = !editingOrder && BATCH_TYPES.includes(selType);

  /* fetch orders — R7az-D4-HIGH-6/D4-HIGH-7: abort on UHID change and on
     unmount so the 30s polling timer doesn't keep firing requests after
     the doctor navigates away from the panel. Also avoids late responses
     overwriting state for a different patient when the user clicks rapid
     fire through the sidebar. */
  const fetchAbortRef = useRef(null);
  const fetchOrders = useCallback(async () => {
    if (!UHID) return;
    if (fetchAbortRef.current) {
      try { fetchAbortRef.current.abort(); } catch (_) { /* noop */ }
    }
    const ctrl = new AbortController();
    fetchAbortRef.current = ctrl;
    setLoading(true);
    try {
      const params = new URLSearchParams({ UHID });
      if (visitId) params.set("visitId", visitId);
      const r = await axios.get(`${API_ENDPOINTS.DOCTOR_ORDERS}?${params}`, { signal: ctrl.signal });
      if (!ctrl.signal.aborted) setOrders(r.data?.data || []);
    } catch { /* silently ignore — abort or transient */ }
    finally { if (!ctrl.signal.aborted) setLoading(false); }
  }, [UHID, visitId]);

  useEffect(() => { fetchOrders(); }, [fetchOrders, refreshSignal]);
  // Polling timer + abort cleanup. Both share the abort ref so the
  // unmount fires through whichever cycle is in flight.
  useEffect(() => {
    const t = setInterval(fetchOrders, 30000);
    return () => {
      clearInterval(t);
      if (fetchAbortRef.current) {
        try { fetchAbortRef.current.abort(); } catch (_) { /* noop */ }
      }
    };
  }, [fetchOrders]);

  /* helpers */
  const setField = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const resetForm = () => {
    setSelType(null); setForm({}); setShowForm(false); setEditingOrder(null);
    // R7hr-179 — clear the batch panels so the next entry starts empty
    setBatchMeds([]); setBatchInfs([]); setBatchInvs([]);
  };

  // P1-5: Edit click handler — prefill OrderForm from existing order data so
  // the doctor can amend it (NABH MOM.3 modify-with-reason).
  const startEdit = (order) => {
    const od = order.orderDetails || {};
    // Flatten orderDetails + top-level fields back into the form shape the
    // OrderForm understands. `dose` may already be a combined "500mg" string;
    // we leave it as-is (Field renders it; saver will recombine on output).
    setForm({
      ...od,
      priority: order.priority || od.priority || "Routine",
      medicineName: order.medicineName || od.medicineName || "",
      testName: order.testName || od.testName || "",
      procedureName: order.procedureName || od.procedureName || "",
      reason: order.reason || od.reason || "",
      hamFlag: !!order.hamFlag,
      twoNurseRequired: !!order.twoNurseRequired,
      concentratedElectrolyte: !!order.concentratedElectrolyte,
      highRisk: !!order.highRisk,
      amendReason: "",
    });
    setSelType(order.orderType);
    setShowForm(true);
    setEditingOrder(order);
  };

  /* ── map form → DoctorOrderModel shape ── */
  const buildPayload = () => {
    const base = {
      UHID, visitId: visitId || ipdNo, visitType: "IPD",
      patientName: patientName || "",
      orderType: selType,
      priority: form.priority || "Routine",
      orderedBy: doctorName, orderedByRole: "Doctor", doctor: doctorId,
      status: "Pending",
    };

    // Build orderDetails
    const d = { ...form };
    delete d.priority;
    // Strip root-level HAM flags from orderDetails (they live at root, not nested)
    delete d.hamFlag; delete d.twoNurseRequired; delete d.concentratedElectrolyte; delete d.highRisk;
    // P1-5: amendReason is a sibling of `changes` on the modify request; do not
    // leak it into the saved orderDetails when amending.
    delete d.amendReason;
    // ServiceMaster UI helper — local toggle only, never sent to the server.
    // (serviceMasterId / serviceCode / serviceName / unitPrice DO stay on
    // orderDetails so downstream billing can charge the picked catalog item.)
    delete d.__manualEntry;
    // R7du — Strip Pre-Transfusion Checklist flat keys from orderDetails;
    // they collect into a root-level `preTransfusion` object below so the
    // NABH MOM.4 emitter (services/Compliance/nabhRegisterEmitter.js →
    // emitBloodTransfusion) which reads `order.preTransfusion.{consentSigned,
    // consentFormId, bp, pulse, temp, spo2}` finds them at the expected path.
    delete d.preTxConsentSigned; delete d.preTxConsentFormId;
    delete d.preTxBp; delete d.preTxPulse; delete d.preTxTemp; delete d.preTxSpo2;

    // Combine dose + unit into human-readable string (e.g. "500mg") for display
    if (d.dose !== undefined && d.dose !== "" && d.doseUnit) {
      d.dose = `${d.dose}${d.doseUnit}`;
    }
    // Combine durationValue + unit into duration string (e.g. "6 hrs" / "5 days") for display.
    // P1-12: For Medication default to 'days'; for IV_Fluid default to 'hrs'; otherwise 'hrs'.
    if (d.durationValue !== undefined && d.durationValue !== "") {
      const defaultUnit = selType === "Medication" ? "days" : "hrs";
      d.duration = `${d.durationValue} ${d.durationUnit || defaultUnit}`;
    }

    // P1-9: IV_Fluid totalVolume — write structured value to orderDetails
    if (selType === "IV_Fluid") {
      d.totalVolume = Number(form.totalVolume) || 0;
    }

    // P1-8: Medication mealStatus — write to orderDetails (default NotApplicable)
    if (selType === "Medication") {
      d.mealStatus = form.mealStatus || "NotApplicable";
    }

    // P1-7: Consultation reason at root (not under orderDetails)
    if (selType === "Consultation") {
      base.reason = form.reason || "";
      delete d.reason;
    }

    base.orderDetails = d;

    // HAM root-level flags (Medication only)
    // P2-11: hamFlag mirrors visually-displayed state — disabled-but-checked when auto-detected
    if (selType === "Medication") {
      const HAM_KW = ["insulin","heparin","enoxaparin","warfarin","digoxin","amiodarone","kcl","potassium","magnesium sulphate","mgso4","morphine","fentanyl","pethidine","tramadol iv","noradrenaline","norepinephrine","adrenaline","epinephrine","dopamine","dobutamine","vasopressin","suxamethonium","succinylcholine","vecuronium","rocuronium","streptokinase","alteplase","methotrexate","cyclophosphamide","cisplatin","vincristine","oxytocin","nitroprusside","ketamine","propofol","midazolam iv","vancomycin iv","gentamicin iv","amikacin iv","dextrose 25%","dextrose 50%","concentrated sodium","hypertonic saline","fondaparinux","acenocoumarol","lidocaine","lignocaine"];
      const autoHAM = HAM_KW.some(k => (form.medicineName || "").toLowerCase().includes(k));
      base.hamFlag              = !!form.hamFlag || autoHAM;
      base.twoNurseRequired     = !!form.twoNurseRequired || autoHAM;
      base.concentratedElectrolyte = !!form.concentratedElectrolyte;
      base.highRisk             = !!form.highRisk;
    }

    // Specific model fields for display/query
    if (selType === "Medication" || selType === "IV_Fluid" || selType === "BloodTransfusion") {
      base.medicineName = form.medicineName;
      base.dose = d.dose || form.dose;   // use combined string
      base.route = form.route;
      base.frequency = form.frequency;
      base.duration = d.duration || form.duration;
    }
    // R7du — Pre-Transfusion Checklist (NABH MOM.4). Backend route picks
    // up `body.preTransfusion` and threads it to emitBloodTransfusion so
    // the BT register row stores consent + pre-tx vitals. Goes at root
    // (not under orderDetails) because the emitter reads `order.preTransfusion`.
    if (selType === "BloodTransfusion") {
      base.preTransfusion = {
        consentSigned: !!form.preTxConsentSigned,
        consentFormId: form.preTxConsentFormId || null,
        bp:    form.preTxBp || "",
        pulse: form.preTxPulse !== undefined && form.preTxPulse !== "" ? Number(form.preTxPulse) : null,
        temp:  form.preTxTemp  !== undefined && form.preTxTemp  !== "" ? Number(form.preTxTemp)  : null,
        spo2:  form.preTxSpo2  !== undefined && form.preTxSpo2  !== "" ? Number(form.preTxSpo2)  : null,
      };
    }
    if (selType === "Lab" || selType === "Radiology") {
      base.testName = form.testName;
      // P2-8: canonical field is `priority`. Mirror to urgency for backward-compat
      // on any downstream code that still reads it.
      base.urgency  = form.priority;
    }
    if (selType === "Procedure") {
      base.procedureName = form.procedureName;
      base.procedureType = form.procedureType;
      base.consentRequired = form.consentRequired === "Yes";
      // B3-T06 — OT flag. If the doctor never touched the toggle (form.requiresOT
      // is undefined/blank), apply the same auto-default the UI shows: Major/Surgical
      // type OR GA/Sedation anaesthesia ⇒ Yes; everything else ⇒ No.
      // P1-11: requiresOT lives under orderDetails — Mongoose strips unknown root fields.
      const otValue = form.requiresOT
        || ((form.procedureType === "Major" || form.procedureType === "Surgical"
             || form.anaesthesia   === "GA"    || form.anaesthesia   === "Sedation") ? "Yes" : "No");
      base.orderDetails.requiresOT = otValue === "Yes";
    }
    base.notes = form.notes || "";
    base.displayName = form.medicineName || form.testName || form.procedureName
      || form.instruction || form.dietType || form.ptType
      || form.activityLevel || form.deliveryDevice || form.speciality || selType;

    return base;
  };

  // R7hr-179 — batch save: one DoctorOrder POST per panel row, sequential
  // like the R7hr-176 verbal-order loop (keeps backend dedupe + order-number
  // sequencing race-free). HAM auto-detect runs per medication row with the
  // same keyword list buildPayload uses, so 3% Hypertonic Saline typed into
  // an InfusionPanel row still lands with hamFlag + twoNurseRequired set.
  const BATCH_HAM_KW = ["insulin","heparin","enoxaparin","warfarin","digoxin","amiodarone","kcl","potassium","magnesium sulphate","mgso4","morphine","fentanyl","pethidine","tramadol iv","noradrenaline","norepinephrine","adrenaline","epinephrine","dopamine","dobutamine","vasopressin","suxamethonium","succinylcholine","vecuronium","rocuronium","streptokinase","alteplase","methotrexate","cyclophosphamide","cisplatin","vincristine","oxytocin","nitroprusside","ketamine","propofol","midazolam iv","vancomycin iv","gentamicin iv","amikacin iv","dextrose 25%","dextrose 50%","concentrated sodium","hypertonic saline","fondaparinux","acenocoumarol","lidocaine","lignocaine"];
  const saveBatchOrders = async () => {
    if (saving) return;
    const baseOf = () => ({
      UHID, visitId: visitId || ipdNo, visitType: "IPD",
      patientName: patientName || "",
      priority: form.priority || "Routine",
      orderedBy: doctorName, orderedByRole: "Doctor", doctor: doctorId,
      status: "Pending",
      notes: form.notes || "",
    });

    let bodies = [];
    // R7hr-266 — keep the source rows + their setter aligned with `bodies` so a
    // partial failure can retain ONLY the failed rows (see the loop below).
    let srcRows = [];
    let keepFailed = null;
    if (selType === "Medication") {
      const rows = batchMeds.filter(m => (m.name || "").trim());
      if (!rows.length) return toast.error("Add at least one medicine");
      // Backend DoctorOrderModel requires orderDetails.frequency on
      // Medication orders — catch it here so the doctor sees WHICH row
      // is incomplete instead of a silent per-row POST failure.
      const noFreq = rows.find(m => !(m.frequency || "").trim());
      if (noFreq) return toast.error(`"${noFreq.name}" needs a Frequency — set it on the row and re-add`);
      // R7hr-266 — DoctorOrderModel also REQUIRES orderDetails.dose on Medication
      // orders; catch a dose-less row here so the doctor sees WHICH row is
      // incomplete instead of it failing silently into the "N failed" count.
      const noDose = rows.find(m => !(m.dose || "").trim());
      if (noDose) return toast.error(`"${noDose.name}" needs a Dose — set it on the row and re-add`);
      srcRows = rows; keepFailed = setBatchMeds;
      bodies = rows.map(m => {
        const isHAM = BATCH_HAM_KW.some(k => m.name.toLowerCase().includes(k));
        return {
          ...baseOf(),
          orderType: "Medication",
          orderDetails: {
            medicineName: m.name.trim(), displayName: m.name.trim(),
            genericName: m.genericName || "", form: m.form || "",
            dose: m.dose || "", route: m.route || "Oral",
            frequency: m.frequency || "",
            mealStatus: m.mealStatus || "NotApplicable",
            duration: m.duration || "",
            dilutionVolume: m.dilutionVolume || "",
            dilutionFluid: m.dilutionFluid || "",
            infuseOverMinutes: m.infuseOverMinutes || "",
            notes: form.notes || "",
          },
          medicineName: m.name.trim(), dose: m.dose || "",
          route: m.route || "Oral", frequency: m.frequency || "",
          duration: m.duration || "", displayName: m.name.trim(),
          hamFlag: isHAM, twoNurseRequired: isHAM,
        };
      });
    } else if (selType === "IV_Fluid") {
      const rows = batchInfs.filter(i => (i.name || "").trim());
      if (!rows.length) return toast.error("Add at least one IV fluid / infusion");
      srcRows = rows; keepFailed = setBatchInfs;
      bodies = rows.map(i => {
        const isHAM = BATCH_HAM_KW.some(k => i.name.toLowerCase().includes(k));
        return {
          ...baseOf(),
          orderType: "IV_Fluid",
          orderDetails: {
            fluidName: i.name.trim(), displayName: i.name.trim(),
            totalVolume: Number(i.totalVolume) || 0, rate: i.rate || "",
            route: i.route || "IV Infusion", duration: i.duration || "",
            additives: i.additives || "", strength: i.strength || "",
            notes: i.instructions || form.notes || "",
          },
          medicineName: i.name.trim(), route: i.route || "IV Infusion",
          duration: i.duration || "", displayName: i.name.trim(),
          hamFlag: isHAM, twoNurseRequired: isHAM,
        };
      });
    } else if (selType === "Investigations") {
      // R7hr-180 — one picker, two real order types. Each name classifies
      // to Lab or Radiology; lab-only batch fields (sample/fasting) land
      // only on Lab bodies, imaging-only fields (region/contrast) only on
      // Radiology bodies.
      if (!batchInvs.length) return toast.error("Pick at least one investigation");
      srcRows = batchInvs; keepFailed = setBatchInvs;
      bodies = batchInvs.map(t => {
        const imaging = isImagingTest(t);
        return {
          ...baseOf(),
          orderType: imaging ? "Radiology" : "Lab",
          orderDetails: {
            testName: t, displayName: t,
            sampleType: !imaging ? (form.sampleType || "") : undefined,
            fasting:    !imaging ? (form.fasting || "") : undefined,
            region:     imaging ? (form.region || "") : undefined,
            contrast:   imaging ? (form.contrast || "") : undefined,
            notes: form.notes || "",
          },
          testName: t, urgency: form.priority || "Routine", displayName: t,
        };
      });
    } else return;

    setSaving(true);
    let ok = 0, fail = 0;
    const failedRows = [];
    let firstErr = "";
    try {
      for (let idx = 0; idx < bodies.length; idx++) {
        try {
          await axios.post(API_ENDPOINTS.DOCTOR_ORDERS, bodies[idx]);
          ok++;
        } catch (e) {
          if (e.response?.status === 409 && e.response?.data?.code === "DUPLICATE_ORDER") { ok++; }
          else {
            fail++;
            failedRows.push(srcRows[idx]);
            if (!firstErr) firstErr = e?.response?.data?.message || e?.message || "";
            console.error("[batch-order] row failed:", e?.response?.data?.message || e?.message);
          }
        }
      }
      if (ok > 0 && fail === 0) {
        toast.success(`${ok} ${TYPE_MAP[selType]?.label} order${ok > 1 ? "s" : ""} placed`);
        resetForm(); fetchOrders();
      } else if (ok > 0) {
        // R7hr-266 — keep ONLY the failed rows in the batch so a retry doesn't
        // re-POST the rows that already saved. Lab/Radiology have no 30s server
        // dedupe, so a blind "save again" would create DUPLICATE orders. Also
        // surface the first server error instead of a generic "retry" message.
        if (keepFailed) keepFailed(failedRows.filter(Boolean));
        toast.warning(`${ok} placed, ${fail} failed${firstErr ? ` — ${firstErr}` : ""}. Failed row${fail > 1 ? "s" : ""} kept for retry.`);
        fetchOrders();
      } else {
        toast.error(`Order placement failed — none saved${firstErr ? `: ${firstErr}` : ""}`);
      }
    } finally { setSaving(false); }
  };

  const saveOrder = async () => {
    // R7bq-J2 — re-entrancy guard. The `disabled={saving}` on the button
    // prevents most double-clicks, but React's async state update lets a
    // second invocation slip through before the disabled flag applies.
    // Bail out synchronously if a save is already in flight.
    if (saving) return;
    if (!selType) return toast.error("Select an order type");
    const required = {
      Medication: "medicineName", IV_Fluid: "medicineName", Lab: "testName",
      Radiology: "testName", Procedure: "procedureName",
      BloodTransfusion: "medicineName", Diet: "dietType", Oxygen: "deliveryDevice",
      Physiotherapy: "ptType", Activity: "activityLevel", Nursing: "instruction",
      // P1-7: Consultation requires `reason` (clinical summary), not just speciality —
      // the backend rejects without it.
      Consultation: "reason",
    };
    const reqField = required[selType];
    if (reqField && !form[reqField]) return toast.error("Fill in the required fields (*)");
    // P1-5: amend reason is mandatory when modifying (NABH MOM.3)
    if (editingOrder && !(form.amendReason || "").trim()) {
      return toast.error("Amend reason is required");
    }

    setSaving(true);
    try {
      // Token is attached automatically by the global axios interceptor
      // (reads `his_token`). Manual headers using the wrong key
      // (`localStorage.getItem("token")` → null) used to send `Bearer null`
      // and trigger a 401 + session wipe — removed.
      if (editingOrder) {
        // P1-5: NABH MOM.3 modify path — POST to /doctor-action so the
        // backend records the amendment in the audit log with the reason.
        const payload = buildPayload();
        // Strip the read-only routing fields from the changes delta — the
        // backend uses the order id from the URL, not the payload.
        const { UHID: _u, visitId: _v, visitType: _t, orderType: _o,
                orderedBy: _b, orderedByRole: _r, doctor: _d, status: _s,
                ...changes } = payload;
        await axios.post(
          `${API_ENDPOINTS.DOCTOR_ORDERS}/${editingOrder._id}/doctor-action`,
          { action: "modify", amendReason: form.amendReason.trim(), changes }
        );
        toast.success(`${TYPE_MAP[selType]?.label} order amended`);
      } else {
        await axios.post(API_ENDPOINTS.DOCTOR_ORDERS, buildPayload());
        toast.success(`${TYPE_MAP[selType]?.label} order placed`);
      }
      resetForm();
      fetchOrders();
    } catch (e) {
      // R7bq-J2 — server-side 30s dedupe surfaces a 409 with code=DUPLICATE_ORDER
      // when an identical Medication / IV_Fluid was just placed. Treat it as
      // an info toast (not an error) and refresh the list so the user sees
      // the existing row instead of error-spamming the screen.
      const data = e.response?.data;
      if (e.response?.status === 409 && data?.code === "DUPLICATE_ORDER") {
        const msg = data.message
          || "This order was already placed a few seconds ago. Refreshing list…";
        toast.info ? toast.info(msg) : toast.success(msg);
        resetForm();
        fetchOrders();
      } else {
        toast.error(data?.message || "Failed to place order");
      }
    } finally { setSaving(false); }
  };

  const cancelOrder = async (id) => {
    try {
      await axios.delete(`${API_ENDPOINTS.DOCTOR_ORDERS}/${id}`);
      toast.success("Order cancelled");
      fetchOrders();
    } catch { toast.error("Cancel failed"); }
  };

  /* ── filter ── */
  const ACTIVE_STATUSES  = ["Pending","Acknowledged","InProgress","OnHold"];
  // P2-12: Status filter now matches individual statuses OR the "Active"
  // meta-bucket (union of ACTIVE_STATUSES). "all" / "All" = no status filter.
  const filtered = orders.filter(o => {
    const typeOk = filterType === "All" || o.orderType === filterType;
    const statOk = filterStat === "All" || filterStat === "all"
      || (filterStat === "Active" && ACTIVE_STATUSES.includes(o.status))
      || (o.status === filterStat);
    return typeOk && statOk;
  });

  const activeCount    = orders.filter(o => ACTIVE_STATUSES.includes(o.status)).length;
  const completedCount = orders.filter(o => o.status === "Completed").length;

  /* ── Priority counts for header badges ── */
  const statOrders = orders.filter(o => o.priority === "STAT" && ACTIVE_STATUSES.includes(o.status));

  /* ── R7hr-141 — Verbal order cosign queue.
       Every nurse-entered verbal/telephonic order (R7hr-139) sits with
       coSignedBy=null until the prescribing doctor co-signs. NABH MOM.7c
       §3 requires the cosign within 24h; the daily cron flags overdue
       ones with VERBAL_ORDER_OVERDUE_COSIGN. The doctor sees this list
       at the very top of their orders panel as a red banner so it can't
       be missed during morning round. ─────────────────────────────── */
  const pendingVerbalOrders = orders.filter(o => o.isVerbal && !o.coSignedBy);
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  const overdueVerbalOrders = pendingVerbalOrders.filter(o =>
    o.verbalEnteredAt && (Date.now() - new Date(o.verbalEnteredAt).getTime()) > ONE_DAY_MS
  );

  const cosignVerbalOrder = async (orderId) => {
    if (!window.confirm("Co-sign this verbal order? This permanently attaches your identity to the order per NABH MOM.7c.")) return;
    try {
      await axios.post(`${API_ENDPOINTS.DOCTOR_ORDERS}/${orderId}/cosign-verbal`);
      toast.success("Verbal order co-signed");
      fetchOrders();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Co-sign failed");
    }
  };

  return (
    <div style={{ background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 12, overflow: "hidden", marginBottom: 16 }}>

      {/* ── Panel header ── */}
      <div style={{ background: `linear-gradient(135deg, ${C.primary} 0%, ${C.primaryMid} 100%)`, padding: "12px 16px", display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 34, height: 34, borderRadius: 8, background: "rgba(255,255,255,.15)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <i className="pi pi-list" style={{ color: "white", fontSize: 16 }}/>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ color: "white", fontWeight: 800, fontSize: 15 }}>Doctor Orders</div>
          <div style={{ color: "rgba(255,255,255,.7)", fontSize: 11 }}>NABH COP.2 · Full Audit Trail</div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {statOrders.length > 0 && (
            <span style={{ background: C.red, color: "white", fontSize: 10, fontWeight: 900, padding: "3px 8px", borderRadius: 12, letterSpacing: ".5px" }}>
              {statOrders.length} STAT
            </span>
          )}
          <span style={{ background: "rgba(255,255,255,.2)", color: "white", fontSize: 11, padding: "3px 10px", borderRadius: 10 }}>
            {activeCount} active
          </span>
          <span style={{ background: "rgba(255,255,255,.1)", color: "rgba(255,255,255,.7)", fontSize: 11, padding: "3px 10px", borderRadius: 10 }}>
            {completedCount} done
          </span>
          <button
            onClick={fetchOrders}
            style={{ background: "rgba(255,255,255,.15)", border: "none", borderRadius: 7, padding: "5px 8px", cursor: "pointer", color: "white" }}
          ><i className="pi pi-refresh" style={{ fontSize: 11 }}/></button>
          {!showForm && (
            <button
              onClick={() => setShowForm(true)}
              style={{ background: "white", border: "none", borderRadius: 8, padding: "6px 14px", cursor: "pointer", color: C.primary, fontWeight: 800, fontSize: 12, display: "flex", alignItems: "center", gap: 5 }}
            >
              <i className="pi pi-plus" style={{ fontSize: 11 }}/> New Order
            </button>
          )}
        </div>
      </div>

      {/* R7hr-141 — Pending Verbal Orders banner (NABH MOM.7c §3 cosign).
          Sits between the panel header and the order form so the
          consultant cannot miss it during morning round. Red-tinted
          when there's an overdue (>24h) verbal in the queue; amber
          otherwise. Each row has a single-click Co-sign action. */}
      {pendingVerbalOrders.length > 0 && (
        <div style={{
          background: overdueVerbalOrders.length > 0 ? "#fef2f2" : "#fffbeb",
          border: `1.5px solid ${overdueVerbalOrders.length > 0 ? "#fecaca" : "#fde68a"}`,
          borderRadius: 0,
          borderTopWidth: 0,
          borderLeftWidth: 0,
          borderRightWidth: 0,
          padding: "10px 16px",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <span style={{
              background: overdueVerbalOrders.length > 0 ? "#dc2626" : "#d97706",
              color: "white",
              padding: "3px 10px",
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: ".3px",
            }}>
              📞 {pendingVerbalOrders.length} Verbal Order{pendingVerbalOrders.length > 1 ? "s" : ""} — pending your co-sign
            </span>
            {overdueVerbalOrders.length > 0 && (
              <span style={{
                background: "#7f1d1d",
                color: "white",
                padding: "2px 8px",
                borderRadius: 4,
                fontSize: 10,
                fontWeight: 800,
              }}>
                ⚠ {overdueVerbalOrders.length} OVERDUE (>24h — NABH MOM.7c §3)
              </span>
            )}
            <span style={{ fontSize: 10, color: "#78716c", fontWeight: 600, marginLeft: "auto" }}>
              IPSG.2 read-back was confirmed by the nurse at intake.
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {pendingVerbalOrders.map(o => {
              const enteredAt = o.verbalEnteredAt ? new Date(o.verbalEnteredAt) : null;
              const hoursAgo = enteredAt ? Math.floor((Date.now() - enteredAt.getTime()) / 3600000) : null;
              const isOverdue = hoursAgo !== null && hoursAgo > 24;
              const drugName = o.orderDetails?.medicineName || o.orderDetails?.fluidName || o.orderDetails?.displayName || o.orderType;
              const detail = o.orderType === "IV_Fluid"
                ? `${o.orderDetails?.totalVolume || ""} @ ${o.orderDetails?.rate || ""}`.trim()
                : `${o.orderDetails?.dose || ""} · ${o.orderDetails?.route || ""} · ${o.orderDetails?.frequency || ""}`.replace(/^ · | · $|· · /g, "");
              return (
                <div key={o._id} style={{
                  background: "white",
                  border: `1px solid ${isOverdue ? "#fecaca" : "#fde68a"}`,
                  borderRadius: 8,
                  padding: "8px 10px",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  flexWrap: "wrap",
                }}>
                  <div style={{ flex: "1 1 250px", minWidth: 0 }}>
                    <div style={{ fontWeight: 800, color: "#0f172a", fontSize: 13 }}>
                      {o.orderType === "IV_Fluid" ? "💧" : "💊"} {drugName}
                    </div>
                    <div style={{ fontSize: 11, color: "#475569" }}>{detail}</div>
                  </div>
                  <div style={{ flex: "1 1 200px", fontSize: 11, color: "#475569" }}>
                    <div><b>From:</b> {o.verbalFromDoctor || "—"}</div>
                    <div><b>Via nurse:</b> {o.verbalEnteredByName || "—"}</div>
                    {o.verbalReason && <div style={{ color: "#64748b", fontStyle: "italic" }}>{o.verbalReason}</div>}
                  </div>
                  <div style={{ fontSize: 11, color: isOverdue ? "#dc2626" : "#0891b2", fontWeight: 700, minWidth: 90, textAlign: "right" }}>
                    {hoursAgo !== null ? `${hoursAgo}h ago` : "—"}
                    {isOverdue && <div style={{ fontSize: 9, color: "#7f1d1d" }}>OVERDUE</div>}
                  </div>
                  <button
                    onClick={() => cosignVerbalOrder(o._id)}
                    style={{
                      padding: "6px 14px",
                      background: "linear-gradient(135deg, #16a34a, #15803d)",
                      color: "white",
                      border: "none",
                      borderRadius: 7,
                      fontSize: 12,
                      fontWeight: 800,
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    ✓ Co-sign
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ═══════════════ ORDER FORM ═══════════════ */}
      {showForm && (
        <div style={{ padding: 16, borderBottom: `1.5px solid ${C.border}`, background: C.grayL }}>

          {/* Type selector grid */}
          {!selType ? (
            <>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".6px", marginBottom: 10 }}>Select Order Type</div>
              {/* R7hr-180 — TILE_TYPES merges Lab + Imaging into one
                  "Investigations" tile; the filter dropdown below keeps
                  the separate Lab / Radiology options for existing orders. */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 8 }}>
                {TILE_TYPES.map(t => (
                  <button
                    key={t.id}
                    onClick={() => setSelType(t.id)}
                    style={{ padding: "10px 8px", border: `1.5px solid ${t.border}`, borderRadius: 10, background: t.bg, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 5, transition: "transform .15s" }}
                    onMouseEnter={e => e.currentTarget.style.transform="scale(1.04)"}
                    onMouseLeave={e => e.currentTarget.style.transform="scale(1)"}
                  >
                    <i className={`pi ${t.icon}`} style={{ fontSize: 16, color: t.color }}/>
                    <span style={{ fontSize: 11, fontWeight: 700, color: t.color, textAlign: "center", lineHeight: 1.3 }}>{t.label}</span>
                  </button>
                ))}
              </div>
              <button onClick={resetForm} style={{ marginTop: 10, padding: "6px 14px", border: `1px solid ${C.border}`, borderRadius: 7, background: "white", color: C.muted, fontSize: 12, cursor: "pointer" }}>
                Cancel
              </button>
            </>
          ) : (
            <>
              {/* Back + type title */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                <button onClick={() => { setSelType(null); setForm({}); setEditingOrder(null); }} style={{ border: `1px solid ${C.border}`, background: "white", borderRadius: 7, padding: "4px 10px", fontSize: 11, cursor: "pointer", color: C.muted }}>
                  <i className="pi pi-arrow-left" style={{ marginRight: 5 }}/>Back
                </button>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ width: 30, height: 30, borderRadius: 8, background: TYPE_MAP[selType]?.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <i className={`pi ${TYPE_MAP[selType]?.icon}`} style={{ fontSize: 13, color: TYPE_MAP[selType]?.color }}/>
                  </div>
                  <div>
                    <div style={{ fontWeight: 800, color: TYPE_MAP[selType]?.color, fontSize: 14 }}>
                      {editingOrder ? `Edit ${TYPE_MAP[selType]?.label}` : TYPE_MAP[selType]?.label}
                    </div>
                    <div style={{ fontSize: 11, color: C.muted }}>Dr. {doctorName} · {new Date().toLocaleString("en-IN", { day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit" })}</div>
                  </div>
                </div>
              </div>

              {/* P1-5: Amend reason — required when modifying an existing order (NABH MOM.3) */}
              {editingOrder && (
                <div style={{ background: C.amberL, border: `1.5px solid ${C.amberB}`, borderRadius: 10, padding: 12, marginBottom: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <i className="pi pi-exclamation-triangle" style={{ fontSize: 13, color: C.amber }}/>
                    <span style={{ fontWeight: 800, fontSize: 12, color: C.amber, letterSpacing: ".3px" }}>
                      Amending Existing Order — NABH MOM.3
                    </span>
                  </div>
                  <label className="his-label">Reason for amendment *</label>
                  <textarea
                    className="his-textarea" rows={2}
                    placeholder="e.g. Dose adjusted per renal function, frequency changed after consultation…"
                    value={form.amendReason || ""}
                    onChange={(e) => setField("amendReason", e.target.value)}
                  />
                </div>
              )}

              {/* Dynamic form.
                  R7hr-179 — NEW orders for Medication / IV Fluid / Lab /
                  Imaging use the same multi-row panels as the Doctor IPD
                  Initial Assessment (PrescriptionPanel with R7hr-128
                  dilution, InfusionPanel with R7hr-68 presets, R7hr-69
                  multi-pick chips). Amend path (editingOrder) + every other
                  order type keep the legacy single-order <OrderForm>. */}
              <div style={{ background: "white", borderRadius: 10, border: `1px solid ${C.border}`, padding: 14 }}>
                {!isBatchMode && <OrderForm typeId={selType} form={form} set={setField}/>}
                {isBatchMode && selType === "Medication" && (
                  <>
                    <PrescriptionPanel value={batchMeds} onChange={setBatchMeds} />
                    <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: 10, marginTop: 12 }}>
                      <Field form={form} set={setField} label="Priority (all rows)" name="priority" options={["Routine","Urgent","STAT"]}/>
                      <Field form={form} set={setField} label="Special Instructions (all rows)" name="notes" placeholder="Monitoring, interactions, pre/post food…"/>
                    </div>
                  </>
                )}
                {isBatchMode && selType === "IV_Fluid" && (
                  <>
                    <InfusionPanel value={batchInfs} onChange={setBatchInfs} />
                    <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: 10, marginTop: 12 }}>
                      <Field form={form} set={setField} label="Priority (all rows)" name="priority" options={["Routine","Urgent","STAT"]}/>
                      <Field form={form} set={setField} label="Instructions (all rows)" name="notes" placeholder="Drip rate, monitoring, pump settings…"/>
                    </div>
                  </>
                )}
                {isBatchMode && selType === "Investigations" && (() => {
                  // R7hr-180 — single entry point for Lab + Imaging. Live
                  // split counter shows how the batch will fan out.
                  const labCount = batchInvs.filter(t => !isImagingTest(t)).length;
                  const imgCount = batchInvs.length - labCount;
                  return (
                    <>
                      <div style={{ fontSize: 11, color: C.muted, fontWeight: 500, marginBottom: 10 }}>
                        Type to search labs + imaging together — pick multiple, each becomes its own order
                        {batchInvs.length > 0 && (
                          <span style={{ marginLeft: 8, fontWeight: 800 }}>
                            <span style={{ color: C.teal }}>{labCount} Lab</span>
                            <span style={{ color: C.muted }}> · </span>
                            <span style={{ color: C.indigo }}>{imgCount} Imaging</span>
                          </span>
                        )}
                      </div>
                      <MultiTestPicker
                        catalog={[...ORDER_LAB_CATALOG, ...ORDER_IMAGING_CATALOG]}
                        value={batchInvs} onChange={setBatchInvs}
                        color={C.teal}
                        kindOf={(t) => (isImagingTest(t) ? "IMAGING" : "LAB")}
                        placeholder="CBC, LFT, Blood Culture, CECT Chest, USG Abdomen, MRI Brain…"/>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginTop: 12 }}>
                        <Field form={form} set={setField} label="Priority (all)" name="priority" options={["Routine","Urgent","STAT"]}/>
                        <Field form={form} set={setField} label="Sample Type (lab tests)" name="sampleType" options={["Venous Blood","Arterial Blood","Urine (Spot)","Urine (24hr)","Stool","Sputum","Swab","CSF","Pleural Fluid","Ascitic Fluid","Tissue Biopsy"]}/>
                        <Field form={form} set={setField} label="Fasting (lab tests)" name="fasting" options={["No","Yes — 8 hrs","Yes — 12 hrs"]}/>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                        <Field form={form} set={setField} label="Region / Body Part (imaging)" name="region" placeholder="e.g. Chest, Abdomen-Pelvis"/>
                        <Field form={form} set={setField} label="Contrast (imaging)" name="contrast" options={["Plain (No Contrast)","With IV Contrast","With Oral Contrast","Both"]}/>
                      </div>
                      <Field form={form} set={setField} label="Clinical Details / Indication" name="notes" placeholder="Pre-antibiotic, timing, allergy to contrast, prior imaging…" type="textarea"/>
                    </>
                  );
                })()}
              </div>

              {/* Actions */}
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button onClick={resetForm} style={{ padding: "8px 18px", border: `1px solid ${C.border}`, borderRadius: 8, background: "white", color: C.muted, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                  Cancel
                </button>
                <button
                  onClick={isBatchMode ? saveBatchOrders : saveOrder}
                  disabled={saving}
                  style={{ padding: "8px 22px", border: "none", borderRadius: 8, background: `linear-gradient(135deg, ${C.primary}, ${C.primaryMid})`, color: "white", fontSize: 12, fontWeight: 800, cursor: saving ? "not-allowed" : "pointer", opacity: saving ? .7 : 1, display: "flex", alignItems: "center", gap: 6 }}
                >
                  {saving
                    ? <><i className="pi pi-spin pi-spinner" style={{ fontSize: 12 }}/> {editingOrder ? "Amending…" : "Placing…"}</>
                    : <><i className="pi pi-check" style={{ fontSize: 11 }}/> {editingOrder ? "Amend Order"
                        : isBatchMode
                          ? `Place ${(selType === "Medication" ? batchMeds : selType === "IV_Fluid" ? batchInfs : batchInvs).length || ""} Order${((selType === "Medication" ? batchMeds : selType === "IV_Fluid" ? batchInfs : batchInvs).length) > 1 ? "s" : ""}`.replace("  ", " ")
                          : "Place Order"}</>}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ═══════════════ FILTERS ═══════════════ */}
      <div style={{ padding: "8px 16px", borderBottom: `1px solid ${C.border}`, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", background: C.grayL }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".5px" }}>Filter:</div>
        {/* P2-12: expanded status filter — individual statuses + "Active (any)"
            meta-bucket. Default selection is Active for the common case. */}
        <select className="his-select" style={{ width: "auto", fontSize: 11, padding: "3px 8px", minWidth: 140 }} value={filterStat} onChange={e => setFilterStat(e.target.value)}>
          <option value="all">All</option>
          <option value="Pending">Pending</option>
          <option value="Acknowledged">Acknowledged</option>
          <option value="InProgress">In Progress</option>
          <option value="OnHold">On Hold</option>
          <option value="Active">Active (any)</option>
          <option value="Completed">Completed</option>
          <option value="Cancelled">Cancelled</option>
          <option value="Stopped">Stopped</option>
        </select>
        <div style={{ width: 1, height: 16, background: C.border, margin: "0 4px" }}/>
        <select className="his-select" style={{ width: "auto", fontSize: 11, padding: "3px 8px", minWidth: 120 }} value={filterType} onChange={e => setFilterType(e.target.value)}>
          <option value="All">All Types</option>
          {ORDER_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
      </div>

      {/* ═══════════════ ORDERS LIST ═══════════════ */}
      <div style={{ padding: "12px 14px", maxHeight: 520, overflowY: "auto" }}>
        {loading && (
          <div style={{ textAlign: "center", padding: 24, color: C.muted }}>
            <i className="pi pi-spin pi-spinner" style={{ fontSize: 20 }}/> <div style={{ fontSize: 12, marginTop: 6 }}>Loading orders…</div>
          </div>
        )}
        {!loading && filtered.length === 0 && (
          <div style={{ textAlign: "center", padding: 28, color: C.muted }}>
            <i className="pi pi-list" style={{ fontSize: 28, opacity: .3 }}/>
            <div style={{ fontSize: 13, marginTop: 8, fontWeight: 600 }}>No orders found</div>
            <div style={{ fontSize: 11, marginTop: 4 }}>
              {UHID ? 'Use the "+ New Order" button above to place the first order.' : "Load a patient to view orders."}
            </div>
          </div>
        )}
        {!loading && filtered.map(order => (
          <OrderCard
            key={order._id}
            order={order}
            onCancel={cancelOrder}
            onComplete={setCompleteOrder}
            onEdit={startEdit}
          />
        ))}
      </div>

      {/* OT Procedure completion modal (NABH COP.10 evidence) */}
      {completeOrder && (
        <CompleteProcedureModal
          order={completeOrder}
          onClose={() => setCompleteOrder(null)}
          onSaved={() => { setCompleteOrder(null); fetchOrders(); }}
        />
      )}

      {/* ── Footer legend ── */}
      <div style={{ borderTop: `1px solid ${C.border}`, padding: "7px 16px", background: C.grayL, display: "flex", gap: 14, flexWrap: "wrap" }}>
        {[["Pending","#d97706"],["In Progress","#0d9488"],["Completed","#16a34a"],["Cancelled","#dc2626"]].map(([l,c]) => (
          <span key={l} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: C.muted }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: c, display: "inline-block" }}/>
            {l}
          </span>
        ))}
        <span style={{ marginLeft: "auto", fontSize: 10, color: C.muted }}>Auto-refreshes every 30s</span>
      </div>
    </div>
  );
}
