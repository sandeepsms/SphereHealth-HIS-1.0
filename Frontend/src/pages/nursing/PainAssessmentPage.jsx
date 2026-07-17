/**
 * PainAssessmentPage.jsx
 * NABH-Compliant Comprehensive Pain Assessment
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
};

function Section({ title, icon, color=C.primary, badge, children, defaultOpen=true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ background:C.card, border:`1.5px solid ${C.border}`, borderRadius:14, marginBottom:16, overflow:"hidden", boxShadow:"0 1px 2px rgba(16,24,40,.04), 0 4px 12px rgba(16,24,40,.06)" }}>
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

const PAIN_COLORS = ["#16a34a","#22c55e","#84cc16","#a3e635","#facc15","#fbbf24","#f97316","#ef4444","#dc2626","#b91c1c","#991b1b"];

const LOCATIONS = ["Head","Neck","Chest","Abdomen","Back","Upper Limb (R)","Upper Limb (L)","Lower Limb (R)","Lower Limb (L)","Generalized"];
const CHARACTERS = ["Aching","Burning","Stabbing","Throbbing","Shooting","Cramping","Pressure","Tingling","Dull","Sharp"];
const IMPACTS = ["Sleep","Appetite","Mobility","Daily Activities"];
const IMPACT_OPTIONS = ["None","Mild","Moderate","Severe"];

const emptyReassessRow = () => ({
  id: Date.now(), time: new Date().toTimeString().slice(0,5),
  score:"", intervention:"", reassessScore:"", nurse:"",
});

const defaultForm = {
  nrsScore: 5, location:[], character:[], duration:"", onset:"", frequency:"",
  aggravating:"", relieving:"",
  impactSleep:"None", impactAppetite:"None", impactMobility:"None", impactDaily:"None",
  analgesicDrug:"", analgesicDose:"", analgesicRoute:"", analgesicLastGiven:"",
};

function NRSSelector({ value, onChange }) {
  return (
    <div>
      <div style={{ display:"flex", gap:4, marginBottom:8 }}>
        {Array.from({length:11},(_,i)=>(
          <button key={i} onClick={()=>onChange(i)}
            style={{
              flex:1, padding:"10px 0", borderRadius:8, border:`2px solid ${i===value?"#0f172a":PAIN_COLORS[i]+"60"}`,
              background: i===value ? PAIN_COLORS[i] : PAIN_COLORS[i]+"25",
              color: i===value ? "#fff" : C.text, fontWeight:800, fontSize:14, cursor:"pointer",
              transition:"all .15s",
            }}>{i}</button>
        ))}
      </div>
      <div style={{ textAlign:"center", marginTop:4 }}>
        <span style={{
          fontSize:32, fontWeight:900, color: PAIN_COLORS[value],
          background: PAIN_COLORS[value]+"18", padding:"8px 28px", borderRadius:12,
          display:"inline-block", lineHeight:1,
        }}>{value}</span>
        <div style={{ fontSize:12, color:C.muted, marginTop:6 }}>
          {value===0?"No Pain":value<=3?"Mild Pain":value<=6?"Moderate Pain":value<=8?"Severe Pain":"Worst Possible Pain"}
          {value<=3 && value>0 && " — Target: ≤ 3 ✓"}
          {value>3 && <span style={{ color:C.red }}> — Target: ≤ 3</span>}
        </div>
      </div>
    </div>
  );
}

function PillSelect({ options, value=[], onChange, color=C.primary }) {
  const toggle = (opt) => {
    onChange(value.includes(opt) ? value.filter(v=>v!==opt) : [...value, opt]);
  };
  return (
    <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
      {options.map(opt => {
        const sel = value.includes(opt);
        return (
          <button key={opt} onClick={()=>toggle(opt)}
            style={{
              padding:"6px 14px", borderRadius:20, fontSize:12, fontWeight:600, cursor:"pointer",
              border:`2px solid ${sel?color:C.border}`,
              background:sel?color+"18":"#fff",
              color:sel?color:C.muted, transition:"all .15s",
            }}>{opt}</button>
        );
      })}
    </div>
  );
}

function PainContent({ patient }) {
  const { user } = useAuth();
  const [form, setForm] = useState(defaultForm);
  const [reassessLog, setReassessLog] = useState([]);
  const [history, setHistory] = useState([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const draftKey = patient?._id ? `sphere_draft_pain_${patient._id}` : null;
  const { savedAt, hasDraft, clearDraft } = useAutoSave(draftKey, { form, reassessLog }, 2000);
  const { signature, showSetup, setShowSetup, saveSignature } = useDigitalSignature();

  useEffect(() => {
    if (!patient) return;
    const stored = sessionStorage.getItem(`nabh_pain_${patient._id}`);
    if (stored) {
      try {
        const data = JSON.parse(stored);
        setHistory(data.history || []);
        setReassessLog(data.reassessLog || []);
      } catch {}
    }
    // Restore auto-save draft
    const dKey = `sphere_draft_pain_${patient._id}`;
    try {
      const raw = localStorage.getItem(dKey);
      if (raw) {
        const { form: df, reassessLog: dr } = JSON.parse(raw);
        if (df) setForm(f => ({ ...f, ...df }));
        if (dr) setReassessLog(dr);
      }
    } catch {}
  }, [patient]);

  const set = (field, val) => { setForm(prev=>({...prev,[field]:val})); setSaved(false); };

  const addReassessRow = () => setReassessLog(prev=>[...prev, emptyReassessRow()]);
  const updateReassess = (id, field, val) => setReassessLog(prev=>prev.map(r=>r.id===id?{...r,[field]:val}:r));
  const removeReassess = (id) => setReassessLog(prev=>prev.filter(r=>r.id!==id));

  const handleSave = async () => {
    if (!patient) return;
    // R7az-D5-CRIT-1 — POST first, only clearDraft + setSaved on 2xx.
    // Pre-fix the silent catch let a network failure leave the nurse
    // thinking the assessment was saved server-side while it lived only
    // on her laptop's localStorage.
    setSaving(true);
    const entry = { date: new Date().toISOString(), ...form, reassessLog: [...reassessLog] };
    try {
      await axios.post(`${API}/nursing-assessments/pain`, {
        patientId: patient._id,
        UHID: patient.UHID,
        admissionId: patient.currentAdmissionId || patient.admissionId,
        patientName: patient.fullName || patient.name,
        ...entry,
        nurseName: user?.fullName || `${user?.firstName || ""} ${user?.lastName || ""}`.trim(),
        nurseEmployeeId: user?.employeeId || "",
        nurseSignature: signature || undefined,
      });
      const newHistory = [entry, ...history];
      sessionStorage.setItem(`nabh_pain_${patient._id}`, JSON.stringify({ history: newHistory, reassessLog }));
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
        <i className="pi pi-heart" style={{ fontSize:48, marginBottom:16, opacity:.3 }} />
        <div style={{ fontSize:16, fontWeight:600 }}>No patient selected</div>
        <div style={{ fontSize:13, marginTop:6 }}>Search or select a patient to begin Pain Assessment</div>
      </div>
    );
  }

  return (
    <div style={{ padding:"20px 24px", fontFamily:"'DM Sans',sans-serif", background:C.bg, minHeight:"100vh" }}>
      <PageHeader
        icon="pi-heart-fill"
        title="Pain Assessment"
        subtitle="Comprehensive NRS Pain Assessment — NABH Compliant"
        gradient="linear-gradient(135deg,#ea580c,#c2410c)"
        right={
          <div style={{ textAlign:"right" }}>
            <div style={{ background:"rgba(255,255,255,.2)", color:"#fff", fontSize:11, fontWeight:700, padding:"4px 12px", borderRadius:8 }}>NABH COP.7</div>
            <div style={{ color:"rgba(255,255,255,.8)", fontSize:10, marginTop:4 }}>Target: Pain Score ≤ 3</div>
          </div>
        }
      />

      <Section title="NRS Pain Scale (0–10)" icon="pi-chart-line" color={C.orange}>
        <NRSSelector value={form.nrsScore} onChange={v=>set("nrsScore",v)} />
      </Section>

      <Section title="Pain Characteristics" icon="pi-info-circle" color={C.blue}>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
          <Field label="Pain Location" style={{ gridColumn:"span 2" }}>
            <PillSelect options={LOCATIONS} value={form.location} onChange={v=>set("location",v)} color={C.blue} />
          </Field>
          <Field label="Pain Character" style={{ gridColumn:"span 2" }}>
            <PillSelect options={CHARACTERS} value={form.character} onChange={v=>set("character",v)} color={C.orange} />
          </Field>
          <Field label="Duration">
            <input className="his-field" value={form.duration} onChange={e=>set("duration",e.target.value)} placeholder="e.g. 2 days, 3 hours" />
          </Field>
          <Field label="Onset">
            <select className="his-select" value={form.onset} onChange={e=>set("onset",e.target.value)}>
              <option value="">Select</option>
              <option>Sudden</option><option>Gradual</option>
            </select>
          </Field>
          <Field label="Frequency">
            <select className="his-select" value={form.frequency} onChange={e=>set("frequency",e.target.value)}>
              <option value="">Select</option>
              <option>Constant</option><option>Intermittent</option><option>Episodic</option>
            </select>
          </Field>
          <Field label="Aggravating Factors">
            <input className="his-field" value={form.aggravating} onChange={e=>set("aggravating",e.target.value)} placeholder="e.g. Movement, coughing" />
          </Field>
          <Field label="Relieving Factors">
            <input className="his-field" value={form.relieving} onChange={e=>set("relieving",e.target.value)} placeholder="e.g. Rest, medication, heat" />
          </Field>
        </div>
      </Section>

      <Section title="Impact Assessment" icon="pi-users" color={C.purple}>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))", gap:14 }}>
          {IMPACTS.map(impact => {
            const key = `impact${impact.replace(/\s/g,"")}`;
            return (
              <Field key={impact} label={`Impact on ${impact}`}>
                <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                  {IMPACT_OPTIONS.map(opt => {
                    const selected = form[key] === opt;
                    const col = opt==="None"?C.green:opt==="Mild"?C.amber:opt==="Moderate"?C.orange:C.red;
                    return (
                      <button key={opt} onClick={()=>set(key,opt)}
                        style={{
                          padding:"5px 10px", borderRadius:6, fontSize:11, fontWeight:600, cursor:"pointer",
                          border:`2px solid ${selected?col:C.border}`,
                          background:selected?col+"18":"#fff", color:selected?col:C.muted,
                        }}>{opt}</button>
                    );
                  })}
                </div>
              </Field>
            );
          })}
        </div>
      </Section>

      <Section title="Current Analgesic" icon="pi-tablet" color={C.primary}>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))", gap:12 }}>
          <Field label="Drug Name"><input className="his-field" value={form.analgesicDrug} onChange={e=>set("analgesicDrug",e.target.value)} placeholder="e.g. Paracetamol" /></Field>
          <Field label="Dose"><input className="his-field" value={form.analgesicDose} onChange={e=>set("analgesicDose",e.target.value)} placeholder="e.g. 500mg" /></Field>
          <Field label="Route">
            <select className="his-select" value={form.analgesicRoute} onChange={e=>set("analgesicRoute",e.target.value)}>
              <option value="">Select</option>
              {["Oral","IV","IM","SC","Topical","PR","Sublingual","Transdermal"].map(r=><option key={r}>{r}</option>)}
            </select>
          </Field>
          <Field label="Last Given">
            <input type="datetime-local" className="his-field" value={form.analgesicLastGiven} onChange={e=>set("analgesicLastGiven",e.target.value)} />
          </Field>
        </div>
      </Section>

      <Section title="Reassessment Log" icon="pi-refresh" color={C.amber}>
        <div style={{ marginBottom:12 }}>
          <button onClick={addReassessRow}
            style={{ padding:"7px 16px", borderRadius:8, border:`1.5px solid ${C.amber}`, background:C.amberL, color:C.amber, fontWeight:700, fontSize:12, cursor:"pointer", display:"flex", alignItems:"center", gap:6 }}>
            <i className="pi pi-plus" /> Add Reassessment Entry
          </button>
        </div>
        {reassessLog.length===0 && <div style={{ fontSize:13, color:C.muted, textAlign:"center", padding:"16px 0" }}>No reassessment entries yet.</div>}
        {reassessLog.map(row=>(
          <div key={row.id} style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))", gap:10, background:"#f8fafc", borderRadius:10, padding:"12px 14px", marginBottom:10, border:`1.5px solid ${C.border}` }}>
            <Field label="Time"><input type="time" className="his-field" value={row.time} onChange={e=>updateReassess(row.id,"time",e.target.value)} /></Field>
            <Field label="Pain Score">
              <select className="his-select" value={row.score} onChange={e=>updateReassess(row.id,"score",e.target.value)}>
                <option value="">-</option>
                {Array.from({length:11},(_,i)=><option key={i} value={i}>{i}</option>)}
              </select>
            </Field>
            <Field label="Intervention" style={{ gridColumn:"span 2" }}>
              <input className="his-field" value={row.intervention} onChange={e=>updateReassess(row.id,"intervention",e.target.value)} placeholder="e.g. Analgesic given, repositioned" />
            </Field>
            <Field label="Post-intervention Score">
              <select className="his-select" value={row.reassessScore} onChange={e=>updateReassess(row.id,"reassessScore",e.target.value)}>
                <option value="">-</option>
                {Array.from({length:11},(_,i)=><option key={i} value={i}>{i}</option>)}
              </select>
            </Field>
            <Field label="Nurse"><input className="his-field" value={row.nurse} onChange={e=>updateReassess(row.id,"nurse",e.target.value)} placeholder="Name" /></Field>
            <div style={{ display:"flex", alignItems:"flex-end" }}>
              <button onClick={()=>removeReassess(row.id)} style={{ padding:"6px 12px", borderRadius:6, border:`1px solid ${C.red}`, background:C.redL, color:C.red, fontSize:11, cursor:"pointer" }}>
                <i className="pi pi-trash" />
              </button>
            </div>
          </div>
        ))}
      </Section>

      <div style={{ display:"flex", gap:12, alignItems:"center", marginBottom:24, flexWrap:"wrap" }}>
        <button onClick={handleSave} disabled={saving}
          style={{
            padding:"10px 28px", borderRadius:10, border:"none", cursor:saving?"not-allowed":"pointer",
            background: saved?`linear-gradient(135deg,${C.green},#15803d)`:`linear-gradient(135deg,${C.orange},#c2410c)`,
            color:"#fff", fontWeight:700, fontSize:13, display:"flex", alignItems:"center", gap:8,
            opacity:saving?.65:1, transition:"all .2s",
          }}>
          <i className={`pi ${saved?"pi-check":saving?"pi-spin pi-spinner":"pi-save"}`} />
          {saved?"Saved!":saving?"Saving…":"Save Assessment"}
        </button>
        <AutoSaveIndicator savedAt={savedAt} hasDraft={hasDraft} />
        <button onClick={() => setShowSetup(true)} style={{ padding:"8px 14px", background: signature ? "#f0fdf4" : "#fffbeb", border:`1.5px solid ${signature ? "#bbf7d0" : "#fde68a"}`, borderRadius:8, cursor:"pointer", fontSize:11, fontWeight:700, color: signature ? "#16a34a" : "#92400e", display:"flex", alignItems:"center", gap:5 }}>
          {signature ? <><i className="pi pi-verified" /> Signature Set</> : <><i className="pi pi-pen-to-square" /> Setup Signature</>}
        </button>
      </div>

      {history.length > 0 && (
        <Section title="Assessment History" icon="pi-history" color={C.blue} defaultOpen={false}>
          <div style={{ overflowX:"auto" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
              <thead>
                <tr style={{ background:"#f8fafc" }}>
                  {["Date & Time","NRS Score","Location","Character","Analgesic"].map(h=>(
                    <th key={h} style={{ padding:"8px 12px", textAlign:"left", fontWeight:700, color:C.muted, borderBottom:`1px solid ${C.border}` }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.map((row,i)=>(
                  <tr key={i} style={{ borderBottom:`1px solid ${C.border}` }}>
                    <td style={{ padding:"8px 12px", color:C.text }}>{new Date(row.date).toLocaleString()}</td>
                    <td style={{ padding:"8px 12px" }}>
                      <span style={{ background:PAIN_COLORS[row.nrsScore]+"25", color:PAIN_COLORS[row.nrsScore], fontWeight:700, padding:"2px 10px", borderRadius:6, fontSize:13 }}>{row.nrsScore}</span>
                    </td>
                    <td style={{ padding:"8px 12px", color:C.muted }}>{(row.location||[]).join(", ")||"—"}</td>
                    <td style={{ padding:"8px 12px", color:C.muted }}>{(row.character||[]).join(", ")||"—"}</td>
                    <td style={{ padding:"8px 12px", color:C.muted }}>{row.analgesicDrug||"—"}</td>
                  </tr>
                ))}
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

export default function PainAssessmentPage() {
  const [patient, setPatient] = useState(null);
  return (
    <ClinicalLayout onPatientSelect={setPatient} selectedId={patient?._id} pageType="pain-assessment">
      {/* R9-FIX(R9-109): key on patient id so the form REMOUNTS (all useState
          reset) on patient switch — the #47 fix, applied to this twin.
          ClinicalLayout renders children keyless, so without this the prior
          patient's pain score/site/analgesic bled into the next patient. */}
      <PainContent key={patient?._id || "no-patient"} patient={patient} />
    </ClinicalLayout>
  );
}
