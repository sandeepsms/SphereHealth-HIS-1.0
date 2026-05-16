/**
 * FallRiskAssessmentPage.jsx
 * NABH-Compliant Morse Fall Scale Assessment
 */

import React, { useState, useCallback, useEffect } from "react";
import axios from "axios";
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

const defaultScores = Object.fromEntries(MORSE_ITEMS.map(i => [i.key, null]));

function getRisk(score) {
  if (score < 25) return { level: "No Risk", color: C.green, bg: C.greenL, interventions: INTERVENTIONS.none };
  if (score < 45) return { level: "Low Risk", color: C.amber, bg: C.amberL, interventions: INTERVENTIONS.low };
  return { level: "High Risk", color: C.red, bg: C.redL, interventions: INTERVENTIONS.high };
}

function FallRiskContent({ patient }) {
  const { user } = useAuth();
  const [scores, setScores] = useState(defaultScores);
  const [nurseName, setNurseName] = useState("");
  const [actionsNote, setActionsNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [history, setHistory] = useState([]);

  /* ── Auto-save + signature ── */
  const draftKey = patient?._id ? `sphere_draft_fall_${patient._id}` : null;
  const { savedAt, hasDraft, clearDraft } = useAutoSave(draftKey, { scores, nurseName, actionsNote }, 2000);
  const { signature, showSetup, setShowSetup, saveSignature } = useDigitalSignature();

  // Auto-fill nurse name from logged-in user
  useEffect(() => {
    if (!user) return;
    const name = user.fullName || `${user.firstName || ""} ${user.lastName || ""}`.trim();
    setNurseName(prev => prev || name);
  }, [user]);

  useEffect(() => {
    if (!patient) return;
    const key = `nabh_fall_risk_${patient._id}`;
    const stored = localStorage.getItem(key);
    if (stored) {
      try {
        const data = JSON.parse(stored);
        setHistory(data.history || []);
      } catch {}
    }
    // Restore auto-save draft
    const dKey = `sphere_draft_fall_${patient._id}`;
    try {
      const raw = localStorage.getItem(dKey);
      if (raw) {
        const { scores: ds, nurseName: dn, actionsNote: da } = JSON.parse(raw);
        if (ds) setScores(s => ({ ...s, ...ds }));
        if (dn) setNurseName(dn);
        if (da) setActionsNote(da);
      }
    } catch {}
  }, [patient]);

  const totalScore = Object.values(scores).reduce((a, v) => a + (v ?? 0), 0);
  const risk = getRisk(totalScore);
  const allAnswered = Object.values(scores).every(v => v !== null);

  const handleScore = useCallback((key, val) => {
    setScores(prev => ({ ...prev, [key]: val }));
    setSaved(false);
  }, []);

  const handleSave = async () => {
    if (!patient || !allAnswered) return;
    setSaving(true);
    const entry = {
      date: new Date().toISOString(),
      score: totalScore,
      risk: risk.level,
      nurse: nurseName,
      actions: actionsNote,
      scores: { ...scores },
    };
    const key = `nabh_fall_risk_${patient._id}`;
    const newHistory = [entry, ...history];
    localStorage.setItem(key, JSON.stringify({ history: newHistory }));
    setHistory(newHistory);
    try {
      await axios.post(`${API}/nursing-assessments/fall-risk`, {
        patientId: patient._id,
        ...entry,
        nurseEmployeeId: user?.employeeId || "",
        nurseSignature: signature || undefined,
      });
    } catch {}
    clearDraft();
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  if (!patient) {
    return (
      <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", height:400, color:C.muted }}>
        <i className="pi pi-user" style={{ fontSize:48, marginBottom:16, opacity:.3 }} />
        <div style={{ fontSize:16, fontWeight:600 }}>No patient selected</div>
        <div style={{ fontSize:13, marginTop:6 }}>Search or select a patient from the left panel to begin Fall Risk Assessment</div>
      </div>
    );
  }

  return (
    <div style={{ padding:"20px 24px", fontFamily:"'DM Sans',sans-serif", background:C.bg, minHeight:"100vh" }}>
      <PageHeader
        icon="pi-exclamation-triangle"
        title="Fall Risk Assessment"
        subtitle="Morse Fall Scale — NABH Compliant"
        gradient="linear-gradient(135deg,#dc2626,#b91c1c)"
        right={
          <span style={{ background:"rgba(255,255,255,.2)", color:"#fff", fontSize:11, fontWeight:700, padding:"4px 12px", borderRadius:8 }}>
            NABH COP.11
          </span>
        }
      />

      <Section title="Morse Fall Scale" icon="pi-list" color={C.red}>
        <div style={{ display:"grid", gap:14 }}>
          {MORSE_ITEMS.map(item => (
            <div key={item.key} style={{ background:"#f8fafc", borderRadius:10, padding:"14px 16px", border:`1.5px solid ${C.border}` }}>
              <div style={{ fontSize:13, fontWeight:700, color:C.text, marginBottom:10 }}>{item.label}</div>
              <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
                {item.options.map(opt => {
                  const selected = scores[item.key] === opt.value;
                  return (
                    <button
                      key={opt.value}
                      onClick={() => handleScore(item.key, opt.value)}
                      style={{
                        padding:"7px 16px", borderRadius:8, fontSize:12, fontWeight:600, cursor:"pointer",
                        border:`2px solid ${selected ? C.red : C.border}`,
                        background: selected ? C.redL : "#fff",
                        color: selected ? C.red : C.muted,
                        transition:"all .15s",
                      }}
                    >
                      {opt.label}
                      <span style={{ marginLeft:6, fontSize:11, opacity:.7 }}>({opt.value} pts)</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Risk Score Summary" icon="pi-chart-bar" color={risk.color}>
        <div style={{ display:"flex", alignItems:"center", gap:24, flexWrap:"wrap" }}>
          <ScoreBadge score={totalScore} max={125} label={risk.level} bg={risk.bg} color={risk.color} />
          <div style={{ flex:1, minWidth:200 }}>
            <div style={{ background:risk.bg, border:`2px solid ${risk.color}`, borderRadius:12, padding:"14px 18px" }}>
              <div style={{ fontSize:12, fontWeight:700, color:risk.color, marginBottom:10, textTransform:"uppercase", letterSpacing:".5px" }}>
                {risk.level} — Recommended Interventions
              </div>
              <ul style={{ margin:0, paddingLeft:18, display:"flex", flexDirection:"column", gap:5 }}>
                {risk.interventions.map((item, i) => (
                  <li key={i} style={{ fontSize:12, color:C.slate, lineHeight:1.5 }}>{item}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
        <div style={{ marginTop:16, display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
          <Field label="Assessing Nurse">
            <input className="his-field" value={nurseName} onChange={e => setNurseName(e.target.value)} placeholder="Nurse name & designation" />
          </Field>
          <Field label="Actions Taken / Notes">
            <input className="his-field" value={actionsNote} onChange={e => setActionsNote(e.target.value)} placeholder="e.g. Wristband applied, family educated" />
          </Field>
        </div>
        <div style={{ marginTop:16, display:"flex", alignItems:"center", gap:12, flexWrap:"wrap" }}>
          <button
            onClick={handleSave}
            disabled={saving || !allAnswered}
            style={{
              padding:"10px 28px", borderRadius:10, border:"none", cursor: (!allAnswered || saving) ? "not-allowed" : "pointer",
              background: saved ? `linear-gradient(135deg,${C.green},#15803d)` : `linear-gradient(135deg,${C.red},#b91c1c)`,
              color:"#fff", fontWeight:700, fontSize:13, display:"flex", alignItems:"center", gap:8,
              opacity: (!allAnswered || saving) ? .65 : 1, transition:"all .2s",
            }}
          >
            <i className={`pi ${saved ? "pi-check" : saving ? "pi-spin pi-spinner" : "pi-save"}`} />
            {saved ? "Saved!" : saving ? "Saving…" : "Save Assessment"}
          </button>
          <AutoSaveIndicator savedAt={savedAt} hasDraft={hasDraft} />
          <button onClick={() => setShowSetup(true)} style={{ padding:"8px 14px", background: signature ? "#f0fdf4" : "#fffbeb", border:`1.5px solid ${signature ? "#bbf7d0" : "#fde68a"}`, borderRadius:8, cursor:"pointer", fontSize:11, fontWeight:700, color: signature ? "#16a34a" : "#92400e", display:"flex", alignItems:"center", gap:5 }}>
            {signature ? <><i className="pi pi-verified" /> Signature Set</> : <><i className="pi pi-pen-to-square" /> Setup Signature</>}
          </button>
          {!allAnswered && <div style={{ fontSize:11, color:C.muted }}>Please answer all 6 items to save.</div>}
        </div>
      </Section>

      {history.length > 0 && (
        <Section title="Assessment History" icon="pi-history" color={C.blue} defaultOpen={false}>
          <div style={{ overflowX:"auto" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
              <thead>
                <tr style={{ background:"#f8fafc" }}>
                  {["Date & Time","Score","Risk Level","Nurse","Actions / Notes"].map(h => (
                    <th key={h} style={{ padding:"8px 12px", textAlign:"left", fontWeight:700, color:C.muted, borderBottom:`1px solid ${C.border}`, whiteSpace:"nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.map((row, i) => {
                  const r = getRisk(row.score);
                  return (
                    <tr key={i} style={{ borderBottom:`1px solid ${C.border}` }}>
                      <td style={{ padding:"8px 12px", color:C.text }}>{new Date(row.date).toLocaleString()}</td>
                      <td style={{ padding:"8px 12px", fontWeight:700, color:r.color }}>{row.score}</td>
                      <td style={{ padding:"8px 12px" }}>
                        <span style={{ background:r.bg, color:r.color, padding:"2px 8px", borderRadius:6, fontWeight:700, fontSize:11 }}>{row.risk}</span>
                      </td>
                      <td style={{ padding:"8px 12px", color:C.text }}>{row.nurse || "—"}</td>
                      <td style={{ padding:"8px 12px", color:C.muted }}>{row.actions || "—"}</td>
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
          userName={nurseName}
          onSave={async (dataUrl) => { await saveSignature(dataUrl); setShowSetup(false); }}
          onCancel={() => setShowSetup(false)}
        />
      )}
    </div>
  );
}

export default function FallRiskAssessmentPage() {
  const [patient, setPatient] = useState(null);
  return (
    <ClinicalLayout onPatientSelect={setPatient} selectedId={patient?._id} pageType="fall-risk">
      <FallRiskContent patient={patient} />
    </ClinicalLayout>
  );
}
