/**
 * OPDAssessmentPage.jsx
 * Doctor's SOAP note + assessment page for OPD visits.
 * Navigated from DoctorOPDPanelPage via "Assess" button:
 *   /opd-assessment?visitNumber=OPD-XXXXXX&uhid=UH-XXXXX
 *
 * Every save creates a BillingTrigger automatically (DoctorAssessment type).
 */
import React, { useState, useEffect, useCallback } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import axios from "axios";
import { toast } from "react-toastify";
import API_ENDPOINTS from "../../config/api";

const C = {
  doctor: "#7c3aed", nurse: "#db2777", primary: "#1e40af",
  success: "#059669", warn: "#d97706", danger: "#dc2626",
  bg: "#f8fafc", card: "#ffffff", border: "#e2e8f0",
  muted: "#64748b", dark: "#0f172a",
};

function Field({ label, children, required }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 6, letterSpacing: ".3px" }}>
        {label}{required && <span style={{ color: C.danger }}> *</span>}
      </label>
      {children}
    </div>
  );
}

function Textarea({ value, onChange, placeholder, rows = 3 }) {
  return (
    <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={rows}
      style={{ width: "100%", border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 12px", fontSize: 13,
        color: C.dark, background: C.card, resize: "vertical", fontFamily: "inherit", lineHeight: 1.5, boxSizing: "border-box", outline: "none" }}
      onFocus={e => e.target.style.borderColor = C.doctor} onBlur={e => e.target.style.borderColor = C.border} />
  );
}

function Input({ value, onChange, placeholder, type = "text" }) {
  return (
    <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      style={{ width: "100%", border: `1px solid ${C.border}`, borderRadius: 8, padding: "9px 12px",
        fontSize: 13, color: C.dark, background: C.card, boxSizing: "border-box", outline: "none" }}
      onFocus={e => e.target.style.borderColor = C.doctor} onBlur={e => e.target.style.borderColor = C.border} />
  );
}

function Card({ title, icon, color = C.doctor, children, badge }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, marginBottom: 20, overflow: "hidden", boxShadow: "0 1px 6px rgba(0,0,0,.05)" }}>
      <div style={{ padding: "12px 18px", background: color + "08", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 10 }}>
        <i className={`pi ${icon}`} style={{ fontSize: 14, color }} />
        <span style={{ fontWeight: 700, fontSize: 13, color }}>{title}</span>
        {badge && <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: ".6px", padding: "2px 8px", borderRadius: 20, background: color + "18", color, border: `1px solid ${color}30` }}>{badge}</span>}
      </div>
      <div style={{ padding: "18px" }}>{children}</div>
    </div>
  );
}

const SOURCE_COLORS = {
  DoctorVisit: C.doctor, DoctorAssessment: C.doctor, NurseNote: C.nurse,
  DoctorNote: C.primary, MAR: C.warn, InvestigationOrder: "#0284c7",
  AutoCharge: C.success, Manual: C.muted,
};

function AuditItem({ trigger }) {
  const color = SOURCE_COLORS[trigger.sourceType] || C.muted;
  const when = new Date(trigger.createdAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  const icons = { NurseNote: "pi-heart", DoctorAssessment: "pi-file-edit", DoctorVisit: "pi-user-edit", InvestigationOrder: "pi-search" };
  return (
    <div style={{ display: "flex", gap: 10, padding: "9px 0", borderBottom: `1px solid ${C.border}` }}>
      <div style={{ width: 30, height: 30, borderRadius: "50%", background: color + "18", border: `1.5px solid ${color}30`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <i className={`pi ${icons[trigger.sourceType] || "pi-receipt"}`} style={{ fontSize: 11, color }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: C.dark }}>{trigger.serviceName}</span>
          <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 20,
            background: trigger.status === "billed" ? "#d1fae5" : "#fef3c7",
            color: trigger.status === "billed" ? C.success : C.warn }}>
            {trigger.status?.toUpperCase()}
          </span>
        </div>
        <div style={{ fontSize: 11, color: C.muted, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {trigger.orderDetails}
        </div>
        <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2, display: "flex", gap: 8 }}>
          <span>{trigger.orderedByRole} — {trigger.orderedBy}</span>
          <span>·</span><span>{when}</span>
          {trigger.totalAmount > 0 && <><span>·</span><span>₹{trigger.totalAmount.toLocaleString("en-IN")}</span></>}
        </div>
      </div>
    </div>
  );
}

export default function OPDAssessmentPage() {
  const [params]    = useSearchParams();
  const navigate    = useNavigate();
  const visitNumber = params.get("visitNumber") || "";
  const uhid        = params.get("uhid") || "";

  const [visit,   setVisit]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [audit,   setAudit]   = useState([]);

  const [soap, setSoap] = useState({
    subjectiveNote: "", objectiveNote: "", assessmentNote: "", planNote: "",
    provisionalDiagnosis: "", finalDiagnosis: "", generalExamination: "",
    systemicExamination: "", advice: "", followUpDate: "", doctorNotes: "",
  });

  const [meds,     setMeds]     = useState([]);
  const [newMed,   setNewMed]   = useState({ name: "", dose: "", frequency: "", duration: "", route: "Oral" });
  const [invests,  setInvests]  = useState([]);
  const [newInvest,setNewInvest]= useState({ name: "", urgency: "Routine", instructions: "" });

  const loadVisit = useCallback(async () => {
    if (!visitNumber) { setLoading(false); return; }
    try {
      const { data } = await axios.get(`${API_ENDPOINTS.OPD}/${visitNumber}`);
      const v = data.data || data;
      setVisit(v);
      setSoap({
        subjectiveNote:       v.subjectiveNote || v.chiefComplaint || "",
        objectiveNote:        v.objectiveNote || "",
        assessmentNote:       v.assessmentNote || "",
        planNote:             v.planNote || "",
        provisionalDiagnosis: v.provisionalDiagnosis || "",
        finalDiagnosis:       v.finalDiagnosis || "",
        generalExamination:   v.generalExamination || "",
        systemicExamination:  v.systemicExamination || "",
        advice:               v.advice || "",
        followUpDate:         v.followUpDate ? v.followUpDate.slice(0, 10) : "",
        doctorNotes:          v.doctorNotes || "",
      });
      setMeds(v.prescribedMedications || []);
      setInvests(v.investigationsOrdered || []);
    } catch (err) {
      toast.error("Could not load visit: " + (err.response?.data?.message || err.message));
    } finally {
      setLoading(false);
    }
  }, [visitNumber]);

  const loadAudit = useCallback(async () => {
    if (!visitNumber) return;
    try {
      const { data } = await axios.get(`${API_ENDPOINTS.OPD}/${visitNumber}/audit-trail`);
      setAudit(data.data?.triggers || []);
    } catch (_) {}
  }, [visitNumber]);

  useEffect(() => { loadVisit(); loadAudit(); }, [loadVisit, loadAudit]);

  const handleSave = async () => {
    if (!soap.provisionalDiagnosis.trim()) return toast.warn("Please enter a provisional diagnosis");
    setSaving(true);
    try {
      const user = (() => { try { return JSON.parse(localStorage.getItem("his_user") || "{}"); } catch { return {}; } })();
      await axios.post(`${API_ENDPOINTS.OPD}/${visitNumber}/assessment`, {
        ...soap,
        doctorName: user.fullName || user.name || "Doctor",
      });
      toast.success("Assessment saved — audit trail updated");
      loadVisit();
      setTimeout(loadAudit, 1500);
    } catch (err) {
      toast.error(err.response?.data?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const addMed = async () => {
    if (!newMed.name.trim()) return toast.warn("Medicine name required");
    try { await axios.post(`${API_ENDPOINTS.OPD}/${visitNumber}/prescription`, newMed); } catch (_) {}
    setMeds(p => [...p, { ...newMed }]);
    setNewMed({ name: "", dose: "", frequency: "", duration: "", route: "Oral" });
    toast.success("Medication added");
  };

  const addInvestigation = async () => {
    if (!newInvest.name.trim()) return toast.warn("Investigation name required");
    try { await axios.post(`${API_ENDPOINTS.OPD}/${visitNumber}/investigation`, { ...newInvest, status: "Ordered" }); } catch (_) {}
    setInvests(p => [...p, { ...newInvest, status: "Ordered" }]);
    setNewInvest({ name: "", urgency: "Routine", instructions: "" });
    toast.success("Investigation ordered");
  };

  const vitals = visit?.vitals || {};
  const vitInfo = [
    { label: "BP",    value: vitals.bloodPressure || "—" },
    { label: "Pulse", value: vitals.pulse ? `${vitals.pulse} bpm` : "—" },
    { label: "Temp",  value: vitals.temperature ? `${vitals.temperature} °F` : "—" },
    { label: "SpO₂",  value: vitals.oxygenSaturation ? `${vitals.oxygenSaturation}%` : "—" },
    { label: "Wt",    value: vitals.weight ? `${vitals.weight} kg` : "—" },
    { label: "BMI",   value: vitals.bmi || "—" },
  ];

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "60vh" }}>
      <i className="pi pi-spin pi-spinner" style={{ fontSize: 32, color: C.doctor }} />
    </div>
  );

  if (!visitNumber) return (
    <div style={{ padding: 40, textAlign: "center", color: C.muted }}>
      <i className="pi pi-exclamation-triangle" style={{ fontSize: 40, marginBottom: 16, display: "block" }} />
      <p>No visit number provided. Navigate from the Doctor OPD Panel.</p>
      <button onClick={() => navigate("/doctor-opd-panel")}
        style={{ marginTop: 12, padding: "10px 24px", background: C.doctor, color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13 }}>
        Go to OPD Panel
      </button>
    </div>
  );

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", fontFamily: "'DM Sans', sans-serif" }}>

      {/* Header */}
      <div style={{
        background: `linear-gradient(135deg, #4c1d95, ${C.doctor})`,
        borderRadius: 14, padding: "20px 24px", marginBottom: 24, color: "#fff",
        display: "flex", alignItems: "flex-start", justifyContent: "space-between",
        boxShadow: "0 4px 20px rgba(124,58,237,.25)",
      }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <button onClick={() => navigate("/doctor-opd-panel")}
              style={{ background: "rgba(255,255,255,.15)", border: "none", color: "#fff", padding: "4px 12px", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>
              ← OPD Panel
            </button>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "1px", background: "rgba(255,255,255,.2)", padding: "2px 10px", borderRadius: 20 }}>
              OPD ASSESSMENT
            </span>
          </div>
          <h1 style={{ margin: "0 0 6px", fontSize: 22, fontWeight: 800 }}>
            {visit?.patientName || uhid || "Patient"}
          </h1>
          <div style={{ display: "flex", gap: 16, fontSize: 12, opacity: .85, flexWrap: "wrap" }}>
            <span><i className="pi pi-id-card" style={{ marginRight: 4 }} />{visit?.UHID || uhid}</span>
            <span><i className="pi pi-tag" style={{ marginRight: 4 }} />{visitNumber}</span>
            <span><i className="pi pi-calendar" style={{ marginRight: 4 }} />{new Date(visit?.visitDate || Date.now()).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</span>
            <span><i className="pi pi-building" style={{ marginRight: 4 }} />{visit?.department || "General"}</span>
            <span><i className="pi pi-user-edit" style={{ marginRight: 4 }} />{visit?.consultantName || "—"}</span>
          </div>
        </div>
        <button onClick={handleSave} disabled={saving} style={{
          background: saving ? "rgba(255,255,255,.25)" : "#fff", color: C.doctor,
          border: "none", padding: "11px 24px", borderRadius: 10,
          cursor: saving ? "not-allowed" : "pointer", fontWeight: 700, fontSize: 13,
          display: "flex", alignItems: "center", gap: 8, boxShadow: "0 2px 8px rgba(0,0,0,.1)",
        }}>
          {saving ? <><i className="pi pi-spin pi-spinner" /> Saving…</> : <><i className="pi pi-save" /> Save Assessment</>}
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 20 }}>

        {/* LEFT: Forms */}
        <div>

          {/* Vitals from Nurse */}
          <Card title="Vitals — Recorded by Nursing" icon="pi-heart" color={C.nurse}>
            {visit?.vitalsStatus === "Done" ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
                {vitInfo.map(v => (
                  <div key={v.label} style={{ background: C.bg, borderRadius: 8, padding: "10px 14px", border: `1px solid ${C.border}` }}>
                    <div style={{ fontSize: 10, color: C.muted, fontWeight: 600, marginBottom: 2 }}>{v.label}</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: C.dark }}>{v.value}</div>
                  </div>
                ))}
              </div>
            ) : (
              <p style={{ color: C.muted, fontSize: 13, margin: 0 }}>
                <i className="pi pi-clock" style={{ marginRight: 6 }} />Vitals not yet recorded by nurse.
              </p>
            )}
          </Card>

          {/* SOAP */}
          <Card title="SOAP Assessment" icon="pi-file-edit" color={C.doctor} badge="NABH">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <Field label="S — Subjective (Chief Complaint)">
                <Textarea value={soap.subjectiveNote} onChange={v => setSoap(p => ({ ...p, subjectiveNote: v }))}
                  placeholder={visit?.chiefComplaint || "Chief complaint, history…"} rows={4} />
              </Field>
              <Field label="O — Objective (Examination)">
                <Textarea value={soap.objectiveNote} onChange={v => setSoap(p => ({ ...p, objectiveNote: v }))}
                  placeholder="Physical findings, vitals, lab…" rows={4} />
              </Field>
              <Field label="A — Assessment (Diagnosis)">
                <Textarea value={soap.assessmentNote} onChange={v => setSoap(p => ({ ...p, assessmentNote: v }))}
                  placeholder="Clinical assessment, differentials…" rows={4} />
              </Field>
              <Field label="P — Plan">
                <Textarea value={soap.planNote} onChange={v => setSoap(p => ({ ...p, planNote: v }))}
                  placeholder="Treatment plan, medications, follow-up…" rows={4} />
              </Field>
            </div>
          </Card>

          {/* Clinical Examination */}
          <Card title="Clinical Examination" icon="pi-search" color={C.primary}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <Field label="General Examination">
                <Textarea value={soap.generalExamination} onChange={v => setSoap(p => ({ ...p, generalExamination: v }))}
                  placeholder="Conscious, oriented, afebrile…" />
              </Field>
              <Field label="Systemic Examination">
                <Textarea value={soap.systemicExamination} onChange={v => setSoap(p => ({ ...p, systemicExamination: v }))}
                  placeholder="CVS, RS, CNS, Abdomen findings…" />
              </Field>
            </div>
          </Card>

          {/* Diagnosis */}
          <Card title="Diagnosis & Plan" icon="pi-verified" color={C.success}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <Field label="Provisional Diagnosis" required>
                <Input value={soap.provisionalDiagnosis} onChange={v => setSoap(p => ({ ...p, provisionalDiagnosis: v }))}
                  placeholder="e.g. Viral fever, URTI, Type 2 DM…" />
              </Field>
              <Field label="Final Diagnosis">
                <Input value={soap.finalDiagnosis} onChange={v => setSoap(p => ({ ...p, finalDiagnosis: v }))}
                  placeholder="Confirmed diagnosis…" />
              </Field>
              <Field label="Advice / Counselling">
                <Textarea value={soap.advice} onChange={v => setSoap(p => ({ ...p, advice: v }))}
                  placeholder="Diet, lifestyle, precautions…" rows={2} />
              </Field>
              <Field label="Follow-up Date">
                <Input type="date" value={soap.followUpDate} onChange={v => setSoap(p => ({ ...p, followUpDate: v }))} />
              </Field>
            </div>
            <Field label="Additional Notes">
              <Textarea value={soap.doctorNotes} onChange={v => setSoap(p => ({ ...p, doctorNotes: v }))}
                placeholder="Any additional observations…" rows={2} />
            </Field>
          </Card>

          {/* Prescription */}
          <Card title="Prescription" icon="pi-pencil" color={C.warn}>
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr auto", gap: 8, marginBottom: 12, alignItems: "center" }}>
              {[["name","Medicine *"],["dose","Dose"],["frequency","Frequency"],["duration","Duration"],["route","Route"]].map(([k,ph]) => (
                <input key={k} value={newMed[k]} onChange={e => setNewMed(p => ({ ...p, [k]: e.target.value }))}
                  placeholder={ph}
                  style={{ border: `1px solid ${C.border}`, borderRadius: 7, padding: "8px 10px", fontSize: 12, outline: "none", fontFamily: "inherit", color: C.dark }} />
              ))}
              <button onClick={addMed} style={{ background: C.warn, color: "#fff", border: "none", borderRadius: 7, padding: "8px 14px", cursor: "pointer", fontWeight: 600, fontSize: 12 }}>
                + Add
              </button>
            </div>
            {meds.length === 0 ? (
              <p style={{ color: C.muted, fontSize: 12, margin: 0 }}>No medications prescribed.</p>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead><tr style={{ background: C.bg }}>
                  {["Medicine","Dose","Frequency","Duration","Route"].map(h => (
                    <th key={h} style={{ textAlign: "left", padding: "6px 10px", fontWeight: 600, color: C.muted, borderBottom: `1px solid ${C.border}` }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>{meds.map((m, i) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                    {["name","dose","frequency","duration","route"].map(k => (
                      <td key={k} style={{ padding: "7px 10px", color: C.dark }}>{m[k] || "—"}</td>
                    ))}
                  </tr>
                ))}</tbody>
              </table>
            )}
          </Card>

          {/* Investigations */}
          <Card title="Investigation Orders" icon="pi-search-plus" color="#0284c7">
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 2fr auto", gap: 8, marginBottom: 12, alignItems: "center" }}>
              {[["name","Investigation *"],["urgency","Urgency (Routine/STAT)"],["instructions","Special instructions"]].map(([k,ph]) => (
                <input key={k} value={newInvest[k]} onChange={e => setNewInvest(p => ({ ...p, [k]: e.target.value }))}
                  placeholder={ph}
                  style={{ border: `1px solid ${C.border}`, borderRadius: 7, padding: "8px 10px", fontSize: 12, outline: "none", fontFamily: "inherit", color: C.dark }} />
              ))}
              <button onClick={addInvestigation} style={{ background: "#0284c7", color: "#fff", border: "none", borderRadius: 7, padding: "8px 14px", cursor: "pointer", fontWeight: 600, fontSize: 12 }}>
                + Order
              </button>
            </div>
            {invests.length === 0 ? (
              <p style={{ color: C.muted, fontSize: 12, margin: 0 }}>No investigations ordered.</p>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead><tr style={{ background: C.bg }}>
                  {["Investigation","Urgency","Status","Instructions"].map(h => (
                    <th key={h} style={{ textAlign: "left", padding: "6px 10px", fontWeight: 600, color: C.muted, borderBottom: `1px solid ${C.border}` }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>{invests.map((inv, i) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                    <td style={{ padding: "7px 10px", color: C.dark }}>{inv.name || inv.testName}</td>
                    <td style={{ padding: "7px 10px", color: inv.urgency === "STAT" ? C.danger : C.muted }}>{inv.urgency || "Routine"}</td>
                    <td style={{ padding: "7px 10px" }}>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20,
                        background: inv.status === "Resulted" ? "#d1fae5" : "#fef3c7",
                        color: inv.status === "Resulted" ? C.success : C.warn }}>
                        {inv.status || "Ordered"}
                      </span>
                    </td>
                    <td style={{ padding: "7px 10px", color: C.muted }}>{inv.instructions || "—"}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </Card>

        </div>

        {/* RIGHT: Patient Info + Audit */}
        <div>

          <Card title="Patient Details" icon="pi-user" color={C.primary}>
            {[
              ["UHID", visit?.UHID || uhid],
              ["Visit Number", visitNumber],
              ["Visit Type", visit?.visitType || "Consultation"],
              ["Chief Complaint", visit?.chiefComplaint || "—"],
              ["Consultant", visit?.consultantName || "—"],
              ["Department", visit?.department || "—"],
              ["Token", visit?.tokenNumber ? `#${visit.tokenNumber}` : "—"],
              ["Status", visit?.status || "—"],
            ].map(([label, value]) => (
              <div key={label} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "5px 0", borderBottom: `1px solid ${C.border}` }}>
                <span style={{ color: C.muted, fontWeight: 500 }}>{label}</span>
                <span style={{ color: C.dark, fontWeight: 600, textAlign: "right", maxWidth: "55%", wordBreak: "break-word" }}>{value}</span>
              </div>
            ))}
          </Card>

          {/* Quick navigation */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
            {[
              { label: "Full Audit Trail",  icon: "pi-list",    path: `/billing-audit-trail?uhid=${visit?.UHID || uhid}` },
              { label: "Patient Billing",   icon: "pi-receipt", path: `/patient-billing/${visit?.UHID || uhid}` },
              { label: "Patient History",   icon: "pi-clock",   path: `/patient-history?uhid=${visit?.UHID || uhid}` },
            ].map(l => (
              <button key={l.label} onClick={() => navigate(l.path)}
                style={{ padding: "9px 14px", background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
                  color: C.dark, fontWeight: 500, fontSize: 12, cursor: "pointer",
                  display: "flex", alignItems: "center", gap: 8 }}>
                <i className={`pi ${l.icon}`} style={{ color: C.muted }} />{l.label}
              </button>
            ))}
          </div>

          {/* Audit Trail */}
          <Card title="Audit Trail" icon="pi-list" color={C.success} badge="LIVE">
            {audit.length === 0 ? (
              <div style={{ textAlign: "center", padding: "20px 0", color: C.muted }}>
                <i className="pi pi-info-circle" style={{ fontSize: 28, marginBottom: 8, display: "block" }} />
                <p style={{ fontSize: 12, margin: 0 }}>No audit entries yet.<br />Save assessment to create first entry.</p>
              </div>
            ) : (
              <div>
                {audit.map((t, i) => <AuditItem key={t._id || i} trigger={t} />)}
                <button onClick={loadAudit} style={{ marginTop: 10, width: "100%", padding: "7px", background: "none", border: `1px solid ${C.border}`, borderRadius: 6, color: C.muted, cursor: "pointer", fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                  <i className="pi pi-refresh" /> Refresh
                </button>
              </div>
            )}
          </Card>

        </div>
      </div>
    </div>
  );
}
