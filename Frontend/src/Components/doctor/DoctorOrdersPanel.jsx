/**
 * DoctorOrdersPanel.jsx
 * Comprehensive doctor order entry + full audit trail viewer
 * NABH COP.2 / MOM.3 / SRC.1 compliant
 * Supports 12 order types — each with dedicated form fields
 * Audit trail: who ordered (doctor) + each nurse step + completion timestamp
 */
import React, { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API_ENDPOINTS } from "../../config/api";
import { useAuth } from "../../context/AuthContext";
import { toast } from "react-toastify";

/* ── Design tokens ── */
const C = {
  bg: "#f8fafc", card: "#ffffff", border: "#e2e8f0", text: "#0f172a", muted: "#64748b",
  primary: "#1e40af", primaryL: "#eff6ff", primaryMid: "#2563eb",
  green: "#16a34a", greenL: "#dcfce7", greenB: "#bbf7d0",
  amber: "#d97706", amberL: "#fffbeb", amberB: "#fde68a",
  red: "#dc2626", redL: "#fef2f2", redB: "#fecaca",
  blue: "#1d4ed8", blueL: "#dbeafe", blueB: "#93c5fd",
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
   DrugAutocomplete — replaces the plain "Drug Name" text field on
   Medication orders. As the doctor types, fetches matching drugs
   from the pharmacy master (/api/pharmacy/drugs/search?q=…) and
   shows a dropdown of name + generic + strength + form so the
   doctor can pick the exact SKU and avoid typos.

   Picking a row:
     • writes the drug's primary name into `medicineName`
     • mirrors strength → `dose` + `doseUnit` (best-effort parse,
       e.g. "500 mg" → dose 500, unit "mg")
     • mirrors genericName → `genericName` (audited; doctor can
       still override)
     • keeps focus + lets typing continue (no implicit save)         */
function DrugAutocomplete({ form, set, label, name, placeholder }) {
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const debRef = React.useRef(null);
  const val = form[name] ?? "";

  useEffect(() => {
    if (debRef.current) clearTimeout(debRef.current);
    const q = (val || "").trim();
    if (q.length < 2) { setResults([]); return; }
    const ac = new AbortController();
    debRef.current = setTimeout(async () => {
      setBusy(true);
      try {
        const { data } = await axios.get(
          `${API_ENDPOINTS.BASE}/pharmacy/drugs/search`,
          { params: { q }, signal: ac.signal },
        );
        if (!ac.signal.aborted) setResults(data?.data || []);
      } catch (e) {
        if (!axios.isCancel(e)) console.warn("[DrugAutocomplete]", e?.message);
      } finally {
        if (!ac.signal.aborted) setBusy(false);
      }
    }, 200);
    return () => { ac.abort(); if (debRef.current) clearTimeout(debRef.current); };
  }, [val]);

  const pick = (drug) => {
    set(name, drug.name);
    if (drug.genericName) set("genericName", drug.genericName);
    // Try to split strength like "500 mg" or "5 mg/5 mL" into a numeric
    // dose + unit. Doctor can still override either field afterwards.
    const m = String(drug.strength || "").match(/^\s*([\d.]+)\s*([a-zA-Z/%μ]+)?/);
    if (m) {
      set("dose", Number(m[1]));
      if (m[2]) set("doseUnit", m[2]);
    }
    if (drug.form) set("dosageForm", drug.form);  // optional, future-friendly
    setOpen(false);
    setResults([]);
  };

  return (
    <div style={{ position: "relative" }}>
      <label className="his-label">{label}</label>
      <input
        className="his-field"
        type="text"
        placeholder={placeholder}
        value={val}
        onFocus={() => setOpen(true)}
        onChange={e => { set(name, e.target.value); setOpen(true); }}
        onBlur={() => setTimeout(() => setOpen(false), 180)}
        autoComplete="off"
      />
      {open && (results.length > 0 || busy) && (
        <div style={{
          position: "absolute", top: "100%", left: 0, right: 0, zIndex: 20,
          marginTop: 4, maxHeight: 280, overflowY: "auto",
          background: "#fff", border: "1px solid #cbd5e1", borderRadius: 8,
          boxShadow: "0 10px 24px rgba(15,23,42,.12)",
        }}>
          {busy && results.length === 0 && (
            <div style={{ padding: 10, fontSize: 12, color: "#64748b" }}>
              <i className="pi pi-spin pi-spinner" /> Searching pharmacy master…
            </div>
          )}
          {results.map(d => (
            <button
              key={d._id}
              type="button"
              onMouseDown={() => pick(d)}
              style={{
                display: "block", width: "100%", textAlign: "left",
                padding: "8px 10px", border: 0,
                borderBottom: "1px solid #f1f5f9", background: "#fff",
                cursor: "pointer", fontFamily: "inherit",
              }}
              onMouseEnter={e => e.currentTarget.style.background = "#eff6ff"}
              onMouseLeave={e => e.currentTarget.style.background = "#fff"}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span style={{ fontWeight: 700, color: "#0f172a", fontSize: 13 }}>
                  {d.name}
                  {d.strength ? ` · ${d.strength}` : ""}
                </span>
                {d.form && (
                  <span style={{ fontSize: 10, color: "#0e7490", background: "#ecfeff", padding: "1px 8px", borderRadius: 999, fontWeight: 700 }}>
                    {d.form}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                {d.genericName && <span>Generic: <strong>{d.genericName}</strong></span>}
                {d.genericName && d.manufacturer && " · "}
                {d.manufacturer && <span>{d.manufacturer}</span>}
                {d.isHighAlert && <span style={{ marginLeft: 6, color: "#b91c1c", fontWeight: 700 }}>⚠ HIGH-ALERT</span>}
                {d.isLASA && <span style={{ marginLeft: 6, color: "#c2410c", fontWeight: 700 }}>LASA</span>}
                {d.schedule && d.schedule !== "OTC" && <span style={{ marginLeft: 6, fontWeight: 700, color: "#7c3aed" }}>Sch-{d.schedule}</span>}
              </div>
            </button>
          ))}
          {!busy && results.length === 0 && val.trim().length >= 2 && (
            <div style={{ padding: 10, fontSize: 12, color: "#94a3b8" }}>
              No drug found — you can still type the name manually.
            </div>
          )}
        </div>
      )}
    </div>
  );
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
      {/* IV Dilution — shown for IV / IM routes; auto-logs to patient Input chart on each dose given */}
      {(form.route === "IV" || form.route === "IM") && (
        <div style={{ padding: "10px 12px", background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 8, marginBottom: 6 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#0369a1", textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 8 }}>
            💧 IV Dilution — optional · auto-logged to Input chart when nurse administers
          </div>
          <div style={g("140px 1fr")}>
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
          </div>
          {form.dilutionVolume > 0 && (
            <div style={{ marginTop: 6, fontSize: 11, color: "#0369a1" }}>
              📋 <strong>{form.medicineName || "Drug"}</strong> ko <strong>{form.dilutionVolume} ml {form.dilutionFluid || "NS 0.9%"}</strong> mein dilute karke dena — har dose administration par Input chart mein auto-entry hogi.
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
        <Field form={form} set={set} label="Fluid / Solution *" name="medicineName" placeholder="e.g. NS 0.9%, RL, DNS, Dextrose 5%"/>
        <Field form={form} set={set} label="Volume *" name="dose" type="number" placeholder="500" unit="ml"/>
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
      {(form.dose > 0 && form.rate > 0) && (() => {
        const hrs = form.durationValue > 0
          ? (form.durationUnit === "mins" ? form.durationValue / 60 : form.durationUnit === "days" ? form.durationValue * 24 : form.durationValue)
          : form.dose / form.rate;
        return (
          <div style={{ padding: "10px 14px", background: "#f0fdf4", border: "1.5px solid #86efac", borderRadius: 8, marginBottom: 6, fontSize: 11, color: "#15803d" }}>
            📊 <strong>{form.dose} ml</strong> at <strong>{form.rate} ml/hr</strong> → runs for <strong>~{Math.round(hrs * 10) / 10} hrs</strong>
            {Math.ceil(hrs) > 1 && <> · <strong>{Math.ceil(hrs)} hourly entries</strong> will be auto-created in the Input/Output chart when nurse starts the infusion</>}
          </div>
        );
      })()}
      <Field form={form} set={set} label="Instructions" name="notes" placeholder="Drip rate, monitoring, pump settings…" type="textarea"/>
    </>
  );

  if (typeId === "Lab") return (
    <>
      <div style={g("2fr 1fr 1fr")}>
        <Field form={form} set={set} label="Test Name(s) *" name="testName" placeholder="CBC, LFT, RFT, Blood Culture, Coagulation…" span={2}/>
        <Field form={form} set={set} label="Urgency" name="urgency" options={["Routine","Urgent","STAT"]}/>
      </div>
      <div style={g("1fr 1fr 1fr")}>
        <Field form={form} set={set} label="Sample Type" name="sampleType" options={["Venous Blood","Arterial Blood","Urine (Spot)","Urine (24hr)","Stool","Sputum","Swab","CSF","Pleural Fluid","Ascitic Fluid","Tissue Biopsy"]}/>
        <Field form={form} set={set} label="Fasting Required" name="fasting" options={["No","Yes — 8 hrs","Yes — 12 hrs"]}/>
        <Field form={form} set={set} label="Priority" name="priority" options={["Routine","Urgent","STAT"]}/>
      </div>
      <Field form={form} set={set} label="Clinical Details / Special Instructions" name="notes" placeholder="Pre-antibiotic, timing, paired samples…" type="textarea"/>
    </>
  );

  if (typeId === "Radiology") return (
    <>
      <div style={g("2fr 1fr 1fr")}>
        <Field form={form} set={set} label="Scan / Study *" name="testName" placeholder="e.g. CECT Chest, USG Abdomen, MRI Brain, X-Ray PA"/>
        <Field form={form} set={set} label="Region / Body Part" name="region" placeholder="e.g. Chest, Abdomen-Pelvis"/>
        <Field form={form} set={set} label="Urgency" name="urgency" options={["Routine","Urgent","STAT"]}/>
      </div>
      <div style={g("1fr 1fr 1fr 1fr")}>
        <Field form={form} set={set} label="Contrast" name="contrast" options={["Plain (No Contrast)","With IV Contrast","With Oral Contrast","Both"]}/>
        <Field form={form} set={set} label="Sedation Required" name="sedation" options={["No","Yes"]}/>
        <Field form={form} set={set} label="Laterality" name="laterality" options={["—","Right","Left","Bilateral"]}/>
        <Field form={form} set={set} label="Priority" name="priority" options={["Routine","Urgent","STAT"]}/>
      </div>
      <Field form={form} set={set} label="Clinical Indication / History" name="notes" placeholder="Relevant clinical details, allergy to contrast, prior imaging…" type="textarea"/>
    </>
  );

  if (typeId === "Procedure") return (
    <>
      <div style={g("2fr 1fr")}>
        <Field form={form} set={set} label="Procedure Name *" name="procedureName" placeholder="e.g. Chest Drain Insertion, Lumbar Puncture, IV Cannula"/>
        <Field form={form} set={set} label="Type" name="procedureType" options={["Minor","Major","Diagnostic","Therapeutic","Bedside"]}/>
      </div>
      <div style={g("1fr 1fr 1fr")}>
        <Field form={form} set={set} label="Indication *" name="indication" placeholder="e.g. Pleural Effusion, Raised ICP"/>
        <Field form={form} set={set} label="Estimated Duration" name="estimatedDuration" placeholder="e.g. 30 min"/>
        <Field form={form} set={set} label="Priority" name="priority" options={["Routine","Urgent","STAT"]}/>
      </div>
      <div style={g("1fr 1fr 1fr")}>
        <Field form={form} set={set} label="Consent Required" name="consentRequired" options={["Yes","No"]}/>
        <Field form={form} set={set} label="Anaesthesia" name="anaesthesia" options={["None","Local","Sedation","GA"]}/>
        <Field form={form} set={set} label="Position" name="position" options={["Supine","Lateral Decubitus","Sitting","Prone","Lithotomy"]}/>
      </div>
      <Field form={form} set={set} label="Pre-procedure Instructions / Equipment Needed" name="notes" placeholder="NPO, coagulation check, equipment list…" type="textarea"/>
    </>
  );

  if (typeId === "BloodTransfusion") return (
    <>
      <div style={g("1fr 1fr 1fr 1fr")}>
        <Field form={form} set={set} label="Blood Product *" name="medicineName" options={["Packed Red Cells","Whole Blood","Fresh Frozen Plasma","Platelets","Cryoprecipitate","Albumin"]}/>
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
      <Field form={form} set={set} label="Special Instructions / Transfusion Notes" name="notes" placeholder="Reaction plan, warmer required, irradiated blood…" type="textarea"/>
    </>
  );

  if (typeId === "Diet") return (
    <>
      <div style={g("1fr 1fr 1fr")}>
        <Field form={form} set={set} label="Diet Type *" name="dietType" options={["Regular/Normal","Soft","Semi-Solid","Liquid","Clear Liquid","NPO (Nil by Mouth)","Diabetic Diet","Low Salt","Low Fat","High Protein","Renal Diet","Hepatic Diet","Enteral (NG Tube)","TPN (Total Parenteral)"]}/>
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
      <div style={g("1fr 1fr 1fr 1fr")}>
        <Field form={form} set={set} label="Delivery Device *" name="deliveryDevice" options={["Nasal Prongs","Simple Face Mask","Non-Rebreather Mask","Venturi Mask","High-Flow Nasal Cannula (HFNC)","CPAP Mask","BiPAP Mask","Tracheostomy Collar","Incubator / Hood","Room Air"]}/>
        <Field form={form} set={set} label="Flow Rate (L/min)" name="flowRate" placeholder="e.g. 4"/>
        <Field form={form} set={set} label="FiO₂ (%)" name="fio2" placeholder="e.g. 40"/>
        <Field form={form} set={set} label="Target SpO₂ (%)" name="targetSpo2" placeholder="e.g. ≥95"/>
      </div>
      <div style={g("1fr 1fr 1fr")}>
        <Field form={form} set={set} label="HFNC Flow (L/min)" name="hfncFlow" placeholder="e.g. 40 (if HFNC)"/>
        <Field form={form} set={set} label="Duration" name="duration" placeholder="e.g. Continuous, PRN, 6 hrs"/>
        <Field form={form} set={set} label="Priority" name="priority" options={["Routine","Urgent","STAT"]}/>
      </div>
      <Field form={form} set={set} label="Weaning Instructions / Special Notes" name="notes" placeholder="Wean by 2 L/min every 4 hrs if SpO₂ stable…" type="textarea"/>
    </>
  );

  if (typeId === "Physiotherapy") return (
    <>
      <div style={g("1fr 1fr 1fr")}>
        <Field form={form} set={set} label="PT Type *" name="ptType" options={["Chest Physiotherapy","Respiratory Exercises","Limb Exercises (Passive)","Limb Exercises (Active)","Ambulation","Transfer Training","Strengthening","Range of Motion","Incentive Spirometry","Postural Drainage","Traction","Ultrasound Therapy"]}/>
        <Field form={form} set={set} label="Frequency" name="frequency" options={["Once Daily","Twice Daily","Three Times Daily","PRN","Every 4 hrs","Post Op (Immediately)"]}/>
        <Field form={form} set={set} label="Priority" name="priority" options={["Routine","Urgent","STAT"]}/>
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
      <div style={g("1fr 1fr 1fr")}>
        <Field form={form} set={set} label="Activity Level *" name="activityLevel" options={["Bed Rest (Strict)","Bed Rest with Commode","Bed Rest with BRP","Dangle at Bedside","Chair Sit (30 min)","Ambulate in Room","Ambulate in Corridor","Independent Ambulation","As Tolerated"]}/>
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
        <Field form={form} set={set} label="Nursing Instruction *" name="instruction" placeholder="e.g. 2-hourly position change, hourly urine output, wound care"/>
        <Field form={form} set={set} label="Frequency" name="frequency" options={["Stat (Once)","Hourly","2-Hourly","4-Hourly","6-Hourly","8-Hourly","12-Hourly","Daily","BD","TDS","PRN","Continuous"]}/>
      </div>
      <div style={g("1fr 1fr 1fr")}>
        <Field form={form} set={set} label="Care Category" name="careCategory" options={["Wound Care","Catheter Care","NG Tube Care","Tracheostomy Care","Pressure Area Care","Oral Hygiene","Eye Care","IV Site Care","Drain Care","Monitoring","Medication-Related","Other"]}/>
        <Field form={form} set={set} label="Duration" name="duration" placeholder="e.g. Until DC, 3 days"/>
        <Field form={form} set={set} label="Priority" name="priority" options={["Routine","Urgent","STAT"]}/>
      </div>
      <Field form={form} set={set} label="Detailed Instructions" name="notes" placeholder="Step-by-step nursing instructions, product to use, documentation required…" type="textarea"/>
    </>
  );

  if (typeId === "Consultation") return (
    <>
      <div style={g("1fr 1fr 1fr")}>
        <Field form={form} set={set} label="Speciality *" name="speciality" options={["Cardiology","Neurology","Nephrology","Pulmonology","Gastroenterology","Endocrinology","Haematology","Oncology","Infectious Disease","Orthopaedics","General Surgery","Urology","Gynaecology","Ophthalmology","ENT","Dermatology","Psychiatry","Anaesthesia","ICU / Critical Care","Palliative Care","Dietitian","Physiotherapy","Social Work"]}/>
        <Field form={form} set={set} label="Consultant Name" name="consultantName" placeholder="e.g. Dr. Sharma"/>
        <Field form={form} set={set} label="Urgency" name="urgency" options={["Routine (Within 24 hrs)","Urgent (Within 4 hrs)","Emergency (Immediate)"]}/>
      </div>
      <div style={g("1fr 1fr")}>
        <Field form={form} set={set} label="Referred By" name="referredBy" placeholder="Referring doctor name"/>
        <Field form={form} set={set} label="Priority" name="priority" options={["Routine","Urgent","STAT"]}/>
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
   ORDER CARD
══════════════════════════════════════════════════════════════ */
function OrderCard({ order, onCancel }) {
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

  const subtitle = [
    order.orderDetails?.dose,
    order.orderDetails?.route,
    order.orderDetails?.frequency,
    order.orderDetails?.duration,
    order.orderDetails?.urgency,
    order.orderDetails?.region,
    order.orderDetails?.flowRate && `${order.orderDetails.flowRate} L/min`,
  ].filter(Boolean).join(" · ");

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
          {order.status !== "Completed" && order.status !== "Cancelled" && (
            <button
              onClick={(e) => { e.stopPropagation(); if (window.confirm("Cancel this order?")) onCancel(order._id); }}
              style={{ marginTop: 10, padding: "5px 12px", border: `1px solid ${C.redB}`, borderRadius: 7, background: C.redL, color: C.red, fontSize: 11, fontWeight: 700, cursor: "pointer" }}
            >
              <i className="pi pi-times" style={{ marginRight: 5 }}/> Cancel Order
            </button>
          )}
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

  /* fetch orders */
  const fetchOrders = useCallback(async () => {
    if (!UHID) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ UHID });
      if (visitId) params.set("visitId", visitId);
      const r = await axios.get(`${API_ENDPOINTS.DOCTOR_ORDERS}?${params}`);
      setOrders(r.data?.data || []);
    } catch { /* silently ignore */ }
    finally { setLoading(false); }
  }, [UHID, visitId]);

  useEffect(() => { fetchOrders(); }, [fetchOrders, refreshSignal]);
  useEffect(() => { const t = setInterval(fetchOrders, 30000); return () => clearInterval(t); }, [fetchOrders]);

  /* helpers */
  const setField = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const resetForm = () => { setSelType(null); setForm({}); setShowForm(false); };

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

    // Combine dose + unit into human-readable string (e.g. "500mg") for display
    if (d.dose !== undefined && d.dose !== "" && d.doseUnit) {
      d.dose = `${d.dose}${d.doseUnit}`;
    }
    // Combine durationValue + unit into duration string (e.g. "6 hrs") for display
    if (d.durationValue !== undefined && d.durationValue !== "") {
      d.duration = `${d.durationValue} ${d.durationUnit || "hrs"}`;
    }

    base.orderDetails = d;

    // HAM root-level flags (Medication only)
    if (selType === "Medication") {
      base.hamFlag              = !!form.hamFlag;
      base.twoNurseRequired     = !!form.twoNurseRequired;
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
    if (selType === "Lab" || selType === "Radiology") {
      base.testName = form.testName;
      base.urgency  = form.urgency;
    }
    if (selType === "Procedure") {
      base.procedureName = form.procedureName;
      base.procedureType = form.procedureType;
      base.consentRequired = form.consentRequired === "Yes";
    }
    base.notes = form.notes || "";
    base.displayName = form.medicineName || form.testName || form.procedureName
      || form.instruction || form.dietType || form.ptType
      || form.activityLevel || form.deliveryDevice || form.speciality || selType;

    return base;
  };

  const saveOrder = async () => {
    if (!selType) return toast.error("Select an order type");
    const required = {
      Medication: "medicineName", IV_Fluid: "medicineName", Lab: "testName",
      Radiology: "testName", Procedure: "procedureName",
      BloodTransfusion: "medicineName", Diet: "dietType", Oxygen: "deliveryDevice",
      Physiotherapy: "ptType", Activity: "activityLevel", Nursing: "instruction",
      Consultation: "speciality",
    };
    const reqField = required[selType];
    if (reqField && !form[reqField]) return toast.error("Fill in the required fields (*)");

    setSaving(true);
    try {
      // Token is attached automatically by the global axios interceptor
      // (reads `his_token`). Manual headers using the wrong key
      // (`localStorage.getItem("token")` → null) used to send `Bearer null`
      // and trigger a 401 + session wipe — removed.
      await axios.post(API_ENDPOINTS.DOCTOR_ORDERS, buildPayload());
      toast.success(`${TYPE_MAP[selType]?.label} order placed`);
      resetForm();
      fetchOrders();
    } catch (e) {
      toast.error(e.response?.data?.message || "Failed to place order");
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
  const filtered = orders.filter(o => {
    const typeOk = filterType === "All" || o.orderType === filterType;
    const statOk = filterStat === "All"
      || (filterStat === "Active"    && ACTIVE_STATUSES.includes(o.status))
      || (filterStat === "Completed" && o.status === "Completed")
      || (filterStat === "Cancelled" && o.status === "Cancelled");
    return typeOk && statOk;
  });

  const activeCount    = orders.filter(o => ACTIVE_STATUSES.includes(o.status)).length;
  const completedCount = orders.filter(o => o.status === "Completed").length;

  /* ── Priority counts for header badges ── */
  const statOrders = orders.filter(o => o.priority === "STAT" && ACTIVE_STATUSES.includes(o.status));

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

      {/* ═══════════════ ORDER FORM ═══════════════ */}
      {showForm && (
        <div style={{ padding: 16, borderBottom: `1.5px solid ${C.border}`, background: C.grayL }}>

          {/* Type selector grid */}
          {!selType ? (
            <>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".6px", marginBottom: 10 }}>Select Order Type</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 8 }}>
                {ORDER_TYPES.map(t => (
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
                <button onClick={() => { setSelType(null); setForm({}); }} style={{ border: `1px solid ${C.border}`, background: "white", borderRadius: 7, padding: "4px 10px", fontSize: 11, cursor: "pointer", color: C.muted }}>
                  <i className="pi pi-arrow-left" style={{ marginRight: 5 }}/>Back
                </button>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ width: 30, height: 30, borderRadius: 8, background: TYPE_MAP[selType]?.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <i className={`pi ${TYPE_MAP[selType]?.icon}`} style={{ fontSize: 13, color: TYPE_MAP[selType]?.color }}/>
                  </div>
                  <div>
                    <div style={{ fontWeight: 800, color: TYPE_MAP[selType]?.color, fontSize: 14 }}>{TYPE_MAP[selType]?.label}</div>
                    <div style={{ fontSize: 11, color: C.muted }}>Dr. {doctorName} · {new Date().toLocaleString("en-IN", { day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit" })}</div>
                  </div>
                </div>
              </div>

              {/* Dynamic form */}
              <div style={{ background: "white", borderRadius: 10, border: `1px solid ${C.border}`, padding: 14 }}>
                <OrderForm typeId={selType} form={form} set={setField}/>
              </div>

              {/* Actions */}
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button onClick={resetForm} style={{ padding: "8px 18px", border: `1px solid ${C.border}`, borderRadius: 8, background: "white", color: C.muted, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                  Cancel
                </button>
                <button
                  onClick={saveOrder}
                  disabled={saving}
                  style={{ padding: "8px 22px", border: "none", borderRadius: 8, background: `linear-gradient(135deg, ${C.primary}, ${C.primaryMid})`, color: "white", fontSize: 12, fontWeight: 800, cursor: saving ? "not-allowed" : "pointer", opacity: saving ? .7 : 1, display: "flex", alignItems: "center", gap: 6 }}
                >
                  {saving ? <><i className="pi pi-spin pi-spinner" style={{ fontSize: 12 }}/> Placing…</> : <><i className="pi pi-check" style={{ fontSize: 11 }}/> Place Order</>}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ═══════════════ FILTERS ═══════════════ */}
      <div style={{ padding: "8px 16px", borderBottom: `1px solid ${C.border}`, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", background: C.grayL }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".5px" }}>Filter:</div>
        {["Active","Completed","Cancelled","All"].map(s => (
          <button key={s} onClick={() => setFilterStat(s)} style={{ padding: "3px 10px", borderRadius: 10, fontSize: 11, fontWeight: 700, cursor: "pointer", border: `1px solid ${filterStat === s ? C.primary : C.border}`, background: filterStat === s ? C.primaryL : "white", color: filterStat === s ? C.primary : C.muted }}>
            {s}
          </button>
        ))}
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
          <OrderCard key={order._id} order={order} onCancel={cancelOrder}/>
        ))}
      </div>

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
