/**
 * EmergencyRegistrationPage.jsx
 * NABH-Compliant Emergency Registration
 * Standards: NABH EM.1 · EM.4 (Triage) · EM.9 (MLC) · MOM.1 (Allergies) · IPSG.1 (ID)
 *
 * Design pattern: matches IPDAdmissionPage (Section, F, G2/G3/G4, inline-styles)
 * Color: Red #dc2626
 */

import React, { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import emergencyService from "../../Services/patient/emergencyService";
import patientService from "../../Services/patient/patientService";
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
  accent: "#dc2626",    // ER Red
  accentL: "#fef2f2",
  accentDark: "#991b1b",
  blue: "#1e40af",
  blueL: "#eff6ff",
  green: "#16a34a",
  greenL: "#dcfce7",
  amber: "#d97706",
  amberL: "#fffbeb",
  teal: "#0d9488",
  tealL: "#f0fdfa",
  slate: "#334155",
  orange: "#ea580c",
  orangeL: "#fff7ed",
  yellow: "#ca8a04",
  yellowL: "#fefce8",
  purple: "#7c3aed",
};

const FF = "'DM Sans', sans-serif";

const G2 = ({ children, gap = 14 }) => (
  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap }}>{children}</div>
);
const G3 = ({ children, gap = 12 }) => (
  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap }}>{children}</div>
);
const G4 = ({ children }) => (
  <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>{children}</div>
);

function F({ label, required, children, hint, span }) {
  return (
    <div style={span ? { gridColumn: `span ${span}` } : {}}>
      <label style={{
        display: "block", fontSize: 11, fontWeight: 700, color: C.muted,
        textTransform: "uppercase", letterSpacing: ".6px", marginBottom: 4, fontFamily: FF,
      }}>
        {label}{required && <span style={{ color: C.accent, marginLeft: 3 }}>*</span>}
      </label>
      {children}
      {hint && <div style={{ fontSize: 10, color: C.muted, marginTop: 3, fontFamily: FF }}>{hint}</div>}
    </div>
  );
}

function Section({ title, icon, color = C.accent, badge, children, defaultOpen = true, nabh, urgent }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{
      background: C.card,
      border: urgent ? `2px solid ${color}` : `1.5px solid ${color}25`,
      borderRadius: 12, overflow: "hidden", marginBottom: 14,
      boxShadow: urgent ? `0 2px 12px ${color}20` : "0 1px 4px rgba(0,0,0,.04)",
    }}>
      <div onClick={() => setOpen(o => !o)} style={{
        padding: "11px 18px",
        background: urgent ? color + "12" : color + "08",
        borderBottom: open ? `1px solid ${color}${urgent ? "40" : "18"}` : "none",
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
          <span style={{ fontWeight: 700, fontSize: 13, color: urgent ? color : C.text, fontFamily: FF }}>{title}</span>
          {urgent && (
            <span style={{
              background: color, color: "#fff",
              fontSize: 9, fontWeight: 800, padding: "2px 8px", borderRadius: 4, letterSpacing: 1, fontFamily: FF,
              animation: "pulse 2s infinite",
            }}>PRIORITY</span>
          )}
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

/* ══════════════════════════════════════════════════════════════
   TRIAGE CONFIG (NABH EM.4)
══════════════════════════════════════════════════════════════ */
const TRIAGE_LEVELS = [
  {
    code: "P1", label: "Critical", color: "#dc2626", bg: "#fef2f2", border: "#fca5a5",
    icon: "🔴", description: "Immediate life-threatening — resuscitation required",
    examples: "Cardiac arrest, respiratory failure, major trauma, unconscious",
    maxWait: "Immediate",
  },
  {
    code: "P2", label: "Emergency", color: "#ea580c", bg: "#fff7ed", border: "#fdba74",
    icon: "🟠", description: "Very urgent — high risk of deterioration",
    examples: "Chest pain, stroke symptoms, severe dyspnea, major fractures",
    maxWait: "< 15 min",
  },
  {
    code: "P3", label: "Urgent", color: "#ca8a04", bg: "#fefce8", border: "#fde68a",
    icon: "🟡", description: "Urgent but stable — can wait briefly",
    examples: "Moderate pain, high fever, vomiting, minor injuries",
    maxWait: "< 30 min",
  },
  {
    code: "P4", label: "Semi-urgent", color: "#16a34a", bg: "#f0fdf4", border: "#bbf7d0",
    icon: "🟢", description: "Less acute — stable condition",
    examples: "Minor illness, wound dressing, prescription review",
    maxWait: "< 60 min",
  },
  {
    code: "P5", label: "Non-urgent", color: "#0d9488", bg: "#f0fdfa", border: "#99f6e4",
    icon: "🔵", description: "Non-urgent — could be managed at OPD",
    examples: "Routine query, minor skin lesions, chronic conditions",
    maxWait: "< 120 min",
  },
];

const ARRIVAL_MODE = ["Ambulance", "Walk-in", "Police / Law enforcement", "Referred from another hospital", "Air ambulance", "Other"];
const GENDER_OPTS = ["Male", "Female", "Other"];
const TITLE_OPTS = ["Mr.", "Mrs.", "Miss", "Master", "Baby", "Dr.", "Unknown"];
const BLOOD_OPTS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-", "Not Known"];
const MLC_TYPES = [
  "Road Traffic Accident (RTA)", "Physical Assault / Alleged Assault", "Sexual Assault / Rape",
  "Attempted Suicide / Self-harm", "Poisoning / Drug overdose", "Burns (suspicious)",
  "Industrial / Occupational Injury", "Firearm / Weapon injury", "Drowning", "Unknown cause of injury",
  "Other MLC",
];
const DISPOSITION_OPTS = ["Active", "Admitted to IPD", "Discharged", "Referred out", "Absconded / LAMA", "Expired"];

/* ── Helpers ── */
const calcAge = (dob) => {
  if (!dob) return "";
  const t = new Date(), b = new Date(dob);
  let a = t.getFullYear() - b.getFullYear();
  if (t.getMonth() - b.getMonth() < 0 || (t.getMonth() === b.getMonth() && t.getDate() < b.getDate())) a--;
  return a < 0 ? "" : a;
};
const nowDateTime = () => new Date().toISOString().slice(0, 16);
const todayISO = () => new Date().toISOString().split("T")[0];

/* ── Wristband Printer ── */
const printWristband = ({ patient, erVisit, triage }) => {
  const t = TRIAGE_LEVELS.find(t => t.label === triage) || TRIAGE_LEVELS[0];
  const w = window.open("", "_blank", "width=380,height=480");
  w.document.write(`
    <html><head><title>ER Wristband</title>
    <style>
      *{box-sizing:border-box}
      body{font-family:'DM Sans',Arial,sans-serif;margin:0;padding:16px;background:#fff}
      .band{border:2px solid ${t.color};border-radius:10px;overflow:hidden}
      .band-header{background:${t.color};color:#fff;padding:10px 14px;text-align:center}
      .triage-code{font-size:32px;font-weight:900;line-height:1}
      .triage-label{font-size:13px;letter-spacing:1px;opacity:.9}
      .body{padding:14px}
      .uhid-bar{background:${t.bg};border:1.5px solid ${t.border};border-radius:8px;padding:8px 12px;text-align:center;margin-bottom:10px}
      .uhid{font-size:20px;font-weight:800;letter-spacing:3px;color:${t.color}}
      .label{font-size:9px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.8px}
      .info-row{display:flex;justify-content:space-between;border-bottom:1px solid #f1f5f9;padding:5px 0}
      .info-key{font-size:10px;color:#64748b;font-weight:600}
      .info-val{font-size:12px;color:#1e293b;font-weight:700}
      .er-num{background:#1e293b;color:#fff;padding:6px 10px;border-radius:6px;text-align:center;margin-top:10px;font-size:13px;font-weight:700;letter-spacing:1px}
      .footer{font-size:9px;color:#94a3b8;text-align:center;margin-top:8px}
      @media print{body{margin:0;padding:8px}}
    </style></head><body>
    <div class="band">
      <div class="band-header">
        <div class="triage-code">${t.code} ${t.icon}</div>
        <div class="triage-label">${t.label.toUpperCase()} EMERGENCY</div>
      </div>
      <div class="body">
        <div class="uhid-bar">
          <div class="label">UHID / Patient ID</div>
          <div class="uhid">${patient.UHID || "UNKNOWN"}</div>
        </div>
        <div class="info-row"><span class="info-key">Name</span><span class="info-val">${patient.title || ""} ${patient.fullName || "Unknown"}</span></div>
        <div class="info-row"><span class="info-key">Gender / Age</span><span class="info-val">${patient.gender || "—"} / ${patient.age || calcAge(patient.dateOfBirth) || "—"} yrs</span></div>
        <div class="info-row"><span class="info-key">Blood Group</span><span class="info-val">${patient.bloodGroup || "Unknown"}</span></div>
        <div class="info-row"><span class="info-key">Allergies</span><span class="info-val">${patient.knownAllergies || "NKDA"}</span></div>
        <div class="info-row"><span class="info-key">Arrival</span><span class="info-val">${new Date().toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}</span></div>
        <div class="er-num">ER: ${erVisit?.emergencyNumber || "—"}</div>
        <div class="footer">SphereHealth Hospital · Emergency Department</div>
      </div>
    </div>
    </body></html>
  `);
  w.document.close();
  setTimeout(() => w.print(), 400);
};

/* ══════════════════════════════════════════════════════════════
   MAIN COMPONENT
══════════════════════════════════════════════════════════════ */
export default function EmergencyRegistrationPage() {
  const navigate = useNavigate();
  const toastRef = useRef(null);

  /* ── Patient search ── */
  const [searchQ, setSearchQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const [searchDone, setSearchDone] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [unknownPatient, setUnknownPatient] = useState(false);
  const [isNewPatient, setIsNewPatient] = useState(false);

  /* ── Doctors ── */
  const [consultants, setConsultants] = useState([]);

  /* ── Triage ── */
  const [triage, setTriage] = useState("");

  /* ── Patient info ── */
  const [pt, setPt] = useState({
    title: "Mr.", fullName: "", gender: "", age: "", dateOfBirth: "",
    contactNumber: "", bloodGroup: "", knownAllergies: "",
    nkda: false,
    address: "",
  });

  /* ── Arrival ── */
  const [arrival, setArrival] = useState({
    arrivalMode: "Walk-in",
    arrivalDateTime: nowDateTime(),
    broughtBy: "",
    referredFrom: "",
    ambulanceNumber: "",
  });

  /* ── Vitals (mandatory in ER) ── */
  const [vitals, setVitals] = useState({
    bloodPressure: "", pulse: "", respiratoryRate: "",
    temperature: "", oxygenSaturation: "", painScore: "",
    glasgowComaScale: "", weight: "", height: "",
    bloodGlucose: "",
  });

  /* ── Clinical ── */
  const [clinical, setClinical] = useState({
    presentingComplaints: "",
    complaintDuration: "",
    historyOfPresentIllness: "",
    pastMedicalHistory: "",
    currentMedications: "",
    provisionalDiagnosis: "",
  });

  /* ── MLC ── */
  const [mlc, setMlc] = useState({
    isMLC: false,
    mlcType: "",
    mlcReportTime: nowDateTime(),
    policeStation: "",
    policeName: "",
    policeContactNumber: "",
    mlcNotes: "",
  });

  /* ── Management ── */
  const [mgmt, setMgmt] = useState({
    consultantIncharge: "",
    consultantId: "",
    nursingNotes: "",
    disposition: "Active",
    dispositionNotes: "",
  });

  /* ── Submit state ── */
  const [submitting, setSubmitting] = useState(false);
  const [successData, setSuccessData] = useState(null);

  /* ── Load consultants ── */
  useEffect(() => {
    (async () => {
      try {
        const res = await doctorService.getDoctorsByDepartment("");
        const list = res.data?.data || res.data || res || [];
        if (Array.isArray(list)) {
          setConsultants(list.map(d => ({
            id: d._id,
            name: `Dr. ${d.personalInfo?.firstName || ""} ${d.personalInfo?.lastName || ""}`.trim(),
          })));
        }
      } catch { /* silent */ }
    })();
  }, []);

  /* ── Search patient ── */
  const doSearch = async () => {
    if (!searchQ.trim() || searchQ.trim().length < 2) return;
    setSearching(true); setSearchDone(false); setSearchResults([]);
    try {
      const res = await patientService.searchPatients(searchQ.trim(), 15);
      setSearchResults(Array.isArray(res.data || res) ? (res.data || res) : []);
    } catch (e) {
      showToast("error", "Search Failed", e.message);
    } finally { setSearching(false); setSearchDone(true); }
  };

  const selectExistingPatient = (p) => {
    setSelectedPatient(p);
    setIsNewPatient(false);
    setUnknownPatient(false);
    setPt({
      title: p.title || "Mr.", fullName: p.fullName || "",
      gender: p.gender || "", age: calcAge(p.dateOfBirth) || "",
      dateOfBirth: p.dateOfBirth?.split("T")[0] || "",
      contactNumber: p.contactNumber || "",
      bloodGroup: p.bloodGroup || "",
      knownAllergies: p.knownAllergies || "",
      nkda: p.knownAllergies === "NKDA",
      address: p.address?.completeAddress || "",
    });
    setSearchResults([]);
    setSearchDone(false);
    setSearchQ("");
  };

  /* ── Unknown patient toggle ── */
  const handleUnknownToggle = (val) => {
    setUnknownPatient(val);
    if (val) {
      setSelectedPatient(null);
      setIsNewPatient(true);
      setPt({
        title: "Unknown", fullName: "Unknown Patient",
        gender: "", age: "", dateOfBirth: "",
        contactNumber: "", bloodGroup: "Not Known",
        knownAllergies: "", nkda: false, address: "",
      });
    } else {
      setIsNewPatient(false);
      setPt({ title: "Mr.", fullName: "", gender: "", age: "", dateOfBirth: "", contactNumber: "", bloodGroup: "", knownAllergies: "", nkda: false, address: "" });
    }
  };

  /* ── Submit ── */
  const handleSubmit = async () => {
    if (!triage) return showToast("error", "Required", "Triage classification is mandatory (NABH EM.4)");
    if (!pt.fullName.trim()) return showToast("error", "Required", "Patient name or 'Unknown Patient' is required");
    if (!clinical.presentingComplaints.trim()) return showToast("error", "Required", "Presenting complaints are required");
    if (!vitals.pulse.trim() && !vitals.bloodPressure.trim())
      return showToast("error", "Required", "At least pulse and blood pressure vitals are required");

    setSubmitting(true);
    try {
      let patientId = selectedPatient?._id;
      let UHID = selectedPatient?.UHID;

      /* Create new patient if needed */
      if (!selectedPatient) {
        const patPayload = {
          title: pt.title,
          fullName: pt.fullName,
          gender: pt.gender || "Other",
          dateOfBirth: pt.dateOfBirth || undefined,
          contactNumber: pt.contactNumber || "0000000000",
          bloodGroup: pt.bloodGroup || "Not Known",
          knownAllergies: pt.nkda ? "NKDA" : pt.knownAllergies || undefined,
          address: pt.address ? { completeAddress: pt.address } : undefined,
          registrationType: "Emergency",
          isUnknownPatient: unknownPatient,
        };
        const pr = await patientService.createPatient(patPayload);
        const newPt = pr.data || pr;
        patientId = newPt._id;
        UHID = newPt.UHID;
      }

      const triageObj = TRIAGE_LEVELS.find(t => t.code === triage);

      const payload = {
        patientId,
        UHID,
        triageCategory: triageObj?.label || triage,
        triageCode: triage,
        arrivalMode: arrival.arrivalMode,
        arrivalDateTime: arrival.arrivalDateTime,
        broughtBy: arrival.broughtBy || undefined,
        referredFrom: arrival.referredFrom || undefined,
        ambulanceNumber: arrival.ambulanceNumber || undefined,
        presentingComplaints: clinical.presentingComplaints,
        complaintDuration: clinical.complaintDuration || undefined,
        historyOfPresentIllness: clinical.historyOfPresentIllness || undefined,
        pastMedicalHistory: clinical.pastMedicalHistory || undefined,
        currentMedications: clinical.currentMedications || undefined,
        provisionalDiagnosis: clinical.provisionalDiagnosis || undefined,
        vitals: {
          bloodPressure: vitals.bloodPressure || undefined,
          pulse: vitals.pulse || undefined,
          respiratoryRate: vitals.respiratoryRate || undefined,
          temperature: vitals.temperature || undefined,
          oxygenSaturation: vitals.oxygenSaturation || undefined,
          painScore: vitals.painScore || undefined,
          glasgowComaScale: vitals.glasgowComaScale || undefined,
          weight: vitals.weight || undefined,
          height: vitals.height || undefined,
          bloodGlucose: vitals.bloodGlucose || undefined,
        },
        isMLC: mlc.isMLC,
        mlcType: mlc.isMLC ? mlc.mlcType : undefined,
        mlcReportTime: mlc.isMLC ? mlc.mlcReportTime : undefined,
        policeStation: mlc.isMLC ? mlc.policeStation : undefined,
        policeName: mlc.isMLC ? mlc.policeName : undefined,
        policeContactNumber: mlc.isMLC ? mlc.policeContactNumber : undefined,
        mlcNotes: mlc.isMLC ? mlc.mlcNotes : undefined,
        consultantIncharge: mgmt.consultantIncharge || undefined,
        nursingNotes: mgmt.nursingNotes || undefined,
        disposition: mgmt.disposition,
      };

      const res = await emergencyService.createEmergencyVisit(payload);
      const erVisit = res.data?.data || res.data || res;

      setSuccessData({
        patient: selectedPatient || { fullName: pt.fullName, title: pt.title, gender: pt.gender, UHID, bloodGroup: pt.bloodGroup, knownAllergies: pt.nkda ? "NKDA" : pt.knownAllergies, dateOfBirth: pt.dateOfBirth, age: pt.age },
        erVisit,
        triage,
        triageObj,
      });
    } catch (e) {
      showToast("error", "Registration Failed", e?.response?.data?.message || e.message);
    } finally { setSubmitting(false); }
  };

  const showToast = (severity, summary, detail) => {
    if (toastRef.current) {
      toastRef.current.textContent = `${summary}: ${detail}`;
      toastRef.current.style.background = severity === "error" ? "#fef2f2" : "#dcfce7";
      toastRef.current.style.color = severity === "error" ? C.accent : C.green;
      toastRef.current.style.display = "block";
      setTimeout(() => { if (toastRef.current) toastRef.current.style.display = "none"; }, 5000);
    }
  };

  const currentTriage = TRIAGE_LEVELS.find(t => t.code === triage);

  /* ════════════════════════════════════════ RENDER ════════════════════════════════════════ */
  if (successData) {
    return <SuccessScreen data={successData} C={C} FF={FF}
      onPrintWristband={() => printWristband({ patient: successData.patient, erVisit: successData.erVisit, triage: successData.triageObj?.label })}
      onNewEmergency={() => window.location.reload()}
      onViewList={() => navigate("/emergency-list")}
    />;
  }

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FF, padding: "0 0 56px" }}>

      {/* ── Toast ── */}
      <div ref={toastRef} style={{
        display: "none", position: "fixed", top: 18, right: 18, zIndex: 9999,
        padding: "12px 20px", borderRadius: 10, fontWeight: 600, fontSize: 13,
        fontFamily: FF, boxShadow: "0 4px 16px rgba(0,0,0,.15)", maxWidth: 400,
        border: "1.5px solid currentColor",
      }} />

      {/* ── ER Header ── */}
      <div style={{
        background: `linear-gradient(135deg, ${C.accent}, #991b1b)`,
        padding: "20px 28px 18px",
        boxShadow: "0 2px 16px rgba(220,38,38,.25)",
      }}>
        <div style={{ maxWidth: 960, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{
              width: 48, height: 48, borderRadius: 12,
              background: "rgba(255,255,255,.18)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 24, border: "2px solid rgba(255,255,255,.3)",
            }}>🚨</div>
            <div>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#fff", letterSpacing: "-.3px" }}>
                Emergency Registration
              </div>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,.78)", marginTop: 2 }}>
                NABH EM.1 · EM.4 (Triage) · EM.9 (MLC) — Emergency Department
              </div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {/* Live clock */}
            <div style={{
              background: "rgba(255,255,255,.12)", borderRadius: 8,
              padding: "6px 14px", color: "#fff", fontFamily: FF,
              fontSize: 13, fontWeight: 700,
            }}>
              <i className="pi pi-clock" style={{ marginRight: 6, fontSize: 11 }} />
              {new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
            </div>
            {currentTriage && (
              <div style={{
                background: currentTriage.color, color: "#fff",
                borderRadius: 8, padding: "6px 14px",
                fontFamily: FF, fontSize: 13, fontWeight: 800,
              }}>
                {currentTriage.code} · {currentTriage.label}
              </div>
            )}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 960, margin: "0 auto", padding: "20px 16px 0" }}>

        {/* ══ SECTION 1: TRIAGE — ALWAYS FIRST & MOST PROMINENT ══ */}
        <Section title="Triage Classification" icon="pi-exclamation-circle"
          color={C.accent} nabh badge="NABH EM.4" urgent defaultOpen>
          <div style={{
            background: "#fff8f8", border: `1px solid ${C.accent}20`,
            borderRadius: 10, padding: "10px 14px", marginBottom: 14, fontSize: 12, color: "#7f1d1d", fontFamily: FF,
          }}>
            <strong>NABH EM.4</strong> — Triage must be performed by trained personnel within <strong>2 minutes</strong> of patient arrival.
            Assign the appropriate priority level based on clinical assessment.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 10 }}>
            {TRIAGE_LEVELS.map(t => (
              <button key={t.code} onClick={() => setTriage(t.code)} style={{
                background: triage === t.code ? t.color : t.bg,
                border: `2px solid ${triage === t.code ? t.color : t.border}`,
                borderRadius: 12, padding: "14px 10px", cursor: "pointer",
                textAlign: "center", transition: ".15s", fontFamily: FF,
                boxShadow: triage === t.code ? `0 4px 16px ${t.color}40` : "none",
                transform: triage === t.code ? "scale(1.04)" : "scale(1)",
              }}>
                <div style={{ fontSize: 24 }}>{t.icon}</div>
                <div style={{
                  fontSize: 16, fontWeight: 900, color: triage === t.code ? "#fff" : t.color,
                  lineHeight: 1.1, marginTop: 4,
                }}>{t.code}</div>
                <div style={{
                  fontSize: 11, fontWeight: 700, color: triage === t.code ? "rgba(255,255,255,.9)" : t.color,
                  marginBottom: 4,
                }}>{t.label}</div>
                <div style={{
                  fontSize: 9.5, color: triage === t.code ? "rgba(255,255,255,.8)" : C.muted,
                  lineHeight: 1.3,
                }}>{t.maxWait}</div>
              </button>
            ))}
          </div>
          {triage && currentTriage && (
            <div style={{
              background: currentTriage.bg, border: `1.5px solid ${currentTriage.border}`,
              borderRadius: 10, padding: "12px 16px", marginTop: 12, fontFamily: FF,
            }}>
              <div style={{ fontWeight: 700, color: currentTriage.color, fontSize: 14, marginBottom: 4 }}>
                {currentTriage.icon} {currentTriage.code} — {currentTriage.label} · Max wait: {currentTriage.maxWait}
              </div>
              <div style={{ fontSize: 12, color: C.muted }}>{currentTriage.description}</div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>
                <strong>Examples:</strong> {currentTriage.examples}
              </div>
            </div>
          )}
        </Section>

        {/* ══ SECTION 2: PATIENT IDENTITY ══ */}
        <Section title="Patient Identification" icon="pi-id-card" color={C.blue} nabh badge="NABH EM.1 · IPSG.1" defaultOpen>
          {/* Unknown / Search toggle */}
          <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
            {/* Search existing */}
            <div style={{ flex: 1, minWidth: 240 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".6px", marginBottom: 6, fontFamily: FF }}>
                Search Existing Patient (UHID / Name / Phone)
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  value={searchQ} onChange={e => setSearchQ(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && doSearch()}
                  placeholder="UHID, name, phone…"
                  disabled={unknownPatient}
                  className="his-field" style={{ flex: 1, background: unknownPatient ? "#f8fafc" : "#fff" }}
                />
                <button onClick={doSearch} disabled={searching || unknownPatient || searchQ.trim().length < 2} style={{
                  background: C.blue, color: "#fff", border: "none", borderRadius: 8,
                  padding: "0 14px", cursor: "pointer", fontFamily: FF, fontWeight: 600,
                  fontSize: 12, display: "flex", alignItems: "center", gap: 5,
                  opacity: unknownPatient ? .4 : 1,
                }}>
                  <i className={`pi ${searching ? "pi-spin pi-spinner" : "pi-search"}`} style={{ fontSize: 12 }} />
                </button>
              </div>
            </div>
            {/* OR divider */}
            <div style={{ display: "flex", alignItems: "flex-end", padding: "0 4px 8px", color: C.muted, fontFamily: FF, fontSize: 12 }}>OR</div>
            {/* Unknown patient */}
            <div style={{ display: "flex", alignItems: "flex-end", paddingBottom: 2 }}>
              <label style={{
                display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
                background: unknownPatient ? "#fef2f2" : "#f8fafc",
                border: `1.5px solid ${unknownPatient ? C.accent : C.border}`,
                borderRadius: 8, padding: "8px 14px", transition: ".15s", fontFamily: FF,
              }}>
                <input type="checkbox" checked={unknownPatient}
                  onChange={e => handleUnknownToggle(e.target.checked)}
                  style={{ accentColor: C.accent, width: 14, height: 14 }} />
                <div>
                  <div style={{ fontWeight: 700, fontSize: 12, color: unknownPatient ? C.accent : C.text }}>Unknown Patient</div>
                  <div style={{ fontSize: 10, color: C.muted }}>Unidentified / unconscious</div>
                </div>
              </label>
            </div>
          </div>

          {/* Search results dropdown */}
          {searchDone && searchResults.length > 0 && (
            <div style={{
              border: `1.5px solid ${C.blueL}`, borderRadius: 10,
              background: "#fff", marginBottom: 12, maxHeight: 240, overflowY: "auto",
              boxShadow: "0 4px 16px rgba(0,0,0,.08)",
            }}>
              {searchResults.map(p => (
                <div key={p._id} onClick={() => selectExistingPatient(p)} style={{
                  padding: "10px 14px", cursor: "pointer", fontFamily: FF,
                  borderBottom: `1px solid ${C.border}`,
                  display: "flex", alignItems: "center", gap: 12,
                }}
                  onMouseEnter={e => e.currentTarget.style.background = C.blueL}
                  onMouseLeave={e => e.currentTarget.style.background = "#fff"}
                >
                  <i className="pi pi-user" style={{ color: C.blue, fontSize: 16 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, color: C.text }}>{p.title} {p.fullName}</div>
                    <div style={{ fontSize: 11, color: C.muted }}>{p.UHID} · {p.gender} · {calcAge(p.dateOfBirth)} yrs · {p.contactNumber}</div>
                  </div>
                  <span style={{ background: C.blue, color: "#fff", borderRadius: 6, padding: "2px 8px", fontSize: 10, fontWeight: 700 }}>Select</span>
                </div>
              ))}
              <div style={{ padding: "8px 14px", fontSize: 11, color: C.muted, fontFamily: FF, textAlign: "center" }}>
                Patient not found? Fill the form below to register as new
              </div>
            </div>
          )}

          {/* Selected patient banner */}
          {selectedPatient && !unknownPatient && (
            <div style={{
              background: C.blueL, border: `1.5px solid #bfdbfe`,
              borderRadius: 10, padding: "10px 16px", marginBottom: 12,
              display: "flex", alignItems: "center", gap: 10, fontFamily: FF,
            }}>
              <i className="pi pi-check-circle" style={{ color: C.blue, fontSize: 18 }} />
              <div style={{ flex: 1 }}>
                <span style={{ fontWeight: 700, color: C.text }}>{selectedPatient.title} {selectedPatient.fullName}</span>
                <span style={{ fontSize: 12, color: C.blue, marginLeft: 10 }}>UHID: <strong>{selectedPatient.UHID}</strong></span>
                <span style={{ fontSize: 12, color: C.muted, marginLeft: 10 }}>{selectedPatient.gender} · {calcAge(selectedPatient.dateOfBirth)} yrs · {selectedPatient.contactNumber}</span>
              </div>
              <button onClick={() => { setSelectedPatient(null); setIsNewPatient(false); }} style={{
                background: "none", border: "none", cursor: "pointer", color: C.muted, fontSize: 12,
              }}>
                <i className="pi pi-times" /> Change
              </button>
            </div>
          )}

          {/* Patient form fields */}
          <G2 gap={14}>
            <div style={{ display: "grid", gridTemplateColumns: "100px 1fr", gap: 10 }}>
              <F label="Title">
                <select value={pt.title} onChange={e => setPt(p => ({ ...p, title: e.target.value }))} className="his-select">
                  {TITLE_OPTS.map(t => <option key={t}>{t}</option>)}
                </select>
              </F>
              <F label="Full Name" required hint={unknownPatient ? "Use 'Unknown Patient' or descriptive name" : ""}>
                <input value={pt.fullName} onChange={e => setPt(p => ({ ...p, fullName: e.target.value }))}
                  placeholder={unknownPatient ? "Unknown Patient / Unknown Male-001" : "Patient's full name"}
                  className="his-field" />
              </F>
            </div>
            <G3 gap={10}>
              <F label="Gender">
                <select value={pt.gender} onChange={e => setPt(p => ({ ...p, gender: e.target.value }))} className="his-select">
                  <option value="">Unknown</option>
                  {GENDER_OPTS.map(g => <option key={g}>{g}</option>)}
                </select>
              </F>
              <F label="Approx. Age (yrs)" hint={pt.dateOfBirth ? `Calc: ${calcAge(pt.dateOfBirth)} yrs` : ""}>
                <input value={pt.age} onChange={e => setPt(p => ({ ...p, age: e.target.value }))}
                  placeholder="Age in years" type="number" min="0" max="150" className="his-field" />
              </F>
              <F label="Date of Birth">
                <input type="date" value={pt.dateOfBirth} max={todayISO()}
                  onChange={e => setPt(p => ({ ...p, dateOfBirth: e.target.value }))} className="his-field" />
              </F>
            </G3>
          </G2>
          <div style={{ marginTop: 12 }}>
            <G3>
              <F label="Contact Number">
                <input value={pt.contactNumber} onChange={e => setPt(p => ({ ...p, contactNumber: e.target.value }))}
                  placeholder={unknownPatient ? "—" : "10-digit mobile"} className="his-field" />
              </F>
              <F label="Blood Group">
                <select value={pt.bloodGroup} onChange={e => setPt(p => ({ ...p, bloodGroup: e.target.value }))} className="his-select">
                  <option value="">Unknown</option>
                  {BLOOD_OPTS.map(b => <option key={b}>{b}</option>)}
                </select>
              </F>
              <F label="Known Allergies / NKDA">
                <input value={pt.nkda ? "NKDA" : pt.knownAllergies}
                  onChange={e => setPt(p => ({ ...p, knownAllergies: e.target.value, nkda: false }))}
                  placeholder="NKDA or list allergies" className="his-field" />
              </F>
            </G3>
          </div>
        </Section>

        {/* ══ SECTION 3: ARRIVAL & REFERRAL ══ */}
        <Section title="Arrival & Referral Details" icon="pi-car" color={C.slate} nabh badge="NABH EM.1" defaultOpen>
          <G3>
            <F label="Mode of Arrival" required>
              <select value={arrival.arrivalMode} onChange={e => setArrival(a => ({ ...a, arrivalMode: e.target.value }))} className="his-select">
                {ARRIVAL_MODE.map(m => <option key={m}>{m}</option>)}
              </select>
            </F>
            <F label="Date & Time of Arrival" required hint="Critical for NABH EM.1 compliance">
              <input type="datetime-local" value={arrival.arrivalDateTime}
                onChange={e => setArrival(a => ({ ...a, arrivalDateTime: e.target.value }))} className="his-field" />
            </F>
            <F label="Brought By">
              <input value={arrival.broughtBy} onChange={e => setArrival(a => ({ ...a, broughtBy: e.target.value }))}
                placeholder="Name of person / relative" className="his-field" />
            </F>
          </G3>
          <div style={{ marginTop: 12 }}>
            <G2>
              <F label="Referred From (if referred)" hint="Hospital / clinic name">
                <input value={arrival.referredFrom} onChange={e => setArrival(a => ({ ...a, referredFrom: e.target.value }))}
                  placeholder="Referring hospital / doctor" className="his-field" />
              </F>
              <F label="Ambulance Number">
                <input value={arrival.ambulanceNumber} onChange={e => setArrival(a => ({ ...a, ambulanceNumber: e.target.value }))}
                  placeholder="Vehicle / call number" className="his-field" />
              </F>
            </G2>
          </div>
        </Section>

        {/* ══ SECTION 4: VITALS — MANDATORY ══ */}
        <Section title="Vitals Assessment" icon="pi-heart" color={C.accent} nabh badge="NABH EM.4 · EM.5" defaultOpen urgent>
          <div style={{
            fontSize: 12, color: "#7f1d1d", fontFamily: FF,
            background: "#fff8f8", borderRadius: 8, padding: "8px 12px", marginBottom: 14,
          }}>
            <i className="pi pi-info-circle" style={{ marginRight: 6 }} />
            Vitals are <strong>mandatory</strong> in Emergency — record at time of triage (NABH EM.4)
          </div>
          <G4>
            <F label="Blood Pressure (mmHg)" required hint="Systolic/Diastolic">
              <input value={vitals.bloodPressure} onChange={e => setVitals(v => ({ ...v, bloodPressure: e.target.value }))}
                placeholder="e.g. 120/80" className="his-field" />
            </F>
            <F label="Pulse (bpm)" required>
              <input value={vitals.pulse} onChange={e => setVitals(v => ({ ...v, pulse: e.target.value }))}
                placeholder="e.g. 72" type="number" min="0" className="his-field" />
            </F>
            <F label="Respiratory Rate (/min)">
              <input value={vitals.respiratoryRate} onChange={e => setVitals(v => ({ ...v, respiratoryRate: e.target.value }))}
                placeholder="e.g. 18" type="number" className="his-field" />
            </F>
            <F label="SpO₂ (%)">
              <input value={vitals.oxygenSaturation} onChange={e => setVitals(v => ({ ...v, oxygenSaturation: e.target.value }))}
                placeholder="e.g. 98" type="number" min="0" max="100" className="his-field" />
            </F>
          </G4>
          <div style={{ marginTop: 12 }}>
            <G4>
              <F label="Temperature (°F)">
                <input value={vitals.temperature} onChange={e => setVitals(v => ({ ...v, temperature: e.target.value }))}
                  placeholder="e.g. 98.6" type="number" className="his-field" />
              </F>
              <F label="Pain Score (0-10)">
                <input value={vitals.painScore} onChange={e => setVitals(v => ({ ...v, painScore: e.target.value }))}
                  placeholder="0 = No pain, 10 = Worst" type="number" min="0" max="10" className="his-field" />
              </F>
              <F label="GCS (Glasgow Coma Scale)" hint="3-15">
                <input value={vitals.glasgowComaScale} onChange={e => setVitals(v => ({ ...v, glasgowComaScale: e.target.value }))}
                  placeholder="e.g. 15 (Normal)" type="number" min="3" max="15" className="his-field" />
              </F>
              <F label="Blood Glucose (mg/dL)">
                <input value={vitals.bloodGlucose} onChange={e => setVitals(v => ({ ...v, bloodGlucose: e.target.value }))}
                  placeholder="RBS / GRBS" type="number" className="his-field" />
              </F>
            </G4>
          </div>
          <div style={{ marginTop: 12 }}>
            <G2>
              <F label="Weight (kg)">
                <input value={vitals.weight} onChange={e => setVitals(v => ({ ...v, weight: e.target.value }))}
                  placeholder="Patient weight" type="number" className="his-field" />
              </F>
              <F label="Height (cm)">
                <input value={vitals.height} onChange={e => setVitals(v => ({ ...v, height: e.target.value }))}
                  placeholder="Patient height" type="number" className="his-field" />
              </F>
            </G2>
          </div>
        </Section>

        {/* ══ SECTION 5: CLINICAL ASSESSMENT ══ */}
        <Section title="Clinical Assessment" icon="pi-book" color={C.teal} nabh badge="NABH EM.5" defaultOpen>
          <G2>
            <F label="Presenting Complaints" required hint="Chief reason for ER visit">
              <textarea value={clinical.presentingComplaints}
                onChange={e => setClinical(c => ({ ...c, presentingComplaints: e.target.value }))}
                placeholder="Main complaints in patient's or attendant's words…" rows={3} className="his-textarea" />
            </F>
            <F label="Duration of Symptoms">
              <input value={clinical.complaintDuration}
                onChange={e => setClinical(c => ({ ...c, complaintDuration: e.target.value }))}
                placeholder="e.g. 2 hours, since morning, 3 days" className="his-field" />
            </F>
          </G2>
          <div style={{ marginTop: 12 }}>
            <G2>
              <F label="History of Present Illness">
                <textarea value={clinical.historyOfPresentIllness}
                  onChange={e => setClinical(c => ({ ...c, historyOfPresentIllness: e.target.value }))}
                  placeholder="Onset, nature, progression, associated symptoms…" rows={3} className="his-textarea" />
              </F>
              <F label="Past Medical / Surgical History">
                <textarea value={clinical.pastMedicalHistory}
                  onChange={e => setClinical(c => ({ ...c, pastMedicalHistory: e.target.value }))}
                  placeholder="Co-morbidities, previous surgeries, hospitalizations…" rows={3} className="his-textarea" />
              </F>
            </G2>
          </div>
          <div style={{ marginTop: 12 }}>
            <G2>
              <F label="Current Medications">
                <textarea value={clinical.currentMedications}
                  onChange={e => setClinical(c => ({ ...c, currentMedications: e.target.value }))}
                  placeholder="List all medications patient is taking…" rows={2} className="his-textarea" />
              </F>
              <F label="Provisional Diagnosis">
                <textarea value={clinical.provisionalDiagnosis}
                  onChange={e => setClinical(c => ({ ...c, provisionalDiagnosis: e.target.value }))}
                  placeholder="Working diagnosis at time of registration…" rows={2} className="his-textarea" />
              </F>
            </G2>
          </div>
        </Section>

        {/* ══ SECTION 6: MLC / MEDICO-LEGAL CASE ══ */}
        <Section title="MLC — Medico Legal Case" icon="pi-shield" color="#7c3aed" nabh badge="NABH EM.9" defaultOpen={false}>
          <label style={{
            display: "flex", alignItems: "center", gap: 10, cursor: "pointer",
            background: mlc.isMLC ? "#fef2f2" : "#f8fafc",
            border: `1.5px solid ${mlc.isMLC ? C.accent : C.border}`,
            borderRadius: 10, padding: "12px 16px", marginBottom: 14, transition: ".15s",
          }}>
            <input type="checkbox" checked={mlc.isMLC}
              onChange={e => setMlc(m => ({ ...m, isMLC: e.target.checked }))}
              style={{ accentColor: C.accent, width: 16, height: 16 }} />
            <div style={{ fontFamily: FF }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: mlc.isMLC ? C.accent : C.text }}>
                {mlc.isMLC ? "⚠ This is a Medico-Legal Case (MLC)" : "Mark as Medico-Legal Case (MLC)"}
              </div>
              <div style={{ fontSize: 11, color: C.muted }}>
                NABH EM.9 — Report to police mandatory for RTAs, assaults, unknown cause of injury, suspicious burns, etc.
              </div>
            </div>
          </label>

          {mlc.isMLC && (
            <div>
              <G2>
                <F label="MLC Type / Nature of Injury" required>
                  <select value={mlc.mlcType} onChange={e => setMlc(m => ({ ...m, mlcType: e.target.value }))} className="his-select">
                    <option value="">Select type…</option>
                    {MLC_TYPES.map(t => <option key={t}>{t}</option>)}
                  </select>
                </F>
                <F label="MLC Report Date & Time" required hint="Time of reporting to police">
                  <input type="datetime-local" value={mlc.mlcReportTime}
                    onChange={e => setMlc(m => ({ ...m, mlcReportTime: e.target.value }))} className="his-field" />
                </F>
              </G2>
              <div style={{ marginTop: 12 }}>
                <G3>
                  <F label="Police Station Name">
                    <input value={mlc.policeStation} onChange={e => setMlc(m => ({ ...m, policeStation: e.target.value }))}
                      placeholder="Name of police station" className="his-field" />
                  </F>
                  <F label="Reporting Officer Name">
                    <input value={mlc.policeName} onChange={e => setMlc(m => ({ ...m, policeName: e.target.value }))}
                      placeholder="Officer name" className="his-field" />
                  </F>
                  <F label="Police Contact Number">
                    <input value={mlc.policeContactNumber} onChange={e => setMlc(m => ({ ...m, policeContactNumber: e.target.value }))}
                      placeholder="Phone number" className="his-field" />
                  </F>
                </G3>
              </div>
              <div style={{ marginTop: 12 }}>
                <F label="MLC Notes / Observations" hint="Document visible injuries, patient's statement, circumstances">
                  <textarea value={mlc.mlcNotes} onChange={e => setMlc(m => ({ ...m, mlcNotes: e.target.value }))}
                    placeholder="Describe injuries, patient's statement if conscious, circumstances of incident…" rows={3} className="his-textarea" />
                </F>
              </div>
            </div>
          )}
        </Section>

        {/* ══ SECTION 7: CONSULTANT & MANAGEMENT ══ */}
        <Section title="Consultant & Initial Management" icon="pi-user-md" color={C.green} nabh badge="NABH EM.6" defaultOpen={false}>
          <G3>
            <F label="Consultant In-charge">
              <select value={mgmt.consultantId}
                onChange={e => {
                  const doc = consultants.find(d => d.id === e.target.value);
                  setMgmt(m => ({ ...m, consultantId: e.target.value, consultantIncharge: doc?.name || "" }));
                }} className="his-select">
                <option value="">Select consultant…</option>
                {consultants.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </F>
            <F label="Disposition" required>
              <select value={mgmt.disposition} onChange={e => setMgmt(m => ({ ...m, disposition: e.target.value }))} className="his-select">
                {DISPOSITION_OPTS.map(d => <option key={d}>{d}</option>)}
              </select>
            </F>
            <F label="Disposition Notes">
              <input value={mgmt.dispositionNotes} onChange={e => setMgmt(m => ({ ...m, dispositionNotes: e.target.value }))}
                placeholder="Details, ward/bed, transfer info…" className="his-field" />
            </F>
          </G3>
          <div style={{ marginTop: 12 }}>
            <F label="Initial Nursing Notes">
              <textarea value={mgmt.nursingNotes} onChange={e => setMgmt(m => ({ ...m, nursingNotes: e.target.value }))}
                placeholder="Initial nursing assessment, interventions done, patient response…" rows={3} className="his-textarea" />
            </F>
          </div>
        </Section>

        {/* ── Footer ── */}
        <div style={{
          background: C.card, borderRadius: 12, padding: "16px 22px",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          boxShadow: "0 -2px 12px rgba(0,0,0,.07)", border: `1.5px solid ${C.border}`,
          position: "sticky", bottom: 0, zIndex: 100,
        }}>
          <div style={{ fontFamily: FF }}>
            {!triage && (
              <span style={{ fontSize: 12, color: C.accent, fontWeight: 600 }}>
                <i className="pi pi-exclamation-circle" style={{ marginRight: 4 }} />Triage classification required
              </span>
            )}
            {triage && currentTriage && (
              <span style={{
                background: currentTriage.bg, color: currentTriage.color,
                border: `1.5px solid ${currentTriage.border}`,
                borderRadius: 8, padding: "5px 14px", fontSize: 12, fontWeight: 700,
              }}>
                {currentTriage.icon} {currentTriage.code} — {currentTriage.label}
              </span>
            )}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={() => navigate(-1)} style={{
              background: "none", border: `1.5px solid ${C.border}`,
              borderRadius: 10, padding: "10px 18px", cursor: "pointer",
              fontFamily: FF, fontWeight: 600, fontSize: 13, color: C.muted,
              display: "flex", alignItems: "center", gap: 6,
            }}>
              <i className="pi pi-arrow-left" style={{ fontSize: 11 }} /> Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting}
              style={{
                background: submitting ? "#94a3b8" : C.accent,
                color: "#fff", border: "none", borderRadius: 10, padding: "11px 24px",
                fontFamily: FF, fontWeight: 800, fontSize: 13,
                cursor: submitting ? "wait" : "pointer",
                display: "flex", alignItems: "center", gap: 8, transition: ".15s",
                boxShadow: submitting ? "none" : `0 4px 14px ${C.accent}40`,
              }}
            >
              <i className={`pi ${submitting ? "pi-spin pi-spinner" : "pi-bolt"}`} style={{ fontSize: 14 }} />
              {submitting ? "Registering…" : "Register Emergency Patient"}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   SUCCESS SCREEN
══════════════════════════════════════════════════════════════ */
function SuccessScreen({ data, onPrintWristband, onNewEmergency, onViewList, C, FF }) {
  const { patient, erVisit, triage, triageObj } = data;
  const t = triageObj || TRIAGE_LEVELS[0];
  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FF, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ maxWidth: 640, width: "100%" }}>
        {/* Triage banner */}
        <div style={{
          background: `linear-gradient(135deg, ${t.color}, ${t.color}cc)`,
          borderRadius: "16px 16px 0 0", padding: "20px 28px", textAlign: "center", color: "#fff",
        }}>
          <div style={{ fontSize: 36, marginBottom: 6 }}>{t.icon}</div>
          <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-.3px" }}>
            {t.code} — {t.label}
          </div>
          <div style={{ fontSize: 13, opacity: .85, marginTop: 4 }}>Emergency Registration Successful · {t.maxWait}</div>
        </div>

        <div style={{
          background: C.card, borderRadius: "0 0 16px 16px",
          padding: "24px 28px", boxShadow: "0 4px 24px rgba(0,0,0,.1)",
        }}>
          {/* ER Number */}
          <div style={{
            border: `2px solid ${t.color}`, borderRadius: 12,
            padding: "16px 20px", textAlign: "center", marginBottom: 18,
          }}>
            <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase" }}>Emergency Number</div>
            <div style={{ fontSize: 36, fontWeight: 900, color: t.color, letterSpacing: 2 }}>
              {erVisit?.emergencyNumber || "—"}
            </div>
          </div>

          {/* UHID */}
          <div style={{
            background: C.accent, color: "#fff", borderRadius: 10,
            padding: "10px 16px", textAlign: "center", marginBottom: 16,
          }}>
            <div style={{ fontSize: 10, opacity: .8, letterSpacing: 2 }}>UNIQUE HEALTH ID (UHID)</div>
            <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: 3 }}>{patient.UHID || "Generating…"}</div>
          </div>

          {/* Info grid */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 18 }}>
            {[
              ["Patient", `${patient.title || ""} ${patient.fullName}`],
              ["Gender / Age", `${patient.gender || "—"} / ${patient.age || calcAge(patient.dateOfBirth) || "—"} yrs`],
              ["Blood Group", patient.bloodGroup || "Unknown"],
              ["Allergies", patient.knownAllergies || "NKDA"],
              ["Arrived", new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })],
              ["MLC", erVisit?.isMLC ? "⚠ YES — Police Informed" : "No"],
            ].map(([k, v]) => (
              <div key={k} style={{ background: "#f8fafc", borderRadius: 8, padding: "10px 12px" }}>
                <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: .5 }}>{k}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginTop: 3 }}>{v}</div>
              </div>
            ))}
          </div>

          {/* Actions */}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
            <button onClick={onPrintWristband} style={{
              background: t.color, color: "#fff", border: "none",
              borderRadius: 10, padding: "11px 20px", cursor: "pointer",
              fontFamily: FF, fontWeight: 700, fontSize: 13,
              display: "flex", alignItems: "center", gap: 7,
            }}>
              <i className="pi pi-print" style={{ fontSize: 13 }} /> Print ER Wristband
            </button>
            <button onClick={onViewList} style={{
              background: "none", color: C.accent, border: `1.5px solid ${C.accent}`,
              borderRadius: 10, padding: "10px 18px", cursor: "pointer",
              fontFamily: FF, fontWeight: 600, fontSize: 13,
              display: "flex", alignItems: "center", gap: 7,
            }}>
              <i className="pi pi-list" style={{ fontSize: 12 }} /> ER Patient List
            </button>
            <button onClick={onNewEmergency} style={{
              background: "none", color: C.muted, border: `1.5px solid ${C.border}`,
              borderRadius: 10, padding: "10px 18px", cursor: "pointer",
              fontFamily: FF, fontWeight: 600, fontSize: 13,
              display: "flex", alignItems: "center", gap: 7,
            }}>
              <i className="pi pi-plus" style={{ fontSize: 11 }} /> New Emergency
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
