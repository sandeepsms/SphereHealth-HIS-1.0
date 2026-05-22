/**
 * NutritionalAssessmentPage.jsx
 * NABH-Compliant NRS-2002 Nutritional Risk Screening + Anthropometric Data
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

function calcBMI(h, w) {
  const hm = parseFloat(h)/100;
  const wk = parseFloat(w);
  if (!hm || !wk || hm<=0) return null;
  return (wk/(hm*hm)).toFixed(1);
}

function calcIBW(h) {
  const hcm = parseFloat(h);
  if (!hcm) return null;
  return (hcm - 100).toFixed(1);
}

function calcPUBW(w, usual) {
  const wk = parseFloat(w), uw = parseFloat(usual);
  if (!wk || !uw) return null;
  return ((wk/uw)*100).toFixed(1);
}

function NutritionalContent({ patient }) {
  const { user } = useAuth();
  const [form, setForm] = useState(defaultForm);
  const [history, setHistory] = useState([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const draftKey = patient?._id ? `sphere_draft_nutrition_${patient._id}` : null;
  const { savedAt, hasDraft, clearDraft } = useAutoSave(draftKey, { form }, 2000);
  const { signature, showSetup, setShowSetup, saveSignature } = useDigitalSignature();

  useEffect(() => {
    if (!patient) return;
    const stored = localStorage.getItem(`nabh_nutrition_${patient._id}`);
    if (stored) {
      try {
        const data = JSON.parse(stored);
        setHistory(data.history || []);
      } catch {}
    }
    // Restore auto-save draft
    const dKey = `sphere_draft_nutrition_${patient._id}`;
    try {
      const raw = localStorage.getItem(dKey);
      if (raw) {
        const { form: df } = JSON.parse(raw);
        if (df) setForm(f => ({ ...f, ...df }));
      }
    } catch {}
  }, [patient]);

  const setF = (field, val) => { setForm(prev=>({...prev,[field]:val})); setSaved(false); };
  const setPrescreen = (key, val) => { setForm(prev=>({...prev,prescreen:{...prev.prescreen,[key]:val}})); setSaved(false); };

  const anyYes = Object.values(form.prescreen).some(v=>v==="yes");
  const bmi = calcBMI(form.height, form.weight);
  const ibw = calcIBW(form.height);
  const pubw = calcPUBW(form.weight, form.usualWeight);

  let totalScore = 0;
  if (form.nutriStatus!==null) totalScore += form.nutriStatus;
  if (form.diseaseSeverity!==null) totalScore += form.diseaseSeverity;
  if (form.ageOver70) totalScore += 1;

  const atRisk = totalScore >= 3;
  const riskColor = atRisk ? C.red : C.green;
  const riskBg = atRisk ? C.redL : C.greenL;

  const toggleDietType = (type) => {
    setForm(prev => ({
      ...prev,
      dietType: prev.dietType.includes(type) ? prev.dietType.filter(t=>t!==type) : [...prev.dietType, type],
    }));
    setSaved(false);
  };

  const handleSave = async () => {
    if (!patient) return;
    // R7az-D5-CRIT-1 — POST first, only clearDraft + setSaved on 2xx.
    setSaving(true);
    const entry = { date: new Date().toISOString(), ...form, totalScore, atRisk, bmi };
    try {
      await axios.post(`${API}/nursing-assessments/nutrition`, {
        patientId: patient._id, ...entry,
        nurseName: user?.fullName || `${user?.firstName || ""} ${user?.lastName || ""}`.trim(),
        nurseEmployeeId: user?.employeeId || "",
        nurseSignature: signature || undefined,
      });
      const newHistory = [entry, ...history];
      localStorage.setItem(`nabh_nutrition_${patient._id}`, JSON.stringify({ history: newHistory }));
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
        <i className="pi pi-chart-pie" style={{ fontSize:48, marginBottom:16, opacity:.3 }} />
        <div style={{ fontSize:16, fontWeight:600 }}>No patient selected</div>
        <div style={{ fontSize:13, marginTop:6 }}>Search or select a patient to begin Nutritional Risk Screening</div>
      </div>
    );
  }

  return (
    <div style={{ padding:"20px 24px", fontFamily:"'DM Sans',sans-serif", background:C.bg, minHeight:"100vh" }}>
      <PageHeader
        icon="pi-apple"
        title="Nutritional Assessment"
        subtitle="NRS-2002 Nutritional Risk Screening — NABH Compliant"
        gradient="linear-gradient(135deg,#16a34a,#15803d)"
        right={
          <span style={{ background:"rgba(255,255,255,.2)", color:"#fff", fontSize:11, fontWeight:700, padding:"4px 12px", borderRadius:8 }}>
            NABH COP.8
          </span>
        }
      />

      <Section title="Step 1: Pre-Screening" icon="pi-question-circle" color={C.blue} badge="Initial Screen">
        <div style={{ fontSize:12, color:C.muted, marginBottom:14 }}>Answer YES or NO to each question. If any YES → proceed to full NRS-2002 scoring.</div>
        <div style={{ display:"grid", gap:12 }}>
          {PRESCREENING.map(q => (
            <div key={q.key} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", background:"#f8fafc", borderRadius:10, padding:"12px 16px", border:`1.5px solid ${C.border}` }}>
              <span style={{ fontSize:13, fontWeight:600, color:C.text }}>{q.label}</span>
              <div style={{ display:"flex", gap:8 }}>
                {["yes","no"].map(opt => {
                  const sel = form.prescreen[q.key]===opt;
                  const color = opt==="yes"?C.red:C.green;
                  return (
                    <button key={opt} onClick={()=>setPrescreen(q.key,opt)}
                      style={{ padding:"5px 16px", borderRadius:8, border:`2px solid ${sel?color:C.border}`, background:sel?color+"18":"#fff", color:sel?color:C.muted, fontWeight:700, fontSize:12, cursor:"pointer", textTransform:"uppercase" }}>
                      {opt}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        {!anyYes && Object.values(form.prescreen).filter(v=>v!=="").length===4 && (
          <div style={{ marginTop:12, background:C.greenL, border:`1.5px solid ${C.green}`, borderRadius:10, padding:"12px 16px", fontSize:13, color:C.green, fontWeight:600 }}>
            <i className="pi pi-check-circle" style={{ marginRight:8 }} />All pre-screening answers are NO. Patient is not at nutritional risk at this time. Reassess weekly.
          </div>
        )}
        {anyYes && (
          <div style={{ marginTop:12, background:C.amberL, border:`1.5px solid ${C.amber}`, borderRadius:10, padding:"12px 16px", fontSize:13, color:C.amber, fontWeight:600 }}>
            <i className="pi pi-exclamation-triangle" style={{ marginRight:8 }} />One or more YES answers — proceed to full NRS-2002 scoring below.
          </div>
        )}
      </Section>

      <Section title="Step 2: NRS-2002 Full Scoring" icon="pi-calculator" color={C.purple} defaultOpen={anyYes}>
        <div style={{ display:"grid", gap:14, marginBottom:16 }}>
          <div>
            <div style={{ fontSize:12, fontWeight:700, color:C.muted, marginBottom:8, textTransform:"uppercase", letterSpacing:".5px" }}>Nutritional Status Impairment (0–3)</div>
            <div style={{ display:"grid", gap:8 }}>
              {NUTRI_STATUS.map(opt => (
                <button key={opt.value} onClick={()=>{ setF("nutriStatus",opt.value); setSaved(false); }}
                  style={{ padding:"10px 14px", borderRadius:10, border:`2px solid ${form.nutriStatus===opt.value?C.purple:C.border}`, background:form.nutriStatus===opt.value?C.purpleL:"#fff", textAlign:"left", cursor:"pointer", transition:"all .15s" }}>
                  <span style={{ fontWeight:700, fontSize:13, color:form.nutriStatus===opt.value?C.purple:C.text }}>Score {opt.value}: {opt.label}</span>
                  <span style={{ fontSize:11, color:C.muted, marginLeft:8 }}>{opt.desc}</span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontSize:12, fontWeight:700, color:C.muted, marginBottom:8, textTransform:"uppercase", letterSpacing:".5px" }}>Disease Severity (0–3)</div>
            <div style={{ display:"grid", gap:8 }}>
              {DISEASE_SEVERITY.map(opt => (
                <button key={opt.value} onClick={()=>{ setF("diseaseSeverity",opt.value); setSaved(false); }}
                  style={{ padding:"10px 14px", borderRadius:10, border:`2px solid ${form.diseaseSeverity===opt.value?C.blue:C.border}`, background:form.diseaseSeverity===opt.value?C.blueL:"#fff", textAlign:"left", cursor:"pointer", transition:"all .15s" }}>
                  <span style={{ fontWeight:700, fontSize:13, color:form.diseaseSeverity===opt.value?C.blue:C.text }}>Score {opt.value}: {opt.label}</span>
                  <span style={{ fontSize:11, color:C.muted, marginLeft:8 }}>{opt.desc}</span>
                </button>
              ))}
            </div>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:12, background:"#f8fafc", borderRadius:10, padding:"12px 16px", border:`1.5px solid ${C.border}` }}>
            <input type="checkbox" id="ageOver70" checked={form.ageOver70} onChange={e=>{setF("ageOver70",e.target.checked); setSaved(false);}}
              style={{ width:18, height:18, cursor:"pointer" }} />
            <label htmlFor="ageOver70" style={{ fontSize:13, fontWeight:600, color:C.text, cursor:"pointer" }}>
              Age ≥ 70 years (add 1 point)
            </label>
          </div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:20, background:riskBg, border:`2px solid ${riskColor}`, borderRadius:12, padding:"14px 20px" }}>
          <ScoreBadge score={totalScore} max={7} label={atRisk?"At Risk":"No Risk"} bg={riskBg} color={riskColor} />
          <div>
            <div style={{ fontSize:14, fontWeight:800, color:riskColor }}>
              {atRisk ? "⚠ Nutritional Risk Identified (Score ≥ 3)" : "No Immediate Nutritional Risk (Score < 3)"}
            </div>
            <div style={{ fontSize:12, color:C.muted, marginTop:4 }}>
              {atRisk ? "Refer to dietitian. Initiate nutritional support plan." : "Reassess weekly or if clinical condition changes."}
            </div>
          </div>
        </div>
      </Section>

      <Section title="Anthropometric Data" icon="pi-chart-bar" color={C.primary}>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))", gap:12 }}>
          <Field label="Height (cm)"><input type="number" className="his-field" value={form.height} onChange={e=>setF("height",e.target.value)} placeholder="e.g. 165" /></Field>
          <Field label="Weight (kg)"><input type="number" className="his-field" value={form.weight} onChange={e=>setF("weight",e.target.value)} placeholder="e.g. 70" /></Field>
          <Field label="Usual Weight (kg)"><input type="number" className="his-field" value={form.usualWeight} onChange={e=>setF("usualWeight",e.target.value)} placeholder="e.g. 75" /></Field>
          <Field label="BMI (auto)">
            <div style={{ ...fld, background:"#f8fafc", color: bmi ? (parseFloat(bmi)<18.5||parseFloat(bmi)>30 ? C.red : C.green) : C.muted, fontWeight:700 }}>
              {bmi ? `${bmi} kg/m²` : "—"}
            </div>
          </Field>
          <Field label="Ideal Body Wt (kg)">
            <div style={{ ...fld, background:"#f8fafc", color:C.muted }}>{ibw ? `${ibw} kg` : "—"}</div>
          </Field>
          <Field label="% Usual Body Wt">
            <div style={{ ...fld, background:"#f8fafc", color: pubw ? (parseFloat(pubw)<85?C.red:C.green) : C.muted, fontWeight:700 }}>
              {pubw ? `${pubw}%` : "—"}
            </div>
          </Field>
        </div>
      </Section>

      <Section title="Dietary History & Intake" icon="pi-inbox" color={C.amber}>
        <div style={{ display:"grid", gap:14 }}>
          <Field label="Current Diet Type">
            <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
              {DIET_TYPES.map(type => {
                const sel = form.dietType.includes(type);
                return (
                  <button key={type} onClick={()=>toggleDietType(type)}
                    style={{ padding:"5px 14px", borderRadius:8, fontSize:12, fontWeight:600, cursor:"pointer", border:`2px solid ${sel?C.amber:C.border}`, background:sel?C.amberL:"#fff", color:sel?C.amber:C.muted, transition:"all .15s" }}>
                    {type}
                  </button>
                );
              })}
            </div>
          </Field>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
            <Field label="Appetite">
              <select className="his-select" value={form.appetite} onChange={e=>setF("appetite",e.target.value)}>
                <option value="">Select</option>
                {["Good","Fair","Poor","None"].map(v=><option key={v}>{v}</option>)}
              </select>
            </Field>
            <Field label="Swallowing Ability">
              <select className="his-select" value={form.swallowing} onChange={e=>setF("swallowing",e.target.value)}>
                <option value="">Select</option>
                {["Normal","Mild Difficulty","Moderate Difficulty","Unable to Swallow"].map(v=><option key={v}>{v}</option>)}
              </select>
            </Field>
          </div>
        </div>
      </Section>

      <Section title="Dietitian Referral & Plan" icon="pi-user-plus" color={C.primary}>
        <div style={{ display:"grid", gap:14 }}>
          <div style={{ display:"flex", alignItems:"center", gap:12, background:"#f8fafc", borderRadius:10, padding:"12px 16px", border:`1.5px solid ${C.border}` }}>
            <input type="checkbox" id="dietRef" checked={form.dietitianReferral} onChange={e=>setF("dietitianReferral",e.target.checked)}
              style={{ width:18, height:18, cursor:"pointer" }} />
            <label htmlFor="dietRef" style={{ fontSize:13, fontWeight:600, color:C.text, cursor:"pointer" }}>Dietitian Referral Made</label>
          </div>
          {form.dietitianReferral && (
            <Field label="Referral Date">
              <input type="date" className="his-field" value={form.referralDate} onChange={e=>setF("referralDate",e.target.value)} />
            </Field>
          )}
          <Field label="Nutritional Plan / Interventions">
            <textarea className="his-textarea" value={form.nutritionPlan} onChange={e=>setF("nutritionPlan",e.target.value)}
              placeholder="Document nutritional support plan, goals, supplements, monitoring frequency…" />
          </Field>
        </div>
        <div style={{ marginTop:16, display:"flex", gap:12, alignItems:"center", flexWrap:"wrap" }}>
          <button onClick={handleSave} disabled={saving}
            style={{
              padding:"10px 28px", borderRadius:10, border:"none", cursor:saving?"not-allowed":"pointer",
              background: saved?`linear-gradient(135deg,${C.green},#15803d)`:`linear-gradient(135deg,${C.primary},#0d9488)`,
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
      </Section>

      {history.length > 0 && (
        <Section title="Assessment History" icon="pi-history" color={C.blue} defaultOpen={false}>
          <div style={{ overflowX:"auto" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
              <thead>
                <tr style={{ background:"#f8fafc" }}>
                  {["Date","NRS Score","At Risk","BMI","Dietitian Referral"].map(h=>(
                    <th key={h} style={{ padding:"8px 12px", textAlign:"left", fontWeight:700, color:C.muted, borderBottom:`1px solid ${C.border}` }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.map((row,i)=>(
                  <tr key={i} style={{ borderBottom:`1px solid ${C.border}` }}>
                    <td style={{ padding:"8px 12px", color:C.text }}>{new Date(row.date).toLocaleString()}</td>
                    <td style={{ padding:"8px 12px", fontWeight:700, color:row.atRisk?C.red:C.green }}>{row.totalScore}</td>
                    <td style={{ padding:"8px 12px" }}>
                      <span style={{ background:row.atRisk?C.redL:C.greenL, color:row.atRisk?C.red:C.green, padding:"2px 8px", borderRadius:6, fontWeight:700, fontSize:11 }}>{row.atRisk?"YES":"NO"}</span>
                    </td>
                    <td style={{ padding:"8px 12px", color:C.muted }}>{row.bmi||"—"}</td>
                    <td style={{ padding:"8px 12px", color:C.muted }}>{row.dietitianReferral?"Yes":"No"}</td>
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

export default function NutritionalAssessmentPage() {
  const [patient, setPatient] = useState(null);
  return (
    <ClinicalLayout onPatientSelect={setPatient} selectedId={patient?._id} pageType="nutrition">
      <NutritionalContent patient={patient} />
    </ClinicalLayout>
  );
}
