/**
 * IPDAdmissionPage.jsx
 * NABH-Compliant Inpatient Admission Form
 * Covers all 10 NABH IPD admission requirements
 */

import React, { useState, useRef, useEffect } from "react";
import axios from "axios";
import { API_ENDPOINTS } from "../../config/api";

/* ── Design tokens ── */
const C = {
  bg: "#f0f2f5",
  card: "#ffffff",
  border: "#e2e6ea",
  text: "#1a1d23",
  muted: "#6b7280",
  accent: "#7c3aed",      // IPD purple
  accentL: "#f5f3ff",
  blue: "#1e40af",
  blueL: "#eff6ff",
  green: "#16a34a",
  greenL: "#dcfce7",
  red: "#dc2626",
  redL: "#fef2f2",
  amber: "#d97706",
  amberL: "#fffbeb",
  teal: "#0d9488",
  tealL: "#f0fdfa",
  slate: "#334155",
};

/* ── Shared field style ── */
/* ── Grid helpers ── */
const G2 = ({ children, gap = 14 }) => (
  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap }}>{children}</div>
);
const G3 = ({ children }) => (
  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>{children}</div>
);
const G4 = ({ children }) => (
  <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>{children}</div>
);

/* ── Field label wrapper ── */
function F({ label, required, children, hint, span }) {
  return (
    <div style={span ? { gridColumn: `span ${span}` } : {}}>
      <label style={{
        display: "block", fontSize: 11, fontWeight: 700, color: C.muted,
        textTransform: "uppercase", letterSpacing: ".6px", marginBottom: 4,
      }}>
        {label}{required && <span style={{ color: C.red, marginLeft: 3 }}>*</span>}
      </label>
      {children}
      {hint && <div style={{ fontSize: 10, color: C.muted, marginTop: 3 }}>{hint}</div>}
    </div>
  );
}

/* ── Collapsible section card ── */
function Section({ title, icon, color = C.accent, badge, children, defaultOpen = true, nabh }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{
      background: C.card, border: `1.5px solid ${color}25`,
      borderRadius: 12, overflow: "hidden", marginBottom: 14,
      boxShadow: "0 1px 4px rgba(0,0,0,.04)",
    }}>
      <div onClick={() => setOpen(o => !o)} style={{
        padding: "11px 18px", background: color + "08",
        borderBottom: open ? `1px solid ${color}18` : "none",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        cursor: "pointer", userSelect: "none",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{
            width: 28, height: 28, borderRadius: 7, background: color + "20",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <i className={`pi ${icon}`} style={{ fontSize: 13, color }} />
          </span>
          <span style={{ fontWeight: 700, fontSize: 13, color: C.text }}>{title}</span>
          {badge && (
            <span style={{
              background: color + "18", color, border: `1px solid ${color}30`,
              fontSize: 10, fontWeight: 700, padding: "1px 8px", borderRadius: 4,
            }}>{badge}</span>
          )}
          {nabh && (
            <span style={{
              background: "#f0fdf4", color: C.green, border: "1px solid #bbf7d0",
              fontSize: 9, fontWeight: 700, padding: "1px 7px", borderRadius: 4, letterSpacing: ".8px",
            }}>NABH</span>
          )}
        </div>
        <i className={`pi ${open ? "pi-chevron-up" : "pi-chevron-down"}`}
          style={{ fontSize: 10, color: C.muted }} />
      </div>
      {open && <div style={{ padding: "16px 18px" }}>{children}</div>}
    </div>
  );
}

/* ── Radio group ── */
function RadioGroup({ name, options, value, onChange }) {
  return (
    <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 4 }}>
      {options.map(opt => (
        <label key={opt.value} style={{
          display: "flex", alignItems: "center", gap: 6,
          fontSize: 13, color: C.text, cursor: "pointer",
        }}>
          <input type="radio" name={name} value={opt.value}
            checked={value === opt.value}
            onChange={() => onChange(opt.value)}
            style={{ accentColor: C.accent }} />
          {opt.label}
        </label>
      ))}
    </div>
  );
}

/* ── Checkbox row ── */
function CheckRow({ label, checked, onChange, color = C.accent }) {
  return (
    <label style={{
      display: "flex", alignItems: "center", gap: 8,
      fontSize: 13, color: C.text, cursor: "pointer", padding: "4px 0",
    }}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}
        style={{ accentColor: color, width: 15, height: 15 }} />
      {label}
    </label>
  );
}

/* ── Status badge ── */
function StatusBadge({ label, color }) {
  return (
    <span style={{
      background: color + "18", color, border: `1px solid ${color}35`,
      fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 6,
    }}>{label}</span>
  );
}

/* ══════════════════════════════════════
   MAIN PAGE
══════════════════════════════════════ */
export default function IPDAdmissionPage() {
  const printRef = useRef();

  /* ── Step tracker ── */
  const [activeStep, setActiveStep] = useState(0);

  /* ── Form state ── */
  // Step 1 — Patient Identity
  const [identity, setIdentity] = useState({
    uhid: "", existingPatient: false,
    title: "Mr", firstName: "", middleName: "", lastName: "",
    gender: "Male", dob: "", age: "", ageUnit: "Years",
    maritalStatus: "Single", religion: "", occupation: "",
    nationality: "Indian", language: "Hindi",
    contactNumber: "", altContact: "", email: "",
    address: "", city: "", district: "", state: "", pincode: "",
    idType: "Aadhar", idNumber: "",
  });

  // Step 2 — Admission Details
  const [admission, setAdmission] = useState({
    admissionDate: new Date().toISOString().slice(0, 10),
    admissionTime: new Date().toTimeString().slice(0, 5),
    admissionType: "Planned",
    sourceOfAdmission: "OPD Referral",
    department: "", departmentId: "", attendingDoctor: "", attendingDoctorId: "", referringDoctor: "",
    ward: "", room: "", bed: "",
    chiefComplaint: "", provisionalDiagnosis: "",
    icd10Code: "", expectedLOS: "",
    specialInstructions: "",
  });

  // Step 3 — Vitals at Admission
  const [vitals, setVitals] = useState({
    bpSys: "", bpDia: "", pulse: "", temp: "", spo2: "", rr: "",
    weight: "", height: "", bmi: "",
    painScore: "0", consciousnessLevel: "Alert",
    gcs: "", pupilReaction: "Equal & Reacting",
  });

  // Step 4 — Allergy Declaration
  const [allergies, setAllergies] = useState({
    noKnownAllergies: false,
    drugAllergy: false, drugAllergyDetails: "",
    foodAllergy: false, foodAllergyDetails: "",
    environmentalAllergy: false, envAllergyDetails: "",
    contrastAllergy: false, latexAllergy: false,
    otherAllergy: "", allergyNotes: "",
  });

  // Step 5 — Payment & Insurance
  const [payment, setPayment] = useState({
    paymentType: "General",
    tpaName: "", policyNumber: "", policyHolder: "",
    sumInsured: "", coPayPercent: "",
    corporateName: "", employeeId: "",
    govtSchemeName: "", govtSchemeId: "",
    estimatedCost: "", advancePaid: "",
  });

  // Step 6 — MLC & Legal
  const [mlc, setMlc] = useState({
    isMLC: false, mlcNumber: "", mlcReason: "",
    policeStation: "", policeOfficer: "", firNumber: "",
    mlcNotes: "",
  });

  // Step 7 — Attendant / Guardian
  const [attendant, setAttendant] = useState({
    name: "", relationship: "", contactNumber: "",
    address: "", idType: "Aadhar", idNumber: "",
    isLegalGuardian: false,
  });

  // Step 8 — Diet & Activity Orders
  const [orders, setOrders] = useState({
    diet: "Normal Hospital Diet", dietNotes: "",
    activity: "Bed Rest", activityNotes: "",
    isolation: "None", isolationReason: "",
    fallRisk: "Low", pressureUlcerRisk: "Low",
    specialEquipment: [],
  });

  // Step 9 — Consents
  const [consents, setConsents] = useState({
    generalConsent: false, generalConsentDate: "", generalConsentBy: "",
    procedureConsent: false,
    bloodConsent: false,
    anesthesiaConsent: false,
    patientRights: false,
    dataPrivacy: false,
    witnessName: "", witnessRelation: "",
  });

  // Step 10 — Nursing Admission Note
  const [nursingNote, setNursingNote] = useState({
    nurseName: "", nurseId: "",
    admissionWeight: "", admissionHeight: "",
    skinIntact: true, skinNotes: "",
    ivAccess: false, ivSite: "",
    urinaryCatheter: false,
    oxygenSupport: false, oxygenLPM: "",
    personalBelongings: "",
    patientEducationGiven: false,
    nursingAdmissionNote: "",
  });

  const [submitted, setSubmitted] = useState(false);
  const [ipdNo, setIpdNo] = useState("");
  const [admitError, setAdmitError] = useState("");
  const [admitting, setAdmitting] = useState(false);

  // Available beds from API
  const [availableBeds, setAvailableBeds] = useState([]);
  const [bedsLoading, setBedsLoading] = useState(false);

  // Departments & doctors (API-driven for IPD ownership)
  const [departments, setDepartments] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [doctorsLoading, setDoctorsLoading] = useState(false);
  const [selectedDeptId, setSelectedDeptId] = useState("");
  const [selectedDoctorUserId, setSelectedDoctorUserId] = useState("");

  useEffect(() => {
    const token = localStorage.getItem("his_token");
    const headers = token ? { Authorization: `Bearer ${token}` } : {};

    // Load beds
    setBedsLoading(true);
    fetch(`${API_ENDPOINTS.BEDS}/available`, { headers })
      .then(r => r.json())
      .then(d => setAvailableBeds(Array.isArray(d.data) ? d.data : Array.isArray(d) ? d : []))
      .catch(() => setAvailableBeds([]))
      .finally(() => setBedsLoading(false));

    // Load departments
    axios.get(API_ENDPOINTS.DEPARTMENTS, { headers })
      .then(res => {
        const list = Array.isArray(res.data) ? res.data : res.data?.departments || res.data?.data || [];
        setDepartments(list);
      })
      .catch(() => setDepartments([]));
  }, []);

  // Load doctors when department changes
  useEffect(() => {
    if (!selectedDeptId) { setDoctors([]); return; }
    const token = localStorage.getItem("his_token");
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    setDoctorsLoading(true);
    setSelectedDoctorUserId("");
    setAdmission(prev => ({ ...prev, attendingDoctor: "", attendingDoctorId: "" }));
    axios.get(`${API_ENDPOINTS.USERS}/department/${selectedDeptId}`, { headers })
      .then(res => {
        const list = Array.isArray(res.data) ? res.data : res.data?.users || res.data?.data || [];
        setDoctors(list.filter(u => u.role === "Doctor" || !u.role));
      })
      .catch(() => setDoctors([]))
      .finally(() => setDoctorsLoading(false));
  }, [selectedDeptId]);

  /* ── Steps config ── */
  const STEPS = [
    { label: "Patient Identity",     icon: "pi-id-card",        color: C.blue },
    { label: "Admission Details",    icon: "pi-calendar-plus",  color: C.accent },
    { label: "Vitals",               icon: "pi-heart",          color: C.red },
    { label: "Allergies",            icon: "pi-exclamation-triangle", color: C.amber },
    { label: "Payment",              icon: "pi-credit-card",    color: C.teal },
    { label: "MLC / Legal",          icon: "pi-shield",         color: C.slate },
    { label: "Attendant",            icon: "pi-users",          color: C.green },
    { label: "Diet & Orders",        icon: "pi-list-check",     color: C.blue },
    { label: "Consents",             icon: "pi-file-check",     color: C.accent },
    { label: "Nursing Note",         icon: "pi-pencil",         color: "#db2777" },
  ];

  const upd = (setter) => (field) => (e) =>
    setter(prev => ({ ...prev, [field]: e.target ? e.target.value : e }));

  /* ── Auto BMI ── */
  const calcBMI = (w, h) => {
    const wn = parseFloat(w), hn = parseFloat(h) / 100;
    if (wn && hn) return (wn / (hn * hn)).toFixed(1);
    return "";
  };

  const handlePrint = () => window.print();

  const handleSubmit = async () => {
    if (!identity.firstName || !identity.lastName || !identity.contactNumber) {
      setAdmitError("Patient name and contact number are required.");
      setActiveStep(0);
      return;
    }
    if (!admission.department || !admission.attendingDoctor || !admission.chiefComplaint) {
      setAdmitError("Department, doctor and chief complaint are required.");
      setActiveStep(1);
      return;
    }
    setAdmitError("");
    setAdmitting(true);
    try {
      const token = localStorage.getItem("his_token");
      const headers = token ? { Authorization: `Bearer ${token}` } : {};

      // 1 — Use already-resolved IDs from dropdowns
      if (!selectedDeptId) throw new Error("Please select a department.");
      if (!selectedDoctorUserId) throw new Error("Please select an attending doctor.");
      const matchedDept = departments.find(d => d._id === selectedDeptId) || { _id: selectedDeptId, name: admission.department };
      const matchedDoctor = doctors.find(d => d._id === selectedDoctorUserId) || { _id: selectedDoctorUserId };

      // 2 — Create / register patient
      const TITLE_MAP = { "Mr": "Mr.", "Mrs": "Mrs.", "Ms": "Miss", "Dr": "Dr.", "Master": "Master", "Baby": "Baby", "Baby of": "Baby" };
      const resolvedTitle = TITLE_MAP[identity.title] || identity.title || "Mr.";
      // Derive DOB from age if not provided
      let resolvedDOB = identity.dob;
      if (!resolvedDOB && identity.age) {
        const d = new Date();
        d.setFullYear(d.getFullYear() - parseInt(identity.age));
        resolvedDOB = d.toISOString().slice(0, 10);
      }
      const patientPayload = {
        registrationType: "IPD",
        title: resolvedTitle,
        firstName: identity.firstName,
        middleName: identity.middleName,
        lastName: identity.lastName,
        fullName: `${identity.title} ${identity.firstName} ${identity.middleName ? identity.middleName + " " : ""}${identity.lastName}`.trim(),
        gender: identity.gender,
        dateOfBirth: resolvedDOB,
        age: identity.age ? Number(identity.age) : undefined,
        maritalStatus: identity.maritalStatus,
        contactNumber: identity.contactNumber,
        email: identity.email || undefined,
        address: {
          completeAddress: identity.address || "Not provided",
          city: identity.city || "Not provided",
          district: identity.district || "Not provided",
          state: identity.state || "Not provided",
          pincode: identity.pincode || "000000",
        },
        bloodGroup: identity.bloodGroup || undefined,
        paymentType: payment.paymentType === "General" ? "GENERAL" : payment.paymentType.toUpperCase(),
        isMLC: mlc.isMLC,
        mlcNumber: mlc.mlcNumber || undefined,
        companionName: attendant.name || undefined,
        companionRelationship: attendant.relationship || undefined,
        companionContact: attendant.contactNumber || undefined,
        department: matchedDept._id,
        // doctor field on patient references Doctor model; omit here since IPD ownership is via attendingDoctorId on admission
      };
      const patientRes = await axios.post(API_ENDPOINTS.PATIENTS, patientPayload, { headers });
      const patient = patientRes.data?.data || patientRes.data?.patient || patientRes.data;

      // 3 — Create admission
      const doctorFullName = matchedDoctor.fullName ||
        `${matchedDoctor.firstName || ""} ${matchedDoctor.lastName || ""}`.trim() ||
        admission.attendingDoctor;
      const admissionPayload = {
        patientId: patient._id,
        UHID: patient.UHID,
        patientName: patient.fullName,
        contactNumber: identity.contactNumber,
        admissionType: admission.admissionType,
        admissionDate: admission.admissionDate,
        department: matchedDept.name || admission.department,
        departmentId: matchedDept._id,
        attendingDoctor: doctorFullName,
        attendingDoctorId: selectedDoctorUserId,
        referringDoctor: admission.referringDoctor || undefined,
        reasonForAdmission: admission.chiefComplaint,
        expectedDischargeDate: admission.expectedLOS
          ? new Date(new Date(admission.admissionDate).getTime() + Number(admission.expectedLOS) * 86400000).toISOString()
          : undefined,
        specialInstructions: admission.specialInstructions || undefined,
        bedNumber: admission.bed || undefined,
        wardName: admission.ward || undefined,
        estimatedCost: payment.estimatedCost ? Number(payment.estimatedCost) : undefined,
        advancePaid: payment.advancePaid ? Number(payment.advancePaid) : undefined,
        status: "Active",
      };
      const admRes = await axios.post(API_ENDPOINTS.ADMISSIONS, admissionPayload, { headers });
      const adm = admRes.data?.data || admRes.data?.admission || admRes.data;
      setIpdNo(adm.admissionNumber || patient.patientId || patient.UHID);
      setSubmitted(true);
    } catch (err) {
      setAdmitError(err.response?.data?.message || err.message || "Admission failed. Please try again.");
    } finally {
      setAdmitting(false);
    }
  };

  /* ── Step nav ── */
  const canProceed = () => {
    if (activeStep === 0) return identity.firstName && identity.lastName && identity.contactNumber;
    if (activeStep === 1) return admission.department && admission.attendingDoctor && admission.chiefComplaint;
    return true;
  };

  if (submitted) {
    return <SuccessScreen ipdNo={ipdNo} identity={identity} admission={admission}
      onPrint={handlePrint} onNew={() => setSubmitted(false)} />;
  }

  return (
    <div style={{ fontFamily: "'DM Sans', sans-serif", background: C.bg, minHeight: "100vh" }}>
      {/* ── Page header ── */}
      <div style={{
        background: "white", borderBottom: `2px solid ${C.accent}20`,
        padding: "14px 24px", display: "flex", alignItems: "center",
        justifyContent: "space-between", marginBottom: 20,
        borderRadius: 12, boxShadow: "0 1px 6px rgba(0,0,0,.06)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10,
            background: `linear-gradient(135deg, ${C.accent}, ${C.blue})`,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <i className="pi pi-plus-circle" style={{ fontSize: 18, color: "white" }} />
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 17, color: C.text }}>IPD Admission</div>
            <div style={{ fontSize: 11, color: C.muted }}>Inpatient Department • NABH Compliant</div>
          </div>
          <span style={{
            background: C.accentL, color: C.accent, border: `1px solid ${C.accent}30`,
            fontSize: 10, fontWeight: 700, padding: "3px 10px", borderRadius: 5, letterSpacing: ".8px",
          }}>NABH STANDARD</span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={handlePrint} style={{
            padding: "7px 16px", border: `1.5px solid ${C.border}`,
            borderRadius: 8, background: "white", cursor: "pointer",
            fontSize: 12, fontWeight: 600, color: C.muted,
            display: "flex", alignItems: "center", gap: 6,
          }}>
            <i className="pi pi-print" style={{ fontSize: 12 }} /> Print Form
          </button>
          {admitError && (
            <span style={{ fontSize: 11, color: C.red, fontWeight: 600, maxWidth: 260 }}>{admitError}</span>
          )}
          <button onClick={handleSubmit} disabled={admitting} style={{
            padding: "7px 20px", border: "none",
            borderRadius: 8, background: admitting ? C.muted : `linear-gradient(135deg, ${C.accent}, ${C.blue})`,
            cursor: admitting ? "not-allowed" : "pointer", fontSize: 12, fontWeight: 700, color: "white",
            display: "flex", alignItems: "center", gap: 6, boxShadow: admitting ? "none" : "0 2px 8px rgba(124,58,237,.3)",
          }}>
            <i className={`pi ${admitting ? "pi-spin pi-spinner" : "pi-check-circle"}`} style={{ fontSize: 12 }} />
            {admitting ? "Admitting…" : "Admit Patient"}
          </button>
        </div>
      </div>

      {/* ── Step progress bar ── */}
      <div style={{
        background: "white", borderRadius: 12, padding: "14px 20px",
        marginBottom: 20, boxShadow: "0 1px 4px rgba(0,0,0,.05)",
        overflowX: "auto",
      }}>
        <div style={{ display: "flex", gap: 4, minWidth: 800 }}>
          {STEPS.map((step, i) => (
            <button key={i} onClick={() => setActiveStep(i)} style={{
              flex: 1, padding: "8px 6px", border: "none", borderRadius: 8,
              background: activeStep === i ? step.color + "15" : "transparent",
              cursor: "pointer", textAlign: "center",
              borderBottom: activeStep === i ? `2.5px solid ${step.color}` : "2.5px solid transparent",
              transition: "all .15s",
            }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                <div style={{
                  width: 28, height: 28, borderRadius: "50%",
                  background: activeStep === i ? step.color : (i < activeStep ? C.green : C.border),
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  {i < activeStep
                    ? <i className="pi pi-check" style={{ fontSize: 11, color: "white" }} />
                    : <i className={`pi ${step.icon}`} style={{ fontSize: 11, color: activeStep === i ? "white" : C.muted }} />
                  }
                </div>
                <span style={{
                  fontSize: 10, fontWeight: 600,
                  color: activeStep === i ? step.color : (i < activeStep ? C.green : C.muted),
                  lineHeight: 1.2, whiteSpace: "nowrap",
                }}>{step.label}</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* ── Step content ── */}
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        {activeStep === 0 && <StepIdentity data={identity} upd={upd(setIdentity)} />}
        {activeStep === 1 && <StepAdmission data={admission} upd={upd(setAdmission)} />}
        {activeStep === 2 && <StepVitals data={vitals} setData={setVitals} calcBMI={calcBMI} upd={upd(setVitals)} />}
        {activeStep === 3 && <StepAllergies data={allergies} setData={setAllergies} upd={upd(setAllergies)} />}
        {activeStep === 4 && <StepPayment data={payment} upd={upd(setPayment)} />}
        {activeStep === 5 && <StepMLC data={mlc} setData={setMlc} upd={upd(setMlc)} />}
        {activeStep === 6 && <StepAttendant data={attendant} setData={setAttendant} upd={upd(setAttendant)} />}
        {activeStep === 7 && <StepOrders data={orders} setData={setOrders} upd={upd(setOrders)} />}
        {activeStep === 8 && <StepConsents data={consents} setData={setConsents} upd={upd(setConsents)} />}
        {activeStep === 9 && <StepNursing data={nursingNote} setData={setNursingNote} upd={upd(setNursingNote)} />}
      </div>

      {/* ── Navigation buttons ── */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "16px 24px", background: "white",
        borderTop: `1px solid ${C.border}`, marginTop: 20,
        borderRadius: 12, boxShadow: "0 -2px 8px rgba(0,0,0,.04)",
        position: "sticky", bottom: 0,
      }}>
        <button onClick={() => setActiveStep(s => Math.max(0, s - 1))}
          disabled={activeStep === 0}
          style={{
            padding: "9px 22px", border: `1.5px solid ${C.border}`,
            borderRadius: 8, background: "white", cursor: activeStep === 0 ? "not-allowed" : "pointer",
            fontSize: 13, fontWeight: 600, color: activeStep === 0 ? C.muted : C.text,
            display: "flex", alignItems: "center", gap: 7,
          }}>
          <i className="pi pi-chevron-left" style={{ fontSize: 11 }} /> Previous
        </button>

        <div style={{ fontSize: 12, color: C.muted, fontWeight: 600 }}>
          Step {activeStep + 1} of {STEPS.length} — <span style={{ color: STEPS[activeStep].color }}>{STEPS[activeStep].label}</span>
        </div>

        {activeStep < STEPS.length - 1 ? (
          <button onClick={() => setActiveStep(s => s + 1)}
            style={{
              padding: "9px 22px", border: "none",
              borderRadius: 8,
              background: canProceed()
                ? `linear-gradient(135deg, ${STEPS[activeStep].color}, ${C.blue})`
                : C.border,
              cursor: "pointer",
              fontSize: 13, fontWeight: 700, color: "white",
              display: "flex", alignItems: "center", gap: 7,
              boxShadow: canProceed() ? "0 2px 8px rgba(124,58,237,.25)" : "none",
            }}>
            Next <i className="pi pi-chevron-right" style={{ fontSize: 11 }} />
          </button>
        ) : (
          <button onClick={handleSubmit} disabled={admitting} style={{
            padding: "9px 24px", border: "none", borderRadius: 8,
            background: admitting ? C.muted : `linear-gradient(135deg, ${C.green}, #15803d)`,
            cursor: admitting ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 700, color: "white",
            display: "flex", alignItems: "center", gap: 7,
            boxShadow: admitting ? "none" : "0 2px 8px rgba(22,163,74,.3)",
          }}>
            <i className={`pi ${admitting ? "pi-spin pi-spinner" : "pi-check-circle"}`} style={{ fontSize: 13 }} />
            {admitting ? "Admitting…" : "Admit Patient"}
          </button>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════
   STEP 1 — PATIENT IDENTITY
══════════════════════════════════════ */
function StepIdentity({ data, upd }) {
  const [searchMode, setSearchMode] = useState(false);
  return (
    <div>
      {/* Existing patient search */}
      <div style={{
        background: C.blueL, border: `1.5px solid ${C.blue}25`, borderRadius: 12,
        padding: "14px 18px", marginBottom: 16,
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <i className="pi pi-search" style={{ fontSize: 16, color: C.blue }} />
          <div>
            <div style={{ fontWeight: 700, fontSize: 13, color: C.text }}>Existing Patient?</div>
            <div style={{ fontSize: 11, color: C.muted }}>Search by UHID, name, or mobile to pre-fill details</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input placeholder="Search UHID / Name / Mobile..." className="his-field" style={{ width: 260, borderColor: C.blue + "40", }} />
          <button style={{
            padding: "7px 16px", background: C.blue, color: "white",
            border: "none", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600,
          }}>Search</button>
        </div>
      </div>

      <Section title="Patient Identification" icon="pi-id-card" color={C.blue} nabh defaultOpen>
        <G4>
          <F label="Title" required>
            <select className="his-select" value={data.title} onChange={upd("title")}>
              {["Mr", "Mrs", "Ms", "Dr", "Master", "Baby", "Baby of"].map(t => <option key={t}>{t}</option>)}
            </select>
          </F>
          <F label="First Name" required>
            <input className="his-field" value={data.firstName} onChange={upd("firstName")} placeholder="First name" />
          </F>
          <F label="Middle Name">
            <input className="his-field" value={data.middleName} onChange={upd("middleName")} placeholder="Middle name" />
          </F>
          <F label="Last Name" required>
            <input className="his-field" value={data.lastName} onChange={upd("lastName")} placeholder="Last name" />
          </F>
        </G4>

        <div style={{ height: 12 }} />

        <G4>
          <F label="Gender" required>
            <select className="his-select" value={data.gender} onChange={upd("gender")}>
              {["Male", "Female", "Other", "Unknown"].map(g => <option key={g}>{g}</option>)}
            </select>
          </F>
          <F label="Date of Birth">
            <input type="date" className="his-field" value={data.dob} onChange={upd("dob")} />
          </F>
          <F label="Age" required>
            <div style={{ display: "flex", gap: 6 }}>
              <input className="his-field" style={{ width: "60%" }} value={data.age} onChange={upd("age")} placeholder="e.g. 45" type="number" />
              <select className="his-select" style={{ width: "40%" }} value={data.ageUnit} onChange={upd("ageUnit")}>
                {["Years", "Months", "Days"].map(u => <option key={u}>{u}</option>)}
              </select>
            </div>
          </F>
          <F label="Marital Status">
            <select className="his-select" value={data.maritalStatus} onChange={upd("maritalStatus")}>
              {["Single", "Married", "Widowed", "Divorced", "Separated", "Unknown"].map(s => <option key={s}>{s}</option>)}
            </select>
          </F>
        </G4>

        <div style={{ height: 12 }} />

        <G4>
          <F label="Blood Group">
            <select className="his-select" value={data.bloodGroup} onChange={upd("bloodGroup")}>
              <option value="">Select</option>
              {["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-", "Unknown"].map(b => <option key={b}>{b}</option>)}
            </select>
          </F>
          <F label="Religion">
            <select className="his-select" value={data.religion} onChange={upd("religion")}>
              <option value="">Select</option>
              {["Hindu", "Muslim", "Christian", "Sikh", "Jain", "Buddhist", "Other"].map(r => <option key={r}>{r}</option>)}
            </select>
          </F>
          <F label="Occupation">
            <input className="his-field" value={data.occupation} onChange={upd("occupation")} placeholder="Occupation" />
          </F>
          <F label="Preferred Language">
            <select className="his-select" value={data.language} onChange={upd("language")}>
              {["Hindi", "English", "Marathi", "Bengali", "Tamil", "Telugu", "Gujarati", "Kannada", "Other"].map(l => <option key={l}>{l}</option>)}
            </select>
          </F>
        </G4>
      </Section>

      <Section title="Contact & Address" icon="pi-map-marker" color={C.teal} nabh>
        <G3>
          <F label="Primary Contact" required>
            <input className="his-field" value={data.contactNumber} onChange={upd("contactNumber")}
              placeholder="+91 XXXXX XXXXX" type="tel" />
          </F>
          <F label="Alternate Contact">
            <input className="his-field" value={data.altContact} onChange={upd("altContact")}
              placeholder="+91 XXXXX XXXXX" type="tel" />
          </F>
          <F label="Email Address">
            <input className="his-field" value={data.email} onChange={upd("email")}
              placeholder="patient@email.com" type="email" />
          </F>
        </G3>
        <div style={{ height: 12 }} />
        <F label="Complete Address" required span={3}>
          <textarea className="his-textarea" value={data.address} onChange={upd("address")}
            placeholder="House No., Street, Locality..." />
        </F>
        <div style={{ height: 10 }} />
        <G4>
          <F label="City"><input className="his-field" value={data.city} onChange={upd("city")} placeholder="City" /></F>
          <F label="District"><input className="his-field" value={data.district} onChange={upd("district")} placeholder="District" /></F>
          <F label="State">
            <select className="his-select" value={data.state} onChange={upd("state")}>
              <option value="">Select State</option>
              {["Maharashtra", "Delhi", "Karnataka", "Tamil Nadu", "Uttar Pradesh", "Gujarat",
                "Rajasthan", "West Bengal", "Madhya Pradesh", "Andhra Pradesh", "Other"].map(s =>
                <option key={s}>{s}</option>)}
            </select>
          </F>
          <F label="Pincode"><input className="his-field" value={data.pincode} onChange={upd("pincode")} placeholder="400001" /></F>
        </G4>
      </Section>

      <Section title="Identification Document" icon="pi-verified" color={C.green} nabh>
        <G3>
          <F label="ID Proof Type" required>
            <select className="his-select" value={data.idType} onChange={upd("idType")}>
              {["Aadhar Card", "PAN Card", "Passport", "Voter ID", "Driving Licence",
                "Ration Card", "ABHA Card", "Other"].map(t => <option key={t}>{t}</option>)}
            </select>
          </F>
          <F label="ID Number" required>
            <input className="his-field" value={data.idNumber} onChange={upd("idNumber")} placeholder="Enter ID number" />
          </F>
          <F label="ABHA ID (Ayushman Bharat)">
            <input className="his-field" placeholder="14-digit ABHA number" />
          </F>
        </G3>
      </Section>
    </div>
  );
}

/* ══════════════════════════════════════
   STEP 2 — ADMISSION DETAILS
══════════════════════════════════════ */
function StepAdmission({ data, upd }) {
  return (
    <div>
      <Section title="Admission Information" icon="pi-calendar-plus" color={C.accent} nabh defaultOpen>
        <G4>
          <F label="Admission Date" required>
            <input type="date" className="his-field" value={data.admissionDate} onChange={upd("admissionDate")} />
          </F>
          <F label="Admission Time" required>
            <input type="time" className="his-field" value={data.admissionTime} onChange={upd("admissionTime")} />
          </F>
          <F label="Admission Type" required>
            <select className="his-select" value={data.admissionType} onChange={upd("admissionType")}>
              {["Planned", "Emergency", "Transfer – Internal", "Transfer – External", "Day Care", "LAMA Re-admission"].map(t =>
                <option key={t}>{t}</option>)}
            </select>
          </F>
          <F label="Source of Admission" required>
            <select className="his-select" value={data.sourceOfAdmission} onChange={upd("sourceOfAdmission")}>
              {["OPD Referral", "Emergency", "Direct Admission", "Inter-Hospital Transfer",
                "ICU Step-Down", "Daycare to IPD", "Walk-In"].map(s => <option key={s}>{s}</option>)}
            </select>
          </F>
        </G4>

        <div style={{ height: 12 }} />

        <G3>
          <F label="Department / Speciality" required>
            <select className="his-select" value={selectedDeptId} onChange={e => {
              const deptId = e.target.value;
              const dept = departments.find(d => d._id === deptId);
              setSelectedDeptId(deptId);
              setAdmission(prev => ({ ...prev, department: dept?.name || "", departmentId: deptId }));
            }}>
              <option value="">Select Department</option>
              {departments.map(d => <option key={d._id} value={d._id}>{d.name}</option>)}
              {departments.length === 0 && <option disabled>Loading departments...</option>}
            </select>
          </F>
          <F label="Attending Doctor" required hint={doctorsLoading ? "Loading doctors..." : selectedDeptId && doctors.length === 0 ? "No doctors in this department" : ""}>
            <select className="his-select" value={selectedDoctorUserId} onChange={e => {
              const uid = e.target.value;
              const doc = doctors.find(d => d._id === uid);
              const docName = doc ? (doc.fullName || `${doc.firstName || ""} ${doc.lastName || ""}`.trim()) : "";
              setSelectedDoctorUserId(uid);
              setAdmission(prev => ({ ...prev, attendingDoctor: docName, attendingDoctorId: uid }));
            }} disabled={!selectedDeptId || doctorsLoading}>
              <option value="">{doctorsLoading ? "Loading..." : "Select Doctor"}</option>
              {doctors.map(d => (
                <option key={d._id} value={d._id}>
                  {d.fullName || `${d.firstName || ""} ${d.lastName || ""}`.trim()}
                  {d.doctorDetails?.registrationNumber ? ` (${d.doctorDetails.registrationNumber})` : ""}
                </option>
              ))}
            </select>
          </F>
          <F label="Referring Doctor">
            <input className="his-field" value={data.referringDoctor} onChange={upd("referringDoctor")}
              placeholder="Dr. Name (Referring)" />
          </F>
        </G3>
      </Section>

      <Section title="Bed Allocation" icon="pi-table" color={C.teal} nabh>
        <G3>
          <F label="Ward" required>
            <select className="his-select" value={data.ward} onChange={upd("ward")}>
              <option value="">Select Ward</option>
              {["General Ward – Male", "General Ward – Female", "ICU", "CCU",
                "Semi-Private", "Private", "Paediatric Ward", "Maternity Ward",
                "Isolation Ward", "Emergency Ward"].map(w => <option key={w}>{w}</option>)}
            </select>
          </F>
          <F label="Room Number">
            <input className="his-field" value={data.room} onChange={upd("room")} placeholder="e.g. 201" />
          </F>
          <F label="Bed Number" required>
            <input className="his-field" value={data.bed} onChange={upd("bed")} placeholder="e.g. B-04" />
          </F>
        </G3>

        {/* Visual bed availability indicator */}
        <div style={{
          marginTop: 14, padding: "12px 16px", background: "#f8fafc",
          border: `1px solid ${C.border}`, borderRadius: 8,
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, marginBottom: 10, letterSpacing: ".6px" }}>
            WARD BED AVAILABILITY
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {["B-01", "B-02", "B-03", "B-04", "B-05", "B-06", "B-07", "B-08"].map((bed, i) => (
              <button key={bed} onClick={() => upd("bed")({ target: { value: bed } })} style={{
                padding: "6px 14px", borderRadius: 6, border: "1.5px solid",
                cursor: i % 3 === 0 ? "not-allowed" : "pointer",
                borderColor: i % 3 === 0 ? "#fca5a5" : data.bed === bed ? C.teal : "#86efac",
                background: i % 3 === 0 ? "#fef2f2" : data.bed === bed ? C.tealL : "#f0fdf4",
                color: i % 3 === 0 ? C.red : data.bed === bed ? C.teal : C.green,
                fontSize: 12, fontWeight: 600,
              }}>
                {bed} {i % 3 === 0 ? "●" : "○"}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 16, marginTop: 10, fontSize: 11, color: C.muted }}>
            <span><span style={{ color: C.green }}>○</span> Available</span>
            <span><span style={{ color: C.red }}>●</span> Occupied</span>
            <span><span style={{ color: C.teal }}>○</span> Selected</span>
          </div>
        </div>
      </Section>

      <Section title="Clinical Reason for Admission" icon="pi-file-edit" color={C.blue} nabh>
        <G2>
          <F label="Chief Complaint / Presenting Illness" required>
            <textarea className="his-textarea" value={data.chiefComplaint} onChange={upd("chiefComplaint")}
              placeholder="Describe the main complaint and duration..." />
          </F>
          <F label="Provisional Diagnosis" required>
            <textarea className="his-textarea" value={data.provisionalDiagnosis} onChange={upd("provisionalDiagnosis")}
              placeholder="Provisional diagnosis at time of admission..." />
          </F>
        </G2>
        <div style={{ height: 12 }} />
        <G3>
          <F label="ICD-10 Code">
            <input className="his-field" value={data.icd10Code} onChange={upd("icd10Code")} placeholder="e.g. J18.0" />
          </F>
          <F label="Expected Length of Stay">
            <div style={{ display: "flex", gap: 6 }}>
              <input className="his-field" style={{ width: "60%" }} value={data.expectedLOS} onChange={upd("expectedLOS")}
                type="number" placeholder="e.g. 5" />
              <span className="his-field" style={{ width: "40%", background: "#f8fafc", color: C.muted, textAlign: "center" }}>Days</span>
            </div>
          </F>
          <F label="Special Instructions">
            <input className="his-field" value={data.specialInstructions} onChange={upd("specialInstructions")}
              placeholder="Any special notes..." />
          </F>
        </G3>
      </Section>
    </div>
  );
}

/* ══════════════════════════════════════
   STEP 3 — VITALS AT ADMISSION
══════════════════════════════════════ */
function StepVitals({ data, setData, calcBMI, upd }) {
  const handleVital = (field) => (e) => {
    const val = e.target.value;
    setData(prev => {
      const next = { ...prev, [field]: val };
      if (field === "weight" || field === "height") {
        next.bmi = calcBMI(
          field === "weight" ? val : prev.weight,
          field === "height" ? val : prev.height
        );
      }
      return next;
    });
  };

  const bmiColor = () => {
    const b = parseFloat(data.bmi);
    if (!b) return C.muted;
    if (b < 18.5) return C.amber;
    if (b < 25) return C.green;
    if (b < 30) return C.amber;
    return C.red;
  };

  const bmiLabel = () => {
    const b = parseFloat(data.bmi);
    if (!b) return "";
    if (b < 18.5) return "Underweight";
    if (b < 25) return "Normal";
    if (b < 30) return "Overweight";
    return "Obese";
  };

  return (
    <div>
      <Section title="Vital Signs at Admission" icon="pi-heart" color={C.red} nabh defaultOpen>
        <div style={{ marginBottom: 14 }}>
          <div style={{
            padding: "8px 14px", background: C.redL, border: `1px solid ${C.red}25`,
            borderRadius: 8, fontSize: 11, color: C.red, fontWeight: 600,
          }}>
            <i className="pi pi-info-circle" style={{ marginRight: 6 }} />
            NABH Requirement: Vital signs must be recorded at the time of admission for all IPD patients.
          </div>
        </div>

        {/* BP */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".6px", display: "block", marginBottom: 6 }}>
            Blood Pressure (mmHg)
          </label>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input className="his-field" style={{ width: 100 }} value={data.bpSys} onChange={upd("bpSys")}
              placeholder="Sys" type="number" />
            <span style={{ fontSize: 18, color: C.muted, fontWeight: 700 }}>/</span>
            <input className="his-field" style={{ width: 100 }} value={data.bpDia} onChange={upd("bpDia")}
              placeholder="Dia" type="number" />
            <span style={{ fontSize: 12, color: C.muted }}>mmHg</span>
            {data.bpSys && data.bpDia && (
              <StatusBadge
                label={parseInt(data.bpSys) > 140 || parseInt(data.bpDia) > 90 ? "Hypertension" : parseInt(data.bpSys) < 90 ? "Hypotension" : "Normal"}
                color={parseInt(data.bpSys) > 140 || parseInt(data.bpDia) > 90 ? C.red : parseInt(data.bpSys) < 90 ? C.amber : C.green}
              />
            )}
          </div>
        </div>

        <G4>
          <F label="Pulse Rate" hint="beats/min">
            <div style={{ display: "flex", gap: 6 }}>
              <input className="his-field" value={data.pulse} onChange={upd("pulse")} placeholder="72" type="number" />
              {data.pulse && <StatusBadge label={parseInt(data.pulse) > 100 ? "Tachycardia" : parseInt(data.pulse) < 60 ? "Bradycardia" : "Normal"}
                color={parseInt(data.pulse) > 100 || parseInt(data.pulse) < 60 ? C.amber : C.green} />}
            </div>
          </F>
          <F label="Temperature" hint="°F">
            <div style={{ display: "flex", gap: 6 }}>
              <input className="his-field" value={data.temp} onChange={upd("temp")} placeholder="98.6" type="number" step="0.1" />
              {data.temp && <StatusBadge label={parseFloat(data.temp) > 99.5 ? "Fever" : "Normal"}
                color={parseFloat(data.temp) > 99.5 ? C.red : C.green} />}
            </div>
          </F>
          <F label="SpO₂" hint="% oxygen saturation">
            <div style={{ display: "flex", gap: 6 }}>
              <input className="his-field" value={data.spo2} onChange={upd("spo2")} placeholder="98" type="number" />
              {data.spo2 && <StatusBadge label={parseInt(data.spo2) < 94 ? "Low" : "Normal"}
                color={parseInt(data.spo2) < 94 ? C.red : C.green} />}
            </div>
          </F>
          <F label="Respiratory Rate" hint="breaths/min">
            <input className="his-field" value={data.rr} onChange={upd("rr")} placeholder="16" type="number" />
          </F>
        </G4>

        <div style={{ height: 14 }} />

        <G4>
          <F label="Weight (kg)">
            <input className="his-field" value={data.weight} onChange={handleVital("weight")} placeholder="65.0" type="number" step="0.1" />
          </F>
          <F label="Height (cm)">
            <input className="his-field" value={data.height} onChange={handleVital("height")} placeholder="170" type="number" />
          </F>
          <F label="BMI">
            <div className="his-field" style={{ background: "#f8fafc", display: "flex", alignItems: "center", gap: 8, }}>
              <span style={{ fontWeight: 700, color: bmiColor() }}>{data.bmi || "—"}</span>
              {data.bmi && <span style={{ fontSize: 10, color: bmiColor(), fontWeight: 600 }}>{bmiLabel()}</span>}
            </div>
          </F>
          <F label="GCS Score" hint="3–15">
            <input className="his-field" value={data.gcs} onChange={upd("gcs")} placeholder="15" type="number" min="3" max="15" />
          </F>
        </G4>

        <div style={{ height: 14 }} />

        <G3>
          <F label="Consciousness Level" required>
            <select className="his-select" value={data.consciousnessLevel} onChange={upd("consciousnessLevel")}>
              {["Alert", "Verbal Response", "Pain Response", "Unresponsive", "Sedated", "Confused"].map(c =>
                <option key={c}>{c}</option>)}
            </select>
          </F>
          <F label="Pain Score (0–10)">
            <div>
              <input type="range" min="0" max="10" value={data.painScore}
                onChange={upd("painScore")}
                style={{ width: "100%", accentColor: parseInt(data.painScore) > 6 ? C.red : parseInt(data.painScore) > 3 ? C.amber : C.green }} />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: C.muted }}>
                <span>0 No pain</span>
                <span style={{ fontWeight: 700, fontSize: 14,
                  color: parseInt(data.painScore) > 6 ? C.red : parseInt(data.painScore) > 3 ? C.amber : C.green }}>
                  {data.painScore}
                </span>
                <span>10 Worst</span>
              </div>
            </div>
          </F>
          <F label="Pupil Reaction">
            <select className="his-select" value={data.pupilReaction} onChange={upd("pupilReaction")}>
              {["Equal & Reacting", "Unequal", "Non-Reacting", "Sluggish", "Not Assessed"].map(p =>
                <option key={p}>{p}</option>)}
            </select>
          </F>
        </G3>
      </Section>
    </div>
  );
}

/* ══════════════════════════════════════
   STEP 4 — ALLERGY DECLARATION
══════════════════════════════════════ */
function StepAllergies({ data, setData, upd }) {
  const toggle = (field) => (val) => setData(p => ({ ...p, [field]: val }));
  return (
    <div>
      <Section title="Allergy Declaration" icon="pi-exclamation-triangle" color={C.amber} nabh defaultOpen>
        <div style={{
          padding: "10px 14px", background: C.amberL, border: `1px solid ${C.amber}30`,
          borderRadius: 8, marginBottom: 16, fontSize: 12, color: C.amber, fontWeight: 600,
        }}>
          <i className="pi pi-shield" style={{ marginRight: 6 }} />
          NABH Standard: Allergy status must be documented for every admitted patient. Undeclared allergy shall not be assumed as "No Known Allergy".
        </div>

        <CheckRow label="No Known Allergies (NKDA)" checked={data.noKnownAllergies}
          onChange={toggle("noKnownAllergies")} color={C.green} />

        {!data.noKnownAllergies && (
          <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 14 }}>
            {[
              { key: "drugAllergy",          detailKey: "drugAllergyDetails",  label: "Drug / Medication Allergy",  color: C.red,    placeholder: "e.g. Penicillin – Anaphylaxis, Aspirin – Rash" },
              { key: "foodAllergy",           detailKey: "foodAllergyDetails",  label: "Food Allergy",               color: C.amber,  placeholder: "e.g. Peanuts, Shellfish, Milk protein" },
              { key: "environmentalAllergy",  detailKey: "envAllergyDetails",   label: "Environmental / Contact",   color: C.blue,   placeholder: "e.g. Dust, Pollen, Latex" },
            ].map(item => (
              <div key={item.key} style={{
                padding: "12px 14px", border: `1.5px solid ${data[item.key] ? item.color + "40" : C.border}`,
                borderRadius: 10, background: data[item.key] ? item.color + "06" : "#fafafa",
              }}>
                <CheckRow label={item.label} checked={data[item.key]}
                  onChange={toggle(item.key)} color={item.color} />
                {data[item.key] && (
                  <div style={{ marginTop: 10 }}>
                    <textarea className="his-textarea" style={{ borderColor: item.color + "40", minHeight: 56 }}
                      value={data[item.detailKey]}
                      onChange={upd(item.detailKey)}
                      placeholder={item.placeholder} />
                  </div>
                )}
              </div>
            ))}

            <G2>
              <div style={{ padding: "10px 14px", border: `1.5px solid ${C.border}`, borderRadius: 10 }}>
                <CheckRow label="Contrast Media Allergy" checked={data.contrastAllergy}
                  onChange={toggle("contrastAllergy")} color={C.accent} />
              </div>
              <div style={{ padding: "10px 14px", border: `1.5px solid ${C.border}`, borderRadius: 10 }}>
                <CheckRow label="Latex Allergy" checked={data.latexAllergy}
                  onChange={toggle("latexAllergy")} color={C.accent} />
              </div>
            </G2>

            <F label="Other Allergies / Additional Notes">
              <textarea className="his-textarea" value={data.allergyNotes} onChange={upd("allergyNotes")}
                placeholder="Any other allergies or relevant notes..." />
            </F>
          </div>
        )}

        {data.noKnownAllergies && (
          <div style={{
            marginTop: 14, padding: "12px 16px",
            background: C.greenL, border: `1px solid ${C.green}30`, borderRadius: 8,
            display: "flex", alignItems: "center", gap: 8,
          }}>
            <i className="pi pi-check-circle" style={{ fontSize: 16, color: C.green }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: C.green }}>
              Patient / Attendant has confirmed No Known Drug / Food Allergies
            </span>
          </div>
        )}
      </Section>
    </div>
  );
}

/* ══════════════════════════════════════
   STEP 5 — PAYMENT & INSURANCE
══════════════════════════════════════ */
function StepPayment({ data, upd }) {
  return (
    <div>
      <Section title="Payment & Insurance Details" icon="pi-credit-card" color={C.teal} nabh defaultOpen>
        <F label="Payment Category" required>
          <RadioGroup name="paymentType"
            options={[
              { value: "General",     label: "General (Self Pay)" },
              { value: "TPA",         label: "TPA / Insurance" },
              { value: "Corporate",   label: "Corporate / CGHS" },
              { value: "Government",  label: "Government Scheme" },
              { value: "Free",        label: "Free / Charitable" },
            ]}
            value={data.paymentType}
            onChange={v => upd("paymentType")({ target: { value: v } })}
          />
        </F>

        {data.paymentType === "TPA" && (
          <div style={{ marginTop: 14, padding: "14px 16px", background: C.tealL, borderRadius: 10, border: `1px solid ${C.teal}25` }}>
            <div style={{ fontWeight: 700, fontSize: 12, color: C.teal, marginBottom: 12 }}>TPA / Insurance Details</div>
            <G3>
              <F label="TPA / Insurance Company" required>
                <select className="his-select" value={data.tpaName} onChange={upd("tpaName")}>
                  <option value="">Select TPA</option>
                  {["Star Health", "HDFC ERGO", "United India", "National Insurance",
                    "New India Assurance", "Oriental Insurance", "Bajaj Allianz",
                    "ICICI Lombard", "Medi Assist", "Vipul Medcorp", "Other"].map(t =>
                    <option key={t}>{t}</option>)}
                </select>
              </F>
              <F label="Policy Number" required>
                <input className="his-field" value={data.policyNumber} onChange={upd("policyNumber")} placeholder="Policy number" />
              </F>
              <F label="Policy Holder Name">
                <input className="his-field" value={data.policyHolder} onChange={upd("policyHolder")} placeholder="Name on policy" />
              </F>
              <F label="Sum Insured (₹)">
                <input className="his-field" value={data.sumInsured} onChange={upd("sumInsured")} placeholder="500000" type="number" />
              </F>
              <F label="Co-Pay (%)" hint="Patient bears this % of bill">
                <input className="his-field" value={data.coPayPercent} onChange={upd("coPayPercent")} placeholder="0" type="number" />
              </F>
            </G3>
          </div>
        )}

        {data.paymentType === "Corporate" && (
          <div style={{ marginTop: 14, padding: "14px 16px", background: "#f0fdf4", borderRadius: 10, border: `1px solid ${C.green}25` }}>
            <div style={{ fontWeight: 700, fontSize: 12, color: C.green, marginBottom: 12 }}>Corporate / CGHS Details</div>
            <G3>
              <F label="Company / Organisation" required>
                <input className="his-field" value={data.corporateName} onChange={upd("corporateName")} placeholder="Company name" />
              </F>
              <F label="Employee ID" required>
                <input className="his-field" value={data.employeeId} onChange={upd("employeeId")} placeholder="EMP12345" />
              </F>
            </G3>
          </div>
        )}

        {data.paymentType === "Government" && (
          <div style={{ marginTop: 14, padding: "14px 16px", background: "#eff6ff", borderRadius: 10, border: `1px solid ${C.blue}25` }}>
            <div style={{ fontWeight: 700, fontSize: 12, color: C.blue, marginBottom: 12 }}>Government Scheme Details</div>
            <G3>
              <F label="Scheme Name" required>
                <select className="his-select" value={data.govtSchemeName} onChange={upd("govtSchemeName")}>
                  <option value="">Select Scheme</option>
                  {["Ayushman Bharat PM-JAY", "CGHS", "ECHS", "Mahatma Phule Jan Arogya",
                    "Mukhyamantri Samagra Swasthya Bima", "ESI", "State Government Scheme", "Other"].map(s =>
                    <option key={s}>{s}</option>)}
                </select>
              </F>
              <F label="Scheme Beneficiary ID" required>
                <input className="his-field" value={data.govtSchemeId} onChange={upd("govtSchemeId")} placeholder="Beneficiary ID" />
              </F>
            </G3>
          </div>
        )}

        <div style={{ height: 14 }} />
        <G3>
          <F label="Estimated Treatment Cost (₹)">
            <input className="his-field" value={data.estimatedCost} onChange={upd("estimatedCost")}
              placeholder="Estimated amount" type="number" />
          </F>
          <F label="Advance Collected (₹)">
            <input className="his-field" value={data.advancePaid} onChange={upd("advancePaid")}
              placeholder="Amount received" type="number" />
          </F>
          <F label="Receipt / Transaction Ref">
            <input className="his-field" placeholder="Receipt number" />
          </F>
        </G3>
      </Section>
    </div>
  );
}

/* ══════════════════════════════════════
   STEP 6 — MLC / LEGAL
══════════════════════════════════════ */
function StepMLC({ data, setData, upd }) {
  const toggle = (field) => (val) => setData(p => ({ ...p, [field]: val }));
  return (
    <div>
      <Section title="Medico-Legal Case (MLC)" icon="pi-shield" color={C.slate} nabh defaultOpen>
        <div style={{
          padding: "10px 14px", background: "#f8fafc", border: `1px solid ${C.slate}25`,
          borderRadius: 8, marginBottom: 16, fontSize: 12, color: C.slate, fontWeight: 600,
        }}>
          <i className="pi pi-info-circle" style={{ marginRight: 6 }} />
          NABH Requirement: MLC status must be recorded. Police intimation is mandatory for MLC cases as per law.
        </div>

        <div style={{
          padding: "14px 16px", border: `2px solid ${data.isMLC ? C.red + "50" : C.border}`,
          borderRadius: 10, background: data.isMLC ? C.redL : "#fafafa",
        }}>
          <CheckRow
            label="This is a Medico-Legal Case (MLC)"
            checked={data.isMLC}
            onChange={toggle("isMLC")}
            color={C.red}
          />

          {data.isMLC && (
            <div style={{ marginTop: 14 }}>
              <G3>
                <F label="MLC Number" required>
                  <input className="his-field" value={data.mlcNumber} onChange={upd("mlcNumber")} placeholder="MLC/2025/XXXX" />
                </F>
                <F label="MLC Reason" required>
                  <select className="his-select" value={data.mlcReason} onChange={upd("mlcReason")}>
                    <option value="">Select Reason</option>
                    {["Road Traffic Accident", "Assault / Violence", "Burns", "Poisoning",
                      "Alleged Rape / Sexual Assault", "Suicide Attempt", "Industrial Accident",
                      "Fall from Height", "Unknown / Unconscious Patient", "Other"].map(r =>
                      <option key={r}>{r}</option>)}
                  </select>
                </F>
                <F label="FIR Number">
                  <input className="his-field" value={data.firNumber} onChange={upd("firNumber")} placeholder="FIR number if available" />
                </F>
              </G3>
              <div style={{ height: 12 }} />
              <G2>
                <F label="Police Station">
                  <input className="his-field" value={data.policeStation} onChange={upd("policeStation")} placeholder="Police station name" />
                </F>
                <F label="Police Officer Name / Badge">
                  <input className="his-field" value={data.policeOfficer} onChange={upd("policeOfficer")} placeholder="Officer name / badge no." />
                </F>
              </G2>
              <div style={{ height: 12 }} />
              <F label="MLC Notes / Circumstances">
                <textarea className="his-textarea" value={data.mlcNotes} onChange={upd("mlcNotes")}
                  placeholder="Describe circumstances of the medico-legal case..." />
              </F>
            </div>
          )}
        </div>

        {!data.isMLC && (
          <div style={{
            marginTop: 12, padding: "10px 14px", background: C.greenL,
            border: `1px solid ${C.green}25`, borderRadius: 8,
            display: "flex", alignItems: "center", gap: 8,
          }}>
            <i className="pi pi-check-circle" style={{ fontSize: 14, color: C.green }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: C.green }}>Not a Medico-Legal Case</span>
          </div>
        )}
      </Section>
    </div>
  );
}

/* ══════════════════════════════════════
   STEP 7 — ATTENDANT / GUARDIAN
══════════════════════════════════════ */
function StepAttendant({ data, setData, upd }) {
  return (
    <div>
      <Section title="Attendant / Guardian Details" icon="pi-users" color={C.green} nabh defaultOpen>
        <div style={{
          padding: "10px 14px", background: C.greenL, border: `1px solid ${C.green}25`,
          borderRadius: 8, marginBottom: 16, fontSize: 12, color: C.green, fontWeight: 600,
        }}>
          <i className="pi pi-info-circle" style={{ marginRight: 6 }} />
          NABH Requirement: At least one emergency contact / attendant must be recorded for all IPD patients.
        </div>

        <G3>
          <F label="Attendant Full Name" required>
            <input className="his-field" value={data.name} onChange={upd("name")} placeholder="Full name" />
          </F>
          <F label="Relationship to Patient" required>
            <select className="his-select" value={data.relationship} onChange={upd("relationship")}>
              <option value="">Select</option>
              {["Spouse", "Father", "Mother", "Son", "Daughter", "Brother", "Sister",
                "Friend", "Legal Guardian", "Employer", "Other"].map(r => <option key={r}>{r}</option>)}
            </select>
          </F>
          <F label="Contact Number" required>
            <input className="his-field" value={data.contactNumber} onChange={upd("contactNumber")}
              placeholder="+91 XXXXX XXXXX" type="tel" />
          </F>
        </G3>

        <div style={{ height: 12 }} />

        <F label="Attendant Address">
          <textarea className="his-textarea" style={{ minHeight: 56 }} value={data.address} onChange={upd("address")}
            placeholder="Address if different from patient..." />
        </F>

        <div style={{ height: 12 }} />

        <G3>
          <F label="ID Proof Type">
            <select className="his-select" value={data.idType} onChange={upd("idType")}>
              {["Aadhar Card", "PAN Card", "Passport", "Voter ID", "Driving Licence", "Other"].map(t =>
                <option key={t}>{t}</option>)}
            </select>
          </F>
          <F label="ID Number">
            <input className="his-field" value={data.idNumber} onChange={upd("idNumber")} placeholder="ID number" />
          </F>
          <F label="Legal Guardian Status">
            <div style={{ marginTop: 6 }}>
              <CheckRow
                label="Is the Legal / Authorised Guardian"
                checked={data.isLegalGuardian}
                onChange={v => setData(p => ({ ...p, isLegalGuardian: v }))}
                color={C.green}
              />
            </div>
          </F>
        </G3>
      </Section>
    </div>
  );
}

/* ══════════════════════════════════════
   STEP 8 — DIET & ORDERS
══════════════════════════════════════ */
function StepOrders({ data, setData, upd }) {
  const equipOptions = ["Ventilator", "IV Pump", "Cardiac Monitor", "Pulse Oximeter",
    "Suction Machine", "BiPAP", "CPAP", "Feeding Pump"];
  const toggleEquip = (eq) => setData(prev => ({
    ...prev,
    specialEquipment: prev.specialEquipment.includes(eq)
      ? prev.specialEquipment.filter(e => e !== eq)
      : [...prev.specialEquipment, eq],
  }));

  return (
    <div>
      <Section title="Diet Orders" icon="pi-apple" color={C.green} nabh defaultOpen>
        <G2>
          <F label="Diet Type" required>
            <select className="his-select" value={data.diet} onChange={upd("diet")}>
              {["Normal Hospital Diet", "Soft Diet", "Liquid Diet", "Clear Liquid", "NPO (Nothing by Mouth)",
                "Diabetic Diet", "Low Sodium", "Low Fat", "High Protein", "Renal Diet",
                "Cardiac Diet", "Tube Feeding", "TPN (Total Parenteral Nutrition)", "Other"].map(d =>
                <option key={d}>{d}</option>)}
            </select>
          </F>
          <F label="Diet Notes / Special Instructions">
            <textarea className="his-textarea" style={{ minHeight: 56 }} value={data.dietNotes} onChange={upd("dietNotes")}
              placeholder="Specific dietary instructions, preferences, restrictions..." />
          </F>
        </G2>
      </Section>

      <Section title="Activity & Mobility Orders" icon="pi-walking" color={C.blue} nabh>
        <G2>
          <F label="Activity Level" required>
            <select className="his-select" value={data.activity} onChange={upd("activity")}>
              {["Bed Rest", "Bed Rest with Bathroom Privileges", "Chair Rest",
                "Ambulate with Assistance", "Ambulate Independently",
                "No Restrictions", "Physical Therapy Required"].map(a =>
                <option key={a}>{a}</option>)}
            </select>
          </F>
          <F label="Activity Notes">
            <textarea className="his-textarea" style={{ minHeight: 56 }} value={data.activityNotes} onChange={upd("activityNotes")}
              placeholder="Additional activity instructions..." />
          </F>
        </G2>
      </Section>

      <Section title="Isolation Precautions" icon="pi-lock" color={C.amber} nabh>
        <G3>
          <F label="Isolation Type">
            <select className="his-select" value={data.isolation} onChange={upd("isolation")}>
              {["None", "Standard Precautions", "Contact Precautions", "Droplet Precautions",
                "Airborne Precautions", "Reverse / Protective Isolation", "Strict Isolation"].map(i =>
                <option key={i}>{i}</option>)}
            </select>
          </F>
          {data.isolation !== "None" && (
            <F label="Reason for Isolation">
              <input className="his-field" value={data.isolationReason} onChange={upd("isolationReason")}
                placeholder="Reason / diagnosis requiring isolation" />
            </F>
          )}
        </G3>
      </Section>

      <Section title="Risk Assessment" icon="pi-exclamation-circle" color={C.red} nabh>
        <G3>
          <F label="Fall Risk Assessment">
            <select className="his-select" value={data.fallRisk} onChange={upd("fallRisk")}>
              {["Low", "Medium", "High"].map(r => <option key={r}>{r}</option>)}
            </select>
          </F>
          <F label="Pressure Ulcer Risk (Braden)">
            <select className="his-select" value={data.pressureUlcerRisk} onChange={upd("pressureUlcerRisk")}>
              {["Low (19–23)", "Mild Risk (15–18)", "Moderate Risk (13–14)",
                "High Risk (10–12)", "Severe Risk (≤9)"].map(r => <option key={r}>{r}</option>)}
            </select>
          </F>
        </G3>
      </Section>

      <Section title="Special Equipment Required" icon="pi-cog" color={C.teal}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {equipOptions.map(eq => (
            <button key={eq} onClick={() => toggleEquip(eq)} style={{
              padding: "6px 14px", borderRadius: 20, border: "1.5px solid",
              borderColor: data.specialEquipment.includes(eq) ? C.teal : C.border,
              background: data.specialEquipment.includes(eq) ? C.tealL : "white",
              color: data.specialEquipment.includes(eq) ? C.teal : C.muted,
              cursor: "pointer", fontSize: 12, fontWeight: 600, transition: "all .15s",
            }}>
              {data.specialEquipment.includes(eq) && <i className="pi pi-check" style={{ marginRight: 5, fontSize: 10 }} />}
              {eq}
            </button>
          ))}
        </div>
      </Section>
    </div>
  );
}

/* ══════════════════════════════════════
   STEP 9 — CONSENTS
══════════════════════════════════════ */
function StepConsents({ data, setData, upd }) {
  const toggle = (field) => (val) => setData(p => ({ ...p, [field]: val }));
  const allRequired = data.generalConsent && data.patientRights && data.dataPrivacy;

  return (
    <div>
      <div style={{
        padding: "12px 16px", background: "#fffbeb", border: `1.5px solid ${C.amber}40`,
        borderRadius: 10, marginBottom: 16, fontSize: 12, color: C.amber, fontWeight: 600,
      }}>
        <i className="pi pi-exclamation-circle" style={{ marginRight: 6 }} />
        NABH Requirement (COP.4): Informed consent must be obtained before initiating treatment.
        General Consent, Patient Rights & Data Privacy are mandatory for all IPD admissions.
      </div>

      <Section title="Mandatory Consents" icon="pi-file-check" color={C.accent} nabh defaultOpen
        badge={allRequired ? "Complete" : "Pending"}>
        {[
          { key: "generalConsent",    label: "General Consent for Treatment & Procedures",
            desc: "Patient / Guardian consents to routine medical care, nursing procedures, diagnostic tests, and treatment by authorised hospital staff." },
          { key: "patientRights",     label: "Patient Rights & Responsibilities Acknowledgment",
            desc: "Patient / Guardian has been informed of and acknowledges their rights and responsibilities as per NABH Patient Rights & Education standard." },
          { key: "dataPrivacy",       label: "Data Privacy & Information Disclosure Consent",
            desc: "Patient consents to sharing of clinical data for treatment purposes within the hospital, as per the hospital's privacy policy." },
        ].map(item => (
          <div key={item.key} style={{
            marginBottom: 12, padding: "14px 16px", border: `1.5px solid`,
            borderColor: data[item.key] ? C.green + "50" : C.border,
            borderRadius: 10, background: data[item.key] ? C.greenL : "#fafafa",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: C.text, marginBottom: 4 }}>{item.label}</div>
                <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.5 }}>{item.desc}</div>
              </div>
              <CheckRow label={data[item.key] ? "Obtained" : "Pending"}
                checked={data[item.key]} onChange={toggle(item.key)} color={C.green} />
            </div>
          </div>
        ))}
      </Section>

      <Section title="Clinical Consents (as applicable)" icon="pi-clipboard" color={C.blue}>
        <G2>
          {[
            { key: "procedureConsent",   label: "Consent for Surgical / Invasive Procedure" },
            { key: "bloodConsent",       label: "Consent for Blood / Blood Product Transfusion" },
            { key: "anesthesiaConsent",  label: "Consent for Anaesthesia" },
          ].map(item => (
            <div key={item.key} style={{
              padding: "12px 14px", border: `1.5px solid`,
              borderColor: data[item.key] ? C.blue + "40" : C.border,
              borderRadius: 10, background: data[item.key] ? C.blueL : "#fafafa",
            }}>
              <CheckRow label={item.label} checked={data[item.key]} onChange={toggle(item.key)} color={C.blue} />
            </div>
          ))}
        </G2>
      </Section>

      <Section title="Witness Details" icon="pi-user-edit" color={C.teal}>
        <G2>
          <F label="Witness Name">
            <input className="his-field" value={data.witnessName} onChange={upd("witnessName")} placeholder="Witness full name" />
          </F>
          <F label="Witness Relationship">
            <input className="his-field" value={data.witnessRelation} onChange={upd("witnessRelation")} placeholder="e.g. Nurse, Staff" />
          </F>
        </G2>
        <div style={{ height: 12 }} />
        <G2>
          <F label="General Consent Date">
            <input type="date" className="his-field" value={data.generalConsentDate} onChange={upd("generalConsentDate")} />
          </F>
          <F label="Consent Obtained By">
            <input className="his-field" value={data.generalConsentBy} onChange={upd("generalConsentBy")} placeholder="Staff name / ID" />
          </F>
        </G2>
      </Section>
    </div>
  );
}

/* ══════════════════════════════════════
   STEP 10 — NURSING ADMISSION NOTE
══════════════════════════════════════ */
function StepNursing({ data, setData, upd }) {
  const toggle = (field) => (val) => setData(p => ({ ...p, [field]: val }));
  return (
    <div>
      <Section title="Nursing Admission Assessment" icon="pi-pencil" color="#db2777" nabh defaultOpen>
        <G3>
          <F label="Admitting Nurse Name" required>
            <input className="his-field" value={data.nurseName} onChange={upd("nurseName")} placeholder="Nurse name" />
          </F>
          <F label="Nurse Employee ID">
            <input className="his-field" value={data.nurseId} onChange={upd("nurseId")} placeholder="EMP ID" />
          </F>
        </G3>

        <div style={{ height: 14 }} />

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontWeight: 700, fontSize: 12, color: C.muted, letterSpacing: ".6px", textTransform: "uppercase" }}>
            Equipment / Devices at Admission
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {[
              { key: "ivAccess",          label: "IV Access",              detailKey: "ivSite",    placeholder: "IV site location" },
              { key: "urinaryCatheter",   label: "Urinary Catheter",       detailKey: null,         placeholder: null },
              { key: "oxygenSupport",     label: "Oxygen Support",         detailKey: "oxygenLPM",  placeholder: "O₂ flow (LPM)" },
            ].map(item => (
              <div key={item.key} style={{
                padding: "10px 14px", border: `1.5px solid`,
                borderColor: data[item.key] ? "#db277750" : C.border,
                borderRadius: 10, background: data[item.key] ? "#fdf2f8" : "#fafafa",
              }}>
                <CheckRow label={item.label} checked={data[item.key]} onChange={toggle(item.key)} color="#db2777" />
                {item.detailKey && data[item.key] && (
                  <input className="his-field" style={{ marginTop: 8 }} value={data[item.detailKey]}
                    onChange={upd(item.detailKey)} placeholder={item.placeholder} />
                )}
              </div>
            ))}
          </div>
        </div>

        <div style={{ height: 14 }} />

        <G2>
          <F label="Skin Integrity">
            <div style={{ marginTop: 4 }}>
              <RadioGroup name="skinIntact"
                options={[{ value: true, label: "Intact" }, { value: false, label: "Not Intact (document)" }]}
                value={data.skinIntact}
                onChange={v => setData(p => ({ ...p, skinIntact: v }))}
              />
              {!data.skinIntact && (
                <textarea className="his-textarea" style={{ marginTop: 8, minHeight: 56 }}
                  value={data.skinNotes} onChange={upd("skinNotes")}
                  placeholder="Describe skin condition, wounds, pressure injuries..." />
              )}
            </div>
          </F>
          <F label="Patient Belongings / Valuables">
            <textarea className="his-textarea" style={{ minHeight: 56 }} value={data.personalBelongings} onChange={upd("personalBelongings")}
              placeholder="List items: e.g. mobile phone, jewellery, spectacles, wallet..." />
          </F>
        </G2>

        <div style={{ height: 14 }} />

        <CheckRow label="Patient / Attendant education given (ward orientation, call bell, falls prevention)"
          checked={data.patientEducationGiven}
          onChange={toggle("patientEducationGiven")}
          color="#db2777"
        />

        <div style={{ height: 12 }} />
        <F label="Nursing Admission Note" required>
          <textarea className="his-textarea" style={{ minHeight: 100 }} value={data.nursingAdmissionNote} onChange={upd("nursingAdmissionNote")}
            placeholder="Brief nursing admission note — condition on arrival, significant observations, immediate care given..." />
        </F>
      </Section>

      {/* Summary review card */}
      <div style={{
        padding: "16px 18px", background: C.accentL, border: `1.5px solid ${C.accent}30`,
        borderRadius: 12, marginTop: 4,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <i className="pi pi-check-circle" style={{ fontSize: 18, color: C.accent }} />
          <span style={{ fontWeight: 700, fontSize: 14, color: C.text }}>Ready to Admit</span>
        </div>
        <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.7 }}>
          You have completed all 10 NABH-required IPD admission steps. Click <strong>Admit Patient</strong> to
          register the admission, allocate the bed, and generate the IPD number.
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════
   SUCCESS SCREEN
══════════════════════════════════════ */
function SuccessScreen({ ipdNo, identity, admission, onPrint, onNew }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", minHeight: "70vh", padding: 40,
      fontFamily: "'DM Sans', sans-serif",
    }}>
      <div style={{
        background: "white", borderRadius: 20, padding: "40px 48px",
        boxShadow: "0 8px 40px rgba(0,0,0,.12)", maxWidth: 560, width: "100%", textAlign: "center",
      }}>
        <div style={{
          width: 72, height: 72, borderRadius: "50%",
          background: `linear-gradient(135deg, ${C.green}, #15803d)`,
          display: "flex", alignItems: "center", justifyContent: "center",
          margin: "0 auto 20px", boxShadow: "0 4px 20px rgba(22,163,74,.3)",
        }}>
          <i className="pi pi-check" style={{ fontSize: 30, color: "white" }} />
        </div>

        <div style={{ fontWeight: 800, fontSize: 22, color: C.text, marginBottom: 6 }}>
          Patient Admitted Successfully
        </div>
        <div style={{ fontSize: 13, color: C.muted, marginBottom: 24 }}>
          NABH-compliant IPD admission completed
        </div>

        {/* IPD Number */}
        <div style={{
          background: C.accentL, border: `2px solid ${C.accent}30`,
          borderRadius: 12, padding: "16px 24px", marginBottom: 20,
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, letterSpacing: ".8px", marginBottom: 4 }}>IPD NUMBER</div>
          <div style={{ fontSize: 28, fontWeight: 900, color: C.accent, letterSpacing: 2 }}>{ipdNo}</div>
        </div>

        {/* Details */}
        <div style={{ textAlign: "left", marginBottom: 24 }}>
          {[
            { label: "Patient Name",  value: `${identity.title} ${identity.firstName} ${identity.lastName}` || "Demo Patient" },
            { label: "Department",    value: admission.department || "General Medicine" },
            { label: "Doctor",        value: admission.attendingDoctor || "Dr. Assigned" },
            { label: "Ward / Bed",    value: `${admission.ward || "General Ward"} — ${admission.bed || "B-04"}` },
            { label: "Admission",     value: `${admission.admissionDate} at ${admission.admissionTime}` },
          ].map(row => (
            <div key={row.label} style={{
              display: "flex", justifyContent: "space-between", padding: "7px 0",
              borderBottom: `1px solid ${C.border}`, fontSize: 13,
            }}>
              <span style={{ color: C.muted, fontWeight: 600 }}>{row.label}</span>
              <span style={{ color: C.text, fontWeight: 700 }}>{row.value}</span>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onPrint} style={{
            flex: 1, padding: "10px 0", border: `1.5px solid ${C.border}`,
            borderRadius: 8, background: "white", cursor: "pointer",
            fontSize: 13, fontWeight: 600, color: C.text,
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
          }}>
            <i className="pi pi-print" /> Print Admission Slip
          </button>
          <button onClick={onNew} style={{
            flex: 1, padding: "10px 0", border: "none",
            borderRadius: 8,
            background: `linear-gradient(135deg, ${C.accent}, ${C.blue})`,
            cursor: "pointer", fontSize: 13, fontWeight: 700, color: "white",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            boxShadow: "0 2px 10px rgba(124,58,237,.3)",
          }}>
            <i className="pi pi-plus" /> New Admission
          </button>
        </div>
      </div>
    </div>
  );
}
