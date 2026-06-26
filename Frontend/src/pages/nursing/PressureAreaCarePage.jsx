/**
 * PressureAreaCarePage.jsx
 * NABH-Compliant Braden Scale Pressure Injury Risk + Wound Care Log
 */

import React, { useState, useCallback, useEffect } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { API_ENDPOINTS } from "../../config/api";
import { useAuth } from "../../context/AuthContext";
import ClinicalLayout from "../../Components/clinical/ClinicalLayout";
import { useAutoSave } from "../../hooks/useAutoSave";
import { useDigitalSignature } from "../../hooks/useDigitalSignature";
import AutoSaveIndicator from "../../Components/signature/AutoSaveIndicator";
import SignaturePad from "../../Components/signature/SignaturePad";

const API = API_ENDPOINTS.BASE;

const C = {
  bg: "#f8fafc", card: "#ffffff", border: "#e2e8f0", text: "#0f172a", muted: "#64748b",
  primary: "#0f766e", primaryL: "#f0fdfa", primaryMid: "#0d9488",
  green: "#16a34a", greenL: "#dcfce7", greenB: "#bbf7d0",
  amber: "#d97706", amberL: "#fffbeb", amberB: "#fde68a",
  red: "#dc2626", redL: "#fef2f2", redB: "#fecaca",
  blue: "#4f46e5", blueL: "#eef2ff", blueB: "#c7d2fe",
  purple: "#7c3aed", purpleL: "#f5f3ff",
  slate: "#1e293b", pink: "#be185d",
  orange: "#ea580c", orangeL: "#fff7ed",
  yellow: "#ca8a04", yellowL: "#fefce8",
};

function Section({ title, icon, color=C.primary, badge, children, defaultOpen=true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ background:C.card, border:`1.5px solid ${C.border}`, borderRadius:14, marginBottom:16, overflow:"hidden", boxShadow:"0 1px 3px rgba(0,0,0,.04)" }}>
      <div onClick={()=>setOpen(o=>!o)} style={{ padding:"12px 20px", background:"#f8fafc", borderBottom:open?`1px solid ${C.border}`:"none", display:"flex", alignItems:"center", justifyContent:"space-between", cursor:"pointer", userSelect:"none" }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <span style={{ width:30, height:30, borderRadius:8, background:color+"18", display:"flex", alignItems:"center", justifyContent:"center" }}>
            <i className={`pi ${icon}`} style={{ fontSize:13, color }} />
          </span>
          <span style={{ fontWeight:700, fontSize:13, color:C.text }}>{title}</span>
          {badge && <span style={{ background:color+"20", color, fontSize:10, fontWeight:700, padding:"2px 8px", borderRadius:8 }}>{badge}</span>}
        </div>
        <i className={`pi ${open?"pi-chevron-up":"pi-chevron-down"}`} style={{ fontSize:11, color:C.muted }} />
      </div>
      {open && <div style={{ padding:"18px 20px" }}>{children}</div>}
    </div>
  );
}

function Field({ label, children, style }) {
  return (
    <div style={style}>
      {label && <label className="his-label">{label}</label>}
      {children}
    </div>
  );
}

function PageHeader({ icon, title, subtitle, gradient, right }) {
  return (
    <div style={{ background:gradient, borderRadius:14, padding:"18px 24px", marginBottom:20, display:"flex", justifyContent:"space-between", alignItems:"center", boxShadow:"0 4px 16px rgba(0,0,0,.08)" }}>
      <div style={{ display:"flex", alignItems:"center", gap:14 }}>
        <div style={{ width:46, height:46, borderRadius:12, background:"rgba(255,255,255,.2)", display:"flex", alignItems:"center", justifyContent:"center" }}>
          <i className={`pi ${icon}`} style={{ fontSize:20, color:"#fff" }} />
        </div>
        <div>
          <div style={{ color:"#fff", fontWeight:800, fontSize:18, letterSpacing:"-.3px" }}>{title}</div>
          <div style={{ color:"rgba(255,255,255,.7)", fontSize:12, marginTop:2 }}>{subtitle}</div>
        </div>
      </div>
      {right && <div>{right}</div>}
    </div>
  );
}

function ScoreBadge({ score, max, label, bg, color }) {
  return (
    <div style={{ background:bg, border:`2px solid ${color}`, borderRadius:12, padding:"12px 20px", textAlign:"center", minWidth:100 }}>
      <div style={{ fontSize:28, fontWeight:900, color, lineHeight:1 }}>{score}</div>
      <div style={{ fontSize:10, fontWeight:700, color, marginTop:2 }}>/ {max}</div>
      <div style={{ fontSize:11, color, fontWeight:600, marginTop:4 }}>{label}</div>
    </div>
  );
}

const BRADEN_SCALES = [
  {
    key: "sensory", label: "Sensory Perception", icon: "pi-eye",
    desc: "Ability to respond meaningfully to pressure-related discomfort",
    options: [
      { label:"Completely Limited", value:1 },
      { label:"Very Limited", value:2 },
      { label:"Slightly Limited", value:3 },
      { label:"No Impairment", value:4 },
    ],
  },
  {
    key: "moisture", label: "Moisture", icon: "pi-tint",
    desc: "Degree to which skin is exposed to moisture",
    options: [
      { label:"Constantly Moist", value:1 },
      { label:"Moist", value:2 },
      { label:"Occasionally Moist", value:3 },
      { label:"Rarely Moist", value:4 },
    ],
  },
  {
    key: "activity", label: "Activity", icon: "pi-user",
    desc: "Degree of physical activity",
    options: [
      { label:"Bedfast", value:1 },
      { label:"Chairfast", value:2 },
      { label:"Walks Occasionally", value:3 },
      { label:"Walks Frequently", value:4 },
    ],
  },
  {
    key: "mobility", label: "Mobility", icon: "pi-arrows-alt",
    desc: "Ability to change and control body position",
    options: [
      { label:"Completely Immobile", value:1 },
      { label:"Very Limited", value:2 },
      { label:"Slightly Limited", value:3 },
      { label:"No Limitation", value:4 },
    ],
  },
  {
    key: "nutrition", label: "Nutrition", icon: "pi-heart",
    desc: "Usual food intake pattern",
    options: [
      { label:"Very Poor", value:1 },
      { label:"Probably Inadequate", value:2 },
      { label:"Adequate", value:3 },
      { label:"Excellent", value:4 },
    ],
  },
  {
    key: "friction", label: "Friction & Shear", icon: "pi-minus",
    desc: "Friction and shear problem assessment",
    options: [
      { label:"Problem", value:1 },
      { label:"Potential Problem", value:2 },
      { label:"No Apparent Problem", value:3 },
    ],
  },
];

const PRESSURE_POINTS = [
  "Occiput","Right Shoulder","Left Shoulder","Right Elbow","Left Elbow",
  "Sacrum","Right Heel","Left Heel","Right Knee","Left Knee",
  "Right Ankle","Left Ankle","Right Ischium","Left Ischium",
];

const emptyWoundRow = () => ({
  id: Date.now(), date: new Date().toISOString().slice(0,10), site:"", stage:"",
  size:"", woundBed:"", exudate:"", treatment:"", nurse:"",
});

function getBradenRisk(score) {
  if (score <= 9)  return { level:"Very High Risk", color:C.red,    bg:C.redL };
  if (score <= 12) return { level:"High Risk",      color:C.orange,  bg:C.orangeL };
  if (score <= 14) return { level:"Moderate Risk",  color:C.amber,   bg:C.amberL };
  if (score <= 18) return { level:"Mild Risk",      color:C.yellow,  bg:C.yellowL };
  return                   { level:"No Risk",        color:C.green,   bg:C.greenL };
}

function getCarePlan(score) {
  const base = ["Daily skin inspection","Keep skin clean and dry","Use pH-balanced skin cleansers","Adequate hydration and nutrition"];
  if (score <= 9)  return [...base, "Reposition every 2 hours (24h schedule)","Use specialised pressure-relief mattress","Heel protectors / offloading","Dietitian and wound care specialist referral","Document all skin changes immediately"];
  if (score <= 14) return [...base, "Reposition every 2–4 hours","Pressure-redistributing mattress","Protective dressings on bony prominences","Nutritional supplementation if indicated"];
  if (score <= 18) return [...base, "Reposition every 4 hours","Standard pressure-reducing mattress","Educate patient and family on repositioning"];
  return [...base, "Standard preventive skin care","Educate on importance of mobility"];
}

// R7em-1: Ulcer schema (NABH HIC.4 / NPUAP) — these fields are required by
// PressureUlcerRegisterModel so the emit row carries the full sentinel-event
// picture. Stages match the model enum.
const ULCER_STAGES = ["I", "II", "III", "IV", "Unstageable", "DTI"];
const ULCER_SITES  = ["Sacrum", "Coccyx", "Ischium", "Heel", "Trochanter", "Scapula", "Elbow", "Occiput", "Other"];
const DRESSING_TYPES = ["Hydrocolloid", "Hydrogel", "Foam", "Alginate", "Silver/Antimicrobial", "Transparent Film", "Gauze", "None"];

function PressureAreaContent({ patient }) {
  const { user } = useAuth();
  const [scores, setScores] = useState(Object.fromEntries(BRADEN_SCALES.map(s => [s.key, null])));
  const [pressurePoints, setPressurePoints] = useState({});
  const [woundLog, setWoundLog] = useState([]);
  const [history, setHistory] = useState([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // R7em-1: ulcer-specific NABH register fields. ulcerPresent gates the
  // ulcer details (stage/site/size/dressing) reveal; hospitalAcquired is
  // tracked independently because HAPU≥III is a sentinel event.
  const [ulcerPresent, setUlcerPresent] = useState(false);
  const [ulcerStage, setUlcerStage] = useState("");
  const [ulcerSite, setUlcerSite] = useState("");
  const [ulcerSize, setUlcerSize] = useState("");
  const [hospitalAcquired, setHospitalAcquired] = useState(false);
  const [dressingType, setDressingType] = useState("");

  const draftKey = patient?._id ? `sphere_draft_pressure_${patient._id}` : null;
  const { savedAt, hasDraft, clearDraft } = useAutoSave(
    draftKey,
    { scores, pressurePoints, woundLog, ulcerPresent, ulcerStage, ulcerSite, ulcerSize, hospitalAcquired, dressingType },
    2000
  );
  const { signature, showSetup, setShowSetup, saveSignature } = useDigitalSignature();

  useEffect(() => {
    if (!patient) return;
    const stored = sessionStorage.getItem(`nabh_pressure_area_${patient._id}`);
    if (stored) {
      try {
        const data = JSON.parse(stored);
        setHistory(data.history || []);
        setWoundLog(data.woundLog || []);
        setPressurePoints(data.pressurePoints || {});
      } catch {}
    }
    // Restore auto-save draft
    const dKey = `sphere_draft_pressure_${patient._id}`;
    try {
      const raw = localStorage.getItem(dKey);
      if (raw) {
        const {
          scores: ds, pressurePoints: dp, woundLog: dw,
          ulcerPresent: dup, ulcerStage: dust, ulcerSite: dusi, ulcerSize: dusz,
          hospitalAcquired: dha, dressingType: ddt,
        } = JSON.parse(raw);
        if (ds) setScores(s => ({ ...s, ...ds }));
        if (dp) setPressurePoints(dp);
        if (dw) setWoundLog(dw);
        // R7em-1: restore ulcer-specific fields from draft
        if (dup != null) setUlcerPresent(!!dup);
        if (dust) setUlcerStage(dust);
        if (dusi) setUlcerSite(dusi);
        if (dusz) setUlcerSize(dusz);
        if (dha != null) setHospitalAcquired(!!dha);
        if (ddt) setDressingType(ddt);
      }
    } catch {}
  }, [patient]);

  const totalScore = Object.values(scores).reduce((a, v) => a + (v ?? 0), 0);
  const filledCount = Object.values(scores).filter(v => v !== null).length;
  const allAnswered = filledCount === BRADEN_SCALES.length;
  const risk = getBradenRisk(allAnswered ? totalScore : 23);
  const carePlan = getCarePlan(totalScore);

  const togglePoint = useCallback((pt) => {
    setPressurePoints(prev => ({ ...prev, [pt]: !prev[pt] }));
  }, []);

  const addWoundRow = () => setWoundLog(prev => [...prev, emptyWoundRow()]);
  const updateWound = (id, field, val) => setWoundLog(prev => prev.map(r => r.id===id ? {...r,[field]:val} : r));
  const removeWound = (id) => setWoundLog(prev => prev.filter(r => r.id!==id));

  const handleSave = async () => {
    if (!patient || !allAnswered) return;
    // R7az-D5-CRIT-1 — POST first, only clearDraft + setSaved on 2xx.
    setSaving(true);
    const entry = {
      date: new Date().toISOString(),
      score: totalScore,
      risk: getBradenRisk(totalScore).level,
      scores: { ...scores },
    };
    try {
      await axios.post(`${API}/nursing-assessments/pressure-area`, {
        patientId: patient._id,
        // B3-T03: UHID + admissionId + patientName required by
        // PressureUlcerRegisterModel (UHID required=true at schema level).
        // Without these the register row cannot persist even if emit runs.
        UHID: patient.UHID,
        admissionId: patient.currentAdmissionId || patient.admissionId || patient.activeAdmissionId || undefined,
        patientName: patient.fullName || `${patient.firstName || ""} ${patient.lastName || ""}`.trim(),
        ...entry, woundLog, pressurePoints,
        // R7em-1: NABH HIC.4 ulcer surveillance fields. ulcerStage/site/size
        // /dressingType only carry data when ulcerPresent=true; otherwise
        // they're empty strings (matches PressureUlcerRegisterModel enum "").
        ulcerPresent,
        ulcerStage: ulcerPresent ? ulcerStage : "",
        ulcerSite:  ulcerPresent ? ulcerSite  : "",
        ulcerSize:  ulcerPresent ? ulcerSize  : "",
        dressingType: ulcerPresent ? dressingType : "",
        hospitalAcquired,
        nurseName: user?.fullName || `${user?.firstName || ""} ${user?.lastName || ""}`.trim(),
        nurseEmployeeId: user?.employeeId || "",
        nurseSignature: signature || undefined,
      });
      const newHistory = [entry, ...history];
      const payload = { history: newHistory, woundLog, pressurePoints };
      sessionStorage.setItem(`nabh_pressure_area_${patient._id}`, JSON.stringify(payload));
      setHistory(newHistory);
      clearDraft();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      toast.error("Save failed: " + (err.response?.data?.message || err.message) + " — your draft is preserved, please retry.");
    } finally {
      setSaving(false);
    }
  };

  if (!patient) {
    return (
      <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", height:400, color:C.muted }}>
        <i className="pi pi-shield" style={{ fontSize:48, marginBottom:16, opacity:.3 }} />
        <div style={{ fontSize:16, fontWeight:600 }}>No patient selected</div>
        <div style={{ fontSize:13, marginTop:6 }}>Search or select a patient to begin Pressure Area Care Assessment</div>
      </div>
    );
  }

  const displayRisk = allAnswered ? getBradenRisk(totalScore) : null;

  return (
    <div style={{ padding:"20px 24px", fontFamily:"'DM Sans',sans-serif", background:C.bg, minHeight:"100vh" }}>
      <PageHeader
        icon="pi-shield"
        title="Pressure Area Care"
        subtitle="Braden Scale — NABH Compliant Pressure Injury Risk Assessment"
        gradient="linear-gradient(135deg,#7c3aed,#6d28d9)"
        right={
          <span style={{ background:"rgba(255,255,255,.2)", color:"#fff", fontSize:11, fontWeight:700, padding:"4px 12px", borderRadius:8 }}>
            NABH COP.10
          </span>
        }
      />

      <Section title="Braden Scale Scoring" icon="pi-list" color={C.purple}>
        <div style={{ display:"grid", gap:14 }}>
          {BRADEN_SCALES.map(scale => (
            <div key={scale.key} style={{ background:"#f8fafc", borderRadius:10, padding:"14px 16px", border:`1.5px solid ${C.border}` }}>
              <div style={{ display:"flex", alignItems:"baseline", gap:8, marginBottom:6 }}>
                <span style={{ fontSize:13, fontWeight:700, color:C.text }}>{scale.label}</span>
                <span style={{ fontSize:11, color:C.muted }}>{scale.desc}</span>
              </div>
              <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                {scale.options.map(opt => {
                  const selected = scores[scale.key] === opt.value;
                  return (
                    <button key={opt.value} onClick={() => { setScores(prev => ({...prev,[scale.key]:opt.value})); setSaved(false); }}
                      style={{
                        padding:"6px 14px", borderRadius:8, fontSize:12, fontWeight:600, cursor:"pointer",
                        border:`2px solid ${selected ? C.purple : C.border}`,
                        background: selected ? C.purpleL : "#fff",
                        color: selected ? C.purple : C.muted, transition:"all .15s",
                      }}>
                      {opt.label} <span style={{ opacity:.7 }}>({opt.value})</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </Section>

      {allAnswered && (
        <Section title="Risk Level & Care Plan" icon="pi-chart-bar" color={displayRisk.color}>
          <div style={{ display:"flex", alignItems:"flex-start", gap:24, flexWrap:"wrap" }}>
            <ScoreBadge score={totalScore} max={23} label={displayRisk.level} bg={displayRisk.bg} color={displayRisk.color} />
            <div style={{ flex:1, minWidth:220, background:displayRisk.bg, border:`2px solid ${displayRisk.color}`, borderRadius:12, padding:"14px 18px" }}>
              <div style={{ fontSize:12, fontWeight:700, color:displayRisk.color, marginBottom:10, textTransform:"uppercase", letterSpacing:".5px" }}>Prevention Care Plan</div>
              <ul style={{ margin:0, paddingLeft:18, display:"flex", flexDirection:"column", gap:5 }}>
                {carePlan.map((item,i) => <li key={i} style={{ fontSize:12, color:C.slate, lineHeight:1.5 }}>{item}</li>)}
              </ul>
            </div>
          </div>
        </Section>
      )}

      {/* R7em-1: NABH HIC.4 — existing pressure ulcer surveillance. These
          fields flow to PressureUlcerRegisterModel; HAPU stage III+ is a
          sentinel event. Stage/site/size/dressing reveal only when an ulcer
          is actually present; hospitalAcquired stays visible as a separate
          checkbox so post-admission skin breakdown is captured even before
          the nurse has staged it. */}
      <Section title="Existing Pressure Ulcer" icon="pi-exclamation-circle" color={C.red}>
        <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
          <label style={{ display:"flex", alignItems:"center", gap:10, cursor:"pointer" }}>
            <input
              type="checkbox"
              checked={ulcerPresent}
              onChange={e => { setUlcerPresent(e.target.checked); setSaved(false); }}
              style={{ width:18, height:18, cursor:"pointer", accentColor:C.red }}
            />
            <span style={{ fontSize:13, fontWeight:700, color:C.text }}>
              Pressure ulcer present at this assessment
            </span>
          </label>

          <label style={{ display:"flex", alignItems:"center", gap:10, cursor:"pointer" }}>
            <input
              type="checkbox"
              checked={hospitalAcquired}
              onChange={e => { setHospitalAcquired(e.target.checked); setSaved(false); }}
              style={{ width:18, height:18, cursor:"pointer", accentColor:C.orange }}
            />
            <span style={{ fontSize:13, fontWeight:700, color:C.text }}>
              Hospital-acquired (HAPU)
              <span style={{ fontSize:11, fontWeight:500, color:C.muted, marginLeft:6 }}>
                — Stage III+ HAPU is a NABH sentinel event
              </span>
            </span>
          </label>

          {ulcerPresent && (
            <div style={{ background:C.redL, border:`1.5px solid ${C.redB}`, borderRadius:10, padding:"14px 16px" }}>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))", gap:12 }}>
                <Field label="Stage (NPUAP)">
                  <select className="his-select" value={ulcerStage} onChange={e => { setUlcerStage(e.target.value); setSaved(false); }}>
                    <option value="">Select stage</option>
                    {ULCER_STAGES.map(s => <option key={s} value={s}>Stage {s}</option>)}
                  </select>
                </Field>
                <Field label="Site / Location">
                  <select className="his-select" value={ulcerSite} onChange={e => { setUlcerSite(e.target.value); setSaved(false); }}>
                    <option value="">Select site</option>
                    {ULCER_SITES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </Field>
                <Field label="Size (L × W × D cm)">
                  <input
                    className="his-field"
                    value={ulcerSize}
                    onChange={e => { setUlcerSize(e.target.value); setSaved(false); }}
                    placeholder="e.g. 3 × 2 × 0.5"
                  />
                </Field>
                <Field label="Dressing Type">
                  <select className="his-select" value={dressingType} onChange={e => { setDressingType(e.target.value); setSaved(false); }}>
                    <option value="">Select dressing</option>
                    {DRESSING_TYPES.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </Field>
              </div>
            </div>
          )}
        </div>
      </Section>

      <Section title="Body Map — Pressure Points" icon="pi-map-marker" color={C.blue}>
        <div style={{ fontSize:12, color:C.muted, marginBottom:12 }}>Click a site to mark it as "At Risk". Unmarked = Intact.</div>
        <div style={{ display:"flex", flexWrap:"wrap", gap:10 }}>
          {PRESSURE_POINTS.map(pt => {
            const atRisk = !!pressurePoints[pt];
            return (
              <button key={pt} onClick={() => togglePoint(pt)}
                style={{
                  padding:"8px 14px", borderRadius:8, fontSize:12, fontWeight:600, cursor:"pointer",
                  border:`2px solid ${atRisk ? C.red : C.border}`,
                  background: atRisk ? C.redL : "#fff",
                  color: atRisk ? C.red : C.muted, transition:"all .15s",
                }}>
                <i className={`pi ${atRisk ? "pi-times-circle" : "pi-check-circle"}`} style={{ marginRight:6 }} />
                {pt}
                <span style={{ marginLeft:6, fontSize:10, fontWeight:700 }}>{atRisk ? "AT RISK" : "Intact"}</span>
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="Wound Care Log" icon="pi-pencil" color={C.amber}>
        <div style={{ marginBottom:12 }}>
          <button onClick={addWoundRow}
            style={{ padding:"7px 16px", borderRadius:8, border:`1.5px solid ${C.amber}`, background:C.amberL, color:C.amber, fontWeight:700, fontSize:12, cursor:"pointer", display:"flex", alignItems:"center", gap:6 }}>
            <i className="pi pi-plus" /> Add Wound Entry
          </button>
        </div>
        {woundLog.length === 0 && <div style={{ fontSize:13, color:C.muted, textAlign:"center", padding:"20px 0" }}>No wound entries yet.</div>}
        {woundLog.map(row => (
          <div key={row.id} style={{ background:"#f8fafc", border:`1.5px solid ${C.border}`, borderRadius:10, padding:"14px 16px", marginBottom:12 }}>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))", gap:10 }}>
              <Field label="Date"><input type="date" className="his-field" value={row.date} onChange={e=>updateWound(row.id,"date",e.target.value)} /></Field>
              <Field label="Site / Location"><input className="his-field" value={row.site} onChange={e=>updateWound(row.id,"site",e.target.value)} placeholder="e.g. Sacrum" /></Field>
              <Field label="Stage / Grade">
                <select className="his-select" value={row.stage} onChange={e=>updateWound(row.id,"stage",e.target.value)}>
                  <option value="">Select</option>
                  {["Stage 1","Stage 2","Stage 3","Stage 4","Unstageable","Deep Tissue"].map(s=><option key={s}>{s}</option>)}
                </select>
              </Field>
              <Field label="Size (cm)"><input className="his-field" value={row.size} onChange={e=>updateWound(row.id,"size",e.target.value)} placeholder="L x W x D" /></Field>
              <Field label="Wound Bed">
                <select className="his-select" value={row.woundBed} onChange={e=>updateWound(row.id,"woundBed",e.target.value)}>
                  <option value="">Select</option>
                  {["Granulating","Sloughy","Necrotic","Epithelialising","Mixed"].map(s=><option key={s}>{s}</option>)}
                </select>
              </Field>
              <Field label="Exudate">
                <select className="his-select" value={row.exudate} onChange={e=>updateWound(row.id,"exudate",e.target.value)}>
                  <option value="">Select</option>
                  {["None","Scant","Moderate","Heavy","Serous","Purulent","Sanguineous"].map(s=><option key={s}>{s}</option>)}
                </select>
              </Field>
              <Field label="Treatment" style={{ gridColumn:"span 2" }}>
                <input className="his-field" value={row.treatment} onChange={e=>updateWound(row.id,"treatment",e.target.value)} placeholder="Dressing type, medications applied" />
              </Field>
              <Field label="Nurse Signature"><input className="his-field" value={row.nurse} onChange={e=>updateWound(row.id,"nurse",e.target.value)} placeholder="Name & designation" /></Field>
            </div>
            <button onClick={()=>removeWound(row.id)} style={{ marginTop:8, padding:"4px 12px", borderRadius:6, border:`1px solid ${C.red}`, background:C.redL, color:C.red, fontSize:11, cursor:"pointer" }}>
              <i className="pi pi-trash" style={{ marginRight:4 }} />Remove
            </button>
          </div>
        ))}
      </Section>

      <div style={{ display:"flex", gap:12, alignItems:"center", marginBottom:24, flexWrap:"wrap" }}>
        <button onClick={handleSave} disabled={saving || !allAnswered}
          style={{
            padding:"10px 28px", borderRadius:10, border:"none", cursor:(!allAnswered||saving)?"not-allowed":"pointer",
            background: saved ? `linear-gradient(135deg,${C.green},#15803d)` : `linear-gradient(135deg,${C.purple},#6d28d9)`,
            color:"#fff", fontWeight:700, fontSize:13, display:"flex", alignItems:"center", gap:8,
            opacity:(!allAnswered||saving)?.65:1, transition:"all .2s",
          }}>
          <i className={`pi ${saved?"pi-check":saving?"pi-spin pi-spinner":"pi-save"}`} />
          {saved?"Saved!":saving?"Saving…":"Save Assessment"}
        </button>
        <AutoSaveIndicator savedAt={savedAt} hasDraft={hasDraft} />
        <button onClick={() => setShowSetup(true)} style={{ padding:"8px 14px", background: signature ? "#f0fdf4" : "#fffbeb", border:`1.5px solid ${signature ? "#bbf7d0" : "#fde68a"}`, borderRadius:8, cursor:"pointer", fontSize:11, fontWeight:700, color: signature ? "#16a34a" : "#92400e", display:"flex", alignItems:"center", gap:5 }}>
          {signature ? <><i className="pi pi-verified" /> Signature Set</> : <><i className="pi pi-pen-to-square" /> Setup Signature</>}
        </button>
        {!allAnswered && <span style={{ fontSize:11, color:C.muted }}>Complete all 6 Braden subscales to save.</span>}
      </div>

      {history.length > 0 && (
        <Section title="Assessment History" icon="pi-history" color={C.blue} defaultOpen={false}>
          <div style={{ overflowX:"auto" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
              <thead>
                <tr style={{ background:"#f8fafc" }}>
                  {["Date","Score","Risk Level"].map(h=>(
                    <th key={h} style={{ padding:"8px 12px", textAlign:"left", fontWeight:700, color:C.muted, borderBottom:`1px solid ${C.border}` }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.map((row,i) => {
                  const r = getBradenRisk(row.score);
                  return (
                    <tr key={i} style={{ borderBottom:`1px solid ${C.border}` }}>
                      <td style={{ padding:"8px 12px", color:C.text }}>{new Date(row.date).toLocaleString()}</td>
                      <td style={{ padding:"8px 12px", fontWeight:700, color:r.color }}>{row.score}</td>
                      <td style={{ padding:"8px 12px" }}>
                        <span style={{ background:r.bg, color:r.color, padding:"2px 8px", borderRadius:6, fontWeight:700, fontSize:11 }}>{row.risk}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>
      )}
      {showSetup && (
        <SignaturePad
          existing={signature}
          onSave={async (dataUrl) => { await saveSignature(dataUrl); setShowSetup(false); }}
          onCancel={() => setShowSetup(false)}
        />
      )}
    </div>
  );
}

export default function PressureAreaCarePage() {
  const [patient, setPatient] = useState(null);
  return (
    <ClinicalLayout onPatientSelect={setPatient} selectedId={patient?._id} pageType="pressure-area">
      <PressureAreaContent patient={patient} />
    </ClinicalLayout>
  );
}
