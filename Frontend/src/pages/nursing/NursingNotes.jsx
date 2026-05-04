import React, { useState, useEffect, useRef } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { API_ENDPOINTS } from "../../config/api";
import { useAuth } from "../../context/AuthContext";
import { toast } from "react-toastify";
import { useAutoSave } from "../../hooks/useAutoSave";
import { useDigitalSignature } from "../../hooks/useDigitalSignature";
import AutoSaveIndicator from "../../Components/signature/AutoSaveIndicator";
import SignaturePad from "../../Components/signature/SignaturePad";
import ClinicalLayout from "../../Components/clinical/ClinicalLayout";
import NurseOrdersPanel from "../../Components/clinical/NurseOrdersPanel";
import TreatmentChart from "../../Components/clinical/TreatmentChart";
import FingerprintConsentModal from "../../Components/clinical/FingerprintConsentModal";
import IntegratedVitalsPanel from "../../Components/clinical/IntegratedVitalsPanel";
import NursingPatientReport from "../../Components/nursing/NursingPatientReport";

/* ── Design tokens ── */
const C = {
  bg: "#f8fafc", card: "#ffffff", border: "#e2e8f0", text: "#0f172a", muted: "#64748b",
  primary: "#0f766e", primaryL: "#f0fdfa", primaryMid: "#0d9488",
  green: "#16a34a", greenL: "#dcfce7", greenB: "#bbf7d0",
  amber: "#d97706", amberL: "#fffbeb", amberB: "#fde68a",
  red: "#dc2626", redL: "#fef2f2", redB: "#fecaca",
  blue: "#1d4ed8", blueL: "#eff6ff", blueB: "#bfdbfe",
  purple: "#7c3aed", purpleL: "#f5f3ff",
  slate: "#1e293b", slateMid: "#334155",
  // legacy aliases kept for NOTE_STYLE / SHIFT_STYLE references
  accent: "#1d4ed8", accentL: "#eff6ff",
  teal: "#0d9488", tealL: "#f0fdfa",
  orange: "#ea580c", orangeL: "#fff7ed",
  pink: "#db2777",
  gray: "#9ca3af", grayL: "#f9fafb",
};

const fld = {
  padding: "9px 12px", border: "1.5px solid #e2e8f0", borderRadius: 8,
  fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: "#0f172a",
  outline: "none", background: "white", width: "100%", boxSizing: "border-box",
};
const sel = { ...fld, cursor: "pointer" };
const ta = { ...fld, resize: "vertical", minHeight: 80 };

const lbl = {
  display: "block", fontSize: 11, fontWeight: 700, color: C.muted,
  textTransform: "uppercase", letterSpacing: ".6px", marginBottom: 5,
};

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
  { id: "mews",      label: "MEWS Score",                 icon: "pi-chart-bar",               border: "#fbbf24", color: "#92400e", bg: "#fffbeb", dot: true },
  { id: "general",   label: "General Observation",        icon: "pi-file",                    border: "#d1d5db", color: "#374151", bg: C.grayL },
  // ── Consolidated from sidebar ──
  { id: "daily",     label: "Daily Assessment",           icon: "pi-calendar-plus",           border: "#bae6fd", color: "#0369a1", bg: "#e0f2fe" },
  { id: "initial",   label: "Initial Assessment",         icon: "pi-clipboard",               border: "#f9a8d4", color: "#be185d", bg: "#fdf2f8" },
  { id: "careplan",  label: "Care Plan",                  icon: "pi-heart-fill",              border: "#6ee7b7", color: "#065f46", bg: "#ecfdf5" },
  { id: "nutrition", label: "Nutritional Assessment",     icon: "pi-apple",                   border: "#86efac", color: "#15803d", bg: "#dcfce7" },
  { id: "education", label: "Patient Education",          icon: "pi-book",                    border: "#c4b5fd", color: "#6d28d9", bg: "#f5f3ff" },
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
  mews:      { bg: C.amberL, color: "#92400e",  dot: C.amber    },
  daily:     { bg: "#e0f2fe", color: "#0369a1", dot: "#0ea5e9" },
  initial:   { bg: "#fdf2f8", color: "#be185d", dot: "#ec4899" },
  careplan:  { bg: "#ecfdf5", color: "#065f46", dot: "#10b981" },
  nutrition: { bg: "#dcfce7", color: "#15803d", dot: "#22c55e" },
  education: { bg: "#f5f3ff", color: "#6d28d9", dot: "#8b5cf6" },
};

const SHIFT_STYLE = {
  morning:   { bg: "#dbeafe", color: "#1e40af" },
  afternoon: { bg: C.amberL,  color: "#92400e" },
  evening:   { bg: "#ede9fe", color: C.purple  },
  night:     { bg: C.slate,   color: "#94a3b8" },
};

/* ── Quick tags per module ── */
const MODULE_TAGS = {
  vitals:    ["Doctor Notified", "High BP", "High BSL", "Low SpO\u2082", "Tachycardia", "Fever"],
  blood:     ["Pre-check \u2713", "Consent Obtained", "Doctor Informed", "Reaction Noted", "Dual ID Check"],
  iv:        ["Site OK", "Pump Set", "Bottle Changed", "Line Flushed", "Infiltration Noted"],
  wound:     ["Dressing Done", "Wound Swabbed", "Doctor Notified", "Healing Well", "Infection Signs"],
  pain:      ["Analgesic Given", "Doctor Informed", "Pain Reassessed", "Non-pharmacological"],
  neuro:     ["GCS Changed", "Doctor Informed", "Seizure Noted", "Pupil Change"],
  intake:    ["Positive Balance", "Negative Balance", "Foley Cath Patent", "NGT Feed Given"],
  fall:      ["Fall Precautions Active", "Bed Rails Up", "Patient Educated", "Doctor Informed"],
  skin:      ["Repositioned", "Barrier Cream Applied", "Foam Dressing", "Dietician Alerted"],
  procedure: ["Consent Obtained", "Doctor Present", "Patient Tolerated Well", "Specimen Sent"],
  discharge: ["Patient Educated", "Instructions Given", "Valuables Returned", "Handover Completed"],
  mews:      ["Doctor Alerted", "ICU Notified", "Rapid Response Called", "Vitals Rechecked", "Family Informed"],
  general:   ["Doctor Informed", "Family Informed", "Patient Comfortable", "Monitoring Continued"],
  daily:     ["Systems Checked", "Vitals Stable", "Doctor Informed", "Interventions Completed", "Care Continued"],
  initial:   ["Braden Scored", "Morse Fall Scored", "Psychosocial Assessed", "Care Plan Initiated", "Family Educated"],
  careplan:  ["Problem Identified", "Goals Set", "Intervention Planned", "Goal Achieved", "Plan Revised"],
  nutrition: ["NRS-2002 Completed", "Dietitian Referred", "Diet Modified", "Intake Adequate", "Patient Educated"],
  education: ["Patient Understood", "Family Included", "Verbal Confirmation", "Follow-up Planned", "Materials Given"],
};

/* ── MEWS Scoring ── */
const calcMEWS = (m) => {
  let s = 0;
  const rr = Number(m.rr), spo2 = Number(m.spo2), temp = Number(m.temp), sbp = Number(m.sbp), hr = Number(m.hr);
  if (rr)   { if (rr<=8) s+=3; else if (rr<=11) s+=1; else if (rr<=20) s+=0; else if (rr<=24) s+=2; else s+=3; }
  if (spo2) { if (spo2>=96) s+=0; else if (spo2>=94) s+=1; else if (spo2>=92) s+=2; else s+=3; }
  if (temp) { if (temp<=35) s+=3; else if (temp<=36) s+=1; else if (temp<=38) s+=0; else if (temp<=38.5) s+=1; else s+=2; }
  if (sbp)  { if (sbp<=90) s+=3; else if (sbp<=100) s+=2; else if (sbp<=110) s+=1; else if (sbp<=219) s+=0; else s+=3; }
  if (hr)   { if (hr<=40) s+=3; else if (hr<=50) s+=1; else if (hr<=90) s+=0; else if (hr<=110) s+=1; else if (hr<=130) s+=2; else s+=3; }
  const avpuMap = { A:0, V:1, P:2, U:3 };
  s += (avpuMap[m.avpu] ?? 0);
  return s;
};
const mewsBand = (score) => {
  if (score <= 1) return { label:"Normal", color:C.green, bg:C.greenL, action:"Routine monitoring", icon:"pi-check-circle" };
  if (score <= 4) return { label:"Increased Monitoring", color:C.amber, bg:C.amberL, action:"Increase frequency, inform nurse-in-charge", icon:"pi-exclamation-circle" };
  if (score <= 6) return { label:"Urgent Review", color:C.orange, bg:C.orangeL, action:"Immediate review — consider calling doctor urgently", icon:"pi-exclamation-triangle" };
  return { label:"EMERGENCY", color:C.red, bg:C.redL, action:"Call doctor IMMEDIATELY — consider ICU/HDU transfer", icon:"pi-bolt" };
};
const mewsParamScore = (param, val) => {
  const v = Number(val); if (!v && param!=="avpu") return null;
  if (param==="rr")   return v<=8?3:v<=11?1:v<=20?0:v<=24?2:3;
  if (param==="spo2") return v>=96?0:v>=94?1:v>=92?2:3;
  if (param==="temp") return v<=35?3:v<=36?1:v<=38?0:v<=38.5?1:2;
  if (param==="sbp")  return v<=90?3:v<=100?2:v<=110?1:v<=219?0:3;
  if (param==="hr")   return v<=40?3:v<=50?1:v<=90?0:v<=110?1:v<=130?2:3;
  if (param==="avpu") return {A:0,V:1,P:2,U:3}[val]??0;
  return null;
};

/* ── Morse Fall Scale ── */
const calcMorse = (f) => {
  return Number(f.m1||0) + Number(f.m2||0) + Number(f.m3||0) + Number(f.m4||0) + Number(f.m5||0) + Number(f.m6||0);
};
const morseBand = (score) => {
  if (score < 25)  return { label:"No Risk", color:C.green, bg:C.greenL };
  if (score < 45)  return { label:"Low Risk", color:C.amber, bg:C.amberL };
  return { label:"High Risk", color:C.red, bg:C.redL };
};

/* ── Braden Scale ── */
const calcBraden = (s) => {
  return Number(s.b1||1) + Number(s.b2||1) + Number(s.b3||1) + Number(s.b4||1) + Number(s.b5||1) + Number(s.b6||1);
};
const bradenBand = (score) => {
  if (score <= 9)  return { label:"Very High Risk", color:C.red, bg:C.redL };
  if (score <= 12) return { label:"High Risk", color:C.orange, bg:C.orangeL };
  if (score <= 14) return { label:"Moderate Risk", color:C.amber, bg:C.amberL };
  if (score <= 18) return { label:"Mild Risk", color:C.blue, bg:C.blueL };
  return { label:"No Risk", color:C.green, bg:C.greenL };
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

/* ── Field label helper ── */
function FL({ label, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <label style={lbl}>{label}</label>
      {children}
    </div>
  );
}

/* ── Section card ── */
function Section({ title, icon, color = C.primary, children }) {
  return (
    <div style={{ background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 12, marginBottom: 14, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,.04)" }}>
      <div style={{ padding: "10px 18px", background: "#f8fafc", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 28, height: 28, borderRadius: 7, background: color + "18", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <i className={`pi ${icon}`} style={{ fontSize: 12, color }} />
        </span>
        <span style={{ fontWeight: 700, fontSize: 13, color: C.text }}>{title}</span>
      </div>
      <div style={{ padding: "16px 18px" }}>{children}</div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════ */
function NursingNotesContent({ selectedPatient }) {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [searchUHID, setSearchUHID] = useState("");
  const [ipdNoForDraft, setIpdNoForDraft] = useState("");

  useEffect(() => {
    if (selectedPatient?.UHID) setSearchUHID(selectedPatient.UHID);
  }, [selectedPatient]);

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

  /* ── Equipment / Nursing Charges ── */
  const [equipItems,    setEquipItems]    = useState([]);   // master catalogue
  const [equipLoading,  setEquipLoading]  = useState(false);
  const [todayCharges,  setTodayCharges]  = useState([]);   // already billed today
  const [selectedEquip, setSelectedEquip] = useState({});   // { itemId: qty }
  const [equipSaving,   setEquipSaving]   = useState(false);
  const [equipSaved,    setEquipSaved]    = useState(false);

  /* ── Doctor Orders panel ── */
  const [ordersRefresh, setOrdersRefresh] = useState(0);
  const [consentOrder,  setConsentOrder]  = useState(null);

  /* ── Patient Report (print / PDF) ── */
  const [showReport, setShowReport] = useState(false);

  /* ── Module-specific form state ── */
  const [vitals,    setVitals]    = useState({ bp: "", pulse: "", temp: "", spo2: "", rr: "", gcs: "", bsl: "", painScore: "", o2Flow: "", o2Device: "None", weight: "", position: "Supine" });
  const [blood,     setBlood]     = useState({ product: "PRC (Packed RBC)", bagNo: "", crossMatchNo: "", volume: "350", groupVerified: true, secondNurse: "", startTime: "", status: "Transfusing", endTime: "", reactionType: "None", preBP: "", prePulse: "", preTemp: "", postBP: "", postPulse: "" });
  const [iv,        setIV]        = useState({ fluid: "NS 0.9%", volume: "", rate: "", dropsPerMin: "", route: "IV Right Forearm", site: "Patent", cannulaDate: "", setChangeDate: "", additive: "" });
  const [intake,    setIntake]    = useState({ oral: "", ivFluids: "", bloodProducts: "", urineOutput: "", drainOutput: "", nasogastric: "", emesis: "", bloodLoss: "" });
  const [ivMedOrders,    setIvMedOrders]    = useState([]); // IV dilution volumes from Treatment Chart
  const [ivMedLoading,   setIvMedLoading]   = useState(false);
  const [includedMedIds, setIncludedMedIds] = useState(new Set());
  const [neuro,     setNeuro]     = useState({ gcse: "", gcsv: "", gcsm: "", pupils: "Equal & Reactive", pupilSizeL: "", pupilSizeR: "", lightReflex: "Present", seizure: false, orientation: "Alert & Oriented ×3", limbUL: "Normal", limbUR: "Normal", limbLL: "Normal", limbLR: "Normal" });
  const [pain,      setPain]      = useState({ scale: "NRS", score: "", location: "", type: "Acute", character: "Dull", onset: "Sudden", duration: "", frequency: "Constant", radiation: false, radiationSite: "", aggravating: "", relieving: "", painOnMovement: false, nonPharm: "", analgesicGiven: false, analgesic: "", analgesicRoute: "IV", analgesicTime: "", reassessScore: "", reassessTime: "" });
  const [wound,     setWound]     = useState({ type: "Surgical", site: "", length: "", width: "", depth: "", exudateAmt: "None", exudateType: "Serous", healingStage: "Granulating", surroundingSkin: "Intact", tunneling: false, undermining: false, odour: false, dressing: "", painDuring: "", nextDressingDate: "", swabSent: false });
  const [skin,      setSkin]      = useState({ area: "", b1: "4", b2: "4", b3: "4", b4: "4", b5: "4", b6: "3", stage: "Stage I", intervention: "", repositioned: false, repositionFreq: "2-hourly" });
  const [fallRisk,  setFallRisk]  = useState({ m1: "0", m2: "0", m3: "0", m4: "0", m5: "0", m6: "0", intBedRails: false, intCallBell: false, intNonSlip: false, intBedLowest: false, intSupervision: false, intPatientEd: false, intFamilyEd: false });
  const [procedure, setProcedure] = useState({ procedureName: "", indication: "", site: "", laterality: "N/A", time: "", consentObtained: true, performedBy: "", designation: "Staff Nurse", assistant: "", sterile: true, position: "Supine", outcome: "Tolerated Well", complications: "None", specimenSent: false, specimenType: "", postProcVitals: "", followUp: "" });
  const [discharge, setDischarge] = useState({ type: "Shift Handover", situation: "", background: "", assessment: "", recommendation: "", incomingNurse: "", patientStatus: "Stable", educationGiven: false, educationTopics: "", followUpDate: "", valuablesHandedOver: false });
  const [mews,      setMews]      = useState({ rr: "", spo2: "", temp: "", sbp: "", hr: "", avpu: "A" });

  /* ── Fetch IV dilution orders when I/O tab opens ── */
  useEffect(() => {
    if (activeModal !== "intake" || !patient) return;
    const uhid = patient?.uhid || patient?.UHID || patient?.patientId?.uhid || patient?.patientId?.UHID;
    if (!uhid) return;
    setIvMedLoading(true);
    axios.get(`${API_ENDPOINTS.DOCTOR_ORDERS}?UHID=${uhid}`)
      .then(({ data }) => {
        const orders = Array.isArray(data) ? data : (data.data || []);
        const isToday = (dateStr) => {
          if (!dateStr) return false;
          const d = new Date(dateStr), t = new Date();
          return d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth() && d.getDate() === t.getDate();
        };
        // Parse "Dilute in Xml ..." from notes as fallback when totalVolume not set
        const parseDilutionVolume = (od = {}) => {
          if (Number(od.totalVolume || 0) > 0) return Number(od.totalVolume);
          const m = (od.notes || "").match(/dilute\s+in\s+(\d+)\s*ml/i);
          return m ? Number(m[1]) : 0;
        };
        const parseDilutionFluid = (od = {}) => {
          if (od.dilution) return od.dilution;
          const m = (od.notes || "").match(/dilute\s+in\s+\d+\s*ml\s+(\S+)/i);
          return m ? m[1] : "";
        };
        const ivOrders = orders
          .filter(o => {
            const route = (o.orderDetails?.route || "").toLowerCase();
            return (route.includes("iv") || route.includes("intravenous")) &&
                   parseDilutionVolume(o.orderDetails) > 0;
          })
          .map(o => {
            const vol = parseDilutionVolume(o.orderDetails);
            const dilutionFluid = parseDilutionFluid(o.orderDetails);
            const todayGiven = (o.administrationRecord || []).filter(r =>
              r.status === "given" && isToday(r.givenAt)
            );
            const infusionVol = (o.infusionMonitoring || [])
              .filter(m => m.volumeInfused && isToday(m.time))
              .reduce((s, m) => s + Number(m.volumeInfused || 0), 0);
            const totalVol = todayGiven.length > 0
              ? todayGiven.length * vol
              : infusionVol;
            return {
              id: o._id,
              name: o.orderDetails.medicineName || "Unknown",
              dose: o.orderDetails.dose || "",
              dilution: dilutionFluid,
              volPerDose: vol,
              administered: todayGiven.length,
              totalVol,
              times: todayGiven.map(r => new Date(r.givenAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })),
            };
          });
        setIvMedOrders(ivOrders);
        setIncludedMedIds(new Set(ivOrders.filter(o => o.totalVol > 0).map(o => o.id)));
      })
      .catch(() => {})
      .finally(() => setIvMedLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeModal, patient]);

  /* ── New consolidated module state ── */
  const [dailyAssess, setDailyAssess] = useState({
    // Vitals snapshot
    bp: "", pulse: "", temp: "", spo2: "", rr: "", bsl: "", gcs: "",
    // System assessments
    neuroStatus: "Alert & Oriented", respiratoryStatus: "Clear bilaterally", cardiovascularStatus: "Regular rate & rhythm",
    giStatus: "Active bowel sounds", guStatus: "Urine output adequate", musculoskeletalStatus: "Moves all extremities", skinStatus: "Intact",
    // Interventions (checklist)
    intReposition: false, intOralCare: false, intPressureRelief: false, intRangeOfMotion: false,
    intFallPrecautions: false, intCallBell: false, intMedAdministered: false, intWoundCare: false,
    intIVCheck: false, intNGTCheck: false, intFoleyCheck: false, intOxygenCheck: false,
    intPatientEducation: false, intFamilyUpdate: false, intDoctorNotified: false, intDocumented: false,
  });
  const [initialAssess, setInitialAssess] = useState({
    // Admission details
    admissionMode: "Planned", chiefComplaint: "", duration: "", historyOfIllness: "",
    // Past history
    pastMedical: "", pastSurgical: "", medications: "", allergies: "None", familyHistory: "",
    // Systems review
    respiratory: "Normal", cardiovascular: "Normal", gastrointestinal: "Normal",
    genitourinary: "Normal", musculoskeletal: "Normal", neurological: "Normal",
    // Vitals at admission
    bp: "", pulse: "", temp: "", spo2: "", rr: "", weight: "", height: "",
    // Braden (pressure ulcer risk)
    b1: "4", b2: "4", b3: "4", b4: "4", b5: "4", b6: "3",
    // Morse (fall risk)
    m1: "0", m2: "0", m3: "0", m4: "0", m5: "0", m6: "0",
    // Psychosocial
    anxiety: "None", depression: "None", painLevel: "0", sleepPattern: "Normal",
    cognition: "Intact", communication: "Verbal", religion: "", languageBarrier: false,
    // Nutrition
    nutritionStatus: "Adequate", appetiteStatus: "Normal", swallowing: "Normal",
    // Discharge planning
    dischargePlan: "Home", caregiverAvailable: true, caregiverName: "", specialNeeds: "",
    // IV access
    ivSite: "", ivType: "", ivDate: "", ivCondition: "Patent",
  });
  const [carePlan, setCarePlan] = useState({
    problems: [{ id: Date.now(), statement: "", relatedTo: "", evidencedBy: "", priority: "High", goals: "", targetDate: "", interventions: "", evaluation: "", status: "Active" }],
  });
  const [nutrition, setNutrition] = useState({
    // NRS-2002 Pre-screening
    bmi: "", bmiLow: false, weightLoss: false, reducedIntake: false, seriouslyIll: false,
    // NRS-2002 Nutritional status score
    nutritionScore: "0", diseaseScore: "0", ageScore: false,
    // Anthropometrics
    weight: "", height: "", idealBodyWeight: "", actualWeightPercent: "", midArmCirc: "",
    // Diet assessment
    dietType: "Regular", consistency: "Normal", fluidRestriction: false, fluidLimit: "",
    appetite: "Good", swallowing: "Normal", feedingMode: "Oral", ngtPresent: false,
    // Intake
    caloriesToday: "", proteinToday: "", fluidToday: "",
    // Referral
    dietitianReferral: false, referralReason: "",
  });
  const [education, setEducation] = useState({
    date: new Date().toISOString().split("T")[0],
    educator: "",
    topics: [],
    methods: [],
    language: "Hindi",
    understanding: "Good",
    barriers: [],
    response: "Positive",
    sessionNotes: "",
    nextSessionDate: "",
  });

  /* ── Auto-save draft (saves all module states keyed by IPD) ── */
  const draftKey = ipdNoForDraft ? `sphere_draft_nurse_${ipdNoForDraft}` : null;
  const { savedAt, hasDraft, clearDraft } = useAutoSave(
    draftKey,
    { vitals, blood, iv, intake, neuro, pain, wound, skin, fallRisk, procedure, discharge, mews,
      dailyAssess, initialAssess, carePlan, nutrition, education, noteText, shift },
    2000
  );

  /* ── Digital signature ── */
  const { signature, showSetup, setShowSetup, saveSignature } = useDigitalSignature();

  /* ── Load equipment master catalogue once ── */
  useEffect(() => {
    (async () => {
      setEquipLoading(true);
      try {
        const { data } = await axios.get(`${API_ENDPOINTS.NURSING_CHARGES}/items`);
        const arr = Array.isArray(data) ? data : data.data || [];
        setEquipItems(arr.filter(i => i.isActive !== false));
      } catch { /* silent */ }
      finally { setEquipLoading(false); }
    })();
  }, []);

  /* ── Load today's charges for an admission ── */
  const loadTodayCharges = async (admissionId) => {
    if (!admissionId) return;
    try {
      const { data } = await axios.get(`${API_ENDPOINTS.NURSING_CHARGES}/${admissionId}/today`);
      const arr = Array.isArray(data) ? data : data.data || [];
      setTodayCharges(arr);
    } catch { setTodayCharges([]); }
  };

  /* ── Log selected equipment ── */
  const logEquipment = async () => {
    if (!patient) return;
    const items = Object.entries(selectedEquip)
      .filter(([, qty]) => qty > 0)
      .map(([itemId, qty]) => ({ itemId, quantity: qty }));
    if (!items.length) { toast.warn("Select at least one item"); return; }

    const admissionId = patient._id;
    setEquipSaving(true);
    try {
      const token = localStorage.getItem("his_token");
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const { data } = await axios.post(
        `${API_ENDPOINTS.NURSING_CHARGES}/log`,
        {
          admissionId,
          patientId: patient.patientId?._id || patient.patientId,
          UHID: patient.UHID || patient.uhid || searchUHID,
          items,
          shift,
          chargedBy: user?.fullName || `${user?.firstName || ""} ${user?.lastName || ""}`.trim(),
        },
        { headers }
      );
      const saved  = data?.data?.saved  || [];
      const skipped = data?.data?.skipped || [];
      if (saved.length)   toast.success(`${saved.length} item(s) logged & billed`);
      if (skipped.length) toast.info(`${skipped.length} item(s) skipped (already billed today): ${skipped.map(s => s.itemName).join(", ")}`);
      setSelectedEquip({});
      setEquipSaved(true);
      setTimeout(() => setEquipSaved(false), 3000);
      await loadTodayCharges(admissionId);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to log equipment");
    } finally { setEquipSaving(false); }
  };

  /* ── Load patient ── */
  const loadPatient = async (e) => {
    e?.preventDefault();
    if (!searchUHID.trim()) return;
    setLoading(true);
    try {
      // Use /active endpoint — it returns { data: [...] } and already filters status:"Active"
      // Also supports ?UHID= filter (both cases handled in service)
      const { data } = await axios.get(
        `${API_ENDPOINTS.ADMISSIONS}/active?UHID=${encodeURIComponent(searchUHID.trim())}`
      );
      const arr = Array.isArray(data) ? data : data.data || [];
      const active = arr[0]; // all results are already Active; take latest
      if (active) {
        setPatient(active);
        const ipd = active.ipdNo || active.admissionNumber || active._id;
        setIpdNoForDraft(ipd);

        // Restore draft if one exists for this patient
        const dKey = `sphere_draft_nurse_${ipd}`;
        let draftRestored = false;
        try {
          const raw = localStorage.getItem(dKey);
          if (raw) {
            const { _meta, vitals: dv, blood: db, iv: div, intake: di, neuro: dn, pain: dp, wound: dw,
              skin: dsk, fallRisk: dfr, procedure: dpr, discharge: ddc, mews: dmw,
              dailyAssess: dda, initialAssess: dia, carePlan: dcp, nutrition: dnu, education: ded,
              noteText: dnt, shift: dsh } = JSON.parse(raw);
            if (dv)  setVitals(v => ({ ...v, ...dv }));
            if (db)  setBlood(b => ({ ...b, ...db }));
            if (div) setIV(i => ({ ...i, ...div }));
            if (di)  setIntake(i => ({ ...i, ...di }));
            if (dn)  setNeuro(n => ({ ...n, ...dn }));
            if (dp)  setPain(p => ({ ...p, ...dp }));
            if (dw)  setWound(w => ({ ...w, ...dw }));
            if (dsk) setSkin(s => ({ ...s, ...dsk }));
            if (dfr) setFallRisk(f => ({ ...f, ...dfr }));
            if (dpr) setProcedure(p => ({ ...p, ...dpr }));
            if (ddc) setDischarge(d => ({ ...d, ...ddc }));
            if (dmw) setMews(m => ({ ...m, ...dmw }));
            if (dda) setDailyAssess(d => ({ ...d, ...dda }));
            if (dia) setInitialAssess(i => ({ ...i, ...dia }));
            if (dcp) setCarePlan(c => ({ ...c, ...dcp }));
            if (dnu) setNutrition(n => ({ ...n, ...dnu }));
            if (ded) setEducation(e => ({ ...e, ...ded }));
            if (dnt) setNoteText(dnt);
            if (dsh) setShift(dsh);
            draftRestored = true;
            toast.info(`📝 Draft restored (${_meta?.savedAt ? new Date(_meta.savedAt).toLocaleTimeString() : "last session"})`, { autoClose: 3000 });
          }
        } catch (_) {}

        if (!draftRestored) {
          setVitals({ bp: "", pulse: "", temp: "", spo2: "", rr: "", gcs: "", bsl: "", painScore: "", o2Flow: "", o2Device: "None", weight: "", position: "Supine" });
          setMews({ rr: "", spo2: "", temp: "", sbp: "", hr: "", avpu: "A" });
        }
        setIvMedOrders([]); setIncludedMedIds(new Set());
        await fetchNotes(ipd);
        await loadTodayCharges(active._id);
        toast.success(`Loaded: ${active.patientName || active.patientId?.fullName || searchUHID}`);
      } else {
        toast.warn("No active IPD admission found for UHID: " + searchUHID);
      }
    } catch (err) {
      toast.error(err?.response?.data?.message || "Patient not found");
    }
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
    // vitals persist across tab switches — they're updated live by IntegratedVitalsPanel
    setBlood({ product: "PRC (Packed RBC)", bagNo: "", crossMatchNo: "", volume: "350", groupVerified: true, secondNurse: "", startTime: "", status: "Transfusing", endTime: "", reactionType: "None", preBP: "", prePulse: "", preTemp: "", postBP: "", postPulse: "" });
    setIV({ fluid: "NS 0.9%", volume: "", rate: "", dropsPerMin: "", route: "IV Right Forearm", site: "Patent", cannulaDate: "", setChangeDate: "", additive: "" });
    setIntake({ oral: "", ivFluids: "", bloodProducts: "", urineOutput: "", drainOutput: "", nasogastric: "", emesis: "", bloodLoss: "" });
    // When opening MEWS tab, seed from current vitals; otherwise reset
    if (id === "mews") {
      const [sbp = ""] = (vitals.bp || "").split("/");
      setMews(p => ({ ...p, rr: vitals.rr || p.rr, spo2: vitals.spo2 || p.spo2, temp: vitals.temp || p.temp, sbp: sbp || p.sbp, hr: vitals.pulse || p.hr }));
    } else {
      setMews({ rr: "", spo2: "", temp: "", sbp: "", hr: "", avpu: "A" });
    }
    setDailyAssess({ bp:"", pulse:"", temp:"", spo2:"", rr:"", bsl:"", gcs:"", neuroStatus:"Alert & Oriented", respiratoryStatus:"Clear bilaterally", cardiovascularStatus:"Regular rate & rhythm", giStatus:"Active bowel sounds", guStatus:"Urine output adequate", musculoskeletalStatus:"Moves all extremities", skinStatus:"Intact", intReposition:false, intOralCare:false, intPressureRelief:false, intRangeOfMotion:false, intFallPrecautions:false, intCallBell:false, intMedAdministered:false, intWoundCare:false, intIVCheck:false, intNGTCheck:false, intFoleyCheck:false, intOxygenCheck:false, intPatientEducation:false, intFamilyUpdate:false, intDoctorNotified:false, intDocumented:false });
    setCarePlan({ problems: [{ id: Date.now(), statement:"", relatedTo:"", evidencedBy:"", priority:"High", goals:"", targetDate:"", interventions:"", evaluation:"", status:"Active" }] });
    setNutrition({ bmi:"", bmiLow:false, weightLoss:false, reducedIntake:false, seriouslyIll:false, nutritionScore:"0", diseaseScore:"0", ageScore:false, weight:"", height:"", idealBodyWeight:"", actualWeightPercent:"", midArmCirc:"", dietType:"Regular", consistency:"Normal", fluidRestriction:false, fluidLimit:"", appetite:"Good", swallowing:"Normal", feedingMode:"Oral", ngtPresent:false, caloriesToday:"", proteinToday:"", fluidToday:"", dietitianReferral:false, referralReason:"" });
    setEducation({ date: new Date().toISOString().split("T")[0], educator:"", topics:[], methods:[], language:"Hindi", understanding:"Good", barriers:[], response:"Positive", sessionNotes:"", nextSessionDate:"" });
  };

  const toggleTag = (t) => setSelectedTags(ts => ts.includes(t) ? ts.filter(x => x !== t) : [...ts, t]);

  const saveNote = async () => {
    if (!patient) { toast.warn("No patient loaded"); return; }
    const ipdNo = patient.ipdNo || patient.admissionNumber || patient._id;
    let payload = {
      patientId: patient._id || patient.patientId || undefined,
      patientUHID: patient.uhid || patient.UHID || searchUHID,
      patientName: patient.patientName || patient.patient?.name || "",
      ipdNo, shift, noteType: activeModal, isCriticalEvent: isCritical,
      remarks: noteText, tags: selectedTags, status: "submitted",
      nurseName: user?.fullName || `${user?.firstName || ""} ${user?.lastName || ""}`.trim(),
      nurseEmployeeId: user?.employeeId || "",
      nurseId: user?._id || user?.id || undefined,
    };
    if (activeModal === "vitals")   payload.vitals = { bp: { systolic: Number(vitals.bp.split("/")[0] || 0), diastolic: Number(vitals.bp.split("/")[1] || 0) }, pulse: Number(vitals.pulse), temp: Number(vitals.temp), spo2: Number(vitals.spo2), rr: Number(vitals.rr), gcs: vitals.gcs, bsl: Number(vitals.bsl) };
    if (activeModal === "blood")    payload.bloodTransfusion = blood;
    if (activeModal === "iv")       payload.ivInfusion = iv;
    if (activeModal === "intake") {
      const _autoMedVol = ivMedOrders.filter(o => includedMedIds.has(o.id)).reduce((s, o) => s + o.totalVol, 0);
      payload.intakeOutput = { oral: Number(intake.oral), ivFluids: Number(intake.ivFluids) + _autoMedVol, ivMedFluids: _autoMedVol, urineOutput: Number(intake.urineOutput), nasogastricOutput: Number(intake.nasogastric), otherOutput: Number(intake.drainOutput) };
    }
    if (activeModal === "neuro")    payload.neuroAssessment = neuro;
    if (activeModal === "pain")     payload.painAssessment = pain;
    if (activeModal === "wound")    payload.woundCare = wound;
    if (activeModal === "skin")     payload.skinAssessment = skin;
    if (activeModal === "fall")     payload.fallRisk = fallRisk;
    if (activeModal === "procedure") payload.procedure = procedure;
    if (activeModal === "discharge") payload.discharge = discharge;
    if (activeModal === "mews")      payload.mewsScore = { ...mews, total: calcMEWS(mews), band: mewsBand(calcMEWS(mews)).label };
    if (activeModal === "daily")     payload.dailyAssessment = dailyAssess;
    if (activeModal === "initial")   payload.initialAssessment = initialAssess;
    if (activeModal === "careplan")  payload.carePlan = carePlan;
    if (activeModal === "nutrition") payload.nutritionalAssessment = { ...nutrition, nrsTotal: (Number(nutrition.nutritionScore||0)+Number(nutrition.diseaseScore||0)+(nutrition.ageScore?1:0)) };
    if (activeModal === "education") payload.patientEducation = education;

    // Include nurse's digital signature
    payload.signature = signature || undefined;
    payload.signedByName = user?.fullName || `${user?.firstName || ""} ${user?.lastName || ""}`.trim();

    setLoading(true);
    try {
      await axios.post(API_ENDPOINTS.NURSE_NOTES, payload);
      clearDraft(); // clear auto-saved draft after successful save
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
  const today = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

  /* ══════════════════════════════════════════════════════ */
  return (
    <div style={{ marginLeft: 260, padding: "24px 28px", minHeight: "100vh", background: C.bg, fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: C.text }}>

      {/* ── Page Header ── */}
      <div style={{ background: `linear-gradient(135deg, ${C.primary} 0%, ${C.primaryMid} 100%)`, borderRadius: 16, padding: "20px 26px", marginBottom: 20, display: "flex", alignItems: "center", justifyContent: "space-between", boxShadow: `0 8px 24px ${C.primary}30` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 44, height: 44, borderRadius: 11, background: "rgba(255,255,255,.18)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <i className="pi pi-file-edit" style={{ fontSize: 19, color: "white" }} />
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: 19, fontWeight: 800, color: "white" }}>Nursing Notes</h2>
            <p style={{ margin: "2px 0 0", fontSize: 12, color: "rgba(255,255,255,.75)" }}>IPD / Day Care — Clinical Documentation</p>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <AutoSaveIndicator savedAt={savedAt} hasDraft={hasDraft} />
          <button onClick={() => setShowSetup(true)} title={signature ? "Signature set — click to change" : "Setup your digital signature"}
            style={{ background: signature ? "rgba(34,197,94,.25)" : "rgba(255,255,255,.15)", border: `1.5px solid ${signature ? "rgba(34,197,94,.5)" : "rgba(255,255,255,.3)"}`, borderRadius: 8, padding: "6px 12px", fontSize: 11, fontWeight: 700, color: "white", cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}>
            {signature ? <><i className="pi pi-verified" /> Signature Set</> : <><i className="pi pi-pen-to-square" /> Setup Signature</>}
          </button>
          <div style={{ background: "rgba(255,255,255,.15)", borderRadius: 8, padding: "6px 14px", fontSize: 12, color: "white", fontWeight: 600 }}>
            <i className="pi pi-calendar" style={{ marginRight: 6, fontSize: 11 }} />
            {today}
          </div>
        </div>
      </div>

      {/* ── Patient Search ── */}
      {!patient ? (
        <div style={{ maxWidth: 560, margin: "0 auto", paddingTop: 8 }}>
          <div style={{ background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 14, padding: "28px 28px", boxShadow: "0 4px 24px rgba(0,0,0,.06)" }}>
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
              <input
                value={searchUHID}
                onChange={e => setSearchUHID(e.target.value.toUpperCase())}
                placeholder="UHID / Admission No..."
                style={{ ...fld, flex: 1 }}
                autoFocus
              />
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
          <div style={{ background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 12, padding: "16px 22px", marginBottom: 14, boxShadow: "0 1px 3px rgba(0,0,0,.04)" }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
              {/* Patient fields */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: "12px 28px", flex: 1 }}>
                {[
                  { label: "Patient ID",  value: patient.uhid || patient.UHID || searchUHID },
                  { label: "Name",        value: patient.patientName || patient.patient?.name || "\u2014" },
                  { label: "Age / Sex",   value: `${patient.age || patient.patient?.age || "?"}Y / ${(patient.gender || patient.patient?.gender || "?")[0]?.toUpperCase()}` },
                  { label: "Ward / Bed",  value: `${patient.wardName || "\u2014"} \u2014 Bed ${patient.bedNumber || "\u2014"}` },
                  { label: "Admission",   value: patient.admissionDate ? new Date(patient.admissionDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "\u2014" },
                  { label: "Diagnosis",   value: patient.diagnosis || patient.admittingDiagnosis || "\u2014" },
                  { label: "Consultant",  value: patient.doctorName || patient.consultantName || "\u2014" },
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

              {/* Action buttons */}
              <div style={{ display: "flex", gap: 6, flexShrink: 0, alignItems: "flex-start", flexWrap: "wrap", maxWidth: 280 }}>
                <button onClick={() => navigate("/nursing-care-plan")}
                  style={{ padding: "6px 12px", border: `1.5px solid ${C.border}`, borderRadius: 7, background: "white", fontSize: 11, fontWeight: 600, cursor: "pointer", color: C.text, display: "flex", alignItems: "center", gap: 5 }}>
                  <i className="pi pi-clipboard" style={{ fontSize: 11 }} /> Care Plan
                </button>
                <button onClick={() => navigate("/vitalsView")}
                  style={{ padding: "6px 12px", border: `1.5px solid ${C.border}`, borderRadius: 7, background: "white", fontSize: 11, fontWeight: 600, cursor: "pointer", color: C.text, display: "flex", alignItems: "center", gap: 5 }}>
                  <i className="pi pi-chart-bar" style={{ fontSize: 11 }} /> Vitals Trend
                </button>
                <button onClick={() => setShowReport(true)}
                  style={{ padding: "6px 12px", border: `1.5px solid ${C.primary}40`, borderRadius: 7, background: C.primaryL, fontSize: 11, fontWeight: 600, cursor: "pointer", color: C.primary, display: "flex", alignItems: "center", gap: 5 }}>
                  <i className="pi pi-print" style={{ fontSize: 11 }} /> Print / PDF Report
                </button>
                <button onClick={() => navigate(`/ipd-assessment/${patient.uhid || patient.UHID || searchUHID}`)}
                  style={{ padding: "6px 12px", border: `1.5px solid ${C.primary}30`, borderRadius: 7, background: C.primaryL, fontSize: 11, fontWeight: 600, cursor: "pointer", color: C.primary, display: "flex", alignItems: "center", gap: 5 }}>
                  <i className="pi pi-file-check" style={{ fontSize: 11 }} /> IPD Assessment
                </button>
                <button onClick={() => { setPatient(null); setNotes([]); setSearchUHID(""); }}
                  style={{ padding: "6px 12px", border: `1.5px solid ${C.border}`, borderRadius: 7, background: "white", fontSize: 11, fontWeight: 600, cursor: "pointer", color: C.muted, display: "flex", alignItems: "center", gap: 5 }}>
                  <i className="pi pi-times" style={{ fontSize: 11 }} /> Change
                </button>
              </div>
            </div>
          </div>

          {/* ── Doctor's Active Orders (NurseOrdersPanel) ── */}
          <div style={{ marginBottom: 14 }}>
            <NurseOrdersPanel
              UHID={patient.uhid || patient.UHID || searchUHID}
              visitId={patient.ipdNo || patient.admissionNumber || patient._id}
              refreshTrigger={ordersRefresh}
              onConsentRequest={(order) => setConsentOrder(order)}
            />
          </div>

          {/* ── NABH Treatment Chart (Nurse Administration View) ── */}
          <div style={{ marginBottom: 14 }}>
            <TreatmentChart
              UHID={patient.uhid || patient.UHID || searchUHID}
              visitId={patient.ipdNo || patient.admissionNumber || patient._id}
              patientName={patient.patientName || patient.patientId?.fullName || ""}
              nurseMode={true}
              refreshTrigger={ordersRefresh}
              onAdminSave={() => setOrdersRefresh(p => p + 1)}
            />
          </div>

          {/* ── Shift Selector ── */}
          <div style={{ background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 12, padding: "12px 20px", marginBottom: 14, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".6px" }}>Current Shift:</span>
              <div style={{ display: "flex", gap: 6 }}>
                {[
                  { id: "morning",   label: "Morning",   icon: "pi-sun" },
                  { id: "afternoon", label: "Afternoon", icon: "pi-cloud" },
                  { id: "evening",   label: "Evening",   icon: "pi-moon" },
                  { id: "night",     label: "Night",     icon: "pi-star" },
                ].map(s => {
                  const ss = SHIFT_STYLE[s.id];
                  const active = shift === s.id;
                  return (
                    <button key={s.id} onClick={() => setShift(s.id)}
                      style={{ padding: "6px 16px", border: `1.5px solid ${active ? C.primary + "60" : C.border}`, borderRadius: 20, background: active ? C.primaryL : "white", color: active ? C.primary : C.muted, fontFamily: "'DM Sans',sans-serif", fontSize: 12, fontWeight: 700, cursor: "pointer", transition: "all .15s", display: "flex", alignItems: "center", gap: 5 }}>
                      <i className={`pi ${s.icon}`} style={{ fontSize: 10 }} />
                      {s.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <button onClick={() => openModal("general")}
              style={{ padding: "9px 20px", background: C.green, color: "white", border: "none", borderRadius: 8, fontFamily: "'DM Sans',sans-serif", fontSize: 13, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 7, boxShadow: `0 4px 12px ${C.green}35` }}>
              <i className="pi pi-plus" style={{ fontSize: 12 }} /> Quick Note
            </button>
          </div>

          {/* ── Module Launcher ── */}
          <div style={{ background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 12, overflow: "hidden", marginBottom: 14 }}>
            <div style={{ padding: "10px 20px", borderBottom: `1px solid ${C.border}`, background: "#f8fafc", display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 26, height: 26, borderRadius: 6, background: C.primary + "18", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <i className="pi pi-plus-circle" style={{ color: C.primary, fontSize: 12 }} />
              </span>
              <span style={{ fontWeight: 700, fontSize: 12, textTransform: "uppercase", letterSpacing: ".8px", color: C.muted }}>Add Care Note</span>
            </div>
            <div style={{ padding: "14px 18px", display: "flex", flexWrap: "wrap", gap: 8 }}>
              {MODULES.map(m => (
                <button key={m.id} onClick={() => openModal(m.id)}
                  style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 14px", borderRadius: 9, border: `1.5px solid ${m.border}`, fontFamily: "'DM Sans',sans-serif", fontSize: 12, fontWeight: 600, cursor: "pointer", background: "white", color: m.color, transition: "all .2s", position: "relative" }}
                  onMouseEnter={e => { e.currentTarget.style.background = m.bg; e.currentTarget.style.transform = "translateY(-1px)"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "white"; e.currentTarget.style.transform = "none"; }}>
                  <i className={`pi ${m.icon}`} style={{ fontSize: 13 }} />
                  {m.label}
                  {m.dot && <span style={{ position: "absolute", top: -4, right: -4, width: 8, height: 8, background: C.red, borderRadius: "50%", border: "2px solid white" }} />}
                </button>
              ))}
            </div>
          </div>

          {/* ── Equipment Used This Shift ── */}
          {(() => {
            // Group items by category
            const CATEGORY_COLORS = {
              "IV & Infusion":      { color: C.teal,   bg: C.tealL,   icon: "pi-plus-circle"     },
              "Oxygen Therapy":     { color: C.blue,   bg: C.blueL,   icon: "pi-cloud"            },
              "Urinary Care":       { color: C.amber,  bg: C.amberL,  icon: "pi-filter"           },
              "Wound & Dressing":   { color: C.red,    bg: C.redL,    icon: "pi-pencil"           },
              "Monitoring":         { color: C.purple, bg: C.purpleL, icon: "pi-chart-line"       },
              "Feeding":            { color: C.orange, bg: C.orangeL, icon: "pi-heart"            },
              "Suctioning":         { color: "#0e7490",bg: "#ecfeff",  icon: "pi-inbox"           },
              "Other":              { color: C.muted,  bg: "#f1f5f9",  icon: "pi-box"             },
            };

            // Build a set of itemIds already charged today (once-per-day)
            const billedTodayIds = new Set(
              todayCharges
                .filter(c => c.status === "active")
                .map(c => c.itemId?.toString?.() || c.itemId)
            );

            // Group
            const byCategory = {};
            equipItems.forEach(item => {
              const cat = item.category || "Other";
              if (!byCategory[cat]) byCategory[cat] = [];
              byCategory[cat].push(item);
            });

            const totalSelected = Object.values(selectedEquip).reduce((s, q) => s + (q > 0 ? 1 : 0), 0);
            const totalAmount   = Object.entries(selectedEquip).reduce((s, [id, q]) => {
              const item = equipItems.find(i => i._id === id);
              return s + (item ? item.unitPrice * q : 0);
            }, 0);

            return (
              <div style={{ background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 12, overflow: "hidden", marginBottom: 14 }}>
                {/* Header */}
                <div style={{ padding: "12px 20px", background: "#f8fafc", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ width: 28, height: 28, borderRadius: 7, background: C.primary + "18", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <i className="pi pi-bolt" style={{ fontSize: 13, color: C.primary }} />
                    </span>
                    <span style={{ fontWeight: 700, fontSize: 13, color: C.text }}>Equipment Used This Shift</span>
                    <span style={{ fontSize: 10, color: C.muted, background: "#f1f5f9", padding: "2px 8px", borderRadius: 6, fontWeight: 600 }}>
                      Auto-billed · Daily dedup active
                    </span>
                  </div>
                  {totalSelected > 0 && (
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: C.primary }}>
                        {totalSelected} item{totalSelected > 1 ? "s" : ""} · ₹{totalAmount.toLocaleString("en-IN")}
                      </div>
                      <button
                        onClick={logEquipment}
                        disabled={equipSaving}
                        style={{
                          padding: "8px 20px", background: equipSaved
                            ? `linear-gradient(135deg,${C.green},#15803d)`
                            : `linear-gradient(135deg,${C.primary},${C.primaryMid})`,
                          color: "white", border: "none", borderRadius: 8,
                          fontFamily: "'DM Sans',sans-serif", fontSize: 13, fontWeight: 700,
                          cursor: equipSaving ? "not-allowed" : "pointer",
                          display: "flex", alignItems: "center", gap: 7,
                          boxShadow: `0 4px 12px ${C.primary}30`,
                          opacity: equipSaving ? .8 : 1,
                        }}
                      >
                        <i className={`pi ${equipSaving ? "pi-spin pi-spinner" : equipSaved ? "pi-check" : "pi-save"}`} style={{ fontSize: 12 }} />
                        {equipSaving ? "Logging…" : equipSaved ? "Logged!" : "Log & Bill"}
                      </button>
                    </div>
                  )}
                </div>

                {/* Today's billed summary bar */}
                {todayCharges.filter(c => c.status === "active").length > 0 && (
                  <div style={{ padding: "8px 20px", background: C.greenL, borderBottom: `1px solid ${C.greenB}`, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <i className="pi pi-check-circle" style={{ fontSize: 12, color: C.green }} />
                    <span style={{ fontSize: 11, fontWeight: 700, color: C.green }}>Already billed today:</span>
                    {todayCharges.filter(c => c.status === "active").map(c => (
                      <span key={c._id} style={{ fontSize: 10, background: C.greenB, color: "#14532d", padding: "2px 8px", borderRadius: 5, fontWeight: 600 }}>
                        {c.itemName} ×{c.quantity}
                      </span>
                    ))}
                  </div>
                )}

                {/* Item grid */}
                <div style={{ padding: "16px 20px" }}>
                  {equipLoading ? (
                    <div style={{ textAlign: "center", padding: "24px 0", color: C.muted, fontSize: 13 }}>
                      <i className="pi pi-spin pi-spinner" style={{ fontSize: 18, display: "block", marginBottom: 8 }} />
                      Loading items…
                    </div>
                  ) : Object.keys(byCategory).length === 0 ? (
                    <div style={{ textAlign: "center", padding: "24px 0", color: C.muted, fontSize: 13 }}>No equipment items configured.</div>
                  ) : (
                    Object.entries(byCategory).map(([cat, items]) => {
                      const style = CATEGORY_COLORS[cat] || CATEGORY_COLORS["Other"];
                      return (
                        <div key={cat} style={{ marginBottom: 16 }}>
                          <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".7px", color: style.color, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                            <i className={`pi ${style.icon}`} style={{ fontSize: 11 }} />
                            {cat}
                          </div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                            {items.map(item => {
                              const iid     = item._id;
                              const qty     = selectedEquip[iid] || 0;
                              const active  = qty > 0;
                              const billed  = billedTodayIds.has(iid) && item.chargeOncePerDay;

                              return (
                                <div
                                  key={iid}
                                  style={{
                                    border: `1.5px solid ${billed ? C.greenB : active ? style.color : C.border}`,
                                    borderRadius: 10,
                                    background: billed ? C.greenL : active ? style.bg : "white",
                                    padding: "10px 14px",
                                    minWidth: 160,
                                    maxWidth: 210,
                                    flex: "1 1 160px",
                                    cursor: billed ? "default" : "pointer",
                                    transition: "all .15s",
                                    opacity: billed ? .75 : 1,
                                    position: "relative",
                                  }}
                                  onClick={() => {
                                    if (billed) return;
                                    setSelectedEquip(prev => {
                                      const cur = prev[iid] || 0;
                                      return { ...prev, [iid]: cur > 0 ? 0 : 1 };
                                    });
                                  }}
                                >
                                  {/* Billed badge */}
                                  {billed && (
                                    <span style={{
                                      position: "absolute", top: -8, right: -8,
                                      background: C.green, color: "white",
                                      fontSize: 9, fontWeight: 700,
                                      padding: "2px 6px", borderRadius: 6,
                                      display: "flex", alignItems: "center", gap: 3,
                                    }}>
                                      <i className="pi pi-check" style={{ fontSize: 8 }} /> BILLED
                                    </span>
                                  )}

                                  {/* Active check */}
                                  {active && !billed && (
                                    <span style={{
                                      position: "absolute", top: -8, right: -8,
                                      background: style.color, color: "white",
                                      width: 18, height: 18, borderRadius: "50%",
                                      display: "flex", alignItems: "center", justifyContent: "center",
                                    }}>
                                      <i className="pi pi-check" style={{ fontSize: 9 }} />
                                    </span>
                                  )}

                                  <div style={{ fontWeight: 700, fontSize: 12, color: billed ? "#14532d" : active ? style.color : C.text, marginBottom: 4 }}>
                                    {item.name}
                                  </div>
                                  <div style={{ fontSize: 11, color: C.muted, marginBottom: 8 }}>
                                    ₹{item.unitPrice?.toLocaleString("en-IN")}
                                    {item.chargeOncePerDay && (
                                      <span style={{ marginLeft: 5, background: "#f1f5f9", borderRadius: 4, padding: "1px 5px", fontSize: 9, fontWeight: 700, color: C.muted }}>
                                        1×/day
                                      </span>
                                    )}
                                  </div>

                                  {/* Qty stepper — only when selected & not once-per-day */}
                                  {active && !billed && !item.chargeOncePerDay && (
                                    <div
                                      style={{ display: "flex", alignItems: "center", gap: 6 }}
                                      onClick={e => e.stopPropagation()}
                                    >
                                      <button
                                        onClick={() => setSelectedEquip(prev => ({ ...prev, [iid]: Math.max(1, (prev[iid] || 1) - 1) }))}
                                        style={{ width: 24, height: 24, borderRadius: 6, border: `1.5px solid ${style.color}`, background: "white", color: style.color, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, lineHeight: 1 }}>−</button>
                                      <span style={{ fontFamily: "'DM Mono', monospace", fontWeight: 700, fontSize: 13, color: style.color, minWidth: 20, textAlign: "center" }}>{qty}</span>
                                      <button
                                        onClick={() => setSelectedEquip(prev => ({ ...prev, [iid]: (prev[iid] || 1) + 1 }))}
                                        style={{ width: 24, height: 24, borderRadius: 6, border: `1.5px solid ${style.color}`, background: "white", color: style.color, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, lineHeight: 1 }}>+</button>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })()}

          {/* ── Notes Timeline ── */}
          <div style={{ background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
            {/* Timeline header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 20px", borderBottom: `1px solid ${C.border}`, background: "#f8fafc" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 14 }}>
                <i className="pi pi-list" style={{ color: C.primary, fontSize: 14 }} />
                Nursing Notes Timeline
                <span style={{ background: C.primary, color: "white", padding: "2px 9px", borderRadius: 10, fontSize: 11, fontWeight: 700 }}>
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
                  { key: "mews",     label: "MEWS" },
                ].map(f => (
                  <button key={f.key} onClick={() => setFilterType(f.key)}
                    style={{ padding: "4px 12px", border: `1.5px solid ${filterType === f.key ? C.primary : C.border}`, borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: "pointer", background: filterType === f.key ? C.primaryL : "white", color: filterType === f.key ? C.primary : C.muted, transition: "all .15s" }}>
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
                <button onClick={() => openModal("general")} style={{ marginTop: 10, background: "none", border: "none", color: C.primary, fontWeight: 700, cursor: "pointer", fontSize: 13 }}>
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
                    style={{ padding: "16px 20px", borderBottom: i < filteredNotes.length - 1 ? `1px solid ${C.border}` : "none", display: "grid", gridTemplateColumns: "76px 1fr auto", gap: 16, alignItems: "start", borderLeft: `4px solid ${ns.dot}` }}
                    onMouseEnter={e => e.currentTarget.style.background = "#fafbff"}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}>

                    {/* Time column */}
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                      <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, fontWeight: 700, color: C.text }}>{timeStr}</span>
                      <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 9, fontWeight: 700, letterSpacing: ".6px", ...ss }}>
                        {(note.shift || "morning").charAt(0).toUpperCase() + (note.shift || "morning").slice(1)}
                      </span>
                      <span style={{ width: 12, height: 12, borderRadius: "50%", border: `2.5px solid ${ns.dot}`, background: "white", marginTop: 2, display: "block" }} />
                    </div>

                    {/* Body */}
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8, flexWrap: "wrap" }}>
                        <span style={{ padding: "3px 10px", borderRadius: 5, fontSize: 10, fontWeight: 700, letterSpacing: ".6px", background: ns.bg, color: ns.color, display: "flex", alignItems: "center", gap: 5 }}>
                          {mod && <i className={`pi ${mod.icon}`} style={{ fontSize: 10 }} />}
                          {mod?.label || note.noteType?.toUpperCase()}
                        </span>
                        {note.isCriticalEvent && (
                          <span style={{ background: C.red, color: "white", padding: "2px 8px", borderRadius: 4, fontSize: 9, fontWeight: 700, letterSpacing: ".5px", display: "flex", alignItems: "center", gap: 4 }}>
                            <i className="pi pi-exclamation-triangle" style={{ fontSize: 9 }} /> CRITICAL EVENT
                          </span>
                        )}
                        {note.nurseName && (
                          <span style={{ fontSize: 11, color: C.muted, fontWeight: 500 }}>{note.nurseName}</span>
                        )}
                      </div>

                      {/* Vitals structured data */}
                      {note.vitals && note.noteType === "vitals" && (
                        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", padding: "8px 14px", background: C.grayL, borderRadius: 7, marginBottom: 8 }}>
                          {[
                            { label: "BP",    value: `${note.vitals.bp?.systolic || "\u2014"}/${note.vitals.bp?.diastolic || "\u2014"}`, abnormal: isAbnormal("bp_sys", note.vitals.bp?.systolic) },
                            { label: "PULSE", value: `${note.vitals.pulse || "\u2014"} /min`, abnormal: isAbnormal("pulse", note.vitals.pulse) },
                            { label: "TEMP",  value: note.vitals.temp ? `${note.vitals.temp}\u00b0F` : "\u2014", abnormal: isAbnormal("temp", note.vitals.temp) },
                            { label: "SPO\u2082",  value: note.vitals.spo2 ? `${note.vitals.spo2}%` : "\u2014", abnormal: isAbnormal("spo2", note.vitals.spo2) },
                            { label: "RR",    value: note.vitals.rr ? `${note.vitals.rr} /min` : "\u2014", abnormal: isAbnormal("rr", note.vitals.rr) },
                            { label: "GCS",   value: note.moduleData?.vitals?.gcs || note.vitals.gcs || "\u2014" },
                            { label: "BSL",   value: (note.moduleData?.vitals?.bsl || note.vitals.bsl) ? `${note.moduleData?.vitals?.bsl || note.vitals.bsl} mg/dL` : "\u2014", abnormal: isAbnormal("bsl", note.moduleData?.vitals?.bsl || note.vitals.bsl) },
                          ].map(v => (
                            <div key={v.label} style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                              <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".6px", color: C.muted }}>{v.label}</span>
                              <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 12, fontWeight: v.abnormal ? 700 : 500, color: v.abnormal ? C.red : C.text }}>{v.value}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* ── MEWS Score (special colored band display) ── */}
                      {note.moduleData?.mewsScore && note.noteType === "mews" && (() => {
                        const ms = note.moduleData.mewsScore;
                        const band = mewsBand(ms.total || 0);
                        return (
                          <div style={{ display:"flex", gap:12, flexWrap:"wrap", padding:"8px 14px", background:band.bg, borderRadius:7, marginBottom:8, alignItems:"center", border:`1px solid ${band.color}20` }}>
                            <div style={{ display:"flex", flexDirection:"column", gap:1 }}>
                              <span style={{ fontSize:9, fontWeight:700, textTransform:"uppercase", letterSpacing:".6px", color:C.muted }}>MEWS TOTAL</span>
                              <span style={{ fontFamily:"'DM Mono',monospace", fontSize:20, fontWeight:900, color:band.color }}>{ms.total}</span>
                            </div>
                            <div style={{ flex:1 }}>
                              <div style={{ fontSize:12, fontWeight:800, color:band.color }}>{ms.band}</div>
                              <div style={{ fontSize:11, color:band.color+"cc" }}>{band.action}</div>
                            </div>
                            {[{l:"RR",v:ms.rr},{l:"SpO₂",v:ms.spo2},{l:"Temp",v:ms.temp},{l:"SBP",v:ms.sbp},{l:"HR",v:ms.hr},{l:"AVPU",v:ms.avpu}].filter(x=>x.v).map(v=>(
                              <div key={v.l} style={{ display:"flex", flexDirection:"column", gap:1 }}>
                                <span style={{ fontSize:9, fontWeight:700, textTransform:"uppercase", letterSpacing:".6px", color:C.muted }}>{v.l}</span>
                                <span style={{ fontFamily:"'DM Mono',monospace", fontSize:12, fontWeight:500 }}>{v.v}</span>
                              </div>
                            ))}
                          </div>
                        );
                      })()}

                      {/* ── All module data: generic renderer from note.moduleData ──
                           Covers: pain, blood, iv, intake, neuro, wound, skin, fall,
                           procedure, discharge, daily, initial, carePlan, nutrition, education */}
                      {note.moduleData && (() => {
                        const SKIP = new Set(
                          note.noteType === "mews"   ? ["mewsScore"] :
                          note.noteType === "vitals" ? ["vitals"]    : []
                        );
                        const MOD_SECTION_LBL = {
                          painAssessment:"Pain Assessment", neuroAssessment:"Neuro / GCS",
                          bloodTransfusion:"Blood Transfusion", ivInfusion:"IV Infusion",
                          intakeOutput:"Intake / Output", woundCare:"Wound / Dressing",
                          skinAssessment:"Skin / Pressure (Braden)", fallRisk:"Fall Risk (Morse Scale)",
                          procedure:"Procedure / Intervention", discharge:"Discharge / Handover (SBAR)",
                          dailyAssessment:"Daily Assessment", initialAssessment:"Initial Assessment",
                          carePlan:"Care Plan", nutritionalAssessment:"Nutritional Assessment (NRS-2002)",
                          patientEducation:"Patient Education",
                        };
                        const FIELD_LBL = {
                          m1:"History of Falls", m2:"Secondary Dx", m3:"Ambul. Aid",
                          m4:"IV / Heparin Lock", m5:"Gait / Transfer", m6:"Mental Status",
                          intBedRails:"Bed Rails ↑", intCallBell:"Call Bell", intNonSlip:"Non-Slip",
                          intBedLowest:"Bed Lowest", intSupervision:"Supervision",
                          intPatientEd:"Patient Edu.", intFamilyEd:"Family Edu.",
                          gcse:"Eyes (E)", gcsv:"Verbal (V)", gcsm:"Motor (M)",
                          scale:"Scale", score:"Score", location:"Location", character:"Character",
                          onset:"Onset", frequency:"Frequency", duration:"Duration",
                          analgesicGiven:"Analgesic Given", analgesic:"Drug", analgesicRoute:"Route",
                          painOnMovement:"Pain on Movement", reassessScore:"Reassess Score",
                          reassessTime:"Reassess Time", nonPharmacological:"Non-Pharm",
                          aggravatingFactors:"Aggravating",
                          pupils:"Pupils", pupilSizeL:"Pupil L (mm)", pupilSizeR:"Pupil R (mm)",
                          lightReflex:"Light Reflex", orientation:"Orientation",
                          seizure:"Seizure", limbUL:"Upper-L", limbUR:"Upper-R",
                          limbLL:"Lower-L", limbLR:"Lower-R",
                          product:"Product", bagNo:"Bag No.", crossMatchNo:"X-Match No.",
                          volume:"Volume (mL)", groupVerified:"Group Verified", secondNurse:"2nd Nurse",
                          startTime:"Start", endTime:"End", reactionType:"Reaction",
                          preBP:"Pre-BP", prePulse:"Pre-Pulse", postBP:"Post-BP", postPulse:"Post-Pulse",
                          fluid:"Fluid", rate:"Rate (mL/hr)", dropsPerMin:"gtts/min",
                          route:"Route", site:"Site", cannulaDate:"Cannula Date",
                          setChangeDate:"Set Change", additive:"Additive",
                          oral:"Oral (mL)", ivFluids:"IV Fluids (mL)", urineOutput:"Urine (mL)",
                          otherOutput:"Other Out (mL)", nasogastricOutput:"NGT Out (mL)",
                          ivMedFluids:"IV Med (mL)",
                          type:"Type", length:"Length (cm)", width:"Width (cm)", depth:"Depth (cm)",
                          exudateAmt:"Exudate Amt", exudateType:"Exudate Type",
                          healingStage:"Healing Stage", surroundingSkin:"Surrounding Skin",
                          tunneling:"Tunneling", undermining:"Undermining", odour:"Odour",
                          dressing:"Dressing Used", painDuring:"Pain During",
                          nextDressingDate:"Next Dressing", swabSent:"Swab Sent",
                          area:"Area", b1:"Sensory", b2:"Moisture", b3:"Activity",
                          b4:"Mobility", b5:"Nutrition(Braden)", b6:"Friction/Shear",
                          stage:"Pressure Stage", repositioned:"Repositioned", repositionFreq:"Freq.",
                          procedureName:"Procedure", indication:"Indication", laterality:"Laterality",
                          time:"Time", consentObtained:"Consent", performedBy:"Performed By",
                          designation:"Designation", assistant:"Assistant",
                          sterile:"Sterile", position:"Position", outcome:"Outcome",
                          complications:"Complications", specimenSent:"Specimen Sent",
                          specimenType:"Specimen Type", postProcVitals:"Post-Proc Vitals",
                          followUp:"Follow-Up",
                          situation:"S – Situation", background:"B – Background",
                          assessment:"A – Assessment", recommendation:"R – Recommendation",
                          incomingNurse:"Incoming Nurse", patientStatus:"Patient Status",
                          educationGiven:"Edu. Given", educationTopics:"Topics",
                          followUpDate:"Follow-Up Date", valuablesHandedOver:"Valuables",
                          neuroStatus:"Neuro", respiratoryStatus:"Respiratory",
                          cardiovascularStatus:"CVS", giStatus:"GI", guStatus:"GU",
                          musculoskeletalStatus:"MSK", skinStatus:"Skin",
                          intReposition:"Reposition", intOralCare:"Oral Care",
                          intPressureRelief:"Pressure Relief", intRangeOfMotion:"ROM",
                          intFallPrecautions:"Fall Precautions", intMedAdministered:"Meds Given",
                          intWoundCare:"Wound Care", intIVCheck:"IV Check",
                          intNGTCheck:"NGT Check", intFoleyCheck:"Foley Check",
                          intOxygenCheck:"O₂ Check", intPatientEducation:"Pt. Edu.",
                          intFamilyUpdate:"Family Update", intDoctorNotified:"Dr. Notified",
                          intDocumented:"Documented",
                          dietType:"Diet", appetite:"Appetite", feedingMode:"Mode",
                          swallowing:"Swallowing", ngtPresent:"NGT Present",
                          caloriesToday:"Calories", proteinToday:"Protein", fluidToday:"Fluid",
                          dietitianReferral:"Dietitian Ref.", referralReason:"Ref. Reason",
                          nutritionScore:"Nutrition Score", diseaseScore:"Disease Score",
                          ageScore:"Age Score (>70yr)", weight:"Weight", height:"Height",
                          topics:"Topics", methods:"Methods", understanding:"Understanding",
                          language:"Language", response:"Response", barriers:"Barriers",
                          sessionNotes:"Session Notes", nextSessionDate:"Next Session",
                        };
                        const fmtKey = k => FIELD_LBL[k] || k.replace(/([A-Z])/g," $1").replace(/^[Ii]nt /,"").trim();
                        const fmtVal = v => {
                          if (v === null || v === undefined || v === "" || v === false) return null;
                          if (typeof v === "boolean") return "✓ Yes";
                          if (Array.isArray(v)) {
                            if (!v.length) return null;
                            return v.map(x => typeof x === "object" ? (x.statement || x.topic || x.name || JSON.stringify(x)) : String(x)).join(", ");
                          }
                          if (typeof v === "object") {
                            if ("systolic" in v && "diastolic" in v) return `${v.systolic||"—"}/${v.diastolic||"—"}`;
                            const inner = Object.entries(v).filter(([,x])=>x).map(([k2,v2])=>`${k2}:${v2}`).join(" | ");
                            return inner || null;
                          }
                          return String(v);
                        };
                        const blocks = Object.entries(note.moduleData)
                          .filter(([k]) => !SKIP.has(k))
                          .map(([mk, mv]) => {
                            if (!mv) return null;
                            if (Array.isArray(mv)) {
                              const items = mv.filter(Boolean);
                              if (!items.length) return null;
                              const summary = items.map((x,i) => typeof x === "object" ? (x.statement||x.topic||x.name||`Item ${i+1}`) : String(x)).join(" | ");
                              return { key: mk, label: MOD_SECTION_LBL[mk]||mk, chips:[{label:`${items.length} item(s)`, value: summary}] };
                            }
                            if (typeof mv !== "object") return null;
                            const chips = Object.entries(mv)
                              .map(([k,v]) => ({ label: fmtKey(k), value: fmtVal(v) }))
                              .filter(c => c.value !== null);
                            if (!chips.length) return null;
                            return { key: mk, label: MOD_SECTION_LBL[mk]||mk.replace(/([A-Z])/g," $1").trim(), chips };
                          })
                          .filter(Boolean);
                        if (!blocks.length) return null;
                        return (
                          <div style={{ display:"flex", flexDirection:"column", gap:5, marginBottom:8 }}>
                            {blocks.map(({ key, label, chips }) => (
                              <div key={key} style={{ padding:"7px 12px", background:C.grayL, borderRadius:7, border:`1px solid ${C.border}` }}>
                                <div style={{ fontSize:9, fontWeight:700, textTransform:"uppercase", letterSpacing:".5px", color:C.primary, marginBottom:5 }}>
                                  {label}
                                </div>
                                <div style={{ display:"flex", gap:"5px 14px", flexWrap:"wrap" }}>
                                  {chips.map(c => (
                                    <div key={c.label} style={{ display:"flex", flexDirection:"column", gap:1 }}>
                                      <span style={{ fontSize:9, fontWeight:700, textTransform:"uppercase", letterSpacing:".5px", color:C.muted }}>{c.label}</span>
                                      <span style={{ fontFamily:"'DM Mono',monospace", fontSize:11, fontWeight:500, color:C.text }}>{c.value}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        );
                      })()}

                      {/* Remarks */}
                      {note.remarks && (
                        <div style={{ fontSize: 12.5, color: C.text, lineHeight: 1.6, marginBottom: 8 }}>{note.remarks}</div>
                      )}

                      {/* Tags */}
                      {note.tags?.length > 0 && (
                        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                          {note.tags.map(t => (
                            <span key={t} style={{ padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 600, background: C.grayL, color: C.muted, border: `1px solid ${C.border}` }}>
                              {t}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 5, alignItems: "flex-end" }}>
                      <button style={{ padding: "4px 10px", border: `1.5px solid ${C.border}`, borderRadius: 6, background: "white", fontSize: 11, fontWeight: 600, cursor: "pointer", color: C.muted, display: "flex", alignItems: "center", gap: 4 }}>
                        <i className="pi pi-pencil" style={{ fontSize: 10 }} /> Edit
                      </button>
                      <button style={{ padding: "4px 10px", border: `1.5px solid ${C.border}`, borderRadius: 6, background: "white", fontSize: 11, fontWeight: 600, cursor: "pointer", color: C.muted, display: "flex", alignItems: "center", gap: 4 }}>
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

      {/* ── Fingerprint Consent Modal ── */}
      {consentOrder && (
        <FingerprintConsentModal
          order={consentOrder}
          onClose={() => setConsentOrder(null)}
          onConfirm={async (hash) => {
            try {
              const token = localStorage.getItem("his_token");
              const headers = token ? { Authorization: `Bearer ${token}` } : {};
              const nurseName = user?.fullName || `${user?.firstName || ""} ${user?.lastName || ""}`.trim();
              await axios.patch(
                `/api/doctor-orders/${consentOrder._id}`,
                { consentStatus: "Obtained", consentData: { fingerprintHash: hash, obtainedAt: new Date().toISOString(), nurseName } },
                { headers }
              );
              toast.success("Biometric consent captured & stored");
              setConsentOrder(null);
              setOrdersRefresh(n => n + 1);
            } catch (err) {
              toast.error(err?.response?.data?.message || "Failed to save consent");
            }
          }}
        />
      )}

      {/* ══════════════ MODAL ══════════════ */}
      {activeModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.6)", backdropFilter: "blur(4px)", zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          onClick={() => setActiveModal(null)}>
          <div style={{ background: "white", borderRadius: 16, width: 640, maxWidth: "96vw", maxHeight: "92vh", overflowY: "auto", boxShadow: "0 24px 60px rgba(0,0,0,.28)" }}
            onClick={e => e.stopPropagation()}>

            {/* Modal header */}
            <div style={{ padding: "16px 22px", background: `linear-gradient(135deg, ${C.primary}, ${C.primaryMid})`, color: "white", display: "flex", justifyContent: "space-between", alignItems: "center", borderRadius: "16px 16px 0 0", position: "sticky", top: 0, zIndex: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ width: 32, height: 32, borderRadius: 8, background: "rgba(255,255,255,.2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <i className={`pi ${modDef(activeModal)?.icon || "pi-file"}`} style={{ fontSize: 15, color: "white" }} />
                </span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{modDef(activeModal)?.label}</div>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,.75)" }}>
                    {patient?.patientName || patient?.patient?.name} &middot; IPD: {patient?.ipdNo || patient?.admissionNumber || "\u2014"}
                  </div>
                </div>
              </div>
              <button onClick={() => setActiveModal(null)}
                style={{ background: "rgba(255,255,255,.2)", border: "none", color: "white", fontSize: 18, cursor: "pointer", lineHeight: 1, width: 30, height: 30, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center" }}>
                &times;
              </button>
            </div>

            {/* Modal body */}
            <div style={{ padding: "20px 22px" }}>

              {/* ── Vitals (NABH NS.3) — Integrated VitalSheet Panel ── */}
              {activeModal === "vitals" && (
                <IntegratedVitalsPanel
                  UHID={patient?.uhid || patient?.UHID || searchUHID}
                  nurseName={user?.fullName || `${user?.firstName || ""} ${user?.lastName || ""}`.trim()}
                  onVitalsChange={v => {
                    setVitals(v);
                    const [sbp = ""] = (v.bp || "").split("/");
                    setMews(p => ({ ...p, rr: v.rr || p.rr, spo2: v.spo2 || p.spo2, temp: v.temp || p.temp, sbp: sbp || p.sbp, hr: v.pulse || p.hr }));
                  }}
                />
              )}

              {/* ── Neuro / GCS (NABH COP.2) ── */}
              {activeModal === "neuro" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  {/* GCS */}
                  <div style={{ background:"#f8fafc", borderRadius:10, padding:"12px 14px", border:`1px solid ${C.border}` }}>
                    <div style={{ fontSize:11, fontWeight:700, color:C.muted, textTransform:"uppercase", letterSpacing:".6px", marginBottom:10 }}>Glasgow Coma Scale</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10 }}>
                      <FL label="Eyes (E 1-4)">
                        <select style={sel} value={neuro.gcse} onChange={e => setNeuro(p => ({ ...p, gcse: e.target.value }))}>
                          <option value="">—</option>
                          {[{v:"1",l:"1 – No response"},{v:"2",l:"2 – To pain"},{v:"3",l:"3 – To sound"},{v:"4",l:"4 – Spontaneous"}].map(o=><option key={o.v} value={o.v}>{o.l}</option>)}
                        </select>
                      </FL>
                      <FL label="Verbal (V 1-5)">
                        <select style={sel} value={neuro.gcsv} onChange={e => setNeuro(p => ({ ...p, gcsv: e.target.value }))}>
                          <option value="">—</option>
                          {[{v:"1",l:"1 – None"},{v:"2",l:"2 – Sounds"},{v:"3",l:"3 – Words"},{v:"4",l:"4 – Confused"},{v:"5",l:"5 – Oriented"}].map(o=><option key={o.v} value={o.v}>{o.l}</option>)}
                        </select>
                      </FL>
                      <FL label="Motor (M 1-6)">
                        <select style={sel} value={neuro.gcsm} onChange={e => setNeuro(p => ({ ...p, gcsm: e.target.value }))}>
                          <option value="">—</option>
                          {[{v:"1",l:"1 – None"},{v:"2",l:"2 – Extension"},{v:"3",l:"3 – Flexion"},{v:"4",l:"4 – Withdrawal"},{v:"5",l:"5 – Localises"},{v:"6",l:"6 – Obeys"}].map(o=><option key={o.v} value={o.v}>{o.l}</option>)}
                        </select>
                      </FL>
                      <FL label="GCS Total">
                        <div style={{ ...fld, fontWeight:800, textAlign:"center", fontFamily:"monospace", fontSize:18, color: (() => { const t=(Number(neuro.gcse)||0)+(Number(neuro.gcsv)||0)+(Number(neuro.gcsm)||0); return t<=8?C.red:t<=12?C.amber:C.green; })(), display:"flex", alignItems:"center", justifyContent:"center" }}>
                          {(Number(neuro.gcse)||0)+(Number(neuro.gcsv)||0)+(Number(neuro.gcsm)||0)||"—"}/15
                        </div>
                      </FL>
                    </div>
                  </div>
                  {/* Pupils */}
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:10 }}>
                    <FL label="Pupil Reaction">
                      <select style={sel} value={neuro.pupils} onChange={e => setNeuro(p => ({ ...p, pupils: e.target.value }))}>
                        {["Equal & Reactive","Unequal","Fixed & Dilated","Pinpoint","Sluggish"].map(o => <option key={o}>{o}</option>)}
                      </select>
                    </FL>
                    <FL label="Pupil Size L (mm)">
                      <input type="number" min="1" max="8" style={fld} value={neuro.pupilSizeL} placeholder="3" onChange={e => setNeuro(p => ({ ...p, pupilSizeL: e.target.value }))} />
                    </FL>
                    <FL label="Pupil Size R (mm)">
                      <input type="number" min="1" max="8" style={fld} value={neuro.pupilSizeR} placeholder="3" onChange={e => setNeuro(p => ({ ...p, pupilSizeR: e.target.value }))} />
                    </FL>
                    <FL label="Light Reflex">
                      <select style={sel} value={neuro.lightReflex} onChange={e => setNeuro(p => ({ ...p, lightReflex: e.target.value }))}>
                        {["Present","Absent","Sluggish"].map(o => <option key={o}>{o}</option>)}
                      </select>
                    </FL>
                  </div>
                  {/* Orientation & Limbs */}
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                    <FL label="Orientation / Consciousness">
                      <select style={sel} value={neuro.orientation} onChange={e => setNeuro(p => ({ ...p, orientation: e.target.value }))}>
                        {["Alert & Oriented ×3","Oriented to person only","Confused","Drowsy","Unconscious","Sedated"].map(o => <option key={o}>{o}</option>)}
                      </select>
                    </FL>
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                      {[{k:"limbUL",l:"Upper L"},{k:"limbUR",l:"Upper R"},{k:"limbLL",l:"Lower L"},{k:"limbLR",l:"Lower R"}].map(f=>(
                        <FL key={f.k} label={`Limb Movement ${f.l}`}>
                          <select style={{ ...sel, fontSize:12 }} value={neuro[f.k]} onChange={e => setNeuro(p => ({ ...p, [f.k]: e.target.value }))}>
                            {["Normal","Weak","Absent","Paralysed"].map(o=><option key={o}>{o}</option>)}
                          </select>
                        </FL>
                      ))}
                    </div>
                  </div>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontWeight: 700, fontSize: 13, color: neuro.seizure ? C.red : C.muted }}>
                    <input type="checkbox" checked={neuro.seizure} onChange={e => setNeuro(p => ({ ...p, seizure: e.target.checked }))} style={{ accentColor: C.red, width: 15, height: 15 }} />
                    Seizure / Abnormal movement noted
                  </label>
                </div>
              )}

              {/* ── Pain Assessment (NABH COP.5) ── */}
              {activeModal === "pain" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10 }}>
                    <FL label="Pain Scale Used">
                      <select style={sel} value={pain.scale} onChange={e => setPain(p => ({ ...p, scale: e.target.value }))}>
                        {["NRS (Numeric)","VAS","Wong-Baker Faces","FLACC (Paediatric)","CPOT (Non-verbal)"].map(o=><option key={o}>{o}</option>)}
                      </select>
                    </FL>
                    <FL label="Pain Score (0-10) *">
                      <input type="number" min="0" max="10" style={{ ...fld, fontWeight:800, fontSize:15, textAlign:"center", borderColor: Number(pain.score)>=7?C.red:Number(pain.score)>=4?C.amber:"#e2e8f0" }}
                        value={pain.score} placeholder="0" onChange={e => setPain(p => ({ ...p, score: e.target.value }))} />
                    </FL>
                    <FL label="Pain Type">
                      <select style={sel} value={pain.type} onChange={e => setPain(p => ({ ...p, type: e.target.value }))}>
                        {["Acute","Chronic","Neuropathic","Breakthrough","Procedural"].map(o=><option key={o}>{o}</option>)}
                      </select>
                    </FL>
                  </div>
                  {pain.score && <div style={{ display:"flex", gap:3, alignItems:"center" }}>
                    {[0,1,2,3,4,5,6,7,8,9,10].map(n=>(
                      <div key={n} style={{ flex:1, height:12, borderRadius:3, background:Number(pain.score)>=n?(n>=7?C.red:n>=4?C.amber:C.green):"#e2e8f0", cursor:"pointer" }}
                        onClick={() => setPain(p => ({ ...p, score: String(n) }))} title={String(n)} />
                    ))}
                    <span style={{ fontSize:11, fontWeight:800, color:Number(pain.score)>=7?C.red:Number(pain.score)>=4?C.amber:C.green, marginLeft:6, minWidth:36 }}>{pain.score}/10</span>
                  </div>}
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10 }}>
                    <FL label="Location *"><input style={fld} value={pain.location} placeholder="e.g. Right lower abdomen" onChange={e => setPain(p => ({ ...p, location: e.target.value }))} /></FL>
                    <FL label="Character">
                      <select style={sel} value={pain.character} onChange={e => setPain(p => ({ ...p, character: e.target.value }))}>
                        {["Dull","Sharp","Burning","Stabbing","Colicky","Throbbing","Cramping","Aching","Shooting"].map(o=><option key={o}>{o}</option>)}
                      </select>
                    </FL>
                    <FL label="Onset">
                      <select style={sel} value={pain.onset} onChange={e => setPain(p => ({ ...p, onset: e.target.value }))}>
                        {["Sudden","Gradual","Intermittent"].map(o=><option key={o}>{o}</option>)}
                      </select>
                    </FL>
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10 }}>
                    <FL label="Frequency">
                      <select style={sel} value={pain.frequency} onChange={e => setPain(p => ({ ...p, frequency: e.target.value }))}>
                        {["Constant","Intermittent","Episodic"].map(o=><option key={o}>{o}</option>)}
                      </select>
                    </FL>
                    <FL label="Duration"><input style={fld} value={pain.duration} placeholder="e.g. 2 hrs, since morning" onChange={e => setPain(p => ({ ...p, duration: e.target.value }))} /></FL>
                    <FL label="Aggravating Factors"><input style={fld} value={pain.aggravating} placeholder="movement, breathing…" onChange={e => setPain(p => ({ ...p, aggravating: e.target.value }))} /></FL>
                  </div>
                  <div style={{ display:"flex", gap:20, flexWrap:"wrap" }}>
                    <label style={{ display:"flex", alignItems:"center", gap:8, cursor:"pointer", fontWeight:600, fontSize:13, color:pain.radiation?C.amber:C.muted }}>
                      <input type="checkbox" checked={pain.radiation} onChange={e => setPain(p => ({ ...p, radiation: e.target.checked }))} style={{ accentColor:C.amber, width:15, height:15 }} />
                      Radiates
                    </label>
                    <label style={{ display:"flex", alignItems:"center", gap:8, cursor:"pointer", fontWeight:600, fontSize:13, color:pain.painOnMovement?C.red:C.muted }}>
                      <input type="checkbox" checked={pain.painOnMovement} onChange={e => setPain(p => ({ ...p, painOnMovement: e.target.checked }))} style={{ accentColor:C.red, width:15, height:15 }} />
                      Pain on movement
                    </label>
                    <label style={{ display:"flex", alignItems:"center", gap:8, cursor:"pointer", fontWeight:600, fontSize:13, color:pain.analgesicGiven?C.green:C.muted }}>
                      <input type="checkbox" checked={pain.analgesicGiven} onChange={e => setPain(p => ({ ...p, analgesicGiven: e.target.checked }))} style={{ accentColor:C.green, width:15, height:15 }} />
                      Analgesic given
                    </label>
                  </div>
                  {pain.radiation && <FL label="Radiation Site"><input style={fld} value={pain.radiationSite} placeholder="e.g. radiates to left shoulder" onChange={e => setPain(p => ({ ...p, radiationSite: e.target.value }))} /></FL>}
                  {pain.analgesicGiven && (
                    <div style={{ display:"grid", gridTemplateColumns:"2fr 1fr 1fr", gap:10 }}>
                      <FL label="Drug & Dose"><input style={fld} value={pain.analgesic} placeholder="Inj. Paracetamol 1g" onChange={e => setPain(p => ({ ...p, analgesic: e.target.value }))} /></FL>
                      <FL label="Route">
                        <select style={sel} value={pain.analgesicRoute} onChange={e => setPain(p => ({ ...p, analgesicRoute: e.target.value }))}>
                          {["IV","IM","Oral","Sublingual","Topical","PR","Epidural"].map(o=><option key={o}>{o}</option>)}
                        </select>
                      </FL>
                      <FL label="Time Given"><input type="time" style={fld} value={pain.analgesicTime} onChange={e => setPain(p => ({ ...p, analgesicTime: e.target.value }))} /></FL>
                    </div>
                  )}
                  <FL label="Non-Pharmacological Interventions"><input style={fld} value={pain.nonPharm} placeholder="Positioning, ice pack, heat, relaxation, distraction…" onChange={e => setPain(p => ({ ...p, nonPharm: e.target.value }))} /></FL>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                    <FL label="Reassessment Score (0-10)"><input type="number" min="0" max="10" style={fld} value={pain.reassessScore} onChange={e => setPain(p => ({ ...p, reassessScore: e.target.value }))} /></FL>
                    <FL label="Reassessment Time"><input type="time" style={fld} value={pain.reassessTime} onChange={e => setPain(p => ({ ...p, reassessTime: e.target.value }))} /></FL>
                  </div>
                </div>
              )}

              {/* ── IV Infusion (NABH COP.3) ── */}
              {activeModal === "iv" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                    <FL label="IV Fluid *">
                      <select style={sel} value={iv.fluid} onChange={e => setIV(p => ({ ...p, fluid: e.target.value }))}>
                        {["NS 0.9%","RL (Ringer's Lactate)","DNS","D5W","D10W","NS 0.45%","Plasmalyte","Isolyte S","Haemaccel","Other"].map(o => <option key={o}>{o}</option>)}
                      </select>
                    </FL>
                    <FL label="Volume (mL) *"><input type="number" style={fld} value={iv.volume} placeholder="500" onChange={e => setIV(p => ({ ...p, volume: e.target.value }))} /></FL>
                    <FL label="Rate (mL/hr) *"><input type="number" style={fld} value={iv.rate} placeholder="84" onChange={e => { const r=e.target.value; const d=r?Math.round(Number(r)*20/60):""  ; setIV(p => ({ ...p, rate: r, dropsPerMin: String(d) })); }} /></FL>
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10 }}>
                    <FL label="Drip Rate (drops/min)">
                      <div style={{ ...fld, background:"#f8fafc", fontFamily:"monospace", fontWeight:700, color:C.primary }}>{iv.dropsPerMin || "—"}</div>
                    </FL>
                    <FL label="Route / Access *"><input style={fld} value={iv.route} placeholder="IV Right Forearm" onChange={e => setIV(p => ({ ...p, route: e.target.value }))} /></FL>
                    <FL label="IV Site Status *">
                      <select style={{ ...sel, borderColor: iv.site==="Patent"?C.green:iv.site==="Infiltration"||iv.site==="Blocked"?C.red:C.amber }} value={iv.site} onChange={e => setIV(p => ({ ...p, site: e.target.value }))}>
                        {["Patent","Redness","Swelling","Infiltration","Replaced","Blocked","Phlebitis"].map(o => <option key={o}>{o}</option>)}
                      </select>
                    </FL>
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                    <FL label="Cannula Insertion Date"><input type="date" style={fld} value={iv.cannulaDate} onChange={e => setIV(p => ({ ...p, cannulaDate: e.target.value }))} /></FL>
                    <FL label="IV Set Last Changed"><input type="date" style={fld} value={iv.setChangeDate} onChange={e => setIV(p => ({ ...p, setChangeDate: e.target.value }))} /></FL>
                  </div>
                  <FL label="Medication Additive (if any)"><input style={fld} value={iv.additive} placeholder="e.g. Inj. KCl 20 mEq, Inj. MgSO₄ 1g" onChange={e => setIV(p => ({ ...p, additive: e.target.value }))} /></FL>
                </div>
              )}

              {/* ── Blood Transfusion (NABH COP.7) ── */}
              {activeModal === "blood" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ background: C.redL, border: `1.5px solid #fca5a5`, borderRadius: 8, padding: "10px 14px", fontSize: 12, color: C.red, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
                    <i className="pi pi-exclamation-triangle" style={{ fontSize: 13 }} /> NABH COP.7 — Blood Product Administration · Dual RN Verification Mandatory
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                    <FL label="Blood Product *">
                      <select style={sel} value={blood.product} onChange={e => setBlood(p => ({ ...p, product: e.target.value }))}>
                        {["PRC (Packed RBC)","FFP","Platelets (RDP)","Platelets (SDP)","Whole Blood","Albumin 5%","Albumin 20%","Cryoprecipitate","Granulocytes"].map(o => <option key={o}>{o}</option>)}
                      </select>
                    </FL>
                    <FL label="Bag / Unit No. *"><input style={fld} value={blood.bagNo} placeholder="BT-YYYYMMDD-01" onChange={e => setBlood(p => ({ ...p, bagNo: e.target.value }))} /></FL>
                    <FL label="Cross-Match Report No. *"><input style={fld} value={blood.crossMatchNo} placeholder="CM-2024-001" onChange={e => setBlood(p => ({ ...p, crossMatchNo: e.target.value }))} /></FL>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                    <FL label="Volume (mL) *"><input type="number" style={fld} value={blood.volume} placeholder="350" onChange={e => setBlood(p => ({ ...p, volume: e.target.value }))} /></FL>
                    <FL label="Transfusion Start Time *"><input type="time" style={fld} value={blood.startTime} onChange={e => setBlood(p => ({ ...p, startTime: e.target.value }))} /></FL>
                    <FL label="End Time / Status *">
                      <select style={sel} value={blood.status} onChange={e => setBlood(p => ({ ...p, status: e.target.value }))}>
                        {["Transfusing","Completed","Held","Reaction","Stopped"].map(o => <option key={o}>{o}</option>)}
                      </select>
                    </FL>
                  </div>
                  {/* Pre-transfusion vitals */}
                  <div style={{ background:"#fff7ed", border:`1px solid #fed7aa`, borderRadius:8, padding:"10px 14px" }}>
                    <div style={{ fontSize:11, fontWeight:700, color:C.orange, textTransform:"uppercase", letterSpacing:".6px", marginBottom:8 }}>Pre-Transfusion Vitals *</div>
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10 }}>
                      <FL label="BP (mmHg)"><input style={fld} value={blood.preBP} placeholder="120/80" onChange={e => setBlood(p => ({ ...p, preBP: e.target.value }))} /></FL>
                      <FL label="Pulse (/min)"><input type="number" style={fld} value={blood.prePulse} placeholder="80" onChange={e => setBlood(p => ({ ...p, prePulse: e.target.value }))} /></FL>
                      <FL label="Temp (°F)"><input type="number" style={fld} value={blood.preTemp} placeholder="98.6" onChange={e => setBlood(p => ({ ...p, preTemp: e.target.value }))} /></FL>
                    </div>
                  </div>
                  {/* Post-transfusion vitals */}
                  {blood.status === "Completed" && (
                    <div style={{ background:C.greenL, border:`1px solid ${C.greenB}`, borderRadius:8, padding:"10px 14px" }}>
                      <div style={{ fontSize:11, fontWeight:700, color:C.green, textTransform:"uppercase", letterSpacing:".6px", marginBottom:8 }}>Post-Transfusion Vitals *</div>
                      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                        <FL label="BP (mmHg)"><input style={fld} value={blood.postBP} placeholder="118/76" onChange={e => setBlood(p => ({ ...p, postBP: e.target.value }))} /></FL>
                        <FL label="Pulse (/min)"><input type="number" style={fld} value={blood.postPulse} placeholder="78" onChange={e => setBlood(p => ({ ...p, postPulse: e.target.value }))} /></FL>
                      </div>
                    </div>
                  )}
                  <div style={{ display:"flex", gap:20, alignItems:"center", flexWrap:"wrap" }}>
                    <label style={{ display:"flex", alignItems:"center", gap:8, cursor:"pointer", fontWeight:700, fontSize:13, color:blood.groupVerified?C.green:C.red }}>
                      <input type="checkbox" checked={blood.groupVerified} onChange={e => setBlood(p => ({ ...p, groupVerified: e.target.checked }))} style={{ accentColor:C.green, width:15, height:15 }} />
                      Group & crossmatch verified (Dual RN sign) ✓
                    </label>
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                    <FL label="Second Nurse Verified (Name) *"><input style={fld} value={blood.secondNurse} placeholder="Verifying nurse name" onChange={e => setBlood(p => ({ ...p, secondNurse: e.target.value }))} /></FL>
                    <FL label="Transfusion Reaction">
                      <select style={{ ...sel, borderColor: blood.reactionType!=="None"?C.red:"#e2e8f0" }} value={blood.reactionType} onChange={e => setBlood(p => ({ ...p, reactionType: e.target.value }))}>
                        {["None","Febrile","Allergic / Urticaria","Anaphylaxis","Haemolytic","TACO","TRALI","Other"].map(o=><option key={o}>{o}</option>)}
                      </select>
                    </FL>
                  </div>
                  {blood.reactionType !== "None" && (
                    <div style={{ background:C.redL, border:`1.5px solid #fca5a5`, borderRadius:8, padding:10, fontSize:12, color:C.red, fontWeight:600 }}>
                      ⚠️ Reaction reported — stop transfusion, notify doctor, send blood bag to lab. Document in critical event.
                    </div>
                  )}
                </div>
              )}

              {/* ── Intake / Output (NABH COP.2) ── */}
              {activeModal === "intake" && (() => {
                const autoMedVol = ivMedOrders.filter(o => includedMedIds.has(o.id)).reduce((s, o) => s + o.totalVol, 0);
                const totalIn  = Number(intake.oral||0)+Number(intake.ivFluids||0)+Number(intake.bloodProducts||0)+autoMedVol;
                const totalOut = Number(intake.urineOutput||0)+Number(intake.drainOutput||0)+Number(intake.nasogastric||0)+Number(intake.emesis||0)+Number(intake.bloodLoss||0);
                const balance  = totalIn - totalOut;
                const toggleMed = (id) => setIncludedMedIds(prev => {
                  const next = new Set(prev);
                  next.has(id) ? next.delete(id) : next.add(id);
                  return next;
                });
                return (
                  <div style={{ display:"flex", flexDirection:"column", gap:12 }}>

                    {/* ── IV Medication Volumes from Treatment Chart ── */}
                    <div style={{ background:"#f0f9ff", border:"1.5px solid #bae6fd", borderRadius:10, overflow:"hidden" }}>
                      <div style={{ padding:"9px 14px", background:"#e0f2fe", borderBottom:"1px solid #bae6fd", display:"flex", alignItems:"center", gap:8 }}>
                        <i className="pi pi-tablets" style={{ fontSize:13, color:"#0369a1" }} />
                        <span style={{ fontSize:12, fontWeight:700, color:"#0369a1", textTransform:"uppercase", letterSpacing:".5px" }}>IV Medication Fluids — Auto from Treatment Chart</span>
                        {ivMedLoading && <i className="pi pi-spin pi-spinner" style={{ fontSize:11, color:"#0369a1", marginLeft:"auto" }} />}
                        {!ivMedLoading && <span style={{ fontSize:11, color:"#0369a1", marginLeft:"auto", fontWeight:600 }}>
                          {ivMedOrders.length === 0 ? "No IV dilution orders found for today" : `${ivMedOrders.length} order${ivMedOrders.length!==1?"s":""} found`}
                        </span>}
                      </div>
                      {ivMedOrders.length > 0 && (
                        <div style={{ padding:"10px 14px", display:"flex", flexDirection:"column", gap:7 }}>
                          {ivMedOrders.map(o => {
                            const included = includedMedIds.has(o.id);
                            const hasVol = o.totalVol > 0;
                            return (
                              <div key={o.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 10px", background: included ? "#f0fdf4" : "#f8fafc", border:`1px solid ${included ? "#86efac" : "#e2e8f0"}`, borderRadius:8, opacity: hasVol ? 1 : 0.6 }}>
                                <input
                                  type="checkbox"
                                  checked={included}
                                  onChange={() => toggleMed(o.id)}
                                  style={{ width:15, height:15, accentColor:"#16a34a", cursor:"pointer", flexShrink:0 }}
                                />
                                <div style={{ flex:1, minWidth:0 }}>
                                  <div style={{ fontSize:13, fontWeight:700, color:"#0f172a" }}>
                                    {o.name}{o.dose ? ` ${o.dose}` : ""}
                                  </div>
                                  <div style={{ fontSize:11, color:"#64748b", marginTop:1 }}>
                                    {o.dilution ? `Dilute in ${o.volPerDose} mL ${o.dilution}` : `${o.volPerDose} mL IV`}
                                    {o.administered > 1 ? ` × ${o.administered} doses` : ""}
                                    {o.times.length > 0 && <span style={{ marginLeft:6, color:"#0369a1" }}>@ {o.times.join(", ")}</span>}
                                  </div>
                                </div>
                                <div style={{ textAlign:"right", flexShrink:0 }}>
                                  {hasVol ? (
                                    <span style={{ fontFamily:"'DM Mono',monospace", fontSize:13, fontWeight:800, color: included ? "#16a34a" : "#64748b" }}>
                                      {included ? "+" : ""}{o.totalVol} mL
                                    </span>
                                  ) : (
                                    <span style={{ fontSize:11, color:"#94a3b8", fontStyle:"italic" }}>Pending</span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                          {autoMedVol > 0 && (
                            <div style={{ display:"flex", justifyContent:"flex-end", paddingTop:4, borderTop:"1px solid #bae6fd" }}>
                              <span style={{ fontFamily:"'DM Mono',monospace", fontSize:12, fontWeight:700, color:"#0369a1" }}>
                                Auto IV Total: +{autoMedVol} mL (included in Total In)
                              </span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* ── Manual Intake / Output ── */}
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                      <div style={{ background:"#eff6ff", border:`1px solid ${C.blueB}`, borderRadius:10, padding:"10px 14px" }}>
                        <div style={{ fontSize:11, fontWeight:700, color:C.blue, textTransform:"uppercase", letterSpacing:".6px", marginBottom:10 }}>Intake</div>
                        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                          {[{k:"oral",l:"Oral (mL)"},{k:"ivFluids",l:"IV Drip Fluids (mL)"},{k:"bloodProducts",l:"Blood Products (mL)"}].map(f=>(
                            <FL key={f.k} label={f.l}>
                              <input type="number" style={{ ...fld, fontSize:13 }} value={intake[f.k]} placeholder="0" onChange={e => setIntake(p => ({ ...p, [f.k]: e.target.value }))} />
                            </FL>
                          ))}
                          {autoMedVol > 0 && (
                            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"5px 8px", background:"#dcfce7", borderRadius:6 }}>
                              <span style={{ fontSize:11, color:"#166534", fontWeight:600 }}>
                                <i className="pi pi-tablets" style={{ marginRight:4, fontSize:10 }} />
                                Medication IV Fluids (Auto)
                              </span>
                              <span style={{ fontFamily:"'DM Mono',monospace", fontSize:12, fontWeight:800, color:"#16a34a" }}>+{autoMedVol} mL</span>
                            </div>
                          )}
                          <div style={{ fontFamily:"'DM Mono',monospace", fontSize:13, fontWeight:700, color:C.blue, paddingTop:4, borderTop:`1px solid ${C.blueB}` }}>Total In: {totalIn} mL</div>
                        </div>
                      </div>
                      <div style={{ background:C.amberL, border:`1px solid ${C.amberB}`, borderRadius:10, padding:"10px 14px" }}>
                        <div style={{ fontSize:11, fontWeight:700, color:C.amber, textTransform:"uppercase", letterSpacing:".6px", marginBottom:10 }}>Output</div>
                        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                          {[{k:"urineOutput",l:"Urine Output (mL)"},{k:"drainOutput",l:"Drain Output (mL)"},{k:"nasogastric",l:"Nasogastric (mL)"},{k:"emesis",l:"Emesis / Vomit (mL)"},{k:"bloodLoss",l:"Blood Loss (mL)"}].map(f=>(
                            <FL key={f.k} label={f.l}>
                              <input type="number" style={{ ...fld, fontSize:13 }} value={intake[f.k]} placeholder="0" onChange={e => setIntake(p => ({ ...p, [f.k]: e.target.value }))} />
                            </FL>
                          ))}
                          <div style={{ fontFamily:"'DM Mono',monospace", fontSize:13, fontWeight:700, color:C.amber, paddingTop:4, borderTop:`1px solid ${C.amberB}` }}>Total Out: {totalOut} mL</div>
                        </div>
                      </div>
                    </div>
                    <div style={{ background: balance>=0?C.greenL:C.redL, border:`1.5px solid ${balance>=0?C.greenB:"#fca5a5"}`, borderRadius:10, padding:"12px 18px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                      <span style={{ fontSize:13, fontWeight:700, color:balance>=0?C.green:C.red }}>Fluid Balance (This Entry)</span>
                      <span style={{ fontFamily:"'DM Mono',monospace", fontSize:22, fontWeight:800, color:balance>=0?C.green:C.red }}>{balance>=0?"+":""}{balance} mL</span>
                    </div>
                  </div>
                );
              })()}

              {/* ── Wound / Dressing (NABH COP.4) ── */}
              {activeModal === "wound" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10 }}>
                    <FL label="Wound Type *">
                      <select style={sel} value={wound.type} onChange={e => setWound(p => ({ ...p, type: e.target.value }))}>
                        {["Surgical","Pressure Injury","Traumatic","Burn","Diabetic Foot","Vascular","Fungating","Other"].map(o=><option key={o}>{o}</option>)}
                      </select>
                    </FL>
                    <FL label="Wound Site / Location *"><input style={fld} value={wound.site} placeholder="e.g. Right lower leg, sacrum" onChange={e => setWound(p => ({ ...p, site: e.target.value }))} /></FL>
                    <FL label="Healing Stage *">
                      <select style={sel} value={wound.healingStage} onChange={e => setWound(p => ({ ...p, healingStage: e.target.value }))}>
                        {["Haemostasis","Inflammatory","Granulating","Epithelializing","Sloughy","Infected","Necrotic","Dehisced"].map(o=><option key={o}>{o}</option>)}
                      </select>
                    </FL>
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10 }}>
                    <FL label="Length (cm) *"><input type="number" style={fld} value={wound.length} placeholder="3" onChange={e => setWound(p => ({ ...p, length: e.target.value }))} /></FL>
                    <FL label="Width (cm) *"><input type="number" style={fld} value={wound.width} placeholder="2" onChange={e => setWound(p => ({ ...p, width: e.target.value }))} /></FL>
                    <FL label="Depth (cm)"><input type="number" style={fld} value={wound.depth} placeholder="0.5" onChange={e => setWound(p => ({ ...p, depth: e.target.value }))} /></FL>
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                    <FL label="Exudate Amount">
                      <select style={sel} value={wound.exudateAmt} onChange={e => setWound(p => ({ ...p, exudateAmt: e.target.value }))}>
                        {["None","Scant","Minimal","Moderate","Heavy"].map(o=><option key={o}>{o}</option>)}
                      </select>
                    </FL>
                    <FL label="Exudate Type">
                      <select style={sel} value={wound.exudateType} onChange={e => setWound(p => ({ ...p, exudateType: e.target.value }))}>
                        {["Serous","Sero-sanguinous","Sanguinous","Purulent","Haemopurulent"].map(o=><option key={o}>{o}</option>)}
                      </select>
                    </FL>
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                    <FL label="Surrounding Skin">
                      <select style={sel} value={wound.surroundingSkin} onChange={e => setWound(p => ({ ...p, surroundingSkin: e.target.value }))}>
                        {["Intact","Erythema","Macerated","Oedematous","Dry/Scaly","Excoriated"].map(o=><option key={o}>{o}</option>)}
                      </select>
                    </FL>
                    <FL label="Dressing Applied *"><input style={fld} value={wound.dressing} placeholder="e.g. Povidone-Iodine + paraffin gauze" onChange={e => setWound(p => ({ ...p, dressing: e.target.value }))} /></FL>
                  </div>
                  <div style={{ display:"flex", gap:20, flexWrap:"wrap" }}>
                    {[
                      {k:"tunneling",l:"Tunnelling present",c:C.amber},{k:"undermining",l:"Undermining present",c:C.amber},
                      {k:"odour",l:"Malodour present",c:C.red},{k:"swabSent",l:"Wound swab sent",c:C.green},
                    ].map(f=>(
                      <label key={f.k} style={{ display:"flex", alignItems:"center", gap:8, cursor:"pointer", fontWeight:600, fontSize:13, color:wound[f.k]?f.c:C.muted }}>
                        <input type="checkbox" checked={wound[f.k]} onChange={e => setWound(p => ({ ...p, [f.k]: e.target.checked }))} style={{ accentColor:f.c, width:15, height:15 }} />
                        {f.l}
                      </label>
                    ))}
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                    <FL label="Pain During Dressing (NRS 0-10)"><input type="number" min="0" max="10" style={fld} value={wound.painDuring} placeholder="0" onChange={e => setWound(p => ({ ...p, painDuring: e.target.value }))} /></FL>
                    <FL label="Next Dressing Due"><input type="date" style={fld} value={wound.nextDressingDate} onChange={e => setWound(p => ({ ...p, nextDressingDate: e.target.value }))} /></FL>
                  </div>
                </div>
              )}

              {/* ── Skin / Pressure (NABH COP.4 — Braden Scale) ── */}
              {activeModal === "skin" && (() => {
                const bradenTotal = calcBraden(skin);
                const band = bradenBand(bradenTotal);
                const bradenFields = [
                  { k:"b1", label:"Sensory Perception", opts:[{v:"1",l:"1 – Completely Limited"},{v:"2",l:"2 – Very Limited"},{v:"3",l:"3 – Slightly Limited"},{v:"4",l:"4 – No Impairment"}] },
                  { k:"b2", label:"Moisture", opts:[{v:"1",l:"1 – Constantly Moist"},{v:"2",l:"2 – Often Moist"},{v:"3",l:"3 – Occasionally Moist"},{v:"4",l:"4 – Rarely Moist"}] },
                  { k:"b3", label:"Activity", opts:[{v:"1",l:"1 – Bedfast"},{v:"2",l:"2 – Chairfast"},{v:"3",l:"3 – Walks Occasionally"},{v:"4",l:"4 – Walks Frequently"}] },
                  { k:"b4", label:"Mobility", opts:[{v:"1",l:"1 – Completely Immobile"},{v:"2",l:"2 – Very Limited"},{v:"3",l:"3 – Slightly Limited"},{v:"4",l:"4 – No Limitation"}] },
                  { k:"b5", label:"Nutrition", opts:[{v:"1",l:"1 – Very Poor"},{v:"2",l:"2 – Probably Inadequate"},{v:"3",l:"3 – Adequate"},{v:"4",l:"4 – Excellent"}] },
                  { k:"b6", label:"Friction & Shear", opts:[{v:"1",l:"1 – Problem"},{v:"2",l:"2 – Potential Problem"},{v:"3",l:"3 – No Apparent Problem"}] },
                ];
                return (
                  <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
                    {/* Braden Score */}
                    <div style={{ background:"#f8fafc", border:`1px solid ${C.border}`, borderRadius:10, padding:"12px 14px" }}>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
                        <div style={{ fontSize:12, fontWeight:700, color:C.muted, textTransform:"uppercase", letterSpacing:".6px" }}>Braden Pressure Injury Risk Scale</div>
                        <div style={{ background:band.bg, color:band.color, border:`1.5px solid ${band.color}30`, borderRadius:8, padding:"4px 14px", fontWeight:800, fontSize:14 }}>
                          {bradenTotal}/23 — {band.label}
                        </div>
                      </div>
                      <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8 }}>
                        {bradenFields.map(f => (
                          <FL key={f.k} label={f.label}>
                            <select style={{ ...sel, borderColor: Number(skin[f.k])<=2?C.red:Number(skin[f.k])===3?C.amber:"#e2e8f0" }}
                              value={skin[f.k]} onChange={e => setSkin(p => ({ ...p, [f.k]: e.target.value }))}>
                              {f.opts.map(o=><option key={o.v} value={o.v}>{o.l}</option>)}
                            </select>
                          </FL>
                        ))}
                      </div>
                    </div>
                    {/* Pressure injury details */}
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10 }}>
                      <FL label="Pressure Area Location"><input style={fld} value={skin.area} placeholder="e.g. Sacrum, heels, occiput" onChange={e => setSkin(p => ({ ...p, area: e.target.value }))} /></FL>
                      <FL label="Pressure Injury Stage">
                        <select style={sel} value={skin.stage} onChange={e => setSkin(p => ({ ...p, stage: e.target.value }))}>
                          {["No Injury","Stage I","Stage II","Stage III","Stage IV","Unstageable","Deep Tissue Injury"].map(o=><option key={o}>{o}</option>)}
                        </select>
                      </FL>
                      <FL label="Repositioning Frequency">
                        <select style={sel} value={skin.repositionFreq} onChange={e => setSkin(p => ({ ...p, repositionFreq: e.target.value }))}>
                          {["Hourly","2-hourly","4-hourly","As tolerated","On request"].map(o=><option key={o}>{o}</option>)}
                        </select>
                      </FL>
                    </div>
                    <FL label="Interventions Applied"><input style={fld} value={skin.intervention} placeholder="Foam dressing, barrier cream, pressure-relieving mattress, heel wedge…" onChange={e => setSkin(p => ({ ...p, intervention: e.target.value }))} /></FL>
                    <label style={{ display:"flex", alignItems:"center", gap:8, cursor:"pointer", fontWeight:700, fontSize:13, color:skin.repositioned?C.green:C.muted }}>
                      <input type="checkbox" checked={skin.repositioned} onChange={e => setSkin(p => ({ ...p, repositioned: e.target.checked }))} style={{ accentColor:C.green, width:15, height:15 }} />
                      Patient repositioned this entry
                    </label>
                  </div>
                );
              })()}

              {/* ── Fall Risk — Morse Scale (NABH FMS.2) ── */}
              {activeModal === "fall" && (() => {
                const morseTotal = calcMorse(fallRisk);
                const band = morseBand(morseTotal);
                const morseItems = [
                  { k:"m1", label:"1. History of Falls (within 3 months)", opts:[{v:"0",l:"No — 0"},{v:"25",l:"Yes — 25"}] },
                  { k:"m2", label:"2. Secondary Diagnosis", opts:[{v:"0",l:"No — 0"},{v:"15",l:"Yes — 15"}] },
                  { k:"m3", label:"3. Ambulatory Aid", opts:[{v:"0",l:"None / Bedrest / Nurse — 0"},{v:"15",l:"Crutch / Cane / Walker — 15"},{v:"30",l:"Furniture — 30"}] },
                  { k:"m4", label:"4. IV / Heparin Lock", opts:[{v:"0",l:"No — 0"},{v:"20",l:"Yes — 20"}] },
                  { k:"m5", label:"5. Gait / Transferring", opts:[{v:"0",l:"Normal / Bedrest / Immobile — 0"},{v:"10",l:"Weak — 10"},{v:"20",l:"Impaired — 20"}] },
                  { k:"m6", label:"6. Mental Status", opts:[{v:"0",l:"Aware of own ability — 0"},{v:"15",l:"Forgets limitations — 15"}] },
                ];
                const intList = [
                  {k:"intBedRails",l:"Bed rails raised (×2)"},{k:"intCallBell",l:"Call bell within reach"},
                  {k:"intNonSlip",l:"Non-slip footwear"},{k:"intBedLowest",l:"Bed in lowest position"},
                  {k:"intSupervision",l:"Supervision / escort for ambulation"},{k:"intPatientEd",l:"Patient educated on fall risk"},
                  {k:"intFamilyEd",l:"Family educated"},
                ];
                return (
                  <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
                    <div style={{ background:"#f8fafc", border:`1px solid ${C.border}`, borderRadius:10, padding:"12px 14px" }}>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
                        <div style={{ fontSize:12, fontWeight:700, color:C.muted, textTransform:"uppercase", letterSpacing:".6px" }}>Morse Fall Scale</div>
                        <div style={{ background:band.bg, color:band.color, border:`1.5px solid ${band.color}30`, borderRadius:8, padding:"4px 16px", fontWeight:800, fontSize:14 }}>
                          {morseTotal}/125 — {band.label}
                        </div>
                      </div>
                      <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                        {morseItems.map(item => (
                          <div key={item.k} style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, alignItems:"center" }}>
                            <div style={{ fontSize:12, fontWeight:600, color:C.text }}>{item.label}</div>
                            <select style={{ ...sel, borderColor: Number(fallRisk[item.k])>0?C.amber:"#e2e8f0" }}
                              value={fallRisk[item.k]} onChange={e => setFallRisk(p => ({ ...p, [item.k]: e.target.value }))}>
                              {item.opts.map(o=><option key={o.v} value={o.v}>{o.l}</option>)}
                            </select>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div style={lbl}>Interventions Applied (check all that apply)</div>
                      <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginTop:6 }}>
                        {intList.map(f=>(
                          <label key={f.k} style={{ display:"flex", alignItems:"center", gap:7, cursor:"pointer", fontWeight:600, fontSize:12, color:fallRisk[f.k]?C.green:C.muted, padding:"6px 12px", border:`1.5px solid ${fallRisk[f.k]?C.green:C.border}`, borderRadius:20, background:fallRisk[f.k]?C.greenL:"white", transition:"all .15s" }}>
                            <input type="checkbox" checked={fallRisk[f.k]} onChange={e => setFallRisk(p => ({ ...p, [f.k]: e.target.checked }))} style={{ accentColor:C.green, width:13, height:13 }} />
                            {f.l}
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* ── Procedure / Intervention (NABH COP.3) ── */}
              {activeModal === "procedure" && (
                <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10 }}>
                    <FL label="Procedure Name *"><input style={fld} value={procedure.procedureName} placeholder="e.g. Urinary catheterisation" onChange={e => setProcedure(p => ({ ...p, procedureName: e.target.value }))} /></FL>
                    <FL label="Indication / Reason *"><input style={fld} value={procedure.indication} placeholder="Reason for procedure" onChange={e => setProcedure(p => ({ ...p, indication: e.target.value }))} /></FL>
                    <FL label="Time of Procedure *"><input type="time" style={fld} value={procedure.time} onChange={e => setProcedure(p => ({ ...p, time: e.target.value }))} /></FL>
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10 }}>
                    <FL label="Performed By *"><input style={fld} value={procedure.performedBy} placeholder="Name of performer" onChange={e => setProcedure(p => ({ ...p, performedBy: e.target.value }))} /></FL>
                    <FL label="Designation *">
                      <select style={sel} value={procedure.designation} onChange={e => setProcedure(p => ({ ...p, designation: e.target.value }))}>
                        {["Staff Nurse","Senior Nurse","Resident Doctor","Consultant","Anaesthetist","Technician"].map(o=><option key={o}>{o}</option>)}
                      </select>
                    </FL>
                    <FL label="Assistant"><input style={fld} value={procedure.assistant} placeholder="Assisting nurse/doctor" onChange={e => setProcedure(p => ({ ...p, assistant: e.target.value }))} /></FL>
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10 }}>
                    <FL label="Site / Location"><input style={fld} value={procedure.site} placeholder="e.g. Right subclavian" onChange={e => setProcedure(p => ({ ...p, site: e.target.value }))} /></FL>
                    <FL label="Laterality">
                      <select style={sel} value={procedure.laterality} onChange={e => setProcedure(p => ({ ...p, laterality: e.target.value }))}>
                        {["N/A","Left","Right","Bilateral","Midline"].map(o=><option key={o}>{o}</option>)}
                      </select>
                    </FL>
                    <FL label="Patient Position">
                      <select style={sel} value={procedure.position} onChange={e => setProcedure(p => ({ ...p, position: e.target.value }))}>
                        {["Supine","Left Lateral","Right Lateral","Lithotomy","Trendelenburg","Prone","Sitting"].map(o=><option key={o}>{o}</option>)}
                      </select>
                    </FL>
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                    <FL label="Patient Outcome">
                      <select style={{ ...sel, borderColor: procedure.outcome==="Complication Noted"||procedure.outcome==="Procedure Abandoned"?C.red:"#e2e8f0" }}
                        value={procedure.outcome} onChange={e => setProcedure(p => ({ ...p, outcome: e.target.value }))}>
                        {["Tolerated Well","Partial Cooperation","Procedure Abandoned","Complication Noted"].map(o=><option key={o}>{o}</option>)}
                      </select>
                    </FL>
                    <FL label="Complications (if any)"><input style={fld} value={procedure.complications} placeholder="None / describe" onChange={e => setProcedure(p => ({ ...p, complications: e.target.value }))} /></FL>
                  </div>
                  <FL label="Post-Procedure Monitoring / Follow-up"><input style={fld} value={procedure.followUp} placeholder="e.g. Monitor urine output, check site for bleeding in 30 min" onChange={e => setProcedure(p => ({ ...p, followUp: e.target.value }))} /></FL>
                  <div style={{ display:"flex", gap:20, flexWrap:"wrap" }}>
                    <label style={{ display:"flex", alignItems:"center", gap:8, cursor:"pointer", fontWeight:700, fontSize:13, color:procedure.consentObtained?C.green:C.red }}>
                      <input type="checkbox" checked={procedure.consentObtained} onChange={e => setProcedure(p => ({ ...p, consentObtained: e.target.checked }))} style={{ accentColor:C.green, width:15, height:15 }} />
                      Consent Obtained *
                    </label>
                    <label style={{ display:"flex", alignItems:"center", gap:8, cursor:"pointer", fontWeight:700, fontSize:13, color:procedure.sterile?C.green:C.amber }}>
                      <input type="checkbox" checked={procedure.sterile} onChange={e => setProcedure(p => ({ ...p, sterile: e.target.checked }))} style={{ accentColor:C.green, width:15, height:15 }} />
                      Sterile technique maintained
                    </label>
                    <label style={{ display:"flex", alignItems:"center", gap:8, cursor:"pointer", fontWeight:700, fontSize:13, color:procedure.specimenSent?C.blue:C.muted }}>
                      <input type="checkbox" checked={procedure.specimenSent} onChange={e => setProcedure(p => ({ ...p, specimenSent: e.target.checked }))} style={{ accentColor:C.blue, width:15, height:15 }} />
                      Specimen sent
                    </label>
                  </div>
                  {procedure.specimenSent && <FL label="Specimen Type"><input style={fld} value={procedure.specimenType} placeholder="e.g. Urine C&S, Blood culture, Tissue biopsy" onChange={e => setProcedure(p => ({ ...p, specimenType: e.target.value }))} /></FL>}
                </div>
              )}

              {/* ── Discharge / Handover — SBAR (NABH COP.6) ── */}
              {activeModal === "discharge" && (
                <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10 }}>
                    <FL label="Handover Type *">
                      <select style={sel} value={discharge.type} onChange={e => setDischarge(p => ({ ...p, type: e.target.value }))}>
                        {["Shift Handover","Patient Discharge","Ward Transfer","ICU Transfer","LAMA","Death Summary"].map(o=><option key={o}>{o}</option>)}
                      </select>
                    </FL>
                    <FL label="Patient Status *">
                      <select style={{ ...sel, borderColor: discharge.patientStatus==="Critical"||discharge.patientStatus==="Deteriorating"?C.red:"#e2e8f0" }}
                        value={discharge.patientStatus} onChange={e => setDischarge(p => ({ ...p, patientStatus: e.target.value }))}>
                        {["Stable","Improving","Unchanged","Critical","Deteriorating","Deceased"].map(o=><option key={o}>{o}</option>)}
                      </select>
                    </FL>
                    <FL label="Receiving Nurse / Handover To *"><input style={fld} value={discharge.incomingNurse} placeholder="Name of incoming nurse" onChange={e => setDischarge(p => ({ ...p, incomingNurse: e.target.value }))} /></FL>
                  </div>
                  {/* SBAR */}
                  <div style={{ background:"#f8fafc", border:`1px solid ${C.border}`, borderRadius:10, padding:"12px 14px" }}>
                    <div style={{ fontSize:11, fontWeight:700, color:C.muted, textTransform:"uppercase", letterSpacing:".6px", marginBottom:12 }}>SBAR Handover Format (NABH Std)</div>
                    {[
                      {k:"situation", label:"S — Situation", placeholder:"Current status, immediate concern, reason for handover…", color:C.blue},
                      {k:"background", label:"B — Background", placeholder:"Admission diagnosis, relevant history, current medications & treatments…", color:C.purple},
                      {k:"assessment", label:"A — Assessment", placeholder:"Clinical condition now, vital signs, pain score, any recent changes…", color:C.amber},
                      {k:"recommendation", label:"R — Recommendation", placeholder:"Pending orders, actions needed, follow-up, special precautions…", color:C.green},
                    ].map(f=>(
                      <div key={f.k} style={{ marginBottom:10 }}>
                        <label style={{ ...lbl, color:f.color }}>{f.label}</label>
                        <textarea style={{ ...ta, minHeight:60, borderColor:`${f.color}40` }} value={discharge[f.k]} placeholder={f.placeholder}
                          onChange={e => setDischarge(p => ({ ...p, [f.k]: e.target.value }))} />
                      </div>
                    ))}
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                    <div>
                      <div style={lbl}>Patient / Family Education</div>
                      <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
                        <label style={{ display:"flex", alignItems:"center", gap:8, cursor:"pointer", fontWeight:600, fontSize:13, color:discharge.educationGiven?C.green:C.muted }}>
                          <input type="checkbox" checked={discharge.educationGiven} onChange={e => setDischarge(p => ({ ...p, educationGiven: e.target.checked }))} style={{ accentColor:C.green, width:14, height:14 }} />
                          Education given
                        </label>
                        <label style={{ display:"flex", alignItems:"center", gap:8, cursor:"pointer", fontWeight:600, fontSize:13, color:discharge.valuablesHandedOver?C.green:C.muted }}>
                          <input type="checkbox" checked={discharge.valuablesHandedOver} onChange={e => setDischarge(p => ({ ...p, valuablesHandedOver: e.target.checked }))} style={{ accentColor:C.green, width:14, height:14 }} />
                          Valuables handed over
                        </label>
                      </div>
                    </div>
                    <FL label="Follow-up Date"><input type="date" style={fld} value={discharge.followUpDate} onChange={e => setDischarge(p => ({ ...p, followUpDate: e.target.value }))} /></FL>
                  </div>
                  {discharge.educationGiven && <FL label="Education Topics Covered"><input style={fld} value={discharge.educationTopics} placeholder="Medication adherence, wound care, diet, warning signs, follow-up…" onChange={e => setDischarge(p => ({ ...p, educationTopics: e.target.value }))} /></FL>}
                </div>
              )}

              {/* ── MEWS Calculator ── */}
              {activeModal === "mews" && (() => {
                const total = calcMEWS(mews);
                const band  = mewsBand(total);
                const params = [
                  { k:"rr",   label:"Respiratory Rate (/min)",  placeholder:"16", scoreLabel: mewsParamScore("rr",   mews.rr)   },
                  { k:"spo2", label:"SpO₂ (%)",                 placeholder:"98", scoreLabel: mewsParamScore("spo2", mews.spo2) },
                  { k:"temp", label:"Temperature (°C)",         placeholder:"37", scoreLabel: mewsParamScore("temp", mews.temp) },
                  { k:"sbp",  label:"Systolic BP (mmHg)",       placeholder:"120",scoreLabel: mewsParamScore("sbp",  mews.sbp)  },
                  { k:"hr",   label:"Heart Rate (/min)",        placeholder:"80", scoreLabel: mewsParamScore("hr",   mews.hr)   },
                ];
                return (
                  <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
                    {/* Big score display */}
                    <div style={{ background:band.bg, border:`2px solid ${band.color}30`, borderRadius:14, padding:"18px 24px", display:"flex", alignItems:"center", gap:20 }}>
                      <div style={{ textAlign:"center" }}>
                        <div style={{ fontFamily:"'DM Mono',monospace", fontSize:52, fontWeight:900, color:band.color, lineHeight:1 }}>{total}</div>
                        <div style={{ fontSize:11, fontWeight:700, color:band.color+"aa", textTransform:"uppercase", letterSpacing:".8px" }}>MEWS Score</div>
                      </div>
                      <div>
                        <div style={{ fontSize:16, fontWeight:800, color:band.color, marginBottom:4 }}>
                          <i className={`pi ${band.icon}`} style={{ marginRight:8 }} />{band.label}
                        </div>
                        <div style={{ fontSize:12, color:band.color+"cc", lineHeight:1.5 }}>{band.action}</div>
                        <div style={{ display:"flex", gap:4, marginTop:10 }}>
                          {[0,1,2,3,4,5,6,7,8,9].map(n=>(
                            <div key={n} style={{ width:28, height:8, borderRadius:4, background: total>n?(n>=7?C.red:n>=5?C.orange:n>=2?C.amber:C.green):"#e2e8f0", transition:"all .3s" }} />
                          ))}
                        </div>
                      </div>
                    </div>
                    {/* Parameter inputs */}
                    <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10 }}>
                      {params.map(p => {
                        const sc = p.scoreLabel;
                        return (
                          <div key={p.k} style={{ background:"#f8fafc", border:`1px solid ${sc!==null&&sc>0?C.amber:C.border}`, borderRadius:10, padding:"10px 12px" }}>
                            <div style={{ fontSize:10, fontWeight:700, color:C.muted, textTransform:"uppercase", letterSpacing:".6px", marginBottom:6 }}>{p.label}</div>
                            <input type="number" style={{ ...fld, background:"white", marginBottom:6 }} value={mews[p.k]} placeholder={p.placeholder}
                              onChange={e => setMews(pr => ({ ...pr, [p.k]: e.target.value }))} />
                            {sc !== null && (
                              <div style={{ fontSize:11, fontWeight:700, color:sc>0?C.red:C.green, textAlign:"center" }}>
                                Score: {sc} {sc>0?"⚠":"✓"}
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {/* AVPU */}
                      <div style={{ background:"#f8fafc", border:`1px solid ${mews.avpu!=="A"?C.red:C.border}`, borderRadius:10, padding:"10px 12px" }}>
                        <div style={{ fontSize:10, fontWeight:700, color:C.muted, textTransform:"uppercase", letterSpacing:".6px", marginBottom:6 }}>AVPU Consciousness</div>
                        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6 }}>
                          {[{v:"A",l:"Alert"},{v:"V",l:"Voice"},{v:"P",l:"Pain"},{v:"U",l:"Unresponsive"}].map(opt=>(
                            <button key={opt.v} onClick={() => setMews(p=>({...p, avpu:opt.v}))}
                              style={{ padding:"6px 8px", border:`1.5px solid ${mews.avpu===opt.v?(opt.v==="A"?C.green:C.red):C.border}`, borderRadius:7, background:mews.avpu===opt.v?(opt.v==="A"?C.greenL:C.redL):"white", fontFamily:"'DM Sans',sans-serif", fontSize:12, fontWeight:700, cursor:"pointer", color:mews.avpu===opt.v?(opt.v==="A"?C.green:C.red):C.muted }}>
                              <span style={{ fontSize:14, fontWeight:900 }}>{opt.v}</span> {opt.l}
                            </button>
                          ))}
                        </div>
                        <div style={{ fontSize:11, fontWeight:700, color:mews.avpu==="A"?C.green:C.red, textAlign:"center", marginTop:6 }}>
                          Score: {{A:0,V:1,P:2,U:3}[mews.avpu]} {mews.avpu!=="A"?"⚠":"✓"}
                        </div>
                      </div>
                    </div>
                    {/* Reference table */}
                    <div style={{ background:"#f1f5f9", borderRadius:8, padding:"10px 14px", fontSize:11, color:C.muted }}>
                      <div style={{ fontWeight:700, marginBottom:4 }}>Escalation Protocol (as per NABH/WHO Rapid Response)</div>
                      <div style={{ display:"flex", gap:16 }}>
                        {[{score:"0–1",label:"Normal",c:C.green},{score:"2–4",label:"↑ Monitoring",c:C.amber},{score:"5–6",label:"Urgent Review",c:C.orange},{score:"≥7",label:"Emergency",c:C.red}].map(b=>(
                          <span key={b.score} style={{ fontWeight:700, color:b.c }}>{b.score}: {b.label}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* ── General Observation (default free text only) ── */}
              {activeModal === "general" && null}

              {/* ── Daily Assessment (NABH NS.4) ── */}
              {activeModal === "daily" && (() => {
                const SYSTEMS = [
                  { k:"neuroStatus",         label:"Neuro / Consciousness" },
                  { k:"respiratoryStatus",    label:"Respiratory" },
                  { k:"cardiovascularStatus", label:"Cardiovascular" },
                  { k:"giStatus",             label:"GI / Abdomen" },
                  { k:"guStatus",             label:"GU / Urine Output" },
                  { k:"musculoskeletalStatus",label:"Musculoskeletal / Mobility" },
                  { k:"skinStatus",           label:"Skin / Wound" },
                ];
                const SYS_DEFAULTS = {
                  neuroStatus: ["Alert & Oriented","Confused","Drowsy","Unresponsive","Sedated"],
                  respiratoryStatus: ["Clear bilaterally","Rhonchi present","Crackles present","Wheeze","On O₂ support"],
                  cardiovascularStatus: ["Regular rate & rhythm","Tachycardia","Bradycardia","Irregular","Oedema present"],
                  giStatus: ["Active bowel sounds","Absent bowel sounds","Distension","Nausea/vomiting","NGT in situ"],
                  guStatus: ["Urine output adequate","Reduced output","Foley catheter patent","Haematuria","Anuria"],
                  musculoskeletalStatus: ["Moves all extremities","Reduced mobility","Bed-bound","Contractures","Oedema limbs"],
                  skinStatus: ["Intact","Redness noted","Stage I pressure injury","Stage II pressure injury","Wound present"],
                };
                const INTERVENTIONS = [
                  { k:"intReposition",       label:"Repositioning done" },
                  { k:"intOralCare",         label:"Oral care given" },
                  { k:"intPressureRelief",   label:"Pressure relief applied" },
                  { k:"intRangeOfMotion",    label:"ROM exercises performed" },
                  { k:"intFallPrecautions",  label:"Fall precautions active" },
                  { k:"intCallBell",         label:"Call bell within reach" },
                  { k:"intMedAdministered",  label:"Medications administered" },
                  { k:"intWoundCare",        label:"Wound/dressing care done" },
                  { k:"intIVCheck",          label:"IV site checked" },
                  { k:"intNGTCheck",         label:"NGT position verified" },
                  { k:"intFoleyCheck",       label:"Foley catheter patent" },
                  { k:"intOxygenCheck",      label:"O₂ therapy check" },
                  { k:"intPatientEducation", label:"Patient education given" },
                  { k:"intFamilyUpdate",     label:"Family updated" },
                  { k:"intDoctorNotified",   label:"Doctor notified" },
                  { k:"intDocumented",       label:"Documentation complete" },
                ];
                return (
                  <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
                    {/* Vitals snapshot */}
                    <div style={{ background:"#f8fafc", borderRadius:10, padding:"12px 14px", border:`1px solid ${C.border}` }}>
                      <div style={{ fontSize:11, fontWeight:700, color:C.muted, textTransform:"uppercase", letterSpacing:".6px", marginBottom:10 }}>Vitals Snapshot</div>
                      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8 }}>
                        {[{k:"bp",label:"BP (mmHg)",ph:"120/80"},{k:"pulse",label:"Pulse (/min)",ph:"80"},{k:"temp",label:"Temp (°F)",ph:"98.6"},{k:"spo2",label:"SpO₂ (%)",ph:"98"},{k:"rr",label:"RR (/min)",ph:"16"},{k:"bsl",label:"BSL (mg/dL)",ph:"110"},{k:"gcs",label:"GCS",ph:"15"}].map(f=>(
                          <FL key={f.k} label={f.label}>
                            <input style={fld} value={dailyAssess[f.k]} placeholder={f.ph} onChange={e=>setDailyAssess(p=>({...p,[f.k]:e.target.value}))} />
                          </FL>
                        ))}
                      </div>
                    </div>
                    {/* System assessments */}
                    <div style={{ background:"#f8fafc", borderRadius:10, padding:"12px 14px", border:`1px solid ${C.border}` }}>
                      <div style={{ fontSize:11, fontWeight:700, color:C.muted, textTransform:"uppercase", letterSpacing:".6px", marginBottom:10 }}>Body Systems Assessment</div>
                      <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                        {SYSTEMS.map(sys=>(
                          <div key={sys.k} style={{ display:"grid", gridTemplateColumns:"160px 1fr", alignItems:"center", gap:10 }}>
                            <label style={{ fontSize:12, fontWeight:600, color:C.text }}>{sys.label}</label>
                            <select style={sel} value={dailyAssess[sys.k]} onChange={e=>setDailyAssess(p=>({...p,[sys.k]:e.target.value}))}>
                              {SYS_DEFAULTS[sys.k].map(o=><option key={o}>{o}</option>)}
                            </select>
                          </div>
                        ))}
                      </div>
                    </div>
                    {/* Interventions checklist */}
                    <div style={{ background:"#f8fafc", borderRadius:10, padding:"12px 14px", border:`1px solid ${C.border}` }}>
                      <div style={{ fontSize:11, fontWeight:700, color:C.muted, textTransform:"uppercase", letterSpacing:".6px", marginBottom:10 }}>Nursing Interventions</div>
                      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6 }}>
                        {INTERVENTIONS.map(iv=>(
                          <label key={iv.k} style={{ display:"flex", alignItems:"center", gap:7, fontSize:12, fontWeight:500, color:dailyAssess[iv.k]?C.primary:C.text, cursor:"pointer", padding:"4px 6px", borderRadius:6, background:dailyAssess[iv.k]?C.primaryL:"transparent" }}>
                            <input type="checkbox" checked={dailyAssess[iv.k]} onChange={e=>setDailyAssess(p=>({...p,[iv.k]:e.target.checked}))} style={{ accentColor:C.primary, width:14, height:14 }} />
                            {iv.label}
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* ── Initial Assessment (NABH COP.1) ── */}
              {activeModal === "initial" && (() => {
                const bradenScore = calcBraden(initialAssess);
                const morseScore  = calcMorse(initialAssess);
                const bb = bradenBand(bradenScore);
                const mb = morseBand(morseScore);
                return (
                  <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
                    {/* Admission Info */}
                    <div style={{ background:"#f8fafc", borderRadius:10, padding:"12px 14px", border:`1px solid ${C.border}` }}>
                      <div style={{ fontSize:11, fontWeight:700, color:C.muted, textTransform:"uppercase", letterSpacing:".6px", marginBottom:10 }}>Admission Details</div>
                      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                        <FL label="Mode of Admission">
                          <select style={sel} value={initialAssess.admissionMode} onChange={e=>setInitialAssess(p=>({...p,admissionMode:e.target.value}))}>
                            {["Planned","Emergency","Transfer","OPD Referral"].map(o=><option key={o}>{o}</option>)}
                          </select>
                        </FL>
                        <FL label="Chief Complaint">
                          <input style={fld} value={initialAssess.chiefComplaint} placeholder="e.g. Chest pain" onChange={e=>setInitialAssess(p=>({...p,chiefComplaint:e.target.value}))} />
                        </FL>
                        <FL label="Duration of Complaint">
                          <input style={fld} value={initialAssess.duration} placeholder="e.g. 2 days" onChange={e=>setInitialAssess(p=>({...p,duration:e.target.value}))} />
                        </FL>
                        <FL label="Allergies">
                          <input style={fld} value={initialAssess.allergies} placeholder="None / NKDA" onChange={e=>setInitialAssess(p=>({...p,allergies:e.target.value}))} />
                        </FL>
                      </div>
                      <div style={{ marginTop:10 }}>
                        <FL label="History of Present Illness">
                          <textarea style={{...ta,minHeight:56}} value={initialAssess.historyOfIllness} placeholder="Brief history..." onChange={e=>setInitialAssess(p=>({...p,historyOfIllness:e.target.value}))} />
                        </FL>
                      </div>
                    </div>
                    {/* Vitals at Admission */}
                    <div style={{ background:"#f8fafc", borderRadius:10, padding:"12px 14px", border:`1px solid ${C.border}` }}>
                      <div style={{ fontSize:11, fontWeight:700, color:C.muted, textTransform:"uppercase", letterSpacing:".6px", marginBottom:10 }}>Vitals on Admission</div>
                      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8 }}>
                        {[{k:"bp",l:"BP",ph:"120/80"},{k:"pulse",l:"Pulse",ph:"80"},{k:"temp",l:"Temp°F",ph:"98.6"},{k:"spo2",l:"SpO₂%",ph:"98"},{k:"rr",l:"RR/min",ph:"16"},{k:"weight",l:"Weight kg",ph:"60"},{k:"height",l:"Height cm",ph:"165"}].map(f=>(
                          <FL key={f.k} label={f.l}>
                            <input style={fld} value={initialAssess[f.k]} placeholder={f.ph} onChange={e=>setInitialAssess(p=>({...p,[f.k]:e.target.value}))} />
                          </FL>
                        ))}
                      </div>
                    </div>
                    {/* Braden Scale */}
                    <div style={{ background:"#f8fafc", borderRadius:10, padding:"12px 14px", border:`1px solid ${C.border}` }}>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
                        <div style={{ fontSize:11, fontWeight:700, color:C.muted, textTransform:"uppercase", letterSpacing:".6px" }}>Braden Scale — Pressure Ulcer Risk</div>
                        <span style={{ background:bb.bg, color:bb.color, padding:"2px 10px", borderRadius:5, fontSize:11, fontWeight:700 }}>{bradenScore}/23 — {bb.label}</span>
                      </div>
                      <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8 }}>
                        {[
                          {k:"b1",l:"Sensory Perception",opts:["1 – Completely Limited","2 – Very Limited","3 – Slightly Limited","4 – No Impairment"]},
                          {k:"b2",l:"Moisture",opts:["1 – Constantly Moist","2 – Often Moist","3 – Occasionally Moist","4 – Rarely Moist"]},
                          {k:"b3",l:"Activity",opts:["1 – Bedfast","2 – Chairfast","3 – Walks Occasionally","4 – Walks Frequently"]},
                          {k:"b4",l:"Mobility",opts:["1 – Completely Immobile","2 – Very Limited","3 – Slightly Limited","4 – No Limitation"]},
                          {k:"b5",l:"Nutrition",opts:["1 – Very Poor","2 – Probably Inadequate","3 – Adequate","4 – Excellent"]},
                          {k:"b6",l:"Friction & Shear",opts:["1 – Problem","2 – Potential Problem","3 – No Apparent Problem"]},
                        ].map(f=>(
                          <FL key={f.k} label={f.l}>
                            <select style={{...sel,fontSize:11}} value={initialAssess[f.k]} onChange={e=>setInitialAssess(p=>({...p,[f.k]:e.target.value}))}>
                              {f.opts.map(o=><option key={o} value={o[0]}>{o}</option>)}
                            </select>
                          </FL>
                        ))}
                      </div>
                    </div>
                    {/* Morse Fall Scale */}
                    <div style={{ background:"#f8fafc", borderRadius:10, padding:"12px 14px", border:`1px solid ${C.border}` }}>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
                        <div style={{ fontSize:11, fontWeight:700, color:C.muted, textTransform:"uppercase", letterSpacing:".6px" }}>Morse Fall Scale</div>
                        <span style={{ background:mb.bg, color:mb.color, padding:"2px 10px", borderRadius:5, fontSize:11, fontWeight:700 }}>{morseScore} — {mb.label}</span>
                      </div>
                      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                        {[
                          {k:"m1",l:"Fall History (last 3 months)",opts:[{v:"0",l:"No (0)"},{v:"25",l:"Yes (25)"}]},
                          {k:"m2",l:"Secondary Diagnosis",opts:[{v:"0",l:"No (0)"},{v:"15",l:"Yes (15)"}]},
                          {k:"m3",l:"Ambulatory Aid",opts:[{v:"0",l:"None/Bedrest/Wheelchair (0)"},{v:"15",l:"Crutches/Cane/Walker (15)"},{v:"30",l:"Furniture (30)"}]},
                          {k:"m4",l:"IV / Hep-Lock",opts:[{v:"0",l:"No (0)"},{v:"20",l:"Yes (20)"}]},
                          {k:"m5",l:"Gait",opts:[{v:"0",l:"Normal/Bedrest/Wheelchair (0)"},{v:"10",l:"Weak (10)"},{v:"20",l:"Impaired (20)"}]},
                          {k:"m6",l:"Mental Status",opts:[{v:"0",l:"Oriented (0)"},{v:"15",l:"Overestimates ability (15)"}]},
                        ].map(f=>(
                          <FL key={f.k} label={f.l}>
                            <select style={sel} value={initialAssess[f.k]} onChange={e=>setInitialAssess(p=>({...p,[f.k]:e.target.value}))}>
                              {f.opts.map(o=><option key={o.v} value={o.v}>{o.l}</option>)}
                            </select>
                          </FL>
                        ))}
                      </div>
                    </div>
                    {/* Psychosocial */}
                    <div style={{ background:"#f8fafc", borderRadius:10, padding:"12px 14px", border:`1px solid ${C.border}` }}>
                      <div style={{ fontSize:11, fontWeight:700, color:C.muted, textTransform:"uppercase", letterSpacing:".6px", marginBottom:10 }}>Psychosocial & Discharge Planning</div>
                      <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8 }}>
                        {[
                          {k:"anxiety",l:"Anxiety",opts:["None","Mild","Moderate","Severe"]},
                          {k:"cognition",l:"Cognition",opts:["Intact","Mild Impairment","Moderate Impairment","Severe"]},
                          {k:"painLevel",l:"Pain Score (0-10)",opts:["0","1","2","3","4","5","6","7","8","9","10"]},
                          {k:"sleepPattern",l:"Sleep Pattern",opts:["Normal","Disturbed","Insomnia","Excessive"]},
                          {k:"communication",l:"Communication",opts:["Verbal","Written","Non-verbal","Interpreter needed"]},
                          {k:"dischargePlan",l:"Planned Discharge To",opts:["Home","Rehab","SNF","Transfer","Unknown"]},
                        ].map(f=>(
                          <FL key={f.k} label={f.l}>
                            <select style={sel} value={initialAssess[f.k]} onChange={e=>setInitialAssess(p=>({...p,[f.k]:e.target.value}))}>
                              {f.opts.map(o=><option key={o}>{o}</option>)}
                            </select>
                          </FL>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* ── Care Plan (NABH COP.8) ── */}
              {activeModal === "careplan" && (() => {
                const QUICK_TEMPLATES = [
                  { statement:"Impaired gas exchange", relatedTo:"respiratory disease", interventions:"O₂ therapy, position, breathing exercises" },
                  { statement:"Risk for pressure injury", relatedTo:"immobility", interventions:"Reposition 2-hourly, barrier cream, Braden monitoring" },
                  { statement:"Acute pain", relatedTo:"surgical intervention", interventions:"Analgesics as ordered, non-pharmacological pain relief, reassess q4h" },
                  { statement:"Risk for falls", relatedTo:"weakness/altered gait", interventions:"Bed rails up, call bell within reach, non-slip footwear, supervision" },
                  { statement:"Imbalanced nutrition (less than requirements)", relatedTo:"decreased appetite", interventions:"Diet monitoring, encourage intake, dietitian referral" },
                  { statement:"Fluid volume deficit", relatedTo:"vomiting/diarrhoea", interventions:"IV fluids as ordered, I/O monitoring, daily weight" },
                  { statement:"Risk for infection", relatedTo:"invasive device/surgery", interventions:"Sterile technique, site monitoring, hand hygiene" },
                  { statement:"Deficient knowledge", relatedTo:"new diagnosis", interventions:"Patient education on condition, medications, follow-up care" },
                ];
                const addProblem = () => setCarePlan(p=>({ problems:[...p.problems,{ id:Date.now(), statement:"", relatedTo:"", evidencedBy:"", priority:"High", goals:"", targetDate:"", interventions:"", evaluation:"", status:"Active" }] }));
                const removeProblem = (id) => setCarePlan(p=>({ problems: p.problems.filter(pr=>pr.id!==id) }));
                const updateProblem = (id,field,val) => setCarePlan(p=>({ problems: p.problems.map(pr=>pr.id===id?{...pr,[field]:val}:pr) }));
                const applyTemplate = (tpl) => setCarePlan(p=>({ problems:[...p.problems,{ id:Date.now(), statement:tpl.statement, relatedTo:tpl.relatedTo, evidencedBy:"", priority:"High", goals:"Patient will improve within 24-48 hrs", targetDate:"", interventions:tpl.interventions, evaluation:"", status:"Active" }] }));
                return (
                  <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
                    {/* Quick templates */}
                    <div style={{ background:"#f8fafc", borderRadius:10, padding:"12px 14px", border:`1px solid ${C.border}` }}>
                      <div style={{ fontSize:11, fontWeight:700, color:C.muted, textTransform:"uppercase", letterSpacing:".6px", marginBottom:8 }}>Quick Templates</div>
                      <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                        {QUICK_TEMPLATES.map((tpl,i)=>(
                          <button key={i} onClick={()=>applyTemplate(tpl)}
                            style={{ padding:"4px 10px", borderRadius:6, border:`1.5px solid #6ee7b7`, background:"white", color:"#065f46", fontSize:11, fontWeight:600, cursor:"pointer" }}
                            onMouseEnter={e=>{e.currentTarget.style.background="#ecfdf5"}} onMouseLeave={e=>{e.currentTarget.style.background="white"}}>
                            + {tpl.statement}
                          </button>
                        ))}
                      </div>
                    </div>
                    {/* Problems */}
                    {carePlan.problems.map((prob,idx)=>(
                      <div key={prob.id} style={{ background:"white", border:`1.5px solid ${C.border}`, borderRadius:10, padding:"14px 16px" }}>
                        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
                          <div style={{ fontSize:12, fontWeight:700, color:C.text }}>Problem #{idx+1}</div>
                          <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                            <select style={{...sel,maxWidth:100,fontSize:11,padding:"4px 8px"}} value={prob.priority} onChange={e=>updateProblem(prob.id,"priority",e.target.value)}>
                              {["High","Medium","Low"].map(o=><option key={o}>{o}</option>)}
                            </select>
                            <select style={{...sel,maxWidth:100,fontSize:11,padding:"4px 8px"}} value={prob.status} onChange={e=>updateProblem(prob.id,"status",e.target.value)}>
                              {["Active","Resolved","On Hold"].map(o=><option key={o}>{o}</option>)}
                            </select>
                            {carePlan.problems.length > 1 && (
                              <button onClick={()=>removeProblem(prob.id)} style={{ width:24, height:24, borderRadius:6, border:`1px solid #fca5a5`, background:C.redL, color:C.red, cursor:"pointer", fontSize:14, display:"flex", alignItems:"center", justifyContent:"center" }}>×</button>
                            )}
                          </div>
                        </div>
                        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                          <FL label="Problem Statement"><input style={fld} value={prob.statement} placeholder="e.g. Impaired gas exchange" onChange={e=>updateProblem(prob.id,"statement",e.target.value)} /></FL>
                          <FL label="Related To"><input style={fld} value={prob.relatedTo} placeholder="Underlying cause" onChange={e=>updateProblem(prob.id,"relatedTo",e.target.value)} /></FL>
                          <FL label="Evidenced By"><input style={fld} value={prob.evidencedBy} placeholder="Signs / symptoms" onChange={e=>updateProblem(prob.id,"evidencedBy",e.target.value)} /></FL>
                          <FL label="Target Date"><input type="date" style={fld} value={prob.targetDate} onChange={e=>updateProblem(prob.id,"targetDate",e.target.value)} /></FL>
                        </div>
                        <div style={{ marginTop:8, display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                          <FL label="Goals / Expected Outcomes"><textarea style={{...ta,minHeight:48}} value={prob.goals} placeholder="Patient will..." onChange={e=>updateProblem(prob.id,"goals",e.target.value)} /></FL>
                          <FL label="Nursing Interventions"><textarea style={{...ta,minHeight:48}} value={prob.interventions} placeholder="Actions to take..." onChange={e=>updateProblem(prob.id,"interventions",e.target.value)} /></FL>
                        </div>
                        <div style={{ marginTop:8 }}>
                          <FL label="Evaluation / Patient Response"><textarea style={{...ta,minHeight:40}} value={prob.evaluation} placeholder="Goal met / partially met / not met..." onChange={e=>updateProblem(prob.id,"evaluation",e.target.value)} /></FL>
                        </div>
                      </div>
                    ))}
                    <button onClick={addProblem}
                      style={{ padding:"9px 20px", border:`1.5px dashed #6ee7b7`, borderRadius:9, background:"#f0fdf4", color:"#065f46", fontFamily:"'DM Sans',sans-serif", fontSize:13, fontWeight:700, cursor:"pointer", display:"flex", alignItems:"center", gap:7, justifyContent:"center" }}>
                      <i className="pi pi-plus" style={{ fontSize:12 }} /> Add Another Problem
                    </button>
                  </div>
                );
              })()}

              {/* ── Nutritional Assessment (NRS-2002, NABH) ── */}
              {activeModal === "nutrition" && (() => {
                const nrsTotal = Number(nutrition.nutritionScore||0) + Number(nutrition.diseaseScore||0) + (nutrition.ageScore ? 1 : 0);
                const nrsBand = nrsTotal >= 3 ? { label:"At Risk — Dietitian Referral Recommended", color:C.red, bg:C.redL } : nrsTotal >= 1 ? { label:"Borderline — Monitor Closely", color:C.amber, bg:C.amberL } : { label:"Not At Risk — Reassess Weekly", color:C.green, bg:C.greenL };
                const preScreenFailed = nutrition.bmiLow || nutrition.weightLoss || nutrition.reducedIntake || nutrition.seriouslyIll;
                return (
                  <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
                    {/* NRS-2002 Pre-screening */}
                    <div style={{ background:"#f8fafc", borderRadius:10, padding:"12px 14px", border:`1px solid ${C.border}` }}>
                      <div style={{ fontSize:11, fontWeight:700, color:C.muted, textTransform:"uppercase", letterSpacing:".6px", marginBottom:10 }}>NRS-2002 Pre-screening</div>
                      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                        {[
                          {k:"bmiLow",l:"BMI < 20.5 kg/m²"},
                          {k:"weightLoss",l:"Weight lost in past 3 months"},
                          {k:"reducedIntake",l:"Food intake reduced in past week"},
                          {k:"seriouslyIll",l:"Patient is seriously ill / ICU"},
                        ].map(f=>(
                          <label key={f.k} style={{ display:"flex", alignItems:"center", gap:7, fontSize:12, fontWeight:500, cursor:"pointer", padding:"6px 10px", borderRadius:7, background:nutrition[f.k]?C.amberL:"white", border:`1px solid ${nutrition[f.k]?C.amber:C.border}`, color:nutrition[f.k]?"#92400e":C.text }}>
                            <input type="checkbox" checked={nutrition[f.k]} onChange={e=>setNutrition(p=>({...p,[f.k]:e.target.checked}))} style={{ accentColor:C.amber, width:14, height:14 }} />
                            {f.l}
                          </label>
                        ))}
                      </div>
                      {!preScreenFailed && (
                        <div style={{ marginTop:10, padding:"8px 12px", background:C.greenL, borderRadius:7, fontSize:12, fontWeight:600, color:C.green }}>
                          <i className="pi pi-check-circle" style={{ marginRight:6, fontSize:12 }} />Pre-screening negative — no nutritional risk detected
                        </div>
                      )}
                    </div>
                    {/* NRS-2002 Full scoring */}
                    {preScreenFailed && (
                      <div style={{ background:"#f8fafc", borderRadius:10, padding:"12px 14px", border:`1.5px solid ${C.amber}30` }}>
                        <div style={{ fontSize:11, fontWeight:700, color:C.muted, textTransform:"uppercase", letterSpacing:".6px", marginBottom:10 }}>NRS-2002 Full Scoring</div>
                        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                          <FL label="Nutritional Status Score">
                            <select style={sel} value={nutrition.nutritionScore} onChange={e=>setNutrition(p=>({...p,nutritionScore:e.target.value}))}>
                              <option value="0">0 — Normal nutritional status</option>
                              <option value="1">1 — Weight loss &gt;5% in 3 months / intake 50-75% of requirement</option>
                              <option value="2">2 — Weight loss &gt;5% in 2 months / BMI 18.5-20.5 + impaired condition</option>
                              <option value="3">3 — Weight loss &gt;5% in 1 month / BMI &lt;18.5 + impaired condition</option>
                            </select>
                          </FL>
                          <FL label="Disease Severity Score">
                            <select style={sel} value={nutrition.diseaseScore} onChange={e=>setNutrition(p=>({...p,diseaseScore:e.target.value}))}>
                              <option value="0">0 — Normal requirements</option>
                              <option value="1">1 — Hip fracture, chronic illness (COPD, DM, dialysis, cancer)</option>
                              <option value="2">2 — Major abdominal surgery, stroke, severe pneumonia, haematology</option>
                              <option value="3">3 — Head injury, bone marrow transplant, ICU (APACHE &gt;10)</option>
                            </select>
                          </FL>
                        </div>
                        <label style={{ display:"flex", alignItems:"center", gap:7, marginTop:10, fontSize:12, fontWeight:500, cursor:"pointer" }}>
                          <input type="checkbox" checked={nutrition.ageScore} onChange={e=>setNutrition(p=>({...p,ageScore:e.target.checked}))} style={{ accentColor:C.amber, width:14, height:14 }} />
                          Age ≥ 70 years (+1 point)
                        </label>
                        <div style={{ marginTop:12, padding:"10px 14px", background:nrsBand.bg, borderRadius:8, fontWeight:700, color:nrsBand.color, fontSize:13 }}>
                          NRS-2002 Total: {nrsTotal} — {nrsBand.label}
                        </div>
                      </div>
                    )}
                    {/* Anthropometrics */}
                    <div style={{ background:"#f8fafc", borderRadius:10, padding:"12px 14px", border:`1px solid ${C.border}` }}>
                      <div style={{ fontSize:11, fontWeight:700, color:C.muted, textTransform:"uppercase", letterSpacing:".6px", marginBottom:10 }}>Anthropometrics & Intake</div>
                      <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8 }}>
                        {[{k:"weight",l:"Weight (kg)",ph:"60"},{k:"height",l:"Height (cm)",ph:"165"},{k:"midArmCirc",l:"Mid-Arm Circ. (cm)",ph:"28"},{k:"caloriesToday",l:"Calories Today (kcal)",ph:"1800"},{k:"proteinToday",l:"Protein (g)",ph:"60"},{k:"fluidToday",l:"Fluid Intake (ml)",ph:"2000"}].map(f=>(
                          <FL key={f.k} label={f.l}>
                            <input type="number" style={fld} value={nutrition[f.k]} placeholder={f.ph} onChange={e=>setNutrition(p=>({...p,[f.k]:e.target.value}))} />
                          </FL>
                        ))}
                      </div>
                    </div>
                    {/* Diet & Feeding */}
                    <div style={{ background:"#f8fafc", borderRadius:10, padding:"12px 14px", border:`1px solid ${C.border}` }}>
                      <div style={{ fontSize:11, fontWeight:700, color:C.muted, textTransform:"uppercase", letterSpacing:".6px", marginBottom:10 }}>Diet & Feeding</div>
                      <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8 }}>
                        <FL label="Diet Type">
                          <select style={sel} value={nutrition.dietType} onChange={e=>setNutrition(p=>({...p,dietType:e.target.value}))}>
                            {["Regular","Soft","Semi-solid","Liquid","Clear Liquid","NPO","Diabetic","Low-sodium","Renal Diet","Cardiac Diet"].map(o=><option key={o}>{o}</option>)}
                          </select>
                        </FL>
                        <FL label="Appetite">
                          <select style={sel} value={nutrition.appetite} onChange={e=>setNutrition(p=>({...p,appetite:e.target.value}))}>
                            {["Good","Fair","Poor","Anorexic"].map(o=><option key={o}>{o}</option>)}
                          </select>
                        </FL>
                        <FL label="Swallowing">
                          <select style={sel} value={nutrition.swallowing} onChange={e=>setNutrition(p=>({...p,swallowing:e.target.value}))}>
                            {["Normal","Dysphagia — Mild","Dysphagia — Moderate","Dysphagia — Severe","NPO"].map(o=><option key={o}>{o}</option>)}
                          </select>
                        </FL>
                        <FL label="Feeding Mode">
                          <select style={sel} value={nutrition.feedingMode} onChange={e=>setNutrition(p=>({...p,feedingMode:e.target.value}))}>
                            {["Oral","NGT","PEG","TPN","Combination"].map(o=><option key={o}>{o}</option>)}
                          </select>
                        </FL>
                      </div>
                      <label style={{ display:"flex", alignItems:"center", gap:7, marginTop:10, fontSize:12, fontWeight:600, cursor:"pointer", color:nutrition.dietitianReferral?C.primary:C.muted }}>
                        <input type="checkbox" checked={nutrition.dietitianReferral} onChange={e=>setNutrition(p=>({...p,dietitianReferral:e.target.checked}))} style={{ accentColor:C.primary, width:14, height:14 }} />
                        Refer to Dietitian
                      </label>
                      {nutrition.dietitianReferral && (
                        <FL label="Reason for Referral" style={{ marginTop:8 }}>
                          <textarea style={{...ta,minHeight:48}} value={nutrition.referralReason} placeholder="Reason..." onChange={e=>setNutrition(p=>({...p,referralReason:e.target.value}))} />
                        </FL>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* ── Patient Education (NABH MOM.4) ── */}
              {activeModal === "education" && (() => {
                const ALL_TOPICS = ["Disease Process","Medications","Diet & Nutrition","Activity Restrictions","Wound Care","Infection Prevention","Pain Management","Fall Prevention","Equipment Use","Warning Signs","Follow-up Care","When to Seek Help","Discharge Instructions","Lifestyle Modification"];
                const ALL_METHODS = ["Verbal","Demonstration","Pamphlet/Leaflet","Video","Return Demonstration","Group Education"];
                const ALL_BARRIERS = ["Language","Low Literacy","Hearing Impairment","Vision Impairment","Cognitive Impairment","Anxiety","Cultural Beliefs","Denial","Pain","None"];
                const toggle = (field, val) => setEducation(p => ({ ...p, [field]: p[field].includes(val) ? p[field].filter(x=>x!==val) : [...p[field], val] }));
                return (
                  <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10 }}>
                      <FL label="Date">
                        <input type="date" style={fld} value={education.date} onChange={e=>setEducation(p=>({...p,date:e.target.value}))} />
                      </FL>
                      <FL label="Educator Name">
                        <input style={fld} value={education.educator} placeholder="Nurse name" onChange={e=>setEducation(p=>({...p,educator:e.target.value}))} />
                      </FL>
                      <FL label="Language of Education">
                        <select style={sel} value={education.language} onChange={e=>setEducation(p=>({...p,language:e.target.value}))}>
                          {["Hindi","English","Marathi","Bengali","Tamil","Telugu","Gujarati","Punjabi","Other"].map(o=><option key={o}>{o}</option>)}
                        </select>
                      </FL>
                    </div>
                    {/* Topics */}
                    <div style={{ background:"#f8fafc", borderRadius:10, padding:"12px 14px", border:`1px solid ${C.border}` }}>
                      <div style={{ fontSize:11, fontWeight:700, color:C.muted, textTransform:"uppercase", letterSpacing:".6px", marginBottom:8 }}>Topics Covered</div>
                      <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                        {ALL_TOPICS.map(t=>{
                          const sel2 = education.topics.includes(t);
                          return (
                            <button key={t} onClick={()=>toggle("topics",t)}
                              style={{ padding:"4px 10px", borderRadius:5, fontSize:11, fontWeight:600, cursor:"pointer", border:`1.5px solid ${sel2?"#8b5cf6":C.border}`, background:sel2?"#f5f3ff":"white", color:sel2?"#6d28d9":C.muted, transition:"all .15s" }}>
                              {sel2 && <i className="pi pi-check" style={{ fontSize:9, marginRight:4 }} />}{t}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    {/* Methods */}
                    <div style={{ background:"#f8fafc", borderRadius:10, padding:"12px 14px", border:`1px solid ${C.border}` }}>
                      <div style={{ fontSize:11, fontWeight:700, color:C.muted, textTransform:"uppercase", letterSpacing:".6px", marginBottom:8 }}>Teaching Methods</div>
                      <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                        {ALL_METHODS.map(t=>{
                          const sel2 = education.methods.includes(t);
                          return (
                            <button key={t} onClick={()=>toggle("methods",t)}
                              style={{ padding:"4px 10px", borderRadius:5, fontSize:11, fontWeight:600, cursor:"pointer", border:`1.5px solid ${sel2?"#8b5cf6":C.border}`, background:sel2?"#f5f3ff":"white", color:sel2?"#6d28d9":C.muted, transition:"all .15s" }}>
                              {sel2 && <i className="pi pi-check" style={{ fontSize:9, marginRight:4 }} />}{t}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    {/* Understanding & Response */}
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                      <FL label="Level of Understanding">
                        <select style={sel} value={education.understanding} onChange={e=>setEducation(p=>({...p,understanding:e.target.value}))}>
                          {["Excellent","Good","Fair","Poor","Unable to Assess"].map(o=><option key={o}>{o}</option>)}
                        </select>
                      </FL>
                      <FL label="Patient Response">
                        <select style={sel} value={education.response} onChange={e=>setEducation(p=>({...p,response:e.target.value}))}>
                          {["Positive","Cooperative","Anxious","Resistant","Indifferent"].map(o=><option key={o}>{o}</option>)}
                        </select>
                      </FL>
                    </div>
                    {/* Barriers */}
                    <div style={{ background:"#f8fafc", borderRadius:10, padding:"12px 14px", border:`1px solid ${C.border}` }}>
                      <div style={{ fontSize:11, fontWeight:700, color:C.muted, textTransform:"uppercase", letterSpacing:".6px", marginBottom:8 }}>Learning Barriers</div>
                      <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                        {ALL_BARRIERS.map(t=>{
                          const sel2 = education.barriers.includes(t);
                          return (
                            <button key={t} onClick={()=>toggle("barriers",t)}
                              style={{ padding:"4px 10px", borderRadius:5, fontSize:11, fontWeight:600, cursor:"pointer", border:`1.5px solid ${sel2?C.orange:C.border}`, background:sel2?C.orangeL:"white", color:sel2?C.orange:C.muted, transition:"all .15s" }}>
                              {sel2 && <i className="pi pi-check" style={{ fontSize:9, marginRight:4 }} />}{t}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <FL label="Session Notes">
                      <textarea style={{...ta,minHeight:56}} value={education.sessionNotes} placeholder="Additional observations, patient questions answered..." onChange={e=>setEducation(p=>({...p,sessionNotes:e.target.value}))} />
                    </FL>
                    <FL label="Next Education Session Date">
                      <input type="date" style={{...fld,maxWidth:200}} value={education.nextSessionDate} onChange={e=>setEducation(p=>({...p,nextSessionDate:e.target.value}))} />
                    </FL>
                  </div>
                );
              })()}

              {/* ── Common: Notes + Tags ── */}
              <div style={{ marginTop: 16 }}>
                <label style={lbl}>Nursing Notes / Observations</label>
                <textarea style={{ ...ta, minHeight: 88 }} value={noteText}
                  onChange={e => setNoteText(e.target.value)}
                  placeholder="Document clinical observations, actions taken, patient response\u2026" />
              </div>

              {/* ── Quick Tags ── */}
              {MODULE_TAGS[activeModal]?.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div style={lbl}>Quick Tags</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {MODULE_TAGS[activeModal].map(t => (
                      <button key={t} onClick={() => toggleTag(t)}
                        style={{ padding: "4px 10px", borderRadius: 5, fontSize: 11, fontWeight: 600, cursor: "pointer", border: `1.5px solid ${selectedTags.includes(t) ? C.primary : C.border}`, background: selectedTags.includes(t) ? C.primaryL : "white", color: selectedTags.includes(t) ? C.primary : C.muted, transition: "all .15s" }}>
                        {selectedTags.includes(t) && <i className="pi pi-check" style={{ fontSize: 9, marginRight: 4 }} />}
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Critical Event ── */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, padding: "10px 14px", background: C.redL, border: `1.5px solid #fca5a5`, borderRadius: 8 }}>
                <input type="checkbox" id="criticalEvt" checked={isCritical} onChange={e => setIsCritical(e.target.checked)}
                  style={{ accentColor: C.red, width: 16, height: 16 }} />
                <label htmlFor="criticalEvt" style={{ fontSize: 13, fontWeight: 600, color: C.red, cursor: "pointer" }}>
                  <i className="pi pi-exclamation-triangle" style={{ marginRight: 5, fontSize: 12 }} />
                  Mark as Critical Event &mdash; will alert doctor
                </label>
              </div>
            </div>

            {/* Modal footer */}
            <div style={{ padding: "14px 22px", borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", background: C.bg, borderRadius: "0 0 16px 16px", position: "sticky", bottom: 0 }}>
              <div style={{ fontSize: 11, color: C.muted, display: "flex", alignItems: "center", gap: 5 }}>
                <i className="pi pi-clock" style={{ fontSize: 10 }} />
                {new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })} &middot;{" "}
                <span style={{ ...SHIFT_STYLE[shift], padding: "1px 7px", borderRadius: 4, fontSize: 10, fontWeight: 700 }}>
                  {shift.charAt(0).toUpperCase() + shift.slice(1)}
                </span>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setActiveModal(null)}
                  style={{ padding: "9px 20px", border: `1.5px solid ${C.border}`, borderRadius: 8, background: "white", fontFamily: "'DM Sans',sans-serif", fontSize: 13, fontWeight: 600, cursor: "pointer", color: C.muted }}>
                  Cancel
                </button>
                <button onClick={saveNote} disabled={loading}
                  style={{ padding: "9px 28px", background: loading ? "#5eead4" : `linear-gradient(135deg, ${C.primary}, ${C.primaryMid})`, color: "white", border: "none", borderRadius: 8, fontFamily: "'DM Sans',sans-serif", fontSize: 13, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: 7, boxShadow: `0 4px 12px ${C.primary}35` }}>
                  <i className={`pi ${loading ? "pi-spin pi-spinner" : "pi-check"}`} style={{ fontSize: 12 }} />
                  {loading ? "Saving\u2026" : "Sign & Submit"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Digital Signature Setup Modal ── */}
      {showSetup && (
        <SignaturePad
          existing={signature}
          userName={user?.fullName || `${user?.firstName || ""} ${user?.lastName || ""}`.trim()}
          onSave={async (dataUrl) => {
            await saveSignature(dataUrl);
            setShowSetup(false);
            toast.success("Signature saved — auto-embedded in all notes you submit");
          }}
          onCancel={() => setShowSetup(false)}
        />
      )}

      {/* ── Nursing Patient Report (Print / PDF for insurance) ── */}
      {showReport && patient && (
        <NursingPatientReport
          ipdNo={patient.ipdNo || patient.admissionNumber || patient._id}
          patientName={patient.patientName || patient.patientId?.fullName || searchUHID}
          patientUHID={patient.uhid || patient.UHID || searchUHID}
          patientInfo={{
            age: patient.age || patient.patientId?.age,
            gender: patient.gender || patient.patientId?.gender,
            ward: patient.wardName,
            bed: patient.bedNumber,
            admissionDate: patient.admissionDate,
            diagnosis: patient.diagnosis || patient.admittingDiagnosis,
            consultant: patient.doctorName || patient.consultantName,
            bloodGroup: patient.bloodGroup,
          }}
          hospitalName="SphereHealth Hospital"
          onClose={() => setShowReport(false)}
        />
      )}
    </div>
  );
}

export default function NursingNotes() {
  const [selectedPatient, setSelectedPatient] = useState(null);
  return (
    <ClinicalLayout onPatientSelect={setSelectedPatient} selectedId={selectedPatient?._id} pageType="nursing-notes">
      <NursingNotesContent selectedPatient={selectedPatient} />
    </ClinicalLayout>
  );
}
