import React, { useState, useEffect } from "react";
import "../../Components/clinical/clinical-forms.css";
import axios from "axios";
import { API_ENDPOINTS } from "../../config/api";
import { useAuth } from "../../context/AuthContext";
import ClinicalLayout from "../../Components/clinical/ClinicalLayout";
import { useAutoSave } from "../../hooks/useAutoSave";
import { useDigitalSignature } from "../../hooks/useDigitalSignature";
import AutoSaveIndicator from "../../Components/signature/AutoSaveIndicator";
import SignaturePad from "../../Components/signature/SignaturePad";

const API = API_ENDPOINTS.NURSING_CARE_PLANS;

const emptyAssessment = {
  consciousnessLevel: "Alert",
  mobility: "Independent",
  nutritionStatus: "Good",
  eliminationPattern: "Normal",
  selfCareAbility: "Full",
  painPresent: false,
  painScore: 0,
  skinCondition: "Intact",
  fallRisk: "Low",
  pressureUlcerRisk: "Low",
  ivAccess: false,
  urinaryCatheter: false,
  nasogastricTube: false,
  oxygenSupport: false,
  oxygenFlowRate: "",
  additionalNotes: "",
};

const emptyProblem = {
  problemStatement: "",
  relatedTo: "",
  evidencedBy: "",
  priority: "MEDIUM",
  shortTermGoal: "",
  longTermGoal: "",
  interventions: [{ intervention: "", frequency: "", responsible: "Nurse" }],
  evaluation: "",
  status: "ACTIVE",
};

const COMMON_PROBLEMS = [
  { problemStatement: "Acute Pain", relatedTo: "Surgical incision / medical condition", evidencedBy: "Patient reports pain score > 3" },
  { problemStatement: "Risk for Infection", relatedTo: "IV access / surgical wound / invasive procedure", evidencedBy: "Presence of IV line / wound" },
  { problemStatement: "Impaired Mobility", relatedTo: "Post-surgical / weakness", evidencedBy: "Unable to ambulate independently" },
  { problemStatement: "Risk for Falls", relatedTo: "Weakness / medication / altered sensorium", evidencedBy: "High fall risk score" },
  { problemStatement: "Impaired Nutrition", relatedTo: "Poor oral intake / nausea", evidencedBy: "Inadequate dietary intake" },
  { problemStatement: "Anxiety", relatedTo: "Hospitalization / diagnosis", evidencedBy: "Patient expresses fear/worry" },
  { problemStatement: "Risk for Pressure Ulcer", relatedTo: "Immobility / prolonged bed rest", evidencedBy: "Braden score assessment" },
  { problemStatement: "Altered Elimination", relatedTo: "Immobility / catheter / medication", evidencedBy: "Urinary catheter in situ" },
];

/* ── Design tokens ── */
const C = {
  bg: "#f8fafc", card: "#ffffff", border: "#e2e8f0", text: "#0f172a", muted: "#64748b",
  primary: "#0f766e", primaryL: "#f0fdfa", primaryMid: "#0d9488",
  green: "#16a34a", greenL: "#dcfce7", greenB: "#bbf7d0",
  amber: "#d97706", amberL: "#fffbeb", amberB: "#fde68a",
  red: "#dc2626", redL: "#fef2f2", redB: "#fecaca",
  blue: "#4f46e5", blueL: "#eef2ff", blueB: "#c7d2fe",
  purple: "#7c3aed", purpleL: "#f5f3ff",
  slate: "#1e293b", slateMid: "#334155",
  pink: "#be185d", pinkL: "#fdf2f8",
};

function F({ label, required, children, hint, span }) {
  return (
    <div style={span ? { gridColumn: `span ${span}` } : {}}>
      <label className="his-label">{label}{required && <span style={{ color: C.red }}> *</span>}</label>
      {children}
      {hint && <div style={{ fontSize: 10, color: C.muted, marginTop: 3 }}>{hint}</div>}
    </div>
  );
}

function Section({ title, icon, color = C.primary, badge, nabh, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 14, marginBottom: 16, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,.04)" }}>
      <div onClick={() => setOpen(o => !o)} style={{ padding: "12px 20px", background: "#f8fafc", borderBottom: open ? `1px solid ${C.border}` : "none", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", userSelect: "none" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: 30, height: 30, borderRadius: 8, background: color + "18", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <i className={`pi ${icon}`} style={{ fontSize: 13, color }} />
          </span>
          <span style={{ fontWeight: 700, fontSize: 13, color: C.text }}>{title}</span>
          {nabh && <span style={{ background: "#7c3aed18", color: "#7c3aed", border: "1px solid #7c3aed30", fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 4 }}>NABH</span>}
          {badge && <span style={{ background: color + "18", color, border: `1px solid ${color}30`, fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 4 }}>{badge}</span>}
        </div>
        <i className={`pi ${open ? "pi-chevron-up" : "pi-chevron-down"}`} style={{ fontSize: 10, color: C.muted }} />
      </div>
      {open && <div style={{ padding: "18px 20px" }}>{children}</div>}
    </div>
  );
}

/* Priority badge config */
const PRIORITY_CFG = {
  HIGH:     { bg: C.redL,   color: C.red,   border: C.redB,   label: "HIGH"     },
  MEDIUM:   { bg: C.amberL, color: C.amber, border: C.amberB, label: "MEDIUM"   },
  LOW:      { bg: C.greenL, color: C.green, border: C.greenB, label: "LOW"      },
  CRITICAL: { bg: C.redL,   color: C.red,   border: C.redB,   label: "CRITICAL" },
};

/* Toggle checkbox */
function Toggle({ label, checked, onChange }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      style={{
        display: "flex", alignItems: "center", gap: 8, padding: "8px 14px",
        border: `1.5px solid ${checked ? C.primary + "60" : C.border}`,
        borderRadius: 8, background: checked ? C.primaryL : "white",
        cursor: "pointer", fontFamily: "'DM Sans',sans-serif", fontSize: 12,
        fontWeight: 600, color: checked ? C.primary : C.muted,
        transition: "all .15s",
      }}
    >
      <span style={{
        width: 16, height: 16, borderRadius: 4, border: `2px solid ${checked ? C.primary : "#cbd5e1"}`,
        background: checked ? C.primary : "white", display: "flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0,
      }}>
        {checked && <i className="pi pi-check" style={{ fontSize: 9, color: "white" }} />}
      </span>
      {label}
    </button>
  );
}

/* ═══════════════════════════════════════════════════════ */
function NursingCarePlanContent({ selectedPatient }) {
  const { user } = useAuth();
  const [searchUHID, setSearchUHID] = useState("");
  const [searchIPD, setSearchIPD] = useState("");
  const [plan, setPlan] = useState(null);
  const [form, setForm] = useState({
    UHID: "", patientName: "", age: "", gender: "", ipdNo: "",
    nurseName: "", attendingDoctor: "", department: "",
    admissionAssessment: { ...emptyAssessment },
    educationNeedsAssessed: false, educationTopics: "",
    educationBarriers: "", dischargeGoals: "",
  });
  const [problems, setProblems] = useState([{ ...emptyProblem }]);
  const [mode, setMode] = useState("list");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  /* ── Auto-save + signature ── */
  const draftKey = form.ipdNo ? `sphere_draft_careplan_${form.ipdNo}` : null;
  const { savedAt, hasDraft, clearDraft } = useAutoSave(draftKey, { form, problems }, 2000);
  const { signature, showSetup, setShowSetup, saveSignature } = useDigitalSignature();

  useEffect(() => {
    if (selectedPatient?.UHID) {
      setSearchUHID(selectedPatient.UHID);
      setSearchIPD(selectedPatient.bedNumber || "");
    }
  }, [selectedPatient]);

  // Auto-fill nurse name from logged-in user
  useEffect(() => {
    if (!user) return;
    const name = user.fullName || `${user.firstName || ""} ${user.lastName || ""}`.trim();
    if (name) setForm(p => ({ ...p, nurseName: p.nurseName || name }));
  }, [user]);

  const search = async () => {
    setLoading(true);
    try {
      if (searchIPD) {
        const res = await axios.get(`${API}/ipd/${searchIPD.trim()}`);
        setPlan(res.data.data);
        if (res.data.data) openView(res.data.data);
      } else if (searchUHID) {
        const res = await axios.get(`${API}/uhid/${searchUHID.trim()}`);
        setPlan(res.data.data?.[0] || null);
        if (res.data.data?.[0]) openView(res.data.data[0]);
      }
    } catch { setPlan(null); }
    setLoading(false);
  };

  const openNew = () => {
    setForm(p => ({ ...p, UHID: searchUHID, ipdNo: searchIPD }));
    setProblems([{ ...emptyProblem, interventions: [{ intervention: "", frequency: "", responsible: "Nurse" }] }]);
    setMode("new");
  };

  const openView = (p) => { setPlan(p); setMode("view"); };

  const handleAssessment = (field, val) => {
    setForm(p => ({ ...p, admissionAssessment: { ...p.admissionAssessment, [field]: val } }));
  };

  const addProblem = () => setProblems(p => [...p, { ...emptyProblem, interventions: [{ intervention: "", responsible: "Nurse", frequency: "" }] }]);
  const removeProblem = (i) => setProblems(p => p.filter((_, idx) => idx !== i));

  const useTemplate = (tpl) => {
    setProblems(p => [...p, {
      ...emptyProblem,
      problemStatement: tpl.problemStatement,
      relatedTo: tpl.relatedTo,
      evidencedBy: tpl.evidencedBy,
      interventions: [{ intervention: "", frequency: "Each shift", responsible: "Nurse" }],
    }]);
  };

  const changeProblem = (i, field, val) => setProblems(p => p.map((pr, idx) => idx === i ? { ...pr, [field]: val } : pr));

  const addIntervention = (pi) => setProblems(p => p.map((pr, idx) => idx === pi ? { ...pr, interventions: [...pr.interventions, { intervention: "", frequency: "", responsible: "Nurse" }] } : pr));
  const changeIntervention = (pi, ii, field, val) => setProblems(p => p.map((pr, pidx) => pidx !== pi ? pr : {
    ...pr,
    interventions: pr.interventions.map((iv, iidx) => iidx === ii ? { ...iv, [field]: val } : iv),
  }));
  const removeIntervention = (pi, ii) => setProblems(p => p.map((pr, pidx) => pidx !== pi ? pr : { ...pr, interventions: pr.interventions.filter((_, iidx) => iidx !== ii) }));

  const save = async () => {
    setLoading(true);
    const payload = {
      ...form,
      // NursingCarePlanModel requires the `patient` ObjectId (ref Patient);
      // without it create() fails Mongoose validation. Sourced from the
      // sidebar-selected patient.
      patient: selectedPatient?._id || form.patient,
      nurseName: form.nurseName || user?.fullName || `${user?.firstName || ""} ${user?.lastName || ""}`.trim(),
      nurseEmployeeId: user?.employeeId || "",
      nurseSignature: signature || undefined,
      educationTopics: form.educationTopics ? form.educationTopics.split(",").map(s => s.trim()).filter(Boolean) : [],
      nursingProblems: problems,
    };
    try {
      if (plan && plan._id) {
        await axios.put(`${API}/${plan._id}`, payload);
        setMsg("Care plan updated.");
      } else {
        await axios.post(API, payload);
        setMsg("Care plan created.");
      }
      clearDraft();
      setMode("list");
    } catch (e) { setMsg(e.response?.data?.message || "Error"); }
    setLoading(false);
  };

  const today = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

  return (
    <div style={{ marginLeft: 260, padding: "24px 28px", minHeight: "100vh", background: C.bg, fontFamily: "'DM Sans',sans-serif" }}>

      {/* ── Page Header ── */}
      <div style={{
        background: `linear-gradient(135deg, ${C.primary} 0%, ${C.primaryMid} 100%)`,
        borderRadius: 16, padding: "22px 28px", marginBottom: 20,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        boxShadow: `0 8px 24px ${C.primary}30`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 46, height: 46, borderRadius: 12, background: "rgba(255,255,255,.18)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <i className="pi pi-clipboard" style={{ fontSize: 20, color: "white" }} />
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: "white" }}>Nursing Care Plan</h2>
              <span style={{ background: "rgba(255,255,255,.22)", color: "white", border: "1px solid rgba(255,255,255,.35)", fontSize: 10, fontWeight: 700, padding: "2px 9px", borderRadius: 5, letterSpacing: ".5px" }}>NABH</span>
            </div>
            <p style={{ margin: "2px 0 0", fontSize: 12, color: "rgba(255,255,255,.75)" }}>COP.1 — Individualized nursing care plan per admission</p>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ background: "rgba(255,255,255,.15)", borderRadius: 8, padding: "6px 14px", fontSize: 12, color: "white", fontWeight: 600 }}>
            <i className="pi pi-calendar" style={{ marginRight: 6, fontSize: 11 }} />
            {today}
          </div>
          {mode !== "list" && (
            <button onClick={() => setMode("list")} style={{ padding: "8px 16px", background: "rgba(255,255,255,.2)", border: "1.5px solid rgba(255,255,255,.35)", borderRadius: 8, color: "white", fontSize: 12, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
              <i className="pi pi-arrow-left" style={{ fontSize: 11 }} /> Back
            </button>
          )}
        </div>
      </div>

      {/* ── Status Message ── */}
      {msg && (
        <div style={{ marginBottom: 16, padding: "12px 18px", background: C.greenL, border: `1.5px solid ${C.greenB}`, borderRadius: 10, color: C.green, fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
          <i className="pi pi-check-circle" style={{ fontSize: 14 }} />
          {msg}
        </div>
      )}

      {/* ══════ LIST MODE ══════ */}
      {mode === "list" && (
        <div style={{ background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 14, padding: "22px 24px", boxShadow: "0 1px 3px rgba(0,0,0,.04)" }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: C.text, marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
            <i className="pi pi-search" style={{ color: C.primary, fontSize: 14 }} />
            Search Patient
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto auto", gap: 12, alignItems: "end" }}>
            <F label="Search by UHID">
              <input className="his-field" value={searchUHID} onChange={e => setSearchUHID(e.target.value)} placeholder="Enter UHID..." />
            </F>
            <F label="or IPD Number">
              <input className="his-field" value={searchIPD} onChange={e => setSearchIPD(e.target.value)} placeholder="Enter IPD No..." />
            </F>
            <button onClick={search} style={{ padding: "9px 22px", background: C.primary, color: "white", border: "none", borderRadius: 8, fontFamily: "'DM Sans',sans-serif", fontSize: 13, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 7 }}>
              {loading ? <i className="pi pi-spin pi-spinner" style={{ fontSize: 13 }} /> : <i className="pi pi-search" style={{ fontSize: 12 }} />}
              Search
            </button>
            <button onClick={openNew} style={{ padding: "9px 20px", background: C.green, color: "white", border: "none", borderRadius: 8, fontFamily: "'DM Sans',sans-serif", fontSize: 13, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 7 }}>
              <i className="pi pi-plus" style={{ fontSize: 12 }} /> New Plan
            </button>
          </div>
          {plan === null && !loading && (searchUHID || searchIPD) && (
            <div style={{ marginTop: 20, padding: "20px", background: C.bg, borderRadius: 10, border: `1.5px dashed ${C.border}`, textAlign: "center" }}>
              <i className="pi pi-inbox" style={{ fontSize: 28, color: "#cbd5e1", display: "block", marginBottom: 10 }} />
              <div style={{ fontSize: 13, fontWeight: 600, color: C.muted }}>No care plan found for this patient.</div>
              <button onClick={openNew} style={{ marginTop: 10, padding: "8px 20px", background: C.primary, color: "white", border: "none", borderRadius: 8, fontFamily: "'DM Sans',sans-serif", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                Create New Plan
              </button>
            </div>
          )}
        </div>
      )}

      {/* ══════ NEW / EDIT MODE ══════ */}
      {(mode === "new" || mode === "edit") && (
        <div>
          {/* Patient Information */}
          <Section title="Patient Information" icon="pi-user" color={C.primary}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
              {[
                ["UHID", "UHID", true],
                ["patientName", "Patient Name", true],
                ["age", "Age"],
                ["gender", "Gender"],
                ["ipdNo", "IPD Number", true],
                ["nurseName", "Primary Nurse", true],
                ["attendingDoctor", "Attending Doctor"],
                ["department", "Department"],
              ].map(([name, label, req]) => (
                <F key={name} label={label} required={!!req}>
                  <input className="his-field" name={name} value={form[name]} onChange={e => setForm(p => ({ ...p, [e.target.name]: e.target.value }))} />
                </F>
              ))}
            </div>
          </Section>

          {/* Admission Assessment */}
          <Section title="Admission Assessment" icon="pi-clipboard" color={C.blue} nabh>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
              {[
                ["consciousnessLevel", "Consciousness", ["Alert", "Drowsy", "Confused", "Unconscious", "Sedated"]],
                ["mobility", "Mobility", ["Independent", "Assisted", "Dependent", "Bedridden"]],
                ["nutritionStatus", "Nutrition Status", ["Good", "Fair", "Poor", "On NGT", "On TPN"]],
                ["eliminationPattern", "Elimination", ["Normal", "Constipation", "Diarrhea", "Catheterized", "Colostomy"]],
                ["selfCareAbility", "Self-Care Ability", ["Full", "Partial", "Dependent"]],
                ["skinCondition", "Skin Condition", ["Intact", "Wound", "Rash", "Pressure Ulcer", "Edema"]],
                ["fallRisk", "Fall Risk", ["Low", "Medium", "High"]],
                ["pressureUlcerRisk", "Pressure Ulcer Risk", ["Low", "Medium", "High"]],
              ].map(([field, label, opts]) => (
                <F key={field} label={label}>
                  <select className="his-select" value={form.admissionAssessment[field]} onChange={e => handleAssessment(field, e.target.value)}>
                    {opts.map(o => <option key={o}>{o}</option>)}
                  </select>
                </F>
              ))}
            </div>

            <div style={{ marginBottom: 14 }}>
              <div className="his-label">Devices &amp; Support</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {[
                  ["ivAccess", "IV Access"],
                  ["urinaryCatheter", "Urinary Catheter"],
                  ["nasogastricTube", "NGT"],
                  ["oxygenSupport", "O\u2082 Support"],
                  ["painPresent", "Pain Present"],
                ].map(([field, label]) => (
                  <Toggle key={field} label={label} checked={form.admissionAssessment[field]} onChange={v => handleAssessment(field, v)} />
                ))}
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
              {form.admissionAssessment.painPresent && (
                <F label="Pain Score (0–10)">
                  <input type="number" min="0" max="10" className="his-field" value={form.admissionAssessment.painScore} onChange={e => handleAssessment("painScore", e.target.value)} />
                </F>
              )}
              {form.admissionAssessment.oxygenSupport && (
                <F label="O\u2082 Flow Rate" hint="e.g. 4 L/min">
                  <input className="his-field" value={form.admissionAssessment.oxygenFlowRate} onChange={e => handleAssessment("oxygenFlowRate", e.target.value)} placeholder="4L/min" />
                </F>
              )}
            </div>

            <F label="Additional Notes" span={3}>
              <textarea className="his-textarea" value={form.admissionAssessment.additionalNotes} onChange={e => handleAssessment("additionalNotes", e.target.value)} />
            </F>
          </Section>

          {/* Quick Add Common Problems */}
          <Section title="Quick Add — Common Nursing Problems (NANDA)" icon="pi-bolt" color={C.amber}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {COMMON_PROBLEMS.map((tpl, i) => (
                <button key={i} onClick={() => useTemplate(tpl)}
                  style={{ padding: "7px 14px", border: `1.5px solid ${C.primary}40`, borderRadius: 8, background: C.primaryL, color: C.primary, fontFamily: "'DM Sans',sans-serif", fontSize: 12, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, transition: "all .15s" }}
                  onMouseEnter={e => { e.currentTarget.style.background = C.primary; e.currentTarget.style.color = "white"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = C.primaryL; e.currentTarget.style.color = C.primary; }}
                >
                  <i className="pi pi-plus" style={{ fontSize: 10 }} />
                  {tpl.problemStatement}
                </button>
              ))}
            </div>
          </Section>

          {/* Nursing Problems */}
          <Section title={`Nursing Problems & Care Plan`} icon="pi-list" color={C.red} badge={`${problems.length} problem${problems.length !== 1 ? "s" : ""}`} nabh>
            <div style={{ marginBottom: 16, display: "flex", justifyContent: "flex-end" }}>
              <button onClick={addProblem} style={{ padding: "8px 18px", background: C.primary, color: "white", border: "none", borderRadius: 8, fontFamily: "'DM Sans',sans-serif", fontSize: 12, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
                <i className="pi pi-plus" style={{ fontSize: 11 }} /> Add Problem
              </button>
            </div>

            {problems.map((pr, pi) => {
              const pc = PRIORITY_CFG[pr.priority] || PRIORITY_CFG.MEDIUM;
              return (
                <div key={pi} style={{ border: `1.5px solid ${C.border}`, borderRadius: 12, marginBottom: 16, overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,.03)" }}>
                  {/* Problem header */}
                  <div style={{ padding: "12px 18px", background: "#f8fafc", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ width: 26, height: 26, borderRadius: 6, background: pc.bg, border: `1px solid ${pc.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800, color: pc.color }}>
                        {pi + 1}
                      </span>
                      <span style={{ fontWeight: 700, fontSize: 13, color: C.text }}>
                        {pr.problemStatement || `Problem #${pi + 1}`}
                      </span>
                      <span style={{ padding: "2px 9px", borderRadius: 5, fontSize: 10, fontWeight: 700, background: pc.bg, color: pc.color, border: `1px solid ${pc.border}` }}>
                        {pc.label}
                      </span>
                    </div>
                    <button onClick={() => removeProblem(pi)} style={{ padding: "5px 12px", background: C.redL, border: `1px solid ${C.redB}`, borderRadius: 6, color: C.red, fontSize: 11, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}>
                      <i className="pi pi-trash" style={{ fontSize: 10 }} /> Remove
                    </button>
                  </div>

                  <div style={{ padding: "18px" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
                      <F label="Problem Statement (NANDA)" required>
                        <input className="his-field" value={pr.problemStatement} onChange={e => changeProblem(pi, "problemStatement", e.target.value)} placeholder="e.g. Acute Pain" />
                      </F>
                      <F label="Priority">
                        <select className="his-select" style={{ fontWeight: 700, color: pc.color }} value={pr.priority} onChange={e => changeProblem(pi, "priority", e.target.value)}>
                          {/* Model enum is [HIGH,MEDIUM,LOW]; CRITICAL would fail subdoc validation on save. */}
                          {["HIGH", "MEDIUM", "LOW"].map(v => <option key={v}>{v}</option>)}
                        </select>
                      </F>
                      <F label="Status">
                        <select className="his-select" value={pr.status} onChange={e => changeProblem(pi, "status", e.target.value)}>
                          {["ACTIVE", "RESOLVED", "ON_HOLD"].map(v => <option key={v}>{v}</option>)}
                        </select>
                      </F>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12, marginBottom: 12 }}>
                      <F label="Related To">
                        <input className="his-field" value={pr.relatedTo} onChange={e => changeProblem(pi, "relatedTo", e.target.value)} />
                      </F>
                      <F label="Evidenced By">
                        <input className="his-field" value={pr.evidencedBy} onChange={e => changeProblem(pi, "evidencedBy", e.target.value)} />
                      </F>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
                      <F label="Short-Term Goal">
                        <input className="his-field" value={pr.shortTermGoal} onChange={e => changeProblem(pi, "shortTermGoal", e.target.value)} placeholder="Goal within 24–48 hours" />
                      </F>
                      <F label="Long-Term Goal">
                        <input className="his-field" value={pr.longTermGoal} onChange={e => changeProblem(pi, "longTermGoal", e.target.value)} placeholder="Goal by discharge" />
                      </F>
                    </div>

                    {/* Interventions */}
                    <div style={{ marginBottom: 14 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                        <div className="his-label">Nursing Interventions</div>
                        <button onClick={() => addIntervention(pi)} style={{ padding: "4px 12px", background: C.blueL, border: `1px solid ${C.blueB}`, borderRadius: 6, color: C.blue, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                          + Add Row
                        </button>
                      </div>
                      <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden" }}>
                        <div style={{ display: "grid", gridTemplateColumns: "3fr 1.5fr 1.5fr 40px", padding: "7px 12px", background: "#f8fafc", borderBottom: `1px solid ${C.border}`, gap: 8 }}>
                          {["Intervention", "Frequency", "Responsible", ""].map((h, k) => (
                            <div key={k} style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".5px" }}>{h}</div>
                          ))}
                        </div>
                        {pr.interventions.map((iv, ii) => (
                          <div key={ii} style={{ display: "grid", gridTemplateColumns: "3fr 1.5fr 1.5fr 40px", gap: 8, padding: "8px 10px", borderBottom: ii < pr.interventions.length - 1 ? `1px solid ${C.border}` : "none", background: ii % 2 === 0 ? "white" : "#fafbfc" }}>
                            <input className="his-field" style={{ padding: "7px 10px" }} placeholder="Describe intervention..." value={iv.intervention} onChange={e => changeIntervention(pi, ii, "intervention", e.target.value)} />
                            <input className="his-field" style={{ padding: "7px 10px" }} placeholder="Each shift..." value={iv.frequency} onChange={e => changeIntervention(pi, ii, "frequency", e.target.value)} />
                            <input className="his-field" style={{ padding: "7px 10px" }} placeholder="Nurse / Doctor" value={iv.responsible} onChange={e => changeIntervention(pi, ii, "responsible", e.target.value)} />
                            <button onClick={() => removeIntervention(pi, ii)} style={{ width: 32, height: 32, borderRadius: 6, background: C.redL, border: `1px solid ${C.redB}`, color: C.red, cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center" }}>
                              <i className="pi pi-times" style={{ fontSize: 10 }} />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>

                    <F label="Evaluation / Outcome">
                      <textarea className="his-textarea" style={{ minHeight: 64 }} value={pr.evaluation} onChange={e => changeProblem(pi, "evaluation", e.target.value)} placeholder="Document evaluation of outcomes and patient response..." />
                    </F>
                  </div>
                </div>
              );
            })}
          </Section>

          {/* Patient Education & Discharge */}
          <Section title="Patient Education & Discharge Planning" icon="pi-book" color={C.purple} nabh>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
              <F label="Education Topics" hint="Comma-separated list">
                <input className="his-field" value={form.educationTopics} onChange={e => setForm(p => ({ ...p, educationTopics: e.target.value }))} placeholder="Disease, Medications, Diet, Wound Care..." />
              </F>
              <F label="Education Barriers">
                <input className="his-field" value={form.educationBarriers} onChange={e => setForm(p => ({ ...p, educationBarriers: e.target.value }))} placeholder="Language, Literacy, Anxiety..." />
              </F>
              <F label="Discharge Goals" span={2}>
                <textarea className="his-textarea" value={form.dischargeGoals} onChange={e => setForm(p => ({ ...p, dischargeGoals: e.target.value }))} placeholder="Patient will be able to..." />
              </F>
            </div>
          </Section>

          {/* Save Actions */}
          <div style={{ display: "flex", gap: 12, justifyContent: "space-between", alignItems: "center", marginBottom: 32, padding: "0 4px", flexWrap: "wrap" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <AutoSaveIndicator savedAt={savedAt} hasDraft={hasDraft} />
              <button onClick={() => setShowSetup(true)} style={{ padding:"7px 12px", background: signature ? "#f0fdf4" : "#fffbeb", border:`1.5px solid ${signature ? "#bbf7d0" : "#fde68a"}`, borderRadius:8, cursor:"pointer", fontSize:11, fontWeight:700, color: signature ? "#16a34a" : "#92400e", display:"flex", alignItems:"center", gap:5 }}>
                {signature ? <><i className="pi pi-verified" /> Signature Set</> : <><i className="pi pi-pen-to-square" /> Setup Signature</>}
              </button>
            </div>
            <div style={{ display: "flex", gap: 12 }}>
              <button onClick={() => setMode("list")} style={{ padding: "11px 24px", border: `1.5px solid ${C.border}`, borderRadius: 10, background: "white", fontFamily: "'DM Sans',sans-serif", fontSize: 13, fontWeight: 600, cursor: "pointer", color: C.muted }}>
                Cancel
              </button>
              <button onClick={save} disabled={loading}
                style={{ padding: "11px 32px", background: loading ? "#5eead4" : `linear-gradient(135deg, ${C.primary}, ${C.primaryMid})`, color: "white", border: "none", borderRadius: 10, fontFamily: "'DM Sans',sans-serif", fontSize: 14, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: 8, boxShadow: `0 4px 16px ${C.primary}40` }}>
                <i className={`pi ${loading ? "pi-spin pi-spinner" : "pi-check"}`} style={{ fontSize: 13 }} />
                {loading ? "Saving..." : "Save Care Plan"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════ VIEW MODE ══════ */}
      {mode === "view" && plan && (
        <div>
          {/* Plan header card */}
          <div style={{ background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 14, padding: "20px 24px", marginBottom: 16, boxShadow: "0 1px 3px rgba(0,0,0,.04)" }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                  <span style={{ fontSize: 16, fontWeight: 800, color: C.text }}>{plan.patientName}</span>
                  <span style={{ padding: "3px 10px", borderRadius: 6, fontSize: 10, fontWeight: 700, background: plan.status === "ACTIVE" ? C.greenL : "#f1f5f9", color: plan.status === "ACTIVE" ? C.green : C.muted, border: `1px solid ${plan.status === "ACTIVE" ? C.greenB : C.border}` }}>
                    {plan.status}
                  </span>
                </div>
                <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
                  {[
                    ["UHID", plan.UHID],
                    ["IPD No", plan.ipdNo],
                    ["Nurse", plan.nurseName],
                    ["Doctor", plan.attendingDoctor],
                    ["Department", plan.department],
                    ["Date", plan.assessmentDate ? new Date(plan.assessmentDate).toLocaleDateString("en-IN") : "-"],
                  ].map(([l, v]) => v && (
                    <div key={l}>
                      <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".7px", color: C.muted }}>{l}</div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{v}</div>
                    </div>
                  ))}
                </div>
              </div>
              <button onClick={() => { setForm({ ...plan, educationTopics: (plan.educationTopics || []).join(", ") }); setProblems(plan.nursingProblems || []); setMode("edit"); }}
                style={{ padding: "9px 20px", background: C.amberL, border: `1.5px solid ${C.amberB}`, borderRadius: 8, color: C.amber, fontFamily: "'DM Sans',sans-serif", fontSize: 13, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 7 }}>
                <i className="pi pi-pencil" style={{ fontSize: 12 }} /> Edit Plan
              </button>
            </div>
          </div>

          {/* Problems list */}
          <Section title={`Nursing Problems (${plan.nursingProblems?.length || 0})`} icon="pi-list" color={C.primary}>
            {(plan.nursingProblems || []).map((pr, i) => {
              const pc = PRIORITY_CFG[pr.priority] || PRIORITY_CFG.MEDIUM;
              return (
                <div key={i} style={{ border: `1.5px solid ${C.border}`, borderRadius: 10, padding: "14px 18px", marginBottom: 12, background: "#fafbfc" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ width: 24, height: 24, borderRadius: 6, background: pc.bg, border: `1px solid ${pc.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800, color: pc.color }}>{i + 1}</span>
                      <span style={{ fontWeight: 700, fontSize: 13, color: C.text }}>{pr.problemStatement}</span>
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <span style={{ padding: "2px 9px", borderRadius: 5, fontSize: 10, fontWeight: 700, background: pc.bg, color: pc.color, border: `1px solid ${pc.border}` }}>{pc.label}</span>
                      <span style={{ padding: "2px 9px", borderRadius: 5, fontSize: 10, fontWeight: 700, background: pr.status === "RESOLVED" ? C.greenL : pr.status === "ON_HOLD" ? C.amberL : C.blueL, color: pr.status === "RESOLVED" ? C.green : pr.status === "ON_HOLD" ? C.amber : C.blue, border: `1px solid ${pr.status === "RESOLVED" ? C.greenB : pr.status === "ON_HOLD" ? C.amberB : C.blueB}` }}>{pr.status}</span>
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 8 }}>
                    {pr.relatedTo && <div style={{ fontSize: 12, color: C.muted }}><b>Related to:</b> {pr.relatedTo}</div>}
                    {pr.evidencedBy && <div style={{ fontSize: 12, color: C.muted }}><b>Evidenced by:</b> {pr.evidencedBy}</div>}
                  </div>
                  {pr.interventions?.length > 0 && (
                    <div style={{ background: "white", border: `1px solid ${C.border}`, borderRadius: 7, padding: "8px 12px", marginBottom: 8 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px", color: C.muted, marginBottom: 5 }}>Interventions</div>
                      {pr.interventions.map((iv, j) => (
                        <div key={j} style={{ fontSize: 12, color: C.text, padding: "2px 0", display: "flex", gap: 6 }}>
                          <span style={{ color: C.primary }}>•</span>
                          {iv.intervention}
                          {iv.frequency && <span style={{ color: C.muted }}>— {iv.frequency}</span>}
                          {iv.responsible && <span style={{ color: C.muted }}>— {iv.responsible}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                  {pr.evaluation && (
                    <div style={{ fontSize: 12, color: C.blue, fontStyle: "italic" }}>
                      <b>Evaluation:</b> {pr.evaluation}
                    </div>
                  )}
                </div>
              );
            })}
          </Section>
        </div>
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

export default function NursingCarePlanPage() {
  const [selectedPatient, setSelectedPatient] = useState(null);
  return (
    <ClinicalLayout onPatientSelect={setSelectedPatient} selectedId={selectedPatient?._id} pageType="nursing-care-plan">
      <NursingCarePlanContent selectedPatient={selectedPatient} />
    </ClinicalLayout>
  );
}
