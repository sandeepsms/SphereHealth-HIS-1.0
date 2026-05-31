/**
 * MedicalCertificatePage.jsx
 * ════════════════════════════════════════════════════════════════════
 * R7fu — Medical Certificates builder.
 *
 * URL: /medical-certificates
 *
 * Flow
 *   1. Hero — page title + count badge of certs issued today.
 *   2. Patient picker — debounced search across UHID / name / mobile;
 *      shows latest visit context once a patient is selected. "Standalone"
 *      option lets the doctor issue a cert without a visit.
 *   3. Type picker grid (12 cards, 3-col on desktop).
 *   4. Type-specific form (one block per certType, per the model schema).
 *   5. Common footer fields — diagnosis (free text), ICD-10, notes.
 *   6. Doctor signature block — current user identity + MCI reg.
 *      Disabled with a sticky warning if MCI reg is missing (R7bx).
 *   7. For disability + sterilization: counter-signing officer fields.
 *   8. "Save & Print" → POST /api/medical-certificates → openPrint().
 *   9. Recent certificates list (doctor's last 10) with View / Re-print /
 *      Revoke actions.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { useAuth } from "../../context/AuthContext";
import useHospitalSettings from "../../Components/print/useHospitalSettings";
import { openPrint } from "../../Components/print/openPrint";
import { API_BASE_URL } from "../../config/api";

const API = `${API_BASE_URL}/medical-certificates`;
const PATIENTS_API = `${API_BASE_URL}/patients`;

const authHdr = () => ({
  headers: { Authorization: `Bearer ${sessionStorage.getItem("his_token")}` },
});

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const fmtDateTime = (d) =>
  d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

const todayISO = () => new Date().toISOString().slice(0, 10);

// ────────────────────────────────────────────────────────────────────
// Certificate type catalogue. Each card knows its label, glyph,
// 1-line description, NABH/legal anchor, accent colour, and the
// default typeSpecific shape used to seed the form.
// ────────────────────────────────────────────────────────────────────
const CERT_CATALOGUE = [
  {
    key: "fitness", label: "Fitness Certificate", icon: "pi-check-circle",
    color: "#10b981", bg: "#d1fae5",
    desc: "Fitness to resume duty / school / travel / sports.",
    ref: "Indian Medical Council Reg.",
    defaults: () => ({
      fitForPurpose: "work", purposeOther: "",
      fitFromDate: todayISO(), restrictions: "", validUntil: "",
    }),
  },
  {
    key: "sick-leave", label: "Sick-Leave Certificate", icon: "pi-bookmark",
    color: "#f59e0b", bg: "#fef3c7",
    desc: "Medical leave with rest duration and resume date.",
    ref: "Factories Act §73 / employer HR.",
    defaults: () => ({
      restFromDate: todayISO(), restToDate: todayISO(),
      totalRestDays: 1, reasonSummary: "", advisedFitToReturn: "",
    }),
  },
  {
    key: "discharge-fitness", label: "Discharge Fitness", icon: "pi-arrow-right-arrow-left",
    color: "#0891b2", bg: "#cffafe",
    desc: "Fit to resume normal activities after IPD admission.",
    ref: "NABH AAC.5 / COP.2.",
    defaults: () => ({
      admittedFrom: "", admittedTo: "",
      treatmentSummary: "", advisedRest: "",
      fitToResumeOn: todayISO(),
    }),
  },
  {
    key: "disability", label: "Disability Certificate", icon: "pi-user-minus",
    color: "#7c3aed", bg: "#ede9fe",
    desc: "Percent disability + category + Medical Board (RPwD §57).",
    ref: "RPwD Act 2016 §57(2).",
    defaults: () => ({
      percentDisability: 0,
      category: "locomotor",
      permanenceType: "permanent",
      validUntilIfTemporary: "",
      medicalBoardMembers: ["", "", ""],
      basisOfAssessment: "",
    }),
  },
  {
    key: "vaccination", label: "Vaccination Certificate", icon: "pi-shield",
    color: "#0ea5e9", bg: "#e0f2fe",
    desc: "Vaccine name + dose + lot + date + site.",
    ref: "IAP / UIP Vaccination Card.",
    defaults: () => ({
      vaccineName: "", manufacturer: "", lotNumber: "",
      doseNumber: 1, routeOfAdmin: "IM",
      doseDate: todayISO(), nextDoseDue: "", vaccinationSite: "",
    }),
  },
  {
    key: "pre-employment", label: "Pre-Employment Medical", icon: "pi-briefcase",
    color: "#1d4ed8", bg: "#dbeafe",
    desc: "Pre-employment exam result + fit category + validity.",
    ref: "Factories Act §40 / employer policy.",
    defaults: () => ({
      employerName: "", jobRole: "",
      examinationDate: todayISO(),
      generalCondition: "", fitCategory: "fit",
      restrictionDetails: "", validityMonths: 12,
    }),
  },
  {
    key: "insurance-claim", label: "Insurance Claim", icon: "pi-credit-card",
    color: "#db2777", bg: "#fce7f3",
    desc: "Cashless / reimbursement claim justification.",
    ref: "IRDAI claim guidelines.",
    defaults: () => ({
      insurerName: "", policyNo: "", claimType: "cashless",
      admissionRequired: false,
      estimatedDuration: "", treatmentJustification: "",
    }),
  },
  {
    key: "sterilization", label: "Sterilization Certificate", icon: "pi-times-circle",
    color: "#dc2626", bg: "#fee2e2",
    desc: "Tubectomy / Vasectomy procedure record.",
    ref: "PCPNDT / Family Welfare scheme.",
    defaults: () => ({
      procedureType: "tubectomy", procedureDate: todayISO(),
      hospitalName: "", surgeonName: "", anaesthetistName: "",
      postOpFitness: "", advisedFollowUp: "",
    }),
  },
  {
    key: "bedridden", label: "Bedridden Status", icon: "pi-heart",
    color: "#ea580c", bg: "#ffedd5",
    desc: "Bedridden status for postal voting / pension / tax.",
    ref: "Election Commission Form 12D.",
    defaults: () => ({
      bedriddenFromDate: todayISO(), expectedDuration: "",
      primaryDiagnosis: "", mobilityStatus: "",
      requiresAttendant: true, purposeOfCert: "postal-voting",
    }),
  },
  {
    key: "medico-legal", label: "Medico-Legal (MLC)", icon: "pi-shield",
    color: "#0f172a", bg: "#e2e8f0",
    desc: "MLC summary for Investigating Officer.",
    ref: "CrPC §174 / police request.",
    defaults: () => ({
      mlcNo: "", ioName: "", policeStation: "",
      brief: "", natureOfInjuries: "",
    }),
  },
  {
    key: "cause-of-death", label: "Cause of Death (Form 4)", icon: "pi-flag",
    color: "#1e293b", bg: "#e2e8f0",
    desc: "WHO Form 4 / 4A medical certificate of cause of death.",
    ref: "RBD Act 1969 / MoHFW Form 4.",
    defaults: () => ({
      dateOfDeath: todayISO(), timeOfDeath: "", placeOfDeath: "",
      immediateCause: "", antecedentCauses: ["", "", ""],
      otherSignificantConditions: "",
      mannerOfDeath: "natural", postMortemDone: false,
      postMortemFindings: "",
      attendingDoctor: "", hospitalRegNo: "",
    }),
  },
  {
    key: "birth-notification", label: "Birth Notification", icon: "pi-sun",
    color: "#10b981", bg: "#d1fae5",
    desc: "Hospital live-birth notification (Form 1 precursor).",
    ref: "RBD Act 1969 §10.",
    defaults: () => ({
      dateOfBirth: todayISO(), timeOfBirth: "", sexOfBaby: "Female",
      birthWeightGrams: 0, modeOfDelivery: "NVD", gestationalAgeWeeks: 38,
      motherName: "", motherAge: "", motherAddress: "",
      fatherName: "", attendantDoctor: "",
      healthOfBaby: "alive", placeOfBirth: "",
    }),
  },
];

const COUNTER_SIGN_TYPES = new Set(["disability", "sterilization"]);

// ────────────────────────────────────────────────────────────────────
// Tiny styled atoms (no inline-style sprawl in JSX bodies). The page is
// outside the Reception scope, so inline styles are permitted here.
// ────────────────────────────────────────────────────────────────────
const C = {
  pageBg:    "#f8fafc",
  ink:       "#0f172a",
  muted:     "#64748b",
  border:    "#e2e8f0",
  primary:   "#1d4ed8",
  primaryL:  "#dbeafe",
  success:   "#10b981",
  warn:      "#f59e0b",
  danger:    "#dc2626",
};

const Card = ({ title, icon, color = C.primary, right, children, accent }) => (
  <div style={{
    background: "white", border: `1px solid ${C.border}`, borderRadius: 12,
    marginBottom: 16, overflow: "hidden",
  }}>
    {(title || right) && (
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "12px 18px",
        borderBottom: `1px solid ${C.border}`,
        background: accent || "#fbfdff",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 700, color: C.ink }}>
          {icon && <i className={`pi ${icon}`} style={{ fontSize: 16, color }} />}
          {title}
        </div>
        {right}
      </div>
    )}
    <div style={{ padding: 18 }}>{children}</div>
  </div>
);

const Field = ({ label, children, required, half, full, span }) => (
  <div style={{
    flex: span === 3 ? "1 1 100%" : (full ? "1 1 100%" : half ? "1 1 calc(50% - 8px)" : "1 1 calc(33% - 11px)"),
    minWidth: 200, marginBottom: 12,
  }}>
    <label style={{
      display: "block", fontSize: 11, fontWeight: 600,
      color: C.ink, marginBottom: 4, textTransform: "uppercase", letterSpacing: ".4px",
    }}>
      {label} {required && <span style={{ color: C.danger }}>*</span>}
    </label>
    {children}
  </div>
);

const inputStyle = {
  width: "100%", padding: "8px 10px", border: `1px solid ${C.border}`,
  borderRadius: 6, fontSize: 13, boxSizing: "border-box",
  background: "white",
};

const Input  = (props) => <input  {...props} style={{ ...inputStyle, ...(props.style || {}) }} />;
const Textarea = (props) => (
  <textarea {...props} style={{ ...inputStyle, minHeight: 72, fontFamily: "inherit", ...(props.style || {}) }} />
);
const Select = ({ children, ...props }) => (
  <select {...props} style={{ ...inputStyle, ...(props.style || {}) }}>{children}</select>
);

const Row = ({ children }) => (
  <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>{children}</div>
);

const Button = ({ children, color = C.primary, disabled, onClick, icon, ghost, type = "button", small }) => (
  <button
    type={type}
    onClick={onClick}
    disabled={disabled}
    style={{
      background: ghost ? "white" : color, color: ghost ? color : "white",
      border: `1.5px solid ${color}`,
      padding: small ? "5px 10px" : "9px 16px",
      borderRadius: 8, fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.55 : 1, fontSize: small ? 12 : 13,
      display: "inline-flex", alignItems: "center", gap: 6,
    }}
  >
    {icon && <i className={`pi ${icon}`} />}
    {children}
  </button>
);

// ────────────────────────────────────────────────────────────────────
// Per-type form bodies. Each receives (ts, setTS) — ts = typeSpecific.
// ────────────────────────────────────────────────────────────────────
function FitnessForm({ ts, setTS }) {
  return (
    <Row>
      <Field label="Fit For Purpose" required>
        <Select value={ts.fitForPurpose} onChange={(e) => setTS({ ...ts, fitForPurpose: e.target.value })}>
          <option value="work">Work / Duty</option>
          <option value="school">School / College</option>
          <option value="travel">Travel</option>
          <option value="sports">Sports</option>
          <option value="other">Other</option>
        </Select>
      </Field>
      {ts.fitForPurpose === "other" && (
        <Field label="Purpose (specify)" required>
          <Input value={ts.purposeOther || ""} onChange={(e) => setTS({ ...ts, purposeOther: e.target.value })} />
        </Field>
      )}
      <Field label="Fit From Date" required>
        <Input type="date" value={ts.fitFromDate || ""} onChange={(e) => setTS({ ...ts, fitFromDate: e.target.value })} />
      </Field>
      <Field label="Valid Until (optional)">
        <Input type="date" value={ts.validUntil || ""} onChange={(e) => setTS({ ...ts, validUntil: e.target.value })} />
      </Field>
      <Field label="Restrictions / Advice" full>
        <Textarea value={ts.restrictions || ""} onChange={(e) => setTS({ ...ts, restrictions: e.target.value })}
          placeholder="e.g. No heavy lifting > 5 kg for 2 weeks" />
      </Field>
    </Row>
  );
}

function SickLeaveForm({ ts, setTS }) {
  const days = useMemo(() => {
    if (!ts.restFromDate || !ts.restToDate) return ts.totalRestDays || 1;
    const ms = new Date(ts.restToDate) - new Date(ts.restFromDate);
    return ms >= 0 ? Math.round(ms / 86400000) + 1 : ts.totalRestDays || 1;
  }, [ts.restFromDate, ts.restToDate, ts.totalRestDays]);

  // Keep totalRestDays in sync.
  useEffect(() => {
    if (days !== ts.totalRestDays) setTS({ ...ts, totalRestDays: days });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  return (
    <Row>
      <Field label="Rest From" required>
        <Input type="date" value={ts.restFromDate || ""} onChange={(e) => setTS({ ...ts, restFromDate: e.target.value })} />
      </Field>
      <Field label="Rest To" required>
        <Input type="date" value={ts.restToDate || ""} onChange={(e) => setTS({ ...ts, restToDate: e.target.value })} />
      </Field>
      <Field label="Total Days (auto)">
        <Input type="number" value={days} readOnly style={{ background: "#f1f5f9" }} />
      </Field>
      <Field label="Advised Fit to Return">
        <Input type="date" value={ts.advisedFitToReturn || ""} onChange={(e) => setTS({ ...ts, advisedFitToReturn: e.target.value })} />
      </Field>
      <Field label="Reason Summary" full>
        <Textarea value={ts.reasonSummary || ""} onChange={(e) => setTS({ ...ts, reasonSummary: e.target.value })}
          placeholder="e.g. Acute viral fever with myalgia" />
      </Field>
    </Row>
  );
}

function DischargeFitnessForm({ ts, setTS }) {
  return (
    <Row>
      <Field label="Admitted From" required>
        <Input type="date" value={ts.admittedFrom || ""} onChange={(e) => setTS({ ...ts, admittedFrom: e.target.value })} />
      </Field>
      <Field label="Admitted To" required>
        <Input type="date" value={ts.admittedTo || ""} onChange={(e) => setTS({ ...ts, admittedTo: e.target.value })} />
      </Field>
      <Field label="Fit to Resume On" required>
        <Input type="date" value={ts.fitToResumeOn || ""} onChange={(e) => setTS({ ...ts, fitToResumeOn: e.target.value })} />
      </Field>
      <Field label="Advised Rest (post-discharge)" half>
        <Input value={ts.advisedRest || ""} onChange={(e) => setTS({ ...ts, advisedRest: e.target.value })}
          placeholder="e.g. 7 days bedrest, light diet" />
      </Field>
      <Field label="Treatment Summary" full>
        <Textarea value={ts.treatmentSummary || ""} onChange={(e) => setTS({ ...ts, treatmentSummary: e.target.value })}
          placeholder="Brief course of treatment during admission" />
      </Field>
    </Row>
  );
}

function DisabilityForm({ ts, setTS }) {
  const setBoard = (i, v) => {
    const next = [...(ts.medicalBoardMembers || [])];
    next[i] = v;
    setTS({ ...ts, medicalBoardMembers: next });
  };
  return (
    <Row>
      <Field label="Percent Disability" required>
        <Input type="number" min="0" max="100" value={ts.percentDisability ?? 0}
          onChange={(e) => setTS({ ...ts, percentDisability: Number(e.target.value) })} />
      </Field>
      <Field label="Category" required>
        <Select value={ts.category} onChange={(e) => setTS({ ...ts, category: e.target.value })}>
          <option value="locomotor">Locomotor</option>
          <option value="visual">Visual</option>
          <option value="hearing">Hearing</option>
          <option value="mental">Mental</option>
          <option value="multiple">Multiple</option>
          <option value="other">Other</option>
        </Select>
      </Field>
      <Field label="Permanence" required>
        <Select value={ts.permanenceType} onChange={(e) => setTS({ ...ts, permanenceType: e.target.value })}>
          <option value="permanent">Permanent</option>
          <option value="temporary">Temporary</option>
        </Select>
      </Field>
      {ts.permanenceType === "temporary" && (
        <Field label="Valid Until" required>
          <Input type="date" value={ts.validUntilIfTemporary || ""}
            onChange={(e) => setTS({ ...ts, validUntilIfTemporary: e.target.value })} />
        </Field>
      )}
      <Field label="Basis of Assessment" full required>
        <Textarea value={ts.basisOfAssessment || ""} onChange={(e) => setTS({ ...ts, basisOfAssessment: e.target.value })}
          placeholder="Clinical findings + investigations forming the disability assessment" />
      </Field>
      {ts.permanenceType === "permanent" && (
        <Field label="Medical Board Members (≥ 3 required per RPwD §57(2))" full>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {[0, 1, 2].map((i) => (
              <Input key={i}
                placeholder={`Member ${i + 1} — Name, Designation, Specialty`}
                value={(ts.medicalBoardMembers || [])[i] || ""}
                onChange={(e) => setBoard(i, e.target.value)} />
            ))}
            <Button small ghost icon="pi-plus"
              onClick={() => setTS({ ...ts, medicalBoardMembers: [...(ts.medicalBoardMembers || []), ""] })}>
              Add Member
            </Button>
          </div>
        </Field>
      )}
    </Row>
  );
}

function VaccinationForm({ ts, setTS }) {
  return (
    <Row>
      <Field label="Vaccine Name" required>
        <Input value={ts.vaccineName || ""} onChange={(e) => setTS({ ...ts, vaccineName: e.target.value })} />
      </Field>
      <Field label="Manufacturer">
        <Input value={ts.manufacturer || ""} onChange={(e) => setTS({ ...ts, manufacturer: e.target.value })} />
      </Field>
      <Field label="Lot / Batch No" required>
        <Input value={ts.lotNumber || ""} onChange={(e) => setTS({ ...ts, lotNumber: e.target.value })} />
      </Field>
      <Field label="Dose Number">
        <Input type="number" min="1" max="5" value={ts.doseNumber ?? 1}
          onChange={(e) => setTS({ ...ts, doseNumber: Number(e.target.value) })} />
      </Field>
      <Field label="Route">
        <Select value={ts.routeOfAdmin || "IM"} onChange={(e) => setTS({ ...ts, routeOfAdmin: e.target.value })}>
          <option value="IM">IM</option>
          <option value="SC">SC</option>
          <option value="ID">ID</option>
          <option value="ORAL">Oral</option>
          <option value="INTRANASAL">Intranasal</option>
        </Select>
      </Field>
      <Field label="Vaccination Site">
        <Input value={ts.vaccinationSite || ""} onChange={(e) => setTS({ ...ts, vaccinationSite: e.target.value })}
          placeholder="e.g. Left deltoid" />
      </Field>
      <Field label="Dose Date" required>
        <Input type="date" value={ts.doseDate || ""} onChange={(e) => setTS({ ...ts, doseDate: e.target.value })} />
      </Field>
      <Field label="Next Dose Due (optional)">
        <Input type="date" value={ts.nextDoseDue || ""} onChange={(e) => setTS({ ...ts, nextDoseDue: e.target.value })} />
      </Field>
    </Row>
  );
}

function PreEmploymentForm({ ts, setTS }) {
  return (
    <Row>
      <Field label="Employer Name" required>
        <Input value={ts.employerName || ""} onChange={(e) => setTS({ ...ts, employerName: e.target.value })} />
      </Field>
      <Field label="Job Role">
        <Input value={ts.jobRole || ""} onChange={(e) => setTS({ ...ts, jobRole: e.target.value })} />
      </Field>
      <Field label="Examination Date" required>
        <Input type="date" value={ts.examinationDate || ""} onChange={(e) => setTS({ ...ts, examinationDate: e.target.value })} />
      </Field>
      <Field label="Fit Category" required>
        <Select value={ts.fitCategory} onChange={(e) => setTS({ ...ts, fitCategory: e.target.value })}>
          <option value="fit">Fit</option>
          <option value="fit-with-restriction">Fit with restriction</option>
          <option value="unfit">Unfit</option>
        </Select>
      </Field>
      <Field label="Validity (months)">
        <Input type="number" min="1" max="36" value={ts.validityMonths ?? 12}
          onChange={(e) => setTS({ ...ts, validityMonths: Number(e.target.value) })} />
      </Field>
      <Field label="General Condition" full>
        <Textarea value={ts.generalCondition || ""} onChange={(e) => setTS({ ...ts, generalCondition: e.target.value })}
          placeholder="General build, BMI, BP, key exam findings" />
      </Field>
      {ts.fitCategory === "fit-with-restriction" && (
        <Field label="Restriction Details" full required>
          <Textarea value={ts.restrictionDetails || ""} onChange={(e) => setTS({ ...ts, restrictionDetails: e.target.value })} />
        </Field>
      )}
    </Row>
  );
}

function InsuranceClaimForm({ ts, setTS }) {
  return (
    <Row>
      <Field label="Insurer Name" required>
        <Input value={ts.insurerName || ""} onChange={(e) => setTS({ ...ts, insurerName: e.target.value })} />
      </Field>
      <Field label="Policy No" required>
        <Input value={ts.policyNo || ""} onChange={(e) => setTS({ ...ts, policyNo: e.target.value })} />
      </Field>
      <Field label="Claim Type" required>
        <Select value={ts.claimType} onChange={(e) => setTS({ ...ts, claimType: e.target.value })}>
          <option value="cashless">Cashless</option>
          <option value="reimbursement">Reimbursement</option>
        </Select>
      </Field>
      <Field label="Admission Required">
        <Select value={ts.admissionRequired ? "yes" : "no"}
          onChange={(e) => setTS({ ...ts, admissionRequired: e.target.value === "yes" })}>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </Select>
      </Field>
      <Field label="Estimated Duration" half>
        <Input value={ts.estimatedDuration || ""} onChange={(e) => setTS({ ...ts, estimatedDuration: e.target.value })}
          placeholder="e.g. 5 days" />
      </Field>
      <Field label="Treatment Justification" full required>
        <Textarea value={ts.treatmentJustification || ""}
          onChange={(e) => setTS({ ...ts, treatmentJustification: e.target.value })}
          placeholder="Why this treatment is required, alternatives considered, expected outcome" />
      </Field>
    </Row>
  );
}

function SterilizationForm({ ts, setTS, hospitalName }) {
  // Auto-fill hospitalName from settings the first render only.
  useEffect(() => {
    if (!ts.hospitalName && hospitalName) setTS({ ...ts, hospitalName });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hospitalName]);

  return (
    <Row>
      <Field label="Procedure" required>
        <Select value={ts.procedureType} onChange={(e) => setTS({ ...ts, procedureType: e.target.value })}>
          <option value="tubectomy">Tubectomy</option>
          <option value="vasectomy">Vasectomy</option>
        </Select>
      </Field>
      <Field label="Procedure Date" required>
        <Input type="date" value={ts.procedureDate || ""} onChange={(e) => setTS({ ...ts, procedureDate: e.target.value })} />
      </Field>
      <Field label="Hospital">
        <Input value={ts.hospitalName || ""} onChange={(e) => setTS({ ...ts, hospitalName: e.target.value })} />
      </Field>
      <Field label="Surgeon" required>
        <Input value={ts.surgeonName || ""} onChange={(e) => setTS({ ...ts, surgeonName: e.target.value })} />
      </Field>
      <Field label="Anaesthetist">
        <Input value={ts.anaesthetistName || ""} onChange={(e) => setTS({ ...ts, anaesthetistName: e.target.value })} />
      </Field>
      <Field label="Post-Op Fitness" full>
        <Textarea value={ts.postOpFitness || ""} onChange={(e) => setTS({ ...ts, postOpFitness: e.target.value })} />
      </Field>
      <Field label="Advised Follow-Up" full>
        <Textarea value={ts.advisedFollowUp || ""} onChange={(e) => setTS({ ...ts, advisedFollowUp: e.target.value })} />
      </Field>
    </Row>
  );
}

function BedriddenForm({ ts, setTS }) {
  return (
    <Row>
      <Field label="Bedridden From" required>
        <Input type="date" value={ts.bedriddenFromDate || ""} onChange={(e) => setTS({ ...ts, bedriddenFromDate: e.target.value })} />
      </Field>
      <Field label="Expected Duration" half>
        <Input value={ts.expectedDuration || ""} onChange={(e) => setTS({ ...ts, expectedDuration: e.target.value })}
          placeholder="e.g. 6 months" />
      </Field>
      <Field label="Primary Diagnosis" full>
        <Input value={ts.primaryDiagnosis || ""} onChange={(e) => setTS({ ...ts, primaryDiagnosis: e.target.value })} />
      </Field>
      <Field label="Mobility Status" full>
        <Textarea value={ts.mobilityStatus || ""} onChange={(e) => setTS({ ...ts, mobilityStatus: e.target.value })}
          placeholder="Wheelchair-bound, requires assistance to transfer, etc." />
      </Field>
      <Field label="Requires Attendant">
        <Select value={ts.requiresAttendant ? "yes" : "no"}
          onChange={(e) => setTS({ ...ts, requiresAttendant: e.target.value === "yes" })}>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </Select>
      </Field>
      <Field label="Purpose of Certificate" required>
        <Select value={ts.purposeOfCert} onChange={(e) => setTS({ ...ts, purposeOfCert: e.target.value })}>
          <option value="postal-voting">Postal voting (Form 12D)</option>
          <option value="pension">Pension</option>
          <option value="tax">Income tax §80DD / §80U</option>
          <option value="other">Other</option>
        </Select>
      </Field>
    </Row>
  );
}

function MedicoLegalForm({ ts, setTS }) {
  return (
    <Row>
      <Field label="MLC Number" required>
        <Input value={ts.mlcNo || ""} onChange={(e) => setTS({ ...ts, mlcNo: e.target.value })} />
      </Field>
      <Field label="Investigating Officer" required>
        <Input value={ts.ioName || ""} onChange={(e) => setTS({ ...ts, ioName: e.target.value })} />
      </Field>
      <Field label="Police Station" required>
        <Input value={ts.policeStation || ""} onChange={(e) => setTS({ ...ts, policeStation: e.target.value })} />
      </Field>
      <Field label="Brief History" full>
        <Textarea value={ts.brief || ""} onChange={(e) => setTS({ ...ts, brief: e.target.value })} />
      </Field>
      <Field label="Nature of Injuries" full>
        <Textarea value={ts.natureOfInjuries || ""} onChange={(e) => setTS({ ...ts, natureOfInjuries: e.target.value })}
          placeholder="Simple / grievous / dangerous + each injury described per Form-MLC" />
      </Field>
    </Row>
  );
}

function CauseOfDeathForm({ ts, setTS }) {
  const setAntecedent = (i, v) => {
    const next = [...(ts.antecedentCauses || [])];
    next[i] = v;
    setTS({ ...ts, antecedentCauses: next });
  };
  return (
    <Row>
      <Field label="Date of Death" required>
        <Input type="date" value={ts.dateOfDeath || ""} onChange={(e) => setTS({ ...ts, dateOfDeath: e.target.value })} />
      </Field>
      <Field label="Time of Death (HH:MM)">
        <Input value={ts.timeOfDeath || ""} onChange={(e) => setTS({ ...ts, timeOfDeath: e.target.value })}
          placeholder="14:30" />
      </Field>
      <Field label="Place of Death">
        <Input value={ts.placeOfDeath || ""} onChange={(e) => setTS({ ...ts, placeOfDeath: e.target.value })} />
      </Field>
      <Field label="Immediate Cause (Part I-a)" full required>
        <Input value={ts.immediateCause || ""} onChange={(e) => setTS({ ...ts, immediateCause: e.target.value })}
          placeholder="The disease that directly caused death" />
      </Field>
      <Field label="Antecedent Causes (b → d)" full>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {[0, 1, 2].map((i) => (
            <Input key={i}
              placeholder={`(${String.fromCharCode(98 + i)}) due to / as consequence of`}
              value={(ts.antecedentCauses || [])[i] || ""}
              onChange={(e) => setAntecedent(i, e.target.value)} />
          ))}
        </div>
      </Field>
      <Field label="Other Significant Conditions (Part II)" full>
        <Textarea value={ts.otherSignificantConditions || ""}
          onChange={(e) => setTS({ ...ts, otherSignificantConditions: e.target.value })} />
      </Field>
      <Field label="Manner of Death">
        <Select value={ts.mannerOfDeath} onChange={(e) => setTS({ ...ts, mannerOfDeath: e.target.value })}>
          <option value="natural">Natural</option>
          <option value="accident">Accident</option>
          <option value="suicide">Suicide</option>
          <option value="homicide">Homicide</option>
          <option value="undetermined">Undetermined</option>
        </Select>
      </Field>
      <Field label="Post-Mortem Performed">
        <Select value={ts.postMortemDone ? "yes" : "no"}
          onChange={(e) => setTS({ ...ts, postMortemDone: e.target.value === "yes" })}>
          <option value="no">No</option>
          <option value="yes">Yes</option>
        </Select>
      </Field>
      {ts.postMortemDone && (
        <Field label="Post-Mortem Findings" full>
          <Textarea value={ts.postMortemFindings || ""}
            onChange={(e) => setTS({ ...ts, postMortemFindings: e.target.value })} />
        </Field>
      )}
      <Field label="Attending Doctor (name)">
        <Input value={ts.attendingDoctor || ""} onChange={(e) => setTS({ ...ts, attendingDoctor: e.target.value })} />
      </Field>
      <Field label="Hospital Registration No">
        <Input value={ts.hospitalRegNo || ""} onChange={(e) => setTS({ ...ts, hospitalRegNo: e.target.value })} />
      </Field>
    </Row>
  );
}

function BirthNotificationForm({ ts, setTS, hospitalName }) {
  useEffect(() => {
    if (!ts.placeOfBirth && hospitalName) setTS({ ...ts, placeOfBirth: hospitalName });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hospitalName]);

  return (
    <Row>
      <Field label="Date of Birth" required>
        <Input type="date" value={ts.dateOfBirth || ""} onChange={(e) => setTS({ ...ts, dateOfBirth: e.target.value })} />
      </Field>
      <Field label="Time of Birth">
        <Input value={ts.timeOfBirth || ""} onChange={(e) => setTS({ ...ts, timeOfBirth: e.target.value })}
          placeholder="HH:MM" />
      </Field>
      <Field label="Sex of Baby" required>
        <Select value={ts.sexOfBaby} onChange={(e) => setTS({ ...ts, sexOfBaby: e.target.value })}>
          <option>Female</option>
          <option>Male</option>
          <option>Indeterminate</option>
        </Select>
      </Field>
      <Field label="Birth Weight (g)" required>
        <Input type="number" min="100" max="6000" value={ts.birthWeightGrams ?? 0}
          onChange={(e) => setTS({ ...ts, birthWeightGrams: Number(e.target.value) })} />
      </Field>
      <Field label="Mode of Delivery" required>
        <Select value={ts.modeOfDelivery} onChange={(e) => setTS({ ...ts, modeOfDelivery: e.target.value })}>
          <option value="NVD">NVD</option>
          <option value="LSCS">LSCS</option>
          <option value="forceps">Forceps</option>
          <option value="vacuum">Vacuum</option>
          <option value="other">Other</option>
        </Select>
      </Field>
      <Field label="Gestational Age (weeks)">
        <Input type="number" min="20" max="44" value={ts.gestationalAgeWeeks ?? 38}
          onChange={(e) => setTS({ ...ts, gestationalAgeWeeks: Number(e.target.value) })} />
      </Field>
      <Field label="Place of Birth">
        <Input value={ts.placeOfBirth || ""} onChange={(e) => setTS({ ...ts, placeOfBirth: e.target.value })} />
      </Field>
      <Field label="Health of Baby">
        <Select value={ts.healthOfBaby} onChange={(e) => setTS({ ...ts, healthOfBaby: e.target.value })}>
          <option value="alive">Alive</option>
          <option value="stillborn">Stillborn</option>
          <option value="early-neonatal-death">Early Neonatal Death</option>
        </Select>
      </Field>
      <Field label="Mother — Name" required>
        <Input value={ts.motherName || ""} onChange={(e) => setTS({ ...ts, motherName: e.target.value })} />
      </Field>
      <Field label="Mother — Age">
        <Input value={ts.motherAge || ""} onChange={(e) => setTS({ ...ts, motherAge: e.target.value })} />
      </Field>
      <Field label="Mother — Address" full>
        <Textarea value={ts.motherAddress || ""} onChange={(e) => setTS({ ...ts, motherAddress: e.target.value })} />
      </Field>
      <Field label="Father — Name">
        <Input value={ts.fatherName || ""} onChange={(e) => setTS({ ...ts, fatherName: e.target.value })} />
      </Field>
      <Field label="Attending Doctor (delivery)">
        <Input value={ts.attendantDoctor || ""} onChange={(e) => setTS({ ...ts, attendantDoctor: e.target.value })} />
      </Field>
    </Row>
  );
}

const FORM_REGISTRY = {
  "fitness":            FitnessForm,
  "sick-leave":         SickLeaveForm,
  "discharge-fitness":  DischargeFitnessForm,
  "disability":         DisabilityForm,
  "vaccination":        VaccinationForm,
  "pre-employment":     PreEmploymentForm,
  "insurance-claim":    InsuranceClaimForm,
  "sterilization":      SterilizationForm,
  "bedridden":          BedriddenForm,
  "medico-legal":       MedicoLegalForm,
  "cause-of-death":     CauseOfDeathForm,
  "birth-notification": BirthNotificationForm,
};

// ════════════════════════════════════════════════════════════════════
// Main Page
// ════════════════════════════════════════════════════════════════════
export default function MedicalCertificatePage() {
  const { user } = useAuth();
  const settings = useHospitalSettings();

  const [patientQuery, setPatientQuery] = useState("");
  const [patientResults, setPatientResults] = useState([]);
  const [patientSearching, setPatientSearching] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [standalone, setStandalone] = useState(false);
  const [latestVisit, setLatestVisit] = useState(null);

  const [certType, setCertType] = useState("");
  const [typeSpecific, setTypeSpecific] = useState({});

  const [diagnosis, setDiagnosis] = useState("");
  const [icd10, setIcd10] = useState({ code: "", description: "" });
  const [notes, setNotes] = useState("");

  const [counterSign, setCounterSign] = useState({ name: "", reg: "" });

  const [saving, setSaving] = useState(false);
  const [recent, setRecent] = useState([]);
  const [todayCount, setTodayCount] = useState(0);

  // R7bx — MCI registration check.
  const doctorReg = String(user?.doctorDetails?.registrationNumber || "").trim();
  const doctorName = user?.fullName || "";
  const mciMissing = !doctorReg;

  // ── Patient search (debounced) ────────────────────────────────
  const searchTimer = useRef(null);
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!patientQuery || patientQuery.trim().length < 2) {
      setPatientResults([]); return;
    }
    searchTimer.current = setTimeout(async () => {
      try {
        setPatientSearching(true);
        const res = await axios.get(
          `${PATIENTS_API}/search?q=${encodeURIComponent(patientQuery.trim())}&limit=10`,
          authHdr(),
        );
        const arr = Array.isArray(res.data?.data) ? res.data.data : (res.data?.data?.patients || []);
        setPatientResults(arr);
      } catch (e) {
        // Quiet fail — the form is still useful even if search misfires.
        // eslint-disable-next-line no-console
        console.warn("patient search failed", e?.message);
      } finally {
        setPatientSearching(false);
      }
    }, 300);
    return () => clearTimeout(searchTimer.current);
  }, [patientQuery]);

  // ── Pick a patient ────────────────────────────────────────────
  const pickPatient = useCallback((p) => {
    setSelectedPatient(p);
    setPatientQuery("");
    setPatientResults([]);
    setStandalone(false);
  }, []);

  // ── Recent + today's count ────────────────────────────────────
  const fetchRecent = useCallback(async () => {
    try {
      const q = user?.id
        ? `${API}?issuedBy=&limit=10`           // (issuedBy is the Doctor _id, not user.id; safe to omit)
        : `${API}?limit=10`;
      const res = await axios.get(q, authHdr());
      const rows = res.data?.data || [];
      setRecent(rows);
      // Today's count
      const todayStr = new Date().toDateString();
      setTodayCount(rows.filter((r) => new Date(r.issuedAt).toDateString() === todayStr).length);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("Recent fetch failed", e?.message);
    }
  }, [user]);

  useEffect(() => { fetchRecent(); }, [fetchRecent]);

  // ── Choose cert type → seed typeSpecific ──────────────────────
  const onChooseType = useCallback((key) => {
    const entry = CERT_CATALOGUE.find((e) => e.key === key);
    setCertType(key);
    setTypeSpecific(entry ? entry.defaults() : {});
    if (!COUNTER_SIGN_TYPES.has(key)) setCounterSign({ name: "", reg: "" });
  }, []);

  // ── Submit ────────────────────────────────────────────────────
  const buildPayload = useCallback(() => {
    return {
      patient: selectedPatient?._id,
      visitId: latestVisit?._id || null,
      visitType: latestVisit?.visitType || "",
      certType,
      typeSpecific,
      diagnosis,
      icd10,
      doctorName,
      doctorReg,
      ...(COUNTER_SIGN_TYPES.has(certType) ? { counterSignedBy: counterSign } : {}),
      ...(notes ? { notes } : {}),
    };
  }, [selectedPatient, latestVisit, certType, typeSpecific, diagnosis, icd10, doctorName, doctorReg, counterSign, notes]);

  const submit = useCallback(async () => {
    if (mciMissing) {
      toast.error("MCI registration number missing on your profile. Update before issuing.");
      return;
    }
    if (!selectedPatient) { toast.error("Pick a patient first."); return; }
    if (!certType) { toast.error("Pick a certificate type."); return; }

    if (COUNTER_SIGN_TYPES.has(certType)) {
      if (!counterSign.name || !counterSign.reg) {
        toast.error("Counter-signing officer name and registration are required.");
        return;
      }
    }

    setSaving(true);
    try {
      const res = await axios.post(API, buildPayload(), authHdr());
      const cert = res.data?.data;
      toast.success(`Certificate ${cert?.certNumber || ""} saved.`);
      // Refresh list + reset
      fetchRecent();
      openPrint("medical-certificate", { ...cert, hospitalName: settings.hospitalName });
      // Reset form-area but keep patient/diagnosis for quick re-issue
      setTypeSpecific({});
      setCertType("");
    } catch (e) {
      const msg = e?.response?.data?.message || e?.message || "Failed to save certificate";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }, [buildPayload, fetchRecent, mciMissing, selectedPatient, certType, counterSign, settings.hospitalName]);

  // ── Recent row actions ────────────────────────────────────────
  const reprint = (row) => openPrint("medical-certificate", { ...row, hospitalName: settings.hospitalName });
  const revoke = async (row) => {
    const reason = window.prompt("Reason for revoking this certificate (≥ 5 chars):");
    if (!reason || reason.trim().length < 5) return;
    try {
      await axios.patch(`${API}/${row._id}/revoke`, { revokeReason: reason.trim() }, authHdr());
      toast.success(`Certificate ${row.certNumber} revoked.`);
      fetchRecent();
    } catch (e) {
      toast.error(e?.response?.data?.message || "Revoke failed");
    }
  };

  // ── Render ────────────────────────────────────────────────────
  const TypeForm = certType ? FORM_REGISTRY[certType] : null;
  const chosenEntry = CERT_CATALOGUE.find((e) => e.key === certType);

  return (
    <div style={{ minHeight: "100vh", background: C.pageBg, padding: 24 }}>
      <div style={{ maxWidth: 1400, margin: "0 auto" }}>

        {/* ── Hero ───────────────────────────────────── */}
        <div style={{
          background: "linear-gradient(135deg, #1e40af 0%, #6366f1 100%)",
          color: "white", borderRadius: 12, padding: 22,
          marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <i className="pi pi-id-card" style={{ fontSize: 22 }} />
              <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Medical Certificates</h1>
            </div>
            <div style={{ marginTop: 6, opacity: 0.92, fontSize: 13 }}>
              Issue NABH-compliant clinical certificates for any patient.
            </div>
          </div>
          <div style={{
            background: "rgba(255,255,255,0.18)", padding: "10px 16px",
            borderRadius: 10, textAlign: "center", minWidth: 140,
          }}>
            <div style={{ fontSize: 26, fontWeight: 800 }}>{todayCount}</div>
            <div style={{ fontSize: 11, opacity: 0.9, textTransform: "uppercase", letterSpacing: ".5px" }}>
              Issued today
            </div>
          </div>
        </div>

        {/* ── MCI Reg warning ─────────────────────────── */}
        {mciMissing && (
          <div style={{
            background: "#fef2f2", border: `1.5px solid ${C.danger}`, borderRadius: 10,
            padding: "12px 16px", marginBottom: 16, display: "flex", gap: 10, alignItems: "flex-start",
          }}>
            <i className="pi pi-exclamation-triangle" style={{ color: C.danger, fontSize: 18, marginTop: 2 }} />
            <div style={{ fontSize: 13, color: "#7f1d1d" }}>
              <strong>MCI registration number missing.</strong>{" "}
              Please update your MCI registration number from "My Profile" before issuing
              certificates (MCI Regulation 1.4.2 / R7bx invariant).
            </div>
          </div>
        )}

        {/* ── Patient picker ─────────────────────────── */}
        <Card title="1. Choose Patient" icon="pi-user" color={C.primary}>
          {!selectedPatient && (
            <div>
              <Field label="Search by UHID / Name / Mobile">
                <Input
                  value={patientQuery}
                  onChange={(e) => setPatientQuery(e.target.value)}
                  placeholder="Type at least 2 characters…"
                  autoFocus
                />
              </Field>
              {patientSearching && (
                <div style={{ fontSize: 12, color: C.muted }}>Searching…</div>
              )}
              {patientResults.length > 0 && (
                <div style={{
                  border: `1px solid ${C.border}`, borderRadius: 8,
                  background: "white", maxHeight: 280, overflowY: "auto", marginBottom: 12,
                }}>
                  {patientResults.map((p) => (
                    <div key={p._id}
                      onClick={() => pickPatient(p)}
                      style={{
                        padding: "8px 14px", borderBottom: `1px solid ${C.border}`,
                        cursor: "pointer", display: "flex", justifyContent: "space-between",
                      }}
                      onMouseDown={(e) => e.preventDefault()}>
                      <div>
                        <strong>{p.fullName}</strong>
                        <span style={{ color: C.muted, marginLeft: 8, fontSize: 12 }}>
                          {p.age ? `${p.age}Y` : ""} · {p.gender || ""} · {p.contactNumber || "—"}
                        </span>
                      </div>
                      <div style={{ color: C.primary, fontFamily: "monospace", fontSize: 12 }}>
                        {p.UHID || "—"}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
                <Button ghost icon="pi-pencil" small
                  onClick={() => { setStandalone(true); setSelectedPatient({ _id: null, fullName: "(Standalone certificate — no patient)", UHID: "", gender: "", age: "", contactNumber: "" }); }}>
                  Issue Standalone (no patient on file)
                </Button>
              </div>
            </div>
          )}
          {selectedPatient && (
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              background: C.primaryL, border: `1px solid ${C.border}`, borderRadius: 8,
              padding: "10px 14px",
            }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>
                  {selectedPatient.fullName}
                  {selectedPatient.UHID && (
                    <span style={{ color: C.primary, fontFamily: "monospace", marginLeft: 10, fontSize: 12 }}>
                      {selectedPatient.UHID}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
                  {selectedPatient.age ? `${selectedPatient.age}Y · ` : ""}
                  {selectedPatient.gender || ""}{selectedPatient.contactNumber ? ` · ${selectedPatient.contactNumber}` : ""}
                  {standalone && <span style={{ marginLeft: 8, color: C.warn, fontWeight: 600 }}>STANDALONE</span>}
                  {latestVisit && (
                    <span style={{ marginLeft: 8 }}>
                      · Latest visit: <strong>{latestVisit.visitType}</strong>
                    </span>
                  )}
                </div>
              </div>
              <Button ghost small icon="pi-times" color={C.muted}
                onClick={() => { setSelectedPatient(null); setLatestVisit(null); setStandalone(false); }}>
                Change
              </Button>
            </div>
          )}
        </Card>

        {/* ── Type picker grid ───────────────────────── */}
        {selectedPatient && !certType && (
          <Card title="2. Pick Certificate Type" icon="pi-th-large" color={C.primary}>
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
              gap: 12,
            }}>
              {CERT_CATALOGUE.map((entry) => (
                <div key={entry.key}
                  onClick={() => onChooseType(entry.key)}
                  style={{
                    border: `1.5px solid ${C.border}`, borderRadius: 10,
                    padding: 14, cursor: "pointer", background: "white",
                    transition: "all .15s",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = entry.color; e.currentTarget.style.boxShadow = `0 4px 14px ${entry.bg}`; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.boxShadow = "none"; }}
                >
                  <div style={{
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    width: 40, height: 40, borderRadius: 10, background: entry.bg, marginBottom: 8,
                  }}>
                    <i className={`pi ${entry.icon}`} style={{ fontSize: 20, color: entry.color }} />
                  </div>
                  <div style={{ fontWeight: 700, color: C.ink }}>{entry.label}</div>
                  <div style={{ fontSize: 11.5, color: C.muted, marginTop: 4, lineHeight: 1.5 }}>
                    {entry.desc}
                  </div>
                  {entry.ref && (
                    <div style={{ fontSize: 10, color: entry.color, marginTop: 6, fontWeight: 600 }}>
                      {entry.ref}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* ── Type-specific form + common footer + actions ─── */}
        {selectedPatient && certType && TypeForm && (
          <>
            <Card
              title={`3. ${chosenEntry?.label || "Details"}`}
              icon={chosenEntry?.icon}
              color={chosenEntry?.color}
              right={
                <Button ghost small icon="pi-arrow-left"
                  onClick={() => { setCertType(""); setTypeSpecific({}); }}>
                  Change Type
                </Button>
              }
            >
              <TypeForm
                ts={typeSpecific}
                setTS={setTypeSpecific}
                hospitalName={settings.hospitalName}
              />
            </Card>

            <Card title="4. Clinical Context (common to all certificates)" icon="pi-file-edit" color={C.primary}>
              <Row>
                <Field label="Clinical Diagnosis" full>
                  <Textarea value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)}
                    placeholder="Free-text clinical diagnosis the certificate is based on" />
                </Field>
                <Field label="ICD-10 Code">
                  <Input value={icd10.code}
                    onChange={(e) => setIcd10({ ...icd10, code: e.target.value })}
                    placeholder="e.g. J10.1" />
                </Field>
                <Field label="ICD-10 Description">
                  <Input value={icd10.description}
                    onChange={(e) => setIcd10({ ...icd10, description: e.target.value })}
                    placeholder="e.g. Influenza with respiratory manifestations" />
                </Field>
                <Field label="Internal Notes (not printed)" full>
                  <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
                </Field>
              </Row>
            </Card>

            {COUNTER_SIGN_TYPES.has(certType) && (
              <Card title="5. Counter-Signing Officer" icon="pi-user-plus" color={C.warn}
                accent="#fffbeb">
                <div style={{ fontSize: 12, color: C.muted, marginBottom: 10 }}>
                  A Medical Superintendent or senior doctor must counter-sign this
                  certificate. Both name and registration number are mandatory.
                </div>
                <Row>
                  <Field label="Officer Name" required>
                    <Input value={counterSign.name}
                      onChange={(e) => setCounterSign({ ...counterSign, name: e.target.value })} />
                  </Field>
                  <Field label="Officer Reg / MCI No" required>
                    <Input value={counterSign.reg}
                      onChange={(e) => setCounterSign({ ...counterSign, reg: e.target.value })} />
                  </Field>
                </Row>
              </Card>
            )}

            <Card title="6. Issuing Doctor" icon="pi-id-card" color={C.primary}>
              <Row>
                <Field label="Name">
                  <Input value={doctorName} readOnly style={{ background: "#f1f5f9" }} />
                </Field>
                <Field label="MCI Registration No">
                  <Input
                    value={doctorReg || "(missing)"}
                    readOnly
                    style={{ background: "#f1f5f9", color: mciMissing ? C.danger : C.ink, fontWeight: mciMissing ? 700 : 500 }}
                  />
                </Field>
              </Row>
            </Card>

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginBottom: 24 }}>
              <Button ghost icon="pi-refresh" onClick={() => { setCertType(""); setTypeSpecific({}); }}>
                Cancel
              </Button>
              <Button icon="pi-check" color={C.success}
                disabled={saving || mciMissing}
                onClick={submit}>
                {saving ? "Saving…" : "Save & Print Certificate"}
              </Button>
            </div>
          </>
        )}

        {/* ── Recent issued ──────────────────────────── */}
        <Card title="Recent Certificates" icon="pi-history" color={C.primary}
          right={<Button ghost small icon="pi-refresh" onClick={fetchRecent}>Refresh</Button>}>
          {recent.length === 0 ? (
            <div style={{ textAlign: "center", padding: 24, color: C.muted }}>
              <i className="pi pi-inbox" style={{ fontSize: 32, opacity: 0.4 }} />
              <div style={{ marginTop: 8 }}>No certificates issued yet.</div>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${C.border}`, textAlign: "left", color: C.muted }}>
                    <th style={{ padding: 8 }}>Cert No</th>
                    <th style={{ padding: 8 }}>Patient (UHID)</th>
                    <th style={{ padding: 8 }}>Type</th>
                    <th style={{ padding: 8 }}>Issued At</th>
                    <th style={{ padding: 8 }}>Status</th>
                    <th style={{ padding: 8, textAlign: "right" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((r) => (
                    <tr key={r._id} style={{ borderBottom: `1px solid ${C.border}` }}>
                      <td style={{ padding: 8, fontFamily: "monospace", color: C.primary }}>{r.certNumber}</td>
                      <td style={{ padding: 8 }}>
                        <strong>{r.patientName || "—"}</strong>
                        <span style={{ color: C.muted, marginLeft: 6 }}>{r.patientUHID || ""}</span>
                      </td>
                      <td style={{ padding: 8 }}>{r.certType}</td>
                      <td style={{ padding: 8 }}>{fmtDateTime(r.issuedAt)}</td>
                      <td style={{ padding: 8 }}>
                        <span style={{
                          padding: "2px 8px", borderRadius: 12, fontSize: 11, fontWeight: 600,
                          background: r.status === "revoked" ? "#fee2e2" : "#d1fae5",
                          color: r.status === "revoked" ? C.danger : C.success,
                        }}>{r.status || "issued"}</span>
                      </td>
                      <td style={{ padding: 8, textAlign: "right" }}>
                        <Button small ghost icon="pi-print" onClick={() => reprint(r)}>Re-print</Button>{" "}
                        {r.status !== "revoked" && (
                          <Button small ghost icon="pi-ban" color={C.danger} onClick={() => revoke(r)}>Revoke</Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div style={{ fontSize: 10, color: C.muted, textAlign: "center", marginTop: 12 }}>
          R7fu · Medical Certificates · NABH-compliant clinical certificate surface
        </div>
      </div>
    </div>
  );
}
