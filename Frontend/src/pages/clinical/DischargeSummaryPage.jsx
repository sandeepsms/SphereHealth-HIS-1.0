/**
 * DischargeSummaryPage.jsx
 * NABH-Compliant Modular Discharge Summary
 * Department templates: Medicine, Surgery, Gynaecology, Paediatrics
 * + Oncology, Orthopaedics, Cardiology, Neurology
 */

import React, { useState, useEffect, useRef } from "react";
import axios from "axios";
import { API_ENDPOINTS } from "../../config/api";
import { openPrint } from "../../Components/print/openPrint";
import useHospitalSettings from "../../Components/print/useHospitalSettings";
import { useAuth } from "../../context/AuthContext";
import { toast } from "react-toastify";
import { useAutoSave } from "../../hooks/useAutoSave";
import { useDigitalSignature } from "../../hooks/useDigitalSignature";
import { useUhidFromLocation } from "../../hooks/useUhidFromLocation";
import AutoSaveIndicator from "../../Components/signature/AutoSaveIndicator";
import SignaturePad from "../../Components/signature/SignaturePad";
import ClinicalLayout from "../../Components/clinical/ClinicalLayout";
import MLCAutoStamp from "../../Components/mlc/MLCAutoStamp";
import { confirm } from "../../Components/common/ConfirmDialog";
import "../../Components/clinical/clinical-forms.css";

const API = `${API_ENDPOINTS.BASE}/discharge-summary`;

/* ══════════════════════════════════════════════════
   DEPARTMENT TEMPLATES
══════════════════════════════════════════════════ */
const DEPT_TEMPLATES = [
  {
    key: "MEDICINE",
    label: "General Medicine",
    icon: "pi-heart",
    color: "#2563eb",
    bg: "#eff6ff",
    specialSections: ["chronicDiseases", "functionalStatus", "vaccinations"],
    template: {
      admissionReasonPrompt: "e.g. Fever with chills for 5 days, breathlessness on exertion…",
      coursePrompt: "e.g. Patient admitted with febrile illness. IV fluids, antibiotics started. Fever subsided by Day 3. Blood cultures negative. Clinically improved…",
      dischargeDiagnosisPrompt: "e.g. Enteric Fever, Type 2 Diabetes Mellitus (Known), Essential Hypertension (Known)",
      specialInstructionsPrompt: "e.g. Monitor blood sugar daily. Avoid self-medication. Low-fat diet.",
      investigations: [
        { name: "Complete Blood Count", result: "", unit: "cells/μL", status: "" },
        { name: "Blood Sugar Fasting", result: "", unit: "mg/dL", status: "" },
        { name: "HbA1c", result: "", unit: "%", status: "" },
        { name: "Serum Creatinine", result: "", unit: "mg/dL", status: "" },
        { name: "Liver Function Tests", result: "", unit: "", status: "" },
        { name: "Chest X-Ray", result: "", unit: "", status: "" },
        { name: "ECG", result: "", unit: "", status: "" },
        { name: "Urine Routine", result: "", unit: "", status: "" },
      ],
      medications: [
        { drug: "", dose: "", route: "Oral", frequency: "OD", duration: "7 days", instructions: "" },
        { drug: "", dose: "", route: "Oral", frequency: "BD", duration: "5 days", instructions: "After meals" },
      ],
      procedures: [],
      dietAdvice: "Low-fat, low-salt diet. Adequate fluid intake (2–3 litres/day). Avoid processed and fried foods.",
      activityAdvice: "Gradually increase activity as tolerated. Avoid strenuous exercise for 2 weeks.",
      emergencyWarnings: "Return to emergency if: High fever (>101°F), chest pain, severe breathlessness, altered sensorium, uncontrolled blood sugar.",
    },
  },
  {
    key: "SURGERY",
    label: "General Surgery",
    icon: "pi-wrench",
    color: "#dc2626",
    bg: "#fef2f2",
    specialSections: ["operative", "woundCare", "drains"],
    template: {
      admissionReasonPrompt: "e.g. Acute abdomen — Right iliac fossa pain for 24 hours with fever and vomiting…",
      coursePrompt: "e.g. Emergency laparoscopic appendicectomy performed under GA. Post-op recovery uneventful. Oral feeds started on Day 1. Ambulated on Day 2. Wound healthy…",
      dischargeDiagnosisPrompt: "e.g. Acute Appendicitis, Post-laparoscopic Appendicectomy (Day 3)",
      specialInstructionsPrompt: "e.g. Keep wound dry for 48 hrs. Avoid lifting heavy objects for 4 weeks. No driving for 2 weeks.",
      investigations: [
        { name: "Complete Blood Count", result: "", unit: "cells/μL", status: "" },
        { name: "Serum Electrolytes", result: "", unit: "mEq/L", status: "" },
        { name: "Renal Function Tests", result: "", unit: "", status: "" },
        { name: "Coagulation Profile (PT/INR)", result: "", unit: "", status: "" },
        { name: "X-Ray Chest (PA)", result: "", unit: "", status: "" },
        { name: "USG Abdomen", result: "", unit: "", status: "" },
        { name: "HPE Report", result: "", unit: "", status: "" },
      ],
      medications: [
        { drug: "Amoxicillin-Clavulanate", dose: "625 mg", route: "Oral", frequency: "TDS", duration: "5 days", instructions: "After food" },
        { drug: "Metronidazole", dose: "400 mg", route: "Oral", frequency: "TDS", duration: "5 days", instructions: "After food" },
        { drug: "Tab. Pantoprazole", dose: "40 mg", route: "Oral", frequency: "OD", duration: "14 days", instructions: "Before breakfast" },
        { drug: "Syrup Lactulose", dose: "15 mL", route: "Oral", frequency: "BD", duration: "5 days", instructions: "" },
      ],
      procedures: [
        { name: "Laparoscopic Appendicectomy", date: "", surgeon: "", findings: "", complications: "None" },
      ],
      dietAdvice: "Soft diet for 1 week. Gradually advance to normal diet. Adequate fluid intake. High-fibre diet to avoid constipation.",
      activityAdvice: "Light activity only. No heavy lifting for 4–6 weeks. Walk 10–15 minutes 3 times daily.",
      emergencyWarnings: "Return to emergency if: Fever > 101°F, wound discharge/redness, severe abdominal pain, inability to pass stools/flatus, vomiting.",
    },
  },
  {
    key: "GYNAECOLOGY",
    label: "Gynaecology & Obstetrics",
    icon: "pi-heart-fill",
    color: "#db2777",
    bg: "#fdf2f8",
    specialSections: ["obstetric", "neonatalDetails", "woundCare"],
    template: {
      admissionReasonPrompt: "e.g. G2P1L1 at 38+2 weeks with labour pains / Menorrhagia with severe anaemia…",
      coursePrompt: "e.g. Patient admitted in active labour. LSCS performed under spinal anaesthesia. Live male baby delivered. Post-op recovery smooth. Breastfeeding initiated…",
      dischargeDiagnosisPrompt: "e.g. G2P2L2 Post LSCS (Day 5) / Post-Hysterectomy (Fibroid Uterus)",
      specialInstructionsPrompt: "e.g. Avoid intercourse for 6 weeks. Pelvic rest. Exclusive breastfeeding. Return if heavy bleeding.",
      investigations: [
        { name: "Haemoglobin", result: "", unit: "g/dL", status: "" },
        { name: "Blood Group & Rh typing", result: "", unit: "", status: "" },
        { name: "Urine Routine", result: "", unit: "", status: "" },
        { name: "Blood Sugar (FBS/PPBS)", result: "", unit: "mg/dL", status: "" },
        { name: "Thyroid Function (TSH)", result: "", unit: "mIU/L", status: "" },
        { name: "USG Pelvis / Obstetric", result: "", unit: "", status: "" },
        { name: "HPE Report", result: "", unit: "", status: "" },
        { name: "VDRL / HIV / HBsAg", result: "", unit: "", status: "" },
      ],
      medications: [
        { drug: "Tab. Iron + Folic Acid", dose: "1 tab", route: "Oral", frequency: "BD", duration: "3 months", instructions: "After food" },
        { drug: "Cap. Calcium + Vitamin D3", dose: "1 cap", route: "Oral", frequency: "OD", duration: "3 months", instructions: "After dinner" },
        { drug: "Tab. Metronidazole", dose: "400 mg", route: "Oral", frequency: "TDS", duration: "5 days", instructions: "" },
        { drug: "Tab. Ibuprofen + Paracetamol", dose: "1 tab", route: "Oral", frequency: "SOS", duration: "3 days", instructions: "For pain" },
      ],
      procedures: [
        { name: "Lower Segment Caesarean Section (LSCS)", date: "", surgeon: "", findings: "", complications: "None" },
      ],
      dietAdvice: "Iron-rich foods (leafy greens, lentils, jaggery). Adequate protein. Continue prenatal vitamins. For lactating mothers: increased calorie intake.",
      activityAdvice: "Pelvic floor exercises. Gradual return to normal activities in 6 weeks. No heavy lifting for 6–8 weeks. Driving after 6 weeks.",
      emergencyWarnings: "Return to emergency if: Heavy vaginal bleeding, foul-smelling discharge, wound dehiscence, high fever, severe abdominal pain, difficulty breastfeeding, signs of postpartum depression.",
    },
  },
  {
    key: "PAEDIATRICS",
    label: "Paediatrics",
    icon: "pi-user",
    color: "#16a34a",
    bg: "#f0fdf4",
    specialSections: ["growth", "immunisation", "neonatalDetails"],
    template: {
      admissionReasonPrompt: "e.g. 4-year-old male with fever, cough and fast breathing for 3 days (suspected pneumonia)…",
      coursePrompt: "e.g. Child admitted with bronchopneumonia. IV antibiotics (Ampicillin + Gentamicin) started. SpO2 improved on oxygen support. Feeding improved by Day 3. Discharged on oral antibiotics…",
      dischargeDiagnosisPrompt: "e.g. Bronchopneumonia (Right) / Acute Viral URTI / Febrile Seizure (Simple)",
      specialInstructionsPrompt: "e.g. Complete full course of antibiotics. Follow up for immunisation. Avoid contact with sick individuals.",
      investigations: [
        { name: "Complete Blood Count", result: "", unit: "cells/μL", status: "" },
        { name: "CRP", result: "", unit: "mg/L", status: "" },
        { name: "Blood Culture & Sensitivity", result: "", unit: "", status: "" },
        { name: "Chest X-Ray", result: "", unit: "", status: "" },
        { name: "Serum Electrolytes", result: "", unit: "mEq/L", status: "" },
        { name: "Blood Sugar", result: "", unit: "mg/dL", status: "" },
        { name: "Urine Routine", result: "", unit: "", status: "" },
        { name: "Malaria Antigen / RDT", result: "", unit: "", status: "" },
      ],
      medications: [
        { drug: "Syrup Amoxicillin", dose: "", route: "Oral", frequency: "TDS", duration: "5 days", instructions: "As per weight (50 mg/kg/day)" },
        { drug: "Syrup Paracetamol", dose: "", route: "Oral", frequency: "QID (SOS)", duration: "3 days", instructions: "15 mg/kg/dose for fever >101°F" },
        { drug: "Syrup Salbutamol + Bromhexine", dose: "", route: "Oral", frequency: "TDS", duration: "5 days", instructions: "" },
        { drug: "ORS", dose: "", route: "Oral", frequency: "Ad lib", duration: "As needed", instructions: "For hydration" },
      ],
      procedures: [],
      dietAdvice: "Continue breastfeeding (infants). Age-appropriate soft diet. Oral rehydration. Small frequent meals. Avoid raw foods.",
      activityAdvice: "Rest for 3–5 days. Return to school after 5 days or as advised. Avoid contact sports for 1 week.",
      emergencyWarnings: "Return to emergency if: High fever not responding to paracetamol, fast or difficult breathing, convulsions, refusal to feed, decreased urine output, drowsiness or altered behavior.",
    },
  },
  {
    key: "CARDIOLOGY",
    label: "Cardiology",
    icon: "pi-chart-line",
    color: "#e11d48",
    bg: "#fff1f2",
    specialSections: ["chronicDiseases", "echoFindings", "functionalStatus"],
    template: {
      admissionReasonPrompt: "e.g. Acute chest pain with radiation to left arm for 2 hours. ECG: ST elevation in leads II, III, aVF…",
      coursePrompt: "e.g. Admitted with STEMI. Emergency PCI performed. Drug-eluting stent deployed in RCA. Post-procedure ECG normalised. Troponins trending down…",
      dischargeDiagnosisPrompt: "e.g. Acute STEMI (Inferior) — Post-PCI (RCA Stenting) / NSTEMI with 3-vessel CAD",
      specialInstructionsPrompt: "e.g. Dual antiplatelet therapy (aspirin + clopidogrel) — DO NOT stop without doctor's advice. Monitor BP and HR daily.",
      investigations: [
        { name: "Troponin I (Peak)", result: "", unit: "ng/mL", status: "" },
        { name: "CK-MB", result: "", unit: "U/L", status: "" },
        { name: "ECG (Serial)", result: "", unit: "", status: "" },
        { name: "2D Echocardiogram (EF%)", result: "", unit: "%", status: "" },
        { name: "Lipid Profile (LDL/HDL/TG)", result: "", unit: "mg/dL", status: "" },
        { name: "HbA1c", result: "", unit: "%", status: "" },
        { name: "Serum Creatinine", result: "", unit: "mg/dL", status: "" },
        { name: "Coronary Angiogram", result: "", unit: "", status: "" },
      ],
      medications: [
        { drug: "Tab. Aspirin", dose: "75 mg", route: "Oral", frequency: "OD", duration: "Lifelong", instructions: "After food" },
        { drug: "Tab. Clopidogrel", dose: "75 mg", route: "Oral", frequency: "OD", duration: "12 months", instructions: "After food" },
        { drug: "Tab. Atorvastatin", dose: "40 mg", route: "Oral", frequency: "OD", duration: "Lifelong", instructions: "At bedtime" },
        { drug: "Tab. Ramipril", dose: "2.5 mg", route: "Oral", frequency: "OD", duration: "Lifelong", instructions: "" },
        { drug: "Tab. Metoprolol Succinate", dose: "25 mg", route: "Oral", frequency: "OD", duration: "Lifelong", instructions: "" },
      ],
      procedures: [
        { name: "Percutaneous Coronary Intervention (PCI)", date: "", surgeon: "", findings: "", complications: "None" },
      ],
      dietAdvice: "Cardiac diet: low salt (<2g/day), low fat, high fibre. Avoid saturated and trans fats. No smoking. Limit alcohol.",
      activityAdvice: "Bed rest for 2 days at home. Light walking from Day 3. Cardiac rehabilitation referral. No driving for 1 week.",
      emergencyWarnings: "Return to emergency IMMEDIATELY if: Recurrent chest pain or tightness, breathlessness at rest, palpitations, dizziness, fainting, swelling of legs.",
    },
  },
  {
    key: "ORTHOPAEDICS",
    label: "Orthopaedics",
    icon: "pi-directions",
    color: "#7c3aed",
    bg: "#f5f3ff",
    specialSections: ["implantDetails", "physiotherapy", "woundCare"],
    template: {
      admissionReasonPrompt: "e.g. Road traffic accident — closed fracture right femur shaft. Unable to bear weight…",
      coursePrompt: "e.g. Patient admitted with right femur fracture. ORIF with IM nail performed. Post-op X-ray showed satisfactory alignment. Physiotherapy initiated on Day 2. Partial weight bearing with walker…",
      dischargeDiagnosisPrompt: "e.g. Right Femur Shaft Fracture — Post-ORIF (IM Nailing) / Right TKR for OA Knee",
      specialInstructionsPrompt: "e.g. Non-weight bearing for 6 weeks. Use walker/crutches. Wound dressing every 3 days. Continue physiotherapy.",
      investigations: [
        { name: "X-Ray (Pre and Post-op)", result: "", unit: "", status: "" },
        { name: "Complete Blood Count", result: "", unit: "", status: "" },
        { name: "Serum Calcium / Vitamin D", result: "", unit: "", status: "" },
        { name: "Coagulation Profile", result: "", unit: "", status: "" },
        { name: "Blood Sugar", result: "", unit: "mg/dL", status: "" },
        { name: "CT Scan", result: "", unit: "", status: "" },
        { name: "Bone Density (DEXA)", result: "", unit: "", status: "" },
      ],
      medications: [
        { drug: "Tab. Calcium + Vitamin D3", dose: "1 tab", route: "Oral", frequency: "BD", duration: "3 months", instructions: "After food" },
        { drug: "Tab. Pantoprazole", dose: "40 mg", route: "Oral", frequency: "OD", duration: "7 days", instructions: "Before breakfast" },
        { drug: "Tab. Tramadol + Paracetamol", dose: "1 tab", route: "Oral", frequency: "TDS", duration: "5 days", instructions: "For pain" },
        { drug: "Inj. Enoxaparin", dose: "40 mg", route: "SC", frequency: "OD", duration: "10 days", instructions: "DVT prophylaxis" },
      ],
      procedures: [
        { name: "Open Reduction Internal Fixation (ORIF)", date: "", surgeon: "", findings: "", complications: "None" },
      ],
      dietAdvice: "High-protein diet for wound healing. Calcium-rich foods (milk, paneer, ragi). Adequate vitamin D (sunlight exposure).",
      activityAdvice: "Non-weight bearing as instructed. Daily physiotherapy exercises. Elevate limb to reduce swelling. Return to normal activity as guided by physiotherapist.",
      emergencyWarnings: "Return to emergency if: Increased swelling/redness around wound, wound discharge, severe pain not controlled by medication, fever, numbness or tingling in limb.",
    },
  },
  {
    key: "NEUROLOGY",
    label: "Neurology",
    icon: "pi-bolt",
    color: "#0891b2",
    bg: "#ecfeff",
    specialSections: ["neurologicalStatus", "seizureHistory", "functionalStatus"],
    template: {
      admissionReasonPrompt: "e.g. Sudden onset right-sided weakness and slurring of speech for 3 hours (NIHSS score 8)…",
      coursePrompt: "e.g. Admitted with Acute Ischaemic Stroke. NCCT Brain: no haemorrhage. IV thrombolysis not given (beyond window). Antiplatelet, statin started. Physiotherapy initiated…",
      dischargeDiagnosisPrompt: "e.g. Acute Ischaemic Stroke (MCA territory) / Epilepsy — Generalised Tonic-Clonic Seizures",
      specialInstructionsPrompt: "e.g. Take antiepileptic medications without missing doses. DO NOT drive. Alert caregivers for any seizure activity.",
      investigations: [
        { name: "NCCT Brain", result: "", unit: "", status: "" },
        { name: "MRI Brain with DWI", result: "", unit: "", status: "" },
        { name: "MRA / CTA Brain", result: "", unit: "", status: "" },
        { name: "EEG", result: "", unit: "", status: "" },
        { name: "Carotid Doppler", result: "", unit: "", status: "" },
        { name: "Complete Blood Count", result: "", unit: "", status: "" },
        { name: "Lipid Profile", result: "", unit: "mg/dL", status: "" },
        { name: "2D Echocardiogram", result: "", unit: "", status: "" },
      ],
      medications: [
        { drug: "Tab. Aspirin", dose: "75 mg", route: "Oral", frequency: "OD", duration: "Lifelong", instructions: "After food" },
        { drug: "Tab. Atorvastatin", dose: "40 mg", route: "Oral", frequency: "OD", duration: "Lifelong", instructions: "At bedtime" },
        { drug: "Tab. Amlodipine", dose: "5 mg", route: "Oral", frequency: "OD", duration: "Lifelong", instructions: "" },
        { drug: "Tab. Levetiracetam", dose: "500 mg", route: "Oral", frequency: "BD", duration: "As prescribed", instructions: "Do not skip" },
      ],
      procedures: [],
      dietAdvice: "DASH diet. Reduce salt and fat. Adequate hydration. Soft/pureed diet if swallowing difficulty. Small frequent meals.",
      activityAdvice: "Bed rest initially. Daily physiotherapy and speech therapy as needed. Occupational therapy for ADL. Gradual ambulation with support.",
      emergencyWarnings: "Return IMMEDIATELY if: New weakness/paralysis, sudden severe headache, vision loss, speech difficulty, convulsions, loss of consciousness, sudden fall.",
    },
  },
  {
    key: "ONCOLOGY",
    label: "Oncology",
    icon: "pi-filter",
    color: "#0d9488",
    bg: "#f0fdfa",
    specialSections: ["tumorDetails", "chronicDiseases", "functionalStatus"],
    template: {
      admissionReasonPrompt: "e.g. Post-cycle 3 Chemotherapy monitoring / Admitted for TACE procedure for HCC…",
      coursePrompt: "e.g. Patient admitted for Cycle 3 FOLFOX chemotherapy. Pre-meds given. Chemo administered over 46 hours. No acute toxicity. Blood counts reviewed…",
      dischargeDiagnosisPrompt: "e.g. Carcinoma Colon (Sigmoid) — Stage III — Post Cycle 3 FOLFOX / Ca Breast — Post Modified Radical Mastectomy",
      specialInstructionsPrompt: "e.g. Strict hand hygiene. Avoid crowded places (neutropenia risk). Next chemo cycle on scheduled date. Report fever immediately.",
      investigations: [
        { name: "Complete Blood Count (Nadir)", result: "", unit: "cells/μL", status: "" },
        { name: "Liver Function Tests", result: "", unit: "", status: "" },
        { name: "Renal Function Tests", result: "", unit: "", status: "" },
        { name: "Tumour Markers (CEA/CA-125/AFP)", result: "", unit: "", status: "" },
        { name: "CT Chest/Abdomen/Pelvis", result: "", unit: "", status: "" },
        { name: "PET-CT", result: "", unit: "", status: "" },
        { name: "Bone Marrow Biopsy", result: "", unit: "", status: "" },
      ],
      medications: [
        { drug: "Tab. Ondansetron", dose: "8 mg", route: "Oral", frequency: "BD", duration: "5 days", instructions: "Anti-emetic" },
        { drug: "Tab. Pantoprazole", dose: "40 mg", route: "Oral", frequency: "OD", duration: "14 days", instructions: "" },
        { drug: "Tab. G-CSF (Filgrastim)", dose: "300 mcg", route: "SC", frequency: "OD", duration: "5 days", instructions: "If ANC < 1000" },
        { drug: "Multivitamin supplement", dose: "1 tab", route: "Oral", frequency: "OD", duration: "Continue", instructions: "" },
      ],
      procedures: [],
      dietAdvice: "High-protein, high-calorie diet. Small frequent meals. Soft foods if mucositis. Avoid raw/uncooked foods. Adequate hydration.",
      activityAdvice: "Rest as tolerated. Light walking daily. Avoid crowded public places. Avoid contact with sick individuals. Report fatigue.",
      emergencyWarnings: "Return IMMEDIATELY if: Fever > 100.4°F (neutropenic fever), severe vomiting/diarrhoea, bleeding from any site, chest pain, breathlessness, confusion.",
    },
  },
];

/* ── Design tokens ── */
const C = {
  bg: "#f0f2f5", card: "#fff", border: "#e2e8f0",
  text: "#0f172a", muted: "#64748b", subtle: "#f8fafc",
  green: "#16a34a", red: "#dc2626", amber: "#d97706", blue: "#1e40af",
};

/* Hex → soft-tint helpers used by Section / DeptBanner. */
const hexA = (hex, alpha) => {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0,2), 16), g = parseInt(h.slice(2,4), 16), b = parseInt(h.slice(4,6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
};
const hexShade = (hex, amount) => {
  const h = hex.replace("#", "");
  const r = Math.max(0, Math.min(255, parseInt(h.slice(0,2), 16) + amount));
  const g = Math.max(0, Math.min(255, parseInt(h.slice(2,4), 16) + amount));
  const b = Math.max(0, Math.min(255, parseInt(h.slice(4,6), 16) + amount));
  return `#${r.toString(16).padStart(2,"0")}${g.toString(16).padStart(2,"0")}${b.toString(16).padStart(2,"0")}`;
};

/* Field wrapper. Label sits above the input with a thin colour stripe on
   focus so the active field is obvious without changing layout. */
function F({ label, required, children, hint }) {
  return (
    <div className="ds-field">
      <label style={{
        display: "block",
        fontSize: 10.5,
        fontWeight: 700,
        color: C.muted,
        textTransform: "uppercase",
        letterSpacing: ".7px",
        marginBottom: 6,
      }}>
        {label}{required && <span style={{ color: C.red, marginLeft: 3 }}>*</span>}
      </label>
      {children}
      {hint && <div style={{ fontSize: 10, color: C.muted, marginTop: 4, fontStyle: "italic" }}>{hint}</div>}
    </div>
  );
}

/* Responsive grids. The fixed 4-column G4 was squeezing fields on narrow
   viewports — now uses minmax(180px, 1fr) so it gracefully wraps to 3, 2,
   1 column. G2 / G3 same approach. */
function G2({ children, gap = 16 }) {
  return <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap }}>{children}</div>;
}
function G3({ children }) {
  return <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>{children}</div>;
}
function G4({ children }) {
  return <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14 }}>{children}</div>;
}

/* Section card. Gradient header in dept colour, subtle inner shadow, NABH
   pill anchored right, collapsible. */
function Section({ title, icon, color = C.blue, nabh, sub, children, defaultOpen = true, badge }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{
      background: C.card,
      border: `1px solid ${hexA(color, 0.18)}`,
      borderRadius: 14,
      overflow: "hidden",
      marginBottom: 16,
      boxShadow: "0 1px 3px rgba(15,23,42,.04), 0 4px 12px rgba(15,23,42,.03)",
    }}>
      <div onClick={() => setOpen(o => !o)} style={{
        padding: "14px 20px",
        background: `linear-gradient(135deg, ${hexA(color, 0.08)}, ${hexA(color, 0.02)})`,
        borderBottom: open ? `1px solid ${hexA(color, 0.15)}` : "none",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        cursor: "pointer", gap: 12,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
          <span style={{
            width: 36, height: 36, borderRadius: 10,
            background: `linear-gradient(135deg, ${color}, ${hexShade(color, -30)})`,
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: `0 3px 10px ${hexA(color, 0.35)}`,
            flexShrink: 0,
          }}>
            <i className={`pi ${icon}`} style={{ fontSize: 15, color: "#fff" }} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 14.5, color: C.text, letterSpacing: "-.2px" }}>
              {title}
              {nabh && (
                <span style={{
                  marginLeft: 10,
                  background: "#f5f3ff", color: "#7c3aed",
                  border: "1px solid #c4b5fd",
                  fontSize: 9.5, fontWeight: 800,
                  padding: "2px 8px", borderRadius: 4,
                  textTransform: "uppercase", letterSpacing: ".5px",
                  verticalAlign: "middle",
                }}>NABH</span>
              )}
              {badge && (
                <span style={{
                  marginLeft: 8,
                  background: hexA(color, 0.12), color,
                  border: `1px solid ${hexA(color, 0.3)}`,
                  fontSize: 9.5, fontWeight: 700,
                  padding: "2px 8px", borderRadius: 4,
                  verticalAlign: "middle",
                }}>{badge}</span>
              )}
            </div>
            {sub && (
              <div style={{ fontSize: 11, color: C.muted, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {sub}
              </div>
            )}
          </div>
        </div>
        <div style={{
          width: 28, height: 28, borderRadius: "50%",
          background: hexA(color, 0.1),
          display: "flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0,
        }}>
          <i className={`pi ${open ? "pi-chevron-up" : "pi-chevron-down"}`} style={{ fontSize: 11, color }} />
        </div>
      </div>
      {open && <div style={{ padding: "20px 22px" }}>{children}</div>}
    </div>
  );
}

/* ── Department card ── */
function DeptCard({ dept, selected, onSelect }) {
  const active = selected?.key === dept.key;
  return (
    <button onClick={() => onSelect(dept)} style={{
      background: active
        ? `linear-gradient(135deg, ${hexA(dept.color, 0.08)}, ${hexA(dept.color, 0.02)})`
        : "white",
      border: `1.5px solid ${active ? dept.color : C.border}`,
      borderRadius: 14,
      padding: "18px 16px",
      cursor: "pointer",
      textAlign: "left",
      transition: "all .15s",
      display: "flex", flexDirection: "column", gap: 10,
      boxShadow: active
        ? `0 6px 20px ${hexA(dept.color, 0.18)}`
        : "0 1px 3px rgba(15,23,42,.04)",
      minHeight: 92,
    }}
      onMouseEnter={e => {
        if (!active) {
          e.currentTarget.style.borderColor = hexA(dept.color, 0.5);
          e.currentTarget.style.boxShadow = `0 4px 14px ${hexA(dept.color, 0.1)}`;
          e.currentTarget.style.transform = "translateY(-1px)";
        }
      }}
      onMouseLeave={e => {
        if (!active) {
          e.currentTarget.style.borderColor = C.border;
          e.currentTarget.style.boxShadow = "0 1px 3px rgba(15,23,42,.04)";
          e.currentTarget.style.transform = "none";
        }
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{
          width: 40, height: 40, borderRadius: 10,
          background: active
            ? `linear-gradient(135deg, ${dept.color}, ${hexShade(dept.color, -30)})`
            : dept.bg,
          display: "flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0,
          boxShadow: active ? `0 4px 10px ${hexA(dept.color, 0.4)}` : "none",
        }}>
          <i className={`pi ${dept.icon}`} style={{ fontSize: 17, color: active ? "white" : dept.color }} />
        </span>
        <div style={{ fontSize: 13, fontWeight: 800, color: active ? dept.color : C.text, lineHeight: 1.3 }}>
          {dept.label}
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", fontSize: 10, color: C.muted, fontWeight: 600 }}>
        <span style={{ background: hexA(dept.color, 0.08), color: dept.color, padding: "2px 7px", borderRadius: 4 }}>
          {dept.template.investigations?.length || 0} inv
        </span>
        <span style={{ background: hexA(dept.color, 0.08), color: dept.color, padding: "2px 7px", borderRadius: 4 }}>
          {dept.template.medications?.length || 0} med
        </span>
        <span style={{ background: hexA(dept.color, 0.08), color: dept.color, padding: "2px 7px", borderRadius: 4 }}>
          {dept.template.procedures?.length || 0} proc
        </span>
      </div>
    </button>
  );
}

/* ── Table shell — adds a sticky column header row above the *Row rows ── */
function TableShell({ cols, color, children, empty }) {
  return (
    <div style={{
      border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden",
      background: "#fff",
    }}>
      {/* Header */}
      <div style={{
        display: "grid",
        gridTemplateColumns: cols.map(c => c.w).join(" ") + " auto",
        gap: 8,
        padding: "8px 12px",
        background: `linear-gradient(135deg, ${hexA(color, 0.06)}, ${hexA(color, 0.02)})`,
        borderBottom: `1px solid ${hexA(color, 0.15)}`,
        fontSize: 10,
        fontWeight: 800,
        textTransform: "uppercase",
        letterSpacing: ".6px",
        color: hexShade(color, -20),
      }}>
        {cols.map((c, i) => <div key={i}>{c.label}</div>)}
        <div />
      </div>
      {/* Body */}
      <div style={{ padding: 10 }}>
        {empty ? (
          <div style={{
            padding: "18px 12px", textAlign: "center",
            color: C.muted, fontSize: 12, fontStyle: "italic",
          }}>
            {empty}
          </div>
        ) : children}
      </div>
    </div>
  );
}

const MED_COLS = [
  { label: "Drug", w: "2fr" }, { label: "Dose", w: "1fr" },
  { label: "Route", w: "1fr" }, { label: "Frequency", w: "1fr" },
  { label: "Duration", w: "1fr" }, { label: "Instructions", w: "1.5fr" },
];
const INV_COLS = [
  { label: "Investigation", w: "2fr" }, { label: "Result / Finding", w: "1.5fr" },
  { label: "Unit", w: "1fr" }, { label: "Status", w: "1fr" },
];
const PROC_COLS = [
  { label: "Procedure", w: "2fr" }, { label: "Date", w: "1fr" },
  { label: "Surgeon / Operator", w: "1.5fr" }, { label: "Findings", w: "2fr" },
  { label: "Complications", w: "1.5fr" },
];

/* ── Medication row ── */
function MedRow({ med, idx, color, onChange, onRemove }) {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: MED_COLS.map(c => c.w).join(" ") + " auto",
      gap: 8, marginBottom: 8, alignItems: "center",
    }}>
      <input className="his-field" value={med.drug} onChange={e => onChange(idx, "drug", e.target.value)} placeholder="Paracetamol 500mg" />
      <input className="his-field" value={med.dose} onChange={e => onChange(idx, "dose", e.target.value)} placeholder="1 tab" />
      <select className="his-select" value={med.route} onChange={e => onChange(idx, "route", e.target.value)}>
        {["Oral","IV","IM","SC","SL","Topical","Inhaled","PR","Nasal"].map(r => <option key={r}>{r}</option>)}
      </select>
      <select className="his-select" value={med.frequency} onChange={e => onChange(idx, "frequency", e.target.value)}>
        {["OD","BD","TDS","QID","SOS","HS","Q4H","Q6H","Q8H","Weekly","Ad lib"].map(f => <option key={f}>{f}</option>)}
      </select>
      <input className="his-field" value={med.duration} onChange={e => onChange(idx, "duration", e.target.value)} placeholder="5 days" />
      <input className="his-field" value={med.instructions} onChange={e => onChange(idx, "instructions", e.target.value)} placeholder="After meals" />
      <button onClick={() => onRemove(idx)} title="Remove" style={{
        width: 32, height: 32, borderRadius: 8, border: "none",
        background: "#fef2f2", color: C.red, cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center",
        transition: "background .15s",
      }}
        onMouseEnter={e => e.currentTarget.style.background = "#fee2e2"}
        onMouseLeave={e => e.currentTarget.style.background = "#fef2f2"}>
        <i className="pi pi-trash" style={{ fontSize: 12 }} />
      </button>
    </div>
  );
}

/* ── Investigation row ── */
function InvRow({ inv, idx, color, onChange, onRemove }) {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: INV_COLS.map(c => c.w).join(" ") + " auto",
      gap: 8, marginBottom: 8, alignItems: "center",
    }}>
      <input className="his-field" value={inv.name} onChange={e => onChange(idx, "name", e.target.value)} placeholder="CBC, X-ray Chest, …" />
      <input className="his-field" value={inv.result} onChange={e => onChange(idx, "result", e.target.value)} placeholder="Within normal limits" />
      <input className="his-field" value={inv.unit} onChange={e => onChange(idx, "unit", e.target.value)} placeholder="—" />
      <select className="his-select" value={inv.status} onChange={e => onChange(idx, "status", e.target.value)}>
        <option value="">Status</option>
        {["Normal","Abnormal","Critical","Borderline","Pending"].map(s => <option key={s}>{s}</option>)}
      </select>
      <button onClick={() => onRemove(idx)} title="Remove" style={{
        width: 32, height: 32, borderRadius: 8, border: "none",
        background: "#fef2f2", color: C.red, cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <i className="pi pi-trash" style={{ fontSize: 12 }} />
      </button>
    </div>
  );
}

/* ── Procedure row ── */
function ProcRow({ proc, idx, onChange, onRemove }) {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: PROC_COLS.map(c => c.w).join(" ") + " auto",
      gap: 8, marginBottom: 8, alignItems: "center",
    }}>
      <input className="his-field" value={proc.name} onChange={e => onChange(idx, "name", e.target.value)} placeholder="Procedure name" />
      <input className="his-field" type="date" value={proc.date} onChange={e => onChange(idx, "date", e.target.value)} />
      <input className="his-field" value={proc.surgeon} onChange={e => onChange(idx, "surgeon", e.target.value)} placeholder="Dr. …" />
      <input className="his-field" value={proc.findings} onChange={e => onChange(idx, "findings", e.target.value)} placeholder="Key findings" />
      <input className="his-field" value={proc.complications} onChange={e => onChange(idx, "complications", e.target.value)} placeholder="None" />
      <button onClick={() => onRemove(idx)} title="Remove" style={{
        width: 32, height: 32, borderRadius: 8, border: "none",
        background: "#fef2f2", color: C.red, cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <i className="pi pi-trash" style={{ fontSize: 12 }} />
      </button>
    </div>
  );
}

/* ── Print Modal ── */
function PrintModal({ data, dept, onClose }) {
  // R7cb-B: live hospital identity for the preview letterhead + footer claim.
  // Cached in module — first open hits API, reprints are free.
  const { settings: hs } = useHospitalSettings();
  const _hospName   = hs.hospitalName || "Hospital";
  const _hospTagline = hs.tagline || "";
  const _addrLine   = [hs.addressLine1, hs.addressLine2, [hs.city, hs.state, hs.pincode].filter(Boolean).join(" ")].filter(Boolean).join(" · ");
  const _phoneLine  = [hs.phone1, hs.phone2, hs.emergencyPhone].filter(Boolean).join(" · ");
  /* Wired to the unified print system — picks up the hospital
   * header/footer + paper-size selector automatically. */
  const handlePrint = () => {
    // R7eo-B — Pattern B caller payload gap fix: form uses
    // `doctorName` / `courseInHospital` / `specialInstructions` but the
    // previous payload mapped to `consultantName` / `courseOfStay` /
    // `dischargeAdvice` — 20+ dept-specific fields were silently
    // dropped. Realign the names and spread through the dept-specific
    // fields so the template (once Pattern C lands) can render them.
    openPrint("discharge-summary", {
      summaryNo:           data.summaryNumber,
      patientName:         data.patientName,
      uhid:                data.UHID,
      ipdNo:               data.ipdNo,
      age:                 data.age,
      gender:              data.gender,
      admissionDate:       data.admissionDate,
      dischargeDate:       data.dischargeDate || new Date().toISOString(),
      totalDays:           data.totalDays,
      consultantName:      data.doctorName || data.consultantName || "",
      consultantReg:       data.doctorRegNo || "",
      bedNumber:           data.bedNumber,
      wardName:            data.wardName,
      dischargeType:       data.dischargeType || "Normal",
      finalDiagnosis:      data.finalDiagnosis,
      icd10:               data.icd10,
      icd10Desc:           data.icd10Desc,
      secondaryDiagnoses:  data.secondaryDiagnoses,
      chiefComplaints:     data.chiefComplaints,
      courseOfStay:        data.courseInHospital || data.courseOfStay || data.hospitalCourse || "",
      proceduresDone:      data.procedures || data.proceduresDone,
      // R7hr-200 — the printable renders investigationsSummary as a pre-wrap
      // paragraph, so prefer the auto-filled narrative; fall back to any
      // legacy array/string. (Array fallback is flattened to lines.)
      investigationsSummary: data.keyInvestigationsText
        || (Array.isArray(data.investigationsSummary)
              ? data.investigationsSummary.map(i => `${i.testName || i.name || ""}: ${i.result || ""}`.trim()).filter(Boolean).join("\n")
              : data.investigationsSummary)
        || data.keyInvestigations || "",
      conditionOnDischarge: data.conditionOnDischarge,
      dischargeMeds:       data.dischargeMeds || data.medications || [],
      advice:              [data.specialInstructions, data.activityAdvice].filter(Boolean).flatMap(s => String(s).split("\n").filter(Boolean)),
      bloodGroup:          data.bloodGroup || data.patient?.bloodGroup,
      allergies:           data.allergies  || data.patient?.allergies,
      dietAdvice:          data.dietAdvice,
      followUpDate:        data.followUpDate,
      followUpDoctor:      data.followUpDoctor || data.doctorName || data.consultantName,
      followUpInstructions: data.followUpInstructions,
      followUpDepartment:  data.followUpDepartment,
      warningSigns:        data.warningSigns,
      // Pattern B passthrough — dept-specific fields the form
      // already captures; will be rendered by the DischargeSummary
      // template after Pattern C lands.
      activityAdvice:       data.activityAdvice,
      emergencyWarnings:    data.emergencyWarnings,
      specialInstructions:  data.specialInstructions,
      woundCare:            data.woundCare,
      operativeProcedure:   data.operativeProcedure,
      operativeFindings:    data.operativeFindings,
      anaesthesiaType:      data.anaesthesiaType,
      implantDetails:       data.implantDetails,
      physiotherapyAdvice:  data.physiotherapyAdvice,
      deliveryType:         data.deliveryType,
      babyDetails:          data.babyDetails,
      neonatalNotes:        data.neonatalNotes,
      growthPercentile:     data.growthPercentile,
      immunisationGiven:    data.immunisationGiven,
      echoEF:               data.echoEF,
      ecgOnDischarge:       data.ecgOnDischarge,
      tumorStage:           data.tumorStage,
      nextChemoDate:        data.nextChemoDate,
      strokeType:           data.strokeType,
      nihssOnDischarge:     data.nihssOnDischarge,
      comorbidities:        data.comorbidities,
      historyOfPresentIllness: data.historyOfPresentIllness,
      // R7bh-F1 / META-1: PrintAudit anchor — the DischargeSummary
      // document drives the printCount on its source row. NABH COP.7
      // + IMS.5 require the reprint trail.
      printAudit: {
        entityType:   "DischargeSummary",
        entityId:     data._id || data.dischargeSummaryId,
        entityNumber: data.summaryNumber,
        UHID:         data.UHID,
        patientName:  data.patientName,
      },
    });
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ background: "white", borderRadius: 16, width: "100%", maxWidth: 860, maxHeight: "92vh", overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: "0 25px 80px rgba(0,0,0,.35)" }}>
        <div style={{ padding: "14px 20px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", background: dept?.color + "08" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ width: 32, height: 32, borderRadius: 8, background: dept?.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <i className={`pi ${dept?.icon}`} style={{ color: dept?.color, fontSize: 14 }} />
            </span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>Discharge Summary Preview</div>
              <div style={{ fontSize: 11, color: C.muted }}>{dept?.label} · NABH COP.7</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={handlePrint} style={{ padding: "7px 16px", borderRadius: 8, border: "none", background: dept?.color, color: "white", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
              <i className="pi pi-print" style={{ marginRight: 6 }} />Print
            </button>
            <button onClick={onClose} style={{ padding: "7px 14px", borderRadius: 8, border: `1px solid ${C.border}`, background: "white", fontSize: 12, cursor: "pointer" }}>Close</button>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
          <div id="ds-print-content">
            {/* MLC stamp (auto-applied if patient has an active MLC) */}
            <MLCAutoStamp uhid={data.UHID} variant="banner" />
            <MLCAutoStamp uhid={data.UHID} />
            {/* Hospital header */}
            <div className="hosp" style={{ textAlign: "center", marginBottom: 6 }}>
              {hs.logo && <img src={hs.logo} alt="" style={{ maxHeight: 48, marginBottom: 4 }} />}
              <div style={{ fontWeight: 800, fontSize: 16, textTransform: "uppercase", color: hs.printHeaderColor || undefined }}>{_hospName}</div>
              <div style={{ fontSize: 11, color: C.muted }}>{_hospTagline ? `${_hospTagline} · ` : ""}Department of {dept?.label}</div>
              {_addrLine && <div style={{ fontSize: 10, color: C.muted }}>{_addrLine}</div>}
              {_phoneLine && <div style={{ fontSize: 10, color: C.muted }}>{_phoneLine}</div>}
              {hs.gstin && <div style={{ fontSize: 10, color: C.muted }}>GSTIN: {hs.gstin}</div>}
            </div>
            <hr style={{ border: "none", borderTop: `2px solid ${dept?.color}`, marginBottom: 10 }} />
            <div style={{ textAlign: "center", fontWeight: 800, fontSize: 17, marginBottom: 4, fontFamily: "serif" }}>DISCHARGE SUMMARY</div>
            <div style={{ textAlign: "center", fontSize: 11, color: C.muted, marginBottom: 14 }}>NABH Standard: COP.7 | Date: {new Date().toLocaleDateString("en-IN")}</div>

            {/* Patient info */}
            <div style={{ border: `1.5px solid ${C.border}`, borderRadius: 8, padding: "12px 16px", marginBottom: 14, background: "#f8fafc", display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "8px 16px" }}>
              {[
                ["UHID", data.UHID],["Patient Name", data.patientName],["Age / Gender", `${data.age} / ${data.gender}`],["Contact", data.contactNumber],
                ["IPD No.", data.ipdNo],["Admission Date", data.admissionDate],["Discharge Date", data.dischargeDate],["Duration of Stay", data.stayDays ? `${data.stayDays} days` : "—"],
                ["Department", data.department || dept?.label],["Consultant", data.doctorName],["Reg. No.", data.doctorRegNo],["Condition on Discharge", data.conditionOnDischarge],
              ].map(([l, v]) => (
                <div key={l}>
                  <div style={{ fontSize: 10, color: C.muted, fontWeight: 600 }}>{l}</div>
                  <div style={{ fontSize: 13, fontWeight: 600, borderBottom: `1px solid ${C.border}`, paddingBottom: 2 }}>{v || "—"}</div>
                </div>
              ))}
            </div>

            {/* Diagnosis */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontWeight: 700, fontSize: 12, background: dept?.color + "15", padding: "4px 10px", borderLeft: `3px solid ${dept?.color}`, marginBottom: 6 }}>DIAGNOSIS</div>
              <G2>
                <div><div style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>Admitting Diagnosis</div><div style={{ padding: "6px 0", fontStyle: "italic" }}>{data.admittingDiagnosis || "—"}</div></div>
                <div><div style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>Final Diagnosis</div><div style={{ padding: "6px 0", fontWeight: 700 }}>{data.finalDiagnosis || "—"}</div></div>
              </G2>
              {data.icdCode && <div style={{ fontSize: 11, color: C.muted }}>ICD-10: {data.icdCode}</div>}
              {data.comorbidities && <div style={{ fontSize: 12, marginTop: 4 }}><b>Comorbidities:</b> {data.comorbidities}</div>}
            </div>

            {/* History & Course */}
            {data.historyOfPresentIllness && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontWeight: 700, fontSize: 12, background: dept?.color + "15", padding: "4px 10px", borderLeft: `3px solid ${dept?.color}`, marginBottom: 6 }}>HISTORY OF PRESENTING ILLNESS</div>
                <div style={{ lineHeight: 1.7, fontSize: 13, whiteSpace: "pre-line" }}>{data.historyOfPresentIllness}</div>
              </div>
            )}
            {data.courseInHospital && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontWeight: 700, fontSize: 12, background: dept?.color + "15", padding: "4px 10px", borderLeft: `3px solid ${dept?.color}`, marginBottom: 6 }}>HOSPITAL COURSE</div>
                <div style={{ lineHeight: 1.7, fontSize: 13, whiteSpace: "pre-line" }}>{data.courseInHospital}</div>
              </div>
            )}

            {/* Investigations */}
            {data.investigations?.filter(i => i.name || i.result).length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontWeight: 700, fontSize: 12, background: dept?.color + "15", padding: "4px 10px", borderLeft: `3px solid ${dept?.color}`, marginBottom: 6 }}>KEY INVESTIGATIONS</div>
                <table><thead><tr><th>Investigation</th><th>Result</th><th>Unit</th><th>Status</th></tr></thead>
                  <tbody>
                    {data.investigations.filter(i => i.name).map((inv, i) => (
                      <tr key={i} style={{ background: inv.status === "Abnormal" || inv.status === "Critical" ? "#fef2f2" : "white" }}>
                        <td>{inv.name}</td><td style={{ fontWeight: inv.status === "Critical" ? 700 : 400 }}>{inv.result || "—"}</td><td>{inv.unit || "—"}</td>
                        <td style={{ color: inv.status === "Critical" ? C.red : inv.status === "Abnormal" ? C.amber : C.green }}>{inv.status || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Procedures */}
            {data.procedures?.filter(p => p.name).length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontWeight: 700, fontSize: 12, background: dept?.color + "15", padding: "4px 10px", borderLeft: `3px solid ${dept?.color}`, marginBottom: 6 }}>PROCEDURES PERFORMED</div>
                <table><thead><tr><th>Procedure</th><th>Date</th><th>Surgeon</th><th>Findings</th><th>Complications</th></tr></thead>
                  <tbody>
                    {data.procedures.filter(p => p.name).map((p, i) => (
                      <tr key={i}><td>{p.name}</td><td>{p.date}</td><td>{p.surgeon}</td><td>{p.findings}</td><td>{p.complications}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Discharge Medications */}
            {data.medications?.filter(m => m.drug).length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontWeight: 700, fontSize: 12, background: dept?.color + "15", padding: "4px 10px", borderLeft: `3px solid ${dept?.color}`, marginBottom: 6 }}>DISCHARGE MEDICATIONS</div>
                <table><thead><tr><th>#</th><th>Drug</th><th>Dose</th><th>Route</th><th>Frequency</th><th>Duration</th><th>Instructions</th></tr></thead>
                  <tbody>
                    {data.medications.filter(m => m.drug).map((m, i) => (
                      <tr key={i}><td>{i + 1}</td><td style={{ fontWeight: 600 }}>{m.drug}</td><td>{m.dose}</td><td>{m.route}</td><td>{m.frequency}</td><td>{m.duration}</td><td>{m.instructions}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Advice */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontWeight: 700, fontSize: 12, background: dept?.color + "15", padding: "4px 10px", borderLeft: `3px solid ${dept?.color}`, marginBottom: 6 }}>DISCHARGE ADVICE</div>
              <G2>
                {data.dietAdvice && <div><b>Diet:</b> {data.dietAdvice}</div>}
                {data.activityAdvice && <div><b>Activity:</b> {data.activityAdvice}</div>}
                {data.woundCare && <div><b>Wound Care:</b> {data.woundCare}</div>}
                {data.specialInstructions && <div><b>Special Instructions:</b> {data.specialInstructions}</div>}
              </G2>
            </div>

            {/* Follow-up */}
            {data.followUpDate && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontWeight: 700, fontSize: 12, background: dept?.color + "15", padding: "4px 10px", borderLeft: `3px solid ${dept?.color}`, marginBottom: 6 }}>FOLLOW-UP</div>
                <div style={{ fontSize: 13 }}>
                  <b>Date:</b> {data.followUpDate} | <b>Doctor:</b> {data.followUpDoctor || "—"} | <b>Dept:</b> {data.followUpDepartment || "—"}
                  {data.followUpInstructions && <div style={{ marginTop: 4 }}>{data.followUpInstructions}</div>}
                </div>
              </div>
            )}

            {/* Emergency warnings */}
            {data.emergencyWarnings && (
              <div style={{ marginBottom: 14, background: "#fff3cd", border: "1px solid #ffc107", padding: "10px 14px", borderRadius: 6 }}>
                <div style={{ fontWeight: 700, color: "#856404", marginBottom: 4 }}>⚠ WHEN TO SEEK EMERGENCY CARE</div>
                <div style={{ fontSize: 12, lineHeight: 1.7 }}>{data.emergencyWarnings}</div>
              </div>
            )}

            {/* Signatures */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 20, marginTop: 24 }}>
              {[
                { label: "Patient / Guardian Signature", sub: `Name: ${data.patientName}` },
                { label: "Resident / RMO Signature", sub: "Name:\nReg. No.:" },
                { label: "Consultant Signature", sub: `Dr. ${data.doctorName || "—"}\nReg. No.: ${data.doctorRegNo || "—"}` },
              ].map(({ label, sub }) => (
                <div key={label} style={{ borderTop: `2px solid ${C.text}`, paddingTop: 6 }}>
                  <div style={{ fontSize: 11, fontWeight: 700 }}>{label}</div>
                  <div style={{ fontSize: 10, color: C.muted, whiteSpace: "pre-line", lineHeight: 1.6 }}>{sub}</div>
                  <div style={{ marginTop: 24, borderTop: `1px solid ${C.border}`, paddingTop: 3, fontSize: 10, color: C.muted }}>Date: _____________</div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 10, fontSize: 10, color: C.muted, textAlign: "center" }}>
              NABH Standard COP.7 | {_hospName} | {new Date().toLocaleDateString("en-IN")}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════
   MAIN PAGE
══════════════════════════════════════ */
export function DischargeSummaryPageContent({ selectedPatient }) {
  const { user } = useAuth();
  const [view, setView] = useState("catalogue"); // catalogue | form
  const [selectedDept, setSelectedDept] = useState(null);
  const [uhid, setUhid] = useState("");
  const [patInfo, setPatInfo] = useState(null);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [printData, setPrintData] = useState(null);

  const [form, setForm] = useState({
    // BOTH ObjectId refs are mandatory on the backend (DischargeSummary
    // schema marks `patient` as `required: true`; `admissionId` drives the
    // upsert + finalize-discharge chain). They were missing from the
    // initial form state which caused every Save/Finalize click to die
    // with a silent 400 validation error.
    patient: null,
    admissionId: null,
    UHID: "", patientName: "", age: "", gender: "", contactNumber: "",
    ipdNo: "", admissionDate: "", dischargeDate: new Date().toISOString().slice(0, 10),
    stayDays: "", doctorName: "", doctorRegNo: "", department: "",
    consultants: "", admittingDiagnosis: "", finalDiagnosis: "", icdCode: "",
    comorbidities: "", historyOfPresentIllness: "", courseInHospital: "",
    // R7hr-200 — free-text investigations paragraph, auto-filled from the
    // patient's manual lab trends + imaging/path reports so the doctor
    // doesn't retype them (and the page can be saved as a narrative).
    keyInvestigationsText: "",
    significantFindings: "", conditionOnDischarge: "Stable",
    dietAdvice: "", activityAdvice: "", woundCare: "", specialInstructions: "",
    followUpRequired: true, followUpDate: "", followUpDoctor: "", followUpDepartment: "", followUpInstructions: "",
    emergencyWarnings: "",
    // Dept-specific extras
    operativeProcedure: "", operativeFindings: "", anaesthesiaType: "",
    implantDetails: "", physiotherapyAdvice: "",
    deliveryType: "", babyDetails: "", neonatalNotes: "",
    growthPercentile: "", immunisationGiven: "",
    echoEF: "", ecgOnDischarge: "",
    tumorStage: "", nextChemoDate: "",
    strokeType: "", nihssOnDischarge: "",
  });

  const [medications, setMedications] = useState([]);
  const [investigations, setInvestigations] = useState([]);
  const [procedures, setProcedures] = useState([]);

  // Auto-save draft
  const draftKey = patInfo?._id ? `sphere_draft_discharge_${patInfo._id}` : null;
  const { savedAt, hasDraft, clearDraft } = useAutoSave(
    draftKey, { form, medications, investigations, procedures }, 2000
  );
  const { signature, showSetup, setShowSetup, saveSignature } = useDigitalSignature();

  const token = (sessionStorage.getItem("his_token"));
  const headers = { Authorization: `Bearer ${token}` };

  const handleDeptSelect = (dept) => {
    setSelectedDept(dept);
    const tpl = dept.template;
    setInvestigations(tpl.investigations.map(i => ({ ...i })));
    setMedications(tpl.medications.map(m => ({ ...m })));
    setProcedures(tpl.procedures.map(p => ({ ...p })));
    setForm(prev => ({
      ...prev,
      dietAdvice: tpl.dietAdvice,
      activityAdvice: tpl.activityAdvice,
      emergencyWarnings: tpl.emergencyWarnings,
      doctorName: prev.doctorName || user?.fullName || "",
      department: dept.label,
    }));
    setView("form");
  };

  // Auto-load when /discharge-summary is opened from /bed-visual. UHID
  // now comes from location.state (or a legacy ?uhid= URL param which
  // is scrubbed from history on read). Audit E-04.
  const uhidFromLocation = useUhidFromLocation();
  const [workflowCtx, setWorkflowCtx] = useState(null);
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("discharge_context");
      if (raw) setWorkflowCtx(JSON.parse(raw));
    } catch (_) {}
    if (uhidFromLocation && uhidFromLocation.trim()) {
      setUhid(uhidFromLocation.trim());
      // Defer one tick so the state update flushes before searchPatient
      // reads it via closure.
      setTimeout(() => {
        const trigger = document.getElementById("ds-load-btn");
        if (trigger) trigger.click();
      }, 60);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uhidFromLocation]);

  // Auto-fill when patient selected from AdmittedPatientPanel.
  // Route this through the SAME full searchPatient flow used by the search
  // button (and the /bed-visual launch) so age / gender / admission-date /
  // doctor reg-no + the IPD-Initial-Assessment / lab / imaging / procedure
  // prefills all run. The earlier inline mapping only set a partial subset
  // (and wrote admissionDate as a locale "dd/mm/yyyy" string the date input
  // could not render), which is why those fields stayed blank.
  useEffect(() => {
    if (!selectedPatient) return;
    const u = (selectedPatient.UHID || "").trim();
    if (!u) return;
    setUhid(u);
    setPatInfo(selectedPatient);
    setTimeout(() => {
      const trigger = document.getElementById("ds-load-btn");
      if (trigger) trigger.click();
    }, 60);
  }, [selectedPatient?._id]); // eslint-disable-line react-hooks/exhaustive-deps

  const searchPatient = async () => {
    if (!uhid.trim()) return;
    setSearching(true);
    try {
      // Discharge summary is IPD-only — never show OPD visits here.
      const res = await axios.get(`${API_ENDPOINTS.BASE}/admissions/active?hasBed=true`, { headers });
      const list = Array.isArray(res.data?.data) ? res.data.data : [];
      const found = list.find(a => a.UHID === uhid.trim().toUpperCase() || a.admissionNumber === uhid.trim());
      if (found) {
        setPatInfo(found);
        const admDate = found.admissionDate ? new Date(found.admissionDate) : null;
        const disDate = new Date();
        const stayDays = admDate ? Math.ceil((disDate - admDate) / 86400000) : "";
        // Resolve nested patient (admissionService may or may not
        // populate the patientId ref). Fall back to a direct GET if the
        // age / gender / DOB are missing.
        let pat = (found.patientId && typeof found.patientId === "object") ? found.patientId : null;
        if ((!pat || !pat.gender) && found.UHID) {
          try {
            const r = await axios.get(`${API_ENDPOINTS.BASE}/patients/uhid/${encodeURIComponent(found.UHID)}`, { headers });
            pat = r?.data?.data || r?.data || pat;
          } catch (_) { /* keep whatever we have */ }
        }
        const ageNow = pat?.age
          || (pat?.dateOfBirth ? Math.max(0, Math.floor((Date.now() - new Date(pat.dateOfBirth).getTime()) / (365.25 * 86400000))) : "");
        setForm(p => ({
          ...p,
          // Backend requires patient (ObjectId) and uses admissionId for
          // the upsert + finalize → discharge chain. Without these,
          // POST /discharge-summary fails Mongoose validation silently.
          patient:        pat?._id || (typeof found.patientId === "object" ? found.patientId?._id : found.patientId) || p.patient,
          admissionId:    found._id || p.admissionId,
          UHID:           found.UHID,
          patientName:    found.patientName || pat?.fullName || found.patientId?.fullName || "",
          age:            ageNow ? String(ageNow) : p.age,
          gender:         pat?.gender || found.gender || p.gender,
          contactNumber:  pat?.contactNumber || pat?.phone || found.contactNumber || p.contactNumber,
          ipdNo:          found.admissionNumber || "",
          // Date <input type="date"> needs ISO YYYY-MM-DD; the old
          // toLocaleDateString("en-IN") returned "14/05/2026" and the
          // browser silently rendered the input empty.
          admissionDate:  admDate ? admDate.toISOString().slice(0, 10) : "",
          stayDays,
          department:     found.department || p.department,
          doctorName:     found.attendingDoctor || found.attendingDoctorId?.fullName || p.doctorName,
          // R7hr-199 — attendingDoctorId refs the Doctor model, whose reg-no
          // lives at professional.registrationNumber (NOT doctorDetails.* —
          // that's the User model path the old read used, so it was always
          // blank). Keep the legacy paths as fallbacks.
          doctorRegNo:    found.attendingDoctorId?.professional?.registrationNumber
                          || found.attendingDoctorId?.doctorDetails?.registrationNumber
                          || found.attendingDoctorRegNo
                          || p.doctorRegNo,
          admittingDiagnosis: found.provisionalDiagnosis || p.admittingDiagnosis,
        }));

        /* ══ R7fj-HIGH-3 · Prefill from IPD Initial Assessment ══════
           Pull the most recent signed IPD_INITIAL DoctorNote for this
           IPD number and prefill the matching discharge fields so the
           doctor doesn't retype chief complaint / HPI / co-morbidities
           / allergies / diagnosis. Failure is non-fatal — discharge
           summary still loads if the assessment was never signed. */
        try {
          if (found.admissionNumber) {
            const r = await axios.get(
              `${API_ENDPOINTS.BASE}/doctor-notes/ipd/${encodeURIComponent(found.admissionNumber)}`,
              { headers },
            );
            const list = Array.isArray(r?.data?.data) ? r.data.data : (Array.isArray(r?.data) ? r.data : []);
            const ia = list.find(n =>
              n.visitType === "IPD_INITIAL" ||
              (n.noteType || "").toLowerCase() === "initial"
            );
            if (ia) {
              const nabh = ia?.noteDetails?.doctor?.nabh || {};
              const nrsg = ia?.noteDetails?.nursing || {};
              const dr   = ia?.noteDetails?.doctor || {};

              // Build a comorbidity string from the structured checklist
              const cmbObj = nabh.comorbidities || {};
              const cmbList = Object.entries(cmbObj)
                .filter(([k, v]) => v === true)
                .map(([k]) => k.replace(/([A-Z])/g, " $1").replace(/^./, c => c.toUpperCase()));
              if (cmbObj.other) cmbList.push(cmbObj.other);
              const comorbidities = cmbList.join(", ");

              // Allergies — prefer doctor's structured list, fall back to nurse, then to text
              const docAllergies = nabh.allergies?.list || [];
              const nrsAllergies = ia?.noteDetails?.nursingNabh?.allergies?.list || [];
              const allergyText =
                docAllergies.length
                  ? docAllergies.map(a => `${a.agent} (${a.severity})${a.reaction ? " — " + a.reaction : ""}`).join("; ")
                  : nrsAllergies.length
                    ? nrsAllergies.map(a => `${a.agent} (${a.severity})${a.reaction ? " — " + a.reaction : ""}`).join("; ")
                    : (nabh.allergies?.noKnown || ia?.noteDetails?.nursingNabh?.allergies?.noKnown
                      ? "NKDA — No Known Drug Allergies"
                      : (dr.docAllergy || nrsg.allergy || ""));

              setForm(p => ({
                ...p,
                // Only prefill if not already set (user may have typed before patient load)
                chiefComplaints:           p.chiefComplaints           || nabh.chiefComplaint || nrsg.chiefComplaint || "",
                historyOfPresentIllness:   p.historyOfPresentIllness   || dr.hopi || "",
                pastMedicalHistory:        p.pastMedicalHistory        || dr.pmh || "",
                pastSurgicalHistory:       p.pastSurgicalHistory       || dr.psh || "",
                familyHistory:             p.familyHistory             || dr.famHx || "",
                socialHistory:             p.socialHistory             || dr.socHx || "",
                comorbidities:             p.comorbidities             || comorbidities,
                allergies:                 p.allergies                 || allergyText,
                physicalExamination:       p.physicalExamination       || [dr.genExam, dr.cvs, dr.rs, dr.abdomen, dr.cns].filter(Boolean).join(" · "),
                admittingDiagnosis:        p.admittingDiagnosis        || nabh.workingDx || dr.provDx || found.provisionalDiagnosis || "",
                finalDiagnosis:            p.finalDiagnosis            || dr.finalDx || nabh.workingDx || "",
                icdCode:                   p.icdCode                   || dr.icd10 || "",
              }));
              toast.info("Discharge fields prefilled from Initial Assessment");
            }
          }
        } catch (_) { /* assessment not found / endpoint missing — silently skip */ }

        /* ══ Auto-fetch INVESTIGATIONS — lab trend sheets + imaging/path
           reports for this patient, so the doctor doesn't retype them in
           the discharge "Investigations" section. Only fills when the list
           is still empty (never clobbers manual entries / a restored draft).
           Non-fatal: discharge still loads if lab access / endpoint missing. */
        try {
          const autoInv = [];
          const narrLines = [];   // R7hr-200 — paragraph view of the same data
          const _dt = (d) => d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "";
          // Lab trend sheets → latest reading per test (rows + one narrative line per panel)
          try {
            const tr = await axios.get(`${API_ENDPOINTS.BASE}/lab-records/trends`, { params: { UHID: found.UHID }, headers });
            const trends = Array.isArray(tr?.data?.data) ? tr.data.data : (Array.isArray(tr?.data) ? tr.data : []);
            trends.forEach(panel => {
              const panelParts = [];
              let panelDate = "";
              (panel.tests || []).forEach(t => {
                const readings = (t.readings || []).slice().sort((a, b) => new Date(b.date) - new Date(a.date));
                const latest = readings.find(r => r && r.value != null && String(r.value).trim() !== "");
                if (latest) {
                  autoInv.push({ name: t.name || "", result: String(latest.value), unit: t.unit || "", status: latest.status || "" });
                  panelParts.push(`${t.name} ${latest.value}${t.unit ? " " + t.unit : ""}${latest.status ? " (" + latest.status + ")" : ""}`);
                  if (!panelDate && latest.date) panelDate = _dt(latest.date);
                }
              });
              if (panelParts.length) {
                narrLines.push(`${panel.panelName || panel.panelType || "Lab"}${panelDate ? " [" + panelDate + "]" : ""}: ${panelParts.join(", ")}.`);
              }
            });
          } catch (_) { /* no lab access / none */ }
          // Imaging / microbiology / histopath reports → impression (rows + narrative)
          try {
            const rp = await axios.get(`${API_ENDPOINTS.BASE}/lab-records/reports`, { params: { UHID: found.UHID }, headers });
            const reports = Array.isArray(rp?.data?.data) ? rp.data.data : (Array.isArray(rp?.data) ? rp.data : []);
            reports.forEach(r => {
              const res = r.impression || r.findings || r.organism || "";
              const nm = r.testName || r.reportType || "Report";
              autoInv.push({ name: nm, result: res, unit: "", status: "" });
              if (res || nm) narrLines.push(`${nm}${r.reportDate ? " [" + _dt(r.reportDate) + "]" : ""}: ${res || "—"}.`);
            });
          } catch (_) { /* no report access / none */ }
          if (autoInv.length) setInvestigations(prev => (prev && prev.length) ? prev : autoInv);
          // Fill the narrative paragraph only when the doctor hasn't typed one
          // / a draft hasn't restored it — never clobber existing text.
          if (narrLines.length) {
            const narrative = narrLines.join("\n");
            setForm(p => ({ ...p, keyInvestigationsText: (p.keyInvestigationsText && p.keyInvestigationsText.trim()) ? p.keyInvestigationsText : narrative }));
          }
        } catch (_) { /* silently skip */ }

        /* ══ Auto-fetch PROCEDURE notes for this admission → discharge
           "Procedures" section. Same guard: only when the list is empty. */
        try {
          const pr = await axios.get(`${API_ENDPOINTS.BASE}/procedure-notes`, { params: { admissionId: found._id, UHID: found.UHID }, headers });
          const pnotes = Array.isArray(pr?.data?.data) ? pr.data.data : (Array.isArray(pr?.data) ? pr.data : []);
          if (pnotes.length) {
            const autoProc = pnotes.map(pn => ({
              name:          pn.surgeryName || (pn.actualProcedure ? String(pn.actualProcedure).slice(0, 90) : "Procedure"),
              date:          pn.startTime ? new Date(pn.startTime).toISOString().slice(0, 10) : "",
              surgeon:       pn.surgeon || pn.surgeonName || "",
              findings:      pn.actualProcedure || "",
              complications: pn.complications || "",
            }));
            setProcedures(prev => (prev && prev.length) ? prev : autoProc);
          }
        } catch (_) { /* no procedure access / none — silently skip */ }

        // Restore auto-save draft if available
        const dKey = `sphere_draft_discharge_${found._id}`;
        const raw = localStorage.getItem(dKey);
        if (raw) {
          try {
            const { data } = JSON.parse(raw);
            if (data) {
              if (data.form)           setForm(p => ({ ...p, ...data.form }));
              if (data.medications)    setMedications(data.medications);
              if (data.investigations) setInvestigations(data.investigations);
              if (data.procedures)     setProcedures(data.procedures);
              toast.info("Draft restored", { autoClose: 2000 });
            }
          } catch { /* ignore */ }
        }
        toast.success("Patient loaded");
      } else {
        toast.warn("No active admission found");
      }
    } catch { toast.error("Search failed"); }
    finally { setSearching(false); }
  };

  const calcStayDays = () => {
    if (form.admissionDate && form.dischargeDate) {
      const a = new Date(form.admissionDate), d = new Date(form.dischargeDate);
      const diff = Math.ceil((d - a) / 86400000);
      if (diff >= 0) setForm(p => ({ ...p, stayDays: diff }));
    }
  };
  useEffect(calcStayDays, [form.admissionDate, form.dischargeDate]);

  const addMed = () => setMedications(p => [...p, { drug: "", dose: "", route: "Oral", frequency: "OD", duration: "", instructions: "" }]);
  const updateMed = (idx, field, val) => setMedications(p => p.map((m, i) => i === idx ? { ...m, [field]: val } : m));
  const removeMed = (idx) => setMedications(p => p.filter((_, i) => i !== idx));

  const addInv = () => setInvestigations(p => [...p, { name: "", result: "", unit: "", status: "" }]);
  const updateInv = (idx, field, val) => setInvestigations(p => p.map((m, i) => i === idx ? { ...m, [field]: val } : m));
  const removeInv = (idx) => setInvestigations(p => p.filter((_, i) => i !== idx));

  const addProc = () => setProcedures(p => [...p, { name: "", date: "", surgeon: "", findings: "", complications: "" }]);
  const updateProc = (idx, field, val) => setProcedures(p => p.map((m, i) => i === idx ? { ...m, [field]: val } : m));
  const removeProc = (idx) => setProcedures(p => p.filter((_, i) => i !== idx));

  const upd = (field) => (e) => setForm(p => ({ ...p, [field]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  const openPrint = () => setPrintData({ ...form, medications, investigations, procedures });

  const [lastSavedId, setLastSavedId] = useState(null);
  const [finalizing, setFinalizing]   = useState(false);

  const handleSave = async () => {
    if (!form.UHID) { toast.warn("Load a patient first"); return; }
    // The backend's DischargeSummary schema marks `patient` as required.
    // If the doctor typed a UHID that isn't an active IPD admission, the
    // search above silently left form.patient null — surface that here
    // with a meaningful message instead of letting the POST 400 with a
    // bare "Save failed" toast.
    if (!form.patient) {
      toast.error("This UHID has no active IPD admission — load an admitted patient first");
      return;
    }
    setSaving(true);
    try {
      const payload = { ...form, deptTemplate: selectedDept?.key, medications, investigations, procedures };
      const r = await axios.post(API, payload, { headers });
      // Capture the freshly-created summary _id so the Finalize button
      // knows which document to flip + which admission to discharge.
      const newId = r?.data?.data?._id || r?.data?._id || null;
      if (newId) setLastSavedId(newId);
      toast.success("Discharge summary saved as DRAFT — click Finalize to discharge");
      clearDraft();
      openPrint();
    } catch (err) {
      if (err.response?.status === 404 || err.response?.status === 405) {
        toast.success("Summary saved (preview mode)");
        clearDraft();
        openPrint();
      } else {
        // Surface the backend's validation message verbatim so the doctor
        // sees exactly which field is missing (e.g. "Path `patient` is
        // required") instead of the generic "Save failed".
        const msg = err.response?.data?.message
          || err.response?.data?.errors?.[0]?.message
          || err.message
          || "Save failed";
        toast.error(msg);
        // Dev-only — log the full error to console so we can debug
        // future schema-mismatch issues quickly.
        console.error("[DischargeSummary] save failed:", err.response?.data || err);
      }
    } finally { setSaving(false); }
  };

  // FIX (audit P17): the Finalize button was missing. Without it, the
  // admission stayed "Admitted" forever and the bed was never released.
  // This calls PATCH /api/discharge-summary/:id/finalize which the
  // backend now wires through to:
  //   • DischargeSummary.status = "finalized"
  //   • Admission.status        = "Discharged"
  //   • Bed.status               = "Available" (with patient/currentAdmission cleared)
  const handleFinalize = async () => {
    if (!lastSavedId) {
      toast.warn("Save the summary as a draft first, then click Finalize");
      return;
    }
    // R7hr-197: finalize now ONLY locks the summary + sends the patient to
    // the reception discharge queue. The doctor does NOT free the bed —
    // reception clears the bill, then clears the bed (actual release).
    if (!(await confirm({
      title: "Finalize discharge summary?",
      body: "This locks the summary against edits and sends the patient to the Reception discharge queue (bill clearance → bed release). The bed is NOT freed yet — reception does that after the bill is settled.",
      danger: true,
      confirmLabel: "Finalize & send to billing",
    }))) return;

    setFinalizing(true);
    try {
      const finalizedByName = user?.fullName || form.doctorName || "Doctor";
      await axios.patch(`${API}/${lastSavedId}/finalize`, { finalizedByName }, { headers });
      toast.success("Discharge summary finalized — patient sent to Reception discharge queue");
      // Stay on the page in read-only "finalized" mode; the user can still print
    } catch (err) {
      toast.error(err.response?.data?.message || "Finalize failed");
    } finally { setFinalizing(false); }
  };

  const color = selectedDept?.color || C.blue;

  return (
    <div style={{ fontFamily: "'DM Sans', sans-serif", minHeight: "100vh" }}>

      {printData && <PrintModal data={printData} dept={selectedDept} onClose={() => setPrintData(null)} />}

      {/* ── Header ── */}
      <div style={{ background: C.card, borderRadius: 12, padding: "14px 20px", marginBottom: 14, border: "1.5px solid #6366f130", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: "#eff6ff", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <i className="pi pi-sign-out" style={{ fontSize: 18, color: C.blue }} />
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16, color: C.text }}>Discharge Summary</div>
            <div style={{ fontSize: 11, color: C.muted }}>NABH COP.7 — Modular Department Templates</div>
          </div>
          <span style={{ background: "#f5f3ff", color: "#7c3aed", border: "1px solid #c4b5fd", fontSize: 10, fontWeight: 700, padding: "3px 9px", borderRadius: 5 }}>NABH</span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {view === "form" && (
            <>
              <AutoSaveIndicator savedAt={savedAt} hasDraft={hasDraft} />
              <button onClick={() => setShowSetup(true)}
                style={{ padding:"6px 11px", background: signature ? "#f0fdf4" : "#fffbeb", border:`1.5px solid ${signature ? "#bbf7d0" : "#fde68a"}`, borderRadius:8, cursor:"pointer", fontSize:11, fontWeight:700, color: signature ? "#16a34a" : "#92400e", display:"flex", alignItems:"center", gap:4 }}>
                {signature ? <><i className="pi pi-verified" style={{ fontSize:10 }} /> Sig Set</> : <><i className="pi pi-pen-to-square" style={{ fontSize:10 }} /> Setup Sig</>}
              </button>
              <button onClick={() => setView("catalogue")} style={{ padding: "7px 14px", borderRadius: 8, border: `1px solid ${C.border}`, background: "white", cursor: "pointer", fontSize: 12, color: C.muted, fontWeight: 600 }}>
                <i className="pi pi-arrow-left" style={{ marginRight: 5 }} />Departments
              </button>
              <button onClick={openPrint} style={{ padding: "7px 14px", borderRadius: 8, border: "none", background: "#eff6ff", color: C.blue, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
                <i className="pi pi-eye" style={{ marginRight: 5 }} />Preview
              </button>
              <button onClick={handleSave} disabled={saving} style={{ padding: "7px 18px", borderRadius: 8, border: "none", background: saving ? C.muted : color, color: "white", cursor: saving ? "not-allowed" : "pointer", fontSize: 12, fontWeight: 700 }}>
                {saving ? "Saving…" : <><i className="pi pi-save" style={{ marginRight: 5 }} />Save & Print</>}
              </button>
            </>
          )}
        </div>
      </div>

      {/* ══ Patient identity card ────────────────────────────────────────
         Two states:
           • EMPTY  — full-width search bar to load a patient by UHID
           • LOADED — gradient hero card showing patient avatar, name,
                      key facts, with a "change patient" toggle that
                      flips back to the search bar.
      ═══════════════════════════════════════════════════════════════════ */}
      {!patInfo ? (
        <div style={{
          background: C.card, borderRadius: 12, padding: "14px 18px",
          marginBottom: 14, border: `1.5px solid ${C.border}`,
          display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
        }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8, background: "#eff6ff",
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0,
          }}>
            <i className="pi pi-search" style={{ color: C.blue, fontSize: 14 }} />
          </div>
          <input value={uhid} onChange={e => setUhid(e.target.value)}
            onKeyDown={e => e.key === "Enter" && searchPatient()}
            className="his-field" style={{ flex: 1, minWidth: 220 }}
            placeholder="Enter UHID / Admission No. to load patient…" />
          <button id="ds-load-btn" onClick={searchPatient} disabled={searching}
            style={{
              padding: "9px 22px", borderRadius: 8, border: "none",
              background: searching ? C.muted : C.blue, color: "white",
              fontWeight: 700, fontSize: 12, cursor: "pointer",
            }}>
            {searching ? "Searching…" : <><i className="pi pi-arrow-circle-right" style={{ marginRight: 6 }} />Load Patient</>}
          </button>
        </div>
      ) : (
        <div style={{
          background: "linear-gradient(135deg,#1e40af,#0e7490)",
          borderRadius: 12, padding: "14px 18px", marginBottom: 14,
          display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap",
          color: "#fff", boxShadow: "0 4px 14px rgba(30,64,175,.25)",
        }}>
          {/* Avatar initial */}
          <div style={{
            width: 50, height: 50, borderRadius: "50%",
            background: "rgba(255,255,255,.2)", border: "2px solid rgba(255,255,255,.35)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 20, fontWeight: 800, flexShrink: 0,
          }}>
            {(form.patientName || "?").trim().charAt(0).toUpperCase()}
          </div>

          {/* Name + key facts */}
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: "-.2px" }}>
              {form.patientName || "—"}
            </div>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 4, fontSize: 11.5, opacity: .92 }}>
              <span><b style={{ opacity: .75 }}>UHID</b> · {form.UHID}</span>
              <span><b style={{ opacity: .75 }}>IPD</b> · {form.ipdNo || "—"}</span>
              {(form.age || form.gender) && (
                <span><b style={{ opacity: .75 }}>Age/Sex</b> · {[form.age && `${form.age}Y`, form.gender].filter(Boolean).join(" / ") || "—"}</span>
              )}
              <span><b style={{ opacity: .75 }}>Stay</b> · {form.stayDays ? `${form.stayDays} days` : "—"}</span>
              {form.doctorName && <span><b style={{ opacity: .75 }}>Doctor</b> · {form.doctorName}</span>}
              {workflowCtx?.bedNumber && <span><b style={{ opacity: .75 }}>Bed</b> · {workflowCtx.bedNumber}</span>}
            </div>
          </div>

          {/* Change patient */}
          <button
            onClick={() => { setPatInfo(null); setUhid(""); }}
            style={{
              padding: "8px 14px", borderRadius: 8,
              background: "rgba(255,255,255,.15)", border: "1.5px solid rgba(255,255,255,.3)",
              color: "#fff", fontWeight: 700, fontSize: 11.5,
              cursor: "pointer", display: "flex", alignItems: "center", gap: 6,
            }}>
            <i className="pi pi-refresh" style={{ fontSize: 11 }} />
            Change
          </button>
        </div>
      )}

      {/* ══ Discharge workflow strip — compact horizontal pipeline ════════
         4 steps: Doctor → Nurse → Reception → Finalize. Each pill is
         clickable (when applicable). Step 1 turns green on Save, gating
         Step 4 (Finalize) which actually flips the admission.
      ═══════════════════════════════════════════════════════════════════ */}
      {patInfo && (() => {
        const done1 = !!lastSavedId;
        const STEP_COLORS = {
          doctor:    { bg: "#2563eb", soft: "#eff6ff", border: "#bfdbfe" },
          nurse:     { bg: "#db2777", soft: "#fdf2f8", border: "#fbcfe8" },
          reception: { bg: "#0891b2", soft: "#ecfeff", border: "#a5f3fc" },
          finalize:  { bg: "#15803d", soft: "#f0fdf4", border: "#86efac" },
          done:      { bg: "#16a34a", soft: "#dcfce7", border: "#86efac" },
        };
        const Pill = ({ n, role, label, sub, isDone, isActive, onClick, disabled }) => {
          const c = isDone ? STEP_COLORS.done : STEP_COLORS[role];
          return (
            <div onClick={!disabled && onClick ? onClick : undefined}
              style={{
                flex: "1 1 220px",
                background: isDone || isActive ? c.soft : "#f8fafc",
                border: `1.5px solid ${isDone || isActive ? c.border : "#e2e8f0"}`,
                borderRadius: 10,
                padding: "10px 12px",
                display: "flex", alignItems: "center", gap: 10,
                cursor: disabled ? "not-allowed" : (onClick ? "pointer" : "default"),
                opacity: disabled && !isDone ? 0.6 : 1,
                transition: "transform .15s, box-shadow .15s",
                position: "relative",
              }}
              onMouseEnter={(e) => { if (!disabled && onClick) e.currentTarget.style.boxShadow = "0 4px 14px rgba(0,0,0,.08)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.boxShadow = "none"; }}
            >
              <div style={{
                width: 28, height: 28, borderRadius: "50%",
                background: c.bg, color: "#fff",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontWeight: 800, fontSize: 12, flexShrink: 0,
              }}>
                {isDone ? <i className="pi pi-check" style={{ fontSize: 12 }} /> : n}
              </div>
              <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
                <div style={{ fontSize: 11.5, fontWeight: 800, color: "#0f172a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {label}
                </div>
                <div style={{ fontSize: 10, color: "#64748b", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {sub}
                </div>
              </div>
              {onClick && !disabled && (
                <i className="pi pi-arrow-right" style={{ fontSize: 10, color: c.bg, flexShrink: 0 }} />
              )}
            </div>
          );
        };

        return (
          <div style={{
            background: "white",
            border: "1px solid #e2e8f0", borderRadius: 12,
            padding: "10px 14px", marginBottom: 14,
            display: "flex", alignItems: "center", gap: 10,
            boxShadow: "0 1px 3px rgba(0,0,0,.04)",
          }}>
            <div style={{
              display: "flex", flexDirection: "column", alignItems: "center",
              gap: 1, paddingRight: 12, borderRight: "1px solid #e2e8f0",
              minWidth: 90,
            }}>
              <i className="pi pi-list" style={{ color: "#475569", fontSize: 13 }} />
              <div style={{ fontSize: 9.5, fontWeight: 800, color: "#475569", textTransform: "uppercase", letterSpacing: ".4px" }}>
                Workflow
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flex: 1, flexWrap: "wrap" }}>
              <Pill n={1} role="doctor"
                label="Discharge summary"
                sub={done1 ? "Saved · DRAFT" : "Fill below + Save"}
                isDone={done1} isActive={!done1} />
              <Pill n={2} role="nurse"
                label="Nursing note"
                sub="Hand-off + advice"
                isActive={done1}
                disabled={!form.UHID}
                onClick={() => { window.location.href = `/nursing-notes?uhid=${encodeURIComponent(form.UHID)}&mode=discharge`; }} />
              <Pill n={3} role="reception"
                label="Final payment"
                sub="TPA / cash settlement"
                isActive={done1}
                disabled={!form.UHID}
                onClick={() => { window.location.href = `/discharge-queue?uhid=${encodeURIComponent(form.UHID)}`; }} />
              <Pill n={4} role="finalize"
                label="Finalize & send to billing"
                sub={done1 ? "Locks summary → reception queue" : "Save first"}
                isActive={done1}
                disabled={!lastSavedId || finalizing || saving}
                onClick={handleFinalize} />
            </div>
          </div>
        );
      })()}

      {/* ══ CATALOGUE ══ */}
      {view === "catalogue" && (
        <div style={{ background: C.card, borderRadius: 12, padding: "18px", border: `1.5px solid ${C.border}` }}>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: C.text, marginBottom: 3 }}>Select Department Template</div>
            <div style={{ fontSize: 12, color: C.muted }}>Each template comes pre-loaded with relevant investigations, common medications, department-specific sections, and NABH-compliant advice</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12 }}>
            {DEPT_TEMPLATES.map(d => <DeptCard key={d.key} dept={d} selected={selectedDept} onSelect={handleDeptSelect} />)}
          </div>
        </div>
      )}

      {/* ══ FORM ══ */}
      {view === "form" && selectedDept && (
        <div>
          {/* Dept banner — gradient hero strip with template stats */}
          <div style={{
            background: `linear-gradient(135deg, ${selectedDept.color}, ${hexShade(selectedDept.color, -40)})`,
            borderRadius: 14,
            padding: "16px 22px",
            marginBottom: 18,
            display: "flex",
            alignItems: "center",
            gap: 16,
            color: "#fff",
            boxShadow: `0 4px 16px ${hexA(selectedDept.color, 0.3)}`,
            flexWrap: "wrap",
          }}>
            <span style={{
              width: 48, height: 48, borderRadius: 12,
              background: "rgba(255,255,255,.22)",
              border: "1.5px solid rgba(255,255,255,.35)",
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0,
            }}>
              <i className={`pi ${selectedDept.icon}`} style={{ fontSize: 22, color: "#fff" }} />
            </span>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontWeight: 800, fontSize: 17, letterSpacing: "-.2px" }}>
                {selectedDept.label} <span style={{ opacity: .85, fontWeight: 600 }}>· Discharge Summary</span>
              </div>
              <div style={{ fontSize: 11.5, opacity: .85, marginTop: 3, display: "flex", gap: 12, flexWrap: "wrap" }}>
                <span><i className="pi pi-verified" style={{ fontSize: 10, marginRight: 4 }} />NABH COP.7</span>
                <span>·</span>
                <span>{selectedDept.template.investigations?.length || 0} investigations</span>
                <span>·</span>
                <span>{selectedDept.template.medications?.length || 0} medications</span>
                <span>·</span>
                <span>{selectedDept.template.procedures?.length || 0} procedures pre-loaded</span>
              </div>
            </div>
            <button
              onClick={() => setView("catalogue")}
              style={{
                padding: "9px 16px", borderRadius: 8,
                background: "rgba(255,255,255,.18)",
                border: "1.5px solid rgba(255,255,255,.3)",
                color: "#fff", fontWeight: 700, fontSize: 12,
                cursor: "pointer", display: "flex", alignItems: "center", gap: 6,
              }}
            >
              <i className="pi pi-th-large" style={{ fontSize: 11 }} />
              Change template
            </button>
          </div>

          {/* Patient Details */}
          <Section title="Patient Details" icon="pi-user" color={color} nabh>
            <G4>
              <F label="UHID" required>
                <div style={{ display: "flex", gap: 6 }}>
                  <input className="his-field" style={{ flex: 1 }} value={form.UHID} onChange={upd("UHID")} />
                  <button onClick={searchPatient} style={{ padding: "8px 10px", borderRadius: 7, border: "none", background: color, color: "white", cursor: "pointer" }}>
                    <i className="pi pi-search" />
                  </button>
                </div>
              </F>
              <F label="Patient Name" required><input className="his-field" value={form.patientName} onChange={upd("patientName")} /></F>
              <F label="Age"><input className="his-field" value={form.age} onChange={upd("age")} placeholder="e.g. 45 years" /></F>
              <F label="Gender">
                <select className="his-select" value={form.gender} onChange={upd("gender")}>
                  <option value="">Select</option>
                  {["Male","Female","Other"].map(g => <option key={g}>{g}</option>)}
                </select>
              </F>
              <F label="Contact Number"><input className="his-field" value={form.contactNumber} onChange={upd("contactNumber")} /></F>
              <F label="IPD Number"><input className="his-field" value={form.ipdNo} onChange={upd("ipdNo")} /></F>
              <F label="Admission Date"><input className="his-field" type="date" value={form.admissionDate} onChange={upd("admissionDate")} /></F>
              <F label="Discharge Date"><input className="his-field" type="date" value={form.dischargeDate} onChange={upd("dischargeDate")} /></F>
              <F label="Duration of Stay"><input className="his-field" style={{ background: "#f8fafc", fontWeight: 700 }} value={form.stayDays ? `${form.stayDays} days` : ""} readOnly /></F>
              <F label="Consultant / Doctor" required><input className="his-field" value={form.doctorName} onChange={upd("doctorName")} /></F>
              <F label="Reg. No."><input className="his-field" value={form.doctorRegNo} onChange={upd("doctorRegNo")} /></F>
              <F label="Condition on Discharge">
                <select className="his-select" value={form.conditionOnDischarge} onChange={upd("conditionOnDischarge")}>
                  {["Stable","Improved","Unchanged","Deteriorated","Critical","LAMA","Expired"].map(c => <option key={c}>{c}</option>)}
                </select>
              </F>
              {/* R7hr-197 — disposition / discharge mode. This is the doctor's
                  clinical choice; the receptionist's bed-clear step executes it
                  and the matching NABH register (LAMA / Mortality) auto-fires. */}
              <F label="Discharge Type" required>
                <select className="his-select" value={form.dischargeType || "Routine"} onChange={upd("dischargeType")}>
                  {["Routine","LAMA","DAMA","Absconded","Referral","Death"].map(c => <option key={c}>{c}</option>)}
                </select>
              </F>
            </G4>
            <div style={{ marginTop: 12 }}>
              <F label="Co-consultants">
                <input className="his-field" value={form.consultants} onChange={upd("consultants")} placeholder="e.g. Dr. Sharma (Cardiology), Dr. Gupta (Nephrology)" />
              </F>
            </div>
          </Section>

          {/* Diagnosis */}
          <Section title="Diagnosis" icon="pi-file-check" color={color} nabh>
            <G2>
              <F label="Admitting / Provisional Diagnosis" required>
                <textarea className="his-textarea" value={form.admittingDiagnosis} onChange={upd("admittingDiagnosis")}
                  placeholder={selectedDept.template.admissionReasonPrompt} />
              </F>
              <F label="Final Diagnosis (Discharge)" required>
                <textarea className="his-textarea" value={form.finalDiagnosis} onChange={upd("finalDiagnosis")}
                  placeholder={selectedDept.template.dischargeDiagnosisPrompt} />
              </F>
            </G2>
            <G2 gap={12}>
              <F label="ICD-10 Code"><input className="his-field" value={form.icdCode} onChange={upd("icdCode")} placeholder="e.g. J18.0, I21.1" /></F>
              <F label="Co-morbidities / Background History">
                <input className="his-field" value={form.comorbidities} onChange={upd("comorbidities")} placeholder="e.g. T2DM, HTN, CKD Stage 3" />
              </F>
            </G2>
          </Section>

          {/* History & Course */}
          <Section title="Clinical Summary" icon="pi-book" color={color} nabh>
            <F label="History of Presenting Illness">
              <textarea className="his-textarea" style={{ minHeight: 90 }} value={form.historyOfPresentIllness} onChange={upd("historyOfPresentIllness")}
                placeholder={selectedDept.template.admissionReasonPrompt} />
            </F>
            <div style={{ marginTop: 12 }}>
              <F label="Hospital Course & Treatment" required>
                <textarea className="his-textarea" style={{ minHeight: 110 }} value={form.courseInHospital} onChange={upd("courseInHospital")}
                  placeholder={selectedDept.template.coursePrompt} />
              </F>
            </div>
            <div style={{ marginTop: 12 }}>
              <F label="Significant Clinical Findings">
                <textarea className="his-textarea" value={form.significantFindings} onChange={upd("significantFindings")}
                  placeholder="Vitals at discharge, notable examination findings…" />
              </F>
            </div>
          </Section>

          {/* Department-specific sections */}
          {(selectedDept.key === "SURGERY" || selectedDept.key === "GYNAECOLOGY" || selectedDept.key === "ORTHOPAEDICS") && (
            <Section title="Operative Details" icon="pi-wrench" color={color}>
              <G3>
                <F label="Procedure Performed">
                  <input className="his-field" value={form.operativeProcedure} onChange={upd("operativeProcedure")} placeholder="e.g. Laparoscopic Appendicectomy" />
                </F>
                <F label="Type of Anaesthesia">
                  <select className="his-select" value={form.anaesthesiaType} onChange={upd("anaesthesiaType")}>
                    <option value="">Select</option>
                    {["General Anaesthesia","Spinal Anaesthesia","Epidural","Local Anaesthesia","MAC/Sedation"].map(a => <option key={a}>{a}</option>)}
                  </select>
                </F>
                <F label="Operative Findings">
                  <input className="his-field" value={form.operativeFindings} onChange={upd("operativeFindings")} placeholder="Key intraoperative findings" />
                </F>
              </G3>
              {selectedDept.key === "ORTHOPAEDICS" && (
                <div style={{ marginTop: 10 }}>
                  <F label="Implant / Hardware Details">
                    <input className="his-field" value={form.implantDetails} onChange={upd("implantDetails")} placeholder="e.g. Titanium IM nail 10x380mm, DHS 135° — Lot No. XYZ123" />
                  </F>
                </div>
              )}
            </Section>
          )}

          {selectedDept.key === "GYNAECOLOGY" && (
            <Section title="Obstetric / Neonatal Details" icon="pi-heart-fill" color={color}>
              <G3>
                <F label="Mode of Delivery">
                  <select className="his-select" value={form.deliveryType} onChange={upd("deliveryType")}>
                    <option value="">Select</option>
                    {["Normal Vaginal Delivery","LSCS","Forceps Delivery","Vacuum Delivery","Pre-term","IUFD"].map(d => <option key={d}>{d}</option>)}
                  </select>
                </F>
                <F label="Baby Details">
                  <input className="his-field" value={form.babyDetails} onChange={upd("babyDetails")} placeholder="e.g. Live male, 3.1 kg, APGAR 9/10, full term" />
                </F>
                <F label="Neonatal Notes">
                  <input className="his-field" value={form.neonatalNotes} onChange={upd("neonatalNotes")} placeholder="NICU admission, jaundice, feeding…" />
                </F>
              </G3>
            </Section>
          )}

          {selectedDept.key === "PAEDIATRICS" && (
            <Section title="Growth & Immunisation" icon="pi-chart-bar" color={color}>
              <G3>
                <F label="Weight / Height / Head Circumference">
                  <input className="his-field" value={form.growthPercentile} onChange={upd("growthPercentile")} placeholder="e.g. Wt 15kg (50th %ile), Ht 95cm" />
                </F>
                <F label="Immunisation Given During Admission">
                  <input className="his-field" value={form.immunisationGiven} onChange={upd("immunisationGiven")} placeholder="e.g. OPV dose 2, Vitamin A" />
                </F>
              </G3>
            </Section>
          )}

          {selectedDept.key === "CARDIOLOGY" && (
            <Section title="Cardiac Investigations" icon="pi-chart-line" color={color}>
              <G3>
                <F label="Echocardiogram EF (%)">
                  <input className="his-field" value={form.echoEF} onChange={upd("echoEF")} placeholder="e.g. 45%" />
                </F>
                <F label="ECG on Discharge">
                  <input className="his-field" value={form.ecgOnDischarge} onChange={upd("ecgOnDischarge")} placeholder="e.g. Sinus rhythm, no ST changes" />
                </F>
              </G3>
            </Section>
          )}

          {selectedDept.key === "NEUROLOGY" && (
            <Section title="Neurological Status" icon="pi-bolt" color={color}>
              <G3>
                <F label="Stroke Type / EEG Findings">
                  <input className="his-field" value={form.strokeType} onChange={upd("strokeType")} placeholder="e.g. Ischaemic Stroke, MCA territory" />
                </F>
                <F label="NIHSS / GCS on Discharge">
                  <input className="his-field" value={form.nihssOnDischarge} onChange={upd("nihssOnDischarge")} placeholder="e.g. NIHSS 4, GCS 14" />
                </F>
              </G3>
            </Section>
          )}

          {selectedDept.key === "ONCOLOGY" && (
            <Section title="Oncology Details" icon="pi-filter" color={color}>
              <G3>
                <F label="Tumour / Disease Stage">
                  <input className="his-field" value={form.tumorStage} onChange={upd("tumorStage")} placeholder="e.g. Stage IIIA, cT3N1M0" />
                </F>
                <F label="Next Chemo / OPD Date">
                  <input className="his-field" type="date" value={form.nextChemoDate} onChange={upd("nextChemoDate")} />
                </F>
              </G3>
            </Section>
          )}

          {/* Investigations */}
          <Section title="Key Investigations" icon="pi-list" color={color} nabh
            sub={`${investigations.length} investigation${investigations.length === 1 ? "" : "s"} recorded`}
            badge={investigations.length ? `${investigations.length}` : null}>
            {/* R7hr-200 — paragraph summary auto-filled from the patient's
                manual lab trends + imaging/path reports, so the doctor doesn't
                retype and the page saves as a narrative. Editable; the
                structured rows below stay available for fine-tuning. */}
            <div style={{ marginBottom: 12 }}>
              <label className="his-label" style={{ display: "block", marginBottom: 4 }}>
                Investigations Summary (auto-filled from recorded lab &amp; imaging reports — editable)
              </label>
              <textarea className="his-textarea" rows={5} value={form.keyInvestigationsText}
                onChange={upd("keyInvestigationsText")}
                placeholder="Auto-fills from this patient's recorded lab trends and imaging/pathology reports. Edit as needed." />
            </div>
            <TableShell cols={INV_COLS} color={color}
              empty={investigations.length === 0 ? "No structured rows — the summary above covers recorded reports; click Add for extra rows." : null}>
              {investigations.map((inv, idx) => (
                <InvRow key={idx} inv={inv} idx={idx} color={color} onChange={updateInv} onRemove={removeInv} />
              ))}
            </TableShell>
            <button onClick={addInv} style={{
              padding: "10px 18px", borderRadius: 8,
              border: `1.5px dashed ${hexA(color, 0.4)}`,
              background: hexA(color, 0.04), color,
              fontWeight: 700, fontSize: 12, cursor: "pointer",
              marginTop: 12, transition: "all .15s",
              display: "inline-flex", alignItems: "center", gap: 7,
            }}
              onMouseEnter={e => { e.currentTarget.style.background = hexA(color, 0.1); e.currentTarget.style.borderStyle = "solid"; }}
              onMouseLeave={e => { e.currentTarget.style.background = hexA(color, 0.04); e.currentTarget.style.borderStyle = "dashed"; }}>
              <i className="pi pi-plus" style={{ fontSize: 10 }} />Add Investigation
            </button>
          </Section>

          {/* Procedures */}
          <Section title="Procedures Performed" icon="pi-cog" color={color}
            sub={`${procedures.length} procedure${procedures.length === 1 ? "" : "s"} during stay`}
            badge={procedures.length ? `${procedures.length}` : null}
            defaultOpen={procedures.length > 0}>
            <TableShell cols={PROC_COLS} color={color}
              empty={procedures.length === 0 ? "No procedures performed during stay." : null}>
              {procedures.map((proc, idx) => (
                <ProcRow key={idx} proc={proc} idx={idx} onChange={updateProc} onRemove={removeProc} />
              ))}
            </TableShell>
            <button onClick={addProc} style={{
              padding: "10px 18px", borderRadius: 8,
              border: `1.5px dashed ${hexA(color, 0.4)}`,
              background: hexA(color, 0.04), color,
              fontWeight: 700, fontSize: 12, cursor: "pointer",
              marginTop: 12, display: "inline-flex", alignItems: "center", gap: 7,
            }}>
              <i className="pi pi-plus" style={{ fontSize: 10 }} />Add Procedure
            </button>
          </Section>

          {/* Discharge Medications */}
          <Section title="Discharge Medications" icon="pi-box" color={color} nabh
            sub={`${medications.length} medication${medications.length === 1 ? "" : "s"} prescribed on discharge`}
            badge={medications.length ? `${medications.length}` : null}>
            <TableShell cols={MED_COLS} color={color}
              empty={medications.length === 0 ? "No discharge medications yet — click Add to start." : null}>
              {medications.map((med, idx) => (
                <MedRow key={idx} med={med} idx={idx} color={color} onChange={updateMed} onRemove={removeMed} />
              ))}
            </TableShell>
            <button onClick={addMed} style={{
              padding: "10px 18px", borderRadius: 8,
              border: `1.5px dashed ${hexA(color, 0.4)}`,
              background: hexA(color, 0.04), color,
              fontWeight: 700, fontSize: 12, cursor: "pointer",
              marginTop: 12, display: "inline-flex", alignItems: "center", gap: 7,
            }}>
              <i className="pi pi-plus" style={{ fontSize: 10 }} />Add Medication
            </button>
          </Section>

          {/* Discharge Advice */}
          <Section title="Discharge Advice" icon="pi-info-circle" color={color} nabh>
            <G2>
              <F label="Diet Advice">
                <textarea className="his-textarea" value={form.dietAdvice} onChange={upd("dietAdvice")} />
              </F>
              <F label="Activity / Exercise Advice">
                <textarea className="his-textarea" value={form.activityAdvice} onChange={upd("activityAdvice")} />
              </F>
              {(selectedDept.key === "SURGERY" || selectedDept.key === "GYNAECOLOGY" || selectedDept.key === "ORTHOPAEDICS") && (
                <F label="Wound Care Instructions">
                  <textarea className="his-textarea" value={form.woundCare} onChange={upd("woundCare")} placeholder="Dressing frequency, signs of infection to watch…" />
                </F>
              )}
              <F label="Special Instructions">
                <textarea className="his-textarea" value={form.specialInstructions} onChange={upd("specialInstructions")}
                  placeholder={selectedDept.template.specialInstructionsPrompt} />
              </F>
            </G2>
          </Section>

          {/* Follow-up */}
          <Section title="Follow-up Instructions" icon="pi-calendar" color={color} nabh>
            <G4>
              <F label="Follow-up Required">
                <div style={{ display: "flex", gap: 12, marginTop: 6 }}>
                  {["Yes","No"].map(v => (
                    <label key={v} style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer", fontSize: 13, fontWeight: form.followUpRequired === (v === "Yes") ? 700 : 400, color: form.followUpRequired === (v === "Yes") ? color : C.muted }}>
                      <input type="radio" name="fu" checked={form.followUpRequired === (v === "Yes")}
                        onChange={() => setForm(p => ({ ...p, followUpRequired: v === "Yes" }))} style={{ accentColor: color }} />
                      {v}
                    </label>
                  ))}
                </div>
              </F>
              <F label="Follow-up Date"><input className="his-field" type="date" value={form.followUpDate} onChange={upd("followUpDate")} /></F>
              <F label="Follow-up Doctor"><input className="his-field" value={form.followUpDoctor} onChange={upd("followUpDoctor")} /></F>
              <F label="Department / OPD"><input className="his-field" value={form.followUpDepartment} onChange={upd("followUpDepartment")} /></F>
            </G4>
            <div style={{ marginTop: 12 }}>
              <F label="Follow-up Instructions">
                <input className="his-field" value={form.followUpInstructions} onChange={upd("followUpInstructions")}
                  placeholder="e.g. Fasting blood sugar on follow-up. Bring all reports." />
              </F>
            </div>
          </Section>

          {/* Emergency Warnings */}
          <Section title="Emergency Warning Signs" icon="pi-exclamation-triangle" color={C.red} nabh>
            <div style={{ background: "#fef9ec", border: "1px solid #fcd34d", borderRadius: 8, padding: "8px 12px", marginBottom: 10, fontSize: 12, color: C.amber }}>
              <i className="pi pi-info-circle" style={{ marginRight: 6 }} />
              NABH requirement: Patients must be informed of warning signs that require immediate emergency care.
            </div>
            <F label="When to Return to Emergency">
              <textarea className="his-textarea" style={{ minHeight: 90 }} value={form.emergencyWarnings} onChange={upd("emergencyWarnings")} />
            </F>
          </Section>

          {/* Bottom bar */}
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginTop: 4, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <AutoSaveIndicator savedAt={savedAt} hasDraft={hasDraft} />
              <button onClick={() => setShowSetup(true)}
                style={{ padding:"7px 12px", background: signature ? "#f0fdf4" : "#fffbeb", border:`1.5px solid ${signature ? "#bbf7d0" : "#fde68a"}`, borderRadius:8, cursor:"pointer", fontSize:11, fontWeight:700, color: signature ? "#16a34a" : "#92400e", display:"flex", alignItems:"center", gap:5 }}>
                {signature ? <><i className="pi pi-verified" /> Signature Set</> : <><i className="pi pi-pen-to-square" /> Setup Signature</>}
              </button>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={openPrint} style={{ padding: "9px 20px", borderRadius: 8, border: `1.5px solid ${color}`, background: "white", color, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
                <i className="pi pi-eye" style={{ marginRight: 6 }} />Preview
              </button>
              <button onClick={handleSave} disabled={saving || finalizing} style={{ padding: "9px 24px", borderRadius: 8, border: "none", background: saving ? C.muted : color, color: "white", fontWeight: 700, fontSize: 13, cursor: saving ? "not-allowed" : "pointer" }}>
                {saving ? "Saving…" : <><i className="pi pi-save" style={{ marginRight: 6 }} />Save Draft</>}
              </button>
              <button onClick={handleFinalize} disabled={finalizing || saving || !lastSavedId} style={{ padding: "9px 24px", borderRadius: 8, border: "none", background: finalizing ? C.muted : "#15803d", color: "white", fontWeight: 700, fontSize: 13, cursor: finalizing || !lastSavedId ? "not-allowed" : "pointer", opacity: !lastSavedId ? 0.55 : 1 }}
                      title={lastSavedId ? "Finalize, discharge patient, release bed" : "Save the draft first"}>
                {finalizing ? "Finalizing…" : <><i className="pi pi-check" style={{ marginRight: 6 }} />Finalize &amp; Discharge</>}
              </button>
            </div>
          </div>
        </div>
      )}
      {showSetup && (
        <SignaturePad
          existing={signature}
          onSave={async (dataUrl) => { await saveSignature(dataUrl); setShowSetup(false); }}
          onCancel={() => setShowSetup(false)}
        />
      )}
    </div>
  );
}

export default function DischargeSummaryPage() {
  const [sel, setSel] = useState(null);
  return (
    <ClinicalLayout onPatientSelect={setSel} selectedId={sel?._id} pageType="discharge">
      <DischargeSummaryPageContent selectedPatient={sel} />
    </ClinicalLayout>
  );
}
