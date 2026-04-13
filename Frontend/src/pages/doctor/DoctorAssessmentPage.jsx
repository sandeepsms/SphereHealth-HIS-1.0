import React, { useState, useEffect } from "react";
import axios from "axios";
import API_ENDPOINTS from "../../config/api";

/* ── Design tokens ── */
const C = {
  bg: "#f0f2f5", card: "#fff", border: "#e2e6ea", text: "#1a1d23", muted: "#6b7280",
  accent: "#1e40af", accentL: "#eff6ff",
  green: "#16a34a", greenL: "#dcfce7",
  red: "#dc2626", redL: "#fef2f2",
  amber: "#d97706", amberL: "#fffbeb",
  blue: "#0ea5e9", blueL: "#f0f9ff",
  grayL: "#f9fafb",
  purple: "#7c3aed", purpleL: "#f5f3ff",
  teal: "#0d9488", tealL: "#f0fdfa",
  orange: "#ea580c", orangeL: "#fff7ed",
  pink: "#db2777", pinkL: "#fdf2f8",
  slate: "#1e293b", slateMid: "#334155",
  stat: "#be185d", statL: "#fdf2f8",
};

const fld = { padding: "8px 11px", border: `1.5px solid ${C.border}`, borderRadius: 8, fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: C.text, outline: "none", background: "white", width: "100%", boxSizing: "border-box" };

const ORDER_TYPES = [
  { key: "medication",   label: "💊 Medication",          bg: "#dbeafe",        color: C.accent },
  { key: "iv_fluid",     label: "💧 IV Infusion",          bg: "#ccfbf1",        color: C.teal },
  { key: "blood",        label: "🩸 Blood Product",        bg: "#fecaca",        color: "#9f1239" },
  { key: "lab",          label: "🔬 Lab Investigation",    bg: "#ede9fe",        color: C.purple },
  { key: "radiology",    label: "📷 Radiology / Imaging",  bg: "#fef3c7",        color: "#92400e" },
  { key: "procedure",    label: "⚕️ Procedure",            bg: "#fed7aa",        color: C.orange },
  { key: "diet",         label: "🥗 Diet / Nutrition",     bg: C.greenL,        color: C.green },
  { key: "consultation", label: "👨‍⚕️ Consultation",       bg: "#fce7f3",        color: C.pink },
  { key: "nursing",      label: "🩺 Nursing Order",        bg: "#d1fae5",        color: "#065f46" },
  { key: "physio",       label: "🏃 Physiotherapy",        bg: "#e0f2fe",        color: "#0369a1" },
];

const TYPE_STYLE = {
  medication:   { bg: "#dbeafe", color: C.accent,  label: "Med" },
  iv_fluid:     { bg: "#ccfbf1", color: C.teal,    label: "Infusion" },
  blood:        { bg: "#fecaca", color: "#9f1239",  label: "Blood" },
  investigation:{ bg: "#ede9fe", color: C.purple,  label: "Lab" },
  lab:          { bg: "#ede9fe", color: C.purple,  label: "Lab" },
  radiology:    { bg: "#fef3c7", color: "#92400e", label: "Radiology" },
  procedure:    { bg: "#fed7aa", color: C.orange,  label: "Procedure" },
  diet:         { bg: C.greenL, color: C.green,    label: "Diet" },
  consultation: { bg: "#fce7f3", color: C.pink,    label: "Consult" },
  nursing:      { bg: "#d1fae5", color: "#065f46", label: "Nursing" },
  physio:       { bg: "#e0f2fe", color: "#0369a1", label: "Physio" },
  other:        { bg: C.grayL,  color: C.muted,   label: "Other" },
};

const STATUS_STYLE = {
  active:    { bg: "#dbeafe", color: C.accent  },
  pending:   { bg: C.amberL, color: "#92400e" },
  scheduled: { bg: C.purpleL,color: C.purple  },
  completed: { bg: C.greenL, color: C.green   },
  held:      { bg: "#fef3c7",color: "#b45309" },
  cancelled: { bg: C.grayL,  color: "#64748b" },
};

const PRIORITY_COLOR = {
  STAT:    { color: "#be185d", bg: "#fdf2f8" },
  URGENT:  { color: C.red,    bg: C.redL },
  ROUTINE: { color: C.muted,  bg: "transparent" },
};

function VitalCard({ label, value, unit, status, statusColor }) {
  const isAbnormal = statusColor === "red";
  const isWarn     = statusColor === "amber";
  return (
    <div style={{ background: isAbnormal ? C.redL : isWarn ? C.amberL : C.grayL, border: `1.5px solid ${isAbnormal ? "#fca5a5" : isWarn ? "#fcd34d" : C.border}`, borderRadius: 9, padding: "10px 12px", textAlign: "center" }}>
      <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".7px", color: C.muted, marginBottom: 4 }}>{label}</div>
      <div style={{ fontFamily: "monospace", fontSize: 18, fontWeight: 700, color: isAbnormal ? C.red : isWarn ? C.amber : C.text, lineHeight: 1 }}>{value || "—"}</div>
      {unit && <div style={{ fontSize: 9, color: C.muted, marginTop: 2 }}>{unit}</div>}
      {status && <div style={{ fontSize: 10, marginTop: 3, color: isAbnormal ? C.red : isWarn ? C.amber : C.green }}>↑ {status}</div>}
    </div>
  );
}

function FG({ label, children, style }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5, ...style }}>
      <label style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".7px", color: C.muted }}>{label}</label>
      {children}
    </div>
  );
}

function SectionCard({ title, children, open: initOpen = true }) {
  const [open, setOpen] = useState(initOpen);
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, marginBottom: 14, overflow: "hidden" }}>
      <div onClick={() => setOpen(p => !p)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 18px", background: C.grayL, cursor: "pointer", userSelect: "none", borderBottom: open ? `1px solid ${C.border}` : "none" }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: C.text }}>{title}</div>
        <span style={{ fontSize: 12, color: C.muted, transform: open ? "none" : "rotate(-90deg)", transition: "transform .2s", display: "inline-block" }}>▾</span>
      </div>
      {open && <div style={{ padding: 18 }}>{children}</div>}
    </div>
  );
}

export default function DoctorAssessmentPage() {
  const [search,   setSearch]   = useState("");
  const [patient,  setPatient]  = useState(null);
  const [ipdNo,    setIpdNo]    = useState("");
  const [loading,  setLoading]  = useState(false);
  const [toast,    setToast]    = useState(null);
  const [activeTab,setActiveTab]= useState("assessment");
  const [notes,    setNotes]    = useState([]);
  const [allOrders,setAllOrders]= useState([]);
  const [orderModal,setOrderModal] = useState(false);
  const [editingNote,setEditingNote] = useState(null);

  // Form state
  const [form, setForm] = useState({
    doctorName: "", doctorRegNo: "", shift: "morning",
    soap: { subjective: "", objective: "", assessment: "", plan: "" },
    vitals: { bp_sys: "", bp_dia: "", pulse: "", temp: "", rr: "", spo2: "", bsl: "", gcs: "", urine: "" },
    provisionalDiagnosis: "", finalDiagnosis: "", investigations: "",
  });
  const [orders, setOrders] = useState([]);
  const [newOrder, setNewOrder] = useState({ type: "medication", instruction: "", dose: "", route: "", frequency: "", duration: "", notes: "", priority: "ROUTINE" });

  const showToast = (msg, type = "ok") => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000); };

  const fetchNotes = async (ipd) => {
    try {
      const { data } = await axios.get(`${API_ENDPOINTS.DOCTOR_NOTES}/ipd/${ipd}`);
      setNotes(Array.isArray(data) ? data : data.data || []);
    } catch { /* silent */ }
  };

  const fetchOrders = async (ipd) => {
    try {
      const { data } = await axios.get(`${API_ENDPOINTS.DOCTOR_NOTES}/pending-orders/${ipd}`);
      setAllOrders(Array.isArray(data) ? data : data.data || []);
    } catch { /* silent */ }
  };

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!search.trim()) return;
    setLoading(true);
    try {
      const { data } = await axios.get(`${API_ENDPOINTS.ADMISSIONS}?uhid=${search.trim()}`);
      const arr = Array.isArray(data) ? data : data.data || [];
      const active = arr.find(a => a.status === "admitted") || arr[0];
      if (active) {
        setPatient(active);
        const ipd = active.ipdNo || active.admissionNumber || active._id;
        setIpdNo(ipd);
        await fetchNotes(ipd);
        await fetchOrders(ipd);
        showToast("Patient loaded", "ok");
      } else showToast("No active admission found", "warn");
    } catch { showToast("Patient not found", "err"); }
    finally { setLoading(false); }
  };

  const sf   = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const ssoap = (k, v) => setForm(p => ({ ...p, soap: { ...p.soap, [k]: v } }));
  const svital = (k, v) => setForm(p => ({ ...p, vitals: { ...p.vitals, [k]: v } }));

  const addOrder = () => {
    if (!newOrder.instruction.trim()) return;
    setOrders(p => [...p, { ...newOrder, _id: Date.now().toString(), status: "active", nurseStatus: "pending", orderedBy: form.doctorName || "Dr. Admin", orderedAt: new Date().toISOString() }]);
    setNewOrder({ type: "medication", instruction: "", dose: "", route: "", frequency: "", duration: "", notes: "", priority: "ROUTINE" });
    setOrderModal(false);
    showToast("Order added", "ok");
  };

  const saveNote = async (status = "draft") => {
    if (!ipdNo) { showToast("Search for a patient first", "warn"); return; }
    setLoading(true);
    const payload = {
      ipdNo,
      patient: patient?._id || patient?.patient?._id || "000000000000000000000000",
      patientName: patient?.patientName || patient?.patient?.name || "",
      patientUHID: patient?.uhid || patient?.UHID || search,
      doctor: "000000000000000000000001",
      doctorName: form.doctorName, doctorRegNo: form.doctorRegNo,
      shift: form.shift,
      soap: form.soap,
      vitals: {
        bp: { systolic: Number(form.vitals.bp_sys), diastolic: Number(form.vitals.bp_dia) },
        pulse: Number(form.vitals.pulse), temp: Number(form.vitals.temp),
        rr: Number(form.vitals.rr), spo2: Number(form.vitals.spo2),
      },
      provisionalDiagnosis: form.provisionalDiagnosis, finalDiagnosis: form.finalDiagnosis,
      investigations: form.investigations ? form.investigations.split(",").map(s => s.trim()).filter(Boolean) : [],
      orders: orders.map(o => ({
        type: ["medication","iv_fluid","procedure","diet"].includes(o.type) ? o.type : "other",
        instruction: o.instruction, route: o.route || "", frequency: o.frequency || "", duration: o.duration || "", notes: o.notes || "",
      })),
      status,
    };
    try {
      if (editingNote) {
        await axios.put(`${API_ENDPOINTS.DOCTOR_NOTES}/${editingNote._id}`, payload);
        showToast("Note updated", "ok");
      } else {
        await axios.post(API_ENDPOINTS.DOCTOR_NOTES, payload);
        showToast(status === "signed" ? "Note signed ✓" : "Draft saved", "ok");
      }
      setOrders([]);
      setForm({ doctorName: "", doctorRegNo: "", shift: "morning", soap: { subjective: "", objective: "", assessment: "", plan: "" }, vitals: { bp_sys: "", bp_dia: "", pulse: "", temp: "", rr: "", spo2: "", bsl: "", gcs: "", urine: "" }, provisionalDiagnosis: "", finalDiagnosis: "", investigations: "" });
      setEditingNote(null);
      await fetchNotes(ipdNo); await fetchOrders(ipdNo);
    } catch (err) { showToast(err?.response?.data?.message || "Save failed", "err"); }
    finally { setLoading(false); }
  };

  const signNote = async (noteId) => {
    try { await axios.patch(`${API_ENDPOINTS.DOCTOR_NOTES}/${noteId}/sign`); showToast("Note signed ✓", "ok"); await fetchNotes(ipdNo); }
    catch { showToast("Sign failed", "err"); }
  };

  const vitalCards = !patient ? [] : [
    { label: "BP",    value: `${form.vitals.bp_sys || "—"}/${form.vitals.bp_dia || "—"}`, unit: "mmHg",   status: Number(form.vitals.bp_sys) > 160 ? "High" : "Normal", statusColor: Number(form.vitals.bp_sys) > 160 ? "red" : "ok" },
    { label: "PULSE", value: form.vitals.pulse || "—",    unit: "/min",   status: Number(form.vitals.pulse) > 100 ? "High" : "Normal", statusColor: "ok" },
    { label: "TEMP",  value: form.vitals.temp ? `${form.vitals.temp}` : "—", unit: "°F", status: Number(form.vitals.temp) > 99.5 ? "Low grade" : "Normal", statusColor: Number(form.vitals.temp) > 99.5 ? "amber" : "ok" },
    { label: "SPO₂",  value: form.vitals.spo2 ? `${form.vitals.spo2}` : "—", unit: "%", status: Number(form.vitals.spo2) < 95 ? "Low" : "Acceptable", statusColor: Number(form.vitals.spo2) < 95 ? "red" : "ok" },
    { label: "RR",    value: form.vitals.rr || "—",       unit: "/min",   status: "Normal", statusColor: "ok" },
    { label: "BSL",   value: form.vitals.bsl || "—",      unit: "mg/dL",  status: Number(form.vitals.bsl) > 200 ? "High" : "Normal", statusColor: Number(form.vitals.bsl) > 200 ? "red" : "ok" },
    { label: "GCS",   value: form.vitals.gcs || "—",      unit: "",       status: "Normal", statusColor: "ok" },
    { label: "URINE", value: form.vitals.urine || "—",    unit: "mL/8hr", status: "Adequate", statusColor: "ok" },
  ];

  const tabs = [
    { id: "assessment", label: "Assessment" },
    { id: "orders",     label: "Active Orders",   badge: allOrders.length },
    { id: "notes",      label: "Progress Notes",  badge: notes.length },
    { id: "pending",    label: "Pending / Scheduled", badge: allOrders.filter(o => o.nurseStatus === "pending").length },
    { id: "results",    label: "Results / Reports" },
    { id: "discharge",  label: "Discharge Summary" },
  ];

  let orderCounter = 1;

  return (
    <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: C.text }}>

      {/* ── Patient Search ── */}
      {!patient && (
        <div style={{ maxWidth: 640, margin: "0 auto", paddingTop: 20 }}>
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 28, boxShadow: "0 4px 24px rgba(0,0,0,.06)" }}>
            <div style={{ fontWeight: 700, fontSize: 18, color: C.slate, marginBottom: 6 }}>Doctor Assessment & Order Entry</div>
            <div style={{ color: C.muted, fontSize: 13, marginBottom: 20 }}>Enter UHID or IPD Number to load patient</div>
            <form onSubmit={handleSearch} style={{ display: "flex", gap: 10 }}>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="UHID / IPD No…" style={{ ...fld, flex: 1 }} />
              <button type="submit" style={{ padding: "9px 22px", background: C.accent, color: "white", border: "none", borderRadius: 8, fontWeight: 700, cursor: "pointer", fontFamily: "'DM Sans',sans-serif" }}>
                {loading ? "Loading…" : "Search"}
              </button>
            </form>
          </div>
        </div>
      )}

      {patient && (
        <>
          {/* ── Patient Header (dark slate) ── */}
          <div style={{ background: C.slate, color: "white", borderRadius: 14, padding: "16px 22px", marginBottom: 0, position: "relative", overflow: "hidden" }}>
            <div style={{ position: "absolute", top: -30, right: -30, width: 160, height: 160, background: "radial-gradient(circle,rgba(56,189,248,.15),transparent 70%)", pointerEvents: "none" }} />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 20, alignItems: "center" }}>
                <div>
                  <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".9px", color: "#64748b" }}>Patient</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: "white" }}>{patient.patientName || patient.patient?.name || "—"}</div>
                </div>
                {[
                  { label: "ID",          value: patient.uhid || patient.UHID || search },
                  { label: "Age / Sex",   value: `${patient.age || patient.patient?.age || "?"}Y / ${(patient.gender || patient.patient?.gender || "M").charAt(0).toUpperCase()}` },
                  { label: "Ward / Bed",  value: `${patient.wardName || "ICU"} — Bed ${patient.bedNumber || "—"}` },
                  { label: "Admit Date",  value: patient.admissionDate ? new Date(patient.admissionDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—" },
                  { label: "Day",         value: patient.admissionDate ? `D${Math.max(1, Math.ceil((Date.now() - new Date(patient.admissionDate)) / 86400000))}` : "D1" },
                  { label: "Diagnosis",   value: patient.diagnosis || patient.admittingDiagnosis || "—" },
                  { label: "Consultant",  value: patient.doctorName || patient.consultantName || "—" },
                ].map(f => (
                  <div key={f.label}>
                    <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".9px", color: "#64748b" }}>{f.label}</div>
                    <div style={{ fontWeight: 600, fontSize: 13, color: "#e2e8f0" }}>{f.value}</div>
                  </div>
                ))}
                {(patient.allergies || patient.knownAllergies || []).map(a => (
                  <span key={a} style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "rgba(220,38,38,.25)", border: "1px solid rgba(220,38,38,.4)", color: "#fca5a5", padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 700 }}>⚠ {a}</span>
                ))}
                {patient.bloodGroup && (
                  <span style={{ background: "rgba(220,38,38,.2)", border: "1px solid rgba(220,38,38,.35)", color: "#fca5a5", padding: "2px 10px", borderRadius: 4, fontFamily: "monospace", fontSize: 13, fontWeight: 700 }}>{patient.bloodGroup}</span>
                )}
                <span style={{ background: "rgba(124,58,237,.3)", border: "1px solid rgba(124,58,237,.4)", color: "#c4b5fd", padding: "3px 10px", borderRadius: 5, fontSize: 10, fontWeight: 700 }}>
                  {patient.admissionType?.toUpperCase() || "IPD"}
                </span>
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "flex-start", flexShrink: 0 }}>
                {["🖨️ Print","📊 Trend","📜 History","🔄 Transfer"].map(a => (
                  <button key={a} style={{ padding: "6px 12px", border: "1px solid #334155", borderRadius: 7, background: "rgba(255,255,255,.06)", color: "#94a3b8", fontFamily: "'DM Sans',sans-serif", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>{a}</button>
                ))}
                <button onClick={() => { setPatient(null); setSearch(""); setNotes([]); setOrders([]); }}
                  style={{ padding: "6px 12px", border: "1px solid #334155", borderRadius: 7, background: "rgba(255,255,255,.06)", color: "#94a3b8", fontFamily: "'DM Sans',sans-serif", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>✕</button>
              </div>
            </div>
          </div>

          {/* ── Vitals Strip ── */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(8,1fr)", gap: 8, margin: "8px 0 10px" }}>
            {vitalCards.map(v => <VitalCard key={v.label} {...v} />)}
          </div>

          {/* ── Tab Nav ── */}
          <div style={{ display: "flex", gap: 2, background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 5, marginBottom: 14, overflowX: "auto" }}>
            {tabs.map(t => (
              <button key={t.id} onClick={() => setActiveTab(t.id)}
                style={{ padding: "9px 18px", borderRadius: 8, border: "none", background: activeTab === t.id ? C.slate : "transparent", color: activeTab === t.id ? "white" : C.muted, fontFamily: "'DM Sans',sans-serif", fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 6, boxShadow: activeTab === t.id ? "0 2px 8px rgba(30,41,59,.3)" : "none", transition: "all .2s" }}>
                {t.label}
                {t.badge ? <span style={{ background: t.id === "orders" ? C.stat : C.red, color: "white", padding: "1px 6px", borderRadius: 10, fontSize: 9, fontWeight: 700 }}>{t.badge}</span> : null}
              </button>
            ))}
          </div>

          {/* ══ ASSESSMENT TAB ══ */}
          {activeTab === "assessment" && (
            <>
              <SectionCard title="👨‍⚕️ Doctor & Shift">
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>
                  <FG label="Doctor Name *"><input style={fld} value={form.doctorName} onChange={e => sf("doctorName", e.target.value)} placeholder="Dr. …" /></FG>
                  <FG label="Reg. No"><input style={fld} value={form.doctorRegNo} onChange={e => sf("doctorRegNo", e.target.value)} placeholder="MCI / State Reg" /></FG>
                  <FG label="Shift">
                    <select style={fld} value={form.shift} onChange={e => sf("shift", e.target.value)}>
                      {["morning","afternoon","evening","night"].map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
                    </select>
                  </FG>
                  <FG label="Date"><input style={fld} type="date" defaultValue={new Date().toISOString().slice(0,10)} /></FG>
                </div>
              </SectionCard>

              <SectionCard title="📊 Vitals Entry">
                <div style={{ display: "grid", gridTemplateColumns: "repeat(8,1fr)", gap: 10 }}>
                  {[
                    { k:"bp_sys",  label:"BP Sys",    unit:"mmHg" },
                    { k:"bp_dia",  label:"BP Dia",    unit:"mmHg" },
                    { k:"pulse",   label:"Pulse",     unit:"/min" },
                    { k:"temp",    label:"Temp",      unit:"°F" },
                    { k:"spo2",    label:"SpO₂",      unit:"%" },
                    { k:"rr",      label:"RR",        unit:"/min" },
                    { k:"bsl",     label:"BSL",       unit:"mg/dL" },
                    { k:"gcs",     label:"GCS",       unit:"/ 15" },
                    { k:"urine",   label:"Urine",     unit:"mL/8h" },
                  ].map(v => (
                    <div key={v.k} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                      <label style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".7px", color: C.muted }}>{v.label} <span style={{ color: C.muted, fontWeight: 400 }}>({v.unit})</span></label>
                      <input type="number" value={form.vitals[v.k]} onChange={e => svital(v.k, e.target.value)} style={fld} />
                    </div>
                  ))}
                </div>
              </SectionCard>

              <SectionCard title="📝 SOAP Notes">
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  {[
                    { k:"subjective", label:"S — Subjective (Chief Complaints)", ph:"Patient complaints, history of present illness…" },
                    { k:"objective",  label:"O — Objective (Examination Findings)", ph:"Examination findings, investigations…" },
                    { k:"assessment", label:"A — Assessment (Diagnosis)", ph:"Clinical assessment, working diagnosis…" },
                    { k:"plan",       label:"P — Plan (Treatment Plan)", ph:"Treatment plan, procedures, follow up…" },
                  ].map(s => (
                    <FG key={s.k} label={s.label}>
                      <textarea style={{ ...fld, minHeight: 90, resize: "vertical" }} value={form.soap[s.k]} onChange={e => ssoap(s.k, e.target.value)} placeholder={s.ph} />
                    </FG>
                  ))}
                </div>
              </SectionCard>

              <SectionCard title="🏥 Diagnosis">
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                  <FG label="Provisional Diagnosis"><input style={fld} value={form.provisionalDiagnosis} onChange={e => sf("provisionalDiagnosis", e.target.value)} placeholder="Working diagnosis…" /></FG>
                  <FG label="Final Diagnosis / ICD-10"><input style={fld} value={form.finalDiagnosis} onChange={e => sf("finalDiagnosis", e.target.value)} placeholder="Final diagnosis + ICD code…" /></FG>
                </div>
                <FG label="Investigations Ordered (comma separated)">
                  <input style={fld} value={form.investigations} onChange={e => sf("investigations", e.target.value)} placeholder="CBC, LFT, RFT, Chest X-Ray…" />
                </FG>
              </SectionCard>

              {/* ── Order Type Buttons ── */}
              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 18, marginBottom: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".8px", color: C.muted, marginBottom: 12 }}>Add Order</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {ORDER_TYPES.map(ot => (
                    <button key={ot.key} onClick={() => { setNewOrder(p => ({ ...p, type: ot.key })); setOrderModal(true); }}
                      style={{ display: "flex", alignItems: "center", gap: 7, padding: "9px 16px", borderRadius: 9, border: `1.5px solid ${ot.bg}`, fontFamily: "'DM Sans',sans-serif", fontSize: 12, fontWeight: 700, cursor: "pointer", background: "white", color: ot.color, transition: "all .2s" }}>
                      {ot.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* ── Orders on this note ── */}
              {orders.length > 0 && (
                <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, marginBottom: 14, overflow: "hidden" }}>
                  <div style={{ padding: "12px 18px", background: C.grayL, fontWeight: 700, fontSize: 13, borderBottom: `1px solid ${C.border}` }}>
                    Orders on this note ({orders.length})
                  </div>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr>{["#","TYPE","ORDER","DOSE / RATE","FREQ / DURATION","ROUTE","PRIORITY","STATUS","ORDERED BY",""].map(h => (
                          <th key={h} style={{ background: C.slate, color: "#cbd5e1", padding: "10px 13px", textAlign: "left", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".8px", whiteSpace: "nowrap" }}>{h}</th>
                        ))}</tr>
                      </thead>
                      <tbody>
                        {orders.map((o, i) => {
                          const ts = TYPE_STYLE[o.type] || TYPE_STYLE.other;
                          const pc = PRIORITY_COLOR[o.priority] || PRIORITY_COLOR.ROUTINE;
                          return (
                            <tr key={o._id} style={{ borderBottom: `1px solid ${C.border}`, background: o.priority === "STAT" ? "#fff8f8" : "white" }}>
                              <td style={{ padding: "10px 13px", fontFamily: "monospace", fontSize: 11, color: C.muted }}>{String(i+1).padStart(3,"0")}</td>
                              <td style={{ padding: "10px 13px" }}>
                                <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 700, background: ts.bg, color: ts.color }}>{ts.label}</span>
                              </td>
                              <td style={{ padding: "10px 13px", minWidth: 180 }}>
                                <div style={{ fontWeight: 600, fontSize: 13 }}>{o.instruction}</div>
                                {o.notes && <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{o.notes}</div>}
                              </td>
                              <td style={{ padding: "10px 13px", fontFamily: "monospace", fontSize: 12 }}>{o.dose || "—"}</td>
                              <td style={{ padding: "10px 13px", fontSize: 12 }}>{[o.frequency, o.duration].filter(Boolean).join(" / ") || "—"}</td>
                              <td style={{ padding: "10px 13px", fontSize: 12 }}>{o.route || "—"}</td>
                              <td style={{ padding: "10px 13px" }}>
                                <span style={{ color: pc.color, fontWeight: 800, fontSize: 11 }}>
                                  {o.priority === "STAT" ? "⚡ " : o.priority === "URGENT" ? "▲ " : ""}{o.priority}
                                </span>
                              </td>
                              <td style={{ padding: "10px 13px" }}>
                                <span style={{ padding: "3px 9px", borderRadius: 4, fontSize: 9, fontWeight: 700, ...STATUS_STYLE.active }}>ACTIVE</span>
                              </td>
                              <td style={{ padding: "10px 13px", fontSize: 11, color: C.muted }}>{form.doctorName || "Dr. Admin"}</td>
                              <td style={{ padding: "10px 13px" }}>
                                <div style={{ display: "flex", gap: 3 }}>
                                  {["—","‖","⊘","🖨"].map(a => (
                                    <button key={a} onClick={() => a === "⊘" && setOrders(p => p.filter(x => x._id !== o._id))}
                                      style={{ width: 26, height: 26, borderRadius: 5, border: `1.5px solid ${C.border}`, background: "white", cursor: "pointer", fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center" }}>{a}</button>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Save buttons */}
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginBottom: 24 }}>
                <button onClick={() => saveNote("draft")} disabled={loading}
                  style={{ padding: "10px 24px", border: `1.5px solid ${C.border}`, borderRadius: 8, background: "white", color: C.muted, fontFamily: "'DM Sans',sans-serif", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>💾 Save Draft</button>
                <button onClick={() => saveNote("signed")} disabled={loading}
                  style={{ padding: "10px 24px", background: C.green, color: "white", border: "none", borderRadius: 8, fontFamily: "'DM Sans',sans-serif", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>✅ Sign & Submit</button>
              </div>
            </>
          )}

          {/* ══ ACTIVE ORDERS TAB ══ */}
          {activeTab === "orders" && (
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
              <div style={{ padding: "14px 20px", borderBottom: `1px solid ${C.border}`, background: C.grayL, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>Active Doctor Orders</div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <select style={{ ...fld, width: 140 }}><option>All Types</option>{ORDER_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}</select>
                  <button onClick={() => setActiveTab("assessment")} style={{ padding: "7px 16px", background: C.accent, color: "white", border: "none", borderRadius: 7, fontWeight: 700, cursor: "pointer", fontSize: 12 }}>+ New Note</button>
                </div>
              </div>
              {allOrders.length === 0 ? (
                <div style={{ textAlign: "center", padding: "48px 0", color: C.muted }}>No active orders for IPD {ipdNo}</div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr>{["#","TYPE","ORDER","DOSE / RATE","FREQ / DURATION","ROUTE","PRIORITY","SCHEDULED","STATUS","ORDERED BY","ACTIONS"].map(h => (
                        <th key={h} style={{ background: C.slate, color: "#cbd5e1", padding: "10px 13px", textAlign: "left", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".8px", whiteSpace: "nowrap" }}>{h}</th>
                      ))}</tr>
                    </thead>
                    <tbody>
                      {allOrders.map((o, i) => {
                        const ts = TYPE_STYLE[o.type] || TYPE_STYLE.other;
                        return (
                          <tr key={i} style={{ borderBottom: `1px solid ${C.border}`, background: "white" }}
                            onMouseEnter={e => e.currentTarget.style.background = "#f8faff"}
                            onMouseLeave={e => e.currentTarget.style.background = "white"}>
                            <td style={{ padding: "10px 13px", fontFamily: "monospace", fontSize: 11, color: C.muted }}>{String(i+1).padStart(3,"0")}</td>
                            <td style={{ padding: "10px 13px" }}><span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 700, background: ts.bg, color: ts.color }}>{ts.label}</span></td>
                            <td style={{ padding: "10px 13px", minWidth: 180 }}><div style={{ fontWeight: 600 }}>{o.instruction}</div><div style={{ fontSize: 11, color: C.muted }}>{o.notes || ""}</div></td>
                            <td style={{ padding: "10px 13px", fontFamily: "monospace", fontSize: 12 }}>—</td>
                            <td style={{ padding: "10px 13px", fontSize: 12 }}>{o.frequency || "—"}</td>
                            <td style={{ padding: "10px 13px", fontSize: 12 }}>{o.route || "—"}</td>
                            <td style={{ padding: "10px 13px", fontSize: 11, color: C.muted }}>Routine</td>
                            <td style={{ padding: "10px 13px" }}><span style={{ display: "inline-flex", alignItems: "center", gap: 4, background: C.purpleL, border: "1px solid #c4b5fd", color: C.purple, padding: "3px 8px", borderRadius: 5, fontSize: 10, fontWeight: 700, fontFamily: "monospace" }}>🗓 Ongoing</span></td>
                            <td style={{ padding: "10px 13px" }}><span style={{ padding: "3px 9px", borderRadius: 4, fontSize: 9, fontWeight: 700, ...STATUS_STYLE.active }}>ACTIVE</span></td>
                            <td style={{ padding: "10px 13px", fontSize: 11, color: C.muted }}>{o.doctorName || "—"}<div style={{ fontSize: 9, color: C.muted }}>{o.visitDate ? new Date(o.visitDate).toLocaleDateString() : ""}</div></td>
                            <td style={{ padding: "10px 13px" }}><div style={{ display: "flex", gap: 3 }}>{["—","‖","⊘","🖨"].map(a => <button key={a} style={{ width: 26, height: 26, borderRadius: 5, border: `1.5px solid ${C.border}`, background: "white", cursor: "pointer", fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center" }}>{a}</button>)}</div></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ══ PROGRESS NOTES TAB ══ */}
          {activeTab === "notes" && (
            <div>
              <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
                <button onClick={() => setActiveTab("assessment")} style={{ padding: "7px 16px", background: C.accent, color: "white", border: "none", borderRadius: 7, fontWeight: 700, cursor: "pointer", fontSize: 12 }}>+ New Note</button>
              </div>
              {notes.length === 0 ? (
                <div style={{ textAlign: "center", padding: "48px 0", color: C.muted, background: C.card, borderRadius: 12, border: `1px solid ${C.border}` }}>No progress notes yet</div>
              ) : (
                notes.map((n, i) => (
                  <div key={n._id || i} style={{ background: "white", border: `1px solid ${C.border}`, borderRadius: 10, padding: "14px 16px", marginBottom: 10, display: "grid", gridTemplateColumns: "64px 1fr auto", gap: 14 }}>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                      <span style={{ fontFamily: "monospace", fontSize: 11, fontWeight: 600 }}>{new Date(n.visitDate || n.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                      <span style={{ fontSize: 9, color: C.muted }}>{new Date(n.visitDate || n.createdAt).toLocaleDateString()}</span>
                      <span style={{ width: 10, height: 10, borderRadius: "50%", background: n.status === "signed" ? C.green : C.amber, display: "block", marginTop: 3, boxShadow: `0 0 0 2px ${n.status === "signed" ? C.green : C.amber}`, outline: "3px solid white" }} />
                    </div>
                    <div>
                      <div style={{ display: "flex", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                        <span style={{ padding: "3px 10px", borderRadius: 5, fontSize: 10, fontWeight: 700, background: n.status === "signed" ? C.greenL : C.amberL, color: n.status === "signed" ? C.green : "#92400e" }}>{n.status?.toUpperCase()}</span>
                        <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 700, background: "#dbeafe", color: C.accent }}>{n.shift?.toUpperCase()}</span>
                        <span style={{ fontSize: 11, color: C.muted }}>{n.doctorName || "—"}</span>
                      </div>
                      {n.soap?.assessment && <div style={{ fontSize: 12.5, lineHeight: 1.6, marginBottom: 4 }}><strong>A:</strong> {n.soap.assessment}</div>}
                      {n.soap?.plan && <div style={{ fontSize: 12.5, lineHeight: 1.6, marginBottom: 4 }}><strong>P:</strong> {n.soap.plan}</div>}
                      {n.orders?.length > 0 && <div style={{ fontSize: 11, color: C.muted }}>{n.orders.length} order(s)</div>}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {n.status === "draft" && <button onClick={() => signNote(n._id)} style={{ padding: "4px 10px", border: `1.5px solid ${C.green}`, borderRadius: 6, background: "white", fontSize: 11, fontWeight: 600, cursor: "pointer", color: C.green }}>Sign</button>}
                      <button style={{ padding: "4px 10px", border: `1.5px solid ${C.border}`, borderRadius: 6, background: "white", fontSize: 11, fontWeight: 600, cursor: "pointer", color: C.muted }}>View</button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* ══ PENDING TAB ══ */}
          {activeTab === "pending" && (
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
              <div style={{ padding: "14px 20px", borderBottom: `1px solid ${C.border}`, background: C.grayL, fontWeight: 700, fontSize: 14 }}>
                Pending / Scheduled — {allOrders.filter(o => o.nurseStatus === "pending").length} item(s)
              </div>
              {allOrders.filter(o => o.nurseStatus === "pending").length === 0 ? (
                <div style={{ textAlign: "center", padding: "40px 0", color: C.muted }}>All orders actioned ✓</div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr>{["#","TYPE","ORDER","ROUTE","FREQUENCY","DOCTOR","DATE"].map(h => (
                        <th key={h} style={{ background: C.slate, color: "#cbd5e1", padding: "10px 13px", textAlign: "left", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".8px" }}>{h}</th>
                      ))}</tr>
                    </thead>
                    <tbody>
                      {allOrders.filter(o => o.nurseStatus === "pending").map((o, i) => (
                        <tr key={i} style={{ background: C.amberL, borderBottom: `1px solid ${C.border}` }}>
                          <td style={{ padding: "10px 13px", fontFamily: "monospace", fontSize: 11, color: C.muted }}>{String(i+1).padStart(3,"0")}</td>
                          <td style={{ padding: "10px 13px" }}><span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 700, background: "#fef3c7", color: "#92400e" }}>{o.type?.replace("_"," ").toUpperCase()}</span></td>
                          <td style={{ padding: "10px 13px", fontSize: 12 }}>{o.instruction}</td>
                          <td style={{ padding: "10px 13px", fontSize: 12 }}>{o.route || "—"}</td>
                          <td style={{ padding: "10px 13px", fontSize: 12 }}>{o.frequency || "—"}</td>
                          <td style={{ padding: "10px 13px", fontSize: 12 }}>{o.doctorName || "—"}</td>
                          <td style={{ padding: "10px 13px", fontSize: 11, fontFamily: "monospace" }}>{o.visitDate ? new Date(o.visitDate).toLocaleDateString() : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Other tabs placeholder */}
          {(activeTab === "results" || activeTab === "discharge") && (
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "48px 0", textAlign: "center", color: C.muted }}>
              {activeTab === "results" ? "Results & Reports module coming soon" : <a href="/discharge-summary" style={{ color: C.accent, fontWeight: 600 }}>→ Open Discharge Summary</a>}
            </div>
          )}
        </>
      )}

      {/* ══ ADD ORDER MODAL ══ */}
      {orderModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", backdropFilter: "blur(3px)", zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "white", borderRadius: 16, width: 560, maxWidth: "100%", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 24px 70px rgba(0,0,0,.3)" }}>
            <div style={{ padding: "18px 22px", background: C.slate, color: "white", display: "flex", justifyContent: "space-between", alignItems: "center", borderRadius: "16px 16px 0 0" }}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>Add Doctor Order</div>
              <button onClick={() => setOrderModal(false)} style={{ background: "none", border: "none", color: "#94a3b8", fontSize: 22, cursor: "pointer" }}>×</button>
            </div>
            <div style={{ padding: "20px 22px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                <FG label="Order Type">
                  <select style={fld} value={newOrder.type} onChange={e => setNewOrder(p => ({ ...p, type: e.target.value }))}>
                    {ORDER_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                  </select>
                </FG>
                <FG label="Priority">
                  <select style={fld} value={newOrder.priority} onChange={e => setNewOrder(p => ({ ...p, priority: e.target.value }))}>
                    {["ROUTINE","URGENT","STAT"].map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </FG>
              </div>
              <FG label="Order / Drug Name *" style={{ marginBottom: 12 }}>
                <input style={fld} value={newOrder.instruction} onChange={e => setNewOrder(p => ({ ...p, instruction: e.target.value }))} placeholder="Drug name / test / instruction…" />
              </FG>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                <FG label="Dose / Rate"><input style={fld} value={newOrder.dose} onChange={e => setNewOrder(p => ({ ...p, dose: e.target.value }))} placeholder="40mg / 500mL @ 84mL/hr" /></FG>
                <FG label="Route">
                  <select style={fld} value={newOrder.route} onChange={e => setNewOrder(p => ({ ...p, route: e.target.value }))}>
                    {["","IV","IM","Oral","SC","SL","Topical","Inhalation","Blood"].map(r => <option key={r} value={r}>{r || "— Select —"}</option>)}
                  </select>
                </FG>
                <FG label="Frequency"><input style={fld} value={newOrder.frequency} onChange={e => setNewOrder(p => ({ ...p, frequency: e.target.value }))} placeholder="OD / BD / TDS / Continuous" /></FG>
                <FG label="Duration"><input style={fld} value={newOrder.duration} onChange={e => setNewOrder(p => ({ ...p, duration: e.target.value }))} placeholder="3 days / 1 week / Ongoing" /></FG>
              </div>
              <FG label="Special Instructions">
                <textarea style={{ ...fld, minHeight: 60, resize: "vertical" }} value={newOrder.notes} onChange={e => setNewOrder(p => ({ ...p, notes: e.target.value }))} placeholder="Additional notes…" />
              </FG>
            </div>
            <div style={{ padding: "13px 22px", borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "flex-end", gap: 10, background: C.grayL, borderRadius: "0 0 16px 16px" }}>
              <button onClick={() => setOrderModal(false)} style={{ padding: "9px 20px", border: `1.5px solid ${C.border}`, borderRadius: 8, background: "white", color: C.muted, fontFamily: "'DM Sans',sans-serif", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
              <button onClick={addOrder} style={{ padding: "9px 22px", background: C.accent, color: "white", border: "none", borderRadius: 8, fontWeight: 700, cursor: "pointer", fontFamily: "'DM Sans',sans-serif", fontSize: 13 }}>Add Order</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Toast ── */}
      {toast && (
        <div style={{ position: "fixed", bottom: 22, right: 22, zIndex: 9999, background: C.slate, color: "white", padding: "11px 16px", borderRadius: 9, fontSize: 12, fontWeight: 500, display: "flex", alignItems: "center", gap: 9, boxShadow: "0 6px 24px rgba(0,0,0,.3)", borderLeft: `4px solid ${toast.type === "ok" ? C.green : toast.type === "err" ? C.red : C.amber}` }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
