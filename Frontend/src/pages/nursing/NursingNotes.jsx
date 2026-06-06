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
// Roadmap follow-up — dnp-* design system for the recorded-notes timeline.
import "../../pages/patient/patient-file.css";
import "../doctor/note-page-redesign.css";
import NurseOrdersPanel from "../../Components/clinical/NurseOrdersPanel";
import TreatmentChart from "../../Components/clinical/TreatmentChart";
import FingerprintConsentModal from "../../Components/clinical/FingerprintConsentModal";
import IntegratedVitalsPanel from "../../Components/clinical/IntegratedVitalsPanel";
import { saveVitalSheet, getVitalSheet } from "../../Services/vital/vitalService";
import NursingPatientReport from "../../Components/nursing/NursingPatientReport";
// R7cb-C: stop passing literal "SphereHealth Hospital" to NursingPatientReport.
import useHospitalSettings from "../../Components/print/useHospitalSettings";
// R7gc — per-type compact print for nursing notes (mirrors R7fx doctor-note pattern)
// R7gv — also pull the embed-card HTML builder so the standalone Nursing Notes
// timeline renders the same per-type artwork the Complete File embeds (instead
// of the bespoke dnp-note inline cards this page shipped with).
import { printNurseNote, buildNurseNoteCardHtml } from "./printNurseNote";
// R7bi — shared patient banner (Doctor + Nursing parity). Replaces the
// inline JSX that lived here pre-R7bi (with R7bg's QR/IPD/age/diagnosis
// enhancements now promoted into the shared component).
import PatientHeaderCard from "../../Components/clinical/PatientHeaderCard";
// R7hr-86 — alert chips (allergies + assessment compliance) ride beside
// the All Sections back button now, not inside the patient card footer.
import PatientAlertStrip from "../../Components/clinical/PatientAlertStrip";
// R7bi — QRCodeSVG import removed; the QR now lives inside the shared
// PatientHeaderCard component, so this file no longer references it.

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

/* ── Module definitions ──
   R7bf — `nabh` (chapter code) + `description` (one-line summary) added to
   each entry so the picker grid renders the same card layout used by
   Doctor Notes' "Select Note Type" (R7aw) and the /consent-forms picker.
   Each card shows icon + label + NABH code + description. */
const MODULES = [
  // R7bj — "Initial Assessment" module removed from this inline picker.
  // The COP.2 nurse Initial Assessment is filled on the dedicated full-
  // page form at /nursing-initial-assessment (reached via the top-level
  // "IPD Initial Assessment" tile, NABH AAC.1). Keeping a second
  // inline-only entry point was redundant and produced two saves of
  // the same assessment in two different shapes — the standalone page
  // is the source of truth.
  { id: "daily",     label: "Daily Assessment",           nabh: "NS.4",         description: "Shift-wise nursing assessment — head-to-toe review",
    icon: "pi-calendar-plus",        border: "#bae6fd", color: "#0369a1", bg: "#e0f2fe" },
  { id: "vitals",    label: "Vital Signs",                nabh: "NS.4",         description: "BP / HR / RR / SpO₂ / Temp / Pain / GCS / Urine",
    icon: "pi-heart",                border: "#bfdbfe", color: "#1d4ed8", bg: "#dbeafe" },
  { id: "neuro",     label: "Neuro / GCS",                nabh: "AAC.4",        description: "GCS, pupils, motor, posture (NIHSS for stroke)",
    icon: "pi-eye",                  border: "#d8b4fe", color: C.purple, bg: C.purpleL },
  { id: "pain",      label: "Pain Assessment",            nabh: "AAC.4",        description: "VAS / FLACC / numeric — onset, character, relief",
    icon: "pi-exclamation-circle",   border: "#fcd34d", color: "#b45309", bg: C.amberL },
  { id: "mews",      label: "MEWS Score",                 nabh: "COP.17",       description: "Modified Early Warning Score — escalation trigger",
    icon: "pi-chart-bar",            border: "#fbbf24", color: "#92400e", bg: "#fffbeb", dot: true },
  { id: "fall",      label: "Fall Risk (Morse)",          nabh: "AAC.4",        description: "Morse Fall Scale — risk score + precautions",
    icon: "pi-exclamation-triangle", border: "#fdba74", color: C.orange, bg: C.orangeL },
  // R7bs — DVT (Caprini) chip. Lives alongside Fall Risk because both are
  // structured-risk scoring scales. Auto-pops the NABH DVT register via
  // POST /api/nursing-assessments/dvt → nabhRegisterEmitter.emitDVT.
  { id: "dvt",       label: "DVT (Caprini)",              nabh: "MOM.7",        description: "Caprini VTE risk + IMPROVE bleeding score + prophylaxis",
    icon: "pi-shield",               border: "#a5b4fc", color: "#4338ca", bg: "#eef2ff" },
  { id: "skin",      label: "Skin / Pressure Assessment", nabh: "AAC.4",        description: "Braden / pressure ulcer staging, integrity check",
    icon: "pi-th-large",             border: "#86efac", color: "#166534", bg: C.greenL },
  { id: "intake",    label: "Intake / Output",            nabh: "COP.16",       description: "Oral / IV / NG intake vs urine / drains / NG-loss",
    icon: "pi-sort-alt",             border: "#93c5fd", color: C.accent, bg: C.accentL },
  { id: "iv",        label: "IV Infusion",                nabh: "MOM.4",        description: "IV access, infusion rate, drip monitoring",
    icon: "pi-plus-circle",          border: "#6ee7b7", color: C.teal, bg: C.tealL },
  { id: "blood",     label: "Blood Transfusion",          nabh: "COP.16",       description: "Whole blood / PRBC / FFP / Platelet — 2-nurse check",
    icon: "pi-heart-fill",           border: "#fca5a5", color: "#9f1239", bg: "#fecaca", dot: true },
  { id: "wound",     label: "Wound / Dressing",           nabh: "COP.15",       description: "Wound assessment, dressing change, drains",
    icon: "pi-pencil",               border: "#fca5a5", color: C.red, bg: C.redL },
  { id: "procedure", label: "Procedure / Intervention",   nabh: "COP.10",       description: "Nursing procedure note — aseptic technique, complications",
    icon: "pi-cog",                  border: "#c4b5fd", color: C.purple, bg: C.purpleL },
  { id: "careplan",  label: "Care Plan",                  nabh: "COP.8",        description: "Nursing care plan with goals + interventions",
    icon: "pi-heart-fill",           border: "#6ee7b7", color: "#065f46", bg: "#ecfdf5" },
  { id: "nutrition", label: "Nutritional Assessment",     nabh: "COP.16",       description: "NRS-2002 nutritional risk screening",
    icon: "pi-apple",                border: "#86efac", color: "#15803d", bg: "#dcfce7" },
  { id: "education", label: "Patient Education",          nabh: "PRE.5",        description: "Patient + family education session log",
    icon: "pi-book",                 border: "#c4b5fd", color: "#6d28d9", bg: "#f5f3ff" },
  { id: "discharge", label: "Discharge / Handover",       nabh: "AAC.4",        description: "RN-to-RN handover + discharge instructions",
    icon: "pi-sign-out",             border: "#6ee7b7", color: C.green, bg: C.greenL },
  { id: "general",   label: "General Observation",        nabh: "COP.1",        description: "Free-text observation note",
    icon: "pi-file",                 border: "#d1d5db", color: "#374151", bg: C.grayL },
];

/* ── R7bs — Caprini 2010 VTE risk factor catalogue (weighted) ──
 * Mirrors CapriniDVTAssessmentPage.jsx so the nursing-notes chip and the
 * standalone Caprini page share the same scoring source of truth. */
const CAPRINI_FACTORS_BY_WEIGHT = {
  5: [
    { code: "STROKE_LT_1M",             label: "Stroke (<1 mo)" },
    { code: "ELECTIVE_LE_ARTHROPLASTY", label: "Elective major LE arthroplasty" },
    { code: "HIP_PELVIS_LEG_FRACTURE",  label: "Hip / pelvis / leg fracture (<1 mo)" },
    { code: "ACUTE_SPINAL_CORD_INJURY", label: "Acute spinal-cord injury w/ paralysis (<1 mo)" },
    { code: "MULTIPLE_TRAUMA",          label: "Multiple trauma (<1 mo)" },
  ],
  3: [
    { code: "AGE_GE_75",                label: "Age ≥ 75 years" },
    { code: "HISTORY_DVT_PE",           label: "History of DVT / PE" },
    { code: "FAMILY_HISTORY_THROMBOSIS",label: "Family history of thrombosis" },
    { code: "FACTOR_V_LEIDEN",          label: "Factor V Leiden mutation" },
    { code: "PROTHROMBIN_20210A",       label: "Prothrombin 20210A mutation" },
    { code: "LUPUS_ANTICOAGULANT",      label: "Lupus anticoagulant" },
    { code: "ANTICARDIOLIPIN_AB",       label: "Anticardiolipin antibodies" },
    { code: "ELEVATED_HOMOCYSTEINE",    label: "Elevated serum homocysteine" },
    { code: "HIT_HISTORY",              label: "Heparin-induced thrombocytopenia (HIT)" },
    { code: "OTHER_THROMBOPHILIA",      label: "Other thrombophilia" },
  ],
  2: [
    { code: "AGE_61_74",                label: "Age 61–74 years" },
    { code: "ARTHROSCOPIC_SURGERY",     label: "Arthroscopic surgery" },
    { code: "MAJOR_OPEN_SURGERY",       label: "Major open surgery (>45 min)" },
    { code: "LAPAROSCOPIC_GT_45",       label: "Laparoscopic surgery (>45 min)" },
    { code: "MALIGNANCY",               label: "Malignancy (present or prior)" },
    { code: "BEDREST_GT_72H",           label: "Patient confined to bed (>72 h)" },
    { code: "IMMOBILIZING_CAST",        label: "Immobilizing plaster cast (<1 mo)" },
    { code: "CENTRAL_VENOUS_LINE",      label: "Central venous access" },
  ],
  1: [
    { code: "AGE_41_60",                label: "Age 41–60 years" },
    { code: "MINOR_SURGERY",            label: "Minor surgery planned" },
    { code: "BMI_OVER_25",              label: "BMI > 25 kg/m²" },
    { code: "SWOLLEN_LEGS",             label: "Swollen legs (current)" },
    { code: "VARICOSE_VEINS",           label: "Varicose veins" },
    { code: "PREGNANCY_POSTPARTUM",     label: "Pregnancy / postpartum (<1 mo)", femaleOnly: true },
    { code: "RECURRENT_ABORTION",       label: "Recurrent / unexplained spontaneous abortion", femaleOnly: true },
    { code: "OCP_HRT",                  label: "On OCP / HRT", femaleOnly: true },
    { code: "SEPSIS_LT_1M",             label: "Sepsis (<1 mo)" },
    { code: "LUNG_DISEASE_LT_1M",       label: "Serious lung disease incl. pneumonia (<1 mo)" },
    { code: "ABNORMAL_PFT",             label: "Abnormal PFT (COPD)" },
    { code: "ACUTE_MI",                 label: "Acute myocardial infarction" },
    { code: "CHF_LT_1M",                label: "Congestive heart failure (<1 mo)" },
    { code: "IBD_HISTORY",              label: "History of inflammatory bowel disease" },
    { code: "MEDICAL_BEDREST",          label: "Medical patient at bed rest" },
  ],
};
const IMPROVE_BLEED_FACTORS = [
  { code: "MOD_RENAL_FAIL",  label: "Moderate renal failure (GFR 30–59)",       points: 1 },
  { code: "MALE",            label: "Male sex",                                  points: 1 },
  { code: "AGE_40_84",       label: "Age 40–84 years",                           points: 1.5 },
  { code: "CURRENT_CANCER",  label: "Current cancer",                            points: 2 },
  { code: "RHEUMATIC",       label: "Rheumatic disease",                         points: 2 },
  { code: "CV_CATHETER",     label: "Central venous catheter",                   points: 2 },
  { code: "ICU_CCU",         label: "ICU / CCU admission",                       points: 2.5 },
  { code: "SEV_RENAL_FAIL",  label: "Severe renal failure (GFR <30)",            points: 2.5 },
  { code: "HEPATIC_FAILURE", label: "Hepatic failure (INR >1.5)",                points: 2.5 },
  { code: "AGE_GE_85",       label: "Age ≥ 85 years",                            points: 3.5 },
  { code: "PLT_LT_50",       label: "Platelets <50 × 10⁹/L",                     points: 4 },
  { code: "RECENT_BLEED",    label: "Bleeding in 3 mo before admission",         points: 4 },
  { code: "GU_ULCER",        label: "Active gastroduodenal ulcer",               points: 4.5 },
];
const DVT_CONTRAINDICATIONS = [
  "Active clinically significant bleeding",
  "Severe thrombocytopenia (<50 × 10⁹/L)",
  "Known / suspected HIT",
  "Coagulopathy (INR >1.5, not on warfarin)",
  "Recent intracranial / spinal / ophthalmic surgery (<14 days)",
  "Severe uncontrolled hypertension (BP >230/120)",
  "Neuraxial anaesthesia within timing window",
  "Known LMWH / UFH / DOAC hypersensitivity",
];
function _capriniTier(score) {
  if (score >= 9) return { tier: "Highest", bg: "#fef2f2", color: "#991b1b" };
  if (score >= 5) return { tier: "High",    bg: "#fff7ed", color: "#9a3412" };
  if (score >= 3) return { tier: "Moderate",bg: "#eff6ff", color: "#1d4ed8" };
  if (score >= 1) return { tier: "Low",     bg: "#f8fafc", color: "#475569" };
  return                  { tier: "Very Low", bg: "#f8fafc", color: "#64748b" };
}

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
  if (h >= 7  && h < 12) return "morning";
  if (h >= 12 && h < 17) return "afternoon";
  if (h >= 17 && h < 21) return "evening";
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
  // R7cb-C: settings-driven hospital name passed into NursingPatientReport
  // (replaces literal "SphereHealth Hospital" near the report mount).
  const { settings: hospitalSettings } = useHospitalSettings();

  const [searchUHID, setSearchUHID] = useState("");
  const [ipdNoForDraft, setIpdNoForDraft] = useState("");
  // R7bg — Latest diagnosis fetched from /api/doctor-notes/ipd/{ipdNo}.
  // Refreshes on patient load + on tab focus so when the doctor saves a
  // new diagnosis via Doctor Notes → Patient Diagnosis tile, the nursing
  // patient header reflects it within seconds.
  const [latestDiagnosis, setLatestDiagnosis] = useState(null);

  // R7bd — Auto-load on side-panel click. Pre-R7bd only set the input
  // field; user had to click "Load Patient" themselves. Now we fire
  // loadPatient(uhid) directly so a single click in the side panel
  // fetches + renders the patient.
  useEffect(() => {
    if (selectedPatient?.UHID) {
      setSearchUHID(selectedPatient.UHID);
      loadPatient(selectedPatient.UHID);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPatient?._id, selectedPatient?.UHID]);

  // R7bg — Focus refresh useEffect MOVED below the `patient` useState
  // declaration to avoid TDZ ReferenceError. See the relocated block
  // after `const [patient, setPatient] = useState(null);`.

  /* Auto-load when /nursing-notes?uhid=… is opened from /bed-visual or
     /discharge-summary (mode=discharge). When ?mode=discharge is set the
     loader will FALL BACK to the most recent DISCHARGED admission if no
     active admission exists — and flip the page into late-entry mode so
     the nurse can still record the handover note that was skipped during
     the premature discharge finalize. */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const u    = params.get("uhid");
    const mode = params.get("mode");
    if (!u || !u.trim()) return;
    setSearchUHID(u.trim());
    (async () => {
      try {
        const { data } = await axios.get(
          `${API_ENDPOINTS.ADMISSIONS}/active?UHID=${encodeURIComponent(u.trim())}`,
        );
        const arr = Array.isArray(data) ? data : data.data || [];
        let active = arr[0];
        let isLateEntry = false;
        // Active admission not found — try discharged fallback if the
        // caller explicitly asked for the discharge handover flow.
        if (!active && mode === "discharge") {
          try {
            const r = await axios.get(
              `${API_ENDPOINTS.ADMISSIONS}?UHID=${encodeURIComponent(u.trim())}&status=Discharged`,
            );
            const dis = Array.isArray(r.data) ? r.data : r.data?.data || [];
            // Most recent discharged admission for this UHID.
            active = dis.sort((a, b) =>
              new Date(b.actualDischargeDate || b.updatedAt || 0) -
              new Date(a.actualDischargeDate || a.updatedAt || 0),
            )[0];
            if (active) isLateEntry = true;
          } catch (_) { /* fall through to silent fail */ }
        }
        if (active) {
          setPatient(active);
          setLateEntryMode(isLateEntry);
          const ipd = active.ipdNo || active.admissionNumber || active._id;
          setIpdNoForDraft(ipd);
          await fetchNotes(ipd, active);
          if (isLateEntry) {
            toast.info("Discharged admission loaded in LATE-ENTRY mode. Provide a reason for the retroactive note.", { autoClose: 6000 });
          }
        }
      } catch (_) { /* silent — user can still search manually */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [patient,    setPatient]    = useState(null);

  /* R7bg — Refresh latest diagnosis when the tab regains focus.
     If the doctor updated diagnosis in their notes while the nurse was
     on another tab, this brings the new value back without forcing a
     full reload. Placed AFTER the `patient` useState declaration —
     pre-fix this lived earlier and crashed because the deps array
     `[patient?._id]` read `patient` while it was still in the temporal
     dead zone (const declared later in the function body). */
  useEffect(() => {
    if (!patient) return;
    const ipd = patient.ipdNo || patient.admissionNumber || patient._id;
    const onFocus = () => fetchLatestDiagnosis(ipd);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patient?._id]);
  const [notes,      setNotes]      = useState([]);
  const [loading,    setLoading]    = useState(false);
  const [activeModal,setActiveModal]= useState(null);
  const [editingNote,setEditingNote]= useState(null);

  /* ── Late-entry mode (NABH HIC.6 backdated entry) ──
     Enabled when the loaded admission is already DISCHARGED — typically
     because the receptionist (or doctor) finalized discharge before the
     nursing handover note was written. The page stays usable but every
     subsequent saveNote() POSTs `lateEntry: true` + the mandatory reason
     so the audit trail flags the row as retroactive. The reason input
     blocks save until the nurse fills it. */
  const [lateEntryMode,   setLateEntryMode]   = useState(false);
  const [lateEntryReason, setLateEntryReason] = useState("");

  /* ── Initial Assessment Gate (NABH COP.2) ──
     R7bi re-enables the gate per the requirement that other notes
     stay locked until the nurse files the Initial Assessment for THIS
     admission. Lifts when:
       1. Admission has initialAssessment.nurseCompleted === true, OR
       2. Patient already has at least one nurse note saved (legacy
          admissions where nurseCompleted was never persisted due to
          the Mongoose strict-mode bug that has since been fixed).
     R7bj — Only the "IPD Initial Assessment" top-level tile (NABH
     AAC.1, full /nursing-initial-assessment page) stays unlocked
     while the gate is active. The inline COP.2 module that used to
     live inside "Add a Care Note" was deleted in R7bj.
  ── */
  const nurseAssessmentDone =
    !!patient?.initialAssessment?.nurseCompleted || (notes?.length || 0) > 0;
  const gateActive = !!patient && !nurseAssessmentDone;
  const [filterType, setFilterType] = useState("All");
  const [filterShift,setFilterShift]= useState("");
  // R7fp — date range filter (parity with Doctor Notes timeline).
  // Values: "today" | "week" | "7days" | "all". Default "today".
  // R7gv — default to "all" so the standalone Nursing Notes timeline
  // surfaces ALL historical notes the same way the Complete File does
  // (the tile is literally subtitled "All historical care notes + filters").
  // The "today" default left timelines empty whenever no nurse note was
  // recorded on the current calendar date — even when the patient had a
  // long history under Badal-style admissions. setFilterDateRange is still
  // available for future date-pill UI.
  const [filterDateRange, setFilterDateRange] = useState("all");
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

  /* ── Tile / section navigator ──
       Nursing Notes is split into 5 tiles, mirroring the Doctor Notes
       tile pattern. `activeTile` null → grid view; otherwise the
       matching section expands inline below the patient banner.
       Tile keys: "orders" | "mar" | "addnote" | "equipment" | "timeline" */
  const [activeTile, setActiveTile] = useState(null);

  /* ── Patient Report (print / PDF) ── */
  const [showReport, setShowReport] = useState(false);

  /* ── Module-specific form state ── */
  const [vitals,    setVitals]    = useState({ bp_sys: "", bp_dia: "", pulse: "", temp: "", spo2: "", rr: "", gcs: "", bsl: "", painScore: "", o2Flow: "", o2Device: "None", weight: "", position: "Supine" });
  // `intra` is the in-transfusion monitoring log — each row is one set of
  // vitals taken at a known minute offset (NABH typical schedule:
  // 15 min, 30 min, 60 min, then hourly). Array keeps the panel rendering
  // forward-compatible if the schedule changes.
  const [blood,     setBlood]     = useState({ product: "PRC (Packed RBC)", bagNo: "", crossMatchNo: "", volume: "350", groupVerified: true, secondNurse: "", startTime: "", status: "Transfusing", endTime: "", reactionType: "None", preBP_sys: "", preBP_dia: "", prePulse: "", preTemp: "", postBP_sys: "", postBP_dia: "", postPulse: "", intra: [
    { atMin: 15, bp_sys: "", bp_dia: "", pulse: "", temp: "" },
    { atMin: 30, bp_sys: "", bp_dia: "", pulse: "", temp: "" },
    { atMin: 60, bp_sys: "", bp_dia: "", pulse: "", temp: "" },
  ] });
  const [iv,        setIV]        = useState({ fluid: "NS 0.9%", volume: "", rate: "", dropsPerMin: "", route: "IV Right Forearm", site: "Patent", cannulaDate: "", setChangeDate: "", additive: "" });
  const [intake,    setIntake]    = useState({ oral: "", ivFluids: "", bloodProducts: "", urineOutput: "", drainOutput: "", nasogastric: "", emesis: "", bloodLoss: "" });
  const [ivMedOrders,    setIvMedOrders]    = useState([]); // IV dilution volumes from Treatment Chart
  const [ivMedLoading,   setIvMedLoading]   = useState(false);
  const [includedMedIds, setIncludedMedIds] = useState(new Set());
  // R7bq-5 — Auto-fed I/O ledger rows (source of truth). Populated from
  // /api/intake-output. Drives the "Auto-recorded today" strip in the
  // I/O modal — read-only, can be voided but never edited.
  const [ioLedger,       setIoLedger]       = useState({ rows: [], totals: { in: 0, out: 0, net: 0 } });
  const [ioLedgerLoading,setIoLedgerLoading]= useState(false);
  const [neuro,     setNeuro]     = useState({ gcse: "", gcsv: "", gcsm: "", pupils: "Equal & Reactive", pupilSizeL: "", pupilSizeR: "", lightReflex: "Present", seizure: false, orientation: "Alert & Oriented ×3", limbUL: "Normal", limbUR: "Normal", limbLL: "Normal", limbLR: "Normal" });
  const [pain,      setPain]      = useState({ scale: "NRS", score: "", location: "", type: "Acute", character: "Dull", onset: "Sudden", duration: "", frequency: "Constant", radiation: false, radiationSite: "", aggravating: "", relieving: "", painOnMovement: false, nonPharm: "", analgesicGiven: false, analgesic: "", analgesicRoute: "IV", analgesicTime: "", reassessScore: "", reassessTime: "" });
  const [wound,     setWound]     = useState({ type: "Surgical", site: "", length: "", width: "", depth: "", exudateAmt: "None", exudateType: "Serous", healingStage: "Granulating", surroundingSkin: "Intact", tunneling: false, undermining: false, odour: false, dressing: "", painDuring: "", nextDressingDate: "", swabSent: false });
  const [skin,      setSkin]      = useState({ area: "", b1: "4", b2: "4", b3: "4", b4: "4", b5: "4", b6: "3", stage: "Stage I", intervention: "", repositioned: false, repositionFreq: "2-hourly" });
  const [fallRisk,  setFallRisk]  = useState({ m1: "0", m2: "0", m3: "0", m4: "0", m5: "0", m6: "0", intBedRails: false, intCallBell: false, intNonSlip: false, intBedLowest: false, intSupervision: false, intPatientEd: false, intFamilyEd: false });
  // R7bs — Caprini DVT/VTE risk factor selections. Keys mirror the
  // CAPRINI_FACTORS table below; values are simple booleans. The IMPROVE
  // bleed-risk factors share the same selection object (improveSelected)
  // for clean state management. Saving emits to /api/nursing-assessments/dvt
  // which fans out to the NABH DVT register via emitFromNursingAssessment.
  const [dvtSelected, setDvtSelected] = useState({});
  const [dvtImproveSelected, setDvtImproveSelected] = useState({});
  const [dvtContras, setDvtContras] = useState([]);
  const [dvtContraNotes, setDvtContraNotes] = useState("");
  const [dvtTrigger, setDvtTrigger] = useState("Admission");
  const [dvtSaving, setDvtSaving] = useState(false);
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

  /* ── R7bq-5 — Fetch the I/O ledger (auto + manual rows from DB) when
     the Intake/Output chip opens. This is the source of truth that the
     MAR auto-hook and the hourly infusion cron write into. The old
     ivMedOrders preview above stays as a checkbox helper for legacy
     notes, but new rows render straight from the ledger below. ─── */
  useEffect(() => {
    if (activeModal !== "intake" || !patient) return;
    const admissionId = patient?._id || patient?.admissionId;
    const UHID = patient?.uhid || patient?.UHID || patient?.patientId?.uhid || patient?.patientId?.UHID;
    if (!admissionId && !UHID) return;
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    const endOfDay   = new Date(); endOfDay.setHours(23, 59, 59, 999);
    setIoLedgerLoading(true);
    const qs = new URLSearchParams();
    if (admissionId) qs.append("admissionId", admissionId);
    else if (UHID)   qs.append("UHID", UHID);
    qs.append("from", startOfDay.toISOString());
    qs.append("to",   endOfDay.toISOString());
    axios.get(`${API_ENDPOINTS.INTAKE_OUTPUT}?${qs}`)
      .then(({ data }) => {
        const d = data?.data || { rows: [], totals: { in: 0, out: 0, net: 0 } };
        setIoLedger(d);
      })
      .catch(() => setIoLedger({ rows: [], totals: { in: 0, out: 0, net: 0 } }))
      .finally(() => setIoLedgerLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeModal, patient]);

  /* ── New consolidated module state ── */
  const [dailyAssess, setDailyAssess] = useState({
    // Vitals snapshot
    bp_sys: "", bp_dia: "", pulse: "", temp: "", spo2: "", rr: "", bsl: "", gcs: "",
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
    bp_sys: "", bp_dia: "", pulse: "", temp: "", spo2: "", rr: "", weight: "", height: "",
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
      const token = (sessionStorage.getItem("his_token"));
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

  /* ── Load patient ──
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
      // Use /active endpoint — it returns { data: [...] } and already filters status:"Active"
      // Also supports ?UHID= filter (both cases handled in service)
      const { data } = await axios.get(
        `${API_ENDPOINTS.ADMISSIONS}/active?UHID=${encodeURIComponent(uhidVal)}`
      );
      const arr = Array.isArray(data) ? data : data.data || [];
      let active = arr[0]; // all results are already Active; take latest
      let isLateEntry = false;
      // Fallback: when active is empty, try the discharged-admission lookup
      // and load the most recent one in late-entry mode. This covers the
      // "discharge was finalized without nursing handover" recovery path
      // — page stays usable, but each save is flagged retroactive with a
      // mandatory reason (NABH HIC.6).
      if (!active) {
        try {
          const r = await axios.get(
            `${API_ENDPOINTS.ADMISSIONS}?UHID=${encodeURIComponent(uhidVal)}&status=Discharged`
          );
          const dis = Array.isArray(r.data) ? r.data : r.data?.data || [];
          active = dis.sort((a, b) =>
            new Date(b.actualDischargeDate || b.updatedAt || 0) -
            new Date(a.actualDischargeDate || a.updatedAt || 0),
          )[0];
          if (active) isLateEntry = true;
        } catch (_) { /* keep active null */ }
      }
      setLateEntryMode(isLateEntry);
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
          setVitals({ bp_sys: "", bp_dia: "", pulse: "", temp: "", spo2: "", rr: "", gcs: "", bsl: "", painScore: "", o2Flow: "", o2Device: "None", weight: "", position: "Supine" });
          setMews({ rr: "", spo2: "", temp: "", sbp: "", hr: "", avpu: "A" });
        }
        setIvMedOrders([]); setIncludedMedIds(new Set());
        await fetchNotes(ipd, active);   // pass active so retroactive flag can run
        await fetchLatestDiagnosis(ipd); // R7bg — pull latest doctor diagnosis
        await loadTodayCharges(active._id);
        if (isLateEntry) {
          toast.warn(`Late-entry mode: ${active.patientName || searchUHID} is already DISCHARGED. Every note saved here will be flagged retroactive — provide a reason in the banner above.`, { autoClose: 8000 });
        } else {
          toast.success(`Loaded: ${active.patientName || active.patientId?.fullName || searchUHID}`);
        }
        // ── SphereAI: store active patient context ──
        sessionStorage.setItem("sphereai_active_patient", JSON.stringify({
          uhid: active.patientUHID || active.patientId?.UHID || searchUHID,
          patientId: String(active.patientId?._id || active.patientId || ""),
          ipdNo: ipd,
          patientName: active.patientName || active.patientId?.fullName || searchUHID,
          page: "nursing-notes"
        }));
      } else {
        toast.warn("No active IPD admission found for UHID: " + searchUHID);
      }
    } catch (err) {
      toast.error(err?.response?.data?.message || "Patient not found");
    }
    finally { setLoading(false); }
  };

  /* ── R7bg — Pull latest doctor diagnosis ──
     The Doctor's "Patient Diagnosis" tile in DoctorNotes (provisional /
     working / final + ICD-10) is saved as a doctor-notes record keyed
     by ipdNo. This helper fetches the most recent one whose diagnosis
     fields are populated so the nursing patient header always reflects
     the latest doctor decision. Falls back gracefully to admission's
     admittingDiagnosis if no doctor note exists. */
  const fetchLatestDiagnosis = async (ipdNo) => {
    if (!ipdNo) return;
    try {
      const { data } = await axios.get(`${API_ENDPOINTS.DOCTOR_NOTES}/ipd/${encodeURIComponent(ipdNo)}`);
      const arr = Array.isArray(data) ? data : data.data || [];
      // Find most recent note with any diagnosis populated. Sort by
      // createdAt desc; pick first non-empty.
      const sorted = arr
        .filter(n => n.finalDiagnosis || n.workingDiagnosis || n.provisionalDiagnosis)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      const top = sorted[0];
      if (top) {
        setLatestDiagnosis({
          text:
            top.finalDiagnosis ||
            top.workingDiagnosis ||
            top.provisionalDiagnosis ||
            "",
          tier: top.finalDiagnosis ? "Final"
              : top.workingDiagnosis ? "Working"
              : "Provisional",
          icd10Code: top.icd10Code || "",
          icd10Description: top.icd10Description || "",
          updatedAt: top.createdAt,
        });
      } else {
        setLatestDiagnosis(null);
      }
    } catch {
      // silent — keep whatever was previously fetched (or null) so a
      // transient backend blip doesn't blank the header.
    }
  };

  const fetchNotes = async (ipdNo, admissionDoc) => {
    try {
      const { data } = await axios.get(`${API_ENDPOINTS.NURSING_NOTES}/ipd/${encodeURIComponent(ipdNo)}`);
      const arr = Array.isArray(data) ? data : data.data || [];
      setNotes(arr.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));

      /* ── Retroactive fix: if notes exist but nurseCompleted not flagged in DB,
             persist the flag now so the gate never re-activates on reload.        ── */
      const admDoc = admissionDoc || patient;
      if (arr.length > 0 && admDoc?._id && !admDoc?.initialAssessment?.nurseCompleted) {
        try {
          const token = (sessionStorage.getItem("his_token"));
          await axios.post(
            `${API_ENDPOINTS.ADMISSIONS}/${admDoc._id}/nurse-assessment`,
            {
              UHID: admDoc.UHID || admDoc.uhid || "",
              assessedAt: arr[arr.length - 1]?.createdAt || new Date().toISOString(),
              assessedBy: arr[0]?.nurseName || "Nurse",
              nurseId: arr[0]?.nurseEmployeeId || "",
              designation: "Staff Nurse",
              notes: "Auto-flagged: nurse notes already existed for this admission.",
            },
            { headers: { Authorization: `Bearer ${token}` } }
          );
          // Also update local patient state so gate lifts without waiting
          setPatient(prev => prev ? ({
            ...prev,
            initialAssessment: { ...(prev.initialAssessment || {}), nurseCompleted: true },
          }) : prev);
        } catch (_) { /* silent — gate still lifts via notes.length > 0 */ }
      }
    } catch { /* silent */ }
  };

  const openModal = (id) => {
    /* R7bj — Gate: block ALL modules until the standalone Nursing
       Initial Assessment is filed. The "initial" inline module is gone;
       the only entry point now is the top-level "IPD Initial
       Assessment" tile (NABH AAC.1 → /nursing-initial-assessment). */
    if (gateActive) {
      toast.error("⛔ Open the 'IPD Initial Assessment' tile and complete the Nursing Initial Assessment first (NABH AAC.1 / COP.2).", { autoClose: 5500 });
      return;
    }
    setActiveModal(id);
    setNoteText(""); setIsCritical(false); setSelectedTags([]);
    // vitals persist across tab switches — they're updated live by IntegratedVitalsPanel
    setBlood({ product: "PRC (Packed RBC)", bagNo: "", crossMatchNo: "", volume: "350", groupVerified: true, secondNurse: "", startTime: "", status: "Transfusing", endTime: "", reactionType: "None", preBP_sys: "", preBP_dia: "", prePulse: "", preTemp: "", postBP_sys: "", postBP_dia: "", postPulse: "" });
    setIV({ fluid: "NS 0.9%", volume: "", rate: "", dropsPerMin: "", route: "IV Right Forearm", site: "Patent", cannulaDate: "", setChangeDate: "", additive: "" });
    setIntake({ oral: "", ivFluids: "", bloodProducts: "", urineOutput: "", drainOutput: "", nasogastric: "", emesis: "", bloodLoss: "" });
    // When opening MEWS tab, seed from current vitals; otherwise reset
    if (id === "mews") {
      const sbp = vitals.bp_sys || "";
      setMews(p => ({ ...p, rr: vitals.rr || p.rr, spo2: vitals.spo2 || p.spo2, temp: vitals.temp || p.temp, sbp: sbp || p.sbp, hr: vitals.pulse || p.hr }));
    } else {
      setMews({ rr: "", spo2: "", temp: "", sbp: "", hr: "", avpu: "A" });
    }
    setDailyAssess({ bp_sys:"", bp_dia:"", pulse:"", temp:"", spo2:"", rr:"", bsl:"", gcs:"", neuroStatus:"Alert & Oriented", respiratoryStatus:"Clear bilaterally", cardiovascularStatus:"Regular rate & rhythm", giStatus:"Active bowel sounds", guStatus:"Urine output adequate", musculoskeletalStatus:"Moves all extremities", skinStatus:"Intact", intReposition:false, intOralCare:false, intPressureRelief:false, intRangeOfMotion:false, intFallPrecautions:false, intCallBell:false, intMedAdministered:false, intWoundCare:false, intIVCheck:false, intNGTCheck:false, intFoleyCheck:false, intOxygenCheck:false, intPatientEducation:false, intFamilyUpdate:false, intDoctorNotified:false, intDocumented:false });
    setCarePlan({ problems: [{ id: Date.now(), statement:"", relatedTo:"", evidencedBy:"", priority:"High", goals:"", targetDate:"", interventions:"", evaluation:"", status:"Active" }] });
    setNutrition({ bmi:"", bmiLow:false, weightLoss:false, reducedIntake:false, seriouslyIll:false, nutritionScore:"0", diseaseScore:"0", ageScore:false, weight:"", height:"", idealBodyWeight:"", actualWeightPercent:"", midArmCirc:"", dietType:"Regular", consistency:"Normal", fluidRestriction:false, fluidLimit:"", appetite:"Good", swallowing:"Normal", feedingMode:"Oral", ngtPresent:false, caloriesToday:"", proteinToday:"", fluidToday:"", dietitianReferral:false, referralReason:"" });
    setEducation({ date: new Date().toISOString().split("T")[0], educator:"", topics:[], methods:[], language:"Hindi", understanding:"Good", barriers:[], response:"Positive", sessionNotes:"", nextSessionDate:"" });
  };

  const toggleTag = (t) => setSelectedTags(ts => ts.includes(t) ? ts.filter(x => x !== t) : [...ts, t]);

  const saveNote = async () => {
    if (!patient) { toast.warn("No patient loaded"); return; }
    // Late-entry guard — backend enforces this too (NABH HIC.6), but
    // catching it here saves a round-trip and surfaces the requirement
    // before the nurse fills the whole form.
    if (lateEntryMode && !lateEntryReason.trim()) {
      toast.error("This admission is DISCHARGED. Please enter a reason for the late-entry note (banner at top) before saving.");
      return;
    }
    const ipdNo = patient.ipdNo || patient.admissionNumber || patient._id;
    // patient is an admission object — patientId is the actual Patient ref (may be populated)
    const resolvedPatientId = patient.patientId?._id || patient.patientId || patient._id;
    let payload = {
      patientId: resolvedPatientId,
      patientUHID: patient.patientUHID || patient.uhid || patient.UHID || searchUHID,
      patientName: patient.patientName || patient.patientId?.fullName || patient.patient?.name || "",
      UHID: patient.patientUHID || patient.UHID || searchUHID,
      admissionNumber: ipdNo,
      ipdNo, shift, noteType: activeModal, isCriticalEvent: isCritical,
      remarks: noteText, tags: selectedTags, status: "submitted",
      nurseName: user?.fullName || user?.name || `${user?.firstName || ""} ${user?.lastName || ""}`.trim(),
      nurseEmployeeId: user?.employeeId || "",
      nurseId: user?._id || user?.id || undefined,
      // Late-entry flags — only emitted when the admission is already
      // discharged. Backend persists these on the NurseNote document so
      // surveyors can filter retroactive entries on audit replay.
      lateEntry: lateEntryMode || undefined,
      lateEntryReason: lateEntryMode ? lateEntryReason.trim() : undefined,
      lateEntryBy: lateEntryMode ? (user?.fullName || user?.employeeId || "") : undefined,
      lateEntryByRole: lateEntryMode ? (user?.role || "Nurse") : undefined,
    };
    if (activeModal === "vitals")   payload.vitals = { bp: { systolic: Number(vitals.bp_sys || 0), diastolic: Number(vitals.bp_dia || 0) }, pulse: Number(vitals.pulse), temp: Number(vitals.temp), spo2: Number(vitals.spo2), rr: Number(vitals.rr), gcs: vitals.gcs, bsl: Number(vitals.bsl) };
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

      /* ── Dual-write to VitalSheet so the trend chart populates ───────────
         NurseNote.vitals lives on the clinical note doc; the trend chart
         inside the Vital Signs module reads /api/vitalsheet. Without this
         second write the chart stayed empty after every Sign & Submit and
         the nurse had to re-key the same numbers in the standalone /vitalSheet
         page. Mirror the vitals payload into the time-slotted vitalsheet
         row keyed by today's date + current time.
      ─────────────────────────────────────────────────────────────────── */
      if (activeModal === "vitals" || activeModal === "initial") {
        try {
          const uhid = patient.patientUHID || patient.UHID || patient.uhid || searchUHID;
          const v = activeModal === "initial" ? initialAssess : vitals;
          // Map both vital module + initial-assessment shape into VitalSheet values
          const values = {};
          const sbp = v.bp_sys, dbp = v.bp_dia;
          if (sbp) values["BP Systolic"]  = { value: Number(sbp), unit: "mmHg" };
          if (dbp) values["BP Diastolic"] = { value: Number(dbp), unit: "mmHg" };
          if (v.pulse) values["Pulse"]    = { value: Number(v.pulse), unit: "bpm" };
          if (v.temp)  values["Temperature"] = { value: Number(v.temp), unit: "°F" };
          if (v.spo2)  values["SpO2"]     = { value: Number(v.spo2), unit: "%" };
          if (v.rr)    values["Resp Rate"]= { value: Number(v.rr), unit: "/min" };
          if (v.bsl)   values["BSL"]      = { value: Number(v.bsl), unit: "mg/dL" };
          if (v.gcs)   values["GCS"]      = { value: v.gcs, unit: "score" };
          if (v.painScore) values["Pain Score"] = { value: Number(v.painScore), unit: "score" };
          if (v.weight) values["Weight"]  = { value: Number(v.weight), unit: "kg" };

          if (Object.keys(values).length > 0 && uhid) {
            const d = new Date();
            const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
            const timeStr = `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;

            // Merge with any existing rows for today so we don't clobber
            // earlier hourly slots — append the new slot and re-sort.
            let existingRows = [];
            try {
              const res = await getVitalSheet(uhid, dateStr);
              const sheet = Array.isArray(res?.data) ? res.data[0] : res?.data || res;
              if (sheet?.tableData) existingRows = sheet.tableData;
            } catch (_) { /* no prior sheet today — fine */ }

            const newRow = {
              time: timeStr,
              nurse: user?.fullName || user?.name || "",
              notes: noteText || "",
              values,
            };
            const merged = existingRows
              .filter(r => r.time !== newRow.time)
              .concat(newRow)
              .sort((a, b) => a.time.localeCompare(b.time));

            const activeVitals = [
              { name: "BP Systolic",  unit: "mmHg"  },
              { name: "BP Diastolic", unit: "mmHg"  },
              { name: "Pulse",        unit: "bpm"   },
              { name: "Temperature",  unit: "°F"    },
              { name: "SpO2",         unit: "%"     },
              { name: "Resp Rate",    unit: "/min"  },
              { name: "BSL",          unit: "mg/dL" },
              { name: "GCS",          unit: "score" },
              { name: "Pain Score",   unit: "score" },
              { name: "Weight",       unit: "kg"    },
            ];

            await saveVitalSheet({
              uhid, date: dateStr, slot: "01 Hours",
              activeVitals, tableData: merged,
            });
          }
        } catch (e) {
          // Don't block note save if vitalsheet sync fails — log and continue.
          console.warn("[NursingNotes] vitalsheet dual-write failed:", e?.message);
        }
      }

      /* ── When "Initial Assessment" is saved, also mark nurseCompleted
             on the Admission document so the gate lifts immediately.     ── */
      if (activeModal === "initial" && patient?._id) {
        try {
          const token = (sessionStorage.getItem("his_token"));
          const signedByName = user?.fullName || `${user?.firstName || ""} ${user?.lastName || ""}`.trim();
          await axios.post(
            `${API_ENDPOINTS.ADMISSIONS}/${patient._id}/nurse-assessment`,
            {
              UHID: patient.UHID || patient.uhid || searchUHID,
              assessedAt: new Date().toISOString(),
              assessedBy: signedByName,
              nurseId: user?._id || user?.id || "",
              designation: "Staff Nurse",
              notes: [initialAssess.chiefComplaint, initialAssess.historyOfIllness].filter(Boolean).join("; "),
              vitals: {
                bpSys: initialAssess.bp_sys, bpDia: initialAssess.bp_dia,
                pulse: initialAssess.pulse, temp: initialAssess.temp,
                spo2: initialAssess.spo2, rr: initialAssess.rr,
                weight: initialAssess.weight, height: initialAssess.height,
              },
              systemAssessment: {
                respiratory: initialAssess.respiratory,
                cardiovascular: initialAssess.cardiovascular,
                gastrointestinal: initialAssess.gastrointestinal,
                genitourinary: initialAssess.genitourinary,
                musculoskeletal: initialAssess.musculoskeletal,
                neurological: initialAssess.neurological,
                ivSite: initialAssess.ivSite, ivSize: initialAssess.ivType,
                ivInsertedDate: initialAssess.ivDate, ivCondition: initialAssess.ivCondition,
              },
              psychosocial: {
                anxietyLevel: initialAssess.anxiety,
                cognitiveStatus: initialAssess.cognition,
                languageBarrier: initialAssess.languageBarrier ? "Yes — Interpreter needed" : "No",
              },
              nutritionHydration: {
                nutritionRisk: initialAssess.nutritionStatus,
                swallowingDifficulty: initialAssess.swallowing,
              },
              riskAssessments: {
                bradenScale: {
                  sensoryPerception: initialAssess.b1, moisture: initialAssess.b2,
                  activity: initialAssess.b3, mobility: initialAssess.b4,
                  nutrition: initialAssess.b5, frictionShear: initialAssess.b6,
                  totalScore: calcBraden(initialAssess),
                  riskLevel: bradenBand(calcBraden(initialAssess)).label,
                },
                morseFallScale: {
                  fallHistory: initialAssess.m1, secondaryDiagnosis: initialAssess.m2,
                  ambulatoryAid: initialAssess.m3, ivAccess: initialAssess.m4,
                  gaitBalance: initialAssess.m5, mentalStatus: initialAssess.m6,
                  totalScore: calcMorse(initialAssess),
                  riskLevel: morseBand(calcMorse(initialAssess)).label,
                },
              },
              dischargePlanning: {
                dischargePlan: initialAssess.dischargePlan,
                caregiverAvailable: initialAssess.caregiverAvailable ? "Yes" : "No",
                caregiverName: initialAssess.caregiverName,
                specialNeeds: initialAssess.specialNeeds,
              },
              fullFormData: initialAssess, // store raw form data
            },
            { headers: { Authorization: `Bearer ${token}` } }
          );
        } catch (_) { /* silent — gate still lifts via state update below */ }

        // ── Lift the gate in local state immediately (no need to reload patient) ──
        setPatient(prev => ({
          ...prev,
          initialAssessment: {
            ...(prev?.initialAssessment || {}),
            nurseCompleted: true,
            nurseCompletedAt: new Date().toISOString(),
          },
        }));
      }

      clearDraft(); // clear auto-saved draft after successful save
      toast.success("Note saved");
      setActiveModal(null);
      await fetchNotes(ipdNo);
    } catch (err) { toast.error(err?.response?.data?.message || "Save failed"); }
    finally { setLoading(false); }
  };

  // R7fp — date range matcher. "today" = since 00:00 local; "week" = current
  // ISO week (Mon→Sun); "7days" = rolling 7 days; "all" = no constraint.
  const dateRangeMatch = (n) => {
    if (filterDateRange === "all") return true;
    const d = new Date(n.createdAt || n.noteDate || 0);
    if (isNaN(d.getTime())) return true;
    const now = new Date();
    if (filterDateRange === "today") {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      return d >= start;
    }
    if (filterDateRange === "7days") {
      const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      return d >= start;
    }
    if (filterDateRange === "week") {
      const day = now.getDay() || 7; // Mon = 1, Sun = 7
      const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (day - 1));
      return d >= monday;
    }
    return true;
  };
  const filteredNotes = notes.filter(n => {
    const typeMatch = filterType === "All" || n.noteType === filterType;
    const shiftMatch = !filterShift || n.shift === filterShift;
    return typeMatch && shiftMatch && dateRangeMatch(n);
  });

  const modDef = (id) => MODULES.find(m => m.id === id);
  const today = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

  /* ══════════════════════════════════════════════════════ */
  /* ── SphereAI window event listener ─────────────────────────────── */
  const _saveNoteRef = useRef(null);
  useEffect(() => { _saveNoteRef.current = saveNote; }); // keep ref current

  useEffect(() => {
    const handler = async (e) => {
      const { noteType, content, vitals: av, autoSave } = e.detail || {};
      // Map AI note type → modal id (case-insensitive)
      const typeMap = {
        "vital signs note": "vitals", "vitals": "vitals", "vital": "vitals",
        "initial assessment": "initial", "initial": "initial",
        "nurse initial assessment": "initial", "nursing initial assessment": "initial",
        "pain assessment": "pain", "pain": "pain",
        "intake/output": "intake", "intake": "intake", "i/o": "intake",
        "neuro assessment": "neuro", "neuro": "neuro", "neurological": "neuro",
        "mews": "mews", "mews score": "mews",
        "care plan": "careplan", "careplan": "careplan", "nursing care plan": "careplan",
        "nutritional assessment": "nutrition", "nutrition": "nutrition",
        "daily nursing assessment": "daily", "daily": "daily", "daily assessment": "daily",
        "fall risk assessment": "fall", "fall": "fall", "fall risk": "fall",
        "wound care": "wound", "wound": "wound",
        "skin assessment": "skin", "skin": "skin",
        "procedure note": "procedure", "procedure": "procedure",
        "discharge note": "discharge", "discharge": "discharge",
        "patient education": "education", "education": "education",
        "blood transfusion": "blood", "blood": "blood",
        "iv infusion": "iv", "iv": "iv",
        "progress note": "general", "observation note": "general", "general": "general",
      };
      const modal = typeMap[(noteType || "").toLowerCase()] || "general";
      // Pre-fill text
      if (content) setNoteText(content);
      // Pre-fill vitals if provided
      if (av && Object.values(av).some(Boolean)) {
        const [sys, dia] = (av.bp || "").split("/");
        setVitals(prev => ({
          ...prev,
          ...(sys  && { bp_sys: sys.trim() }),
          ...(dia  && { bp_dia: dia.trim() }),
          ...(av.pulse       && { pulse: String(av.pulse) }),
          ...(av.temperature && { temp: String(av.temperature) }),
          ...(av.spo2        && { spo2: String(av.spo2) }),
          ...(av.respirationRate && { rr: String(av.respirationRate) }),
          ...(av.weight      && { weight: String(av.weight) }),
        }));
      }
      // Open modal
      setActiveModal(modal);
      // Auto-save after React re-renders with new state
      if (autoSave !== false) {
        setTimeout(() => {
          if (_saveNoteRef.current) _saveNoteRef.current();
        }, 700);
      }
    };
    window.addEventListener("sphereai:fill_nursing_note", handler);
    return () => window.removeEventListener("sphereai:fill_nursing_note", handler);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ padding: "24px 28px", minHeight: "100vh", background: C.bg, fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: C.text }}>

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
          {/* ── Late-Entry Banner (NABH HIC.6) ──
              Renders only when the loaded admission is already DISCHARGED.
              Shows an amber warning + a mandatory "Reason for late entry"
              textarea. saveNote() blocks the POST until this is filled.
              Backend persists `lateEntry: true` + the reason on every
              note row so audit replays can filter retroactive entries. */}
          {lateEntryMode && (
            <div style={{
              background: "linear-gradient(135deg, #fef3c7, #fde68a)",
              border: "1.5px solid #f59e0b",
              borderRadius: 10,
              padding: "12px 14px",
              marginBottom: 14,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{
                  width: 24, height: 24, borderRadius: "50%",
                  background: "#b45309", color: "#fff",
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  fontWeight: 800, fontSize: 13, flexShrink: 0,
                }}>!</span>
                <strong style={{ color: "#78350f", fontSize: 13 }}>
                  Late-entry mode — admission is already DISCHARGED
                </strong>
              </div>
              <div style={{ fontSize: 11.5, color: "#78350f", lineHeight: 1.5 }}>
                This nursing note will be flagged as retroactive on the audit trail per NABH HIC.6.
                A documented reason is mandatory before the note can be saved.
              </div>
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#78350f", textTransform: "uppercase", letterSpacing: 0.4 }}>
                  Reason for late entry <span style={{ color: "#dc2626" }}>*</span>
                </span>
                <textarea
                  value={lateEntryReason}
                  onChange={(e) => setLateEntryReason(e.target.value)}
                  placeholder="e.g. Discharge was finalized at 09:08 AM before the handover note was written. Adding retroactive note to complete the clinical record."
                  rows={2}
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    border: "1.5px solid #fbbf24",
                    borderRadius: 8,
                    fontSize: 12,
                    fontFamily: "inherit",
                    resize: "vertical",
                    outline: "none",
                    background: "#fffbeb",
                  }}
                />
              </label>
            </div>
          )}

          {/* R7bi — Shared PatientHeaderCard (Doctor + Nursing parity).
              All visuals + QR/IPD/age/diagnosis-tier/ward logic now
              live in Components/clinical/PatientHeaderCard.jsx.
              Pre-R7bi this was 220 lines of inline JSX. */}
          <PatientHeaderCard
            patient={patient}
            searchUHID={searchUHID}
            latestDiagnosis={latestDiagnosis}
            onChangePatient={() => { setPatient(null); setNotes([]); setSearchUHID(""); setLatestDiagnosis(null); }}
          />

          {/* ══ TILE GRID (when no section is active) ════════════════════════
                Nursing Notes is split into 5 tiles. Mirrors the Doctor
                Notes pattern — click a tile to expand that section
                inline below the patient banner. Counts where we have
                them (`notes.length`); child-owned counts (orders / MAR)
                stay as "Open" badges until we lift them up later. */}
          {!activeTile && (
            <div className="dnp-tiles-grid" role="navigation" aria-label="Nursing Notes sections">
              {[
                {
                  id: "orders",
                  title: "Doctor's Active Orders",
                  subtitle: "Live orders awaiting nursing action",
                  icon: "pi-list-check",
                  color: "#7c3aed",
                  tint: "#ede9fe",
                  badges: [{ label: "Open", tone: "info" }],
                },
                {
                  id: "mar",
                  title: "Treatment Chart — Live MAR",
                  subtitle: "Administer meds + infusions (NABH COP.3)",
                  icon: "pi-chart-bar",
                  color: "#db2777",
                  tint: "#fce7f3",
                  badges: [{ label: "Open", tone: "info" }],
                },
                {
                  id: "addnote",
                  title: "Add a Care Note",
                  subtitle: "Shift + Assessment, Interventions, Documentation",
                  icon: "pi-plus-circle",
                  color: "#0d9488",
                  tint: "#ccfbf1",
                  // R7bj — Per-tile "Initial Assessment required" badge
                  // collapsed into the global locked badge (rendered by
                  // the tile loop below when `locked` is true).
                  badges: [{ label: "Ready", tone: "ok" }],
                },
                {
                  id: "equipment",
                  title: "Equipment Used This Shift",
                  subtitle: "Auto-billed disposables, IV lines, monitoring",
                  icon: "pi-box",
                  color: "#2563eb",
                  tint: "#dbeafe",
                  badges: [{ label: "Auto-billed", tone: "info" }],
                },
                {
                  id: "timeline",
                  title: "Nursing Notes Timeline",
                  subtitle: "All historical care notes + filters",
                  icon: "pi-history",
                  color: "#ea580c",
                  tint: "#ffedd5",
                  badges: [
                    notes.length > 0
                      ? { label: `${notes.length} recorded`, tone: "info" }
                      : { label: "No notes yet", tone: "warn" },
                    notes.length > 0 && notes[0]?.shift
                      ? { label: `Last: ${notes[0].shift}`, tone: "accent" }
                      : null,
                  ].filter(Boolean),
                },
                /* ── R7be — relocated from patient-header action buttons ──
                   Care Plan / Vitals Trend / IPD Assessment / Print&PDF used
                   to be inline pills above the tile grid; moving them into
                   the grid as full tiles matches Doctor Notes' clean
                   single-hub UX. `action` field fires a custom handler
                   (navigate, openReport, etc.); the onClick below falls
                   through to setActiveTile(id) for legacy inline tiles. */
                {
                  id: "careplan-nav",
                  title: "Care Plan",
                  subtitle: "Nursing care plan (NABH COP.8)",
                  icon: "pi-heart-fill",
                  color: "#16a34a",
                  tint: "#dcfce7",
                  badges: [{ label: "NABH", tone: "ok" }],
                  action: () => navigate("/nursing-care-plan"),
                },
                {
                  id: "vitalstrend-nav",
                  title: "Vitals Trend",
                  subtitle: "BP / HR / RR / SpO₂ / Temp graphs over time",
                  icon: "pi-chart-bar",
                  color: "#0891b2",
                  tint: "#cffafe",
                  badges: [{ label: "Open", tone: "info" }],
                  action: () => navigate("/vitalsView"),
                },
                /* R7ca — Diabetic Chart tile. Same one-click entry pattern
                   as Vitals Trend / Care Plan above. Uses location.state for
                   the UHID handoff (PHI-safe — the useUhidFromLocation hook
                   on DiabeticChartPage prefers state and scrubs any legacy
                   URL param). The sliding-scale BG chart is sufficiently
                   distinct from the GRBS chip in vitals to merit a dedicated
                   tile — it tracks RBS + insulin dose + nurse signature per
                   slot per day, which the inline vitals chip cannot do. */
                {
                  id: "diabetic-nav",
                  title: "Diabetic Chart",
                  subtitle: "RBS + sliding-scale insulin (NABH MOM.4)",
                  icon: "pi-chart-line",
                  color: "#dc2626",
                  tint: "#fee2e2",
                  badges: [{ label: "NABH", tone: "ok" }],
                  action: () => navigate("/diabetic-chart", {
                    state: { uhid: patient?.UHID || patient?.uhid || searchUHID || "" },
                  }),
                },
                /* R7eg — Bundles of Care (ICU). One-shift bundle compliance
                   sheet (VAP / CAUTI / CLABSI / DVT / Sepsis / SUP). Same
                   PHI-safe location.state handoff as the Diabetic Chart
                   tile above. Saves + finalizes auto-feed the NABH HIC.5
                   Infection Control register via ClinicalAudit. */
                {
                  id: "icubundles-nav",
                  title: "Bundles of Care — ICU",
                  subtitle: "VAP / CAUTI / CLABSI / DVT / Sepsis / SUP (NABH HIC.5)",
                  icon: "pi-shield",
                  color: "#059669",
                  tint: "#d1fae5",
                  badges: [{ label: "NABH", tone: "ok" }, { label: "Quality", tone: "accent" }],
                  action: () => navigate("/icu-bundles", {
                    state: { uhid: patient?.UHID || patient?.uhid || searchUHID || "" },
                  }),
                },
                /* R7du — Restraint Register (NABH COP.17). Nurse-side
                   structured entry for restraint episodes (physical /
                   chemical / both). Doctor enters the order as plain text
                   in nursing communication; this tile opens the form that
                   captures device, reason, monitoring frequency, and
                   alternatives tried — auto-populating the COP.17 register
                   row via /api/restraints → emitRestraint. */
                {
                  id: "restraint-nav",
                  title: "Restraint Register",
                  subtitle: "Physical / chemical restraint episodes (NABH COP.17)",
                  icon: "pi-lock",
                  color: "#dc2626",
                  tint: "#fee2e2",
                  badges: [{ label: "NABH", tone: "ok" }, { label: "COP.17", tone: "warn" }],
                  action: () => navigate(`/nursing/restraints/${encodeURIComponent(patient?.UHID || patient?.uhid || searchUHID || "")}`),
                },
                {
                  id: "ipdassessment-nav",
                  title: "IPD Initial Assessment",
                  subtitle: "Nursing admission assessment (NABH AAC.1)",
                  icon: "pi-file-check",
                  color: "#d97706",
                  tint: "#fef3c7",
                  badges: [{ label: "NABH", tone: "ok" }],
                  // R7bl — Bug fix: `uhidVal` used to be referenced here
                  // but it's a local variable inside loadPatient() (line
                  // 748), out-of-scope for this JSX closure. Clicks
                  // threw a silent ReferenceError and the page never
                  // navigated. Resolve from the loaded admission's UHID
                  // (or the search box as a last resort).
                  action: () => navigate(`/ipd-assessment/${encodeURIComponent(patient?.UHID || patient?.uhid || searchUHID || "")}`),
                },
                {
                  id: "print-nav",
                  title: "Print / PDF Report",
                  subtitle: "Nursing patient report for insurance / file",
                  icon: "pi-print",
                  color: "#9333ea",
                  tint: "#f3e8ff",
                  badges: [{ label: "Print", tone: "info" }],
                  action: () => setShowReport(true),
                },
              ].map(t => {
                // R7bj — Initial Assessment gate. The ONLY entry point
                // to the nurse Initial Assessment is now the standalone
                // "IPD Initial Assessment" tile (NABH AAC.1 → the full
                // /nursing-initial-assessment form). The previous inline
                // COP.2 "Initial Assessment" module inside Add a Care
                // Note was removed in R7bj — having two entry points was
                // confusing and produced duplicate-shape saves.
                //
                // Until the nurse files that assessment, ALL other tiles
                // (including Add a Care Note) stay locked.
                const isAssessmentTile = t.id === "ipdassessment-nav";
                const locked = gateActive && !isAssessmentTile;
                return (
                <button
                  key={t.id}
                  type="button"
                  // R7be — tiles with an `action` fire a custom handler
                  // (navigate / openReport); legacy tiles fall through to
                  // setActiveTile(id) to expand inline below the header.
                  onClick={() => {
                    if (locked) {
                      toast.error("⛔ Complete the Nursing Initial Assessment first — open the 'IPD Initial Assessment' tile (NABH AAC.1).", { autoClose: 5500 });
                      return;
                    }
                    return t.action ? t.action() : setActiveTile(t.id);
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
              R7hr-86: alert chips ride next to the back button. */}
          {activeTile && (
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
          {/* R7hr-86 — surface alerts in a slim row above the tile grid
              when no tile is open, so allergies / OVERDUE stay visible. */}
          {!activeTile && patient && (
            <PatientAlertStrip
              patientId={patient?._id}
              allergies={patient?.allergies || patient?.knownAllergies}
            />
          )}

          {/* ── Doctor's Active Orders (NurseOrdersPanel) ── */}
          {activeTile === "orders" && (
          <div style={{ marginBottom: 14 }}>
            <NurseOrdersPanel
              UHID={patient.uhid || patient.UHID || searchUHID}
              visitId={patient.ipdNo || patient.admissionNumber || patient._id}
              refreshTrigger={ordersRefresh}
              onConsentRequest={(order) => setConsentOrder(order)}
            />
          </div>
          )}

          {/* ── NABH Treatment Chart (Nurse Administration View) ── */}
          {activeTile === "mar" && (
          <div style={{ marginBottom: 14 }}>
            <TreatmentChart
              UHID={patient.uhid || patient.UHID || searchUHID}
              visitId={patient.ipdNo || patient.admissionNumber || patient._id}
              // R7j: admissionId enables the inline "Raise Indent" button
              // in the MAR header. patient._id is the Admission ObjectId
              // (this page sets patient to the admission doc — see line 537
              // where it's also used directly as `admissionId`).
              admissionId={patient._id}
              patientName={patient.patientName || patient.patientId?.fullName || ""}
              nurseMode={true}
              refreshTrigger={ordersRefresh}
              onAdminSave={() => setOrdersRefresh(p => p + 1)}
            />
          </div>
          )}

          {/* ── Add a Care Note: shift selector + module pill bar ──
              Tile-gated. Same primitives as Doctor Notes; rendered as
              a normal section (not sticky chrome) since it's the
              active tile's panel. */}
          {activeTile === "addnote" && (
          <div className="dnp-addnote-panel pf-tint--nurse">
            <div className="dnp-shift-row">
              <span className="dnp-shift-row__label">Current Shift:</span>
              {[
                { id: "morning",   label: "Morning",   icon: "pi-sun" },
                { id: "afternoon", label: "Afternoon", icon: "pi-cloud" },
                { id: "evening",   label: "Evening",   icon: "pi-moon" },
                { id: "night",     label: "Night",     icon: "pi-star" },
              ].map(s => (
                <button key={s.id} onClick={() => setShift(s.id)}
                  className={`dnp-shift-pill ${shift === s.id ? "dnp-shift-pill--active" : ""}`}>
                  <i className={`pi ${s.icon}`} style={{ fontSize: 10 }} />
                  {s.label}
                </button>
              ))}
              <button onClick={() => openModal("general")} className="dnp-shift-row__cta">
                <i className="pi pi-plus" style={{ fontSize: 12 }} /> Quick Note
              </button>
            </div>

          {/* R7bj — Inline gate banner removed.
              The "Add a Care Note" top-level tile is now itself locked
              when gateActive is true, so this panel never renders while
              the gate is on. Gating is enforced at the tile-grid level
              with a 🔒 badge + redirect toast pointing at "IPD Initial
              Assessment" (NABH AAC.1). */}

          {/* ── Nursing Notes Quick-View Banner (click → jump to timeline) ── */}
          {patient && (
            <div
              onClick={() => document.getElementById('nursing-notes-timeline')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              style={{ marginBottom: 14, background: notes.length > 0 ? C.primaryL : "#f8fafc", border: `1.5px solid ${notes.length > 0 ? C.primary + "40" : C.border}`, borderRadius: 10, padding: "10px 16px", display: "flex", alignItems: "center", gap: 12, cursor: "pointer", transition: "background .15s" }}
            >
              <div style={{ width: 34, height: 34, borderRadius: 9, background: notes.length > 0 ? C.primary : "#e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <i className="pi pi-list" style={{ fontSize: 14, color: notes.length > 0 ? "white" : C.muted }} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: notes.length > 0 ? C.primary : C.muted }}>
                  {notes.length > 0 ? `📋 ${notes.length} Nursing Notes recorded` : "📋 No nursing notes yet"}
                </div>
                {notes.length > 0 && (
                  <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                    Last: <strong>{notes[0]?.noteType || "note"}</strong> by {notes[0]?.nurseName || "nurse"} · {notes[0]?.shift || ""} shift
                    {notes[0]?.createdAt ? " · " + new Date(notes[0].createdAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : ""}
                  </div>
                )}
              </div>
              {notes.length > 0 && <span style={{ fontSize: 11, color: C.primary, fontWeight: 700, flexShrink: 0 }}>View all ↓</span>}
            </div>
          )}

            {/* ── R7bf — Note type picker (card grid) ──
                Mirrors Doctor Notes' "Select Note Type" layout (R7aw) so
                nurses get the same visual language: icon square + label +
                NABH chapter code + one-line description, with locked
                cards rendered with a lock icon and reduced opacity (gate
                stays visible so the nurse can see WHAT they'll get once
                they sign the Initial Assessment). */}
            <div style={{ background: C.card, borderRadius: 12, padding: "18px", border: `1.5px solid ${C.border}`, marginTop: 14 }}>
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: C.text, marginBottom: 3 }}>Select Note Type</div>
                <div style={{ fontSize: 12, color: C.muted }}>
                  Choose the appropriate NABH-compliant clinical note for this patient encounter
                </div>
              </div>
              {/* R7bj — Per-module lock logic removed. The parent "Add a
                  Care Note" tile is already lockedwhen the Nursing Initial
                  Assessment is not yet filed, so this picker only renders
                  when the gate is OFF. Modules are always clickable here. */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
                {MODULES.map(m => (
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
          {/* /dnp-addnote-panel */}

          {/* ── Equipment Used This Shift ── */}
          {activeTile === "equipment" && (() => {
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
          {activeTile === "timeline" && (
          <div id="nursing-notes-timeline" style={{ background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 16, overflow: 'hidden', boxShadow: '0 2px 10px rgba(0,0,0,.04)' }}>
            {/* Timeline header */}
            <div style={{ background: 'linear-gradient(to right, #f0fdfa, #f8fafc)', borderBottom: `1px solid ${C.border}`, padding: '14px 22px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                {/* Title */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 34, height: 34, borderRadius: 10, background: C.primary, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 3px 8px ${C.primary}40` }}>
                    <i className="pi pi-list" style={{ fontSize: 14, color: 'white' }} />
                  </div>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 14, color: C.text }}>Nursing Notes Timeline</div>
                    <div style={{ fontSize: 11, color: C.muted }}>{filteredNotes.length} {filteredNotes.length === 1 ? 'entry' : 'entries'} recorded</div>
                  </div>
                </div>
                {/* Filters */}
                <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap' }}>
                  {[
                    { key: 'All',     label: 'All',       color: C.primary },
                    { key: 'vitals',  label: '❤ Vitals',  color: '#1d4ed8' },
                    { key: 'blood',   label: '🩸 Blood',   color: '#9f1239' },
                    { key: 'iv',      label: '💉 IV',      color: C.teal    },
                    { key: 'wound',   label: '🩹 Wound',   color: C.red     },
                    { key: 'pain',    label: '⚡ Pain',    color: C.amber   },
                    { key: 'neuro',   label: '🧠 Neuro',   color: C.purple  },
                    { key: 'intake',  label: '📊 I/O',     color: C.accent  },
                    { key: 'general', label: '📝 General', color: C.muted   },
                    { key: 'mews',    label: '📈 MEWS',    color: '#92400e' },
                  ].map(f => (
                    <button key={f.key} onClick={() => setFilterType(f.key)} style={{
                      padding: '4px 11px', borderRadius: 20, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                      border: `1.5px solid ${filterType === f.key ? f.color : C.border}`,
                      background: filterType === f.key ? f.color : 'white',
                      color: filterType === f.key ? 'white' : C.muted,
                      transition: 'all .15s',
                    }}
                      onMouseEnter={e => { if (filterType !== f.key) { e.currentTarget.style.borderColor = f.color; e.currentTarget.style.color = f.color; }}}
                      onMouseLeave={e => { if (filterType !== f.key) { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.muted; }}}>
                      {f.label}
                    </button>
                  ))}
                  <select value={filterShift} onChange={e => setFilterShift(e.target.value)}
                    style={{ padding: '5px 10px', border: `1.5px solid ${C.border}`, borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: 'pointer', background: 'white', color: C.muted, outline: 'none' }}>
                    <option value="">All Shifts</option>
                    <option value="morning">🌅 Morning</option>
                    <option value="afternoon">☀️ Afternoon</option>
                    <option value="evening">🌆 Evening</option>
                    <option value="night">🌙 Night</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Timeline entries — wrapped in pf-tint--nurse dnp-timeline */}
            {filteredNotes.length === 0 ? (
              <div className="dnp-empty">
                <div className="dnp-empty__icon"><i className="pi pi-file-edit" /></div>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--pf-text)', marginBottom: 4 }}>No nursing notes yet</div>
                <div style={{ fontSize: 12, color: 'var(--pf-muted)', marginBottom: 12 }}>Start documenting by clicking any module above</div>
                <button onClick={() => openModal('general')} className="dnp-note__btn dnp-note__btn--primary">
                  <i className="pi pi-plus" style={{ fontSize: 11 }} /> Add First Note
                </button>
              </div>
            ) : (
              <div className="dnp-timeline pf-tint--nurse">
              {/* R7gv — day-grouped timeline (mirrors Complete File / patient
                   panel pills). Each day is its own header pill, then the per-
                   note cards under it. Card body comes from the same
                   buildNurseNoteCardHtml() the printed Complete File embeds —
                   so the standalone timeline shows the rich per-type artwork
                   instead of the legacy dnp-note bespoke layout. */}
              {(() => {
                const byDay = new Map();
                for (const n of filteredNotes) {
                  const ts = n.createdAt ? new Date(n.createdAt) : null;
                  const key = ts && !isNaN(ts)
                    ? ts.toISOString().slice(0, 10)
                    : "undated";
                  if (!byDay.has(key)) byDay.set(key, []);
                  byDay.get(key).push(n);
                }
                const dayLabel = (key) => {
                  if (key === "undated") return "Undated";
                  const d = new Date(key + "T00:00:00");
                  return d.toLocaleDateString("en-IN", {
                    weekday: "short", day: "2-digit", month: "short", year: "numeric",
                  });
                };
                return [...byDay.entries()].map(([dayKey, dayNotes]) => (
                  <React.Fragment key={dayKey}>
                    <div className="dnp-day-header" style={{
                      display: "flex", alignItems: "center", gap: 10,
                      margin: "12px 0 6px 0", padding: "6px 12px",
                      background: "linear-gradient(90deg,#f0fdfa 0%,#ffffff 100%)",
                      border: `1px solid ${C.border}`, borderLeft: `4px solid ${C.primary}`,
                      borderRadius: 8,
                    }}>
                      <i className="pi pi-calendar" style={{ fontSize: 11, color: C.primary }} />
                      <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: ".4px", color: C.primary, textTransform: "uppercase" }}>
                        {dayLabel(dayKey)}
                      </span>
                      <span style={{ fontSize: 10, color: C.muted }}>
                        {dayNotes.length} note{dayNotes.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    {dayNotes.map((note, i) => {
                const ns  = NOTE_STYLE[note.noteType] || NOTE_STYLE.general;
                const ss  = SHIFT_STYLE[note.shift] || SHIFT_STYLE.morning;
                const mod = modDef(note.noteType);
                const timeStr = note.createdAt
                  ? new Date(note.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
                  : "--:--";
                return (
                  <div key={note._id || i}
                    className={`dnp-note dnp-note--nurse ${note.isCriticalEvent ? "dnp-note--critical" : ""}`}
                    style={{ "--dnp-accent": ns.color, "--dnp-tint": ns.bg }}>
                    {/* ── Time gutter ── */}
                    <div className="dnp-note__time">
                      <div className="dnp-note__time-pill">
                        <div className="dnp-note__time-hh">{timeStr}</div>
                        <span className="dnp-note__time-shift">
                          {(note.shift || 'morning').charAt(0).toUpperCase() + (note.shift || 'morning').slice(1)}
                        </span>
                      </div>
                      <div className="dnp-note__time-dot" />
                    </div>

                    {/* ── Body ── */}
                    <div className="dnp-note__body">
                      <div className="dnp-note__badge-row">
                        <span className="dnp-note__type-badge">
                          {mod
                            ? <i className={`pi ${mod.icon}`} style={{ fontSize: 10 }} />
                            : note.noteType === "initial"
                              ? <i className="pi pi-clipboard" style={{ fontSize: 10 }} />
                              : null}
                          {/* R7fm — friendlier label for the dual-written
                              IPD Initial Assessment (no MODULES entry by
                              design — R7bj removed the inline picker). */}
                          {mod?.label
                            || (note.noteType === "initial" ? "Initial Assessment · NABH AAC.1" : note.noteType?.toUpperCase())}
                        </span>
                        <span
                          style={{
                            fontSize: 9,
                            fontWeight: 700,
                            padding: "2px 7px",
                            borderRadius: 4,
                            background: note.status === "submitted" ? "#dcfce7" : note.status === "draft" ? "#fef3c7" : "#e2e8f0",
                            color: note.status === "submitted" ? "#15803d" : note.status === "draft" ? "#92400e" : "#475569",
                            letterSpacing: 0.3,
                            textTransform: "uppercase",
                          }}
                        >
                          {note.status === "submitted" ? "✓ Submitted" : (note.status || "draft").toUpperCase()}
                        </span>
                        {note.isCriticalEvent && (
                          <span className="dnp-note__status dnp-note__status--critical">
                            <i className="pi pi-exclamation-triangle" style={{ fontSize: 9 }} /> CRITICAL EVENT
                          </span>
                        )}
                        {note.nurseName && (
                          <span className="dnp-note__author">{note.nurseName}</span>
                        )}
                      </div>

                      {/* R7gv \u2014 Body artwork is now the shared
                           buildNurseNoteCardHtml() output (same as Complete
                           File and patient-panel pills). All the legacy
                           per-block renderers (vitals strip, MEWS band,
                           generic noteData section, remarks, tags) used to
                           live here \u2014 see git history. Builder includes the
                           SIGNED footer with Emp ID + signature image. */}
                      <div
                        className="tnc-body-embed pf-tint--nurse"
                        style={{ marginBottom: 8 }}
                        // eslint-disable-next-line react/no-danger
                        dangerouslySetInnerHTML={{ __html: buildNurseNoteCardHtml(note) }}
                      />
                      {false && (
                        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", padding: "10px 16px", background: `linear-gradient(to right, ${ns.bg}60, white)`, borderRadius: 10, marginBottom: 8 }}>
                          {[
                            { label: "BP",    value: `${note.vitals.bp?.systolic || "\u2014"}/${note.vitals.bp?.diastolic || "\u2014"}`, abnormal: isAbnormal("bp_sys", note.vitals.bp?.systolic) },
                            { label: "PULSE", value: `${note.vitals.pulse || "\u2014"} /min`, abnormal: isAbnormal("pulse", note.vitals.pulse) },
                            { label: "TEMP",  value: note.vitals.temp ? `${note.vitals.temp}\u00b0F` : "\u2014", abnormal: isAbnormal("temp", note.vitals.temp) },
                            { label: "SPO\u2082",  value: note.vitals.spo2 ? `${note.vitals.spo2}%` : "\u2014", abnormal: isAbnormal("spo2", note.vitals.spo2) },
                            { label: "RR",    value: note.vitals.rr ? `${note.vitals.rr} /min` : "\u2014", abnormal: isAbnormal("rr", note.vitals.rr) },
                            { label: "GCS",   value: note.noteData?.vitals?.gcs || note.vitals.gcs || "\u2014" },
                            { label: "BSL",   value: (note.noteData?.vitals?.bsl || note.vitals.bsl) ? `${note.noteData?.vitals?.bsl || note.vitals.bsl} mg/dL` : "\u2014", abnormal: isAbnormal("bsl", note.noteData?.vitals?.bsl || note.vitals.bsl) },
                          ].map(v => (
                            <div key={v.label} style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                              <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".6px", color: C.muted }}>{v.label}</span>
                              <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 12, fontWeight: v.abnormal ? 700 : 500, color: v.abnormal ? C.red : C.text }}>{v.value}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* ── MEWS Score (special colored band display) ──
                           R7gv — guarded off; builder now renders MEWS band. */}
                      {false && note.noteData?.mewsScore && note.noteType === "mews" && (() => {
                        const ms = note.noteData.mewsScore;
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

                      {/* ── All module data: generic renderer from note.noteData ──
                           R7gv — guarded off; builder renders all module data
                           in the per-type artwork now. */}
                      {false && note.noteData && (() => {
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
                          preBP:"Pre-BP", preBP_sys:"Pre-Sys BP", preBP_dia:"Pre-Dia BP",
                          prePulse:"Pre-Pulse", postBP:"Post-BP", postBP_sys:"Post-Sys BP", postBP_dia:"Post-Dia BP", postPulse:"Post-Pulse",
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
                        const blocks = Object.entries(note.noteData)
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

                      {/* Remarks — R7gv: builder renders remarks too. */}
                      {false && note.remarks && (
                        <div style={{ fontSize: 12.5, color: C.text, lineHeight: 1.6, marginBottom: 8 }}>{note.remarks}</div>
                      )}

                      {/* Tags — R7gv: builder renders tags too. */}
                      {false && note.tags?.length > 0 && (
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
                    <div className="dnp-note__actions">
                      {note.status !== "submitted" && (
                        <button
                          className="dnp-note__btn dnp-note__btn--info"
                          onClick={() => {
                            setActiveModal(note.noteType);
                            setEditingNote(note);
                          }}
                        >
                          <i className="pi pi-pencil" style={{ fontSize: 10 }} /> Edit
                        </button>
                      )}
                      <button
                        className="dnp-note__btn"
                        onClick={() => {
                          // R7gc — use the new per-type print builder (mirrors
                          // R7fx for doctor notes). Replaces the previous raw
                          // JSON.stringify dump.
                          const ok = printNurseNote(note, hospitalSettings || {});
                          if (!ok) toast.error("Pop-up blocked");
                        }}
                      >
                        <i className="pi pi-print" style={{ fontSize: 10 }} /> Print
                      </button>
                    </div>
                  </div>
                );
              })}
                  </React.Fragment>
                ));
              })()}
              </div>
            )}
          </div>
          )}
        </>
      )}

      {/* ── Fingerprint Consent Modal ── */}
      {consentOrder && (
        <FingerprintConsentModal
          order={consentOrder}
          onClose={() => setConsentOrder(null)}
          onConfirm={async (hash) => {
            try {
              const token = (sessionStorage.getItem("his_token"));
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
                    const sbp = v.bp_sys || "";
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
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:10 }}>
                      <FL label="Systolic BP (mmHg)"><input type="number" style={fld} value={blood.preBP_sys} placeholder="120" onChange={e => setBlood(p => ({ ...p, preBP_sys: e.target.value }))} /></FL>
                      <FL label="Diastolic BP (mmHg)"><input type="number" style={fld} value={blood.preBP_dia} placeholder="80" onChange={e => setBlood(p => ({ ...p, preBP_dia: e.target.value }))} /></FL>
                      <FL label="Pulse (/min)"><input type="number" style={fld} value={blood.prePulse} placeholder="80" onChange={e => setBlood(p => ({ ...p, prePulse: e.target.value }))} /></FL>
                      <FL label="Temp (°F)"><input type="number" style={fld} value={blood.preTemp} placeholder="98.6" onChange={e => setBlood(p => ({ ...p, preTemp: e.target.value }))} /></FL>
                    </div>
                  </div>

                  {/* In-transfusion monitoring vitals — NABH typical:
                      15 min, 30 min, 60 min, then hourly. Each row is
                      independent so nurses can skip / add as needed. */}
                  <div style={{ background:"#fffbeb", border:`1px solid #fde68a`, borderRadius:8, padding:"10px 14px" }}>
                    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
                      <div style={{ fontSize:11, fontWeight:700, color:"#b45309", textTransform:"uppercase", letterSpacing:".6px" }}>In-Transfusion Monitoring</div>
                      <button type="button"
                        onClick={() => setBlood(p => ({ ...p, intra: [...(p.intra||[]), { atMin: ((p.intra?.[p.intra.length-1]?.atMin || 0) + 30), bp_sys: "", bp_dia: "", pulse: "", temp: "" }] }))}
                        style={{ padding:"3px 10px", borderRadius:5, border:`1px solid #fcd34d`, background:"#fff", color:"#b45309", fontSize:11, fontWeight:700, cursor:"pointer" }}>
                        + Add reading
                      </button>
                    </div>
                    {(blood.intra || []).map((row, idx) => (
                      <div key={idx} style={{ display:"grid", gridTemplateColumns:"70px 1fr 1fr 1fr 1fr 24px", gap:8, marginBottom:6, alignItems:"end" }}>
                        <FL label="At (min)">
                          <input type="number" style={fld} value={row.atMin ?? ""} placeholder="15"
                            onChange={e => setBlood(p => ({ ...p, intra: p.intra.map((r,i) => i===idx ? { ...r, atMin: e.target.value === "" ? "" : Number(e.target.value) } : r) }))} />
                        </FL>
                        <FL label="Sys BP"><input type="number" style={fld} value={row.bp_sys} placeholder="120"
                          onChange={e => setBlood(p => ({ ...p, intra: p.intra.map((r,i) => i===idx ? { ...r, bp_sys: e.target.value } : r) }))} /></FL>
                        <FL label="Dia BP"><input type="number" style={fld} value={row.bp_dia} placeholder="78"
                          onChange={e => setBlood(p => ({ ...p, intra: p.intra.map((r,i) => i===idx ? { ...r, bp_dia: e.target.value } : r) }))} /></FL>
                        <FL label="Pulse"><input type="number" style={fld} value={row.pulse} placeholder="80"
                          onChange={e => setBlood(p => ({ ...p, intra: p.intra.map((r,i) => i===idx ? { ...r, pulse: e.target.value } : r) }))} /></FL>
                        <FL label="Temp"><input type="number" style={fld} value={row.temp} placeholder="98.6"
                          onChange={e => setBlood(p => ({ ...p, intra: p.intra.map((r,i) => i===idx ? { ...r, temp: e.target.value } : r) }))} /></FL>
                        <button type="button" title="Remove this reading"
                          onClick={() => setBlood(p => ({ ...p, intra: p.intra.filter((_,i) => i!==idx) }))}
                          style={{ width:24, height:24, borderRadius:5, border:`1px solid #fcd34d`, background:"#fff", color:"#b45309", cursor:"pointer", fontWeight:800 }}>×</button>
                      </div>
                    ))}
                    <div style={{ fontSize:10.5, color:C.muted, marginTop:4 }}>
                      Leave a row blank to skip it. NABH suggests vitals at 15 min, 30 min, then hourly until 2 h post-end.
                    </div>
                  </div>
                  {/* Post-transfusion vitals */}
                  {blood.status === "Completed" && (
                    <div style={{ background:C.greenL, border:`1px solid ${C.greenB}`, borderRadius:8, padding:"10px 14px" }}>
                      <div style={{ fontSize:11, fontWeight:700, color:C.green, textTransform:"uppercase", letterSpacing:".6px", marginBottom:8 }}>Post-Transfusion Vitals *</div>
                      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10 }}>
                        <FL label="Systolic BP (mmHg)"><input type="number" style={fld} value={blood.postBP_sys} placeholder="118" onChange={e => setBlood(p => ({ ...p, postBP_sys: e.target.value }))} /></FL>
                        <FL label="Diastolic BP (mmHg)"><input type="number" style={fld} value={blood.postBP_dia} placeholder="76" onChange={e => setBlood(p => ({ ...p, postBP_dia: e.target.value }))} /></FL>
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

                    {/* ── R7bq-5 — Auto-recorded I/O Ledger (real DB rows)
                         Populated by: MAR-given hook (R7bq-3) +
                         hourly infusion cron (R7bq-4). Manual rows the
                         nurse adds via the form below also land here
                         on save. Read-only display; void via the × button. */}
                    <div style={{ background:"#fafafa", border:"1.5px solid #d4d4d8", borderRadius:10, overflow:"hidden" }}>
                      <div style={{ padding:"9px 14px", background:"#f4f4f5", borderBottom:"1px solid #d4d4d8", display:"flex", alignItems:"center", gap:8 }}>
                        <i className="pi pi-clock" style={{ fontSize:13, color:"#52525b" }} />
                        <span style={{ fontSize:12, fontWeight:700, color:"#27272a", textTransform:"uppercase", letterSpacing:".5px" }}>
                          Today's Auto-Recorded I/O Ledger
                        </span>
                        {ioLedgerLoading && <i className="pi pi-spin pi-spinner" style={{ fontSize:11, marginLeft:"auto" }} />}
                        {!ioLedgerLoading && (
                          <span style={{ marginLeft:"auto", fontSize:11, color:"#52525b", fontWeight:600 }}>
                            {ioLedger.rows.length} row{ioLedger.rows.length !== 1 ? "s" : ""}
                            {ioLedger.rows.length > 0 && (
                              <span style={{ marginLeft:8, fontFamily:"'DM Mono',monospace" }}>
                                IN: <b style={{color:"#16a34a"}}>{ioLedger.totals.in}</b>
                                {" · "}OUT: <b style={{color:"#dc2626"}}>{ioLedger.totals.out}</b>
                                {" · "}NET: <b style={{color: ioLedger.totals.net >= 0 ? "#16a34a" : "#dc2626"}}>
                                  {ioLedger.totals.net >= 0 ? "+" : ""}{ioLedger.totals.net} mL
                                </b>
                              </span>
                            )}
                          </span>
                        )}
                      </div>
                      {ioLedger.rows.length > 0 ? (
                        <div style={{ maxHeight:260, overflowY:"auto" }}>
                          {ioLedger.rows.map(r => {
                            const isIn = r.direction === "IN";
                            const srcBadge = {
                              MAR: { label: "MAR", bg: "#fce7f3", color: "#be185d" },
                              INFUSION_CRON: { label: "Infusion (auto)", bg: "#dbeafe", color: "#1d4ed8" },
                              MANUAL: { label: "Manual", bg: "#f1f5f9", color: "#475569" },
                              BLOOD_TRANSFUSION: { label: "Blood", bg: "#fef2f2", color: "#dc2626" },
                              ORAL_INTAKE: { label: "Oral", bg: "#fef3c7", color: "#a16207" },
                              CATHETER: { label: "Catheter", bg: "#fef3c7", color: "#a16207" },
                              DRAIN: { label: "Drain", bg: "#fef3c7", color: "#a16207" },
                            }[r.source] || { label: r.source, bg: "#f1f5f9", color: "#475569" };
                            return (
                              <div key={r._id} style={{ display:"flex", alignItems:"center", gap:10, padding:"7px 14px", borderBottom:"1px solid #e4e4e7", fontSize:12 }}>
                                <span style={{ fontFamily:"'DM Mono',monospace", fontSize:10.5, color:"#71717a", minWidth:46 }}>
                                  {new Date(r.ts).toLocaleTimeString("en-IN", { hour:"2-digit", minute:"2-digit", hour12:false })}
                                </span>
                                <span style={{ fontSize:9, fontWeight:800, padding:"1px 6px", borderRadius:3, background:srcBadge.bg, color:srcBadge.color, minWidth:80, textAlign:"center" }}>
                                  {srcBadge.label}
                                </span>
                                <span style={{ fontSize:9, fontWeight:700, padding:"1px 6px", borderRadius:3, background:isIn?"#dcfce7":"#fee2e2", color:isIn?"#166534":"#991b1b" }}>
                                  {r.direction}
                                </span>
                                <span style={{ flex:1, minWidth:0, color:"#27272a", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                                  {r.label || r.fluidType || "—"}
                                </span>
                                <span style={{ fontFamily:"'DM Mono',monospace", fontSize:12, fontWeight:800, color: isIn ? "#16a34a" : "#dc2626", minWidth:62, textAlign:"right" }}>
                                  {isIn ? "+" : "−"}{r.volumeML} mL
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      ) : !ioLedgerLoading && (
                        <div style={{ padding:"14px 18px", color:"#71717a", fontSize:11.5, fontStyle:"italic" }}>
                          No auto-recorded entries today yet. They'll appear as the nurse marks doses given (Treatment Chart) and as the hourly infusion cron ticks for running drips.
                        </div>
                      )}
                    </div>

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

              {/* ── R7bs — DVT (Caprini) Risk Assessment (NABH MOM.7 + AAC.4) ── */}
              {activeModal === "dvt" && (() => {
                const isFemale = patient?.gender === "Female" || patient?.patientId?.gender === "Female";
                // Live total
                let capriniTotal = 0;
                Object.entries(CAPRINI_FACTORS_BY_WEIGHT).forEach(([w, list]) => {
                  list.forEach((f) => {
                    if (!dvtSelected[f.code]) return;
                    if (f.femaleOnly && !isFemale) return;
                    capriniTotal += Number(w);
                  });
                });
                const tierInfo = _capriniTier(capriniTotal);
                let improveTotal = 0;
                IMPROVE_BLEED_FACTORS.forEach((f) => { if (dvtImproveSelected[f.code]) improveTotal += f.points; });
                improveTotal = Math.round(improveTotal * 10) / 10;
                const improveHigh = improveTotal >= 7;
                const escalated = capriniTotal >= 5;
                const toggle = (code, setter) => setter((s) => ({ ...s, [code]: !s[code] }));
                const toggleContra = (label) =>
                  setDvtContras((c) => (c.includes(label) ? c.filter((x) => x !== label) : [...c, label]));

                const saveDVT = async () => {
                  const uhid = patient?.UHID || patient?.uhid || patient?.patientId?.UHID || patient?.patientId?.uhid;
                  if (!uhid) { toast.error("Patient UHID missing"); return; }
                  const factorBreakdown = [];
                  Object.entries(CAPRINI_FACTORS_BY_WEIGHT).forEach(([w, list]) => {
                    list.forEach((f) => {
                      if (!dvtSelected[f.code]) return;
                      if (f.femaleOnly && !isFemale) return;
                      factorBreakdown.push({ code: f.code, label: f.label, points: Number(w) });
                    });
                  });
                  const payload = {
                    UHID: uhid,
                    patientName: patient?.fullName || patient?.firstName || patient?.patientId?.fullName || "",
                    admissionId: patient?.admissionId || patient?._id || undefined,
                    capriniScore: capriniTotal,
                    improveScore: Object.keys(dvtImproveSelected).length > 0 ? improveTotal : undefined,
                    factorBreakdown,
                    contraindications: dvtContras,
                    contraindicationNotes: dvtContraNotes,
                    reassessmentTrigger: dvtTrigger,
                  };
                  setDvtSaving(true);
                  try {
                    const r = await axios.post(`${API_ENDPOINTS.NURSING_ASSESSMENTS || "/api/nursing-assessments"}/dvt`, payload);
                    if (r.data?.success) {
                      toast.success(`Caprini ${capriniTotal} (${tierInfo.tier}) saved — DVT register updated`);
                      // Reset for next entry
                      setDvtSelected({}); setDvtImproveSelected({}); setDvtContras([]); setDvtContraNotes("");
                    } else {
                      toast.error(r.data?.message || "Save failed");
                    }
                  } catch (e) {
                    toast.error(e?.response?.data?.message || "Save failed");
                  }
                  setDvtSaving(false);
                };

                return (
                  <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
                    {/* Score header */}
                    <div style={{ background:"#f8fafc", border:`1px solid ${C.border}`, borderRadius:10, padding:"12px 14px" }}>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:10 }}>
                        <div>
                          <div style={{ fontSize:12, fontWeight:700, color:C.muted, textTransform:"uppercase", letterSpacing:".6px" }}>Caprini VTE Risk Score · NABH MOM.7</div>
                          <div style={{ fontSize:11, color:C.muted, marginTop:2 }}>Auto-populates the NABH DVT register on save · escalates to treating doctor if ≥ 5</div>
                        </div>
                        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                          <div style={{ background:tierInfo.bg, color:tierInfo.color, border:`1.5px solid ${tierInfo.color}30`, borderRadius:8, padding:"6px 18px", fontWeight:800, fontSize:16 }}>
                            {capriniTotal} — {tierInfo.tier}
                          </div>
                          {Object.keys(dvtImproveSelected).length > 0 && (
                            <div style={{ background: improveHigh?"#fef2f2":"#f0f9ff", color: improveHigh?"#991b1b":"#0c4a6e", border:`1.5px solid ${(improveHigh?"#991b1b":"#0c4a6e")}30`, borderRadius:8, padding:"6px 14px", fontWeight:700, fontSize:13 }}>
                              IMPROVE {improveTotal} · Bleed {improveHigh?"High":"Low"}
                            </div>
                          )}
                        </div>
                      </div>
                      {escalated && (
                        <div style={{ marginTop:10, padding:"8px 12px", background:"#fef2f2", border:"1px solid #fecaca", borderRadius:6, color:"#991b1b", fontSize:12, fontWeight:600 }}>
                          ⚠ Caprini ≥ 5 — treating doctor will be notified for prophylaxis order (60 min SLA).
                        </div>
                      )}
                    </div>

                    {/* Caprini factor groups */}
                    {[5, 3, 2, 1].map((weight) => (
                      <div key={weight} style={{ border:`1px solid ${C.border}`, borderRadius:8, padding:"10px 12px" }}>
                        <div style={{ fontSize:11, fontWeight:800, color:C.muted, textTransform:"uppercase", letterSpacing:".5px", marginBottom:8 }}>{weight}-point factors</div>
                        <div style={{ display:"grid", gridTemplateColumns:"repeat(2, 1fr)", gap:6 }}>
                          {CAPRINI_FACTORS_BY_WEIGHT[weight].map((f) => {
                            if (f.femaleOnly && !isFemale) return null;
                            const on = !!dvtSelected[f.code];
                            return (
                              <label key={f.code} style={{ display:"flex", alignItems:"center", gap:8, cursor:"pointer", fontSize:12, fontWeight:600, color: on?"#4338ca":C.text, padding:"6px 10px", border:`1.5px solid ${on?"#a5b4fc":C.border}`, borderRadius:8, background: on?"#eef2ff":"white", transition:"all .15s" }}>
                                <input type="checkbox" checked={on} onChange={() => toggle(f.code, setDvtSelected)} style={{ accentColor:"#4f46e5", width:13, height:13 }} />
                                {f.label}
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    ))}

                    {/* IMPROVE bleed (optional) */}
                    <div style={{ border:`1px solid ${C.border}`, borderRadius:8, padding:"10px 12px" }}>
                      <div style={{ fontSize:11, fontWeight:800, color:C.muted, textTransform:"uppercase", letterSpacing:".5px", marginBottom:8 }}>IMPROVE Bleeding Risk (optional · gates pharmacological prophylaxis safety)</div>
                      <div style={{ display:"grid", gridTemplateColumns:"repeat(2, 1fr)", gap:6 }}>
                        {IMPROVE_BLEED_FACTORS.map((f) => {
                          const on = !!dvtImproveSelected[f.code];
                          return (
                            <label key={f.code} style={{ display:"flex", alignItems:"center", gap:8, cursor:"pointer", fontSize:12, fontWeight:600, color: on?"#9a3412":C.text, padding:"6px 10px", border:`1.5px solid ${on?"#fed7aa":C.border}`, borderRadius:8, background: on?"#fff7ed":"white", transition:"all .15s" }}>
                              <input type="checkbox" checked={on} onChange={() => toggle(f.code, setDvtImproveSelected)} style={{ accentColor:"#ea580c", width:13, height:13 }} />
                              {f.label} <span style={{ marginLeft:"auto", fontSize:10, color:C.muted }}>+{f.points}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>

                    {/* Contraindications */}
                    <div style={{ border:`1px solid ${C.border}`, borderRadius:8, padding:"10px 12px" }}>
                      <div style={{ fontSize:11, fontWeight:800, color:C.muted, textTransform:"uppercase", letterSpacing:".5px", marginBottom:8 }}>Contraindications to Pharmacological Prophylaxis</div>
                      <div style={{ display:"grid", gridTemplateColumns:"repeat(2, 1fr)", gap:6 }}>
                        {DVT_CONTRAINDICATIONS.map((c) => {
                          const on = dvtContras.includes(c);
                          return (
                            <label key={c} style={{ display:"flex", alignItems:"center", gap:8, cursor:"pointer", fontSize:12, fontWeight:600, color: on?C.red:C.text, padding:"6px 10px", border:`1.5px solid ${on?"#fca5a5":C.border}`, borderRadius:8, background: on?"#fef2f2":"white", transition:"all .15s" }}>
                              <input type="checkbox" checked={on} onChange={() => toggleContra(c)} style={{ accentColor:C.red, width:13, height:13 }} />
                              {c}
                            </label>
                          );
                        })}
                      </div>
                      <textarea
                        value={dvtContraNotes}
                        onChange={(e) => setDvtContraNotes(e.target.value)}
                        rows={2}
                        placeholder="Free-text notes / specifics (max 1000 chars)"
                        style={{ width:"100%", marginTop:8, padding:"6px 10px", border:`1.5px solid ${C.border}`, borderRadius:8, fontSize:12, fontFamily:"inherit" }}
                      />
                    </div>

                    {/* Reassessment trigger + save */}
                    <div style={{ display:"grid", gridTemplateColumns:"1fr auto", gap:12, alignItems:"end" }}>
                      <div>
                        <div style={{ fontSize:11, fontWeight:800, color:C.muted, textTransform:"uppercase", letterSpacing:".5px", marginBottom:4 }}>Reassessment trigger</div>
                        <select value={dvtTrigger} onChange={(e) => setDvtTrigger(e.target.value)} style={sel}>
                          {["Admission", "Q-Shift", "Condition-Change", "Post-Op", "Bleeding-Event", "Pre-Discharge"].map((t) => (
                            <option key={t} value={t}>{t}</option>
                          ))}
                        </select>
                      </div>
                      <button
                        onClick={saveDVT}
                        disabled={dvtSaving}
                        style={{ padding:"10px 18px", borderRadius:8, border:"none", background: dvtSaving?"#94a3b8":"#4f46e5", color:"white", fontWeight:700, fontSize:13, cursor: dvtSaving?"not-allowed":"pointer" }}
                      >
                        {dvtSaving ? "Saving…" : "Save DVT Assessment"}
                      </button>
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
                        {[{k:"bp_sys",label:"Systolic BP (mmHg)",ph:"120"},{k:"bp_dia",label:"Diastolic BP (mmHg)",ph:"80"},{k:"pulse",label:"Pulse (/min)",ph:"80"},{k:"temp",label:"Temp (°F)",ph:"98.6"},{k:"spo2",label:"SpO₂ (%)",ph:"98"},{k:"rr",label:"RR (/min)",ph:"16"},{k:"bsl",label:"BSL (mg/dL)",ph:"110"},{k:"gcs",label:"GCS",ph:"15"}].map(f=>(
                          <FL key={f.k} label={f.label}>
                            <input type="number" style={f.k==="gcs"?fld:{...fld}} value={dailyAssess[f.k]} placeholder={f.ph} onChange={e=>setDailyAssess(p=>({...p,[f.k]:e.target.value}))} />
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
                        {[{k:"bp_sys",l:"Systolic BP (mmHg)",ph:"120"},{k:"bp_dia",l:"Diastolic BP (mmHg)",ph:"80"},{k:"pulse",l:"Pulse (/min)",ph:"80"},{k:"temp",l:"Temp (°F)",ph:"98.6"},{k:"spo2",l:"SpO₂ (%)",ph:"98"},{k:"rr",l:"RR/min",ph:"16"},{k:"weight",l:"Weight (kg)",ph:"60"},{k:"height",l:"Height (cm)",ph:"165"}].map(f=>(
                          <FL key={f.k} label={f.l}>
                            <input type="number" style={fld} value={initialAssess[f.k]} placeholder={f.ph} onChange={e=>setInitialAssess(p=>({...p,[f.k]:e.target.value}))} />
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
          hospitalName={hospitalSettings?.hospitalName || ""}
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
