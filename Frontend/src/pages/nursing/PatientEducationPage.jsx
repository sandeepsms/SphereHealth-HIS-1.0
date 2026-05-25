/**
 * PatientEducationPage.jsx
 * NABH-Compliant Patient & Family Education Record
 */

import React, { useState, useEffect, useCallback } from "react";
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
  blue: "#1d4ed8", blueL: "#eff6ff", blueB: "#bfdbfe",
  purple: "#7c3aed", purpleL: "#f5f3ff",
  slate: "#1e293b", pink: "#be185d",
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

const TOPIC_CATEGORIES = [
  "Disease Process","Medications","Diet & Nutrition","Exercise / Activity","Wound Care",
  "Pain Management","Fall Prevention","Infection Control","Discharge Instructions",
  "Follow-up Care","Warning Signs","Home Safety","Device / Equipment Use",
];

const EDUCATORS = ["Nurse","Doctor","Dietitian","Physiotherapist","Social Worker","Pharmacist","Other"];
const TEACHING_METHODS = ["Verbal","Written Material","Demonstration","Audio / Visual","Return Demonstration","Pamphlet / Leaflet"];
const UNDERSTANDING = ["Understood Well","Partial Understanding","Did Not Understand","Needs Reinforcement"];
const BARRIERS = ["None","Language Barrier","Cultural Beliefs","Physical Limitation","Cognitive Impairment","Anxiety / Fear","Low Literacy","Hearing Impairment","Visual Impairment"];
const RESPONSES = ["Receptive","Neutral","Resistant","Questions Asked","Verbal Agreement","Written Consent"];

const emptySession = () => ({
  id: Date.now(),
  date: new Date().toISOString().slice(0,10),
  time: new Date().toTimeString().slice(0,5),
  educator: "",
  topics: [],
  methods: [],
  language: "",
  understanding: "",
  barriers: [],
  response: "",
  furtherNeeded: "No",
  furtherNeeds: "",
  signature: "",
});

function PillMultiSelect({ options, value=[], onChange, color=C.primary }) {
  const toggle = (opt) => onChange(value.includes(opt) ? value.filter(v=>v!==opt) : [...value, opt]);
  return (
    <div style={{ display:"flex", flexWrap:"wrap", gap:7 }}>
      {options.map(opt => {
        const sel = value.includes(opt);
        return (
          <button key={opt} onClick={()=>toggle(opt)}
            style={{
              padding:"5px 12px", borderRadius:20, fontSize:11, fontWeight:600, cursor:"pointer",
              border:`1.5px solid ${sel?color:C.border}`,
              background:sel?color+"18":"#fff", color:sel?color:C.muted, transition:"all .15s",
            }}>{opt}</button>
        );
      })}
    </div>
  );
}

function RadioRow({ options, value, onChange, color=C.primary }) {
  return (
    <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
      {options.map(opt => {
        const sel = value === opt;
        return (
          <button key={opt} onClick={()=>onChange(opt)}
            style={{
              padding:"5px 12px", borderRadius:8, fontSize:12, fontWeight:600, cursor:"pointer",
              border:`2px solid ${sel?color:C.border}`, background:sel?color+"18":"#fff",
              color:sel?color:C.muted, transition:"all .15s",
            }}>{opt}</button>
        );
      })}
    </div>
  );
}

function EducationSessionCard({ session, idx, onChange, onRemove }) {
  const s = session;
  const set = (field, val) => onChange({ ...s, [field]: val });

  const understandingColor = s.understanding==="Understood Well"?C.green
    :s.understanding==="Partial Understanding"?C.amber
    :s.understanding==="Did Not Understand"?C.red:C.blue;

  return (
    <div style={{ background:C.card, border:`2px solid ${C.border}`, borderRadius:14, padding:"18px 20px", marginBottom:16, boxShadow:"0 2px 8px rgba(0,0,0,.05)" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ width:32, height:32, borderRadius:10, background:C.primary+"18", display:"flex", alignItems:"center", justifyContent:"center" }}>
            <span style={{ fontWeight:800, color:C.primary, fontSize:14 }}>{idx+1}</span>
          </div>
          <div>
            <div style={{ fontWeight:700, fontSize:13, color:C.text }}>Education Session {idx+1}</div>
            <div style={{ fontSize:11, color:C.muted }}>{s.date} · {s.time}</div>
          </div>
        </div>
        <button onClick={onRemove}
          style={{ padding:"5px 12px", borderRadius:8, border:`1px solid ${C.red}`, background:C.redL, color:C.red, fontSize:11, cursor:"pointer", fontWeight:600 }}>
          <i className="pi pi-trash" style={{ marginRight:4 }} />Remove
        </button>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:12, marginBottom:14 }}>
        <Field label="Date"><input type="date" className="his-field" value={s.date} onChange={e=>set("date",e.target.value)} /></Field>
        <Field label="Time"><input type="time" className="his-field" value={s.time} onChange={e=>set("time",e.target.value)} /></Field>
        <Field label="Educator">
          <select className="his-select" value={s.educator} onChange={e=>set("educator",e.target.value)}>
            <option value="">Select Educator</option>
            {EDUCATORS.map(v=><option key={v}>{v}</option>)}
          </select>
        </Field>
      </div>

      <div style={{ display:"grid", gap:12, marginBottom:14 }}>
        <Field label="Topics Covered">
          <PillMultiSelect options={TOPIC_CATEGORIES} value={s.topics} onChange={v=>set("topics",v)} color={C.primary} />
        </Field>
        <Field label="Teaching Method Used">
          <PillMultiSelect options={TEACHING_METHODS} value={s.methods} onChange={v=>set("methods",v)} color={C.blue} />
        </Field>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:14 }}>
        <Field label="Language Used">
          <input className="his-field" value={s.language} onChange={e=>set("language",e.target.value)} placeholder="e.g. English, Hindi, Tamil" />
        </Field>
        <Field label="Patient Understanding">
          <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
            {UNDERSTANDING.map(opt => {
              const isSel = s.understanding===opt;
              const col = opt==="Understood Well"?C.green:opt==="Partial Understanding"?C.amber:opt==="Did Not Understand"?C.red:C.blue;
              return (
                <button key={opt} onClick={()=>set("understanding",opt)}
                  style={{ padding:"5px 12px", borderRadius:8, fontSize:11, fontWeight:600, cursor:"pointer", border:`2px solid ${isSel?col:C.border}`, background:isSel?col+"18":"#fff", color:isSel?col:C.muted, transition:"all .15s" }}>
                  {opt}
                </button>
              );
            })}
          </div>
        </Field>
      </div>

      <div style={{ display:"grid", gap:12, marginBottom:14 }}>
        <Field label="Barriers to Learning">
          <PillMultiSelect options={BARRIERS} value={s.barriers} onChange={v=>set("barriers",v)} color={C.amber} />
        </Field>
        <Field label="Patient / Family Response">
          <RadioRow options={RESPONSES} value={s.response} onChange={v=>set("response",v)} color={C.purple} />
        </Field>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:14 }}>
        <Field label="Further Education Needed?">
          <RadioRow options={["Yes","No"]} value={s.furtherNeeded} onChange={v=>set("furtherNeeded",v)} color={C.primary} />
        </Field>
        {s.furtherNeeded==="Yes" && (
          <Field label="Specific Needs">
            <input className="his-field" value={s.furtherNeeds} onChange={e=>set("furtherNeeds",e.target.value)} placeholder="Describe specific education needs" />
          </Field>
        )}
      </div>

      <Field label="Educator Signature">
        <input className="his-field" value={s.signature} onChange={e=>set("signature",e.target.value)} placeholder="Name, designation, date" />
      </Field>

      {s.understanding && (
        <div style={{ marginTop:14, background:understandingColor+"10", border:`1.5px solid ${understandingColor}30`, borderRadius:10, padding:"10px 14px", display:"flex", alignItems:"center", gap:8 }}>
          <i className={`pi ${s.understanding==="Understood Well"?"pi-check-circle":"pi-info-circle"}`} style={{ color:understandingColor, fontSize:14 }} />
          <span style={{ fontSize:12, color:understandingColor, fontWeight:600 }}>Understanding Level: {s.understanding}</span>
          {s.furtherNeeded==="Yes" && <span style={{ fontSize:11, color:C.amber, fontWeight:600, marginLeft:8 }}>— Follow-up required</span>}
        </div>
      )}
    </div>
  );
}

function PatientEducationContent({ patient }) {
  const { user } = useAuth();
  const [sessions, setSessions] = useState([]);
  const [savedSessions, setSavedSessions] = useState([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const draftKey = patient?._id ? `sphere_draft_education_${patient._id}` : null;
  const { savedAt, hasDraft, loadDraft, clearDraft } = useAutoSave(draftKey, { sessions }, 2000);
  const { signature, showSetup, setShowSetup, saveSignature } = useDigitalSignature();

  useEffect(() => {
    if (!patient) return;
    const stored = sessionStorage.getItem(`nabh_patient_education_${patient._id}`);
    if (stored) {
      try {
        const data = JSON.parse(stored);
        setSavedSessions(data.sessions || []);
      } catch {}
    }
    // Restore auto-save draft if available
    const draft = loadDraft();
    if (draft?.data?.sessions?.length) {
      setSessions(draft.data.sessions);
    }
  }, [patient]); // eslint-disable-line react-hooks/exhaustive-deps

  const addSession = () => setSessions(prev=>[...prev, emptySession()]);

  const updateSession = useCallback((id, updated) => {
    setSessions(prev => prev.map(s => s.id===id ? updated : s));
  }, []);

  const removeSession = useCallback((id) => {
    setSessions(prev => prev.filter(s => s.id!==id));
  }, []);

  const handleSave = async () => {
    if (!patient || sessions.length===0) return;
    // R7az-D5-CRIT-1 — POST first, only clearDraft + setSaved on 2xx.
    setSaving(true);
    const newSessions = [...sessions.map(s => ({ ...s, savedAt: new Date().toISOString() })), ...savedSessions];
    try {
      await axios.post(`${API}/nursing-assessments/education`, {
        patientId: patient._id,
        sessions: newSessions.slice(0, sessions.length),
        nurseName: user?.fullName || `${user?.firstName || ""} ${user?.lastName || ""}`.trim(),
        nurseEmployeeId: user?.employeeId || "",
        nurseSignature: signature || undefined,
      });
      sessionStorage.setItem(`nabh_patient_education_${patient._id}`, JSON.stringify({ sessions: newSessions }));
      setSavedSessions(newSessions);
      setSessions([]);
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
        <i className="pi pi-book" style={{ fontSize:48, marginBottom:16, opacity:.3 }} />
        <div style={{ fontSize:16, fontWeight:600 }}>No patient selected</div>
        <div style={{ fontSize:13, marginTop:6 }}>Search or select a patient to begin Patient & Family Education</div>
      </div>
    );
  }

  const understandingStats = savedSessions.reduce((acc, s) => {
    if (s.understanding) acc[s.understanding] = (acc[s.understanding]||0)+1;
    return acc;
  }, {});

  return (
    <div style={{ padding:"20px 24px", fontFamily:"'DM Sans',sans-serif", background:C.bg, minHeight:"100vh" }}>
      <PageHeader
        icon="pi-book"
        title="Patient & Family Education"
        subtitle="NABH Education Record — COP.4 / COP.5 Compliant"
        gradient="linear-gradient(135deg,#7c3aed,#6d28d9)"
        right={
          <div style={{ textAlign:"right" }}>
            <div style={{ background:"rgba(255,255,255,.2)", color:"#fff", fontSize:11, fontWeight:700, padding:"4px 12px", borderRadius:8, marginBottom:4 }}>NABH COP.4 / COP.5</div>
            <div style={{ color:"rgba(255,255,255,.8)", fontSize:10 }}>{savedSessions.length} session(s) recorded</div>
          </div>
        }
      />

      {/* Stats bar */}
      {savedSessions.length > 0 && (
        <div style={{ display:"flex", gap:12, marginBottom:16, flexWrap:"wrap" }}>
          {Object.entries(understandingStats).map(([level,count])=>{
            const col = level==="Understood Well"?C.green:level==="Partial Understanding"?C.amber:level==="Did Not Understand"?C.red:C.blue;
            return (
              <div key={level} style={{ background:col+"12", border:`1.5px solid ${col}30`, borderRadius:10, padding:"8px 16px", display:"flex", alignItems:"center", gap:8 }}>
                <span style={{ fontSize:18, fontWeight:900, color:col }}>{count}</span>
                <span style={{ fontSize:11, color:col, fontWeight:600 }}>{level}</span>
              </div>
            );
          })}
          <div style={{ background:C.primaryL, border:`1.5px solid ${C.primary}30`, borderRadius:10, padding:"8px 16px", display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ fontSize:18, fontWeight:900, color:C.primary }}>{savedSessions.filter(s=>s.furtherNeeded==="Yes").length}</span>
            <span style={{ fontSize:11, color:C.primary, fontWeight:600 }}>Need Follow-up</span>
          </div>
        </div>
      )}

      {/* New Sessions */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
        <div style={{ fontWeight:700, fontSize:14, color:C.text }}>
          New Education Session{sessions.length>0?` (${sessions.length} pending)`:""}</div>
        <button onClick={addSession}
          style={{ padding:"8px 18px", borderRadius:10, border:`1.5px solid ${C.primary}`, background:C.primaryL, color:C.primary, fontWeight:700, fontSize:12, cursor:"pointer", display:"flex", alignItems:"center", gap:6 }}>
          <i className="pi pi-plus" /> Add Session
        </button>
      </div>

      {sessions.length===0 && savedSessions.length===0 && (
        <div style={{ background:C.card, border:`2px dashed ${C.border}`, borderRadius:14, padding:"40px 24px", textAlign:"center", marginBottom:16 }}>
          <i className="pi pi-book" style={{ fontSize:36, color:C.muted, opacity:.4, marginBottom:12 }} />
          <div style={{ fontSize:14, color:C.muted, fontWeight:600 }}>No education sessions yet</div>
          <div style={{ fontSize:12, color:C.muted, marginTop:6 }}>Click "Add Session" to record a patient or family education session</div>
        </div>
      )}

      {sessions.map((s, i) => (
        <EducationSessionCard
          key={s.id}
          session={s}
          idx={i}
          onChange={(updated) => updateSession(s.id, updated)}
          onRemove={() => removeSession(s.id)}
        />
      ))}

      {sessions.length > 0 && (
        <div style={{ display:"flex", gap:12, alignItems:"center", marginBottom:24, flexWrap:"wrap", justifyContent:"space-between" }}>
          <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
            <AutoSaveIndicator savedAt={savedAt} hasDraft={hasDraft} />
            <button onClick={() => setShowSetup(true)}
              style={{ padding:"7px 12px", background: signature ? "#f0fdf4" : "#fffbeb", border:`1.5px solid ${signature ? "#bbf7d0" : "#fde68a"}`, borderRadius:8, cursor:"pointer", fontSize:11, fontWeight:700, color: signature ? "#16a34a" : "#92400e", display:"flex", alignItems:"center", gap:5 }}>
              {signature ? <><i className="pi pi-verified" /> Signature Set</> : <><i className="pi pi-pen-to-square" /> Setup Signature</>}
            </button>
          </div>
          <div style={{ display:"flex", gap:10, alignItems:"center" }}>
            <button onClick={handleSave} disabled={saving}
              style={{
                padding:"10px 28px", borderRadius:10, border:"none", cursor:saving?"not-allowed":"pointer",
                background: saved?`linear-gradient(135deg,${C.green},#15803d)`:`linear-gradient(135deg,${C.purple},#6d28d9)`,
                color:"#fff", fontWeight:700, fontSize:13, display:"flex", alignItems:"center", gap:8,
                opacity:saving?.65:1, transition:"all .2s",
              }}>
              <i className={`pi ${saved?"pi-check":saving?"pi-spin pi-spinner":"pi-save"}`} />
              {saved?"Sessions Saved!":saving?"Saving…":`Save ${sessions.length} Session(s)`}
            </button>
            <span style={{ fontSize:11, color:C.muted }}>Sessions will be added to the summary table below</span>
          </div>
        </div>
      )}

      {/* Session Summary Table */}
      {savedSessions.length > 0 && (
        <Section title="Education Sessions Summary" icon="pi-table" color={C.primary} defaultOpen>
          <div style={{ overflowX:"auto" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
              <thead>
                <tr style={{ background:"#f8fafc" }}>
                  {["#","Date","Time","Educator","Topics","Method","Understanding","Barriers","Response","Follow-up","Signature"].map(h=>(
                    <th key={h} style={{ padding:"8px 10px", textAlign:"left", fontWeight:700, color:C.muted, borderBottom:`1px solid ${C.border}`, whiteSpace:"nowrap", fontSize:11 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {savedSessions.map((s, i) => {
                  const uCol = s.understanding==="Understood Well"?C.green:s.understanding==="Partial Understanding"?C.amber:s.understanding==="Did Not Understand"?C.red:C.blue;
                  return (
                    <tr key={i} style={{ borderBottom:`1px solid ${C.border}`, verticalAlign:"top" }}>
                      <td style={{ padding:"8px 10px", color:C.muted, fontWeight:700 }}>{savedSessions.length-i}</td>
                      <td style={{ padding:"8px 10px", color:C.text, whiteSpace:"nowrap" }}>{s.date}</td>
                      <td style={{ padding:"8px 10px", color:C.muted }}>{s.time}</td>
                      <td style={{ padding:"8px 10px", color:C.text }}>{s.educator||"—"}</td>
                      <td style={{ padding:"8px 10px", color:C.muted, maxWidth:160 }}>
                        <div style={{ display:"flex", flexWrap:"wrap", gap:3 }}>
                          {(s.topics||[]).slice(0,3).map(t=>(
                            <span key={t} style={{ background:C.primaryL, color:C.primary, fontSize:10, padding:"1px 6px", borderRadius:4, fontWeight:600 }}>{t}</span>
                          ))}
                          {s.topics?.length>3 && <span style={{ fontSize:10, color:C.muted }}>+{s.topics.length-3}</span>}
                        </div>
                      </td>
                      <td style={{ padding:"8px 10px", color:C.muted }}>{(s.methods||[]).join(", ")||"—"}</td>
                      <td style={{ padding:"8px 10px" }}>
                        {s.understanding ? (
                          <span style={{ background:uCol+"18", color:uCol, padding:"2px 8px", borderRadius:6, fontWeight:700, fontSize:10, whiteSpace:"nowrap" }}>{s.understanding}</span>
                        ) : "—"}
                      </td>
                      <td style={{ padding:"8px 10px", color:C.muted }}>{(s.barriers||[]).filter(b=>b!=="None").join(", ")||"None"}</td>
                      <td style={{ padding:"8px 10px", color:C.muted }}>{s.response||"—"}</td>
                      <td style={{ padding:"8px 10px" }}>
                        <span style={{ background:s.furtherNeeded==="Yes"?C.amberL:C.greenL, color:s.furtherNeeded==="Yes"?C.amber:C.green, padding:"2px 8px", borderRadius:6, fontWeight:700, fontSize:10 }}>
                          {s.furtherNeeded==="Yes"?"YES":"NO"}
                        </span>
                      </td>
                      <td style={{ padding:"8px 10px", color:C.muted, fontSize:11 }}>{s.signature||"—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* NABH Compliance Note */}
      <div style={{ background:"linear-gradient(135deg,#7c3aed12,#6d28d912)", border:`1.5px solid #7c3aed30`, borderRadius:14, padding:"16px 20px", display:"flex", gap:14, alignItems:"flex-start" }}>
        <div style={{ width:36, height:36, borderRadius:10, background:C.purple+"18", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
          <i className="pi pi-verified" style={{ color:C.purple, fontSize:16 }} />
        </div>
        <div>
          <div style={{ fontWeight:700, fontSize:13, color:C.purple, marginBottom:6 }}>NABH Compliance — COP.4 / COP.5 Patient Education Standards</div>
          <div style={{ fontSize:12, color:C.muted, lineHeight:1.6 }}>
            This record satisfies NABH requirements for patient and family education documentation. Education must be tailored to patient literacy, language, and learning capacity.
            Barriers to learning must be identified and addressed. All sessions must be signed by the educator.
            Effectiveness of education must be assessed and re-education provided where understanding is incomplete.
          </div>
          <div style={{ display:"flex", gap:8, marginTop:10, flexWrap:"wrap" }}>
            {["Patient involvement","Family education","Multi-disciplinary approach","Language-appropriate","Assessed for understanding"].map(tag=>(
              <span key={tag} style={{ background:C.purple+"15", color:C.purple, fontSize:10, fontWeight:700, padding:"3px 10px", borderRadius:20 }}>{tag}</span>
            ))}
          </div>
        </div>
      </div>
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

export default function PatientEducationPage() {
  const [patient, setPatient] = useState(null);
  return (
    <ClinicalLayout onPatientSelect={setPatient} selectedId={patient?._id} pageType="patient-education">
      <PatientEducationContent patient={patient} />
    </ClinicalLayout>
  );
}
