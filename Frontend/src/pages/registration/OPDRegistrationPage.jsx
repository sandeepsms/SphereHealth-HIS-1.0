/**
 * OPDRegistrationPage.jsx
 * NABH-Compliant OPD Registration — Search → New/Revisit → Visit Form → Token
 * Standards: NABH AAC.1, AAC.4, MOM.1, PFR.1, IPSG.1
 *
 * Design pattern: matches IPDAdmissionPage (Section, F, G2/G3/G4, inline-styles)
 * Color: Teal #0891b2
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import patientService from "../../Services/patient/patientService";
import opdService from "../../Services/patient/opdService";
import { departmentService } from "../../Services/departmentService";
import { doctorService } from "../../Services/doctors/doctorService";

/* ══════════════════════════════════════════════════════════════
   DESIGN TOKENS
══════════════════════════════════════════════════════════════ */
const C = {
  bg: "#f0f2f5",
  card: "#ffffff",
  border: "#e2e6ea",
  text: "#1a1d23",
  muted: "#6b7280",
  accent: "#0891b2",   // OPD Teal
  accentL: "#ecfeff",
  blue: "#1e40af",
  blueL: "#eff6ff",
  green: "#16a34a",
  greenL: "#dcfce7",
  red: "#dc2626",
  redL: "#fef2f2",
  amber: "#d97706",
  amberL: "#fffbeb",
  slate: "#334155",
};

const FF = "'DM Sans', sans-serif";

const fld = {
  padding: "8px 11px",
  border: `1.5px solid ${C.border}`,
  borderRadius: 8,
  fontFamily: FF,
  fontSize: 13,
  color: C.text,
  outline: "none",
  background: "white",
  width: "100%",
  boxSizing: "border-box",
  transition: "border-color .15s",
};
const ta = { ...fld, resize: "vertical", minHeight: 72 };
const sel = { ...fld, cursor: "pointer", appearance: "auto" };

const G2 = ({ children, gap = 14 }) => (
  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap }}>{children}</div>
);
const G3 = ({ children }) => (
  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>{children}</div>
);
const G4 = ({ children }) => (
  <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>{children}</div>
);

function F({ label, required, children, hint, span }) {
  return (
    <div style={span ? { gridColumn: `span ${span}` } : {}}>
      <label style={{
        display: "block", fontSize: 11, fontWeight: 700, color: C.muted,
        textTransform: "uppercase", letterSpacing: ".6px", marginBottom: 4,
        fontFamily: FF,
      }}>
        {label}{required && <span style={{ color: C.red, marginLeft: 3 }}>*</span>}
      </label>
      {children}
      {hint && <div style={{ fontSize: 10, color: C.muted, marginTop: 3, fontFamily: FF }}>{hint}</div>}
    </div>
  );
}

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
          <span style={{ fontWeight: 700, fontSize: 13, color: C.text, fontFamily: FF }}>{title}</span>
          {badge && (
            <span style={{
              background: color + "18", color, border: `1px solid ${color}30`,
              fontSize: 10, fontWeight: 700, padding: "1px 8px", borderRadius: 4, fontFamily: FF,
            }}>{badge}</span>
          )}
          {nabh && (
            <span style={{
              background: "#f0fdf4", color: C.green, border: "1px solid #bbf7d0",
              fontSize: 9, fontWeight: 700, padding: "1px 7px", borderRadius: 4, letterSpacing: ".8px", fontFamily: FF,
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

/* ── Helpers ── */
const calcAge = (dob) => {
  if (!dob) return "";
  const t = new Date(), b = new Date(dob);
  let a = t.getFullYear() - b.getFullYear();
  if (t.getMonth() - b.getMonth() < 0 || (t.getMonth() === b.getMonth() && t.getDate() < b.getDate())) a--;
  return a < 0 ? "" : a;
};
const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-IN") : "—";
const todayISO = () => new Date().toISOString().split("T")[0];

/* ── Token Slip ── */
const printToken = ({ patient, visit, department, doctor }) => {
  const w = window.open("", "_blank", "width=420,height=560");
  w.document.write(`
    <html><head><title>OPD Token</title>
    <style>
      *{box-sizing:border-box}
      body{font-family:'DM Sans',Arial,sans-serif;margin:0;padding:20px;background:#fff}
      .header{text-align:center;border-bottom:2px solid #0891b2;padding-bottom:12px;margin-bottom:16px}
      .hospital{font-size:18px;font-weight:700;color:#0891b2}
      .token-box{border:3px solid #0891b2;border-radius:12px;padding:20px;text-align:center;margin:14px 0}
      .token-num{font-size:72px;font-weight:900;color:#0891b2;line-height:1}
      .token-label{font-size:11px;color:#64748b;margin-top:4px;letter-spacing:1px;text-transform:uppercase}
      .visit-num{font-size:13px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:6px;padding:6px 12px;margin:8px 0;font-weight:600;color:#0369a1;text-align:center}
      .uhid-bar{background:#0891b2;color:#fff;padding:8px 12px;border-radius:6px;text-align:center;margin:10px 0}
      .uhid-num{font-size:20px;font-weight:700;letter-spacing:3px}
      .info{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px}
      .info-item{background:#f8fafc;border-radius:6px;padding:8px 10px}
      .info-label{font-size:10px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.5px}
      .info-value{font-size:13px;color:#1e293b;font-weight:600;margin-top:2px}
      .footer{text-align:center;font-size:10px;color:#94a3b8;margin-top:16px;border-top:1px solid #e2e8f0;padding-top:10px}
      @media print{body{margin:0;padding:10px}}
    </style></head><body>
    <div class="header">
      <div class="hospital">SphereHealth Hospital</div>
      <div style="font-size:12px;color:#64748b">OPD Registration Slip</div>
    </div>
    <div class="token-box">
      <div class="token-num">${String(visit.tokenNumber || "—").padStart(3, "0")}</div>
      <div class="token-label">OPD Token Number</div>
    </div>
    <div class="visit-num">Visit No: ${visit.visitNumber || "—"}</div>
    <div class="uhid-bar">
      <div style="font-size:10px;opacity:.8;letter-spacing:1px">UNIQUE HEALTH ID</div>
      <div class="uhid-num">${patient.UHID}</div>
    </div>
    <div class="info">
      <div class="info-item"><div class="info-label">Patient</div><div class="info-value">${patient.title || ""} ${patient.fullName}</div></div>
      <div class="info-item"><div class="info-label">Contact</div><div class="info-value">${patient.contactNumber || "—"}</div></div>
      <div class="info-item"><div class="info-label">Department</div><div class="info-value">${department}</div></div>
      <div class="info-item"><div class="info-label">Consultant</div><div class="info-value">${doctor}</div></div>
      <div class="info-item"><div class="info-label">Date</div><div class="info-value">${fmtDate(new Date())}</div></div>
      <div class="info-item"><div class="info-label">Visit #</div><div class="info-value">${visit.patientVisitSeq || 1}</div></div>
    </div>
    <div class="footer">
      Please present this slip to the OPD nurse for vitals.<br>
      NABH Accredited · SphereHealth HMS · ${new Date().toLocaleString("en-IN")}
    </div>
    </body></html>
  `);
  w.document.close();
  setTimeout(() => w.print(), 400);
};

/* ══════════════════════════════════════════════════════════════
   CONSTANTS
══════════════════════════════════════════════════════════════ */
const TITLE_OPTS = ["Mr.", "Mrs.", "Miss", "Master", "Baby", "Dr.", "Prof."];
const GENDER_OPTS = ["Male", "Female", "Other", "Prefer not to say"];
const BLOOD_OPTS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-", "Not Known"];
const MARITAL_OPTS = ["Single", "Married", "Divorced", "Widowed", "Other"];
const PAYMENT_OPTS = ["GENERAL", "TPA / Insurance", "CORPORATE", "CGHS", "ESI", "PMJAY / Ayushman"];
const VISIT_TYPE_OPTS = ["First Visit", "Follow-up", "Routine Checkup", "Review", "Emergency OPD"];
const ID_PROOF_OPTS = ["Aadhaar Card", "PAN Card", "Voter ID", "Passport", "Driving License", "Ration Card", "Other"];
const RELATION_OPTS = ["Spouse", "Parent", "Child", "Sibling", "Friend", "Guardian", "Other"];
const ALLERGY_SEVERITY = ["Mild", "Moderate", "Severe"];

/* ══════════════════════════════════════════════════════════════
   MAIN COMPONENT
══════════════════════════════════════════════════════════════ */
export default function OPDRegistrationPage() {
  const navigate = useNavigate();
  const toastRef = useRef(null);

  /* ── Phase: search | form | success ── */
  const [phase, setPhase] = useState("search");
  const [selectedPatient, setSelectedPatient] = useState(null); // existing patient
  const [isNewPatient, setIsNewPatient] = useState(false);

  /* ── Search ── */
  const [searchQ, setSearchQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const [searchDone, setSearchDone] = useState(false);

  /* ── Departments & Doctors ── */
  const [departments, setDepartments] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [loadingDept, setLoadingDept] = useState(false);
  const [loadingDoctors, setLoadingDoctors] = useState(false);

  /* ── New patient fields ── */
  const [np, setNp] = useState({
    title: "Mr.", fullName: "", gender: "", dateOfBirth: "",
    maritalStatus: "", contactNumber: "", altContact: "", email: "",
    bloodGroup: "", idProofType: "", idProofNumber: "",
    address: { completeAddress: "", pincode: "", city: "", state: "", district: "" },
    paymentType: "GENERAL", insuranceName: "", insurancePolicyNo: "",
    companionName: "", companionRelationship: "", companionContact: "",
    // Allergies
    nkda: false,
    allergies: [],   // [{type:"Drug",substance:"",reaction:"",severity:"Moderate"}]
    // Consent
    consentGiven: false,
    consentBy: "",
  });

  /* ── Visit form ── */
  const [vf, setVf] = useState({
    departmentId: "", departmentName: "",
    doctorId: "", consultantName: "",
    visitType: "First Visit",
    chiefComplaint: "",
    complaintDuration: "",
    historyOfPresentIllness: "",
    pastMedicalHistory: "",
    currentMedications: "",
    referredBy: "",
  });

  const [submitting, setSubmitting] = useState(false);
  const [successData, setSuccessData] = useState(null);

  /* ── Load departments on mount ── */
  useEffect(() => {
    (async () => {
      setLoadingDept(true);
      try {
        const res = await departmentService.getActiveDepartments();
        const list = res.data || res || [];
        setDepartments(
          (Array.isArray(list) ? list : []).map(d => ({
            id: d._id, name: d.departmentName,
          }))
        );
      } catch { /* silent */ } finally { setLoadingDept(false); }
    })();
  }, []);

  const loadDoctors = async (deptId) => {
    if (!deptId) { setDoctors([]); return; }
    setLoadingDoctors(true);
    try {
      const res = await doctorService.getDoctorsByDepartment(deptId);
      const list = res.data?.data || res.data || res || [];
      setDoctors(
        (Array.isArray(list) ? list : []).map(d => ({
          id: d._id,
          name: `Dr. ${d.personalInfo?.firstName || ""} ${d.personalInfo?.lastName || ""}`.trim(),
        }))
      );
    } catch { setDoctors([]); } finally { setLoadingDoctors(false); }
  };

  /* ── Search ── */
  const doSearch = async () => {
    if (!searchQ.trim() || searchQ.trim().length < 2) return;
    setSearching(true); setSearchDone(false); setSearchResults([]);
    try {
      const res = await patientService.searchPatients(searchQ.trim(), 20);
      setSearchResults(Array.isArray(res.data || res) ? (res.data || res) : []);
    } catch (e) {
      showToast("error", "Search Failed", e.message);
    } finally { setSearching(false); setSearchDone(true); }
  };

  /* ── Select existing patient ── */
  const selectExistingPatient = (patient) => {
    setSelectedPatient(patient);
    setIsNewPatient(false);
    setVf(prev => ({
      ...prev,
      visitType: (patient.totalOPDVisits || 0) > 0 ? "Follow-up" : "First Visit",
    }));
    setPhase("form");
  };

  /* ── Start new patient ── */
  const startNewPatient = () => {
    setSelectedPatient(null);
    setIsNewPatient(true);
    setPhase("form");
  };

  /* ── Dept change ── */
  const onDeptChange = (deptId) => {
    const dept = departments.find(d => d.id === deptId);
    setVf(prev => ({ ...prev, departmentId: deptId, departmentName: dept?.name || "", doctorId: "", consultantName: "" }));
    loadDoctors(deptId);
  };

  /* ── Doctor change ── */
  const onDoctorChange = (docId) => {
    const doc = doctors.find(d => d.id === docId);
    setVf(prev => ({ ...prev, doctorId: docId, consultantName: doc?.name || "" }));
  };

  /* ── Allergy helpers ── */
  const addAllergy = () => setNp(prev => ({
    ...prev,
    allergies: [...prev.allergies, { type: "Drug", substance: "", reaction: "", severity: "Moderate" }],
  }));
  const removeAllergy = (i) => setNp(prev => ({
    ...prev, allergies: prev.allergies.filter((_, idx) => idx !== i),
  }));
  const updateAllergy = (i, field, val) => setNp(prev => ({
    ...prev,
    allergies: prev.allergies.map((a, idx) => idx === i ? { ...a, [field]: val } : a),
  }));

  /* ── Submit ── */
  const handleSubmit = async () => {
    if (!vf.departmentId) return showToast("error", "Required", "Please select a department");
    if (!vf.doctorId) return showToast("error", "Required", "Please select a doctor");
    if (!vf.chiefComplaint.trim()) return showToast("error", "Required", "Chief complaint is required");

    if (isNewPatient) {
      if (!np.fullName.trim()) return showToast("error", "Required", "Full name is required");
      if (!np.gender) return showToast("error", "Required", "Gender is required");
      if (!np.dateOfBirth) return showToast("error", "Required", "Date of birth is required");
      if (!np.contactNumber.trim()) return showToast("error", "Required", "Contact number is required");
    }

    setSubmitting(true);
    try {
      let patientDoc = selectedPatient;

      if (isNewPatient) {
        const payload = {
          title: np.title,
          fullName: np.fullName,
          gender: np.gender,
          dateOfBirth: np.dateOfBirth || undefined,
          maritalStatus: np.maritalStatus || undefined,
          contactNumber: np.contactNumber,
          alternateContact: np.altContact || undefined,
          email: np.email || undefined,
          bloodGroup: np.bloodGroup || undefined,
          idProofType: np.idProofType || undefined,
          idProofNumber: np.idProofNumber || undefined,
          address: np.address,
          paymentType: np.paymentType,
          insuranceName: np.insuranceName || undefined,
          insurancePolicyNo: np.insurancePolicyNo || undefined,
          companionName: np.companionName || undefined,
          companionRelationship: np.companionRelationship || undefined,
          companionContact: np.companionContact || undefined,
          knownAllergies: np.nkda ? "NKDA" : np.allergies.map(a => `${a.type}: ${a.substance} (${a.severity})`).join("; ") || undefined,
          registrationType: "OPD",
          department: vf.departmentId,
          doctor: vf.doctorId,
        };
        const pr = await patientService.createPatient(payload);
        patientDoc = pr.data || pr;
      }

      const visitPayload = {
        patientId: patientDoc._id,
        UHID: patientDoc.UHID,
        departmentId: vf.departmentId,
        department: vf.departmentName,
        doctorId: vf.doctorId,
        consultantName: vf.consultantName,
        visitType: vf.visitType,
        chiefComplaint: vf.chiefComplaint,
        complaintDuration: vf.complaintDuration || undefined,
        historyOfPresentIllness: vf.historyOfPresentIllness || undefined,
        pastMedicalHistory: vf.pastMedicalHistory || undefined,
        allergyHistory: np.nkda ? "NKDA" : np.allergies.map(a => `${a.type}: ${a.substance}`).join("; ") || undefined,
        currentMedications: vf.currentMedications || undefined,
        referredBy: vf.referredBy || undefined,
      };

      const vr = await opdService.createOPDVisit(visitPayload);
      const visit = vr.data?.data || vr.data || vr;

      setSuccessData({ patient: patientDoc, visit });
      setPhase("success");
    } catch (e) {
      showToast("error", "Registration Failed", e?.response?.data?.message || e.message);
    } finally { setSubmitting(false); }
  };

  /* ── Toast ── */
  const showToast = (severity, summary, detail) => {
    if (toastRef.current) {
      toastRef.current.textContent = `${summary}: ${detail}`;
      toastRef.current.style.background = severity === "error" ? C.redL : C.greenL;
      toastRef.current.style.color = severity === "error" ? C.red : C.green;
      toastRef.current.style.display = "block";
      setTimeout(() => { if (toastRef.current) toastRef.current.style.display = "none"; }, 4000);
    }
  };

  const resetAll = () => {
    setPhase("search"); setSearchQ(""); setSearchResults([]); setSearchDone(false);
    setSelectedPatient(null); setIsNewPatient(false); setSuccessData(null);
    setVf({ departmentId: "", departmentName: "", doctorId: "", consultantName: "", visitType: "First Visit", chiefComplaint: "", complaintDuration: "", historyOfPresentIllness: "", pastMedicalHistory: "", currentMedications: "", referredBy: "" });
    setNp({ title: "Mr.", fullName: "", gender: "", dateOfBirth: "", maritalStatus: "", contactNumber: "", altContact: "", email: "", bloodGroup: "", idProofType: "", idProofNumber: "", address: { completeAddress: "", pincode: "", city: "", state: "", district: "" }, paymentType: "GENERAL", insuranceName: "", insurancePolicyNo: "", companionName: "", companionRelationship: "", companionContact: "", nkda: false, allergies: [], consentGiven: false, consentBy: "" });
  };

  /* ════════════════════════════════════════ RENDER ════════════════════════════════════════ */
  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FF, padding: "0 0 48px" }}>

      {/* ── Toast ── */}
      <div ref={toastRef} style={{
        display: "none", position: "fixed", top: 18, right: 18, zIndex: 9999,
        padding: "12px 20px", borderRadius: 10, fontWeight: 600,
        fontSize: 13, fontFamily: FF, boxShadow: "0 4px 16px rgba(0,0,0,.12)",
        border: "1.5px solid currentColor", maxWidth: 380,
      }} />

      {/* ── Page Header ── */}
      <div style={{
        background: `linear-gradient(135deg, ${C.accent}, #0e7490)`,
        padding: "22px 28px 20px", marginBottom: 24,
        boxShadow: "0 2px 12px rgba(8,145,178,.18)",
      }}>
        <div style={{ maxWidth: 960, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{
              width: 46, height: 46, borderRadius: 12, background: "rgba(255,255,255,.18)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <i className="pi pi-user-plus" style={{ fontSize: 22, color: "#fff" }} />
            </div>
            <div>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#fff", letterSpacing: "-.3px" }}>OPD Registration</div>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,.78)", marginTop: 2 }}>
                NABH AAC.1 · IPSG.1 · MOM.1 · PFR.1 — Outpatient Department
              </div>
            </div>
          </div>
          {/* Step indicator */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {["search", "form", "success"].map((s, i) => (
              <React.Fragment key={s}>
                <div style={{
                  width: 28, height: 28, borderRadius: "50%", fontFamily: FF,
                  background: phase === s ? "#fff" : (["search", "form", "success"].indexOf(phase) > i ? "rgba(255,255,255,.5)" : "rgba(255,255,255,.2)"),
                  color: phase === s ? C.accent : (["search", "form", "success"].indexOf(phase) > i ? C.accent : "rgba(255,255,255,.6)"),
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 12, fontWeight: 800, transition: ".2s",
                }}>{i + 1}</div>
                {i < 2 && <div style={{ width: 24, height: 2, background: "rgba(255,255,255,.3)", borderRadius: 1 }} />}
              </React.Fragment>
            ))}
            <span style={{ fontSize: 11, color: "rgba(255,255,255,.7)", marginLeft: 8, fontFamily: FF }}>
              {phase === "search" ? "Search" : phase === "form" ? "Register" : "Done"}
            </span>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 960, margin: "0 auto", padding: "0 16px" }}>

        {/* ══════════════ PHASE: SEARCH ══════════════ */}
        {phase === "search" && (
          <SearchPhase
            searchQ={searchQ} setSearchQ={setSearchQ}
            searching={searching} searchDone={searchDone} searchResults={searchResults}
            doSearch={doSearch}
            onSelect={selectExistingPatient}
            onNewPatient={startNewPatient}
            C={C} FF={FF}
          />
        )}

        {/* ══════════════ PHASE: FORM ══════════════ */}
        {phase === "form" && (
          <FormPhase
            isNewPatient={isNewPatient}
            selectedPatient={selectedPatient}
            np={np} setNp={setNp}
            vf={vf} setVf={setVf}
            departments={departments} doctors={doctors}
            loadingDept={loadingDept} loadingDoctors={loadingDoctors}
            onDeptChange={onDeptChange} onDoctorChange={onDoctorChange}
            addAllergy={addAllergy} removeAllergy={removeAllergy} updateAllergy={updateAllergy}
            onBack={() => setPhase("search")}
            onSubmit={handleSubmit} submitting={submitting}
            C={C} FF={FF} fld={fld} ta={ta} sel={sel} G2={G2} G3={G3} G4={G4} F={F} Section={Section}
          />
        )}

        {/* ══════════════ PHASE: SUCCESS ══════════════ */}
        {phase === "success" && successData && (
          <SuccessPhase
            data={successData} vf={vf}
            onPrintToken={() => printToken({ patient: successData.patient, visit: successData.visit, department: vf.departmentName, doctor: vf.consultantName })}
            onNewRegistration={resetAll}
            onViewQueue={() => navigate("/opd-queue")}
            C={C} FF={FF}
          />
        )}

      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   SEARCH PHASE
══════════════════════════════════════════════════════════════ */
function SearchPhase({ searchQ, setSearchQ, searching, searchDone, searchResults, doSearch, onSelect, onNewPatient, C, FF }) {
  return (
    <div>
      {/* Search card */}
      <div style={{
        background: C.card, borderRadius: 14, padding: "24px 28px",
        boxShadow: "0 2px 12px rgba(0,0,0,.07)", marginBottom: 20,
        border: `1.5px solid ${C.accent}20`,
      }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 4, fontFamily: FF }}>
          <i className="pi pi-search" style={{ marginRight: 8, color: C.accent }} />
          Search Existing Patient
        </div>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 14, fontFamily: FF }}>
          Search by Name, UHID, or Phone Number (NABH IPSG.1 — Correct Patient Identification)
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <input
            value={searchQ}
            onChange={e => setSearchQ(e.target.value)}
            onKeyDown={e => e.key === "Enter" && doSearch()}
            placeholder="e.g.  Rahul Sharma  /  UH00000042  /  9876543210"
            autoFocus
            style={{
              flex: 1, padding: "11px 14px", border: `1.5px solid ${C.border}`,
              borderRadius: 10, fontFamily: FF, fontSize: 14, color: C.text,
              outline: "none", background: "#fff",
            }}
            onFocus={e => e.target.style.borderColor = C.accent}
            onBlur={e => e.target.style.borderColor = C.border}
          />
          <button
            onClick={doSearch}
            disabled={searching || searchQ.trim().length < 2}
            style={{
              background: searching || searchQ.trim().length < 2 ? "#94a3b8" : C.accent,
              color: "#fff", border: "none", borderRadius: 10, padding: "0 22px",
              fontFamily: FF, fontWeight: 700, fontSize: 13, cursor: searching ? "wait" : "pointer",
              display: "flex", alignItems: "center", gap: 7, transition: ".15s",
            }}
          >
            <i className={`pi ${searching ? "pi-spin pi-spinner" : "pi-search"}`} style={{ fontSize: 14 }} />
            {searching ? "Searching…" : "Search"}
          </button>
        </div>
        <div style={{ fontSize: 11, color: C.muted, marginTop: 7, fontFamily: FF }}>
          Press Enter or click Search · minimum 2 characters
        </div>
      </div>

      {/* Results */}
      {searching && (
        <div style={{ textAlign: "center", padding: "40px 0", color: C.muted, fontFamily: FF }}>
          <i className="pi pi-spin pi-spinner" style={{ fontSize: 32, color: C.accent }} />
          <div style={{ marginTop: 12, fontSize: 14 }}>Searching patients…</div>
        </div>
      )}

      {searchDone && !searching && searchResults.length > 0 && (
        <div>
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 10, fontFamily: FF, fontWeight: 600 }}>
            {searchResults.length} patient{searchResults.length > 1 ? "s" : ""} found — select to create a new visit
          </div>
          {searchResults.map(p => (
            <PatientResultCard key={p._id} patient={p} onSelect={() => onSelect(p)} C={C} FF={FF} />
          ))}
          <div style={{ textAlign: "center", padding: "12px 0", fontFamily: FF }}>
            <span style={{ fontSize: 13, color: C.muted }}>Patient not found? </span>
            <button onClick={onNewPatient} style={outlineBtn(C)}>
              <i className="pi pi-user-plus" style={{ fontSize: 12 }} /> Register New Patient
            </button>
          </div>
        </div>
      )}

      {searchDone && !searching && searchResults.length === 0 && (
        <div style={{
          background: C.card, borderRadius: 14, padding: "36px 28px",
          textAlign: "center", boxShadow: "0 2px 12px rgba(0,0,0,.06)",
        }}>
          <div style={{ fontSize: 40, color: "#cbd5e1", marginBottom: 12 }}>👤</div>
          <div style={{ fontSize: 17, fontWeight: 700, color: C.text, fontFamily: FF }}>No patient found</div>
          <div style={{ color: C.muted, margin: "6px 0 20px", fontSize: 13, fontFamily: FF }}>
            No records matching your search. Register as a new patient?
          </div>
          <button onClick={onNewPatient} style={primaryBtn(C)}>
            <i className="pi pi-user-plus" style={{ fontSize: 13 }} /> Register New Patient
          </button>
        </div>
      )}

      {!searchDone && !searching && (
        <div style={{
          background: C.card, borderRadius: 14, padding: "36px 28px",
          textAlign: "center", boxShadow: "0 2px 12px rgba(0,0,0,.06)",
          border: `1.5px dashed ${C.border}`,
        }}>
          <i className="pi pi-search" style={{ fontSize: 44, color: "#cbd5e1", display: "block", marginBottom: 12 }} />
          <div style={{ color: C.muted, fontSize: 14, fontFamily: FF, marginBottom: 18 }}>
            Search above, or directly register a new patient
          </div>
          <button onClick={onNewPatient} style={outlineBtn(C)}>
            <i className="pi pi-user-plus" style={{ fontSize: 12 }} /> Register New Patient
          </button>
        </div>
      )}
    </div>
  );
}

function PatientResultCard({ patient, onSelect, C, FF }) {
  const [hov, setHov] = useState(false);
  const totalVisits = (patient.totalOPDVisits || 0) + (patient.totalIPDVisits || 0) + (patient.totalEmergencyVisits || 0);
  return (
    <div
      onClick={onSelect}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        background: hov ? C.accentL : C.card,
        border: `1.5px solid ${hov ? C.accent : C.border}`,
        borderRadius: 12, padding: "14px 18px", marginBottom: 10,
        boxShadow: "0 1px 6px rgba(0,0,0,.05)", cursor: "pointer",
        display: "flex", alignItems: "center", gap: 16, transition: ".15s",
      }}
    >
      <div style={{
        width: 48, height: 48, borderRadius: "50%", background: C.accent + "18",
        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
      }}>
        <i className="pi pi-user" style={{ color: C.accent, fontSize: 22 }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 700, fontSize: 15, color: C.text, fontFamily: FF }}>
            {patient.title} {patient.fullName}
          </span>
          <span style={{ background: C.blueL, color: C.blue, border: `1px solid #bfdbfe`, fontSize: 10, fontWeight: 700, padding: "1px 8px", borderRadius: 4, fontFamily: FF, letterSpacing: 1 }}>
            {patient.UHID}
          </span>
          {totalVisits > 0 && (
            <span style={{ background: C.greenL, color: C.green, border: `1px solid #bbf7d0`, fontSize: 10, fontWeight: 700, padding: "1px 8px", borderRadius: 4, fontFamily: FF }}>
              {totalVisits} visit{totalVisits > 1 ? "s" : ""}
            </span>
          )}
        </div>
        <div style={{ fontSize: 12, color: C.muted, marginTop: 3, fontFamily: FF }}>
          {patient.gender} · {calcAge(patient.dateOfBirth)} yrs · {patient.contactNumber}
          {patient.lastVisitDate && ` · Last visit: ${fmtDate(patient.lastVisitDate)}`}
        </div>
        {patient.knownAllergies && patient.knownAllergies !== "NKDA" && (
          <div style={{ fontSize: 11, color: C.amber, marginTop: 2, fontFamily: FF }}>
            ⚠ Allergies: {patient.knownAllergies}
          </div>
        )}
      </div>
      <button onClick={e => { e.stopPropagation(); onSelect(); }} style={primaryBtn(C)}>
        <i className="pi pi-plus" style={{ fontSize: 11 }} /> New Visit
      </button>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   FORM PHASE — all sections
══════════════════════════════════════════════════════════════ */
function FormPhase({
  isNewPatient, selectedPatient,
  np, setNp, vf, setVf,
  departments, doctors, loadingDept, loadingDoctors,
  onDeptChange, onDoctorChange,
  addAllergy, removeAllergy, updateAllergy,
  onBack, onSubmit, submitting,
  C, FF, fld, ta, sel, G2, G3, G4, F, Section,
}) {
  const npSet = (field, val) => setNp(prev => ({ ...prev, [field]: val }));
  const npAddr = (field, val) => setNp(prev => ({ ...prev, address: { ...prev.address, [field]: val } }));
  const vfSet = (field, val) => setVf(prev => ({ ...prev, [field]: val }));

  return (
    <div>
      {/* Back + patient banner */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <button onClick={onBack} style={{
          background: "none", border: `1.5px solid ${C.border}`, borderRadius: 8,
          padding: "6px 12px", cursor: "pointer", fontFamily: FF, fontSize: 12,
          color: C.muted, display: "flex", alignItems: "center", gap: 6,
        }}>
          <i className="pi pi-arrow-left" style={{ fontSize: 11 }} /> Back to Search
        </button>
        {!isNewPatient && selectedPatient && (
          <div style={{
            flex: 1, background: C.accentL, border: `1.5px solid ${C.accent}30`,
            borderRadius: 10, padding: "10px 16px", display: "flex", alignItems: "center", gap: 12,
          }}>
            <i className="pi pi-user" style={{ color: C.accent, fontSize: 18 }} />
            <div>
              <span style={{ fontWeight: 700, color: C.text, fontFamily: FF }}>
                {selectedPatient.title} {selectedPatient.fullName}
              </span>
              <span style={{ fontSize: 12, color: C.accent, marginLeft: 10, fontFamily: FF }}>
                UHID: <strong>{selectedPatient.UHID}</strong>
              </span>
              <span style={{ fontSize: 12, color: C.muted, marginLeft: 10, fontFamily: FF }}>
                {selectedPatient.gender} · {calcAge(selectedPatient.dateOfBirth)} yrs · {selectedPatient.contactNumber}
              </span>
              {(selectedPatient.totalOPDVisits || 0) > 0 && (
                <span style={{ fontSize: 12, color: C.green, marginLeft: 10, fontFamily: FF }}>
                  · {selectedPatient.totalOPDVisits} previous OPD visit{selectedPatient.totalOPDVisits > 1 ? "s" : ""}
                </span>
              )}
            </div>
          </div>
        )}
        {isNewPatient && (
          <div style={{
            flex: 1, background: "#fffbeb", border: "1.5px solid #fcd34d",
            borderRadius: 10, padding: "10px 16px", display: "flex", alignItems: "center", gap: 10,
          }}>
            <i className="pi pi-user-plus" style={{ color: C.amber, fontSize: 18 }} />
            <div style={{ fontFamily: FF }}>
              <span style={{ fontWeight: 700, color: C.text }}>New Patient Registration</span>
              <span style={{ fontSize: 12, color: C.amber, marginLeft: 10 }}>A new UHID will be generated upon registration</span>
            </div>
          </div>
        )}
      </div>

      {/* ── Section 1: Patient Identity ── */}
      {isNewPatient && (
        <Section title="Patient Identity" icon="pi-id-card" color={C.accent} nabh badge="NABH AAC.1 · IPSG.1" defaultOpen>
          <G2 gap={14}>
            <div style={{ display: "grid", gridTemplateColumns: "110px 1fr", gap: 10 }}>
              <F label="Title" required>
                <select value={np.title} onChange={e => npSet("title", e.target.value)} style={sel}>
                  {["Mr.", "Mrs.", "Miss", "Master", "Baby", "Dr.", "Prof."].map(t => <option key={t}>{t}</option>)}
                </select>
              </F>
              <F label="Full Name" required hint="As per ID proof">
                <input value={np.fullName} onChange={e => npSet("fullName", e.target.value)}
                  placeholder="Patient's full legal name" style={fld} />
              </F>
            </div>
            <G3>
              <F label="Gender" required>
                <select value={np.gender} onChange={e => npSet("gender", e.target.value)} style={sel}>
                  <option value="">Select…</option>
                  {GENDER_OPTS.map(g => <option key={g}>{g}</option>)}
                </select>
              </F>
              <F label="Date of Birth" required hint={np.dateOfBirth ? `Age: ${calcAge(np.dateOfBirth)} yrs` : ""}>
                <input type="date" value={np.dateOfBirth} max={todayISO()}
                  onChange={e => npSet("dateOfBirth", e.target.value)} style={fld} />
              </F>
              <F label="Marital Status">
                <select value={np.maritalStatus} onChange={e => npSet("maritalStatus", e.target.value)} style={sel}>
                  <option value="">Select…</option>
                  {MARITAL_OPTS.map(m => <option key={m}>{m}</option>)}
                </select>
              </F>
            </G3>
          </G2>
          <div style={{ marginTop: 12 }}>
            <G3>
              <F label="Mobile Number" required>
                <input value={np.contactNumber} onChange={e => npSet("contactNumber", e.target.value)}
                  placeholder="10-digit mobile" maxLength={10} style={fld} />
              </F>
              <F label="Alt. Contact">
                <input value={np.altContact} onChange={e => npSet("altContact", e.target.value)}
                  placeholder="Secondary number" style={fld} />
              </F>
              <F label="Email Address">
                <input type="email" value={np.email} onChange={e => npSet("email", e.target.value)}
                  placeholder="patient@email.com" style={fld} />
              </F>
            </G3>
          </div>
          <div style={{ marginTop: 12 }}>
            <G3>
              <F label="Blood Group">
                <select value={np.bloodGroup} onChange={e => npSet("bloodGroup", e.target.value)} style={sel}>
                  <option value="">Unknown</option>
                  {BLOOD_OPTS.map(b => <option key={b}>{b}</option>)}
                </select>
              </F>
              <F label="ID Proof Type">
                <select value={np.idProofType} onChange={e => npSet("idProofType", e.target.value)} style={sel}>
                  <option value="">Select…</option>
                  {ID_PROOF_OPTS.map(i => <option key={i}>{i}</option>)}
                </select>
              </F>
              <F label="ID Proof Number">
                <input value={np.idProofNumber} onChange={e => npSet("idProofNumber", e.target.value)}
                  placeholder="ID number" style={fld} />
              </F>
            </G3>
          </div>
        </Section>
      )}

      {/* ── Section 2: Address (new patient only) ── */}
      {isNewPatient && (
        <Section title="Address & Contact" icon="pi-map-marker" color={C.teal || "#0d9488"} nabh badge="NABH AAC.1" defaultOpen>
          <F label="Complete Address" span={3}>
            <input value={np.address.completeAddress} onChange={e => npAddr("completeAddress", e.target.value)}
              placeholder="House/Flat No., Street, Locality…" style={fld} />
          </F>
          <div style={{ marginTop: 12 }}>
            <G4>
              <F label="Pincode" required>
                <input value={np.address.pincode} onChange={e => npAddr("pincode", e.target.value)}
                  placeholder="6-digit pincode" maxLength={6} style={fld} />
              </F>
              <F label="City">
                <input value={np.address.city} onChange={e => npAddr("city", e.target.value)}
                  placeholder="City" style={fld} />
              </F>
              <F label="District">
                <input value={np.address.district} onChange={e => npAddr("district", e.target.value)}
                  placeholder="District" style={fld} />
              </F>
              <F label="State">
                <input value={np.address.state} onChange={e => npAddr("state", e.target.value)}
                  placeholder="State" style={fld} />
              </F>
            </G4>
          </div>
        </Section>
      )}

      {/* ── Section 3: Allergies ── */}
      <Section title="Allergy Documentation" icon="pi-exclamation-triangle" color={C.amber} nabh badge="NABH MOM.1" defaultOpen>
        {/* NKDA toggle */}
        <label style={{
          display: "flex", alignItems: "center", gap: 10, cursor: "pointer",
          background: np.nkda ? "#dcfce7" : "#f8fafc",
          border: `1.5px solid ${np.nkda ? C.green : C.border}`,
          borderRadius: 10, padding: "10px 16px", marginBottom: 12, transition: ".15s",
        }}>
          <input type="checkbox" checked={np.nkda}
            onChange={e => setNp(prev => ({ ...prev, nkda: e.target.checked, allergies: [] }))}
            style={{ accentColor: C.green, width: 16, height: 16 }} />
          <div>
            <div style={{ fontWeight: 700, fontSize: 13, color: np.nkda ? C.green : C.text, fontFamily: FF }}>
              {np.nkda ? "✓ No Known Drug Allergies (NKDA)" : "No Known Drug Allergies (NKDA)"}
            </div>
            <div style={{ fontSize: 11, color: C.muted, fontFamily: FF }}>Check this if patient has no known allergies to any medications, food, or substances</div>
          </div>
        </label>

        {!np.nkda && (
          <div>
            {np.allergies.map((a, i) => (
              <div key={i} style={{
                background: "#fff7ed", border: "1px solid #fed7aa",
                borderRadius: 10, padding: "12px 14px", marginBottom: 10,
                display: "grid", gridTemplateColumns: "100px 1fr 1fr 110px 32px", gap: 8, alignItems: "end",
              }}>
                <F label="Type">
                  <select value={a.type} onChange={e => updateAllergy(i, "type", e.target.value)} style={{ ...sel, fontSize: 12 }}>
                    {["Drug", "Food", "Environmental", "Latex", "Other"].map(t => <option key={t}>{t}</option>)}
                  </select>
                </F>
                <F label="Substance / Agent">
                  <input value={a.substance} onChange={e => updateAllergy(i, "substance", e.target.value)}
                    placeholder="e.g. Penicillin, Peanuts" style={{ ...fld, fontSize: 12 }} />
                </F>
                <F label="Reaction / Symptoms">
                  <input value={a.reaction} onChange={e => updateAllergy(i, "reaction", e.target.value)}
                    placeholder="e.g. Urticaria, Anaphylaxis" style={{ ...fld, fontSize: 12 }} />
                </F>
                <F label="Severity">
                  <select value={a.severity} onChange={e => updateAllergy(i, "severity", e.target.value)} style={{ ...sel, fontSize: 12 }}>
                    {ALLERGY_SEVERITY.map(s => <option key={s}>{s}</option>)}
                  </select>
                </F>
                <div style={{ paddingBottom: 2 }}>
                  <button onClick={() => removeAllergy(i)} style={{
                    background: C.redL, color: C.red, border: `1px solid ${C.red}30`,
                    borderRadius: 6, width: 30, height: 30, cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    <i className="pi pi-times" style={{ fontSize: 10 }} />
                  </button>
                </div>
              </div>
            ))}
            <button onClick={addAllergy} style={{
              background: "#fff7ed", border: "1.5px dashed #fdba74",
              borderRadius: 8, padding: "8px 16px", cursor: "pointer",
              color: C.amber, fontFamily: FF, fontWeight: 600, fontSize: 12,
              display: "flex", alignItems: "center", gap: 6,
            }}>
              <i className="pi pi-plus" style={{ fontSize: 11 }} /> Add Allergy Entry
            </button>
          </div>
        )}
      </Section>

      {/* ── Section 4: Visit Details ── */}
      <Section title="Visit Details" icon="pi-calendar-plus" color={C.accent} nabh badge="NABH AAC.4" defaultOpen>
        <G2>
          <F label="Department" required>
            <select value={vf.departmentId} onChange={e => onDeptChange(e.target.value)} style={sel} disabled={loadingDept}>
              <option value="">{loadingDept ? "Loading departments…" : "Select department…"}</option>
              {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </F>
          <F label="Consultant Doctor" required>
            <select value={vf.doctorId} onChange={e => onDoctorChange(e.target.value)} style={sel}
              disabled={!vf.departmentId || loadingDoctors}>
              <option value="">
                {loadingDoctors ? "Loading doctors…" : !vf.departmentId ? "Select department first…" : "Select doctor…"}
              </option>
              {doctors.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </F>
        </G2>
        <div style={{ marginTop: 12 }}>
          <G2>
            <F label="Visit Type">
              <select value={vf.visitType} onChange={e => vfSet("visitType", e.target.value)} style={sel}>
                {VISIT_TYPE_OPTS.map(v => <option key={v}>{v}</option>)}
              </select>
            </F>
            <F label="Referred By">
              <input value={vf.referredBy} onChange={e => vfSet("referredBy", e.target.value)}
                placeholder="Dr. / Hospital / Self" style={fld} />
            </F>
          </G2>
        </div>
        <div style={{ marginTop: 12 }}>
          <G2>
            <F label="Chief Complaint" required hint="Primary reason for today's visit">
              <textarea value={vf.chiefComplaint} onChange={e => vfSet("chiefComplaint", e.target.value)}
                placeholder="Main presenting complaint…" rows={3} style={ta} />
            </F>
            <F label="Duration of Complaint">
              <input value={vf.complaintDuration} onChange={e => vfSet("complaintDuration", e.target.value)}
                placeholder="e.g. 3 days, 2 weeks, 1 month" style={fld} />
            </F>
          </G2>
        </div>
      </Section>

      {/* ── Section 5: Clinical History ── */}
      <Section title="Clinical History" icon="pi-book" color={C.slate} defaultOpen={false} nabh badge="NABH AAC.1">
        <G2>
          <F label="History of Present Illness">
            <textarea value={vf.historyOfPresentIllness} onChange={e => vfSet("historyOfPresentIllness", e.target.value)}
              placeholder="Timeline, severity, aggravating factors…" rows={3} style={ta} />
          </F>
          <F label="Past Medical / Surgical History">
            <textarea value={vf.pastMedicalHistory} onChange={e => vfSet("pastMedicalHistory", e.target.value)}
              placeholder="Previous illnesses, surgeries, hospitalizations…" rows={3} style={ta} />
          </F>
        </G2>
        <div style={{ marginTop: 12 }}>
          <F label="Current Medications" hint="List all medications patient is currently taking">
            <textarea value={vf.currentMedications} onChange={e => vfSet("currentMedications", e.target.value)}
              placeholder="Medication name – dose – frequency (or NONE)" rows={2} style={ta} />
          </F>
        </div>
      </Section>

      {/* ── Section 6: Payment & Insurance ── */}
      {isNewPatient && (
        <Section title="Payment & Insurance" icon="pi-wallet" color={C.blue} defaultOpen={false} nabh badge="NABH MOM.3">
          <G3>
            <F label="Payment Type" required>
              <select value={np.paymentType} onChange={e => npSet("paymentType", e.target.value)} style={sel}>
                {PAYMENT_OPTS.map(p => <option key={p}>{p}</option>)}
              </select>
            </F>
            <F label="Insurance / TPA Name">
              <input value={np.insuranceName} onChange={e => npSet("insuranceName", e.target.value)}
                placeholder="Insurance provider name" style={fld} />
            </F>
            <F label="Policy / TPA Number">
              <input value={np.insurancePolicyNo} onChange={e => npSet("insurancePolicyNo", e.target.value)}
                placeholder="Policy / member ID" style={fld} />
            </F>
          </G3>
        </Section>
      )}

      {/* ── Section 7: Companion / Attendant ── */}
      {isNewPatient && (
        <Section title="Companion / Attendant" icon="pi-users" color={C.green} defaultOpen={false}>
          <G3>
            <F label="Companion Name">
              <input value={np.companionName} onChange={e => npSet("companionName", e.target.value)}
                placeholder="Full name" style={fld} />
            </F>
            <F label="Relationship">
              <select value={np.companionRelationship} onChange={e => npSet("companionRelationship", e.target.value)} style={sel}>
                <option value="">Select…</option>
                {RELATION_OPTS.map(r => <option key={r}>{r}</option>)}
              </select>
            </F>
            <F label="Contact Number">
              <input value={np.companionContact} onChange={e => npSet("companionContact", e.target.value)}
                placeholder="Mobile number" style={fld} />
            </F>
          </G3>
        </Section>
      )}

      {/* ── Section 8: Consent ── */}
      <Section title="Patient Consent" icon="pi-file-edit" color={C.accent} nabh badge="NABH PFR.1" defaultOpen>
        <label style={{
          display: "flex", alignItems: "flex-start", gap: 12, cursor: "pointer",
          background: np.consentGiven ? C.greenL : "#f8fafc",
          border: `1.5px solid ${np.consentGiven ? C.green : C.border}`,
          borderRadius: 10, padding: "14px 16px", transition: ".15s",
        }}>
          <input type="checkbox" checked={np.consentGiven}
            onChange={e => setNp(prev => ({ ...prev, consentGiven: e.target.checked }))}
            style={{ accentColor: C.green, width: 16, height: 16, marginTop: 2, flexShrink: 0 }} />
          <div>
            <div style={{ fontWeight: 700, fontSize: 13, color: C.text, fontFamily: FF, marginBottom: 4 }}>
              General Consent for OPD Examination & Treatment
            </div>
            <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.6, fontFamily: FF }}>
              I / the patient hereby voluntarily consent to OPD examination, investigations, and treatment as deemed necessary by the attending physician at SphereHealth Hospital. I understand I have the right to refuse treatment and ask questions about my care at any time. (NABH PFR.1 — Patient Rights & Responsibilities)
            </div>
            {np.consentGiven && (
              <div style={{ marginTop: 10 }}>
                <F label="Consent Given By (if not patient)">
                  <input value={np.consentBy} onChange={e => setNp(prev => ({ ...prev, consentBy: e.target.value }))}
                    placeholder="Name of legal guardian / attendant (if patient cannot consent)" style={{ ...fld, marginTop: 4 }} />
                </F>
              </div>
            )}
          </div>
        </label>
        {!np.consentGiven && (
          <div style={{ fontSize: 11, color: C.amber, marginTop: 8, fontFamily: FF, display: "flex", alignItems: "center", gap: 6 }}>
            <i className="pi pi-info-circle" />
            Consent is required to proceed with OPD registration (NABH PFR.1)
          </div>
        )}
      </Section>

      {/* ── Footer actions ── */}
      <div style={{
        background: C.card, borderRadius: 12, padding: "16px 22px",
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
        boxShadow: "0 -2px 12px rgba(0,0,0,.06)", border: `1.5px solid ${C.border}`,
      }}>
        <button onClick={onBack} style={outlineBtn(C)}>
          <i className="pi pi-arrow-left" style={{ fontSize: 11 }} /> Back
        </button>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {!np.consentGiven && (
            <span style={{ fontSize: 12, color: C.amber, fontFamily: FF }}>
              <i className="pi pi-lock" style={{ marginRight: 4 }} />Patient consent required
            </span>
          )}
          <button
            onClick={onSubmit}
            disabled={submitting || !np.consentGiven}
            style={{
              background: submitting || !np.consentGiven ? "#94a3b8" : C.accent,
              color: "#fff", border: "none", borderRadius: 10, padding: "11px 24px",
              fontFamily: FF, fontWeight: 700, fontSize: 13, cursor: submitting || !np.consentGiven ? "not-allowed" : "pointer",
              display: "flex", alignItems: "center", gap: 8, transition: ".15s",
            }}
          >
            <i className={`pi ${submitting ? "pi-spin pi-spinner" : "pi-check-circle"}`} style={{ fontSize: 14 }} />
            {submitting ? "Registering…" : "Register & Generate Token"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   SUCCESS PHASE
══════════════════════════════════════════════════════════════ */
function SuccessPhase({ data, vf, onPrintToken, onNewRegistration, onViewQueue, C, FF }) {
  const { patient, visit } = data;
  return (
    <div style={{ maxWidth: 640, margin: "0 auto" }}>
      {/* Success header */}
      <div style={{
        background: `linear-gradient(135deg, ${C.green}, #15803d)`,
        borderRadius: "16px 16px 0 0", padding: "24px 28px", textAlign: "center", color: "#fff",
      }}>
        <div style={{
          width: 64, height: 64, borderRadius: "50%", background: "rgba(255,255,255,.2)",
          display: "flex", alignItems: "center", justifyContent: "center",
          margin: "0 auto 12px",
        }}>
          <i className="pi pi-check-circle" style={{ fontSize: 32 }} />
        </div>
        <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-.3px", fontFamily: FF }}>Registration Successful!</div>
        <div style={{ fontSize: 13, opacity: .85, marginTop: 4, fontFamily: FF }}>Patient registered & OPD visit created</div>
      </div>

      <div style={{
        background: C.card, borderRadius: "0 0 16px 16px",
        padding: "24px 28px", boxShadow: "0 4px 24px rgba(0,0,0,.1)",
      }}>
        {/* Token */}
        <div style={{
          border: `3px solid ${C.accent}`, borderRadius: 14,
          padding: "20px 24px", textAlign: "center", marginBottom: 20,
        }}>
          <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", fontFamily: FF }}>OPD Token Number</div>
          <div style={{ fontSize: 80, fontWeight: 900, color: C.accent, lineHeight: 1.1, fontFamily: FF }}>
            {String(visit.tokenNumber || "—").padStart(3, "0")}
          </div>
          <div style={{
            background: C.accentL, border: `1px solid ${C.accent}30`,
            borderRadius: 8, padding: "6px 14px", display: "inline-block",
            fontSize: 13, fontWeight: 700, color: C.accent, marginTop: 6, fontFamily: FF,
          }}>
            Visit No: {visit.visitNumber || "—"}
          </div>
        </div>

        {/* UHID bar */}
        <div style={{
          background: C.accent, color: "#fff", borderRadius: 10,
          padding: "10px 16px", textAlign: "center", marginBottom: 16,
        }}>
          <div style={{ fontSize: 10, opacity: .8, letterSpacing: 2, fontFamily: FF }}>UNIQUE HEALTH ID (UHID)</div>
          <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: 3, fontFamily: FF }}>{patient.UHID}</div>
        </div>

        {/* Info grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 18 }}>
          {[
            ["Patient", `${patient.title || ""} ${patient.fullName}`],
            ["Gender / Age", `${patient.gender || "—"} / ${calcAge(patient.dateOfBirth) || "—"} yrs`],
            ["Department", vf.departmentName || "—"],
            ["Consultant", vf.consultantName || "—"],
            ["Visit Type", vf.visitType || "—"],
            ["Date & Time", new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })],
          ].map(([k, v]) => (
            <div key={k} style={{ background: "#f8fafc", borderRadius: 8, padding: "10px 12px" }}>
              <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: .5, fontFamily: FF }}>{k}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginTop: 3, fontFamily: FF }}>{v}</div>
            </div>
          ))}
        </div>

        {/* Vitals pending notice */}
        <div style={{
          background: "#fffbeb", border: "1px solid #fcd34d",
          borderRadius: 8, padding: "10px 14px", marginBottom: 20,
          display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontFamily: FF,
        }}>
          <i className="pi pi-clock" style={{ color: C.amber, fontSize: 14 }} />
          <span style={{ color: "#92400e" }}>
            <strong>Vitals:</strong> Pending — OPD nurse will record vitals from the queue
          </span>
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
          <button onClick={onPrintToken} style={primaryBtn(C)}>
            <i className="pi pi-print" style={{ fontSize: 13 }} /> Print Token
          </button>
          <button onClick={onViewQueue} style={outlineBtn(C)}>
            <i className="pi pi-list" style={{ fontSize: 12 }} /> View OPD Queue
          </button>
          <button onClick={onNewRegistration} style={{
            background: "none", border: `1.5px solid ${C.border}`, borderRadius: 10,
            padding: "10px 18px", cursor: "pointer", fontFamily: FF, fontWeight: 600,
            fontSize: 13, color: C.muted, display: "flex", alignItems: "center", gap: 7,
          }}>
            <i className="pi pi-plus" style={{ fontSize: 11 }} /> New Registration
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Button helpers ── */
const primaryBtn = (C) => ({
  background: C.accent, color: "#fff", border: "none",
  borderRadius: 10, padding: "10px 20px", cursor: "pointer",
  fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 13,
  display: "inline-flex", alignItems: "center", gap: 7, transition: ".15s",
});
const outlineBtn = (C) => ({
  background: "none", color: C.accent, border: `1.5px solid ${C.accent}`,
  borderRadius: 10, padding: "9px 18px", cursor: "pointer",
  fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: 13,
  display: "inline-flex", alignItems: "center", gap: 7,
});

/* ── teal alias (for backward compat) ── */
const teal = "#0d9488";
