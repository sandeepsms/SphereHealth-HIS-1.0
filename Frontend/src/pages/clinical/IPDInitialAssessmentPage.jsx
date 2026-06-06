import React, { useState, useEffect, useMemo } from "react";
import "../../Components/clinical/clinical-forms.css";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import axios from "axios";
import { API_ENDPOINTS } from "../../config/api";
import { useAuth } from "../../context/AuthContext";
import { toast } from "react-toastify";
import ClinicalLayout from "../../Components/clinical/ClinicalLayout";
import { useAutoSave } from "../../hooks/useAutoSave";
import { useDigitalSignature } from "../../hooks/useDigitalSignature";
import AutoSaveIndicator from "../../Components/signature/AutoSaveIndicator";
import SignaturePad from "../../Components/signature/SignaturePad";
// R7fr Track C: shared NABH print frame — replaces the inline
// <head><style>...</style></head> + .hdr/.pat-strip blocks in
// handlePrintAssessment() with the canonical PrintShell triple-zone
// header + 2-col patient strip + double-signature zone. The
// role-aware nursing/doctor block HTML (R7fh) flows in via bodyHtml.
import { buildPrintShellHtml } from "@/templates/PrintShell";
// R7hr-58 — Structured Clinical Examination card shared with
// OPDAssessmentPage. Replaces the old Review-of-Systems checklist +
// free-text Physical Examination textareas with the same rich
// General-Exam + CVS/RS/CNS/P-A UI the doctor already uses in OPD.
import ClinicalExaminationCard, { clinExamSummary } from "../../Components/clinical/ClinicalExaminationCard";
// R7hr-59 — Shared OPD-style Rx + IV-fluids builders. Same controlled
// components the doctor already uses in OPDAssessmentPage so the IPD
// Initial Assessment gets the rich DrugAutocomplete + 7-cell rx row +
// IV bag builder UX instead of the legacy hand-built textarea/table.
import PrescriptionPanel from "../../Components/clinical/PrescriptionPanel";
import InfusionPanel     from "../../Components/clinical/InfusionPanel";

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
  slate: "#1e293b",
};

/* ── Section card ── */
function Section({ title, icon, color = C.accent, badge, children, defaultOpen = true, disabled = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ background: C.card, border: `1.5px solid ${color}25`, borderRadius: 12, overflow: "hidden", marginBottom: 14 }}>
      <div onClick={() => setOpen(o => !o)} style={{
        padding: "10px 18px", background: color + "08", borderBottom: open ? `1px solid ${color}18` : "none",
        display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 26, height: 26, borderRadius: 6, background: color + "20",
            display: "flex", alignItems: "center", justifyContent: "center" }}>
            <i className={`pi ${icon}`} style={{ fontSize: 12, color }} />
          </span>
          <span style={{ fontWeight: 700, fontSize: 13, color: C.text }}>{title}</span>
          {badge && (
            <span style={{ background: color + "18", color, border: `1px solid ${color}30`,
              fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 4 }}>{badge}</span>
          )}
          {disabled && (
            <span title="Locked - click Amend at the top of the page to edit"
              style={{ background: "#fee2e2", color: "#b91c1c", border: "1px solid #fecaca",
                fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 4 }}>LOCKED</span>
          )}
        </div>
        <i className={`pi ${open ? "pi-chevron-up" : "pi-chevron-down"}`} style={{ fontSize: 10, color: C.muted }} />
      </div>
      {open && (
        <div
          aria-disabled={disabled || undefined}
          style={{
            padding: "16px 18px",
            ...(disabled ? { pointerEvents: "none", opacity: 0.7, filter: "saturate(0.85)" } : null),
          }}
        >{children}</div>
      )}
    </div>
  );
}

function Grid2({ children, gap = 14 }) {
  return <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap }}>{children}</div>;
}
function Grid3({ children }) {
  return <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>{children}</div>;
}
function Grid4({ children }) {
  return <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>{children}</div>;
}

function Field({ label, required, children, hint }) {
  return (
    <div>
      <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: C.muted,
        textTransform: "uppercase", letterSpacing: ".6px", marginBottom: 4 }}>
        {label}{required && <span style={{ color: C.red, marginLeft: 3 }}>*</span>}
      </label>
      {children}
      {hint && <div style={{ fontSize: 10, color: C.muted, marginTop: 3 }}>{hint}</div>}
    </div>
  );
}

/* ── Score badge ── */
function ScoreBadge({ score, label, risk, color }) {
  return (
    <div style={{ background: color + "15", border: `1.5px solid ${color}40`, borderRadius: 10,
      padding: "10px 14px", textAlign: "center" }}>
      <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 28, fontWeight: 900, color, lineHeight: 1 }}>{score}</div>
      <div style={{ fontSize: 10, fontWeight: 700, color, marginTop: 3 }}>{label}</div>
      <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{risk}</div>
    </div>
  );
}

/* ── R7hr-69 · Lab / Imaging / Procedure catalog for the
       Investigations autocomplete. Order: most-common Indian IPD
       admission workup first, then grouped specialty groups so the
       filter feels "smart" — doctor types 2-3 letters and the right
       test surfaces near the top. ─────────────────────────────────── */
const LAB_TESTS = [
  // Hematology
  "CBC (Complete Blood Count)", "ESR", "PT / INR", "aPTT", "D-Dimer",
  "Peripheral Smear", "Reticulocyte Count", "Bleeding Time", "Clotting Time",
  // Biochemistry — daily ward workup
  "LFT (Liver Function Tests)", "RFT (Renal Function Tests)",
  "Electrolytes (Na / K / Cl)", "Serum Calcium", "Serum Magnesium",
  "Serum Phosphorus", "Lipid Profile", "Random Blood Sugar (RBS)",
  "Fasting Blood Sugar (FBS)", "Post-Prandial Blood Sugar (PPBS)",
  "HbA1c", "Uric Acid", "Amylase", "Lipase", "CPK", "CPK-MB",
  "Troponin I", "NT-proBNP", "Procalcitonin", "CRP", "Ferritin",
  "Serum Iron / TIBC", "Vitamin D (25-OH)", "Vitamin B12", "Folate",
  // Endocrine
  "TSH", "Free T3", "Free T4", "Cortisol (8 AM)", "PTH",
  "Serum Insulin (Fasting)", "HCG (Beta)",
  // ABG / Blood Gas
  "ABG (Arterial Blood Gas)", "VBG (Venous Blood Gas)", "Lactate",
  // Microbiology / Culture
  "Blood Culture & Sensitivity", "Urine Culture & Sensitivity",
  "Sputum Culture & Sensitivity", "Stool Culture",
  "Wound Swab Culture", "CSF Analysis", "Pleural Fluid Analysis",
  "Ascitic Fluid Analysis",
  // Serology
  "HIV ELISA", "HBsAg", "Anti-HCV", "VDRL", "Dengue NS1 + IgM / IgG",
  "Malaria Antigen (MP-MRDT)", "Typhi-Dot IgM", "Widal Test",
  "COVID-19 RT-PCR", "Leptospira IgM", "Scrub Typhus IgM",
  // Urine / Stool
  "Urine Routine & Microscopy", "Urine Albumin-Creatinine Ratio",
  "24-hr Urine Protein", "24-hr Urine Creatinine Clearance",
  "Stool Routine & Microscopy", "Stool Occult Blood",
  // Cardiac
  "ECG (12-Lead)", "2D Echo", "Stress Test (TMT)", "Holter Monitoring",
  // Radiology
  "Chest X-Ray PA", "Chest X-Ray AP", "X-Ray KUB", "X-Ray Abdomen Erect",
  "X-Ray (specify region)",
  "USG Abdomen", "USG KUB", "USG Pelvis", "USG Whole Abdomen",
  "USG Doppler — Lower Limb Venous", "USG Doppler — Carotid",
  "CECT Head", "NCCT Head", "CECT Chest", "CECT Abdomen + Pelvis",
  "HRCT Chest", "MRI Brain (Plain + Contrast)", "MRI Spine",
  // Endoscopy / Procedures
  "Upper GI Endoscopy", "Colonoscopy", "Bronchoscopy", "ERCP",
  "FNAC (specify site)", "Biopsy (specify site)",
  // Pulmonary / Neuro
  "PFT (Pulmonary Function Test)", "Spirometry",
  "EEG", "EMG", "Nerve Conduction Study (NCS)",
];
/* ─────────────────────────────────────────────────────── */

/* ── R7hr-70 · Structured History catalogs (Past Surgical, Family,
       Social). Each [key, label] pair drives both the on-screen
       checkbox grid AND the print/save summary. ─────────────────── */
const PSH_OPTIONS = [
  ["appendectomy",     "Appendectomy"],
  ["cholecystectomy",  "Cholecystectomy"],
  ["hernia",           "Hernia repair"],
  ["cabg",             "CABG"],
  ["angioplasty",      "Angioplasty / Stent"],
  ["valveReplacement", "Valve replacement"],
  ["hysterectomy",     "Hysterectomy"],
  ["cSection",         "Caesarean section"],
  ["thyroidectomy",    "Thyroidectomy"],
  ["kneeReplacement",  "Knee replacement"],
  ["hipReplacement",   "Hip replacement"],
  ["cataract",         "Cataract surgery"],
];
const FAMHX_OPTIONS = [
  ["diabetes",            "Diabetes Mellitus"],
  ["hypertension",        "Hypertension"],
  ["cad",                 "CAD / IHD"],
  ["stroke",              "Stroke / CVA"],
  ["cancer",              "Cancer / Malignancy"],
  ["asthma",              "Asthma"],
  ["thyroid",             "Thyroid disorder"],
  ["mentalIllness",       "Mental illness"],
  ["kidney",              "Chronic Kidney Disease"],
  ["suddenCardiacDeath",  "Sudden cardiac death"],
  ["bleedingDisorder",    "Hereditary bleeding disorder"],
];
/* Social history is the odd one out — chip-group values (Never /
   Current / Former etc.) rather than booleans. Group → chip options. */
const SOCHX_GROUPS = [
  { key: "smoking",   label: "Smoking",   chips: ["Never", "Current", "Former"] },
  { key: "alcohol",   label: "Alcohol",   chips: ["Never", "Occasional", "Daily", "Former"] },
  { key: "tobacco",   label: "Tobacco / Gutka / Paan", chips: ["Never", "Current", "Former"] },
  { key: "substance", label: "Substance abuse", chips: ["Never", "Past", "Current"] },
];

function pshSummary(s) {
  if (!s) return "";
  const ticks = PSH_OPTIONS.filter(([k]) => s[k]).map(([, l]) => l);
  if (s.other) ticks.push(s.other);
  return ticks.join(", ");
}
function famHxSummary(s) {
  if (!s) return "";
  const ticks = FAMHX_OPTIONS.filter(([k]) => s[k]).map(([, l]) => l);
  if (s.other) ticks.push(s.other);
  return ticks.join(", ");
}
function socHxSummary(s) {
  if (!s) return "";
  const parts = [];
  for (const g of SOCHX_GROUPS) {
    const v = s[g.key];
    if (v && v !== "Never") parts.push(`${g.label}: ${v}`);
  }
  if (s.occupation)    parts.push(`Occupation: ${s.occupation}`);
  if (s.recentTravel)  parts.push(`Recent travel: ${s.recentTravel}`);
  if (s.other)         parts.push(s.other);
  return parts.join(" · ");
}

/* ── MORSE FALL SCALE ──────────────────────────────── */
const MORSE_ITEMS = [
  {
    key: "fallHistory", label: "History of falling within 3 months",
    options: [{ label: "No", score: 0 }, { label: "Yes", score: 25 }],
  },
  {
    key: "secondDiagnosis", label: "Secondary diagnosis",
    options: [{ label: "No", score: 0 }, { label: "Yes", score: 15 }],
  },
  {
    key: "ambulatoryAid", label: "Ambulatory aid",
    options: [
      { label: "None / Bedrest / Nurse assist", score: 0 },
      { label: "Crutches / cane / walker", score: 15 },
      { label: "Furniture", score: 30 },
    ],
  },
  {
    key: "ivAccess", label: "IV access / IV therapy",
    options: [{ label: "No", score: 0 }, { label: "Yes", score: 20 }],
  },
  {
    key: "gait", label: "Gait / transferring",
    options: [
      { label: "Normal / bedrest / immobile", score: 0 },
      { label: "Weak", score: 10 },
      { label: "Impaired", score: 20 },
    ],
  },
  {
    key: "mentalStatus", label: "Mental status",
    options: [
      { label: "Oriented to own ability", score: 0 },
      { label: "Overestimates / forgets limitations", score: 15 },
    ],
  },
];

function morseRisk(score) {
  if (score < 25) return { label: "No Risk", color: C.green };
  if (score < 45) return { label: "Low Risk", color: C.amber };
  return { label: "High Risk", color: C.red };
}

/* ── BRADEN SCALE ──────────────────────────────────── */
const BRADEN_ITEMS = [
  {
    key: "sensoryPerception", label: "Sensory Perception",
    options: [
      { label: "1 — Completely Limited", score: 1 },
      { label: "2 — Very Limited", score: 2 },
      { label: "3 — Slightly Limited", score: 3 },
      { label: "4 — No Impairment", score: 4 },
    ],
  },
  {
    key: "moisture", label: "Moisture",
    options: [
      { label: "1 — Constantly Moist", score: 1 },
      { label: "2 — Very Moist", score: 2 },
      { label: "3 — Occasionally Moist", score: 3 },
      { label: "4 — Rarely Moist", score: 4 },
    ],
  },
  {
    key: "activity", label: "Activity",
    options: [
      { label: "1 — Bedfast", score: 1 },
      { label: "2 — Chairfast", score: 2 },
      { label: "3 — Walks Occasionally", score: 3 },
      { label: "4 — Walks Frequently", score: 4 },
    ],
  },
  {
    key: "mobility", label: "Mobility",
    options: [
      { label: "1 — Completely Immobile", score: 1 },
      { label: "2 — Very Limited", score: 2 },
      { label: "3 — Slightly Limited", score: 3 },
      { label: "4 — No Limitation", score: 4 },
    ],
  },
  {
    key: "nutrition", label: "Nutrition",
    options: [
      { label: "1 — Very Poor", score: 1 },
      { label: "2 — Probably Inadequate", score: 2 },
      { label: "3 — Adequate", score: 3 },
      { label: "4 — Excellent", score: 4 },
    ],
  },
  {
    key: "frictionShear", label: "Friction & Shear",
    options: [
      { label: "1 — Problem", score: 1 },
      { label: "2 — Potential Problem", score: 2 },
      { label: "3 — No Apparent Problem", score: 3 },
    ],
  },
];

function bradenRisk(score) {
  if (score <= 9)  return { label: "Very High Risk", color: "#9f1239" };
  if (score <= 12) return { label: "High Risk", color: C.red };
  if (score <= 14) return { label: "Moderate Risk", color: C.orange };
  if (score <= 18) return { label: "Mild Risk", color: C.amber };
  return { label: "No Risk", color: C.green };
}

/* ── NRS-2002 Nutritional Screen ── */
const NUTRI_ITEMS = [
  {
    key: "bmi", label: "Nutritional status (BMI / weight loss)",
    options: [
      { label: "0 — BMI >20.5 & no weight loss", score: 0 },
      { label: "1 — Weight loss >5% in 3 months OR BMI 18.5–20.5", score: 1 },
      { label: "2 — Weight loss >5% in 2 months OR BMI <18.5", score: 2 },
      { label: "3 — Severely malnourished (BMI <18.5 + impaired general condition)", score: 3 },
    ],
  },
  {
    key: "intake", label: "Dietary intake in past week",
    options: [
      { label: "0 — Normal intake", score: 0 },
      { label: "1 — Intake reduced to 50–75% of requirement", score: 1 },
      { label: "2 — Intake reduced to 25–50%", score: 2 },
      { label: "3 — Intake 0–25% of requirement", score: 3 },
    ],
  },
  {
    key: "severity", label: "Severity of disease",
    options: [
      { label: "0 — No disease / normal requirements", score: 0 },
      { label: "1 — Hip fracture / chronic disease (dialysis, COPD, diabetes)", score: 1 },
      { label: "2 — Major abdominal surgery / stroke / severe pneumonia / blood cancer", score: 2 },
      { label: "3 — Head injury / bone marrow transplant / ICU (APACHE >10)", score: 3 },
    ],
  },
  {
    key: "age", label: "Age ≥70 years",
    options: [
      { label: "0 — No", score: 0 },
      { label: "1 — Yes (add 1 to total)", score: 1 },
    ],
  },
];

function nutriRisk(score) {
  if (score >= 3) return { label: "At Risk — refer dietician", color: C.red };
  return { label: "Not at Risk — reassess in 7 days", color: C.green };
}

/* ── CAPRINI VTE RISK ── */
const VTE_GROUPS = [
  {
    group: "1 point each",
    items: [
      { key: "age41_60", label: "Age 41–60 years" },
      { key: "minorSurgery", label: "Minor surgery planned" },
      { key: "historyMajorSurgery", label: "Previous major surgery (<1 month)" },
      { key: "varicoseVeins", label: "Varicose veins" },
      { key: "inflammatoryBowel", label: "History of IBD" },
      { key: "swollenLegs", label: "Swollen legs (current)" },
      { key: "obesity", label: "Obesity (BMI > 25)" },
      { key: "acuteMI", label: "Acute myocardial infarction" },
      { key: "chf", label: "Congestive heart failure (<1 month)" },
      { key: "sepsisInfection", label: "Sepsis (<1 month)" },
      { key: "pneumoniaLung", label: "Serious lung disease (incl. pneumonia)" },
      { key: "bedRestMedical", label: "Bed rest medical patient (currently)" },
      { key: "immobilizingPlaster", label: "Immobilizing plaster cast" },
      { key: "centralVenousAccess", label: "Central venous access" },
    ],
  },
  {
    group: "2 points each",
    items: [
      { key: "age61_74", label: "Age 61–74 years" },
      { key: "arthroscopy", label: "Arthroscopic surgery" },
      { key: "malignancy", label: "Malignancy (present or previous)" },
      { key: "majorSurgery90", label: "Major surgery >45 min" },
      { key: "laparoscopic45", label: "Laparoscopic surgery (>45 min)" },
      { key: "confinedBed72h", label: "Confined to bed >72 hours" },
      { key: "immobilizingCast", label: "Immobilizing cast / brace" },
    ],
  },
  {
    group: "3 points each",
    items: [
      { key: "age75plus", label: "Age ≥75 years" },
      { key: "dvtHistory", label: "Personal history of DVT/PE" },
      { key: "familyHistory", label: "Family history of DVT/PE" },
      { key: "factorV", label: "Factor V Leiden mutation" },
      { key: "prothrombin20210a", label: "Prothrombin 20210A mutation" },
      { key: "lupus", label: "Lupus anticoagulant" },
      { key: "antiphospholipid", label: "Anticardiolipin antibodies" },
      { key: "homocysteine", label: "Elevated serum homocysteine" },
      { key: "hit", label: "HIT (do not use heparin/LMWH)" },
      { key: "otherThrombophilia", label: "Other congenital or acquired thrombophilia" },
    ],
  },
  {
    group: "5 points each",
    items: [
      { key: "stroke", label: "Stroke (<1 month)" },
      { key: "electiveMajorLowerLimb", label: "Elective major lower limb arthroplasty" },
      { key: "hipPelvisFracture", label: "Hip, pelvis or leg fracture (<1 month)" },
      { key: "acuteSpinalCord", label: "Acute spinal cord injury (<1 month)" },
      { key: "multipleTrauma", label: "Multiple trauma (<1 month)" },
    ],
  },
];

const VTE_POINTS = { "1 point each": 1, "2 points each": 2, "3 points each": 3, "5 points each": 5 };

function vteRisk(score) {
  if (score === 0) return { label: "Lowest Risk — early ambulation", color: C.green };
  if (score <= 2)  return { label: "Low Risk — IPCD recommended", color: C.teal };
  if (score <= 4)  return { label: "Moderate Risk — LMWH / IPCD", color: C.amber };
  return { label: "High Risk — LMWH + IPCD + graduated stockings", color: C.red };
}

/* ── Rx blank row ── */
const blankRx = () => ({
  id: Date.now() + Math.random(),
  drug: "", dose: "", route: "Oral", frequency: "OD", duration: "", instructions: "",
});

const ROUTES = ["Oral", "IV", "IM", "SC", "SL", "Topical", "Inhaled", "PR", "Nasal"];
const FREQS  = ["OD", "BD", "TDS", "QID", "SOS", "Stat", "HS", "Alternate days", "Weekly"];

/* ════════════════════════════════════════════════════════════════ */
// R7ev — Named export so DoctorNotesPage can mount this inline (mirrors
// the EmergencyAssessmentPageContent pattern). Without this, the only
// way to reach this surface was the standalone /ipd-initial-assessment
// route, so an IPD admission opened in DoctorNotes was being shown the
// Emergency Assessment shape (triage + bed allotment) instead.
// R7ey-F79/F80/F81 — accept `onSign` callback so the parent (DoctorNotesPage
// embed) can refresh its local `patient.initialAssessment` cache the moment
// the doctor signs, lifting the tile-gate without a full page reload.
export function IPDInitialAssessmentContent({ selectedPatient, onSign, defaultViewRole }) {
  const { uhid: uhidParam } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  // R7ey-F79/F80 — when a DOCTOR mounts this component (via DoctorNotesPage),
  // show the Doctor sign-off block instead of the Nursing one. Pre-R7ey the
  // Doctor block was dead under {false && ...} so the doctor saw the Nurse
  // sign button → signed as a nurse → admission.initialAssessment.nurseCompleted
  // got set instead of doctorCompleted → DoctorNotes tile-gate never lifted.
  // R7fn — make the role-aware view toggleable for Admin. The page was
  // previously locked to NURSING view for Admin (isDoctorRole === false),
  // so Admin couldn't fill the Doctor side at all. Now Admin gets a small
  // toggle in the header to flip between Nurse and Doctor view. Doctor
  // users always see Doctor view; Nurse users always see Nursing view —
  // no UX change for them.
  //
  // R7hr-57 — accept `defaultViewRole` prop. Pre-R7hr-57 an Admin opening
  // this page from DoctorNotes saw the Nursing form by default (because
  // the role-based default fell through to "nurse" for non-doctor users).
  // DoctorNotes now passes `defaultViewRole="doctor"` so the embed always
  // opens in Doctor view — matching the page context the user clicked
  // into. Standalone /ipd-initial-assessment route keeps the role-based
  // default. Doctor/Nurse users are unaffected (their role still wins).
  const _userRoleRaw = String(user?.role || "").toLowerCase();
  const isAdminUser  = _userRoleRaw === "admin";
  const _roleBasedDefault = _userRoleRaw === "doctor" ? "doctor" : "nurse";
  // Doctor role always overrides; Nurse role always overrides; everyone
  // else (Admin, etc.) honours the explicit `defaultViewRole` prop.
  const _defaultViewRole =
    _userRoleRaw === "doctor" ? "doctor"
    : _userRoleRaw === "nurse" ? "nurse"
    : (defaultViewRole === "doctor" || defaultViewRole === "nurse")
      ? defaultViewRole
      : _roleBasedDefault;
  const [viewRole, setViewRole] = useState(_defaultViewRole);
  const isDoctorRole = viewRole === "doctor";

  // Support both path param (:uhid) and query param (?uhid=)
  const initUhid = uhidParam || searchParams.get("uhid") || "";
  const [uhid, setUhid]           = useState(initUhid);
  const [patient, setPatient]     = useState(null);
  const [admission, setAdmission] = useState(null); // active admission for initialAssessment gate

  // R7bd — Auto-load patient when clicked from the admitted-patient
  // side panel. Pre-R7bd this useEffect only pre-filled the UHID input
  // field; the user then had to hit the "Load Patient" button to
  // actually fetch the patient data. Now we ALSO fire loadPatient()
  // with the UHID directly so the form renders immediately.
  useEffect(() => {
    if (selectedPatient?.UHID) {
      setUhid(selectedPatient.UHID);
      setIpdNo(selectedPatient.bedNumber || "");
      setWard(selectedPatient.wardName || "");
      setBedNo(selectedPatient.bedNumber || "");
      loadPatient(selectedPatient.UHID);
    }
    // loadPatient is a stable closure; depending on selectedPatient._id
    // is enough to re-run only when the user picks a different patient.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPatient?._id, selectedPatient?.UHID]);
  const [loadingPt, setLoadingPt] = useState(false);
  const [saving, setSaving]       = useState(false);
  // R7fn-v2 — TWO distinct DoctorNote rows: one per section. The R7fa
  // design said nurse and doctor have SEPARATE Initial Assessments, but
  // the original code reused a single id. That meant once the nurse
  // signed (status="signed"), the doctor's PATCH /sign came back 400
  // ("Note already signed") because the backend tried to lock the SAME
  // row a second time. Each section now tracks its own DoctorNote id so
  // the doctor's save creates a new doc on top of the nurse's signed
  // one — and signs it cleanly.
  const [doctorNoteId, setDoctorNoteId] = useState(null);
  const [nurseSectionNoteId, setNurseSectionNoteId] = useState(null);
  // R7fm — separate NurseNote id for the nursing-section mirror write
  // (NurseNotes collection / nursing timeline). See R7fm.
  const [nurseNoteId, setNurseNoteId] = useState(null);
  // R7hr-72/lock — One-shot fill, explicit Amend ceremony. Once the
  // restored role-specific note has status signed/amended, the page
  // drops into LOCKED mode: every Section becomes read-only behind the
  // `ro` helper, the bottom Save/Sign buttons hide, and a red ribbon
  // exposes a single Amend button. Clicking it pops a modal that
  // captures a reason (min 5 chars), snapshots the full form state,
  // then unlocks the page for editing. On save, a diff payload + the
  // reason posts to /{role-notes}/:id/amend so the backend logs the
  // audit row and re-signs.
  const [iaLocked,         setIaLocked]         = useState(false);
  const [amendMode,        setAmendMode]        = useState(false);
  const [amendReason,      setAmendReason]      = useState("");
  const [amendModalOpen,   setAmendModalOpen]   = useState(false);
  const [preAmendSnapshot, setPreAmendSnapshot] = useState(null);
  // Lock ribbon metadata sourced from the restored note.
  const [lockedSignedByName, setLockedSignedByName] = useState("");
  const [lockedSignedAt,     setLockedSignedAt]     = useState(null);
  // R7hr-90 — Server-known existing role-specific signed/amended IA note
  // (id only). Powers the pre-POST defensive guard and the 409 handler:
  // the one-shot constraint says only ONE Initial Assessment per
  // (admission, role) may exist signed. If this id is set, attempting to
  // create another via Sign & Submit (without amendMode) is blocked.
  const [existingSignedIaId, setExistingSignedIaId] = useState(null);
  // R7bd — activeTab + Doctor Initial Assessment tab removed. This page
  // is now nursing-only: the Doctor's initial assessment lives in the
  // dedicated Doctor Notes → Initial Assessment flow, and combining
  // both forms here was confusing nurses (the screenshot showed both
  // tabs side-by-side when entering from Nursing Notes).

  /* ══ NURSING ASSESSMENT STATE ══ */

  /* General */
  const [admitDate, setAdmitDate]   = useState(new Date().toISOString().slice(0, 10));
  const [admitTime, setAdmitTime]   = useState(new Date().toTimeString().slice(0, 5));
  const [ipdNo, setIpdNo]           = useState("");
  const [nurseName, setNurseName]   = useState(user?.fullName || "");
  const [ward, setWard]             = useState("");
  const [bedNo, setBedNo]           = useState("");
  const [modeOfAdmit, setModeOfAdmit] = useState("OPD Referral");
  const [consciousnessLevel, setConsciousnessLevel] = useState("Alert");
  const [mobility, setMobility]     = useState("Independent");
  const [allergy, setAllergy]       = useState("");
  const [chiefComplaint, setChiefComplaint] = useState("");

  /* Vitals on admission */
  const [vitals, setVitals] = useState({
    bpSys: "", bpDia: "", pulse: "", temp: "", spo2: "",
    rr: "", weight: "", height: "",
  });

  /* Pain */
  const [painPresent, setPainPresent] = useState(false);
  const [painScore, setPainScore]     = useState("");
  const [painLocation, setPainLocation] = useState("");
  const [painCharacter, setPainCharacter] = useState("");

  /* Devices */
  const [devices, setDevices] = useState({
    ivAccess: false, urinaryCatheter: false,
    nasogastricTube: false, oxygenSupport: false,
    centralLine: false, rylesTube: false,
  });

  /* Skin */
  const [skinIntact, setSkinIntact] = useState(true);
  const [skinNotes, setSkinNotes]   = useState("");

  /* Morse Fall Scale */
  const [morse, setMorse] = useState({
    fallHistory: 0, secondDiagnosis: 0, ambulatoryAid: 0,
    ivAccess: 0, gait: 0, mentalStatus: 0,
  });
  const morseTotal = Object.values(morse).reduce((a, b) => a + b, 0);
  const morseMeta  = morseRisk(morseTotal);

  /* Braden Scale */
  const bradenDefaults = { sensoryPerception: 4, moisture: 4, activity: 4, mobility: 4, nutrition: 4, frictionShear: 3 };
  const [braden, setBraden] = useState(bradenDefaults);
  const bradenTotal = Object.values(braden).reduce((a, b) => a + b, 0);
  const bradenMeta  = bradenRisk(bradenTotal);

  /* NRS-2002 */
  const [nutri, setNutri] = useState({ bmi: 0, intake: 0, severity: 0, age: 0 });
  const nutriTotal = Object.values(nutri).reduce((a, b) => a + b, 0);
  const nutriMeta  = nutriRisk(nutriTotal);

  /* VTE — Caprini */
  const [vte, setVte] = useState({});
  const vteTotal = VTE_GROUPS.reduce((sum, grp) => {
    const pts = VTE_POINTS[grp.group];
    return sum + grp.items.reduce((s, item) => s + (vte[item.key] ? pts : 0), 0);
  }, 0);
  const vteMeta = vteRisk(vteTotal);

  /* Nursing plan / goals */
  const [nursingProblems, setNursingProblems] = useState("");
  const [nursingGoals, setNursingGoals]       = useState("");
  const [nursingNotes, setNursingNotes]       = useState("");

  /* ══ DOCTOR ASSESSMENT STATE ══ */
  const [doctorName, setDoctorName]     = useState(user?.fullName || "");
  const [regNo, setRegNo]               = useState(user?.doctorDetails?.registrationNumber || "");
  const [hopi, setHopi]                 = useState("");       // History of Present Illness
  // R7hr-70 — pmh removed (replaced by Co-morbidities checklist).
  // PSH / FamHx / SocHx kept as legacy strings for load fall-back, but
  // the canonical state moves to structured objects below.
  const [psh, setPsh]                   = useState("");   // legacy string — read-only after R7hr-70
  const [famHx, setFamHx]               = useState("");   // legacy string — read-only after R7hr-70
  const [socHx, setSocHx]               = useState("");   // legacy string — read-only after R7hr-70

  // R7hr-70 — Structured Past Surgical / Family / Social history.
  // Checkbox-grid UI mirrors Co-morbidities (3-col). Free-text "other"
  // captures anything not in the menu. On save these write through to
  // pshStruct / famHxStruct / socHxStruct AND a derived legacy string
  // so any downstream consumer that reads `psh` etc. still works.
  const [pshStruct, setPshStruct] = useState({
    appendectomy: false, cholecystectomy: false, hernia: false,
    cabg: false, angioplasty: false, valveReplacement: false,
    hysterectomy: false, cSection: false, thyroidectomy: false,
    kneeReplacement: false, hipReplacement: false, cataract: false,
    other: "",
  });
  const [famHxStruct, setFamHxStruct] = useState({
    diabetes: false, hypertension: false, cad: false, stroke: false,
    cancer: false, asthma: false, thyroid: false, mentalIllness: false,
    kidney: false, suddenCardiacDeath: false, bleedingDisorder: false,
    other: "",
  });
  const [socHxStruct, setSocHxStruct] = useState({
    smoking:   "Never",   // Never / Current / Former
    alcohol:   "Never",   // Never / Occasional / Daily / Former
    tobacco:   "Never",   // Never / Current / Former
    substance: "Never",   // Never / Past / Current
    occupation: "",
    recentTravel: "",
    other: "",
  });
  const [docAllergy, setDocAllergy]     = useState("");
  const [genExam, setGenExam]           = useState("");
  const [cvs, setCvs]                   = useState("");
  const [rs, setRs]                     = useState("");
  const [abdomen, setAbdomen]           = useState("");
  const [cns, setCns]                   = useState("");
  const [provDx, setProvDx]             = useState("");
  const [finalDx, setFinalDx]           = useState("");
  const [icd10, setIcd10]               = useState("");
  // R7hr-65 — bring IPD Diagnosis card to parity with OPD: ICD-10
  // description (free-text alongside the code) + Patient Status pill
  // (Stable / Improving / Unchanged / Deteriorating / Critical /
  // Ready for Discharge). Empty defaults so old saved IAs still load.
  const [icd10Description, setIcd10Description] = useState("");
  const [patientStatus, setPatientStatus]       = useState("");
  const [investigations, setInvestigations] = useState("");
  const [rxRows, setRxRows]             = useState([blankRx()]);
  // R7hr-59 — Adopt OPD-style structured Investigations + Rx + Infusion.
  // Shapes match PrescriptionPanel / InfusionPanel so the shared
  // components drop straight in. The legacy `rxRows` + `investigations`
  // string still live above for back-compat read/save (old saved
  // assessments shouldn't be lost), but new IPD assessments write
  // through to these structured arrays.
  const [meds,      setMeds]      = useState([]);   // PrescriptionPanel value
  const [invests,   setInvests]   = useState([]);   // [{ name, urgency?, instructions? }]
  const [infusions, setInfusions] = useState([]);   // InfusionPanel value
  // R7hr-69 — Investigations picker: catalog autocomplete + multi-select
  // chip flow. `invQuery` is the live input, `invPending` is the chip
  // batch waiting to be committed, `invUrgency` + `invInstructions`
  // apply to the whole batch on commit. `invSuggestIdx` drives keyboard
  // nav inside the autocomplete dropdown.
  const [invQuery,        setInvQuery]        = useState("");
  const [invPending,      setInvPending]      = useState([]); // array of test-name strings
  const [invUrgency,      setInvUrgency]      = useState("ROUTINE");
  const [invInstructions, setInvInstructions] = useState("");
  const [invShowSuggest,  setInvShowSuggest]  = useState(false);
  const [invSuggestIdx,   setInvSuggestIdx]   = useState(-1);
  const [treatmentPlan, setTreatmentPlan] = useState("");
  const [followupNotes, setFollowupNotes] = useState("");
  const [dietAdvice, setDietAdvice]     = useState("");
  const [activityAdvice, setActivityAdvice] = useState("");

  /* ══ R7fb · DOCTOR P0 NABH FIELDS (D1-D9) ══════════════════════
     Adds the NABH AAC.1 / COP.1 / AAC.4 fields that were missing
     when the doctor block was first uncovered (R7ey-F80). Each
     state group maps 1:1 to a section below — keep them aligned. */
  // D1 · Chief Complaint (distinct from HPI per NABH AAC.1)
  const [docCC, setDocCC]               = useState("");
  const [ccDuration, setCcDuration]     = useState("");
  // D2 · Structured Allergies (replaces old single docAllergy textarea)
  const [allergyList, setAllergyList]   = useState([]); // [{type, agent, severity, reaction}]
  const [noKnownAllergies, setNoKnownAllergies] = useState(false);
  // D3 · Medication Reconciliation (drugs patient was taking at home)
  const [medRecon, setMedRecon]         = useState([]); // [{drug, dose, frequency, lastTaken, continueOnAdmit}]
  // D4 · Working Diagnosis + Differential Diagnoses (3-tier per AAC.1)
  const [workingDx, setWorkingDx]       = useState("");
  const [differentialDx, setDifferentialDx] = useState(""); // freeform list, one per line
  // D5 · Co-morbidity structured checklist
  const [comorbid, setComorbid]         = useState({
    diabetes: false, hypertension: false, cad: false, ckd: false, copd: false,
    asthma: false, liverDx: false, cancer: false, stroke: false, mentalHealth: false,
    hypothyroid: false, hiv: false, hepB: false, hepC: false, other: "",
  });
  // D6 · Code Status (NABH AAC.4 / ROP.1)
  const [codeStatus, setCodeStatus]     = useState("FULL_CODE"); // FULL_CODE | DNR | DNI | LIMITED
  const [codeStatusDiscussedWith, setCodeStatusDiscussedWith] = useState("");
  const [codeStatusLimitations, setCodeStatusLimitations] = useState("");
  // D7 · Estimated Length of Stay + Goal of Care (AAC.4 discharge planning Day 1)
  const [elosDays, setElosDays]         = useState("");
  const [goalOfCare, setGoalOfCare]     = useState(""); // curative | palliative | supportive | rehabilitative
  // D8 · Doctor's risk acknowledgement (independent of nurse capture)
  const [docRiskAck, setDocRiskAck]     = useState({
    fall: { acknowledged: false, plan: "" },
    dvt:  { acknowledged: false, score: "", plan: "" }, // Caprini score moved here per audit
    ulcer:{ acknowledged: false, plan: "" },
    pain: { acknowledged: false, plan: "" },
  });
  // D9 · Review of Systems (brief checklist with "NAD" default)
  const [ros, setRos]                   = useState({
    constitutional: "NAD", cardiac: "NAD", respiratory: "NAD", gi: "NAD",
    gu: "NAD", musculoskeletal: "NAD", neuro: "NAD", skin: "NAD",
    endocrine: "NAD", psych: "NAD",
  });
  // R7hr-58 — Structured clinical examination (replaces simple Review of
  // Systems checklist + Physical Examination textareas). Shares UI with
  // OPD Assessment via ClinicalExaminationCard. The old `ros` + `genExam`
  // / `cvs` / `rs` / `abdomen` / `cns` strings stay in scope so legacy
  // records still load + print; the new structured payload takes
  // precedence on hydration.
  const [clinExam, setClinExam] = useState({
    genExam: {
      built: "", nourishment: "", consciousness: "", orientation: "",
      pallor: "", pedalEdema: "", hydration: "", jvp: "",
      icterus: false, cyanosis: false, clubbing: false,
      lymphadenopathy: false, febrile: false, lymphLocation: "",
    },
    sysExam: {
      cvs: { s1s2: "", rhythm: "", murmur: false, murmurDetails: "", other: "" },
      rs:  { airEntry: "", breathSounds: "", crepts: false, wheeze: false, rhonchi: false, other: "" },
      cns: { gcs: "", speech: "", tone: "", reflexes: "", plantar: "", power: "", other: "" },
      pa:  { soft: false, tender: false, distended: false, organomegaly: false, mass: false,
             bowelSounds: "", tenderLocation: "", organomegalyDetails: "", other: "" },
    },
    generalExamination: "",
    systemicExamination: "",
  });

  /* ══ R7fc · NURSE P0 NABH FIELDS (N1-N10) ══════════════════════ */
  // N1 · Identification Band Check (PSQ.1 two-identifier verification)
  const [idBand, setIdBand]             = useState({
    bandAttached: false, nameVerified: false, uhidVerified: false,
    dobVerified: false, verifiedBy: "",
  });
  // N2 · Independent nursing allergy capture (cross-check with doctor)
  const [nurseAllergyList, setNurseAllergyList] = useState([]); // same shape as allergyList
  const [nurseNoKnownAllergies, setNurseNoKnownAllergies] = useState(false);
  // N3 · Brief PMH + home medications (independent reconciliation)
  const [nurseBriefPmh, setNurseBriefPmh] = useState("");
  const [homeMeds, setHomeMeds]         = useState([]); // [{drug, dose, frequency, lastTaken}]
  // N4 · Anthropometry
  const [anthropo, setAnthropo]         = useState({ heightCm: "", weightKg: "", bmi: "" });
  // N5 · Psychosocial assessment
  const [psychosocial, setPsychosocial] = useState({
    emotionalState: "Calm",   // Calm | Anxious | Depressed | Agitated | Withdrawn
    moodAffect: "",
    languagePreferred: "Hindi",
    familySupport: "Adequate",  // Adequate | Limited | Absent
    notes: "",
  });
  // N6 · Functional / ADL (Barthel Index — 10 items, 0-100 scale)
  const [barthel, setBarthel]           = useState({
    feeding: 10, bathing: 5, grooming: 5, dressing: 10, bowels: 10,
    bladder: 10, toilet: 10, transfer: 15, mobility: 15, stairs: 10,
  });
  // N7 · Body chart / wound diagram (freeform per region for now)
  const [bodyChart, setBodyChart]       = useState({
    headNeck: "", chestBack: "", abdomenGroin: "", upperLimbs: "",
    lowerLimbs: "", existingWounds: "", existingBruises: "",
  });
  // N8 · Discharge planning needs (initiated Day 1 per AAC.4)
  const [dischargePlan, setDischargePlan] = useState({
    homeSupport: "",       // Lives with family / alone / institution
    primaryCaregiver: "",
    equipmentNeeded: [],   // checkboxes: walker / wheelchair / oxygen / commode / hospital-bed
    transportNeed: "",
    anticipatedBarriers: "",
  });
  // N9 · Education needs assessment (AAC.6 + PRE.5)
  const [educationNeeds, setEducationNeeds] = useState({
    canRead: true, canWrite: true,
    preferredLanguage: "Hindi",
    learningStyle: "Verbal",     // Verbal | Written | Demonstration | Mixed
    barriersToLearning: "",
    targetAudience: "Self",      // Self | Spouse | Parent | Adult-child | LAR
  });
  // N10 · Special precautions (links to existing Restraint/Isolation registers)
  const [precautions, setPrecautions]   = useState({
    isolation: { required: false, type: "" }, // Contact | Droplet | Airborne | Protective
    restraints: { required: false, type: "", reason: "" },
    suicide: false, fallPrecaution: false, aspiration: false, bleed: false,
    seizure: false, mri: false, latex: false,
  });

  /* ══ R7fd · DOCTOR P1 NABH FIELDS (D10-D14) ════════════════════ */
  // D10 · Anthropometry (doctor's own — even if nurse captured, doctor
  // confirms for drug-dosing safety, esp. cachectic / edematous cases)
  const [docAnthropo, setDocAnthropo]   = useState({
    heightCm: "", weightKg: "", bmi: "", idealBodyWeightKg: "",
  });
  // D11 · Local examination (surgical patients / focused exam)
  const [localExam, setLocalExam]       = useState("");
  // D12 · Cross-consultation / Referral plan
  const [referrals, setReferrals]       = useState([]); // [{specialty, reason, urgency, status}]
  // D13 · Prognosis discussion (NABH PRE.4)
  const [prognosis, setPrognosis]       = useState({
    discussedWith: "",  // name + relation
    languageUsed: "Hindi",
    summary: "",
    questionsAddressed: "",
  });
  // D14 · Consent linkage — flag which consents must be obtained
  const [consentNeeded, setConsentNeeded] = useState({
    surgical: false, anesthesia: false, bloodTransfusion: false,
    hivTesting: false, photography: false, research: false,
    dnr: false, lama: false,
  });

  /* ══ R7fd · NURSE P1 NABH FIELDS (N11-N17) ═════════════════════ */
  // N11 · Cognitive / Communication assessment
  const [cognitive, setCognitive]       = useState({
    orientationPerson: true, orientationPlace: true, orientationTime: true,
    visionDeficit: false, hearingDeficit: false, speechDeficit: false,
    aidsUsed: "",   // glasses / hearing aid / dentures
    gcs: "",        // optional Glasgow score
    notes: "",
  });
  // N12 · Cultural / Spiritual preferences
  const [cultural, setCultural]         = useState({
    religion: "",
    dietaryRestrictions: "", // vegetarian / non-veg / halal / jain / kosher / other
    spiritualNeeds: "",
    customs: "",            // specific care preferences
  });
  // N13 · Bowel / Bladder pattern
  const [elimination, setElimination]   = useState({
    bowelContinence: "Continent", // Continent | Occasional | Incontinent | Stoma
    bowelLastBM: "",
    bowelFrequency: "",
    bladderContinence: "Continent",
    bladderCatheterised: false,
    bladderOutput24h: "",
    notes: "",
  });
  // N14 · Sleep pattern
  const [sleep, setSleep]               = useState({
    hoursPerNight: "",
    quality: "Good",  // Good | Disturbed | Poor
    sleepAids: "",
    snoring: false,
    apneaDx: false,
  });
  // N15 · Valuables / Belongings noted at admission
  const [valuables, setValuables]       = useState({
    status: "Sent home with family", // 'Sent home with family' | 'Locker' | 'Patient retains' | 'Nil declared'
    items: "",
    handedTo: "",
    receiptIssued: false,
  });
  // N16 · Family / Primary Caregiver identification
  const [caregiver, setCaregiver]       = useState({
    primaryName: "", primaryRelation: "", primaryContact: "",
    escalationName: "", escalationRelation: "", escalationContact: "",
    lives_with_patient: true,
  });
  // N17 · High-risk patient flag (drives observation frequency + escalation)
  const [highRisk, setHighRisk]         = useState({
    pediatric: false, geriatric: false, pregnant: false,
    immunocompromised: false, mentalHealth: false,
    bariatric: false, polyTrauma: false, severeMalnutrition: false,
    notes: "",
  });

  /* ══ R7fg · DOCTOR P2 NABH FIELDS (D15-D18) ════════════════════ */
  // D15 · Menstrual / Obstetric history (women of childbearing age)
  const [obGyn, setObGyn]               = useState({
    isApplicable: false,  // tick if female of childbearing age
    lmp: "", cycleRegular: true, cycleDays: "",
    gravida: "", para: "", abortions: "", livingChildren: "",
    contraception: "",    // type
    lastPregnancyOutcome: "",
    pregnancyTestDone: false, pregnancyTestResult: "",
    notes: "",
  });
  // D16 · Immunisation status (esp paediatric, immunocompromised, pre-op)
  const [immunisation, setImmunisation] = useState({
    upToDateForAge: true,
    tetanus: { vaccinated: false, lastDate: "" },
    hepB:    { vaccinated: false, lastDate: "" },
    covid:   { vaccinated: false, lastDate: "", doses: "" },
    influenza:{ vaccinated: false, lastDate: "" },
    pneumococcal: { vaccinated: false, lastDate: "" },
    other: "",
  });
  // D17 · Functional / Disability — ECOG performance status
  const [ecog, setEcog]                 = useState({
    score: "",  // 0–4 or "5" for dead (not used here)
    disabilities: "", // free-text: visual / hearing / cognitive / motor
    aidsRequired: "", // walker / wheelchair / NIV / oxygen
  });
  // D18 · Spiritual / existential needs (doctor's reflection — beyond
  // nurse's N12 cultural-spiritual capture)
  const [spiritual, setSpiritual]       = useState({
    distressNoted: false,
    concerns: "",
    chaplainReferralRequested: false,
  });

  /* ══ R7fg · NURSE P2 NABH FIELDS (N18-N21) ═════════════════════ */
  // N18 · Mobility / Gait assessment
  // R7fi-FIX: renamed from mobility to mobilityGait to avoid collision
  // with the existing nurse-side `mobility` (simple string for admission
  // consciousness/mobility level declared on line ~385).
  const [mobilityGait, setMobilityGait] = useState({
    independent: true,
    usesAid: "", // walker / cane / wheelchair / crutches
    gaitNormal: true,
    fallRisk: false,
    notes: "",
  });
  // N19 · Pre-anaesthesia basics (for elective surgery — quick screen)
  const [preAnaesthesia, setPreAnaesthesia] = useState({
    plannedSurgery: false,
    npoSince: "",
    looseTooth: false, crowns: false, dentures: false,
    difficulIntubationHistory: false,
    anaesthesiaHistory: "",  // GA / SA / RA previously
    pacScheduled: false, pacDate: "",
  });
  // N20 · NRS-2002 simplification — 4 quick screening questions
  // (full NRS-2002 stays in the existing nutri section; this is the
  //  fast triage that triggers dietitian referral if positive ≥ 1)
  const [nrsQuick, setNrsQuick]         = useState({
    bmiUnder20: false,
    weightLossLast3Months: false,
    reducedIntakeLastWeek: false,
    severelyIll: false,
    dietitianReferralTriggered: false,
  });
  // N21 · PROM / PREM trigger (Patient-reported outcome / experience
  //   surveys — flag at admission, dispatched at discharge)
  const [promPrem, setPromPrem]         = useState({
    promPlanned: false, promSurvey: "",  // EQ-5D / SF-36 / PROMIS
    premPlanned: true,  premSurvey: "Hospital experience (NABH PSQ)",
    notes: "",
  });

  /* ── Auto-save draft ── */
  const draftKey = patient?._id ? `sphere_draft_ipd_initial_${patient._id}` : null;
  const { savedAt, hasDraft, clearDraft } = useAutoSave(
    draftKey,
    { admitDate, admitTime, ipdNo, nurseName, ward, bedNo, modeOfAdmit, consciousnessLevel, mobility, allergy, chiefComplaint, vitals, painPresent, painScore, painLocation, painCharacter, devices, skinIntact, skinNotes, morse, braden, nutri, vte, nursingProblems, nursingGoals, nursingNotes, doctorName, regNo, hopi, psh, famHx, socHx, pshStruct, famHxStruct, socHxStruct, docAllergy, genExam, cvs, rs, abdomen, cns, provDx, finalDx, icd10, investigations, rxRows, treatmentPlan, followupNotes, dietAdvice, activityAdvice,
      // R7hr-72 — structured panels added during R7hr-58..69; without
      // them in this dep object the autosave hook would never re-fire
      // when the doctor edited Investigations / Prescription / Infusion
      // / Clinical Examination / Diagnosis-extras, so the draft silently
      // froze on the field that was open when autosave last ran.
      meds, invests, infusions, clinExam, icd10Description, patientStatus,
      // R7fb · doctor P0 fields
      docCC, ccDuration, allergyList, noKnownAllergies, medRecon, workingDx, differentialDx, comorbid, codeStatus, codeStatusDiscussedWith, codeStatusLimitations, elosDays, goalOfCare, docRiskAck, ros,
      // R7fc · nurse P0 fields
      idBand, nurseAllergyList, nurseNoKnownAllergies, nurseBriefPmh, homeMeds, anthropo, psychosocial, barthel, bodyChart, dischargePlan, educationNeeds, precautions,
      // R7fd · doctor P1 + nurse P1
      docAnthropo, localExam, referrals, prognosis, consentNeeded,
      cognitive, cultural, elimination, sleep, valuables, caregiver, highRisk,
      // R7fg · P2 fields
      obGyn, immunisation, ecog, spiritual,
      mobilityGait, preAnaesthesia, nrsQuick, promPrem },
    2000
  );
  const { signature, showSetup, setShowSetup, saveSignature } = useDigitalSignature();

  useEffect(() => {
    if (initUhid) loadPatient(initUhid);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ══ R7fe · Cross-form auto-flows — kill the duplications ══════
     Doctor and nurse share the same component, so we can wire fields
     that one party owns to flow into the other's display. Each effect
     only fires when the target field is still empty — i.e. it's a one-
     way pre-fill, not a clobber. The doctor can always override.
     ───────────────────────────────────────────────────────────── */

  // A · Chief Complaint — nurse's `chiefComplaint` is the patient's
  // reported reason at intake. Doctor's structured CC defaults to it.
  useEffect(() => {
    if (!docCC && chiefComplaint?.trim()) setDocCC(chiefComplaint.trim());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chiefComplaint]);

  // B · PMH — bidirectional best-effort sync. Whichever party fills
  // first becomes the seed for the other. Doctor's full > nurse's brief.
  useEffect(() => {
    // R7hr-70 — pmh removed from doctor view (replaced by Co-morbidities
    // checklist). Nurse's brief PMH field stays — it's the nurse-side
    // context, no longer fans out to a doctor PMH textarea.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nurseBriefPmh]);

  // R7hr-70 — keep the legacy psh / famHx / socHx strings in sync with
  // the structured state so any downstream consumer that reads the
  // string fields (discharge-summary print, narrative theme, etc.)
  // gets the canonical joined-summary text without per-source plumbing.
  useEffect(() => { setPsh(pshSummary(pshStruct)); /* eslint-disable-next-line */ }, [pshStruct]);
  useEffect(() => { setFamHx(famHxSummary(famHxStruct)); /* eslint-disable-next-line */ }, [famHxStruct]);
  useEffect(() => { setSocHx(socHxSummary(socHxStruct)); /* eslint-disable-next-line */ }, [socHxStruct]);

  // R7hr-96 — High-Alert Medication keyword sniff (mirrors backend
  // DoctorOrderModel HAM_KEYWORDS so the row's HAM chip lights up the
  // moment the doctor types the drug name, without waiting for save).
  // The doctor can still flip the checkbox manually for an edge-case
  // brand name we didn't anticipate.
  const HAM_KEYWORDS_FE = [
    "insulin","heparin","enoxaparin","fondaparinux","warfarin","acenocoumarol",
    "digoxin","amiodarone","lidocaine","lignocaine","morphine","fentanyl",
    "pethidine","tramadol","midazolam","propofol","ketamine","potassium",
    "kcl","sodium bicarbonate","magnesium sulfate","calcium chloride",
    "calcium gluconate","adrenaline","epinephrine","noradrenaline",
    "norepinephrine","dobutamine","dopamine","vasopressin","nitroprusside",
    "alteplase","tenecteplase","streptokinase","methotrexate",
    "vincristine","cisplatin","carboplatin","doxorubicin","cyclophosphamide",
    "vancomycin iv","gentamicin iv","amikacin iv",
  ];
  const isHAMByName = (name = "") => HAM_KEYWORDS_FE.some(k => (name || "").toLowerCase().includes(k));

  // C · Medication Reconciliation — nurse owns the home-meds list (she
  // sees the drugs the patient brought). Doctor's table inherits each
  // row + only adds the Continue/Hold decision (R7hr-96: dropped Modify/
  // Discontinue because they don't map cleanly to MAR — Hold covers
  // "don't give now"; Continue auto-fans-out to MAR). Doctor can still
  // add rows nurse didn't (e.g. insulin the patient didn't mention) —
  // those stay marked `_doctorOnly: true`.
  useEffect(() => {
    setMedRecon(prev => {
      // Index existing doctor rows so we preserve their decisions.
      const byDrug = new Map(
        prev.map(r => [(r.drug || "").toLowerCase().trim(), r]),
      );
      const nursingRows = (homeMeds || [])
        .filter(hm => (hm.drug || "").trim())
        .map(hm => {
          const key = hm.drug.toLowerCase().trim();
          const existing = byDrug.get(key) || {};
          return {
            drug: hm.drug, dose: hm.dose, frequency: hm.frequency, lastTaken: hm.lastTaken,
            // R7hr-96 — only Continue / Hold are valid; collapse any
            // legacy Modify/Discontinue values to Hold so the dropdown
            // never renders a missing option.
            continueOnAdmit: ["Continue","Hold"].includes(existing.continueOnAdmit) ? existing.continueOnAdmit : "Continue",
            isHAM: typeof existing.isHAM === "boolean" ? existing.isHAM : isHAMByName(hm.drug),
            _fromNursing: true,
          };
        });
      const nursingKeys = new Set(nursingRows.map(r => r.drug.toLowerCase().trim()));
      const doctorOnly = prev.filter(r => {
        const k = (r.drug || "").toLowerCase().trim();
        return k && !nursingKeys.has(k) && !r._fromNursing;
      }).map(r => ({ ...r, _doctorOnly: true }));
      return [...nursingRows, ...doctorOnly];
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [homeMeds]);

  // R7hr-88 — Anthropometry auto-fills from "Vitals on Admission".
  // Nursing IPD Initial Assessment captures Weight (kg) and Height (cm)
  // in the Vitals on Admission section; this effect pushes those into
  // the N4 Anthropometry block (heightCm / weightKg / BMI) so the nurse
  // doesn't have to re-enter the same numbers. Skips overwriting an
  // existing manual Anthropometry entry — only fills when the
  // Anthropometry field is still blank, so a deliberate post-admission
  // measurement re-take isn't clobbered.
  useEffect(() => {
    const v_h = String(vitals.height || "").trim();
    const v_w = String(vitals.weight || "").trim();
    if (!v_h && !v_w) return;
    setAnthropo(prev => {
      const next = { ...prev };
      if (v_h && !prev.heightCm) next.heightCm = v_h;
      if (v_w && !prev.weightKg) next.weightKg = v_w;
      const h = Number(next.heightCm) / 100;
      const w = Number(next.weightKg);
      next.bmi = (h && w) ? (w / (h * h)).toFixed(1) : prev.bmi;
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vitals.height, vitals.weight]);

  // D · Anthropometry — nurse measures Ht/Wt with calibrated scale at
  // admission. Doctor's section mirrors nurse's values (read-only) and
  // only IBW (Devine formula) stays doctor-editable.
  useEffect(() => {
    if (anthropo.heightCm || anthropo.weightKg || anthropo.bmi) {
      setDocAnthropo(prev => ({
        ...prev,
        heightCm: anthropo.heightCm || prev.heightCm,
        weightKg: anthropo.weightKg || prev.weightKg,
        bmi:      anthropo.bmi      || prev.bmi,
      }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anthropo.heightCm, anthropo.weightKg, anthropo.bmi]);

  // E · Family Caregiver — doctor's prognosis "Discussed with" pre-fills
  // from nurse's N16 primary caregiver. Doctor can override (sometimes
  // the prognosis discussion happens with a different relative).
  //
  // R7fe-VERIFY-FIX: the original guard `!prognosis.discussedWith` blocked
  // re-formatting when name was typed before relation (initial fire set
  // "Sunita Sharma"; later relation change skipped). Detect the auto-
  // generated shapes — empty, name-alone, or "Name (Relation)" — and
  // re-format when nursing's caregiver fields change. A user-edited
  // value that doesn't match those shapes is preserved verbatim.
  useEffect(() => {
    const name = caregiver.primaryName?.trim();
    const rel  = caregiver.primaryRelation?.trim();
    if (!name) return;
    const formatted = rel ? `${name} (${rel})` : name;
    setPrognosis(p => {
      const cur = (p.discussedWith || "").trim();
      const isAutoShape = !cur || cur === name || /^.+\s\(.+\)$/.test(cur);
      if (!isAutoShape) return p;            // user customised — leave alone
      if (cur === formatted) return p;       // no change needed
      return { ...p, discussedWith: formatted };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caregiver.primaryName, caregiver.primaryRelation]);

  /* ══ R7ff · Cross-validation alerts (NABH PSQ.4) ═════════════════
     Live diff between doctor's and nurse's independently-captured
     fields. The point of capturing allergies / weight / caregiver
     twice is so a discrepancy SURFACES — silent agreement is fine,
     silent disagreement is a safety event. Banner stays visible at
     the top of the form until both sides reconcile or admin overrides.
     ───────────────────────────────────────────────────────────── */
  const crossCheckAlerts = useMemo(() => {
    const alerts = [];

    // 1. Allergy list mismatch — both sides should converge.
    const norm = (s) => (s || "").toString().toLowerCase().trim();
    const nurseSet  = new Set((nurseAllergyList || []).map(a => norm(a.agent)).filter(Boolean));
    const doctorSet = new Set((allergyList || []).map(a => norm(a.agent)).filter(Boolean));
    const onlyNurse  = [...nurseSet].filter(a => !doctorSet.has(a));
    const onlyDoctor = [...doctorSet].filter(a => !nurseSet.has(a));
    if (onlyNurse.length) alerts.push({
      severity: "high", category: "Allergy",
      message: `Nurse logged allergen(s) not on doctor's list: ${onlyNurse.join(", ")}`,
    });
    if (onlyDoctor.length) alerts.push({
      severity: "high", category: "Allergy",
      message: `Doctor logged allergen(s) not on nurse's list: ${onlyDoctor.join(", ")}`,
    });
    // NKDA flag mismatch (one side says "no known", other has entries)
    if (noKnownAllergies && nurseAllergyList?.length) alerts.push({
      severity: "high", category: "Allergy",
      message: `Doctor marked NKDA but nurse listed ${nurseAllergyList.length} allergen(s)`,
    });
    if (nurseNoKnownAllergies && allergyList?.length) alerts.push({
      severity: "high", category: "Allergy",
      message: `Nurse marked NKDA but doctor listed ${allergyList.length} allergen(s)`,
    });

    // 2. Anthropometry mismatch — both sides may type independently
    //    if doctor opens form before nurse's measurement lands. Flag
    //    differences > 2 cm / 2 kg (within calibration tolerance).
    const nh = Number(anthropo?.heightCm), dh = Number(docAnthropo?.heightCm);
    if (nh && dh && Math.abs(nh - dh) > 2) alerts.push({
      severity: "medium", category: "Anthropometry",
      message: `Height mismatch: nurse ${nh} cm vs doctor ${dh} cm (Δ ${Math.abs(nh-dh).toFixed(1)} cm)`,
    });
    const nw = Number(anthropo?.weightKg), dw = Number(docAnthropo?.weightKg);
    if (nw && dw && Math.abs(nw - dw) > 2) alerts.push({
      severity: "medium", category: "Anthropometry",
      message: `Weight mismatch: nurse ${nw} kg vs doctor ${dw} kg (Δ ${Math.abs(nw-dw).toFixed(1)} kg)`,
    });

    // 3. Caregiver vs prognosis "discussed with" — flag only when both
    //    are populated and the discussed-with text doesn't contain the
    //    primary caregiver name (case-insensitive substring).
    const nName = caregiver?.primaryName?.trim();
    const dwTxt = (prognosis?.discussedWith || "").trim();
    if (nName && dwTxt && !norm(dwTxt).includes(norm(nName))) alerts.push({
      severity: "low", category: "Family",
      message: `Doctor's "Discussed with" = "${dwTxt}" doesn't match nurse's primary caregiver "${nName}"`,
    });

    return alerts;
  }, [allergyList, noKnownAllergies, nurseAllergyList, nurseNoKnownAllergies, anthropo, docAnthropo, caregiver, prognosis]);

  const loadPatient = async (id) => {
    if (!id?.trim()) return;
    setLoadingPt(true); setPatient(null); setAdmission(null);
    try {
      const [ptRes, admRes] = await Promise.all([
        axios.get(`${API_ENDPOINTS.PATIENTS}/uhid/${id.trim().toUpperCase()}`),
        axios.get(`${API_ENDPOINTS.BASE}/admissions?uhid=${id.trim().toUpperCase()}`).catch(() => ({ data: [] })),
      ]);
      const pt = ptRes.data?.data || ptRes.data;
      if (!pt) { toast.error("Patient not found"); return; }
      setPatient(pt);
      setUhid(pt.UHID || id);
      // R7fn — guard against the typed allergies virtual (R7fl) being
      // splatted into the legacy free-text fields. `pt.allergies` is now
      // an array of {allergen, severity, type}; only the structured
      // allergyList[] block consumes it. Free-text legacy fields stay
      // either empty or are restored from the prior note's noteDetails.
      if (typeof pt.allergies === "string" && pt.allergies.trim()) {
        setAllergy(pt.allergies);
        setDocAllergy(pt.allergies);
      } else if (typeof pt.knownAllergies === "string" && pt.knownAllergies.trim() && pt.knownAllergies !== "Nill") {
        setAllergy(pt.knownAllergies);
        setDocAllergy(pt.knownAllergies);
      }
      // Restore auto-save draft if available
      const dKey = `sphere_draft_ipd_initial_${pt._id}`;
      const raw = localStorage.getItem(dKey);
      if (raw) {
        try {
          const { data: d } = JSON.parse(raw);
          if (d) {
            if (d.admitDate)          setAdmitDate(d.admitDate);
            if (d.admitTime)          setAdmitTime(d.admitTime);
            if (d.ipdNo)              setIpdNo(d.ipdNo);
            if (d.nurseName)          setNurseName(d.nurseName);
            if (d.ward)               setWard(d.ward);
            if (d.bedNo)              setBedNo(d.bedNo);
            if (d.modeOfAdmit)        setModeOfAdmit(d.modeOfAdmit);
            if (d.consciousnessLevel) setConsciousnessLevel(d.consciousnessLevel);
            if (d.mobility)           setMobility(d.mobility);
            if (d.chiefComplaint)     setChiefComplaint(d.chiefComplaint);
            if (d.vitals)             setVitals(d.vitals);
            if (d.painPresent !== undefined) setPainPresent(d.painPresent);
            if (d.painScore)          setPainScore(d.painScore);
            if (d.painLocation)       setPainLocation(d.painLocation);
            if (d.painCharacter)      setPainCharacter(d.painCharacter);
            if (d.devices)            setDevices(d.devices);
            if (d.skinIntact !== undefined) setSkinIntact(d.skinIntact);
            if (d.skinNotes)          setSkinNotes(d.skinNotes);
            if (d.morse)              setMorse(d.morse);
            if (d.braden)             setBraden(d.braden);
            if (d.nutri)              setNutri(d.nutri);
            if (d.vte)                setVte(d.vte);
            if (d.nursingProblems)    setNursingProblems(d.nursingProblems);
            if (d.nursingGoals)       setNursingGoals(d.nursingGoals);
            if (d.nursingNotes)       setNursingNotes(d.nursingNotes);
            if (d.hopi)               setHopi(d.hopi);
            // R7hr-70 — pmh dropped from UI; if older draft has it, fold it
            // into pshStruct.other as a fallback so doctor doesn't lose data.
            if (d.psh)                setPsh(d.psh);
            if (d.famHx)              setFamHx(d.famHx);
            if (d.socHx)              setSocHx(d.socHx);
            if (d.pshStruct)          setPshStruct(s => ({ ...s, ...d.pshStruct }));
            else if (d.psh)           setPshStruct(s => ({ ...s, other: d.psh }));
            if (d.famHxStruct)        setFamHxStruct(s => ({ ...s, ...d.famHxStruct }));
            else if (d.famHx)         setFamHxStruct(s => ({ ...s, other: d.famHx }));
            if (d.socHxStruct)        setSocHxStruct(s => ({ ...s, ...d.socHxStruct }));
            else if (d.socHx)         setSocHxStruct(s => ({ ...s, other: d.socHx }));
            if (d.genExam)            setGenExam(d.genExam);
            if (d.cvs)                setCvs(d.cvs);
            if (d.rs)                 setRs(d.rs);
            if (d.abdomen)            setAbdomen(d.abdomen);
            if (d.cns)                setCns(d.cns);
            if (d.provDx)             setProvDx(d.provDx);
            if (d.finalDx)            setFinalDx(d.finalDx);
            if (d.icd10)              setIcd10(d.icd10);
            // R7hr-65 — new fields, may be missing on older drafts
            if (d.icd10Description)   setIcd10Description(d.icd10Description);
            if (d.patientStatus)      setPatientStatus(d.patientStatus);
            if (d.investigations)     setInvestigations(d.investigations);
            if (d.rxRows)             setRxRows(d.rxRows);
            if (Array.isArray(d.meds))      setMeds(d.meds);          // R7hr-59
            if (Array.isArray(d.invests))   setInvests(d.invests);    // R7hr-59
            if (Array.isArray(d.infusions)) setInfusions(d.infusions);// R7hr-59
            // R7hr-72 — Clinical Examination structured state was missing
            // from the localStorage restore path. Without this the doctor
            // would lose all general + systemic exam findings on refresh.
            if (d.clinExam) {
              setClinExam(c => ({
                ...c,
                ...d.clinExam,
                genExam: { ...c.genExam, ...(d.clinExam.genExam || {}) },
                sysExam: {
                  cvs: { ...c.sysExam.cvs, ...(d.clinExam.sysExam?.cvs || {}) },
                  rs:  { ...c.sysExam.rs,  ...(d.clinExam.sysExam?.rs  || {}) },
                  cns: { ...c.sysExam.cns, ...(d.clinExam.sysExam?.cns || {}) },
                  pa:  { ...c.sysExam.pa,  ...(d.clinExam.sysExam?.pa  || {}) },
                },
              }));
            }
            if (d.treatmentPlan)      setTreatmentPlan(d.treatmentPlan);
            if (d.followupNotes)      setFollowupNotes(d.followupNotes);
            if (d.dietAdvice)         setDietAdvice(d.dietAdvice);
            if (d.activityAdvice)     setActivityAdvice(d.activityAdvice);
            toast.info("Draft restored", { autoClose: 2000 });
          }
        } catch { /* ignore */ }
      }
      // Find active admission
      const admList = Array.isArray(admRes.data?.admissions) ? admRes.data.admissions
                    : Array.isArray(admRes.data?.data) ? admRes.data.data
                    : Array.isArray(admRes.data) ? admRes.data : [];
      const adm = admList.find(a => a.status === "Active" || a.status === "Admitted") || admList[0] || null;
      setAdmission(adm);
      if (adm?.admissionNumber) setIpdNo(adm.admissionNumber);
      if (adm?.department) setWard(adm.department);
      if (adm?.bedNumber) setBedNo(adm.bedNumber);

      // R7fn — Restore from the LATEST signed/draft IPD_INITIAL DoctorNote
      // for this admission. Without this, when a doctor opens the page
      // after a nurse has signed, every nursing field is blank — which
      // means the R7fe cross-form auto-flows (nurse→doctor) can't fire
      // because their source state is empty. By rehydrating the nursing
      // sub-block here we let the existing useEffects do their job:
      // docCC, pmh, medRecon, docAnthropo, prognosis.discussedWith all
      // auto-populate from the nurse's data the moment the doctor opens
      // the form.
      if (adm?.admissionNumber) {
        try {
          const noteRes = await axios.get(
            `${API_ENDPOINTS.DOCTOR_NOTES}/ipd/${encodeURIComponent(adm.admissionNumber)}`,
          );
          const noteList = Array.isArray(noteRes.data) ? noteRes.data
                         : Array.isArray(noteRes.data?.data) ? noteRes.data.data
                         : [];
          const initials = noteList
            .filter(n => n?.noteType === "initial" || n?.visitType === "IPD_INITIAL")
            .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
          // R7fn-v2: split the existing notes by section. Nurse-section
          // notes feed cross-flow auto-populate; doctor-section notes
          // are the doctor's write target (PUT vs POST).
          //
          // CRITICAL: only reuse an id as the write target when the row
          // is still a DRAFT. A note that was already signed/amended
          // can't be re-signed — PATCH /sign returns 400. In that case
          // we leave the section's noteId null so handleSave POSTs a
          // FRESH draft row that we can sign cleanly. We still hydrate
          // the form from it (read-only restore).
          const nurseSec  = initials.find(n => n.section === "nursing" || (n.noteDetails?.nursing && !n.noteDetails?.doctor?.hopi));
          const doctorSec = initials.find(n => n.section === "doctor"  || (n.noteDetails?.doctor?.hopi));
          const isReusable = (n) => n && n.status !== "signed" && n.status !== "amended";
          if (isReusable(nurseSec))  setNurseSectionNoteId(nurseSec._id);
          if (isReusable(doctorSec)) setDoctorNoteId(doctorSec._id);
          // Hydrate from whichever has the richest combined data.
          const existing = doctorSec || nurseSec;

          if (existing?._id) {
            const nur = existing.noteDetails?.nursing || {};
            const nNabh = existing.noteDetails?.nursingNabh || {};
            const doc = existing.noteDetails?.doctor || {};
            const dNabh = doc.nabh || {};

            // ── Nursing-section restore (needed for R7fe auto-flows) ──
            if (nur.admitDate)          setAdmitDate(nur.admitDate);
            if (nur.admitTime)          setAdmitTime(nur.admitTime);
            if (nur.nurseName)          setNurseName(nur.nurseName);
            if (nur.ward)               setWard(nur.ward);
            if (nur.bedNo)              setBedNo(nur.bedNo);
            if (nur.modeOfAdmit)        setModeOfAdmit(nur.modeOfAdmit);
            if (nur.consciousnessLevel) setConsciousnessLevel(nur.consciousnessLevel);
            if (typeof nur.mobility === "string") setMobility(nur.mobility);
            if (nur.allergy)            setAllergy(nur.allergy);
            if (nur.chiefComplaint)     setChiefComplaint(nur.chiefComplaint);
            if (nur.vitals)             setVitals(v => ({ ...v, ...nur.vitals }));
            if (nur.painPresent !== undefined) setPainPresent(!!nur.painPresent);
            if (nur.painScore !== undefined)   setPainScore(String(nur.painScore));
            if (nur.painLocation)       setPainLocation(nur.painLocation);
            if (nur.painCharacter)      setPainCharacter(nur.painCharacter);
            if (nur.devices)            setDevices(d => ({ ...d, ...nur.devices }));
            if (nur.skinIntact !== undefined) setSkinIntact(!!nur.skinIntact);
            if (nur.skinNotes)          setSkinNotes(nur.skinNotes);
            if (nur.morse?.scores)      setMorse(nur.morse.scores);
            if (nur.braden?.scores)     setBraden(nur.braden.scores);
            if (nur.nutri?.scores)      setNutri(nur.nutri.scores);
            if (nur.vte?.scores)        setVte(nur.vte.scores);
            if (nur.nursingProblems)    setNursingProblems(nur.nursingProblems);
            if (nur.nursingGoals)       setNursingGoals(nur.nursingGoals);
            if (nur.nursingNotes)       setNursingNotes(nur.nursingNotes);

            // ── Nursing NABH P0/P1/P2 (drives 5 cross-form auto-flows) ──
            if (nNabh.identification)   setIdBand(b => ({ ...b, ...nNabh.identification }));
            if (Array.isArray(nNabh.allergies?.list)) setNurseAllergyList(nNabh.allergies.list);
            if (nNabh.allergies?.noKnown !== undefined) setNurseNoKnownAllergies(!!nNabh.allergies.noKnown);
            if (nNabh.briefPmh)         setNurseBriefPmh(nNabh.briefPmh);
            if (Array.isArray(nNabh.homeMedications)) setHomeMeds(nNabh.homeMedications);
            if (nNabh.anthropometry)    setAnthropo(a => ({ ...a, ...nNabh.anthropometry }));
            if (nNabh.psychosocial)     setPsychosocial(p => ({ ...p, ...nNabh.psychosocial }));
            if (nNabh.adlBarthel)       setBarthel(b => ({ ...b, ...nNabh.adlBarthel }));
            if (nNabh.bodyChart)        setBodyChart(c => ({ ...c, ...nNabh.bodyChart }));
            if (nNabh.dischargePlanning) setDischargePlan(d => ({ ...d, ...nNabh.dischargePlanning }));
            if (nNabh.educationNeeds)   setEducationNeeds(e => ({ ...e, ...nNabh.educationNeeds }));
            if (nNabh.specialPrecautions) setPrecautions(p => ({ ...p, ...nNabh.specialPrecautions }));
            if (nNabh.cognitiveCommunication) setCognitive(c => ({ ...c, ...nNabh.cognitiveCommunication }));
            if (nNabh.culturalSpiritual) setCultural(c => ({ ...c, ...nNabh.culturalSpiritual }));
            if (nNabh.bowelBladder)     setElimination(e => ({ ...e, ...nNabh.bowelBladder }));
            if (nNabh.sleepPattern)     setSleep(s => ({ ...s, ...nNabh.sleepPattern }));
            if (nNabh.valuablesBelongings) setValuables(v => ({ ...v, ...nNabh.valuablesBelongings }));
            if (nNabh.familyCaregiver)  setCaregiver(c => ({ ...c, ...nNabh.familyCaregiver }));
            if (nNabh.highRiskFlags)    setHighRisk(h => ({ ...h, ...nNabh.highRiskFlags }));
            if (nNabh.mobilityGait)     setMobilityGait(m => ({ ...m, ...nNabh.mobilityGait }));
            if (nNabh.preAnaesthesia)   setPreAnaesthesia(p => ({ ...p, ...nNabh.preAnaesthesia }));
            if (nNabh.nutritionalScreeningQuick) setNrsQuick(n => ({ ...n, ...nNabh.nutritionalScreeningQuick }));
            if (nNabh.promPremTriggers) setPromPrem(p => ({ ...p, ...nNabh.promPremTriggers }));

            // ── Doctor-section restore (preserves prior doctor draft) ──
            if (doc.doctorName)         setDoctorName(doc.doctorName);
            if (doc.regNo)              setRegNo(doc.regNo);
            if (doc.hopi)               setHopi(doc.hopi);
            // R7hr-70 — pmh dropped; structured fields take precedence
            if (doc.psh)                setPsh(doc.psh);
            if (doc.famHx)              setFamHx(doc.famHx);
            if (doc.socHx)              setSocHx(doc.socHx);
            if (doc.pshStruct)          setPshStruct(s => ({ ...s, ...doc.pshStruct }));
            else if (doc.psh)           setPshStruct(s => ({ ...s, other: doc.psh }));
            if (doc.famHxStruct)        setFamHxStruct(s => ({ ...s, ...doc.famHxStruct }));
            else if (doc.famHx)         setFamHxStruct(s => ({ ...s, other: doc.famHx }));
            if (doc.socHxStruct)        setSocHxStruct(s => ({ ...s, ...doc.socHxStruct }));
            else if (doc.socHx)         setSocHxStruct(s => ({ ...s, other: doc.socHx }));
            if (doc.docAllergy)         setDocAllergy(doc.docAllergy);
            if (doc.genExam)            setGenExam(doc.genExam);
            if (doc.cvs)                setCvs(doc.cvs);
            if (doc.rs)                 setRs(doc.rs);
            if (doc.abdomen)            setAbdomen(doc.abdomen);
            if (doc.cns)                setCns(doc.cns);
            if (doc.provDx)             setProvDx(doc.provDx);
            if (doc.finalDx)            setFinalDx(doc.finalDx);
            if (doc.icd10)              setIcd10(doc.icd10);
            // R7hr-65 — saved-from-server pull (icd10Description + patientStatus)
            if (doc.icd10Description)   setIcd10Description(doc.icd10Description);
            if (doc.patientStatus)      setPatientStatus(doc.patientStatus);
            if (doc.investigations)     setInvestigations(doc.investigations);
            if (Array.isArray(doc.rxRows) && doc.rxRows.length) setRxRows(doc.rxRows);
            if (Array.isArray(doc.meds))      setMeds(doc.meds);          // R7hr-59
            if (Array.isArray(doc.invests))   setInvests(doc.invests);    // R7hr-59
            if (Array.isArray(doc.infusions)) setInfusions(doc.infusions);// R7hr-59
            if (doc.treatmentPlan)      setTreatmentPlan(doc.treatmentPlan);
            if (doc.followupNotes)      setFollowupNotes(doc.followupNotes);
            if (doc.dietAdvice)         setDietAdvice(doc.dietAdvice);
            if (doc.activityAdvice)     setActivityAdvice(doc.activityAdvice);
            if (dNabh.chiefComplaint)   setDocCC(dNabh.chiefComplaint);
            if (dNabh.ccDuration)       setCcDuration(dNabh.ccDuration);
            if (Array.isArray(dNabh.allergies?.list)) setAllergyList(dNabh.allergies.list);
            if (dNabh.allergies?.noKnown !== undefined) setNoKnownAllergies(!!dNabh.allergies.noKnown);
            if (Array.isArray(dNabh.medicationReconciliation)) {
              // R7hr-96 — collapse legacy Modify/Discontinue to Hold so the
              // 2-option dropdown never renders a missing value; backfill
              // isHAM by drug-name keyword sniff for rows saved before this.
              setMedRecon(dNabh.medicationReconciliation.map(r => ({
                ...r,
                continueOnAdmit: ["Continue","Hold"].includes(r.continueOnAdmit) ? r.continueOnAdmit : "Hold",
                isHAM: typeof r.isHAM === "boolean" ? r.isHAM : isHAMByName(r.drug),
              })));
            }
            if (dNabh.workingDx)        setWorkingDx(dNabh.workingDx);
            if (dNabh.differentialDx)   setDifferentialDx(dNabh.differentialDx);
            if (dNabh.comorbidities)    setComorbid(c => ({ ...c, ...dNabh.comorbidities }));
            if (dNabh.codeStatus?.value) setCodeStatus(dNabh.codeStatus.value);
            if (dNabh.codeStatus?.discussedWith) setCodeStatusDiscussedWith(dNabh.codeStatus.discussedWith);
            if (dNabh.codeStatus?.limitations) setCodeStatusLimitations(dNabh.codeStatus.limitations);
            if (dNabh.elosDays)         setElosDays(dNabh.elosDays);
            if (dNabh.goalOfCare)       setGoalOfCare(dNabh.goalOfCare);
            if (dNabh.riskAcknowledgement) setDocRiskAck(r => ({ ...r, ...dNabh.riskAcknowledgement }));
            if (dNabh.reviewOfSystems)  setRos(s => ({ ...s, ...dNabh.reviewOfSystems }));
            // R7hr-58 — Hydrate structured clinical examination (preferred
            // over legacy `ros` + free-text exam fields). Deep-merge each
            // nested system block so partial saves don't wipe defaults.
            if (dNabh.clinicalExamination) {
              setClinExam(c => ({
                ...c,
                ...dNabh.clinicalExamination,
                genExam: { ...c.genExam, ...(dNabh.clinicalExamination.genExam || {}) },
                sysExam: {
                  cvs: { ...c.sysExam.cvs, ...(dNabh.clinicalExamination.sysExam?.cvs || {}) },
                  rs:  { ...c.sysExam.rs,  ...(dNabh.clinicalExamination.sysExam?.rs  || {}) },
                  cns: { ...c.sysExam.cns, ...(dNabh.clinicalExamination.sysExam?.cns || {}) },
                  pa:  { ...c.sysExam.pa,  ...(dNabh.clinicalExamination.sysExam?.pa  || {}) },
                },
              }));
            }
            if (dNabh.anthropometry)    setDocAnthropo(a => ({ ...a, ...dNabh.anthropometry }));
            if (dNabh.localExamination) setLocalExam(e => ({ ...e, ...dNabh.localExamination }));
            if (dNabh.referrals)        setReferrals(r => ({ ...r, ...dNabh.referrals }));
            if (dNabh.prognosis)        setPrognosis(p => ({ ...p, ...dNabh.prognosis }));
            if (dNabh.consentRequired !== undefined) setConsentNeeded(!!dNabh.consentRequired);
            if (dNabh.obstetricGynae)   setObGyn(o => ({ ...o, ...dNabh.obstetricGynae }));
            if (dNabh.immunisationStatus) setImmunisation(i => ({ ...i, ...dNabh.immunisationStatus }));
            if (dNabh.functionalEcog)   setEcog(e => ({ ...e, ...dNabh.functionalEcog }));
            if (dNabh.spiritualNeeds)   setSpiritual(s => ({ ...s, ...dNabh.spiritualNeeds }));

            // Friendly status label — surveyors don't want to see
            // "amended" alarming the doctor. "Locked" conveys
            // signed/amended (nurse already finalised); "Draft" otherwise.
            const statusLabel = (existing.status === "signed" || existing.status === "amended")
              ? "nurse-signed"
              : (existing.status || "draft");
            toast.info(
              `Nursing Initial Assessment found (${statusLabel}). ` +
              `Nurse data ready — fill the Doctor section and Sign to add your assessment.`,
              { autoClose: 3500 },
            );

            // R7hr-72/lock — Drop into LOCKED mode if the ROLE-SPECIFIC
            // restored note is already signed/amended. Doctor view checks
            // the doctor-section note; nurse view checks the nurse-section
            // note. If only the OTHER role's note is signed (common: nurse
            // signed first, doctor still drafting) the active form stays
            // editable.
            const lockSrc = isDoctorRole ? doctorSec : nurseSec;
            if (lockSrc && (lockSrc.status === "signed" || lockSrc.status === "amended")) {
              setIaLocked(true);
              setLockedSignedByName(
                lockSrc.signedByName
                || (isDoctorRole ? (lockSrc.noteDetails?.doctor?.doctorName || doctorName)
                                 : (lockSrc.noteDetails?.nursing?.nurseName || nurseName))
                || "",
              );
              setLockedSignedAt(lockSrc.signedAt || lockSrc.updatedAt || lockSrc.createdAt || null);
              // R7hr-90 — Record the server-known existing IA id so the
              // pre-POST guard + 409 handler can recognise it (even after
              // the user dismisses LOCKED via a stale-state edge).
              if (lockSrc._id) setExistingSignedIaId(lockSrc._id);
            }
          }

          // Also resolve the NurseNote mirror id so future sign-offs PUT
          // to the same row (no duplicate timeline entries).
          try {
            const nurseRes = await axios.get(
              `${API_ENDPOINTS.NURSING_NOTES}/ipd/${encodeURIComponent(adm.admissionNumber)}`,
            );
            const nurseList = Array.isArray(nurseRes.data) ? nurseRes.data
                            : Array.isArray(nurseRes.data?.data) ? nurseRes.data.data
                            : [];
            const nurseInitial = nurseList
              .filter(n => n?.noteType === "initial")
              .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt))[0];
            if (nurseInitial?._id) setNurseNoteId(nurseInitial._id);
          } catch { /* non-fatal */ }
        } catch { /* non-fatal — page can still POST a fresh note */ }
      }
    } catch { toast.error("Patient not found"); }
    finally { setLoadingPt(false); }
  };

  /* Build payload */
  const buildPayload = (section, status = "draft") => ({
    visitType: "IPD_INITIAL",
    // R7fj-HIGH-1: noteType drives the filters in CompletePatientFile,
    // PatientPanelTabs InitialAssessmentTab, NursingNotes header etc.
    // Backend DoctorNotes schema (R7g) restricts noteType to a fixed
    // enum — "initial" is the NABH COP.1 first-contact bucket which
    // both upstream consumers filter on. Earlier draft used
    // "initialAssessment" which failed enum validation with 400.
    noteType: "initial",
    patientUHID: patient?.UHID || uhid,
    patientId: patient?._id,
    patientName: patient?.fullName || "",
    status,
    assessmentDate: new Date().toISOString(),
    section, // "nursing" | "doctor" | "both"
    // R7fj-HIGH-1: lift diagnosis + chief complaint + HPI to TOP-LEVEL
    // DoctorNote fields. The NursingNotes header (L896-924) and the
    // PatientHeaderCard banner read these top-level fields directly —
    // burying them under noteDetails.doctor.nabh.workingDx made every
    // header chip stay blank. Mirror to top-level here for downstream
    // visibility while keeping the structured nabh copy intact.
    chiefComplaint: docCC || chiefComplaint || "",
    historyOfPresentIllness: hopi || "",
    provisionalDiagnosis: provDx || "",
    workingDiagnosis: workingDx || "",
    finalDiagnosis: finalDx || "",
    icdCode: icd10 || "",
    // R7hr-65 — mirror to top-level so discharge summary / file print can
    // surface the description + status without digging through noteDetails.
    icdDescription: icd10Description || "",
    patientStatus: patientStatus || "",
    diagnosis: finalDx || workingDx || provDx || "",
    // R7fb/R7fc — DoctorNotes schema is strict; the only catch-all field is
    // `noteDetails` (Mixed). Pack the entire role-specific form data here so
    // the new NABH P0 fields persist instead of being silently dropped.
    //
    // R26 (USER RULE, 2026-06-06) — Doctor IA and Nurse IA must always be
    // SEPARATE records with role-pure noteDetails. Previously this payload
    // packed BOTH nursing + doctor blocks regardless of `section`, so a
    // doctor-section save would contaminate the DoctorNote with stale
    // nursing data (and vice versa). Now we inline the per-role blocks
    // only when the matching section is saving. The doctor's record gets
    // ONLY doctor data; the nurse's record gets ONLY nursing data.
    // Cross-flow auto-flows (R7fe) still work because they READ from each
    // record independently — they don't write into the other role's blob.
    noteDetails: {
      ...(section !== "doctor" && {
      nursing: {
        admitDate, admitTime, ipdNo, nurseName, ward, bedNo, modeOfAdmit,
        consciousnessLevel, mobility, allergy, chiefComplaint,
        vitals, painPresent, painScore, painLocation, painCharacter,
        devices, skinIntact, skinNotes,
        morse: { scores: morse, total: morseTotal, risk: morseMeta.label },
        braden: { scores: braden, total: bradenTotal, risk: bradenMeta.label },
        nutri: { scores: nutri, total: nutriTotal, risk: nutriMeta.label },
        vte: { scores: vte, total: vteTotal, risk: vteMeta.label },
        nursingProblems, nursingGoals, nursingNotes,
      }}),
      ...(section !== "nursing" && {
      doctor: {
        // R7hr-70 — pmh dropped (Co-morbidities replaces it). PSH /
        // FamHx / SocHx now write through pshStruct etc.; legacy
        // strings stay in the payload as a back-compat read.
        doctorName, regNo, hopi, psh, famHx, socHx, pshStruct, famHxStruct, socHxStruct, docAllergy,
        genExam, cvs, rs, abdomen, cns,
        // R7hr-65 — icd10Description + patientStatus mirror what OPD writes,
        // so the same downstream consumers (discharge summary, patient file
        // print, narrative theme) light up without per-source plumbing.
        provDx, finalDx, icd10, icd10Description, patientStatus, investigations,
        rxRows: rxRows.filter(r => r.drug.trim()),
        meds,           // R7hr-59 — structured Rx (PrescriptionPanel shape)
        invests,        // R7hr-59 — structured Investigations
        infusions,      // R7hr-59 — IV/infusion orders (InfusionPanel shape)
        treatmentPlan, followupNotes, dietAdvice, activityAdvice,
        // R7fb — doctor P0 NABH fields (AAC.1 / COP.1 / AAC.4)
        nabh: {
          chiefComplaint: docCC, ccDuration,
          allergies: { list: allergyList, noKnown: noKnownAllergies },
          medicationReconciliation: medRecon,
          workingDx, differentialDx,
          comorbidities: comorbid,
          codeStatus: { value: codeStatus, discussedWith: codeStatusDiscussedWith, limitations: codeStatusLimitations },
          elosDays, goalOfCare,
          riskAcknowledgement: docRiskAck,
          reviewOfSystems: ros,
          // R7hr-58 — Structured clinical examination (General Exam +
          // CVS/RS/CNS/P-A blocks). Replaces the simple `ros` checklist
          // and the 5 free-text exam textareas on UI. We keep `ros`
          // saved alongside for back-compat (old records remain
          // readable); on load, `clinicalExamination` takes precedence.
          clinicalExamination: clinExam,
          // R7fd · doctor P1
          anthropometry: docAnthropo,
          localExamination: localExam,
          referrals,
          prognosis,
          consentRequired: consentNeeded,
          // R7fg · doctor P2
          obstetricGynae: obGyn,
          immunisationStatus: immunisation,
          functionalEcog: ecog,
          spiritualNeeds: spiritual,
        },
      }}),
      // R7ff — Cross-check alerts snapshot for backend audit trail.
      // 'high' severity should ideally block sign-off; for now persisted
      // so accountability is preserved. R26 — cross-check is meaningful only
      // when both roles are in scope; carried by either save for now since
      // it is a global flag-set (not role-specific PHI).
      crossCheckAlerts,
      // R7fc — nurse P0 NABH fields (AAC.1 / AAC.4 / IPC / PSQ)
      // R26 — same wrapper as the `nursing:` block; nursingNabh is pure
      // nurse-side data and must NOT appear in a doctor-only save.
      ...(section !== "doctor" && {
      nursingNabh: {
        identification: idBand,
        allergies: { list: nurseAllergyList, noKnown: nurseNoKnownAllergies },
        briefPmh: nurseBriefPmh,
        homeMedications: homeMeds,
        anthropometry: anthropo,
        psychosocial,
        adlBarthel: { ...barthel, total: Object.values(barthel).reduce((s, v) => s + Number(v || 0), 0) },
        bodyChart,
        dischargePlanning: dischargePlan,
        educationNeeds,
        specialPrecautions: precautions,
        // R7fd · nurse P1
        cognitiveCommunication: cognitive,
        culturalSpiritual: cultural,
        bowelBladder: elimination,
        sleepPattern: sleep,
        valuablesBelongings: valuables,
        familyCaregiver: caregiver,
        highRiskFlags: highRisk,
        // R7fg · nurse P2
        mobilityGait,
        preAnaesthesia,
        nutritionalScreeningQuick: nrsQuick,
        promPremTriggers: promPrem,
      }}),
    },
  });

  // R7bd — section defaults to "nursing" (the only remaining tab on this page).
  /* ══ R7fh · Initial Assessment Print ═══════════════════════════
     Role-aware printable document covering EVERY field in the form.
     Doctor prints the doctor block; nurse prints the nursing block.
     One-click sheet to drop in the patient's physical file alongside
     the digital record. Uses inline HTML so it never blocks on a
     missing template file or framework upgrade. */
  const handlePrintAssessment = async () => {
    if (!patient) return toast.warn("Load a patient first");
    let hs = {};
    try {
      const r = await axios.get(`${API_ENDPOINTS.BASE}/hospital-settings`);
      hs = r.data?.data || r.data || {};
    } catch (_) {/* non-blocking */}

    const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
    const _dt = (d) => d ? new Date(d).toLocaleString("en-IN", { day:"2-digit", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit" }) : "—";
    const yn = (b) => b ? "Yes" : "No";
    const dash = (v) => (v == null || v === "") ? "—" : esc(v);

    const kv = (label, value, full = false) => `
      <div class="kv${full ? ' full' : ''}">
        <span class="lbl">${esc(label)}</span>
        <span class="val">${dash(value)}</span>
      </div>`;

    const block = (title, badge, inner) => `
      <div class="block">
        <div class="block-title">
          <span>${esc(title)}</span>
          ${badge ? `<span class="badge">${esc(badge)}</span>` : ""}
        </div>
        <div class="block-body">${inner}</div>
      </div>`;

    /* ── NURSING content (collapsed if empty) ─────────────────── */
    const nursingHtml = `
      ${block("Admission", "NABH AAC.1", `
        <div class="grid grid-4">
          ${kv("Admit Date", admitDate)}
          ${kv("Admit Time", admitTime)}
          ${kv("IPD #", ipdNo)}
          ${kv("Mode", modeOfAdmit)}
          ${kv("Ward", ward)}
          ${kv("Bed", bedNo)}
          ${kv("Consciousness", consciousnessLevel)}
          ${kv("Mobility", mobilityGait?.usesAid || (mobilityGait?.independent ? "Independent" : "—"))}
        </div>`)}

      ${block("Patient Identification", "NABH PSQ.1", `
        <div class="grid grid-2">
          ${kv("ID Band attached", yn(idBand.bandAttached))}
          ${kv("Name verified", yn(idBand.nameVerified))}
          ${kv("UHID verified", yn(idBand.uhidVerified))}
          ${kv("DOB verified", yn(idBand.dobVerified))}
          ${kv("Verified by", idBand.verifiedBy, true)}
        </div>`)}

      ${block("Vitals on Admission", "NABH AAC.1.b", `
        <div class="grid grid-4">
          ${kv("BP", vitals?.bp)}
          ${kv("Pulse", vitals?.pulse)}
          ${kv("RR", vitals?.rr)}
          ${kv("Temp", vitals?.temp)}
          ${kv("SpO2", vitals?.spo2)}
          ${kv("RBS", vitals?.rbs)}
        </div>`)}

      ${block("Anthropometry", "Safety", `
        <div class="grid grid-4">
          ${kv("Height (cm)", anthropo.heightCm)}
          ${kv("Weight (kg)", anthropo.weightKg)}
          ${kv("BMI", anthropo.bmi)}
        </div>`)}

      ${block("Allergies (Nursing)", "NABH PSQ.4",
        nurseNoKnownAllergies
          ? `<div class="empty">NKDA — No Known Drug Allergies declared</div>`
          : nurseAllergyList?.length === 0
            ? `<div class="empty">Not captured</div>`
            : `<table><thead><tr><th>Type</th><th>Agent</th><th>Severity</th><th>Reaction</th></tr></thead>
                <tbody>${nurseAllergyList.map(a => `<tr><td>${esc(a.type)}</td><td>${esc(a.agent)}</td><td>${esc(a.severity)}</td><td>${esc(a.reaction)}</td></tr>`).join("")}</tbody></table>`
      )}

      ${block("Brief History & Home Medications", "NABH MOM", `
        ${kv("Brief PMH", nurseBriefPmh, true)}
        ${homeMeds.length === 0 ? `<div class="empty">No home meds captured</div>` :
          `<table><thead><tr><th>Drug</th><th>Dose</th><th>Frequency</th><th>Last taken</th></tr></thead>
           <tbody>${homeMeds.map(m => `<tr><td>${esc(m.drug)}</td><td>${esc(m.dose)}</td><td>${esc(m.frequency)}</td><td>${esc(m.lastTaken)}</td></tr>`).join("")}</tbody></table>`}`)}

      ${block("Pain Assessment", "NABH IPC", `
        <div class="grid grid-4">
          ${kv("Pain present", yn(painPresent))}
          ${kv("Score (0-10)", painScore)}
          ${kv("Location", painLocation)}
          ${kv("Character", painCharacter)}
        </div>`)}

      ${block("Fall Risk (Morse)", "NABH PSQ.4", `
        ${kv("Total Score", morseTotal)}
        ${kv("Risk", morseMeta?.label)}`)}

      ${block("Pressure Ulcer (Braden)", "NABH IPC", `
        ${kv("Total Score", bradenTotal)}
        ${kv("Risk", bradenMeta?.label)}`)}

      ${block("Nutrition (NRS-2002)", "NABH AAC.4", `
        ${kv("Total Score", nutriTotal)}
        ${kv("Risk", nutriMeta?.label)}
        <div class="sub-title">Quick screen (R7fg)</div>
        <div class="grid grid-2">
          ${kv("BMI < 20.5", yn(nrsQuick.bmiUnder20))}
          ${kv("Weight loss in 3mo", yn(nrsQuick.weightLossLast3Months))}
          ${kv("Reduced intake in 1wk", yn(nrsQuick.reducedIntakeLastWeek))}
          ${kv("Severely ill", yn(nrsQuick.severelyIll))}
        </div>
        ${nrsQuick.dietitianReferralTriggered ? `<div class="alert">⚠ Dietitian referral triggered</div>` : ""}`)}

      ${block("Psychosocial", "NABH AAC.1.b", `
        <div class="grid grid-2">
          ${kv("Emotional state", psychosocial.emotionalState)}
          ${kv("Family support", psychosocial.familySupport)}
          ${kv("Preferred language", psychosocial.languagePreferred)}
          ${kv("Notes", psychosocial.notes, true)}
        </div>`)}

      ${block("Functional / Barthel ADL", "NABH AAC.1.b", `
        <div class="grid grid-2">
          ${["feeding","bathing","grooming","dressing","bowels","bladder","toilet","transfer","mobility","stairs"].map(k => kv(k.replace(/^./, c=>c.toUpperCase()), barthel[k])).join("")}
          ${kv("Total", Object.values(barthel).reduce((s,v)=>s+Number(v||0),0) + " / 100", true)}
        </div>`)}

      ${block("Body Chart", "NABH IPC + AAC.6", `
        <div class="grid grid-2">
          ${kv("Head / Neck", bodyChart.headNeck)}
          ${kv("Chest / Back", bodyChart.chestBack)}
          ${kv("Abdomen / Groin", bodyChart.abdomenGroin)}
          ${kv("Upper limbs", bodyChart.upperLimbs)}
          ${kv("Lower limbs", bodyChart.lowerLimbs)}
          ${kv("Existing wounds", bodyChart.existingWounds)}
          ${kv("Bruises / scars", bodyChart.existingBruises, true)}
        </div>`)}

      ${block("Special Precautions", "NABH IPC + PSQ.4", `
        <div class="grid grid-2">
          ${kv("Isolation", precautions.isolation.required ? precautions.isolation.type || "Yes" : "No")}
          ${kv("Restraints", precautions.restraints.required ? `${precautions.restraints.type || "Yes"} · ${precautions.restraints.reason || ""}` : "No")}
          ${kv("Suicide", yn(precautions.suicide))}
          ${kv("Fall precaution", yn(precautions.fallPrecaution))}
          ${kv("Aspiration", yn(precautions.aspiration))}
          ${kv("Bleeding", yn(precautions.bleed))}
          ${kv("Seizure", yn(precautions.seizure))}
          ${kv("MRI safety", yn(precautions.mri))}
          ${kv("Latex-free", yn(precautions.latex))}
        </div>`)}

      ${block("Education Needs", "NABH AAC.6 + PRE.5", `
        <div class="grid grid-2">
          ${kv("Preferred language", educationNeeds.preferredLanguage)}
          ${kv("Learning style", educationNeeds.learningStyle)}
          ${kv("Target audience", educationNeeds.targetAudience)}
          ${kv("Can read", yn(educationNeeds.canRead))}
          ${kv("Can write", yn(educationNeeds.canWrite))}
          ${kv("Barriers to learning", educationNeeds.barriersToLearning, true)}
        </div>`)}

      ${block("Discharge Planning — Day 1", "NABH AAC.4", `
        <div class="grid grid-2">
          ${kv("Home support", dischargePlan.homeSupport)}
          ${kv("Primary caregiver", dischargePlan.primaryCaregiver)}
          ${kv("Transport", dischargePlan.transportNeed)}
          ${kv("Barriers", dischargePlan.anticipatedBarriers)}
          ${kv("Equipment needed", dischargePlan.equipmentNeeded.join(", ") || "—", true)}
        </div>`)}

      ${block("Cognitive & Communication", "NABH AAC.1.b", `
        <div class="grid grid-2">
          ${kv("Oriented to Person", yn(cognitive.orientationPerson))}
          ${kv("Oriented to Place", yn(cognitive.orientationPlace))}
          ${kv("Oriented to Time", yn(cognitive.orientationTime))}
          ${kv("Vision deficit", yn(cognitive.visionDeficit))}
          ${kv("Hearing deficit", yn(cognitive.hearingDeficit))}
          ${kv("Speech deficit", yn(cognitive.speechDeficit))}
          ${kv("Aids used", cognitive.aidsUsed)}
          ${kv("GCS", cognitive.gcs)}
          ${kv("Notes", cognitive.notes, true)}
        </div>`)}

      ${block("Cultural & Spiritual", "NABH ROP", `
        <div class="grid grid-2">
          ${kv("Religion", cultural.religion)}
          ${kv("Dietary restrictions", cultural.dietaryRestrictions)}
          ${kv("Spiritual needs", cultural.spiritualNeeds)}
          ${kv("Customs", cultural.customs, true)}
        </div>`)}

      ${block("Bowel / Bladder", "NABH COP.1", `
        <div class="grid grid-2">
          ${kv("Bowel continence", elimination.bowelContinence)}
          ${kv("Last BM", elimination.bowelLastBM)}
          ${kv("Bowel frequency", elimination.bowelFrequency)}
          ${kv("Bladder continence", elimination.bladderContinence)}
          ${kv("Catheterised", yn(elimination.bladderCatheterised))}
          ${kv("24h Urine output (mL)", elimination.bladderOutput24h)}
          ${kv("Notes", elimination.notes, true)}
        </div>`)}

      ${block("Sleep Pattern", "NABH AAC.1.b", `
        <div class="grid grid-2">
          ${kv("Hours per night", sleep.hoursPerNight)}
          ${kv("Quality", sleep.quality)}
          ${kv("Sleep aids", sleep.sleepAids)}
          ${kv("Snoring", yn(sleep.snoring))}
          ${kv("Apnea Dx", yn(sleep.apneaDx))}
        </div>`)}

      ${block("Valuables & Belongings", "NABH ROP + PSQ", `
        <div class="grid grid-2">
          ${kv("Status", valuables.status)}
          ${kv("Handed to", valuables.handedTo)}
          ${kv("Items", valuables.items, true)}
          ${kv("Receipt issued", yn(valuables.receiptIssued))}
        </div>`)}

      ${block("Family & Caregiver", "NABH AAC.6", `
        <div class="grid grid-2">
          ${kv("Primary name", caregiver.primaryName)}
          ${kv("Primary relation", caregiver.primaryRelation)}
          ${kv("Primary contact", caregiver.primaryContact)}
          ${kv("Lives with patient", yn(caregiver.lives_with_patient))}
          ${kv("Escalation name", caregiver.escalationName)}
          ${kv("Escalation relation", caregiver.escalationRelation)}
          ${kv("Escalation contact", caregiver.escalationContact)}
        </div>`)}

      ${block("High-Risk Flags", "NABH PSQ.4", `
        <div class="grid grid-4">
          ${kv("Pediatric", yn(highRisk.pediatric))}
          ${kv("Geriatric", yn(highRisk.geriatric))}
          ${kv("Pregnant", yn(highRisk.pregnant))}
          ${kv("Immunocompromised", yn(highRisk.immunocompromised))}
          ${kv("Mental Health", yn(highRisk.mentalHealth))}
          ${kv("Bariatric", yn(highRisk.bariatric))}
          ${kv("Polytrauma", yn(highRisk.polyTrauma))}
          ${kv("Severe Malnutrition", yn(highRisk.severeMalnutrition))}
          ${kv("Notes", highRisk.notes, true)}
        </div>`)}

      ${block("Mobility & Gait", "—", `
        <div class="grid grid-2">
          ${kv("Independent", yn(mobilityGait.independent))}
          ${kv("Aid used", mobilityGait.usesAid)}
          ${kv("Gait normal", yn(mobilityGait.gaitNormal))}
          ${kv("Fall risk observed", yn(mobilityGait.fallRisk))}
          ${kv("Notes", mobilityGait.notes, true)}
        </div>`)}

      ${block("Pre-Anaesthesia (if elective surgery)", "—", `
        <div class="grid grid-2">
          ${kv("Planned surgery", yn(preAnaesthesia.plannedSurgery))}
          ${kv("NPO since", preAnaesthesia.npoSince)}
          ${kv("Loose tooth", yn(preAnaesthesia.looseTooth))}
          ${kv("Crowns/bridges", yn(preAnaesthesia.crowns))}
          ${kv("Dentures", yn(preAnaesthesia.dentures))}
          ${kv("Difficult intubation Hx", yn(preAnaesthesia.difficulIntubationHistory))}
          ${kv("Previous anaesthesia", preAnaesthesia.anaesthesiaHistory)}
          ${kv("PAC scheduled", yn(preAnaesthesia.pacScheduled))}
          ${kv("PAC date", preAnaesthesia.pacDate)}
        </div>`)}

      ${block("PROM / PREM Triggers", "NABH PSQ", `
        <div class="grid grid-2">
          ${kv("PROM planned", yn(promPrem.promPlanned))}
          ${kv("PROM survey", promPrem.promSurvey)}
          ${kv("PREM planned", yn(promPrem.premPlanned))}
          ${kv("PREM survey", promPrem.premSurvey)}
          ${kv("Notes", promPrem.notes, true)}
        </div>`)}

      ${block("Nursing Plan", "—", `
        ${kv("Problems", nursingProblems, true)}
        ${kv("Goals", nursingGoals, true)}
        ${kv("Notes", nursingNotes, true)}`)}

      <div class="sign">
        <div>
          <div class="sign-line"></div>
          <div class="sign-label">Nurse signature</div>
          <div class="sign-meta">${esc(nurseName || user?.fullName || "—")}</div>
        </div>
        <div>
          <div class="sign-line"></div>
          <div class="sign-label">Date / time</div>
          <div class="sign-meta">${_dt(new Date())}</div>
        </div>
      </div>`;

    /* ── DOCTOR content ───────────────────────────────────────── */
    const doctorHtml = `
      ${block("Doctor & Assessment Info", "—", `
        <div class="grid grid-3">
          ${kv("Doctor", doctorName)}
          ${kv("Registration No.", regNo)}
          ${kv("Assessment date/time", _dt(new Date()))}
        </div>`)}

      ${block("Chief Complaint", "NABH AAC.1", `
        ${kv("Chief Complaint", docCC, true)}
        ${kv("Duration / Onset", ccDuration, true)}`)}

      ${block("History", "NABH AAC.1", (() => {
        // R7hr-70 — Past Medical Hx removed (Co-morbidities replaces it).
        // PSH / Family / Social rendered from structured state via helpers
        // that join ticked labels + free-text "other".
        const pshOut = pshSummary(pshStruct) || esc(psh) || "—";
        const famOut = famHxSummary(famHxStruct) || esc(famHx) || "—";
        const socOut = socHxSummary(socHxStruct) || esc(socHx) || "—";
        return `
        ${kv("HPI", hopi, true)}
        ${kv("Past Surgical Hx", pshOut, true)}
        <div class="grid grid-2">
          ${kv("Family Hx", famOut)}
          ${kv("Social Hx", socOut)}
        </div>`;
      })())}

      ${block("Co-morbidities", "NABH AAC.1", `
        <div class="grid grid-4">
          ${["diabetes","hypertension","cad","ckd","copd","asthma","liverDx","cancer","stroke","mentalHealth","hypothyroid","hiv","hepB","hepC"]
            .map(k => {
              // R7hr-64: append "(since N yr)" when an onset is captured
              const yrs = comorbid[`${k}Years`];
              const label = k.replace(/([A-Z])/g, " $1").replace(/^./, c => c.toUpperCase());
              const val = comorbid[k]
                ? (yrs ? `Yes (since ${esc(yrs)} yr)` : "Yes")
                : "No";
              return kv(label, val);
            }).join("")}
          ${kv("Other", comorbid.other, true)}
        </div>`)}

      ${block("Allergies (Doctor)", "NABH PSQ.4",
        noKnownAllergies
          ? `<div class="empty">NKDA — No Known Drug Allergies</div>`
          : (allergyList?.length === 0
            ? `<div class="empty">Not captured</div>`
            : `<table><thead><tr><th>Type</th><th>Agent</th><th>Severity</th><th>Reaction</th></tr></thead>
                <tbody>${allergyList.map(a => `<tr><td>${esc(a.type)}</td><td>${esc(a.agent)}</td><td>${esc(a.severity)}</td><td>${esc(a.reaction)}</td></tr>`).join("")}</tbody></table>`)
      )}

      ${block("Medication Reconciliation", "NABH MOM + AAC.4",
        medRecon.length === 0
          ? `<div class="empty">No medications on reconciliation list</div>`
          : `<table><thead><tr><th>Drug</th><th>Dose</th><th>Freq</th><th>Last taken</th><th>Decision</th><th>Source</th></tr></thead>
              <tbody>${medRecon.map(m => `<tr>
                <td>${esc(m.drug)}</td><td>${esc(m.dose)}</td><td>${esc(m.frequency)}</td>
                <td>${esc(m.lastTaken)}</td><td><strong>${esc(m.continueOnAdmit)}</strong></td>
                <td>${m._fromNursing ? "Nursing" : "Doctor"}</td>
              </tr>`).join("")}</tbody></table>`)}

      ${block("Clinical Examination", "NABH AAC.1", (() => {
        // R7hr-58 — Structured Clinical Examination summary. Uses the
        // shared `clinExamSummary` helper exported by
        // ClinicalExaminationCard so OPD + IPD prints stay aligned.
        // Falls back to legacy ros/genExam/cvs/rs/abdomen/cns rendering
        // if the structured block is empty (e.g. older saved records).
        const s = clinExamSummary ? clinExamSummary(clinExam) : null;
        if (s && (s.general || s.systemic)) {
          return `
            ${s.general ? kv("General Examination", s.general, true) : ""}
            ${s.systemic ? kv("Systemic Examination", s.systemic, true) : ""}
            ${kv("Local examination", localExam, true)}`;
        }
        return `
          <div class="grid grid-2">
            ${Object.entries(ros).map(([k, v]) => kv(k.replace(/^./, c=>c.toUpperCase()), v)).join("")}
          </div>
          ${kv("General", genExam, true)}
          <div class="grid grid-2">
            ${kv("CVS", cvs)}
            ${kv("Respiratory", rs)}
            ${kv("Abdomen", abdomen)}
            ${kv("CNS", cns)}
          </div>
          ${kv("Local examination", localExam, true)}`;
      })())}

      ${block("Diagnosis (3-tier)", "NABH AAC.1", `
        ${kv("Provisional", provDx, true)}
        ${kv("Working", workingDx, true)}
        ${kv("Final / Confirmed", finalDx, true)}
        <div class="grid grid-2">
          ${kv("ICD-10 Code", icd10)}
          ${kv("ICD-10 Description", icd10Description)}
        </div>
        ${kv("Patient Status", patientStatus)}
        ${kv("Differentials", differentialDx, true)}`)}

      ${block("Anthropometry (Doctor confirms)", "Drug-dosing safety", `
        <div class="grid grid-4">
          ${kv("Height (cm)", docAnthropo.heightCm)}
          ${kv("Weight (kg)", docAnthropo.weightKg)}
          ${kv("BMI", docAnthropo.bmi)}
          ${kv("IBW (Devine)", docAnthropo.idealBodyWeightKg)}
        </div>`)}

      ${block("Investigations Ordered", "—", invests.length > 0
        ? `<ul style="margin:0;padding-left:18px">${invests.map(i => `<li>${esc(i.name)}${i.urgency && i.urgency!=="ROUTINE" ? ` <span style="color:#b91c1c;font-weight:700">[${esc(i.urgency)}]</span>` : ""}${i.instructions ? ` — ${esc(i.instructions)}` : ""}</li>`).join("")}</ul>`
        : kv("Tests ordered", investigations, true))}

      ${block("Treatment Plan", "NABH COP.1", kv("Plan", treatmentPlan, true))}

      ${block("Prescription",
        `${meds.length || rxRows.filter(r=>r.drug).length} drug(s)`,
        meds.length > 0
          ? `<table><thead><tr><th>Drug</th><th>Dose</th><th>Route</th><th>Frequency</th><th>Duration</th></tr></thead><tbody>${meds.map(m => `<tr><td>${esc(m.name)}</td><td>${esc(m.dose||"")}</td><td>${esc(m.route||"")}</td><td>${esc(m.frequency||"")}</td><td>${esc(m.duration||"")}</td></tr>`).join("")}</tbody></table>`
          : (rxRows.filter(r=>r.drug).length === 0
              ? `<div class="empty">No medications prescribed</div>`
              : `<table><thead><tr><th>Drug</th><th>Dose</th><th>Route</th><th>Frequency</th><th>Duration</th><th>Instructions</th></tr></thead>
                  <tbody>${rxRows.filter(r=>r.drug).map(r => `<tr>
                    <td>${esc(r.drug)}</td><td>${esc(r.dose)}</td><td>${esc(r.route)}</td>
                    <td>${esc(r.frequency)}</td><td>${esc(r.duration)}</td><td>${esc(r.instructions)}</td>
                  </tr>`).join("")}</tbody></table>`))}

      ${infusions.length > 0 ? block("Infusion / IV Fluids", "—",
        `<table><thead><tr><th>Fluid</th><th>Volume</th><th>Rate</th><th>Additives</th></tr></thead><tbody>${infusions.map(f => `<tr><td>${esc(f.name)}</td><td>${esc(f.totalVolume||"")}</td><td>${esc(f.rate||"")}</td><td>${esc(f.additives||"")}</td></tr>`).join("")}</tbody></table>`
      ) : ""}

      ${block("Care Decisions", "NABH AAC.4 + ROP.1", `
        <div class="grid grid-2">
          ${kv("Code status", codeStatus.replace(/_/g, " "))}
          ${kv("Discussed with", codeStatusDiscussedWith)}
          ${kv("Limitations", codeStatusLimitations, true)}
          ${kv("ELOS (days)", elosDays)}
          ${kv("Goal of care", goalOfCare)}
        </div>
        <div class="sub-title">Risk Acknowledgement</div>
        <table><thead><tr><th>Risk</th><th>Acknowledged</th><th>Plan</th></tr></thead>
          <tbody>
            ${["fall","dvt","ulcer","pain"].map(k => `<tr>
              <td>${esc(k.replace(/^./, c=>c.toUpperCase()))}</td>
              <td>${yn(docRiskAck[k]?.acknowledged)}</td>
              <td>${esc(docRiskAck[k]?.plan || "—")}${k === "dvt" && docRiskAck.dvt?.score ? ` <em>(Caprini ${esc(docRiskAck.dvt.score)})</em>` : ""}</td>
            </tr>`).join("")}
          </tbody></table>`)}

      ${block("Cross-Consultation / Referrals", "NABH COP",
        referrals.length === 0
          ? `<div class="empty">No referrals requested</div>`
          : `<table><thead><tr><th>Specialty</th><th>Reason</th><th>Urgency</th><th>Status</th></tr></thead>
              <tbody>${referrals.map(r => `<tr><td>${esc(r.specialty)}</td><td>${esc(r.reason)}</td><td>${esc(r.urgency)}</td><td>${esc(r.status)}</td></tr>`).join("")}</tbody></table>`)}

      ${block("Prognosis Discussion", "NABH PRE.4", `
        <div class="grid grid-2">
          ${kv("Discussed with", prognosis.discussedWith)}
          ${kv("Language used", prognosis.languageUsed)}
          ${kv("Summary", prognosis.summary, true)}
          ${kv("Q&A", prognosis.questionsAddressed, true)}
        </div>`)}

      ${block("Consents Required", "NABH PRE.3 + PRE.4", `
        <div class="grid grid-4">
          ${Object.entries(consentNeeded).map(([k, v]) => kv(k.replace(/^./, c=>c.toUpperCase()), yn(v))).join("")}
        </div>`)}

      ${obGyn.isApplicable ? block("Menstrual / Obstetric", "—", `
        <div class="grid grid-4">
          ${kv("LMP", obGyn.lmp)}
          ${kv("Cycle days", obGyn.cycleDays)}
          ${kv("Regular?", yn(obGyn.cycleRegular))}
          ${kv("G P A L", `${obGyn.gravida || "—"} / ${obGyn.para || "—"} / ${obGyn.abortions || "—"} / ${obGyn.livingChildren || "—"}`)}
          ${kv("Contraception", obGyn.contraception)}
          ${kv("Last pregnancy", obGyn.lastPregnancyOutcome)}
          ${kv("β-hCG", obGyn.pregnancyTestResult)}
          ${kv("Notes", obGyn.notes, true)}
        </div>`) : ""}

      ${block("Immunisation", "—", `
        ${kv("Up-to-date for age", yn(immunisation.upToDateForAge))}
        <table><thead><tr><th>Vaccine</th><th>Status</th><th>Last date</th></tr></thead>
          <tbody>
            ${["tetanus","hepB","covid","influenza","pneumococcal"].map(k => `<tr>
              <td>${esc(k.replace(/^./, c=>c.toUpperCase()))}</td>
              <td>${yn(immunisation[k]?.vaccinated)}</td>
              <td>${esc(immunisation[k]?.lastDate || "—")}${k === "covid" && immunisation.covid?.doses ? ` · ${esc(immunisation.covid.doses)} doses` : ""}</td>
            </tr>`).join("")}
          </tbody></table>
        ${immunisation.other ? kv("Other", immunisation.other, true) : ""}`)}

      ${block("Functional / ECOG", "—", `
        ${kv("ECOG score", ecog.score)}
        ${kv("Disabilities", ecog.disabilities)}
        ${kv("Aids required", ecog.aidsRequired)}`)}

      ${block("Spiritual / Existential", "NABH ROP", `
        ${kv("Distress noted", yn(spiritual.distressNoted))}
        ${kv("Concerns", spiritual.concerns, true)}
        ${kv("Chaplain referral", yn(spiritual.chaplainReferralRequested))}`)}

      ${block("Diet, Activity & Follow-up", "—", `
        ${kv("Diet advice", dietAdvice, true)}
        ${kv("Activity advice", activityAdvice, true)}
        ${kv("Follow-up", followupNotes, true)}`)}

      <div class="sign">
        <div>
          <div class="sign-line"></div>
          <div class="sign-label">Doctor signature</div>
          <div class="sign-meta">${esc(doctorName || user?.fullName || "—")}${regNo ? ` · ${esc(regNo)}` : ""}</div>
        </div>
        <div>
          <div class="sign-line"></div>
          <div class="sign-label">Date / time</div>
          <div class="sign-meta">${_dt(new Date())}</div>
        </div>
      </div>`;

    const roleTitle = isDoctorRole ? "Doctor Initial Assessment" : "Nursing Initial Assessment";
    const contentHtml = isDoctorRole ? doctorHtml : nursingHtml;

    // R7fr Track C — section-block CSS only (kept inline within
    // bodyHtml so the shell's <head> stays generic). PrintShell embeds
    // its own header / patient-strip / footer CSS via ?inline import.
    const bodyCss = `
      <style>
        .block{margin-top:10px;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden}
        .block-title{display:flex;justify-content:space-between;align-items:center;background:#e0e7ff;padding:6px 12px;font-size:12px;font-weight:800;color:#1e3a8a;border-left:4px solid #4f46e5}
        .badge{background:#fff;color:#4f46e5;border:1px solid #c7d2fe;padding:1px 7px;border-radius:4px;font-size:9px;font-weight:700;letter-spacing:.3px}
        .block-body{padding:8px 12px}
        .grid{display:grid;gap:4px 12px}
        .grid-2{grid-template-columns:1fr 1fr}
        .grid-3{grid-template-columns:repeat(3,1fr)}
        .grid-4{grid-template-columns:repeat(4,1fr)}
        .kv{display:flex;justify-content:space-between;gap:8px;padding:3px 0;border-bottom:1px dotted #e2e8f0;font-size:10.5px}
        .kv.full{grid-column:1 / -1}
        .kv .lbl{color:#64748b;font-weight:600;flex:0 0 auto}
        .kv .val{color:#0f172a;text-align:right;flex:1;word-break:break-word}
        .empty{padding:8px;text-align:center;color:#94a3b8;font-style:italic}
        .alert{margin-top:6px;padding:4px 8px;background:#fef3c7;border:1px solid #fbbf24;border-radius:4px;color:#92400e;font-size:10.5px}
        .sub-title{font-size:10.5px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.4px;margin:8px 0 4px}
        .block table{width:100%;border-collapse:collapse;margin:4px 0;font-size:10.5px}
        .block th,.block td{padding:4px 6px;border-bottom:1px solid #e2e8f0;text-align:left;vertical-align:top}
        .block th{background:#f1f5f9;font-weight:700;font-size:9.5px;text-transform:uppercase;letter-spacing:.3px;color:#475569}
        .sign{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:18px;padding-top:10px;border-top:1.5px solid #cbd5e1}
        .sign-line{border-bottom:1.5px solid #0f172a;height:30px}
        .sign-label{font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;margin-top:4px}
        .sign-meta{font-size:10.5px;color:#0f172a;font-weight:600;margin-top:1px}
        @media print { .block{page-break-inside:avoid} }
      </style>`;

    const html = buildPrintShellHtml({
      hospital: hs,
      docTitle: roleTitle,
      docSubtitle: `IPD ${ipdNo || ""} · NABH AAC.1 / COP.2`,
      patient: {
        left: [
          { label: "UHID",        value: patient.UHID || "—" },
          { label: "Patient",     value: patient.fullName || "—" },
          { label: "Age/Sex",     value: `${patient.age || "—"}/${patient.gender?.[0] || "—"}` },
          { label: "Blood Group", value: patient.bloodGroup || "—" },
          { label: "Contact",     value: patient.contactNumber || "—" },
        ],
        right: [
          { label: "IPD #",            value: ipdNo || "—" },
          { label: "Admit Date",       value: `${admitDate || ""} ${admitTime || ""}`.trim() || "—" },
          { label: "Ward/Bed",         value: `${ward || "—"}/${bedNo || "—"}` },
          { label: "Consultant",       value: admission?.attendingDoctor || "—" },
          { label: "Assessment Date",  value: new Date().toLocaleDateString("en-IN") },
        ],
      },
      signatures: {
        type: "double",
        // Left = Nurse, Right = Doctor — preserves the dual-author
        // intent of R7fh's section-aware design even when only one
        // role is printing this run.
        left:  { name: nurseName || user?.fullName || "Nurse", role: "Nursing Staff" },
        right: { name: doctorName || (isDoctorRole ? user?.fullName : "") || "Doctor", role: "Consultant", reg: regNo || "" },
      },
      banners: {
        emergency24x7: true,
        custom: "NABH AAC.1: This Initial Assessment is part of the patient's permanent clinical record.",
      },
      meta: {
        docNumber: (`IA-${ipdNo || ""}`).replace(/[^A-Z0-9\-]/gi, "") || `IA-${Date.now()}`,
        pageOf: "1 of 2",
      },
      bodyHtml: bodyCss + contentHtml,
    });

    const w = window.open("", "_blank");
    if (!w) return toast.error("Pop-up blocked — allow pop-ups to print");
    w.document.write(html);
    w.document.close();
    // PrintShell's embedded <script> auto-fires window.print() on load —
    // no manual setTimeout needed.
  };

  const handleSave = async (sign = false, section = "nursing") => {
    if (!patient) { toast.warn("Load a patient first"); return; }
    setSaving(true);
    try {
      const payload = buildPayload(section, sign ? "signed" : "draft");
      // R7fn-v2 — pick the section-specific id so doctor and nurse each
      // sign their own DoctorNote. Mixing them caused PATCH /sign → 400
      // ("Note already signed") when the doctor saved on top of a
      // nurse-signed initial.
      const sectionNoteId = section === "doctor" ? doctorNoteId : nurseSectionNoteId;
      let res;
      if (sectionNoteId) {
        res = await axios.put(`${API_ENDPOINTS.DOCTOR_NOTES}/${sectionNoteId}`, payload);
        if (sign) await axios.patch(`${API_ENDPOINTS.DOCTOR_NOTES}/${sectionNoteId}/sign`);
      } else {
        res = await axios.post(`${API_ENDPOINTS.DOCTOR_NOTES}`, payload);
        const newId = res.data?.data?._id || res.data?._id;
        if (newId) {
          if (section === "doctor") setDoctorNoteId(newId);
          else setNurseSectionNoteId(newId);
          // After POST, the row is still draft; if `sign` requested, hit
          // /sign now on the freshly-created row.
          if (sign) {
            try { await axios.patch(`${API_ENDPOINTS.DOCTOR_NOTES}/${newId}/sign`); } catch (_) {}
          }
        }
      }

      // R7fm — Mirror nursing-section assessments to /nursing-notes so they
      // appear on the Nursing Notes timeline. The IPDInitialAssessmentPage
      // POSTs the canonical record to /doctor-notes (which DischargeSummary,
      // PatientPanelTabs, and CompletePatientFile read), but NursingNotes.jsx
      // reads exclusively from /nursing-notes — a separate collection. Live
      // R7fk verify showed an empty NurseNotes collection for Badal even
      // after a signed save. We dual-write here so both timelines stay in
      // sync. Failure to mirror is non-fatal — the canonical DoctorNote save
      // already succeeded.
      if (section === "nursing" && patient?._id) {
        try {
          const nursePayload = {
            patient:        patient._id,
            patientId:      patient._id,
            patientUHID:    patient.UHID || uhid,
            patientName:    patient.fullName || "",
            UHID:           patient.UHID || uhid,
            admissionNumber: ipdNo,
            ipdNo,
            noteDate:       new Date().toISOString(),
            shift:          "general",
            nurseName:      nurseName || user?.fullName || "Nurse",
            noteType:       "initial",
            isCriticalEvent: false,
            status:         sign ? "submitted" : "draft",
            ...(sign ? { submittedAt: new Date().toISOString() } : {}),
            vitals: {
              bp:    { systolic: Number(vitals?.bp?.split("/")?.[0]) || undefined,
                       diastolic: Number(vitals?.bp?.split("/")?.[1]) || undefined },
              pulse:      Number(vitals?.pulse) || undefined,
              temp:       Number(vitals?.temp)  || undefined,
              rr:         Number(vitals?.rr)    || undefined,
              spo2:       Number(vitals?.spo2)  || undefined,
              bloodSugar: Number(vitals?.rbs)   || undefined,
            },
            painScore: Number(painScore) || 0,
            painAssessment: painPresent
              ? [painLocation, painCharacter].filter(Boolean).join(" — ")
              : "No pain reported on admission",
            remarks: nursingNotes
              || `Nursing Initial Assessment (NABH AAC.1 / COP.2) — ${
                   chiefComplaint || patient?.fullName || "patient"
                 }`,
            tags: ["initial-assessment", "nabh-aac1", "nabh-cop2"],
            signedByName: sign ? (nurseName || user?.fullName || "") : undefined,
            // Mixed catch-all — full role-specific payload so any downstream
            // reader (timeline expansion, print, audit) has the whole record.
            noteData: payload.noteDetails?.nursing && {
              nursing:     payload.noteDetails.nursing,
              nursingNabh: payload.noteDetails.nursingNabh,
              section:     "nursing",
              linkedDoctorNoteId: noteId || res.data?.data?._id || res.data?._id,
              assessmentDate: payload.assessmentDate,
            },
          };

          if (nurseNoteId) {
            await axios.put(
              `${API_ENDPOINTS.NURSING_NOTES}/${nurseNoteId}`,
              nursePayload,
            );
          } else {
            const nr = await axios.post(
              `${API_ENDPOINTS.NURSING_NOTES}`,
              nursePayload,
            );
            const nid = nr.data?.data?._id || nr.data?._id;
            if (nid) setNurseNoteId(nid);
          }
        } catch (e) {
          // Non-fatal — canonical save already landed in DoctorNotes.
          // Surface a soft warning so a nurse can re-try / report it.
          console.warn("Nursing timeline mirror failed:", e?.response?.data || e.message);
        }
      }

      // On sign-off, mark the corresponding initial assessment flag on the admission
      if (sign && admission?._id) {
        const role = section === "nursing" ? "nurse" : "doctor";
        const name = section === "nursing"
          ? (nurseName || user?.fullName || "")
          : (doctorName || user?.fullName || "");
        // R7fn-v3 — Hardened gate-flag PUT. Previously a silent .catch(() => {})
        // swallowed any failure, leaving the other-role tile locked even after
        // a successful sign — and the user had no signal. Now: log first
        // failure, retry once with explicit completedAt, and as last resort
        // patch the nested flag directly via PATCH /admissions/:id. Local
        // admission state is always updated below so the in-page gate UI
        // lifts even if the backend disagrees.
        try {
          await axios.put(`${API_ENDPOINTS.BASE}/admissions/${admission._id}/initial-assessment`, { role, name });
        } catch (err) {
          console.warn("[R7fn] Initial Assessment gate flag PUT failed, retrying:", err?.response?.data || err.message);
          try {
            await axios.put(`${API_ENDPOINTS.BASE}/admissions/${admission._id}/initial-assessment`, {
              role, name, completedAt: new Date().toISOString(),
            });
          } catch (err2) {
            // Last resort: update via PATCH /admissions/:id with the nested flag
            try {
              const patchBody = {
                initialAssessment: {
                  ...(admission.initialAssessment || {}),
                  [`${role}Completed`]: true,
                  [`${role}CompletedAt`]: new Date().toISOString(),
                  [`${role}Name`]: name,
                },
              };
              await axios.put(`${API_ENDPOINTS.BASE}/admissions/${admission._id}`, patchBody);
            } catch (err3) {
              console.error("[R7fn] All gate-flag update attempts failed:", err3?.response?.data || err3.message);
              toast.warn("Sign succeeded but admission gate flag couldn't update. Other doctor tiles may stay locked — refresh the page.");
            }
          }
        }
        // Always update local admission state so the gate UI lifts even if backend disagreed
        setAdmission(prev => prev ? {
          ...prev,
          initialAssessment: {
            ...prev.initialAssessment,
            [`${role}Completed`]: true,
            [`${role}CompletedAt`]: new Date().toISOString(),
          },
        } : prev);
      }
      // R7fj-HIGH-2 + R7fl: PATCH Patient.allergyList so PatientHeaderCard's
      // banner, drug-allergy gate, and Pharmacy/MAR cross-checks pick up the
      // structured allergy list at sign-off. We MERGE nurse + doctor agents
      // so a cross-check captured by either party lands on the patient
      // record. Non-blocking — banner is convenience, not a hard constraint;
      // failure to patch shouldn't fail save.
      //
      // R7fl-FIX: previously PATCHed `{allergies: [...]}` but `allergies` is
      // a Mongoose VIRTUAL (read-only) on PatientSchema — Mongo silently
      // dropped the write and the legacy `knownAllergies` string (e.g.
      // "Nill" from registration) kept feeding the virtual via fallback,
      // so the banner never updated. We now PATCH the real schema path
      // `allergyList[]` with the canonical shape:
      //   { allergen, severity (enum UPPER), type (enum UPPER), recordedBy }
      // and rewrite `knownAllergies` to a human summary so legacy displays
      // that still read the string field stay in sync. This is an
      // array-REPLACE (Mongo `$set`) so legacy seed rows are wiped.
      if (sign && patient?._id) {
        try {
          const SEV_ENUM  = new Set(["MILD","MODERATE","SEVERE","ANAPHYLAXIS","UNKNOWN"]);
          const TYPE_ENUM = new Set(["DRUG","FOOD","OTHER"]);
          const normSev   = (s) => {
            const u = String(s || "").trim().toUpperCase();
            return SEV_ENUM.has(u) ? u : "UNKNOWN";
          };
          const normType  = (t) => {
            const u = String(t || "").trim().toUpperCase();
            return TYPE_ENUM.has(u) ? u : "DRUG";
          };

          const mergedAllergyList = [];
          const seen = new Set();
          const addRow = (a, source) => {
            const k = String(a?.agent || "").toLowerCase().trim();
            if (!k || seen.has(k)) return;
            seen.add(k);
            mergedAllergyList.push({
              allergen:   a.agent,                       // schema field name
              severity:   normSev(a.severity),           // SEVERE / MODERATE / MILD / ANAPHYLAXIS / UNKNOWN
              type:       normType(a.type),              // DRUG / FOOD / OTHER
              recordedBy: `${source} — IPD Initial Assessment`,
              // recordedAt defaults server-side
            });
          };
          (allergyList      || []).forEach(a => addRow(a, "doctor"));
          (nurseAllergyList || []).forEach(a => addRow(a, "nurse"));

          const nkda = !!(noKnownAllergies || nurseNoKnownAllergies) && mergedAllergyList.length === 0;

          // Build a human-readable summary string for `knownAllergies` so
          // any legacy view that still reads the string field shows the
          // same data. Wipe to empty string when NKDA so the registration
          // placeholder ("Nill" / "None" / etc.) is cleared.
          const knownAllergiesSummary = nkda
            ? ""
            : mergedAllergyList
                .map(r => `${r.allergen} (${r.severity})`)
                .join(", ");

          if (mergedAllergyList.length > 0 || nkda) {
            // PUT is the canonical patient update verb in this codebase.
            // findByIdAndUpdate with $set: { allergyList } REPLACES the
            // array (clears legacy seed rows). Wrapped in try/catch so a
            // 403 (missing patient.write-clinical) or 4xx doesn't fail
            // the assessment save.
            try {
              await axios.put(
                `${API_ENDPOINTS.PATIENTS}/${patient._id}`,
                {
                  allergyList:     mergedAllergyList,
                  knownAllergies:  knownAllergiesSummary,
                },
              );
            } catch (e) {
              // Fallback: try PATCH in case a deployment routes PATCH separately.
              try {
                await axios.patch(
                  `${API_ENDPOINTS.PATIENTS}/${patient._id}`,
                  {
                    allergyList:    mergedAllergyList,
                    knownAllergies: knownAllergiesSummary,
                  },
                );
              } catch (_) { /* non-fatal */ }
            }
          }
        } catch (_) { /* non-fatal */ }
      }
      toast.success(sign ? "Assessment signed & submitted ✓" : "Draft saved");
      if (sign) {
        clearDraft();
        // R7hr-98 — IMMEDIATELY lock the IA in-session so the next
        // autosave tick doesn't write the same form back as a fresh
        // draft (which was overwriting the signed record). Pre-fix the
        // page waited for a reload to hydrate iaLocked from the server
        // status, but the autosave fired before that. Now we lock the
        // moment the sign API call returns 2xx — UI flips to LOCKED
        // banner, all fields go read-only, no more autosave writes.
        // The amend path remains the only way back into write mode.
        const whoSigned =
          (section === "doctor"
            ? (doctorName || user?.fullName || "")
            : (nurseName  || user?.fullName || ""));
        setIaLocked(true);
        setLockedSignedByName(whoSigned);
        setLockedSignedAt(new Date().toISOString());
      }
    } catch (err) {
      toast.error(err.response?.data?.message || "Save failed");
    } finally { setSaving(false); }
  };

  const setV = key => val => setVitals(v => ({ ...v, [key]: val }));
  const setDev = key => e => setDevices(d => ({ ...d, [key]: e.target.checked }));

  /* ── R7hr-72/lock — Read-only helper. Every Section gets disabled={ro}
     so its body becomes non-interactive once locked. The bottom Save
     Draft / Sign buttons also gate on this; the Amend button (top
     ribbon) stays clickable. */
  const ro = iaLocked && !amendMode;

  /* ── R7hr-72/lock — Pretty-print signed-at for the locked ribbon. */
  const fmtDT = (d) => {
    if (!d) return "—";
    try {
      return new Date(d).toLocaleString("en-IN", {
        day: "2-digit", month: "short", year: "numeric",
        hour: "2-digit", minute: "2-digit",
      });
    } catch { return String(d); }
  };

  /* ── R7hr-72/lock — Snapshot every top-level form-state bucket BEFORE
     we unlock the page. The diff at save-time walks pre-amend vs current
     and emits a [{ field, oldValue, newValue }] list. Listing every state
     slot here keeps the audit trail honest — anything a doctor or nurse
     might touch during an amend must be captured. */
  const captureFormSnapshot = () => ({
    // Nursing general
    admitDate, admitTime, ipdNo, nurseName, ward, bedNo, modeOfAdmit,
    consciousnessLevel, mobility, allergy, chiefComplaint,
    vitals, painPresent, painScore, painLocation, painCharacter,
    devices, skinIntact, skinNotes,
    morse, braden, nutri, vte,
    nursingProblems, nursingGoals, nursingNotes,
    // Doctor general + history
    doctorName, regNo, hopi, psh, famHx, socHx,
    pshStruct, famHxStruct, socHxStruct,
    docAllergy, genExam, cvs, rs, abdomen, cns,
    provDx, finalDx, icd10, icd10Description, patientStatus,
    investigations, rxRows, meds, invests, infusions,
    treatmentPlan, followupNotes, dietAdvice, activityAdvice,
    // Doctor P0 NABH
    docCC, ccDuration, allergyList, noKnownAllergies, medRecon,
    workingDx, differentialDx, comorbid,
    codeStatus, codeStatusDiscussedWith, codeStatusLimitations,
    elosDays, goalOfCare, docRiskAck, ros, clinExam,
    // Doctor P1 NABH
    docAnthropo, localExam, referrals, prognosis, consentNeeded,
    // Doctor P2 NABH
    obGyn, immunisation, ecog, spiritual,
    // Nurse P0 NABH
    idBand, nurseAllergyList, nurseNoKnownAllergies, nurseBriefPmh,
    homeMeds, anthropo, psychosocial, barthel, bodyChart,
    dischargePlan, educationNeeds, precautions,
    // Nurse P1 NABH
    cognitive, cultural, elimination, sleep, valuables, caregiver, highRisk,
    // Nurse P2 NABH
    mobilityGait, preAnaesthesia, nrsQuick, promPrem,
  });

  /* ── R7hr-72/lock — Walk pre-amend vs current and emit a flat list
     of [{ field, oldValue, newValue }]. Primitives compare directly;
     arrays / objects are JSON-stringified for compare and emit a single
     root-level entry when they deep-differ. Compact + reliable for the
     audit row — surveyors care about WHAT changed, not the leaf-level
     breakdown. */
  const computeAmendChanges = (before, after) => {
    if (!before) return [];
    const changes = [];
    const isPrimitive = (v) => v == null || (typeof v !== "object");
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const k of keys) {
      const a = before[k], b = after[k];
      if (isPrimitive(a) && isPrimitive(b)) {
        if (a !== b) changes.push({ field: k, oldValue: a, newValue: b });
      } else {
        const aj = JSON.stringify(a);
        const bj = JSON.stringify(b);
        if (aj !== bj) changes.push({
          field: k,
          oldValue: JSON.parse(aj ?? "null"),
          newValue: JSON.parse(bj ?? "null"),
        });
      }
    }
    return changes;
  };

  /* ── R7hr-72/lock — Amend dispatch. Called by the bottom Save buttons
     (and the role-specific sign-off buttons) when amendMode is true.
     Routes to the right collection: doctor amends hit /doctor-notes/:id
     /amend, nurse amends hit the same canonical row (DoctorNotes section
     ="nursing") + mirror the amend onto /nursing-notes/:id/amend for the
     nursing-timeline log. Reason + diff travel together. */
  const handleAmendSave = async (section = "nursing") => {
    if (!patient) { toast.warn("Load a patient first"); return; }
    if (!amendReason || amendReason.trim().length < 5) {
      toast.error("Amend reason is required (min 5 characters)");
      return;
    }
    setSaving(true);
    try {
      const after  = captureFormSnapshot();
      const changes = computeAmendChanges(preAmendSnapshot, after);
      const payload = {
        reason: amendReason.trim(),
        changes,
        ...buildPayload(section, "signed"),
      };
      const sectionNoteId = section === "doctor" ? doctorNoteId : nurseSectionNoteId;
      if (!sectionNoteId) {
        // No id to amend against — fall back to the existing save path so
        // the row is created + signed cleanly (still records the reason
        // in noteDetails for the audit).
        toast.warn("No existing signed note found — saving as a fresh signed entry instead.");
        await handleSave(true, section);
      } else {
        // Primary canonical row.
        await axios.post(
          `${API_ENDPOINTS.DOCTOR_NOTES}/${sectionNoteId}/amend`,
          payload,
        );
        // Nurse-section amend also mirrors onto the NurseNotes timeline.
        if (section === "nursing" && nurseNoteId) {
          try {
            await axios.post(
              `${API_ENDPOINTS.NURSING_NOTES}/${nurseNoteId}/amend`,
              { reason: amendReason.trim(), changes },
            );
          } catch (_) { /* non-fatal — DoctorNotes amend already landed */ }
        }
      }
      toast.success("Amendment saved & re-signed ✓ (audit logged)");
      // Stay LOCKED — status is 'amended', still a locked record.
      setAmendMode(false);
      setAmendReason("");
      setPreAmendSnapshot(null);
      setLockedSignedAt(new Date().toISOString());
    } catch (err) {
      toast.error(err.response?.data?.message || "Amend save failed");
    } finally { setSaving(false); }
  };

  /* ═══════════ RENDER ═══════════ */
  return (
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={() => navigate(-1)}
            style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 8,
              padding: "6px 12px", cursor: "pointer", fontSize: 12, color: C.muted,
              display: "flex", alignItems: "center", gap: 6 }}>
            <i className="pi pi-arrow-left" style={{ fontSize: 11 }} /> Back
          </button>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {/* R7fa — title is role-aware. Doctor sees the doctor-only
                  Initial Assessment surface (HPI / exam / 3-tier diagnosis
                  / plan / Rx); nurse sees the nursing-only one (vitals /
                  fall risk / pain / devices / care plan). Two completely
                  separate forms; whichever role mounted the page sees
                  only their fields. */}
              <div style={{ fontSize: 18, fontWeight: 800, color: C.text }}>
                {isDoctorRole ? "Doctor Initial Assessment" : "Nursing Initial Assessment"}
              </div>
              <span style={{ background: C.accentL, color: C.accent, border: `1px solid ${C.accent}30`,
                padding: "2px 10px", borderRadius: 5, fontSize: 10, fontWeight: 800, letterSpacing: 1 }}>IPD</span>
              <span style={{ background: C.greenL, color: C.green, border: `1px solid ${C.green}30`,
                padding: "2px 10px", borderRadius: 5, fontSize: 10, fontWeight: 700 }}>NABH AAC.1</span>
            </div>
            <div style={{ fontSize: 11, color: C.muted }}>
              {isDoctorRole
                ? "History · Physical Examination · Diagnosis · Plan · Prescription"
                : "Vitals · Fall Risk · Pain · Pressure Ulcer · ADL · Devices · Care Plan"
              } · {new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {/* R7fn — Admin role-view toggle. Admins are the only role that
              legitimately needs to fill BOTH halves (training, late entries,
              QA fixes). Doctor users always see Doctor view; Nurse users
              always see Nursing view — toggle hidden for them. */}
          {isAdminUser && (
            <div style={{ display: "flex", border: `1.5px solid ${C.border}`, borderRadius: 8, overflow: "hidden", marginRight: 4 }}>
              <button onClick={() => setViewRole("nurse")}
                style={{ padding: "7px 11px", border: "none", cursor: "pointer", fontSize: 11, fontWeight: 700,
                  background: viewRole === "nurse" ? C.accent : "white",
                  color:      viewRole === "nurse" ? "white"   : C.muted }}>
                <i className="pi pi-user" style={{ fontSize: 10, marginRight: 4 }} /> Nurse View
              </button>
              <button onClick={() => setViewRole("doctor")}
                style={{ padding: "7px 11px", border: "none", cursor: "pointer", fontSize: 11, fontWeight: 700,
                  background: viewRole === "doctor" ? C.accent : "white",
                  color:      viewRole === "doctor" ? "white"   : C.muted }}>
                <i className="pi pi-id-card" style={{ fontSize: 10, marginRight: 4 }} /> Doctor View
              </button>
            </div>
          )}
          <AutoSaveIndicator savedAt={savedAt} hasDraft={hasDraft} />
          <button onClick={() => setShowSetup(true)}
            style={{ padding:"7px 12px", background: signature ? "#f0fdf4" : "#fffbeb", border:`1.5px solid ${signature ? "#bbf7d0" : "#fde68a"}`, borderRadius:8, cursor:"pointer", fontSize:11, fontWeight:700, color: signature ? "#16a34a" : "#92400e", display:"flex", alignItems:"center", gap:5 }}>
            {signature ? <><i className="pi pi-verified" /> Signature Set</> : <><i className="pi pi-pen-to-square" /> Setup Signature</>}
          </button>
          {/* R7fh — role-aware print of the full assessment sheet */}
          <button onClick={handlePrintAssessment} disabled={!patient}
            style={{ padding: "8px 14px", border: `1.5px solid ${C.accent}40`, borderRadius: 8,
              background: "white", color: C.accent, cursor: patient ? "pointer" : "not-allowed",
              fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 700,
              display: "flex", alignItems: "center", gap: 5, opacity: patient ? 1 : 0.55 }}>
            <i className="pi pi-print" style={{ fontSize: 11 }} /> Print
          </button>
          {/* R7fa — these header buttons default to section="nursing".
              For doctor mode they'd save the wrong role, so the buttons
              are hidden — the doctor uses the dedicated Doctor sign-off
              block at the bottom of the doctor form which calls
              handleSave(true, "doctor").
              R7hr-72/lock — also hidden when LOCKED & !amendMode; the
              red Amend ribbon owns the only path back to editing. */}
          {!isDoctorRole && !(iaLocked && !amendMode) && (<>
            <button onClick={() => handleSave(false)} disabled={saving}
              style={{ padding: "8px 18px", border: `1.5px solid ${C.border}`, borderRadius: 8,
                background: "white", cursor: saving ? "not-allowed" : "pointer",
                fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 600, color: C.muted }}>
              <i className="pi pi-save" style={{ marginRight: 6, fontSize: 12 }} />Save Draft
            </button>
            <button onClick={() => amendMode ? handleAmendSave("nursing") : handleSave(true)} disabled={saving || !patient}
              style={{ padding: "8px 22px", border: "none", borderRadius: 8,
                background: saving ? "#93c5fd" : (amendMode ? "#d97706" : C.accent),
                cursor: saving ? "not-allowed" : "pointer",
                fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 700, color: "white" }}>
              <i className="pi pi-check-circle" style={{ marginRight: 6, fontSize: 12 }} />
              {saving ? "Saving…" : (amendMode ? "Save Amendment" : "Sign & Submit")}
            </button>
          </>)}
        </div>
      </div>

      {/* ── Patient search ── */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
        padding: "14px 20px", marginBottom: 16, display: "flex", alignItems: "center", gap: 12 }}>
        <i className="pi pi-search" style={{ color: C.accent, fontSize: 16 }} />
        <input value={uhid} onChange={e => setUhid(e.target.value.toUpperCase())}
          onKeyDown={e => e.key === "Enter" && loadPatient(uhid)}
          placeholder="Type UHID and press Enter…"
          className="his-field" style={{ maxWidth: 260 }} />
        <button onClick={() => loadPatient(uhid)} disabled={loadingPt}
          style={{ padding: "8px 18px", border: "none", borderRadius: 8, background: C.accent,
            color: "white", cursor: "pointer", fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 600 }}>
          {loadingPt ? <i className="pi pi-spin pi-spinner" /> : "Load Patient"}
        </button>
        {patient && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginLeft: 8 }}>
            <div style={{ width: 36, height: 36, borderRadius: "50%", background: C.accentL,
              border: `2px solid ${C.accent}30`, display: "flex", alignItems: "center", justifyContent: "center",
              fontWeight: 800, fontSize: 14, color: C.accent }}>
              {(patient.fullName || patient.firstName || "?")[0]}
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>
                {patient.title ? patient.title + " " : ""}{patient.fullName || `${patient.firstName} ${patient.lastName}`}
              </div>
              <div style={{ fontSize: 11, color: C.muted }}>
                {patient.UHID} · {patient.age}y / {patient.gender?.[0] || "—"}
                {patient.bloodGroup && (
                  <span style={{ marginLeft: 8, background: C.redL, color: C.red,
                    padding: "1px 6px", borderRadius: 4, fontWeight: 700 }}>{patient.bloodGroup}</span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {!patient && (
        <div style={{ textAlign: "center", padding: "60px 20px", color: C.muted }}>
          <i className="pi pi-user-plus" style={{ fontSize: 40, display: "block", marginBottom: 12, color: "#cbd5e1" }} />
          <div style={{ fontSize: 14, fontWeight: 600 }}>Load a patient to begin IPD Initial Assessment</div>
        </div>
      )}

      {patient && (<>

        {/* ── R7hr-72/lock · LOCKED ribbon ─────────────────────────────
            Visible when the restored note for the active role is signed
            or amended. Amend opens the modal — the only way into edit
            mode. Backend logs the audit row on /amend dispatch. */}
        {iaLocked && !amendMode && (
          <div role="status" style={{
            background: "#fef2f2", border: "2px solid #dc2626", borderRadius: 10,
            padding: "12px 16px", marginBottom: 14, color: "#7f1d1d",
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 18 }} aria-hidden="true">{"🔒"}</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: ".3px" }}>
                  LOCKED — signed by {lockedSignedByName || "—"} on {fmtDT(lockedSignedAt)}.
                </div>
                <div style={{ fontSize: 11, color: "#9f1239", marginTop: 2 }}>
                  Click Amend to edit (audit logged).
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setAmendModalOpen(true)}
              style={{
                padding: "8px 18px", border: "none", borderRadius: 8,
                background: "#dc2626", color: "white", cursor: "pointer",
                fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 800,
                boxShadow: "0 4px 12px rgba(220,38,38,.35)", whiteSpace: "nowrap",
              }}
            >
              <i className="pi pi-pencil" style={{ fontSize: 11, marginRight: 6 }} />
              Amend
            </button>
          </div>
        )}

        {/* ── R7hr-72/lock · AMENDING ribbon ───────────────────────────
            Amber banner while amendMode is true. Cancel reverts the
            mode-flip (snapshot is dropped; we never mutated form state
            on "Begin Amend", just flipped the gate). */}
        {amendMode && (
          <div role="status" style={{
            background: "#fffbeb", border: "2px solid #d97706", borderRadius: 10,
            padding: "12px 16px", marginBottom: 14, color: "#78350f",
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 18 }} aria-hidden="true">{"✏"}</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: ".3px" }}>
                  AMENDING — reason: «{amendReason}».
                </div>
                <div style={{ fontSize: 11, color: "#92400e", marginTop: 2 }}>
                  Make changes then click Save Amendment.
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setAmendMode(false);
                setAmendReason("");
                setPreAmendSnapshot(null);
              }}
              style={{
                padding: "8px 16px", border: "1.5px solid #d97706", borderRadius: 8,
                background: "white", color: "#92400e", cursor: "pointer",
                fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap",
              }}
            >
              Cancel Amend
            </button>
          </div>
        )}

        {/* R7ff · Cross-check banner — appears at top whenever nurse's
            and doctor's independently-captured fields disagree. Sticky
            visibility forces reconciliation before sign-off. */}
        {crossCheckAlerts.length > 0 && (
          <div style={{
            background: "#fef3c7", border: "1.5px solid #f59e0b", borderRadius: 10,
            padding: "12px 16px", marginBottom: 14, color: "#78350f",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <i className="pi pi-exclamation-triangle" style={{ fontSize: 14, color: "#d97706" }} />
              <div style={{ fontSize: 13, fontWeight: 800 }}>
                Cross-check alerts ({crossCheckAlerts.length}) — reconcile before sign
              </div>
              <span style={{ background: "#fef9c3", color: "#78350f", padding: "1px 8px", borderRadius: 4, fontSize: 9, fontWeight: 800, letterSpacing: ".4px" }}>
                NABH PSQ.4
              </span>
            </div>
            <ul style={{ margin: 0, paddingLeft: 22, fontSize: 11.5, lineHeight: 1.55 }}>
              {crossCheckAlerts.map((a, i) => (
                <li key={i} style={{ marginBottom: 2 }}>
                  <span style={{
                    background: a.severity === "high" ? "#fee2e2" : a.severity === "medium" ? "#fef3c7" : "#e0e7ff",
                    color:      a.severity === "high" ? "#b91c1c" : a.severity === "medium" ? "#92400e" : "#3730a3",
                    padding: "1px 6px", borderRadius: 4, fontSize: 9, fontWeight: 800,
                    marginRight: 6, letterSpacing: ".3px",
                  }}>
                    {a.severity.toUpperCase()}
                  </span>
                  <strong>{a.category}:</strong> {a.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* R7fa — Nursing form gate. When a DOCTOR mounts this component
            (via DoctorNotes embed), skip every nursing-shaped section and
            jump straight to the doctor-side form below. Pre-R7fa the
            doctor saw the entire nursing assessment + their own form
            stacked together (confusing + duplicate-data risk). Now the
            page renders one role-appropriate form, never both. */}
        {!isDoctorRole && (<>

          {/* ── Admission Details ── */}
          <Section title="Admission Details" icon="pi-calendar-plus" color={C.teal} disabled={ro}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 14 }}>
              <Field label="Admit Date"><input type="date" value={admitDate} onChange={e => setAdmitDate(e.target.value)} className="his-field" /></Field>
              <Field label="Admit Time"><input type="time" value={admitTime} onChange={e => setAdmitTime(e.target.value)} className="his-field" /></Field>
              <Field label="IPD Number"><input value={ipdNo} onChange={e => setIpdNo(e.target.value)} placeholder="IPD-XXXX" className="his-field" /></Field>
              <Field label="Mode of Admission">
                <select value={modeOfAdmit} onChange={e => setModeOfAdmit(e.target.value)} className="his-field">
                  {["OPD Referral", "Emergency", "Referred from other hospital", "Direct admission", "Day Care", "Other"].map(m => <option key={m}>{m}</option>)}
                </select>
              </Field>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>
              <Field label="Admitting Nurse"><input value={nurseName} onChange={e => setNurseName(e.target.value)} placeholder="Nurse name" className="his-field" /></Field>
              <Field label="Ward"><input value={ward} onChange={e => setWard(e.target.value)} placeholder="Ward name" className="his-field" /></Field>
              <Field label="Bed No."><input value={bedNo} onChange={e => setBedNo(e.target.value)} placeholder="Bed number" className="his-field" /></Field>
              <Field label="Consciousness">
                <select value={consciousnessLevel} onChange={e => setConsciousnessLevel(e.target.value)} className="his-field">
                  {["Alert", "Drowsy", "Confused", "Unconscious", "Sedated"].map(m => <option key={m}>{m}</option>)}
                </select>
              </Field>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
              <Field label="Chief Complaint / Reason for Admission" required>
                <textarea value={chiefComplaint} onChange={e => setChiefComplaint(e.target.value)}
                  placeholder="Patient's presenting complaint…" className="his-textarea" style={{ minHeight: 60 }} />
              </Field>
              <Field label="Known Allergies">
                <textarea value={allergy} onChange={e => setAllergy(e.target.value)}
                  placeholder="Drug / food allergies — None if none" className="his-textarea" style={{ minHeight: 60 }} />
              </Field>
            </div>
          </Section>

          {/* ── Vitals ── */}
          <Section title="Vitals on Admission" icon="pi-heart-fill" color={C.red} badge="NABH Required" disabled={ro}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 12 }}>
              {[
                { label: "BP Systolic", key: "bpSys", unit: "mmHg" },
                { label: "BP Diastolic", key: "bpDia", unit: "mmHg" },
                { label: "Pulse", key: "pulse", unit: "bpm" },
                { label: "Temperature", key: "temp", unit: "°F" },
              ].map(({ label, key, unit }) => (
                <div key={key} style={{ background: C.bg, border: `1.5px solid ${C.border}`, borderRadius: 9, padding: "10px 12px" }}>
                  <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".7px", color: C.muted, marginBottom: 5 }}>{label}</div>
                  <input value={vitals[key]} onChange={e => setV(key)(e.target.value)}
                    className="his-field" style={{ textAlign: "center", fontFamily: "'DM Mono', monospace", fontSize: 16, fontWeight: 700, padding: "4px 8px" }} />
                  <div style={{ fontSize: 9, color: C.muted, textAlign: "center", marginTop: 3 }}>{unit}</div>
                </div>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>
              {[
                { label: "SpO₂", key: "spo2", unit: "%" },
                { label: "Resp Rate", key: "rr", unit: "/min" },
                { label: "Weight", key: "weight", unit: "kg" },
                { label: "Height", key: "height", unit: "cm" },
              ].map(({ label, key, unit }) => (
                <div key={key} style={{ background: C.bg, border: `1.5px solid ${C.border}`, borderRadius: 9, padding: "10px 12px" }}>
                  <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".7px", color: C.muted, marginBottom: 5 }}>{label}</div>
                  <input value={vitals[key]} onChange={e => setV(key)(e.target.value)}
                    className="his-field" style={{ textAlign: "center", fontFamily: "'DM Mono', monospace", fontSize: 16, fontWeight: 700, padding: "4px 8px" }} />
                  <div style={{ fontSize: 9, color: C.muted, textAlign: "center", marginTop: 3 }}>{unit}</div>
                </div>
              ))}
            </div>
          </Section>

          {/* ── Pain ── */}
          <Section title="Pain Assessment" icon="pi-exclamation-circle" color={C.orange} disabled={ro}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <input type="checkbox" id="painPresent" checked={painPresent} onChange={e => setPainPresent(e.target.checked)}
                style={{ accentColor: C.orange, width: 16, height: 16 }} />
              <label htmlFor="painPresent" style={{ fontWeight: 700, fontSize: 13, cursor: "pointer",
                color: painPresent ? C.orange : C.muted }}>Pain present</label>
            </div>
            {painPresent && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr 2fr", gap: 12 }}>
                <Field label="Pain Score (0–10)">
                  <input type="number" min="0" max="10" value={painScore}
                    onChange={e => setPainScore(e.target.value)} className="his-field" />
                </Field>
                <Field label="Location">
                  <input value={painLocation} onChange={e => setPainLocation(e.target.value)}
                    placeholder="e.g. Lower abdomen, chest…" className="his-field" />
                </Field>
                <Field label="Character">
                  <input value={painCharacter} onChange={e => setPainCharacter(e.target.value)}
                    placeholder="Burning, stabbing, dull, colicky…" className="his-field" />
                </Field>
              </div>
            )}
          </Section>

          {/* ── Skin & Devices ── */}
          <Section title="Skin Integrity & Medical Devices" icon="pi-user" color={C.purple} disabled={ro}>
            <Grid2>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase",
                  letterSpacing: ".6px", marginBottom: 8 }}>Skin Integrity</div>
                <div style={{ display: "flex", gap: 12, marginBottom: 10 }}>
                  {["Intact", "Not Intact"].map(v => (
                    <label key={v} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer",
                      fontWeight: 700, fontSize: 13, color: (skinIntact ? "Intact" : "Not Intact") === v ? C.accent : C.muted }}>
                      <input type="radio" checked={(skinIntact ? "Intact" : "Not Intact") === v}
                        onChange={() => setSkinIntact(v === "Intact")}
                        style={{ accentColor: C.accent }} /> {v}
                    </label>
                  ))}
                </div>
                {!skinIntact && (
                  <textarea value={skinNotes} onChange={e => setSkinNotes(e.target.value)}
                    placeholder="Location and description of wounds, rashes, pressure areas…"
                    className="his-textarea" style={{ minHeight: 60 }} />
                )}
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase",
                  letterSpacing: ".6px", marginBottom: 8 }}>Medical Devices / Access</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 20px" }}>
                  {[
                    { key: "ivAccess", label: "IV Access" },
                    { key: "centralLine", label: "Central Line" },
                    { key: "urinaryCatheter", label: "Urinary Catheter" },
                    { key: "nasogastricTube", label: "Nasogastric Tube" },
                    { key: "rylesTube", label: "Ryle's Tube" },
                    { key: "oxygenSupport", label: "Oxygen Support" },
                  ].map(({ key, label }) => (
                    <label key={key} style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer",
                      fontWeight: devices[key] ? 700 : 400, fontSize: 13,
                      color: devices[key] ? C.accent : C.muted }}>
                      <input type="checkbox" checked={!!devices[key]} onChange={setDev(key)}
                        style={{ accentColor: C.accent, width: 14, height: 14 }} />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
            </Grid2>
          </Section>

          {/* ── MORSE FALL SCALE ── */}
          <Section title="Morse Fall Scale" icon="pi-exclamation-triangle" color={C.amber} badge="NABH Required" disabled={ro}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 20, alignItems: "start" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {MORSE_ITEMS.map(item => (
                  <div key={item.key}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 6 }}>{item.label}</div>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      {item.options.map(opt => (
                        <label key={opt.score} style={{
                          display: "flex", alignItems: "center", gap: 6, cursor: "pointer",
                          padding: "5px 12px", borderRadius: 7,
                          border: `1.5px solid ${morse[item.key] === opt.score ? C.amber : C.border}`,
                          background: morse[item.key] === opt.score ? C.amberL : "white",
                          fontWeight: morse[item.key] === opt.score ? 700 : 400,
                          fontSize: 12, color: morse[item.key] === opt.score ? C.amber : C.muted,
                        }}>
                          <input type="radio" name={`morse_${item.key}`}
                            checked={morse[item.key] === opt.score}
                            onChange={() => setMorse(m => ({ ...m, [item.key]: opt.score }))}
                            style={{ display: "none" }} />
                          {opt.label}
                          <span style={{ fontFamily: "'DM Mono', monospace", fontWeight: 700, fontSize: 11,
                            color: C.amber }}>(+{opt.score})</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <ScoreBadge score={morseTotal} label="Morse Score" risk={morseMeta.label} color={morseMeta.color} />
            </div>
          </Section>

          {/* ── BRADEN SCALE ── */}
          <Section title="Braden Scale — Pressure Ulcer Risk" icon="pi-th-large" color={C.purple} badge="NABH Required" disabled={ro}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 20, alignItems: "start" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {BRADEN_ITEMS.map(item => (
                  <div key={item.key}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 6 }}>{item.label}</div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {item.options.map(opt => (
                        <label key={opt.score} style={{
                          display: "flex", alignItems: "center", gap: 5, cursor: "pointer",
                          padding: "5px 11px", borderRadius: 7,
                          border: `1.5px solid ${braden[item.key] === opt.score ? C.purple : C.border}`,
                          background: braden[item.key] === opt.score ? C.purpleL : "white",
                          fontWeight: braden[item.key] === opt.score ? 700 : 400,
                          fontSize: 12, color: braden[item.key] === opt.score ? C.purple : C.muted,
                        }}>
                          <input type="radio" name={`braden_${item.key}`}
                            checked={braden[item.key] === opt.score}
                            onChange={() => setBraden(b => ({ ...b, [item.key]: opt.score }))}
                            style={{ display: "none" }} />
                          {opt.label}
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div>
                <ScoreBadge score={bradenTotal} label="Braden Score" risk={bradenMeta.label} color={bradenMeta.color} />
                <div style={{ fontSize: 10, color: C.muted, marginTop: 8, textAlign: "center" }}>Lower = more risk</div>
              </div>
            </div>
          </Section>

          {/* ── NRS-2002 Nutritional Screen ── */}
          <Section title="Nutritional Risk Screening (NRS-2002)" icon="pi-chart-bar" color={C.green} badge="NABH Required" disabled={ro}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 20, alignItems: "start" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {NUTRI_ITEMS.map(item => (
                  <div key={item.key}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 6 }}>{item.label}</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {item.options.map(opt => (
                        <label key={opt.score} style={{
                          display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
                          padding: "6px 12px", borderRadius: 7,
                          border: `1.5px solid ${nutri[item.key] === opt.score ? C.green : C.border}`,
                          background: nutri[item.key] === opt.score ? C.greenL : "white",
                          fontWeight: nutri[item.key] === opt.score ? 700 : 400,
                          fontSize: 12, color: nutri[item.key] === opt.score ? C.green : C.muted,
                        }}>
                          <input type="radio" name={`nutri_${item.key}`}
                            checked={nutri[item.key] === opt.score}
                            onChange={() => setNutri(n => ({ ...n, [item.key]: opt.score }))}
                            style={{ display: "none" }} />
                          {opt.label}
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div>
                <ScoreBadge score={nutriTotal} label="NRS Score" risk={nutriMeta.label} color={nutriMeta.color} />
                {nutriTotal >= 3 && (
                  <div style={{ marginTop: 10, background: C.redL, border: `1px solid ${C.red}30`,
                    borderRadius: 8, padding: "8px 10px", fontSize: 11, color: C.red, fontWeight: 600 }}>
                    ⚠ Refer to Dietician
                  </div>
                )}
              </div>
            </div>
          </Section>

          {/* R7fc · Caprini VTE removed from nursing — DVT/VTE is a
              medico-decisional assessment (drives anticoagulation
              prescribing). Moved to Doctor's "Care Decisions → Risk
              Acknowledgement → DVT" row, which now carries the Caprini
              score + plan. Nurses continue to flag suspected DVT in
              vitals + ongoing observations as before. */}

          {/* ══════════════════════════════════════════════════════════
              R7fc · NURSE P0 NABH FIELDS (N1-N10)
              Inserted between the risk-scale block and the care-plan
              block so all the nursing P0 items live together. Each new
              section is tagged with the NABH chapter that requires it,
              so an inspector can map field → standard at a glance.
              ══════════════════════════════════════════════════════════ */}

          {/* ── N1 · Patient Identification (PSQ.1 two-identifier) ── */}
          <Section title="Patient Identification" icon="pi-id-card" color={C.teal} badge="NABH PSQ.1" disabled={ro}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 12, fontSize: 12 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                <input type="checkbox" checked={idBand.bandAttached}
                  onChange={e => setIdBand(b => ({ ...b, bandAttached: e.target.checked }))} />
                ID band physically attached to patient
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                <input type="checkbox" checked={idBand.nameVerified}
                  onChange={e => setIdBand(b => ({ ...b, nameVerified: e.target.checked }))} />
                Name verified with patient / family
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                <input type="checkbox" checked={idBand.uhidVerified}
                  onChange={e => setIdBand(b => ({ ...b, uhidVerified: e.target.checked }))} />
                UHID matches admission paper
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                <input type="checkbox" checked={idBand.dobVerified}
                  onChange={e => setIdBand(b => ({ ...b, dobVerified: e.target.checked }))} />
                DOB / age verified with patient
              </label>
            </div>
            <Field label="Verified by (nurse name)" style={{ marginTop: 10 }}>
              <input value={idBand.verifiedBy} onChange={e => setIdBand(b => ({ ...b, verifiedBy: e.target.value }))}
                placeholder="Nurse who completed two-identifier check" className="his-field" />
            </Field>
          </Section>

          {/* ── N4 · Anthropometry (drug dosing safety) ── */}
          <Section title="Anthropometry" icon="pi-chart-bar" color={C.teal} disabled={ro}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              <Field label="Height (cm)">
                <input type="number" value={anthropo.heightCm}
                  onChange={e => {
                    const h = e.target.value;
                    const w = Number(anthropo.weightKg);
                    const hM = Number(h) / 100;
                    const bmi = (h && w && hM > 0) ? (w / (hM * hM)).toFixed(1) : "";
                    setAnthropo(a => ({ ...a, heightCm: h, bmi }));
                  }} placeholder="e.g. 168" className="his-field" />
              </Field>
              <Field label="Weight (kg)">
                <input type="number" value={anthropo.weightKg}
                  onChange={e => {
                    const w = e.target.value;
                    const h = Number(anthropo.heightCm) / 100;
                    const bmi = (w && h > 0) ? (Number(w) / (h * h)).toFixed(1) : "";
                    setAnthropo(a => ({ ...a, weightKg: w, bmi }));
                  }} placeholder="e.g. 68" className="his-field" />
              </Field>
              <Field label="BMI (auto)">
                <input value={anthropo.bmi} readOnly placeholder="—"
                  className="his-field" style={{ background: "#f8fafc", fontWeight: 700 }} />
              </Field>
            </div>
          </Section>

          {/* ── N2 · Allergies (independent of doctor capture) ── */}
          <Section title="Allergies (Nursing check)" icon="pi-shield" color={C.red} badge="NABH PSQ.4" disabled={ro}>
            <div style={{ marginBottom: 8 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: C.muted, cursor: "pointer" }}>
                <input type="checkbox" checked={nurseNoKnownAllergies}
                  onChange={e => { setNurseNoKnownAllergies(e.target.checked); if (e.target.checked) setNurseAllergyList([]); }} />
                NKDA — No known drug allergies declared by patient / family
              </label>
            </div>
            {!nurseNoKnownAllergies && (
              <>
                {nurseAllergyList.length > 0 && (
                  <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 6, fontSize: 11.5 }}>
                    <thead>
                      <tr style={{ background: C.redL }}>
                        {["Type", "Agent", "Severity", "Reaction", ""].map(h => (
                          <th key={h} style={{ padding: "6px 8px", textAlign: "left", fontSize: 10, fontWeight: 700, color: C.red, textTransform: "uppercase", borderBottom: `1.5px solid ${C.red}30` }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {nurseAllergyList.map((a, i) => (
                        <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                          <td style={{ padding: "6px 8px" }}>
                            <select value={a.type || "Drug"} onChange={e => setNurseAllergyList(l => l.map((x, j) => j === i ? { ...x, type: e.target.value } : x))} className="his-field" style={{ padding: "4px 6px" }}>
                              {["Drug", "Food", "Latex", "Contact", "Environmental", "Other"].map(t => <option key={t}>{t}</option>)}
                            </select>
                          </td>
                          <td><input value={a.agent || ""} onChange={e => setNurseAllergyList(l => l.map((x, j) => j === i ? { ...x, agent: e.target.value } : x))} placeholder="Agent" className="his-field" style={{ padding: "4px 6px" }} /></td>
                          <td>
                            <select value={a.severity || "Mild"} onChange={e => setNurseAllergyList(l => l.map((x, j) => j === i ? { ...x, severity: e.target.value } : x))} className="his-field" style={{ padding: "4px 6px" }}>
                              {["Mild", "Moderate", "Severe", "Anaphylaxis"].map(t => <option key={t}>{t}</option>)}
                            </select>
                          </td>
                          <td><input value={a.reaction || ""} onChange={e => setNurseAllergyList(l => l.map((x, j) => j === i ? { ...x, reaction: e.target.value } : x))} placeholder="Reaction" className="his-field" style={{ padding: "4px 6px" }} /></td>
                          <td>
                            <button onClick={() => setNurseAllergyList(l => l.filter((_, j) => j !== i))} style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer" }}>
                              <i className="pi pi-trash" style={{ fontSize: 12 }} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <button onClick={() => setNurseAllergyList(l => [...l, { type: "Drug", agent: "", severity: "Mild", reaction: "" }])}
                  style={{ padding: "5px 12px", border: `1.5px dashed ${C.red}60`, borderRadius: 6, background: C.redL, cursor: "pointer", fontSize: 11.5, fontWeight: 600, color: C.red }}>
                  <i className="pi pi-plus" style={{ marginRight: 5, fontSize: 10 }} />Add allergy
                </button>
              </>
            )}
          </Section>

          {/* ── N3 · Brief PMH + Home Medications ── */}
          <Section title="Brief History & Home Medications" icon="pi-list" color={C.purple} badge="NABH MOM" disabled={ro}>
            <Field label="Past Medical History (brief — for nursing context)" style={{ marginBottom: 10 }}>
              <textarea value={nurseBriefPmh} onChange={e => setNurseBriefPmh(e.target.value)}
                placeholder="e.g. DM on insulin since 2018, HTN, post-MI 2022…"
                className="his-textarea" style={{ minHeight: 56 }} />
            </Field>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: C.muted, marginBottom: 6 }}>Home medications brought / declared</div>
            {homeMeds.length > 0 && (
              <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 6, fontSize: 11.5 }}>
                <thead>
                  <tr style={{ background: "#f8fafc" }}>
                    {["Drug", "Dose", "Frequency", "Last taken", ""].map(h => (
                      <th key={h} style={{ padding: "6px 8px", textAlign: "left", fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase", borderBottom: `1.5px solid ${C.border}` }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {homeMeds.map((m, i) => (
                    <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                      <td><input value={m.drug || ""} onChange={e => setHomeMeds(l => l.map((x, j) => j === i ? { ...x, drug: e.target.value } : x))} placeholder="Drug" className="his-field" style={{ padding: "4px 6px" }} /></td>
                      <td><input value={m.dose || ""} onChange={e => setHomeMeds(l => l.map((x, j) => j === i ? { ...x, dose: e.target.value } : x))} placeholder="Dose" className="his-field" style={{ padding: "4px 6px" }} /></td>
                      <td><input value={m.frequency || ""} onChange={e => setHomeMeds(l => l.map((x, j) => j === i ? { ...x, frequency: e.target.value } : x))} placeholder="OD/BD" className="his-field" style={{ padding: "4px 6px" }} /></td>
                      <td><input value={m.lastTaken || ""} onChange={e => setHomeMeds(l => l.map((x, j) => j === i ? { ...x, lastTaken: e.target.value } : x))} placeholder="Date/Time" className="his-field" style={{ padding: "4px 6px" }} /></td>
                      <td><button onClick={() => setHomeMeds(l => l.filter((_, j) => j !== i))} style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer" }}><i className="pi pi-trash" style={{ fontSize: 12 }} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <button onClick={() => setHomeMeds(l => [...l, { drug: "", dose: "", frequency: "", lastTaken: "" }])}
              style={{ padding: "5px 12px", border: `1.5px dashed ${C.purple}60`, borderRadius: 6, background: "#f5f3ff", cursor: "pointer", fontSize: 11.5, fontWeight: 600, color: C.purple }}>
              <i className="pi pi-plus" style={{ marginRight: 5, fontSize: 10 }} />Add home medicine
            </button>
          </Section>

          {/* ── N5 · Psychosocial Assessment ── */}
          <Section title="Psychosocial Assessment" icon="pi-heart" color={C.pink} badge="NABH AAC.1.b" disabled={ro}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              <Field label="Emotional state">
                <select value={psychosocial.emotionalState} onChange={e => setPsychosocial(p => ({ ...p, emotionalState: e.target.value }))} className="his-field">
                  {["Calm", "Anxious", "Depressed", "Agitated", "Withdrawn", "Confused"].map(o => <option key={o}>{o}</option>)}
                </select>
              </Field>
              <Field label="Family support">
                <select value={psychosocial.familySupport} onChange={e => setPsychosocial(p => ({ ...p, familySupport: e.target.value }))} className="his-field">
                  {["Adequate", "Limited", "Absent"].map(o => <option key={o}>{o}</option>)}
                </select>
              </Field>
              <Field label="Preferred language">
                <select value={psychosocial.languagePreferred} onChange={e => setPsychosocial(p => ({ ...p, languagePreferred: e.target.value }))} className="his-field">
                  {["Hindi", "English", "Punjabi", "Haryanvi", "Urdu", "Bengali", "Tamil", "Telugu", "Marathi", "Other"].map(o => <option key={o}>{o}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Mood / affect / additional notes" style={{ marginTop: 10 }}>
              <textarea value={psychosocial.notes} onChange={e => setPsychosocial(p => ({ ...p, notes: e.target.value }))}
                placeholder="Affect, suicidal ideation screening, recent loss, financial stress…"
                className="his-textarea" style={{ minHeight: 56 }} />
            </Field>
          </Section>

          {/* ── N6 · Functional / ADL (Barthel Index) ── */}
          <Section title="Functional Assessment — Barthel ADL" icon="pi-check-square" color={C.teal} badge="NABH AAC.1.b" disabled={ro}>
            {(() => {
              const cfg = [
                ["feeding", "Feeding", [[0,"Unable"],[5,"Needs help"],[10,"Independent"]]],
                ["bathing", "Bathing", [[0,"Dependent"],[5,"Independent"]]],
                ["grooming", "Grooming", [[0,"Needs help"],[5,"Independent"]]],
                ["dressing", "Dressing", [[0,"Unable"],[5,"Needs help"],[10,"Independent"]]],
                ["bowels", "Bowels", [[0,"Incontinent"],[5,"Occasional"],[10,"Continent"]]],
                ["bladder", "Bladder", [[0,"Incontinent / catheterised"],[5,"Occasional"],[10,"Continent"]]],
                ["toilet", "Toilet use", [[0,"Dependent"],[5,"Needs help"],[10,"Independent"]]],
                ["transfer", "Transfer (bed↔chair)", [[0,"Unable"],[5,"Major help"],[10,"Minor help"],[15,"Independent"]]],
                ["mobility", "Mobility (level surface)", [[0,"Immobile"],[5,"Wheelchair"],[10,"Walks with help"],[15,"Independent"]]],
                ["stairs", "Stairs", [[0,"Unable"],[5,"Needs help"],[10,"Independent"]]],
              ];
              const total = cfg.reduce((s, [k]) => s + Number(barthel[k] || 0), 0);
              return (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 8, fontSize: 11.5 }}>
                    {cfg.map(([k, label, opts]) => (
                      <div key={k} style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: 6, alignItems: "center" }}>
                        <span style={{ fontWeight: 600, color: C.muted }}>{label}</span>
                        <select value={barthel[k]} onChange={e => setBarthel(b => ({ ...b, [k]: Number(e.target.value) }))} className="his-field" style={{ padding: "4px 6px" }}>
                          {opts.map(([v, lbl]) => <option key={v} value={v}>{v} — {lbl}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: 10, padding: "8px 12px", background: total >= 80 ? C.greenL : total >= 60 ? C.warnL : C.redL,
                    border: `1.5px solid ${total >= 80 ? C.green : total >= 60 ? C.warn : C.red}30`, borderRadius: 8, fontSize: 12, fontWeight: 700, color: C.text }}>
                    Total Barthel score: <strong>{total} / 100</strong>
                    <span style={{ color: C.muted, marginLeft: 8, fontWeight: 500 }}>
                      ({total >= 80 ? "Independent" : total >= 60 ? "Mild dependence" : total >= 40 ? "Moderate dependence" : total >= 20 ? "Severe dependence" : "Total dependence"})
                    </span>
                  </div>
                </>
              );
            })()}
          </Section>

          {/* ── N7 · Body Chart / Wound Documentation ── */}
          <Section title="Body Chart — Existing wounds / bruises / scars" icon="pi-user-edit" color={C.purple} badge="NABH IPC + AAC.6" disabled={ro}>
            <div style={{ fontSize: 10.5, color: C.muted, marginBottom: 8 }}>
              Document all existing skin findings AT ADMISSION — defends against "developed in hospital" claims.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Field label="Head / Neck"><input value={bodyChart.headNeck} onChange={e => setBodyChart(b => ({ ...b, headNeck: e.target.value }))} placeholder="Wound location + size + appearance" className="his-field" /></Field>
              <Field label="Chest / Back"><input value={bodyChart.chestBack} onChange={e => setBodyChart(b => ({ ...b, chestBack: e.target.value }))} placeholder="—" className="his-field" /></Field>
              <Field label="Abdomen / Groin"><input value={bodyChart.abdomenGroin} onChange={e => setBodyChart(b => ({ ...b, abdomenGroin: e.target.value }))} placeholder="—" className="his-field" /></Field>
              <Field label="Upper limbs"><input value={bodyChart.upperLimbs} onChange={e => setBodyChart(b => ({ ...b, upperLimbs: e.target.value }))} placeholder="—" className="his-field" /></Field>
              <Field label="Lower limbs"><input value={bodyChart.lowerLimbs} onChange={e => setBodyChart(b => ({ ...b, lowerLimbs: e.target.value }))} placeholder="—" className="his-field" /></Field>
              <Field label="Existing pressure injuries / bedsores"><input value={bodyChart.existingWounds} onChange={e => setBodyChart(b => ({ ...b, existingWounds: e.target.value }))} placeholder="Stage + location" className="his-field" /></Field>
            </div>
            <Field label="Bruises / scars / other markings" style={{ marginTop: 10 }}>
              <textarea value={bodyChart.existingBruises} onChange={e => setBodyChart(b => ({ ...b, existingBruises: e.target.value }))}
                placeholder="Describe location, colour, age of bruise…"
                className="his-textarea" style={{ minHeight: 50 }} />
            </Field>
          </Section>

          {/* ── N10 · Special Precautions ── */}
          <Section title="Special Precautions" icon="pi-exclamation-triangle" color={C.warn} badge="NABH IPC + PSQ.4" disabled={ro}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
              <div>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 600, marginBottom: 6, cursor: "pointer" }}>
                  <input type="checkbox" checked={precautions.isolation.required}
                    onChange={e => setPrecautions(p => ({ ...p, isolation: { ...p.isolation, required: e.target.checked } }))} />
                  Isolation required
                </label>
                {precautions.isolation.required && (
                  <select value={precautions.isolation.type}
                    onChange={e => setPrecautions(p => ({ ...p, isolation: { ...p.isolation, type: e.target.value } }))}
                    className="his-field" style={{ padding: "5px 8px" }}>
                    <option value="">— Select type —</option>
                    {["Contact", "Droplet", "Airborne", "Protective / Reverse"].map(o => <option key={o}>{o}</option>)}
                  </select>
                )}
              </div>
              <div>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 600, marginBottom: 6, cursor: "pointer" }}>
                  <input type="checkbox" checked={precautions.restraints.required}
                    onChange={e => setPrecautions(p => ({ ...p, restraints: { ...p.restraints, required: e.target.checked } }))} />
                  Restraints required
                </label>
                {precautions.restraints.required && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                    <input value={precautions.restraints.type}
                      onChange={e => setPrecautions(p => ({ ...p, restraints: { ...p.restraints, type: e.target.value } }))}
                      placeholder="Type (soft / bed rail)" className="his-field" style={{ padding: "5px 8px" }} />
                    <input value={precautions.restraints.reason}
                      onChange={e => setPrecautions(p => ({ ...p, restraints: { ...p.restraints, reason: e.target.value } }))}
                      placeholder="Reason" className="his-field" style={{ padding: "5px 8px" }} />
                  </div>
                )}
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, fontSize: 12 }}>
              {[
                ["suicide", "Suicide precaution"],
                ["fallPrecaution", "Fall precaution"],
                ["aspiration", "Aspiration precaution"],
                ["bleed", "Bleeding precaution"],
                ["seizure", "Seizure precaution"],
                ["mri", "MRI safety alert"],
                ["latex", "Latex-free environment"],
              ].map(([k, label]) => (
                <label key={k} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                  <input type="checkbox" checked={!!precautions[k]}
                    onChange={e => setPrecautions(p => ({ ...p, [k]: e.target.checked }))} />
                  {label}
                </label>
              ))}
            </div>
          </Section>

          {/* ── N9 · Education Needs ── */}
          <Section title="Patient Education Needs" icon="pi-book" color={C.green} badge="NABH AAC.6 + PRE.5" disabled={ro}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 12 }}>
              <Field label="Preferred language">
                <select value={educationNeeds.preferredLanguage}
                  onChange={e => setEducationNeeds(p => ({ ...p, preferredLanguage: e.target.value }))} className="his-field">
                  {["Hindi", "English", "Punjabi", "Haryanvi", "Urdu", "Bengali", "Tamil", "Telugu", "Marathi", "Other"].map(o => <option key={o}>{o}</option>)}
                </select>
              </Field>
              <Field label="Preferred learning style">
                <select value={educationNeeds.learningStyle}
                  onChange={e => setEducationNeeds(p => ({ ...p, learningStyle: e.target.value }))} className="his-field">
                  {["Verbal", "Written", "Demonstration", "Mixed"].map(o => <option key={o}>{o}</option>)}
                </select>
              </Field>
              <Field label="Target audience (who will receive teaching?)">
                <select value={educationNeeds.targetAudience}
                  onChange={e => setEducationNeeds(p => ({ ...p, targetAudience: e.target.value }))} className="his-field">
                  {["Self", "Spouse", "Parent", "Adult-child", "Sibling", "Caregiver", "LAR"].map(o => <option key={o}>{o}</option>)}
                </select>
              </Field>
              <div style={{ display: "flex", alignItems: "center", gap: 18, paddingTop: 24 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }}>
                  <input type="checkbox" checked={educationNeeds.canRead}
                    onChange={e => setEducationNeeds(p => ({ ...p, canRead: e.target.checked }))} />
                  Can read
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }}>
                  <input type="checkbox" checked={educationNeeds.canWrite}
                    onChange={e => setEducationNeeds(p => ({ ...p, canWrite: e.target.checked }))} />
                  Can write
                </label>
              </div>
            </div>
            <Field label="Barriers to learning" style={{ marginTop: 10 }}>
              <input value={educationNeeds.barriersToLearning}
                onChange={e => setEducationNeeds(p => ({ ...p, barriersToLearning: e.target.value }))}
                placeholder="e.g. Hearing impairment, anxiety, cognitive impairment" className="his-field" />
            </Field>
          </Section>

          {/* ── N8 · Discharge Planning (initiated Day 1) ── */}
          <Section title="Discharge Planning — Day 1" icon="pi-home" color={C.accent} badge="NABH AAC.4" disabled={ro}>
            <div style={{ fontSize: 10.5, color: C.muted, marginBottom: 8 }}>
              Discharge planning starts at admission — gives time to arrange home support, equipment, follow-up.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Home support">
                <select value={dischargePlan.homeSupport}
                  onChange={e => setDischargePlan(p => ({ ...p, homeSupport: e.target.value }))} className="his-field">
                  <option value="">— Select —</option>
                  {["Lives with family", "Lives alone", "Lives in institution / care home", "Homeless / no fixed address"].map(o => <option key={o}>{o}</option>)}
                </select>
              </Field>
              <Field label="Primary caregiver (name + relation)">
                <input value={dischargePlan.primaryCaregiver}
                  onChange={e => setDischargePlan(p => ({ ...p, primaryCaregiver: e.target.value }))}
                  placeholder="e.g. Wife — Mrs Smita Sharma" className="his-field" />
              </Field>
              <Field label="Transport needs at discharge">
                <select value={dischargePlan.transportNeed}
                  onChange={e => setDischargePlan(p => ({ ...p, transportNeed: e.target.value }))} className="his-field">
                  <option value="">— Select —</option>
                  {["Own transport", "Hospital ambulance", "Wheelchair transport", "Other"].map(o => <option key={o}>{o}</option>)}
                </select>
              </Field>
              <Field label="Anticipated barriers to discharge">
                <input value={dischargePlan.anticipatedBarriers}
                  onChange={e => setDischargePlan(p => ({ ...p, anticipatedBarriers: e.target.value }))}
                  placeholder="e.g. No-one at home, ground-floor access only" className="his-field" />
              </Field>
            </div>
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, marginBottom: 6, textTransform: "uppercase", letterSpacing: ".4px" }}>
                Equipment likely needed at discharge
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, fontSize: 12 }}>
                {["Walker", "Wheelchair", "Oxygen concentrator", "Commode", "Hospital bed", "Suction machine", "Nebuliser", "Glucometer"].map(item => (
                  <label key={item} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                    <input type="checkbox" checked={dischargePlan.equipmentNeeded.includes(item)}
                      onChange={e => setDischargePlan(p => ({
                        ...p,
                        equipmentNeeded: e.target.checked
                          ? [...p.equipmentNeeded, item]
                          : p.equipmentNeeded.filter(x => x !== item),
                      }))} />
                    {item}
                  </label>
                ))}
              </div>
            </div>
          </Section>

          {/* ══════════════════════════════════════════════════════════
              R7fd · NURSE P1 NABH FIELDS (N11-N17)
              ══════════════════════════════════════════════════════════ */}

          {/* ── N11 · Cognitive / Communication ── */}
          <Section title="Cognitive & Communication" icon="pi-eye" color={C.purple} badge="NABH AAC.1.b" disabled={ro}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, marginBottom: 6, textTransform: "uppercase", letterSpacing: ".4px" }}>
              Orientation
            </div>
            <div style={{ display: "flex", gap: 18, fontSize: 12, marginBottom: 10 }}>
              {[
                ["orientationPerson", "Oriented to Person"],
                ["orientationPlace", "Oriented to Place"],
                ["orientationTime", "Oriented to Time"],
              ].map(([k, label]) => (
                <label key={k} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                  <input type="checkbox" checked={!!cognitive[k]}
                    onChange={e => setCognitive(c => ({ ...c, [k]: e.target.checked }))} />
                  {label}
                </label>
              ))}
            </div>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, marginBottom: 6, textTransform: "uppercase", letterSpacing: ".4px" }}>
              Sensory deficits
            </div>
            <div style={{ display: "flex", gap: 18, fontSize: 12, marginBottom: 10 }}>
              {[
                ["visionDeficit", "Vision deficit"],
                ["hearingDeficit", "Hearing deficit"],
                ["speechDeficit", "Speech deficit / aphasia"],
              ].map(([k, label]) => (
                <label key={k} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                  <input type="checkbox" checked={!!cognitive[k]}
                    onChange={e => setCognitive(c => ({ ...c, [k]: e.target.checked }))} />
                  {label}
                </label>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Aids used (glasses / hearing aid / dentures)">
                <input value={cognitive.aidsUsed}
                  onChange={e => setCognitive(c => ({ ...c, aidsUsed: e.target.value }))}
                  placeholder="e.g. Spectacles, dentures (upper)" className="his-field" />
              </Field>
              <Field label="GCS (if applicable)">
                <input value={cognitive.gcs}
                  onChange={e => setCognitive(c => ({ ...c, gcs: e.target.value }))}
                  placeholder="e.g. E4 V5 M6 = 15/15" className="his-field" />
              </Field>
            </div>
            <Field label="Additional notes" style={{ marginTop: 10 }}>
              <textarea value={cognitive.notes}
                onChange={e => setCognitive(c => ({ ...c, notes: e.target.value }))}
                placeholder="Confusion, dementia history, communication preferences…"
                className="his-textarea" style={{ minHeight: 50 }} />
            </Field>
          </Section>

          {/* ── N12 · Cultural / Spiritual ── */}
          <Section title="Cultural & Spiritual Preferences" icon="pi-globe" color={C.green} badge="NABH ROP" disabled={ro}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Religion">
                <select value={cultural.religion}
                  onChange={e => setCultural(p => ({ ...p, religion: e.target.value }))} className="his-field">
                  <option value="">— Select / decline —</option>
                  {["Hindu", "Muslim", "Christian", "Sikh", "Buddhist", "Jain", "Parsi", "Jewish", "Atheist / None", "Other"].map(o => <option key={o}>{o}</option>)}
                </select>
              </Field>
              <Field label="Dietary restrictions">
                <select value={cultural.dietaryRestrictions}
                  onChange={e => setCultural(p => ({ ...p, dietaryRestrictions: e.target.value }))} className="his-field">
                  <option value="">— Select —</option>
                  {["No restrictions", "Vegetarian", "Vegan", "Non-vegetarian", "Halal", "Jain (no root vegetables)", "Kosher", "Eggetarian", "Other"].map(o => <option key={o}>{o}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Spiritual / religious needs (prayer, visits from clergy, fasting)" style={{ marginTop: 10 }}>
              <input value={cultural.spiritualNeeds}
                onChange={e => setCultural(p => ({ ...p, spiritualNeeds: e.target.value }))}
                placeholder="e.g. Pre-dawn prayer, weekly visit from temple, Ramzan fasting" className="his-field" />
            </Field>
            <Field label="Care customs / preferences" style={{ marginTop: 10 }}>
              <input value={cultural.customs}
                onChange={e => setCultural(p => ({ ...p, customs: e.target.value }))}
                placeholder="e.g. Same-gender caregiver preferred, family-decision-maker, modesty" className="his-field" />
            </Field>
          </Section>

          {/* ── N13 · Bowel / Bladder Pattern ── */}
          <Section title="Bowel / Bladder Pattern" icon="pi-sync" color={C.teal} disabled={ro}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, marginBottom: 6, textTransform: "uppercase", letterSpacing: ".4px" }}>Bowel</div>
                <Field label="Continence">
                  <select value={elimination.bowelContinence}
                    onChange={e => setElimination(p => ({ ...p, bowelContinence: e.target.value }))} className="his-field">
                    {["Continent", "Occasional incontinence", "Incontinent", "Colostomy / Ileostomy"].map(o => <option key={o}>{o}</option>)}
                  </select>
                </Field>
                <Field label="Last bowel movement">
                  <input value={elimination.bowelLastBM}
                    onChange={e => setElimination(p => ({ ...p, bowelLastBM: e.target.value }))}
                    placeholder="Date / today / 3 days ago" className="his-field" />
                </Field>
                <Field label="Frequency / character">
                  <input value={elimination.bowelFrequency}
                    onChange={e => setElimination(p => ({ ...p, bowelFrequency: e.target.value }))}
                    placeholder="Once daily, soft / diarrhoea x 4 stools" className="his-field" />
                </Field>
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, marginBottom: 6, textTransform: "uppercase", letterSpacing: ".4px" }}>Bladder</div>
                <Field label="Continence">
                  <select value={elimination.bladderContinence}
                    onChange={e => setElimination(p => ({ ...p, bladderContinence: e.target.value }))} className="his-field">
                    {["Continent", "Occasional incontinence", "Incontinent", "Urinary retention"].map(o => <option key={o}>{o}</option>)}
                  </select>
                </Field>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer", marginTop: 10 }}>
                  <input type="checkbox" checked={elimination.bladderCatheterised}
                    onChange={e => setElimination(p => ({ ...p, bladderCatheterised: e.target.checked }))} />
                  Currently catheterised
                </label>
                <Field label="24-hour urine output (mL)" style={{ marginTop: 6 }}>
                  <input type="number" value={elimination.bladderOutput24h}
                    onChange={e => setElimination(p => ({ ...p, bladderOutput24h: e.target.value }))}
                    placeholder="e.g. 1400" className="his-field" />
                </Field>
              </div>
            </div>
            <Field label="Notes" style={{ marginTop: 10 }}>
              <input value={elimination.notes}
                onChange={e => setElimination(p => ({ ...p, notes: e.target.value }))}
                placeholder="e.g. Burning micturition, BPH, recent laxative use" className="his-field" />
            </Field>
          </Section>

          {/* ── N14 · Sleep Pattern ── */}
          <Section title="Sleep Pattern" icon="pi-moon" color={C.accent} disabled={ro}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              <Field label="Hours per night">
                <input type="number" value={sleep.hoursPerNight}
                  onChange={e => setSleep(p => ({ ...p, hoursPerNight: e.target.value }))}
                  placeholder="e.g. 6" className="his-field" />
              </Field>
              <Field label="Sleep quality">
                <select value={sleep.quality}
                  onChange={e => setSleep(p => ({ ...p, quality: e.target.value }))} className="his-field">
                  {["Good", "Disturbed", "Poor", "Insomnia"].map(o => <option key={o}>{o}</option>)}
                </select>
              </Field>
              <Field label="Sleep aids used">
                <input value={sleep.sleepAids}
                  onChange={e => setSleep(p => ({ ...p, sleepAids: e.target.value }))}
                  placeholder="e.g. Alprazolam 0.25mg HS" className="his-field" />
              </Field>
            </div>
            <div style={{ display: "flex", gap: 18, marginTop: 10, fontSize: 12 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                <input type="checkbox" checked={sleep.snoring}
                  onChange={e => setSleep(p => ({ ...p, snoring: e.target.checked }))} />
                Snoring reported
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                <input type="checkbox" checked={sleep.apneaDx}
                  onChange={e => setSleep(p => ({ ...p, apneaDx: e.target.checked }))} />
                Diagnosed sleep apnea
              </label>
            </div>
          </Section>

          {/* ── N15 · Valuables / Belongings ── */}
          <Section title="Valuables & Belongings" icon="pi-briefcase" color={C.warn} badge="NABH ROP + PSQ" disabled={ro}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Status">
                <select value={valuables.status}
                  onChange={e => setValuables(p => ({ ...p, status: e.target.value }))} className="his-field">
                  {["Sent home with family", "Stored in hospital locker", "Patient retains", "Nil declared"].map(o => <option key={o}>{o}</option>)}
                </select>
              </Field>
              <Field label="Handed to (name + relation)">
                <input value={valuables.handedTo}
                  onChange={e => setValuables(p => ({ ...p, handedTo: e.target.value }))}
                  placeholder="e.g. Wife — Mrs Smita Sharma" className="his-field" />
              </Field>
            </div>
            <Field label="Itemised list (if locker / retained)" style={{ marginTop: 10 }}>
              <textarea value={valuables.items}
                onChange={e => setValuables(p => ({ ...p, items: e.target.value }))}
                placeholder="e.g. Gold chain (~10g), wedding ring, ₹3,500 cash, mobile phone, ID proof"
                className="his-textarea" style={{ minHeight: 50 }} />
            </Field>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer", marginTop: 8 }}>
              <input type="checkbox" checked={valuables.receiptIssued}
                onChange={e => setValuables(p => ({ ...p, receiptIssued: e.target.checked }))} />
              Receipt issued to patient / family
            </label>
          </Section>

          {/* ── N16 · Family / Caregiver Identification ── */}
          <Section title="Family & Primary Caregiver" icon="pi-users" color={C.pink} badge="NABH AAC.6" disabled={ro}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, marginBottom: 6, textTransform: "uppercase", letterSpacing: ".4px" }}>
              Primary caregiver
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              <Field label="Name">
                <input value={caregiver.primaryName}
                  onChange={e => setCaregiver(p => ({ ...p, primaryName: e.target.value }))}
                  placeholder="Full name" className="his-field" />
              </Field>
              <Field label="Relation">
                <input value={caregiver.primaryRelation}
                  onChange={e => setCaregiver(p => ({ ...p, primaryRelation: e.target.value }))}
                  placeholder="e.g. Husband / Daughter" className="his-field" />
              </Field>
              <Field label="Contact">
                <input value={caregiver.primaryContact}
                  onChange={e => setCaregiver(p => ({ ...p, primaryContact: e.target.value }))}
                  placeholder="+91 ..." className="his-field" />
              </Field>
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer", marginTop: 8 }}>
              <input type="checkbox" checked={caregiver.lives_with_patient}
                onChange={e => setCaregiver(p => ({ ...p, lives_with_patient: e.target.checked }))} />
              Lives with patient
            </label>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, marginTop: 14, marginBottom: 6, textTransform: "uppercase", letterSpacing: ".4px" }}>
              Escalation contact (if primary unavailable)
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              <Field label="Name">
                <input value={caregiver.escalationName}
                  onChange={e => setCaregiver(p => ({ ...p, escalationName: e.target.value }))}
                  placeholder="Full name" className="his-field" />
              </Field>
              <Field label="Relation">
                <input value={caregiver.escalationRelation}
                  onChange={e => setCaregiver(p => ({ ...p, escalationRelation: e.target.value }))}
                  placeholder="e.g. Son / Sister" className="his-field" />
              </Field>
              <Field label="Contact">
                <input value={caregiver.escalationContact}
                  onChange={e => setCaregiver(p => ({ ...p, escalationContact: e.target.value }))}
                  placeholder="+91 ..." className="his-field" />
              </Field>
            </div>
          </Section>

          {/* ── N17 · High-Risk Patient Flag ── */}
          <Section title="High-Risk Patient Flag" icon="pi-flag-fill" color={C.red} badge="NABH PSQ.4" disabled={ro}>
            <div style={{ fontSize: 10.5, color: C.muted, marginBottom: 8 }}>
              Flag drives observation frequency, escalation protocols, and discharge planning urgency.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, fontSize: 12 }}>
              {[
                ["pediatric", "Pediatric (<18y)"],
                ["geriatric", "Geriatric (>65y)"],
                ["pregnant", "Pregnant"],
                ["immunocompromised", "Immunocompromised"],
                ["mentalHealth", "Mental health / suicide"],
                ["bariatric", "Bariatric (BMI ≥ 40)"],
                ["polyTrauma", "Polytrauma"],
                ["severeMalnutrition", "Severe malnutrition"],
              ].map(([k, label]) => (
                <label key={k} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                  <input type="checkbox" checked={!!highRisk[k]}
                    onChange={e => setHighRisk(p => ({ ...p, [k]: e.target.checked }))} />
                  {label}
                </label>
              ))}
            </div>
            <Field label="Additional risk notes" style={{ marginTop: 10 }}>
              <textarea value={highRisk.notes}
                onChange={e => setHighRisk(p => ({ ...p, notes: e.target.value }))}
                placeholder="Other clinical risks driving observation cadence…"
                className="his-textarea" style={{ minHeight: 50 }} />
            </Field>
          </Section>

          {/* ══════════════════════════════════════════════════════════
              R7fg · NURSE P2 NABH FIELDS (N18-N21)
              ══════════════════════════════════════════════════════════ */}

          {/* ── N18 · Mobility / Gait ── */}
          <Section title="Mobility & Gait" icon="pi-arrow-right" color={C.teal} disabled={ro}>
            <div style={{ display: "flex", gap: 18, fontSize: 12, flexWrap: "wrap" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                <input type="checkbox" checked={mobilityGait.independent} onChange={e => setMobilityGait(p => ({ ...p, independent: e.target.checked }))} />
                Independent mobility
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                <input type="checkbox" checked={mobilityGait.gaitNormal} onChange={e => setMobilityGait(p => ({ ...p, gaitNormal: e.target.checked }))} />
                Gait normal
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                <input type="checkbox" checked={mobilityGait.fallRisk} onChange={e => setMobilityGait(p => ({ ...p, fallRisk: e.target.checked }))} />
                Fall risk observed
              </label>
            </div>
            <Field label="Aids used" style={{ marginTop: 10 }}>
              <input value={mobilityGait.usesAid} onChange={e => setMobilityGait(p => ({ ...p, usesAid: e.target.value }))} placeholder="Walker / cane / wheelchair / crutches" className="his-field" />
            </Field>
            <Field label="Notes" style={{ marginTop: 10 }}>
              <textarea value={mobilityGait.notes} onChange={e => setMobilityGait(p => ({ ...p, notes: e.target.value }))} placeholder="Antalgic / ataxic / hemiparetic gait, unsteady on uneven surface…" className="his-textarea" style={{ minHeight: 50 }} />
            </Field>
          </Section>

          {/* ── N19 · Pre-anaesthesia basics (elective surgery quick screen) ── */}
          <Section title="Pre-Anaesthesia Screen (if elective surgery planned)" icon="pi-bolt" color={C.warn} disabled={ro}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, cursor: "pointer", marginBottom: 10 }}>
              <input type="checkbox" checked={preAnaesthesia.plannedSurgery} onChange={e => setPreAnaesthesia(p => ({ ...p, plannedSurgery: e.target.checked }))} />
              Elective surgery planned this admission
            </label>
            {preAnaesthesia.plannedSurgery && (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <Field label="NPO since (date / time)">
                    <input value={preAnaesthesia.npoSince} onChange={e => setPreAnaesthesia(p => ({ ...p, npoSince: e.target.value }))} placeholder="e.g. 22:00 last night" className="his-field" />
                  </Field>
                  <Field label="Previous anaesthesia history">
                    <input value={preAnaesthesia.anaesthesiaHistory} onChange={e => setPreAnaesthesia(p => ({ ...p, anaesthesiaHistory: e.target.value }))} placeholder="GA 2020 (uneventful) / SA 2018" className="his-field" />
                  </Field>
                </div>
                <div style={{ display: "flex", gap: 18, fontSize: 12, flexWrap: "wrap", marginTop: 10 }}>
                  {[
                    ["looseTooth", "Loose tooth"],
                    ["crowns", "Crowns / bridges"],
                    ["dentures", "Dentures"],
                    ["difficulIntubationHistory", "Difficult intubation history"],
                  ].map(([k, label]) => (
                    <label key={k} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                      <input type="checkbox" checked={!!preAnaesthesia[k]} onChange={e => setPreAnaesthesia(p => ({ ...p, [k]: e.target.checked }))} />
                      {label}
                    </label>
                  ))}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }}>
                    <input type="checkbox" checked={preAnaesthesia.pacScheduled} onChange={e => setPreAnaesthesia(p => ({ ...p, pacScheduled: e.target.checked }))} />
                    PAC (pre-anaesthesia consultation) scheduled
                  </label>
                  <Field label="PAC date / time">
                    <input value={preAnaesthesia.pacDate} onChange={e => setPreAnaesthesia(p => ({ ...p, pacDate: e.target.value }))} className="his-field" />
                  </Field>
                </div>
              </>
            )}
          </Section>

          {/* ── N20 · NRS-2002 Quick Screen ── */}
          <Section title="Nutritional Quick Screen (NRS-2002 short)" icon="pi-bookmark" color={C.green} disabled={ro}>
            <div style={{ fontSize: 10.5, color: C.muted, marginBottom: 8 }}>
              4-question rapid triage. Any "Yes" triggers dietitian referral. Full NRS-2002 is in the
              "Nutritional Risk Screening" section above.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 12 }}>
              {[
                ["bmiUnder20", "BMI < 20.5 kg/m²"],
                ["weightLossLast3Months", "Weight loss in last 3 months"],
                ["reducedIntakeLastWeek", "Reduced intake in last week"],
                ["severelyIll", "Severely ill (e.g. ICU)"],
              ].map(([k, label]) => (
                <label key={k} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                  <input type="checkbox" checked={!!nrsQuick[k]}
                    onChange={e => {
                      const next = { ...nrsQuick, [k]: e.target.checked };
                      next.dietitianReferralTriggered = next.bmiUnder20 || next.weightLossLast3Months || next.reducedIntakeLastWeek || next.severelyIll;
                      setNrsQuick(next);
                    }} />
                  {label}
                </label>
              ))}
            </div>
            {nrsQuick.dietitianReferralTriggered && (
              <div style={{ marginTop: 10, padding: "6px 10px", background: C.warnL, border: `1.5px solid ${C.warn}40`, borderRadius: 6, fontSize: 11.5, color: C.warn, fontWeight: 600 }}>
                <i className="pi pi-flag" style={{ marginRight: 6 }} />
                Dietitian referral triggered — raise nutrition consult.
              </div>
            )}
          </Section>

          {/* ── N21 · PROM / PREM Surveys (NABH PSQ) ── */}
          <Section title="Outcome & Experience Surveys (PROM / PREM)" icon="pi-comments" color={C.accent} badge="NABH PSQ" disabled={ro}>
            <div style={{ fontSize: 10.5, color: C.muted, marginBottom: 8 }}>
              Schedule patient-reported outcomes (PROM) and experience (PREM) at discharge.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, cursor: "pointer", marginBottom: 6 }}>
                  <input type="checkbox" checked={promPrem.promPlanned} onChange={e => setPromPrem(p => ({ ...p, promPlanned: e.target.checked }))} />
                  PROM (Outcome) planned
                </label>
                {promPrem.promPlanned && (
                  <select value={promPrem.promSurvey} onChange={e => setPromPrem(p => ({ ...p, promSurvey: e.target.value }))} className="his-field" style={{ padding: "5px 8px" }}>
                    <option value="">— Select survey —</option>
                    {["EQ-5D-5L", "SF-36", "PROMIS", "Oxford knee / hip", "VAS pain", "Other"].map(o => <option key={o}>{o}</option>)}
                  </select>
                )}
              </div>
              <div>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, cursor: "pointer", marginBottom: 6 }}>
                  <input type="checkbox" checked={promPrem.premPlanned} onChange={e => setPromPrem(p => ({ ...p, premPlanned: e.target.checked }))} />
                  PREM (Experience) planned
                </label>
                {promPrem.premPlanned && (
                  <input value={promPrem.premSurvey} onChange={e => setPromPrem(p => ({ ...p, premSurvey: e.target.value }))} placeholder="Survey name" className="his-field" style={{ padding: "5px 8px" }} />
                )}
              </div>
            </div>
            <Field label="Notes" style={{ marginTop: 10 }}>
              <input value={promPrem.notes} onChange={e => setPromPrem(p => ({ ...p, notes: e.target.value }))} placeholder="Language preference, follow-up call number…" className="his-field" />
            </Field>
          </Section>

          {/* ── Nursing Plan (existing) ── */}
          <Section title="Nursing Problems & Care Goals" icon="pi-pencil" color={C.pink} disabled={ro}>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <Field label="Identified Nursing Problems">
                <textarea value={nursingProblems} onChange={e => setNursingProblems(e.target.value)}
                  placeholder="1. Risk for falls related to...\n2. Impaired skin integrity related to..."
                  className="his-textarea" style={{ minHeight: 80 }} />
              </Field>
              <Grid2>
                <Field label="Short-term Goals">
                  <textarea value={nursingGoals} onChange={e => setNursingGoals(e.target.value)}
                    placeholder="Patient will... within 24 hours" className="his-textarea" style={{ minHeight: 64 }} />
                </Field>
                <Field label="Additional Nursing Notes">
                  <textarea value={nursingNotes} onChange={e => setNursingNotes(e.target.value)}
                    placeholder="Any other relevant observations or instructions…" className="his-textarea" style={{ minHeight: 64 }} />
                </Field>
              </Grid2>
            </div>
          </Section>

          {/* ── Nursing sign-off — only shown when the mounter is a NURSE
              (or unknown role, for the legacy standalone /ipd-initial-
              assessment route). When a DOCTOR mounts via DoctorNotes the
              Doctor sign-off block below renders instead. R7ey-F79.
              R7hr-72/lock — hidden when LOCKED & !amendMode (the red
              ribbon's Amend button is the only path back in); when
              amendMode is on, the "Sign" button morphs into "Save
              Amendment" and dispatches via handleAmendSave. */}
          {!isDoctorRole && !(iaLocked && !amendMode) && (
          <div style={{ background: amendMode ? "#fffbeb" : "#fdf2f8",
            border: `1px solid ${amendMode ? "#d97706" : C.pink}30`, borderRadius: 12,
            padding: "14px 20px", marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: amendMode ? "#92400e" : C.pink }}>
                <i className="pi pi-verified" style={{ marginRight: 6 }} />Nurse's Digital Signature
              </div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                {nurseName || user?.fullName || "—"} · {new Date().toLocaleString("en-IN")}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {!amendMode && (
                <button onClick={() => handleSave(false, "nursing")} disabled={saving}
                  style={{ padding: "9px 20px", border: `1.5px solid ${C.border}`, borderRadius: 8,
                    background: "white", cursor: saving ? "not-allowed" : "pointer",
                    fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 600, color: C.muted }}>
                  Save Draft
                </button>
              )}
              {amendMode ? (
                <button onClick={() => handleAmendSave("nursing")} disabled={saving}
                  style={{ padding: "9px 22px", border: "none", borderRadius: 8, background: "#d97706",
                    cursor: saving ? "not-allowed" : "pointer",
                    fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 700, color: "white",
                    boxShadow: "0 4px 14px rgba(217,119,6,.4)" }}>
                  <i className="pi pi-check-circle" style={{ marginRight: 6, fontSize: 12 }} />
                  {saving ? "Saving…" : "Save Amendment"}
                </button>
              ) : (
                <button onClick={async () => { await handleSave(true, "nursing"); onSign?.("nurse"); }} disabled={saving}
                  style={{ padding: "9px 22px", border: "none", borderRadius: 8, background: C.pink,
                    cursor: saving ? "not-allowed" : "pointer",
                    fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 700, color: "white",
                    boxShadow: `0 4px 14px ${C.pink}40` }}>
                  <i className="pi pi-check-circle" style={{ marginRight: 6, fontSize: 12 }} />
                  {saving ? "Saving…" : "Sign Nursing Assessment"}
                </button>
              )}
            </div>
          </div>
          )}

        </>)}{/* /R7fa — end nursing form */}

        {/* R7ey-F80 — Doctor authoring surface, gated on role. When a DOCTOR
            mounts this component from the DoctorNotes embed, render the
            full doctor-side form + sign-off. R7bd had blanket-hidden the
            block (which made the page useful only to Nurses); the audit
            (F80) confirmed the doctor block was completely dead under
            `{false && ...}`, so a doctor saw the Nurse sign-off and
            unintentionally signed as a nurse. */}
        {isDoctorRole && (<>

          {/* ── Doctor Header ── */}
          <Section title="Doctor & Admission Info" icon="pi-id-card" color={C.accent} disabled={ro}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
              <Field label="Doctor Name" required>
                <input value={doctorName} onChange={e => setDoctorName(e.target.value)} placeholder="Dr. Full Name" className="his-field" />
              </Field>
              <Field label="Registration No.">
                <input value={regNo} onChange={e => setRegNo(e.target.value)} placeholder="MCI / State reg. no." className="his-field" />
              </Field>
              <Field label="Assessment Date/Time">
                <input type="datetime-local" defaultValue={new Date().toISOString().slice(0,16)} className="his-field" />
              </Field>
            </div>
          </Section>

          {/* ── D1 · Chief Complaint (NABH AAC.1 — distinct from HPI) ── */}
          <Section title="Chief Complaint" icon="pi-comment" color={C.accent} badge="NABH AAC.1" disabled={ro}>
            <Grid2>
              <Field label="Chief Complaint *">
                <input value={docCC} onChange={e => setDocCC(e.target.value)}
                  placeholder="e.g. Fever and cough" className="his-field" />
              </Field>
              <Field label="Duration / Onset">
                <input value={ccDuration} onChange={e => setCcDuration(e.target.value)}
                  placeholder="e.g. 3 days, sudden onset" className="his-field" />
              </Field>
            </Grid2>
          </Section>

          {/* ── History ──
              R7hr-70: Past Medical History removed (Co-morbidities card
              below is the structured replacement). Past Surgical /
              Family / Social History upgraded from plain textareas to
              checkbox-grid pickers matching the Co-morbidities pattern;
              free-text "Other" stays for anything off-menu. */}
          <Section title="History" icon="pi-book" color={C.purple} disabled={ro}>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <Field label="History of Present Illness *">
                <textarea value={hopi} onChange={e => setHopi(e.target.value)}
                  placeholder="Onset, character, progression, associated symptoms, relieving/aggravating factors…"
                  className="his-textarea" style={{ minHeight: 90 }} />
              </Field>

              {/* Past Surgical History — checkbox grid */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".4px", marginBottom: 8 }}>
                  Past Surgical History
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, fontSize: 12, marginBottom: 8 }}>
                  {PSH_OPTIONS.map(([k, label]) => (
                    <label key={k} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                      <input type="checkbox" checked={!!pshStruct[k]}
                        onChange={e => setPshStruct(s => ({ ...s, [k]: e.target.checked }))} />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
                <input value={pshStruct.other}
                  onChange={e => setPshStruct(s => ({ ...s, other: e.target.value }))}
                  placeholder="Other surgeries (free-text)…" className="his-field" />
              </div>

              {/* Family History — checkbox grid */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".4px", marginBottom: 8 }}>
                  Family History (hereditary conditions)
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, fontSize: 12, marginBottom: 8 }}>
                  {FAMHX_OPTIONS.map(([k, label]) => (
                    <label key={k} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                      <input type="checkbox" checked={!!famHxStruct[k]}
                        onChange={e => setFamHxStruct(s => ({ ...s, [k]: e.target.checked }))} />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
                <input value={famHxStruct.other}
                  onChange={e => setFamHxStruct(s => ({ ...s, other: e.target.value }))}
                  placeholder="Other family history (specify cancer type, age at death, etc.)…" className="his-field" />
              </div>

              {/* Social / Personal History — chip groups + small inputs */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".4px", marginBottom: 8 }}>
                  Social / Personal History
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
                  {SOCHX_GROUPS.map(g => (
                    <div key={g.key} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <span style={{ minWidth: 160, fontSize: 11.5, fontWeight: 600, color: C.text }}>{g.label}:</span>
                      {g.chips.map(c => (
                        <button key={c} type="button"
                          onClick={() => setSocHxStruct(s => ({ ...s, [g.key]: c }))}
                          style={{
                            padding: "3px 12px", borderRadius: 999,
                            border: `1.5px solid ${socHxStruct[g.key] === c ? C.purple : C.border}`,
                            background:  socHxStruct[g.key] === c ? C.purple : "white",
                            color:       socHxStruct[g.key] === c ? "white"   : C.muted,
                            fontFamily: "inherit", fontSize: 11, fontWeight: 700,
                            cursor: "pointer", transition: "all .15s ease",
                          }}>{c}</button>
                      ))}
                    </div>
                  ))}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                  <input value={socHxStruct.occupation}
                    onChange={e => setSocHxStruct(s => ({ ...s, occupation: e.target.value }))}
                    placeholder="Occupation (e.g. office worker, farmer, factory…)" className="his-field" />
                  <input value={socHxStruct.recentTravel}
                    onChange={e => setSocHxStruct(s => ({ ...s, recentTravel: e.target.value }))}
                    placeholder="Recent travel (last 3 months)…" className="his-field" />
                </div>
                <input value={socHxStruct.other}
                  onChange={e => setSocHxStruct(s => ({ ...s, other: e.target.value }))}
                  placeholder="Other personal / social context (sleep, exercise, diet, marital, etc.)…" className="his-field" />
              </div>
            </div>
          </Section>

          {/* ── D5 · Co-morbidity checklist (NABH AAC.1 / COP.1) ──
              R7hr-64: each ticked co-morbidity now exposes an inline
              "since N yr" input. Stored alongside the boolean as
              `${key}Years` (e.g. comorbid.diabetes=true +
              comorbid.diabetesYears='5'), so the existing boolean
              shape survives and the year-of-onset shows up in the
              print block + downstream consumers without a schema
              change. */}
          <Section title="Co-morbidities" icon="pi-list-check" color={C.purple} badge="NABH AAC.1" disabled={ro}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, fontSize: 12 }}>
              {[
                ["diabetes", "Diabetes Mellitus"],   ["hypertension", "Hypertension"],
                ["cad", "CAD / IHD"],                ["ckd", "Chronic Kidney Disease"],
                ["copd", "COPD"],                    ["asthma", "Asthma"],
                ["liverDx", "Liver Disease"],        ["cancer", "Cancer / Malignancy"],
                ["stroke", "Stroke / CVA"],          ["mentalHealth", "Mental Health"],
                ["hypothyroid", "Hypothyroidism"],   ["hiv", "HIV / AIDS"],
                ["hepB", "Hepatitis B"],             ["hepC", "Hepatitis C"],
              ].map(([k, label]) => {
                const yearsKey = `${k}Years`;
                const ticked = !!comorbid[k];
                return (
                  <div key={k} style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 26 }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", flex: ticked ? "0 0 auto" : 1, minWidth: 0 }}>
                      <input type="checkbox" checked={ticked}
                        onChange={e => setComorbid(c => ({
                          ...c,
                          [k]: e.target.checked,
                          // clear the years field if the box is being un-ticked
                          ...(e.target.checked ? {} : { [yearsKey]: "" }),
                        }))} />
                      <span>{label}</span>
                    </label>
                    {ticked && (
                      <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: C.muted }}>
                        <span>since</span>
                        <input
                          type="number"
                          min="0"
                          step="0.1"
                          inputMode="decimal"
                          value={comorbid[yearsKey] || ""}
                          onChange={e => setComorbid(c => ({ ...c, [yearsKey]: e.target.value }))}
                          placeholder="—"
                          style={{
                            width: 56, padding: "3px 6px",
                            border: `1px solid ${C.border}`, borderRadius: 6,
                            fontSize: 11.5, fontWeight: 700, color: C.text,
                            background: "#fff", outline: "none",
                          }}
                        />
                        <span>yr</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <Field label="Other co-morbidities" style={{ marginTop: 10 }}>
              <input value={comorbid.other}
                onChange={e => setComorbid(c => ({ ...c, other: e.target.value }))}
                placeholder="Free-text — e.g. Rheumatoid arthritis, Sickle cell…" className="his-field" />
            </Field>
          </Section>

          {/* ── D2+D3 · Structured Allergies + Medication Reconciliation
                       (NABH PSQ.4 + MOM + AAC.4) ────────────────────────── */}
          <Section title="Allergies & Medication Reconciliation" icon="pi-shield" color={C.red} badge="NABH PSQ.4 + MOM" disabled={ro}>
            {/* Allergies — structured list */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.text }}>Known Allergies</div>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: C.muted, cursor: "pointer" }}>
                  <input type="checkbox" checked={noKnownAllergies}
                    onChange={e => { setNoKnownAllergies(e.target.checked); if (e.target.checked) setAllergyList([]); }} />
                  No known allergies (NKDA)
                </label>
              </div>
              {!noKnownAllergies && (
                <>
                  {allergyList.length > 0 && (
                    <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 6, fontSize: 11.5 }}>
                      <thead>
                        <tr style={{ background: C.redL }}>
                          {["Type", "Agent", "Severity", "Reaction", ""].map(h => (
                            <th key={h} style={{ padding: "6px 8px", textAlign: "left", fontSize: 10, fontWeight: 700, color: C.red, textTransform: "uppercase", borderBottom: `1.5px solid ${C.red}30` }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {allergyList.map((a, i) => (
                          <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                            <td style={{ padding: "6px 8px" }}>
                              <select value={a.type || "Drug"} onChange={e => setAllergyList(l => l.map((x, j) => j === i ? { ...x, type: e.target.value } : x))} className="his-field" style={{ padding: "4px 6px" }}>
                                {["Drug", "Food", "Latex", "Contact", "Environmental", "Other"].map(t => <option key={t}>{t}</option>)}
                              </select>
                            </td>
                            <td style={{ padding: "6px 8px" }}>
                              <input value={a.agent || ""} onChange={e => setAllergyList(l => l.map((x, j) => j === i ? { ...x, agent: e.target.value } : x))} placeholder="e.g. Penicillin" className="his-field" style={{ padding: "4px 6px" }} />
                            </td>
                            <td style={{ padding: "6px 8px" }}>
                              <select value={a.severity || "Mild"} onChange={e => setAllergyList(l => l.map((x, j) => j === i ? { ...x, severity: e.target.value } : x))} className="his-field" style={{ padding: "4px 6px" }}>
                                {["Mild", "Moderate", "Severe", "Anaphylaxis"].map(t => <option key={t}>{t}</option>)}
                              </select>
                            </td>
                            <td style={{ padding: "6px 8px" }}>
                              <input value={a.reaction || ""} onChange={e => setAllergyList(l => l.map((x, j) => j === i ? { ...x, reaction: e.target.value } : x))} placeholder="e.g. Rash, breathlessness" className="his-field" style={{ padding: "4px 6px" }} />
                            </td>
                            <td style={{ padding: "6px 8px" }}>
                              <button onClick={() => setAllergyList(l => l.filter((_, j) => j !== i))} style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer" }}>
                                <i className="pi pi-trash" style={{ fontSize: 12 }} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  <button onClick={() => setAllergyList(l => [...l, { type: "Drug", agent: "", severity: "Mild", reaction: "" }])}
                    style={{ padding: "5px 12px", border: `1.5px dashed ${C.red}60`, borderRadius: 6,
                      background: C.redL, cursor: "pointer", fontSize: 11.5, fontWeight: 600, color: C.red }}>
                    <i className="pi pi-plus" style={{ marginRight: 5, fontSize: 10 }} />Add allergy
                  </button>
                </>
              )}
            </div>

            {/* Medication Reconciliation */}
            <div style={{ borderTop: `1px dashed ${C.border}`, paddingTop: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 8 }}>
                Medication Reconciliation
                <span style={{ fontSize: 10.5, fontWeight: 500, color: C.muted, marginLeft: 8 }}>
                  (drugs patient was taking before admission)
                </span>
              </div>
              {/* R7fe-C — nursing-sourced rows render read-only with a
                  small "from nursing" badge. Doctor only edits the
                  Continue/Hold dropdown for those rows. Doctor-added
                  rows (not in nurse's homeMeds) remain fully editable. */}
              {medRecon.length > 0 && (
                <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 6, fontSize: 11.5 }}>
                  <thead>
                    <tr style={{ background: "#f8fafc" }}>
                      {["Drug", "Dose", "Frequency", "Last taken", "Continue?", "HAM", ""].map(h => (
                        <th key={h} style={{ padding: "6px 8px", textAlign: "left", fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase", borderBottom: `1.5px solid ${C.border}` }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {medRecon.map((m, i) => {
                      const ro = !!m._fromNursing;
                      const cellStyle = ro
                        ? { padding: "6px 8px", background: "#f8fafc", color: C.text, fontSize: 11.5 }
                        : { padding: "6px 8px" };
                      return (
                        <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                          <td style={cellStyle}>
                            {ro ? (
                              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                {m.drug}
                                <span style={{ background: C.pink, color: "white", padding: "1px 6px", borderRadius: 4, fontSize: 9, fontWeight: 800, letterSpacing: ".3px" }}>NURSING</span>
                              </span>
                            ) : (
                              <input value={m.drug || ""} onChange={e => setMedRecon(l => l.map((x, j) => j === i ? { ...x, drug: e.target.value, isHAM: (typeof x.isHAM === "boolean" && x.isHAM !== isHAMByName(x.drug)) ? x.isHAM : isHAMByName(e.target.value) } : x))} placeholder="Drug name" className="his-field" style={{ padding: "4px 6px" }} />
                            )}
                          </td>
                          <td style={cellStyle}>
                            {ro ? (m.dose || "—") : (
                              <input value={m.dose || ""} onChange={e => setMedRecon(l => l.map((x, j) => j === i ? { ...x, dose: e.target.value } : x))} placeholder="500mg" className="his-field" style={{ padding: "4px 6px" }} />
                            )}
                          </td>
                          <td style={cellStyle}>
                            {ro ? (m.frequency || "—") : (
                              <input value={m.frequency || ""} onChange={e => setMedRecon(l => l.map((x, j) => j === i ? { ...x, frequency: e.target.value } : x))} placeholder="BD / TDS" className="his-field" style={{ padding: "4px 6px" }} />
                            )}
                          </td>
                          <td style={cellStyle}>
                            {ro ? (m.lastTaken || "—") : (
                              <input value={m.lastTaken || ""} onChange={e => setMedRecon(l => l.map((x, j) => j === i ? { ...x, lastTaken: e.target.value } : x))} placeholder="Date / time" className="his-field" style={{ padding: "4px 6px" }} />
                            )}
                          </td>
                          <td style={{ padding: "6px 8px" }}>
                            {/* R7hr-96 — 2 options only. Continue → DoctorOrder
                                Medication created on save (lands in MAR/
                                Treatment Chart). Hold → recorded in IA but no
                                MAR row, doctor decides later. */}
                            <select value={m.continueOnAdmit || "Continue"} onChange={e => setMedRecon(l => l.map((x, j) => j === i ? { ...x, continueOnAdmit: e.target.value } : x))} className="his-field" style={{ padding: "4px 6px" }}>
                              {["Continue", "Hold"].map(t => <option key={t}>{t}</option>)}
                            </select>
                          </td>
                          <td style={{ padding: "6px 8px", textAlign: "center" }}>
                            {/* R7hr-96 — HAM tag. Auto-detected from the drug
                                name (HAM_KEYWORDS list) but the doctor can
                                flip it for brand names we didn't anticipate.
                                On Continue → fan-out, the DoctorOrder backend
                                pre-save hook re-asserts HAM independently, so
                                this UI flag is advisory-only — the source of
                                truth for two-nurse-witness lives on the
                                downstream MAR row. */}
                            <label style={{ display: "inline-flex", alignItems: "center", gap: 4, cursor: "pointer", fontSize: 11 }}>
                              <input
                                type="checkbox"
                                checked={!!m.isHAM}
                                onChange={e => setMedRecon(l => l.map((x, j) => j === i ? { ...x, isHAM: e.target.checked } : x))}
                                style={{ accentColor: "#ef4444" }}
                              />
                              {m.isHAM && (
                                <span style={{ background: "#fee2e2", color: "#b91c1c", padding: "1px 5px", borderRadius: 3, fontSize: 9, fontWeight: 800, letterSpacing: ".3px" }}>HAM</span>
                              )}
                            </label>
                          </td>
                          <td style={{ padding: "6px 8px" }}>
                            {!ro && (
                              <button onClick={() => setMedRecon(l => l.filter((_, j) => j !== i))} style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer" }}>
                                <i className="pi pi-trash" style={{ fontSize: 12 }} />
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
              {homeMeds.length > 0 && medRecon.length === 0 && (
                <div style={{ fontSize: 11, color: C.muted, fontStyle: "italic", marginTop: 4 }}>
                  Nursing has captured {homeMeds.length} home medication{homeMeds.length === 1 ? "" : "s"} — they'll appear here automatically.
                </div>
              )}
              <button onClick={() => setMedRecon(l => [...l, { drug: "", dose: "", frequency: "", lastTaken: "", continueOnAdmit: "Continue", isHAM: false, _doctorOnly: true }])}
                style={{ padding: "5px 12px", border: `1.5px dashed ${C.accent}60`, borderRadius: 6,
                  background: C.accentL, cursor: "pointer", fontSize: 11.5, fontWeight: 600, color: C.accent }}>
                <i className="pi pi-plus" style={{ marginRight: 5, fontSize: 10 }} />Add medication (doctor-only)
              </button>
            </div>
          </Section>

          {/* ── R7hr-58 · Structured Clinical Examination (replaces ROS + PE) ──
              The old "Review of Systems" 10-input NAD checklist and
              "Physical Examination" 5-textarea grid were too thin for IPD
              admission. Now reuses the rich Clinical Examination card from
              OPD Assessment: structured General Examination (dropdowns +
              severity-scaled findings + quick checkboxes) and Systemic
              Examination CVS/RS/CNS/PA mini-blocks with picklists. Single
              shared component → single source of truth, consistent UX
              across OPD and IPD doctors. */}
          <ClinicalExaminationCard value={clinExam} onChange={setClinExam} color={C.teal} />

          {/* ── D4 · 3-tier Diagnosis + Differentials (NABH AAC.1) ──
              R7hr-65: Adopt the OPD Assessment "Patient Diagnosis" card
              layout — three color-coded tiles (Provisional amber /
              Working blue / Final green), an ICD-10 Code + Description
              row in purple, and a Patient Status chip strip. Differential
              Diagnoses kept below as an IPD-specific add (OPD doesn't
              have it). Single source of truth for what a diagnosis card
              looks like across OPD and IPD. */}
          <Section title="Diagnosis" icon="pi-tag" color={C.accent} badge="NABH AAC.1 · 3-tier" disabled={ro}>
            <div style={{ fontSize: 11, color: C.muted, fontWeight: 500, marginBottom: 12, marginTop: -6 }}>
              Provisional → Working → Final + ICD-10 coding
            </div>

            {/* Three diagnosis tiers — color-coded by clinical certainty */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
              {/* Provisional (orange) — first-contact impression */}
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#f59e0b", flexShrink: 0 }} />
                  <span style={{ fontSize: 10, fontWeight: 700, color: "#92400e", textTransform: "uppercase", letterSpacing: ".6px" }}>Provisional Dx *</span>
                </div>
                <textarea
                  value={provDx}
                  onChange={e => setProvDx(e.target.value)}
                  placeholder="Initial clinical impression on admission"
                  style={{ width: "100%", border: "1.5px solid #fcd34d", borderRadius: 8, padding: "9px 12px", fontFamily: "inherit", fontSize: 13, color: "#1e293b", outline: "none", background: "#fffbeb", boxSizing: "border-box", minHeight: 64, resize: "vertical" }}
                />
              </div>
              {/* Working (blue) — evolving impression */}
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#3b82f6", flexShrink: 0 }} />
                  <span style={{ fontSize: 10, fontWeight: 700, color: "#1d4ed8", textTransform: "uppercase", letterSpacing: ".6px" }}>Working Dx</span>
                </div>
                <textarea
                  value={workingDx}
                  onChange={e => setWorkingDx(e.target.value)}
                  placeholder="Refined after labs / imaging"
                  style={{ width: "100%", border: "1.5px solid #93c5fd", borderRadius: 8, padding: "9px 12px", fontFamily: "inherit", fontSize: 13, color: "#1e293b", outline: "none", background: "#eff6ff", boxSizing: "border-box", minHeight: 64, resize: "vertical" }}
                />
              </div>
              {/* Final (green) — confirmed at discharge */}
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#22c55e", flexShrink: 0 }} />
                  <span style={{ fontSize: 10, fontWeight: 700, color: "#166534", textTransform: "uppercase", letterSpacing: ".6px" }}>Final Dx</span>
                </div>
                <textarea
                  value={finalDx}
                  onChange={e => setFinalDx(e.target.value)}
                  placeholder="Confirmed at discharge"
                  style={{ width: "100%", border: "1.5px solid #86efac", borderRadius: 8, padding: "9px 12px", fontFamily: "inherit", fontSize: 13, color: "#1e293b", outline: "none", background: "#f0fdf4", boxSizing: "border-box", minHeight: 64, resize: "vertical" }}
                />
              </div>
            </div>

            {/* ICD-10 row — code + description applied to the episode */}
            <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", gap: 12, marginBottom: 12 }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#8b5cf6", flexShrink: 0 }} />
                  <span style={{ fontSize: 10, fontWeight: 700, color: "#5b21b6", textTransform: "uppercase", letterSpacing: ".6px" }}>ICD-10 Code</span>
                </div>
                <input
                  value={icd10}
                  onChange={e => setIcd10(e.target.value)}
                  placeholder="e.g. J18.9"
                  style={{ width: "100%", border: "1.5px solid #c4b5fd", borderRadius: 8, padding: "9px 12px", fontFamily: "'DM Mono', monospace", fontSize: 13, fontWeight: 700, color: "#5b21b6", outline: "none", background: "#faf5ff", boxSizing: "border-box", letterSpacing: ".5px" }}
                />
              </div>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#8b5cf6", flexShrink: 0 }} />
                  <span style={{ fontSize: 10, fontWeight: 700, color: "#5b21b6", textTransform: "uppercase", letterSpacing: ".6px" }}>ICD-10 Description</span>
                </div>
                <input
                  value={icd10Description}
                  onChange={e => setIcd10Description(e.target.value)}
                  placeholder="e.g. Unspecified pneumonia, Type 2 DM with complications…"
                  style={{ width: "100%", border: "1.5px solid #c4b5fd", borderRadius: 8, padding: "9px 12px", fontFamily: "inherit", fontSize: 13, color: "#1e293b", outline: "none", background: "#faf5ff", boxSizing: "border-box" }}
                />
              </div>
            </div>

            {/* Patient Status chips — clinical trajectory at a glance.
                Click an already-selected chip to clear it (toggle), since
                "no status set" is a valid state for a fresh admission. */}
            <div style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".5px" }}>Patient Status:</span>
              {["Stable","Improving","Unchanged","Deteriorating","Critical","Ready for Discharge"].map(s => (
                <button key={s} type="button"
                  onClick={() => setPatientStatus(p => p === s ? "" : s)}
                  style={{
                    padding: "4px 13px", borderRadius: 20,
                    border: `1.5px solid ${patientStatus === s ? "#2563eb" : C.border}`,
                    background: patientStatus === s ? "#2563eb" : "white",
                    color: patientStatus === s ? "white" : C.muted,
                    fontFamily: "inherit", fontSize: 11, fontWeight: 700,
                    cursor: "pointer", transition: "all .15s ease",
                  }}>
                  {s}
                </button>
              ))}
            </div>

            {/* Differential Diagnoses — IPD-specific addition (OPD card
                doesn't include this; we keep it for the admission flow
                because the doctor often lists 2-3 dx to rule out). */}
            <Field label="Differential Diagnoses">
              <textarea value={differentialDx} onChange={e => setDifferentialDx(e.target.value)}
                placeholder="Alternative diagnoses to rule out — one per line"
                className="his-textarea" style={{ minHeight: 56 }} />
            </Field>
          </Section>

          {/* ── R7hr-59 · Structured Investigations (OPD-style)
              R7hr-67 polish: subtitle line matches Diagnosis card.
              R7hr-69: lab-catalog autocomplete + multi-pick chip flow
              — doctor types "cbc", picks CBC → chip; types "lft",
              picks LFT → chip; clicks "+ Add 2 Tests" → both commit
              with the urgency + instructions set above. Free-text
              entries also work — pressing Enter on any value not in
              the catalog still chips it. */}
          <Section title="Investigations Ordered" icon="pi-list-check" color={C.purple} badge={`${invests.length} test${invests.length===1?"":"s"}`} disabled={ro}>
            <div style={{ fontSize: 11, color: C.muted, fontWeight: 500, marginBottom: 12, marginTop: -6 }}>
              Order labs / imaging / procedures — type to search, pick multiple, then click Add
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1.4fr 130px 1.4fr auto", gap: 8, alignItems: "end" }}>
                <Field label="Test / Investigation Name">
                  <div style={{ position: "relative" }}>
                    <input
                      value={invQuery}
                      onChange={e => { setInvQuery(e.target.value); setInvShowSuggest(true); setInvSuggestIdx(-1); }}
                      onFocus={() => setInvShowSuggest(true)}
                      onBlur={() => setTimeout(() => setInvShowSuggest(false), 150)}
                      onKeyDown={(e) => {
                        const q = invQuery.trim().toLowerCase();
                        const matches = q ? LAB_TESTS.filter(t => t.toLowerCase().includes(q)).slice(0, 8) : [];
                        if (e.key === "ArrowDown") { e.preventDefault(); setInvSuggestIdx(i => Math.min(matches.length - 1, i + 1)); }
                        else if (e.key === "ArrowUp") { e.preventDefault(); setInvSuggestIdx(i => Math.max(0, i - 1)); }
                        else if (e.key === "Enter") {
                          e.preventDefault();
                          const pick = invSuggestIdx >= 0 && matches[invSuggestIdx]
                            ? matches[invSuggestIdx]
                            : invQuery.trim();
                          if (!pick) return;
                          if (!invPending.includes(pick)) setInvPending(prev => [...prev, pick]);
                          setInvQuery(""); setInvSuggestIdx(-1); setInvShowSuggest(false);
                        } else if (e.key === "Escape") { setInvShowSuggest(false); setInvSuggestIdx(-1); }
                      }}
                      placeholder="Type test name — CBC, LFT, ECG, USG…"
                      className="his-field"
                    />
                    {invShowSuggest && invQuery.trim() && (() => {
                      const q = invQuery.trim().toLowerCase();
                      const matches = LAB_TESTS.filter(t => t.toLowerCase().includes(q)).slice(0, 8);
                      const exact = matches.some(m => m.toLowerCase() === q);
                      return (
                        <div style={{
                          position: "absolute", top: "100%", left: 0, right: 0, marginTop: 4,
                          background: "white", border: `1px solid ${C.border}`, borderRadius: 8,
                          boxShadow: "0 8px 24px rgba(15,23,42,.12)",
                          maxHeight: 280, overflowY: "auto", zIndex: 50,
                        }}>
                          {matches.length === 0 && !exact && (
                            <div
                              onMouseDown={(e) => {
                                e.preventDefault();
                                const pick = invQuery.trim();
                                if (pick && !invPending.includes(pick)) setInvPending(prev => [...prev, pick]);
                                setInvQuery(""); setInvShowSuggest(false);
                              }}
                              style={{ padding: "10px 14px", fontSize: 12, color: C.muted, cursor: "pointer", borderBottom: `1px solid ${C.border}` }}>
                              <span style={{ color: C.purple, fontWeight: 700 }}>+ Add "{invQuery.trim()}"</span> as custom test
                            </div>
                          )}
                          {matches.map((m, i) => (
                            <div
                              key={m}
                              onMouseDown={(e) => {
                                e.preventDefault();
                                if (!invPending.includes(m)) setInvPending(prev => [...prev, m]);
                                setInvQuery(""); setInvShowSuggest(false); setInvSuggestIdx(-1);
                              }}
                              onMouseEnter={() => setInvSuggestIdx(i)}
                              style={{
                                padding: "9px 14px", fontSize: 12, cursor: "pointer",
                                background: invSuggestIdx === i ? `${C.purple}12` : "white",
                                color: C.text, fontWeight: invSuggestIdx === i ? 700 : 500,
                                borderBottom: i < matches.length - 1 ? `1px solid ${C.border}40` : "none",
                                display: "flex", alignItems: "center", gap: 8,
                              }}>
                              <i className="pi pi-plus-circle" style={{ color: C.purple, fontSize: 11 }} />
                              {m}
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                </Field>
                <Field label="Urgency">
                  <select value={invUrgency} onChange={e => setInvUrgency(e.target.value)} className="his-field">
                    <option value="ROUTINE">Routine</option>
                    <option value="URGENT">Urgent</option>
                    <option value="STAT">STAT</option>
                  </select>
                </Field>
                <Field label="Instructions">
                  <input value={invInstructions} onChange={e => setInvInstructions(e.target.value)}
                    placeholder="Fasting, repeat, specific time…" className="his-field" />
                </Field>
                <button type="button" onClick={() => {
                  // Commit invPending (or, if empty, the typed query) into invests
                  // using the current urgency + instructions for the whole batch.
                  let names = [...invPending];
                  if (invQuery.trim() && !names.includes(invQuery.trim())) names.push(invQuery.trim());
                  if (names.length === 0) return;
                  setInvests(prev => [
                    ...prev,
                    ...names.map(name => ({ name, urgency: invUrgency, instructions: invInstructions.trim() })),
                  ]);
                  setInvPending([]); setInvQuery(""); setInvInstructions(""); setInvUrgency("ROUTINE");
                }} disabled={invPending.length === 0 && !invQuery.trim()} style={{
                  height: 38, padding: "0 18px", minWidth: 110,
                  border: "none", borderRadius: 8,
                  background: (invPending.length > 0 || invQuery.trim()) ? C.purple : `${C.purple}50`,
                  color: "white",
                  fontFamily: "inherit", fontSize: 12.5, fontWeight: 700,
                  cursor: (invPending.length > 0 || invQuery.trim()) ? "pointer" : "not-allowed",
                  whiteSpace: "nowrap",
                  boxShadow: `0 1px 2px ${C.purple}30`,
                }}>+ Add {invPending.length > 0 ? `${invPending.length + (invQuery.trim() ? 1 : 0)} Test${(invPending.length + (invQuery.trim() ? 1 : 0)) === 1 ? "" : "s"}` : "Test"}</button>
              </div>

              {/* Pending chip strip — shown only while the doctor is
                  stacking up tests. Each chip is removable. */}
              {invPending.length > 0 && (
                <div style={{
                  display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
                  padding: "10px 12px",
                  background: `${C.purple}08`, border: `1px solid ${C.purple}30`,
                  borderRadius: 8,
                }}>
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: C.purple, textTransform: "uppercase", letterSpacing: ".5px" }}>
                    Selected ({invPending.length}):
                  </span>
                  {invPending.map((t, idx) => (
                    <span key={t + idx} style={{
                      display: "inline-flex", alignItems: "center", gap: 6,
                      padding: "4px 4px 4px 11px", borderRadius: 999,
                      background: "white", border: `1.5px solid ${C.purple}40`,
                      fontSize: 11.5, fontWeight: 600, color: C.text,
                    }}>
                      {t}
                      <button type="button" onClick={() => setInvPending(prev => prev.filter((_, j) => j !== idx))}
                        title={`Remove ${t}`}
                        style={{
                          width: 18, height: 18, border: "none", background: `${C.purple}15`,
                          color: C.purple, borderRadius: "50%", cursor: "pointer",
                          display: "inline-flex", alignItems: "center", justifyContent: "center",
                          fontSize: 11, fontWeight: 800, padding: 0,
                        }}>×</button>
                    </span>
                  ))}
                  <button type="button" onClick={() => setInvPending([])}
                    style={{
                      marginLeft: "auto", border: "none", background: "transparent",
                      color: C.muted, fontSize: 11, cursor: "pointer", fontWeight: 600, textDecoration: "underline",
                    }}>Clear all</button>
                </div>
              )}
              {invests.length === 0 ? (
                <div style={{
                  padding: "14px 16px", borderRadius: 10,
                  background: `${C.purple}08`, border: `1px dashed ${C.purple}40`,
                  textAlign: "center", fontSize: 12, color: C.muted, fontStyle: "italic",
                }}>
                  <i className="pi pi-info-circle" style={{ marginRight: 6, color: C.purple }} />
                  No investigations ordered yet — type a test name above and click "+ Add Test".
                </div>
              ) : (
                <div style={{ overflowX: "auto", border: `1px solid ${C.border}`, borderRadius: 10 }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead><tr style={{ background: `${C.purple}08` }}>
                      {["#", "Investigation", "Urgency", "Instructions", ""].map(h => (
                        <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontSize: 10, fontWeight: 700, color: C.purple, textTransform: "uppercase", letterSpacing: ".6px", borderBottom: `1.5px solid ${C.purple}20` }}>{h}</th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {invests.map((inv, i) => {
                        const urgColor = inv.urgency === "STAT" ? "#b91c1c"
                                      : inv.urgency === "URGENT" ? "#a16207"
                                      : "#475569";
                        const urgBg    = inv.urgency === "STAT" ? "#fef2f2"
                                      : inv.urgency === "URGENT" ? "#fef3c7"
                                      : "#f1f5f9";
                        return (
                          <tr key={i} style={{ borderTop: i === 0 ? "none" : `1px solid ${C.border}`, background: i % 2 ? "#fafbfc" : "white" }}>
                            <td style={{ padding: "8px 12px", fontSize: 12, fontWeight: 700, color: C.muted, width: 32 }}>{i+1}</td>
                            <td style={{ padding: "8px 12px", fontSize: 12.5, fontWeight: 600, color: C.text }}>{inv.name}</td>
                            <td style={{ padding: "8px 12px", fontSize: 11 }}>
                              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 10px", borderRadius: 999, background: urgBg, color: urgColor, fontWeight: 700, fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".4px" }}>
                                <span style={{ width: 6, height: 6, borderRadius: "50%", background: urgColor, flexShrink: 0 }} />
                                {inv.urgency || "Routine"}
                              </span>
                            </td>
                            <td style={{ padding: "8px 12px", fontSize: 11.5, color: C.muted }}>{inv.instructions || "—"}</td>
                            <td style={{ padding: "8px 12px", textAlign: "right", width: 36 }}>
                              <button type="button" onClick={() => setInvests(prev => prev.filter((_, j) => j !== i))} title="Remove" style={{ border: "none", background: "transparent", cursor: "pointer", color: "#dc2626", fontWeight: 800, fontSize: 14 }}>✕</button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </Section>

          {/* ── R7hr-59 · Prescription (shared PrescriptionPanel)
              R7hr-67 polish: subtitle bar above the panel for visual
              parity with Diagnosis. PrescriptionPanel itself is shared
              with OPD so we don't touch internals — just wrap better. */}
          <Section title="Prescription / Medications" icon="pi-file-edit" color={C.green} badge={`${meds.length} drug${meds.length===1?"":"s"}`} disabled={ro}>
            <div style={{ fontSize: 11, color: C.muted, fontWeight: 500, marginBottom: 12, marginTop: -6 }}>
              Inpatient medications — drug · dose · frequency · meal · duration · route
            </div>
            <PrescriptionPanel value={meds} onChange={setMeds} />
          </Section>

          {/* ── R7hr-59 · Infusion / IV Fluids (shared InfusionPanel)
              R7hr-67 polish: subtitle bar. InfusionPanel internals stay
              untouched (shared with OPD); HAM auto-tag banner lives
              inside the panel. */}
          <Section title="Infusion / IV Fluids" icon="pi-bolt" color={C.teal} badge={`${infusions.length} order${infusions.length===1?"":"s"}`} disabled={ro}>
            <div style={{ fontSize: 11, color: C.muted, fontWeight: 500, marginBottom: 12, marginTop: -6 }}>
              IV fluids / drips — routes to nurse's Infusion Orders & Monitoring tab on save
            </div>
            <InfusionPanel value={infusions} onChange={setInfusions} />
          </Section>

          {/* ── Treatment Plan ── */}
          <Section title="Treatment Plan" icon="pi-list" color={C.green} disabled={ro}>
            <Field label="Treatment Plan / Management">
              <textarea value={treatmentPlan} onChange={e => setTreatmentPlan(e.target.value)}
                placeholder="Conservative / surgical plan, monitoring required, nursing orders, special instructions…"
                className="his-textarea" style={{ minHeight: 80 }} />
            </Field>
          </Section>

          {/* ── D6 + D7 + D8 · Care Decisions (NABH AAC.4 / ROP.1 / PSQ.4) ── */}
          <Section title="Care Decisions" icon="pi-flag" color={C.accent} badge="NABH AAC.4 + ROP.1" disabled={ro}>
            {/* Code Status */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".4px", marginBottom: 6 }}>
                Code Status (resuscitation preference)
              </div>
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12 }}>
                {[
                  ["FULL_CODE", "Full code (all measures)"],
                  ["DNR", "DNR (no CPR)"],
                  ["DNI", "DNI (no intubation)"],
                  ["LIMITED", "Limited / partial resuscitation"],
                ].map(([v, label]) => (
                  <label key={v} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                    <input type="radio" name="codeStatus" checked={codeStatus === v}
                      onChange={() => setCodeStatus(v)} />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
              {codeStatus !== "FULL_CODE" && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 10 }}>
                  <Field label="Discussed with (name + relation)">
                    <input value={codeStatusDiscussedWith} onChange={e => setCodeStatusDiscussedWith(e.target.value)}
                      placeholder="e.g. Wife — Mrs Smita Sharma" className="his-field" />
                  </Field>
                  <Field label="Specific limitations">
                    <input value={codeStatusLimitations} onChange={e => setCodeStatusLimitations(e.target.value)}
                      placeholder="e.g. No vasopressors, no dialysis" className="his-field" />
                  </Field>
                </div>
              )}
            </div>

            {/* ELOS + Goal of Care */}
            <div style={{ borderTop: `1px dashed ${C.border}`, paddingTop: 12, marginBottom: 12 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <Field label="Estimated Length of Stay (days)">
                  <input type="number" min="1" value={elosDays}
                    onChange={e => setElosDays(e.target.value)} placeholder="e.g. 5" className="his-field" />
                </Field>
                <Field label="Goal of Care">
                  <select value={goalOfCare} onChange={e => setGoalOfCare(e.target.value)} className="his-field">
                    <option value="">— Select —</option>
                    <option value="Curative">Curative</option>
                    <option value="Palliative">Palliative</option>
                    <option value="Supportive">Supportive</option>
                    <option value="Rehabilitative">Rehabilitative</option>
                    <option value="Diagnostic">Diagnostic workup</option>
                  </select>
                </Field>
              </div>
            </div>

            {/* Risk Acknowledgement — Fall / DVT / Pressure Ulcer / Pain */}
            <div style={{ borderTop: `1px dashed ${C.border}`, paddingTop: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".4px", marginBottom: 8 }}>
                Doctor's Risk Acknowledgement (independent of nursing capture)
              </div>
              {[
                ["fall",  "Fall risk",         "Plan: e.g. bed-rail, footwear, side-rail toilet…"],
                ["dvt",   "DVT / VTE risk",    "Plan: e.g. LMWH 40mg SC OD, compression stockings…"],
                ["ulcer", "Pressure ulcer",    "Plan: e.g. 2-hourly turning, air-mattress…"],
                ["pain",  "Pain management",   "Plan: e.g. PRN analgesia, multimodal, regional block…"],
              ].map(([k, label, hint]) => (
                <div key={k} style={{ display: "grid", gridTemplateColumns: "200px 1fr", gap: 12, alignItems: "flex-start", marginBottom: 8 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, cursor: "pointer", paddingTop: 8 }}>
                    <input type="checkbox" checked={!!docRiskAck[k]?.acknowledged}
                      onChange={e => setDocRiskAck(r => ({ ...r, [k]: { ...r[k], acknowledged: e.target.checked } }))} />
                    {label}
                  </label>
                  <div>
                    {k === "dvt" && (
                      <input value={docRiskAck.dvt?.score || ""}
                        onChange={e => setDocRiskAck(r => ({ ...r, dvt: { ...r.dvt, score: e.target.value } }))}
                        placeholder="Caprini score (e.g. 4)" className="his-field"
                        style={{ marginBottom: 6, padding: "5px 8px", fontSize: 11.5 }} />
                    )}
                    <input value={docRiskAck[k]?.plan || ""}
                      onChange={e => setDocRiskAck(r => ({ ...r, [k]: { ...r[k], plan: e.target.value } }))}
                      placeholder={hint} className="his-field"
                      style={{ padding: "5px 8px", fontSize: 11.5 }} />
                  </div>
                </div>
              ))}
            </div>
          </Section>

          {/* ══════════════════════════════════════════════════════════
              R7fd · DOCTOR P1 NABH FIELDS (D10-D14)
              ══════════════════════════════════════════════════════════ */}

          {/* ── D10 · Anthropometry (drug-dosing safety) ──
              R7fe-D: Nurse owns Ht / Wt / BMI (measured with calibrated
              scale at admission). Doctor's section mirrors nurse's values
              read-only and only IBW (Devine formula) stays doctor-
              editable. Falls back to writable inputs if no nursing
              measurement exists yet — the doctor can still proceed. */}
          {(() => {
            const fromNursing = !!(anthropo.heightCm || anthropo.weightKg);
            return (
              <Section title="Anthropometry" icon="pi-chart-line" color={C.teal} badge="Drug-dosing safety" disabled={ro}>
                {fromNursing && (
                  <div style={{ background: "#fdf2f8", border: `1.5px solid ${C.pink}40`, borderRadius: 6, padding: "6px 10px", marginBottom: 10, fontSize: 11, color: C.pink, fontWeight: 600 }}>
                    <i className="pi pi-info-circle" style={{ marginRight: 6 }} />
                    Ht / Wt / BMI measured by nursing — read-only here. Only IBW is doctor-editable.
                  </div>
                )}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>
                  <Field label={fromNursing ? "Height (cm) · from nursing" : "Height (cm)"}>
                    <input type="number" value={docAnthropo.heightCm} readOnly={fromNursing}
                      onChange={e => {
                        if (fromNursing) return;
                        const h = e.target.value;
                        const w = Number(docAnthropo.weightKg);
                        const hM = Number(h) / 100;
                        const bmi = (h && w && hM > 0) ? (w / (hM * hM)).toFixed(1) : "";
                        setDocAnthropo(a => ({ ...a, heightCm: h, bmi }));
                      }} placeholder="e.g. 168" className="his-field"
                      style={fromNursing ? { background: "#f8fafc", fontWeight: 600 } : undefined} />
                  </Field>
                  <Field label={fromNursing ? "Weight (kg) · from nursing" : "Weight (kg)"}>
                    <input type="number" value={docAnthropo.weightKg} readOnly={fromNursing}
                      onChange={e => {
                        if (fromNursing) return;
                        const w = e.target.value;
                        const h = Number(docAnthropo.heightCm) / 100;
                        const bmi = (w && h > 0) ? (Number(w) / (h * h)).toFixed(1) : "";
                        setDocAnthropo(a => ({ ...a, weightKg: w, bmi }));
                      }} placeholder="e.g. 68" className="his-field"
                      style={fromNursing ? { background: "#f8fafc", fontWeight: 600 } : undefined} />
                  </Field>
                  <Field label="BMI (auto)">
                    <input value={docAnthropo.bmi} readOnly placeholder="—"
                      className="his-field" style={{ background: "#f8fafc", fontWeight: 700 }} />
                  </Field>
                  <Field label="Ideal Body Weight (kg)">
                    <input type="number" value={docAnthropo.idealBodyWeightKg}
                      onChange={e => setDocAnthropo(a => ({ ...a, idealBodyWeightKg: e.target.value }))}
                      placeholder="e.g. 65 (Devine formula)" className="his-field" />
                  </Field>
                </div>
                <div style={{ marginTop: 8, fontSize: 10.5, color: C.muted }}>
                  Devine IBW: Males = 50 + 2.3 kg per inch &gt; 5 ft; Females = 45.5 + 2.3 kg per inch &gt; 5 ft.
                  Use IBW (not actual weight) for aminoglycoside / vancomycin / heparin dosing in obese patients.
                </div>
              </Section>
            );
          })()}

          {/* ── D11 · Local examination (surgical/focused) ── */}
          <Section title="Local / Focused Examination" icon="pi-search" color={C.purple} disabled={ro}>
            <Field label="Local examination findings (relevant to chief complaint)">
              <textarea value={localExam} onChange={e => setLocalExam(e.target.value)}
                placeholder="e.g. RIF tender, McBurney's positive, Rovsing's negative, no rebound. Wound: clean, healthy granulation, 4×3 cm, no slough…"
                className="his-textarea" style={{ minHeight: 72 }} />
            </Field>
          </Section>

          {/* ── D12 · Cross-Consultation / Referrals ── */}
          <Section title="Cross-Consultation / Referrals" icon="pi-users" color={C.accent} badge="NABH COP" disabled={ro}>
            {referrals.length > 0 && (
              <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 8, fontSize: 11.5 }}>
                <thead>
                  <tr style={{ background: "#f8fafc" }}>
                    {["Specialty", "Reason", "Urgency", "Status", ""].map(h => (
                      <th key={h} style={{ padding: "6px 8px", textAlign: "left", fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase", borderBottom: `1.5px solid ${C.border}` }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {referrals.map((r, i) => (
                    <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                      <td><input value={r.specialty || ""} onChange={e => setReferrals(l => l.map((x, j) => j === i ? { ...x, specialty: e.target.value } : x))} placeholder="Specialty" className="his-field" style={{ padding: "4px 6px" }} /></td>
                      <td><input value={r.reason || ""} onChange={e => setReferrals(l => l.map((x, j) => j === i ? { ...x, reason: e.target.value } : x))} placeholder="Reason" className="his-field" style={{ padding: "4px 6px" }} /></td>
                      <td>
                        <select value={r.urgency || "Routine"} onChange={e => setReferrals(l => l.map((x, j) => j === i ? { ...x, urgency: e.target.value } : x))} className="his-field" style={{ padding: "4px 6px" }}>
                          {["Stat", "Urgent", "Routine"].map(t => <option key={t}>{t}</option>)}
                        </select>
                      </td>
                      <td>
                        <select value={r.status || "Requested"} onChange={e => setReferrals(l => l.map((x, j) => j === i ? { ...x, status: e.target.value } : x))} className="his-field" style={{ padding: "4px 6px" }}>
                          {["Requested", "Accepted", "Seen", "Declined"].map(t => <option key={t}>{t}</option>)}
                        </select>
                      </td>
                      <td><button onClick={() => setReferrals(l => l.filter((_, j) => j !== i))} style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer" }}><i className="pi pi-trash" style={{ fontSize: 12 }} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <button onClick={() => setReferrals(l => [...l, { specialty: "", reason: "", urgency: "Routine", status: "Requested" }])}
              style={{ padding: "5px 12px", border: `1.5px dashed ${C.accent}60`, borderRadius: 6, background: C.accentL, cursor: "pointer", fontSize: 11.5, fontWeight: 600, color: C.accent }}>
              <i className="pi pi-plus" style={{ marginRight: 5, fontSize: 10 }} />Add referral
            </button>
          </Section>

          {/* ── D13 · Prognosis Discussion ── */}
          <Section title="Prognosis Discussed With" icon="pi-comments" color={C.pink} badge="NABH PRE.4" disabled={ro}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Discussed with (name + relation)">
                <input value={prognosis.discussedWith}
                  onChange={e => setPrognosis(p => ({ ...p, discussedWith: e.target.value }))}
                  placeholder="e.g. Mr Ravi Sharma (Husband)" className="his-field" />
              </Field>
              <Field label="Language used">
                <select value={prognosis.languageUsed}
                  onChange={e => setPrognosis(p => ({ ...p, languageUsed: e.target.value }))} className="his-field">
                  {["Hindi", "English", "Punjabi", "Haryanvi", "Urdu", "Bengali", "Tamil", "Telugu", "Marathi", "Other"].map(o => <option key={o}>{o}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Summary of prognosis communicated" style={{ marginTop: 10 }}>
              <textarea value={prognosis.summary}
                onChange={e => setPrognosis(p => ({ ...p, summary: e.target.value }))}
                placeholder="e.g. Explained diagnosis of severe sepsis with multi-organ dysfunction. Mortality risk ~30%. Family understood and consented to ICU admission + ventilation if needed."
                className="his-textarea" style={{ minHeight: 56 }} />
            </Field>
            <Field label="Questions addressed / concerns" style={{ marginTop: 10 }}>
              <textarea value={prognosis.questionsAddressed}
                onChange={e => setPrognosis(p => ({ ...p, questionsAddressed: e.target.value }))}
                placeholder="What did family ask? What was the response?"
                className="his-textarea" style={{ minHeight: 50 }} />
            </Field>
          </Section>

          {/* ── D14 · Consent Linkage ── */}
          <Section title="Consents Required" icon="pi-id-card" color={C.green} badge="NABH PRE.3 + PRE.4" disabled={ro}>
            <div style={{ fontSize: 10.5, color: C.muted, marginBottom: 8 }}>
              Flag which consents must be obtained before procedures. Each flagged consent must be captured
              with biometric + staff e-sign via the Consent Forms page (R7ez).
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, fontSize: 12 }}>
              {[
                ["surgical", "Surgical / Operation"],
                ["anesthesia", "Anaesthesia"],
                ["bloodTransfusion", "Blood Transfusion"],
                ["hivTesting", "HIV Testing"],
                ["photography", "Photography / Recording"],
                ["research", "Research / Trial"],
                ["dnr", "DNR"],
                ["lama", "LAMA (pre-emptive)"],
              ].map(([k, label]) => (
                <label key={k} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                  <input type="checkbox" checked={!!consentNeeded[k]}
                    onChange={e => setConsentNeeded(c => ({ ...c, [k]: e.target.checked }))} />
                  {label}
                </label>
              ))}
            </div>
          </Section>

          {/* ══════════════════════════════════════════════════════════
              R7fg · DOCTOR P2 NABH FIELDS (D15-D18)
              ══════════════════════════════════════════════════════════ */}

          {/* ── D15 · Menstrual / Obstetric (women of childbearing age) ── */}
          <Section title="Menstrual & Obstetric History" icon="pi-heart" color={C.pink} disabled={ro}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, cursor: "pointer", marginBottom: 10 }}>
              <input type="checkbox" checked={obGyn.isApplicable} onChange={e => setObGyn(p => ({ ...p, isApplicable: e.target.checked }))} />
              Patient is female of childbearing age — capture below
            </label>
            {obGyn.isApplicable && (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10 }}>
                  <Field label="LMP (Last Menstrual Period)"><input type="date" value={obGyn.lmp} onChange={e => setObGyn(p => ({ ...p, lmp: e.target.value }))} className="his-field" /></Field>
                  <Field label="Cycle days (e.g. 28)"><input value={obGyn.cycleDays} onChange={e => setObGyn(p => ({ ...p, cycleDays: e.target.value }))} className="his-field" placeholder="28" /></Field>
                  <Field label="G P A L">
                    <div style={{ display: "flex", gap: 4 }}>
                      <input value={obGyn.gravida} onChange={e => setObGyn(p => ({ ...p, gravida: e.target.value }))} placeholder="G" className="his-field" style={{ padding: "5px 6px" }} />
                      <input value={obGyn.para} onChange={e => setObGyn(p => ({ ...p, para: e.target.value }))} placeholder="P" className="his-field" style={{ padding: "5px 6px" }} />
                      <input value={obGyn.abortions} onChange={e => setObGyn(p => ({ ...p, abortions: e.target.value }))} placeholder="A" className="his-field" style={{ padding: "5px 6px" }} />
                      <input value={obGyn.livingChildren} onChange={e => setObGyn(p => ({ ...p, livingChildren: e.target.value }))} placeholder="L" className="his-field" style={{ padding: "5px 6px" }} />
                    </div>
                  </Field>
                  <Field label="Contraception (current)">
                    <input value={obGyn.contraception} onChange={e => setObGyn(p => ({ ...p, contraception: e.target.value }))} placeholder="OCP / IUCD / barrier / nil" className="his-field" />
                  </Field>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginTop: 10 }}>
                  <Field label="Last pregnancy outcome">
                    <input value={obGyn.lastPregnancyOutcome} onChange={e => setObGyn(p => ({ ...p, lastPregnancyOutcome: e.target.value }))} placeholder="LSCS 2022 / Term-vaginal 2020 / Miscarriage" className="his-field" />
                  </Field>
                  <Field label="Pregnancy test (β-hCG)">
                    <select value={obGyn.pregnancyTestResult} onChange={e => setObGyn(p => ({ ...p, pregnancyTestResult: e.target.value, pregnancyTestDone: !!e.target.value }))} className="his-field">
                      <option value="">Not done</option>
                      <option>Negative</option>
                      <option>Positive</option>
                    </select>
                  </Field>
                  <Field label="Cycle regularity">
                    <select value={obGyn.cycleRegular ? "Regular" : "Irregular"} onChange={e => setObGyn(p => ({ ...p, cycleRegular: e.target.value === "Regular" }))} className="his-field">
                      <option>Regular</option>
                      <option>Irregular</option>
                    </select>
                  </Field>
                </div>
                <Field label="Notes" style={{ marginTop: 10 }}>
                  <textarea value={obGyn.notes} onChange={e => setObGyn(p => ({ ...p, notes: e.target.value }))} placeholder="Menstrual concerns, PCOS, endometriosis, infertility…" className="his-textarea" style={{ minHeight: 50 }} />
                </Field>
              </>
            )}
          </Section>

          {/* ── D16 · Immunisation Status ── */}
          <Section title="Immunisation Status" icon="pi-shield" color={C.green} disabled={ro}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, cursor: "pointer", marginBottom: 10 }}>
              <input type="checkbox" checked={immunisation.upToDateForAge} onChange={e => setImmunisation(p => ({ ...p, upToDateForAge: e.target.checked }))} />
              Up-to-date for age per national schedule
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 10 }}>
              {[
                ["tetanus", "Tetanus / Td"], ["hepB", "Hepatitis B"],
                ["covid", "COVID-19"],       ["influenza", "Influenza"],
                ["pneumococcal", "Pneumococcal"],
              ].map(([k, label]) => (
                <div key={k} style={{ display: "grid", gridTemplateColumns: "180px 1fr 1fr", gap: 6, alignItems: "center" }}>
                  <label style={{ fontSize: 11.5, display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontWeight: 600 }}>
                    <input type="checkbox" checked={immunisation[k]?.vaccinated || false} onChange={e => setImmunisation(p => ({ ...p, [k]: { ...p[k], vaccinated: e.target.checked } }))} />
                    {label}
                  </label>
                  <input type="date" value={immunisation[k]?.lastDate || ""} onChange={e => setImmunisation(p => ({ ...p, [k]: { ...p[k], lastDate: e.target.value } }))} className="his-field" style={{ padding: "5px 7px" }} />
                  {k === "covid" && (
                    <input value={immunisation.covid?.doses || ""} onChange={e => setImmunisation(p => ({ ...p, covid: { ...p.covid, doses: e.target.value } }))} placeholder="Doses (1/2/3 + booster)" className="his-field" style={{ padding: "5px 7px" }} />
                  )}
                </div>
              ))}
            </div>
            <Field label="Other vaccines / notes" style={{ marginTop: 10 }}>
              <input value={immunisation.other} onChange={e => setImmunisation(p => ({ ...p, other: e.target.value }))} placeholder="Rabies post-exposure / Yellow fever / Typhoid…" className="his-field" />
            </Field>
          </Section>

          {/* ── D17 · Functional / ECOG ── */}
          <Section title="Functional Status (ECOG)" icon="pi-user" color={C.teal} disabled={ro}>
            <Field label="ECOG Performance Status (0–4)">
              <select value={ecog.score} onChange={e => setEcog(p => ({ ...p, score: e.target.value }))} className="his-field">
                <option value="">— Select —</option>
                <option value="0">0 — Fully active, no restriction</option>
                <option value="1">1 — Light work; ambulatory</option>
                <option value="2">2 — Ambulatory, self-care; up &gt; 50% waking hours; no work</option>
                <option value="3">3 — Limited self-care; bed/chair &gt; 50% waking hours</option>
                <option value="4">4 — Completely disabled; cannot self-care; bedbound</option>
              </select>
            </Field>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
              <Field label="Disabilities">
                <input value={ecog.disabilities} onChange={e => setEcog(p => ({ ...p, disabilities: e.target.value }))} placeholder="Visual / hearing / cognitive / motor" className="his-field" />
              </Field>
              <Field label="Aids required">
                <input value={ecog.aidsRequired} onChange={e => setEcog(p => ({ ...p, aidsRequired: e.target.value }))} placeholder="Walker / wheelchair / NIV / oxygen" className="his-field" />
              </Field>
            </div>
          </Section>

          {/* ── D18 · Spiritual / Existential Needs ── */}
          <Section title="Spiritual / Existential Needs" icon="pi-star" color={C.purple} disabled={ro}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, cursor: "pointer", marginBottom: 10 }}>
              <input type="checkbox" checked={spiritual.distressNoted} onChange={e => setSpiritual(p => ({ ...p, distressNoted: e.target.checked }))} />
              Spiritual / existential distress noted at this visit
            </label>
            <Field label="Concerns expressed">
              <textarea value={spiritual.concerns} onChange={e => setSpiritual(p => ({ ...p, concerns: e.target.value }))} placeholder="Loss of meaning, fear of death, unresolved guilt, family rifts…" className="his-textarea" style={{ minHeight: 50 }} />
            </Field>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, cursor: "pointer", marginTop: 10 }}>
              <input type="checkbox" checked={spiritual.chaplainReferralRequested} onChange={e => setSpiritual(p => ({ ...p, chaplainReferralRequested: e.target.checked }))} />
              Chaplain / spiritual counsellor referral requested
            </label>
          </Section>

          {/* ── Diet, Activity & Follow-up ── */}
          <Section title="Diet, Activity & Follow-up" icon="pi-calendar-clock" color={C.teal} disabled={ro}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              <Field label="Diet Advice">
                <textarea value={dietAdvice} onChange={e => setDietAdvice(e.target.value)}
                  placeholder="Normal diet / diabetic diet / liquid diet / NPO…" className="his-textarea" />
              </Field>
              <Field label="Activity Advice">
                <textarea value={activityAdvice} onChange={e => setActivityAdvice(e.target.value)}
                  placeholder="Bed rest / restricted / ambulate with assistance…" className="his-textarea" />
              </Field>
              <Field label="Follow-up / Additional Instructions">
                <textarea value={followupNotes} onChange={e => setFollowupNotes(e.target.value)}
                  placeholder="Monitoring frequency, review labs, escalation criteria…" className="his-textarea" />
              </Field>
            </div>
          </Section>

          {/* ── Doctor sign-off ──
              R7hr-72/lock — hidden when LOCKED & !amendMode (the red
              ribbon's Amend button is the only path back in); when
              amendMode is on, the "Sign" button morphs into "Save
              Amendment" and dispatches via handleAmendSave. */}
          {!(iaLocked && !amendMode) && (
          <div style={{ background: amendMode ? "#fffbeb" : C.accentL,
            border: `1px solid ${amendMode ? "#d97706" : C.accent}30`, borderRadius: 12,
            padding: "14px 20px", marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: amendMode ? "#92400e" : C.accent }}>
                <i className="pi pi-verified" style={{ marginRight: 6 }} />Doctor's Digital Signature
              </div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                {doctorName || "—"} · {regNo || "Reg. no. not entered"} · {new Date().toLocaleString("en-IN")}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {!amendMode && (
                <button onClick={() => handleSave(false, "doctor")} disabled={saving}
                  style={{ padding: "9px 20px", border: `1.5px solid ${C.border}`, borderRadius: 8,
                    background: "white", cursor: saving ? "not-allowed" : "pointer",
                    fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 600, color: C.muted }}>
                  Save Draft
                </button>
              )}
              {amendMode ? (
                <button onClick={() => handleAmendSave("doctor")} disabled={saving}
                  style={{ padding: "9px 22px", border: "none", borderRadius: 8, background: "#d97706",
                    cursor: saving ? "not-allowed" : "pointer",
                    fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 700, color: "white",
                    boxShadow: "0 4px 14px rgba(217,119,6,.4)" }}>
                  <i className="pi pi-check-circle" style={{ marginRight: 6, fontSize: 12 }} />
                  {saving ? "Saving…" : "Save Amendment"}
                </button>
              ) : (
                <button onClick={async () => { await handleSave(true, "doctor"); onSign?.("doctor"); }} disabled={saving}
                  style={{ padding: "9px 22px", border: "none", borderRadius: 8, background: C.accent,
                    cursor: saving ? "not-allowed" : "pointer",
                    fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 700, color: "white",
                    boxShadow: `0 4px 14px ${C.accent}40` }}>
                  <i className="pi pi-check-circle" style={{ marginRight: 6, fontSize: 12 }} />
                  {saving ? "Submitting…" : "Sign Doctor Initial Assessment"}
                </button>
              )}
            </div>
          </div>
          )}

        </>)}

      </>)}
      {showSetup && (
        <SignaturePad
          existing={signature}
          onSave={async (dataUrl) => { await saveSignature(dataUrl); setShowSetup(false); }}
          onCancel={() => setShowSetup(false)}
        />
      )}

      {/* ── R7hr-72/lock · Amend modal ────────────────────────────────
          Centred overlay with a mandatory reason textarea (min 5 chars).
          Begin Amend captures the full form snapshot, flips amendMode
          on, and dismisses itself; the AMENDING ribbon + editable form
          take over. */}
      {amendModalOpen && (
        <div
          role="dialog" aria-modal="true" aria-labelledby="amend-modal-title"
          style={{
            position: "fixed", inset: 0, background: "rgba(15,23,42,.55)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 9999, padding: 20,
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setAmendModalOpen(false); }}
        >
          <div style={{
            background: "white", borderRadius: 14, width: "100%", maxWidth: 520,
            border: "1px solid #e2e6ea", boxShadow: "0 24px 70px rgba(15,23,42,.35)",
            overflow: "hidden",
          }}>
            <div style={{
              padding: "14px 20px", borderBottom: "1px solid #e2e6ea",
              background: "#fef2f2", display: "flex", alignItems: "center", gap: 8,
            }}>
              <span style={{ fontSize: 16 }} aria-hidden="true">{"🔒"}</span>
              <div id="amend-modal-title" style={{ fontSize: 14, fontWeight: 800, color: "#7f1d1d" }}>
                Amend Initial Assessment
              </div>
            </div>
            <div style={{ padding: "16px 20px" }}>
              <div style={{ fontSize: 12, color: C.muted, marginBottom: 8, lineHeight: 1.5 }}>
                This record is signed. Amendments are <strong>permanent + audit-logged</strong>.
                Please describe why the assessment must change.
              </div>
              <label style={{
                display: "block", fontSize: 11, fontWeight: 700, color: C.muted,
                textTransform: "uppercase", letterSpacing: ".6px", marginBottom: 4,
              }}>
                Reason for amendment <span style={{ color: C.red, marginLeft: 3 }}>*</span>
              </label>
              <textarea
                value={amendReason}
                onChange={(e) => setAmendReason(e.target.value)}
                placeholder="Reason for amendment (required) — e.g. lab corrected, vitals re-checked, history clarified…"
                style={{
                  width: "100%", minHeight: 92, padding: "8px 10px",
                  border: `1.5px solid ${amendReason.trim().length >= 5 ? C.border : "#fecaca"}`,
                  borderRadius: 8, fontSize: 13, fontFamily: "'DM Sans', sans-serif",
                  resize: "vertical", boxSizing: "border-box",
                }}
                autoFocus
              />
              <div style={{ fontSize: 10, color: amendReason.trim().length >= 5 ? C.muted : "#b91c1c", marginTop: 4 }}>
                {amendReason.trim().length}/5 characters minimum
              </div>
            </div>
            <div style={{
              padding: "12px 20px", borderTop: "1px solid #e2e6ea",
              background: "#f8fafc", display: "flex", justifyContent: "flex-end", gap: 8,
            }}>
              <button
                type="button"
                onClick={() => { setAmendModalOpen(false); }}
                style={{
                  padding: "8px 18px", border: `1.5px solid ${C.border}`, borderRadius: 8,
                  background: "white", color: C.muted, cursor: "pointer",
                  fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 700,
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={amendReason.trim().length < 5}
                onClick={() => {
                  const reason = amendReason.trim();
                  if (reason.length < 5) return;
                  setPreAmendSnapshot(captureFormSnapshot());
                  setAmendMode(true);
                  setAmendModalOpen(false);
                  setAmendReason(reason);
                }}
                style={{
                  padding: "8px 18px", border: "none", borderRadius: 8,
                  background: amendReason.trim().length >= 5 ? "#dc2626" : "#fca5a5",
                  color: "white",
                  cursor: amendReason.trim().length >= 5 ? "pointer" : "not-allowed",
                  fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 800,
                  boxShadow: amendReason.trim().length >= 5 ? "0 4px 12px rgba(220,38,38,.35)" : "none",
                }}
              >
                <i className="pi pi-pencil" style={{ fontSize: 10, marginRight: 5 }} />
                Begin Amend
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function IPDInitialAssessmentPage() {
  const [selectedPatient, setSelectedPatient] = useState(null);
  return (
    <ClinicalLayout onPatientSelect={setSelectedPatient} selectedId={selectedPatient?._id} pageType="ipd-assessment">
      <IPDInitialAssessmentContent selectedPatient={selectedPatient} />
    </ClinicalLayout>
  );
}
