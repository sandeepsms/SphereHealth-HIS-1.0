import React, { useState, useEffect, useRef } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { API_ENDPOINTS } from "../../config/api";
import { useAuth } from "../../context/AuthContext";
import { toast } from "react-toastify";

/* ── Design tokens ── */
const C = {
  bg: "#f0f2f5", card: "#fff", border: "#e2e6ea", text: "#1a1d23", muted: "#6b7280",
  accent: "#1e40af", accentL: "#eff6ff",
  green: "#16a34a", greenL: "#dcfce7",
  red: "#dc2626", redL: "#fef2f2",
  amber: "#d97706", amberL: "#fffbeb",
  teal: "#0d9488", tealL: "#f0fdfa",
  purple: "#7c3aed", purpleL: "#f5f3ff",
  orange: "#ea580c", orangeL: "#fff7ed",
  pink: "#db2777",
  gray: "#9ca3af", grayL: "#f9fafb",
  slate: "#1e293b",
};

const fld = {
  padding: "8px 11px", border: `1.5px solid ${C.border}`, borderRadius: 8,
  fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: C.text,
  outline: "none", background: "white", width: "100%", boxSizing: "border-box",
};
const ta = { ...fld, resize: "vertical", minHeight: 80 };

/* ── Module definitions ── */
const MODULES = [
  { id: "vitals",    label: "Vital Signs",               icon: "pi-heart",                   border: "#bfdbfe", color: "#1d4ed8", bg: "#dbeafe" },
  { id: "neuro",     label: "Neuro / GCS",               icon: "pi-eye",                     border: "#d8b4fe", color: C.purple, bg: C.purpleL },
  { id: "pain",      label: "Pain Assessment",            icon: "pi-exclamation-circle",      border: "#fcd34d", color: "#b45309", bg: C.amberL },
  { id: "intake",    label: "Intake / Output",            icon: "pi-sort-alt",                border: "#93c5fd", color: C.accent, bg: C.accentL },
  { id: "iv",        label: "IV Infusion",                icon: "pi-plus-circle",             border: "#6ee7b7", color: C.teal, bg: C.tealL },
  { id: "blood",     label: "Blood Transfusion",          icon: "pi-heart-fill",              border: "#fca5a5", color: "#9f1239", bg: "#fecaca", dot: true },
  { id: "wound",     label: "Wound / Dressing",           icon: "pi-pencil",                  border: "#fca5a5", color: C.red, bg: C.redL },
  { id: "skin",      label: "Skin / Pressure Assessment", icon: "pi-th-large",                border: "#86efac", color: "#166534", bg: C.greenL },
  { id: "fall",      label: "Fall Risk (Morse)",          icon: "pi-exclamation-triangle",    border: "#fdba74", color: C.orange, bg: C.orangeL },
  { id: "procedure", label: "Procedure / Intervention",   icon: "pi-cog",                     border: "#c4b5fd", color: C.purple, bg: C.purpleL },
  { id: "discharge", label: "Discharge / Handover",       icon: "pi-sign-out",                border: "#6ee7b7", color: C.green, bg: C.greenL },
  { id: "general",   label: "General Observation",        icon: "pi-file",                    border: "#d1d5db", color: "#374151", bg: C.grayL },
];

/* ── Note badge styles ── */
const NOTE_STYLE = {
  vitals:    { bg: "#dbeafe", color: "#1e40af",  dot: "#3b82f6"  },
  blood:     { bg: "#fecaca", color: "#9f1239",  dot: "#dc2626"  },
  iv:        { bg: C.tealL,  color: C.teal,     dot: C.teal     },
  wound:     { bg: C.redL,   color: C.red,      dot: C.red      },
  pain:      { bg: C.amberL, color: "#92400e",  dot: C.amber    },
  procedure: { bg: C.purpleL,color: C.purple,   dot: C.purple   },
  neuro:     { bg: C.purpleL,color: C.purple,   dot: C.purple   },
  fall:      { bg: C.orangeL,color: C.orange,   dot: C.orange   },
  skin:      { bg: C.greenL, color: C.green,    dot: C.green    },
  intake:    { bg: C.accentL,color: C.accent,   dot: C.accent   },
  general:   { bg: C.grayL,  color: "#374151",  dot: C.gray     },
  discharge: { bg: C.greenL, color: C.green,    dot: C.green    },
};

const SHIFT_STYLE = {
  morning:   { bg: "#dbeafe", color: "#1e40af" },
  afternoon: { bg: C.amberL,  color: "#92400e" },
  evening:   { bg: "#ede9fe", color: C.purple  },
  night:     { bg: C.slate,   color: "#94a3b8" },
};

/* ── Quick tags per module ── */
const MODULE_TAGS = {
  vitals:    ["Doctor Notified", "High BP", "High BSL", "Low SpO₂", "Tachycardia", "Fever"],
  blood:     ["Pre-check ✓", "Consent Obtained", "Doctor Informed", "Reaction Noted", "Dual ID Check"],
  iv:        ["Site OK", "Pump Set", "Bottle Changed", "Line Flushed", "Infiltration Noted"],
  wound:     ["Dressing Done", "Wound Swabbed", "Doctor Notified", "Healing Well", "Infection Signs"],
  pain:      ["Analgesic Given", "Doctor Informed", "Pain Reassessed", "Non-pharmacological"],
  neuro:     ["GCS Changed", "Doctor Informed", "Seizure Noted", "Pupil Change"],
  intake:    ["Positive Balance", "Negative Balance", "Foley Cath Patent", "NGT Feed Given"],
  fall:      ["Fall Precautions Active", "Bed Rails Up", "Patient Educated", "Doctor Informed"],
  skin:      ["Repositioned", "Barrier Cream Applied", "Foam Dressing", "Dietician Alerted"],
  procedure: ["Consent Obtained", "Doctor Present", "Patient Tolerated Well", "Specimen Sent"],
  discharge: ["Patient Educated", "Instructions Given", "Valuables Returned", "Handover Completed"],
  general:   ["Doctor Informed", "Family Informed", "Patient Comfortable", "Monitoring Continued"],
};

function getShift() {
  const h = new Date().getHours();
  if (h >= 7 && h < 14) return "morning";
  if (h >= 14 && h < 21) return "evening";
  return "night";
}

const isAbnormal = (key, val) => {
  const v = Number(val);
  if (!v) return false;
  if (key === "bp_sys" && (v > 160 || v < 90)) return true;
  if (key === "pulse"  && (v > 100 || v < 50)) return true;
  if (key === "temp"   && (v > 99.5 || v < 96)) return true;
  if (key === "spo2"   && v < 95) return true;
  if (key === "bsl"    && v > 200) return true;
  if (key === "rr"     && (v > 24 || v < 10)) return true;
  return false;
};

/* ── Field label ── */
function FL({ label, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <label style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase",
        letterSpacing: ".7px", color: C.muted }}>{label}</label>
      {children}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════ */
export default function NursingNotes() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [searchUHID, setSearchUHID] = useState("");
  const [patient,    setPatient]    = useState(null);
  const [notes,      setNotes]      = useState([]);
  const [loading,    setLoading]    = useState(false);
  const [activeModal,setActiveModal]= useState(null);
  const [filterType, setFilterType] = useState("All");
  const [filterShift,setFilterShift]= useState("");
  const [shift,      setShift]      = useState(getShift());
  const [selectedTags, setSelectedTags] = useState([]);
  const [noteText,   setNoteText]   = useState("");
  const [isCritical, setIsCritical] = useState(false);

  /* ── Module-specific form state ── */
  const [vitals,    setVitals]    = useState({ bp: "", pulse: "", temp: "", spo2: "", rr: "", gcs: "", bsl: "" });
  const [blood,     setBlood]     = useState({ product: "PRC (Packed RBC)", bagNo: "", volume: "350", groupVerified: true, status: "Transfusing" });
  const [iv,        setIV]        = useState({ fluid: "NS 0.9%", volume: "", rate: "", route: "IV Right Forearm", site: "Patent" });
  const [intake,    setIntake]    = useState({ oral: "", ivFluids: "", urineOutput: "", drainOutput: "", nasogastric: "" });
  const [neuro,     setNeuro]     = useState({ gcs: "", gcse: "", gcsv: "", gcsm: "", pupils: "Equal & Reactive", seizure: false, orientation: "Alert & Oriented ×3" });
  const [pain,      setPain]      = useState({ score: "", location: "", character: "Dull", radiation: false, analgesicGiven: false, analgesic: "", reassessScore: "" });
  const [wound,     setWound]     = useState({ site: "", size: "", exudate: "None", odour: false, dressing: "", healingStage: "Granulating" });
  const [skin,      setSkin]      = useState({ area: "", stage: "Stage I", intervention: "", repositioned: false });
  const [fallRisk,  setFallRisk]  = useState({ morseScore: "", risk: "Low", interventions: "" });
  const [procedure, setProcedure] = useState({ procedureName: "", indication: "", consentObtained: true, performedBy: "", outcome: "Tolerated Well" });
  const [discharge, setDischarge] = useState({ type: "Shift Handover", summary: "", incomingNurse: "", patientStatus: "Stable" });

  /* ── Load patient ── */
  const loadPatient = async (e) => {
    e?.preventDefault();
    if (!searchUHID.trim()) return;
    setLoading(true);
    try {
      const { data } = await axios.get(`${API_ENDPOINTS.ADMISSIONS}?uhid=${searchUHID.trim()}`);
      const arr = Array.isArray(data) ? data : data.data || [];
      const active = arr.find(a => a.status === "admitted") || arr[0];
      if (active) {
        setPatient(active);
        await fetchNotes(active.ipdNo || active.admissionNumber || active._id);
        toast.success("Patient loaded");
      } else toast.warn("No active admission found");
    } catch { toast.error("Patient not found"); }
    finally { setLoading(false); }
  };

  const fetchNotes = async (ipdNo) => {
    try {
      const { data } = await axios.get(`${API_ENDPOINTS.NURSE_NOTES}?ipdNo=${ipdNo}`);
      const arr = Array.isArray(data) ? data : data.data || [];
      setNotes(arr.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
    } catch { /* silent */ }
  };

  const openModal = (id) => {
    setActiveModal(id);
    setNoteText(""); setIsCritical(false); setSelectedTags([]);
    setVitals({ bp: "", pulse: "", temp: "", spo2: "", rr: "", gcs: "", bsl: "" });
    setBlood({ product: "PRC (Packed RBC)", bagNo: "", volume: "350", groupVerified: true, status: "Transfusing" });
    setIV({ fluid: "NS 0.9%", volume: "", rate: "", route: "IV Right Forearm", site: "Patent" });
    setIntake({ oral: "", ivFluids: "", urineOutput: "", drainOutput: "", nasogastric: "" });
  };

  const toggleTag = (t) => setSelectedTags(ts => ts.includes(t) ? ts.filter(x => x !== t) : [...ts, t]);

  const saveNote = async () => {
    if (!patient) { toast.warn("No patient loaded"); return; }
    const ipdNo = patient.ipdNo || patient.admissionNumber || patient._id;
    let payload = {
      patientUHID: patient.uhid || patient.UHID || searchUHID,
      patientName: patient.patientName || patient.patient?.name || "",
      ipdNo, shift, noteType: activeModal, isCriticalEvent: isCritical,
      remarks: noteText, tags: selectedTags, status: "submitted",
      nurseName: user?.fullName || `${user?.firstName || ""} ${user?.lastName || ""}`.trim(),
    };
    if (activeModal === "vitals")   payload.vitals = { bp: { systolic: Number(vitals.bp.split("/")[0] || 0), diastolic: Number(vitals.bp.split("/")[1] || 0) }, pulse: Number(vitals.pulse), temp: Number(vitals.temp), spo2: Number(vitals.spo2), rr: Number(vitals.rr), gcs: vitals.gcs, bsl: Number(vitals.bsl) };
    if (activeModal === "blood")    payload.bloodTransfusion = blood;
    if (activeModal === "iv")       payload.ivInfusion = iv;
    if (activeModal === "intake")   payload.intakeOutput = { oral: Number(intake.oral), ivFluids: Number(intake.ivFluids), urineOutput: Number(intake.urineOutput), nasogastricOutput: Number(intake.nasogastric), otherOutput: Number(intake.drainOutput) };
    if (activeModal === "neuro")    payload.neuroAssessment = neuro;
    if (activeModal === "pain")     payload.painAssessment = pain;
    if (activeModal === "wound")    payload.woundCare = wound;
    if (activeModal === "skin")     payload.skinAssessment = skin;
    if (activeModal === "fall")     payload.fallRisk = fallRisk;
    if (activeModal === "procedure") payload.procedure = procedure;
    if (activeModal === "discharge") payload.discharge = discharge;

    setLoading(true);
    try {
      await axios.post(API_ENDPOINTS.NURSE_NOTES, payload);
      toast.success("Note saved");
      setActiveModal(null);
      await fetchNotes(ipdNo);
    } catch (err) { toast.error(err?.response?.data?.message || "Save failed"); }
    finally { setLoading(false); }
  };

  const filteredNotes = notes.filter(n => {
    const typeMatch = filterType === "All" || n.noteType === filterType;
    const shiftMatch = !filterShift || n.shift === filterShift;
    return typeMatch && shiftMatch;
  });

  const modDef = (id) => MODULES.find(m => m.id === id);

  /* ═══ RENDER ═══ */
  return (
    <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: C.text }}>

      {/* ── Patient Search ── */}
      {!patient ? (
        <div style={{ maxWidth: 600, margin: "0 auto", paddingTop: 24 }}>
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 28, boxShadow: "0 4px 24px rgba(0,0,0,.06)" }}>
            <div style={{ fontWeight: 700, fontSize: 18, color: C.slate, marginBottom: 4 }}>Nursing Notes — IPD / Day Care</div>
            <div style={{ color: C.muted, fontSize: 13, marginBottom: 20 }}>Enter UHID or Admission No to load patient</div>
            <form onSubmit={loadPatient} style={{ display: "flex", gap: 10 }}>
              <input value={searchUHID} onChange={e => setSearchUHID(e.target.value.toUpperCase())}
                placeholder="UHID / Admission No…" style={{ ...fld, flex: 1 }} autoFocus />
              <button type="submit" disabled={loading}
                style={{ padding: "9px 22px", background: C.accent, color: "white", border: "none",
                  borderRadius: 8, fontFamily: "'DM Sans',sans-serif", fontSize: 13,
                  fontWeight: 700, cursor: loading ? "not-allowed" : "pointer" }}>
                {loading ? <i className="pi pi-spin pi-spinner" /> : "Load Patient"}
              </button>
            </form>
          </div>
        </div>
      ) : (
        <>
          {/* ── Patient Info Strip ── */}
          <div style={{
            background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
            padding: "14px 22px", marginBottom: 14,
          }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
              {/* Left: fields */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: "10px 28px", flex: 1 }}>
                {[
                  { label: "Patient ID",  value: patient.uhid || patient.UHID || searchUHID },
                  { label: "Name",        value: patient.patientName || patient.patient?.name || "—" },
                  { label: "Age / Sex",   value: `${patient.age || patient.patient?.age || "?"}Y / ${(patient.gender || patient.patient?.gender || "?")[0]?.toUpperCase()}` },
                  { label: "Ward / Bed",  value: `${patient.wardName || "—"} — Bed ${patient.bedNumber || "—"}` },
                  { label: "Admission",   value: patient.admissionDate ? new Date(patient.admissionDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—" },
                  { label: "Diagnosis",   value: patient.diagnosis || patient.admittingDiagnosis || "—" },
                  { label: "Consultant",  value: patient.doctorName || patient.consultantName || "—" },
                ].map(f => (
                  <div key={f.label}>
                    <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".8px", color: C.muted, marginBottom: 2 }}>{f.label}</div>
                    <div style={{ fontWeight: 600, color: C.text, fontSize: 12 }}>{f.value}</div>
                  </div>
                ))}

                {/* Allergies */}
                {(patient.allergies || patient.knownAllergies || []).filter(Boolean).length > 0 && (
                  <div>
                    <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".8px", color: C.muted, marginBottom: 2 }}>Allergies</div>
                    <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                      {(patient.allergies || patient.knownAllergies || []).map(a => (
                        <span key={a} style={{ background: C.redL, color: C.red, border: `1px solid #fca5a5`, padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", gap: 3 }}>
                          <i className="pi pi-exclamation-triangle" style={{ fontSize: 9 }} /> {a}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Blood group */}
                {patient.bloodGroup && (
                  <div>
                    <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".8px", color: C.muted, marginBottom: 2 }}>Blood Group</div>
                    <div style={{ fontWeight: 800, color: C.red, fontSize: 13, fontFamily: "'DM Mono', monospace" }}>{patient.bloodGroup}</div>
                  </div>
                )}

                {/* Admission type */}
                <div>
                  <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".8px", color: C.muted, marginBottom: 2 }}>Admission Type</div>
                  <span style={{ background: C.purpleL, border: "1px solid #c4b5fd", color: C.purple, padding: "2px 10px", borderRadius: 5, fontSize: 11, fontWeight: 700 }}>
                    {patient.admissionType?.toUpperCase() || "IPD"}
                  </span>
                </div>
              </div>

              {/* Right: action buttons */}
              <div style={{ display: "flex", gap: 6, flexShrink: 0, alignItems: "flex-start", flexWrap: "wrap", maxWidth: 280 }}>
                <button onClick={() => navigate("/nursing-care-plan")}
                  style={{ padding: "6px 12px", border: `1.5px solid ${C.border}`, borderRadius: 7, background: "white", fontSize: 11, fontWeight: 600, cursor: "pointer", color: C.text, display: "flex", alignItems: "center", gap: 5 }}>
                  <i className="pi pi-clipboard" style={{ fontSize: 11 }} /> Care Plan
                </button>
                <button onClick={() => navigate("/vitalsView")}
                  style={{ padding: "6px 12px", border: `1.5px solid ${C.border}`, borderRadius: 7, background: "white", fontSize: 11, fontWeight: 600, cursor: "pointer", color: C.text, display: "flex", alignItems: "center", gap: 5 }}>
                  <i className="pi pi-chart-bar" style={{ fontSize: 11 }} /> Vitals Trend
                </button>
                <button
                  style={{ padding: "6px 12px", border: `1.5px solid ${C.border}`, borderRadius: 7, background: "white", fontSize: 11, fontWeight: 600, cursor: "pointer", color: C.text, display: "flex", alignItems: "center", gap: 5 }}>
                  <i className="pi pi-print" style={{ fontSize: 11 }} /> Print Notes
                </button>
                <button onClick={() => navigate(`/ipd-assessment/${patient.uhid || patient.UHID || searchUHID}`)}
                  style={{ padding: "6px 12px", border: `1.5px solid ${C.accent}30`, borderRadius: 7, background: C.accentL, fontSize: 11, fontWeight: 600, cursor: "pointer", color: C.accent, display: "flex", alignItems: "center", gap: 5 }}>
                  <i className="pi pi-file-check" style={{ fontSize: 11 }} /> IPD Assessment
                </button>
                <button onClick={() => { setPatient(null); setNotes([]); setSearchUHID(""); }}
                  style={{ padding: "6px 12px", border: `1.5px solid ${C.border}`, borderRadius: 7, background: "white", fontSize: 11, fontWeight: 600, cursor: "pointer", color: C.muted, display: "flex", alignItems: "center", gap: 5 }}>
                  <i className="pi pi-times" style={{ fontSize: 11 }} /> Change
                </button>
              </div>
            </div>
          </div>

          {/* ── Shift selector + Quick Note ── */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".6px" }}>Shift:</span>
              {["morning","afternoon","evening","night"].map(s => (
                <button key={s} onClick={() => setShift(s)}
                  style={{ padding: "5px 14px", border: `1.5px solid ${shift === s ? C.accent : C.border}`, borderRadius: 20,
                    background: shift === s ? C.accentL : "white", color: shift === s ? C.accent : C.muted,
                    fontSize: 11, fontWeight: 600, cursor: "pointer", transition: "all .15s" }}>
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>
            <button onClick={() => openModal("general")}
              style={{ padding: "8px 18px", background: C.green, color: "white", border: "none",
                borderRadius: 8, fontFamily: "'DM Sans',sans-serif", fontSize: 13, fontWeight: 700,
                cursor: "pointer", display: "flex", alignItems: "center", gap: 7,
                boxShadow: `0 4px 12px ${C.green}35` }}>
              <i className="pi pi-plus" style={{ fontSize: 12 }} /> Quick Note
            </button>
          </div>

          {/* ── Module Launcher ── */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
            overflow: "hidden", marginBottom: 14 }}>
            <div style={{ padding: "10px 18px", borderBottom: `1px solid ${C.border}`, background: "#f8fafc",
              display: "flex", alignItems: "center", gap: 8 }}>
              <i className="pi pi-plus-circle" style={{ color: C.accent, fontSize: 13 }} />
              <span style={{ fontWeight: 700, fontSize: 12, textTransform: "uppercase",
                letterSpacing: ".8px", color: C.muted }}>Add Care Note</span>
            </div>
            <div style={{ padding: "14px 18px" }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {MODULES.map(m => (
                  <button key={m.id} onClick={() => openModal(m.id)}
                    style={{
                      display: "flex", alignItems: "center", gap: 7,
                      padding: "8px 14px", borderRadius: 9, border: `1.5px solid ${m.border}`,
                      fontFamily: "'DM Sans',sans-serif", fontSize: 12, fontWeight: 600,
                      cursor: "pointer", background: "white", color: m.color,
                      transition: "all .2s", position: "relative",
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = m.bg; e.currentTarget.style.transform = "translateY(-1px)"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "white"; e.currentTarget.style.transform = "none"; }}
                  >
                    <i className={`pi ${m.icon}`} style={{ fontSize: 13 }} />
                    {m.label}
                    {m.dot && <span style={{ position: "absolute", top: -4, right: -4, width: 8, height: 8, background: C.red, borderRadius: "50%", border: "2px solid white" }} />}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* ── Notes Timeline ── */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
            {/* Timeline header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "13px 20px", borderBottom: `1px solid ${C.border}`, background: "#f8fafc" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 14 }}>
                <i className="pi pi-list" style={{ color: C.accent, fontSize: 14 }} />
                Nursing Notes Timeline
                <span style={{ background: C.accent, color: "white", padding: "2px 9px", borderRadius: 10, fontSize: 11, fontWeight: 700 }}>
                  {filteredNotes.length}
                </span>
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                {[
                  { key: "All",      label: "All" },
                  { key: "vitals",   label: "Vitals" },
                  { key: "blood",    label: "Blood Tx" },
                  { key: "iv",       label: "IV" },
                  { key: "wound",    label: "Wound" },
                  { key: "pain",     label: "Pain" },
                  { key: "neuro",    label: "Neuro" },
                  { key: "intake",   label: "I/O" },
                  { key: "general",  label: "General" },
                ].map(f => (
                  <button key={f.key} onClick={() => setFilterType(f.key)}
                    style={{ padding: "4px 12px", border: `1.5px solid ${filterType === f.key ? C.accent : C.border}`,
                      borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: "pointer",
                      background: filterType === f.key ? C.accentL : "white",
                      color: filterType === f.key ? C.accent : C.muted, transition: "all .15s" }}>
                    {f.label}
                  </button>
                ))}
                <select value={filterShift} onChange={e => setFilterShift(e.target.value)}
                  style={{ ...fld, maxWidth: 120, padding: "5px 10px", fontSize: 11 }}>
                  <option value="">All Shifts</option>
                  <option value="morning">Morning</option>
                  <option value="afternoon">Afternoon</option>
                  <option value="evening">Evening</option>
                  <option value="night">Night</option>
                </select>
              </div>
            </div>

            {/* Timeline entries */}
            {filteredNotes.length === 0 ? (
              <div style={{ textAlign: "center", padding: "56px 0", color: C.muted }}>
                <i className="pi pi-inbox" style={{ fontSize: 32, display: "block", marginBottom: 12, color: "#cbd5e1" }} />
                <div style={{ fontSize: 13, fontWeight: 600 }}>No nursing notes yet</div>
                <button onClick={() => openModal("general")} style={{ marginTop: 10, background: "none", border: "none", color: C.accent, fontWeight: 700, cursor: "pointer", fontSize: 13 }}>
                  <i className="pi pi-plus" style={{ marginRight: 5, fontSize: 11 }} />Add first note
                </button>
              </div>
            ) : (
              filteredNotes.map((note, i) => {
                const ns  = NOTE_STYLE[note.noteType] || NOTE_STYLE.general;
                const ss  = SHIFT_STYLE[note.shift] || SHIFT_STYLE.morning;
                const mod = modDef(note.noteType);
                const timeStr = note.createdAt
                  ? new Date(note.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
                  : "--:--";
                return (
                  <div key={note._id || i}
                    style={{ padding: "16px 20px", borderBottom: i < filteredNotes.length - 1 ? `1px solid ${C.border}` : "none",
                      display: "grid", gridTemplateColumns: "76px 1fr auto", gap: 16, alignItems: "start" }}
                    onMouseEnter={e => e.currentTarget.style.background = "#fafbff"}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}>

                    {/* ── Time column ── */}
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                      <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, fontWeight: 700, color: C.text }}>
                        {timeStr}
                      </span>
                      <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 9, fontWeight: 700,
                        letterSpacing: ".6px", ...ss }}>
                        {(note.shift || "morning").charAt(0).toUpperCase() + (note.shift || "morning").slice(1)}
                      </span>
                      <span style={{ width: 12, height: 12, borderRadius: "50%",
                        border: `2.5px solid ${ns.dot}`, background: "white",
                        marginTop: 2, display: "block" }} />
                    </div>

                    {/* ── Body ── */}
                    <div>
                      {/* Badges row */}
                      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8, flexWrap: "wrap" }}>
                        <span style={{ padding: "3px 10px", borderRadius: 5, fontSize: 10, fontWeight: 700,
                          letterSpacing: ".6px", background: ns.bg, color: ns.color,
                          display: "flex", alignItems: "center", gap: 5 }}>
                          {mod && <i className={`pi ${mod.icon}`} style={{ fontSize: 10 }} />}
                          {mod?.label || note.noteType?.toUpperCase()}
                        </span>
                        {note.isCriticalEvent && (
                          <span style={{ background: C.red, color: "white", padding: "2px 8px", borderRadius: 4,
                            fontSize: 9, fontWeight: 700, letterSpacing: ".5px",
                            display: "flex", alignItems: "center", gap: 4 }}>
                            <i className="pi pi-exclamation-triangle" style={{ fontSize: 9 }} /> CRITICAL EVENT
                          </span>
                        )}
                        {note.nurseName && (
                          <span style={{ fontSize: 11, color: C.muted, fontWeight: 500 }}>{note.nurseName}</span>
                        )}
                      </div>

                      {/* Structured data rows */}
                      {note.vitals && note.noteType === "vitals" && (
                        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", padding: "8px 14px",
                          background: C.grayL, borderRadius: 7, marginBottom: 8 }}>
                          {[
                            { label: "BP",    value: `${note.vitals.bp?.systolic || "—"}/${note.vitals.bp?.diastolic || "—"}`, abnormal: isAbnormal("bp_sys", note.vitals.bp?.systolic) },
                            { label: "PULSE", value: `${note.vitals.pulse || "—"} /min`, abnormal: isAbnormal("pulse", note.vitals.pulse) },
                            { label: "TEMP",  value: note.vitals.temp ? `${note.vitals.temp}°F` : "—", abnormal: isAbnormal("temp", note.vitals.temp) },
                            { label: "SPO₂",  value: note.vitals.spo2 ? `${note.vitals.spo2}%` : "—", abnormal: isAbnormal("spo2", note.vitals.spo2) },
                            { label: "RR",    value: note.vitals.rr ? `${note.vitals.rr} /min` : "—", abnormal: isAbnormal("rr", note.vitals.rr) },
                            { label: "GCS",   value: note.vitals.gcs || "—" },
                            { label: "BSL",   value: note.vitals.bsl ? `${note.vitals.bsl} mg/dL` : "—", abnormal: isAbnormal("bsl", note.vitals.bsl) },
                          ].map(v => (
                            <div key={v.label} style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                              <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".6px", color: C.muted }}>{v.label}</span>
                              <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 12, fontWeight: v.abnormal ? 700 : 500, color: v.abnormal ? C.red : C.text }}>{v.value}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {note.bloodTransfusion && note.noteType === "blood" && (
                        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", padding: "8px 14px", background: C.grayL, borderRadius: 7, marginBottom: 8 }}>
                          {[
                            { label: "BLOOD PRODUCT", value: note.bloodTransfusion.product },
                            { label: "BAG NO.",        value: note.bloodTransfusion.bagNo },
                            { label: "VOLUME",         value: note.bloodTransfusion.volume ? `${note.bloodTransfusion.volume} mL` : "—" },
                            { label: "GROUP VERIFIED", value: note.bloodTransfusion.groupVerified ? "✓ Match" : "✗ Not Verified", color: note.bloodTransfusion.groupVerified ? C.green : C.red },
                            { label: "STATUS",         value: note.bloodTransfusion.status, color: C.teal },
                          ].map(v => (
                            <div key={v.label} style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                              <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".6px", color: C.muted }}>{v.label}</span>
                              <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 12, fontWeight: 500, color: v.color || C.text }}>{v.value || "—"}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {note.ivInfusion && note.noteType === "iv" && (
                        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", padding: "8px 14px", background: C.grayL, borderRadius: 7, marginBottom: 8 }}>
                          {[
                            { label: "FLUID",  value: note.ivInfusion.fluid },
                            { label: "RATE",   value: note.ivInfusion.rate ? `${note.ivInfusion.rate} mL/hr` : "—" },
                            { label: "ROUTE",  value: note.ivInfusion.route },
                            { label: "SITE",   value: note.ivInfusion.site, color: C.green },
                          ].map(v => (
                            <div key={v.label} style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                              <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".6px", color: C.muted }}>{v.label}</span>
                              <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 12, fontWeight: 500, color: v.color || C.text }}>{v.value || "—"}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {note.intakeOutput && note.noteType === "intake" && (
                        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", padding: "8px 14px", background: C.grayL, borderRadius: 7, marginBottom: 8 }}>
                          {[
                            { label: "ORAL", value: `${note.intakeOutput.oral || 0} mL` },
                            { label: "IV FLUIDS", value: `${note.intakeOutput.ivFluids || 0} mL` },
                            { label: "URINE OUTPUT", value: `${note.intakeOutput.urineOutput || 0} mL` },
                            { label: "DRAIN", value: `${note.intakeOutput.otherOutput || 0} mL` },
                          ].map(v => (
                            <div key={v.label} style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                              <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".6px", color: C.muted }}>{v.label}</span>
                              <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 12, fontWeight: 500 }}>{v.value}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {note.painAssessment && note.noteType === "pain" && (
                        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", padding: "8px 14px", background: C.grayL, borderRadius: 7, marginBottom: 8 }}>
                          {[
                            { label: "SCORE", value: `${note.painAssessment.score || "—"}/10`, color: Number(note.painAssessment.score) >= 7 ? C.red : C.text },
                            { label: "LOCATION", value: note.painAssessment.location || "—" },
                            { label: "CHARACTER", value: note.painAssessment.character || "—" },
                            { label: "ANALGESIC", value: note.painAssessment.analgesicGiven ? note.painAssessment.analgesic || "Given" : "Not given" },
                          ].map(v => (
                            <div key={v.label} style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                              <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".6px", color: C.muted }}>{v.label}</span>
                              <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 12, fontWeight: 500, color: v.color || C.text }}>{v.value}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Remarks */}
                      {note.remarks && (
                        <div style={{ fontSize: 12.5, color: C.text, lineHeight: 1.6, marginBottom: 8 }}>{note.remarks}</div>
                      )}

                      {/* Tags */}
                      {note.tags?.length > 0 && (
                        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                          {note.tags.map(t => (
                            <span key={t} style={{ padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 600,
                              background: C.grayL, color: C.muted, border: `1px solid ${C.border}` }}>
                              {t}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* ── Actions ── */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 5, alignItems: "flex-end" }}>
                      <button style={{ padding: "4px 10px", border: `1.5px solid ${C.border}`, borderRadius: 6,
                        background: "white", fontSize: 11, fontWeight: 600, cursor: "pointer", color: C.muted,
                        display: "flex", alignItems: "center", gap: 4 }}>
                        <i className="pi pi-pencil" style={{ fontSize: 10 }} /> Edit
                      </button>
                      <button style={{ padding: "4px 10px", border: `1.5px solid ${C.border}`, borderRadius: 6,
                        background: "white", fontSize: 11, fontWeight: 600, cursor: "pointer", color: C.muted,
                        display: "flex", alignItems: "center", gap: 4 }}>
                        <i className="pi pi-print" style={{ fontSize: 10 }} /> Print
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </>
      )}

      {/* ══════════════ MODAL ══════════════ */}
      {activeModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.6)", backdropFilter: "blur(3px)",
          zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          onClick={() => setActiveModal(null)}>
          <div style={{ background: "white", borderRadius: 14, width: 620, maxWidth: "96vw",
            maxHeight: "92vh", overflowY: "auto", boxShadow: "0 24px 60px rgba(0,0,0,.28)" }}
            onClick={e => e.stopPropagation()}>

            {/* Modal header */}
            <div style={{ padding: "16px 22px", background: C.slate, color: "white",
              display: "flex", justifyContent: "space-between", alignItems: "center",
              borderRadius: "14px 14px 0 0", position: "sticky", top: 0, zIndex: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ width: 30, height: 30, borderRadius: 7,
                  background: (modDef(activeModal)?.color || C.accent) + "30",
                  display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <i className={`pi ${modDef(activeModal)?.icon || "pi-file"}`}
                    style={{ fontSize: 14, color: modDef(activeModal)?.color || C.accent }} />
                </span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{modDef(activeModal)?.label}</div>
                  <div style={{ fontSize: 11, color: "#94a3b8" }}>
                    {patient?.patientName || patient?.patient?.name} · IPD: {patient?.ipdNo || patient?.admissionNumber || "—"}
                  </div>
                </div>
              </div>
              <button onClick={() => setActiveModal(null)}
                style={{ background: "none", border: "none", color: "#94a3b8", fontSize: 24, cursor: "pointer", lineHeight: 1 }}>×</button>
            </div>

            {/* Modal body */}
            <div style={{ padding: "20px 22px" }}>

              {/* ── Vitals ── */}
              {activeModal === "vitals" && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
                  {[
                    { k: "bp",    label: "BP (sys/dia)",   placeholder: "120/80" },
                    { k: "pulse", label: "Pulse (/min)",   placeholder: "88" },
                    { k: "temp",  label: "Temperature (°F)", placeholder: "98.6" },
                    { k: "spo2",  label: "SpO₂ (%)",       placeholder: "96" },
                    { k: "rr",    label: "Resp Rate (/min)", placeholder: "18" },
                    { k: "bsl",   label: "BSL (mg/dL)",    placeholder: "120" },
                  ].map(v => (
                    <FL key={v.k} label={v.label}>
                      <input style={fld} value={vitals[v.k]} placeholder={v.placeholder}
                        onChange={e => setVitals(p => ({ ...p, [v.k]: e.target.value }))} />
                    </FL>
                  ))}
                  <FL label="GCS">
                    <input style={fld} value={vitals.gcs} placeholder="E4V5M6 / 15"
                      onChange={e => setVitals(p => ({ ...p, gcs: e.target.value }))} />
                  </FL>
                </div>
              )}

              {/* ── Neuro / GCS ── */}
              {activeModal === "neuro" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10 }}>
                    <FL label="Eyes (E 1-4)"><input style={fld} value={neuro.gcse} onChange={e => setNeuro(p => ({ ...p, gcse: e.target.value }))} placeholder="4" /></FL>
                    <FL label="Verbal (V 1-5)"><input style={fld} value={neuro.gcsv} onChange={e => setNeuro(p => ({ ...p, gcsv: e.target.value }))} placeholder="5" /></FL>
                    <FL label="Motor (M 1-6)"><input style={fld} value={neuro.gcsm} onChange={e => setNeuro(p => ({ ...p, gcsm: e.target.value }))} placeholder="6" /></FL>
                    <FL label="GCS Total"><div style={{ ...fld, fontWeight: 800, textAlign: "center", fontFamily: "monospace", color: C.accent, display: "flex", alignItems: "center", justifyContent: "center" }}>{(Number(neuro.gcse) || 0) + (Number(neuro.gcsv) || 0) + (Number(neuro.gcsm) || 0) || "—"}/15</div></FL>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <FL label="Pupils">
                      <select style={fld} value={neuro.pupils} onChange={e => setNeuro(p => ({ ...p, pupils: e.target.value }))}>
                        {["Equal & Reactive", "Unequal", "Fixed & Dilated", "Pinpoint", "Sluggish"].map(o => <option key={o}>{o}</option>)}
                      </select>
                    </FL>
                    <FL label="Orientation">
                      <select style={fld} value={neuro.orientation} onChange={e => setNeuro(p => ({ ...p, orientation: e.target.value }))}>
                        {["Alert & Oriented ×3", "Confused", "Drowsy", "Unconscious", "Sedated"].map(o => <option key={o}>{o}</option>)}
                      </select>
                    </FL>
                  </div>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontWeight: 700, fontSize: 13, color: neuro.seizure ? C.red : C.muted }}>
                    <input type="checkbox" checked={neuro.seizure} onChange={e => setNeuro(p => ({ ...p, seizure: e.target.checked }))} style={{ accentColor: C.red, width: 15, height: 15 }} />
                    Seizure activity noted
                  </label>
                </div>
              )}

              {/* ── Pain ── */}
              {activeModal === "pain" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr 2fr", gap: 10 }}>
                    <FL label="Pain Score (0-10)"><input type="number" min="0" max="10" style={fld} value={pain.score} onChange={e => setPain(p => ({ ...p, score: e.target.value }))} /></FL>
                    <FL label="Location"><input style={fld} value={pain.location} onChange={e => setPain(p => ({ ...p, location: e.target.value }))} placeholder="e.g. Lower abdomen, chest" /></FL>
                    <FL label="Character">
                      <select style={fld} value={pain.character} onChange={e => setPain(p => ({ ...p, character: e.target.value }))}>
                        {["Dull", "Sharp", "Burning", "Stabbing", "Colicky", "Throbbing", "Cramping"].map(o => <option key={o}>{o}</option>)}
                      </select>
                    </FL>
                  </div>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontWeight: 700, fontSize: 13, color: pain.analgesicGiven ? C.green : C.muted }}>
                    <input type="checkbox" checked={pain.analgesicGiven} onChange={e => setPain(p => ({ ...p, analgesicGiven: e.target.checked }))} style={{ accentColor: C.green, width: 15, height: 15 }} />
                    Analgesic given
                  </label>
                  {pain.analgesicGiven && (
                    <FL label="Analgesic Given"><input style={fld} value={pain.analgesic} onChange={e => setPain(p => ({ ...p, analgesic: e.target.value }))} placeholder="Drug name and dose" /></FL>
                  )}
                  <FL label="Reassessment Score"><input type="number" min="0" max="10" style={{ ...fld, maxWidth: 120 }} value={pain.reassessScore} onChange={e => setPain(p => ({ ...p, reassessScore: e.target.value }))} /></FL>
                </div>
              )}

              {/* ── IV Infusion ── */}
              {activeModal === "iv" && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <FL label="IV Fluid">
                    <select style={fld} value={iv.fluid} onChange={e => setIV(p => ({ ...p, fluid: e.target.value }))}>
                      {["NS 0.9%", "RL", "DNS", "D5W", "D10W", "NS 0.45%", "Plasmalyte", "Other"].map(o => <option key={o}>{o}</option>)}
                    </select>
                  </FL>
                  <FL label="Volume (mL)"><input type="number" style={fld} value={iv.volume} onChange={e => setIV(p => ({ ...p, volume: e.target.value }))} placeholder="500" /></FL>
                  <FL label="Rate (mL/hr)"><input type="number" style={fld} value={iv.rate} onChange={e => setIV(p => ({ ...p, rate: e.target.value }))} placeholder="84" /></FL>
                  <FL label="Route"><input style={fld} value={iv.route} onChange={e => setIV(p => ({ ...p, route: e.target.value }))} placeholder="IV Right Forearm" /></FL>
                  <FL label="IV Site Status">
                    <select style={fld} value={iv.site} onChange={e => setIV(p => ({ ...p, site: e.target.value }))}>
                      {["Patent", "Redness", "Swelling", "Infiltration", "Replaced", "Blocked"].map(o => <option key={o}>{o}</option>)}
                    </select>
                  </FL>
                </div>
              )}

              {/* ── Blood Transfusion ── */}
              {activeModal === "blood" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ background: C.redL, border: `1.5px solid #fca5a5`, borderRadius: 8, padding: "9px 14px", fontSize: 12, color: C.red, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
                    <i className="pi pi-exclamation-triangle" style={{ fontSize: 13 }} /> Blood Product Administration — Dual ID Check Required
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <FL label="Blood Product">
                      <select style={fld} value={blood.product} onChange={e => setBlood(p => ({ ...p, product: e.target.value }))}>
                        {["PRC (Packed RBC)", "FFP", "Platelets", "Whole Blood", "Albumin", "Cryoprecipitate"].map(o => <option key={o}>{o}</option>)}
                      </select>
                    </FL>
                    <FL label="Bag No."><input style={fld} value={blood.bagNo} onChange={e => setBlood(p => ({ ...p, bagNo: e.target.value }))} placeholder="BT-YYYYMMDD-01" /></FL>
                    <FL label="Volume (mL)"><input type="number" style={fld} value={blood.volume} onChange={e => setBlood(p => ({ ...p, volume: e.target.value }))} placeholder="350" /></FL>
                    <FL label="Transfusion Status">
                      <select style={fld} value={blood.status} onChange={e => setBlood(p => ({ ...p, status: e.target.value }))}>
                        {["Transfusing", "Completed", "Held", "Reaction", "Stopped"].map(o => <option key={o}>{o}</option>)}
                      </select>
                    </FL>
                  </div>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontWeight: 700, fontSize: 13, color: blood.groupVerified ? C.green : C.red }}>
                    <input type="checkbox" checked={blood.groupVerified} onChange={e => setBlood(p => ({ ...p, groupVerified: e.target.checked }))} style={{ accentColor: C.green, width: 15, height: 15 }} />
                    Group & crossmatch verified ✓
                  </label>
                </div>
              )}

              {/* ── Intake / Output ── */}
              {activeModal === "intake" && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  {[
                    { k: "oral",        label: "Oral Intake (mL)",    placeholder: "200" },
                    { k: "ivFluids",    label: "IV Fluids (mL)",      placeholder: "500" },
                    { k: "urineOutput", label: "Urine Output (mL)",   placeholder: "300" },
                    { k: "drainOutput", label: "Drain / Other (mL)",  placeholder: "0" },
                    { k: "nasogastric", label: "Nasogastric (mL)",    placeholder: "0" },
                  ].map(f => (
                    <FL key={f.k} label={f.label}>
                      <input type="number" style={fld} value={intake[f.k]} placeholder={f.placeholder}
                        onChange={e => setIntake(p => ({ ...p, [f.k]: e.target.value }))} />
                    </FL>
                  ))}
                  <div style={{ display: "flex", flexDirection: "column", gap: 5, justifyContent: "flex-end" }}>
                    <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".7px", color: C.muted }}>Total Balance</div>
                    <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 18, fontWeight: 800,
                      color: (Number(intake.oral) + Number(intake.ivFluids)) - (Number(intake.urineOutput) + Number(intake.drainOutput)) >= 0 ? C.accent : C.red }}>
                      {(Number(intake.oral) + Number(intake.ivFluids)) - (Number(intake.urineOutput) + Number(intake.drainOutput))} mL
                    </div>
                  </div>
                </div>
              )}

              {/* ── Wound / Dressing ── */}
              {activeModal === "wound" && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <FL label="Wound Site"><input style={fld} value={wound.site} onChange={e => setWound(p => ({ ...p, site: e.target.value }))} placeholder="e.g. Right lower leg" /></FL>
                  <FL label="Wound Size"><input style={fld} value={wound.size} onChange={e => setWound(p => ({ ...p, size: e.target.value }))} placeholder="e.g. 3×2 cm" /></FL>
                  <FL label="Exudate">
                    <select style={fld} value={wound.exudate} onChange={e => setWound(p => ({ ...p, exudate: e.target.value }))}>
                      {["None", "Minimal (serous)", "Moderate (sero-sanguinous)", "Heavy (purulent)"].map(o => <option key={o}>{o}</option>)}
                    </select>
                  </FL>
                  <FL label="Healing Stage">
                    <select style={fld} value={wound.healingStage} onChange={e => setWound(p => ({ ...p, healingStage: e.target.value }))}>
                      {["Granulating", "Epithelializing", "Sloughy", "Infected", "Necrotic", "Dehisced"].map(o => <option key={o}>{o}</option>)}
                    </select>
                  </FL>
                  <FL label="Dressing Applied"><input style={fld} value={wound.dressing} onChange={e => setWound(p => ({ ...p, dressing: e.target.value }))} placeholder="e.g. Povidone + gauze" /></FL>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, alignSelf: "flex-end", cursor: "pointer", fontWeight: 700, fontSize: 13, color: wound.odour ? C.amber : C.muted }}>
                    <input type="checkbox" checked={wound.odour} onChange={e => setWound(p => ({ ...p, odour: e.target.checked }))} style={{ accentColor: C.amber, width: 15, height: 15 }} />
                    Odour present
                  </label>
                </div>
              )}

              {/* ── Skin / Pressure ── */}
              {activeModal === "skin" && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <FL label="Pressure Area"><input style={fld} value={skin.area} onChange={e => setSkin(p => ({ ...p, area: e.target.value }))} placeholder="e.g. Sacrum, heels" /></FL>
                  <FL label="Stage">
                    <select style={fld} value={skin.stage} onChange={e => setSkin(p => ({ ...p, stage: e.target.value }))}>
                      {["Stage I", "Stage II", "Stage III", "Stage IV", "Unstageable", "Deep Tissue"].map(o => <option key={o}>{o}</option>)}
                    </select>
                  </FL>
                  <FL label="Intervention"><input style={fld} value={skin.intervention} onChange={e => setSkin(p => ({ ...p, intervention: e.target.value }))} placeholder="Foam dressing, barrier cream…" /></FL>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, alignSelf: "flex-end", cursor: "pointer", fontWeight: 700, fontSize: 13, color: skin.repositioned ? C.green : C.muted }}>
                    <input type="checkbox" checked={skin.repositioned} onChange={e => setSkin(p => ({ ...p, repositioned: e.target.checked }))} style={{ accentColor: C.green, width: 15, height: 15 }} />
                    Patient repositioned
                  </label>
                </div>
              )}

              {/* ── Fall Risk ── */}
              {activeModal === "fall" && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <FL label="Morse Fall Score"><input type="number" style={fld} value={fallRisk.morseScore} onChange={e => setFallRisk(p => ({ ...p, morseScore: e.target.value }))} placeholder="0-125" /></FL>
                  <FL label="Risk Level">
                    <select style={fld} value={fallRisk.risk} onChange={e => setFallRisk(p => ({ ...p, risk: e.target.value }))}>
                      {["No Risk (<25)", "Low Risk (25-44)", "High Risk (≥45)"].map(o => <option key={o}>{o}</option>)}
                    </select>
                  </FL>
                  <div style={{ gridColumn: "span 2" }}>
                    <FL label="Interventions Applied"><textarea style={ta} value={fallRisk.interventions} onChange={e => setFallRisk(p => ({ ...p, interventions: e.target.value }))} placeholder="Bed rails up, non-slip socks, call bell within reach, bed in lowest position…" /></FL>
                  </div>
                </div>
              )}

              {/* ── Procedure ── */}
              {activeModal === "procedure" && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <FL label="Procedure Name"><input style={fld} value={procedure.procedureName} onChange={e => setProcedure(p => ({ ...p, procedureName: e.target.value }))} placeholder="e.g. Urinary catheterisation" /></FL>
                  <FL label="Indication"><input style={fld} value={procedure.indication} onChange={e => setProcedure(p => ({ ...p, indication: e.target.value }))} placeholder="Reason for procedure" /></FL>
                  <FL label="Performed By"><input style={fld} value={procedure.performedBy} onChange={e => setProcedure(p => ({ ...p, performedBy: e.target.value }))} placeholder="Nurse / Doctor name" /></FL>
                  <FL label="Outcome">
                    <select style={fld} value={procedure.outcome} onChange={e => setProcedure(p => ({ ...p, outcome: e.target.value }))}>
                      {["Tolerated Well", "Partial Cooperation", "Procedure Abandoned", "Complication Noted"].map(o => <option key={o}>{o}</option>)}
                    </select>
                  </FL>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, alignSelf: "center", cursor: "pointer", fontWeight: 700, fontSize: 13, color: procedure.consentObtained ? C.green : C.red }}>
                    <input type="checkbox" checked={procedure.consentObtained} onChange={e => setProcedure(p => ({ ...p, consentObtained: e.target.checked }))} style={{ accentColor: C.green, width: 15, height: 15 }} />
                    Consent Obtained
                  </label>
                </div>
              )}

              {/* ── Discharge / Handover ── */}
              {activeModal === "discharge" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <FL label="Type">
                      <select style={fld} value={discharge.type} onChange={e => setDischarge(p => ({ ...p, type: e.target.value }))}>
                        {["Shift Handover", "Patient Discharge", "Transfer Handover", "Death Summary"].map(o => <option key={o}>{o}</option>)}
                      </select>
                    </FL>
                    <FL label="Patient Status">
                      <select style={fld} value={discharge.patientStatus} onChange={e => setDischarge(p => ({ ...p, patientStatus: e.target.value }))}>
                        {["Stable", "Improving", "Critical", "Deteriorating", "Deceased"].map(o => <option key={o}>{o}</option>)}
                      </select>
                    </FL>
                    <FL label="Incoming Nurse"><input style={fld} value={discharge.incomingNurse} onChange={e => setDischarge(p => ({ ...p, incomingNurse: e.target.value }))} placeholder="Receiving nurse name" /></FL>
                  </div>
                  <FL label="Handover Summary"><textarea style={{ ...ta, minHeight: 100 }} value={discharge.summary} onChange={e => setDischarge(p => ({ ...p, summary: e.target.value }))} placeholder="Summary of patient condition, pending orders, special instructions…" /></FL>
                </div>
              )}

              {/* ── General Observation (default free text) ── */}
              {activeModal === "general" && null}

              {/* ── Common: Notes + Tags ── */}
              <div style={{ marginTop: 16 }}>
                <label style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".7px", color: C.muted, display: "block", marginBottom: 5 }}>
                  Nursing Notes / Observations
                </label>
                <textarea style={{ ...ta, minHeight: 88 }} value={noteText}
                  onChange={e => setNoteText(e.target.value)}
                  placeholder="Document clinical observations, actions taken, patient response…" />
              </div>

              {/* ── Quick Tags ── */}
              {MODULE_TAGS[activeModal]?.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".7px", color: C.muted, marginBottom: 7 }}>Quick Tags</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {MODULE_TAGS[activeModal].map(t => (
                      <button key={t} onClick={() => toggleTag(t)}
                        style={{ padding: "4px 10px", borderRadius: 5, fontSize: 11, fontWeight: 600, cursor: "pointer",
                          border: `1.5px solid ${selectedTags.includes(t) ? C.accent : C.border}`,
                          background: selectedTags.includes(t) ? C.accentL : "white",
                          color: selectedTags.includes(t) ? C.accent : C.muted,
                          transition: "all .15s" }}>
                        {selectedTags.includes(t) ? <><i className="pi pi-check" style={{ fontSize: 9, marginRight: 4 }} /></> : null}
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Critical Event ── */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, padding: "10px 14px",
                background: C.redL, border: `1.5px solid #fca5a5`, borderRadius: 8 }}>
                <input type="checkbox" id="criticalEvt" checked={isCritical} onChange={e => setIsCritical(e.target.checked)}
                  style={{ accentColor: C.red, width: 16, height: 16 }} />
                <label htmlFor="criticalEvt" style={{ fontSize: 13, fontWeight: 600, color: C.red, cursor: "pointer" }}>
                  <i className="pi pi-exclamation-triangle" style={{ marginRight: 5, fontSize: 12 }} />
                  Mark as Critical Event — will alert doctor
                </label>
              </div>
            </div>

            {/* Modal footer */}
            <div style={{ padding: "13px 22px", borderTop: `1px solid ${C.border}`,
              display: "flex", justifyContent: "space-between", alignItems: "center",
              background: C.grayL, borderRadius: "0 0 14px 14px", position: "sticky", bottom: 0 }}>
              <div style={{ fontSize: 11, color: C.muted }}>
                <i className="pi pi-clock" style={{ marginRight: 4, fontSize: 10 }} />
                {new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })} ·{" "}
                {shift.charAt(0).toUpperCase() + shift.slice(1)} shift
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setActiveModal(null)}
                  style={{ padding: "9px 20px", border: `1.5px solid ${C.border}`, borderRadius: 8,
                    background: "white", fontFamily: "'DM Sans',sans-serif", fontSize: 13, fontWeight: 600,
                    cursor: "pointer", color: C.muted }}>
                  Cancel
                </button>
                <button onClick={saveNote} disabled={loading}
                  style={{ padding: "9px 24px", background: loading ? "#86efac" : C.green, color: "white",
                    border: "none", borderRadius: 8, fontFamily: "'DM Sans',sans-serif", fontSize: 13,
                    fontWeight: 700, cursor: loading ? "not-allowed" : "pointer",
                    display: "flex", alignItems: "center", gap: 7,
                    boxShadow: `0 4px 12px ${C.green}35` }}>
                  <i className={`pi ${loading ? "pi-spin pi-spinner" : "pi-check"}`} style={{ fontSize: 12 }} />
                  {loading ? "Saving…" : "Save Note"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
