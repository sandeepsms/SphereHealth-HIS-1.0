/**
 * OPDRegistrationPage.jsx
 * Universal OPD Registration — Search → Revisit or New Patient → Visit Form → Token
 *
 * Roles: Admin, Receptionist
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { InputText } from "primereact/inputtext";
import { Dropdown } from "primereact/dropdown";
import { Button } from "primereact/button";
import { Toast } from "primereact/toast";
import { Calendar } from "primereact/calendar";
import { InputTextarea } from "primereact/inputtextarea";
import { ProgressSpinner } from "primereact/progressspinner";
import { Tag } from "primereact/tag";
import patientService from "../../Services/patient/patientService";
import opdService from "../../Services/patient/opdService";
import { departmentService } from "../../Services/departmentService";
import { doctorService } from "../../Services/doctors/doctorService";

/* ── Helpers ── */
const calcAge = (dob) => {
  if (!dob) return "";
  const t = new Date(), b = new Date(dob);
  let a = t.getFullYear() - b.getFullYear();
  if (t.getMonth() - b.getMonth() < 0 || (t.getMonth() === b.getMonth() && t.getDate() < b.getDate())) a--;
  return a < 0 ? "" : a;
};

const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-IN") : "—";

const TITLE_OPTS = ["Mr.", "Mrs.", "Miss", "Master", "Baby", "Dr."].map(v => ({ label: v, value: v }));
const GENDER_OPTS = ["Male", "Female", "Other"].map(v => ({ label: v, value: v }));
const BLOOD_OPTS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-", "Not Known"].map(v => ({ label: v, value: v }));
const MARITAL_OPTS = ["Single", "Married", "Divorced", "Widowed", "Other"].map(v => ({ label: v, value: v }));
const PAYMENT_OPTS = ["GENERAL", "TPA", "CORPORATE"].map(v => ({ label: v, value: v }));
const VISIT_TYPE_OPTS = ["First Visit", "Follow-up", "Routine Checkup"].map(v => ({ label: v, value: v }));

/* ── Token Slip Printer ── */
const printToken = ({ patient, visit, department, doctor }) => {
  const w = window.open("", "_blank", "width=400,height=500");
  w.document.write(`
    <html><head><title>OPD Token</title>
    <style>
      body{font-family:Arial,sans-serif;margin:0;padding:20px;background:#fff}
      .header{text-align:center;border-bottom:2px solid #0891b2;padding-bottom:12px;margin-bottom:16px}
      .hospital{font-size:18px;font-weight:700;color:#0891b2}
      .token-box{border:3px solid #0891b2;border-radius:12px;padding:20px;text-align:center;margin:16px 0}
      .token-num{font-size:64px;font-weight:900;color:#0891b2;line-height:1}
      .token-label{font-size:12px;color:#64748b;margin-top:4px}
      .visit-num{font-size:13px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:6px;padding:6px 12px;margin:8px 0;font-weight:600;color:#0369a1}
      .info{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px}
      .info-item{background:#f8fafc;border-radius:6px;padding:8px 10px}
      .info-label{font-size:10px;color:#64748b;font-weight:600;text-transform:uppercase}
      .info-value{font-size:13px;color:#1e293b;font-weight:600;margin-top:2px}
      .uhid-bar{background:#0891b2;color:#fff;padding:8px;border-radius:6px;text-align:center;margin:12px 0}
      .uhid-num{font-size:18px;font-weight:700;letter-spacing:2px}
      .footer{text-align:center;font-size:11px;color:#94a3b8;margin-top:16px;border-top:1px solid #e2e8f0;padding-top:12px}
    </style></head><body>
    <div class="header">
      <div class="hospital">SphereHealth Hospital</div>
      <div style="font-size:12px;color:#64748b">OPD Registration Slip</div>
    </div>
    <div class="token-box">
      <div class="token-num">${String(visit.tokenNumber || "—").padStart(3, "0")}</div>
      <div class="token-label">TOKEN NUMBER</div>
    </div>
    <div class="visit-num">Visit No: ${visit.visitNumber}</div>
    <div class="uhid-bar">
      <div style="font-size:10px;opacity:.8">UHID</div>
      <div class="uhid-num">${patient.UHID}</div>
    </div>
    <div class="info">
      <div class="info-item"><div class="info-label">Patient</div><div class="info-value">${patient.title || ""} ${patient.fullName}</div></div>
      <div class="info-item"><div class="info-label">Visit #</div><div class="info-value">${visit.patientVisitSeq || 1}</div></div>
      <div class="info-item"><div class="info-label">Department</div><div class="info-value">${department}</div></div>
      <div class="info-item"><div class="info-label">Doctor</div><div class="info-value">${doctor}</div></div>
      <div class="info-item"><div class="info-label">Date</div><div class="info-value">${fmtDate(new Date())}</div></div>
      <div class="info-item"><div class="info-label">Contact</div><div class="info-value">${patient.contactNumber}</div></div>
    </div>
    <div class="footer">Please keep this slip and present it to the nurse for vitals.<br>SphereHealth HMS · ${new Date().toLocaleString("en-IN")}</div>
    </body></html>
  `);
  w.document.close();
  setTimeout(() => { w.print(); }, 400);
};

/* ══════════════════════════════════════════════════════════════
   MAIN COMPONENT
══════════════════════════════════════════════════════════════ */
export default function OPDRegistrationPage() {
  const navigate = useNavigate();
  const toast = useRef(null);

  // ── Search phase ──
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const [searchDone, setSearchDone] = useState(false);

  // ── Flow control ──
  // phase: "search" | "revisit" | "new-patient" | "visit-form" | "success"
  const [phase, setPhase] = useState("search");
  const [selectedPatient, setSelectedPatient] = useState(null);

  // ── New patient form ──
  const [newPatient, setNewPatient] = useState({
    title: "", fullName: "", gender: "", dateOfBirth: null,
    maritalStatus: "", contactNumber: "", email: "",
    bloodGroup: "", knownAllergies: "",
    address: { completeAddress: "", pincode: "", city: "", state: "", district: "" },
    companionName: "", companionRelationship: "", companionContact: "",
    paymentType: "GENERAL",
  });

  // ── Visit form (shared for new/revisit) ──
  const [departments, setDepartments] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [visitForm, setVisitForm] = useState({
    departmentId: null, departmentName: "",
    doctorId: null, consultantName: "",
    visitType: "First Visit",
    chiefComplaint: "", complaintDuration: "",
    historyOfPresentIllness: "", pastMedicalHistory: "",
    allergyHistory: "", currentMedications: "",
  });
  const [loadingDept, setLoadingDept] = useState(false);
  const [loadingDoctors, setLoadingDoctors] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // ── Success ──
  const [successData, setSuccessData] = useState(null);

  // Load departments on mount
  useEffect(() => {
    loadDepartments();
  }, []);

  const loadDepartments = async () => {
    setLoadingDept(true);
    try {
      const res = await departmentService.getActiveDepartments();
      const depts = res.data || res || [];
      setDepartments(
        (Array.isArray(depts) ? depts : []).map(d => ({
          label: d.departmentName,
          value: d._id,
          name: d.departmentName,
        }))
      );
    } catch (e) {
      console.error("Failed to load departments", e);
    } finally {
      setLoadingDept(false);
    }
  };

  const loadDoctors = async (departmentId) => {
    if (!departmentId) { setDoctors([]); return; }
    setLoadingDoctors(true);
    try {
      const res = await doctorService.getDoctorsByDepartment(departmentId);
      const list = res.data?.data || res.data || res || [];
      setDoctors(
        (Array.isArray(list) ? list : []).map(d => ({
          label: `Dr. ${d.personalInfo?.firstName || ""} ${d.personalInfo?.lastName || ""}`.trim(),
          value: d._id,
          name: `Dr. ${d.personalInfo?.firstName || ""} ${d.personalInfo?.lastName || ""}`.trim(),
        }))
      );
    } catch (e) {
      setDoctors([]);
    } finally {
      setLoadingDoctors(false);
    }
  };

  /* ── Search patients ── */
  const doSearch = async () => {
    if (!searchQuery.trim() || searchQuery.trim().length < 2) return;
    setSearching(true);
    setSearchDone(false);
    setSearchResults([]);
    try {
      const res = await patientService.searchPatients(searchQuery.trim(), 20);
      const list = res.data || res || [];
      setSearchResults(Array.isArray(list) ? list : []);
    } catch (e) {
      toast.current?.show({ severity: "error", summary: "Search failed", detail: e.message, life: 3000 });
    } finally {
      setSearching(false);
      setSearchDone(true);
    }
  };

  const handleSearchKey = (e) => { if (e.key === "Enter") doSearch(); };

  /* ── Select existing patient (revisit) ── */
  const selectPatient = (patient) => {
    setSelectedPatient(patient);
    setPhase("visit-form");
    setVisitForm(prev => ({
      ...prev,
      visitType: (patient.totalOPDVisits || 0) > 0 ? "Follow-up" : "First Visit",
    }));
  };

  /* ── Go to new patient form ── */
  const startNewPatient = () => {
    setSelectedPatient(null);
    setPhase("new-patient");
  };

  /* ── After new patient form → visit form ── */
  const proceedToVisit = () => {
    const np = newPatient;
    if (!np.fullName.trim()) return showErr("Full name is required");
    if (!np.title) return showErr("Title is required");
    if (!np.gender) return showErr("Gender is required");
    if (!np.dateOfBirth) return showErr("Date of birth is required");
    if (!np.contactNumber.trim()) return showErr("Contact number is required");
    if (!np.address.pincode.trim()) return showErr("Pincode is required");
    setPhase("visit-form");
  };

  const showErr = (msg) => toast.current?.show({ severity: "error", summary: "Validation", detail: msg, life: 3000 });

  /* ── Department change → reload doctors ── */
  const onDeptChange = (deptId) => {
    const dept = departments.find(d => d.value === deptId);
    setVisitForm(prev => ({ ...prev, departmentId: deptId, departmentName: dept?.name || "", doctorId: null, consultantName: "" }));
    loadDoctors(deptId);
  };

  const onDoctorChange = (docId) => {
    const doc = doctors.find(d => d.value === docId);
    setVisitForm(prev => ({ ...prev, doctorId: docId, consultantName: doc?.name || "" }));
  };

  /* ── Final submit ── */
  const handleSubmit = async () => {
    if (!visitForm.departmentId) return showErr("Please select a department");
    if (!visitForm.doctorId) return showErr("Please select a doctor");
    if (!visitForm.chiefComplaint.trim()) return showErr("Chief complaint is required");

    setSubmitting(true);
    try {
      let patientDoc = selectedPatient;

      // If new patient — create first
      if (!patientDoc) {
        const payload = {
          ...newPatient,
          dateOfBirth: newPatient.dateOfBirth,
          registrationType: "OPD",
          department: visitForm.departmentId,
          doctor: visitForm.doctorId,
        };
        const pr = await patientService.createPatient(payload);
        patientDoc = pr.data || pr;
      }

      // Create OPD visit
      const visitPayload = {
        patientId: patientDoc._id,
        UHID: patientDoc.UHID,
        departmentId: visitForm.departmentId,
        department: visitForm.departmentName,
        doctorId: visitForm.doctorId,
        consultantName: visitForm.consultantName,
        visitType: visitForm.visitType,
        chiefComplaint: visitForm.chiefComplaint,
        complaintDuration: visitForm.complaintDuration,
        historyOfPresentIllness: visitForm.historyOfPresentIllness,
        pastMedicalHistory: visitForm.pastMedicalHistory,
        allergyHistory: visitForm.allergyHistory,
        currentMedications: visitForm.currentMedications,
      };

      const vr = await opdService.createOPDVisit(visitPayload);
      const visit = vr.data?.data || vr.data || vr;

      setSuccessData({ patient: patientDoc, visit });
      setPhase("success");
    } catch (e) {
      toast.current?.show({ severity: "error", summary: "Error", detail: e?.response?.data?.message || e.message, life: 5000 });
    } finally {
      setSubmitting(false);
    }
  };

  /* ── NP field helpers ── */
  const npSet = (field, val) => setNewPatient(prev => ({ ...prev, [field]: val }));
  const npAddrSet = (field, val) => setNewPatient(prev => ({ ...prev, address: { ...prev.address, [field]: val } }));
  const vfSet = (field, val) => setVisitForm(prev => ({ ...prev, [field]: val }));

  /* ════════════════════ RENDER ════════════════════ */

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "0 0 40px" }}>
      <Toast ref={toast} />

      {/* ── Header ── */}
      <div style={{ background: "linear-gradient(135deg,#0891b2,#0e7490)", borderRadius: 14, padding: "24px 28px", marginBottom: 24, color: "#fff" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <i className="pi pi-user-plus" style={{ fontSize: 28 }} />
          <div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>OPD Registration</div>
            <div style={{ opacity: .8, fontSize: 13 }}>Search existing patient or register new — UHID is preserved for all visits</div>
          </div>
        </div>
      </div>

      {/* ════ PHASE: SEARCH ════ */}
      {(phase === "search") && (
        <SearchPhase
          searchQuery={searchQuery} setSearchQuery={setSearchQuery}
          searching={searching} searchDone={searchDone}
          searchResults={searchResults}
          doSearch={doSearch} handleSearchKey={handleSearchKey}
          selectPatient={selectPatient} startNewPatient={startNewPatient}
        />
      )}

      {/* ════ PHASE: NEW PATIENT FORM ════ */}
      {phase === "new-patient" && (
        <NewPatientForm
          newPatient={newPatient} npSet={npSet} npAddrSet={npAddrSet}
          onBack={() => setPhase("search")} onNext={proceedToVisit}
        />
      )}

      {/* ════ PHASE: VISIT FORM ════ */}
      {phase === "visit-form" && (
        <VisitForm
          selectedPatient={selectedPatient}
          departments={departments} doctors={doctors}
          loadingDoctors={loadingDoctors}
          visitForm={visitForm} vfSet={vfSet}
          onDeptChange={onDeptChange} onDoctorChange={onDoctorChange}
          onBack={() => setPhase(selectedPatient ? "search" : "new-patient")}
          onSubmit={handleSubmit} submitting={submitting}
        />
      )}

      {/* ════ PHASE: SUCCESS ════ */}
      {phase === "success" && successData && (
        <SuccessCard
          data={successData}
          departments={departments} doctors={doctors}
          visitForm={visitForm}
          onNewRegistration={() => {
            setPhase("search");
            setSearchQuery(""); setSearchResults([]); setSearchDone(false);
            setSelectedPatient(null);
            setVisitForm({ departmentId: null, departmentName: "", doctorId: null, consultantName: "", visitType: "First Visit", chiefComplaint: "", complaintDuration: "", historyOfPresentIllness: "", pastMedicalHistory: "", allergyHistory: "", currentMedications: "" });
            setNewPatient({ title: "", fullName: "", gender: "", dateOfBirth: null, maritalStatus: "", contactNumber: "", email: "", bloodGroup: "", knownAllergies: "", address: { completeAddress: "", pincode: "", city: "", state: "", district: "" }, companionName: "", companionRelationship: "", companionContact: "", paymentType: "GENERAL" });
          }}
          onViewQueue={() => navigate("/opd-queue")}
        />
      )}
    </div>
  );
}

/* ════════════════ SEARCH PHASE ════════════════ */
function SearchPhase({ searchQuery, setSearchQuery, searching, searchDone, searchResults, doSearch, handleSearchKey, selectPatient, startNewPatient }) {
  return (
    <div>
      {/* Search bar */}
      <div style={{ background: "#fff", borderRadius: 12, padding: "24px 28px", boxShadow: "0 1px 6px rgba(0,0,0,.08)", marginBottom: 20 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: "#1e293b", marginBottom: 12 }}>
          <i className="pi pi-search" style={{ marginRight: 8, color: "#0891b2" }} />
          Search by Name, UHID, or Phone Number
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <InputText
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={handleSearchKey}
            placeholder="e.g. Rahul Sharma  /  UH00000042  /  9876543210"
            style={{ flex: 1, fontSize: 15, padding: "10px 14px" }}
            autoFocus
          />
          <Button
            label={searching ? "Searching…" : "Search"}
            icon={searching ? "pi pi-spin pi-spinner" : "pi pi-search"}
            onClick={doSearch}
            disabled={searching || searchQuery.trim().length < 2}
            style={{ background: "#0891b2", border: "none", padding: "10px 20px" }}
          />
        </div>
        <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 6 }}>Press Enter or click Search · minimum 2 characters</div>
      </div>

      {/* Results */}
      {searching && (
        <div style={{ textAlign: "center", padding: 40 }}>
          <ProgressSpinner style={{ width: 40, height: 40 }} />
          <div style={{ marginTop: 10, color: "#64748b" }}>Searching patients…</div>
        </div>
      )}

      {searchDone && !searching && (
        <div>
          {searchResults.length > 0 ? (
            <div>
              <div style={{ fontSize: 13, color: "#64748b", marginBottom: 10 }}>
                {searchResults.length} patient{searchResults.length > 1 ? "s" : ""} found — select to create a new visit
              </div>
              {searchResults.map(p => (
                <PatientCard key={p._id} patient={p} onSelect={() => selectPatient(p)} />
              ))}
              <div style={{ textAlign: "center", marginTop: 16 }}>
                <span style={{ fontSize: 13, color: "#64748b" }}>Patient not in the list? </span>
                <Button label="Register as New Patient" icon="pi pi-user-plus" className="p-button-outlined" onClick={startNewPatient}
                  style={{ fontSize: 13, padding: "6px 14px", color: "#0891b2", border: "1px solid #0891b2" }} />
              </div>
            </div>
          ) : (
            <div style={{ background: "#fff", borderRadius: 12, padding: "32px 28px", textAlign: "center", boxShadow: "0 1px 6px rgba(0,0,0,.08)" }}>
              <i className="pi pi-user-plus" style={{ fontSize: 40, color: "#0891b2", marginBottom: 12 }} />
              <div style={{ fontSize: 17, fontWeight: 600, color: "#1e293b" }}>No patient found</div>
              <div style={{ color: "#64748b", margin: "8px 0 20px" }}>No record matches "{searchQuery}". Register as a new patient?</div>
              <Button label="Register New Patient" icon="pi pi-user-plus" onClick={startNewPatient}
                style={{ background: "#0891b2", border: "none" }} />
            </div>
          )}
        </div>
      )}

      {!searchDone && !searching && (
        <div style={{ background: "#fff", borderRadius: 12, padding: "32px 28px", textAlign: "center", boxShadow: "0 1px 6px rgba(0,0,0,.08)" }}>
          <i className="pi pi-search" style={{ fontSize: 48, color: "#cbd5e1", marginBottom: 12 }} />
          <div style={{ color: "#94a3b8", fontSize: 15 }}>Search for a patient above or register a new one</div>
          <Button label="Register New Patient" icon="pi pi-user-plus" className="p-button-outlined" onClick={startNewPatient}
            style={{ marginTop: 16, color: "#0891b2", border: "1px solid #0891b2" }} />
        </div>
      )}
    </div>
  );
}

/* ── Patient Search Result Card ── */
function PatientCard({ patient, onSelect }) {
  const totalVisits = (patient.totalOPDVisits || 0) + (patient.totalIPDVisits || 0) + (patient.totalEmergencyVisits || 0);
  return (
    <div onClick={onSelect} style={{
      background: "#fff", borderRadius: 10, padding: "14px 18px", marginBottom: 10,
      boxShadow: "0 1px 6px rgba(0,0,0,.06)", cursor: "pointer", border: "2px solid transparent",
      display: "flex", alignItems: "center", gap: 16, transition: "border-color .15s",
    }}
      onMouseEnter={e => e.currentTarget.style.borderColor = "#0891b2"}
      onMouseLeave={e => e.currentTarget.style.borderColor = "transparent"}
    >
      <div style={{ width: 48, height: 48, borderRadius: "50%", background: "#e0f2fe", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <i className="pi pi-user" style={{ color: "#0891b2", fontSize: 22 }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 700, fontSize: 15, color: "#1e293b" }}>{patient.title} {patient.fullName}</span>
          <Tag value={patient.UHID} severity="info" style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1 }} />
          {totalVisits > 0 && <Tag value={`${totalVisits} visit${totalVisits > 1 ? "s" : ""}`} severity="success" style={{ fontSize: 11 }} />}
        </div>
        <div style={{ fontSize: 12, color: "#64748b", marginTop: 3 }}>
          {patient.gender} · {calcAge(patient.dateOfBirth)} yrs · {patient.contactNumber}
          {patient.lastVisitDate && ` · Last visit: ${fmtDate(patient.lastVisitDate)}`}
        </div>
        {patient.department?.departmentName && (
          <div style={{ fontSize: 12, color: "#0891b2", marginTop: 2 }}>Dept: {patient.department.departmentName}</div>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
        <Button label="Revisit" icon="pi pi-plus" style={{ background: "#0891b2", border: "none", fontSize: 12, padding: "6px 12px" }} onClick={onSelect} />
        <span style={{ fontSize: 11, color: "#94a3b8" }}>New OPD Visit</span>
      </div>
    </div>
  );
}

/* ════════════════ NEW PATIENT FORM ════════════════ */
function NewPatientForm({ newPatient, npSet, npAddrSet, onBack, onNext }) {
  return (
    <div style={{ background: "#fff", borderRadius: 12, padding: "24px 28px", boxShadow: "0 1px 6px rgba(0,0,0,.08)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
        <Button icon="pi pi-arrow-left" className="p-button-text p-button-sm" onClick={onBack} />
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#1e293b" }}>New Patient Registration</div>
          <div style={{ fontSize: 12, color: "#64748b" }}>A new UHID will be generated for this patient</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 12, marginBottom: 12 }}>
        <div>
          <label style={lbl}>Title *</label>
          <Dropdown value={newPatient.title} options={TITLE_OPTS} onChange={e => npSet("title", e.value)} placeholder="Title" style={{ width: "100%" }} />
        </div>
        <div>
          <label style={lbl}>Full Name *</label>
          <InputText value={newPatient.fullName} onChange={e => npSet("fullName", e.target.value)} placeholder="Patient full name" style={{ width: "100%" }} />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
        <div>
          <label style={lbl}>Gender *</label>
          <Dropdown value={newPatient.gender} options={GENDER_OPTS} onChange={e => npSet("gender", e.value)} placeholder="Gender" style={{ width: "100%" }} />
        </div>
        <div>
          <label style={lbl}>Date of Birth *</label>
          <Calendar value={newPatient.dateOfBirth} onChange={e => npSet("dateOfBirth", e.value)} dateFormat="dd/mm/yy" showIcon maxDate={new Date()} style={{ width: "100%" }} />
        </div>
        <div>
          <label style={lbl}>Marital Status</label>
          <Dropdown value={newPatient.maritalStatus} options={MARITAL_OPTS} onChange={e => npSet("maritalStatus", e.value)} placeholder="Status" style={{ width: "100%" }} />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
        <div>
          <label style={lbl}>Contact Number *</label>
          <InputText value={newPatient.contactNumber} onChange={e => npSet("contactNumber", e.target.value)} placeholder="10-digit mobile" style={{ width: "100%" }} />
        </div>
        <div>
          <label style={lbl}>Email</label>
          <InputText value={newPatient.email} onChange={e => npSet("email", e.target.value)} placeholder="patient@email.com" style={{ width: "100%" }} />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
        <div>
          <label style={lbl}>Blood Group</label>
          <Dropdown value={newPatient.bloodGroup} options={BLOOD_OPTS} onChange={e => npSet("bloodGroup", e.value)} placeholder="Blood Group" style={{ width: "100%" }} />
        </div>
        <div>
          <label style={lbl}>Payment Type</label>
          <Dropdown value={newPatient.paymentType} options={PAYMENT_OPTS} onChange={e => npSet("paymentType", e.value)} style={{ width: "100%" }} />
        </div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={lbl}>Known Allergies</label>
        <InputText value={newPatient.knownAllergies} onChange={e => npSet("knownAllergies", e.target.value)} placeholder="NKDA / list allergies" style={{ width: "100%" }} />
      </div>

      <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: 12, marginTop: 4, marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#475569", marginBottom: 8 }}>Address</div>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 12, marginBottom: 10 }}>
          <div>
            <label style={lbl}>Complete Address</label>
            <InputText value={newPatient.address.completeAddress} onChange={e => npAddrSet("completeAddress", e.target.value)} style={{ width: "100%" }} />
          </div>
          <div>
            <label style={lbl}>Pincode *</label>
            <InputText value={newPatient.address.pincode} onChange={e => npAddrSet("pincode", e.target.value)} style={{ width: "100%" }} />
          </div>
          <div>
            <label style={lbl}>City</label>
            <InputText value={newPatient.address.city} onChange={e => npAddrSet("city", e.target.value)} style={{ width: "100%" }} />
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label style={lbl}>State</label>
            <InputText value={newPatient.address.state} onChange={e => npAddrSet("state", e.target.value)} style={{ width: "100%" }} />
          </div>
          <div>
            <label style={lbl}>District</label>
            <InputText value={newPatient.address.district} onChange={e => npAddrSet("district", e.target.value)} style={{ width: "100%" }} />
          </div>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, borderTop: "1px solid #e2e8f0", paddingTop: 16 }}>
        <Button label="Back" icon="pi pi-arrow-left" className="p-button-outlined" onClick={onBack} />
        <Button label="Next: Visit Details" icon="pi pi-arrow-right" iconPos="right" onClick={onNext}
          style={{ background: "#0891b2", border: "none" }} />
      </div>
    </div>
  );
}

/* ════════════════ VISIT FORM ════════════════ */
function VisitForm({ selectedPatient, departments, doctors, loadingDoctors, visitForm, vfSet, onDeptChange, onDoctorChange, onBack, onSubmit, submitting }) {
  return (
    <div>
      {/* Existing patient banner */}
      {selectedPatient && (
        <div style={{ background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 10, padding: "14px 18px", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <i className="pi pi-user" style={{ fontSize: 20, color: "#0891b2" }} />
            <div>
              <div style={{ fontWeight: 700, color: "#0c4a6e" }}>{selectedPatient.title} {selectedPatient.fullName}</div>
              <div style={{ fontSize: 12, color: "#0369a1" }}>
                UHID: <strong>{selectedPatient.UHID}</strong> · {selectedPatient.gender} · {calcAge(selectedPatient.dateOfBirth)} yrs · {selectedPatient.contactNumber}
                {selectedPatient.totalOPDVisits > 0 && ` · OPD visits so far: ${selectedPatient.totalOPDVisits}`}
              </div>
            </div>
          </div>
        </div>
      )}

      <div style={{ background: "#fff", borderRadius: 12, padding: "24px 28px", boxShadow: "0 1px 6px rgba(0,0,0,.08)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
          <Button icon="pi pi-arrow-left" className="p-button-text p-button-sm" onClick={onBack} />
          <div style={{ fontSize: 16, fontWeight: 700, color: "#1e293b" }}>OPD Visit Details</div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
          <div>
            <label style={lbl}>Department *</label>
            <Dropdown value={visitForm.departmentId} options={departments} onChange={e => onDeptChange(e.value)}
              placeholder="Select Department" filter style={{ width: "100%" }} />
          </div>
          <div>
            <label style={lbl}>Doctor *</label>
            <Dropdown value={visitForm.doctorId} options={doctors}
              onChange={e => onDoctorChange(e.value)}
              placeholder={loadingDoctors ? "Loading doctors…" : visitForm.departmentId ? "Select Doctor" : "Select department first"}
              disabled={!visitForm.departmentId || loadingDoctors}
              filter style={{ width: "100%" }}
            />
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={lbl}>Visit Type</label>
          <Dropdown value={visitForm.visitType} options={VISIT_TYPE_OPTS} onChange={e => vfSet("visitType", e.value)} style={{ width: "100%" }} />
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={lbl}>Chief Complaint *</label>
          <InputTextarea value={visitForm.chiefComplaint} onChange={e => vfSet("chiefComplaint", e.target.value)}
            rows={2} placeholder="Main reason for visit…" style={{ width: "100%" }} autoResize />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
          <div>
            <label style={lbl}>Duration of Complaint</label>
            <InputText value={visitForm.complaintDuration} onChange={e => vfSet("complaintDuration", e.target.value)}
              placeholder="e.g. 3 days, 2 weeks" style={{ width: "100%" }} />
          </div>
          <div>
            <label style={lbl}>Current Medications</label>
            <InputText value={visitForm.currentMedications} onChange={e => vfSet("currentMedications", e.target.value)}
              placeholder="Any ongoing medications" style={{ width: "100%" }} />
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={lbl}>History of Present Illness</label>
          <InputTextarea value={visitForm.historyOfPresentIllness} onChange={e => vfSet("historyOfPresentIllness", e.target.value)}
            rows={2} placeholder="Brief history…" style={{ width: "100%" }} autoResize />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
          <div>
            <label style={lbl}>Past Medical History</label>
            <InputTextarea value={visitForm.pastMedicalHistory} onChange={e => vfSet("pastMedicalHistory", e.target.value)}
              rows={2} placeholder="Past illnesses, surgeries…" style={{ width: "100%" }} autoResize />
          </div>
          <div>
            <label style={lbl}>Allergy History</label>
            <InputTextarea value={visitForm.allergyHistory} onChange={e => vfSet("allergyHistory", e.target.value)}
              rows={2} placeholder="Drug / food allergies…" style={{ width: "100%" }} autoResize />
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, borderTop: "1px solid #e2e8f0", paddingTop: 16 }}>
          <Button label="Back" icon="pi pi-arrow-left" className="p-button-outlined" onClick={onBack} />
          <Button
            label={submitting ? "Registering…" : "Register & Generate Token"}
            icon={submitting ? "pi pi-spin pi-spinner" : "pi pi-check"}
            disabled={submitting}
            onClick={onSubmit}
            style={{ background: "#0891b2", border: "none" }}
          />
        </div>
      </div>
    </div>
  );
}

/* ════════════════ SUCCESS CARD ════════════════ */
function SuccessCard({ data, visitForm, onNewRegistration, onViewQueue }) {
  const { patient, visit } = data;
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ background: "#fff", borderRadius: 14, padding: "32px 28px", boxShadow: "0 4px 20px rgba(0,0,0,.1)", maxWidth: 580, margin: "0 auto" }}>
        <div style={{ width: 72, height: 72, background: "#dcfce7", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
          <i className="pi pi-check" style={{ fontSize: 32, color: "#16a34a" }} />
        </div>
        <div style={{ fontSize: 20, fontWeight: 700, color: "#1e293b" }}>Registration Successful!</div>
        <div style={{ color: "#64748b", marginTop: 4, marginBottom: 20 }}>Patient registered & OPD visit created</div>

        {/* Token */}
        <div style={{ border: "3px solid #0891b2", borderRadius: 12, padding: "20px", marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600, letterSpacing: 1, textTransform: "uppercase" }}>Token Number</div>
          <div style={{ fontSize: 72, fontWeight: 900, color: "#0891b2", lineHeight: 1 }}>{String(visit.tokenNumber || "—").padStart(3, "0")}</div>
        </div>

        {/* Key info grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 20 }}>
          {[
            ["UHID", patient.UHID],
            ["Visit No.", visit.visitNumber],
            ["Patient", `${patient.title || ""} ${patient.fullName}`],
            ["Visit #", `${visit.patientVisitSeq || 1}${(visit.patientVisitSeq === 1) ? "st" : visit.patientVisitSeq === 2 ? "nd" : visit.patientVisitSeq === 3 ? "rd" : "th"} OPD`],
            ["Department", visitForm.departmentName],
            ["Doctor", visitForm.consultantName],
          ].map(([k, v]) => (
            <div key={k} style={{ background: "#f8fafc", borderRadius: 8, padding: "10px 12px", textAlign: "left" }}>
              <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase" }}>{k}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#1e293b", marginTop: 2 }}>{v}</div>
            </div>
          ))}
        </div>

        <div style={{ background: "#fef3c7", border: "1px solid #fcd34d", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#92400e", marginBottom: 20 }}>
          <i className="pi pi-info-circle" style={{ marginRight: 6 }} />
          Vitals status: <strong>Pending</strong> — Nurse will enter vitals from the OPD Queue
        </div>

        <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
          <Button label="Print Token" icon="pi pi-print" onClick={() => printToken({ patient, visit, department: visitForm.departmentName, doctor: visitForm.consultantName })}
            style={{ background: "#0891b2", border: "none" }} />
          <Button label="View OPD Queue" icon="pi pi-list" className="p-button-outlined" onClick={onViewQueue}
            style={{ color: "#0891b2", border: "1px solid #0891b2" }} />
          <Button label="New Registration" icon="pi pi-plus" className="p-button-outlined" onClick={onNewRegistration}
            style={{ color: "#64748b", border: "1px solid #94a3b8" }} />
        </div>
      </div>
    </div>
  );
}

const lbl = { display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 4 };
