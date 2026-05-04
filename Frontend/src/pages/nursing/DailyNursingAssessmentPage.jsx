/**
 * DailyNursingAssessmentPage.jsx
 * NABH-Compliant Daily Nursing Progress Assessment (per shift)
 */

import React, { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API_ENDPOINTS } from "../../config/api";
import { useAuth } from "../../context/AuthContext";
import ClinicalLayout from "../../Components/clinical/ClinicalLayout";
import NurseOrdersPanel from "../../Components/clinical/NurseOrdersPanel";
import { useAutoSave } from "../../hooks/useAutoSave";
import { useDigitalSignature } from "../../hooks/useDigitalSignature";
import AutoSaveIndicator from "../../Components/signature/AutoSaveIndicator";
import SignaturePad from "../../Components/signature/SignaturePad";
import FingerprintConsentModal from "../../Components/clinical/FingerprintConsentModal";

const API = API_ENDPOINTS.BASE;

const C = {
  bg: "#f8fafc", card: "#ffffff", border: "#e2e8f0", text: "#0f172a", muted: "#64748b",
  primary: "#0f766e", primaryL: "#f0fdfa", primaryMid: "#0d9488",
  green: "#16a34a", greenL: "#dcfce7", greenB: "#bbf7d0",
  amber: "#d97706", amberL: "#fffbeb", amberB: "#fde68a",
  red: "#dc2626", redL: "#fef2f2", redB: "#fecaca",
  blue: "#1d4ed8", blueL: "#eff6ff", blueB: "#bfdbfe",
  purple: "#7c3aed", purpleL: "#f5f3ff",
  slate: "#1e293b", pink: "#be185d",
};

const fld = { padding:"9px 12px", border:"1.5px solid #e2e8f0", borderRadius:8, fontFamily:"'DM Sans',sans-serif", fontSize:13, color:"#0f172a", outline:"none", background:"white", width:"100%", boxSizing:"border-box" };
const sel = { ...fld, cursor:"pointer" };
const ta  = { ...fld, resize:"vertical", minHeight:80 };
const lbl = { display:"block", fontSize:11, fontWeight:700, color:"#64748b", textTransform:"uppercase", letterSpacing:".6px", marginBottom:5 };

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
      {label && <label style={lbl}>{label}</label>}
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

const SHIFTS = [
  { id:"morning", label:"Morning Shift", time:"7:00 AM – 3:00 PM", color:C.amber },
  { id:"evening", label:"Evening Shift", time:"3:00 PM – 11:00 PM", color:C.purple },
  { id:"night",   label:"Night Shift",   time:"11:00 PM – 7:00 AM", color:C.blue },
];

const NURSING_INTERVENTIONS = [
  "Wound Dressing","IV Care","Catheter Care","Oral Care","Skin Care / Repositioning",
  "Patient Education","Fall Prevention","Restraint Check","Suctioning",
  "Nebulization","Physiotherapy Assisted","Vital Sign Monitoring","Medication Administration",
  "Fluid Balance Monitoring","Blood Glucose Check",
];

const defaultVitals = { sysBP:"", diasBP:"", pulse:"", tempC:"", tempUnit:"C", spo2:"", rr:"", gcsE:"", gcsV:"", gcsM:"", weight:"", glucose:"" };
const defaultNeuro  = { consciousness:"", orientPerson:false, orientPlace:false, orientTime:false, pupils:"", motorStrength:"" };
const defaultResp   = { breathSounds:"", o2Therapy:"", o2Flow:"", secretions:"", cough:"", sputumColor:"" };
const defaultCardio = { rhythm:"", peripheralPulse:"", edema:"", crt:"", skinColor:"", ivSite:"", ivType:"", ivCondition:"" };
const defaultGI     = { bowelSounds:"", lastBM:"", abdomen:"", nauseaVomiting:"", dietTolerance:"" };
const defaultGU     = { urineOutput:"", urineColor:"", catheter:"", catheterCare:false };
const defaultMusc   = { mobility:"", exercise:"", positionFreq:"", skinIntegrity:"" };
const defaultPsycho = { mood:"", sleepQuality:"", concerns:"" };
const defaultSignOff= { nurseName:"", designation:"", time:new Date().toTimeString().slice(0,5) };

const defaultForm = {
  date: new Date().toISOString().slice(0,10),
  shift: "morning",
  vitals: defaultVitals,
  neuro: defaultNeuro,
  resp: defaultResp,
  cardio: defaultCardio,
  gi: defaultGI,
  gu: defaultGU,
  musc: defaultMusc,
  psycho: defaultPsycho,
  medications: "",
  interventions: [],
  signOff: defaultSignOff,
};

function RadioGroup({ options, value, onChange, color=C.primary }) {
  return (
    <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
      {options.map(opt => {
        const sel = value === opt;
        return (
          <button key={opt} onClick={()=>onChange(opt)}
            style={{ padding:"5px 14px", borderRadius:8, fontSize:12, fontWeight:600, cursor:"pointer", border:`2px solid ${sel?color:C.border}`, background:sel?color+"18":"#fff", color:sel?color:C.muted, transition:"all .15s" }}>
            {opt}
          </button>
        );
      })}
    </div>
  );
}

function Checkbox({ label, checked, onChange }) {
  return (
    <label style={{ display:"flex", alignItems:"center", gap:8, cursor:"pointer", fontSize:13, color:C.text }}>
      <input type="checkbox" checked={checked} onChange={e=>onChange(e.target.checked)} style={{ width:16, height:16 }} />
      {label}
    </label>
  );
}

function DailyNursingContent({ patient }) {
  const { user } = useAuth();
  const [form, setForm] = useState(defaultForm);
  const [entries, setEntries] = useState([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const draftKey = patient?._id ? `sphere_draft_daily_${patient._id}` : null;
  const { savedAt, hasDraft, clearDraft } = useAutoSave(draftKey, { form }, 2000);
  const { signature, showSetup, setShowSetup, saveSignature } = useDigitalSignature();

  useEffect(() => {
    if (!patient) return;
    const stored = localStorage.getItem(`nabh_daily_nursing_${patient._id}`);
    if (stored) {
      try {
        const data = JSON.parse(stored);
        setEntries(data.entries || []);
      } catch {}
    }
    // Restore auto-save draft
    const dKey = `sphere_draft_daily_${patient._id}`;
    try {
      const raw = localStorage.getItem(dKey);
      if (raw) {
        const { form: df } = JSON.parse(raw);
        if (df) setForm(f => ({ ...f, ...df }));
      }
    } catch {}
  }, [patient]);

  // Auto-fill sign-off nurse name from logged-in user
  useEffect(() => {
    if (!user) return;
    const name = user.fullName || `${user.firstName || ""} ${user.lastName || ""}`.trim();
    setForm(prev => ({
      ...prev,
      signOff: { ...prev.signOff, nurseName: prev.signOff.nurseName || name },
    }));
  }, [user]);

  const setSection = useCallback((section, field, val) => {
    setForm(prev => ({ ...prev, [section]: { ...prev[section], [field]: val } }));
    setSaved(false);
  }, []);

  const setTop = useCallback((field, val) => { setForm(prev=>({...prev,[field]:val})); setSaved(false); }, []);

  const gcsTotal = () => {
    const e = parseInt(form.vitals.gcsE)||0;
    const v = parseInt(form.vitals.gcsV)||0;
    const m = parseInt(form.vitals.gcsM)||0;
    const total = e+v+m;
    return total > 0 ? total : null;
  };

  const toggleIntervention = (item) => {
    setForm(prev => ({
      ...prev,
      interventions: prev.interventions.includes(item)
        ? prev.interventions.filter(i=>i!==item)
        : [...prev.interventions, item],
    }));
    setSaved(false);
  };

  const handleSave = async () => {
    if (!patient) return;
    setSaving(true);
    const entry = { ...form, gcsTotal: gcsTotal(), savedAt: new Date().toISOString() };
    const newEntries = [entry, ...entries];
    localStorage.setItem(`nabh_daily_nursing_${patient._id}`, JSON.stringify({ entries:newEntries }));
    setEntries(newEntries);
    try {
      await axios.post(`${API}/nursing-assessments/daily`, {
        patientId: patient._id, ...entry,
        nurseName: entry.signOff?.nurseName || user?.fullName || `${user?.firstName || ""} ${user?.lastName || ""}`.trim(),
        nurseEmployeeId: user?.employeeId || "",
        nurseSignature: signature || undefined,
      });
    } catch {}
    clearDraft();
    setSaving(false); setSaved(true);
    setTimeout(()=>setSaved(false),2500);
  };

  if (!patient) {
    return (
      <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", height:400, color:C.muted }}>
        <i className="pi pi-clipboard" style={{ fontSize:48, marginBottom:16, opacity:.3 }} />
        <div style={{ fontSize:16, fontWeight:600 }}>No patient selected</div>
        <div style={{ fontSize:13, marginTop:6 }}>Search or select a patient to begin Daily Nursing Assessment</div>
      </div>
    );
  }

  const shift = SHIFTS.find(s=>s.id===form.shift);

  return (
    <div style={{ padding:"20px 24px", fontFamily:"'DM Sans',sans-serif", background:C.bg, minHeight:"100vh" }}>
      <PageHeader
        icon="pi-clipboard"
        title="Daily Nursing Assessment"
        subtitle="Shift-wise Progress Assessment — NABH Compliant"
        gradient="linear-gradient(135deg,#1d4ed8,#1e40af)"
        right={
          <span style={{ background:"rgba(255,255,255,.2)", color:"#fff", fontSize:11, fontWeight:700, padding:"4px 12px", borderRadius:8 }}>
            NABH COP.6
          </span>
        }
      />

      {/* Shift Header */}
      <div style={{ background:C.card, border:`1.5px solid ${C.border}`, borderRadius:14, padding:"16px 20px", marginBottom:16, display:"flex", gap:16, alignItems:"center", flexWrap:"wrap" }}>
        <Field label="Assessment Date" style={{ flex:1, minWidth:160 }}>
          <input type="date" style={fld} value={form.date} onChange={e=>setTop("date",e.target.value)} />
        </Field>
        <Field label="Shift" style={{ flex:2, minWidth:300 }}>
          <div style={{ display:"flex", gap:10 }}>
            {SHIFTS.map(s => (
              <button key={s.id} onClick={()=>setTop("shift",s.id)}
                style={{
                  flex:1, padding:"8px 12px", borderRadius:10, border:`2px solid ${form.shift===s.id?s.color:C.border}`,
                  background:form.shift===s.id?s.color+"18":"#fff", color:form.shift===s.id?s.color:C.muted,
                  fontWeight:700, fontSize:12, cursor:"pointer", textAlign:"center", transition:"all .15s",
                }}>
                <div>{s.label}</div>
                <div style={{ fontSize:10, fontWeight:400, marginTop:2 }}>{s.time}</div>
              </button>
            ))}
          </div>
        </Field>
      </div>

      {/* 1. Vital Signs */}
      <Section title="1. Vital Signs" icon="pi-heart" color={C.red}>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))", gap:12 }}>
          <Field label="BP Systolic (mmHg)"><input type="number" style={fld} value={form.vitals.sysBP} onChange={e=>setSection("vitals","sysBP",e.target.value)} placeholder="120" /></Field>
          <Field label="BP Diastolic (mmHg)"><input type="number" style={fld} value={form.vitals.diasBP} onChange={e=>setSection("vitals","diasBP",e.target.value)} placeholder="80" /></Field>
          <Field label="Pulse (bpm)"><input type="number" style={fld} value={form.vitals.pulse} onChange={e=>setSection("vitals","pulse",e.target.value)} placeholder="72" /></Field>
          <Field label={`Temperature (°${form.vitals.tempUnit})`}>
            <div style={{ display:"flex", gap:6 }}>
              <input type="number" step="0.1" style={{...fld,flex:1}} value={form.vitals.tempC} onChange={e=>setSection("vitals","tempC",e.target.value)} placeholder={form.vitals.tempUnit==="C"?"37.0":"98.6"} />
              <button onClick={()=>setSection("vitals","tempUnit",form.vitals.tempUnit==="C"?"F":"C")}
                style={{ padding:"0 10px", borderRadius:8, border:`1.5px solid ${C.border}`, background:"#f8fafc", color:C.muted, fontWeight:700, fontSize:11, cursor:"pointer" }}>
                °{form.vitals.tempUnit==="C"?"F":"C"}
              </button>
            </div>
          </Field>
          <Field label="SpO2 (%)"><input type="number" style={fld} value={form.vitals.spo2} onChange={e=>setSection("vitals","spo2",e.target.value)} placeholder="98" /></Field>
          <Field label="RR (breaths/min)"><input type="number" style={fld} value={form.vitals.rr} onChange={e=>setSection("vitals","rr",e.target.value)} placeholder="16" /></Field>
          <Field label="GCS — Eyes (1-4)">
            <select style={sel} value={form.vitals.gcsE} onChange={e=>setSection("vitals","gcsE",e.target.value)}>
              <option value="">-</option>
              <option value="1">1 – No opening</option><option value="2">2 – To pain</option>
              <option value="3">3 – To voice</option><option value="4">4 – Spontaneous</option>
            </select>
          </Field>
          <Field label="GCS — Verbal (1-5)">
            <select style={sel} value={form.vitals.gcsV} onChange={e=>setSection("vitals","gcsV",e.target.value)}>
              <option value="">-</option>
              <option value="1">1 – None</option><option value="2">2 – Sounds</option>
              <option value="3">3 – Words</option><option value="4">4 – Confused</option><option value="5">5 – Oriented</option>
            </select>
          </Field>
          <Field label="GCS — Motor (1-6)">
            <select style={sel} value={form.vitals.gcsM} onChange={e=>setSection("vitals","gcsM",e.target.value)}>
              <option value="">-</option>
              <option value="1">1 – None</option><option value="2">2 – Extension</option>
              <option value="3">3 – Flexion abnormal</option><option value="4">4 – Flexion withdrawal</option>
              <option value="5">5 – Localises</option><option value="6">6 – Obeys</option>
            </select>
          </Field>
          <Field label="GCS Total">
            <div style={{ ...fld, background:"#f8fafc", fontWeight:700, color: gcsTotal()&&gcsTotal()<8?C.red:gcsTotal()&&gcsTotal()<13?C.amber:C.green }}>
              {gcsTotal() ? `${gcsTotal()} / 15` : "—"}
            </div>
          </Field>
          <Field label="Weight (kg)"><input type="number" step="0.1" style={fld} value={form.vitals.weight} onChange={e=>setSection("vitals","weight",e.target.value)} placeholder="70.0" /></Field>
          <Field label="Blood Glucose (mg/dL)"><input type="number" style={fld} value={form.vitals.glucose} onChange={e=>setSection("vitals","glucose",e.target.value)} placeholder="100" /></Field>
        </div>
      </Section>

      {/* 2. Neurological */}
      <Section title="2. Neurological Assessment" icon="pi-eye" color={C.purple}>
        <div style={{ display:"grid", gap:14 }}>
          <Field label="Level of Consciousness">
            <RadioGroup options={["Alert","Drowsy","Confused","Unresponsive"]} value={form.neuro.consciousness} onChange={v=>setSection("neuro","consciousness",v)} color={C.purple} />
          </Field>
          <Field label="Orientation">
            <div style={{ display:"flex", gap:16 }}>
              <Checkbox label="Person" checked={form.neuro.orientPerson} onChange={v=>setSection("neuro","orientPerson",v)} />
              <Checkbox label="Place"  checked={form.neuro.orientPlace}  onChange={v=>setSection("neuro","orientPlace",v)} />
              <Checkbox label="Time"   checked={form.neuro.orientTime}   onChange={v=>setSection("neuro","orientTime",v)} />
            </div>
          </Field>
          <Field label="Pupils">
            <RadioGroup options={["PEARL","Unequal","Dilated","Pinpoint"]} value={form.neuro.pupils} onChange={v=>setSection("neuro","pupils",v)} color={C.purple} />
          </Field>
          <Field label="Motor Strength">
            <RadioGroup options={["Normal","Weakness","Paralysis"]} value={form.neuro.motorStrength} onChange={v=>setSection("neuro","motorStrength",v)} color={C.purple} />
          </Field>
        </div>
      </Section>

      {/* 3. Respiratory */}
      <Section title="3. Respiratory Assessment" icon="pi-cloud" color={C.blue}>
        <div style={{ display:"grid", gap:12 }}>
          <Field label="Breath Sounds">
            <RadioGroup options={["Clear","Crackles","Wheeze","Absent"]} value={form.resp.breathSounds} onChange={v=>setSection("resp","breathSounds",v)} color={C.blue} />
          </Field>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
            <Field label="O2 Therapy">
              <select style={sel} value={form.resp.o2Therapy} onChange={e=>setSection("resp","o2Therapy",e.target.value)}>
                <option value="">Select</option>
                {["None","Nasal Cannula","Simple Mask","Non-rebreather Mask","Ventilator"].map(v=><option key={v}>{v}</option>)}
              </select>
            </Field>
            <Field label="O2 Flow Rate (L/min)">
              <input type="number" step="0.5" style={fld} value={form.resp.o2Flow} onChange={e=>setSection("resp","o2Flow",e.target.value)} placeholder="2" />
            </Field>
          </div>
          <Field label="Secretions">
            <RadioGroup options={["None","Scant","Moderate","Profuse"]} value={form.resp.secretions} onChange={v=>setSection("resp","secretions",v)} color={C.blue} />
          </Field>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
            <Field label="Cough">
              <RadioGroup options={["None","Non-productive","Productive"]} value={form.resp.cough} onChange={v=>setSection("resp","cough",v)} color={C.blue} />
            </Field>
            <Field label="Sputum Color">
              <input style={fld} value={form.resp.sputumColor} onChange={e=>setSection("resp","sputumColor",e.target.value)} placeholder="e.g. Clear, Yellow, Green, Blood-streaked" />
            </Field>
          </div>
        </div>
      </Section>

      {/* 4. Cardiovascular */}
      <Section title="4. Cardiovascular Assessment" icon="pi-heart-fill" color={C.red}>
        <div style={{ display:"grid", gap:12 }}>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))", gap:12 }}>
            <Field label="Cardiac Rhythm">
              <RadioGroup options={["Regular","Irregular"]} value={form.cardio.rhythm} onChange={v=>setSection("cardio","rhythm",v)} color={C.red} />
            </Field>
            <Field label="Peripheral Pulses">
              <RadioGroup options={["Present","Absent","Weak"]} value={form.cardio.peripheralPulse} onChange={v=>setSection("cardio","peripheralPulse",v)} color={C.red} />
            </Field>
            <Field label="Edema">
              <select style={sel} value={form.cardio.edema} onChange={e=>setSection("cardio","edema",e.target.value)}>
                <option value="">Select</option>
                {["None","1+","2+","3+","4+"].map(v=><option key={v}>{v}</option>)}
              </select>
            </Field>
            <Field label="Capillary Refill (CRT)">
              <RadioGroup options={["< 2 sec","≥ 2 sec"]} value={form.cardio.crt} onChange={v=>setSection("cardio","crt",v)} color={C.red} />
            </Field>
            <Field label="Skin Colour / Colour">
              <input style={fld} value={form.cardio.skinColor} onChange={e=>setSection("cardio","skinColor",e.target.value)} placeholder="e.g. Normal, Pale, Cyanotic, Jaundiced" />
            </Field>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:12 }}>
            <Field label="IV Access Site"><input style={fld} value={form.cardio.ivSite} onChange={e=>setSection("cardio","ivSite",e.target.value)} placeholder="e.g. Right forearm" /></Field>
            <Field label="IV Type"><input style={fld} value={form.cardio.ivType} onChange={e=>setSection("cardio","ivType",e.target.value)} placeholder="e.g. Peripheral, Central" /></Field>
            <Field label="IV Site Condition">
              <select style={sel} value={form.cardio.ivCondition} onChange={e=>setSection("cardio","ivCondition",e.target.value)}>
                <option value="">Select</option>
                {["Patent","Redness","Swelling","Phlebitis","Infiltrated","Not applicable"].map(v=><option key={v}>{v}</option>)}
              </select>
            </Field>
          </div>
        </div>
      </Section>

      {/* 5. Gastrointestinal */}
      <Section title="5. Gastrointestinal Assessment" icon="pi-inbox" color={C.amber}>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))", gap:12 }}>
          <Field label="Bowel Sounds">
            <RadioGroup options={["Present","Absent","Hyperactive"]} value={form.gi.bowelSounds} onChange={v=>setSection("gi","bowelSounds",v)} color={C.amber} />
          </Field>
          <Field label="Last Bowel Movement">
            <input type="date" style={fld} value={form.gi.lastBM} onChange={e=>setSection("gi","lastBM",e.target.value)} />
          </Field>
          <Field label="Abdomen">
            <RadioGroup options={["Soft","Distended","Tender","Rigid"]} value={form.gi.abdomen} onChange={v=>setSection("gi","abdomen",v)} color={C.amber} />
          </Field>
          <Field label="Nausea / Vomiting">
            <RadioGroup options={["None","Nausea only","Vomiting"]} value={form.gi.nauseaVomiting} onChange={v=>setSection("gi","nauseaVomiting",v)} color={C.amber} />
          </Field>
          <Field label="Diet Tolerance">
            <select style={sel} value={form.gi.dietTolerance} onChange={e=>setSection("gi","dietTolerance",e.target.value)}>
              <option value="">Select</option>
              {["Full diet tolerated","Partial","Not tolerated","NPO"].map(v=><option key={v}>{v}</option>)}
            </select>
          </Field>
        </div>
      </Section>

      {/* 6. Genitourinary */}
      <Section title="6. Genitourinary Assessment" icon="pi-tint" color={C.blue}>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))", gap:12 }}>
          <Field label="Urine Output (mL)"><input type="number" style={fld} value={form.gu.urineOutput} onChange={e=>setSection("gu","urineOutput",e.target.value)} placeholder="e.g. 1200" /></Field>
          <Field label="Urine Colour">
            <select style={sel} value={form.gu.urineColor} onChange={e=>setSection("gu","urineColor",e.target.value)}>
              <option value="">Select</option>
              {["Clear","Pale Yellow","Yellow","Dark Yellow","Amber","Blood-stained","Cloudy"].map(v=><option key={v}>{v}</option>)}
            </select>
          </Field>
          <Field label="Catheter In Situ">
            <RadioGroup options={["Yes","No"]} value={form.gu.catheter} onChange={v=>setSection("gu","catheter",v)} color={C.blue} />
          </Field>
          {form.gu.catheter==="Yes" && (
            <Field label="Catheter Care Done">
              <RadioGroup options={["Yes","No"]} value={form.gu.catheterCare?"Yes":"No"} onChange={v=>setSection("gu","catheterCare",v==="Yes")} color={C.blue} />
            </Field>
          )}
        </div>
      </Section>

      {/* 7. Musculoskeletal */}
      <Section title="7. Musculoskeletal & Skin" icon="pi-user" color={C.primary}>
        <div style={{ display:"grid", gap:12 }}>
          <Field label="Mobility">
            <RadioGroup options={["Independent","Assisted","Dependent","Bedbound"]} value={form.musc.mobility} onChange={v=>setSection("musc","mobility",v)} color={C.primary} />
          </Field>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:12 }}>
            <Field label="Exercise Done">
              <RadioGroup options={["Yes","No"]} value={form.musc.exercise} onChange={v=>setSection("musc","exercise",v)} color={C.primary} />
            </Field>
            <Field label="Position Change Frequency">
              <select style={sel} value={form.musc.positionFreq} onChange={e=>setSection("musc","positionFreq",e.target.value)}>
                <option value="">Select</option>
                {["Every 2 hours","Every 4 hours","Patient repositions independently","Not required"].map(v=><option key={v}>{v}</option>)}
              </select>
            </Field>
            <Field label="Skin Integrity">
              <select style={sel} value={form.musc.skinIntegrity} onChange={e=>setSection("musc","skinIntegrity",e.target.value)}>
                <option value="">Select</option>
                {["Intact","Redness","Bruising","Wound Present","Pressure Injury"].map(v=><option key={v}>{v}</option>)}
              </select>
            </Field>
          </div>
        </div>
      </Section>

      {/* 8. Psychosocial */}
      <Section title="8. Psychosocial" icon="pi-comments" color={C.pink}>
        <div style={{ display:"grid", gap:12 }}>
          <Field label="Mood / Affect">
            <RadioGroup options={["Calm","Anxious","Agitated","Depressed","Euphoric"]} value={form.psycho.mood} onChange={v=>setSection("psycho","mood",v)} color={C.pink} />
          </Field>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
            <Field label="Sleep Quality">
              <select style={sel} value={form.psycho.sleepQuality} onChange={e=>setSection("psycho","sleepQuality",e.target.value)}>
                <option value="">Select</option>
                {["Good","Fair","Poor","Unable to sleep"].map(v=><option key={v}>{v}</option>)}
              </select>
            </Field>
            <Field label="Patient / Family Concerns">
              <input style={fld} value={form.psycho.concerns} onChange={e=>setSection("psycho","concerns",e.target.value)} placeholder="Document any concerns raised" />
            </Field>
          </div>
        </div>
      </Section>

      {/* 9. Medications */}
      <Section title="9. Medications Administered" icon="pi-tablet" color={C.purple}>
        <Field label="Medications Given This Shift">
          <textarea style={{...ta,minHeight:100}} value={form.medications} onChange={e=>setTop("medications",e.target.value)}
            placeholder="List medications administered during this shift (drug, dose, route, time, response)…" />
        </Field>
      </Section>

      {/* 10. Nursing Interventions */}
      <Section title="10. Nursing Interventions This Shift" icon="pi-check-square" color={C.green}>
        <div style={{ display:"flex", flexWrap:"wrap", gap:10 }}>
          {NURSING_INTERVENTIONS.map(item => {
            const checked = form.interventions.includes(item);
            return (
              <button key={item} onClick={()=>toggleIntervention(item)}
                style={{
                  padding:"7px 14px", borderRadius:8, fontSize:12, fontWeight:600, cursor:"pointer",
                  border:`2px solid ${checked?C.green:C.border}`,
                  background:checked?C.greenL:"#fff", color:checked?C.green:C.muted, transition:"all .15s",
                  display:"flex", alignItems:"center", gap:6,
                }}>
                <i className={`pi ${checked?"pi-check-circle":"pi-circle"}`} style={{ fontSize:12 }} />
                {item}
              </button>
            );
          })}
        </div>
      </Section>

      {/* 11. Sign-off */}
      <Section title="11. Nurse Sign-off" icon="pi-pen" color={C.slate}>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:12 }}>
          <Field label="Nurse Name"><input style={fld} value={form.signOff.nurseName} onChange={e=>setSection("signOff","nurseName",e.target.value)} placeholder="Full name" /></Field>
          <Field label="Designation"><input style={fld} value={form.signOff.designation} onChange={e=>setSection("signOff","designation",e.target.value)} placeholder="e.g. Staff Nurse, Senior Nurse" /></Field>
          <Field label="Time of Sign-off"><input type="time" style={fld} value={form.signOff.time} onChange={e=>setSection("signOff","time",e.target.value)} /></Field>
        </div>
      </Section>

      <div style={{ display:"flex", gap:12, alignItems:"center", marginBottom:24, flexWrap:"wrap" }}>
        <button onClick={handleSave} disabled={saving}
          style={{
            padding:"10px 28px", borderRadius:10, border:"none", cursor:saving?"not-allowed":"pointer",
            background: saved?`linear-gradient(135deg,${C.green},#15803d)`:`linear-gradient(135deg,${C.blue},#1e40af)`,
            color:"#fff", fontWeight:700, fontSize:13, display:"flex", alignItems:"center", gap:8,
            opacity:saving?.65:1, transition:"all .2s",
          }}>
          <i className={`pi ${saved?"pi-check":saving?"pi-spin pi-spinner":"pi-save"}`} />
          {saved?"Entry Saved!":saving?"Saving…":"Save Shift Assessment"}
        </button>
        <AutoSaveIndicator savedAt={savedAt} hasDraft={hasDraft} />
        <button onClick={() => setShowSetup(true)} style={{ padding:"8px 14px", background: signature ? "#f0fdf4" : "#fffbeb", border:`1.5px solid ${signature ? "#bbf7d0" : "#fde68a"}`, borderRadius:8, cursor:"pointer", fontSize:11, fontWeight:700, color: signature ? "#16a34a" : "#92400e", display:"flex", alignItems:"center", gap:5 }}>
          {signature ? <><i className="pi pi-verified" /> Signature Set</> : <><i className="pi pi-pen-to-square" /> Setup Signature</>}
        </button>
      </div>

      {/* Timeline */}
      {entries.length > 0 && (
        <Section title="Today's Assessment Timeline" icon="pi-history" color={C.blue} defaultOpen>
          <div style={{ display:"grid", gap:12 }}>
            {entries.slice(0,10).map((entry, i) => {
              const s = SHIFTS.find(sh=>sh.id===entry.shift);
              return (
                <div key={i} style={{ background:"#f8fafc", border:`1.5px solid ${C.border}`, borderRadius:10, padding:"12px 16px", display:"flex", gap:16, alignItems:"flex-start" }}>
                  <div style={{ minWidth:60, textAlign:"center" }}>
                    <div style={{ background:s?.color+"18", color:s?.color, padding:"4px 8px", borderRadius:6, fontSize:10, fontWeight:700 }}>{s?.label||entry.shift}</div>
                    <div style={{ fontSize:10, color:C.muted, marginTop:4 }}>{entry.date}</div>
                  </div>
                  <div style={{ flex:1 }}>
                    <div style={{ display:"flex", gap:16, flexWrap:"wrap", fontSize:12, color:C.text }}>
                      {entry.vitals?.sysBP && <span>BP: {entry.vitals.sysBP}/{entry.vitals.diasBP}</span>}
                      {entry.vitals?.pulse && <span>P: {entry.vitals.pulse}bpm</span>}
                      {entry.vitals?.spo2 && <span>SpO2: {entry.vitals.spo2}%</span>}
                      {entry.gcsTotal && <span>GCS: {entry.gcsTotal}</span>}
                    </div>
                    <div style={{ fontSize:11, color:C.muted, marginTop:4 }}>
                      Interventions: {entry.interventions?.join(", ")||"None documented"}
                    </div>
                    <div style={{ fontSize:11, color:C.muted }}>
                      Nurse: {entry.signOff?.nurseName||"—"} | {entry.signOff?.time}
                    </div>
                  </div>
                </div>
              );
            })}
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

export default function DailyNursingAssessmentPage() {
  const [patient, setPatient] = useState(null);
  const [consentModal, setConsentModal] = useState({ open: false, order: null });
  // Incrementing this triggers NurseOrdersPanel to re-fetch orders immediately
  const [ordersRefresh, setOrdersRefresh] = useState(0);

  return (
    <ClinicalLayout onPatientSelect={setPatient} selectedId={patient?._id} pageType="daily-nursing">
      {patient && (
        <NurseOrdersPanel
          UHID={patient.UHID || patient.uhid}
          visitId={patient.currentVisitId || patient.visitNumber}
          onConsentRequest={(order) => setConsentModal({ open: true, order })}
          refreshTrigger={ordersRefresh}
        />
      )}
      <DailyNursingContent patient={patient} />
      <FingerprintConsentModal
        open={consentModal.open}
        onClose={() => setConsentModal({ open: false, order: null })}
        procedure={consentModal.order?.orderDetails}
        patient={patient ? { patientName: patient.patientName || patient.name, UHID: patient.UHID || patient.uhid, age: patient.age, gender: patient.gender } : {}}
        onConfirm={async (consentData) => {
          if (consentModal.order?._id) {
            try {
              await axios.patch(`${API_ENDPOINTS.DOCTOR_ORDERS}/${consentModal.order._id}`, {
                consentStatus: "Obtained",
                "consentData.obtainedAt": consentData.obtainedAt,
                "consentData.obtainedBy": consentData.obtainedBy,
                "consentData.fingerprintHash": consentData.fingerprintHash,
                "consentData.fingerprintVerified": consentData.fingerprintVerified,
                "consentData.witnessName": consentData.witnessName,
                "consentData.guardianName": consentData.guardianName,
                "consentData.guardianRelation": consentData.guardianRelation,
                "consentData.notes": consentData.notes,
              });
              // Re-fetch orders so the consent badge updates immediately
              setOrdersRefresh(n => n + 1);
            } catch (_) {}
          }
          setConsentModal({ open: false, order: null });
        }}
      />
    </ClinicalLayout>
  );
}
