import React, { useState, useEffect } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { API_ENDPOINTS } from "../../config/api";
import { useAuth } from "../../context/AuthContext";
import { toast } from "react-toastify";
import ClinicalLayout from "../../Components/clinical/ClinicalLayout";
import { DoctorAssessmentContent } from "./DoctorAssessmentPage";
import DoctorOrdersPanel from "../../Components/doctor/DoctorOrdersPanel";
import TreatmentChart from "../../Components/clinical/TreatmentChart";
import TreatmentTeamPanel from "../../Components/clinical/TreatmentTeamPanel";
import { useAutoSave } from "../../hooks/useAutoSave";
import { useDigitalSignature } from "../../hooks/useDigitalSignature";
import AutoSaveIndicator from "../../Components/signature/AutoSaveIndicator";
import SignaturePad from "../../Components/signature/SignaturePad";

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

/* ── NABH Medication Routes & Frequencies (from Medication Order Sheet) ── */
const ROUTES = [
  "IV","IV Infusion","IV Bolus","IM","SC","ID","PO","SL","Buccal","NG Tube","PEG Tube",
  "Inhalation","Nebulization","Topical","Transdermal","Ophthalmic","Otic","Nasal","PR","PV",
  "Intra-arterial","Intraosseous","Intrathecal","Epidural","Intraperitoneal","Intrapleural","Intra-articular",
];
const FREQ_TIMES = {
  "OD":         ["08:00"],
  "BD":         ["08:00","20:00"],
  "TDS":        ["08:00","14:00","20:00"],
  "QID":        ["06:00","12:00","18:00","00:00"],
  "Q4H":        ["06:00","10:00","14:00","18:00","22:00","02:00"],
  "Q6H":        ["06:00","12:00","18:00","00:00"],
  "Q8H":        ["06:00","14:00","22:00"],
  "Q12H":       ["08:00","20:00"],
  "STAT":       ["Immediate"],
  "SOS":        ["As Needed"],
  "HS":         ["22:00"],
  "Before Food":["Before Meals"],
  "After Food": ["After Meals"],
  "Weekly":     ["Once Weekly"],
  "Continuous": ["Continuous Infusion"],
};
const FREQ_LIST = Object.keys(FREQ_TIMES);

const emptyMedRow  = () => ({ id: Date.now() + Math.random(), datetime: new Date().toISOString().slice(0,16), drug:"", dose:"", route:"PO", frequency:"OD", priority:"Routine", hamOverride:false, indication:"", status:"Active", stopReason:"" });
const emptyInfRow  = () => ({ id: Date.now() + Math.random(), datetime: new Date().toISOString().slice(0,16), type:"Fluid", drugFluid:"", dilution:"", volume:"", rate:"", titrationGoal:"", startTime:"", priority:"Routine", hamOverride:false, status:"Active", stopReason:"" });

/* ── NABH HAM auto-detection (for IA medication / infusion builder) ── */
const HAM_KW_IA = [
  "insulin","heparin","enoxaparin","fondaparinux","warfarin","acenocoumarol","digoxin","amiodarone",
  "kcl","potassium chloride","magnesium sulphate","mgso4","calcium chloride","nacl 3%","hypertonic saline",
  "dextrose 25%","dextrose 50%","d50","d25",
  "morphine","fentanyl","pethidine","tramadol iv","oxycodone",
  "noradrenaline","norepinephrine","adrenaline","epinephrine",
  "dopamine","dobutamine","vasopressin","milrinone","levosimendan",
  "suxamethonium","succinylcholine","vecuronium","rocuronium","atracurium",
  "streptokinase","alteplase","tenecteplase","methotrexate","cyclophosphamide","cisplatin","vincristine",
  "oxytocin","nitroprusside","ketamine","propofol","midazolam iv","phenytoin iv",
  "vancomycin iv","gentamicin iv","amikacin iv",
];
const isHAM_IA = (name = "") => HAM_KW_IA.some(k => (name || "").toLowerCase().includes(k));

/* ── NABH Note Modules ── */
const MODULES = [
  // ── Priority top row ──
  { id: "initial",     label: "Initial Assessment",    icon: "pi-clipboard",           border: "#fbbf24", color: "#92400e", bg: "#fffbeb", priority: true },
  { id: "medication",  label: "Medication Orders",     icon: "pi-tablet",              border: "#93c5fd", color: C.blue,   bg: C.blueL   },
  { id: "infusion",    label: "Infusion Orders",       icon: "pi-plus-circle",         border: "#99f6e4", color: C.teal,   bg: C.tealL   },
  // ── Notes ──
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
  initial:      { bg: "#fffbeb", color: "#92400e", dot: "#f59e0b" },
  medication:   { bg: C.blueL,  color: C.blue,   dot: C.blue   },
  infusion:     { bg: C.tealL,  color: C.teal,   dot: C.teal   },
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
  initial:      ["Initial Assessment Complete", "Braden Scored", "Morse Scored", "Allergies Documented", "Care Plan Initiated"],
  medication:   ["STAT Order", "New Medication", "Dose Changed", "Medication Stopped", "Allergy Checked"],
  infusion:     ["IV Access Confirmed", "Infusion Started", "Rate Changed", "Infusion Stopped", "Monitoring Active"],
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
  const navigate = useNavigate();
  const [showAssessmentModal, setShowAssessmentModal] = useState(false);

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
  const [ordersRefresh, setOrdersRefresh] = useState(0);
  const [expandedNotes, setExpandedNotes] = useState({});
  const [timelineRefresh, setTimelineRefresh] = useState(0);
  const [filterDate,    setFilterDate]    = useState("");   // "" | "today" | "week" | "last7"
  const [editingNote,   setEditingNote]   = useState(null); // draft note being edited

  /* ── Recently admitted patients panel ── */
  const [recentPatients,   setRecentPatients]   = useState([]);
  const [consultPatients,  setConsultPatients]  = useState([]);  // admissions where I am consulting
  const [recentLoading,    setRecentLoading]    = useState(false);
  const [recentSearch,     setRecentSearch]     = useState("");
  const [patientListTab,   setPatientListTab]   = useState("primary");  // "primary" | "consulting"

  /* ── Assessment gate ──
       Uses the admission's initialAssessment.doctorCompleted flag.
       Until the doctor signs the initial assessment, all other note
       types are locked. The "initial" module tile is always accessible.
  ── */
  const assessmentDone = patient?.initialAssessment?.doctorCompleted === true;
  const gateActive = !!patient && !assessmentDone;

  /* ── NABH Medication Order Sheet state ── */
  const [medOrders,  setMedOrders]  = useState([emptyMedRow()]);
  /* ── NABH Infusion Order Sheet state ── */
  const [infOrders,  setInfOrders]  = useState([emptyInfRow()]);

  /* ── Initial Assessment form state ── */
  const [initAssess, setInitAssess] = useState({
    // Admission
    admissionMode:"Planned", chiefComplaint:"", duration:"", hpi:"",
    // Past history
    pastMedical:"", pastSurgical:"", familyHistory:"", socialHistory:"", currentMeds:"", allergies:"NKDA",
    // Vitals on admission
    bp_sys:"", bp_dia:"", pulse:"", temp:"", spo2:"", rr:"", weight:"", height:"", bsl:"",
    // Examination
    generalCondition:"Conscious & Oriented", builtNutrition:"Average", pallor:"Absent", icterus:"Absent", cyanosis:"Absent", clubbing:"Absent", lymphadenopathy:"Absent", oedema:"Absent",
    // Systems
    resp:"Normal vesicular breath sounds bilaterally", cvs:"S1 S2 heard, no murmur", abdomen:"Soft, non-tender, no organomegaly", cns:"Conscious, oriented to time place person",
    // Diagnosis
    provisionalDx:"", differentialDx:"", finalDx:"", icd10:"",
    // Plan
    investigations:"", managementPlan:"",
  });

  /* Doctor info from auth */
  const doctorName = user?.fullName || `${user?.firstName || ""} ${user?.lastName || ""}`.trim() || "Dr. —";
  const doctorRegNo = user?.doctorDetails?.registrationNumber || user?.registrationNumber || "";
  const doctorId = user?.id || user?._id || "000000000000000000000001";

  /* Auto-populate UHID from sidebar patient selection */
  useEffect(() => {
    if (selectedPatient?.UHID) setSearchUHID(selectedPatient.UHID);
  }, [selectedPatient]);

  /* Fetch patients on mount — primary IPD list + consulting list */
  useEffect(() => {
    (async () => {
      setRecentLoading(true);
      try {
        // Try to load role-specific team patients first
        const teamRes = await axios.get(`${API_ENDPOINTS.ADMISSIONS}/my-team-patients`).catch(() => null);
        if (teamRes?.data?.success) {
          const { asPrimary = [], asConsulting = [] } = teamRes.data.data;
          setRecentPatients(asPrimary.sort((a, b) => new Date(b.admissionDate || b.createdAt) - new Date(a.admissionDate || a.createdAt)));
          setConsultPatients(asConsulting);
        } else {
          // Fallback: all active admissions (for Admin or unauthenticated)
          const { data } = await axios.get(`${API_ENDPOINTS.ADMISSIONS}/active`);
          const arr = Array.isArray(data) ? data : (data.data || []);
          setRecentPatients(arr.sort((a, b) => new Date(b.admissionDate || b.createdAt) - new Date(a.admissionDate || a.createdAt)));
        }
      } catch { /* silent */ }
      finally { setRecentLoading(false); }
    })();
  }, []);

  /* ── Module form state ── */
  const initSoap = () => ({ subjective: "", objective: "", assessment: "", plan: "" });
  const initVitals = () => ({ bp_sys: "", bp_dia: "", pulse: "", temp: "", spo2: "", rr: "", bsl: "", gcs: "", urine: "" });

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

  /* ── Auto-save draft ── */
  const draftKey = patient?._id ? `sphere_draft_docnotes_${patient._id}` : null;
  const { savedAt, hasDraft, loadDraft, clearDraft } = useAutoSave(
    draftKey,
    { soap, vitals, diag, invx, orders, icu, proc, consult, preop, postop, death, amendment, initAssess, medOrders, infOrders, selectedTags, isCritical, shift },
    2000
  );
  const { signature, showSetup, setShowSetup, saveSignature } = useDigitalSignature();

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
        // Restore auto-save draft if available for this patient
        const dKey = `sphere_draft_docnotes_${active._id}`;
        const raw = localStorage.getItem(dKey);
        if (raw) {
          try {
            const { data } = JSON.parse(raw);
            if (data) {
              if (data.soap)       setSoap(data.soap);
              if (data.vitals)     setVitals(data.vitals);
              if (data.diag)       setDiag(data.diag);
              if (data.invx !== undefined) setInvx(data.invx);
              if (data.orders)     setOrders(data.orders);
              if (data.icu)        setIcu(data.icu);
              if (data.proc)       setProc(data.proc);
              if (data.consult)    setConsult(data.consult);
              if (data.preop)      setPreop(data.preop);
              if (data.postop)     setPostop(data.postop);
              if (data.death)      setDeath(data.death);
              if (data.amendment)  setAmendment(data.amendment);
              if (data.initAssess) setInitAssess(data.initAssess);
              if (data.medOrders)  setMedOrders(data.medOrders);
              if (data.infOrders)  setInfOrders(data.infOrders);
              if (data.selectedTags) setSelectedTags(data.selectedTags);
              toast.info("Draft restored", { autoClose: 2000 });
            }
          } catch { /* ignore */ }
        }
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
    // Initial assessment always opens the new DoctorAssessmentContent modal
    if (id === "initial") {
      setShowAssessmentModal(true);
      return;
    }
    // Workflow gate: if new admission and initial not done, block other notes
    if (gateActive) {
      toast.warn("⚠ Initial Assessment must be completed and signed before adding other notes", { autoClose: 4000 });
      setShowAssessmentModal(true);
      return;
    }
    setActiveModal(id);
    setSelectedTags([]); setIsCritical(false); setShowOrderRow(false);
    setSoap(initSoap()); setVitals(initVitals());
    setDiag({ provisional: "", final: "", icd10: "", status: "Stable" });
    setInvx(""); setOrders([]);
    setOrderRow({ type: "medication", instruction: "", dose: "", route: "Oral", frequency: "TDS", duration: "3 days", notes: "", priority: "ROUTINE" });
    if (id === "medication") setMedOrders([emptyMedRow()]);
    if (id === "infusion")   setInfOrders([emptyInfRow()]);
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
      doctorId: doctorId,   // backend key
      doctorName, doctorRegNo,
      shift, status,
      ...(status === "signed" && signature ? { signature, signedByName: doctorName, signedByReg: doctorRegNo } : {}),
      soap,
      vitals: Object.values(vitals).some(v => v) ? {
        ...((vitals.bp_sys || vitals.bp_dia) ? { bp: { systolic: Number(vitals.bp_sys||0), diastolic: Number(vitals.bp_dia||0) } } : {}),
        ...(vitals.pulse  ? { pulse:  Number(vitals.pulse)  } : {}),
        ...(vitals.temp   ? { temp:   Number(vitals.temp)   } : {}),
        ...(vitals.rr     ? { rr:     Number(vitals.rr)     } : {}),
        ...(vitals.spo2   ? { spo2:   Number(vitals.spo2)   } : {}),
        ...(vitals.bsl    ? { bsl:    Number(vitals.bsl)    } : {}),
        ...(vitals.gcs    ? { gcs:    vitals.gcs            } : {}),
        ...(vitals.urine  ? { urine:  Number(vitals.urine)  } : {}),
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
                 : activeModal === "initial"     ? { ...initAssess, medicationOrders: medOrders, infusionOrders: infOrders }
                 : activeModal === "medication"  ? { medicationOrders: medOrders }
                 : activeModal === "infusion"    ? { infusionOrders: infOrders }
                 : {},
    };

    setSaving(true);
    try {
      let savedId;
      if (editingNote?._id) {
        // ── Update existing draft ──
        const res = await axios.put(`${API_ENDPOINTS.DOCTOR_NOTES}/${editingNote._id}`, payload, { headers });
        savedId = editingNote._id;
        toast.success("Draft updated ✓");
      } else {
        // ── Create new note ──
        const res = await axios.post(API_ENDPOINTS.DOCTOR_NOTES, payload, { headers });
        savedId = res.data?._id || res.data?.data?._id;
        if (status === "signed" && savedId) {
          try { await axios.patch(`${API_ENDPOINTS.DOCTOR_NOTES}/${savedId}/sign`, {}, { headers }); } catch { /* signed inline */ }
        }
        toast.success(status === "signed" ? "Note signed & submitted ✓" : "Draft saved");

        /* ── Mark admission initialAssessment.doctorCompleted = true ──────────
           Runs whenever the initial assessment note is saved (draft or signed).
           This unlocks all other note types for this patient.
        ──────────────────────────────────────────────────────────────────────── */
        if (activeModal === "initial" && patient?._id) {
          try {
            const markRes = await axios.put(
              `${API_ENDPOINTS.ADMISSIONS}/${patient._id}/initial-assessment`,
              { role: "doctor", name: doctorName },
              { headers }
            );
            // Update local patient state so the gate drops immediately (no reload needed)
            setPatient(prev => prev ? {
              ...prev,
              initialAssessment: {
                ...(prev.initialAssessment || {}),
                doctorCompleted:   true,
                doctorCompletedAt: new Date().toISOString(),
                doctorName,
              }
            } : prev);
          } catch { /* non-fatal — gate will drop on next patient reload */ }
        }

        /* ── Auto-create DoctorOrder (Treatment Chart / MAR) entries ─────────
           Runs for initial assessment, standalone medication, and infusion notes.
           Only on NEW note creation (not on draft edits) to avoid duplicates.
        ──────────────────────────────────────────────────────────────────────── */
        if (["initial","medication","infusion"].includes(activeModal)) {
          const UHID_val  = patient?.UHID || patient?.uhid || searchUHID;
          const visitId_val = patient?.ipdNo || patient?.admissionNumber || patient?._id || "";
          const patName   = patient?.patientName || patient?.patientId?.fullName || "";
          const today     = new Date(); today.setHours(0,0,0,0);

          const orderPromises = [];

          // Medication orders
          if (["initial","medication"].includes(activeModal)) {
            medOrders.filter(m => m.drug?.trim() && m.status === "Active").forEach(m => {
              const hamFlag = isHAM_IA(m.drug) || !!m.hamOverride;
              const times   = FREQ_TIMES[m.frequency] || ["08:00"];
              orderPromises.push(
                axios.post(API_ENDPOINTS.DOCTOR_ORDERS, {
                  UHID: UHID_val, patientName: patName, visitId: visitId_val, visitType: "IPD",
                  orderType: "Medication",
                  priority: m.priority || "Routine",
                  hamFlag, twoNurseRequired: hamFlag, highRisk: hamFlag,
                  orderDetails: {
                    medicineName: m.drug, dose: m.dose, route: m.route,
                    frequency: m.frequency, indication: m.indication,
                    notes: m.stopReason || "",
                  },
                  orderedBy: doctorName, orderedByRole: "Doctor", orderedAt: new Date(),
                  scheduledTimes: times,
                  administrationRecord: times
                    .filter(t => !["Immediate","As Needed","Continuous Infusion","Once Weekly","Before Meals","After Meals"].includes(t))
                    .map(t => ({ scheduledTime: t, scheduledDate: today, status: "pending" })),
                  auditLog: [{ step: "Order created (IA / Medication sheet)", doneBy: doctorName, doneAt: new Date(), notes: m.indication || "" }],
                }, { headers }).catch(() => {})
              );
            });
          }

          // Infusion orders
          if (["initial","infusion"].includes(activeModal)) {
            infOrders.filter(inf => inf.drugFluid?.trim() && inf.status === "Active").forEach(inf => {
              const hamFlag = isHAM_IA(inf.drugFluid) || !!inf.hamOverride;
              orderPromises.push(
                axios.post(API_ENDPOINTS.DOCTOR_ORDERS, {
                  UHID: UHID_val, patientName: patName, visitId: visitId_val, visitType: "IPD",
                  orderType: "IV_Fluid",
                  priority: inf.priority || "Routine",
                  hamFlag, twoNurseRequired: hamFlag, highRisk: hamFlag,
                  orderDetails: {
                    medicineName: inf.drugFluid, displayName: inf.drugFluid,
                    dose: inf.volume ? `${inf.volume}ml` : "",
                    route: "IV Infusion",
                    frequency: "Continuous",
                    rate: inf.rate, totalVolume: inf.volume,
                    dilution: inf.dilution, titrationGoal: inf.titrationGoal,
                    startTime: inf.startTime,
                  },
                  orderedBy: doctorName, orderedByRole: "Doctor", orderedAt: new Date(),
                  currentRate: inf.rate,
                  scheduledTimes: ["Continuous"],
                  auditLog: [{ step: "Infusion started (IA / Infusion sheet)", doneBy: doctorName, doneAt: new Date(), notes: `Rate: ${inf.rate || "—"} ml/hr` }],
                }, { headers }).catch(() => {})
              );
            });
          }

          if (orderPromises.length) {
            await Promise.all(orderPromises);
            toast.info(`💉 ${orderPromises.length} order(s) added to Treatment Chart (MAR)`);
          }
        }
      }
      clearDraft();
      setEditingNote(null);
      setActiveModal(null);
      await fetchNotes(ipdNo);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Save failed");
    } finally { setSaving(false); }
  };

  /* ── Open a draft note for editing ── */
  const openEditModal = (note) => {
    setEditingNote(note);

    // Restore basic form
    if (note.soap) setSoap({ subjective: note.soap.subjective || "", objective: note.soap.objective || "", assessment: note.soap.assessment || "", plan: note.soap.plan || "" });
    else setSoap({ subjective: "", objective: "", assessment: "", plan: "" });

    // Restore vitals — saved format { bp:{systolic,diastolic}, pulse, … } → form strings
    if (note.vitals) {
      const v = note.vitals;
      setVitals({
        bp_sys: v.bp?.systolic != null ? String(v.bp.systolic) : "",
        bp_dia: v.bp?.diastolic != null ? String(v.bp.diastolic) : "",
        pulse: v.pulse != null ? String(v.pulse)  : "",
        temp:  v.temp  != null ? String(v.temp)   : "",
        rr:    v.rr    != null ? String(v.rr)     : "",
        spo2:  v.spo2  != null ? String(v.spo2)   : "",
        bsl:   v.bsl   != null ? String(v.bsl)    : "",
        gcs:   v.gcs   != null ? String(v.gcs)    : "",
        urine: v.urine != null ? String(v.urine)  : "",
      });
    } else { setVitals({ bp_sys:"", bp_dia:"", pulse:"", temp:"", rr:"", spo2:"", bsl:"", gcs:"", urine:"" }); }

    setDiag({
      provisional: note.provisionalDiagnosis || "",
      final:       note.finalDiagnosis       || "",
      icd10:       note.noteDetails?.icd10   || "",
      status:      note.noteDetails?.status  || "Stable",
    });
    setInvx((note.investigations || []).join(", "));
    setOrders(note.orders || []);
    setSelectedTags(note.tags || []);
    setIsCritical(note.isCritical || false);
    setShift(note.shift || getShift());

    // Module-specific states
    const nd = note.noteDetails || {};
    if (note.noteType === "icu")          setIcu(p          => ({ ...p, ...nd }));
    if (note.noteType === "procedure")    setProc(p         => ({ ...p, ...nd }));
    if (note.noteType === "consultation") setConsult(p      => ({ ...p, ...nd }));
    if (note.noteType === "preop")        setPreop(p        => ({ ...p, ...nd }));
    if (note.noteType === "postop")       setPostop(p       => ({ ...p, ...nd }));
    if (note.noteType === "death")        setDeath(p        => ({ ...p, ...nd }));
    if (note.noteType === "amendment")    setAmendment(p    => ({ ...p, ...nd }));
    if (note.noteType === "medication" && nd.medicationOrders?.length) setMedOrders(nd.medicationOrders);
    if (note.noteType === "infusion"   && nd.infusionOrders?.length)   setInfOrders(nd.infusionOrders);

    setActiveModal(note.noteType || "daily");
  };

  /* ── Sign existing draft note ── */
  const signNote = async (noteId) => {
    if (!patient) return;
    const ipdNo = patient.ipdNo || patient.admissionNumber || patient._id;
    const token = localStorage.getItem("his_token");
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    try {
      await axios.patch(`${API_ENDPOINTS.DOCTOR_NOTES}/${noteId}/sign`, {}, { headers });
      toast.success("Note signed & submitted ✓");
      await fetchNotes(ipdNo);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Sign failed");
    }
  };

  const today = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

  /* ── Date range helper ── */
  const dateRangeStart = (() => {
    if (!filterDate) return null;
    const now = new Date();
    if (filterDate === "today") {
      return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    }
    if (filterDate === "week") {
      const d = new Date(now);
      d.setDate(d.getDate() - d.getDay()); // Sunday of current week
      d.setHours(0, 0, 0, 0);
      return d;
    }
    if (filterDate === "last7") {
      const d = new Date(now);
      d.setDate(d.getDate() - 6);
      d.setHours(0, 0, 0, 0);
      return d;
    }
    return null;
  })();

  const filteredNotes = notes.filter(n => {
    const typeMatch  = filterType === "All" || n.noteType === filterType || (filterType === "daily" && !n.noteType);
    const shiftMatch = !filterShift || n.shift === filterShift;
    const dateMatch  = !dateRangeStart || new Date(n.createdAt || n.noteDate) >= dateRangeStart;
    return typeMatch && shiftMatch && dateMatch;
  });

  const modDef = (id) => MODULES.find(m => m.id === id);

  /* ── Stats ── */
  const totalNotes  = notes.length;
  const signedNotes = notes.filter(n => n.status === "signed").length;
  const draftNotes  = notes.filter(n => n.status !== "signed").length;
  const todayNotes  = notes.filter(n => {
    const d = new Date(n.createdAt || n.noteDate);
    const t = new Date();
    return d.getDate() === t.getDate() && d.getMonth() === t.getMonth() && d.getFullYear() === t.getFullYear();
  }).length;

  /* ── Filter button counts ── */
  const noteTypeCounts = {};
  notes.forEach(n => {
    const k = n.noteType || "daily";
    noteTypeCounts[k] = (noteTypeCounts[k] || 0) + 1;
  });

  /* ── Group filtered notes by date ── */
  const groupNotesByDate = (arr) => {
    const groups = {};
    arr.forEach(n => {
      const d = new Date(n.createdAt || n.noteDate);
      const key = d.toISOString().slice(0, 10);
      if (!groups[key]) groups[key] = [];
      groups[key].push(n);
    });
    return Object.entries(groups).sort((a, b) => b[0].localeCompare(a[0]));
  };
  const dateGroups = groupNotesByDate(filteredNotes);

  const fmtDayHeader = (isoDate) => {
    const d = new Date(isoDate + "T00:00:00");
    const t = new Date();
    const todayKey = t.toISOString().slice(0, 10);
    const yday  = new Date(t.setDate(t.getDate() - 1)).toISOString().slice(0, 10);
    if (isoDate === todayKey) return "Today";
    if (isoDate === yday)     return "Yesterday";
    return d.toLocaleDateString("en-IN", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
  };

  /* ── Proper clinical print for a single note ── */
  const printNote = (note) => {
    const pName  = patient?.patientName || patient?.patientId?.fullName || "—";
    const uhid   = patient?.UHID || patient?.uhid || searchUHID || "—";
    const ipd    = patient?.ipdNo || patient?.admissionNumber || "—";
    const ward   = patient?.wardName ? `${patient.wardName} · Bed ${patient.bedNumber || "—"}` : "—";
    const modLabel = modDef(note.noteType)?.label || "Daily Progress";
    const noteDate = note.createdAt ? new Date(note.createdAt).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
    const shift  = (note.shift || "morning");

    const vitalsHtml = (() => {
      const v = note.vitals;
      if (!v) return "";
      const bpStr = v.bp ? `${v.bp.systolic||"—"}/${v.bp.diastolic||"—"} mmHg` : "";
      const rows = [
        ["BP", bpStr], ["Pulse", v.pulse ? `${v.pulse} /min` : ""], ["Temp", v.temp ? `${v.temp}°F` : ""],
        ["SpO₂", v.spo2 ? `${v.spo2}%` : ""], ["RR", v.rr ? `${v.rr} /min` : ""],
        ["BSL", v.bsl ? `${v.bsl} mg/dL` : ""], ["GCS", v.gcs ? String(v.gcs) : ""], ["Urine", v.urine ? `${v.urine} mL/hr` : ""],
      ].filter(r => r[1]);
      if (!rows.length) return "";
      return `<h4 style="margin:12px 0 6px;color:#1e40af;font-size:11px;text-transform:uppercase;letter-spacing:.5px">Vitals</h4>
<table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:10px">
<tr style="background:#eff6ff">${rows.map(r => `<th style="padding:5px 8px;border:1px solid #bfdbfe;text-align:left;font-size:10px;color:#1e40af">${r[0]}</th>`).join("")}</tr>
<tr>${rows.map(r => `<td style="padding:5px 8px;border:1px solid #bfdbfe;font-family:monospace;font-weight:600">${r[1]}</td>`).join("")}</tr>
</table>`;
    })();

    const soapHtml = (() => {
      const s = note.soap;
      if (!s) return "";
      const parts = [["S — Subjective","#1d4ed8",s.subjective],["O — Objective","#0d9488",s.objective],["A — Assessment","#d97706",s.assessment],["P — Plan","#16a34a",s.plan]].filter(p=>p[2]);
      if (!parts.length) return "";
      return `<h4 style="margin:12px 0 6px;color:#1e40af;font-size:11px;text-transform:uppercase;letter-spacing:.5px">SOAP Notes</h4>
${parts.map(p=>`<div style="margin-bottom:8px;border-left:3px solid ${p[1]};padding-left:10px"><strong style="font-size:10px;text-transform:uppercase;color:${p[1]}">${p[0]}</strong><p style="margin:3px 0;font-size:12px;white-space:pre-wrap">${p[2]}</p></div>`).join("")}`;
    })();

    const diagHtml = (() => {
      const parts = [];
      if (note.provisionalDiagnosis) parts.push(`<strong>Provisional:</strong> ${note.provisionalDiagnosis}`);
      if (note.finalDiagnosis)       parts.push(`<strong>Final:</strong> ${note.finalDiagnosis}`);
      if (!parts.length) return "";
      return `<h4 style="margin:12px 0 6px;color:#1e40af;font-size:11px;text-transform:uppercase;letter-spacing:.5px">Diagnosis</h4><p style="font-size:12px;margin:0">${parts.join(" &nbsp;|&nbsp; ")}</p>`;
    })();

    const invHtml = note.investigations?.length
      ? `<h4 style="margin:12px 0 6px;color:#1e40af;font-size:11px;text-transform:uppercase;letter-spacing:.5px">Investigations</h4><p style="font-size:12px;margin:0">${note.investigations.join(", ")}</p>` : "";

    const ordersHtml = note.orders?.length
      ? `<h4 style="margin:12px 0 6px;color:#1e40af;font-size:11px;text-transform:uppercase;letter-spacing:.5px">Doctor Orders</h4>
<table style="width:100%;border-collapse:collapse;font-size:11px">
<tr style="background:#eff6ff"><th style="padding:4px 8px;border:1px solid #bfdbfe;text-align:left">Type</th><th style="padding:4px 8px;border:1px solid #bfdbfe;text-align:left">Instruction</th><th style="padding:4px 8px;border:1px solid #bfdbfe;text-align:left">Route</th><th style="padding:4px 8px;border:1px solid #bfdbfe;text-align:left">Freq</th><th style="padding:4px 8px;border:1px solid #bfdbfe;text-align:left">Priority</th></tr>
${note.orders.map(o=>`<tr><td style="padding:4px 8px;border:1px solid #dbeafe">${o.type||"—"}</td><td style="padding:4px 8px;border:1px solid #dbeafe">${o.instruction||"—"}</td><td style="padding:4px 8px;border:1px solid #dbeafe">${o.route||"—"}</td><td style="padding:4px 8px;border:1px solid #dbeafe">${o.frequency||"—"}</td><td style="padding:4px 8px;border:1px solid #dbeafe;font-weight:700;color:${o.priority==="STAT"?"#dc2626":o.priority==="URGENT"?"#d97706":"#16a34a"}">${o.priority||"ROUTINE"}</td></tr>`).join("")}
</table>` : "";

    const medOrdersHtml = (() => {
      const mo = note.noteDetails?.medicationOrders;
      if (!mo?.length) return "";
      return `<h4 style="margin:12px 0 6px;color:#1d4ed8;font-size:11px;text-transform:uppercase;letter-spacing:.5px">Medication Orders</h4>
<table style="width:100%;border-collapse:collapse;font-size:11px">
<tr style="background:#dbeafe"><th style="padding:4px 8px;border:1px solid #93c5fd;text-align:left">Drug</th><th style="padding:4px 8px;border:1px solid #93c5fd;text-align:left">Dose</th><th style="padding:4px 8px;border:1px solid #93c5fd;text-align:left">Route</th><th style="padding:4px 8px;border:1px solid #93c5fd;text-align:left">Frequency</th><th style="padding:4px 8px;border:1px solid #93c5fd;text-align:left">Status</th></tr>
${mo.map(m=>`<tr style="${m.status==="Stopped"?"background:#fff1f2":""}"><td style="padding:4px 8px;border:1px solid #bfdbfe;font-weight:600">${m.drug||"—"}</td><td style="padding:4px 8px;border:1px solid #bfdbfe">${m.dose||"—"}</td><td style="padding:4px 8px;border:1px solid #bfdbfe">${m.route||"—"}</td><td style="padding:4px 8px;border:1px solid #bfdbfe">${m.frequency||"—"}</td><td style="padding:4px 8px;border:1px solid #bfdbfe;font-weight:700;color:${m.status==="Stopped"?"#dc2626":"#16a34a"}">${m.status||"Active"}</td></tr>`).join("")}
</table>`;
    })();

    const infOrdersHtml = (() => {
      const io = note.noteDetails?.infusionOrders;
      if (!io?.length) return "";
      return `<h4 style="margin:12px 0 6px;color:#0d9488;font-size:11px;text-transform:uppercase;letter-spacing:.5px">Infusion Orders</h4>
<table style="width:100%;border-collapse:collapse;font-size:11px">
<tr style="background:#ccfbf1"><th style="padding:4px 8px;border:1px solid #99f6e4;text-align:left">Drug / Fluid</th><th style="padding:4px 8px;border:1px solid #99f6e4;text-align:left">Type</th><th style="padding:4px 8px;border:1px solid #99f6e4;text-align:left">Volume (mL)</th><th style="padding:4px 8px;border:1px solid #99f6e4;text-align:left">Rate (mL/hr)</th><th style="padding:4px 8px;border:1px solid #99f6e4;text-align:left">Status</th></tr>
${io.map(inf=>`<tr style="${inf.status==="Stopped"?"background:#fff1f2":""}"><td style="padding:4px 8px;border:1px solid #a7f3d0;font-weight:600">${inf.drugFluid||inf.type||"—"}</td><td style="padding:4px 8px;border:1px solid #a7f3d0">${inf.type||"—"}</td><td style="padding:4px 8px;border:1px solid #a7f3d0">${inf.volume||"—"}</td><td style="padding:4px 8px;border:1px solid #a7f3d0">${inf.rate||"—"}</td><td style="padding:4px 8px;border:1px solid #a7f3d0;font-weight:700;color:${inf.status==="Stopped"?"#dc2626":"#0d9488"}">${inf.status||"Active"}</td></tr>`).join("")}
</table>`;
    })();

    const tagsHtml = note.tags?.length
      ? `<p style="margin:6px 0;font-size:11px"><strong>Tags:</strong> ${note.tags.join(" · ")}</p>` : "";

    const sigHtml = note.status === "signed"
      ? `<div style="margin-top:20px;padding:10px 14px;border:1px solid #bbf7d0;border-radius:8px;background:#f0fdf4;display:flex;align-items:center;gap:10px"><div><strong style="color:#15803d;font-size:12px">✓ SIGNED & SUBMITTED</strong><br/><span style="font-size:11px;color:#166534">By: ${note.doctorName||doctorName} ${note.doctorRegNo ? "· Reg: "+note.doctorRegNo : ""} · ${note.signedAt ? new Date(note.signedAt).toLocaleString("en-IN") : noteDate}</span></div></div>`
      : `<div style="margin-top:20px;padding:8px 12px;border:1px solid #fde68a;border-radius:8px;background:#fffbeb"><strong style="color:#d97706;font-size:12px">DRAFT — Not yet signed</strong></div>`;

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Doctor Note — ${pName}</title>
<style>body{font-family:'Segoe UI',Arial,sans-serif;color:#0f172a;margin:0;padding:0}@media print{.no-print{display:none!important}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style></head>
<body>
<!-- Print Header -->
<div style="background:linear-gradient(135deg,#1e40af,#2563eb);color:white;padding:16px 24px;display:flex;align-items:center;justify-content:space-between">
  <div>
    <div style="font-size:18px;font-weight:800;letter-spacing:-.3px">SphereHealth HIS</div>
    <div style="font-size:11px;opacity:.8">NABH Accredited Clinical Documentation System</div>
  </div>
  <div style="text-align:right;font-size:11px;opacity:.85">
    <div>Printed: ${new Date().toLocaleString("en-IN")}</div>
    <div>Confidential — Medical Record</div>
  </div>
</div>

<!-- Patient Header -->
<div style="background:#f8fafc;border-bottom:2px solid #e2e8f0;padding:12px 24px;display:flex;gap:30px;flex-wrap:wrap">
  <div><div style="font-size:9px;text-transform:uppercase;letter-spacing:.5px;color:#64748b;font-weight:700">Patient</div><div style="font-size:14px;font-weight:800">${pName}</div></div>
  <div><div style="font-size:9px;text-transform:uppercase;letter-spacing:.5px;color:#64748b;font-weight:700">UHID</div><div style="font-size:13px;font-weight:700;font-family:monospace">${uhid}</div></div>
  <div><div style="font-size:9px;text-transform:uppercase;letter-spacing:.5px;color:#64748b;font-weight:700">IPD No.</div><div style="font-size:13px;font-weight:700;font-family:monospace">${ipd}</div></div>
  <div><div style="font-size:9px;text-transform:uppercase;letter-spacing:.5px;color:#64748b;font-weight:700">Ward / Bed</div><div style="font-size:12px;font-weight:600">${ward}</div></div>
  <div><div style="font-size:9px;text-transform:uppercase;letter-spacing:.5px;color:#64748b;font-weight:700">Note Date</div><div style="font-size:12px;font-weight:600">${noteDate}</div></div>
  <div><div style="font-size:9px;text-transform:uppercase;letter-spacing:.5px;color:#64748b;font-weight:700">Shift</div><div style="font-size:12px;font-weight:700;text-transform:capitalize">${shift}</div></div>
</div>

<!-- Note Body -->
<div style="padding:20px 24px">
  <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;padding-bottom:10px;border-bottom:1px solid #e2e8f0">
    <div style="padding:5px 14px;border-radius:6px;font-size:13px;font-weight:800;background:#eff6ff;color:#1e40af">${modLabel}</div>
    <div style="padding:4px 10px;border-radius:5px;font-size:11px;font-weight:700;background:${note.status==="signed"?"#dcfce7":"#fffbeb"};color:${note.status==="signed"?"#16a34a":"#d97706"}">${note.status==="signed"?"✓ SIGNED":"DRAFT"}</div>
    ${note.isCritical ? '<div style="padding:4px 10px;border-radius:5px;font-size:11px;font-weight:700;background:#fef2f2;color:#dc2626">⚠ CRITICAL EVENT</div>' : ""}
    <div style="margin-left:auto;font-size:12px;color:#64748b">Doctor: <strong>${note.doctorName||doctorName}</strong>${note.doctorRegNo ? " · Reg: "+note.doctorRegNo : ""}</div>
  </div>

  ${vitalsHtml}${soapHtml}${diagHtml}${invHtml}${ordersHtml}${medOrdersHtml}${infOrdersHtml}${tagsHtml}${sigHtml}
</div>
<div class="no-print" style="padding:16px 24px;border-top:1px solid #e2e8f0;display:flex;gap:10px">
  <button onclick="window.print()" style="padding:9px 24px;background:#1e40af;color:white;border:none;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer">🖨 Print</button>
  <button onclick="window.close()" style="padding:9px 20px;background:white;color:#64748b;border:1.5px solid #e2e8f0;border-radius:8px;font-size:14px;cursor:pointer">Close</button>
</div>
</body></html>`;

    const w = window.open("", "_blank", "width=900,height=700");
    if (w) { w.document.write(html); w.document.close(); }
  };

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

      {/* ── My Patients Panel — Primary + Consulting tabs ── */}
      <div style={{ background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 12, overflow: "hidden", marginBottom: 14 }}>
        <div style={{ padding: "10px 16px", borderBottom: `1px solid ${C.border}`, background: "#f8fafc", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          {/* Tab switcher */}
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ width: 26, height: 26, borderRadius: 6, background: C.primary + "18", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <i className="pi pi-users" style={{ color: C.primary, fontSize: 12 }} />
            </span>
            {[
              { id: "primary",    label: "My IPD Patients",  count: recentPatients.length,  color: C.primary  },
              { id: "consulting", label: "Consulting",        count: consultPatients.length, color: "#7c3aed"  },
            ].map(tab => (
              <button key={tab.id} onClick={() => setPatientListTab(tab.id)} style={{
                padding: "4px 12px", borderRadius: 20, border: "none", cursor: "pointer",
                fontFamily: "'DM Sans',sans-serif", fontSize: 11, fontWeight: 700,
                background: patientListTab === tab.id ? tab.color : "transparent",
                color: patientListTab === tab.id ? "#fff" : C.muted,
                display: "flex", alignItems: "center", gap: 5, transition: ".15s",
              }}>
                {tab.label}
                <span style={{
                  background: patientListTab === tab.id ? "rgba(255,255,255,.3)" : tab.color + "20",
                  color: patientListTab === tab.id ? "#fff" : tab.color,
                  padding: "0px 6px", borderRadius: 10, fontSize: 10,
                }}>{tab.count}</span>
              </button>
            ))}
          </div>
          <input value={recentSearch} onChange={e => setRecentSearch(e.target.value.toUpperCase())}
            placeholder="Search name / UHID…"
            style={{ ...fld, maxWidth: 200, padding: "5px 10px", fontSize: 11 }} />
        </div>

        <div style={{ padding: "10px 14px", display: "flex", gap: 8, overflowX: "auto", alignItems: "stretch", minHeight: 80 }}>
          {recentLoading ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: C.muted, fontSize: 12, flex: 1, justifyContent: "center" }}>
              <i className="pi pi-spin pi-spinner" style={{ fontSize: 16 }} /> Loading patients…
            </div>
          ) : (() => {
            /* Pick active list */
            const activeList = patientListTab === "consulting" ? consultPatients : recentPatients;
            const filtered = activeList.filter(p => {
              if (!recentSearch) return true;
              const s = recentSearch.toLowerCase();
              return (p.patientName||p.patientId?.fullName||"").toLowerCase().includes(s) ||
                     (p.UHID||p.uhid||"").toLowerCase().includes(s);
            });

            if (filtered.length === 0) return (
              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: C.muted, fontSize: 12 }}>
                <i className="pi pi-inbox" style={{ marginRight: 6, fontSize: 14 }} />
                {patientListTab === "consulting"
                  ? "No active consultation requests"
                  : "No active IPD admissions"}
              </div>
            );

            return filtered.map(rp => {
              const isSelected = patient && (patient._id === rp._id || patient.UHID === rp.UHID);
              const admHours = rp.admissionDate ? Math.floor((Date.now() - new Date(rp.admissionDate)) / 3600000) : null;
              const isNew = admHours !== null && admHours < 48;
              const myRole = rp.myRole || (patientListTab === "consulting" ? rp.myConsultEntry?.role || "Consulting" : "Primary");
              const accentColor = patientListTab === "consulting" ? "#7c3aed" : C.primary;
              const urgency = rp.myConsultEntry?.urgency;

              return (
                <button key={rp._id}
                  onClick={() => {
                    setSearchUHID(rp.UHID || rp.uhid || "");
                    setPatient(rp);
                    fetchNotes(rp.ipdNo || rp.admissionNumber || rp._id);
                    toast.success(`Loaded: ${rp.patientName || rp.patientId?.fullName || "Patient"}`);
                  }}
                  style={{
                    flexShrink: 0, width: 180, padding: "10px 12px",
                    border: `2px solid ${isSelected ? accentColor : isNew ? "#fbbf24" : C.border}`,
                    borderRadius: 10,
                    background: isSelected ? (patientListTab === "consulting" ? "#f5f3ff" : C.primaryL) : isNew ? "#fffbeb" : "white",
                    cursor: "pointer", textAlign: "left", position: "relative", transition: "all .15s",
                  }}
                  onMouseEnter={e => { if (!isSelected) e.currentTarget.style.borderColor = accentColor + "80"; }}
                  onMouseLeave={e => { if (!isSelected) e.currentTarget.style.borderColor = isNew ? "#fbbf24" : C.border; }}>

                  {/* Badges */}
                  {isNew && !isSelected && (
                    <span style={{ position: "absolute", top: 6, right: 6, background: "#f59e0b", color: "white", fontSize: 8, fontWeight: 800, padding: "1px 5px", borderRadius: 3, letterSpacing: ".5px" }}>NEW</span>
                  )}
                  {isSelected && (
                    <span style={{ position: "absolute", top: 6, right: 6, background: accentColor, color: "white", fontSize: 8, fontWeight: 800, padding: "1px 5px", borderRadius: 3 }}>OPEN</span>
                  )}
                  {urgency && urgency !== "Routine" && !isSelected && (
                    <span style={{
                      position: "absolute", top: 6, right: 6,
                      background: urgency === "Emergent" ? "#dc2626" : "#d97706",
                      color: "white", fontSize: 8, fontWeight: 800, padding: "1px 5px", borderRadius: 3,
                    }}>{urgency.toUpperCase()}</span>
                  )}

                  <div style={{ fontWeight: 700, fontSize: 12, color: isSelected ? accentColor : C.text, marginBottom: 3, paddingRight: 36, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {rp.patientName || rp.patientId?.fullName || "Patient"}
                  </div>
                  <div style={{ fontFamily: "monospace", fontSize: 10, color: C.muted, marginBottom: 3 }}>{rp.UHID || rp.uhid}</div>
                  {/* Role tag */}
                  <div style={{
                    fontSize: 9, fontWeight: 700, color: accentColor,
                    background: accentColor + "15", display: "inline-block",
                    padding: "1px 6px", borderRadius: 8, marginBottom: 3, letterSpacing: .4,
                  }}>{myRole}</div>
                  <div style={{ fontSize: 10, color: C.muted }}>
                    {rp.bedNumber ? `Bed ${rp.bedNumber}` : rp.department || ""}
                  </div>
                  {rp.attendingDoctor && patientListTab === "consulting" && (
                    <div style={{ fontSize: 9, color: C.muted, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      Primary: {rp.attendingDoctor}
                    </div>
                  )}
                  {admHours !== null && (
                    <div style={{ fontSize: 9, color: isNew ? "#92400e" : C.muted, fontWeight: isNew ? 700 : 400, marginTop: 2 }}>
                      {admHours < 24 ? `${admHours}h ago` : `${Math.floor(admHours/24)}d ago`}
                    </div>
                  )}
                </button>
              );
            });
          })()}
        </div>
      </div>

      {/* ── Patient Search (fallback manual) ── */}
      {!patient ? (
        <div style={{ maxWidth: 560, margin: "0 auto", paddingTop: 4 }}>
          <div style={{ background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 14, padding: "24px 28px", boxShadow: "0 4px 24px rgba(0,0,0,.06)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <div style={{ width: 36, height: 36, borderRadius: 9, background: C.primaryL, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <i className="pi pi-user-plus" style={{ fontSize: 16, color: C.primary }} />
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15, color: C.slate }}>Load Patient</div>
                <div style={{ color: C.muted, fontSize: 12 }}>Select from above or enter UHID manually</div>
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

          {/* ── Assessment Gate Banner (HARD BLOCK) ── */}
          {gateActive && (
            <div style={{ background: "#fef2f2", border: "2px solid #fca5a5", borderRadius: 12, padding: "16px 20px", marginBottom: 14, display: "flex", alignItems: "center", gap: 14, boxShadow: "0 4px 16px rgba(220,38,38,.12)" }}>
              <div style={{ width: 44, height: 44, borderRadius: 10, background: "#fee2e2", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <i className="pi pi-lock" style={{ fontSize: 20, color: "#dc2626" }} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 800, fontSize: 14, color: "#991b1b", display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ background: "#dc2626", color: "white", fontSize: 9, fontWeight: 900, padding: "2px 7px", borderRadius: 4, letterSpacing: ".5px" }}>MANDATORY</span>
                  Initial Assessment not completed — NABH COP.1
                </div>
                <div style={{ fontSize: 12, color: "#b91c1c", marginTop: 4 }}>
                  Doctor's Initial Assessment must be completed and signed before writing daily notes, medication orders, ICU notes, or any other clinical documentation for this patient.
                </div>
              </div>
              <button
                onClick={() => setShowAssessmentModal(true)}
                style={{ padding: "10px 22px", background: "#dc2626", color: "white", border: "none", borderRadius: 8, fontFamily: "'DM Sans',sans-serif", fontSize: 13, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", boxShadow: "0 4px 14px rgba(220,38,38,.35)", flexShrink: 0 }}>
                <i className="pi pi-clipboard" style={{ marginRight: 6, fontSize: 13 }} />
                Write Initial Assessment
              </button>
            </div>
          )}
          {!gateActive && assessmentDone && (
            <div style={{ background: "#f0fdf4", border: "1.5px solid #bbf7d0", borderRadius: 10, padding: "9px 16px", marginBottom: 14, display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#15803d", fontWeight: 600 }}>
              <i className="pi pi-check-circle" style={{ fontSize: 14 }} />
              Initial Assessment completed &amp; signed — full documentation access unlocked
            </div>
          )}

          {/* ── Doctor Orders Panel ── */}
          <DoctorOrdersPanel
            UHID={patient?.UHID || patient?.uhid || searchUHID}
            visitId={patient?.ipdNo || patient?.admissionNumber || patient?.visitId}
            ipdNo={patient?.ipdNo || patient?.admissionNumber}
            patientName={patient?.patientName || patient?.patientId?.fullName || ""}
            refreshSignal={ordersRefresh}
          />

          {/* ── NABH Treatment Chart (Doctor Full View) ── */}
          <div style={{ marginBottom: 14 }}>
            <TreatmentChart
              UHID={patient?.UHID || patient?.uhid || searchUHID}
              visitId={patient?.ipdNo || patient?.admissionNumber || patient?.visitId}
              patientName={patient?.patientName || patient?.patientId?.fullName || ""}
              nurseMode={false}
              refreshTrigger={ordersRefresh}
            />
          </div>

          {/* ── Treatment Team / Multi-doctor Consultation (NABH COP.1) ── */}
          <TreatmentTeamPanel
            admissionId={patient?._id || patient?.admissionId}
            patientName={patient?.patientName || patient?.patientId?.fullName || ""}
            UHID={patient?.UHID || patient?.uhid || searchUHID}
            refreshTrigger={ordersRefresh}
          />

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
              <span style={{ fontWeight: 700, fontSize: 12, textTransform: "uppercase", letterSpacing: ".8px", color: C.muted }}>Clinical Documentation — NABH</span>
            </div>

            {/* Priority modules row */}
            <div style={{ padding: "12px 16px", borderBottom: `1px solid ${C.border}`, background: "#fffbeb", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: "#92400e", textTransform: "uppercase", letterSpacing: ".6px", whiteSpace: "nowrap" }}>Required / Treatment:</span>
              {MODULES.filter(m => m.id === "medication" || m.id === "infusion").map(m => {
                const locked = gateActive && m.id !== "initial";
                return (
                  <button key={m.id} onClick={() => openModal(m.id)}
                    style={{ display: "flex", alignItems: "center", gap: 7, padding: "9px 16px", borderRadius: 9, border: `2px solid ${locked ? C.border : m.border}`, fontFamily: "'DM Sans',sans-serif", fontSize: 12, fontWeight: 700, cursor: "pointer", background: locked ? "#f1f5f9" : (m.id === "initial" && gateActive ? "#fef3c7" : "white"), color: locked ? C.muted : m.color, transition: "all .2s", position: "relative", opacity: locked ? 0.6 : 1 }}
                    onMouseEnter={e => { if (!locked) { e.currentTarget.style.background = m.bg; e.currentTarget.style.transform = "translateY(-1px)"; } }}
                    onMouseLeave={e => { if (!locked) { e.currentTarget.style.background = m.id === "initial" && gateActive ? "#fef3c7" : "white"; e.currentTarget.style.transform = "none"; } }}>
                    <i className={`pi ${locked ? "pi-lock" : m.icon}`} style={{ fontSize: 13 }} />
                    {m.label}
                    {m.id === "initial" && gateActive && <span style={{ marginLeft: 4, background: "#d97706", color: "white", fontSize: 9, fontWeight: 800, padding: "1px 6px", borderRadius: 3 }}>REQUIRED</span>}
                    {m.id === "initial" && assessmentDone && <span style={{ marginLeft: 4, background: C.green, color: "white", fontSize: 9, fontWeight: 800, padding: "1px 6px", borderRadius: 3 }}>✓ DONE</span>}
                  </button>
                );
              })}
            </div>

            {/* All other modules */}
            <div style={{ padding: "12px 18px", display: "flex", flexWrap: "wrap", gap: 8 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".6px", alignSelf: "center", marginRight: 4 }}>Notes:</span>
              {MODULES.filter(m => !m.priority && m.id !== "medication" && m.id !== "infusion").map(m => {
                const locked = gateActive;
                return (
                  <button key={m.id} onClick={() => openModal(m.id)}
                    style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 14px", borderRadius: 9, border: `1.5px solid ${locked ? C.border : m.border}`, fontFamily: "'DM Sans',sans-serif", fontSize: 12, fontWeight: 600, cursor: "pointer", background: "white", color: locked ? C.muted : m.color, transition: "all .2s", position: "relative", opacity: locked ? 0.55 : 1 }}
                    onMouseEnter={e => { if (!locked) { e.currentTarget.style.background = m.bg; e.currentTarget.style.transform = "translateY(-1px)"; } }}
                    onMouseLeave={e => { if (!locked) { e.currentTarget.style.background = "white"; e.currentTarget.style.transform = "none"; } }}>
                    <i className={`pi ${locked ? "pi-lock" : m.icon}`} style={{ fontSize: 13 }} />{m.label}
                    {m.dot && !locked && <span style={{ position: "absolute", top: -4, right: -4, width: 8, height: 8, background: m.color, borderRadius: "50%", border: "2px solid white" }} />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Notes Stats Bar ── */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10, marginBottom: 14 }}>
            {[
              { label: "Total Notes", value: totalNotes, icon: "pi-file-edit", color: C.primary, bg: C.primaryL },
              { label: "Signed",      value: signedNotes, icon: "pi-check-circle", color: C.green, bg: C.greenL },
              { label: "Drafts",      value: draftNotes,  icon: "pi-pencil",       color: C.amber, bg: C.amberL },
              { label: "Today",       value: todayNotes,  icon: "pi-calendar",     color: C.teal,  bg: C.tealL  },
            ].map(s => (
              <div key={s.label} style={{ background: s.bg, border: `1.5px solid ${s.color}25`, borderRadius: 10, padding: "12px 16px", display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 36, height: 36, borderRadius: 9, background: s.color + "20", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <i className={`pi ${s.icon}`} style={{ fontSize: 16, color: s.color }} />
                </div>
                <div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: s.color, lineHeight: 1 }}>{s.value}</div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: s.color + "aa", textTransform: "uppercase", letterSpacing: ".5px" }}>{s.label}</div>
                </div>
              </div>
            ))}
          </div>

          {/* ── Notes Timeline ── */}
          <div style={{ background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 20px", borderBottom: `1px solid ${C.border}`, background: "#f8fafc", flexWrap: "wrap", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 14 }}>
                <i className="pi pi-list" style={{ color: C.primary, fontSize: 14 }} />
                Doctor Notes Timeline
                <span style={{ background: C.primary, color: "white", padding: "2px 9px", borderRadius: 10, fontSize: 11, fontWeight: 700 }}>{filteredNotes.length}</span>
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                {[{id:"All"}, ...["daily","icu","procedure","consultation","preop","postop","medication","infusion","death","amendment"].map(id=>({id}))].map(f => {
                  const cnt = f.id === "All" ? notes.length : (noteTypeCounts[f.id] || 0);
                  const label = f.id === "All" ? "All" : MODULES.find(m => m.id === f.id)?.label || f.id;
                  if (f.id !== "All" && cnt === 0) return null;
                  return (
                    <button key={f.id} onClick={() => setFilterType(f.id)}
                      style={{ padding: "4px 10px", border: `1.5px solid ${filterType === f.id ? C.primary : C.border}`, borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: "pointer", background: filterType === f.id ? C.primaryL : "white", color: filterType === f.id ? C.primary : C.muted, transition: "all .15s", display: "flex", alignItems: "center", gap: 4 }}>
                      {label}
                      {cnt > 0 && <span style={{ background: filterType === f.id ? C.primary : "#e2e8f0", color: filterType === f.id ? "white" : C.muted, padding: "0px 5px", borderRadius: 9, fontSize: 9, fontWeight: 700 }}>{cnt}</span>}
                    </button>
                  );
                })}
                <select value={filterShift} onChange={e => setFilterShift(e.target.value)} style={{ ...fld, maxWidth: 120, padding: "5px 10px", fontSize: 11 }}>
                  <option value="">All Shifts</option>
                  <option value="morning">Morning</option>
                  <option value="afternoon">Afternoon</option>
                  <option value="evening">Evening</option>
                  <option value="night">Night</option>
                </select>
                <button onClick={async () => { setTimelineRefresh(r=>r+1); await fetchNotes(patient?.ipdNo || patient?.admissionNumber || patient?._id); }}
                  title="Refresh timeline"
                  style={{ padding: "5px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, background: "white", cursor: "pointer", color: C.muted, display: "flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 600 }}>
                  <i className="pi pi-refresh" style={{ fontSize: 11 }} /> Refresh
                </button>
              </div>
            </div>

            {/* ── Date Range Sub-bar ── */}
            <div style={{ padding: "8px 20px", borderBottom: `1px solid ${C.border}`, background: "#fafbfc", display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".6px", marginRight: 4 }}>Date:</span>
              {[
                { id: "",       label: "All Time",   icon: "pi-calendar" },
                { id: "today",  label: "Today",       icon: "pi-sun"      },
                { id: "week",   label: "This Week",   icon: "pi-calendar" },
                { id: "last7",  label: "Last 7 Days", icon: "pi-history"  },
              ].map(d => {
                const active = filterDate === d.id;
                return (
                  <button key={d.id} onClick={() => setFilterDate(d.id)}
                    style={{ padding: "4px 12px", border: `1.5px solid ${active ? C.teal : C.border}`, borderRadius: 20, fontSize: 11, fontWeight: active ? 700 : 600, cursor: "pointer", background: active ? C.tealL : "white", color: active ? C.teal : C.muted, transition: "all .15s", display: "flex", alignItems: "center", gap: 5 }}>
                    <i className={`pi ${d.icon}`} style={{ fontSize: 10 }} />
                    {d.label}
                  </button>
                );
              })}
              {filterDate && (
                <span style={{ marginLeft: "auto", fontSize: 11, color: C.teal, fontWeight: 600 }}>
                  {filteredNotes.length} note{filteredNotes.length !== 1 ? "s" : ""} in range
                  <button onClick={() => setFilterDate("")} style={{ marginLeft: 8, background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 11, fontWeight: 600, padding: 0 }}>✕ Clear</button>
                </span>
              )}
            </div>

            {filteredNotes.length === 0 ? (
              <div style={{ textAlign: "center", padding: "56px 0", color: C.muted }}>
                <i className="pi pi-inbox" style={{ fontSize: 32, display: "block", marginBottom: 12, color: "#cbd5e1" }} />
                <div style={{ fontSize: 13, fontWeight: 600 }}>No doctor notes yet</div>
                <button onClick={() => openModal("daily")} style={{ marginTop: 10, background: "none", border: "none", color: C.primary, fontWeight: 700, cursor: "pointer", fontSize: 13 }}>
                  <i className="pi pi-plus" style={{ marginRight: 5, fontSize: 11 }} />Write first progress note
                </button>
              </div>
            ) : dateGroups.map(([dateKey, groupNotes]) => (
              <div key={dateKey}>
                {/* ── Date Section Header ── */}
                <div style={{ padding: "7px 20px", background: "linear-gradient(90deg, #f1f5f9, #f8fafc)", borderBottom: `1px solid ${C.border}`, borderTop: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 10, position: "sticky", top: 0, zIndex: 2 }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: C.primary, flexShrink: 0 }} />
                  <span style={{ fontSize: 12, fontWeight: 800, color: C.primary }}>{fmtDayHeader(dateKey)}</span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: C.muted, fontFamily: "monospace" }}>
                    {new Date(dateKey + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                  </span>
                  <span style={{ marginLeft: "auto", background: C.primary + "18", color: C.primary, padding: "1px 8px", borderRadius: 9, fontSize: 10, fontWeight: 700 }}>{groupNotes.length} note{groupNotes.length !== 1 ? "s" : ""}</span>
                </div>

                {/* ── Notes in this date group ── */}
                {groupNotes.map((note, i) => {
                  const ns  = NOTE_STYLE[note.noteType] || NOTE_STYLE.daily;
                  const mod = modDef(note.noteType);
                  const timeStr   = note.createdAt ? new Date(note.createdAt).toLocaleTimeString("en-IN", { hour:"2-digit", minute:"2-digit" }) : "--:--";
                  const isSigned  = note.status === "signed";
                  const isExpanded = !!expandedNotes[note._id];
                  const toggleExpand = () => setExpandedNotes(prev => ({ ...prev, [note._id]: !prev[note._id] }));

                  /* ── Field label dictionary ── */
                  const NOTE_FIELD_LBL = {
                    admissionMode:"Admission Mode", chiefComplaint:"Chief Complaint", duration:"Duration", hpi:"HPI",
                    pastMedical:"Past Medical Hx", pastSurgical:"Past Surgical Hx", familyHistory:"Family Hx",
                    socialHistory:"Social Hx", currentMeds:"Current Meds", allergies:"Allergies",
                    bp_sys:"Systolic BP", bp_dia:"Diastolic BP", pulse:"Pulse (/min)", temp:"Temp (°F)",
                    spo2:"SpO₂ (%)", rr:"RR (/min)", bsl:"BSL (mg/dL)", weight:"Weight (kg)", height:"Height (cm)",
                    generalCondition:"Gen Condition", builtNutrition:"Built / Nutrition",
                    pallor:"Pallor", icterus:"Icterus", cyanosis:"Cyanosis", clubbing:"Clubbing",
                    lymphadenopathy:"Lymphadenopathy", oedema:"Oedema",
                    resp:"Resp System", cvs:"CVS", abdomen:"Abdomen", cns:"CNS / Neuro",
                    provisionalDx:"Provisional Dx", differentialDx:"Differential Dx", finalDx:"Final Dx", icd10:"ICD-10",
                    investigations:"Investigations", managementPlan:"Management Plan",
                    ventMode:"Vent Mode", fio2:"FiO₂ (%)", peep:"PEEP (cmH₂O)", tv:"Tidal Volume (mL)",
                    ventRR:"Vent RR", pip:"PIP", map:"MAP (mmHg)", cvp:"CVP (mmHg)",
                    rassScore:"RASS Score", bpsScore:"BPS Score", dailyGoals:"Daily Goals",
                    neuro:"Neuro", renal:"Renal", gi:"GI", haem:"Haematology", infective:"Infective",
                    sedation:"Sedation", vasopressors:"Vasopressors", vasopressorDetail:"Vasopressor Detail",
                    procedureName:"Procedure", indication:"Indication", laterality:"Laterality",
                    surgeon:"Surgeon", assistant:"Assistant", anaesthesia:"Anaesthesia",
                    position:"Position", consentObtained:"Consent Obtained",
                    technique:"Technique", findings:"Findings",
                    complications:"Complications", bloodLoss:"Blood Loss",
                    specimenSent:"Specimen Sent", specimenType:"Specimen Type", postInstructions:"Post Instructions",
                    consultantName:"Consultant", speciality:"Speciality", consultantRegNo:"Reg No",
                    referredBy:"Referred By", reason:"Reason", clinicalSummary:"Clinical Summary",
                    impression:"Impression", recommendations:"Recommendations", followUp:"Follow-Up",
                    procedure:"Procedure", preopDiagnosis:"Pre-op Dx", asaGrade:"ASA Grade",
                    plannedAnaesthesia:"Planned Anaesthesia", bloodGroup:"Blood Group", crossMatch:"Cross Match",
                    comorbidities:"Comorbidities", preopOrders:"Pre-op Orders",
                    cbcReviewed:"CBC ✓", ptReviewed:"PT/APTT ✓", ecgReviewed:"ECG ✓", cxrReviewed:"CXR ✓",
                    echoReviewed:"Echo ✓", lftsReviewed:"LFTs ✓", rftReviewed:"RFTs ✓",
                    procedurePerformed:"Procedure Performed", operativeFindings:"Operative Findings",
                    startTime:"Start Time", endTime:"End Time", transfusion:"Transfusion",
                    fluidsGiven:"Fluids Given", urineOutput:"Urine Output",
                    postopDiagnosis:"Post-op Dx", conditionLeavingOT:"Condition (OT)",
                    recoveryInstructions:"Recovery Instructions", postopOrders:"Post-op Orders",
                    dateTime:"Date/Time", causeDeath1:"Immediate Cause", causeDeath2:"Antecedent Cause",
                    causeDeath3:"Underlying Cause", contributing:"Contributing Conditions",
                    sequenceOfEvents:"Sequence of Events", modeOfDeath:"Mode of Death",
                    dnrInPlace:"DNR", familyInformed:"Family Informed", familyInformedBy:"Informed By",
                    familyInformedTime:"Informed At", mlc:"MLC", pmAdvised:"PM Advised",
                    certificateIssued:"Certificate Issued", originalNoteId:"Original Note",
                    correction:"Correction", witness:"Witness",
                  };

                  /* ── Long text fields → paragraph block instead of chip ── */
                  const LONG_FIELDS = new Set([
                    "hpi","managementPlan","pastMedical","pastSurgical","currentMeds",
                    "resp","cvs","abdomen","cns","technique","findings","clinicalSummary",
                    "impression","recommendations","dailyGoals","sequenceOfEvents",
                    "postInstructions","recoveryInstructions","postopOrders","preopOrders",
                    "comorbidities","correction","reason","operativeFindings",
                  ]);

                  /* ── Section maps per note type ── */
                  const NOTE_SECTIONS = {
                    initial: [
                      { label:"Admission Details",          icon:"pi-id-card",           keys:["admissionMode","chiefComplaint","duration","hpi"] },
                      { label:"Past History",               icon:"pi-history",            keys:["pastMedical","pastSurgical","currentMeds","allergies","familyHistory","socialHistory"] },
                      { label:"Vitals on Admission",        icon:"pi-heart",              keys:["bp_sys","bp_dia","pulse","temp","spo2","rr","weight","height","bsl"] },
                      { label:"General Examination",        icon:"pi-eye",                keys:["generalCondition","builtNutrition","pallor","icterus","cyanosis","clubbing","lymphadenopathy","oedema"] },
                      { label:"System Examination",         icon:"pi-search",             keys:["resp","cvs","abdomen","cns"] },
                      { label:"Diagnosis",                  icon:"pi-tag",                keys:["provisionalDx","differentialDx","finalDx","icd10"] },
                      { label:"Investigations & Plan",      icon:"pi-list",               keys:["investigations","managementPlan"] },
                    ],
                    icu: [
                      { label:"Ventilator Settings",        icon:"pi-sliders-h",          keys:["ventMode","fio2","peep","tv","ventRR","pip"] },
                      { label:"Hemodynamics / Monitoring",  icon:"pi-chart-line",         keys:["map","cvp","rassScore","bpsScore"] },
                      { label:"Sedation / Vasopressors",    icon:"pi-bolt",               keys:["sedation","vasopressors","vasopressorDetail"] },
                      { label:"System Assessment",          icon:"pi-list",               keys:["neuro","cvs","resp","renal","gi","haem","infective"] },
                      { label:"Daily Goals",                icon:"pi-check-square",       keys:["dailyGoals"] },
                    ],
                    procedure: [
                      { label:"Procedure Details",          icon:"pi-wrench",             keys:["procedureName","indication","time","surgeon","assistant","anaesthesia","position","consentObtained","laterality"] },
                      { label:"Technique & Findings",       icon:"pi-search",             keys:["technique","findings"] },
                      { label:"Outcome",                    icon:"pi-check-circle",       keys:["complications","bloodLoss","specimenSent","specimenType","postInstructions"] },
                    ],
                    consultation: [
                      { label:"Consultation",               icon:"pi-users",              keys:["consultantName","speciality","consultantRegNo","referredBy","reason"] },
                      { label:"Clinical Summary & Findings",icon:"pi-file-edit",          keys:["clinicalSummary","investigations","findings"] },
                      { label:"Impression & Recommendations",icon:"pi-check-circle",      keys:["impression","recommendations","followUp"] },
                    ],
                    preop: [
                      { label:"Patient & Procedure",        icon:"pi-user",               keys:["procedure","indication","preopDiagnosis","asaGrade","plannedAnaesthesia","bloodGroup"] },
                      { label:"Lab Reviews",                icon:"pi-check-square",       keys:["crossMatch","cbcReviewed","ptReviewed","ecgReviewed","cxrReviewed","echoReviewed","lftsReviewed","rftReviewed"] },
                      { label:"Pre-op Plan",                icon:"pi-list",               keys:["comorbidities","currentMeds","allergies","consentObtained","surgeon","anaesthetist","preopOrders"] },
                    ],
                    postop: [
                      { label:"Operative Details",          icon:"pi-wrench",             keys:["procedurePerformed","operativeFindings","anaesthesia","surgeon","anaesthetist","startTime","endTime"] },
                      { label:"Fluids & Specimens",         icon:"pi-tint",               keys:["bloodLoss","transfusion","fluidsGiven","urineOutput","specimenSent","specimenType"] },
                      { label:"Post-op Status",             icon:"pi-home",               keys:["postopDiagnosis","conditionLeavingOT","recoveryInstructions","postopOrders"] },
                    ],
                    death: [
                      { label:"Cause of Death",             icon:"pi-exclamation-triangle",keys:["dateTime","causeDeath1","causeDeath2","causeDeath3","contributing"] },
                      { label:"Clinical Sequence",          icon:"pi-file",               keys:["sequenceOfEvents","modeOfDeath"] },
                      { label:"Administrative",             icon:"pi-clipboard",          keys:["dnrInPlace","familyInformed","familyInformedBy","familyInformedTime","mlc","pmAdvised","certificateIssued"] },
                    ],
                    amendment: [
                      { label:"Amendment",                  icon:"pi-pencil",             keys:["originalNoteId","correction","reason","witness"] },
                    ],
                  };

                  const fmtKey = k => NOTE_FIELD_LBL[k] || k.replace(/([A-Z])/g, " $1").trim();
                  const fmtVal = v => {
                    if (v === null || v === undefined || v === "" || v === false) return null;
                    if (typeof v === "boolean") return "✓ Yes";
                    if (Array.isArray(v)) {
                      if (!v.length) return null;
                      return v.map(x => typeof x === "object" ? (x.drug||x.drugFluid||x.name||JSON.stringify(x)) : String(x)).join(", ");
                    }
                    if (typeof v === "object") {
                      if ("systolic" in v) return `${v.systolic||"—"}/${v.diastolic||"—"}`;
                      const inner = Object.entries(v).filter(([,x])=>x).map(([k2,v2])=>`${k2}: ${v2}`).join(" | ");
                      return inner || null;
                    }
                    return String(v);
                  };

                  const summaryLine = (() => {
                    if (note.provisionalDiagnosis)          return note.provisionalDiagnosis.slice(0,70);
                    if (note.finalDiagnosis)                return note.finalDiagnosis.slice(0,70);
                    if (note.noteDetails?.provisionalDx)    return note.noteDetails.provisionalDx.slice(0,70);
                    if (note.noteDetails?.chiefComplaint)   return note.noteDetails.chiefComplaint.slice(0,70);
                    if (note.soap?.assessment)              return note.soap.assessment.slice(0,70);
                    if (note.soap?.plan)                    return note.soap.plan.slice(0,70);
                    if (note.noteDetails?.managementPlan)   return note.noteDetails.managementPlan.slice(0,70);
                    return null;
                  })();

                  return (
                    <div key={note._id || i}
                      style={{
                        margin:"0 16px", padding:"16px 16px 16px 0",
                        borderBottom: i < groupNotes.length-1 ? `1px solid ${C.border}` : "none",
                        display:"grid", gridTemplateColumns:"82px 1fr auto", gap:16, alignItems:"start",
                        borderLeft:`4px solid ${ns.dot}`, paddingLeft:16,
                        transition:"background .15s, border-radius .15s", cursor:"pointer",
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background=`${ns.bg}50`; e.currentTarget.style.borderRadius="12px"; e.currentTarget.style.margin="2px 16px"; }}
                      onMouseLeave={e => { e.currentTarget.style.background="transparent"; e.currentTarget.style.borderRadius="0"; e.currentTarget.style.margin="0 16px"; }}
                      onClick={toggleExpand}>

                      {/* ── Time column ── */}
                      <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:5, paddingTop:2 }}>
                        <div style={{ background:ns.bg, border:`1.5px solid ${ns.dot}30`, borderRadius:8, padding:"5px 8px", textAlign:"center", minWidth:64 }}>
                          <div style={{ fontFamily:"'DM Mono',monospace", fontSize:13, fontWeight:800, color:ns.color, lineHeight:1 }}>{timeStr}</div>
                          <div style={{ fontSize:8, fontWeight:700, color:ns.color+"aa", textTransform:"uppercase", letterSpacing:".5px", marginTop:3 }}>
                            {(note.shift||"morning")[0].toUpperCase()+(note.shift||"morning").slice(1)}
                          </div>
                        </div>
                        <div style={{ width:10, height:10, borderRadius:"50%", background:ns.dot, boxShadow:`0 0 0 3px ${ns.dot}30` }} />
                      </div>

                      {/* ── Body ── */}
                      <div>
                        {/* Badge row */}
                        <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:6, flexWrap:"wrap" }}>
                          <span style={{ padding:"3px 10px", borderRadius:5, fontSize:10, fontWeight:700, letterSpacing:".5px", background:ns.bg, color:ns.color, display:"flex", alignItems:"center", gap:5, flexShrink:0 }}>
                            {mod && <i className={`pi ${mod.icon}`} style={{ fontSize:10 }} />}
                            {mod?.label || "Daily Progress"}
                          </span>
                          <span style={{ padding:"2px 8px", borderRadius:4, fontSize:9, fontWeight:700, background:isSigned?C.greenL:C.amberL, color:isSigned?C.green:C.amber, border:`1px solid ${isSigned?C.greenB:C.amberB}` }}>
                            {isSigned ? "✓ SIGNED" : "DRAFT"}
                          </span>
                          {note.isCritical && <span style={{ background:C.red, color:"white", padding:"2px 8px", borderRadius:4, fontSize:9, fontWeight:700 }}>⚠ CRITICAL</span>}
                          {note.doctorName && <span style={{ fontSize:11, color:C.muted, marginLeft:2 }}>{note.doctorName}</span>}
                          {note.doctorRegNo && <span style={{ fontSize:10, color:C.muted }}>Reg: {note.doctorRegNo}</span>}
                          {!isExpanded && summaryLine && (
                            <span style={{ fontSize:11, color:C.muted, fontStyle:"italic", marginLeft:4, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", maxWidth:280 }}>— {summaryLine}{summaryLine.length>=60?"…":""}</span>
                          )}
                        </div>

                        {/* ── Expanded content ── */}
                        {isExpanded && (
                          <div onClick={e => e.stopPropagation()}>

                            {/* SOAP */}
                            {note.soap && (() => {
                              const sf=[{k:"subjective",l:"S — Subjective",c:C.blue},{k:"objective",l:"O — Objective",c:C.teal},{k:"assessment",l:"A — Assessment",c:C.amber},{k:"plan",l:"P — Plan",c:C.green}].filter(s=>note.soap[s.k]);
                              if (!sf.length) return null;
                              return (
                                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:7, marginBottom:10 }}>
                                  {sf.map(s=>(
                                    <div key={s.k} style={{ padding:"8px 12px", background:"#f8fafc", borderRadius:7, borderLeft:`3px solid ${s.c}` }}>
                                      <div style={{ fontSize:9, fontWeight:800, color:s.c, textTransform:"uppercase", letterSpacing:".6px", marginBottom:3 }}>{s.l}</div>
                                      <div style={{ fontSize:12, color:C.text, lineHeight:1.6 }}>{note.soap[s.k]}</div>
                                    </div>
                                  ))}
                                </div>
                              );
                            })()}

                            {/* Top-level diagnosis */}
                            {(note.provisionalDiagnosis||note.finalDiagnosis) && (
                              <div style={{ display:"flex", gap:12, flexWrap:"wrap", marginBottom:8, padding:"6px 10px", background:"#fffbeb", borderRadius:6, border:"1px solid #fde68a" }}>
                                {note.provisionalDiagnosis && <span style={{ fontSize:12, color:C.text }}><b style={{ color:C.amber }}>Provisional:</b> {note.provisionalDiagnosis}</span>}
                                {note.finalDiagnosis && <span style={{ fontSize:12, color:C.text }}><b style={{ color:C.green }}>Final:</b> {note.finalDiagnosis}</span>}
                              </div>
                            )}

                            {/* Investigations (array-type top-level) */}
                            {note.investigations?.length > 0 && (
                              <div style={{ display:"flex", gap:5, flexWrap:"wrap", marginBottom:8, alignItems:"center" }}>
                                <span style={{ fontSize:10, fontWeight:700, color:C.muted }}>Investigations:</span>
                                {note.investigations.map((inv,ii)=>(
                                  <span key={ii} style={{ padding:"2px 8px", borderRadius:4, fontSize:10, fontWeight:600, background:C.purpleL, color:C.purple, border:`1px solid ${C.purpleB}` }}>{inv}</span>
                                ))}
                              </div>
                            )}

                            {/* Orders (top-level) */}
                            {note.orders?.length > 0 && (
                              <div style={{ display:"flex", gap:5, flexWrap:"wrap", marginBottom:8, alignItems:"center" }}>
                                <span style={{ fontSize:10, fontWeight:700, color:C.muted }}>Orders ({note.orders.length}):</span>
                                {note.orders.slice(0,4).map((o,oi)=>(
                                  <span key={oi} style={{ padding:"2px 8px", borderRadius:4, fontSize:10, fontWeight:600, background:C.blueL, color:C.blue, border:`1px solid ${C.blueB}` }}>{o.instruction?.slice(0,36)}</span>
                                ))}
                                {note.orders.length>4 && <span style={{ fontSize:10, color:C.muted }}>+{note.orders.length-4} more</span>}
                              </div>
                            )}

                            {/* Vitals strip */}
                            {note.vitals && (() => {
                              const v=note.vitals;
                              const bpStr=v.bp?`${v.bp.systolic||"—"}/${v.bp.diastolic||"—"}`:null;
                              const vf=[{l:"BP",v:bpStr},{l:"Pulse",v:v.pulse?`${v.pulse}/min`:null},{l:"Temp",v:v.temp?`${v.temp}°F`:null},{l:"SpO₂",v:v.spo2?`${v.spo2}%`:null},{l:"RR",v:v.rr?`${v.rr}/min`:null},{l:"BSL",v:v.bsl?`${v.bsl}mg/dL`:null},{l:"GCS",v:v.gcs?String(v.gcs):null},{l:"Urine",v:v.urine?`${v.urine}mL`:null}].filter(f=>f.v);
                              if (!vf.length) return null;
                              return (
                                <div style={{ display:"flex", gap:"5px 14px", flexWrap:"wrap", padding:"8px 12px", background:"#eff6ff", borderRadius:7, border:"1px solid #bfdbfe", marginBottom:8 }}>
                                  <span style={{ fontSize:9, fontWeight:800, textTransform:"uppercase", color:C.blue, alignSelf:"center", minWidth:44 }}>Vitals</span>
                                  {vf.map(f=>(
                                    <div key={f.l} style={{ display:"flex", flexDirection:"column", gap:1 }}>
                                      <span style={{ fontSize:9, fontWeight:700, textTransform:"uppercase", letterSpacing:".5px", color:C.muted }}>{f.l}</span>
                                      <span style={{ fontFamily:"'DM Mono',monospace", fontSize:11, fontWeight:600, color:C.text }}>{f.v}</span>
                                    </div>
                                  ))}
                                </div>
                              );
                            })()}

                            {/* Tags */}
                            {note.tags?.length > 0 && (
                              <div style={{ display:"flex", gap:4, flexWrap:"wrap", marginBottom:8 }}>
                                {note.tags.map(t=>(
                                  <span key={t} style={{ padding:"2px 8px", borderRadius:4, fontSize:10, fontWeight:600, background:"#f0fdf4", color:"#15803d", border:"1px solid #bbf7d0" }}>{t}</span>
                                ))}
                              </div>
                            )}

                            {/* ── noteDetails: SECTIONED renderer ── */}
                            {note.noteDetails && (() => {
                              const nd = note.noteDetails;
                              if (typeof nd !== "object" || Array.isArray(nd)) return null;
                              const medOrds = nd.medicationOrders;
                              const infOrds = nd.infusionOrders;
                              const SKIP_KEYS = new Set(["medicationOrders","infusionOrders"]);
                              const sections = NOTE_SECTIONS[note.noteType];

                              /* Reusable med/inf order rows */
                              const medInfBlocks = (
                                <>
                                  {medOrds?.length > 0 && (
                                    <div style={{ padding:"6px 12px", background:C.blueL, borderRadius:7, border:`1px solid ${C.blueB}` }}>
                                      <div style={{ fontSize:9, fontWeight:800, textTransform:"uppercase", letterSpacing:".5px", color:C.blue, marginBottom:5 }}>MEDICATION ORDERS ({medOrds.length})</div>
                                      <div style={{ display:"flex", gap:"4px 10px", flexWrap:"wrap" }}>
                                        {medOrds.slice(0,5).map((m,mi)=>(
                                          <span key={mi} style={{ padding:"2px 8px", borderRadius:4, fontSize:10, fontWeight:600, background:"white", color:C.blue, border:`1px solid ${C.blueB}` }}>
                                            {m.drug||"—"}{m.dose?` ${m.dose}`:""}{m.route?` · ${m.route}`:""}{m.frequency?` · ${m.frequency}`:""}
                                          </span>
                                        ))}
                                        {medOrds.length>5 && <span style={{ fontSize:10, color:C.muted }}>+{medOrds.length-5} more</span>}
                                      </div>
                                    </div>
                                  )}
                                  {infOrds?.length > 0 && (
                                    <div style={{ padding:"6px 12px", background:C.tealL, borderRadius:7, border:`1px solid ${C.tealB}` }}>
                                      <div style={{ fontSize:9, fontWeight:800, textTransform:"uppercase", letterSpacing:".5px", color:C.teal, marginBottom:5 }}>INFUSION ORDERS ({infOrds.length})</div>
                                      <div style={{ display:"flex", gap:"4px 10px", flexWrap:"wrap" }}>
                                        {infOrds.slice(0,5).map((inf,ii)=>(
                                          <span key={ii} style={{ padding:"2px 8px", borderRadius:4, fontSize:10, fontWeight:600, background:"white", color:C.teal, border:`1px solid ${C.tealB}` }}>
                                            {inf.drugFluid||inf.type||"—"}{inf.volume?` ${inf.volume}mL`:""}{inf.rate?` @ ${inf.rate}`:""}
                                          </span>
                                        ))}
                                        {infOrds.length>5 && <span style={{ fontSize:10, color:C.muted }}>+{infOrds.length-5} more</span>}
                                      </div>
                                    </div>
                                  )}
                                </>
                              );

                              if (sections) {
                                /* Known note type — render by defined section */
                                const renderedSecs = sections.map(sec => {
                                  const items = sec.keys
                                    .filter(k => k in nd)
                                    .map(k => ({ key:k, label:fmtKey(k), raw:nd[k], isLong:LONG_FIELDS.has(k) }))
                                    .filter(item => {
                                      const v=item.raw;
                                      if (v===null||v===undefined||v===""||v===false) return false;
                                      if (Array.isArray(v)&&!v.length) return false;
                                      return true;
                                    });
                                  return items.length ? { ...sec, items } : null;
                                }).filter(Boolean);

                                if (!renderedSecs.length && !medOrds?.length && !infOrds?.length) return null;
                                return (
                                  <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                                    {renderedSecs.map(sec=>(
                                      <div key={sec.label} style={{ borderRadius:8, border:`1px solid ${ns.dot}25`, overflow:"hidden" }}>
                                        {/* Section header */}
                                        <div style={{ padding:"6px 12px", background:ns.bg, borderBottom:`1px solid ${ns.dot}20`, display:"flex", alignItems:"center", gap:6 }}>
                                          {sec.icon && <i className={`pi ${sec.icon}`} style={{ fontSize:10, color:ns.color }} />}
                                          <span style={{ fontSize:9, fontWeight:800, textTransform:"uppercase", letterSpacing:".7px", color:ns.color }}>{sec.label}</span>
                                        </div>
                                        {/* Section body */}
                                        <div style={{ padding:"8px 12px", background:"#fafbfc", display:"flex", flexDirection:"column", gap:7 }}>
                                          {/* Long text as readable paragraphs */}
                                          {sec.items.filter(item=>item.isLong).map(item=>(
                                            <div key={item.key}>
                                              <div style={{ fontSize:9, fontWeight:700, textTransform:"uppercase", letterSpacing:".5px", color:C.muted, marginBottom:3 }}>{item.label}</div>
                                              <div style={{ fontSize:12, color:C.text, lineHeight:1.75, paddingLeft:2 }}>
                                                {typeof item.raw==="string" ? item.raw : Array.isArray(item.raw) ? item.raw.join(", ") : fmtVal(item.raw)}
                                              </div>
                                            </div>
                                          ))}
                                          {/* Short chip fields */}
                                          {sec.items.filter(item=>!item.isLong).length > 0 && (
                                            <div style={{ display:"flex", gap:"5px 14px", flexWrap:"wrap" }}>
                                              {sec.items.filter(item=>!item.isLong).map(item=>(
                                                <div key={item.key} style={{ display:"flex", flexDirection:"column", gap:1 }}>
                                                  <span style={{ fontSize:9, fontWeight:700, textTransform:"uppercase", letterSpacing:".5px", color:C.muted }}>{item.label}</span>
                                                  <span style={{ fontFamily:"'DM Mono',monospace", fontSize:11, fontWeight:600, color:C.text }}>{fmtVal(item.raw)}</span>
                                                </div>
                                              ))}
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    ))}
                                    {medInfBlocks}
                                  </div>
                                );
                              } else {
                                /* Unknown / daily note type — flat fallback */
                                const allChips = Object.entries(nd)
                                  .filter(([k])=>!SKIP_KEYS.has(k))
                                  .map(([k,v])=>({ key:k, label:fmtKey(k), raw:v, value:fmtVal(v), isLong:LONG_FIELDS.has(k) }))
                                  .filter(c=>c.value!==null);
                                if (!allChips.length && !medOrds?.length && !infOrds?.length) return null;
                                return (
                                  <div style={{ display:"flex", flexDirection:"column", gap:7 }}>
                                    {allChips.filter(c=>c.isLong).map(c=>(
                                      <div key={c.key} style={{ padding:"6px 10px", background:ns.bg+"40", borderRadius:6, border:`1px solid ${ns.dot}20` }}>
                                        <div style={{ fontSize:9, fontWeight:700, textTransform:"uppercase", color:C.muted, marginBottom:3 }}>{c.label}</div>
                                        <div style={{ fontSize:12, color:C.text, lineHeight:1.7 }}>{c.raw||c.value}</div>
                                      </div>
                                    ))}
                                    {allChips.filter(c=>!c.isLong).length > 0 && (
                                      <div style={{ padding:"7px 10px", background:ns.bg, borderRadius:7, border:`1px solid ${ns.dot}20` }}>
                                        <div style={{ fontSize:9, fontWeight:800, textTransform:"uppercase", letterSpacing:".5px", color:ns.color, marginBottom:5 }}>{mod?.label||"Note Details"}</div>
                                        <div style={{ display:"flex", gap:"5px 14px", flexWrap:"wrap" }}>
                                          {allChips.filter(c=>!c.isLong).map(c=>(
                                            <div key={c.key} style={{ display:"flex", flexDirection:"column", gap:1 }}>
                                              <span style={{ fontSize:9, fontWeight:700, textTransform:"uppercase", letterSpacing:".5px", color:C.muted }}>{c.label}</span>
                                              <span style={{ fontFamily:"'DM Mono',monospace", fontSize:11, fontWeight:500, color:C.text }}>{c.value}</span>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                    {medInfBlocks}
                                  </div>
                                );
                              }
                            })()}

                          </div>
                        )}
                      </div>

                      {/* ── Actions ── */}
                      <div onClick={e => e.stopPropagation()} style={{ display:"flex", flexDirection:"column", gap:5, alignItems:"flex-end", flexShrink:0 }}>
                        <button onClick={toggleExpand}
                          style={{ padding:"5px 12px", border:`1.5px solid ${isExpanded?C.primary+"60":C.border}`, borderRadius:6, background:isExpanded?C.primaryL:"white", fontSize:11, fontWeight:700, cursor:"pointer", color:isExpanded?C.primary:C.muted, display:"flex", alignItems:"center", gap:5, transition:"all .15s", whiteSpace:"nowrap" }}>
                          <i className={`pi ${isExpanded?"pi-times":"pi-eye"}`} style={{ fontSize:10 }} />
                          {isExpanded ? "Close" : "View"}
                        </button>
                        <button onClick={() => printNote(note)}
                          style={{ padding:"4px 10px", border:`1.5px solid ${C.border}`, borderRadius:6, background:"white", fontSize:11, fontWeight:600, cursor:"pointer", color:C.muted, display:"flex", alignItems:"center", gap:4 }}>
                          <i className="pi pi-print" style={{ fontSize:10 }} /> Print
                        </button>
                        {!isSigned && (
                          <button onClick={() => openEditModal(note)}
                            style={{ padding:"4px 10px", border:`1.5px solid ${C.blueB}`, borderRadius:6, background:C.blueL, fontSize:11, fontWeight:700, cursor:"pointer", color:C.blue, display:"flex", alignItems:"center", gap:4 }}>
                            <i className="pi pi-pencil" style={{ fontSize:10 }} /> Edit
                          </button>
                        )}
                        {!isSigned && (
                          <button onClick={() => signNote(note._id)}
                            style={{ padding:"4px 10px", border:`1.5px solid ${C.greenB}`, borderRadius:6, background:C.greenL, fontSize:11, fontWeight:700, cursor:"pointer", color:C.green, display:"flex", alignItems:"center", gap:4 }}>
                            <i className="pi pi-check" style={{ fontSize:10 }} /> Sign
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </>
      )}

      {/* ══════════════ MODAL ══════════════ */}
      {activeModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.6)", backdropFilter: "blur(4px)", zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          onClick={() => { setActiveModal(null); setEditingNote(null); }}>
          <div style={{ background: "white", borderRadius: 16, width: ["medication","infusion","initial"].includes(activeModal) ? 1060 : 740, maxWidth: "98vw", maxHeight: "94vh", overflowY: "auto", boxShadow: "0 24px 60px rgba(0,0,0,.28)" }}
            onClick={e => e.stopPropagation()}>

            {/* Modal Header */}
            <div style={{ padding: "16px 22px", background: `linear-gradient(135deg, ${C.primary}, ${C.primaryMid})`, color: "white", display: "flex", justifyContent: "space-between", alignItems: "center", borderRadius: "16px 16px 0 0", position: "sticky", top: 0, zIndex: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ width: 32, height: 32, borderRadius: 8, background: "rgba(255,255,255,.2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <i className={`pi ${modDef(activeModal)?.icon || "pi-file"}`} style={{ fontSize: 15, color: "white" }} />
                </span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15, display: "flex", alignItems: "center", gap: 8 }}>
                    {modDef(activeModal)?.label}
                    {editingNote && (
                      <span style={{ background: "rgba(255,255,255,.25)", borderRadius: 5, padding: "2px 8px", fontSize: 10, fontWeight: 700, letterSpacing: ".5px" }}>
                        ✎ EDITING DRAFT
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,.75)" }}>
                    {patient?.patientName || "—"} · IPD: {patient?.ipdNo || patient?.admissionNumber || "—"} · {doctorName}
                  </div>
                </div>
              </div>
              <button onClick={() => { setActiveModal(null); setEditingNote(null); }}
                style={{ background: "rgba(255,255,255,.2)", border: "none", color: "white", fontSize: 18, cursor: "pointer", width: 30, height: 30, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
            </div>

            <div style={{ padding: "20px 22px" }}>

              {/* ══ Initial Medical Assessment ══ */}
              {activeModal === "initial" && (() => {
                /* alias state so the form can use `ia.field` and `set(key, val)` */
                const ia  = initAssess;
                const set = (k, v) => setInitAssess(p => ({ ...p, [k]: v }));
                return (
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    <div style={{ background: "#fffbeb", border: "1.5px solid #fbbf24", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#92400e", fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
                      <i className="pi pi-clipboard" style={{ fontSize: 13 }} /> Initial Medical Assessment — NABH COP.1 · Must be signed within 24 hours of admission
                    </div>

                    {/* Admission details */}
                    <div style={{ background: "#f8fafc", borderRadius: 10, padding: "12px 14px", border: `1px solid ${C.border}` }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".6px", marginBottom: 10 }}>Admission Details</div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                        <FL label="Mode of Admission">
                          <select style={sel} value={ia.admissionMode} onChange={e => set("admissionMode", e.target.value)}>
                            {["Planned","Emergency","Transfer","OPD Referral","Day Care"].map(o => <option key={o}>{o}</option>)}
                          </select>
                        </FL>
                        <FL label="Chief Complaint *">
                          <input style={fld} value={ia.chiefComplaint} placeholder="e.g. Chest pain" onChange={e => set("chiefComplaint", e.target.value)} />
                        </FL>
                        <FL label="Duration">
                          <input style={fld} value={ia.duration} placeholder="e.g. 2 days" onChange={e => set("duration", e.target.value)} />
                        </FL>
                      </div>
                      <div style={{ marginTop: 10 }}>
                        <FL label="History of Present Illness *">
                          <textarea style={{ ...ta, minHeight: 72 }} value={ia.hpi} placeholder="Detailed history of the presenting complaint, onset, progression, associated symptoms, relevant negatives…" onChange={e => set("hpi", e.target.value)} />
                        </FL>
                      </div>
                    </div>

                    {/* Past History */}
                    <div style={{ background: "#f8fafc", borderRadius: 10, padding: "12px 14px", border: `1px solid ${C.border}` }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".6px", marginBottom: 10 }}>Past History</div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                        <FL label="Past Medical History"><textarea style={{ ...ta, minHeight: 48 }} value={ia.pastMedical} placeholder="HTN, DM, CAD, COPD, CKD, prior hospitalizations…" onChange={e => set("pastMedical", e.target.value)} /></FL>
                        <FL label="Past Surgical History"><textarea style={{ ...ta, minHeight: 48 }} value={ia.pastSurgical} placeholder="Previous operations, procedures, implants…" onChange={e => set("pastSurgical", e.target.value)} /></FL>
                        <FL label="Current Medications"><textarea style={{ ...ta, minHeight: 48 }} value={ia.currentMeds} placeholder="List all current medications with doses…" onChange={e => set("currentMeds", e.target.value)} /></FL>
                        <FL label="Allergies *">
                          <input style={{ ...fld, borderColor: ia.allergies && ia.allergies !== "NKDA" ? C.red : "#e2e8f0" }} value={ia.allergies} placeholder="NKDA or list allergens + reactions" onChange={e => set("allergies", e.target.value)} />
                          {ia.allergies && ia.allergies !== "NKDA" && (
                            <div style={{ fontSize: 10, color: C.red, fontWeight: 700, marginTop: 3 }}>⚠ Allergy documented — verify before prescribing</div>
                          )}
                        </FL>
                        <FL label="Family History"><input style={fld} value={ia.familyHistory} placeholder="Hereditary conditions, sudden cardiac death…" onChange={e => set("familyHistory", e.target.value)} /></FL>
                        <FL label="Social History"><input style={fld} value={ia.socialHistory} placeholder="Smoking, alcohol, occupation, marital status…" onChange={e => set("socialHistory", e.target.value)} /></FL>
                      </div>
                    </div>

                    {/* Vitals on Admission */}
                    <div style={{ background: "#f8fafc", borderRadius: 10, padding: "12px 14px", border: `1px solid ${C.border}` }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".6px", marginBottom: 10 }}>Vitals on Admission</div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8 }}>
                        {[{k:"bp_sys",l:"Systolic BP (mmHg)",ph:"120"},{k:"bp_dia",l:"Diastolic BP (mmHg)",ph:"80"},{k:"pulse",l:"Pulse (/min)",ph:"80"},{k:"temp",l:"Temp (°F)",ph:"98.6"},{k:"spo2",l:"SpO₂ (%)",ph:"98"},{k:"rr",l:"RR (/min)",ph:"16"},{k:"weight",l:"Weight (kg)",ph:"60"},{k:"height",l:"Height (cm)",ph:"165"},{k:"bsl",l:"BSL (mg/dL)",ph:"100"}].map(f => (
                          <FL key={f.k} label={f.l}><input type="number" style={fld} value={ia[f.k]} placeholder={f.ph} onChange={e => set(f.k, e.target.value)} /></FL>
                        ))}
                      </div>
                    </div>

                    {/* Physical Examination */}
                    <div style={{ background: "#f8fafc", borderRadius: 10, padding: "12px 14px", border: `1px solid ${C.border}` }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".6px", marginBottom: 10 }}>Physical Examination</div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, marginBottom: 10 }}>
                        {[
                          {k:"generalCondition",l:"General Condition",opts:["Conscious & Oriented","Alert","Drowsy","Confused","Unresponsive"]},
                          {k:"builtNutrition",l:"Built & Nutrition",opts:["Average","Good","Poor","Obese","Emaciated"]},
                          {k:"pallor",l:"Pallor",opts:["Absent","Present (mild)","Present (moderate)","Present (severe)"]},
                          {k:"icterus",l:"Icterus",opts:["Absent","Present (mild)","Present (moderate)","Present (severe)"]},
                          {k:"cyanosis",l:"Cyanosis",opts:["Absent","Peripheral","Central"]},
                          {k:"clubbing",l:"Clubbing",opts:["Absent","Present (Grade I)","Present (Grade II)","Present (Grade III)","Present (Grade IV)"]},
                          {k:"lymphadenopathy",l:"Lymphadenopathy",opts:["Absent","Present — cervical","Present — axillary","Present — inguinal","Generalised"]},
                          {k:"oedema",l:"Oedema",opts:["Absent","Pedal (pitting)","Pedal (non-pitting)","Sacral","Generalised"]},
                        ].map(f => (
                          <FL key={f.k} label={f.l}>
                            <select style={{ ...sel, fontSize: 11 }} value={ia[f.k]} onChange={e => set(f.k, e.target.value)}>
                              {f.opts.map(o => <option key={o}>{o}</option>)}
                            </select>
                          </FL>
                        ))}
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                        <FL label="Respiratory System"><textarea style={{ ...ta, minHeight: 48 }} value={ia.resp} placeholder="Breath sounds, added sounds, air entry…" onChange={e => set("resp", e.target.value)} /></FL>
                        <FL label="Cardiovascular System"><textarea style={{ ...ta, minHeight: 48 }} value={ia.cvs} placeholder="S1 S2, murmurs, JVP, peripheral pulses…" onChange={e => set("cvs", e.target.value)} /></FL>
                        <FL label="Abdomen"><textarea style={{ ...ta, minHeight: 48 }} value={ia.abdomen} placeholder="Inspection, palpation, percussion, auscultation…" onChange={e => set("abdomen", e.target.value)} /></FL>
                        <FL label="CNS / Neurological"><textarea style={{ ...ta, minHeight: 48 }} value={ia.cns} placeholder="Consciousness, GCS, cranial nerves, motor, sensory…" onChange={e => set("cns", e.target.value)} /></FL>
                      </div>
                    </div>

                    {/* Diagnosis */}
                    <div style={{ background: "#f8fafc", borderRadius: 10, padding: "12px 14px", border: `1px solid ${C.border}` }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".6px", marginBottom: 10 }}>Diagnosis</div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                        <FL label="Provisional Diagnosis *"><input style={fld} value={ia.provisionalDx} placeholder="Working diagnosis on admission" onChange={e => set("provisionalDx", e.target.value)} /></FL>
                        <FL label="Differential Diagnosis"><input style={fld} value={ia.differentialDx} placeholder="Differential diagnoses (comma separated)" onChange={e => set("differentialDx", e.target.value)} /></FL>
                        <FL label="Final Diagnosis (if known)"><input style={fld} value={ia.finalDx} placeholder="Confirmed diagnosis" onChange={e => set("finalDx", e.target.value)} /></FL>
                        <FL label="ICD-10 Code"><input style={fld} value={ia.icd10} placeholder="e.g. J18.9 — Pneumonia" onChange={e => set("icd10", e.target.value)} /></FL>
                      </div>
                    </div>

                    {/* Management Plan */}
                    <div style={{ background: "#f8fafc", borderRadius: 10, padding: "12px 14px", border: `1px solid ${C.border}` }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".6px", marginBottom: 10 }}>Investigations & Management Plan</div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                        <FL label="Investigations Ordered"><textarea style={{ ...ta, minHeight: 60 }} value={ia.investigations} placeholder="CBC, CMP, CXR, ECG, Echo, CT, MRI, cultures…" onChange={e => set("investigations", e.target.value)} /></FL>
                        <FL label="Management Plan *"><textarea style={{ ...ta, minHeight: 60 }} value={ia.managementPlan} placeholder="Treatment goals, monitoring plan, nursing orders, diet, activity, DVT prophylaxis, targets…" onChange={e => set("managementPlan", e.target.value)} /></FL>
                      </div>
                    </div>

                    {/* Embedded Medication Orders */}
                    {(() => {
                      const updateMed = (id, field, val) => setMedOrders(p => p.map(r => r.id === id ? { ...r, [field]: val } : r));
                      const addMed    = () => setMedOrders(p => [...p, emptyMedRow()]);
                      const removeMed = (id) => setMedOrders(p => p.filter(r => r.id !== id));
                      return (
                        <div style={{ background: "#eff6ff", borderRadius: 10, padding: "12px 14px", border: "1.5px solid #93c5fd" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: C.blue, textTransform: "uppercase", letterSpacing: ".6px" }}>
                              <i className="pi pi-tablet" style={{ marginRight: 6 }} />Medication Orders (NABH) — No overwrite · STOP + New Order only
                            </div>
                            <button onClick={addMed} style={{ padding: "5px 12px", background: C.blue, color: "white", border: "none", borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}>
                              <i className="pi pi-plus" style={{ fontSize: 10 }} /> Add Medication
                            </button>
                          </div>
                          <div style={{ overflowX: "auto" }}>
                            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                              <thead>
                                <tr style={{ background: "#dbeafe" }}>
                                  {["Date/Time","Drug *","Dose *","Route","Freq","Times (Auto)","Priority","HAM","Indication","Status","Stop Reason",""].map(h => (
                                    <th key={h} style={{ padding: "6px 8px", border: "1px solid #93c5fd", fontWeight: 700, color: C.blue, textAlign: "left", whiteSpace: "nowrap", fontSize: 10 }}>{h}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {medOrders.map(row => {
                                  const autoHam = isHAM_IA(row.drug);
                                  const hamActive = autoHam || row.hamOverride;
                                  return (
                                  <tr key={row.id} style={{ background: row.status === "Stopped" ? "#fef2f2" : hamActive ? "#fff7ed" : "white" }}>
                                    <td style={{ border: "1px solid #bfdbfe", padding: "4px" }}><input type="datetime-local" style={{ ...fld, fontSize: 10, padding: "4px 6px" }} value={row.datetime} onChange={e => updateMed(row.id, "datetime", e.target.value)} /></td>
                                    <td style={{ border: "1px solid #bfdbfe", padding: "4px", minWidth: 130 }}><input style={{ ...fld, fontSize: 11, padding: "4px 6px", fontWeight: 700 }} value={row.drug} placeholder="Drug name (generic)" onChange={e => updateMed(row.id, "drug", e.target.value)} /></td>
                                    <td style={{ border: "1px solid #bfdbfe", padding: "4px", minWidth: 80 }}><input style={{ ...fld, fontSize: 11, padding: "4px 6px" }} value={row.dose} placeholder="e.g. 500mg" onChange={e => updateMed(row.id, "dose", e.target.value)} /></td>
                                    <td style={{ border: "1px solid #bfdbfe", padding: "4px", minWidth: 100 }}>
                                      <select style={{ ...sel, fontSize: 11, padding: "4px 6px" }} value={row.route} onChange={e => updateMed(row.id, "route", e.target.value)}>
                                        {ROUTES.map(r => <option key={r}>{r}</option>)}
                                      </select>
                                    </td>
                                    <td style={{ border: "1px solid #bfdbfe", padding: "4px", minWidth: 90 }}>
                                      <select style={{ ...sel, fontSize: 11, padding: "4px 6px" }} value={row.frequency} onChange={e => updateMed(row.id, "frequency", e.target.value)}>
                                        {FREQ_LIST.map(f => <option key={f}>{f}</option>)}
                                      </select>
                                    </td>
                                    <td style={{ border: "1px solid #bfdbfe", padding: "4px", minWidth: 110, fontFamily: "monospace", fontSize: 10, color: C.blue, fontWeight: 700 }}>
                                      {(FREQ_TIMES[row.frequency] || []).join(" · ")}
                                    </td>
                                    {/* Priority */}
                                    <td style={{ border: "1px solid #bfdbfe", padding: "4px", minWidth: 85 }}>
                                      <select style={{ ...sel, fontSize: 10, padding: "3px 5px", fontWeight: 700, color: row.priority==="STAT"?C.red:row.priority==="Urgent"?C.amber:C.muted }} value={row.priority||"Routine"} onChange={e => updateMed(row.id, "priority", e.target.value)}>
                                        <option value="Routine">Routine</option>
                                        <option value="Urgent">🔶 Urgent</option>
                                        <option value="STAT">⚡ STAT</option>
                                      </select>
                                    </td>
                                    {/* HAM */}
                                    <td style={{ border: "1px solid #bfdbfe", padding: "4px", textAlign: "center", minWidth: 52 }}>
                                      {autoHam
                                        ? <span title="Auto-detected High Alert Medication" style={{ fontSize: 14 }}>🔴</span>
                                        : <input type="checkbox" title="Mark as High Alert Medication (HAM)" checked={!!row.hamOverride} onChange={e => updateMed(row.id, "hamOverride", e.target.checked)}
                                            style={{ width: 14, height: 14, cursor: "pointer", accentColor: C.red }} />}
                                    </td>
                                    <td style={{ border: "1px solid #bfdbfe", padding: "4px", minWidth: 110 }}><input style={{ ...fld, fontSize: 11, padding: "4px 6px" }} value={row.indication} placeholder="e.g. GI prophylaxis" onChange={e => updateMed(row.id, "indication", e.target.value)} /></td>
                                    <td style={{ border: "1px solid #bfdbfe", padding: "4px" }}>
                                      <select style={{ ...sel, fontSize: 11, padding: "4px 6px", color: row.status === "Stopped" ? C.red : C.green, fontWeight: 700 }} value={row.status} onChange={e => updateMed(row.id, "status", e.target.value)}>
                                        <option value="Active">Active</option>
                                        <option value="Stopped">Stopped</option>
                                      </select>
                                    </td>
                                    <td style={{ border: "1px solid #bfdbfe", padding: "4px", minWidth: 100 }}>
                                      <input style={{ ...fld, fontSize: 11, padding: "4px 6px", borderColor: row.status === "Stopped" && !row.stopReason ? C.red : "#e2e8f0" }} value={row.stopReason} placeholder={row.status === "Stopped" ? "Required!" : "—"} onChange={e => updateMed(row.id, "stopReason", e.target.value)} />
                                    </td>
                                    <td style={{ border: "1px solid #bfdbfe", padding: "4px" }}>
                                      <button onClick={() => removeMed(row.id)} style={{ width: 22, height: 22, borderRadius: 4, border: "1px solid #fca5a5", background: "#fef2f2", color: C.red, cursor: "pointer", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
                                    </td>
                                  </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      );
                    })()}

                    {/* Embedded Infusion Orders */}
                    {(() => {
                      const updateInf = (id, field, val) => setInfOrders(p => p.map(r => r.id === id ? { ...r, [field]: val } : r));
                      const addInf    = () => setInfOrders(p => [...p, emptyInfRow()]);
                      const removeInf = (id) => setInfOrders(p => p.filter(r => r.id !== id));
                      return (
                        <div style={{ background: "#f0fdfa", borderRadius: 10, padding: "12px 14px", border: "1.5px solid #99f6e4" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: C.teal, textTransform: "uppercase", letterSpacing: ".6px" }}>
                              <i className="pi pi-plus-circle" style={{ marginRight: 6 }} />Infusion Orders (NABH) — All changes must be documented · STOP infusion with reason
                            </div>
                            <button onClick={addInf} style={{ padding: "5px 12px", background: C.teal, color: "white", border: "none", borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}>
                              <i className="pi pi-plus" style={{ fontSize: 10 }} /> Add Infusion
                            </button>
                          </div>
                          <div style={{ overflowX: "auto" }}>
                            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                              <thead>
                                <tr style={{ background: "#ccfbf1" }}>
                                  {["Date/Time","Type","Drug / Fluid *","Dilution","Vol (ml)","Rate (ml/hr)","Titration Goal","Start","Priority","HAM","Status","Stop Reason",""].map(h => (
                                    <th key={h} style={{ padding: "6px 8px", border: "1px solid #99f6e4", fontWeight: 700, color: C.teal, textAlign: "left", whiteSpace: "nowrap", fontSize: 10 }}>{h}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {infOrders.map(row => {
                                  const autoHam = isHAM_IA(row.drugFluid);
                                  const hamActive = autoHam || row.hamOverride;
                                  return (
                                  <tr key={row.id} style={{ background: row.status === "Stopped" ? "#fef2f2" : hamActive ? "#fff7ed" : "white" }}>
                                    <td style={{ border: "1px solid #a7f3d0", padding: "4px" }}><input type="datetime-local" style={{ ...fld, fontSize: 10, padding: "4px 6px" }} value={row.datetime} onChange={e => updateInf(row.id, "datetime", e.target.value)} /></td>
                                    <td style={{ border: "1px solid #a7f3d0", padding: "4px" }}>
                                      <select style={{ ...sel, fontSize: 11, padding: "4px 6px" }} value={row.type} onChange={e => updateInf(row.id, "type", e.target.value)}>
                                        {["Fluid","Drug Infusion","Blood","Blood Product","TPN"].map(t => <option key={t}>{t}</option>)}
                                      </select>
                                    </td>
                                    <td style={{ border: "1px solid #a7f3d0", padding: "4px", minWidth: 140 }}><input style={{ ...fld, fontSize: 11, padding: "4px 6px", fontWeight: 700 }} value={row.drugFluid} placeholder="NS 0.9% / Noradrenaline / PRBC" onChange={e => updateInf(row.id, "drugFluid", e.target.value)} /></td>
                                    <td style={{ border: "1px solid #a7f3d0", padding: "4px", minWidth: 110 }}><input style={{ ...fld, fontSize: 11, padding: "4px 6px" }} value={row.dilution} placeholder="e.g. 4mg in 50ml NS" onChange={e => updateInf(row.id, "dilution", e.target.value)} /></td>
                                    <td style={{ border: "1px solid #a7f3d0", padding: "4px", minWidth: 70 }}><input type="number" style={{ ...fld, fontSize: 11, padding: "4px 6px" }} value={row.volume} placeholder="500" onChange={e => updateInf(row.id, "volume", e.target.value)} /></td>
                                    <td style={{ border: "1px solid #a7f3d0", padding: "4px", minWidth: 80 }}><input type="number" style={{ ...fld, fontSize: 11, padding: "4px 6px" }} value={row.rate} placeholder="100" onChange={e => updateInf(row.id, "rate", e.target.value)} /></td>
                                    <td style={{ border: "1px solid #a7f3d0", padding: "4px", minWidth: 120 }}><input style={{ ...fld, fontSize: 11, padding: "4px 6px" }} value={row.titrationGoal} placeholder="MAP > 65 / Hb > 8" onChange={e => updateInf(row.id, "titrationGoal", e.target.value)} /></td>
                                    <td style={{ border: "1px solid #a7f3d0", padding: "4px" }}><input type="time" style={{ ...fld, fontSize: 11, padding: "4px 6px" }} value={row.startTime} onChange={e => updateInf(row.id, "startTime", e.target.value)} /></td>
                                    {/* Priority */}
                                    <td style={{ border: "1px solid #a7f3d0", padding: "4px", minWidth: 85 }}>
                                      <select style={{ ...sel, fontSize: 10, padding: "3px 5px", fontWeight: 700, color: row.priority==="STAT"?C.red:row.priority==="Urgent"?C.amber:C.muted }} value={row.priority||"Routine"} onChange={e => updateInf(row.id, "priority", e.target.value)}>
                                        <option value="Routine">Routine</option>
                                        <option value="Urgent">🔶 Urgent</option>
                                        <option value="STAT">⚡ STAT</option>
                                      </select>
                                    </td>
                                    {/* HAM */}
                                    <td style={{ border: "1px solid #a7f3d0", padding: "4px", textAlign: "center", minWidth: 52 }}>
                                      {autoHam
                                        ? <span title="Auto-detected High Alert Medication" style={{ fontSize: 14 }}>🔴</span>
                                        : <input type="checkbox" title="Mark as High Alert Medication (HAM)" checked={!!row.hamOverride} onChange={e => updateInf(row.id, "hamOverride", e.target.checked)}
                                            style={{ width: 14, height: 14, cursor: "pointer", accentColor: C.red }} />}
                                    </td>
                                    <td style={{ border: "1px solid #a7f3d0", padding: "4px" }}>
                                      <select style={{ ...sel, fontSize: 11, padding: "4px 6px", color: row.status === "Stopped" ? C.red : C.teal, fontWeight: 700 }} value={row.status} onChange={e => updateInf(row.id, "status", e.target.value)}>
                                        <option value="Active">Active</option>
                                        <option value="Stopped">Stopped</option>
                                      </select>
                                    </td>
                                    <td style={{ border: "1px solid #a7f3d0", padding: "4px", minWidth: 100 }}>
                                      <input style={{ ...fld, fontSize: 11, padding: "4px 6px", borderColor: row.status === "Stopped" && !row.stopReason ? C.red : "#e2e8f0" }} value={row.stopReason} placeholder={row.status === "Stopped" ? "Required!" : "—"} onChange={e => updateInf(row.id, "stopReason", e.target.value)} />
                                    </td>
                                    <td style={{ border: "1px solid #a7f3d0", padding: "4px" }}>
                                      <button onClick={() => removeInf(row.id)} style={{ width: 22, height: 22, borderRadius: 4, border: "1px solid #fca5a5", background: "#fef2f2", color: C.red, cursor: "pointer", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
                                    </td>
                                  </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                );
              })()}

              {/* ══ MEDICATION ORDERS SHEET (standalone) ══ */}
              {activeModal === "medication" && (() => {
                const updateMed = (id, field, val) => setMedOrders(p => p.map(r => r.id === id ? { ...r, [field]: val } : r));
                const addMed    = () => setMedOrders(p => [...p, emptyMedRow()]);
                const removeMed = (id) => setMedOrders(p => p.filter(r => r.id !== id));
                return (
                  <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    <div style={{ background: C.blueL, border: `1.5px solid ${C.blueB}`, borderRadius: 8, padding: "10px 14px", fontSize: 12, color: C.blue, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
                      <i className="pi pi-tablet" style={{ fontSize: 13 }} />
                      Medication Order Sheet — NABH MOM.1 · No overwrite · STOP + New Order only · Frequency auto-generates MAR times
                    </div>
                    <div style={{ display: "flex", justifyContent: "flex-end" }}>
                      <button onClick={addMed} style={{ padding: "8px 18px", background: C.primary, color: "white", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
                        <i className="pi pi-plus" style={{ fontSize: 11 }} /> Add Medication Order
                      </button>
                    </div>
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                        <thead>
                          <tr style={{ background: C.blueL }}>
                            {["Date/Time","Drug *","Dose *","Route","Frequency","Times (Auto-MAR)","Indication","Status","Stop Reason",""].map(h => (
                              <th key={h} style={{ padding: "8px 10px", border: `1px solid ${C.blueB}`, fontWeight: 700, color: C.blue, textAlign: "left", whiteSpace: "nowrap", fontSize: 11 }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {medOrders.map((row, idx) => (
                            <tr key={row.id} style={{ background: row.status === "Stopped" ? "#fff1f2" : idx % 2 === 0 ? "white" : "#fafcff" }}>
                              <td style={{ border: `1px solid ${C.blueB}`, padding: "5px" }}><input type="datetime-local" style={{ ...fld, fontSize: 11, padding: "5px 7px" }} value={row.datetime} onChange={e => updateMed(row.id, "datetime", e.target.value)} /></td>
                              <td style={{ border: `1px solid ${C.blueB}`, padding: "5px", minWidth: 130 }}><input style={{ ...fld, fontSize: 12, padding: "5px 7px", fontWeight: 600 }} value={row.drug} placeholder="Drug name" onChange={e => updateMed(row.id, "drug", e.target.value)} /></td>
                              <td style={{ border: `1px solid ${C.blueB}`, padding: "5px", minWidth: 90 }}><input style={{ ...fld, fontSize: 12, padding: "5px 7px" }} value={row.dose} placeholder="500mg" onChange={e => updateMed(row.id, "dose", e.target.value)} /></td>
                              <td style={{ border: `1px solid ${C.blueB}`, padding: "5px", minWidth: 110 }}>
                                <select style={{ ...sel, fontSize: 11, padding: "5px 7px" }} value={row.route} onChange={e => updateMed(row.id, "route", e.target.value)}>
                                  {ROUTES.map(r => <option key={r}>{r}</option>)}
                                </select>
                              </td>
                              <td style={{ border: `1px solid ${C.blueB}`, padding: "5px", minWidth: 100 }}>
                                <select style={{ ...sel, fontSize: 12, padding: "5px 7px", fontWeight: 700 }} value={row.frequency} onChange={e => updateMed(row.id, "frequency", e.target.value)}>
                                  {FREQ_LIST.map(f => <option key={f}>{f}</option>)}
                                </select>
                              </td>
                              <td style={{ border: `1px solid ${C.blueB}`, padding: "5px", minWidth: 140, background: "#eff6ff" }}>
                                <div style={{ fontFamily: "monospace", fontSize: 11, color: C.blue, fontWeight: 700, lineHeight: 1.5 }}>
                                  {(FREQ_TIMES[row.frequency] || []).join(" · ")}
                                </div>
                              </td>
                              <td style={{ border: `1px solid ${C.blueB}`, padding: "5px", minWidth: 110 }}><input style={{ ...fld, fontSize: 11, padding: "5px 7px" }} value={row.indication} placeholder="Indication" onChange={e => updateMed(row.id, "indication", e.target.value)} /></td>
                              <td style={{ border: `1px solid ${C.blueB}`, padding: "5px" }}>
                                <select style={{ ...sel, fontSize: 12, padding: "5px 7px", color: row.status === "Stopped" ? C.red : C.green, fontWeight: 700 }} value={row.status} onChange={e => updateMed(row.id, "status", e.target.value)}>
                                  <option value="Active">Active</option>
                                  <option value="Stopped">Stopped</option>
                                </select>
                              </td>
                              <td style={{ border: `1px solid ${C.blueB}`, padding: "5px", minWidth: 120 }}>
                                <input style={{ ...fld, fontSize: 11, padding: "5px 7px", borderColor: row.status === "Stopped" && !row.stopReason ? C.red : "#e2e8f0", background: row.status === "Stopped" && !row.stopReason ? "#fef2f2" : "white" }} value={row.stopReason} placeholder={row.status === "Stopped" ? "Required ⚠" : "—"} onChange={e => updateMed(row.id, "stopReason", e.target.value)} />
                              </td>
                              <td style={{ border: `1px solid ${C.blueB}`, padding: "5px" }}>
                                <button onClick={() => removeMed(row.id)} title="Remove row" style={{ width: 24, height: 24, borderRadius: 5, border: "1px solid #fca5a5", background: "#fef2f2", color: C.red, cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}>×</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div style={{ background: "#f8fafc", borderRadius: 8, padding: "8px 12px", fontSize: 11, color: C.muted }}>
                      <b style={{ color: C.blue }}>MAR Note:</b> Times shown will be populated in the Medication Administration Record. STAT orders execute immediately. SOS orders as needed. Continuous infusions use the Infusion Orders module.
                    </div>
                  </div>
                );
              })()}

              {/* ══ INFUSION ORDERS SHEET (standalone) ══ */}
              {activeModal === "infusion" && (() => {
                const updateInf = (id, field, val) => setInfOrders(p => p.map(r => r.id === id ? { ...r, [field]: val } : r));
                const addInf    = () => setInfOrders(p => [...p, emptyInfRow()]);
                const removeInf = (id) => setInfOrders(p => p.filter(r => r.id !== id));
                return (
                  <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    <div style={{ background: C.tealL, border: `1.5px solid ${C.tealB}`, borderRadius: 8, padding: "10px 14px", fontSize: 12, color: C.teal, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
                      <i className="pi pi-plus-circle" style={{ fontSize: 13 }} />
                      Infusion Order & Monitoring Sheet — NABH MOM.2 · No overwrite · STOP infusion with reason · All changes documented
                    </div>
                    <div style={{ display: "flex", justifyContent: "flex-end" }}>
                      <button onClick={addInf} style={{ padding: "8px 18px", background: C.teal, color: "white", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
                        <i className="pi pi-plus" style={{ fontSize: 11 }} /> Add Infusion Order
                      </button>
                    </div>
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                        <thead>
                          <tr style={{ background: C.tealL }}>
                            {["Date/Time","Type","Drug / Fluid *","Dilution","Total Vol (ml)","Initial Rate (ml/hr)","Target / Titration Goal","Start Time","Status","Stop Reason",""].map(h => (
                              <th key={h} style={{ padding: "8px 10px", border: `1px solid ${C.tealB}`, fontWeight: 700, color: C.teal, textAlign: "left", whiteSpace: "nowrap", fontSize: 11 }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {infOrders.map((row, idx) => (
                            <tr key={row.id} style={{ background: row.status === "Stopped" ? "#fff1f2" : idx % 2 === 0 ? "white" : "#f0fdfa" }}>
                              <td style={{ border: `1px solid ${C.tealB}`, padding: "5px" }}><input type="datetime-local" style={{ ...fld, fontSize: 11, padding: "5px 7px" }} value={row.datetime} onChange={e => updateInf(row.id, "datetime", e.target.value)} /></td>
                              <td style={{ border: `1px solid ${C.tealB}`, padding: "5px", minWidth: 110 }}>
                                <select style={{ ...sel, fontSize: 11, padding: "5px 7px" }} value={row.type} onChange={e => updateInf(row.id, "type", e.target.value)}>
                                  {["Fluid","Drug Infusion","Blood","Blood Product","TPN"].map(t => <option key={t}>{t}</option>)}
                                </select>
                              </td>
                              <td style={{ border: `1px solid ${C.tealB}`, padding: "5px", minWidth: 140 }}><input style={{ ...fld, fontSize: 12, padding: "5px 7px", fontWeight: 600 }} value={row.drugFluid} placeholder="NS 0.9% / Noradrenaline / PRBC" onChange={e => updateInf(row.id, "drugFluid", e.target.value)} /></td>
                              <td style={{ border: `1px solid ${C.tealB}`, padding: "5px", minWidth: 120 }}><input style={{ ...fld, fontSize: 11, padding: "5px 7px" }} value={row.dilution} placeholder="e.g. 2mg in 50ml NS" onChange={e => updateInf(row.id, "dilution", e.target.value)} /></td>
                              <td style={{ border: `1px solid ${C.tealB}`, padding: "5px", minWidth: 75 }}><input type="number" style={{ ...fld, fontSize: 12, padding: "5px 7px" }} value={row.volume} placeholder="500" onChange={e => updateInf(row.id, "volume", e.target.value)} /></td>
                              <td style={{ border: `1px solid ${C.tealB}`, padding: "5px", minWidth: 90 }}><input type="number" style={{ ...fld, fontSize: 12, padding: "5px 7px" }} value={row.rate} placeholder="100" onChange={e => updateInf(row.id, "rate", e.target.value)} /></td>
                              <td style={{ border: `1px solid ${C.tealB}`, padding: "5px", minWidth: 140 }}><input style={{ ...fld, fontSize: 11, padding: "5px 7px" }} value={row.titrationGoal} placeholder="MAP > 65 / Hb > 8" onChange={e => updateInf(row.id, "titrationGoal", e.target.value)} /></td>
                              <td style={{ border: `1px solid ${C.tealB}`, padding: "5px" }}><input type="time" style={{ ...fld, fontSize: 11, padding: "5px 7px" }} value={row.startTime} onChange={e => updateInf(row.id, "startTime", e.target.value)} /></td>
                              <td style={{ border: `1px solid ${C.tealB}`, padding: "5px" }}>
                                <select style={{ ...sel, fontSize: 12, padding: "5px 7px", color: row.status === "Stopped" ? C.red : C.teal, fontWeight: 700 }} value={row.status} onChange={e => updateInf(row.id, "status", e.target.value)}>
                                  <option value="Active">Active</option>
                                  <option value="Stopped">Stopped</option>
                                </select>
                              </td>
                              <td style={{ border: `1px solid ${C.tealB}`, padding: "5px", minWidth: 120 }}>
                                <input style={{ ...fld, fontSize: 11, padding: "5px 7px", borderColor: row.status === "Stopped" && !row.stopReason ? C.red : "#e2e8f0", background: row.status === "Stopped" && !row.stopReason ? "#fef2f2" : "white" }} value={row.stopReason} placeholder={row.status === "Stopped" ? "Required ⚠" : "—"} onChange={e => updateInf(row.id, "stopReason", e.target.value)} />
                              </td>
                              <td style={{ border: `1px solid ${C.tealB}`, padding: "5px" }}>
                                <button onClick={() => removeInf(row.id)} title="Remove row" style={{ width: 24, height: 24, borderRadius: 5, border: "1px solid #fca5a5", background: "#fef2f2", color: C.red, cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}>×</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div style={{ background: "#f0fdfa", borderRadius: 8, padding: "8px 12px", fontSize: 11, color: C.muted }}>
                      <b style={{ color: C.teal }}>Nursing Note:</b> All rate changes, stops, and restarts must be documented in Nursing Notes with time, reason, and nurse signature. Monitoring vitals every 30 min for vasoactive infusions.
                    </div>
                  </div>
                );
              })()}

              {/* ══ DAILY PROGRESS NOTE (SOAP) ══ */}
              {activeModal === "daily" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  {/* Vitals Row */}
                  <div style={{ background: "#f8fafc", border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 14px" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".6px", marginBottom: 10 }}>Objective Vitals (NABH COP.2)</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8 }}>
                      {[{k:"bp_sys",l:"Systolic BP (mmHg)",p:"120"},{k:"bp_dia",l:"Diastolic BP (mmHg)",p:"80"},{k:"pulse",l:"Pulse (/min)",p:"80"},{k:"temp",l:"Temp (°F)",p:"98.6"},{k:"spo2",l:"SpO₂ (%)",p:"98"},{k:"rr",l:"RR (/min)",p:"16"},{k:"bsl",l:"BSL (mg/dL)",p:"110"},{k:"gcs",l:"GCS",p:"E4V5M6"},{k:"urine",l:"Urine (mL/hr)",p:"50"}].map(v => (
                        <FL key={v.k} label={v.l}>
                          <input type={v.k==="gcs"?"text":"number"} style={{ ...fld, fontSize: 12 }} value={vitals[v.k]} placeholder={v.p} onChange={e => setVitals(p => ({ ...p, [v.k]: e.target.value }))} />
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
            <div style={{ padding: "14px 22px", borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", background: C.bg, borderRadius: "0 0 16px 16px", position: "sticky", bottom: 0, flexWrap: "wrap", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <AutoSaveIndicator savedAt={savedAt} hasDraft={hasDraft} />
                <button onClick={() => setShowSetup(true)}
                  style={{ padding:"6px 11px", background: signature ? "#f0fdf4" : "#fffbeb", border:`1.5px solid ${signature ? "#bbf7d0" : "#fde68a"}`, borderRadius:8, cursor:"pointer", fontSize:10, fontWeight:700, color: signature ? "#16a34a" : "#92400e", display:"flex", alignItems:"center", gap:4 }}>
                  {signature ? <><i className="pi pi-verified" style={{ fontSize:10 }} /> Sig Set</> : <><i className="pi pi-pen-to-square" style={{ fontSize:10 }} /> Setup Sig</>}
                </button>
                <div style={{ fontSize: 11, color: C.muted, display: "flex", alignItems: "center", gap: 6 }}>
                  <i className="pi pi-user" style={{ fontSize: 10 }} />{doctorName}
                  {doctorRegNo && <><span>·</span><span>Reg: {doctorRegNo}</span></>}
                  <span style={{ ...SHIFT_STYLE[shift], padding: "1px 7px", borderRadius: 4, fontSize: 10, fontWeight: 700 }}>{shift[0].toUpperCase() + shift.slice(1)}</span>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => { setActiveModal(null); setEditingNote(null); }} style={{ padding: "9px 20px", border: `1.5px solid ${C.border}`, borderRadius: 8, background: "white", fontFamily: "'DM Sans',sans-serif", fontSize: 13, fontWeight: 600, cursor: "pointer", color: C.muted }}>Cancel</button>
                <button onClick={() => saveNote("draft")} disabled={saving}
                  style={{ padding: "9px 20px", border: `1.5px solid ${C.amberB}`, borderRadius: 8, background: C.amberL, fontFamily: "'DM Sans',sans-serif", fontSize: 13, fontWeight: 700, cursor: saving ? "not-allowed" : "pointer", color: C.amber, display: "flex", alignItems: "center", gap: 6 }}>
                  <i className={`pi ${editingNote ? "pi-refresh" : "pi-save"}`} style={{ fontSize: 11 }} />
                  {editingNote ? "Update Draft" : "Save Draft"}
                </button>
                <button onClick={() => { if (!signature) { setShowSetup(true); toast.info("Please set your signature first"); return; } saveNote("signed"); }} disabled={saving}
                  style={{ padding: "9px 28px", background: saving ? "#5eead4" : `linear-gradient(135deg, ${C.primary}, ${C.primaryMid})`, color: "white", border: "none", borderRadius: 8, fontFamily: "'DM Sans',sans-serif", fontSize: 13, fontWeight: 700, cursor: saving ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: 7, boxShadow: `0 4px 12px ${C.primary}35` }}>
                  <i className={`pi ${saving ? "pi-spin pi-spinner" : "pi-check-circle"}`} style={{ fontSize: 12 }} />
                  {saving ? "Saving…" : "Sign & Submit"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══ SIGNATURE PAD MODAL ══ */}
      {showSetup && (
        <SignaturePad
          existing={signature}
          onSave={async (dataUrl) => { await saveSignature(dataUrl); setShowSetup(false); }}
          onCancel={() => setShowSetup(false)}
        />
      )}

      {/* ══ INITIAL ASSESSMENT MODAL ══ */}
      {showAssessmentModal && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 1200, background: "rgba(15,23,42,.65)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          onClick={() => setShowAssessmentModal(false)}
        >
          <div
            style={{ background: "white", borderRadius: 16, width: "min(1100px, 96vw)", maxHeight: "92vh", display: "flex", flexDirection: "column", boxShadow: "0 24px 60px rgba(0,0,0,.35)", overflow: "hidden" }}
            onClick={e => e.stopPropagation()}
          >
            {/* Modal header */}
            <div style={{ padding: "14px 22px", background: `linear-gradient(135deg, ${C.primary}, ${C.primaryMid})`, color: "white", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ width: 32, height: 32, borderRadius: 8, background: "rgba(255,255,255,.2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <i className="pi pi-clipboard" style={{ fontSize: 15, color: "white" }} />
                </span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>Initial Assessment — NABH COP.1</div>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,.75)" }}>
                    {patient?.patientName || patient?.patientId?.fullName || "—"} · IPD: {patient?.ipdNo || patient?.admissionNumber || "—"}
                  </div>
                </div>
              </div>
              <button onClick={() => setShowAssessmentModal(false)}
                style={{ background: "rgba(255,255,255,.2)", border: "none", color: "white", fontSize: 20, cursor: "pointer", width: 32, height: 32, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}>×</button>
            </div>
            {/* Scrollable content */}
            <div style={{ flex: 1, overflowY: "auto", background: "#f0f2f5", padding: "20px 24px" }}>
              <DoctorAssessmentContent selectedPatient={patient} />
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
