import React, { useState, useEffect } from "react";
import axios from "axios";
import { useLocation } from "react-router-dom";
import { API_ENDPOINTS } from "../../config/api";
import ClinicalLayout from "../../Components/clinical/ClinicalLayout";
import { useAuth } from "../../context/AuthContext";
import { useAutoSave } from "../../hooks/useAutoSave";
import { useDigitalSignature } from "../../hooks/useDigitalSignature";
import AutoSaveIndicator from "../../Components/signature/AutoSaveIndicator";
import SignaturePad from "../../Components/signature/SignaturePad";
import SignatureStamp from "../../Components/signature/SignatureStamp";

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
  const arrow = !status ? "" :
    ["Low","Severe","Hypo"].some(w => status.startsWith(w)) ? "↓ " :
    ["High","Febrile","Moderate","Borderline"].some(w => status.startsWith(w)) ? "↑ " : "→ ";
  return (
    <div style={{ background: isAbnormal ? C.redL : isWarn ? C.amberL : C.grayL, border: `1.5px solid ${isAbnormal ? "#fca5a5" : isWarn ? "#fcd34d" : C.border}`, borderRadius: 9, padding: "10px 12px", textAlign: "center" }}>
      <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".7px", color: C.muted, marginBottom: 4 }}>{label}</div>
      <div style={{ fontFamily: "monospace", fontSize: 18, fontWeight: 700, color: isAbnormal ? C.red : isWarn ? C.amber : C.text, lineHeight: 1 }}>{value || "—"}</div>
      {unit && <div style={{ fontSize: 9, color: C.muted, marginTop: 2 }}>{unit}</div>}
      {status && <div style={{ fontSize: 10, marginTop: 3, color: isAbnormal ? C.red : isWarn ? C.amber : C.green }}>{arrow}{status}</div>}
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

export function DoctorAssessmentContent({ selectedPatient }) {
  const { user } = useAuth();
  const location = useLocation();
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
  const [isOwner,  setIsOwner]  = useState(true);

  // My IPD patients list
  const [myPatients, setMyPatients] = useState([]);
  const [patientsLoading, setPatientsLoading] = useState(false);

  // Pre-fill doctor info from auth user
  const doctorDisplayName = user
    ? user.fullName || `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.name || ""
    : "";
  const doctorReg = user?.doctorDetails?.registrationNumber || "";

  // Form state (doctorName/Reg pre-filled from auth)
  const [form, setForm] = useState({
    doctorName: doctorDisplayName, doctorRegNo: doctorReg, shift: "morning",
    soap: { subjective: "", objective: "", assessment: "", plan: "" },
    vitals: { bp_sys: "", bp_dia: "", pulse: "", temp: "", rr: "", spo2: "", bsl: "", gcs: "", urine: "" },
    provisionalDiagnosis: "", finalDiagnosis: "", investigations: "",
    // General Examination
    consciousness: "", nutritionalStatus: "",
    pallor: "", icterus: "", cyanosis: "", clubbing: "", lymphadenopathy: "", pedalEdema: "",
    painScore: 0,
    // Systemic Examination
    rs: { breathSounds: "", addedSounds: "", percussionNote: "", tracheaPosition: "" },
    cvs: { heartRhythm: "", heartSounds: "", murmur: "", peripheralEdema: "", jvp: "" },
    abdomen: { tenderness: "", organomegaly: [], bowelSounds: "", ascites: "" },
    cns: { motorSystem: "", motorSide: "", tone: "", reflexes: "", cranialNerves: "", speech: "" },
    // History
    currentMedication: "", familyHistory: "", birthHistory: "",
    // MLC / Restraints
    restraints: "No", restraintType: "", restraintComment: "",
  });
  const [orders, setOrders] = useState([]);
  const [newOrder, setNewOrder] = useState({ type: "medication", instruction: "", dose: "", route: "", frequency: "", duration: "", notes: "", priority: "ROUTINE" });

  /* ── Auto-save draft ── */
  const draftKey = ipdNo ? `sphere_draft_doctor_ipd_${ipdNo}` : null;
  const { savedAt, hasDraft, loadDraft, clearDraft } = useAutoSave(
    draftKey,
    { form, orders },
    2000
  );

  /* ── Digital signature ── */
  const { signature, showSetup, setShowSetup, saveSignature } = useDigitalSignature();

  // Update form when user loads
  useEffect(() => {
    if (user) {
      const name = user.fullName || `${user.firstName || ""} ${user.lastName || ""}`.trim() || "";
      const reg = user.doctorDetails?.registrationNumber || "";
      setForm(p => ({ ...p, doctorName: p.doctorName || name, doctorRegNo: p.doctorRegNo || reg }));
    }
  }, [user]);

  // Auto-load my IPD patients on mount
  useEffect(() => {
    const token = localStorage.getItem("his_token");
    if (!token) return;
    setPatientsLoading(true);
    axios.get(`${API_ENDPOINTS.ADMISSIONS}/my-patients?status=Active`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(res => setMyPatients(Array.isArray(res.data.data) ? res.data.data : []))
      .catch(() => setMyPatients([]))
      .finally(() => setPatientsLoading(false));
  }, []);

  // Auto-load when patient selected from panel or passed directly (e.g. from modal)
  useEffect(() => {
    if (selectedPatient?.UHID || selectedPatient?.bedNumber) {
      const id = selectedPatient.UHID || selectedPatient.bedNumber;
      setSearch(id);
      setIpdNo(selectedPatient.bedNumber || selectedPatient.UHID || "");
      // If a full admission record is passed, load it directly without a search round-trip
      if (selectedPatient.ipdNo || selectedPatient.admissionNumber) {
        loadAdmission(selectedPatient);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPatient]);

  // Auto-load patient when navigated from Doctor Notes with a UHID in route state
  useEffect(() => {
    const uhid = location.state?.uhid;
    if (!uhid) return;
    setSearch(uhid);
    const token = localStorage.getItem("his_token");
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    axios.get(`${API_ENDPOINTS.ADMISSIONS}?uhid=${uhid}`, { headers })
      .then(res => {
        const arr = Array.isArray(res.data) ? res.data : res.data?.data || [];
        const active = arr.find(a => a.status === "Active") || arr[0];
        if (active) loadAdmission(active);
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const loadAdmission = async (admission) => {
    setPatient(admission);
    const ipd = admission.ipdNo || admission.admissionNumber || admission._id;
    setIpdNo(ipd);
    // Check ownership
    const ownerId = admission.attendingDoctorId?._id || admission.attendingDoctorId;
    const owned = !ownerId || !user?.id || String(ownerId) === String(user.id);
    setIsOwner(owned);
    await fetchNotes(ipd);
    await fetchOrders(ipd);

    // Restore draft if one exists for this patient
    const dKey = `sphere_draft_doctor_ipd_${ipd}`;
    try {
      const raw = localStorage.getItem(dKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        const { _meta, form: savedForm, orders: savedOrders } = parsed;
        if (savedForm) setForm(f => ({ ...f, ...savedForm }));
        if (savedOrders) setOrders(savedOrders);
        showToast(`Draft restored (${_meta?.savedAt ? new Date(_meta.savedAt).toLocaleTimeString() : "unsaved"})`, "warn");
        return;
      }
    } catch (_) {}

    showToast(owned ? "Patient loaded" : "Loaded (read-only — not your patient)", owned ? "ok" : "warn");
  };

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!search.trim()) return;
    setLoading(true);
    try {
      const token = localStorage.getItem("his_token");
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const { data } = await axios.get(`${API_ENDPOINTS.ADMISSIONS}?uhid=${search.trim()}`, { headers });
      const arr = Array.isArray(data) ? data : data.data || [];
      const active = arr.find(a => a.status === "Active") || arr[0];
      if (active) {
        await loadAdmission(active);
      } else showToast("No active admission found", "warn");
    } catch { showToast("Patient not found", "err"); }
    finally { setLoading(false); }
  };

  const sf     = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const ssoap  = (k, v) => setForm(p => ({ ...p, soap: { ...p.soap, [k]: v } }));
  const svital = (k, v) => setForm(p => ({ ...p, vitals: { ...p.vitals, [k]: v } }));
  const srs    = (k, v) => setForm(p => ({ ...p, rs: { ...p.rs, [k]: v } }));
  const scvs   = (k, v) => setForm(p => ({ ...p, cvs: { ...p.cvs, [k]: v } }));
  const sabd   = (k, v) => setForm(p => ({ ...p, abdomen: { ...p.abdomen, [k]: v } }));
  const scns   = (k, v) => setForm(p => ({ ...p, cns: { ...p.cns, [k]: v } }));

  const addOrder = () => {
    if (!newOrder.instruction.trim()) return;
    setOrders(p => [...p, { ...newOrder, _id: Date.now().toString(), status: "active", nurseStatus: "pending", orderedBy: form.doctorName || "Dr. Admin", orderedAt: new Date().toISOString() }]);
    setNewOrder({ type: "medication", instruction: "", dose: "", route: "", frequency: "", duration: "", notes: "", priority: "ROUTINE" });
    setOrderModal(false);
    showToast("Order added", "ok");
  };

  const saveNote = async (status = "draft") => {
    if (!ipdNo) { showToast("Search for a patient first", "warn"); return; }
    if (!isOwner) { showToast("Access denied — you are not the attending doctor for this patient", "err"); return; }
    setLoading(true);
    const token = localStorage.getItem("his_token");
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const payload = {
      ipdNo,
      patient: patient?.patientId?._id || patient?.patientId || patient?._id || patient?.patient?._id,
      patientName: patient?.patientName || patient?.patient?.name || "",
      patientUHID: patient?.uhid || patient?.UHID || search,
      doctor: user?._id || user?.id,
      doctorId: user?._id || user?.id,
      doctorName: form.doctorName || doctorDisplayName, doctorRegNo: form.doctorRegNo || doctorReg,
      shift: form.shift,
      soap: form.soap,
      vitals: {
        bp: { systolic: Number(form.vitals.bp_sys), diastolic: Number(form.vitals.bp_dia) },
        pulse: Number(form.vitals.pulse), temp: Number(form.vitals.temp),
        rr: Number(form.vitals.rr), spo2: Number(form.vitals.spo2),
      },
      provisionalDiagnosis: form.provisionalDiagnosis, finalDiagnosis: form.finalDiagnosis,
      investigations: form.investigations ? form.investigations.split(",").map(s => s.trim()).filter(Boolean) : [],
      generalExamination: {
        consciousness: form.consciousness, nutritionalStatus: form.nutritionalStatus,
        pallor: form.pallor, icterus: form.icterus, cyanosis: form.cyanosis,
        clubbing: form.clubbing, lymphadenopathy: form.lymphadenopathy, pedalEdema: form.pedalEdema,
        painScore: form.painScore,
      },
      systemicExamination: { rs: form.rs, cvs: form.cvs, abdomen: form.abdomen, cns: form.cns },
      history: { currentMedication: form.currentMedication, familyHistory: form.familyHistory, birthHistory: form.birthHistory },
      restraints: { used: form.restraints, type: form.restraintType, comment: form.restraintComment },
      orders: orders.map(o => ({
        type: ["medication","iv_fluid","procedure","diet"].includes(o.type) ? o.type : "other",
        instruction: o.instruction, route: o.route || "", frequency: o.frequency || "", duration: o.duration || "", notes: o.notes || "",
      })),
      status,
      // Digital signature — auto-embedded when user has set one
      signature: signature || undefined,
      signedByName: form.doctorName || doctorDisplayName,
      signedByReg: form.doctorRegNo || doctorReg,
    };

    // If signing and no signature yet, prompt setup first
    if (status === "signed" && !signature) {
      setShowSetup(true);
      setLoading(false);
      return;
    }

    try {
      if (editingNote) {
        await axios.put(`${API_ENDPOINTS.DOCTOR_NOTES}/${editingNote._id}`, payload, { headers });
        showToast("Note updated", "ok");
      } else {
        await axios.post(API_ENDPOINTS.DOCTOR_NOTES, payload, { headers });
        showToast(status === "signed" ? "Note signed ✓" : "Draft saved", "ok");
      }
      clearDraft(); // clear localStorage draft on successful save
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

  const vitalCards = !patient ? [] : (() => {
    const v = form.vitals;
    const bpS = Number(v.bp_sys), bpD = Number(v.bp_dia);
    const pu = Number(v.pulse), tmp = Number(v.temp), sp = Number(v.spo2);
    const rr = Number(v.rr), bsl = Number(v.bsl), gcs = Number(v.gcs), ur = Number(v.urine);
    return [
      { label: "BP",    value: v.bp_sys ? `${v.bp_sys}/${v.bp_dia||"?"}` : "—", unit: "mmHg",
        status:      !v.bp_sys ? null : bpS > 160 ? "Hypertensive" : bpS < 90 ? "Low" : "Normal",
        statusColor: !v.bp_sys ? null : (bpS > 160 || bpS < 90) ? "red" : "ok" },
      { label: "PULSE", value: v.pulse || "—", unit: "/min",
        status:      !v.pulse ? null : pu > 100 ? "High (Tachy)" : pu < 60 ? "Low (Brady)" : "Normal",
        statusColor: !v.pulse ? null : (pu > 100 || pu < 60) ? "red" : "ok" },
      { label: "TEMP",  value: v.temp || "—", unit: "°F",
        status:      !v.temp ? null : tmp > 100.4 ? "Febrile" : tmp < 96.8 ? "Hypothermia" : "Afebrile",
        statusColor: !v.temp ? null : (tmp > 100.4 || tmp < 96.8) ? "amber" : "ok" },
      { label: "SPO₂",  value: v.spo2 || "—", unit: "%",
        status:      !v.spo2 ? null : sp < 90 ? "Low — Critical" : sp < 94 ? "Low" : sp < 97 ? "Borderline" : "Normal",
        statusColor: !v.spo2 ? null : sp < 90 ? "red" : sp < 94 ? "red" : sp < 97 ? "amber" : "ok" },
      { label: "RR",    value: v.rr || "—", unit: "/min",
        status:      !v.rr ? null : rr > 24 ? "High (Tachypnoea)" : rr < 12 ? "Low (Bradypnoea)" : "Normal",
        statusColor: !v.rr ? null : (rr > 24 || rr < 12) ? "amber" : "ok" },
      { label: "BSL",   value: v.bsl || "—", unit: "mg/dL",
        status:      !v.bsl ? null : bsl > 200 ? "High" : bsl < 70 ? "Low (Hypo)" : "Normal",
        statusColor: !v.bsl ? null : (bsl > 200 || bsl < 70) ? "red" : "ok" },
      { label: "GCS",   value: v.gcs || "—", unit: "/ 15",
        status:      !v.gcs ? null : gcs <= 8 ? "Severe" : gcs <= 12 ? "Moderate" : "Normal",
        statusColor: !v.gcs ? null : gcs <= 8 ? "red" : gcs <= 12 ? "amber" : "ok" },
      { label: "URINE", value: v.urine || "—", unit: "mL/8hr",
        status:      !v.urine ? null : ur < 200 ? "Low (Oliguria)" : ur > 2000 ? "High" : "Adequate",
        statusColor: !v.urine ? null : ur < 200 ? "red" : "ok" },
    ];
  })();

  const tabs = [
    { id: "assessment", label: "Assessment" },
  ];

  let orderCounter = 1;

  return (
    <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: C.text }}>

      {/* ── Patient Search / My Patients ── */}
      {!patient && (
        <div style={{ maxWidth: 760, margin: "0 auto", paddingTop: 20 }}>
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 28, boxShadow: "0 4px 24px rgba(0,0,0,.06)", marginBottom: 18 }}>
            <div style={{ fontWeight: 700, fontSize: 18, color: C.slate, marginBottom: 6 }}>Doctor Assessment & Order Entry</div>
            <div style={{ color: C.muted, fontSize: 13, marginBottom: 20 }}>Enter UHID or IPD Number to load patient</div>
            <form onSubmit={handleSearch} style={{ display: "flex", gap: 10 }}>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="UHID / IPD No…" style={{ ...fld, flex: 1 }} />
              <button type="submit" style={{ padding: "9px 22px", background: C.accent, color: "white", border: "none", borderRadius: 8, fontWeight: 700, cursor: "pointer", fontFamily: "'DM Sans',sans-serif" }}>
                {loading ? "Loading…" : "Search"}
              </button>
            </form>
          </div>

          {/* My Active IPD Patients */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 22, boxShadow: "0 2px 12px rgba(0,0,0,.04)" }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: C.slate, marginBottom: 14, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ background: C.accentL, color: C.accent, padding: "2px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700 }}>MY PATIENTS</span>
              {patientsLoading && <span style={{ fontSize: 11, color: C.muted }}>Loading…</span>}
              {!patientsLoading && <span style={{ fontSize: 11, color: C.muted }}>{myPatients.length} active IPD</span>}
            </div>
            {myPatients.length === 0 && !patientsLoading && (
              <div style={{ textAlign: "center", padding: "24px 0", color: C.muted, fontSize: 13 }}>No active IPD patients assigned to you</div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {myPatients.map(adm => {
                const pt = adm.patientId || {};
                const name = adm.patientName || pt.fullName || "Unknown";
                const uhid = adm.UHID || pt.UHID || "";
                const bed = adm.bedId?.bedNumber || adm.bedNumber || "—";
                const ward = adm.wardId?.wardName || adm.wardName || "—";
                const dayNo = adm.admissionDate ? Math.max(1, Math.ceil((Date.now() - new Date(adm.admissionDate)) / 86400000)) : "?";
                return (
                  <div key={adm._id} onClick={() => loadAdmission(adm)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", border: `1.5px solid ${C.border}`, borderRadius: 10, cursor: "pointer", transition: "border-color .15s, box-shadow .15s" }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = C.accent; e.currentTarget.style.boxShadow = "0 2px 12px rgba(30,64,175,.1)"; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.boxShadow = "none"; }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <div style={{ width: 38, height: 38, borderRadius: "50%", background: C.accentL, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 700, color: C.accent }}>
                        {name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 14, color: C.text }}>{name}</div>
                        <div style={{ fontSize: 11, color: C.muted }}>{uhid} &nbsp;·&nbsp; {ward} / Bed {bed}</div>
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ background: C.accentL, color: C.accent, padding: "2px 9px", borderRadius: 20, fontSize: 11, fontWeight: 700 }}>D{dayNo}</span>
                      <span style={{ background: C.greenL, color: C.green, padding: "2px 9px", borderRadius: 20, fontSize: 11, fontWeight: 700 }}>Active</span>
                      <span style={{ fontSize: 12, color: C.accent, fontWeight: 700 }}>Open →</span>
                    </div>
                  </div>
                );
              })}
            </div>
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

          {/* ── Ownership banner ── */}
          {!isOwner && (
            <div style={{ background: "#fef3c7", border: "1.5px solid #fcd34d", borderRadius: 10, padding: "11px 16px", margin: "8px 0 4px", display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 18 }}>🔒</span>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13, color: "#92400e" }}>Read-Only Access</div>
                <div style={{ fontSize: 12, color: "#b45309" }}>This patient is assigned to another doctor. You can view records but cannot write progress notes or orders.</div>
              </div>
            </div>
          )}

          {/* ── Vitals Strip ── */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(8,1fr)", gap: 8, margin: "8px 0 10px" }}>
            {vitalCards.map(v => <VitalCard key={v.label} {...v} />)}
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

              {/* ── General Examination ── */}
              <SectionCard title="🔍 General Examination">
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
                  <FG label="Level of Consciousness">
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px" }}>
                      {["Alert & Oriented","Confused","Drowsy","Stuporous","Comatose"].map(opt => (
                        <label key={opt} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, cursor: "pointer" }}>
                          <input type="radio" name="consciousness" checked={form.consciousness === opt}
                            onChange={() => sf("consciousness", opt)} style={{ accentColor: C.accent }} />
                          {opt}
                        </label>
                      ))}
                    </div>
                  </FG>
                  <FG label="Nutritional Status">
                    <div style={{ display: "flex", gap: 16 }}>
                      {["Well-Nourished","Malnourished","Cachectic"].map(opt => (
                        <label key={opt} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, cursor: "pointer" }}>
                          <input type="radio" name="nutritionalStatus" checked={form.nutritionalStatus === opt}
                            onChange={() => sf("nutritionalStatus", opt)} style={{ accentColor: C.accent }} />
                          {opt}
                        </label>
                      ))}
                    </div>
                  </FG>
                </div>

                {/* Physical Signs — PICLLEM */}
                <div style={{ background: C.grayL, border: `1px solid ${C.border}`, borderRadius: 9, padding: "12px 16px", marginBottom: 16 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".7px", color: C.muted, marginBottom: 10 }}>Physical Signs (ICCPLE)</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 10 }}>
                    {[
                      { key: "pallor",          label: "Pallor" },
                      { key: "icterus",         label: "Icterus" },
                      { key: "cyanosis",        label: "Cyanosis" },
                      { key: "clubbing",        label: "Clubbing" },
                      { key: "lymphadenopathy", label: "Lymphadenopathy" },
                      { key: "pedalEdema",      label: "Pedal Edema" },
                    ].map(({ key, label }) => (
                      <div key={key} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 10px" }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, marginBottom: 6 }}>{label}</div>
                        <div style={{ display: "flex", gap: 10 }}>
                          {["Present","Absent"].map(opt => (
                            <label key={opt} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, cursor: "pointer" }}>
                              <input type="radio" name={key} checked={form[key] === opt}
                                onChange={() => sf(key, opt)}
                                style={{ accentColor: opt === "Present" ? C.red : C.green }} />
                              <span style={{ color: opt === "Present" && form[key] === "Present" ? C.red : opt === "Absent" && form[key] === "Absent" ? C.green : C.text, fontWeight: form[key] === opt ? 700 : 400 }}>{opt}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Pain Score VAS */}
                <FG label={`Pain Score (VAS) — ${form.painScore}/10 · ${["No Pain","","Mild","","Moderate","","Moderately Severe","","Severe","","Worst Possible"][form.painScore] || ""}`}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ fontSize: 11, color: C.green, fontWeight: 700 }}>0</span>
                    <input type="range" min={0} max={10} step={1} value={form.painScore}
                      onChange={e => sf("painScore", Number(e.target.value))}
                      style={{ flex: 1, accentColor: form.painScore >= 7 ? C.red : form.painScore >= 4 ? C.amber : C.green }} />
                    <span style={{ fontSize: 11, color: C.red, fontWeight: 700 }}>10</span>
                    <span style={{
                      minWidth: 28, textAlign: "center", padding: "4px 10px", borderRadius: 6, fontWeight: 800, fontSize: 15,
                      background: form.painScore >= 7 ? C.redL : form.painScore >= 4 ? C.amberL : C.greenL,
                      color: form.painScore >= 7 ? C.red : form.painScore >= 4 ? C.amber : C.green,
                    }}>{form.painScore}</span>
                  </div>
                </FG>
              </SectionCard>

              {/* ── Systemic Examination ── */}
              <SectionCard title="🫁 Systemic Examination" open={false}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                  {/* Respiratory */}
                  <div style={{ background: C.blueL, border: `1px solid #bae6fd`, borderRadius: 10, padding: "12px 14px" }}>
                    <div style={{ fontWeight: 700, fontSize: 12, color: "#0369a1", marginBottom: 10 }}>🫁 Respiratory System (RS)</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <FG label="Breath Sounds">
                        <select style={fld} value={form.rs.breathSounds} onChange={e => srs("breathSounds", e.target.value)}>
                          <option value="">Select…</option>
                          {["Clear","Vesicular","Bronchial","Diminished","Absent"].map(o => <option key={o}>{o}</option>)}
                        </select>
                      </FG>
                      <FG label="Added Sounds">
                        <select style={fld} value={form.rs.addedSounds} onChange={e => srs("addedSounds", e.target.value)}>
                          <option value="">None</option>
                          {["Crepitations","Rhonchi","Wheeze","Pleural Rub","Stridor"].map(o => <option key={o}>{o}</option>)}
                        </select>
                      </FG>
                      <FG label="Percussion Note">
                        <select style={fld} value={form.rs.percussionNote} onChange={e => srs("percussionNote", e.target.value)}>
                          <option value="">Select…</option>
                          {["Resonant","Dull","Stony Dull","Hyper-resonant","Tympanic"].map(o => <option key={o}>{o}</option>)}
                        </select>
                      </FG>
                      <FG label="Trachea Position">
                        <select style={fld} value={form.rs.tracheaPosition} onChange={e => srs("tracheaPosition", e.target.value)}>
                          <option value="">Select…</option>
                          {["Central","Shifted to Right","Shifted to Left"].map(o => <option key={o}>{o}</option>)}
                        </select>
                      </FG>
                    </div>
                  </div>

                  {/* CVS */}
                  <div style={{ background: C.redL, border: `1px solid #fecaca`, borderRadius: 10, padding: "12px 14px" }}>
                    <div style={{ fontWeight: 700, fontSize: 12, color: C.red, marginBottom: 10 }}>❤️ Cardiovascular System (CVS)</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <FG label="Heart Rhythm">
                        <select style={fld} value={form.cvs.heartRhythm} onChange={e => scvs("heartRhythm", e.target.value)}>
                          <option value="">Select…</option>
                          {["Regular","Irregularly Irregular","Regularly Irregular"].map(o => <option key={o}>{o}</option>)}
                        </select>
                      </FG>
                      <FG label="Heart Sounds">
                        <select style={fld} value={form.cvs.heartSounds} onChange={e => scvs("heartSounds", e.target.value)}>
                          <option value="">Select…</option>
                          {["S1 S2 Normal","S1 S2 + S3","S1 S2 + S4","Muffled","Prosthetic Valve"].map(o => <option key={o}>{o}</option>)}
                        </select>
                      </FG>
                      <FG label="Murmur">
                        <input style={fld} value={form.cvs.murmur} onChange={e => scvs("murmur", e.target.value)} placeholder="Timing, grade, location…" />
                      </FG>
                      <FG label="JVP">
                        <select style={fld} value={form.cvs.jvp} onChange={e => scvs("jvp", e.target.value)}>
                          <option value="">Select…</option>
                          {["Normal","Raised","Not Visible"].map(o => <option key={o}>{o}</option>)}
                        </select>
                      </FG>
                    </div>
                  </div>

                  {/* Abdomen */}
                  <div style={{ background: C.amberL, border: `1px solid #fde68a`, borderRadius: 10, padding: "12px 14px" }}>
                    <div style={{ fontWeight: 700, fontSize: 12, color: C.amber, marginBottom: 10 }}>🫃 Abdomen</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <FG label="Tenderness">
                        <input style={fld} value={form.abdomen.tenderness} onChange={e => sabd("tenderness", e.target.value)} placeholder="Location of tenderness…" />
                      </FG>
                      <FG label="Organomegaly">
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px" }}>
                          {["Hepatomegaly","Splenomegaly","Renal Mass","None"].map(o => (
                            <label key={o} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, cursor: "pointer" }}>
                              <input type="checkbox"
                                checked={(form.abdomen.organomegaly || []).includes(o)}
                                onChange={e => {
                                  const arr = e.target.checked
                                    ? [...(form.abdomen.organomegaly || []), o]
                                    : (form.abdomen.organomegaly || []).filter(x => x !== o);
                                  sabd("organomegaly", arr);
                                }} style={{ accentColor: C.amber }} />
                              {o}
                            </label>
                          ))}
                        </div>
                      </FG>
                      <FG label="Bowel Sounds">
                        <select style={fld} value={form.abdomen.bowelSounds} onChange={e => sabd("bowelSounds", e.target.value)}>
                          <option value="">Select…</option>
                          {["Normal","Increased","Decreased","Absent"].map(o => <option key={o}>{o}</option>)}
                        </select>
                      </FG>
                      <FG label="Ascites">
                        <select style={fld} value={form.abdomen.ascites} onChange={e => sabd("ascites", e.target.value)}>
                          <option value="">Select…</option>
                          {["Absent","Mild","Moderate","Gross"].map(o => <option key={o}>{o}</option>)}
                        </select>
                      </FG>
                    </div>
                  </div>

                  {/* CNS */}
                  <div style={{ background: C.purpleL, border: `1px solid #ddd6fe`, borderRadius: 10, padding: "12px 14px" }}>
                    <div style={{ fontWeight: 700, fontSize: 12, color: C.purple, marginBottom: 10 }}>🧠 CNS / Neuro</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <FG label="Motor System">
                        <select style={fld} value={form.cns.motorSystem} onChange={e => scns("motorSystem", e.target.value)}>
                          <option value="">Select…</option>
                          {["Normal","Hemiparesis","Hemiplegia","Paraparesis","Paraplegia","Quadriparesis","Quadriplegia","Focal Deficit"].map(o => <option key={o}>{o}</option>)}
                        </select>
                      </FG>
                      {form.cns.motorSystem && form.cns.motorSystem !== "Normal" && (
                        <FG label="Affected Side">
                          <select style={fld} value={form.cns.motorSide} onChange={e => scns("motorSide", e.target.value)}>
                            <option value="">Select…</option>
                            {["Right","Left","Bilateral"].map(o => <option key={o}>{o}</option>)}
                          </select>
                        </FG>
                      )}
                      <FG label="Tone">
                        <select style={fld} value={form.cns.tone} onChange={e => scns("tone", e.target.value)}>
                          <option value="">Select…</option>
                          {["Normal","Hypertonia","Hypotonia","Flaccid"].map(o => <option key={o}>{o}</option>)}
                        </select>
                      </FG>
                      <FG label="Reflexes (DTR/Plantar)">
                        <input style={fld} value={form.cns.reflexes} onChange={e => scns("reflexes", e.target.value)} placeholder="e.g. DTR+2, Plantar flexor…" />
                      </FG>
                      <FG label="Speech">
                        <select style={fld} value={form.cns.speech} onChange={e => scns("speech", e.target.value)}>
                          <option value="">Select…</option>
                          {["Normal","Slurred","Aphasia","Dysarthria","Non-verbal"].map(o => <option key={o}>{o}</option>)}
                        </select>
                      </FG>
                    </div>
                  </div>
                </div>
              </SectionCard>

              {/* ── Additional History ── */}
              <SectionCard title="📋 Additional History" open={false}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                  <FG label="Current Medications">
                    <textarea style={{ ...fld, minHeight: 70, resize: "vertical" }} value={form.currentMedication}
                      onChange={e => sf("currentMedication", e.target.value)} placeholder="Ongoing drugs, doses…" />
                  </FG>
                  <FG label="Family / Personal History">
                    <textarea style={{ ...fld, minHeight: 70, resize: "vertical" }} value={form.familyHistory}
                      onChange={e => sf("familyHistory", e.target.value)} placeholder="Family illness, personal habits…" />
                  </FG>
                  <FG label="Birth History / Milestones (Paeds)">
                    <textarea style={{ ...fld, minHeight: 70, resize: "vertical" }} value={form.birthHistory}
                      onChange={e => sf("birthHistory", e.target.value)} placeholder="Applicable for paediatric patients…" />
                  </FG>
                </div>
              </SectionCard>

              {/* ── Restraints / MLC ── */}
              <SectionCard title="⚠️ Restraints / MLC" open={false}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                  <FG label="Restraints Used">
                    <div style={{ display: "flex", gap: 16 }}>
                      {["No","Yes"].map(opt => (
                        <label key={opt} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
                          <input type="radio" name="restraints" checked={form.restraints === opt}
                            onChange={() => sf("restraints", opt)}
                            style={{ accentColor: opt === "Yes" ? C.red : C.green }} />
                          <span style={{ fontWeight: 700, color: opt === "Yes" && form.restraints === "Yes" ? C.red : C.text }}>{opt}</span>
                        </label>
                      ))}
                    </div>
                    {form.restraints === "Yes" && (
                      <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                        <FG label="Type">
                          <div style={{ display: "flex", gap: 12 }}>
                            {["Physical","Chemical","Both"].map(t => (
                              <label key={t} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, cursor: "pointer" }}>
                                <input type="radio" name="restraintType" checked={form.restraintType === t}
                                  onChange={() => sf("restraintType", t)} style={{ accentColor: C.red }} />
                                {t}
                              </label>
                            ))}
                          </div>
                        </FG>
                        <FG label="Justification / Comments">
                          <textarea style={{ ...fld, minHeight: 60, resize: "vertical" }} value={form.restraintComment}
                            onChange={e => sf("restraintComment", e.target.value)} placeholder="Reason for restraint, review plan…" />
                        </FG>
                      </div>
                    )}
                  </FG>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".7px", color: C.muted, marginBottom: 6 }}>MLC Status</div>
                    {patient?.mlcNumber || patient?.MLC ? (
                      <div style={{ background: C.redL, border: `1.5px solid #fca5a5`, borderRadius: 8, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ fontSize: 20 }}>⚠️</span>
                        <div>
                          <div style={{ fontWeight: 700, color: C.red, fontSize: 13 }}>MEDICO-LEGAL CASE</div>
                          <div style={{ fontSize: 12, color: C.muted }}>MLC No: {patient.mlcNumber || patient.MLC}</div>
                        </div>
                      </div>
                    ) : (
                      <div style={{ background: C.greenL, border: `1px solid #86efac`, borderRadius: 8, padding: "10px 14px", fontSize: 13, color: C.green }}>
                        ✓ Not an MLC case
                      </div>
                    )}
                  </div>
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

              {/* Save buttons + Auto-save indicator + Signature */}
              {isOwner ? (
                <>
                  {/* Signature stamp row */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
                    <AutoSaveIndicator savedAt={savedAt} hasDraft={hasDraft} />
                    <SignatureStamp
                      signature={signature}
                      userName={form.doctorName || doctorDisplayName}
                      role="Doctor"
                      regNo={form.doctorRegNo || doctorReg}
                      timestamp={null}
                      onSetup={() => setShowSetup(true)}
                    />
                  </div>
                  <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginBottom: 24 }}>
                    <button onClick={() => saveNote("draft")} disabled={loading}
                      style={{ padding: "10px 24px", border: `1.5px solid ${C.border}`, borderRadius: 8, background: "white", color: C.muted, fontFamily: "'DM Sans',sans-serif", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>💾 Save Draft</button>
                    <button onClick={() => saveNote("signed")} disabled={loading}
                      style={{ padding: "10px 24px", background: C.green, color: "white", border: "none", borderRadius: 8, fontFamily: "'DM Sans',sans-serif", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>✅ Sign & Submit</button>
                  </div>
                </>
              ) : (
                <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginBottom: 24 }}>
                  <div style={{ padding: "10px 18px", background: "#fef3c7", border: "1.5px solid #fcd34d", borderRadius: 8, color: "#92400e", fontSize: 12, fontWeight: 600 }}>
                    🔒 Read-only — not your patient
                  </div>
                </div>
              )}
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

      {/* ── Digital Signature Setup Modal ── */}
      {showSetup && (
        <SignaturePad
          existing={signature}
          userName={form.doctorName || doctorDisplayName}
          onSave={async (dataUrl) => {
            await saveSignature(dataUrl);
            setShowSetup(false);
            showToast("Signature saved — will be auto-embedded in all signed documents", "ok");
          }}
          onCancel={() => setShowSetup(false)}
        />
      )}
    </div>
  );
}

export default function DoctorAssessmentPage() {
  const [selectedPatient, setSelectedPatient] = useState(null);
  return (
    <ClinicalLayout onPatientSelect={setSelectedPatient} selectedId={selectedPatient?._id} pageType="doctor-assessment">
      <DoctorAssessmentContent selectedPatient={selectedPatient} />
    </ClinicalLayout>
  );
}
