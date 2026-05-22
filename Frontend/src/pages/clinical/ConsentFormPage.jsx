/**
 * ConsentFormPage.jsx
 * NABH-Compliant Modular Consent Forms
 * Covers: PRE.3, PRE.4 — Informed Consent for 12 clinical situations
 */

import React, { useState, useRef, useEffect } from "react";
import axios from "axios";
import { API_ENDPOINTS } from "../../config/api";
import { openPrint } from "../../Components/print/openPrint";
import { useAuth } from "../../context/AuthContext";
import { toast } from "react-toastify";
import { useAutoSave } from "../../hooks/useAutoSave";
import { useDigitalSignature } from "../../hooks/useDigitalSignature";
import AutoSaveIndicator from "../../Components/signature/AutoSaveIndicator";
import SignaturePad from "../../Components/signature/SignaturePad";
import ClinicalLayout from "../../Components/clinical/ClinicalLayout";

const API = `${API_ENDPOINTS.BASE}/consent-forms`;

/* ══════════════════════════════════════════════════════════
   CONSENT TYPE CATALOGUE — each has color, icon, NABH ref,
   full template (title, body, risks, benefits, alternatives)
══════════════════════════════════════════════════════════ */
const CONSENT_CATALOGUE = [
  {
    key: "GENERAL_ADMISSION",
    label: "General Admission",
    icon: "pi-building",
    color: "#6366f1",
    bg: "#eef2ff",
    nabh: "PRE.3",
    description: "Standard consent for admission and general treatment",
    template: {
      title: "General Consent for Medical Treatment and Hospitalization",
      body: `I, the undersigned, hereby voluntarily consent to the performance of all diagnostic procedures, medical treatment, and any procedures deemed necessary or advisable by my attending physician(s) and the medical staff of this hospital during the course of my hospitalization.\n\nI understand that medicine is not an exact science and no guarantees can be given regarding the results of treatments and procedures.`,
      risks: [
        "Possible complications from prescribed treatment",
        "Adverse reactions to medications or anaesthesia",
        "Requirement for additional investigations or procedures",
        "Risk of infection associated with hospitalisation",
        "Risk of falls or accidental injury during hospital stay",
      ],
      benefits: [
        "Diagnosis and treatment of the current medical condition",
        "Pain relief and symptom management",
        "Access to specialist care and investigations",
        "Monitoring and prevention of complications",
      ],
      alternatives: [
        "Conservative / outpatient management",
        "Transfer to another healthcare facility",
        "Deferring treatment (with associated risks)",
      ],
    },
  },
  {
    key: "SURGICAL",
    label: "Surgical / Operation",
    icon: "pi-wrench",
    color: "#dc2626",
    bg: "#fef2f2",
    nabh: "PRE.4",
    description: "Informed consent prior to any surgical procedure",
    template: {
      title: "Informed Consent for Surgical Procedure",
      body: `I hereby give my informed consent for the surgical procedure as described and discussed with the operating surgeon. The nature, purpose, risks, benefits, and alternatives of the procedure have been explained to me in a language I understand.\n\nI authorise the surgeon and the surgical team to perform the procedure and any additional procedures that may be found necessary during the operation.`,
      risks: [
        "Bleeding requiring transfusion",
        "Wound infection",
        "Anaesthetic complications",
        "Damage to adjacent structures or organs",
        "Deep vein thrombosis or pulmonary embolism",
        "Failure to achieve the intended outcome",
        "Conversion to open surgery (if laparoscopic)",
        "Death (rare but possible)",
      ],
      benefits: [
        "Correction or removal of pathology",
        "Relief of pain or symptoms",
        "Restoration of function",
        "Prevention of disease progression",
      ],
      alternatives: [
        "Conservative / medical management",
        "Alternative surgical approach",
        "Watchful waiting with regular monitoring",
        "No treatment (with explanation of consequences)",
      ],
    },
  },
  {
    key: "ANESTHESIA",
    label: "Anaesthesia",
    icon: "pi-moon",
    color: "#7c3aed",
    bg: "#f5f3ff",
    nabh: "PRE.4",
    description: "Consent for general, regional or local anaesthesia",
    template: {
      title: "Informed Consent for Anaesthesia",
      body: `I consent to the administration of anaesthesia (general / regional / local / sedation) as deemed appropriate by the anaesthesiologist. The type of anaesthesia, its purpose, risks, and alternatives have been explained to me.\n\nI understand that anaesthesia carries certain risks and that the anaesthesiologist will take all reasonable precautions for my safety.`,
      risks: [
        "Nausea, vomiting, and sore throat",
        "Dental injury",
        "Awareness during anaesthesia (rare)",
        "Allergic reaction to anaesthetic agents",
        "Respiratory depression or airway problems",
        "Nerve injury (with regional blocks)",
        "Post-operative cognitive dysfunction (elderly patients)",
        "Cardiac complications",
        "Death (extremely rare)",
      ],
      benefits: [
        "Pain-free surgical / procedural experience",
        "Safe and controlled unconscious state",
        "Enables complex surgical procedures",
        "Monitoring of vital parameters throughout",
      ],
      alternatives: [
        "Local anaesthesia (for minor procedures)",
        "Regional anaesthesia (spinal / epidural)",
        "Conscious sedation",
        "Postponing elective procedure",
      ],
    },
  },
  {
    key: "PROCEDURE",
    label: "Invasive Procedure",
    icon: "pi-bolt",
    color: "#0891b2",
    bg: "#ecfeff",
    nabh: "PRE.4",
    description: "Endoscopy, biopsy, catheterisation, lumbar puncture, etc.",
    template: {
      title: "Informed Consent for Invasive Diagnostic / Therapeutic Procedure",
      body: `I consent to the performance of the invasive procedure described below. The procedure, its purpose, risks, expected benefits, and alternatives have been explained to me by the performing clinician in a language I understand.`,
      risks: [
        "Bleeding at the procedure site",
        "Infection",
        "Allergic reaction to medications or contrast agents",
        "Perforation or injury to adjacent structures",
        "Failure to achieve the diagnostic or therapeutic goal",
        "Requirement for additional procedures",
      ],
      benefits: [
        "Diagnostic confirmation",
        "Therapeutic relief or treatment",
        "Avoidance of more invasive surgery",
      ],
      alternatives: [
        "Non-invasive imaging or diagnostic tests",
        "Conservative management",
        "Surgical approach",
      ],
    },
  },
  {
    key: "BLOOD_TRANSFUSION",
    label: "Blood Transfusion",
    icon: "pi-heart-fill",
    color: "#e11d48",
    bg: "#fff1f2",
    nabh: "PRE.4",
    description: "Whole blood, packed cells, FFP, platelets",
    template: {
      title: "Informed Consent for Blood / Blood Product Transfusion",
      body: `I consent to the transfusion of blood and/or blood products as deemed medically necessary by my treating physician. The reason, procedure, risks and alternatives have been explained to me.\n\nAll donated blood is screened for HIV, Hepatitis B, Hepatitis C, Syphilis, and Malaria as per NACO guidelines. However, a residual risk of transfusion-transmitted infections exists.`,
      risks: [
        "Febrile non-haemolytic transfusion reaction",
        "Allergic reactions (urticaria, anaphylaxis)",
        "Acute or delayed haemolytic reaction",
        "Transfusion-related acute lung injury (TRALI)",
        "Transfusion-associated circulatory overload (TACO)",
        "Residual risk of transfusion-transmitted infections",
        "Iron overload with repeated transfusions",
      ],
      benefits: [
        "Correction of anaemia and restoration of oxygen-carrying capacity",
        "Control of bleeding",
        "Correction of coagulopathy",
        "Life-saving in critical situations",
      ],
      alternatives: [
        "Iron / B12 / folate supplementation (for deficiency anaemia)",
        "Erythropoietin therapy",
        "Autologous blood transfusion (pre-donated)",
        "Cell salvage during surgery",
      ],
    },
  },
  {
    key: "HIV_TESTING",
    label: "HIV / Infectious Testing",
    icon: "pi-shield",
    color: "#059669",
    bg: "#ecfdf5",
    nabh: "PRE.3",
    description: "Pre-test counselling and consent for HIV / HBsAg / HCV",
    template: {
      title: "Pre-Test Counselling and Consent for HIV / Infectious Disease Testing",
      body: `I voluntarily consent to testing for HIV and other infectious diseases (HBsAg, HCV, VDRL) as part of my routine pre-operative / pre-procedure workup or as clinically indicated.\n\nI have received pre-test counselling and understand:\n• The purpose of the test\n• How the sample will be collected\n• How results will be communicated\n• Confidentiality of results as per the HIV / AIDS Prevention and Control Act 2017`,
      risks: [
        "Psychological distress on learning a positive result",
        "Breach of confidentiality (mitigated by institutional policy)",
        "Possible false positive requiring confirmatory testing",
      ],
      benefits: [
        "Early detection enables timely treatment and better outcomes",
        "Prevention of transmission to healthcare workers",
        "Required for safe blood transfusion and surgery",
        "Access to antiretroviral / antiviral therapy if positive",
      ],
      alternatives: [
        "Deferring testing (with explanation of implications for treatment)",
        "Testing at a government-approved ICTC",
      ],
    },
  },
  {
    key: "LAMA",
    label: "LAMA",
    icon: "pi-sign-out",
    color: "#d97706",
    bg: "#fffbeb",
    nabh: "ACC.3",
    description: "Leave Against Medical Advice",
    template: {
      title: "Discharge Against Medical Advice (LAMA / DAMA)",
      body: `I, the undersigned, wish to leave the hospital AGAINST THE MEDICAL ADVICE of my treating physician. I have been informed in detail about my current medical condition, the treatment being provided, and the consequences of leaving at this time.\n\nI acknowledge that:\n• My condition may worsen or become life-threatening if I leave now\n• The hospital and treating physician are absolved of responsibility for any adverse outcome resulting from my decision to leave\n• I may return to the hospital if my condition deteriorates`,
      risks: [
        "Rapid deterioration of current medical condition",
        "Risk of life-threatening complications",
        "Need for emergency re-admission",
        "Potential permanent disability or death",
        "Incomplete treatment may reduce effectiveness",
      ],
      benefits: [],
      alternatives: [
        "Continuing hospital treatment as advised",
        "Requesting transfer to another hospital if unsatisfied",
        "Seeking a second medical opinion",
      ],
    },
  },
  {
    key: "DNR",
    label: "DNR / AND",
    icon: "pi-times-circle",
    color: "#64748b",
    bg: "#f8fafc",
    nabh: "COP.8",
    description: "Do Not Resuscitate / Allow Natural Death",
    template: {
      title: "Do Not Resuscitate (DNR) / Allow Natural Death (AND) Order",
      body: `After thorough discussion with the treating physician and in consultation with family members, I / we request that in the event of cardiac or respiratory arrest, cardiopulmonary resuscitation (CPR) NOT be performed.\n\nThis decision has been made after understanding:\n• The patient's current prognosis and quality of life\n• The likely outcomes and burdens of CPR in this clinical context\n• The difference between DNR and withdrawal of other treatments\n\nAll other comfort and palliative care measures will continue to be provided.`,
      risks: [
        "Patient may die sooner than if resuscitation were attempted",
        "Family may later feel regret about this decision",
      ],
      benefits: [
        "Avoidance of painful and potentially futile resuscitation",
        "Preservation of dignity at end of life",
        "Reduction of suffering for patient and family",
      ],
      alternatives: [
        "Full resuscitation (CPR, defibrillation, intubation)",
        "Limited code (chest compressions only, no intubation)",
        "Re-evaluation as clinical status changes",
      ],
    },
  },
  {
    key: "CHEMOTHERAPY",
    label: "Chemotherapy",
    icon: "pi-filter",
    color: "#0d9488",
    bg: "#f0fdfa",
    nabh: "PRE.4",
    description: "Systemic anti-cancer treatment",
    template: {
      title: "Informed Consent for Chemotherapy / Systemic Anti-Cancer Treatment",
      body: `I consent to receiving chemotherapy / targeted therapy / immunotherapy as prescribed by my oncologist. The treatment protocol, duration, expected benefits, and side effects have been explained to me.`,
      risks: [
        "Nausea, vomiting, and loss of appetite",
        "Hair loss (alopecia)",
        "Bone marrow suppression (neutropenia, anaemia, thrombocytopenia)",
        "Increased risk of infections",
        "Peripheral neuropathy",
        "Cardiotoxicity (specific agents)",
        "Nephrotoxicity and hepatotoxicity",
        "Infertility",
        "Secondary malignancy (long-term risk)",
        "Fatigue and mucositis",
      ],
      benefits: [
        "Shrinkage or elimination of tumour",
        "Prevention of cancer spread (metastasis)",
        "Symptom control in palliative setting",
        "Increased survival duration",
      ],
      alternatives: [
        "Palliative / supportive care only",
        "Radiation therapy",
        "Surgery",
        "Clinical trial participation",
        "No treatment (with explanation of prognosis)",
      ],
    },
  },
  {
    key: "DIALYSIS",
    label: "Dialysis",
    icon: "pi-sync",
    color: "#2563eb",
    bg: "#eff6ff",
    nabh: "PRE.4",
    description: "Haemodialysis or peritoneal dialysis",
    template: {
      title: "Informed Consent for Renal Replacement Therapy (Dialysis)",
      body: `I consent to undergo haemodialysis / peritoneal dialysis as recommended by my nephrologist for the management of my renal condition. The procedure, its purpose, risks, and alternatives have been explained to me.`,
      risks: [
        "Hypotension during dialysis sessions",
        "Muscle cramps",
        "Infection at vascular access site",
        "Clotting or failure of AV fistula / catheter",
        "Electrolyte imbalances",
        "Anaemia requiring EPO therapy",
        "Peritonitis (peritoneal dialysis)",
        "Dialysis disequilibrium syndrome",
      ],
      benefits: [
        "Removal of toxic metabolites and excess fluid",
        "Correction of electrolyte imbalances",
        "Symptomatic relief of uraemia",
        "Life-sustaining therapy for ESRD",
      ],
      alternatives: [
        "Kidney transplant",
        "Peritoneal dialysis (if on haemodialysis)",
        "Conservative kidney management (CKM)",
        "Supportive / palliative care",
      ],
    },
  },
  {
    key: "RESEARCH",
    label: "Research / Clinical Trial",
    icon: "pi-chart-bar",
    color: "#9333ea",
    bg: "#faf5ff",
    nabh: "PRE.3",
    description: "Participation in approved research or trials",
    template: {
      title: "Informed Consent for Research Participation / Clinical Trial",
      body: `I voluntarily agree to participate in the research study / clinical trial described below. The study has been approved by the Institutional Ethics Committee (IEC).\n\nI understand that:\n• My participation is entirely voluntary\n• I may withdraw at any time without affecting my medical care\n• My personal data will remain confidential\n• I will receive no direct monetary benefit`,
      risks: [
        "Possible side effects of experimental treatment/procedure",
        "Additional time and clinic visits required",
        "Unexpected risks that cannot be fully anticipated",
        "Potential discomfort from additional investigations",
      ],
      benefits: [
        "Access to experimental treatment that may be beneficial",
        "Contribution to medical knowledge",
        "Close monitoring throughout the study",
      ],
      alternatives: [
        "Standard care without research participation",
        "Participation in a different clinical trial",
      ],
    },
  },
  {
    key: "PHOTOGRAPHY",
    label: "Photography / Teaching",
    icon: "pi-camera",
    color: "#f59e0b",
    bg: "#fffbeb",
    nabh: "PRE.3",
    description: "Medical photography and teaching material consent",
    template: {
      title: "Consent for Medical Photography / Video / Teaching Purpose",
      body: `I hereby consent to the taking of photographs, videos, and/or other recordings of my condition for the purpose of medical records, teaching, or publication in medical literature.\n\nI understand that:\n• My identity will be protected wherever possible\n• Images will only be used for stated medical / educational purposes\n• I retain the right to withdraw consent for publication at any time`,
      risks: [
        "Remote possibility of identification despite precautions",
        "Discomfort during photography session",
      ],
      benefits: [
        "Contribution to medical education and training",
        "Improvement in documentation of clinical findings",
        "Potential to help future patients with similar conditions",
      ],
      alternatives: [
        "Declining photography / recording",
        "Allowing for medical records only (no publication)",
      ],
    },
  },
];

/* ── Design tokens ── */
const C = {
  bg: "#f0f2f5", card: "#fff", border: "#e2e6ea",
  text: "#1a1d23", muted: "#6b7280",
  green: "#16a34a", red: "#dc2626", amber: "#d97706", blue: "#1e40af",
};

function F({ label, required, children }) {
  return (
    <div>
      <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: C.muted,
        textTransform: "uppercase", letterSpacing: ".6px", marginBottom: 4 }}>
        {label}{required && <span style={{ color: C.red, marginLeft: 3 }}>*</span>}
      </label>
      {children}
    </div>
  );
}
function G2({ children, gap = 14 }) { return <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap }}>{children}</div>; }
function G3({ children }) { return <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>{children}</div>; }
function G4({ children }) { return <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>{children}</div>; }

function Section({ title, icon, color = C.blue, children, defaultOpen = true }) {
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
        </div>
        <i className={`pi ${open ? "pi-chevron-up" : "pi-chevron-down"}`} style={{ fontSize: 10, color: C.muted }} />
      </div>
      {open && <div style={{ padding: "16px 18px" }}>{children}</div>}
    </div>
  );
}

/* ── Consent type card ── */
function ConsentTypeCard({ type, selected, onSelect }) {
  const active = selected?.key === type.key;
  return (
    <button
      onClick={() => onSelect(type)}
      style={{
        background: active ? type.color + "12" : "white",
        border: `2px solid ${active ? type.color : C.border}`,
        borderRadius: 12, padding: "14px 12px",
        cursor: "pointer", textAlign: "left", transition: "all .15s",
        display: "flex", flexDirection: "column", gap: 6,
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.borderColor = type.color + "50"; }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.borderColor = C.border; }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{
          width: 32, height: 32, borderRadius: 8, flexShrink: 0,
          background: active ? type.color : type.bg,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <i className={`pi ${type.icon}`} style={{ fontSize: 14, color: active ? "white" : type.color }} />
        </span>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: active ? type.color : C.text }}>{type.label}</div>
          <div style={{ fontSize: 10, color: C.muted, fontWeight: 600 }}>{type.nabh}</div>
        </div>
      </div>
      <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.4 }}>{type.description}</div>
    </button>
  );
}

/* ── Editable list ── */
function EditableList({ items, setItems, placeholder, color }) {
  return (
    <div>
      {items.map((item, i) => (
        <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6, alignItems: "center" }}>
          <span style={{ width: 20, height: 20, borderRadius: "50%", background: color + "15",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 10, fontWeight: 700, color, flexShrink: 0 }}>{i + 1}</span>
          <input
            className="his-field" style={{ flex: 1 }}
            value={item}
            onChange={e => setItems(p => p.map((x, idx) => idx === i ? e.target.value : x))}
            placeholder={placeholder}
          />
          <button onClick={() => setItems(p => p.filter((_, idx) => idx !== i))}
            style={{ width: 26, height: 26, borderRadius: 6, border: "none",
              background: "#fef2f2", color: C.red, cursor: "pointer", flexShrink: 0, fontSize: 12 }}>
            <i className="pi pi-times" />
          </button>
        </div>
      ))}
      <button
        onClick={() => setItems(p => [...p, ""])}
        style={{ padding: "6px 14px", borderRadius: 7, border: `1.5px dashed ${color}50`,
          background: color + "06", color, fontWeight: 600, fontSize: 12, cursor: "pointer", marginTop: 4 }}>
        <i className="pi pi-plus" style={{ marginRight: 5, fontSize: 10 }} />Add Item
      </button>
    </div>
  );
}

/* ── Print view ── */
function ConsentPrintView({ data, type, onClose }) {
  const printRef = useRef();
  /* Rewired to the unified print system. The form-type key maps the
   * UI tab to one of the 7 templates inside our ConsentForm printable
   * (admission / surgical / anesthesia / hiv / dnr / procedure / autopsy). */
  const handlePrint = () => {
    const cat = type?.key || type?.code || "";
    const formType =
      /surgical|surg|operation|or/i.test(cat) ? "surgical" :
      /anesth/i.test(cat)                     ? "anesthesia" :
      /hiv/i.test(cat)                        ? "hiv" :
      /dnr|do.?not.?resuscitate/i.test(cat)   ? "dnr" :
      /autopsy|post.?mortem/i.test(cat)       ? "autopsy" :
      /procedure|investigation/i.test(cat)    ? "procedure" :
                                                "admission";
    openPrint("consent-form", {
      consentNo:        data.consentNumber || data.consentId,
      formType,
      patientName:      data.patientName,
      uhid:             data.uhid,
      age:              data.age,
      gender:           data.gender,
      ipdNo:            data.ipdNo,
      bedNumber:        data.bedNumber,
      wardName:         data.wardName,
      consultantName:   data.consultantName || data.doctorName,
      procedure:        data.procedureName || data.investigationName,
      additionalRisks:  data.risks,
      language:         data.language,
      counsellor:       data.counsellor,
      signatoryName:    data.signedBy,
      signatoryRelation:data.relationToPatient,
      witnessName:      data.witnessName,
      // R7bh-F1 / META-1: PrintAudit anchor — informed consent reprint
      // trail is NABH PRE.2 / MOI.7 critical. ConsentForm maps to its
      // own collection in ENTITY_MODEL.
      printAudit: {
        entityType:   "ConsentForm",
        entityId:     data._id || data.consentId,
        entityNumber: data.consentNumber || data.consentId,
        UHID:         data.uhid,
        patientName:  data.patientName,
      },
    });
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 1000,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
    }}>
      <div style={{
        background: "white", borderRadius: 16, width: "100%", maxWidth: 780,
        maxHeight: "92vh", overflow: "hidden", display: "flex", flexDirection: "column",
        boxShadow: "0 25px 80px rgba(0,0,0,0.3)",
      }}>
        {/* Modal header */}
        <div style={{
          padding: "14px 20px", borderBottom: `1px solid ${C.border}`,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          background: type?.color + "08",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ width: 32, height: 32, borderRadius: 8, background: type?.color + "20",
              display: "flex", alignItems: "center", justifyContent: "center" }}>
              <i className={`pi ${type?.icon}`} style={{ color: type?.color, fontSize: 14 }} />
            </span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, color: C.text }}>{data.consentTitle}</div>
              <div style={{ fontSize: 11, color: C.muted }}>NABH Ref: {type?.nabh} · Preview & Print</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={handlePrint} style={{
              padding: "7px 16px", borderRadius: 8, border: "none",
              background: type?.color, color: "white", fontWeight: 700, fontSize: 12, cursor: "pointer",
            }}>
              <i className="pi pi-print" style={{ marginRight: 6 }} />Print
            </button>
            <button onClick={onClose} style={{
              padding: "7px 14px", borderRadius: 8, border: `1px solid ${C.border}`,
              background: "white", color: C.text, fontSize: 12, cursor: "pointer",
            }}>Close</button>
          </div>
        </div>

        {/* Consent document */}
        <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px" }} ref={printRef}>
          <div style={{ textAlign: "center", marginBottom: 6 }}>
            <div style={{ fontWeight: 800, fontSize: 15, textTransform: "uppercase", letterSpacing: ".5px" }}>SphereHealth Hospital</div>
            <div style={{ fontSize: 11, color: C.muted }}>NABH Accredited Healthcare Institution</div>
          </div>
          <hr style={{ border: "none", borderTop: `2px solid ${type?.color}`, marginBottom: 12 }} />

          <h2 style={{ textAlign: "center", fontWeight: 800, fontSize: 17, marginBottom: 4, fontFamily: "serif" }}>{data.consentTitle}</h2>
          <div style={{ textAlign: "center", fontSize: 11, color: C.muted, marginBottom: 18 }}>
            NABH Standard: {type?.nabh} | Consent ID: {data._id?.slice(-8)?.toUpperCase() || "PENDING"} | Date: {new Date().toLocaleDateString("en-IN")}
          </div>

          {/* Patient info box */}
          <div style={{ border: `1.5px solid ${C.border}`, borderRadius: 8, padding: "12px 16px", marginBottom: 16,
            background: "#f8fafc", display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "8px 16px" }}>
            {[
              ["UHID", data.UHID],
              ["Patient Name", data.patientName],
              ["Age / Gender", `${data.age || "—"} / ${data.gender || "—"}`],
              ["IPD / OPD No.", data.ipdNo || "—"],
              ["Ward / Bed", data.wardBed || "—"],
              ["Date of Admission", data.admissionDate || "—"],
              ["Attending Doctor", data.doctorName || "—"],
              ["Department", data.department || "—"],
            ].map(([label, value]) => (
              <div key={label}>
                <div style={{ fontSize: 10, color: C.muted, fontWeight: 600 }}>{label}</div>
                <div style={{ fontSize: 13, fontWeight: 600, borderBottom: `1px solid ${C.border}`, paddingBottom: 2 }}>{value || "—"}</div>
              </div>
            ))}
          </div>

          {/* Body text */}
          <div style={{ marginBottom: 16, lineHeight: 1.8, fontSize: 13, fontFamily: "serif", whiteSpace: "pre-line" }}>
            {data.body}
          </div>

          {/* Risks */}
          {data.risks?.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6, color: C.red }}>
                <i className="pi pi-exclamation-triangle" style={{ marginRight: 6 }} />Risks and Potential Complications
              </div>
              <ul style={{ paddingLeft: 20, margin: 0 }}>
                {data.risks.filter(Boolean).map((r, i) => <li key={i} style={{ marginBottom: 4, fontSize: 13 }}>{r}</li>)}
              </ul>
            </div>
          )}

          {/* Benefits */}
          {data.benefits?.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6, color: C.green }}>
                <i className="pi pi-check-circle" style={{ marginRight: 6 }} />Expected Benefits
              </div>
              <ul style={{ paddingLeft: 20, margin: 0 }}>
                {data.benefits.filter(Boolean).map((b, i) => <li key={i} style={{ marginBottom: 4, fontSize: 13 }}>{b}</li>)}
              </ul>
            </div>
          )}

          {/* Alternatives */}
          {data.alternatives?.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6, color: C.blue }}>
                <i className="pi pi-arrow-right-arrow-left" style={{ marginRight: 6 }} />Alternatives Discussed
              </div>
              <ul style={{ paddingLeft: 20, margin: 0 }}>
                {data.alternatives.filter(Boolean).map((a, i) => <li key={i} style={{ marginBottom: 4, fontSize: 13 }}>{a}</li>)}
              </ul>
            </div>
          )}

          {/* Declaration */}
          <div style={{ background: type?.color + "08", border: `1px solid ${type?.color}30`, borderRadius: 8, padding: "12px 16px", marginBottom: 16, fontSize: 13, lineHeight: 1.7 }}>
            <strong>Declaration:</strong> I confirm that I have read and understood this consent form (or it has been explained to me in{" "}
            <strong>{data.language || "Hindi / English"}</strong>). I have had the opportunity to ask questions and am satisfied with the answers.
            I give my voluntary informed consent freely without any coercion.
            {data.interpreterName && ` An interpreter (${data.interpreterName}) was used.`}
          </div>

          {/* Signature grid */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 20, marginTop: 20, marginBottom: 12 }}>
            {[
              { label: "Patient Signature / Thumb Impression", sub: `Name: ${data.patientName || "—"}` },
              {
                label: data.consentBy !== "SELF" ? `Guardian / Relative Signature` : "Guardian / Relative (if applicable)",
                sub: data.guardianName ? `Name: ${data.guardianName}\nRelation: ${data.guardianRelation}` : "Name:\nRelation:",
              },
              { label: "Witness Signature", sub: `Name: ${data.witnessName || "—"}\nRelation: ${data.witnessRelation || "—"}` },
            ].map(({ label, sub }) => (
              <div key={label} style={{ borderTop: `2px solid ${C.text}`, paddingTop: 6 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.text, marginBottom: 2 }}>{label}</div>
                <div style={{ fontSize: 10, color: C.muted, whiteSpace: "pre-line", lineHeight: 1.5 }}>{sub}</div>
                <div style={{ marginTop: 28, borderTop: `1px solid ${C.border}`, paddingTop: 4, fontSize: 10, color: C.muted }}>
                  Date: _____________ Time: _____________
                </div>
              </div>
            ))}
          </div>

          {/* Doctor sign-off */}
          <div style={{ borderTop: `1.5px solid ${C.border}`, paddingTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
            <div style={{ borderTop: `2px solid ${C.text}`, paddingTop: 6 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.text }}>Explained By (Doctor)</div>
              <div style={{ fontSize: 10, color: C.muted }}>Name: {data.doctorName || "—"}</div>
              <div style={{ fontSize: 10, color: C.muted }}>Reg. No.: {data.doctorRegNo || "—"}</div>
              <div style={{ marginTop: 28, borderTop: `1px solid ${C.border}`, paddingTop: 4, fontSize: 10, color: C.muted }}>
                Date: _____________ Time: _____________
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: C.muted, lineHeight: 1.6 }}>
                <strong>Hospital Stamp</strong><br />
                <div style={{ width: 120, height: 60, border: `1px dashed ${C.border}`, borderRadius: 6, marginTop: 4 }} />
              </div>
            </div>
          </div>

          <div style={{ marginTop: 10, fontSize: 10, color: C.muted, textAlign: "center" }}>
            This consent form is valid as per NABH Standards ({type?.nabh}) | SphereHealth HIS | {new Date().toLocaleDateString("en-IN")}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════
   MAIN PAGE
══════════════════════════════════════ */
function ConsentFormPageContent({ selectedPatient }) {
  const { user } = useAuth();

  // Views: "catalogue" | "form" | "list"
  const [view, setView] = useState("catalogue");
  const [selectedType, setSelectedType] = useState(null);

  // Patient search
  const [uhid, setUhid] = useState("");
  const [patInfo, setPatInfo] = useState(null);
  const [searching, setSearching] = useState(false);
  const [savedForms, setSavedForms] = useState([]);
  const [loadingForms, setLoadingForms] = useState(false);

  // Form data
  const [consentData, setConsentData] = useState({
    UHID: "", patientName: "", age: "", gender: "", ipdNo: "",
    wardBed: "", admissionDate: "", department: "", doctorName: "",
    doctorRegNo: "", consentBy: "SELF", guardianName: "", guardianRelation: "",
    guardianContact: "", witnessName: "", witnessRelation: "",
    language: "Hindi", interpreterRequired: false, interpreterName: "",
    additionalNotes: "",
  });
  const [body, setBody] = useState("");
  const [risks, setRisks] = useState([]);
  const [benefits, setBenefits] = useState([]);
  const [alternatives, setAlternatives] = useState([]);
  const [saving, setSaving] = useState(false);

  // Auto-save draft
  const draftKey = patInfo?._id ? `sphere_draft_consent_${patInfo._id}` : null;
  const { savedAt, hasDraft, clearDraft } = useAutoSave(
    draftKey, { consentData, body, risks, benefits, alternatives }, 2000
  );
  const { signature, showSetup, setShowSetup, saveSignature } = useDigitalSignature();

  // Preview modal
  const [previewData, setPreviewData] = useState(null);
  const [previewType, setPreviewType] = useState(null);

  const token = (sessionStorage.getItem("his_token") || localStorage.getItem("his_token"));
  const headers = { Authorization: `Bearer ${token}` };

  // Auto-fill when patient selected from AdmittedPatientPanel
  useEffect(() => {
    if (!selectedPatient) return;
    const found = selectedPatient;
    setUhid(found.UHID || "");
    setPatInfo(found);
    setConsentData(p => ({
      ...p,
      UHID: found.UHID || "",
      patientName: found.patientName || found.patientId?.fullName || "",
      ipdNo: found.admissionNumber || "",
      wardBed: `${found.wardId?.wardName || found.wardName || ""} / ${found.bedNumber || ""}`.replace(/^\s*\/\s*$/, ""),
      admissionDate: found.admissionDate ? new Date(found.admissionDate).toLocaleDateString("en-IN") : "",
    }));
    toast.success(`Patient loaded: ${found.patientName || found.UHID}`);
  }, [selectedPatient?._id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleTypeSelect = (type) => {
    setSelectedType(type);
    setBody(type.template.body);
    setRisks([...type.template.risks]);
    setBenefits([...type.template.benefits]);
    setAlternatives([...type.template.alternatives]);
    setConsentData(p => ({
      ...p, consentTitle: type.template.title,
      doctorName: user?.fullName || user?.firstName || "",
    }));
    setView("form");
  };

  const searchPatient = async () => {
    if (!uhid.trim()) return;
    setSearching(true);
    try {
      // hasBed=true so OPD/Daycare/Services visits don't pollute the
      // consent-form admission picker (which expects IPD patients only).
      const res = await axios.get(`${API_ENDPOINTS.BASE}/admissions/active?hasBed=true`, { headers });
      const list = Array.isArray(res.data?.data) ? res.data.data : Array.isArray(res.data) ? res.data : [];
      const found = list.find(a =>
        a.UHID === uhid.trim().toUpperCase() ||
        a.admissionNumber === uhid.trim()
      );
      if (found) {
        setPatInfo(found);
        setConsentData(p => ({
          ...p,
          UHID: found.UHID,
          patientName: found.patientName || found.patientId?.fullName || "",
          ipdNo: found.admissionNumber || "",
          wardBed: `${found.wardId?.wardName || ""} / ${found.bedNumber || ""}`,
          admissionDate: found.admissionDate ? new Date(found.admissionDate).toLocaleDateString("en-IN") : "",
        }));
        // Restore auto-save draft if available
        const dKey = `sphere_draft_consent_${found._id}`;
        const raw = localStorage.getItem(dKey);
        if (raw) {
          try {
            const { data } = JSON.parse(raw);
            if (data) {
              if (data.consentData) setConsentData(p => ({ ...p, ...data.consentData }));
              if (data.body !== undefined) setBody(data.body);
              if (data.risks) setRisks(data.risks);
              if (data.benefits) setBenefits(data.benefits);
              if (data.alternatives) setAlternatives(data.alternatives);
              toast.info("Draft restored", { autoClose: 2000 });
            }
          } catch { /* ignore */ }
        }
        toast.success("Patient loaded");
      } else {
        toast.warn("No active admission found");
      }
    } catch {
      toast.error("Failed to search");
    } finally {
      setSearching(false);
    }
  };

  const fetchSavedForms = async () => {
    if (!uhid.trim()) return;
    setLoadingForms(true);
    try {
      const res = await axios.get(`${API}/uhid/${uhid.trim()}`, { headers });
      setSavedForms(Array.isArray(res.data?.data) ? res.data.data : []);
    } catch {
      setSavedForms([]);
    } finally {
      setLoadingForms(false);
    }
  };

  const handleSave = async () => {
    if (!consentData.UHID) { toast.warn("Please load a patient first"); return; }
    setSaving(true);
    try {
      const payload = {
        ...consentData,
        consentType: selectedType?.key,
        consentTitle: consentData.consentTitle,
        procedureDescription: body,
        risksDisclosed: risks.filter(Boolean),
        benefitsExplained: benefits.filter(Boolean),
        alternativesDisclosed: alternatives.filter(Boolean),
        languageUsed: consentData.language,
        interpreterRequired: consentData.interpreterRequired,
        interpreterName: consentData.interpreterName,
        consentGivenBy: consentData.consentBy,
        guardianName: consentData.guardianName,
        guardianRelation: consentData.guardianRelation,
        witnessName: consentData.witnessName,
        explainedByDoctorName: consentData.doctorName,
        doctorRegNo: consentData.doctorRegNo,
        additionalNotes: consentData.additionalNotes,
        status: "PENDING",
      };
      await axios.post(API, payload, { headers });
      toast.success("Consent form saved");
      clearDraft();
      fetchSavedForms();
      openPreview();
    } catch (err) {
      // FIX (audit P18-B4): the legacy 404-swallow lied to the user
      // about a successful save when the backend route was misrouted /
      // broken. Real failures must surface — no more silent data loss.
      toast.error(err.response?.data?.message || `Save failed (${err.response?.status || "network"})`);
    } finally {
      setSaving(false);
    }
  };

  const openPreview = () => {
    setPreviewData({
      ...consentData,
      body,
      risks,
      benefits,
      alternatives,
      consentTitle: consentData.consentTitle,
    });
    setPreviewType(selectedType);
  };

  const STATUS_COLORS = {
    PENDING: { bg: "#fffbeb", text: "#d97706" },
    SIGNED:  { bg: "#dcfce7", text: "#16a34a" },
    REFUSED: { bg: "#fef2f2", text: "#dc2626" },
    REVOKED: { bg: "#f1f5f9", text: "#64748b" },
  };

  const upd = (field) => (e) => setConsentData(p => ({
    ...p, [field]: e.target.type === "checkbox" ? e.target.checked : e.target.value,
  }));

  return (
    <div style={{ fontFamily: "'DM Sans', sans-serif", minHeight: "100vh" }}>

      {/* ── Print preview modal ── */}
      {previewData && (
        <ConsentPrintView
          data={previewData}
          type={previewType}
          onClose={() => setPreviewData(null)}
        />
      )}

      {/* ── Page header ── */}
      <div style={{
        background: C.card, borderRadius: 12, padding: "14px 20px",
        marginBottom: 14, border: `1.5px solid #6366f130`,
        display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: "#eef2ff",
            display: "flex", alignItems: "center", justifyContent: "center" }}>
            <i className="pi pi-file-check" style={{ fontSize: 18, color: "#6366f1" }} />
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16, color: C.text }}>Consent Forms</div>
            <div style={{ fontSize: 11, color: C.muted }}>NABH PRE.3 · PRE.4 · COP.8 — Informed Consent Management</div>
          </div>
          <span style={{ background: "#f5f3ff", color: "#7c3aed", border: "1px solid #c4b5fd",
            fontSize: 10, fontWeight: 700, padding: "3px 9px", borderRadius: 5 }}>NABH</span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {view !== "catalogue" && (
            <button onClick={() => setView("catalogue")} style={{
              padding: "7px 14px", borderRadius: 8, border: `1px solid ${C.border}`,
              background: "white", cursor: "pointer", fontSize: 12, color: C.muted, fontWeight: 600,
            }}>
              <i className="pi pi-arrow-left" style={{ marginRight: 5 }} />Back
            </button>
          )}
          {view === "form" && (
            <button onClick={openPreview} style={{
              padding: "7px 14px", borderRadius: 8, border: "none",
              background: "#eef2ff", color: "#6366f1", cursor: "pointer", fontSize: 12, fontWeight: 700,
            }}>
              <i className="pi pi-eye" style={{ marginRight: 5 }} />Preview
            </button>
          )}
        </div>
      </div>

      {/* ══ CATALOGUE VIEW ══ */}
      {view === "catalogue" && (
        <>
          {/* Patient search */}
          <div style={{
            background: C.card, borderRadius: 12, padding: "14px 18px",
            marginBottom: 14, border: `1.5px solid ${C.border}`,
            display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
          }}>
            <i className="pi pi-search" style={{ color: C.muted, fontSize: 14 }} />
            <input
              value={uhid} onChange={e => setUhid(e.target.value)}
              onKeyDown={e => e.key === "Enter" && (searchPatient(), fetchSavedForms())}
              className="his-field" style={{ flex: 1, minWidth: 220 }} placeholder="Enter UHID / Admission No. to load patient…"
            />
            <button onClick={() => { searchPatient(); fetchSavedForms(); }} disabled={searching} style={{
              padding: "8px 16px", borderRadius: 8, border: "none",
              background: searching ? C.muted : "#6366f1",
              color: "white", fontWeight: 700, fontSize: 12, cursor: "pointer",
            }}>
              {searching ? "Searching…" : "Load Patient"}
            </button>
            {patInfo && (
              <div style={{ display: "flex", gap: 12, fontSize: 12, color: C.text, flexWrap: "wrap" }}>
                <span><b>Patient:</b> {patInfo.patientName || patInfo.patientId?.fullName}</span>
                <span><b>UHID:</b> {patInfo.UHID}</span>
                <span><b>Bed:</b> {patInfo.bedNumber || "—"}</span>
              </div>
            )}
          </div>

          {/* Consent type grid */}
          <div style={{ background: C.card, borderRadius: 12, padding: "18px", marginBottom: 14, border: `1.5px solid ${C.border}` }}>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: C.text, marginBottom: 3 }}>Select Consent Type</div>
              <div style={{ fontSize: 12, color: C.muted }}>Choose the appropriate NABH-compliant consent form for the clinical situation</div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
              {CONSENT_CATALOGUE.map(type => (
                <ConsentTypeCard key={type.key} type={type} selected={selectedType} onSelect={handleTypeSelect} />
              ))}
            </div>
          </div>

          {/* Saved forms */}
          {savedForms.length > 0 && (
            <div style={{ background: C.card, borderRadius: 12, padding: "18px", border: `1.5px solid ${C.border}` }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: C.text, marginBottom: 12 }}>
                Previous Consent Forms — {consentData.UHID}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {savedForms.map(f => {
                  const cat = CONSENT_CATALOGUE.find(c => c.key === f.consentType);
                  const sc = STATUS_COLORS[f.status] || STATUS_COLORS.PENDING;
                  // R7r: Audit trail surfacing (NABH PRE.3 / PRE.4).
                  // Backend captures the full CREATED → UPDATED → SIGNED
                  // → REFUSED / REVOKED trail in f.auditTrail; previously
                  // the UI only showed the latest status pill, hiding
                  // the chain of who signed / refused / amended and
                  // when. Now the card is expandable — click "Trail"
                  // to reveal the chronological state history with
                  // actor + role + reason for each transition.
                  const trail = Array.isArray(f.auditTrail) ? f.auditTrail : [];
                  return (
                    <div key={f._id} style={{
                      padding: "10px 14px", border: `1.5px solid ${C.border}`,
                      borderRadius: 10, background: "#fafbfc",
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <span style={{ width: 30, height: 30, borderRadius: 7, background: cat?.bg || "#f1f5f9",
                          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          <i className={`pi ${cat?.icon || "pi-file"}`} style={{ fontSize: 13, color: cat?.color || C.muted }} />
                        </span>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: C.text }}>{f.consentTitle || cat?.label}</div>
                          <div style={{ fontSize: 11, color: C.muted }}>{new Date(f.createdAt).toLocaleString("en-IN")}</div>
                        </div>
                        <span style={{ padding: "3px 10px", borderRadius: 5, fontSize: 10, fontWeight: 700,
                          background: sc.bg, color: sc.text }}>{f.status}</span>
                        <button onClick={() => { setPreviewData({ ...f, body: f.procedureDescription, risks: f.risksDisclosed, benefits: f.benefitsExplained, alternatives: f.alternativesDisclosed }); setPreviewType(cat); }}
                          style={{ padding: "5px 12px", borderRadius: 7, border: "none", background: "#eef2ff",
                            color: "#6366f1", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                          <i className="pi pi-eye" style={{ marginRight: 4 }} />View
                        </button>
                      </div>
                      {trail.length > 0 && (
                        <details style={{ marginTop: 8, paddingTop: 8, borderTop: `1px dashed ${C.border}`, fontSize: 11 }}>
                          <summary style={{ cursor: "pointer", fontWeight: 700, color: C.muted, userSelect: "none" }}>
                            🪵 Audit Trail ({trail.length} event{trail.length !== 1 ? "s" : ""}) — NABH PRE.3
                          </summary>
                          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4, paddingLeft: 4 }}>
                            {trail
                              .slice()
                              .sort((a, b) => new Date(a.at) - new Date(b.at))
                              .map((evt, idx) => {
                                const palette = evt.action === "SIGNED"   ? { bg: "#dcfce7", fg: "#166534" }
                                              : evt.action === "REFUSED"  ? { bg: "#fee2e2", fg: "#b91c1c" }
                                              : evt.action === "REVOKED"  ? { bg: "#fef3c7", fg: "#92400e" }
                                              : evt.action === "PRINTED"  ? { bg: "#e0e7ff", fg: "#3730a3" }
                                              : evt.action === "UPDATED"  ? { bg: "#cffafe", fg: "#0e7490" }
                                              :                             { bg: "#f1f5f9", fg: "#475569" };
                                return (
                                  <div key={idx} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0" }}>
                                    <span style={{ padding: "1px 7px", borderRadius: 3, background: palette.bg, color: palette.fg, fontWeight: 800, fontSize: 9.5, minWidth: 64, textAlign: "center" }}>
                                      {evt.action}
                                    </span>
                                    <span style={{ color: C.muted, fontFamily: "monospace", minWidth: 130 }}>
                                      {new Date(evt.at).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                                    </span>
                                    <span style={{ color: C.text, fontWeight: 600 }}>{evt.byName || "—"}</span>
                                    {evt.byRole && (
                                      <span style={{ color: C.muted, fontSize: 10 }}>· {evt.byRole}</span>
                                    )}
                                    {evt.reason && (
                                      <span style={{ color: C.muted, fontStyle: "italic", marginLeft: "auto", fontSize: 10.5 }}>
                                        “{evt.reason}”
                                      </span>
                                    )}
                                  </div>
                                );
                              })}
                          </div>
                        </details>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* ══ FORM VIEW ══ */}
      {view === "form" && selectedType && (
        <div>
          {/* Type banner */}
          <div style={{
            background: selectedType.color + "10", border: `1.5px solid ${selectedType.color}30`,
            borderRadius: 12, padding: "12px 18px", marginBottom: 14,
            display: "flex", alignItems: "center", gap: 12,
          }}>
            <span style={{ width: 38, height: 38, borderRadius: 10, background: selectedType.bg,
              display: "flex", alignItems: "center", justifyContent: "center" }}>
              <i className={`pi ${selectedType.icon}`} style={{ fontSize: 18, color: selectedType.color }} />
            </span>
            <div>
              <div style={{ fontWeight: 800, fontSize: 14, color: selectedType.color }}>{selectedType.label} Consent</div>
              <div style={{ fontSize: 11, color: C.muted }}>{selectedType.description} · NABH {selectedType.nabh}</div>
            </div>
            <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <AutoSaveIndicator savedAt={savedAt} hasDraft={hasDraft} />
              <button onClick={() => setShowSetup(true)}
                style={{ padding:"6px 11px", background: signature ? "#f0fdf4" : "#fffbeb", border:`1.5px solid ${signature ? "#bbf7d0" : "#fde68a"}`, borderRadius:8, cursor:"pointer", fontSize:11, fontWeight:700, color: signature ? "#16a34a" : "#92400e", display:"flex", alignItems:"center", gap:4 }}>
                {signature ? <><i className="pi pi-verified" style={{ fontSize:10 }} /> Sig Set</> : <><i className="pi pi-pen-to-square" style={{ fontSize:10 }} /> Setup Sig</>}
              </button>
              <button onClick={openPreview} style={{
                padding: "7px 14px", borderRadius: 8, border: "none",
                background: selectedType.color + "15", color: selectedType.color,
                cursor: "pointer", fontSize: 12, fontWeight: 700,
              }}>
                <i className="pi pi-eye" style={{ marginRight: 5 }} />Preview Form
              </button>
              <button onClick={handleSave} disabled={saving} style={{
                padding: "7px 18px", borderRadius: 8, border: "none",
                background: saving ? C.muted : selectedType.color,
                color: "white", cursor: saving ? "not-allowed" : "pointer", fontSize: 12, fontWeight: 700,
              }}>
                {saving ? "Saving…" : <><i className="pi pi-save" style={{ marginRight: 5 }} />Save & Preview</>}
              </button>
            </div>
          </div>

          {/* Patient Details */}
          <Section title="Patient Details" icon="pi-user" color={selectedType.color}>
            <G4>
              <F label="UHID" required>
                <div style={{ display: "flex", gap: 6 }}>
                  <input className="his-field" style={{ flex: 1 }} value={consentData.UHID}
                    onChange={upd("UHID")} placeholder="UHID" />
                  <button onClick={searchPatient} style={{
                    padding: "8px 10px", borderRadius: 7, border: "none",
                    background: selectedType.color, color: "white", cursor: "pointer", fontSize: 11,
                  }}>
                    <i className="pi pi-search" />
                  </button>
                </div>
              </F>
              <F label="Patient Name" required>
                <input className="his-field" value={consentData.patientName} onChange={upd("patientName")} />
              </F>
              <F label="Age">
                <input className="his-field" value={consentData.age} onChange={upd("age")} placeholder="e.g. 45 years" />
              </F>
              <F label="Gender">
                <select className="his-field" value={consentData.gender} onChange={upd("gender")}>
                  <option value="">Select</option>
                  {["Male","Female","Other"].map(g => <option key={g}>{g}</option>)}
                </select>
              </F>
              <F label="IPD / OPD No.">
                <input className="his-field" value={consentData.ipdNo} onChange={upd("ipdNo")} />
              </F>
              <F label="Ward / Bed">
                <input className="his-field" value={consentData.wardBed} onChange={upd("wardBed")} />
              </F>
              <F label="Admission Date">
                <input className="his-field" value={consentData.admissionDate} onChange={upd("admissionDate")} />
              </F>
              <F label="Department">
                <input className="his-field" value={consentData.department} onChange={upd("department")} placeholder="e.g. Surgery" />
              </F>
            </G4>
          </Section>

          {/* Consent Title & Body */}
          <Section title="Consent Content" icon="pi-file-edit" color={selectedType.color}>
            <F label="Consent Title" required>
              <input className="his-field" style={{ fontWeight: 700, fontSize: 14 }}
                value={consentData.consentTitle} onChange={upd("consentTitle")} />
            </F>
            <div style={{ marginTop: 12 }}>
              <F label="Consent Body / Procedure Description">
                <textarea className="his-textarea" style={{ minHeight: 120, lineHeight: 1.7 }}
                  value={body} onChange={e => setBody(e.target.value)} />
              </F>
            </div>
          </Section>

          {/* Risks */}
          <Section title="Risks & Potential Complications" icon="pi-exclamation-triangle" color={C.red}>
            <EditableList items={risks} setItems={setRisks}
              placeholder="Describe a risk or complication…" color={C.red} />
          </Section>

          {/* Benefits */}
          {selectedType.template.benefits.length > 0 && (
            <Section title="Expected Benefits" icon="pi-check-circle" color={C.green}>
              <EditableList items={benefits} setItems={setBenefits}
                placeholder="Describe an expected benefit…" color={C.green} />
            </Section>
          )}

          {/* Alternatives */}
          <Section title="Alternatives Discussed" icon="pi-arrow-right-arrow-left" color={C.blue}>
            <EditableList items={alternatives} setItems={setAlternatives}
              placeholder="Describe an alternative…" color={C.blue} />
          </Section>

          {/* Communication */}
          <Section title="Communication & Language" icon="pi-comments" color="#0891b2">
            <G3>
              <F label="Language of Explanation" required>
                <select className="his-field" value={consentData.language} onChange={upd("language")}>
                  {["Hindi","English","Marathi","Bengali","Gujarati","Tamil","Telugu","Kannada","Malayalam","Punjabi","Odia","Other"].map(l => (
                    <option key={l}>{l}</option>
                  ))}
                </select>
              </F>
              <F label="Interpreter Required">
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
                  <input type="checkbox" id="interp" checked={consentData.interpreterRequired}
                    onChange={upd("interpreterRequired")} style={{ accentColor: "#0891b2" }} />
                  <label htmlFor="interp" style={{ fontSize: 13, cursor: "pointer" }}>Yes, interpreter used</label>
                </div>
              </F>
              {consentData.interpreterRequired && (
                <F label="Interpreter Name">
                  <input className="his-field" value={consentData.interpreterName} onChange={upd("interpreterName")} />
                </F>
              )}
            </G3>
          </Section>

          {/* Consent given by */}
          <Section title="Consent Given By" icon="pi-user-edit" color="#7c3aed">
            <G3>
              <F label="Consent Given By" required>
                <select className="his-field" value={consentData.consentBy} onChange={upd("consentBy")}>
                  <option value="SELF">Patient (Self)</option>
                  <option value="GUARDIAN">Parent / Guardian</option>
                  <option value="SPOUSE">Spouse</option>
                  <option value="RELATIVE">Relative</option>
                  <option value="LEGAL_REP">Legal Representative</option>
                </select>
              </F>
              {consentData.consentBy !== "SELF" && (
                <>
                  <F label="Guardian / Relative Name" required>
                    <input className="his-field" value={consentData.guardianName} onChange={upd("guardianName")} />
                  </F>
                  <F label="Relation to Patient">
                    <input className="his-field" value={consentData.guardianRelation} onChange={upd("guardianRelation")} />
                  </F>
                  <F label="Contact Number">
                    <input className="his-field" value={consentData.guardianContact} onChange={upd("guardianContact")} />
                  </F>
                </>
              )}
            </G3>
          </Section>

          {/* Witness & Doctor */}
          <Section title="Witness & Doctor Details" icon="pi-shield" color="#64748b">
            <G4>
              <F label="Witness Name">
                <input className="his-field" value={consentData.witnessName} onChange={upd("witnessName")} />
              </F>
              <F label="Witness Relation">
                <input className="his-field" value={consentData.witnessRelation} onChange={upd("witnessRelation")} />
              </F>
              <F label="Explained By (Doctor)" required>
                <input className="his-field" value={consentData.doctorName} onChange={upd("doctorName")} />
              </F>
              <F label="Doctor Reg. No.">
                <input className="his-field" value={consentData.doctorRegNo} onChange={upd("doctorRegNo")} />
              </F>
            </G4>
          </Section>

          {/* Additional Notes */}
          <Section title="Additional Notes" icon="pi-pencil" color={C.muted} defaultOpen={false}>
            <F label="Additional Notes / Special Instructions">
              <textarea className="his-textarea" value={consentData.additionalNotes} onChange={upd("additionalNotes")}
                placeholder="Any additional clinical information or special instructions…" />
            </F>
          </Section>

          {/* Bottom save */}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 4 }}>
            <button onClick={openPreview} style={{
              padding: "9px 20px", borderRadius: 8, border: `1.5px solid ${selectedType.color}`,
              background: "white", color: selectedType.color, fontWeight: 700, fontSize: 13, cursor: "pointer",
            }}>
              <i className="pi pi-eye" style={{ marginRight: 6 }} />Preview
            </button>
            <button onClick={handleSave} disabled={saving} style={{
              padding: "9px 24px", borderRadius: 8, border: "none",
              background: saving ? C.muted : selectedType.color,
              color: "white", fontWeight: 700, fontSize: 13,
              cursor: saving ? "not-allowed" : "pointer",
            }}>
              {saving ? "Saving…" : <><i className="pi pi-save" style={{ marginRight: 6 }} />Save & Print</>}
            </button>
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

export default function ConsentFormPage() {
  const [sel, setSel] = useState(null);
  return (
    <ClinicalLayout onPatientSelect={setSel} selectedId={sel?._id} pageType="consent">
      <ConsentFormPageContent selectedPatient={sel} />
    </ClinicalLayout>
  );
}
