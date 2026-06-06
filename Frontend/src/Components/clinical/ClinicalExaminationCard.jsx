/**
 * ClinicalExaminationCard.jsx
 * R7hr-58 — Shared "Clinical Examination" UI for OPD + IPD.
 *
 * Lifted from OPDAssessmentPage.jsx (the original rich structured exam
 * card with General Exam dropdowns/checkboxes + CVS/RS/CNS/P-A mini
 * blocks). Wrapped as a controlled component so IPD's Initial Assessment
 * page can reuse the exact same UI instead of the older free-text-only
 * "Review of Systems" + "Physical Examination" sections.
 *
 * Controlled component pattern:
 *   <ClinicalExaminationCard
 *       value={clinExam}
 *       onChange={setClinExam}
 *       color="#0d9488"   // optional — defaults to teal/sky
 *   />
 *
 * `value` shape (top-level keys preserved on save so back-ends + print
 * builders can extract any subset):
 *   {
 *     genExam: { built, nourishment, consciousness, orientation,
 *                pallor, pedalEdema, hydration, jvp,
 *                icterus, cyanosis, clubbing, lymphadenopathy, febrile,
 *                lymphLocation },
 *     sysExam: {
 *       cvs: { s1s2, rhythm, murmur, murmurDetails, other },
 *       rs:  { airEntry, breathSounds, crepts, wheeze, rhonchi, other },
 *       cns: { gcs, speech, tone, reflexes, plantar, power, other },
 *       pa:  { soft, tender, distended, organomegaly, mass,
 *              bowelSounds, tenderLocation, organomegalyDetails, other },
 *     },
 *     generalExamination: "",     // free-text "other findings"
 *     systemicExamination: "",    // free-text catch-all (ENT, MSK, skin)
 *   }
 *
 * NOTE: When the parent page does NOT need the wrapping Card chrome
 * (e.g. already inside its own collapsible Section), pass
 * `noCard` to render only the body.
 */
import React, { useState } from "react";

/* ── Helpers — kept tiny so the component is self-contained.
 *    Visual style intentionally mirrors OPDAssessmentPage's Field /
 *    Input / Textarea / Card so the two pages look identical. ── */

function Field({ label, children, required, C }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 6, letterSpacing: ".3px" }}>
        {label}{required && <span style={{ color: "#dc2626" }}> *</span>}
      </label>
      {children}
    </div>
  );
}

function Textarea({ value, onChange, placeholder, rows = 3, C }) {
  return (
    <textarea
      value={value || ""}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      style={{
        width: "100%", border: `1px solid ${C.border}`, borderRadius: 8,
        padding: "10px 12px", fontSize: 13, color: C.dark, background: "#fff",
        resize: "vertical", fontFamily: "inherit", lineHeight: 1.5,
        boxSizing: "border-box", outline: "none",
      }}
      onFocus={e => (e.target.style.borderColor = C.primary)}
      onBlur={e => (e.target.style.borderColor = C.border)}
    />
  );
}

function Input({ value, onChange, placeholder, type = "text", C }) {
  return (
    <input
      type={type}
      value={value || ""}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        width: "100%", border: `1px solid ${C.border}`, borderRadius: 8,
        padding: "9px 12px", fontSize: 13, color: C.dark, background: "#fff",
        boxSizing: "border-box", outline: "none",
      }}
      onFocus={e => (e.target.style.borderColor = C.primary)}
      onBlur={e => (e.target.style.borderColor = C.border)}
    />
  );
}

function Card({ title, icon, color, children, defaultOpen = true }) {
  // localStorage key shared per page — same card across visits keeps
  // its collapsed/expanded state.
  const storageKey = `sphere_clinexam_${title}`;
  const [open, setOpen] = useState(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored === "open") return true;
      if (stored === "closed") return false;
    } catch (_) {}
    return defaultOpen;
  });
  const toggle = () => {
    setOpen(prev => {
      const next = !prev;
      try { localStorage.setItem(storageKey, next ? "open" : "closed"); } catch (_) {}
      return next;
    });
  };
  return (
    <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, marginBottom: 20, overflow: "hidden", boxShadow: "0 1px 6px rgba(0,0,0,.05)" }}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        style={{
          width: "100%", padding: "12px 18px",
          background: color + "08", borderBottom: open ? "1px solid #e2e8f0" : "none",
          border: "none", textAlign: "left",
          display: "flex", alignItems: "center", gap: 10,
          cursor: "pointer", fontFamily: "inherit",
          transition: "background 0.15s ease",
        }}
        onMouseEnter={e => { e.currentTarget.style.background = color + "12"; }}
        onMouseLeave={e => { e.currentTarget.style.background = color + "08"; }}
      >
        <i className={`pi ${icon}`} style={{ fontSize: 14, color }} />
        <span style={{ fontWeight: 700, fontSize: 13, color }}>{title}</span>
        <i
          className="pi pi-chevron-down"
          style={{
            marginLeft: "auto", fontSize: 12, color,
            transform: open ? "rotate(0deg)" : "rotate(-90deg)",
            transition: "transform 0.18s ease",
          }}
          aria-hidden="true"
        />
      </button>
      {open && (
        <div style={{ padding: "18px" }}>
          {children}
        </div>
      )}
    </div>
  );
}

/* ── Defaults — used to backfill any missing nested keys so the
 *    parent can pass a partial object without crashing the
 *    destructuring inside the JSX. ── */
const DEFAULT_VALUE = {
  genExam: {
    built: "", nourishment: "", consciousness: "", orientation: "",
    pallor: "", pedalEdema: "", hydration: "", jvp: "",
    icterus: false, cyanosis: false, clubbing: false,
    lymphadenopathy: false, febrile: false, lymphLocation: "",
  },
  sysExam: {
    cvs: { s1s2: "", rhythm: "", murmur: false, murmurDetails: "", other: "" },
    rs:  { airEntry: "", breathSounds: "", crepts: false, wheeze: false, rhonchi: false, other: "" },
    cns: { gcs: "", speech: "", tone: "", reflexes: "", plantar: "", power: "", other: "" },
    pa:  { soft: false, tender: false, distended: false, organomegaly: false, mass: false,
           bowelSounds: "", tenderLocation: "", organomegalyDetails: "", other: "" },
  },
  generalExamination: "",
  systemicExamination: "",
};

function safeValue(v) {
  if (!v) return DEFAULT_VALUE;
  return {
    ...DEFAULT_VALUE,
    ...v,
    genExam: { ...DEFAULT_VALUE.genExam, ...(v.genExam || {}) },
    sysExam: {
      cvs: { ...DEFAULT_VALUE.sysExam.cvs, ...(v.sysExam?.cvs || {}) },
      rs:  { ...DEFAULT_VALUE.sysExam.rs,  ...(v.sysExam?.rs  || {}) },
      cns: { ...DEFAULT_VALUE.sysExam.cns, ...(v.sysExam?.cns || {}) },
      pa:  { ...DEFAULT_VALUE.sysExam.pa,  ...(v.sysExam?.pa  || {}) },
    },
  };
}

export default function ClinicalExaminationCard({
  value,
  onChange,
  color = "#0ea5e9",
  noCard = false,
}) {
  // Internal palette tied to the caller's color choice. We keep
  // border / dark / muted neutral so the card matches both OPD
  // (purple/blue) and IPD (teal) themes.
  const C = {
    primary: color,
    border: "#cbd5e1",
    dark: "#0f172a",
    muted: "#64748b",
  };

  const v = safeValue(value);

  // Helpers to push updates back to parent without mutating.
  const setGen = (key, val) =>
    onChange({ ...v, genExam: { ...v.genExam, [key]: val } });
  const setSys = (sys, key, val) =>
    onChange({
      ...v,
      sysExam: { ...v.sysExam, [sys]: { ...v.sysExam[sys], [key]: val } },
    });
  const setTop = (key, val) => onChange({ ...v, [key]: val });

  const body = (
    <>
      {/* ── General Examination ── */}
      <div style={{ fontSize: 11, fontWeight: 800, color: C.primary, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
        General Examination
      </div>

      {/* Row 1 — categorical dropdowns */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10, marginBottom: 10 }}>
        {[
          ["Built",         "built",         ["Average", "Lean", "Obese", "Cachectic"]],
          ["Nourishment",   "nourishment",   ["Well-nourished", "Moderate", "Poor"]],
          ["Consciousness", "consciousness", ["Conscious", "Drowsy", "Stuporous", "Comatose"]],
          ["Orientation",   "orientation",   ["Oriented", "Disoriented (Time)", "Disoriented (Place)", "Disoriented (Person)"]],
        ].map(([lbl, key, opts]) => (
          <Field key={key} label={lbl} C={C}>
            <select
              value={v.genExam[key] || ""}
              onChange={e => setGen(key, e.target.value)}
              style={{ width: "100%", border: `1px solid ${C.border}`, borderRadius: 6, padding: "8px 10px", fontSize: 12, outline: "none", fontFamily: "inherit", cursor: "pointer", background: "#fff" }}
            >
              <option value="">—</option>
              {opts.map(o => <option key={o}>{o}</option>)}
            </select>
          </Field>
        ))}
      </div>

      {/* Row 2 — severity-scaled findings + JVP */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10, marginBottom: 10 }}>
        {[
          ["Pallor",      "pallor",      ["None", "+", "++", "+++"]],
          ["Pedal Edema", "pedalEdema",  ["None", "+ Pitting", "++ Pitting", "+++ Pitting", "Non-pitting"]],
          ["Hydration",   "hydration",   ["Well hydrated", "Mild dehydration", "Moderate", "Severe"]],
          ["JVP",         "jvp",         ["Normal", "Raised"]],
        ].map(([lbl, key, opts]) => (
          <Field key={key} label={lbl} C={C}>
            <select
              value={v.genExam[key] || ""}
              onChange={e => setGen(key, e.target.value)}
              style={{ width: "100%", border: `1px solid ${C.border}`, borderRadius: 6, padding: "8px 10px", fontSize: 12, outline: "none", fontFamily: "inherit", cursor: "pointer", background: "#fff" }}
            >
              <option value="">—</option>
              {opts.map(o => <option key={o}>{o}</option>)}
            </select>
          </Field>
        ))}
      </div>

      {/* Row 3 — quick checkbox findings */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 16px", padding: "10px 12px", background: "#f8fafc", border: `1px solid ${C.border}`, borderRadius: 8, marginBottom: 10 }}>
        {[
          ["Icterus",         "icterus"],
          ["Cyanosis",        "cyanosis"],
          ["Clubbing",        "clubbing"],
          ["Lymphadenopathy", "lymphadenopathy"],
          ["Febrile",         "febrile"],
        ].map(([lbl, key]) => (
          <label key={key} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: C.dark, fontWeight: 600, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={!!v.genExam[key]}
              onChange={e => setGen(key, e.target.checked)}
            />
            {lbl}
          </label>
        ))}
      </div>

      {/* Conditional: lymph node location if lymphadenopathy ticked */}
      {v.genExam.lymphadenopathy && (
        <div style={{ marginBottom: 10 }}>
          <Field label="Lymph node location" C={C}>
            <Input
              value={v.genExam.lymphLocation}
              onChange={val => setGen("lymphLocation", val)}
              placeholder="e.g. Cervical, axillary, inguinal — single / matted / firm…"
              C={C}
            />
          </Field>
        </div>
      )}

      {/* Other gen-ex findings (free text) */}
      <Field label="Other General Findings" C={C}>
        <Textarea
          value={v.generalExamination}
          onChange={val => setTop("generalExamination", val)}
          placeholder="Anything not in the standard checklist (skin lesions, pulse character, scars, oedema location, etc.)"
          rows={2}
          C={C}
        />
      </Field>

      {/* ── Systemic Examination ── */}
      <div style={{ fontSize: 11, fontWeight: 800, color: C.primary, textTransform: "uppercase", letterSpacing: 0.5, marginTop: 16, marginBottom: 8 }}>
        Systemic Examination
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {/* CVS */}
        <div style={{ padding: "10px 12px", background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8 }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: "#b91c1c", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>♥ CVS — Cardiovascular</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 6 }}>
            <select
              value={v.sysExam.cvs.s1s2 || ""}
              onChange={e => setSys("cvs", "s1s2", e.target.value)}
              style={{ width: "100%", border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 8px", fontSize: 11, fontFamily: "inherit", cursor: "pointer", background: "#fff" }}
            >
              <option value="">S1 S2 —</option>
              <option>S1 S2 Normal</option>
              <option>S1 S2 Muffled</option>
              <option>S1 S2 Abnormal</option>
            </select>
            <select
              value={v.sysExam.cvs.rhythm || ""}
              onChange={e => setSys("cvs", "rhythm", e.target.value)}
              style={{ width: "100%", border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 8px", fontSize: 11, fontFamily: "inherit", cursor: "pointer", background: "#fff" }}
            >
              <option value="">Rhythm —</option>
              <option>Regular</option>
              <option>Irregular</option>
            </select>
          </div>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: C.dark, fontWeight: 600, cursor: "pointer", marginBottom: 6 }}>
            <input
              type="checkbox"
              checked={!!v.sysExam.cvs.murmur}
              onChange={e => setSys("cvs", "murmur", e.target.checked)}
            />
            Murmur
          </label>
          {v.sysExam.cvs.murmur && (
            <input
              value={v.sysExam.cvs.murmurDetails || ""}
              onChange={e => setSys("cvs", "murmurDetails", e.target.value)}
              placeholder="Site, grade, systolic/diastolic, radiation…"
              style={{ width: "100%", border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 8px", fontSize: 11, fontFamily: "inherit", marginBottom: 6 }}
            />
          )}
          <input
            value={v.sysExam.cvs.other || ""}
            onChange={e => setSys("cvs", "other", e.target.value)}
            placeholder="Other CVS findings"
            style={{ width: "100%", border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 8px", fontSize: 11, fontFamily: "inherit" }}
          />
        </div>

        {/* RS */}
        <div style={{ padding: "10px 12px", background: "#ecfeff", border: "1px solid #67e8f9", borderRadius: 8 }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: "#0e7490", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>🫁 RS — Respiratory</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 6 }}>
            <select
              value={v.sysExam.rs.airEntry || ""}
              onChange={e => setSys("rs", "airEntry", e.target.value)}
              style={{ width: "100%", border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 8px", fontSize: 11, fontFamily: "inherit", cursor: "pointer", background: "#fff" }}
            >
              <option value="">Air entry —</option>
              <option>B/L equal</option>
              <option>Decreased R</option>
              <option>Decreased L</option>
              <option>Unequal</option>
            </select>
            <select
              value={v.sysExam.rs.breathSounds || ""}
              onChange={e => setSys("rs", "breathSounds", e.target.value)}
              style={{ width: "100%", border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 8px", fontSize: 11, fontFamily: "inherit", cursor: "pointer", background: "#fff" }}
            >
              <option value="">Breath sounds —</option>
              <option>Vesicular</option>
              <option>Bronchial</option>
              <option>Broncho-vesicular</option>
              <option>Diminished</option>
            </select>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 6 }}>
            {[["Crepts", "crepts"], ["Wheeze", "wheeze"], ["Rhonchi", "rhonchi"]].map(([lbl, k]) => (
              <label key={k} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: C.dark, fontWeight: 600, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={!!v.sysExam.rs[k]}
                  onChange={e => setSys("rs", k, e.target.checked)}
                />
                {lbl}
              </label>
            ))}
          </div>
          <input
            value={v.sysExam.rs.other || ""}
            onChange={e => setSys("rs", "other", e.target.value)}
            placeholder="Other RS findings"
            style={{ width: "100%", border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 8px", fontSize: 11, fontFamily: "inherit" }}
          />
        </div>

        {/* CNS */}
        <div style={{ padding: "10px 12px", background: "#f5f3ff", border: "1px solid #c4b5fd", borderRadius: 8 }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: "#6d28d9", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>🧠 CNS — Neurological</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 6 }}>
            <input
              value={v.sysExam.cns.gcs || ""}
              onChange={e => setSys("cns", "gcs", e.target.value)}
              placeholder="GCS (E4V5M6)"
              style={{ width: "100%", border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 8px", fontSize: 11, fontFamily: "inherit" }}
            />
            <select
              value={v.sysExam.cns.speech || ""}
              onChange={e => setSys("cns", "speech", e.target.value)}
              style={{ width: "100%", border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 8px", fontSize: 11, fontFamily: "inherit", cursor: "pointer", background: "#fff" }}
            >
              <option value="">Speech —</option>
              <option>Normal</option>
              <option>Slurred</option>
              <option>Aphasia (Expressive)</option>
              <option>Aphasia (Receptive)</option>
            </select>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginBottom: 6 }}>
            <select
              value={v.sysExam.cns.tone || ""}
              onChange={e => setSys("cns", "tone", e.target.value)}
              style={{ width: "100%", border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 8px", fontSize: 11, fontFamily: "inherit", cursor: "pointer", background: "#fff" }}
            >
              <option value="">Tone —</option>
              <option>Normal</option>
              <option>Hypertonia</option>
              <option>Hypotonia</option>
            </select>
            <select
              value={v.sysExam.cns.reflexes || ""}
              onChange={e => setSys("cns", "reflexes", e.target.value)}
              style={{ width: "100%", border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 8px", fontSize: 11, fontFamily: "inherit", cursor: "pointer", background: "#fff" }}
            >
              <option value="">Reflexes —</option>
              <option>Normal</option>
              <option>Brisk</option>
              <option>Absent</option>
            </select>
            <select
              value={v.sysExam.cns.plantar || ""}
              onChange={e => setSys("cns", "plantar", e.target.value)}
              style={{ width: "100%", border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 8px", fontSize: 11, fontFamily: "inherit", cursor: "pointer", background: "#fff" }}
            >
              <option value="">Plantar —</option>
              <option>Flexor</option>
              <option>Extensor</option>
              <option>Equivocal</option>
            </select>
          </div>
          <input
            value={v.sysExam.cns.power || ""}
            onChange={e => setSys("cns", "power", e.target.value)}
            placeholder="Power (e.g. 5/5 all limbs, or 3/5 R UL)"
            style={{ width: "100%", border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 8px", fontSize: 11, fontFamily: "inherit", marginBottom: 6 }}
          />
          <input
            value={v.sysExam.cns.other || ""}
            onChange={e => setSys("cns", "other", e.target.value)}
            placeholder="Other CNS findings"
            style={{ width: "100%", border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 8px", fontSize: 11, fontFamily: "inherit" }}
          />
        </div>

        {/* P/A — Abdomen */}
        <div style={{ padding: "10px 12px", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8 }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: "#a16207", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>🫃 P/A — Per Abdomen</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 6 }}>
            {[["Soft", "soft"], ["Tender", "tender"], ["Distended", "distended"], ["Organomegaly", "organomegaly"], ["Mass", "mass"]].map(([lbl, k]) => (
              <label key={k} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: C.dark, fontWeight: 600, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={!!v.sysExam.pa[k]}
                  onChange={e => setSys("pa", k, e.target.checked)}
                />
                {lbl}
              </label>
            ))}
          </div>
          <select
            value={v.sysExam.pa.bowelSounds || ""}
            onChange={e => setSys("pa", "bowelSounds", e.target.value)}
            style={{ width: "100%", border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 8px", fontSize: 11, fontFamily: "inherit", cursor: "pointer", background: "#fff", marginBottom: 6 }}
          >
            <option value="">Bowel sounds —</option>
            <option>Present</option>
            <option>Sluggish</option>
            <option>Absent</option>
            <option>Hyperactive</option>
          </select>
          {v.sysExam.pa.tender && (
            <input
              value={v.sysExam.pa.tenderLocation || ""}
              onChange={e => setSys("pa", "tenderLocation", e.target.value)}
              placeholder="Tenderness location (RIF, epigastric, McBurney's…)"
              style={{ width: "100%", border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 8px", fontSize: 11, fontFamily: "inherit", marginBottom: 6 }}
            />
          )}
          {v.sysExam.pa.organomegaly && (
            <input
              value={v.sysExam.pa.organomegalyDetails || ""}
              onChange={e => setSys("pa", "organomegalyDetails", e.target.value)}
              placeholder="Organomegaly (Hepato- / Spleno- + size in cm)"
              style={{ width: "100%", border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 8px", fontSize: 11, fontFamily: "inherit", marginBottom: 6 }}
            />
          )}
          <input
            value={v.sysExam.pa.other || ""}
            onChange={e => setSys("pa", "other", e.target.value)}
            placeholder="Other P/A findings"
            style={{ width: "100%", border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 8px", fontSize: 11, fontFamily: "inherit" }}
          />
        </div>
      </div>

      {/* Catch-all for systems not covered above */}
      <div style={{ marginTop: 10 }}>
        <Field label="Other Systemic Findings (ENT, Musculoskeletal, Skin, etc.)" C={C}>
          <Textarea
            value={v.systemicExamination}
            onChange={val => setTop("systemicExamination", val)}
            placeholder="Anything not covered by the CVS / RS / CNS / P-A blocks above"
            rows={2}
            C={C}
          />
        </Field>
      </div>
    </>
  );

  if (noCard) return body;

  return (
    <Card title="Clinical Examination" icon="pi-search" color={C.primary}>
      {body}
    </Card>
  );
}

/* ── Print helper — concise human-readable summary of the structured
 *    exam, for the print/PDF builders on either page. Returns plain
 *    text (no HTML) so callers can wrap it however they need. ── */
export function clinExamSummary(value) {
  const v = safeValue(value);
  const out = [];

  // General — list non-empty categorical + ticked checkboxes
  const gen = [];
  ["built", "nourishment", "consciousness", "orientation", "hydration", "pallor", "pedalEdema", "jvp"].forEach(k => {
    if (v.genExam[k]) gen.push(`${k}: ${v.genExam[k]}`);
  });
  ["icterus", "cyanosis", "clubbing", "lymphadenopathy", "febrile"].forEach(k => {
    if (v.genExam[k]) gen.push(k);
  });
  if (v.genExam.lymphadenopathy && v.genExam.lymphLocation) {
    gen.push(`lymph nodes: ${v.genExam.lymphLocation}`);
  }
  if (v.generalExamination) gen.push(v.generalExamination);
  if (gen.length) out.push(`General: ${gen.join(", ")}`);

  // Systemic — per-system non-empty fields
  const sysLine = (name, sys) => {
    const parts = [];
    Object.entries(sys).forEach(([k, val]) => {
      if (val === true) parts.push(k);
      else if (val && typeof val === "string") parts.push(`${k}: ${val}`);
    });
    if (parts.length) out.push(`${name}: ${parts.join(", ")}`);
  };
  sysLine("CVS", v.sysExam.cvs);
  sysLine("RS",  v.sysExam.rs);
  sysLine("CNS", v.sysExam.cns);
  sysLine("P/A", v.sysExam.pa);
  if (v.systemicExamination) out.push(`Other: ${v.systemicExamination}`);

  return out.join("\n");
}
