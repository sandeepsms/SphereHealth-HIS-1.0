import React, { useState, useEffect } from "react";
import axios from "axios";
import { API_ENDPOINTS } from "../../config/api";
import { useAuth } from "../../context/AuthContext";
import { toast } from "react-toastify";
import ClinicalLayout from "../../Components/clinical/ClinicalLayout";

/* ── Design tokens (blue/indigo — doctor theme) ── */
const C = {
  bg: "#f8fafc", card: "#ffffff", border: "#e2e8f0", text: "#0f172a", muted: "#64748b",
  primary: "#1e40af", primaryL: "#eff6ff", primaryMid: "#2563eb",
  green: "#16a34a", greenL: "#dcfce7", greenB: "#bbf7d0",
  amber: "#d97706", amberL: "#fffbeb", amberB: "#fde68a",
  red: "#dc2626", redL: "#fef2f2", redB: "#fecaca",
  blue: "#1d4ed8", blueL: "#dbeafe", blueB: "#93c5fd",
  purple: "#7c3aed", purpleL: "#f5f3ff", purpleB: "#c4b5fd",
  teal: "#0d9488", tealL: "#f0fdfa", tealB: "#99f6e4",
  orange: "#ea580c", orangeL: "#fff7ed", orangeB: "#fed7aa",
  slate: "#1e293b", slateMid: "#334155",
  gray: "#9ca3af", grayL: "#f9fafb",
  pink: "#db2777", pinkL: "#fdf2f8",
  indigo: "#4f46e5",
};

const fld = { padding: "9px 12px", border: `1.5px solid ${C.border}`, borderRadius: 8, fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: C.text, outline: "none", background: "white", width: "100%", boxSizing: "border-box" };
const sel = { ...fld, cursor: "pointer" };
const ta  = { ...fld, resize: "vertical", minHeight: 78 };
const lbl = { display: "block", fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".6px", marginBottom: 5 };

/* ── NABH Note Modules ── */
const MODULES = [
  { id: "daily",       label: "Daily Progress",       icon: "pi-file-edit",           border: C.blueB,   color: C.blue,   bg: C.blueL   },
  { id: "icu",         label: "ICU / Critical Care",   icon: "pi-heart",               border: C.redB,    color: C.red,    bg: C.redL,    dot: true },
  { id: "procedure",   label: "Procedure Note",        icon: "pi-cog",                 border: C.orangeB, color: C.orange, bg: C.orangeL },
  { id: "consultation",label: "Consultation",          icon: "pi-users",               border: C.purpleB, color: C.purple, bg: C.purpleL },
  { id: "preop",       label: "Pre-operative",         icon: "pi-clock",               border: C.tealB,   color: C.teal,   bg: C.tealL   },
  { id: "postop",      label: "Post-operative",        icon: "pi-check-circle",        border: C.greenB,  color: C.green,  bg: C.greenL  },
  { id: "death",       label: "Death Note",            icon: "pi-exclamation-triangle",border: "#94a3b8", color: C.slate,  bg: "#f1f5f9", dot: true },
  { id: "amendment",   label: "Amendment",             icon: "pi-pencil",              border: C.amberB,  color: C.amber,  bg: C.amberL  },
];

const NOTE_STYLE = {
  daily:        { bg: C.blueL,   color: C.blue,   dot: C.blue   },
  icu:          { bg: C.redL,    color: C.red,    dot: C.red    },
  procedure:    { bg: C.orangeL, color: C.orange, dot: C.orange },
  consultation: { bg: C.purpleL, color: C.purple, dot: C.purple },
  preop:        { bg: C.tealL,   color: C.teal,   dot: C.teal   },
  postop:       { bg: C.greenL,  color: C.green,  dot: C.green  },
  death:        { bg: "#f1f5f9", color: C.slate,  dot: C.slate  },
  amendment:    { bg: C.amberL,  color: C.amber,  dot: C.amber  },
};

const SHIFT_STYLE = {
  morning:   { bg: "#dbeafe", color: "#1e40af" },
  afternoon: { bg: C.amberL,  color: "#92400e" },
  evening:   { bg: "#ede9fe", color: C.purple  },
  night:     { bg: C.slate,   color: "#94a3b8" },
};

const MODULE_TAGS = {
  daily:        ["Stable", "Improving", "Deteriorating", "Critical", "Doctor Review Done", "Informed Family"],
  icu:          ["Ventilated", "Weaning Initiated", "Extubated", "Vasopressors On", "Goals Met", "Family Counselled"],
  procedure:    ["Consent Obtained", "Aseptic Technique", "Patient Tolerated", "Specimen Sent", "Complication Noted"],
  consultation: ["Consultant Reviewed", "Recommendations Noted", "Follow-up Planned"],
  preop:        ["Consent Obtained", "NBM Confirmed", "IV Access Done", "Bloods Sent", "Anaesthetist Reviewed"],
  postop:       ["Haemostasis Confirmed", "Drain Patent", "Transferred to Ward", "Patient Stable"],
  death:        ["Family Informed", "MLC Notified", "Death Certificate Issued", "PM Advised"],
  amendment:    ["Correction Done", "Witness Present", "Original Note Retained"],
};

function getShift() {
  const h = new Date().getHours();
  if (h >= 7 && h < 14) return "morning";
  if (h >= 14 && h < 21) return "evening";
  return "night";
}

/* ── Helpers ── */
function FL({ label, children, span }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5, gridColumn: span ? `span ${span}` : undefined }}>
      <label style={lbl}>{label}</label>
      {children}
    </div>
  );
}

function SBARBox({ letter, title, color, value, onChange, placeholder }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
        <span style={{ width: 24, height: 24, borderRadius: 6, background: color + "25", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: 13, color }}>{letter}</span>
        <label style={{ ...lbl, marginBottom: 0, color }}>{title}</label>
      </div>
      <textarea style={{ ...ta, minHeight: 64, borderColor: color + "40" }} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════ */
function DoctorNotesContent({ selectedPatient }) {
  const { user } = useAuth();

  const [searchUHID,   setSearchUHID]   = useState("");
  const [patient,      setPatient]      = useState(null);
  const [notes,        setNotes]        = useState([]);
  const [loading,      setLoading]      = useState(false);
  const [saving,       setSaving]       = useState(false);
  const [activeModal,  setActiveModal]  = useState(null);
  const [filterType,   setFilterType]   = useState("All");
  const [filterShift,  setFilterShift]  = useState("");
  const [shift,        setShift]        = useState(getShift());
  const [selectedTags, setSelectedTags] = useState([]);
  const [isCritical,   setIsCritical]   = useState(false);

  /* Doctor info from auth */
  const doctorName = user?.fullName || `${user?.firstName || ""} ${user?.lastName || ""}`.trim() || "Dr. —";
  const doctorRegNo = user?.doctorDetails?.registrationNumber || user?.registrationNumber || "";
  const doctorId = user?.id || user?._id || "000000000000000000000001";

  /* Auto-populate UHID from sidebar patient selection */
  useEffect(() => {
    if (selectedPatient?.UHID) setSearchUHID(selectedPatient.UHID);
  }, [selectedPatient]);

  /* ── Module form state ── */
  const initSoap = () => ({ subjective: "", objective: "", assessment: "", plan: "" });
  const initVitals = () => ({ bp: "", pulse: "", temp: "", spo2: "", rr: "", bsl: "", gcs: "", urine: "" });

  const [soap,     setSoap]     = useState(initSoap());
  const [vitals,   setVitals]   = useState(initVitals());
  const [diag,     setDiag]     = useState({ provisional: "", final: "", icd10: "", status: "Stable" });
  const [invx,     setInvx]     = useState("");  // comma-sep investigations ordered
  const [orders,   setOrders]   = useState([]);  // inline orders array
  const [orderRow, setOrderRow] = useState({ type: "medication", instruction: "", dose: "", route: "Oral", frequency: "TDS", duration: "3 days", notes: "", priority: "ROUTINE" });
  const [showOrderRow, setShowOrderRow] = useState(false);

  /* ICU-specific */
  const [icu, setIcu] = useState({ ventMode: "CPAP/PSV", fio2: "", peep: "", tv: "", ventRR: "", pip: "", map: "", cvp: "", rassScore: "0", bpsScore: "", dailyGoals: "", neuro: "Intact", cvs: "Stable", resp: "Supported", renal: "Adequate", gi: "Active", haem: "Normal", infective: "None", sedation: "", vasopressors: false, vasopressorDetail: "" });

  /* Procedure-specific */
  const [proc, setProc] = useState({ procedureName: "", indication: "", time: "", surgeon: "", assistant: "", anaesthesia: "None (Awake)", position: "Supine", consentObtained: true, technique: "", findings: "", complications: "None", bloodLoss: "Minimal (<50mL)", specimenSent: false, specimenType: "", postInstructions: "" });

  /* Consultation-specific */
  const [consult, setConsult] = useState({ consultantName: "", speciality: "", consultantRegNo: "", referredBy: "", reason: "", clinicalSummary: "", investigations: "", findings: "", impression: "", recommendations: "", followUp: "" });

  /* Pre-op */
  const [preop, setPreop] = useState({ procedure: "", indication: "", preopDiagnosis: "", asaGrade: "ASA I", plannedAnaesthesia: "General", bloodGroup: "", crossMatch: false, cbcReviewed: false, ptReviewed: false, ecgReviewed: false, cxrReviewed: false, echoReviewed: false, lftsReviewed: false, rftReviewed: false, comorbidities: "", currentMeds: "", allergies: "NKDA", consentObtained: true, surgeon: "", anaesthetist: "", preopOrders: "" });

  /* Post-op */
  const [postop, setPostop] = useState({ procedurePerformed: "", operativeFindings: "", anaesthesia: "General", surgeon: "", anaesthetist: "", startTime: "", endTime: "", bloodLoss: "", transfusion: "None", fluidsGiven: "", urineOutput: "", specimenSent: false, specimenType: "", postopDiagnosis: "", conditionLeavingOT: "Stable", recoveryInstructions: "", postopOrders: "" });

  /* Death Note */
  const [death, setDeath] = useState({ dateTime: "", causeDeath1: "", causeDeath2: "", causeDeath3: "", contributing: "", sequenceOfEvents: "", modeOfDeath: "Cardiac Arrest", dnrInPlace: false, familyInformed: true, familyInformedBy: "", familyInformedTime: "", mlc: false, pmAdvised: false, certificateIssued: false });

  /* Amendment */
  const [amendment, setAmendment] = useState({ originalNoteId: "", correction: "", reason: "", witness: "" });

  /* ── Load Patient ── */
  const loadPatient = async (e) => {
    e?.preventDefault();
    if (!searchUHID.trim()) return;
    setLoading(true);
    try {
      const { data } = await axios.get(`${API_ENDPOINTS.ADMISSIONS}/active?UHID=${encodeURIComponent(searchUHID.trim())}`);
      const arr = Array.isArray(data) ? data : data.data || [];
      const active = arr[0];
      if (active) {
        setPatient(active);
        await fetchNotes(active.ipdNo || active.admissionNumber || active._id);
        toast.success(`Loaded: ${active.patientName || active.patientId?.fullName || searchUHID}`);
      } else {
        toast.warn("No active IPD admission found for UHID: " + searchUHID);
      }
    } catch (err) {
      toast.error(err?.response?.data?.message || "Patient not found");
    } finally { setLoading(false); }
  };

  const fetchNotes = async (ipdNo) => {
    try {
      const { data } = await axios.get(`${API_ENDPOINTS.DOCTOR_NOTES}/ipd/${ipdNo}`);
      const arr = Array.isArray(data) ? data : data.data || [];
      setNotes(arr.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
    } catch { /* silent */ }
  };

  const openModal = (id) => {
    setActiveModal(id);
    setSelectedTags([]); setIsCritical(false); setShowOrderRow(false);
    setSoap(initSoap()); setVitals(initVitals());
    setDiag({ provisional: "", final: "", icd10: "", status: "Stable" });
    setInvx(""); setOrders([]);
    setOrderRow({ type: "medication", instruction: "", dose: "", route: "Oral", frequency: "TDS", duration: "3 days", notes: "", priority: "ROUTINE" });
  };

  const toggleTag = (t) => setSelectedTags(ts => ts.includes(t) ? ts.filter(x => x !== t) : [...ts, t]);

  const addOrder = () => {
    if (!orderRow.instruction.trim()) { toast.warn("Enter order instruction"); return; }
    setOrders(p => [...p, { ...orderRow, _id: Date.now().toString() }]);
    setOrderRow({ type: "medication", instruction: "", dose: "", route: "Oral", frequency: "TDS", duration: "3 days", notes: "", priority: "ROUTINE" });
    setShowOrderRow(false);
  };

  /* ── Save Note (draft or signed) ── */
  const saveNote = async (status = "draft") => {
    if (!patient) { toast.warn("No patient loaded"); return; }
    const ipdNo = patient.ipdNo || patient.admissionNumber || patient._id;
    const token = localStorage.getItem("his_token");
    const headers = token ? { Authorization: `Bearer ${token}` } : {};

    const payload = {
      ipdNo,
      patient: patient?._id || patient?.patient?._id || "000000000000000000000000",
      patientName: patient?.patientName || patient?.patientId?.fullName || "",
      patientUHID: patient?.UHID || patient?.uhid || searchUHID,
      doctor: doctorId,
      doctorName, doctorRegNo,
      shift, status,
      soap,
      vitals: vitals.bp ? {
        bp: { systolic: Number(vitals.bp.split("/")[0] || 0), diastolic: Number(vitals.bp.split("/")[1] || 0) },
        pulse: Number(vitals.pulse), temp: Number(vitals.temp),
        rr: Number(vitals.rr), spo2: Number(vitals.spo2),
      } : undefined,
      provisionalDiagnosis: diag.provisional, finalDiagnosis: diag.final,
      investigations: invx ? invx.split(",").map(s => s.trim()).filter(Boolean) : [],
      orders: orders.map(o => ({
        type: ["medication","iv_fluid","procedure","diet","other"].includes(o.type) ? o.type : "other",
        instruction: o.instruction, route: o.route || "", frequency: o.frequency || "",
        duration: o.duration || "", notes: o.notes || "",
      })),
      noteType: activeModal,
      isCritical,
      tags: selectedTags,
      noteDetails: activeModal === "icu"         ? icu
                 : activeModal === "procedure"   ? proc
                 : activeModal === "consultation"? consult
                 : activeModal === "preop"       ? preop
                 : activeModal === "postop"      ? postop
                 : activeModal === "death"       ? death
                 : activeModal === "amendment"   ? amendment
                 : {},
    };

    setSaving(true);
    try {
      const res = await axios.post(API_ENDPOINTS.DOCTOR_NOTES, payload, { headers });
      if (status === "signed" && res.data?._id) {
        try { await axios.patch(`${API_ENDPOINTS.DOCTOR_NOTES}/${res.data._id}/sign`, {}, { headers }); } catch { /* already saved */ }
      }
      toast.success(status === "signed" ? "Note signed & submitted ✓" : "Draft saved");
      setActiveModal(null);
      await fetchNotes(ipdNo);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Save failed");
    } finally { setSaving(false); }
  };

  const today = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  const filteredNotes = notes.filter(n => {
    const typeMatch  = filterType === "All" || n.noteType === filterType || (filterType === "daily" && !n.noteType);
    const shiftMatch = !filterShift || n.shift === filterShift;
    return typeMatch && shiftMatch;
  });

  const modDef = (id) => MODULES.find(m => m.id === id);

  /* ══════════════════════════════════════════════════════════════ */
  return (
    <div style={{ marginLeft: 260, padding: "24px 28px", minHeight: "100vh", background: C.bg, fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: C.text }}>

      {/* ── Page Header ── */}
      <div style={{ background: `linear-gradient(135deg, ${C.primary} 0%, ${C.primaryMid} 100%)`, borderRadius: 16, padding: "20px 26px", marginBottom: 20, display: "flex", alignItems: "center", justifyContent: "space-between", boxShadow: `0 8px 24px ${C.primary}30` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 44, height: 44, borderRadius: 11, background: "rgba(255,255,255,.18)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <i className="pi pi-file-edit" style={{ fontSize: 19, color: "white" }} />
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: 19, fontWeight: 800, color: "white" }}>Doctor Notes</h2>
            <p style={{ margin: "2px 0 0", fontSize: 12, color: "rgba(255,255,255,.75)" }}>IPD Clinical Documentation — NABH 5th Edition</p>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <div style={{ background: "rgba(255,255,255,.15)", borderRadius: 8, padding: "6px 14px", fontSize: 12, color: "white", fontWeight: 600 }}>
            <i className="pi pi-user" style={{ marginRight: 5, fontSize: 11 }} />{doctorName}
          </div>
          <div style={{ background: "rgba(255,255,255,.15)", borderRadius: 8, padding: "6px 14px", fontSize: 12, color: "white", fontWeight: 600 }}>
            <i className="pi pi-calendar" style={{ marginRight: 5, fontSize: 11 }} />{today}
          </div>
        </div>
      </div>

      {/* ── Patient Search ── */}
      {!patient ? (
        <div style={{ maxWidth: 560, margin: "0 auto", paddingTop: 8 }}>
          <div style={{ background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 14, padding: "28px", boxShadow: "0 4px 24px rgba(0,0,0,.06)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <div style={{ width: 36, height: 36, borderRadius: 9, background: C.primaryL, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <i className="pi pi-user-plus" style={{ fontSize: 16, color: C.primary }} />
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15, color: C.slate }}>Load Patient</div>
                <div style={{ color: C.muted, fontSize: 12 }}>Enter UHID or Admission No to begin</div>
              </div>
            </div>
            <div style={{ height: 1, background: C.border, margin: "16px 0" }} />
            <form onSubmit={loadPatient} style={{ display: "flex", gap: 10 }}>
              <input value={searchUHID} onChange={e => setSearchUHID(e.target.value.toUpperCase())} placeholder="UHID / Admission No..."
                style={{ ...fld, flex: 1 }} autoFocus />
              <button type="submit" disabled={loading}
                style={{ padding: "9px 22px", background: C.primary, color: "white", border: "none", borderRadius: 8, fontFamily: "'DM Sans',sans-serif", fontSize: 13, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: 7, boxShadow: `0 4px 12px ${C.primary}30` }}>
                {loading ? <i className="pi pi-spin pi-spinner" style={{ fontSize: 13 }} /> : <i className="pi pi-search" style={{ fontSize: 12 }} />}
                Load Patient
              </button>
            </form>
          </div>
        </div>
      ) : (
        <>
          {/* ── Patient Info Strip ── */}
          <div style={{ background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 12, padding: "14px 22px", marginBottom: 14, boxShadow: "0 1px 3px rgba(0,0,0,.04)" }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "10px 24px", flex: 1 }}>
                {[
                  { label: "UHID",      value: patient.UHID || patient.uhid || searchUHID },
                  { label: "Name",      value: patient.patientName || patient.patientId?.fullName || "—" },
                  { label: "Age/Sex",   value: `${patient.age || "?"}Y / ${(patient.gender || "?")[0]?.toUpperCase()}` },
                  { label: "Ward/Bed",  value: `${patient.wardName || "—"} · Bed ${patient.bedNumber || "—"}` },
                  { label: "Admission", value: patient.admissionDate ? new Date(patient.admissionDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—" },
                  { label: "Diagnosis", value: patient.diagnosis || patient.admittingDiagnosis || "—" },
                  { label: "Consultant",value: patient.doctorName || patient.consultantName || "—" },
                ].map(f => (
                  <div key={f.label}>
                    <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".8px", color: C.muted, marginBottom: 2 }}>{f.label}</div>
                    <div style={{ fontWeight: 600, color: C.text, fontSize: 12 }}>{f.value}</div>
                  </div>
                ))}
                {patient.bloodGroup && (
                  <div>
                    <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".8px", color: C.muted, marginBottom: 2 }}>Blood Group</div>
                    <div style={{ fontWeight: 800, color: C.red, fontSize: 13, fontFamily: "monospace" }}>{patient.bloodGroup}</div>
                  </div>
                )}
                {(patient.allergies || patient.knownAllergies || []).filter(Boolean).length > 0 && (
                  <div>
                    <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".8px", color: C.muted, marginBottom: 2 }}>Allergies</div>
                    <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                      {(patient.allergies || patient.knownAllergies || []).map(a => (
                        <span key={a} style={{ background: C.redL, color: C.red, border: "1px solid #fca5a5", padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 700 }}>⚠ {a}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: 6, flexShrink: 0, alignItems: "flex-start", flexWrap: "wrap", maxWidth: 260 }}>
                <button onClick={() => { setPatient(null); setNotes([]); setSearchUHID(""); }}
                  style={{ padding: "6px 12px", border: `1.5px solid ${C.border}`, borderRadius: 7, background: "white", fontSize: 11, fontWeight: 600, cursor: "pointer", color: C.muted, display: "flex", alignItems: "center", gap: 5 }}>
                  <i className="pi pi-times" style={{ fontSize: 10 }} /> Change
                </button>
              </div>
            </div>
          </div>

          {/* ── Shift Selector ── */}
          <div style={{ background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 12, padding: "12px 20px", marginBottom: 14, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".6px" }}>Shift:</span>
              <div style={{ display: "flex", gap: 6 }}>
                {[{id:"morning",label:"Morning",icon:"pi-sun"},{id:"afternoon",label:"Afternoon",icon:"pi-cloud"},{id:"evening",label:"Evening",icon:"pi-moon"},{id:"night",label:"Night",icon:"pi-star"}].map(s => (
                  <button key={s.id} onClick={() => setShift(s.id)}
                    style={{ padding: "6px 16px", border: `1.5px solid ${shift === s.id ? C.primary + "60" : C.border}`, borderRadius: 20, background: shift === s.id ? C.primaryL : "white", color: shift === s.id ? C.primary : C.muted, fontFamily: "'DM Sans',sans-serif", fontSize: 12, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}>
                    <i className={`pi ${s.icon}`} style={{ fontSize: 10 }} />{s.label}
                  </button>
                ))}
              </div>
            </div>
            <button onClick={() => openModal("daily")}
              style={{ padding: "9px 20px", background: `linear-gradient(135deg,${C.primary},${C.primaryMid})`, color: "white", border: "none", borderRadius: 8, fontFamily: "'DM Sans',sans-serif", fontSize: 13, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 7, boxShadow: `0 4px 12px ${C.primary}30` }}>
              <i className="pi pi-plus" style={{ fontSize: 12 }} /> Daily Progress Note
            </button>
          </div>

          {/* ── Module Launcher ── */}
          <div style={{ background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 12, overflow: "hidden", marginBottom: 14 }}>
            <div style={{ padding: "10px 20px", borderBottom: `1px solid ${C.border}`, background: "#f8fafc", display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 26, height: 26, borderRadius: 6, background: C.primary + "18", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <i className="pi pi-plus-circle" style={{ color: C.primary, fontSize: 12 }} />
              </span>
              <span style={{ fontWeight: 700, fontSize: 12, textTransform: "uppercase", letterSpacing: ".8px", color: C.muted }}>Add Doctor Note — NABH</span>
            </div>
            <div style={{ padding: "14px 18px", display: "flex", flexWrap: "wrap", gap: 8 }}>
              {MODULES.map(m => (
                <button key={m.id} onClick={() => openModal(m.id)}
                  style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 14px", borderRadius: 9, border: `1.5px solid ${m.border}`, fontFamily: "'DM Sans',sans-serif", fontSize: 12, fontWeight: 600, cursor: "pointer", background: "white", color: m.color, transition: "all .2s", position: "relative" }}
                  onMouseEnter={e => { e.currentTarget.style.background = m.bg; e.currentTarget.style.transform = "translateY(-1px)"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "white"; e.currentTarget.style.transform = "none"; }}>
                  <i className={`pi ${m.icon}`} style={{ fontSize: 13 }} />{m.label}
                  {m.dot && <span style={{ position: "absolute", top: -4, right: -4, width: 8, height: 8, background: m.color, borderRadius: "50%", border: "2px solid white" }} />}
                </button>
              ))}
            </div>
          </div>

          {/* ── Notes Timeline ── */}
          <div style={{ background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 20px", borderBottom: `1px solid ${C.border}`, background: "#f8fafc" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 14 }}>
                <i className="pi pi-list" style={{ color: C.primary, fontSize: 14 }} />
                Doctor Notes Timeline
                <span style={{ background: C.primary, color: "white", padding: "2px 9px", borderRadius: 10, fontSize: 11, fontWeight: 700 }}>{filteredNotes.length}</span>
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                {["All","daily","icu","procedure","consultation","preop","postop","death","amendment"].map(f => (
                  <button key={f} onClick={() => setFilterType(f)}
                    style={{ padding: "4px 12px", border: `1.5px solid ${filterType === f ? C.primary : C.border}`, borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: "pointer", background: filterType === f ? C.primaryL : "white", color: filterType === f ? C.primary : C.muted, transition: "all .15s" }}>
                    {f === "All" ? "All" : MODULES.find(m => m.id === f)?.label || f}
                  </button>
                ))}
                <select value={filterShift} onChange={e => setFilterShift(e.target.value)} style={{ ...fld, maxWidth: 120, padding: "5px 10px", fontSize: 11 }}>
                  <option value="">All Shifts</option>
                  <option value="morning">Morning</option>
                  <option value="afternoon">Afternoon</option>
                  <option value="evening">Evening</option>
                  <option value="night">Night</option>
                </select>
              </div>
            </div>

            {filteredNotes.length === 0 ? (
              <div style={{ textAlign: "center", padding: "56px 0", color: C.muted }}>
                <i className="pi pi-inbox" style={{ fontSize: 32, display: "block", marginBottom: 12, color: "#cbd5e1" }} />
                <div style={{ fontSize: 13, fontWeight: 600 }}>No doctor notes yet</div>
                <button onClick={() => openModal("daily")} style={{ marginTop: 10, background: "none", border: "none", color: C.primary, fontWeight: 700, cursor: "pointer", fontSize: 13 }}>
                  <i className="pi pi-plus" style={{ marginRight: 5, fontSize: 11 }} />Write first progress note
                </button>
              </div>
            ) : filteredNotes.map((note, i) => {
              const ns  = NOTE_STYLE[note.noteType] || NOTE_STYLE.daily;
              const ss  = SHIFT_STYLE[note.shift]   || SHIFT_STYLE.morning;
              const mod = modDef(note.noteType);
              const timeStr = note.createdAt ? new Date(note.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "--:--";
              const isSigned = note.status === "signed";
              return (
                <div key={note._id || i}
                  style={{ padding: "16px 20px", borderBottom: i < filteredNotes.length - 1 ? `1px solid ${C.border}` : "none", display: "grid", gridTemplateColumns: "76px 1fr auto", gap: 16, alignItems: "start", borderLeft: `4px solid ${ns.dot}` }}
                  onMouseEnter={e => e.currentTarget.style.background = "#f8faff"}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                    <span style={{ fontFamily: "monospace", fontSize: 11, fontWeight: 700 }}>{timeStr}</span>
                    <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 9, fontWeight: 700, letterSpacing: ".6px", ...ss }}>{(note.shift || "morning")[0].toUpperCase() + (note.shift || "morning").slice(1)}</span>
                    <span style={{ width: 12, height: 12, borderRadius: "50%", border: `2.5px solid ${ns.dot}`, background: "white", marginTop: 2, display: "block" }} />
                  </div>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8, flexWrap: "wrap" }}>
                      <span style={{ padding: "3px 10px", borderRadius: 5, fontSize: 10, fontWeight: 700, letterSpacing: ".6px", background: ns.bg, color: ns.color, display: "flex", alignItems: "center", gap: 5 }}>
                        {mod && <i className={`pi ${mod.icon}`} style={{ fontSize: 10 }} />}
                        {mod?.label || "Daily Progress"}
                      </span>
                      <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 9, fontWeight: 700, background: isSigned ? C.greenL : C.amberL, color: isSigned ? C.green : C.amber, border: `1px solid ${isSigned ? C.greenB : C.amberB}` }}>
                        {isSigned ? "✓ SIGNED" : "DRAFT"}
                      </span>
                      {note.isCritical && <span style={{ background: C.red, color: "white", padding: "2px 8px", borderRadius: 4, fontSize: 9, fontWeight: 700 }}>⚠ CRITICAL</span>}
                      {note.doctorName && <span style={{ fontSize: 11, color: C.muted }}>{note.doctorName}</span>}
                      {note.doctorRegNo && <span style={{ fontSize: 10, color: C.muted }}>Reg: {note.doctorRegNo}</span>}
                    </div>
                    {/* SOAP Preview */}
                    {note.soap && (
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                        {[{k:"subjective",l:"S",c:C.blue},{k:"objective",l:"O",c:C.teal},{k:"assessment",l:"A",c:C.amber},{k:"plan",l:"P",c:C.green}].map(s => note.soap[s.k] ? (
                          <div key={s.k} style={{ padding: "6px 10px", background: "#f8fafc", borderRadius: 6, borderLeft: `3px solid ${s.c}` }}>
                            <div style={{ fontSize: 9, fontWeight: 800, color: s.c, textTransform: "uppercase", letterSpacing: ".6px", marginBottom: 2 }}>{s.l} — {s.k}</div>
                            <div style={{ fontSize: 12, color: C.text, lineHeight: 1.5 }}>{note.soap[s.k].slice(0, 120)}{note.soap[s.k].length > 120 ? "…" : ""}</div>
                          </div>
                        ) : null)}
                      </div>
                    )}
                    {/* Diagnosis */}
                    {(note.provisionalDiagnosis || note.finalDiagnosis) && (
                      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 6 }}>
                        {note.provisionalDiagnosis && <span style={{ fontSize: 12, color: C.muted }}><b style={{ color: C.amber }}>Provisional:</b> {note.provisionalDiagnosis}</span>}
                        {note.finalDiagnosis && <span style={{ fontSize: 12, color: C.muted }}><b style={{ color: C.green }}>Final:</b> {note.finalDiagnosis}</span>}
                      </div>
                    )}
                    {/* Investigations */}
                    {note.investigations?.length > 0 && (
                      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 6 }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: C.muted }}>Inv:</span>
                        {note.investigations.map((inv, ii) => (
                          <span key={ii} style={{ padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 600, background: C.purpleL, color: C.purple, border: `1px solid ${C.purpleB}` }}>{inv}</span>
                        ))}
                      </div>
                    )}
                    {/* Orders */}
                    {note.orders?.length > 0 && (
                      <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: C.muted }}>Orders ({note.orders.length}):</span>
                        {note.orders.slice(0, 3).map((o, oi) => (
                          <span key={oi} style={{ padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 600, background: C.blueL, color: C.blue, border: `1px solid ${C.blueB}` }}>{o.instruction?.slice(0, 30)}</span>
                        ))}
                        {note.orders.length > 3 && <span style={{ fontSize: 10, color: C.muted }}>+{note.orders.length - 3} more</span>}
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 5, alignItems: "flex-end" }}>
                    <button style={{ padding: "4px 10px", border: `1.5px solid ${C.border}`, borderRadius: 6, background: "white", fontSize: 11, fontWeight: 600, cursor: "pointer", color: C.muted, display: "flex", alignItems: "center", gap: 4 }}>
                      <i className="pi pi-print" style={{ fontSize: 10 }} /> Print
                    </button>
                    {!isSigned && (
                      <button style={{ padding: "4px 10px", border: `1.5px solid ${C.greenB}`, borderRadius: 6, background: C.greenL, fontSize: 11, fontWeight: 700, cursor: "pointer", color: C.green, display: "flex", alignItems: "center", gap: 4 }}>
                        <i className="pi pi-check" style={{ fontSize: 10 }} /> Sign
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* ══════════════ MODAL ══════════════ */}
      {activeModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.6)", backdropFilter: "blur(4px)", zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          onClick={() => setActiveModal(null)}>
          <div style={{ background: "white", borderRadius: 16, width: 740, maxWidth: "96vw", maxHeight: "92vh", overflowY: "auto", boxShadow: "0 24px 60px rgba(0,0,0,.28)" }}
            onClick={e => e.stopPropagation()}>

            {/* Modal Header */}
            <div style={{ padding: "16px 22px", background: `linear-gradient(135deg, ${C.primary}, ${C.primaryMid})`, color: "white", display: "flex", justifyContent: "space-between", alignItems: "center", borderRadius: "16px 16px 0 0", position: "sticky", top: 0, zIndex: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ width: 32, height: 32, borderRadius: 8, background: "rgba(255,255,255,.2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <i className={`pi ${modDef(activeModal)?.icon || "pi-file"}`} style={{ fontSize: 15, color: "white" }} />
                </span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{modDef(activeModal)?.label}</div>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,.75)" }}>
                    {patient?.patientName || "—"} · IPD: {patient?.ipdNo || patient?.admissionNumber || "—"} · {doctorName}
                  </div>
                </div>
              </div>
              <button onClick={() => setActiveModal(null)}
                style={{ background: "rgba(255,255,255,.2)", border: "none", color: "white", fontSize: 18, cursor: "pointer", width: 30, height: 30, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
            </div>

            <div style={{ padding: "20px 22px" }}>

              {/* ══ DAILY PROGRESS NOTE (SOAP) ══ */}
              {activeModal === "daily" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  {/* Vitals Row */}
                  <div style={{ background: "#f8fafc", border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 14px" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".6px", marginBottom: 10 }}>Objective Vitals (NABH COP.2)</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8 }}>
                      {[{k:"bp",l:"BP (mmHg)",p:"120/80"},{k:"pulse",l:"Pulse (/min)",p:"80"},{k:"temp",l:"Temp (°F)",p:"98.6"},{k:"spo2",l:"SpO₂ (%)",p:"98"},{k:"rr",l:"RR (/min)",p:"16"},{k:"bsl",l:"BSL (mg/dL)",p:"110"},{k:"gcs",l:"GCS",p:"E4V5M6"},{k:"urine",l:"Urine (mL/hr)",p:"50"}].map(v => (
                        <FL key={v.k} label={v.l}>
                          <input style={{ ...fld, fontSize: 12 }} value={vitals[v.k]} placeholder={v.p} onChange={e => setVitals(p => ({ ...p, [v.k]: e.target.value }))} />
                        </FL>
                      ))}
                    </div>
                  </div>
                  {/* SOAP */}
                  {[
                    {k:"subjective", l:"S — Subjective", c:C.blue, ph:"Patient's complaints today: pain, nausea, fever, functional status, how they feel…"},
                    {k:"objective",  l:"O — Objective",  c:C.teal, ph:"Examination findings: general appearance, chest, CVS, abdomen, neuro, wound…"},
                    {k:"assessment", l:"A — Assessment",  c:C.amber,ph:"Clinical impression, response to treatment, disease progression…"},
                    {k:"plan",       l:"P — Plan",        c:C.green,ph:"Investigations ordered, medication changes (add/modify/stop), procedures, nursing orders, diet, activity…"},
                  ].map(s => (
                    <div key={s.k}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                        <span style={{ width: 22, height: 22, borderRadius: 5, background: s.c + "20", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: 12, color: s.c }}>{s.k[0].toUpperCase()}</span>
                        <label style={{ ...lbl, marginBottom: 0, color: s.c }}>{s.l}</label>
                      </div>
                      <textarea style={{ ...ta, minHeight: 72, borderColor: s.c + "40" }} value={soap[s.k]} placeholder={s.ph} onChange={e => setSoap(p => ({ ...p, [s.k]: e.target.value }))} />
                    </div>
                  ))}
                  {/* Diagnosis */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10 }}>
                    <FL label="Provisional Diagnosis"><input style={fld} value={diag.provisional} placeholder="Working diagnosis" onChange={e => setDiag(p => ({ ...p, provisional: e.target.value }))} /></FL>
                    <FL label="Final Diagnosis"><input style={fld} value={diag.final} placeholder="Confirmed diagnosis" onChange={e => setDiag(p => ({ ...p, final: e.target.value }))} /></FL>
                    <FL label="ICD-10 Code"><input style={fld} value={diag.icd10} placeholder="e.g. J18.9" onChange={e => setDiag(p => ({ ...p, icd10: e.target.value }))} /></FL>
                    <FL label="Patient Status">
                      <select style={sel} value={diag.status} onChange={e => setDiag(p => ({ ...p, status: e.target.value }))}>
                        {["Stable","Improving","Unchanged","Deteriorating","Critical","Ready for Discharge"].map(o=><option key={o}>{o}</option>)}
                      </select>
                    </FL>
                  </div>
                  {/* Investigations ordered */}
                  <FL label="Investigations Ordered (comma-separated)">
                    <input style={fld} value={invx} placeholder="CBC, LFT, Chest X-Ray, USG Abdomen, ECG…" onChange={e => setInvx(e.target.value)} />
                  </FL>
                  {/* Inline Orders */}
                  <div style={{ background: "#f8fafc", border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 14px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".6px" }}>Doctor Orders ({orders.length})</div>
                      <button onClick={() => setShowOrderRow(true)} style={{ padding: "5px 14px", background: C.primaryL, color: C.primary, border: `1.5px solid ${C.blueB}`, borderRadius: 7, fontFamily: "'DM Sans',sans-serif", fontSize: 12, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}>
                        <i className="pi pi-plus" style={{ fontSize: 10 }} /> Add Order
                      </button>
                    </div>
                    {showOrderRow && (
                      <div style={{ background: "white", border: `1px solid ${C.blueB}`, borderRadius: 8, padding: "10px 12px", marginBottom: 10 }}>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr 1fr 1fr 1fr 1fr", gap: 8, marginBottom: 8 }}>
                          <FL label="Type">
                            <select style={{ ...sel, fontSize: 12 }} value={orderRow.type} onChange={e => setOrderRow(p => ({ ...p, type: e.target.value }))}>
                              {["medication","iv_fluid","procedure","investigation","diet","nursing","other"].map(o=><option key={o} value={o}>{o}</option>)}
                            </select>
                          </FL>
                          <FL label="Instruction *"><input style={{ ...fld, fontSize: 12 }} value={orderRow.instruction} placeholder="Drug name & dose / order detail" onChange={e => setOrderRow(p => ({ ...p, instruction: e.target.value }))} /></FL>
                          <FL label="Route">
                            <select style={{ ...sel, fontSize: 12 }} value={orderRow.route} onChange={e => setOrderRow(p => ({ ...p, route: e.target.value }))}>
                              {["IV","IM","Oral","SC","SL","Topical","Inhalation",""].map(o=><option key={o}>{o||"—"}</option>)}
                            </select>
                          </FL>
                          <FL label="Frequency"><input style={{ ...fld, fontSize: 12 }} value={orderRow.frequency} placeholder="OD/BD/TDS" onChange={e => setOrderRow(p => ({ ...p, frequency: e.target.value }))} /></FL>
                          <FL label="Duration"><input style={{ ...fld, fontSize: 12 }} value={orderRow.duration} placeholder="3 days" onChange={e => setOrderRow(p => ({ ...p, duration: e.target.value }))} /></FL>
                          <FL label="Priority">
                            <select style={{ ...sel, fontSize: 12, borderColor: orderRow.priority==="STAT"?C.red:orderRow.priority==="URGENT"?C.amber:"#e2e8f0" }} value={orderRow.priority} onChange={e => setOrderRow(p => ({ ...p, priority: e.target.value }))}>
                              {["ROUTINE","URGENT","STAT"].map(o=><option key={o}>{o}</option>)}
                            </select>
                          </FL>
                        </div>
                        <div style={{ display: "flex", gap: 8 }}>
                          <button onClick={addOrder} style={{ padding: "6px 18px", background: C.green, color: "white", border: "none", borderRadius: 7, fontFamily: "'DM Sans',sans-serif", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Add Order</button>
                          <button onClick={() => setShowOrderRow(false)} style={{ padding: "6px 14px", background: "white", color: C.muted, border: `1px solid ${C.border}`, borderRadius: 7, fontFamily: "'DM Sans',sans-serif", fontSize: 12, cursor: "pointer" }}>Cancel</button>
                        </div>
                      </div>
                    )}
                    {orders.length > 0 && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {orders.map((o, i) => (
                          <div key={o._id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 10px", background: "white", borderRadius: 6, border: `1px solid ${C.border}` }}>
                            <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 4, background: C.blueL, color: C.blue }}>{o.type}</span>
                            <span style={{ fontSize: 12, fontWeight: 600, flex: 1 }}>{o.instruction}</span>
                            {o.route && <span style={{ fontSize: 10, color: C.muted }}>{o.route}</span>}
                            {o.frequency && <span style={{ fontSize: 10, color: C.muted }}>{o.frequency}</span>}
                            {o.priority !== "ROUTINE" && <span style={{ fontSize: 10, fontWeight: 700, color: o.priority==="STAT"?C.red:C.amber }}>{o.priority}</span>}
                            <button onClick={() => setOrders(p => p.filter((_, ii) => ii !== i))} style={{ background: "none", border: "none", color: C.red, cursor: "pointer", fontSize: 12, padding: 2 }}>×</button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ══ ICU / CRITICAL CARE NOTE ══ */}
              {activeModal === "icu" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <div style={{ background: C.redL, border: `1.5px solid #fca5a5`, borderRadius: 8, padding: "10px 14px", fontSize: 12, color: C.red, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
                    <i className="pi pi-exclamation-triangle" style={{ fontSize: 13 }} /> ICU/HDU Critical Care Note — NABH COP.4 · Enhanced Monitoring Required
                  </div>
                  {/* Ventilator */}
                  <div style={{ background: "#f8fafc", border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 14px" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: C.red, textTransform: "uppercase", letterSpacing: ".6px", marginBottom: 10 }}>Ventilator Parameters</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8 }}>
                      <FL label="Mode"><select style={sel} value={icu.ventMode} onChange={e => setIcu(p=>({...p,ventMode:e.target.value}))}>{["CPAP/PSV","SIMV","A/C","BiPAP","PC-AC","VC-AC","Spontaneous","Not Ventilated"].map(o=><option key={o}>{o}</option>)}</select></FL>
                      <FL label="FiO₂ (%)"><input type="number" min="21" max="100" style={fld} value={icu.fio2} placeholder="40" onChange={e=>setIcu(p=>({...p,fio2:e.target.value}))} /></FL>
                      <FL label="PEEP (cmH₂O)"><input type="number" style={fld} value={icu.peep} placeholder="5" onChange={e=>setIcu(p=>({...p,peep:e.target.value}))} /></FL>
                      <FL label="Tidal Vol (mL)"><input type="number" style={fld} value={icu.tv} placeholder="500" onChange={e=>setIcu(p=>({...p,tv:e.target.value}))} /></FL>
                      <FL label="Set RR (/min)"><input type="number" style={fld} value={icu.ventRR} placeholder="14" onChange={e=>setIcu(p=>({...p,ventRR:e.target.value}))} /></FL>
                      <FL label="PIP (cmH₂O)"><input type="number" style={fld} value={icu.pip} placeholder="25" onChange={e=>setIcu(p=>({...p,pip:e.target.value}))} /></FL>
                      <FL label="MAP (mmHg)"><input type="number" style={fld} value={icu.map} placeholder="75" onChange={e=>setIcu(p=>({...p,map:e.target.value}))} /></FL>
                      <FL label="CVP (cmH₂O)"><input type="number" style={fld} value={icu.cvp} placeholder="10" onChange={e=>setIcu(p=>({...p,cvp:e.target.value}))} /></FL>
                    </div>
                  </div>
                  {/* Sedation */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                    <FL label="RASS Score (-5 to +4)">
                      <select style={{ ...sel, borderColor: Number(icu.rassScore)>1?C.red:Number(icu.rassScore)<-3?C.amber:"#e2e8f0" }} value={icu.rassScore} onChange={e=>setIcu(p=>({...p,rassScore:e.target.value}))}>
                        {[{v:"+4",l:"+4 Combative"},{v:"+3",l:"+3 Very Agitated"},{v:"+2",l:"+2 Agitated"},{v:"+1",l:"+1 Restless"},{v:"0",l:"0 Alert & Calm"},{v:"-1",l:"-1 Drowsy"},{v:"-2",l:"-2 Light Sedation"},{v:"-3",l:"-3 Mod Sedation"},{v:"-4",l:"-4 Deep Sedation"},{v:"-5",l:"-5 Unarousable"}].map(o=><option key={o.v} value={o.v}>{o.l}</option>)}
                      </select>
                    </FL>
                    <FL label="BPS Score (3-12)"><input type="number" min="3" max="12" style={fld} value={icu.bpsScore} placeholder="3 (no pain)" onChange={e=>setIcu(p=>({...p,bpsScore:e.target.value}))} /></FL>
                    <FL label="Sedation Drugs"><input style={fld} value={icu.sedation} placeholder="Midazolam 2mg/hr, Fentanyl…" onChange={e=>setIcu(p=>({...p,sedation:e.target.value}))} /></FL>
                  </div>
                  {/* Organ System Review */}
                  <div style={{ background: "#f8fafc", border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 14px" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".6px", marginBottom: 10 }}>Organ System Review</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
                      {[{k:"neuro",l:"Neuro",opts:["Intact","Agitated","Encephalopathy","Sedated","Unconscious"]},{k:"cvs",l:"CVS",opts:["Stable","Hypotensive","Hypertensive","Arrhythmia","Vasopressors On"]},{k:"resp",l:"Respiratory",opts:["Self-ventilating","Supported","Weaning","Extubated","ARDS"]},{k:"renal",l:"Renal",opts:["Adequate","Oliguria","Anuria","On CRRT","AKI"]},{k:"gi",l:"GI/Nutrition",opts:["Active","NGT Feed","TPN","Ileus","GI Bleed"]},{k:"haem",l:"Haematology",opts:["Normal","Anaemia","Coagulopathy","Thrombocytopaenia","Anticoag On"]},{k:"infective",l:"Infection",opts:["None","Suspected Sepsis","Confirmed Sepsis","On Antibiotics","MDRO"]},{k:"vasopressorDetail",l:"Vasopressors",opts:["None","Noradrenaline","Vasopressin","Dopamine","Adrenaline","Multiple"]}].map(s=>(
                        <FL key={s.k} label={s.l}>
                          <select style={sel} value={icu[s.k]||icu.vasopressorDetail} onChange={e=>setIcu(p=>({...p,[s.k]:e.target.value}))}>
                            {s.opts.map(o=><option key={o}>{o}</option>)}
                          </select>
                        </FL>
                      ))}
                    </div>
                  </div>
                  {/* SOAP + Daily Goals */}
                  {[{k:"subjective",l:"S — Subjective",c:C.blue,ph:"Family update, nursing observations, any complaints noted…"},{k:"objective",l:"O — Objective",c:C.teal,ph:"Exam findings, lines, tubes, wound…"},{k:"assessment",l:"A — Assessment",c:C.amber,ph:"Overall ICU status, organ function assessment…"},{k:"plan",l:"P — Plan",c:C.green,ph:"Orders, changes, weaning plan, family plan…"}].map(s=>(
                    <div key={s.k}>
                      <label style={{ ...lbl, color: s.c }}>{s.l}</label>
                      <textarea style={{ ...ta, minHeight: 60, borderColor: s.c + "40" }} value={soap[s.k]} placeholder={s.ph} onChange={e=>setSoap(p=>({...p,[s.k]:e.target.value}))} />
                    </div>
                  ))}
                  <FL label="Daily Goals / Targets">
                    <textarea style={{ ...ta, minHeight: 60, borderColor: `${C.green}40` }} value={icu.dailyGoals} placeholder="Target SpO₂ >95%, MAP >65, urine >0.5ml/kg/hr, pain BPS <6, sedation RASS 0 to -2…" onChange={e=>setIcu(p=>({...p,dailyGoals:e.target.value}))} />
                  </FL>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <FL label="Provisional Diagnosis"><input style={fld} value={diag.provisional} placeholder="e.g. Septic shock — ARDS" onChange={e=>setDiag(p=>({...p,provisional:e.target.value}))} /></FL>
                    <FL label="Patient Status">
                      <select style={sel} value={diag.status} onChange={e=>setDiag(p=>({...p,status:e.target.value}))}>
                        {["Stable","Improving","Unchanged","Deteriorating","Critical","Moribund"].map(o=><option key={o}>{o}</option>)}
                      </select>
                    </FL>
                  </div>
                </div>
              )}

              {/* ══ PROCEDURE NOTE ══ */}
              {activeModal === "procedure" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                    <FL label="Procedure Name *"><input style={fld} value={proc.procedureName} placeholder="e.g. Central venous line insertion" onChange={e=>setProc(p=>({...p,procedureName:e.target.value}))} /></FL>
                    <FL label="Indication *"><input style={fld} value={proc.indication} placeholder="Reason for procedure" onChange={e=>setProc(p=>({...p,indication:e.target.value}))} /></FL>
                    <FL label="Time of Procedure *"><input type="time" style={fld} value={proc.time} onChange={e=>setProc(p=>({...p,time:e.target.value}))} /></FL>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                    <FL label="Surgeon / Performer *"><input style={fld} value={proc.surgeon} placeholder="Dr. Name" onChange={e=>setProc(p=>({...p,surgeon:e.target.value}))} /></FL>
                    <FL label="Assistant"><input style={fld} value={proc.assistant} placeholder="Assisting doctor/nurse" onChange={e=>setProc(p=>({...p,assistant:e.target.value}))} /></FL>
                    <FL label="Anaesthesia">
                      <select style={sel} value={proc.anaesthesia} onChange={e=>setProc(p=>({...p,anaesthesia:e.target.value}))}>
                        {["None (Awake)","Local Anaesthesia","Sedation","Spinal","Epidural","General Anaesthesia"].map(o=><option key={o}>{o}</option>)}
                      </select>
                    </FL>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <FL label="Patient Position">
                      <select style={sel} value={proc.position} onChange={e=>setProc(p=>({...p,position:e.target.value}))}>
                        {["Supine","Left Lateral","Right Lateral","Lithotomy","Prone","Trendelenburg","Semi-Fowler's"].map(o=><option key={o}>{o}</option>)}
                      </select>
                    </FL>
                    <FL label="Blood Loss"><input style={fld} value={proc.bloodLoss} placeholder="Minimal / mL" onChange={e=>setProc(p=>({...p,bloodLoss:e.target.value}))} /></FL>
                  </div>
                  <FL label="Technique / Description *"><textarea style={{ ...ta, minHeight: 80 }} value={proc.technique} placeholder="Step-by-step description of technique used, sterile field maintained…" onChange={e=>setProc(p=>({...p,technique:e.target.value}))} /></FL>
                  <FL label="Intraoperative Findings"><textarea style={ta} value={proc.findings} placeholder="What was found during the procedure…" onChange={e=>setProc(p=>({...p,findings:e.target.value}))} /></FL>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <FL label="Complications">
                      <select style={{ ...sel, borderColor: proc.complications!=="None"?C.red:"#e2e8f0" }} value={proc.complications} onChange={e=>setProc(p=>({...p,complications:e.target.value}))}>
                        {["None","Bleeding","Haematoma","Pneumothorax","Infection","Failed Procedure","Vasovagal","Other"].map(o=><option key={o}>{o}</option>)}
                      </select>
                    </FL>
                    <div style={{ display: "flex", gap: 20, alignItems: "flex-end", paddingBottom: 2 }}>
                      <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontWeight: 700, fontSize: 13, color: proc.consentObtained?C.green:C.red }}>
                        <input type="checkbox" checked={proc.consentObtained} onChange={e=>setProc(p=>({...p,consentObtained:e.target.checked}))} style={{ accentColor: C.green, width: 15, height: 15 }} /> Consent Obtained *
                      </label>
                      <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontWeight: 700, fontSize: 13, color: proc.specimenSent?C.blue:C.muted }}>
                        <input type="checkbox" checked={proc.specimenSent} onChange={e=>setProc(p=>({...p,specimenSent:e.target.checked}))} style={{ accentColor: C.blue, width: 15, height: 15 }} /> Specimen Sent
                      </label>
                    </div>
                  </div>
                  {proc.specimenSent && <FL label="Specimen Type"><input style={fld} value={proc.specimenType} placeholder="e.g. Tissue biopsy, Fluid C&S" onChange={e=>setProc(p=>({...p,specimenType:e.target.value}))} /></FL>}
                  <FL label="Post-Procedure Instructions"><textarea style={ta} value={proc.postInstructions} placeholder="Monitor site for 1 hour, check vitals every 15 min, CXR post-line…" onChange={e=>setProc(p=>({...p,postInstructions:e.target.value}))} /></FL>
                </div>
              )}

              {/* ══ CONSULTATION NOTE ══ */}
              {activeModal === "consultation" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                    <FL label="Consultant Name *"><input style={fld} value={consult.consultantName} placeholder="Dr. Name" onChange={e=>setConsult(p=>({...p,consultantName:e.target.value}))} /></FL>
                    <FL label="Speciality *"><input style={fld} value={consult.speciality} placeholder="e.g. Cardiology, Nephrology" onChange={e=>setConsult(p=>({...p,speciality:e.target.value}))} /></FL>
                    <FL label="Reg No."><input style={fld} value={consult.consultantRegNo} placeholder="MCI / State reg. no." onChange={e=>setConsult(p=>({...p,consultantRegNo:e.target.value}))} /></FL>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <FL label="Referred By"><input style={fld} value={consult.referredBy} placeholder="Attending doctor name" onChange={e=>setConsult(p=>({...p,referredBy:e.target.value}))} /></FL>
                    <FL label="Reason for Referral *"><input style={fld} value={consult.reason} placeholder="e.g. Chest pain — rule out ACS" onChange={e=>setConsult(p=>({...p,reason:e.target.value}))} /></FL>
                  </div>
                  <FL label="Clinical Summary (for consultant)"><textarea style={ta} value={consult.clinicalSummary} placeholder="Brief history, current condition, relevant investigations…" onChange={e=>setConsult(p=>({...p,clinicalSummary:e.target.value}))} /></FL>
                  <FL label="Investigations Shared"><input style={fld} value={consult.investigations} placeholder="ECG, Echo, Troponin, CBC…" onChange={e=>setConsult(p=>({...p,investigations:e.target.value}))} /></FL>
                  <FL label="Consultant's Findings"><textarea style={ta} value={consult.findings} placeholder="Examination findings noted by consultant…" onChange={e=>setConsult(p=>({...p,findings:e.target.value}))} /></FL>
                  <FL label="Impression / Diagnosis"><input style={fld} value={consult.impression} placeholder="Consultant's diagnostic impression" onChange={e=>setConsult(p=>({...p,impression:e.target.value}))} /></FL>
                  <FL label="Recommendations *"><textarea style={{ ...ta, minHeight: 80 }} value={consult.recommendations} placeholder="Specific management recommendations from consultant…" onChange={e=>setConsult(p=>({...p,recommendations:e.target.value}))} /></FL>
                  <FL label="Follow-up Plan"><input style={fld} value={consult.followUp} placeholder="Review in 48hrs / on discharge / as needed" onChange={e=>setConsult(p=>({...p,followUp:e.target.value}))} /></FL>
                </div>
              )}

              {/* ══ PRE-OPERATIVE NOTE ══ */}
              {activeModal === "preop" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                    <FL label="Planned Procedure *"><input style={fld} value={preop.procedure} placeholder="e.g. Laparoscopic appendicectomy" onChange={e=>setPreop(p=>({...p,procedure:e.target.value}))} /></FL>
                    <FL label="Indication"><input style={fld} value={preop.indication} placeholder="Acute appendicitis" onChange={e=>setPreop(p=>({...p,indication:e.target.value}))} /></FL>
                    <FL label="Pre-op Diagnosis"><input style={fld} value={preop.preopDiagnosis} placeholder="Confirmed diagnosis" onChange={e=>setPreop(p=>({...p,preopDiagnosis:e.target.value}))} /></FL>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10 }}>
                    <FL label="ASA Grade *">
                      <select style={sel} value={preop.asaGrade} onChange={e=>setPreop(p=>({...p,asaGrade:e.target.value}))}>
                        {["ASA I","ASA II","ASA III","ASA IV","ASA V","ASA VI","ASA IE","ASA IIE","ASA IIIE"].map(o=><option key={o}>{o}</option>)}
                      </select>
                    </FL>
                    <FL label="Planned Anaesthesia *">
                      <select style={sel} value={preop.plannedAnaesthesia} onChange={e=>setPreop(p=>({...p,plannedAnaesthesia:e.target.value}))}>
                        {["General","Spinal","Epidural","Local","Sedation","Combined Spinal-Epidural"].map(o=><option key={o}>{o}</option>)}
                      </select>
                    </FL>
                    <FL label="Blood Group"><input style={fld} value={preop.bloodGroup} placeholder="A+, B-, O+" onChange={e=>setPreop(p=>({...p,bloodGroup:e.target.value}))} /></FL>
                    <FL label="Allergy Status"><input style={fld} value={preop.allergies} placeholder="NKDA / Drug name" onChange={e=>setPreop(p=>({...p,allergies:e.target.value}))} /></FL>
                  </div>
                  {/* Investigations Reviewed */}
                  <div style={{ background: "#f8fafc", border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 14px" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".6px", marginBottom: 10 }}>Pre-op Investigations Reviewed</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                      {[{k:"cbcReviewed",l:"CBC/Hb"},{k:"ptReviewed",l:"PT/INR"},{k:"ecgReviewed",l:"ECG"},{k:"cxrReviewed",l:"CXR"},{k:"echoReviewed",l:"Echo"},{k:"lftsReviewed",l:"LFTs"},{k:"rftReviewed",l:"RFTs"},{k:"crossMatch",l:"Cross-match"}].map(f=>(
                        <label key={f.k} style={{ display:"flex", alignItems:"center", gap:8, cursor:"pointer", fontWeight:600, fontSize:13, color:preop[f.k]?C.green:C.muted, padding:"5px 12px", border:`1.5px solid ${preop[f.k]?C.green:C.border}`, borderRadius:20, background:preop[f.k]?C.greenL:"white", transition:"all .15s" }}>
                          <input type="checkbox" checked={preop[f.k]} onChange={e=>setPreop(p=>({...p,[f.k]:e.target.checked}))} style={{ accentColor:C.green, width:13, height:13 }} />{f.l}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <FL label="Co-morbidities"><input style={fld} value={preop.comorbidities} placeholder="DM, HTN, IHD, CKD…" onChange={e=>setPreop(p=>({...p,comorbidities:e.target.value}))} /></FL>
                    <FL label="Current Medications"><input style={fld} value={preop.currentMeds} placeholder="Metformin held, anticoagulants…" onChange={e=>setPreop(p=>({...p,currentMeds:e.target.value}))} /></FL>
                  </div>
                  <FL label="Pre-op Orders"><textarea style={ta} value={preop.preopOrders} placeholder="NBM from midnight, IV access, pre-med (Tab Alprazolam 0.5mg HS)…" onChange={e=>setPreop(p=>({...p,preopOrders:e.target.value}))} /></FL>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <FL label="Operating Surgeon"><input style={fld} value={preop.surgeon} placeholder="Dr. Name" onChange={e=>setPreop(p=>({...p,surgeon:e.target.value}))} /></FL>
                    <FL label="Anaesthetist"><input style={fld} value={preop.anaesthetist} placeholder="Dr. Name" onChange={e=>setPreop(p=>({...p,anaesthetist:e.target.value}))} /></FL>
                  </div>
                  <label style={{ display:"flex", alignItems:"center", gap:8, cursor:"pointer", fontWeight:700, fontSize:13, color:preop.consentObtained?C.green:C.red }}>
                    <input type="checkbox" checked={preop.consentObtained} onChange={e=>setPreop(p=>({...p,consentObtained:e.target.checked}))} style={{ accentColor:C.green, width:15, height:15 }} /> Informed Consent Obtained & Witnessed *
                  </label>
                </div>
              )}

              {/* ══ POST-OPERATIVE NOTE ══ */}
              {activeModal === "postop" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <FL label="Procedure Performed *"><input style={fld} value={postop.procedurePerformed} placeholder="e.g. Laparoscopic appendicectomy" onChange={e=>setPostop(p=>({...p,procedurePerformed:e.target.value}))} /></FL>
                    <FL label="Post-op Diagnosis"><input style={fld} value={postop.postopDiagnosis} placeholder="Confirmed post-op diagnosis" onChange={e=>setPostop(p=>({...p,postopDiagnosis:e.target.value}))} /></FL>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10 }}>
                    <FL label="Start Time"><input type="time" style={fld} value={postop.startTime} onChange={e=>setPostop(p=>({...p,startTime:e.target.value}))} /></FL>
                    <FL label="End Time"><input type="time" style={fld} value={postop.endTime} onChange={e=>setPostop(p=>({...p,endTime:e.target.value}))} /></FL>
                    <FL label="Surgeon"><input style={fld} value={postop.surgeon} placeholder="Dr. Name" onChange={e=>setPostop(p=>({...p,surgeon:e.target.value}))} /></FL>
                    <FL label="Anaesthetist"><input style={fld} value={postop.anaesthetist} placeholder="Dr. Name" onChange={e=>setPostop(p=>({...p,anaesthetist:e.target.value}))} /></FL>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                    <FL label="Anaesthesia Used">
                      <select style={sel} value={postop.anaesthesia} onChange={e=>setPostop(p=>({...p,anaesthesia:e.target.value}))}>
                        {["General","Spinal","Epidural","Local","Sedation","Combined"].map(o=><option key={o}>{o}</option>)}
                      </select>
                    </FL>
                    <FL label="Blood Loss (mL)"><input type="number" style={fld} value={postop.bloodLoss} placeholder="50" onChange={e=>setPostop(p=>({...p,bloodLoss:e.target.value}))} /></FL>
                    <FL label="Transfusion">
                      <select style={sel} value={postop.transfusion} onChange={e=>setPostop(p=>({...p,transfusion:e.target.value}))}>
                        {["None","1 Unit PRC","2 Units PRC","FFP","Platelets","Multiple"].map(o=><option key={o}>{o}</option>)}
                      </select>
                    </FL>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                    <FL label="Fluids Given (mL)"><input type="number" style={fld} value={postop.fluidsGiven} placeholder="2000" onChange={e=>setPostop(p=>({...p,fluidsGiven:e.target.value}))} /></FL>
                    <FL label="Urine Output (mL)"><input type="number" style={fld} value={postop.urineOutput} placeholder="400" onChange={e=>setPostop(p=>({...p,urineOutput:e.target.value}))} /></FL>
                    <FL label="Condition Leaving OT">
                      <select style={{ ...sel, borderColor: postop.conditionLeavingOT==="Critical"?C.red:"#e2e8f0" }} value={postop.conditionLeavingOT} onChange={e=>setPostop(p=>({...p,conditionLeavingOT:e.target.value}))}>
                        {["Stable","Satisfactory","Critical","On Ventilator","Extubated in OT"].map(o=><option key={o}>{o}</option>)}
                      </select>
                    </FL>
                  </div>
                  <FL label="Operative Findings"><textarea style={ta} value={postop.operativeFindings} placeholder="What was found intraoperatively…" onChange={e=>setPostop(p=>({...p,operativeFindings:e.target.value}))} /></FL>
                  <div style={{ display: "flex", gap: 20 }}>
                    <label style={{ display:"flex", alignItems:"center", gap:8, cursor:"pointer", fontWeight:700, fontSize:13, color:postop.specimenSent?C.blue:C.muted }}>
                      <input type="checkbox" checked={postop.specimenSent} onChange={e=>setPostop(p=>({...p,specimenSent:e.target.checked}))} style={{ accentColor:C.blue, width:15, height:15 }} /> Specimen sent
                    </label>
                  </div>
                  {postop.specimenSent && <FL label="Specimen Type"><input style={fld} value={postop.specimenType} placeholder="Histopathology / C&S" onChange={e=>setPostop(p=>({...p,specimenType:e.target.value}))} /></FL>}
                  <FL label="Post-op Orders"><textarea style={ta} value={postop.postopOrders} placeholder="IV fluids, analgesia, monitoring parameters, diet, drain/suction care…" onChange={e=>setPostop(p=>({...p,postopOrders:e.target.value}))} /></FL>
                  <FL label="Recovery Room Instructions"><input style={fld} value={postop.recoveryInstructions} placeholder="Airway monitoring, vitals Q15, oxygen, call criteria…" onChange={e=>setPostop(p=>({...p,recoveryInstructions:e.target.value}))} /></FL>
                </div>
              )}

              {/* ══ DEATH NOTE ══ */}
              {activeModal === "death" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ background: "#f1f5f9", border: `1.5px solid #94a3b8`, borderRadius: 8, padding: "10px 14px", fontSize: 12, color: C.slate, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
                    <i className="pi pi-exclamation-triangle" style={{ fontSize: 13 }} /> Death Summary — NABH MOI.10 · Complete all mandatory fields
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <FL label="Date & Time of Death *"><input type="datetime-local" style={fld} value={death.dateTime} onChange={e=>setDeath(p=>({...p,dateTime:e.target.value}))} /></FL>
                    <FL label="Mode of Death *">
                      <select style={sel} value={death.modeOfDeath} onChange={e=>setDeath(p=>({...p,modeOfDeath:e.target.value}))}>
                        {["Cardiac Arrest","Respiratory Failure","Multi-organ Failure","Septic Shock","Haemorrhage","Renal Failure","Hepatic Failure","CNS Failure","Other"].map(o=><option key={o}>{o}</option>)}
                      </select>
                    </FL>
                  </div>
                  <div style={{ background: "#f8fafc", border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 14px" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".6px", marginBottom: 10 }}>Cause of Death (ICD-10 Format)</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <FL label="I (a) — Immediate Cause of Death *"><input style={fld} value={death.causeDeath1} placeholder="e.g. Acute myocardial infarction" onChange={e=>setDeath(p=>({...p,causeDeath1:e.target.value}))} /></FL>
                      <FL label="I (b) — Due to / Underlying Cause *"><input style={fld} value={death.causeDeath2} placeholder="e.g. Coronary artery disease" onChange={e=>setDeath(p=>({...p,causeDeath2:e.target.value}))} /></FL>
                      <FL label="I (c) — Due to (if applicable)"><input style={fld} value={death.causeDeath3} placeholder="e.g. Hypertension, Diabetes" onChange={e=>setDeath(p=>({...p,causeDeath3:e.target.value}))} /></FL>
                      <FL label="II — Other Contributing Conditions"><input style={fld} value={death.contributing} placeholder="e.g. Chronic kidney disease, anaemia" onChange={e=>setDeath(p=>({...p,contributing:e.target.value}))} /></FL>
                    </div>
                  </div>
                  <FL label="Brief Sequence of Events *"><textarea style={{ ...ta, minHeight: 80 }} value={death.sequenceOfEvents} placeholder="Timeline of clinical events leading to death…" onChange={e=>setDeath(p=>({...p,sequenceOfEvents:e.target.value}))} /></FL>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <FL label="Family Informed By *"><input style={fld} value={death.familyInformedBy} placeholder="Doctor/nurse name" onChange={e=>setDeath(p=>({...p,familyInformedBy:e.target.value}))} /></FL>
                    <FL label="Time Family Informed"><input type="time" style={fld} value={death.familyInformedTime} onChange={e=>setDeath(p=>({...p,familyInformedTime:e.target.value}))} /></FL>
                  </div>
                  <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
                    {[{k:"familyInformed",l:"Family Informed",c:C.green},{k:"dnrInPlace",l:"DNR Was in Place",c:C.blue},{k:"mlc",l:"MLC Case",c:C.red},{k:"pmAdvised",l:"Post-mortem Advised",c:C.amber},{k:"certificateIssued",l:"Death Certificate Issued",c:C.green}].map(f=>(
                      <label key={f.k} style={{ display:"flex", alignItems:"center", gap:8, cursor:"pointer", fontWeight:700, fontSize:13, color:death[f.k]?f.c:C.muted, padding:"6px 12px", border:`1.5px solid ${death[f.k]?f.c:C.border}`, borderRadius:20, background:death[f.k]?(f.c+"15"):"white", transition:"all .15s" }}>
                        <input type="checkbox" checked={death[f.k]} onChange={e=>setDeath(p=>({...p,[f.k]:e.target.checked}))} style={{ accentColor:f.c, width:13, height:13 }} />{f.l}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* ══ AMENDMENT NOTE ══ */}
              {activeModal === "amendment" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ background: C.amberL, border: `1.5px solid ${C.amberB}`, borderRadius: 8, padding: "10px 14px", fontSize: 12, color: C.amber, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
                    <i className="pi pi-pencil" style={{ fontSize: 13 }} /> Amendment to Signed Note — NABH MOM.3 · Original note is preserved. Amendment must be witnessed.
                  </div>
                  <FL label="Note to be Amended (ID or date)">
                    {notes.filter(n=>n.status==="signed").length > 0 ? (
                      <select style={sel} value={amendment.originalNoteId} onChange={e=>setAmendment(p=>({...p,originalNoteId:e.target.value}))}>
                        <option value="">— Select signed note —</option>
                        {notes.filter(n=>n.status==="signed").map(n=>(
                          <option key={n._id} value={n._id}>
                            {new Date(n.createdAt).toLocaleDateString("en-IN")} {new Date(n.createdAt).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"})} — {MODULES.find(m=>m.id===n.noteType)?.label||"Daily Progress"} — {n.doctorName}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input style={fld} value={amendment.originalNoteId} placeholder="Note ID / Date of note being amended" onChange={e=>setAmendment(p=>({...p,originalNoteId:e.target.value}))} />
                    )}
                  </FL>
                  <FL label="Reason for Amendment *">
                    <select style={sel} value={amendment.reason} onChange={e=>setAmendment(p=>({...p,reason:e.target.value}))}>
                      {["Typographical Error","Clinical Correction","Missing Information","Wrong Medication","Wrong Dose","Clarification Required","Other"].map(o=><option key={o}>{o}</option>)}
                    </select>
                  </FL>
                  <FL label="Amendment / Correction *"><textarea style={{ ...ta, minHeight: 100 }} value={amendment.correction} placeholder="State the correction clearly. Note: original signed content is preserved in the record. This amendment is added as an addendum with date, time, and signature." onChange={e=>setAmendment(p=>({...p,correction:e.target.value}))} /></FL>
                  <FL label="Witnessed By *"><input style={fld} value={amendment.witness} placeholder="Name of witnessing doctor/nurse" onChange={e=>setAmendment(p=>({...p,witness:e.target.value}))} /></FL>
                  <div style={{ background: "#fffbeb", border: `1px solid ${C.amberB}`, borderRadius: 7, padding: "10px 14px", fontSize: 12, color: "#92400e" }}>
                    <b>NABH Requirement:</b> This amendment will be signed with your credentials, time-stamped, and appended to the original note. The original remains unaltered in the system audit trail.
                  </div>
                </div>
              )}

              {/* ── Quick Tags ── */}
              {MODULE_TAGS[activeModal]?.length > 0 && (
                <div style={{ marginTop: 14 }}>
                  <div style={lbl}>Quick Tags</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {MODULE_TAGS[activeModal].map(t => (
                      <button key={t} onClick={() => toggleTag(t)}
                        style={{ padding: "4px 10px", borderRadius: 5, fontSize: 11, fontWeight: 600, cursor: "pointer", border: `1.5px solid ${selectedTags.includes(t) ? C.primary : C.border}`, background: selectedTags.includes(t) ? C.primaryL : "white", color: selectedTags.includes(t) ? C.primary : C.muted, transition: "all .15s" }}>
                        {selectedTags.includes(t) && <i className="pi pi-check" style={{ fontSize: 9, marginRight: 4 }} />}{t}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Critical Event ── */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, padding: "10px 14px", background: C.redL, border: `1.5px solid #fca5a5`, borderRadius: 8 }}>
                <input type="checkbox" id="critDr" checked={isCritical} onChange={e => setIsCritical(e.target.checked)} style={{ accentColor: C.red, width: 16, height: 16 }} />
                <label htmlFor="critDr" style={{ fontSize: 13, fontWeight: 600, color: C.red, cursor: "pointer" }}>
                  <i className="pi pi-exclamation-triangle" style={{ marginRight: 5, fontSize: 12 }} />
                  Mark as Critical Event — will flag for review
                </label>
              </div>
            </div>

            {/* Modal Footer */}
            <div style={{ padding: "14px 22px", borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", background: C.bg, borderRadius: "0 0 16px 16px", position: "sticky", bottom: 0 }}>
              <div style={{ fontSize: 11, color: C.muted, display: "flex", alignItems: "center", gap: 6 }}>
                <i className="pi pi-user" style={{ fontSize: 10 }} />{doctorName}
                {doctorRegNo && <><span>·</span><span>Reg: {doctorRegNo}</span></>}
                <span>·</span><i className="pi pi-clock" style={{ fontSize: 10 }} />
                {new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                <span style={{ ...SHIFT_STYLE[shift], padding: "1px 7px", borderRadius: 4, fontSize: 10, fontWeight: 700, marginLeft: 4 }}>{shift[0].toUpperCase() + shift.slice(1)}</span>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setActiveModal(null)} style={{ padding: "9px 20px", border: `1.5px solid ${C.border}`, borderRadius: 8, background: "white", fontFamily: "'DM Sans',sans-serif", fontSize: 13, fontWeight: 600, cursor: "pointer", color: C.muted }}>Cancel</button>
                <button onClick={() => saveNote("draft")} disabled={saving}
                  style={{ padding: "9px 20px", border: `1.5px solid ${C.amberB}`, borderRadius: 8, background: C.amberL, fontFamily: "'DM Sans',sans-serif", fontSize: 13, fontWeight: 700, cursor: saving ? "not-allowed" : "pointer", color: C.amber, display: "flex", alignItems: "center", gap: 6 }}>
                  <i className="pi pi-save" style={{ fontSize: 11 }} /> Save Draft
                </button>
                <button onClick={() => saveNote("signed")} disabled={saving}
                  style={{ padding: "9px 28px", background: saving ? "#5eead4" : `linear-gradient(135deg, ${C.primary}, ${C.primaryMid})`, color: "white", border: "none", borderRadius: 8, fontFamily: "'DM Sans',sans-serif", fontSize: 13, fontWeight: 700, cursor: saving ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: 7, boxShadow: `0 4px 12px ${C.primary}35` }}>
                  <i className={`pi ${saving ? "pi-spin pi-spinner" : "pi-check-circle"}`} style={{ fontSize: 12 }} />
                  {saving ? "Saving…" : "Sign & Submit"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function DoctorNotesPage() {
  const [selectedPatient, setSelectedPatient] = useState(null);
  return (
    <ClinicalLayout onPatientSelect={setSelectedPatient} selectedId={selectedPatient?._id} pageType="doctor-notes">
      <DoctorNotesContent selectedPatient={selectedPatient} />
    </ClinicalLayout>
  );
}
