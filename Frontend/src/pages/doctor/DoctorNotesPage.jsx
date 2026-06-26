import React, { useState, useEffect, useRef } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { API_ENDPOINTS } from "../../config/api";
import { useAuth } from "../../context/AuthContext";
import { toast } from "react-toastify";
import ClinicalLayout from "../../Components/clinical/ClinicalLayout";
import PatientHeaderCard from "../../Components/clinical/PatientHeaderCard";
// R7hr-86 — patient-safety alert chips (allergies + assessment compliance)
// now live next to the All Sections back button, not inside the card footer.
import PatientAlertStrip from "../../Components/clinical/PatientAlertStrip";
// R7cb-C: hospital settings for the printed note header.
import { fetchHospitalSettings } from "../../Components/print/useHospitalSettings";
// R7fq Track C: shared print shell — replaces inline hospital header/footer
// HTML in printNote() with a SGRH-style triple-zone header + 2-col patient
// strip + role-aware signature zone. The doctor-note body (SOAP grid +
// vitals + noteDetails recursion from R7fp) goes in bodyHtml.
import { buildPrintShellHtml } from "@/templates/PrintShell";
import "../../Components/clinical/clinical-forms.css";
// Roadmap follow-up — new dnp-* design system for the recorded-notes
// timeline. Form modals + save/sign flow remain untouched.
import "../../pages/patient/patient-file.css";
import "./note-page-redesign.css";
// R7az — DoctorAssessmentContent import removed. The fullscreen Initial
// Assessment modal that mounted this component is gone (user wanted a
// single per-patient assessment surface). The "Initial Assessment" chip
// in the Add Note card grid now opens the existing inline activeModal
// === "initial" form (further down in this file) instead of popping a
// modal. The standalone /doctor-opd-panel route still imports
// DoctorAssessmentContent directly when needed.
// R7ax — Inline-embed the 4 surfaces that used to live as standalone
// sidebar entries (Emergency / Discharge / Consent / MLC). Importing
// the named *Content components lets DoctorNotes render them as panels
// alongside Diagnosis / Orders / MAR / Team / Add Note / Timeline so
// the "Back to All Sections" button returns to the tile grid without
// a hard route change. Default-exported page versions still exist on
// the standalone /emergency-assessment, /discharge-summary,
// /consent-forms, /mlc routes for direct deep-links.
import { EmergencyAssessmentPageContent } from "../emergency/EmergencyAssessmentPage";
// R7ev — IPD/Planned/Daycare admissions need the IPD Initial Assessment
// (no triage steps, no bed allotment at the end — patient is already
// admitted). Emergency admissions keep using EmergencyAssessmentPageContent.
import { IPDInitialAssessmentContent } from "../clinical/IPDInitialAssessmentPage";
import { DischargeSummaryPageContent } from "../clinical/DischargeSummaryPage";
import { ConsentFormPageContent } from "../clinical/ConsentFormPage";
import { MLCPageContent } from "../mlc/MLCPage";
import DoctorOrdersPanel from "../../Components/doctor/DoctorOrdersPanel";
// R7hr-231 — floating quick-tools (Nursing Plan editor + OPD/panel/cert/discharge shortcuts)
import DoctorQuickTools from "../../Components/doctor/DoctorQuickTools";
import TreatmentChart from "../../Components/clinical/TreatmentChart";
import TreatmentTeamPanel from "../../Components/clinical/TreatmentTeamPanel";
// R7hr-143 — Pending Investigation Reports shared tab
import { PendingInvestigationReportsTab } from "../../Components/clinical/PatientPanelTabs";
import { useAutoSave } from "../../hooks/useAutoSave";
import { useDigitalSignature } from "../../hooks/useDigitalSignature";
import AutoSaveIndicator from "../../Components/signature/AutoSaveIndicator";
import SignaturePad from "../../Components/signature/SignaturePad";
// R7ez — Unified rich card renderer for every note type in the timeline.
// Replaces the inline SOAP-only card so Initial Assessment, Procedure,
// Pre-Op, Post-Op, Discharge, Consult, Emergency, Referral, Death etc.
// all render with the same polished layout as Daily Progress.
import TimelineNoteCard from "../../Components/notes/TimelineNoteCard";

/* ── Design tokens (blue/indigo — doctor theme) ── */
const C = {
  bg: "#f8fafc", card: "#ffffff", border: "#e2e8f0", text: "#0f172a", muted: "#64748b",
  primary: "#4338ca", primaryL: "#eef2ff", primaryMid: "#4f46e5",
  green: "#16a34a", greenL: "#dcfce7", greenB: "#bbf7d0",
  amber: "#d97706", amberL: "#fffbeb", amberB: "#fde68a",
  red: "#dc2626", redL: "#fef2f2", redB: "#fecaca",
  blue: "#4f46e5", blueL: "#e0e7ff", blueB: "#93c5fd",
  purple: "#7c3aed", purpleL: "#f5f3ff", purpleB: "#c4b5fd",
  teal: "#0d9488", tealL: "#f0fdfa", tealB: "#99f6e4",
  orange: "#ea580c", orangeL: "#fff7ed", orangeB: "#fed7aa",
  slate: "#1e293b", slateMid: "#334155",
  gray: "#9ca3af", grayL: "#f9fafb",
  pink: "#db2777", pinkL: "#fdf2f8",
  indigo: "#4f46e5",
};

/* Form primitives moved to clinical-forms.css — use:
   .his-field    (input)     .his-select (select)
   .his-textarea (textarea)  .his-label  (label)
   .his-field-group (label+input wrapper)
*/

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

/* ── NABH Note Modules ──
   R7aw — `nabh` (chapter code) + `description` (one-line summary) added to
   every entry so the picker grid renders the same card layout used by the
   Consent Form picker (PRE.3 / PRE.4 cards on /consent-forms). NABH codes
   map to the most specific chapter that governs the note type:
     AAC.1 — Initial Assessment             COP.10 — Procedures
     MOM.4 — Medication & Infusion orders   COP.13 — Pre-operative
     COP.1 — Daily progress / consultation  COP.14 — Post-operative
     COP.5 — Critical / ICU care            COP.19 — Death
     IMS.2 — Information Mgmt (amendments)                          */
const MODULES = [
  // R7bk — Inline "Initial Assessment" module removed from this picker.
  // The AAC.1 doctor Initial Assessment is filed via the top-level
  // "Emergency Assessment" tile (mounts EmergencyAssessmentPageContent
  // inline). Keeping a second inline-only entry point was producing
  // duplicate-shape doctor notes — the Emergency Assessment page is the
  // single source of truth, and on sign-and-submit it flips
  // admission.initialAssessment.doctorCompleted = true so the gate lifts.
  // R7bp — "Medication Orders" + "Infusion Orders" tiles removed from this
  // picker. Both are now exclusively handled by the dedicated Doctor Orders
  // module (orderType: "Medication" / "IV_Fluid"), which feeds MAR, indents,
  // pharmacy, and billing through a single source of truth. Keeping them as
  // duplicate "note types" let the same drug be ordered in two places, with
  // only one of them flowing into MAR / pharmacy.
  // ── Notes ──
  { id: "daily",       label: "Daily Progress",        nabh: "COP.1", description: "Shift-wise SOAP progress — stable / improving / deteriorating",
    icon: "pi-file-edit",           border: C.blueB,   color: C.blue,   bg: C.blueL   },
  { id: "icu",         label: "ICU / Critical Care",   nabh: "COP.5", description: "Ventilator, vasopressors, goals of care, family counselling",
    icon: "pi-heart",               border: C.redB,    color: C.red,    bg: C.redL,    dot: true },
  { id: "procedure",   label: "Procedure Note",        nabh: "COP.10", description: "Procedural note — consent, aseptic technique, complications",
    icon: "pi-cog",                 border: C.orangeB, color: C.orange, bg: C.orangeL },
  { id: "consultation",label: "Consultation",          nabh: "COP.1", description: "Specialty consult — referral, recommendations, follow-up",
    icon: "pi-users",               border: C.purpleB, color: C.purple, bg: C.purpleL },
  { id: "preop",       label: "Pre-operative",         nabh: "COP.13", description: "Pre-op checklist — consent, NBM, bloods, anaesthetist review",
    icon: "pi-clock",               border: C.tealB,   color: C.teal,   bg: C.tealL   },
  { id: "postop",      label: "Post-operative",        nabh: "COP.14", description: "Post-op recovery — haemostasis, drains, ward transfer",
    icon: "pi-check-circle",        border: C.greenB,  color: C.green,  bg: C.greenL  },
  { id: "death",       label: "Death Note",            nabh: "COP.19", description: "Death summary — family informed, MLC notified, certificate",
    icon: "pi-exclamation-triangle",border: "#94a3b8", color: C.slate,  bg: "#f1f5f9", dot: true },
  { id: "amendment",   label: "Amendment",             nabh: "IMS.2", description: "Late entry / correction with witness + original retained",
    icon: "pi-pencil",              border: C.amberB,  color: C.amber,  bg: C.amberL  },
  // R7fx — print-only label entries so modDef() resolves a correct doc title
  // for noteTypes that don't show as tile-cards. Without these, every print
  // header read "Doctor Note — Daily Progress" regardless of type (audit P0).
  // R7hr-269 (USER) — "admission", "progress" and "assessment" (Reassessment)
  // removed end-to-end. "general" stays as the system DEFAULT note type (label
  // + render resolution for any untyped note); it is hidden from the picker by
  // the filter further down, not shown as a tile-card.
  { id: "general",     label: "General Note",          nabh: "IMS.1", description: "Free-text clinical narrative",
    icon: "pi-file",                border: "#cbd5e1", color: C.slate,  bg: "#f8fafc" },
  { id: "initial",     label: "Initial Assessment",    nabh: "COP.1", description: "NABH COP.1 first-contact in-patient assessment",
    icon: "pi-id-card",             border: "#fcd34d", color: C.amber,  bg: C.amberL  },
  { id: "discharge",   label: "Discharge Summary",     nabh: "COP.21", description: "Final discharge summary",
    icon: "pi-check-square",        border: C.greenB,  color: C.green,  bg: C.greenL  },
  // R7gb P0-8 — "operative" tile removed. It duplicated procedure + postop,
  // had no dedicated form/state/save handler, and exposing it let users
  // open a non-functional editor. The print builder at
  // TYPE_BUILDERS.operative is retained for any legacy noteDetails.
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
  morning:   { bg: "#e0e7ff", color: "#4338ca" },
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
    <div
      className="his-field-group"
      style={span ? { gridColumn: `span ${span}` } : undefined}
    >
      <label className="his-label">{label}</label>
      {children}
    </div>
  );
}

function SBARBox({ letter, title, color, value, onChange, placeholder }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
        <span style={{ width: 24, height: 24, borderRadius: 6, background: color + "25", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: 13, color }}>{letter}</span>
        <label className="his-label" style={{ marginBottom: 0, color }}>{title}</label>
      </div>
      <textarea className="his-textarea" style={{ minHeight: 64, borderColor: color + "40" }} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════ */
function DoctorNotesContent({ selectedPatient }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  // R7az — showAssessmentModal state retired. Initial Assessment now uses
  // the same inline activeModal flow as every other note type.

  const [searchUHID,   setSearchUHID]   = useState("");
  const [patient,      setPatient]      = useState(null);
  const [notes,        setNotes]        = useState([]);
  const [loading,      setLoading]      = useState(false);
  const [saving,       setSaving]       = useState(false);
  const [activeModal,  setActiveModal]  = useState(null);
  const [filterType,   setFilterType]   = useState("All");
  const [filterShift,  setFilterShift]  = useState("");
  const [shift,        setShift]        = useState(getShift());
  // R7hr-185 — shift auto-follows the wall clock (Morning 7–14 →
  // Evening 14–21 → Night). Manual pill click pins it (late entries).
  const shiftManualRef = useRef(false);
  useEffect(() => {
    const t = setInterval(() => {
      if (!shiftManualRef.current) {
        setShift(prev => { const want = getShift(); return prev === want ? prev : want; });
      }
    }, 60000);
    return () => clearInterval(t);
  }, []);
  const [selectedTags, setSelectedTags] = useState([]);
  const [isCritical,   setIsCritical]   = useState(false);
  const [ordersRefresh, setOrdersRefresh] = useState(0);
  const [expandedNotes, setExpandedNotes] = useState({});
  const [timelineRefresh, setTimelineRefresh] = useState(0);
  const [filterDate,    setFilterDate]    = useState("");   // "" | "today" | "week" | "last7"
  const [editingNote,   setEditingNote]   = useState(null); // draft note being edited

  /* ── Tile / section navigator ──
       Doctor Notes is broken into 6 tiles. When `activeTile` is null,
       the user sees the grid of tiles. When set, the matching section
       expands inline below the patient header and the rest of the
       sections are hidden. "Back to all sections" returns to the grid.
       Tile keys: "diagnosis" | "orders" | "mar" | "team" | "addnote" | "timeline" */
  const [activeTile, setActiveTile] = useState(null);

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

  /* Auto-populate UHID from sidebar patient selection + auto-load.
     R7bd — Pre-R7bd this only set the UHID in the search input and the
     user had to click "Load Patient" themselves. Now we also fire
     loadPatient(UHID) so the patient is fetched + form renders on a
     single click in the side panel. */
  useEffect(() => {
    if (selectedPatient?.UHID) {
      setSearchUHID(selectedPatient.UHID);
      loadPatient(selectedPatient.UHID);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPatient?._id, selectedPatient?.UHID]);

  /* Auto-load when /doctor-notes?uhid=… is opened from /bed-visual */
  useEffect(() => {
    const u = new URLSearchParams(window.location.search).get("uhid");
    if (!u || !u.trim()) return;
    setSearchUHID(u.trim());
    (async () => {
      setLoading(true);
      try {
        const { data } = await axios.get(
          `${API_ENDPOINTS.ADMISSIONS}/active?UHID=${encodeURIComponent(u.trim())}`,
        );
        const arr = Array.isArray(data) ? data : data.data || [];
        const active = arr[0];
        if (active) {
          setPatient(active);
          await fetchNotes(active.ipdNo || active.admissionNumber || active._id);
        }
      } catch (_) { /* silent — user can still search manually */ }
      finally { setLoading(false); }
    })();
    // run only once on mount — subsequent in-page UHID switches go
    // through loadPatient(), not the URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Fetch patients on mount — primary IPD list + consulting list.
     R7az-D4-HIGH-1 — Abort the fetch on unmount so we don't setState
     against a dead component when the user navigates away mid-request. */
  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      setRecentLoading(true);
      try {
        // Try to load role-specific team patients first
        const teamRes = await axios.get(`${API_ENDPOINTS.ADMISSIONS}/my-team-patients`, { signal: ctrl.signal }).catch(() => null);
        if (ctrl.signal.aborted) return;
        if (teamRes?.data?.success) {
          const { asPrimary = [], asConsulting = [] } = teamRes.data.data;
          setRecentPatients(asPrimary.sort((a, b) => new Date(b.admissionDate || b.createdAt) - new Date(a.admissionDate || a.createdAt)));
          setConsultPatients(asConsulting);
        } else {
          // Fallback: all active IPD admissions (for Admin or unauthenticated).
          // hasBed=true filters out OPD/Daycare/Services stubs that share the
          // collection — without it the doctor's notes board showed every
          // OPD visit as if it were an IPD patient.
          const { data } = await axios.get(`${API_ENDPOINTS.ADMISSIONS}/active?hasBed=true`, { signal: ctrl.signal });
          if (ctrl.signal.aborted) return;
          const arr = Array.isArray(data) ? data : (data.data || []);
          setRecentPatients(arr.sort((a, b) => new Date(b.admissionDate || b.createdAt) - new Date(a.admissionDate || a.createdAt)));
        }
      } catch { /* silent — abort or transient network */ }
      finally { if (!ctrl.signal.aborted) setRecentLoading(false); }
    })();
    return () => ctrl.abort();
  }, []);

  /* ── Module form state ── */
  const initSoap = () => ({ subjective: "", objective: "", assessment: "", plan: "" });
  const initVitals = () => ({ bp_sys: "", bp_dia: "", pulse: "", temp: "", spo2: "", rr: "", bsl: "", gcs: "", urine: "" });

  const [soap,     setSoap]     = useState(initSoap());
  const [vitals,   setVitals]   = useState(initVitals());
  const [diag,     setDiag]     = useState({ provisional: "", working: "", final: "", icd10Code: "", icd10Description: "", status: "Stable" });
  const [diagSaving, setDiagSaving] = useState(false);
  const [diagNoteId, setDiagNoteId] = useState(null); // most-recent note _id for diagnosis PATCH
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
  // R7em-2 — added NABH COP.13 pre-op assessment fields (fastingHours, airwayPlan,
  // preOpVitals, inductionAt/reversalAt, aldreteScore) so the ASA register row is complete.
  const [preop, setPreop] = useState({ procedure: "", indication: "", preopDiagnosis: "", asaGrade: "ASA I", plannedAnaesthesia: "General", bloodGroup: "", crossMatch: false, cbcReviewed: false, ptReviewed: false, ecgReviewed: false, cxrReviewed: false, echoReviewed: false, lftsReviewed: false, rftReviewed: false, comorbidities: "", currentMeds: "", allergies: "NKDA", consentObtained: true, surgeon: "", anaesthetist: "", preopOrders: "",
    /* R7em-2 — NABH COP.13 pre-op assessment */
    fastingHours: "", airwayPlan: "", preOpBp: "", preOpPulse: "", preOpTemp: "", preOpSpo2: "",
    inductionAt: "", reversalAt: "", aldreteScore: "" });

  /* Post-op */
  const [postop, setPostop] = useState({ procedurePerformed: "", operativeFindings: "", anaesthesia: "General", surgeon: "", anaesthetist: "", startTime: "", endTime: "", bloodLoss: "", transfusion: "None", fluidsGiven: "", urineOutput: "", specimenSent: false, specimenType: "", postopDiagnosis: "", conditionLeavingOT: "Stable", recoveryInstructions: "", postopOrders: "" });

  /* Death Note */
  // R7em-7 — placeOfDeath / postMortemDone / deathCertificateNumber /
  // deathCertificateIssuedAt added to mirror what the Mortality Register
  // (COP.18) needs on emit. Legacy fields untouched; backend aliases tolerate
  // both naming conventions (dateTime ↔ dateOfDeath, modeOfDeath ↔ manner).
  const [death, setDeath] = useState({ dateTime: "", causeDeath1: "", causeDeath2: "", causeDeath3: "", contributing: "", sequenceOfEvents: "", modeOfDeath: "Cardiac Arrest", placeOfDeath: "Ward", dnrInPlace: false, familyInformed: true, familyInformedBy: "", familyInformedTime: "", mlc: false, pmAdvised: false, postMortemDone: false, certificateIssued: false, deathCertificateNumber: "", deathCertificateIssuedAt: "" });

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

  /* ── Load Patient ──
     R7bd — accepts either a click/submit event OR a UHID string. The
     admitted-patient side-panel auto-loads via `loadPatient(uhid)`
     without an event; the inline "Load Patient" button keeps passing
     its click event. When a UHID is passed directly we skip the
     searchUHID lookup (which would be stale right after a setState). */
  const loadPatient = async (eventOrUhid) => {
    const directUhid = typeof eventOrUhid === "string" ? eventOrUhid : null;
    if (!directUhid) eventOrUhid?.preventDefault?.();
    const uhidVal = (directUhid || searchUHID).trim();
    if (!uhidVal) return;
    setLoading(true);
    try {
      const { data } = await axios.get(`${API_ENDPOINTS.ADMISSIONS}/active?UHID=${encodeURIComponent(uhidVal)}`);
      const arr = Array.isArray(data) ? data : data.data || [];
      const active = arr[0];
      if (active) {
        setPatient(active);
        await fetchNotes(active.ipdNo || active.admissionNumber || active._id);
        toast.success(`Loaded: ${active.patientName || active.patientId?.fullName || uhidVal}`);
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
      const sorted = arr.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      setNotes(sorted);
      // Populate diag state from the most recent note that has any diagnosis data
      const withDiag = sorted.find(n =>
        n.provisionalDiagnosis || n.workingDiagnosis || n.finalDiagnosis || n.icd10Code || n.patientStatus
      );
      if (withDiag) {
        setDiagNoteId(withDiag._id);
        setDiag(prev => ({
          ...prev,
          provisional:    withDiag.provisionalDiagnosis  || prev.provisional,
          working:        withDiag.workingDiagnosis       || prev.working,
          final:          withDiag.finalDiagnosis         || prev.final,
          icd10Code:      withDiag.icd10Code              || prev.icd10Code,
          icd10Description: withDiag.icd10Description     || prev.icd10Description,
          // R7hr-87 — restore the last-saved patient status so the
          // doctor's clinical-status call doesn't reset to "Stable" on
          // reload.
          status:         withDiag.patientStatus          || prev.status,
        }));
      } else if (sorted.length > 0) {
        setDiagNoteId(sorted[0]._id);
      }
    } catch { /* silent */ }
  };

  const openModal = (id) => {
    // R7bk — The inline "Initial Assessment" module was removed; the
    // doctor's compulsory NABH AAC.1 assessment is now filed exclusively
    // via the top-level "Emergency Assessment" tile. So this inline
    // picker only renders once the gate is OFF, which means the gate
    // block here is unreachable in normal flow — but we keep it as a
    // belt-and-braces guard against any direct setActiveModal() calls.
    if (gateActive) {
      toast.warn("⚠ Open the 'Emergency Assessment' tile and complete the Doctor Initial Assessment first (NABH AAC.1).", { autoClose: 5000 });
      return;
    }
    setActiveModal(id);
    setSelectedTags([]); setIsCritical(false); setShowOrderRow(false);
    setSoap(initSoap()); setVitals(initVitals());
    // R7az-D4-CRIT-5 — Pre-fix this reset dropped working / icd10Code /
    // icd10Description, leaving them undefined in the modal so the JSX
    // crashed (Cannot read properties of undefined). The shape must
    // match the initial useState shape declared at the top of the
    // component.
    setDiag({ provisional: "", working: "", final: "", icd10Code: "", icd10Description: "", status: "Stable" });
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
    // R7bx item 8 — MCI Regulation 1.4.2 pre-flight on sign-and-submit.
    // Abort BEFORE the API call when the doctor has no MCI reg number on
    // file. Drafts are still allowed — the gate only applies to the
    // signing flow per MCI 1.4.2.
    if (status === "signed") {
      try {
        const u = JSON.parse(sessionStorage.getItem("his_user") || "{}");
        if (u?.role === "Doctor") {
          // R7fp — widened from doctorDetails.registrationNumber only.
          // Backend doctorNotesService.js now accepts ANY of these.
          const regNo = String(
            u.doctorDetails?.registrationNumber
            || u.doctorDetails?.regNo
            || u.medicalRegNo
            || u.registrationNumber
            || u.regNo
            || ""
          ).trim();
          if (!regNo) {
            toast.error("Add your MCI registration number in your Profile before signing");
            return;
          }
        }
      } catch (_) { /* fall through — server enforces */ }
    }
    const ipdNo = patient.ipdNo || patient.admissionNumber || patient._id;
    const token = (sessionStorage.getItem("his_token"));
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
      provisionalDiagnosis: diag.provisional, workingDiagnosis: diag.working, finalDiagnosis: diag.final,
      icd10Code: diag.icd10Code, icd10Description: diag.icd10Description,
      // R7hr-87 — patientStatus (Stable/Improving/Unchanged/Deteriorating/
      // Critical/Ready for Discharge) was filed in the schema but never
      // sent. Now it persists and surfaces on the patient banner for
      // both doctor + nurse views.
      patientStatus: diag.status,
      investigations: invx ? invx.split(",").map(s => s.trim()).filter(Boolean) : [],
      orders: orders.map(o => ({
        // FIX (audit P12-B1): the legacy whitelist coerced `infusion` and
        // `investigation` to "other", silently losing the categorisation
        // downstream (treatment chart, nurse MAR, billing). Whitelist
        // now matches the <select> options at line 2324.
        type: ["medication","iv_fluid","infusion","procedure","investigation","diet","nursing","other"].includes(o.type) ? o.type : "other",
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
        // R7az-D4-CRIT-3 — Pre-fix: the PATCH /sign failure was silently
        // swallowed with the comment "signed inline" — but the backend
        // /sign endpoint stamps the signedBy / signedAt / status fields
        // and triggers the locked-note workflow. If it fails, the note
        // is left as a draft on the server while we toast "signed". Now
        // we surface the failure and DO NOT claim the note was signed.
        let signedOk = true;
        if (status === "signed" && savedId) {
          try {
            await axios.patch(`${API_ENDPOINTS.DOCTOR_NOTES}/${savedId}/sign`, {}, { headers });
          } catch (signErr) {
            signedOk = false;
            toast.error("Note saved as DRAFT — could not sign: "
              + (signErr.response?.data?.message || signErr.message)
              + " — open it from the timeline and click Sign to retry.");
          }
        }
        if (signedOk) {
          toast.success(status === "signed" ? "Note signed & submitted ✓" : "Draft saved");
        }

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
                    fluidName: inf.drugFluid,
                    dose: inf.volume ? `${inf.volume}ml` : "",
                    route: "IV Infusion",
                    frequency: "Continuous",
                    rate: inf.rate, totalVolume: inf.volume,
                    dilution: inf.dilution, titrationGoal: inf.titrationGoal,
                    startTime: inf.startTime,
                    // P1-10 — surface MAR/Treatment-Chart fields so nurse sees
                    // "Dilute in N ml … infuse over M min" and the auto-I/O
                    // hook can stamp diluent volume. IA infusion state does
                    // not yet collect these (emptyInfRow lacks them); default
                    // to "" so payload validates while keys remain present.
                    dilutionVolume:     inf.dilutionVolume     ?? "",
                    dilutionFluid:      inf.dilutionFluid      ?? "",
                    infuseOverMinutes:  inf.infuseOverMinutes  ?? "",
                    additives:          inf.additives          ?? "",
                    accessSite:         inf.accessSite         ?? "",
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

    // R7az-D4-CRIT-5 — Pre-fix this restore read `noteDetails?.icd10`
    // which was never written by saveNote() (saveNote writes top-level
    // icd10Code / icd10Description and a separate workingDiagnosis).
    // It also lost `working`, so editing a draft and saving again
    // silently blanked the working diagnosis. Restore from the same
    // fields saveNote() writes.
    setDiag({
      provisional:      note.provisionalDiagnosis || "",
      working:          note.workingDiagnosis     || "",
      final:            note.finalDiagnosis       || "",
      icd10Code:        note.icd10Code            || "",
      icd10Description: note.icd10Description     || "",
      status:           note.noteDetails?.status  || "Stable",
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
    // R7bx item 8 — MCI Regulation 1.4.2 pre-flight. Block the sign API
    // call when the doctor has no MCI reg number on file.
    try {
      const u = JSON.parse(sessionStorage.getItem("his_user") || "{}");
      if (u?.role === "Doctor") {
        const regNo = String(u.doctorDetails?.registrationNumber || "").trim();
        if (!regNo) {
          toast.error("Add your MCI registration number in your Profile before signing");
          return;
        }
      }
    } catch (_) { /* fall through — server enforces */ }
    const ipdNo = patient.ipdNo || patient.admissionNumber || patient._id;
    const token = (sessionStorage.getItem("his_token"));
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    try {
      await axios.patch(`${API_ENDPOINTS.DOCTOR_NOTES}/${noteId}/sign`, {}, { headers });
      toast.success("Note signed & submitted ✓");
      await fetchNotes(ipdNo);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Sign failed");
    }
  };

  /* ── Save Diagnosis (standalone card) ── */
  const saveDiagnosis = async () => {
    if (!patient) return;
    const ipdNo = patient.ipdNo || patient.admissionNumber || patient._id;
    const token = (sessionStorage.getItem("his_token"));
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const payload = {
      provisionalDiagnosis: diag.provisional || "",
      workingDiagnosis:     diag.working      || "",
      finalDiagnosis:       diag.final        || "",
      icd10Code:            diag.icd10Code    || "",
      icd10Description:     diag.icd10Description || "",
    };
    try {
      setDiagSaving(true);
      if (diagNoteId) {
        await axios.patch(`${API_ENDPOINTS.DOCTOR_NOTES}/${diagNoteId}/diagnosis`, payload, { headers });
      } else {
        // R7hr-102 — Before spawning a fresh draft, look for an existing
        // Initial Assessment for this patient. The IA is the canonical home
        // for the patient's diagnosis (provisional/working/final/ICD), and
        // previously this path created a phantom "Daily Progress" draft
        // every time the diagnosis card was saved while diagNoteId hadn't
        // hydrated yet — leaving stale empty daily-progress draft cards
        // littering the Doctor Notes timeline right after the IA was signed.
        // Reusing the IA via PATCH keeps R26 intact (no parallel
        // role-mismatched record) and stops the "draft auto-saved after
        // sign+save" regression the user flagged. Falls back to POST only
        // when no IA exists at all (very early flow).
        const existingIA = (notes || []).find(
          (n) => n.noteType === "initial" || n.noteType === "initialAssessment",
        );
        if (existingIA?._id) {
          await axios.patch(`${API_ENDPOINTS.DOCTOR_NOTES}/${existingIA._id}/diagnosis`, payload, { headers });
          setDiagNoteId(existingIA._id);
        } else {
          // No IA yet — create a minimal draft note to anchor the diagnosis
          const res = await axios.post(API_ENDPOINTS.DOCTOR_NOTES, {
            ...payload,
            patient: patient.patientId?._id || patient.patient,
            patientName: patient.patientName || patient.patientId?.fullName || "",
            patientUHID: patient.UHID || patient.uhid || searchUHID,
            ipdNo,
            visitDate: new Date(),
            shift, noteType: "daily",
            doctorName: user?.personalInfo ? `${user.personalInfo.firstName} ${user.personalInfo.lastName}`.trim() : user?.name || "",
          }, { headers });
          const saved = res.data?.data || res.data;
          if (saved?._id) setDiagNoteId(saved._id);
        }
      }
      toast.success("Diagnosis updated ✓");
      await fetchNotes(ipdNo);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to save diagnosis");
    } finally { setDiagSaving(false); }
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
  const printNote = async (note) => {
    const pName  = patient?.patientName || patient?.patientId?.fullName || "—";
    const uhid   = patient?.UHID || patient?.uhid || searchUHID || "—";
    const ipd    = patient?.ipdNo || patient?.admissionNumber || "—";
    // R7ey-F40: patient may not carry wardName directly — derive through
    // R7bi-1 denormalized field, then wardId-populated ref, then department.
    const _wn    = patient?.wardName || patient?.wardId?.wardName || patient?.currentAdmission?.wardName || patient?.department;
    const _bn    = patient?.bedNumber || patient?.bedId?.bedNumber || patient?.currentAdmission?.bedNumber;
    const ward   = _wn ? `${_wn} · Bed ${_bn || "—"}` : "—";
    const modLabel = modDef(note.noteType)?.label || "Daily Progress";
    const noteDate = note.createdAt ? new Date(note.createdAt).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
    const shift  = (note.shift || "morning");
    // R7cb-C: settings-driven hospital name + tagline for the print header.
    // Pre-R7cb hardcoded "SphereHealth HIS" / "NABH Accredited Clinical
    // Documentation System" — now those come from /hospital-settings.
    const hs = await fetchHospitalSettings();
    const escapeHtml = (s) => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");

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
      return `<h4 style="margin:12px 0 6px;color:#4338ca;font-size:11px;text-transform:uppercase;letter-spacing:.5px">Vitals</h4>
<table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:10px">
<tr style="background:#eef2ff">${rows.map(r => `<th style="padding:5px 8px;border:1px solid #c7d2fe;text-align:left;font-size:10px;color:#4338ca">${r[0]}</th>`).join("")}</tr>
<tr>${rows.map(r => `<td style="padding:5px 8px;border:1px solid #c7d2fe;font-family:monospace;font-weight:600">${r[1]}</td>`).join("")}</tr>
</table>`;
    })();

    const soapHtml = (() => {
      const s = note.soap;
      if (!s) return "";
      const parts = [["S — Subjective","#4f46e5",s.subjective],["O — Objective","#0d9488",s.objective],["A — Assessment","#d97706",s.assessment],["P — Plan","#16a34a",s.plan]].filter(p=>p[2]);
      if (!parts.length) return "";
      return `<h4 style="margin:12px 0 6px;color:#4338ca;font-size:11px;text-transform:uppercase;letter-spacing:.5px">SOAP Notes</h4>
${parts.map(p=>`<div style="margin-bottom:8px;border-left:3px solid ${p[1]};padding-left:10px"><strong style="font-size:10px;text-transform:uppercase;color:${p[1]}">${p[0]}</strong><p style="margin:3px 0;font-size:12px;white-space:pre-wrap">${p[2]}</p></div>`).join("")}`;
    })();

    const diagHtml = (() => {
      // R7fx — audit P1: was dropping note.workingDiagnosis + note.icd10Code /
      // icd10Description. Daily progress / assessment notes only carry working
      // Dx, so the entire diagnosis section was silently missing on print.
      const parts = [];
      if (note.provisionalDiagnosis) parts.push(`<strong>Provisional:</strong> ${escapeHtml(note.provisionalDiagnosis)}`);
      if (note.workingDiagnosis)     parts.push(`<strong>Working:</strong> ${escapeHtml(note.workingDiagnosis)}`);
      if (note.finalDiagnosis)       parts.push(`<strong>Final:</strong> ${escapeHtml(note.finalDiagnosis)}`);
      if (note.icd10Code)            parts.push(`<strong>ICD-10:</strong> ${escapeHtml(note.icd10Code)}${note.icd10Description ? " — " + escapeHtml(note.icd10Description) : ""}`);
      if (!parts.length) return "";
      return `<h4 style="margin:12px 0 6px;color:#4338ca;font-size:11px;text-transform:uppercase;letter-spacing:.5px">Diagnosis</h4><p style="font-size:12px;margin:0;line-height:1.6">${parts.join(" &nbsp;|&nbsp; ")}</p>`;
    })();

    const invHtml = note.investigations?.length
      ? `<h4 style="margin:12px 0 6px;color:#4338ca;font-size:11px;text-transform:uppercase;letter-spacing:.5px">Investigations</h4><p style="font-size:12px;margin:0">${note.investigations.join(", ")}</p>` : "";

    const ordersHtml = note.orders?.length
      ? `<h4 style="margin:12px 0 6px;color:#4338ca;font-size:11px;text-transform:uppercase;letter-spacing:.5px">Doctor Orders</h4>
<table style="width:100%;border-collapse:collapse;font-size:11px">
<tr style="background:#eef2ff"><th style="padding:4px 8px;border:1px solid #c7d2fe;text-align:left">Type</th><th style="padding:4px 8px;border:1px solid #c7d2fe;text-align:left">Instruction</th><th style="padding:4px 8px;border:1px solid #c7d2fe;text-align:left">Route</th><th style="padding:4px 8px;border:1px solid #c7d2fe;text-align:left">Freq</th><th style="padding:4px 8px;border:1px solid #c7d2fe;text-align:left">Priority</th></tr>
${note.orders.map(o=>`<tr><td style="padding:4px 8px;border:1px solid #e0e7ff">${o.type||"—"}</td><td style="padding:4px 8px;border:1px solid #e0e7ff">${o.instruction||"—"}</td><td style="padding:4px 8px;border:1px solid #e0e7ff">${o.route||"—"}</td><td style="padding:4px 8px;border:1px solid #e0e7ff">${o.frequency||"—"}</td><td style="padding:4px 8px;border:1px solid #e0e7ff;font-weight:700;color:${o.priority==="STAT"?"#dc2626":o.priority==="URGENT"?"#d97706":"#16a34a"}">${o.priority||"ROUTINE"}</td></tr>`).join("")}
</table>` : "";

    const medOrdersHtml = (() => {
      const mo = note.noteDetails?.medicationOrders;
      if (!mo?.length) return "";
      return `<h4 style="margin:12px 0 6px;color:#4f46e5;font-size:11px;text-transform:uppercase;letter-spacing:.5px">Medication Orders</h4>
<table style="width:100%;border-collapse:collapse;font-size:11px">
<tr style="background:#e0e7ff"><th style="padding:4px 8px;border:1px solid #93c5fd;text-align:left">Drug</th><th style="padding:4px 8px;border:1px solid #93c5fd;text-align:left">Dose</th><th style="padding:4px 8px;border:1px solid #93c5fd;text-align:left">Route</th><th style="padding:4px 8px;border:1px solid #93c5fd;text-align:left">Frequency</th><th style="padding:4px 8px;border:1px solid #93c5fd;text-align:left">Status</th></tr>
${mo.map(m=>`<tr style="${m.status==="Stopped"?"background:#fff1f2":""}"><td style="padding:4px 8px;border:1px solid #c7d2fe;font-weight:600">${m.drug||"—"}</td><td style="padding:4px 8px;border:1px solid #c7d2fe">${m.dose||"—"}</td><td style="padding:4px 8px;border:1px solid #c7d2fe">${m.route||"—"}</td><td style="padding:4px 8px;border:1px solid #c7d2fe">${m.frequency||"—"}</td><td style="padding:4px 8px;border:1px solid #c7d2fe;font-weight:700;color:${m.status==="Stopped"?"#dc2626":"#16a34a"}">${m.status||"Active"}</td></tr>`).join("")}
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

    // R7fn-v3 — Generic noteDetails renderer. Pre-R7fn the print HTML
    // assembled only the well-known sections (vitals, SOAP, diagnosis,
    // investigations, orders, med/inf orders, tags, sig) and silently
    // dropped every other field that lives under `note.noteDetails`:
    // ICU ventilator settings, procedure technique, ASA grade, cause of
    // death, etc. We walk noteDetails recursively (skipping the two
    // already-rendered keys medicationOrders / infusionOrders), emit
    // human-readable kv rows for primitives and collapsible <details>
    // blocks for nested objects. Depth capped at 4 so a pathological
    // payload can't blow up the printout.
    const HUMAN_LBL = {
      // Generic / Admission
      admissionMode:"Admission Mode", chiefComplaint:"Chief Complaint", duration:"Duration", hpi:"HPI",
      pastMedical:"Past Medical Hx", pastSurgical:"Past Surgical Hx", familyHistory:"Family Hx",
      socialHistory:"Social Hx", currentMeds:"Current Meds", allergies:"Allergies",
      // Vitals
      bp_sys:"Systolic BP", bp_dia:"Diastolic BP", pulse:"Pulse (/min)", temp:"Temp (°F)",
      spo2:"SpO₂ (%)", rr:"RR (/min)", bsl:"BSL (mg/dL)", weight:"Weight (kg)", height:"Height (cm)",
      // General/System exam
      generalCondition:"Gen Condition", builtNutrition:"Built / Nutrition",
      pallor:"Pallor", icterus:"Icterus", cyanosis:"Cyanosis", clubbing:"Clubbing",
      lymphadenopathy:"Lymphadenopathy", oedema:"Oedema",
      resp:"Resp System", cvs:"CVS", abdomen:"Abdomen", cns:"CNS / Neuro",
      // Diagnosis
      provisionalDx:"Provisional Dx", differentialDx:"Differential Dx", finalDx:"Final Dx", icd10:"ICD-10",
      investigations:"Investigations", managementPlan:"Management Plan",
      // ICU / Ventilator
      ventMode:"Vent Mode", fio2:"FiO₂ (%)", peep:"PEEP (cmH₂O)", tv:"Tidal Volume (mL)",
      ventRR:"Vent RR", pip:"PIP", map:"MAP (mmHg)", cvp:"CVP (mmHg)",
      rassScore:"RASS Score", bpsScore:"BPS Score", dailyGoals:"Daily Goals",
      neuro:"Neuro", renal:"Renal", gi:"GI", haem:"Haematology", infective:"Infective",
      sedation:"Sedation", vasopressors:"Vasopressors", vasopressorDetail:"Vasopressor Detail",
      // Procedure
      procedureName:"Procedure", indication:"Indication", laterality:"Laterality",
      surgeon:"Surgeon", assistant:"Assistant", anaesthesia:"Anaesthesia",
      position:"Position", consentObtained:"Consent Obtained",
      technique:"Technique", findings:"Findings",
      complications:"Complications", bloodLoss:"Blood Loss",
      specimenSent:"Specimen Sent", specimenType:"Specimen Type", postInstructions:"Post Instructions",
      // Consultation
      consultantName:"Consultant", speciality:"Speciality", consultantRegNo:"Reg No",
      referredBy:"Referred By", reason:"Reason", clinicalSummary:"Clinical Summary",
      impression:"Impression", recommendations:"Recommendations", followUp:"Follow-Up",
      // Pre-op
      procedure:"Procedure", preopDiagnosis:"Pre-op Dx", asaGrade:"ASA Grade",
      plannedAnaesthesia:"Planned Anaesthesia", bloodGroup:"Blood Group", crossMatch:"Cross Match",
      comorbidities:"Comorbidities", preopOrders:"Pre-op Orders",
      cbcReviewed:"CBC ✓", ptReviewed:"PT/APTT ✓", ecgReviewed:"ECG ✓", cxrReviewed:"CXR ✓",
      echoReviewed:"Echo ✓", lftsReviewed:"LFTs ✓", rftReviewed:"RFTs ✓",
      // Post-op
      procedurePerformed:"Procedure Performed", operativeFindings:"Operative Findings",
      startTime:"Start Time", endTime:"End Time", transfusion:"Transfusion",
      fluidsGiven:"Fluids Given", urineOutput:"Urine Output",
      postopDiagnosis:"Post-op Dx", conditionLeavingOT:"Condition (OT)",
      recoveryInstructions:"Recovery Instructions", postopOrders:"Post-op Orders",
      // Death
      dateTime:"Date/Time", causeDeath1:"Immediate Cause", causeDeath2:"Antecedent Cause",
      causeDeath3:"Underlying Cause", contributing:"Contributing Conditions",
      sequenceOfEvents:"Sequence of Events", modeOfDeath:"Mode of Death",
      placeOfDeath:"Place of Death",
      dnrInPlace:"DNR", familyInformed:"Family Informed", familyInformedBy:"Informed By",
      familyInformedTime:"Informed At", mlc:"MLC", pmAdvised:"PM Advised",
      postMortemDone:"PM Done",
      certificateIssued:"Certificate Issued",
      deathCertificateNumber:"Certificate No", deathCertificateIssuedAt:"Certificate Issued At",
      // Amendment
      originalNoteId:"Original Note",
      correction:"Correction", witness:"Witness",
      // R7fx — drift keys surfaced by the 15-agent print audit. Adding these
      // friendly labels means the seed-driven kv rows stop printing as raw
      // camelCase ("Mode Of Admission", "Postop Vitals", etc.).
      // Admission / AAC.1
      modeOfAdmission:"Mode of Admission", broughtBy:"Brought By", firstContactTime:"First Contact Time",
      triageCategory:"Triage Category", admittingDept:"Admitting Dept", consultantOnCall:"Consultant On-Call",
      bedAllocated:"Bed Allocated", riskStratification:"Risk Stratification", infectionStatus:"Infection Status",
      // Procedure / Operative
      operator:"Operator", assistants:"Assistants", consentType:"Consent Type",
      anatomicalSite:"Anatomical Site", asepsisMaintained:"Asepsis Maintained",
      timeoutPerformed:"Timeout (WHO Sign-In) Performed", initialDrainage:"Initial Drainage",
      postProcedureVitals:"Post-procedure Vitals", specimens:"Specimens", anaesthetist:"Anaesthetist",
      // Pre-op
      plannedProcedure:"Planned Procedure", asaClass:"ASA Class", nbmStatus:"NBM Status",
      anaesthesiaPlan:"Anaesthesia Plan", preopVitals:"Pre-op Vitals", preopChecklist:"Pre-op Checklist",
      // Post-op
      postopVitals:"Post-op Vitals", consciousness:"Consciousness",
      painScore:"Pain Score", recoveryTime:"Recovery Time", analgesia:"Analgesia",
      wardTransferTime:"Ward Transfer Time",
      // ICU / COP.5
      ventilatorStatus:"Ventilator Status", sedationStatus:"Sedation Status",
      invasiveLines:"Invasive Lines", goalsOfCare:"Goals of Care",
      familyMeeting:"Family Meeting", bundleCompliance:"Bundle Compliance",
      vapHobElevated:"VAP — HOB Elevated", vapOralCare:"VAP — Oral Care",
      dvtProphylaxis:"DVT Prophylaxis", stressUlcerProphylaxis:"Stress-ulcer Prophylaxis",
      glucoseControl:"Glucose Control",
      // Death / COP.19 — MCCD
      causeDeath1:"Immediate Cause (I·a)", causeDeath2:"Antecedent Cause (I·b)",
      causeDeath3:"Underlying Cause (I·c)", contributing:"Contributing (II)",
      sequenceOfEvents:"Sequence of Events", timeOfDeath:"Time of Death",
      causeOfDeath:"Cause of Death", certifiedBy:"Certified By",
      bodyDisposition:"Body Disposition", mlcRequired:"MLC Required",
      // Discharge / COP.21
      admissionDate:"Admission Date", dischargeDate:"Discharge Date",
      lengthOfStay:"Length of Stay", outcome:"Outcome", disposition:"Disposition",
      instructionsGiven:"Instructions Given", certificatesIssued:"Certificates Issued",
      dischargeMedications:"Discharge Medications",
      // Amendment / IMS.2
      amendmentReason:"Amendment Reason", valueChanged:"Value Changed",
      witnessedBy:"Witnessed By", originalNoteDate:"Original Note Date",
      originalNoteType:"Original Note Type", complianceNote:"Compliance Note",
      // Consultation / COP.1
      consultReason:"Reason for Consult", consultantSeen:"Consultant Seen",
      recommendationsAccepted:"Recommendations Accepted",
    };
    const humanizeKey = (k) => HUMAN_LBL[k] || k.replace(/([A-Z])/g, " $1").replace(/^./, c => c.toUpperCase()).trim();
    const isEmptyVal = (v) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
    // R7fx — auto-format ISO timestamps so firstContactTime/startTime/endTime/
    // signedAt no longer print as "2026-05-30T12:30:00.000Z".
    const ISO_RX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
    const fmtVal = (v) => {
      const s = String(v);
      if (ISO_RX.test(s)) {
        try { return new Date(s).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); }
        catch { /* fall through */ }
      }
      return s;
    };
    const renderNoteDetailsAsHtml = (obj, depth = 0) => {
      if (depth > 4 || !obj || typeof obj !== "object") return "";
      const SKIP = new Set(["medicationOrders", "infusionOrders"]); // already rendered above
      const rows = [];
      for (const [k, v] of Object.entries(obj)) {
        if (SKIP.has(k)) continue;
        if (k.startsWith("DEMO_")) continue;          // R7fx — strip DEMO markers from print
        if (isEmptyVal(v)) continue;
        const lbl = escapeHtml(humanizeKey(k));
        if (typeof v === "boolean") {
          rows.push(`<div class="kv"><span class="lbl">${lbl}</span><span class="val">${v ? "✓ Yes" : "✗ No"}</span></div>`);
        } else if (Array.isArray(v)) {
          // Array of primitives → join; array of objects → always-open nested block
          if (v.every(x => typeof x !== "object" || x === null)) {
            rows.push(`<div class="kv"><span class="lbl">${lbl}</span><span class="val">${escapeHtml(v.join(", "))}</span></div>`);
          } else {
            // R7fx-A4 CRITICAL: was <details><summary> — disclosure widget
            // does NOT unfurl on paper, so allergies.list / medication
            // reconciliation / nested arrays were HIDDEN in print. Always-
            // open block now.
            const inner = v.map((x, i) => typeof x === "object" && x !== null
              ? `<div style="margin:3px 0 3px 12px;padding:4px 6px;background:#fafafa;border-left:2px solid #cbd5e1"><div style="font-size:10px;font-weight:600;color:#475569;margin-bottom:2px">#${i + 1}</div>${renderNoteDetailsAsHtml(x, depth + 1)}</div>`
              : `<div class="kv" style="margin-left:12px"><span class="lbl">#${i + 1}</span><span class="val">${escapeHtml(fmtVal(x))}</span></div>`
            ).join("");
            rows.push(`<div style="margin:6px 0"><div style="font-size:11px;font-weight:700;color:#4338ca;border-bottom:1px solid #e0e7ff;padding-bottom:2px;margin-bottom:3px">${lbl}</div>${inner}</div>`);
          }
        } else if (typeof v === "object") {
          // BP shorthand
          if ("systolic" in v || "diastolic" in v) {
            rows.push(`<div class="kv"><span class="lbl">${lbl}</span><span class="val">${escapeHtml((v.systolic ?? "—") + "/" + (v.diastolic ?? "—"))}</span></div>`);
          } else {
            // R7fx-A4 CRITICAL: see above. WHO Surgical Safety Checklist
            // (preopChecklist) and ICU bundle compliance live inside
            // nested objects — disclosure widget would hide them on paper.
            const nested = renderNoteDetailsAsHtml(v, depth + 1);
            if (nested) rows.push(`<div style="margin:6px 0"><div style="font-size:11px;font-weight:700;color:#4338ca;border-bottom:1px solid #e0e7ff;padding-bottom:2px;margin-bottom:3px">${lbl}</div>${nested}</div>`);
          }
        } else {
          rows.push(`<div class="kv"><span class="lbl">${lbl}</span><span class="val">${escapeHtml(fmtVal(v))}</span></div>`);
        }
      }
      return rows.join("");
    };
    const noteDetailsHtml = note.noteDetails && Object.keys(note.noteDetails).filter(k => k !== "medicationOrders" && k !== "infusionOrders").length
      ? `<div class="section" style="margin-top:14px;padding-top:10px;border-top:1px solid #e2e8f0">
<h3 style="margin:0 0 8px;color:#4338ca;font-size:12px;text-transform:uppercase;letter-spacing:.5px">Additional Details (${escapeHtml(modDef(note.noteType)?.label || note.noteType || "Note")})</h3>
<style>.kv{display:flex;gap:8px;font-size:12px;margin:2px 0;align-items:baseline}.kv .lbl{flex:0 0 180px;font-weight:600;color:#475569;font-size:11px}.kv .val{flex:1;color:#0f172a;white-space:pre-wrap;word-break:break-word}</style>
${renderNoteDetailsAsHtml(note.noteDetails)}
</div>` : "";

    const sigHtml = note.status === "signed"
      ? `<div style="margin-top:20px;padding:10px 14px;border:1px solid #bbf7d0;border-radius:8px;background:#f0fdf4;display:flex;align-items:center;gap:10px"><div><strong style="color:#15803d;font-size:12px">✓ SIGNED & SUBMITTED</strong><br/><span style="font-size:11px;color:#166534">By: ${note.doctorName||doctorName} ${note.doctorRegNo ? "· Reg: "+note.doctorRegNo : ""} · ${note.signedAt ? new Date(note.signedAt).toLocaleString("en-IN") : noteDate}</span></div></div>`
      : `<div style="margin-top:20px;padding:8px 12px;border:1px solid #fde68a;border-radius:8px;background:#fffbeb"><strong style="color:#d97706;font-size:12px">DRAFT — Not yet signed</strong></div>`;

    // R7fx — late-entry banner (NABH HIC.6). Every Badal seeded note has
    // lateEntry:true; the rationale was being buried inside the kv dump.
    const lateEntryBanner = note.lateEntry
      ? `<div style="margin:8px 0 14px;padding:8px 12px;border:1px solid #fcd34d;background:#fffbeb;border-radius:6px;font-size:11px;color:#92400e;display:flex;gap:8px;align-items:flex-start">
  <strong style="white-space:nowrap">⚠ LATE ENTRY</strong>
  <div style="flex:1">${escapeHtml(note.lateEntryReason || "Retrospective entry — NABH HIC.6 backdated-documentation justification on file")}${note.lateEntryAt ? ` · Recorded: ${new Date(note.lateEntryAt).toLocaleString("en-IN")}` : ""}</div>
</div>` : "";

    // R7fx-B — compact 2-col KV grid used by every per-type builder. Keeps
    // page-saving footprint: 11px labels in slate, 12px values in slate-900,
    // 2 col so a 6-field metadata block fits in 3 rows on ~80mm of width.
    const compactGridCss = `<style>
  .rfx-grid{display:grid;grid-template-columns:1fr 1fr;gap:4px 16px;font-size:11.5px;margin:6px 0 10px}
  .rfx-grid .lbl{font-weight:600;color:#475569;font-size:10px;text-transform:uppercase;letter-spacing:.3px;display:block;margin-bottom:1px}
  .rfx-grid .val{color:#0f172a;font-size:11.5px;white-space:pre-wrap}
  .rfx-grid .full{grid-column:1 / -1}
  .rfx-h{margin:10px 0 4px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;padding:3px 8px;border-radius:4px}
  .rfx-tbl{width:100%;border-collapse:collapse;font-size:11px;margin:4px 0 8px}
  .rfx-tbl th{padding:4px 6px;border:1px solid #cbd5e1;background:#f1f5f9;font-size:10px;text-align:left;color:#334155}
  .rfx-tbl td{padding:4px 6px;border:1px solid #e2e8f0;color:#0f172a}
  .rfx-narr{margin:6px 0 10px;padding:8px 12px;background:#f8fafc;border-left:3px solid #94a3b8;font-size:11.5px;white-space:pre-wrap;line-height:1.45}
  .rfx-banner{margin:6px 0 12px;padding:8px 14px;border-radius:6px;font-size:12px;font-weight:600}
</style>`;

    // Single key-value cell helper for the 2-col grid
    // R7gb P0-3a — guard against [object Object] when value is a plain
    // object (e.g. nabh.codeStatus = { value, discussedWith, limitations },
    // comorbid toggle map, riskAcknowledgement). Extract .value/.text/.name,
    // flatten arrays, or pretty-print key:val pairs.
    const _kv = (label, value, isFull = false) => {
      if (value === undefined || value === null || value === "") return "";
      let v;
      if (typeof value === "string") {
        v = ISO_RX.test(value)
          ? new Date(value).toLocaleString("en-IN", { day:"2-digit", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit" })
          : value;
      } else if (Array.isArray(value)) {
        const flat = value.map(x => (x && typeof x === "object")
          ? (x.value || x.text || x.name || x.label || JSON.stringify(x))
          : String(x)).filter(Boolean);
        if (!flat.length) return "";
        v = flat.join(", ");
      } else if (typeof value === "object") {
        const scalar = value.value ?? value.text ?? value.name ?? value.label;
        if (scalar !== undefined && scalar !== null && scalar !== "") {
          v = String(scalar);
          const extras = Object.entries(value)
            .filter(([k, val]) => !["value","text","name","label"].includes(k)
              && val !== undefined && val !== null && val !== ""
              && typeof val !== "object")
            .map(([k, val]) => `${k}: ${val}`);
          if (extras.length) v += ` (${extras.join("; ")})`;
        } else {
          const entries = Object.entries(value)
            .filter(([, val]) => val !== undefined && val !== null && val !== "" && val !== false)
            .map(([k, val]) => {
              if (val === true) return k;
              if (typeof val === "object") {
                const inner = val.value ?? val.text ?? val.name ?? val.label;
                return inner ? `${k}: ${inner}` : k;
              }
              return `${k}: ${val}`;
            });
          if (!entries.length) return "";
          v = entries.join("; ");
        }
      } else {
        v = String(value);
      }
      if (v === "" || v === "[object Object]") return "";
      return `<div${isFull ? ' class="full"' : ''}><span class="lbl">${escapeHtml(label)}</span><span class="val">${escapeHtml(v)}</span></div>`;
    };
    const _section = (title, color, bodyHtml) => bodyHtml
      ? `<div class="rfx-h" style="background:${color}20;color:${color};border-left:3px solid ${color}">${escapeHtml(title)}</div>${bodyHtml}` : "";
    const _grid = (cells) => cells.filter(Boolean).length
      ? `<div class="rfx-grid">${cells.filter(Boolean).join("")}</div>` : "";
    const _narr = (text) => text ? `<div class="rfx-narr">${escapeHtml(String(text))}</div>` : "";

    // ── R7fx-B PER-TYPE COMPACT BUILDERS ──────────────────────────────────
    // Each builder returns { bodyHtml, suppressSoap, suppressGenericDetails }
    // — the assembly below uses these flags to skip the generic SOAP +
    // Additional-Details blocks where the structured builder owns the page.
    const nd = note.noteDetails || {};
    const TYPE_BUILDERS = {
      // ─── ADMISSION (AAC.1) ──────────────────────────────────────────
      admission: () => {
        const identityPanel = _section("Admission Identity", "#4f46e5", _grid([
          _kv("Mode of Admission", nd.modeOfAdmission),
          _kv("Brought By", nd.broughtBy),
          _kv("First Contact", nd.firstContactTime),
          _kv("Triage Category", nd.triageCategory),
          _kv("Admitting Dept", nd.admittingDept),
          _kv("Consultant On-Call", nd.consultantOnCall),
          _kv("Bed Allocated", nd.bedAllocated),
          _kv("Risk Stratification", nd.riskStratification),
          _kv("Infection Status", nd.infectionStatus, true),
        ]));
        const cc = note.soap?.subjective ? _section("Chief Complaint / HPI", "#0d9488", _narr(note.soap.subjective)) : "";
        const exam = note.soap?.objective ? _section("Examination", "#475569", _narr(note.soap.objective)) : "";
        const ax = note.soap?.assessment ? _section("Assessment", "#d97706", _narr(note.soap.assessment)) : "";
        const pl = note.soap?.plan ? _section("Initial Plan", "#16a34a", _narr(note.soap.plan)) : "";
        return { bodyHtml: compactGridCss + identityPanel + diagHtml + cc + exam + ax + pl + vitalsHtml + ordersHtml + medOrdersHtml + infOrdersHtml, suppressSoap: true, suppressGenericDetails: true };
      },

      // ─── ICU (COP.5) ───────────────────────────────────────────────
      icu: () => {
        // R7gb P0-5 — NABH COP.5 Bundle Compliance: all 5 rows MUST
        // render. Missing or false bundle elements are the precise
        // audit signal; dropping them hides VAP/DVT/stress-ulcer/
        // glycaemic gaps from reviewers.
        const bc = nd.bundleCompliance || {};
        const bcRows = [
          ["VAP — HOB Elevated ≥30°", bc.vapHobElevated],
          ["VAP — Oral Care q4h", bc.vapOralCare],
          ["DVT Prophylaxis", bc.dvtProphylaxis],
          ["Stress-ulcer Prophylaxis", bc.stressUlcerProphylaxis],
          ["Glycaemic Control", bc.glucoseControl],
        ];
        const bundleTable = `<table class="rfx-tbl"><tr><th>NABH COP.5 Bundle Element</th><th>Status / Intervention</th></tr>${bcRows.map(r => {
            const raw = r[1];
            let cellHtml;
            if (raw === undefined || raw === null || raw === "") {
              cellHtml = `<strong style="color:#dc2626">✗ NOT DONE</strong>`;
            } else if (raw === false) {
              cellHtml = `<strong style="color:#dc2626">✗ NOT DONE</strong>`;
            } else {
              const v = String(raw).toLowerCase();
              if (v === "false" || v.includes("not done") || v.includes("✗")) {
                cellHtml = `<strong style="color:#dc2626">✗ NOT DONE</strong> ${escapeHtml(String(raw))}`;
              } else {
                cellHtml = `<strong>${escapeHtml(String(raw))}</strong>`;
              }
            }
            return `<tr><td>${escapeHtml(r[0])}</td><td>${cellHtml}</td></tr>`;
          }).join("")}</table>`;
        const icuPanel = _section("ICU Snapshot", "#dc2626", _grid([
          _kv("Ventilator Status", nd.ventilatorStatus),
          _kv("Vasopressors", nd.vasopressors),
          _kv("Sedation Status", nd.sedationStatus),
          _kv("Invasive Lines", nd.invasiveLines, true),
        ]));
        const bundlePanel = _section("Bundle Compliance (NABH COP.5)", "#dc2626", bundleTable);
        const goalsPanel = _section("Goals of Care & Family Meeting", "#475569", _grid([
          _kv("Goals of Care", nd.goalsOfCare, true),
          _kv("Family Meeting", nd.familyMeeting, true),
        ]));
        return { bodyHtml: compactGridCss + icuPanel + bundlePanel + goalsPanel + vitalsHtml + diagHtml + soapHtml, suppressSoap: true, suppressGenericDetails: true };
      },

      // ─── PROCEDURE (COP.10) ────────────────────────────────────────
      procedure: () => {
        const proc = _section(`Procedure — ${nd.procedureName || "—"}`, "#ea580c", _grid([
          _kv("Indication", nd.indication, true),
          _kv("Anatomical Site", nd.anatomicalSite),
          _kv("Operator", nd.operator || nd.surgeon),
          _kv("Assistants", nd.assistants || nd.assistant),
          _kv("Consent", nd.consentType || nd.consentObtained),
          _kv("Asepsis Maintained", nd.asepsisMaintained),
          _kv("WHO Timeout Performed", nd.timeoutPerformed),
        ]));
        const out = _section("Outcome & Recovery", "#475569", _grid([
          _kv("Complications", nd.complications, true),
          _kv("Initial Drainage / Output", nd.initialDrainage),
          _kv("Specimens", nd.specimens || nd.specimenSent),
          _kv("Post-procedure Vitals", nd.postProcedureVitals, true),
        ]));
        const narr = (note.soap?.objective || note.soap?.assessment)
          ? _section("Technique & Findings", "#475569", _narr([note.soap.objective, note.soap.assessment].filter(Boolean).join("\n\n")))
          : "";
        const postOrders = note.soap?.plan ? _section("Post-procedure Orders", "#16a34a", _narr(note.soap.plan)) : "";
        return { bodyHtml: compactGridCss + proc + narr + out + postOrders + ordersHtml, suppressSoap: true, suppressGenericDetails: true };
      },

      // ─── CONSULTATION (COP.1) ──────────────────────────────────────
      consultation: () => {
        const masthead = _section("Referral Masthead", "#7c3aed", _grid([
          _kv("From", nd.referredBy),
          _kv("To", nd.referredTo || nd.consultantName),
          _kv("Speciality", nd.speciality),
          _kv("Consultant Seen", nd.consultantSeen),
          _kv("Reason for Consult", nd.consultReason || nd.reason, true),
        ]));
        const summary = note.soap?.subjective ? _section("Clinical Summary", "#475569", _narr(note.soap.subjective)) : "";
        const findings = note.soap?.objective ? _section("Findings", "#475569", _narr(note.soap.objective)) : "";
        const imp = note.soap?.assessment ? _section("Impression", "#d97706", _narr(note.soap.assessment)) : "";
        const recos = note.soap?.plan ? _section("Recommendations & Follow-up", "#7c3aed", _narr(note.soap.plan)) : "";
        const loop = nd.recommendationsAccepted ? `<div style="margin-top:8px;padding:6px 10px;background:#ecfeff;border-left:3px solid #06b6d4;font-size:11px"><strong>Loop closure:</strong> ${escapeHtml(String(nd.recommendationsAccepted))}</div>` : "";
        return { bodyHtml: compactGridCss + masthead + summary + findings + imp + recos + loop + diagHtml, suppressSoap: true, suppressGenericDetails: true };
      },

      // ─── DISCHARGE (COP.21) — compact builder ──────────────────────
      discharge: () => {
        const meta = _section("Discharge Summary", "#16a34a", _grid([
          _kv("Admission Date", nd.admissionDate),
          _kv("Discharge Date", nd.dischargeDate),
          _kv("Length of Stay", nd.lengthOfStay),
          _kv("Outcome", nd.outcome),
          _kv("Disposition", nd.disposition, true),
        ]));
        const dx = diagHtml; // already includes final + ICD-10
        const course = note.soap?.subjective || note.soap?.objective || note.soap?.assessment
          ? _section("Course in Hospital", "#475569", _narr([note.soap?.subjective, note.soap?.objective, note.soap?.assessment].filter(Boolean).join("\n\n")))
          : "";
        const meds = nd.dischargeMedications
          ? _section("Discharge Medications", "#4f46e5", `<div style="font-size:11.5px;padding:6px 10px;background:#eef2ff;border-radius:4px">${escapeHtml(nd.dischargeMedications)}</div>`)
          : medOrdersHtml;
        const fup = Array.isArray(nd.followUp)
          ? _section("Follow-up Plan", "#0d9488", `<ul style="margin:4px 0;padding-left:18px;font-size:11.5px">${nd.followUp.map(f => `<li>${escapeHtml(f)}</li>`).join("")}</ul>`)
          : nd.followUp ? _section("Follow-up Plan", "#0d9488", _narr(nd.followUp))
          : "";
        const adv = note.soap?.plan ? _section("Discharge Instructions", "#0d9488", _narr(note.soap.plan)) : "";
        const certs = Array.isArray(nd.certificatesIssued)
          ? _section("Certificates Issued", "#475569", `<p style="font-size:11px;margin:0">${nd.certificatesIssued.map(escapeHtml).join(" · ")}</p>`) : "";
        const edu = nd.instructionsGiven ? _section("Education / Counselling", "#475569", _narr(nd.instructionsGiven)) : "";
        return { bodyHtml: compactGridCss + meta + dx + course + meds + fup + adv + edu + certs, suppressSoap: true, suppressGenericDetails: true };
      },

      // ─── DEATH (COP.19) — MCCD chain, NO SOAP ──────────────────────
      death: () => {
        // R7gb P0-6/P0-7 — death-note compliance: certifier MCI reg always
        // present in pronouncement; Family Informed + Administrative
        // sections force-render with "— NOT DOCUMENTED —" red placeholder
        // so a blank section never silently masks a NABH COP.19 gap.
        const _kvReq = (label, value, isFull = false) => {
          const has = value !== undefined && value !== null && value !== "";
          if (has) return _kv(label, value, isFull);
          return `<div${isFull ? ' class="full"' : ''}><span class="lbl">${escapeHtml(label)}</span><span class="val" style="color:#b91c1c;font-weight:600">— NOT DOCUMENTED —</span></div>`;
        };
        const _sectionReq = (title, color, cells) =>
          `<div class="rfx-h" style="background:${color}20;color:${color};border-left:3px solid ${color}">${escapeHtml(title)}</div><div class="rfx-grid">${cells.join("")}</div>`;
        const banner = `<div class="rfx-banner" style="background:#fef2f2;color:#991b1b;border:2px solid #dc2626;text-align:center">DEATH SUMMARY · NABH COP.19 · WHO MCCD</div>`;
        const headline = _section("Pronouncement", "#dc2626", _grid([
          _kv("Time of Death", nd.timeOfDeath || nd.dateTime),
          _kv("Mode of Death", nd.modeOfDeath),
          _kv("Place of Death", nd.placeOfDeath),
          _kv("Pronounced By", nd.certifiedBy || note.signedByName),
          _kv("Certifier Reg No", nd.certifiedByReg || note.signedByReg || note.doctorRegNo),
        ]));
        // MCCD cause-of-death chain
        const mccdRows = [
          ["I (a) Immediate Cause", nd.causeDeath1 || nd.causeOfDeath],
          ["I (b) Antecedent Cause", nd.causeDeath2],
          ["I (c) Underlying Cause", nd.causeDeath3],
          ["II Contributing Conditions", nd.contributing],
        ].filter(r => r[1]);
        const mccdTable = mccdRows.length
          ? `<table class="rfx-tbl"><tr><th style="width:35%">WHO MCCD Layer</th><th>Cause</th></tr>${mccdRows.map(r => `<tr><td>${escapeHtml(r[0])}</td><td><strong>${escapeHtml(String(r[1]))}</strong></td></tr>`).join("")}</table>`
          : "";
        const mccd = _section("Cause of Death (MCCD)", "#dc2626", mccdTable);
        const seq = nd.sequenceOfEvents ? _section("Sequence of Events", "#475569", _narr(nd.sequenceOfEvents)) : "";
        // R7gb P0-7 — force-render Family Informed + Administrative with
        // red placeholders for any missing field. Blank sections were
        // previously elided entirely, masking NABH COP.19 documentation
        // gaps as compliance.
        const family = _sectionReq("Family Informed", "#475569", [
          _kvReq("Family Member", nd.familyInformed),
          _kvReq("Informed By", nd.familyInformedBy),
          _kvReq("Informed At", nd.familyInformedTime),
        ]);
        const admin = _sectionReq("Administrative", "#475569", [
          _kvReq("MLC Required", nd.mlcRequired || nd.mlc),
          _kvReq("DNR in Place", nd.dnrInPlace),
          _kvReq("PM Advised", nd.pmAdvised),
          _kvReq("PM Done", nd.postMortemDone),
          _kvReq("Certificate No", nd.deathCertificateNumber),
          _kvReq("Body Disposition", nd.bodyDisposition, true),
        ]);
        const finalDx = note.finalDiagnosis ? _section("Final Diagnosis", "#0f172a", `<p style="font-size:12px;margin:0">${escapeHtml(note.finalDiagnosis)}${note.icd10Code ? ` · ${escapeHtml(note.icd10Code)}` : ""}</p>`) : "";
        return { bodyHtml: compactGridCss + banner + headline + mccd + seq + finalDx + family + admin, suppressSoap: true, suppressGenericDetails: true };
      },

      // ─── AMENDMENT (IMS.2) — NO SOAP, retain-original banner ───────
      amendment: () => {
        const banner = `<div class="rfx-banner" style="background:#fffbeb;color:#92400e;border:2px solid #f59e0b;text-align:center">CLINICAL DOCUMENT AMENDMENT · NABH IMS.2 · ORIGINAL RECORD RETAINED</div>`;
        const origRef = _section("Original Note Reference", "#94a3b8", _grid([
          _kv("Original Note Type", nd.originalNoteType),
          _kv("Original Note Date", nd.originalNoteDate),
          _kv("Original Note ID", nd.originalNoteId),
        ]));
        const reason = nd.amendmentReason
          ? `<div style="margin:8px 0;padding:10px 14px;background:#fef3c7;border-left:4px solid #f59e0b;font-size:12px"><strong style="display:block;margin-bottom:4px;color:#92400e">Reason for Amendment</strong>${escapeHtml(nd.amendmentReason)}</div>` : "";
        const changes = nd.valueChanged
          ? _section("What Changed", "#d97706", `<div style="padding:8px 12px;background:#fff7ed;border:1px dashed #f59e0b;font-size:11.5px;white-space:pre-wrap">${escapeHtml(String(nd.valueChanged))}</div>`)
          : nd.beforeValue && nd.afterValue
          ? _section("What Changed", "#d97706", `<table class="rfx-tbl"><tr><th>Before</th><th>After</th></tr><tr><td>${escapeHtml(String(nd.beforeValue))}</td><td>${escapeHtml(String(nd.afterValue))}</td></tr></table>`)
          : "";
        const witness = _section("Witness / Co-signature", "#16a34a", _grid([
          _kv("Witnessed By", nd.witnessedBy),
          _kv("Compliance Note", nd.complianceNote, true),
        ]));
        const narr = note.soap?.assessment ? _section("Clinical Note", "#475569", _narr(note.soap.assessment)) : "";
        return { bodyHtml: compactGridCss + banner + origRef + reason + changes + witness + narr, suppressSoap: true, suppressGenericDetails: true };
      },

      // ─── OPERATIVE (COP.13) ────────────────────────────────────────
      operative: () => {
        const proc = _section(`Operative Note — ${nd.procedurePerformed || nd.procedureName || "—"}`, "#7c3aed", _grid([
          _kv("Pre-op Diagnosis", nd.preopDiagnosis),
          _kv("Post-op Diagnosis", nd.postopDiagnosis),
          _kv("Surgeon", nd.surgeon || nd.operator),
          _kv("Assistants", nd.assistants || nd.assistant),
          _kv("Anaesthetist", nd.anaesthetist),
          _kv("Anaesthesia Type", nd.anaesthesia),
          _kv("Start Time", nd.startTime),
          _kv("End Time", nd.endTime),
        ]));
        const findings = nd.operativeFindings ? _section("Operative Findings", "#475569", _narr(nd.operativeFindings)) : "";
        const technique = nd.technique || note.soap?.objective ? _section("Technique", "#475569", _narr(nd.technique || note.soap.objective)) : "";
        const intra = _section("Intra-operative", "#475569", _grid([
          _kv("Blood Loss", nd.bloodLoss),
          _kv("Transfusion", nd.transfusion),
          _kv("Fluids Given", nd.fluidsGiven),
          _kv("Urine Output", nd.urineOutput),
          _kv("Specimens", nd.specimens || nd.specimenSent, true),
        ]));
        const recov = (nd.complications || nd.conditionLeavingOT || nd.recoveryInstructions || nd.postopOrders)
          ? _section("Recovery & Post-op Orders", "#16a34a", _grid([
              _kv("Complications", nd.complications, true),
              _kv("Condition Leaving OT", nd.conditionLeavingOT, true),
              _kv("Recovery Instructions", nd.recoveryInstructions, true),
              _kv("Post-op Orders", nd.postopOrders, true),
            ]))
          : "";
        return { bodyHtml: compactGridCss + proc + findings + technique + intra + recov, suppressSoap: true, suppressGenericDetails: true };
      },

      // ─── PRE-OPERATIVE (COP.13) — WHO Sign-In ──────────────────────
      preop: () => {
        const banner = `<div class="rfx-banner" style="background:#ecfeff;color:#155e75;border:2px solid #06b6d4;text-align:center">WHO SURGICAL SAFETY CHECKLIST — SIGN-IN · Pre-operative Assessment · NABH COP.13</div>`;
        const proc = _section("Planned Procedure", "#0891b2", _grid([
          _kv("Planned Procedure", nd.plannedProcedure || nd.procedure, true),
          _kv("Pre-op Diagnosis", nd.preopDiagnosis),
          _kv("Indication", nd.indication),
          _kv("ASA Class", nd.asaClass || nd.asaGrade),
          _kv("Laterality", nd.laterality),
        ]));
        const nbm = nd.nbmStatus
          ? `<div style="margin:8px 0;padding:8px 14px;background:#fef9c3;border:2px solid #ca8a04;border-radius:6px;font-size:13px;text-align:center;font-weight:700;color:#854d0e">NBM STATUS: ${escapeHtml(nd.nbmStatus)}</div>`
          : "";
        const anaes = _section("Anaesthesia Plan", "#475569", _grid([
          _kv("Anaesthesia Plan", nd.anaesthesiaPlan, true),
          _kv("Surgeon", nd.surgeon),
          _kv("Anaesthetist", nd.anaesthetist),
          _kv("Consent Obtained", nd.consentObtained),
        ]));
        // NON-collapsible WHO checklist tickbox table — R7gb P0-4: NABH
        // COP.13 requires ALL rows render unconditionally. false → ✗ NOT
        // CHECKED (red), null/undefined → — NOT RECORDED — (red).
        // Dropping unchecked rows masks safety gaps as compliance.
        const ck = nd.preopChecklist || {};
        const checklistRows = [
          ["Patient identity confirmed", ck.identityConfirmed],
          ["Consent signed", ck.consentSigned],
          ["Surgical site marked", ck.siteMarked],
          ["Allergies reviewed", ck.allergiesReviewed],
          ["Blood available (if needed)", ck.bloodAvailable],
          ["Imaging available", ck.imagingAvailable],
          ["Anaesthetist review complete", ck.anaesthetistReview],
        ];
        const checklistTable = `<table class="rfx-tbl"><tr><th style="width:65%">WHO Safety Sign-In Item</th><th style="width:35%">Status</th></tr>${checklistRows.map(r => {
            const raw = r[1];
            let cellHtml;
            if (raw === undefined || raw === null || raw === "") {
              cellHtml = `<strong style="color:#dc2626;font-size:13px">— NOT RECORDED —</strong>`;
            } else if (raw === false) {
              cellHtml = `<strong style="color:#dc2626;font-size:13px">✗ NOT CHECKED</strong>`;
            } else {
              const v = String(raw).toLowerCase();
              if (v === "false" || v.includes("not done") || v.includes("not checked") || v.includes("✗")) {
                cellHtml = `<strong style="color:#dc2626;font-size:13px">✗ NOT CHECKED</strong> ${escapeHtml(String(raw))}`;
              } else if (v === "n/a" || v.includes("n/a")) {
                cellHtml = `<strong style="color:#475569;font-size:13px">N/A</strong> ${escapeHtml(String(raw))}`;
              } else {
                cellHtml = `<strong style="color:#16a34a;font-size:13px">✓</strong> ${escapeHtml(String(raw))}`;
              }
            }
            return `<tr><td>${escapeHtml(r[0])}</td><td>${cellHtml}</td></tr>`;
          }).join("")}</table>`;
        const checklist = _section("WHO Safety Checklist (Non-collapsible)", "#0891b2", checklistTable);
        const vitals = nd.preopVitals ? _section("Pre-op Vitals", "#475569", _narr(nd.preopVitals)) : vitalsHtml;
        return { bodyHtml: compactGridCss + banner + proc + nbm + anaes + checklist + vitals, suppressSoap: true, suppressGenericDetails: true };
      },

      // ─── POST-OPERATIVE (COP.14) ───────────────────────────────────
      postop: () => {
        const proc = _section(`Post-operative — ${nd.procedurePerformed || "—"}`, "#16a34a", _grid([
          _kv("Procedure Performed", nd.procedurePerformed, true),
          _kv("Post-op Diagnosis", nd.postopDiagnosis, true),
        ]));
        const recovery = _section("Recovery Snapshot", "#16a34a", _grid([
          _kv("Post-op Vitals", nd.postopVitals, true),
          _kv("Consciousness", nd.consciousness),
          _kv("Pain Score", nd.painScore),
          _kv("Complications", nd.complications, true),
          _kv("Recovery Time", nd.recoveryTime),
          _kv("Analgesia", nd.analgesia),
          _kv("Ward Transfer Time", nd.wardTransferTime, true),
        ]));
        const orders = note.soap?.plan ? _section("Post-op Orders", "#4f46e5", _narr(note.soap.plan)) : "";
        return { bodyHtml: compactGridCss + proc + recovery + orders + ordersHtml, suppressSoap: true, suppressGenericDetails: true };
      },

      // ─── INITIAL ASSESSMENT (COP.1) — compact ─────────────────────
      initial: () => {
        // Honour note.section if present (doctor/nursing/both)
        const docPayload = nd.doctor || nd;       // R7fa split
        const nabh      = docPayload.nabh || {};
        // R7gb P0-3b — allergies banner: form persists docAllergy (string) +
        // nabh.allergies.list (array). Old code only read
        // docPayload.allergies which never existed → banner never fired.
        // Read all known shapes; also surface NKDA confirmation.
        const allergyText = (() => {
          if (Array.isArray(nabh.allergies?.list) && nabh.allergies.list.length) {
            return nabh.allergies.list.map(a => (a && typeof a === "object") ? (a.name || a.value || a.text || JSON.stringify(a)) : String(a)).join(", ");
          }
          if (docPayload.docAllergy && String(docPayload.docAllergy).trim()) return String(docPayload.docAllergy);
          if (Array.isArray(docPayload.allergies?.list) && docPayload.allergies.list.length) {
            return docPayload.allergies.list.map(a => (a && typeof a === "object") ? (a.name || a.value || a.text || JSON.stringify(a)) : String(a)).join(", ");
          }
          if (docPayload.allergies?.knownAllergies) return String(docPayload.allergies.knownAllergies);
          if (typeof docPayload.allergies === "string" && docPayload.allergies.trim()) return docPayload.allergies;
          return "";
        })();
        const allergyNkda = nabh.allergies?.noKnown || docPayload.allergies?.noKnown;
        const allergiesBanner = allergyText
          ? `<div class="rfx-banner" style="background:#fef2f2;color:#991b1b;border:2px solid #dc2626;text-align:center">⚠ ALLERGIES: ${escapeHtml(allergyText)}</div>`
          : allergyNkda
          ? `<div class="rfx-banner" style="background:#ecfdf5;color:#065f46;border:2px solid #10b981;text-align:center">✓ NKDA — No Known Drug Allergies</div>`
          : "";
        const chiefComplaint = _section("Chief Complaint & HPI", "#0d9488", _grid([
          _kv("Chief Complaint", nabh.chiefComplaint || docPayload.chiefComplaint || docPayload.docCC, true),
          _kv("Duration", nabh.ccDuration || docPayload.duration || docPayload.ccDuration),
          _kv("Mode of Admission", docPayload.admissionMode || docPayload.modeOfAdmission),
          // R7gb P0-1 — form persists `hopi` not `hpi`; also fall back to
          // top-level historyOfPresentIllness (mirrored at save time)
          _kv("HPI", docPayload.hpi || docPayload.hopi || note.historyOfPresentIllness, true),
        ]));
        const pmh = _section("Past History", "#475569", _grid([
          _kv("Past Medical", docPayload.pastMedical || docPayload.pmh, true),
          _kv("Past Surgical", docPayload.pastSurgical || docPayload.psh, true),
          _kv("Family Hx", docPayload.familyHistory || docPayload.famHx),
          _kv("Social Hx", docPayload.socialHistory || docPayload.socHx),
        ]));
        const exam = _section("Examination", "#475569", _grid([
          _kv("General Condition", docPayload.generalCondition),
          _kv("Built / Nutrition", docPayload.builtNutrition),
          _kv("Resp / CVS / Abdomen / CNS", [docPayload.resp || docPayload.rs, docPayload.cvs, docPayload.abdomen, docPayload.cns].filter(Boolean).join(" · "), true),
        ]));
        const dx = _section("Diagnosis & Plan", "#d97706", _grid([
          _kv("Provisional Dx", docPayload.provDx || docPayload.provisionalDx || note.provisionalDiagnosis),
          // R7gb P0-2 — promote nabh.* to PRIMARY lookup. Form persists
          // working/differential/comorbidities under noteDetails.doctor.nabh.*,
          // not at docPayload top level. Previous order read docPayload.*
          // first so these cells stayed blank even when filled.
          _kv("Working Dx", nabh.workingDx || docPayload.workingDx || note.workingDiagnosis),
          _kv("Differential Dx", nabh.differentialDx || docPayload.differentialDx),
          _kv("Final Dx", docPayload.finalDx || note.finalDiagnosis),
          _kv("ICD-10", docPayload.icd10 || note.icd10Code),
          _kv("Comorbidities", nabh.comorbidities || docPayload.comorbidities),
          _kv("Code Status", nabh.codeStatus || docPayload.codeStatus),
          _kv("Goal of Care", nabh.goalOfCare || docPayload.goalOfCare),
          _kv("ELOS (days)", nabh.elosDays || docPayload.elosDays),
          _kv("Risk Acknowledgement", nabh.riskAcknowledgement || docPayload.riskAcknowledgement, true),
        ]));
        const plan = _section("Initial Treatment Plan", "#16a34a", _narr(docPayload.managementPlan || note.soap?.plan));
        return { bodyHtml: compactGridCss + allergiesBanner + chiefComplaint + pmh + exam + vitalsHtml + dx + plan + medOrdersHtml + infOrdersHtml, suppressSoap: true, suppressGenericDetails: true };
      },
    };

    // R7fx-B — invoke per-type builder when present
    const builder = TYPE_BUILDERS[note.noteType];
    const typeSpecific = typeof builder === "function" ? builder() : null;

    // R7fq Track C — body block (status pill row + clinical sections).
    // R7fx — per-type compact builder takes precedence over the generic
    // SOAP + Additional-Details flow. The generic flow stays for SOAP-shaped
    // types (general, progress, daily, assessment) and as a fallback.
    const noteBodyHtml = `
  <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;padding-bottom:10px;border-bottom:1px solid #e2e8f0">
    <div style="padding:5px 14px;border-radius:6px;font-size:13px;font-weight:800;background:#eef2ff;color:#4338ca">${modLabel}</div>
    <div style="padding:4px 10px;border-radius:5px;font-size:11px;font-weight:700;background:${note.status==="signed"?"#dcfce7":"#fffbeb"};color:${note.status==="signed"?"#16a34a":"#d97706"}">${note.status==="signed"?"✓ SIGNED":"DRAFT"}</div>
    ${note.isCritical ? '<div style="padding:4px 10px;border-radius:5px;font-size:11px;font-weight:700;background:#fef2f2;color:#dc2626">⚠ CRITICAL EVENT</div>' : ""}
    <div style="margin-left:auto;font-size:12px;color:#64748b">Shift: <strong style="text-transform:capitalize">${shift}</strong> · Recorded: ${noteDate}</div>
  </div>
  ${lateEntryBanner}
  ${typeSpecific ? typeSpecific.bodyHtml : `${vitalsHtml}${soapHtml}${diagHtml}${invHtml}${ordersHtml}${medOrdersHtml}${infOrdersHtml}${tagsHtml}${noteDetailsHtml}`}
  ${tagsHtml && typeSpecific ? tagsHtml : ""}
  ${sigHtml}`;

    // Consultant / Resident split for the signature zone:
    //   - Right = Consultant (note.doctorName or current doctor of record)
    //   - Left  = Resident (signedBy if different from consultant, else falls back)
    // If no Consultant is recorded fall back to "single" stamp with the
    // current doctor (matches the contract's fallback rule).
    const consultantName = note.doctorName || doctorName || "";
    const consultantReg  = note.doctorRegNo || doctorRegNo || "";
    const residentName   = note.signedByName && note.signedByName !== consultantName
      ? note.signedByName : "";
    const sigSpec = consultantName
      ? {
          type: "double",
          left:  { name: residentName || "", role: "Resident Doctor", reg: "" },
          right: { name: consultantName, role: "Consultant", reg: consultantReg },
        }
      : {
          type: "single",
          centre: { name: doctorName || "—", role: "Doctor", reg: doctorRegNo || "" },
        };

    // Pull a department for the subtitle if available on patient / note.
    const _dept = patient?.department || patient?.attendingDoctorDept || note?.department || "";

    const html = buildPrintShellHtml({
      hospital: hs,
      docTitle: `Doctor Note — ${modLabel}`,
      docSubtitle: _dept ? `Department of ${_dept}` : "Clinical Documentation",
      patient: {
        left: [
          { label: "Reg. No",      value: uhid },
          { label: "Patient Name", value: pName },
          { label: "Age",          value: patient?.age || patient?.patientId?.age || "—" },
          { label: "Sex",          value: patient?.gender || patient?.patientId?.gender || "—" },
          { label: "Contact",      value: patient?.contactNumber || patient?.patientId?.contactNumber || "—" },
          { label: "Address",      value: patient?.completeAddress || patient?.patientId?.completeAddress || "—" },
        ],
        right: [
          { label: "Episode No",          value: ipd },
          { label: "DOA",                 value: patient?.admissionDate
              ? new Date(patient.admissionDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
              : "—" },
          { label: "Note Date",           value: noteDate },
          { label: "Ward",                value: _wn || "—" },
          { label: "Admitting Consultant", value: patient?.attendingDoctor || consultantName || "—" },
          { label: "Bed",                 value: _bn || "—" },
        ],
      },
      signatures: sigSpec,
      banners: { emergency24x7: true, homeCare: false },
      meta: {
        docNumber: note._id || ipd,
        pageOf: "Page 1 of 1",
      },
      bodyHtml: noteBodyHtml,
    });

    const w = window.open("", "_blank", "width=900,height=700");
    if (w) { w.document.write(html); w.document.close(); }
  };

  /* ══════════════════════════════════════════════════════════════ */
  return (
    // R7hr-63: dropped redundant marginLeft: 260 — ClinicalLayout's
    // flex parent already reserves the AdmittedPatientPanel slot, so
    // the old margin was just wasted whitespace between the panel and
    // the content (page looked congested on the right because content
    // was being squeezed 260px to the right of where it belonged).
    <div style={{ padding: "24px 28px", minHeight: "100vh", background: C.bg, fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: C.text }}>

      {/* R7hr-231 — floating Nursing Plan editor + quick shortcuts (only with a patient loaded) */}
      {patient && (
        <DoctorQuickTools
          uhid={patient?.UHID || patient?.uhid || searchUHID}
          admissionId={patient?._id || ""}
          ipdNo={patient?.ipdNo || patient?.admissionNumber || ""}
        />
      )}

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


      {/* ── Patient header (shared component — identical to Nursing) ── */}
      {!patient ? (
        <PatientHeaderCard
          patient={null}
          searchUHID={searchUHID}
          onSearchChange={setSearchUHID}
          onLoad={loadPatient}
          loading={loading}
          loadSubtitle="Select from above or enter UHID manually"
        />
      ) : (
        <>
          <PatientHeaderCard
            patient={patient}
            searchUHID={searchUHID}
            diagnosis={diag}
            onChangePatient={() => { setPatient(null); setNotes([]); setSearchUHID(""); }}
          />

          {/* R7ba — Removed both the red "Initial Assessment not completed
              — NABH COP.1" gate banner and the green "Initial Assessment
              completed & signed" confirmation banner. They were leftovers
              from the modal era; with the Emergency Assessment inline tile
              taking over as the doctor's per-patient assessment surface,
              showing a second top-of-page banner about a separate
              Initial Assessment workflow was visual noise. NABH compliance
              capture moves into the Emergency Assessment form itself
              (which already records triage / ABCDE / vitals / orders /
              disposition — the same data NABH COP.1 expects from initial
              assessment). The gate / assessmentDone state is still
              computed below in case other components want to read it,
              but no banner is rendered from this page anymore. */}

          {/* ══ TILE GRID (when no section is active) ════════════════════════
                Doctor Notes is split into 6 tiles. Click → that section
                expands inline below. Counts come from already-loaded
                state (notes, diag, etc.). Sections owned by child
                components (Orders / MAR / Team) show a generic "Open"
                until we lift their counts up. */}
          {patient && !activeTile && (
            <div className="dnp-tiles-grid" role="navigation" aria-label="Doctor Notes sections">
              {[
                {
                  id: "diagnosis",
                  title: "Patient Diagnosis",
                  subtitle: "Provisional → Working → Final + ICD-10",
                  icon: "pi-bookmark",
                  color: "#4f46e5",
                  tint: "#e0e7ff",
                  badges: [
                    diag.provisional || diag.working || diag.final
                      ? { label: "Filled", tone: "ok" }
                      : { label: "Empty", tone: "warn" },
                    diag.status ? { label: diag.status, tone: "info" } : null,
                  ].filter(Boolean),
                },
                {
                  id: "orders",
                  title: "Doctor Orders & History",
                  subtitle: "Active orders + full audit trail (NABH COP.2)",
                  icon: "pi-list-check",
                  color: "#7c3aed",
                  tint: "#ede9fe",
                  badges: [{ label: "Open", tone: "info" }],
                },
                {
                  id: "mar",
                  title: "Treatment Chart — Live MAR",
                  subtitle: "Medication MAR + Infusion monitoring",
                  icon: "pi-chart-bar",
                  color: "#db2777",
                  tint: "#fce7f3",
                  badges: [{ label: "Open", tone: "info" }],
                },
                {
                  id: "team",
                  title: "Treatment Team",
                  subtitle: "Primary consultant + consultations (COP.1)",
                  icon: "pi-users",
                  color: "#0d9488",
                  tint: "#ccfbf1",
                  badges: [{ label: "Open", tone: "info" }],
                },
                // R7hr-143 — Pending Investigation Reports tile (mirrors
                // the same tile in NursingNotes hub). Re-uses shared
                // PendingInvestigationReportsTab so filter + step logic
                // stays single-sourced.
                {
                  id: "pendingreports",
                  title: "Pending Investigation Reports",
                  subtitle: "Samples sent — awaiting result (NABH AAC.4)",
                  icon: "pi-flask",
                  color: "#b45309",
                  tint: "#fef3c7",
                  badges: [{ label: "Open", tone: "warn" }],
                },
                {
                  id: "addnote",
                  title: "Add a Note",
                  subtitle: "Shift, Daily Progress, ICU, Procedure, Consultation…",
                  icon: "pi-plus-circle",
                  color: "#16a34a",
                  tint: "#dcfce7",
                  // R7bk — Per-tile "Initial Assessment required" badge
                  // is now rendered by the shared locked-badge logic in
                  // the tile loop. Keep a single "Ready" tone here.
                  badges: [{ label: "Ready", tone: "ok" }],
                },
                {
                  id: "timeline",
                  title: "Notes Timeline",
                  subtitle: "All historical notes + filters",
                  icon: "pi-history",
                  color: "#ea580c",
                  tint: "#ffedd5",
                  badges: [
                    { label: `${totalNotes} total`, tone: "info" },
                    signedNotes > 0 && { label: `${signedNotes} signed`, tone: "ok" },
                    draftNotes > 0 && { label: `${draftNotes} draft`, tone: "warn" },
                    todayNotes > 0 && { label: `${todayNotes} today`, tone: "accent" },
                  ].filter(Boolean),
                },
                /* ── R7av + R7ax — relocated from Doctor sidebar ──
                   Four full-page clinical surfaces (Emergency Assessment,
                   Discharge Summary, Consent Forms, MLC) used to be
                   top-level sidebar items. They now open INLINE as panels
                   inside DoctorNotes (same pattern as Add a Note) so the
                   "Back to All Sections" button returns straight to this
                   tile grid — no hard route change, the doctor stays on
                   the per-patient hub. Standalone routes are still
                   registered in App.jsx so deep-links from email / print
                   headers keep working. */
                // R7ev — tile adapts based on the patient's admission
                // type. Emergency cases get the ER triage + ABCDE
                // pathway; everyone else (Planned IPD, Day Care,
                // Transfer, OPD-to-IPD) gets the IPD Initial Assessment
                // — patient is already in a bed, no triage required, no
                // bed-allotment step. Both flip
                // admission.initialAssessment.doctorCompleted = true so
                // the gate on the other tiles still lifts identically.
                (() => {
                  const at = String(patient?.admissionType || "").toLowerCase();
                  const isER = at === "emergency" || at === "er";
                  return isER
                    ? {
                        id: "emergency",
                        title: "Emergency Assessment",
                        subtitle: "ER triage + initial doctor assessment (NABH AAC.1)",
                        icon: "pi-exclamation-circle",
                        color: "#dc2626",
                        tint: "#fee2e2",
                        badges: [{ label: "NABH", tone: "ok" }],
                      }
                    : {
                        id: "emergency",   // keep id so the gate-lock check below still works
                        title: "Initial Doctor Assessment",
                        subtitle: "IPD Initial Assessment — history, exam, diagnosis, plan (NABH AAC.1)",
                        icon: "pi-clipboard",
                        color: "#4f46e5",
                        tint: "#e0e7ff",
                        badges: [{ label: "NABH", tone: "ok" }],
                      };
                })(),
                {
                  id: "discharge",
                  title: "Discharge Summary",
                  subtitle: "Final summary + follow-up + meds-on-discharge (AAC.4)",
                  icon: "pi-sign-out",
                  color: "#0891b2",
                  tint: "#cffafe",
                  badges: [{ label: "NABH", tone: "ok" }],
                },
                {
                  id: "consent",
                  title: "Consent Forms",
                  subtitle: "Surgical / anaesthesia / blood-tx / HIV consents (PRE.4)",
                  icon: "pi-shield",
                  color: "#9333ea",
                  tint: "#f3e8ff",
                  badges: [{ label: "NABH", tone: "ok" }],
                },
                {
                  id: "mlc",
                  title: "Medico-Legal (MLC)",
                  subtitle: "MLC register — police info, alleged history, exhibits",
                  icon: "pi-flag",
                  color: "#a16207",
                  tint: "#fef3c7",
                  badges: [{ label: "NABH", tone: "ok" }],
                },
              ].map(t => {
                // R7bk — Doctor Initial Assessment gate. The ONLY entry
                // point to the compulsory NABH AAC.1 doctor Initial
                // Assessment is the "Emergency Assessment" tile (mounts
                // EmergencyAssessmentPageContent inline; sign-and-submit
                // flips initialAssessment.doctorCompleted = true).
                //
                // All other tiles — Patient Diagnosis, Orders, MAR, Team,
                // Add a Note, Notes Timeline, Discharge Summary, Consent
                // Forms, MLC — stay locked until that one tile is signed.
                // Add a Note used to be in the allowlist (held the inline
                // COP.1 "Initial Assessment" sub-module) but R7bk
                // deleted that sub-module too.
                const isAssessmentTile = t.id === "emergency";
                const locked = gateActive && !isAssessmentTile;
                return (
                <button
                  key={t.id}
                  type="button"
                  // R7ax — every tile (legacy + the 4 R7av relocations)
                  // now opens inline via setActiveTile. The standalone
                  // routes still exist for direct deep-links from email
                  // / print headers; the 4 inline panels below match
                  // those routes' content components.
                  onClick={() => {
                    if (locked) {
                      // R7ev — gate-lock message references the same
                      // tile label the user actually sees on the page.
                      const at = String(patient?.admissionType || "").toLowerCase();
                      const isER = at === "emergency" || at === "er";
                      const tileLabel = isER ? "'Emergency Assessment'" : "'Initial Doctor Assessment'";
                      toast.error(`⛔ Complete the Doctor Initial Assessment first — open the ${tileLabel} tile (NABH AAC.1).`, { autoClose: 5500 });
                      return;
                    }
                    setActiveTile(t.id);
                  }}
                  className={`dnp-tile ${locked ? "dnp-tile--locked" : ""}`}
                  style={{ "--tile-color": t.color, "--tile-tint": t.tint }}
                  aria-label={`Open ${t.title}${locked ? " (locked)" : ""}`}
                  aria-disabled={locked}
                >
                  <div className="dnp-tile__icon">
                    <i className={`pi ${locked ? "pi-lock" : t.icon}`} />
                  </div>
                  <div className="dnp-tile__body">
                    <div className="dnp-tile__title">{t.title}</div>
                    <div className="dnp-tile__subtitle">{t.subtitle}</div>
                    {(locked ? [{ label: "🔒 Initial Assessment required", tone: "warn" }] : t.badges).length > 0 && (
                      <div className="dnp-tile__badges">
                        {(locked ? [{ label: "🔒 Initial Assessment required", tone: "warn" }] : t.badges).map((b, i) => (
                          <span key={i} className={`dnp-tile__badge dnp-tile__badge--${b.tone}`}>
                            {b.label}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <i className="pi pi-chevron-right dnp-tile__chevron" aria-hidden />
                </button>
                );
              })}
            </div>
          )}

          {/* ── Back-to-grid button (when a tile is open) ──
              R7hr-86: alert chips now sit beside the back button so
              allergies / OVERDUE compliance stay visible without
              inflating the patient card. */}
          {patient && activeTile && (
            <div className="dnp-back-bar" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
              <button
                type="button"
                onClick={() => setActiveTile(null)}
                className="dnp-back-btn"
                aria-label="Back to all sections"
                style={{ margin: 0 }}
              >
                <i className="pi pi-arrow-left" aria-hidden /> All Sections
              </button>
              <PatientAlertStrip
                patientId={patient?._id}
                allergies={patient?.allergies || patient?.knownAllergies}
              />
            </div>
          )}
          {/* R7hr-86 — When no tile is open the alerts still belong
              alongside the tile grid; show them in a slim row right
              above the grid so allergies / OVERDUE remain visible. */}
          {patient && !activeTile && (
            <PatientAlertStrip
              patientId={patient?._id}
              allergies={patient?.allergies || patient?.knownAllergies}
            />
          )}

          {/* ══ DIAGNOSIS PANEL ══════════════════════════════════════════════ */}
          {patient && activeTile === "diagnosis" && (
            <div style={{ background: "white", border: "1.5px solid #e0e7ef", borderRadius: 14, padding: "18px 22px", marginBottom: 14, boxShadow: "0 2px 10px rgba(79,70,229,.06)" }}>
              {/* Header */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 34, height: 34, borderRadius: 9, background: "#e0e7ff", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <i className="pi pi-bookmark" style={{ fontSize: 15, color: "#4f46e5" }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: "#1e3a5f", letterSpacing: ".3px" }}>Patient Diagnosis</div>
                    <div style={{ fontSize: 11, color: "#64748b", fontWeight: 500 }}>Provisional → Working → Final + ICD-10 coding</div>
                  </div>
                </div>
                <button
                  onClick={saveDiagnosis}
                  disabled={diagSaving}
                  style={{ padding: "8px 20px", background: diagSaving ? "#93c5fd" : "#4f46e5", color: "white", border: "none", borderRadius: 8, fontFamily: "'DM Sans',sans-serif", fontSize: 12, fontWeight: 700, cursor: diagSaving ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: 6, boxShadow: diagSaving ? "none" : "0 3px 10px rgba(79,70,229,.28)" }}>
                  {diagSaving
                    ? <><i className="pi pi-spin pi-spinner" style={{ fontSize: 11 }} /> Saving…</>
                    : <><i className="pi pi-check" style={{ fontSize: 11 }} /> Update Diagnosis</>}
                </button>
              </div>

              {/* Diagnosis fields — 3-column for dx, 2-column for ICD */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
                {/* Provisional */}
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#f59e0b", flexShrink: 0 }} />
                    <span style={{ fontSize: 10, fontWeight: 700, color: "#92400e", textTransform: "uppercase", letterSpacing: ".6px" }}>Provisional Dx</span>
                  </div>
                  <input
                    value={diag.provisional}
                    onChange={e => setDiag(p => ({ ...p, provisional: e.target.value }))}
                    placeholder="Suspected diagnosis on admission"
                    style={{ width: "100%", border: "1.5px solid #fcd34d", borderRadius: 8, padding: "9px 12px", fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: "#1e293b", outline: "none", background: "#fffbeb", boxSizing: "border-box" }}
                  />
                </div>
                {/* Working */}
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#6366f1", flexShrink: 0 }} />
                    <span style={{ fontSize: 10, fontWeight: 700, color: "#4f46e5", textTransform: "uppercase", letterSpacing: ".6px" }}>Working Dx</span>
                  </div>
                  <input
                    value={diag.working}
                    onChange={e => setDiag(p => ({ ...p, working: e.target.value }))}
                    placeholder="Current evolving diagnosis"
                    style={{ width: "100%", border: "1.5px solid #93c5fd", borderRadius: 8, padding: "9px 12px", fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: "#1e293b", outline: "none", background: "#eef2ff", boxSizing: "border-box" }}
                  />
                </div>
                {/* Final */}
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#22c55e", flexShrink: 0 }} />
                    <span style={{ fontSize: 10, fontWeight: 700, color: "#166534", textTransform: "uppercase", letterSpacing: ".6px" }}>Final Dx</span>
                  </div>
                  <input
                    value={diag.final}
                    onChange={e => setDiag(p => ({ ...p, final: e.target.value }))}
                    placeholder="Confirmed final diagnosis"
                    style={{ width: "100%", border: "1.5px solid #86efac", borderRadius: 8, padding: "9px 12px", fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: "#1e293b", outline: "none", background: "#f0fdf4", boxSizing: "border-box" }}
                  />
                </div>
              </div>

              {/* ICD-10 row */}
              <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", gap: 12 }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#8b5cf6", flexShrink: 0 }} />
                    <span style={{ fontSize: 10, fontWeight: 700, color: "#5b21b6", textTransform: "uppercase", letterSpacing: ".6px" }}>ICD-10 Code</span>
                  </div>
                  <input
                    value={diag.icd10Code}
                    onChange={e => setDiag(p => ({ ...p, icd10Code: e.target.value }))}
                    placeholder="e.g. J18.9"
                    style={{ width: "100%", border: "1.5px solid #c4b5fd", borderRadius: 8, padding: "9px 12px", fontFamily: "'DM Mono',monospace", fontSize: 13, fontWeight: 700, color: "#5b21b6", outline: "none", background: "#faf5ff", boxSizing: "border-box", letterSpacing: ".5px" }}
                  />
                </div>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#8b5cf6", flexShrink: 0 }} />
                    <span style={{ fontSize: 10, fontWeight: 700, color: "#5b21b6", textTransform: "uppercase", letterSpacing: ".6px" }}>ICD-10 Description</span>
                  </div>
                  <input
                    value={diag.icd10Description}
                    onChange={e => setDiag(p => ({ ...p, icd10Description: e.target.value }))}
                    placeholder="e.g. Unspecified pneumonia, Sepsis due to Staphylococcus aureus…"
                    style={{ width: "100%", border: "1.5px solid #c4b5fd", borderRadius: 8, padding: "9px 12px", fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: "#1e293b", outline: "none", background: "#faf5ff", boxSizing: "border-box" }}
                  />
                </div>
              </div>

              {/* Status chips row */}
              <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: ".5px" }}>Patient Status:</span>
                {["Stable","Improving","Unchanged","Deteriorating","Critical","Ready for Discharge"].map(s => (
                  <button key={s} onClick={() => setDiag(p => ({ ...p, status: s }))}
                    style={{ padding: "4px 13px", borderRadius: 20, border: `1.5px solid ${diag.status === s ? "#4f46e5" : "#e2e8f0"}`, background: diag.status === s ? "#4f46e5" : "white", color: diag.status === s ? "white" : "#64748b", fontFamily: "'DM Sans',sans-serif", fontSize: 11, fontWeight: 700, cursor: "pointer", transition: "all .15s" }}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Doctor Orders Panel ── */}
          {activeTile === "orders" && (
            <DoctorOrdersPanel
              UHID={patient?.UHID || patient?.uhid || searchUHID}
              visitId={patient?.ipdNo || patient?.admissionNumber || patient?.visitId}
              ipdNo={patient?.ipdNo || patient?.admissionNumber}
              patientName={patient?.patientName || patient?.patientId?.fullName || ""}
              refreshSignal={ordersRefresh}
            />
          )}

          {/* ── NABH Treatment Chart (Doctor Full View) ── */}
          {activeTile === "mar" && (
            <div style={{ marginBottom: 14 }}>
              <TreatmentChart
                UHID={patient?.UHID || patient?.uhid || searchUHID}
                visitId={patient?.ipdNo || patient?.admissionNumber || patient?.visitId}
                // R7j: enables inline "Raise Indent" button in MAR header.
                // patient._id is the Admission ObjectId (same source used by
                // the TreatmentTeamPanel just below).
                admissionId={patient?._id || patient?.admissionId}
                patientName={patient?.patientName || patient?.patientId?.fullName || ""}
                nurseMode={false}
                refreshTrigger={ordersRefresh}
              />
            </div>
          )}

          {/* ── Treatment Team / Multi-doctor Consultation (NABH COP.1) ── */}
          {activeTile === "team" && (
            <TreatmentTeamPanel
              admissionId={patient?._id || patient?.admissionId}
              patientName={patient?.patientName || patient?.patientId?.fullName || ""}
              UHID={patient?.UHID || patient?.uhid || searchUHID}
              refreshTrigger={ordersRefresh}
            />
          )}

          {/* ── R7hr-143 — Pending Investigation Reports (shared) ──
              DoctorNotesPage doesn't carry a dedicated `admission` state
              — its `patient` object already contains UHID + ipdNo +
              admissionNumber + _id. The shared tab reads UHID / ipdNo
              from either prop, so passing patient on both slots works. */}
          {activeTile === "pendingreports" && (
            <div style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: 16, overflow: 'hidden', boxShadow: '0 2px 10px rgba(0,0,0,.04)' }}>
              <PendingInvestigationReportsTab
                admission={patient}
                patient={patient}
                canMarkReportCollected={true}
                actorName="Doctor"
              />
            </div>
          )}

          {/* ── Add a Note: shift selector + module pill bar ──
              Tile-gated. Sticky behavior removed because this is the
              full section view, not chrome floating above another
              section. Same primitives, just no `dnp-sticky-chrome`. */}
          {activeTile === "addnote" && (
          <div className="dnp-addnote-panel pf-tint--doctor">
            {/* Shift selector + Daily Progress quick action */}
            <div className="dnp-shift-row">
              <span className="dnp-shift-row__label">Shift:</span>
              {/* R7hr-185 — exactly 3 hospital shifts for everyone
                  (Afternoon retired); auto-follows the wall clock unless
                  manually pinned. */}
              {[{id:"morning",label:"Morning",icon:"pi-sun"},{id:"evening",label:"Evening",icon:"pi-moon"},{id:"night",label:"Night",icon:"pi-star"}].map(s => (
                <button key={s.id} onClick={() => { shiftManualRef.current = true; setShift(s.id); }}
                  className={`dnp-shift-pill ${shift === s.id ? "dnp-shift-pill--active" : ""}`}>
                  <i className={`pi ${s.icon}`} style={{ fontSize: 10 }} />{s.label}
                </button>
              ))}
              <button onClick={() => openModal("daily")} className="dnp-shift-row__cta">
                <i className="pi pi-plus" style={{ fontSize: 12 }} /> Daily Progress Note
              </button>
            </div>

            {/* ── R7aw — Note type picker (card grid) ──
                Mirrors the /consent-forms "Select Consent Type" layout so
                doctors get the same visual language across consent + notes.
                Each card carries icon + label + NABH chapter code +
                one-line description; locked cards (Initial-Assessment
                gate active) show a lock icon + reduced opacity but stay
                visible so the doctor can see WHAT they'll get once they
                clear the gate. */}
            <div style={{ background: C.card, borderRadius: 12, padding: "18px", border: `1.5px solid ${C.border}`, marginTop: 14 }}>
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: C.text, marginBottom: 3 }}>Select Note Type</div>
                <div style={{ fontSize: 12, color: C.muted }}>
                  Choose the appropriate NABH-compliant clinical note for this patient encounter
                </div>
              </div>
              {/* R7bk — Per-module lock logic + REQ/DONE badges removed.
                  The parent "Add a Note" tile is already locked when the
                  Doctor Initial Assessment (Emergency Assessment tile)
                  hasn't been signed, so this picker only renders when the
                  gate is OFF. Modules are always clickable here. */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
                {/* R7hr-230 — hide "Initial Assessment" + "Discharge Summary"
                    from the Add-a-Note picker: both already have their own
                    dedicated tiles on the Doctor Notes overview (Initial Doctor
                    Assessment → the IPD/Emergency Initial Assessment surface;
                    Discharge Summary → the Discharge Summary tile), so a second
                    entry point here was a duplicate. They STAY in MODULES so
                    modDef() still resolves the correct print-header title for
                    any existing note of those types.
                    R7hr-268 (USER, 2026-06-22) — also hide general / admission /
                    progress / assessment (Reassessment) from the picker per user
                    request ("hume nhi chahiye"). They likewise STAY in MODULES so
                    print headers + timeline labels for any existing notes of these
                    types still resolve. */}
                {MODULES.filter(m => !["initial", "discharge", "general"].includes(m.id)).map(m => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => openModal(m.id)}
                      title={m.label}
                      style={{
                        background: "white",
                        border: `2px solid ${C.border}`,
                        borderRadius: 12, padding: "14px 12px",
                        cursor: "pointer",
                        textAlign: "left", transition: "all .15s",
                        display: "flex", flexDirection: "column", gap: 6,
                        position: "relative",
                      }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = m.color + "70"; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{
                          width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                          background: m.bg,
                          display: "flex", alignItems: "center", justifyContent: "center",
                        }}>
                          <i className={`pi ${m.icon}`} style={{ fontSize: 14, color: m.color }} />
                        </span>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ fontSize: 12, fontWeight: 700, color: C.text }}>{m.label}</span>
                            {m.dot && (
                              <span style={{ width: 7, height: 7, borderRadius: "50%", background: m.color, flexShrink: 0 }} aria-hidden />
                            )}
                          </div>
                          <div style={{ fontSize: 10, color: C.muted, fontWeight: 600 }}>{m.nabh}</div>
                        </div>
                      </div>
                      <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.4 }}>{m.description}</div>
                    </button>
                ))}
              </div>
            </div>
          </div>
          )}

          {/* ══ R7ax — Embedded panels for the 4 relocated surfaces ══
              Each block mounts the named *Content component exported by
              the corresponding page. The component handles its own data
              loading off the selectedPatient prop, so Doctor Notes just
              passes through `patient` (its current selection state).
              "Back to All Sections" (rendered above when activeTile !=
              null) flips activeTile back to null and the tile grid
              reappears. */}
          {patient && activeTile === "emergency" && (() => {
            // R7ev / R7ey-F82/F83 — route to the right Initial Assessment
            // surface based on how the patient was admitted. Empty / OPD
            // admissionType used to silently fall through to the IPD
            // surface (broken for non-admitted patients) — now we render
            // an explicit "not applicable" notice instead.
            const at = String(patient?.admissionType || "").toLowerCase();
            const isER = at === "emergency" || at === "er";
            const IPD_TYPES = ["ipd", "planned", "transfer", "daycare", "day care", "emergency", "er"];
            const isInpatientFlow = IPD_TYPES.includes(at);
            // R7ey-F81 — refresh patient.initialAssessment locally on sign
            // so the gate-lock drops without forcing a full reload.
            const handleAssessmentSigned = (role) => {
              setPatient(prev => prev ? {
                ...prev,
                initialAssessment: {
                  ...(prev?.initialAssessment || {}),
                  [`${role}Completed`]: true,
                  [`${role}CompletedAt`]: new Date().toISOString(),
                },
              } : prev);
            };
            if (!isInpatientFlow) {
              return (
                <div className="dnp-embedded-panel" style={{ marginBottom: 14, padding: "28px 24px", textAlign: "center", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 12 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a", marginBottom: 6 }}>
                    Initial Assessment not applicable
                  </div>
                  <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.5 }}>
                    NABH AAC.1 Initial Assessment is only required for inpatient admissions (IPD / Planned / Day Care / Emergency).
                    {patient?.admissionType
                      ? <> This patient was registered as <strong>{patient.admissionType}</strong>.</>
                      : <> This patient has no active admission record.</>}
                    <br />For OPD visits use the standard Doctor Notes timeline / Add a Note.
                  </div>
                </div>
              );
            }
            return (
              <div className="dnp-embedded-panel" style={{ marginBottom: 14 }}>
                {isER
                  ? <EmergencyAssessmentPageContent selectedPatient={patient} onSign={handleAssessmentSigned} />
                  : <IPDInitialAssessmentContent  selectedPatient={patient} onSign={handleAssessmentSigned} defaultViewRole="doctor" />}
              </div>
            );
          })()}
          {patient && activeTile === "discharge" && (
            <div className="dnp-embedded-panel" style={{ marginBottom: 14 }}>
              <DischargeSummaryPageContent selectedPatient={patient} />
            </div>
          )}
          {patient && activeTile === "consent" && (
            <div className="dnp-embedded-panel" style={{ marginBottom: 14 }}>
              <ConsentFormPageContent selectedPatient={patient} />
            </div>
          )}
          {patient && activeTile === "mlc" && (
            <div className="dnp-embedded-panel" style={{ marginBottom: 14 }}>
              <MLCPageContent selectedPatient={patient} />
            </div>
          )}

          {/* ── Notes Stats Bar ── */}
          {activeTile === "timeline" && (
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
          )}

          {/* ── Notes Timeline ── */}
          {activeTile === "timeline" && (
          <div style={{ background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 20px", borderBottom: `1px solid ${C.border}`, background: "#f8fafc", flexWrap: "wrap", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 14 }}>
                <i className="pi pi-list" style={{ color: C.primary, fontSize: 14 }} />
                Doctor Notes Timeline
                <span style={{ background: C.primary, color: "white", padding: "2px 9px", borderRadius: 10, fontSize: 11, fontWeight: 700 }}>{filteredNotes.length}</span>
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                {[{id:"All"}, ...["initial","daily","icu","procedure","consultation","preop","postop","medication","infusion","death","amendment"].map(id=>({id}))].map(f => {
                  const cnt = f.id === "All" ? notes.length : (noteTypeCounts[f.id] || 0);
                  // R7fn-v3 — Initial Assessment notes (noteType==="initial") had no
                  // chip because the picker MODULES array intentionally omits it
                  // (the picker now routes to /ipd-initial-assessment instead).
                  // Without a chip the filter for "initial" notes was unreachable,
                  // even though the timeline rendered them. Synthetic fallback
                  // label here keeps the picker grid unchanged.
                  const FALLBACK_LBL = { initial: "Initial Assessment" };
                  const label = f.id === "All" ? "All" : (MODULES.find(m => m.id === f.id)?.label || FALLBACK_LBL[f.id] || f.id);
                  if (f.id !== "All" && cnt === 0) return null;
                  return (
                    <button key={f.id} onClick={() => setFilterType(f.id)}
                      style={{ padding: "4px 10px", border: `1.5px solid ${filterType === f.id ? C.primary : C.border}`, borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: "pointer", background: filterType === f.id ? C.primaryL : "white", color: filterType === f.id ? C.primary : C.muted, transition: "all .15s", display: "flex", alignItems: "center", gap: 4 }}>
                      {label}
                      {cnt > 0 && <span style={{ background: filterType === f.id ? C.primary : "#e2e8f0", color: filterType === f.id ? "white" : C.muted, padding: "0px 5px", borderRadius: 9, fontSize: 9, fontWeight: 700 }}>{cnt}</span>}
                    </button>
                  );
                })}
                <select value={filterShift} onChange={e => setFilterShift(e.target.value)} className="his-field" style={{ maxWidth: 120, padding: "5px 10px", fontSize: 11 }}>
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
              <div className="dnp-empty">
                <div className="dnp-empty__icon"><i className="pi pi-inbox" /></div>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>No doctor notes yet</div>
                <button onClick={() => openModal("daily")} className="dnp-note__btn dnp-note__btn--primary">
                  <i className="pi pi-plus" style={{ fontSize: 11 }} />Write first progress note
                </button>
              </div>
            ) : (
            <div className="dnp-timeline pf-tint--doctor">
            {dateGroups.map(([dateKey, groupNotes]) => (
              <div key={dateKey} className="dnp-date-group">
                {/* ── Date Section Header — dnp-date-header (sticky) ── */}
                <div className="dnp-date-header">
                  <div className="dnp-date-header__dot" />
                  <span className="dnp-date-header__title">{fmtDayHeader(dateKey)}</span>
                  <span className="dnp-date-header__sub">
                    {new Date(dateKey + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                  </span>
                  <span className="dnp-date-header__count">{groupNotes.length} note{groupNotes.length !== 1 ? "s" : ""}</span>
                </div>

                {/* ── Notes in this date group — TimelineNoteCard (R7ez) ── */}
                {groupNotes.map((note) => (
                  <TimelineNoteCard
                    key={note._id}
                    note={note}
                    currentUserId={user?._id || user?.id}
                    onEdit={openEditModal}
                    onSign={(n) => signNote(n._id)}
                    onPrint={printNote}
                    defaultOpen={true}
                  />
                ))}
              </div>
            ))}
            </div>
            )}
          </div>
          )}
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
                          <select className="his-select" value={ia.admissionMode} onChange={e => set("admissionMode", e.target.value)}>
                            {["Planned","Emergency","Transfer","OPD Referral","Day Care"].map(o => <option key={o}>{o}</option>)}
                          </select>
                        </FL>
                        <FL label="Chief Complaint *">
                          <input className="his-field" value={ia.chiefComplaint} placeholder="e.g. Chest pain" onChange={e => set("chiefComplaint", e.target.value)} />
                        </FL>
                        <FL label="Duration">
                          <input className="his-field" value={ia.duration} placeholder="e.g. 2 days" onChange={e => set("duration", e.target.value)} />
                        </FL>
                      </div>
                      <div style={{ marginTop: 10 }}>
                        <FL label="History of Present Illness *">
                          <textarea className="his-textarea" style={{ minHeight: 72 }} value={ia.hpi} placeholder="Detailed history of the presenting complaint, onset, progression, associated symptoms, relevant negatives…" onChange={e => set("hpi", e.target.value)} />
                        </FL>
                      </div>
                    </div>

                    {/* Past History */}
                    <div style={{ background: "#f8fafc", borderRadius: 10, padding: "12px 14px", border: `1px solid ${C.border}` }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".6px", marginBottom: 10 }}>Past History</div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                        <FL label="Past Medical History"><textarea className="his-textarea" style={{ minHeight: 48 }} value={ia.pastMedical} placeholder="HTN, DM, CAD, COPD, CKD, prior hospitalizations…" onChange={e => set("pastMedical", e.target.value)} /></FL>
                        <FL label="Past Surgical History"><textarea className="his-textarea" style={{ minHeight: 48 }} value={ia.pastSurgical} placeholder="Previous operations, procedures, implants…" onChange={e => set("pastSurgical", e.target.value)} /></FL>
                        <FL label="Current Medications"><textarea className="his-textarea" style={{ minHeight: 48 }} value={ia.currentMeds} placeholder="List all current medications with doses…" onChange={e => set("currentMeds", e.target.value)} /></FL>
                        <FL label="Allergies *">
                          <input className="his-field" style={{ borderColor: ia.allergies && ia.allergies !== "NKDA" ? C.red : "#e2e8f0" }} value={ia.allergies} placeholder="NKDA or list allergens + reactions" onChange={e => set("allergies", e.target.value)} />
                          {ia.allergies && ia.allergies !== "NKDA" && (
                            <div style={{ fontSize: 10, color: C.red, fontWeight: 700, marginTop: 3 }}>⚠ Allergy documented — verify before prescribing</div>
                          )}
                        </FL>
                        <FL label="Family History"><input className="his-field" value={ia.familyHistory} placeholder="Hereditary conditions, sudden cardiac death…" onChange={e => set("familyHistory", e.target.value)} /></FL>
                        <FL label="Social History"><input className="his-field" value={ia.socialHistory} placeholder="Smoking, alcohol, occupation, marital status…" onChange={e => set("socialHistory", e.target.value)} /></FL>
                      </div>
                    </div>

                    {/* Vitals on Admission */}
                    <div style={{ background: "#f8fafc", borderRadius: 10, padding: "12px 14px", border: `1px solid ${C.border}` }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".6px", marginBottom: 10 }}>Vitals on Admission</div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8 }}>
                        {[{k:"bp_sys",l:"Systolic BP (mmHg)",ph:"120"},{k:"bp_dia",l:"Diastolic BP (mmHg)",ph:"80"},{k:"pulse",l:"Pulse (/min)",ph:"80"},{k:"temp",l:"Temp (°F)",ph:"98.6"},{k:"spo2",l:"SpO₂ (%)",ph:"98"},{k:"rr",l:"RR (/min)",ph:"16"},{k:"weight",l:"Weight (kg)",ph:"60"},{k:"height",l:"Height (cm)",ph:"165"},{k:"bsl",l:"BSL (mg/dL)",ph:"100"}].map(f => (
                          <FL key={f.k} label={f.l}><input type="number" className="his-field" value={ia[f.k]} placeholder={f.ph} onChange={e => set(f.k, e.target.value)} /></FL>
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
                            <select className="his-select" style={{ fontSize: 11 }} value={ia[f.k]} onChange={e => set(f.k, e.target.value)}>
                              {f.opts.map(o => <option key={o}>{o}</option>)}
                            </select>
                          </FL>
                        ))}
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                        <FL label="Respiratory System"><textarea className="his-textarea" style={{ minHeight: 48 }} value={ia.resp} placeholder="Breath sounds, added sounds, air entry…" onChange={e => set("resp", e.target.value)} /></FL>
                        <FL label="Cardiovascular System"><textarea className="his-textarea" style={{ minHeight: 48 }} value={ia.cvs} placeholder="S1 S2, murmurs, JVP, peripheral pulses…" onChange={e => set("cvs", e.target.value)} /></FL>
                        <FL label="Abdomen"><textarea className="his-textarea" style={{ minHeight: 48 }} value={ia.abdomen} placeholder="Inspection, palpation, percussion, auscultation…" onChange={e => set("abdomen", e.target.value)} /></FL>
                        <FL label="CNS / Neurological"><textarea className="his-textarea" style={{ minHeight: 48 }} value={ia.cns} placeholder="Consciousness, GCS, cranial nerves, motor, sensory…" onChange={e => set("cns", e.target.value)} /></FL>
                      </div>
                    </div>

                    {/* Diagnosis */}
                    <div style={{ background: "#f8fafc", borderRadius: 10, padding: "12px 14px", border: `1px solid ${C.border}` }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".6px", marginBottom: 10 }}>Diagnosis</div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                        <FL label="Provisional Diagnosis *"><input className="his-field" value={ia.provisionalDx} placeholder="Working diagnosis on admission" onChange={e => set("provisionalDx", e.target.value)} /></FL>
                        <FL label="Differential Diagnosis"><input className="his-field" value={ia.differentialDx} placeholder="Differential diagnoses (comma separated)" onChange={e => set("differentialDx", e.target.value)} /></FL>
                        <FL label="Final Diagnosis (if known)"><input className="his-field" value={ia.finalDx} placeholder="Confirmed diagnosis" onChange={e => set("finalDx", e.target.value)} /></FL>
                        <FL label="ICD-10 Code"><input className="his-field" value={ia.icd10} placeholder="e.g. J18.9 — Pneumonia" onChange={e => set("icd10", e.target.value)} /></FL>
                      </div>
                    </div>

                    {/* Management Plan */}
                    <div style={{ background: "#f8fafc", borderRadius: 10, padding: "12px 14px", border: `1px solid ${C.border}` }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".6px", marginBottom: 10 }}>Investigations & Management Plan</div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                        <FL label="Investigations Ordered"><textarea className="his-textarea" style={{ minHeight: 60 }} value={ia.investigations} placeholder="CBC, CMP, CXR, ECG, Echo, CT, MRI, cultures…" onChange={e => set("investigations", e.target.value)} /></FL>
                        <FL label="Management Plan *"><textarea className="his-textarea" style={{ minHeight: 60 }} value={ia.managementPlan} placeholder="Treatment goals, monitoring plan, nursing orders, diet, activity, DVT prophylaxis, targets…" onChange={e => set("managementPlan", e.target.value)} /></FL>
                      </div>
                    </div>

                    {/* Embedded Medication Orders */}
                    {(() => {
                      const updateMed = (id, field, val) => setMedOrders(p => p.map(r => r.id === id ? { ...r, [field]: val } : r));
                      const addMed    = () => setMedOrders(p => [...p, emptyMedRow()]);
                      const removeMed = (id) => setMedOrders(p => p.filter(r => r.id !== id));
                      return (
                        <div style={{ background: "#eef2ff", borderRadius: 10, padding: "12px 14px", border: "1.5px solid #93c5fd" }}>
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
                                <tr style={{ background: "#e0e7ff" }}>
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
                                    <td style={{ border: "1px solid #c7d2fe", padding: "4px" }}><input type="datetime-local" className="his-field" style={{ fontSize: 10, padding: "4px 6px" }} value={row.datetime} onChange={e => updateMed(row.id, "datetime", e.target.value)} /></td>
                                    <td style={{ border: "1px solid #c7d2fe", padding: "4px", minWidth: 130 }}><input className="his-field" style={{ fontSize: 11, padding: "4px 6px", fontWeight: 700 }} value={row.drug} placeholder="Drug name (generic)" onChange={e => updateMed(row.id, "drug", e.target.value)} /></td>
                                    <td style={{ border: "1px solid #c7d2fe", padding: "4px", minWidth: 80 }}><input className="his-field" style={{ fontSize: 11, padding: "4px 6px" }} value={row.dose} placeholder="e.g. 500mg" onChange={e => updateMed(row.id, "dose", e.target.value)} /></td>
                                    <td style={{ border: "1px solid #c7d2fe", padding: "4px", minWidth: 100 }}>
                                      <select className="his-select" style={{ fontSize: 11, padding: "4px 6px" }} value={row.route} onChange={e => updateMed(row.id, "route", e.target.value)}>
                                        {ROUTES.map(r => <option key={r}>{r}</option>)}
                                      </select>
                                    </td>
                                    <td style={{ border: "1px solid #c7d2fe", padding: "4px", minWidth: 90 }}>
                                      <select className="his-select" style={{ fontSize: 11, padding: "4px 6px" }} value={row.frequency} onChange={e => updateMed(row.id, "frequency", e.target.value)}>
                                        {FREQ_LIST.map(f => <option key={f}>{f}</option>)}
                                      </select>
                                    </td>
                                    <td style={{ border: "1px solid #c7d2fe", padding: "4px", minWidth: 110, fontFamily: "monospace", fontSize: 10, color: C.blue, fontWeight: 700 }}>
                                      {(FREQ_TIMES[row.frequency] || []).join(" · ")}
                                    </td>
                                    {/* Priority */}
                                    <td style={{ border: "1px solid #c7d2fe", padding: "4px", minWidth: 85 }}>
                                      <select className="his-select" style={{ fontSize: 10, padding: "3px 5px", fontWeight: 700, color: row.priority==="STAT"?C.red:row.priority==="Urgent"?C.amber:C.muted }} value={row.priority||"Routine"} onChange={e => updateMed(row.id, "priority", e.target.value)}>
                                        <option value="Routine">Routine</option>
                                        <option value="Urgent">🔶 Urgent</option>
                                        <option value="STAT">⚡ STAT</option>
                                      </select>
                                    </td>
                                    {/* HAM */}
                                    <td style={{ border: "1px solid #c7d2fe", padding: "4px", textAlign: "center", minWidth: 52 }}>
                                      {autoHam
                                        ? <span title="Auto-detected High Alert Medication" style={{ fontSize: 14 }}>🔴</span>
                                        : <input type="checkbox" title="Mark as High Alert Medication (HAM)" checked={!!row.hamOverride} onChange={e => updateMed(row.id, "hamOverride", e.target.checked)}
                                            style={{ width: 14, height: 14, cursor: "pointer", accentColor: C.red }} />}
                                    </td>
                                    <td style={{ border: "1px solid #c7d2fe", padding: "4px", minWidth: 110 }}><input className="his-field" style={{ fontSize: 11, padding: "4px 6px" }} value={row.indication} placeholder="e.g. GI prophylaxis" onChange={e => updateMed(row.id, "indication", e.target.value)} /></td>
                                    <td style={{ border: "1px solid #c7d2fe", padding: "4px" }}>
                                      <select className="his-select" style={{ fontSize: 11, padding: "4px 6px", color: row.status === "Stopped" ? C.red : C.green, fontWeight: 700 }} value={row.status} onChange={e => updateMed(row.id, "status", e.target.value)}>
                                        <option value="Active">Active</option>
                                        <option value="Stopped">Stopped</option>
                                      </select>
                                    </td>
                                    <td style={{ border: "1px solid #c7d2fe", padding: "4px", minWidth: 100 }}>
                                      <input className="his-field" style={{ fontSize: 11, padding: "4px 6px", borderColor: row.status === "Stopped" && !row.stopReason ? C.red : "#e2e8f0" }} value={row.stopReason} placeholder={row.status === "Stopped" ? "Required!" : "—"} onChange={e => updateMed(row.id, "stopReason", e.target.value)} />
                                    </td>
                                    <td style={{ border: "1px solid #c7d2fe", padding: "4px" }}>
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
                                    <td style={{ border: "1px solid #a7f3d0", padding: "4px" }}><input type="datetime-local" className="his-field" style={{ fontSize: 10, padding: "4px 6px" }} value={row.datetime} onChange={e => updateInf(row.id, "datetime", e.target.value)} /></td>
                                    <td style={{ border: "1px solid #a7f3d0", padding: "4px" }}>
                                      <select className="his-select" style={{ fontSize: 11, padding: "4px 6px" }} value={row.type} onChange={e => updateInf(row.id, "type", e.target.value)}>
                                        {["Fluid","Drug Infusion","Blood","Blood Product","TPN"].map(t => <option key={t}>{t}</option>)}
                                      </select>
                                    </td>
                                    <td style={{ border: "1px solid #a7f3d0", padding: "4px", minWidth: 140 }}><input className="his-field" style={{ fontSize: 11, padding: "4px 6px", fontWeight: 700 }} value={row.drugFluid} placeholder="NS 0.9% / Noradrenaline / PRBC" onChange={e => updateInf(row.id, "drugFluid", e.target.value)} /></td>
                                    <td style={{ border: "1px solid #a7f3d0", padding: "4px", minWidth: 110 }}><input className="his-field" style={{ fontSize: 11, padding: "4px 6px" }} value={row.dilution} placeholder="e.g. 4mg in 50ml NS" onChange={e => updateInf(row.id, "dilution", e.target.value)} /></td>
                                    <td style={{ border: "1px solid #a7f3d0", padding: "4px", minWidth: 70 }}><input type="number" className="his-field" style={{ fontSize: 11, padding: "4px 6px" }} value={row.volume} placeholder="500" onChange={e => updateInf(row.id, "volume", e.target.value)} /></td>
                                    <td style={{ border: "1px solid #a7f3d0", padding: "4px", minWidth: 80 }}><input type="number" className="his-field" style={{ fontSize: 11, padding: "4px 6px" }} value={row.rate} placeholder="100" onChange={e => updateInf(row.id, "rate", e.target.value)} /></td>
                                    <td style={{ border: "1px solid #a7f3d0", padding: "4px", minWidth: 120 }}><input className="his-field" style={{ fontSize: 11, padding: "4px 6px" }} value={row.titrationGoal} placeholder="MAP > 65 / Hb > 8" onChange={e => updateInf(row.id, "titrationGoal", e.target.value)} /></td>
                                    <td style={{ border: "1px solid #a7f3d0", padding: "4px" }}><input type="time" className="his-field" style={{ fontSize: 11, padding: "4px 6px" }} value={row.startTime} onChange={e => updateInf(row.id, "startTime", e.target.value)} /></td>
                                    {/* Priority */}
                                    <td style={{ border: "1px solid #a7f3d0", padding: "4px", minWidth: 85 }}>
                                      <select className="his-select" style={{ fontSize: 10, padding: "3px 5px", fontWeight: 700, color: row.priority==="STAT"?C.red:row.priority==="Urgent"?C.amber:C.muted }} value={row.priority||"Routine"} onChange={e => updateInf(row.id, "priority", e.target.value)}>
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
                                      <select className="his-select" style={{ fontSize: 11, padding: "4px 6px", color: row.status === "Stopped" ? C.red : C.teal, fontWeight: 700 }} value={row.status} onChange={e => updateInf(row.id, "status", e.target.value)}>
                                        <option value="Active">Active</option>
                                        <option value="Stopped">Stopped</option>
                                      </select>
                                    </td>
                                    <td style={{ border: "1px solid #a7f3d0", padding: "4px", minWidth: 100 }}>
                                      <input className="his-field" style={{ fontSize: 11, padding: "4px 6px", borderColor: row.status === "Stopped" && !row.stopReason ? C.red : "#e2e8f0" }} value={row.stopReason} placeholder={row.status === "Stopped" ? "Required!" : "—"} onChange={e => updateInf(row.id, "stopReason", e.target.value)} />
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
                              <td style={{ border: `1px solid ${C.blueB}`, padding: "5px" }}><input type="datetime-local" className="his-field" style={{ fontSize: 11, padding: "5px 7px" }} value={row.datetime} onChange={e => updateMed(row.id, "datetime", e.target.value)} /></td>
                              <td style={{ border: `1px solid ${C.blueB}`, padding: "5px", minWidth: 130 }}><input className="his-field" style={{ fontSize: 12, padding: "5px 7px", fontWeight: 600 }} value={row.drug} placeholder="Drug name" onChange={e => updateMed(row.id, "drug", e.target.value)} /></td>
                              <td style={{ border: `1px solid ${C.blueB}`, padding: "5px", minWidth: 90 }}><input className="his-field" style={{ fontSize: 12, padding: "5px 7px" }} value={row.dose} placeholder="500mg" onChange={e => updateMed(row.id, "dose", e.target.value)} /></td>
                              <td style={{ border: `1px solid ${C.blueB}`, padding: "5px", minWidth: 110 }}>
                                <select className="his-select" style={{ fontSize: 11, padding: "5px 7px" }} value={row.route} onChange={e => updateMed(row.id, "route", e.target.value)}>
                                  {ROUTES.map(r => <option key={r}>{r}</option>)}
                                </select>
                              </td>
                              <td style={{ border: `1px solid ${C.blueB}`, padding: "5px", minWidth: 100 }}>
                                <select className="his-select" style={{ fontSize: 12, padding: "5px 7px", fontWeight: 700 }} value={row.frequency} onChange={e => updateMed(row.id, "frequency", e.target.value)}>
                                  {FREQ_LIST.map(f => <option key={f}>{f}</option>)}
                                </select>
                              </td>
                              <td style={{ border: `1px solid ${C.blueB}`, padding: "5px", minWidth: 140, background: "#eef2ff" }}>
                                <div style={{ fontFamily: "monospace", fontSize: 11, color: C.blue, fontWeight: 700, lineHeight: 1.5 }}>
                                  {(FREQ_TIMES[row.frequency] || []).join(" · ")}
                                </div>
                              </td>
                              <td style={{ border: `1px solid ${C.blueB}`, padding: "5px", minWidth: 110 }}><input className="his-field" style={{ fontSize: 11, padding: "5px 7px" }} value={row.indication} placeholder="Indication" onChange={e => updateMed(row.id, "indication", e.target.value)} /></td>
                              <td style={{ border: `1px solid ${C.blueB}`, padding: "5px" }}>
                                <select className="his-select" style={{ fontSize: 12, padding: "5px 7px", color: row.status === "Stopped" ? C.red : C.green, fontWeight: 700 }} value={row.status} onChange={e => updateMed(row.id, "status", e.target.value)}>
                                  <option value="Active">Active</option>
                                  <option value="Stopped">Stopped</option>
                                </select>
                              </td>
                              <td style={{ border: `1px solid ${C.blueB}`, padding: "5px", minWidth: 120 }}>
                                <input className="his-field" style={{ fontSize: 11, padding: "5px 7px", borderColor: row.status === "Stopped" && !row.stopReason ? C.red : "#e2e8f0", background: row.status === "Stopped" && !row.stopReason ? "#fef2f2" : "white" }} value={row.stopReason} placeholder={row.status === "Stopped" ? "Required ⚠" : "—"} onChange={e => updateMed(row.id, "stopReason", e.target.value)} />
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
                              <td style={{ border: `1px solid ${C.tealB}`, padding: "5px" }}><input type="datetime-local" className="his-field" style={{ fontSize: 11, padding: "5px 7px" }} value={row.datetime} onChange={e => updateInf(row.id, "datetime", e.target.value)} /></td>
                              <td style={{ border: `1px solid ${C.tealB}`, padding: "5px", minWidth: 110 }}>
                                <select className="his-select" style={{ fontSize: 11, padding: "5px 7px" }} value={row.type} onChange={e => updateInf(row.id, "type", e.target.value)}>
                                  {["Fluid","Drug Infusion","Blood","Blood Product","TPN"].map(t => <option key={t}>{t}</option>)}
                                </select>
                              </td>
                              <td style={{ border: `1px solid ${C.tealB}`, padding: "5px", minWidth: 140 }}><input className="his-field" style={{ fontSize: 12, padding: "5px 7px", fontWeight: 600 }} value={row.drugFluid} placeholder="NS 0.9% / Noradrenaline / PRBC" onChange={e => updateInf(row.id, "drugFluid", e.target.value)} /></td>
                              <td style={{ border: `1px solid ${C.tealB}`, padding: "5px", minWidth: 120 }}><input className="his-field" style={{ fontSize: 11, padding: "5px 7px" }} value={row.dilution} placeholder="e.g. 2mg in 50ml NS" onChange={e => updateInf(row.id, "dilution", e.target.value)} /></td>
                              <td style={{ border: `1px solid ${C.tealB}`, padding: "5px", minWidth: 75 }}><input type="number" className="his-field" style={{ fontSize: 12, padding: "5px 7px" }} value={row.volume} placeholder="500" onChange={e => updateInf(row.id, "volume", e.target.value)} /></td>
                              <td style={{ border: `1px solid ${C.tealB}`, padding: "5px", minWidth: 90 }}><input type="number" className="his-field" style={{ fontSize: 12, padding: "5px 7px" }} value={row.rate} placeholder="100" onChange={e => updateInf(row.id, "rate", e.target.value)} /></td>
                              <td style={{ border: `1px solid ${C.tealB}`, padding: "5px", minWidth: 140 }}><input className="his-field" style={{ fontSize: 11, padding: "5px 7px" }} value={row.titrationGoal} placeholder="MAP > 65 / Hb > 8" onChange={e => updateInf(row.id, "titrationGoal", e.target.value)} /></td>
                              <td style={{ border: `1px solid ${C.tealB}`, padding: "5px" }}><input type="time" className="his-field" style={{ fontSize: 11, padding: "5px 7px" }} value={row.startTime} onChange={e => updateInf(row.id, "startTime", e.target.value)} /></td>
                              <td style={{ border: `1px solid ${C.tealB}`, padding: "5px" }}>
                                <select className="his-select" style={{ fontSize: 12, padding: "5px 7px", color: row.status === "Stopped" ? C.red : C.teal, fontWeight: 700 }} value={row.status} onChange={e => updateInf(row.id, "status", e.target.value)}>
                                  <option value="Active">Active</option>
                                  <option value="Stopped">Stopped</option>
                                </select>
                              </td>
                              <td style={{ border: `1px solid ${C.tealB}`, padding: "5px", minWidth: 120 }}>
                                <input className="his-field" style={{ fontSize: 11, padding: "5px 7px", borderColor: row.status === "Stopped" && !row.stopReason ? C.red : "#e2e8f0", background: row.status === "Stopped" && !row.stopReason ? "#fef2f2" : "white" }} value={row.stopReason} placeholder={row.status === "Stopped" ? "Required ⚠" : "—"} onChange={e => updateInf(row.id, "stopReason", e.target.value)} />
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
                          <input type={v.k==="gcs"?"text":"number"} className="his-field" style={{ fontSize: 12 }} value={vitals[v.k]} placeholder={v.p} onChange={e => setVitals(p => ({ ...p, [v.k]: e.target.value }))} />
                        </FL>
                      ))}
                    </div>
                  </div>
                  {/* SOAP */}
                  {[
                    {k:"subjective", l:"S — Subjective", c:C.blue, ph:"Patient's complaints today: pain, nausea, fever, functional status, how they feel…"},
                    {k:"objective",  l:"O — Objective",  c:C.teal, ph:"Examination findings: general appearance, chest, CVS, abdomen, neuro, wound…"},
                    {k:"assessment", l:"A — Assessment",  c:C.amber,ph:"Clinical impression, response to treatment, disease progression…"},
                    {k:"plan",       l:"P — Plan",        c:C.green,ph:"Narrative summary of today's plan: monitoring goals, expected response, nursing instructions, diet, activity, escalation triggers. (Diagnosis updates → Patient Diagnosis tile · Investigations / medications / procedures → Doctor Orders tile.)"},
                  ].map(s => (
                    <div key={s.k}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                        <span style={{ width: 22, height: 22, borderRadius: 5, background: s.c + "20", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: 12, color: s.c }}>{s.k[0].toUpperCase()}</span>
                        <label className="his-label" style={{ marginBottom: 0, color: s.c }}>{s.l}</label>
                      </div>
                      <textarea className="his-textarea" style={{ minHeight: 72, borderColor: s.c + "40" }} value={soap[s.k]} placeholder={s.ph} onChange={e => setSoap(p => ({ ...p, [s.k]: e.target.value }))} />
                    </div>
                  ))}
                  {/* R7bp — Diagnosis / Investigations / Doctor Orders were removed
                       from the Daily Progress note. Diagnosis lives on the dedicated
                       "Patient Diagnosis" tile (PATCH /diagnosis), and all
                       investigations + medication + IV / procedure orders live in
                       the "Doctor Orders" module. Keeping them here duplicated the
                       data entry and let the same diagnosis/order be entered in two
                       places — confusing for the nurse, MAR, and ledger. SOAP narrative
                       in the P (Plan) section above is still the place to describe
                       intent; the actual orderable rows go through Doctor Orders. */}
                  <div style={{ background: "#f0fdfa", border: `1px dashed ${C.teal}`, borderRadius: 8, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, fontSize: 12, color: C.muted }}>
                    <i className="pi pi-info-circle" style={{ color: C.teal, fontSize: 13 }} />
                    <span>
                      <b style={{ color: C.teal }}>Diagnosis</b>, <b style={{ color: C.teal }}>investigations</b> &amp; <b style={{ color: C.teal }}>orders</b> are now entered from the dedicated <b>Patient Diagnosis</b> and <b>Doctor Orders</b> tiles. Use the P — Plan field above for narrative documentation only.
                    </span>
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
                      <FL label="Mode"><select className="his-select" value={icu.ventMode} onChange={e => setIcu(p=>({...p,ventMode:e.target.value}))}>{["CPAP/PSV","SIMV","A/C","BiPAP","PC-AC","VC-AC","Spontaneous","Not Ventilated"].map(o=><option key={o}>{o}</option>)}</select></FL>
                      <FL label="FiO₂ (%)"><input type="number" min="21" max="100" className="his-field" value={icu.fio2} placeholder="40" onChange={e=>setIcu(p=>({...p,fio2:e.target.value}))} /></FL>
                      <FL label="PEEP (cmH₂O)"><input type="number" className="his-field" value={icu.peep} placeholder="5" onChange={e=>setIcu(p=>({...p,peep:e.target.value}))} /></FL>
                      <FL label="Tidal Vol (mL)"><input type="number" className="his-field" value={icu.tv} placeholder="500" onChange={e=>setIcu(p=>({...p,tv:e.target.value}))} /></FL>
                      <FL label="Set RR (/min)"><input type="number" className="his-field" value={icu.ventRR} placeholder="14" onChange={e=>setIcu(p=>({...p,ventRR:e.target.value}))} /></FL>
                      <FL label="PIP (cmH₂O)"><input type="number" className="his-field" value={icu.pip} placeholder="25" onChange={e=>setIcu(p=>({...p,pip:e.target.value}))} /></FL>
                      <FL label="MAP (mmHg)"><input type="number" className="his-field" value={icu.map} placeholder="75" onChange={e=>setIcu(p=>({...p,map:e.target.value}))} /></FL>
                      <FL label="CVP (cmH₂O)"><input type="number" className="his-field" value={icu.cvp} placeholder="10" onChange={e=>setIcu(p=>({...p,cvp:e.target.value}))} /></FL>
                    </div>
                  </div>
                  {/* Sedation */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                    <FL label="RASS Score (-5 to +4)">
                      <select className="his-select" style={{ borderColor: Number(icu.rassScore)>1?C.red:Number(icu.rassScore)<-3?C.amber:"#e2e8f0" }} value={icu.rassScore} onChange={e=>setIcu(p=>({...p,rassScore:e.target.value}))}>
                        {[{v:"+4",l:"+4 Combative"},{v:"+3",l:"+3 Very Agitated"},{v:"+2",l:"+2 Agitated"},{v:"+1",l:"+1 Restless"},{v:"0",l:"0 Alert & Calm"},{v:"-1",l:"-1 Drowsy"},{v:"-2",l:"-2 Light Sedation"},{v:"-3",l:"-3 Mod Sedation"},{v:"-4",l:"-4 Deep Sedation"},{v:"-5",l:"-5 Unarousable"}].map(o=><option key={o.v} value={o.v}>{o.l}</option>)}
                      </select>
                    </FL>
                    <FL label="BPS Score (3-12)"><input type="number" min="3" max="12" className="his-field" value={icu.bpsScore} placeholder="3 (no pain)" onChange={e=>setIcu(p=>({...p,bpsScore:e.target.value}))} /></FL>
                    <FL label="Sedation Drugs"><input className="his-field" value={icu.sedation} placeholder="Midazolam 2mg/hr, Fentanyl…" onChange={e=>setIcu(p=>({...p,sedation:e.target.value}))} /></FL>
                  </div>
                  {/* Organ System Review */}
                  <div style={{ background: "#f8fafc", border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 14px" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".6px", marginBottom: 10 }}>Organ System Review</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
                      {[{k:"neuro",l:"Neuro",opts:["Intact","Agitated","Encephalopathy","Sedated","Unconscious"]},{k:"cvs",l:"CVS",opts:["Stable","Hypotensive","Hypertensive","Arrhythmia","Vasopressors On"]},{k:"resp",l:"Respiratory",opts:["Self-ventilating","Supported","Weaning","Extubated","ARDS"]},{k:"renal",l:"Renal",opts:["Adequate","Oliguria","Anuria","On CRRT","AKI"]},{k:"gi",l:"GI/Nutrition",opts:["Active","NGT Feed","TPN","Ileus","GI Bleed"]},{k:"haem",l:"Haematology",opts:["Normal","Anaemia","Coagulopathy","Thrombocytopaenia","Anticoag On"]},{k:"infective",l:"Infection",opts:["None","Suspected Sepsis","Confirmed Sepsis","On Antibiotics","MDRO"]},{k:"vasopressorDetail",l:"Vasopressors",opts:["None","Noradrenaline","Vasopressin","Dopamine","Adrenaline","Multiple"]}].map(s=>(
                        <FL key={s.k} label={s.l}>
                          <select className="his-select" value={icu[s.k]||icu.vasopressorDetail} onChange={e=>setIcu(p=>({...p,[s.k]:e.target.value}))}>
                            {s.opts.map(o=><option key={o}>{o}</option>)}
                          </select>
                        </FL>
                      ))}
                    </div>
                  </div>
                  {/* SOAP + Daily Goals */}
                  {[{k:"subjective",l:"S — Subjective",c:C.blue,ph:"Family update, nursing observations, any complaints noted…"},{k:"objective",l:"O — Objective",c:C.teal,ph:"Exam findings, lines, tubes, wound…"},{k:"assessment",l:"A — Assessment",c:C.amber,ph:"Overall ICU status, organ function assessment…"},{k:"plan",l:"P — Plan",c:C.green,ph:"Orders, changes, weaning plan, family plan…"}].map(s=>(
                    <div key={s.k}>
                      <label className="his-label" style={{ color: s.c }}>{s.l}</label>
                      <textarea className="his-textarea" style={{ minHeight: 60, borderColor: s.c + "40" }} value={soap[s.k]} placeholder={s.ph} onChange={e=>setSoap(p=>({...p,[s.k]:e.target.value}))} />
                    </div>
                  ))}
                  <FL label="Daily Goals / Targets">
                    <textarea className="his-textarea" style={{ minHeight: 60, borderColor: `${C.green}40` }} value={icu.dailyGoals} placeholder="Target SpO₂ >95%, MAP >65, urine >0.5ml/kg/hr, pain BPS <6, sedation RASS 0 to -2…" onChange={e=>setIcu(p=>({...p,dailyGoals:e.target.value}))} />
                  </FL>
                  {/* R7bp — Diagnosis/Status fields removed from ICU note. The active
                       diagnosis lives on the Patient Diagnosis tile and is the single
                       source of truth across all note types. */}
                </div>
              )}

              {/* ══ PROCEDURE NOTE ══ */}
              {activeModal === "procedure" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                    <FL label="Procedure Name *"><input className="his-field" value={proc.procedureName} placeholder="e.g. Central venous line insertion" onChange={e=>setProc(p=>({...p,procedureName:e.target.value}))} /></FL>
                    <FL label="Indication *"><input className="his-field" value={proc.indication} placeholder="Reason for procedure" onChange={e=>setProc(p=>({...p,indication:e.target.value}))} /></FL>
                    <FL label="Time of Procedure *"><input type="time" className="his-field" value={proc.time} onChange={e=>setProc(p=>({...p,time:e.target.value}))} /></FL>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                    <FL label="Surgeon / Performer *"><input className="his-field" value={proc.surgeon} placeholder="Dr. Name" onChange={e=>setProc(p=>({...p,surgeon:e.target.value}))} /></FL>
                    <FL label="Assistant"><input className="his-field" value={proc.assistant} placeholder="Assisting doctor/nurse" onChange={e=>setProc(p=>({...p,assistant:e.target.value}))} /></FL>
                    <FL label="Anaesthesia">
                      <select className="his-select" value={proc.anaesthesia} onChange={e=>setProc(p=>({...p,anaesthesia:e.target.value}))}>
                        {["None (Awake)","Local Anaesthesia","Sedation","Spinal","Epidural","General Anaesthesia"].map(o=><option key={o}>{o}</option>)}
                      </select>
                    </FL>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <FL label="Patient Position">
                      <select className="his-select" value={proc.position} onChange={e=>setProc(p=>({...p,position:e.target.value}))}>
                        {["Supine","Left Lateral","Right Lateral","Lithotomy","Prone","Trendelenburg","Semi-Fowler's"].map(o=><option key={o}>{o}</option>)}
                      </select>
                    </FL>
                    <FL label="Blood Loss"><input className="his-field" value={proc.bloodLoss} placeholder="Minimal / mL" onChange={e=>setProc(p=>({...p,bloodLoss:e.target.value}))} /></FL>
                  </div>
                  <FL label="Technique / Description *"><textarea className="his-textarea" style={{ minHeight: 80 }} value={proc.technique} placeholder="Step-by-step description of technique used, sterile field maintained…" onChange={e=>setProc(p=>({...p,technique:e.target.value}))} /></FL>
                  <FL label="Intraoperative Findings"><textarea className="his-textarea" value={proc.findings} placeholder="What was found during the procedure…" onChange={e=>setProc(p=>({...p,findings:e.target.value}))} /></FL>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <FL label="Complications">
                      <select className="his-select" style={{ borderColor: proc.complications!=="None"?C.red:"#e2e8f0" }} value={proc.complications} onChange={e=>setProc(p=>({...p,complications:e.target.value}))}>
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
                  {proc.specimenSent && <FL label="Specimen Type"><input className="his-field" value={proc.specimenType} placeholder="e.g. Tissue biopsy, Fluid C&S" onChange={e=>setProc(p=>({...p,specimenType:e.target.value}))} /></FL>}
                  <FL label="Post-Procedure Instructions"><textarea className="his-textarea" value={proc.postInstructions} placeholder="Monitor site for 1 hour, check vitals every 15 min, CXR post-line…" onChange={e=>setProc(p=>({...p,postInstructions:e.target.value}))} /></FL>
                </div>
              )}

              {/* ══ CONSULTATION NOTE ══ */}
              {activeModal === "consultation" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                    <FL label="Consultant Name *"><input className="his-field" value={consult.consultantName} placeholder="Dr. Name" onChange={e=>setConsult(p=>({...p,consultantName:e.target.value}))} /></FL>
                    <FL label="Speciality *"><input className="his-field" value={consult.speciality} placeholder="e.g. Cardiology, Nephrology" onChange={e=>setConsult(p=>({...p,speciality:e.target.value}))} /></FL>
                    <FL label="Reg No."><input className="his-field" value={consult.consultantRegNo} placeholder="MCI / State reg. no." onChange={e=>setConsult(p=>({...p,consultantRegNo:e.target.value}))} /></FL>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <FL label="Referred By"><input className="his-field" value={consult.referredBy} placeholder="Attending doctor name" onChange={e=>setConsult(p=>({...p,referredBy:e.target.value}))} /></FL>
                    <FL label="Reason for Referral *"><input className="his-field" value={consult.reason} placeholder="e.g. Chest pain — rule out ACS" onChange={e=>setConsult(p=>({...p,reason:e.target.value}))} /></FL>
                  </div>
                  <FL label="Clinical Summary (for consultant)"><textarea className="his-textarea" value={consult.clinicalSummary} placeholder="Brief history, current condition, relevant investigations…" onChange={e=>setConsult(p=>({...p,clinicalSummary:e.target.value}))} /></FL>
                  <FL label="Investigations Shared"><input className="his-field" value={consult.investigations} placeholder="ECG, Echo, Troponin, CBC…" onChange={e=>setConsult(p=>({...p,investigations:e.target.value}))} /></FL>
                  <FL label="Consultant's Findings"><textarea className="his-textarea" value={consult.findings} placeholder="Examination findings noted by consultant…" onChange={e=>setConsult(p=>({...p,findings:e.target.value}))} /></FL>
                  <FL label="Impression / Diagnosis"><input className="his-field" value={consult.impression} placeholder="Consultant's diagnostic impression" onChange={e=>setConsult(p=>({...p,impression:e.target.value}))} /></FL>
                  <FL label="Recommendations *"><textarea className="his-textarea" style={{ minHeight: 80 }} value={consult.recommendations} placeholder="Specific management recommendations from consultant…" onChange={e=>setConsult(p=>({...p,recommendations:e.target.value}))} /></FL>
                  <FL label="Follow-up Plan"><input className="his-field" value={consult.followUp} placeholder="Review in 48hrs / on discharge / as needed" onChange={e=>setConsult(p=>({...p,followUp:e.target.value}))} /></FL>
                </div>
              )}

              {/* ══ PRE-OPERATIVE NOTE ══ */}
              {activeModal === "preop" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                    <FL label="Planned Procedure *"><input className="his-field" value={preop.procedure} placeholder="e.g. Laparoscopic appendicectomy" onChange={e=>setPreop(p=>({...p,procedure:e.target.value}))} /></FL>
                    <FL label="Indication"><input className="his-field" value={preop.indication} placeholder="Acute appendicitis" onChange={e=>setPreop(p=>({...p,indication:e.target.value}))} /></FL>
                    <FL label="Pre-op Diagnosis"><input className="his-field" value={preop.preopDiagnosis} placeholder="Confirmed diagnosis" onChange={e=>setPreop(p=>({...p,preopDiagnosis:e.target.value}))} /></FL>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10 }}>
                    <FL label="ASA Grade *">
                      <select className="his-select" value={preop.asaGrade} onChange={e=>setPreop(p=>({...p,asaGrade:e.target.value}))}>
                        {["ASA I","ASA II","ASA III","ASA IV","ASA V","ASA VI","ASA IE","ASA IIE","ASA IIIE"].map(o=><option key={o}>{o}</option>)}
                      </select>
                    </FL>
                    <FL label="Planned Anaesthesia *">
                      <select className="his-select" value={preop.plannedAnaesthesia} onChange={e=>setPreop(p=>({...p,plannedAnaesthesia:e.target.value}))}>
                        {["General","Spinal","Epidural","Local","Sedation","Combined Spinal-Epidural"].map(o=><option key={o}>{o}</option>)}
                      </select>
                    </FL>
                    <FL label="Blood Group"><input className="his-field" value={preop.bloodGroup} placeholder="A+, B-, O+" onChange={e=>setPreop(p=>({...p,bloodGroup:e.target.value}))} /></FL>
                    <FL label="Allergy Status"><input className="his-field" value={preop.allergies} placeholder="NKDA / Drug name" onChange={e=>setPreop(p=>({...p,allergies:e.target.value}))} /></FL>
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
                    <FL label="Co-morbidities"><input className="his-field" value={preop.comorbidities} placeholder="DM, HTN, IHD, CKD…" onChange={e=>setPreop(p=>({...p,comorbidities:e.target.value}))} /></FL>
                    <FL label="Current Medications"><input className="his-field" value={preop.currentMeds} placeholder="Metformin held, anticoagulants…" onChange={e=>setPreop(p=>({...p,currentMeds:e.target.value}))} /></FL>
                  </div>
                  <FL label="Pre-op Orders"><textarea className="his-textarea" value={preop.preopOrders} placeholder="NBM from midnight, IV access, pre-med (Tab Alprazolam 0.5mg HS)…" onChange={e=>setPreop(p=>({...p,preopOrders:e.target.value}))} /></FL>

                  {/* R7em-2 — Pre-op Assessment (NABH COP.13) */}
                  <div style={{ background: "#f8fafc", border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 14px" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".6px", marginBottom: 10 }}>Pre-op Assessment (NABH COP.13)</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10 }}>
                      <FL label="Fasting (hrs)"><input type="number" min="0" className="his-field" value={preop.fastingHours} placeholder="8" onChange={e=>setPreop(p=>({...p,fastingHours:e.target.value}))} /></FL>
                      <FL label="Airway Plan"><input className="his-field" value={preop.airwayPlan} placeholder="ETT / LMA / Mask / Nasal" onChange={e=>setPreop(p=>({...p,airwayPlan:e.target.value}))} /></FL>
                      <FL label="Induction At"><input type="datetime-local" className="his-field" value={preop.inductionAt} onChange={e=>setPreop(p=>({...p,inductionAt:e.target.value}))} /></FL>
                      <FL label="Reversal At"><input type="datetime-local" className="his-field" value={preop.reversalAt} onChange={e=>setPreop(p=>({...p,reversalAt:e.target.value}))} /></FL>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr", gap: 10, marginTop: 10 }}>
                      <FL label="Pre-op BP"><input className="his-field" value={preop.preOpBp} placeholder="120/80" onChange={e=>setPreop(p=>({...p,preOpBp:e.target.value}))} /></FL>
                      <FL label="Pulse"><input type="number" min="0" className="his-field" value={preop.preOpPulse} placeholder="78" onChange={e=>setPreop(p=>({...p,preOpPulse:e.target.value}))} /></FL>
                      <FL label="Temp (°F)"><input type="number" step="0.1" className="his-field" value={preop.preOpTemp} placeholder="98.6" onChange={e=>setPreop(p=>({...p,preOpTemp:e.target.value}))} /></FL>
                      <FL label="SpO₂ (%)"><input type="number" min="0" max="100" className="his-field" value={preop.preOpSpo2} placeholder="98" onChange={e=>setPreop(p=>({...p,preOpSpo2:e.target.value}))} /></FL>
                      <FL label="Aldrete Score (0–10)"><input type="number" min="0" max="10" className="his-field" value={preop.aldreteScore} placeholder="10" onChange={e=>setPreop(p=>({...p,aldreteScore:e.target.value}))} /></FL>
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <FL label="Operating Surgeon"><input className="his-field" value={preop.surgeon} placeholder="Dr. Name" onChange={e=>setPreop(p=>({...p,surgeon:e.target.value}))} /></FL>
                    <FL label="Anaesthetist"><input className="his-field" value={preop.anaesthetist} placeholder="Dr. Name" onChange={e=>setPreop(p=>({...p,anaesthetist:e.target.value}))} /></FL>
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
                    <FL label="Procedure Performed *"><input className="his-field" value={postop.procedurePerformed} placeholder="e.g. Laparoscopic appendicectomy" onChange={e=>setPostop(p=>({...p,procedurePerformed:e.target.value}))} /></FL>
                    <FL label="Post-op Diagnosis"><input className="his-field" value={postop.postopDiagnosis} placeholder="Confirmed post-op diagnosis" onChange={e=>setPostop(p=>({...p,postopDiagnosis:e.target.value}))} /></FL>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10 }}>
                    <FL label="Start Time"><input type="time" className="his-field" value={postop.startTime} onChange={e=>setPostop(p=>({...p,startTime:e.target.value}))} /></FL>
                    <FL label="End Time"><input type="time" className="his-field" value={postop.endTime} onChange={e=>setPostop(p=>({...p,endTime:e.target.value}))} /></FL>
                    <FL label="Surgeon"><input className="his-field" value={postop.surgeon} placeholder="Dr. Name" onChange={e=>setPostop(p=>({...p,surgeon:e.target.value}))} /></FL>
                    <FL label="Anaesthetist"><input className="his-field" value={postop.anaesthetist} placeholder="Dr. Name" onChange={e=>setPostop(p=>({...p,anaesthetist:e.target.value}))} /></FL>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                    <FL label="Anaesthesia Used">
                      <select className="his-select" value={postop.anaesthesia} onChange={e=>setPostop(p=>({...p,anaesthesia:e.target.value}))}>
                        {["General","Spinal","Epidural","Local","Sedation","Combined"].map(o=><option key={o}>{o}</option>)}
                      </select>
                    </FL>
                    <FL label="Blood Loss (mL)"><input type="number" className="his-field" value={postop.bloodLoss} placeholder="50" onChange={e=>setPostop(p=>({...p,bloodLoss:e.target.value}))} /></FL>
                    <FL label="Transfusion">
                      <select className="his-select" value={postop.transfusion} onChange={e=>setPostop(p=>({...p,transfusion:e.target.value}))}>
                        {["None","1 Unit PRC","2 Units PRC","FFP","Platelets","Multiple"].map(o=><option key={o}>{o}</option>)}
                      </select>
                    </FL>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                    <FL label="Fluids Given (mL)"><input type="number" className="his-field" value={postop.fluidsGiven} placeholder="2000" onChange={e=>setPostop(p=>({...p,fluidsGiven:e.target.value}))} /></FL>
                    <FL label="Urine Output (mL)"><input type="number" className="his-field" value={postop.urineOutput} placeholder="400" onChange={e=>setPostop(p=>({...p,urineOutput:e.target.value}))} /></FL>
                    <FL label="Condition Leaving OT">
                      <select className="his-select" style={{ borderColor: postop.conditionLeavingOT==="Critical"?C.red:"#e2e8f0" }} value={postop.conditionLeavingOT} onChange={e=>setPostop(p=>({...p,conditionLeavingOT:e.target.value}))}>
                        {["Stable","Satisfactory","Critical","On Ventilator","Extubated in OT"].map(o=><option key={o}>{o}</option>)}
                      </select>
                    </FL>
                  </div>
                  <FL label="Operative Findings"><textarea className="his-textarea" value={postop.operativeFindings} placeholder="What was found intraoperatively…" onChange={e=>setPostop(p=>({...p,operativeFindings:e.target.value}))} /></FL>
                  <div style={{ display: "flex", gap: 20 }}>
                    <label style={{ display:"flex", alignItems:"center", gap:8, cursor:"pointer", fontWeight:700, fontSize:13, color:postop.specimenSent?C.blue:C.muted }}>
                      <input type="checkbox" checked={postop.specimenSent} onChange={e=>setPostop(p=>({...p,specimenSent:e.target.checked}))} style={{ accentColor:C.blue, width:15, height:15 }} /> Specimen sent
                    </label>
                  </div>
                  {postop.specimenSent && <FL label="Specimen Type"><input className="his-field" value={postop.specimenType} placeholder="Histopathology / C&S" onChange={e=>setPostop(p=>({...p,specimenType:e.target.value}))} /></FL>}
                  <FL label="Post-op Orders"><textarea className="his-textarea" value={postop.postopOrders} placeholder="IV fluids, analgesia, monitoring parameters, diet, drain/suction care…" onChange={e=>setPostop(p=>({...p,postopOrders:e.target.value}))} /></FL>
                  <FL label="Recovery Room Instructions"><input className="his-field" value={postop.recoveryInstructions} placeholder="Airway monitoring, vitals Q15, oxygen, call criteria…" onChange={e=>setPostop(p=>({...p,recoveryInstructions:e.target.value}))} /></FL>
                </div>
              )}

              {/* ══ DEATH NOTE ══ */}
              {activeModal === "death" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ background: "#f1f5f9", border: `1.5px solid #94a3b8`, borderRadius: 8, padding: "10px 14px", fontSize: 12, color: C.slate, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
                    <i className="pi pi-exclamation-triangle" style={{ fontSize: 13 }} /> Death Summary — NABH MOI.10 · Complete all mandatory fields
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                    <FL label="Date & Time of Death *"><input type="datetime-local" className="his-field" value={death.dateTime} onChange={e=>setDeath(p=>({...p,dateTime:e.target.value}))} /></FL>
                    <FL label="Mode of Death *">
                      <select className="his-select" value={death.modeOfDeath} onChange={e=>setDeath(p=>({...p,modeOfDeath:e.target.value}))}>
                        {["Cardiac Arrest","Respiratory Failure","Multi-organ Failure","Septic Shock","Haemorrhage","Renal Failure","Hepatic Failure","CNS Failure","Other"].map(o=><option key={o}>{o}</option>)}
                      </select>
                    </FL>
                    {/* R7em-7 — placeOfDeath required by NABH COP.18 Mortality Register.
                        Values match the MortalityRegister enum so the backend accepts them as-is. */}
                    <FL label="Place of Death *">
                      <select className="his-select" value={death.placeOfDeath} onChange={e=>setDeath(p=>({...p,placeOfDeath:e.target.value}))}>
                        {[
                          ["Ward","Ward"],
                          ["ICU","ICU"],
                          ["Emergency","Emergency"],
                          ["OT","Operation Theatre"],
                          ["Recovery","Recovery"],
                          ["Pre-Hospital-Arrival","Outside hospital"],
                          ["Other","Other"],
                        ].map(([v,l])=><option key={v} value={v}>{l}</option>)}
                      </select>
                    </FL>
                  </div>
                  <div style={{ background: "#f8fafc", border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 14px" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".6px", marginBottom: 10 }}>Cause of Death (ICD-10 Format)</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <FL label="I (a) — Immediate Cause of Death *"><input className="his-field" value={death.causeDeath1} placeholder="e.g. Acute myocardial infarction" onChange={e=>setDeath(p=>({...p,causeDeath1:e.target.value}))} /></FL>
                      <FL label="I (b) — Due to / Underlying Cause *"><input className="his-field" value={death.causeDeath2} placeholder="e.g. Coronary artery disease" onChange={e=>setDeath(p=>({...p,causeDeath2:e.target.value}))} /></FL>
                      <FL label="I (c) — Due to (if applicable)"><input className="his-field" value={death.causeDeath3} placeholder="e.g. Hypertension, Diabetes" onChange={e=>setDeath(p=>({...p,causeDeath3:e.target.value}))} /></FL>
                      <FL label="II — Other Contributing Conditions"><input className="his-field" value={death.contributing} placeholder="e.g. Chronic kidney disease, anaemia" onChange={e=>setDeath(p=>({...p,contributing:e.target.value}))} /></FL>
                    </div>
                  </div>
                  <FL label="Brief Sequence of Events *"><textarea className="his-textarea" style={{ minHeight: 80 }} value={death.sequenceOfEvents} placeholder="Timeline of clinical events leading to death…" onChange={e=>setDeath(p=>({...p,sequenceOfEvents:e.target.value}))} /></FL>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <FL label="Family Informed By *"><input className="his-field" value={death.familyInformedBy} placeholder="Doctor/nurse name" onChange={e=>setDeath(p=>({...p,familyInformedBy:e.target.value}))} /></FL>
                    <FL label="Time Family Informed"><input type="time" className="his-field" value={death.familyInformedTime} onChange={e=>setDeath(p=>({...p,familyInformedTime:e.target.value}))} /></FL>
                  </div>
                  <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
                    {/* R7em-7 — postMortemDone added (separate from pmAdvised which only tracks advice) */}
                    {[{k:"familyInformed",l:"Family Informed",c:C.green},{k:"dnrInPlace",l:"DNR Was in Place",c:C.blue},{k:"mlc",l:"MLC Case",c:C.red},{k:"pmAdvised",l:"Post-mortem Advised",c:C.amber},{k:"postMortemDone",l:"Post-mortem Done",c:C.amber},{k:"certificateIssued",l:"Death Certificate Issued",c:C.green}].map(f=>(
                      <label key={f.k} style={{ display:"flex", alignItems:"center", gap:8, cursor:"pointer", fontWeight:700, fontSize:13, color:death[f.k]?f.c:C.muted, padding:"6px 12px", border:`1.5px solid ${death[f.k]?f.c:C.border}`, borderRadius:20, background:death[f.k]?(f.c+"15"):"white", transition:"all .15s" }}>
                        <input type="checkbox" checked={death[f.k]} onChange={e=>setDeath(p=>({...p,[f.k]:e.target.checked}))} style={{ accentColor:f.c, width:13, height:13 }} />{f.l}
                      </label>
                    ))}
                  </div>
                  {/* R7em-7 — Death-certificate fields required by NABH COP.18 Mortality Register */}
                  {death.certificateIssued && (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                      <FL label="Death Certificate Number"><input className="his-field" value={death.deathCertificateNumber} placeholder="e.g. DC-2026-00123" onChange={e=>setDeath(p=>({...p,deathCertificateNumber:e.target.value}))} /></FL>
                      <FL label="Certificate Issued At"><input type="datetime-local" className="his-field" value={death.deathCertificateIssuedAt} onChange={e=>setDeath(p=>({...p,deathCertificateIssuedAt:e.target.value}))} /></FL>
                    </div>
                  )}
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
                      <select className="his-select" value={amendment.originalNoteId} onChange={e=>setAmendment(p=>({...p,originalNoteId:e.target.value}))}>
                        <option value="">— Select signed note —</option>
                        {notes.filter(n=>n.status==="signed").map(n=>(
                          <option key={n._id} value={n._id}>
                            {new Date(n.createdAt).toLocaleDateString("en-IN")} {new Date(n.createdAt).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"})} — {MODULES.find(m=>m.id===n.noteType)?.label||"Daily Progress"} — {n.doctorName}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input className="his-field" value={amendment.originalNoteId} placeholder="Note ID / Date of note being amended" onChange={e=>setAmendment(p=>({...p,originalNoteId:e.target.value}))} />
                    )}
                  </FL>
                  <FL label="Reason for Amendment *">
                    <select className="his-select" value={amendment.reason} onChange={e=>setAmendment(p=>({...p,reason:e.target.value}))}>
                      {["Typographical Error","Clinical Correction","Missing Information","Wrong Medication","Wrong Dose","Clarification Required","Other"].map(o=><option key={o}>{o}</option>)}
                    </select>
                  </FL>
                  <FL label="Amendment / Correction *"><textarea className="his-textarea" style={{ minHeight: 100 }} value={amendment.correction} placeholder="State the correction clearly. Note: original signed content is preserved in the record. This amendment is added as an addendum with date, time, and signature." onChange={e=>setAmendment(p=>({...p,correction:e.target.value}))} /></FL>
                  <FL label="Witnessed By *"><input className="his-field" value={amendment.witness} placeholder="Name of witnessing doctor/nurse" onChange={e=>setAmendment(p=>({...p,witness:e.target.value}))} /></FL>
                  <div style={{ background: "#fffbeb", border: `1px solid ${C.amberB}`, borderRadius: 7, padding: "10px 14px", fontSize: 12, color: "#92400e" }}>
                    <b>NABH Requirement:</b> This amendment will be signed with your credentials, time-stamped, and appended to the original note. The original remains unaltered in the system audit trail.
                  </div>
                </div>
              )}

              {/* ── Quick Tags ── */}
              {MODULE_TAGS[activeModal]?.length > 0 && (
                <div style={{ marginTop: 14 }}>
                  <div className="his-label">Quick Tags</div>
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
                <button onClick={() => { setActiveModal(null); setEditingNote(null); }} className="his-btn--ghost">
                  Cancel
                </button>
                <button onClick={() => saveNote("draft")} disabled={saving} className="his-btn--ghost"
                  style={{ background: C.amberL, color: C.amber, borderColor: C.amberB }}>
                  <i className={`pi ${editingNote ? "pi-refresh" : "pi-save"}`} />
                  {editingNote ? "Update Draft" : "Save Draft"}
                </button>
                <button onClick={() => { if (!signature) { setShowSetup(true); toast.info("Please set your signature first"); return; } saveNote("signed"); }} disabled={saving} className="his-btn"
                  style={{ background: saving ? "#5eead4" : `linear-gradient(135deg, ${C.primary}, ${C.primaryMid})` }}>
                  <i className={`pi ${saving ? "pi-spin pi-spinner" : "pi-check-circle"}`} />
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

      {/* R7az — Initial Assessment modal removed. Doctors now do the
          initial assessment inline via the Add Note → Initial Assessment
          card; the gate banner above auto-navigates them there when the
          IPD admission requires it. */}
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
