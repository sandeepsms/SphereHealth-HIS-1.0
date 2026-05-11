import React, { useState, useEffect } from "react";
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
function Section({ title, icon, color = C.accent, badge, children, defaultOpen = true }) {
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
        </div>
        <i className={`pi ${open ? "pi-chevron-up" : "pi-chevron-down"}`} style={{ fontSize: 10, color: C.muted }} />
      </div>
      {open && <div style={{ padding: "16px 18px" }}>{children}</div>}
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
function IPDInitialAssessmentContent({ selectedPatient }) {
  const { uhid: uhidParam } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  // Support both path param (:uhid) and query param (?uhid=)
  const initUhid = uhidParam || searchParams.get("uhid") || "";
  const [uhid, setUhid]           = useState(initUhid);
  const [patient, setPatient]     = useState(null);
  const [admission, setAdmission] = useState(null); // active admission for initialAssessment gate

  // Auto-load when patient selected from the panel
  useEffect(() => {
    if (selectedPatient?.UHID) {
      setUhid(selectedPatient.UHID);
      setIpdNo(selectedPatient.bedNumber || "");
      setWard(selectedPatient.wardName || "");
      setBedNo(selectedPatient.bedNumber || "");
    }
  }, [selectedPatient]);
  const [loadingPt, setLoadingPt] = useState(false);
  const [saving, setSaving]       = useState(false);
  const [noteId, setNoteId]       = useState(null);
  const [activeTab, setActiveTab] = useState("nursing"); // nursing | doctor

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
  const [pmh, setPmh]                   = useState("");
  const [psh, setPsh]                   = useState("");
  const [famHx, setFamHx]               = useState("");
  const [socHx, setSocHx]               = useState("");
  const [docAllergy, setDocAllergy]     = useState("");
  const [genExam, setGenExam]           = useState("");
  const [cvs, setCvs]                   = useState("");
  const [rs, setRs]                     = useState("");
  const [abdomen, setAbdomen]           = useState("");
  const [cns, setCns]                   = useState("");
  const [provDx, setProvDx]             = useState("");
  const [finalDx, setFinalDx]           = useState("");
  const [icd10, setIcd10]               = useState("");
  const [investigations, setInvestigations] = useState("");
  const [rxRows, setRxRows]             = useState([blankRx()]);
  const [treatmentPlan, setTreatmentPlan] = useState("");
  const [followupNotes, setFollowupNotes] = useState("");
  const [dietAdvice, setDietAdvice]     = useState("");
  const [activityAdvice, setActivityAdvice] = useState("");

  /* ── Auto-save draft ── */
  const draftKey = patient?._id ? `sphere_draft_ipd_initial_${patient._id}` : null;
  const { savedAt, hasDraft, clearDraft } = useAutoSave(
    draftKey,
    { admitDate, admitTime, ipdNo, nurseName, ward, bedNo, modeOfAdmit, consciousnessLevel, mobility, allergy, chiefComplaint, vitals, painPresent, painScore, painLocation, painCharacter, devices, skinIntact, skinNotes, morse, braden, nutri, vte, nursingProblems, nursingGoals, nursingNotes, doctorName, regNo, hopi, pmh, psh, famHx, socHx, docAllergy, genExam, cvs, rs, abdomen, cns, provDx, finalDx, icd10, investigations, rxRows, treatmentPlan, followupNotes, dietAdvice, activityAdvice },
    2000
  );
  const { signature, showSetup, setShowSetup, saveSignature } = useDigitalSignature();

  useEffect(() => {
    if (initUhid) loadPatient(initUhid);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      if (pt.allergies) { setAllergy(pt.allergies); setDocAllergy(pt.allergies); }
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
            if (d.pmh)                setPmh(d.pmh);
            if (d.psh)                setPsh(d.psh);
            if (d.famHx)              setFamHx(d.famHx);
            if (d.socHx)              setSocHx(d.socHx);
            if (d.genExam)            setGenExam(d.genExam);
            if (d.cvs)                setCvs(d.cvs);
            if (d.rs)                 setRs(d.rs);
            if (d.abdomen)            setAbdomen(d.abdomen);
            if (d.cns)                setCns(d.cns);
            if (d.provDx)             setProvDx(d.provDx);
            if (d.finalDx)            setFinalDx(d.finalDx);
            if (d.icd10)              setIcd10(d.icd10);
            if (d.investigations)     setInvestigations(d.investigations);
            if (d.rxRows)             setRxRows(d.rxRows);
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
    } catch { toast.error("Patient not found"); }
    finally { setLoadingPt(false); }
  };

  /* Build payload */
  const buildPayload = (section, status = "draft") => ({
    visitType: "IPD_INITIAL",
    patientUHID: patient?.UHID || uhid,
    patientId: patient?._id,
    patientName: patient?.fullName || "",
    status,
    assessmentDate: new Date().toISOString(),
    section, // "nursing" | "doctor" | "both"
    formData: {
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
      },
      doctor: {
        doctorName, regNo, hopi, pmh, psh, famHx, socHx, docAllergy,
        genExam, cvs, rs, abdomen, cns,
        provDx, finalDx, icd10, investigations,
        rxRows: rxRows.filter(r => r.drug.trim()),
        treatmentPlan, followupNotes, dietAdvice, activityAdvice,
      },
    },
  });

  const handleSave = async (sign = false, section = activeTab) => {
    if (!patient) { toast.warn("Load a patient first"); return; }
    setSaving(true);
    try {
      const payload = buildPayload(section, sign ? "signed" : "draft");
      let res;
      if (noteId) {
        res = await axios.put(`${API_ENDPOINTS.BASE}/doctorNotes/${noteId}`, payload);
        if (sign) await axios.patch(`${API_ENDPOINTS.BASE}/doctorNotes/${noteId}/sign`);
      } else {
        res = await axios.post(`${API_ENDPOINTS.BASE}/doctorNotes`, payload);
        setNoteId(res.data?.data?._id || res.data?._id);
      }
      // On sign-off, mark the corresponding initial assessment flag on the admission
      if (sign && admission?._id) {
        const role = section === "nursing" ? "nurse" : "doctor";
        const name = section === "nursing"
          ? (nurseName || user?.fullName || "")
          : (doctorName || user?.fullName || "");
        await axios.put(`${API_ENDPOINTS.BASE}/admissions/${admission._id}/initial-assessment`, { role, name })
          .catch(() => {}); // non-blocking; flag is a UX gate not a hard constraint
        // Update local admission state so the gate lifts without page reload
        setAdmission(prev => prev ? {
          ...prev,
          initialAssessment: {
            ...prev.initialAssessment,
            [`${role}Completed`]: true,
            [`${role}CompletedAt`]: new Date().toISOString(),
          },
        } : prev);
      }
      toast.success(sign ? "Assessment signed & submitted ✓" : "Draft saved");
      if (sign) clearDraft();
    } catch (err) {
      toast.error(err.response?.data?.message || "Save failed");
    } finally { setSaving(false); }
  };

  const setV = key => val => setVitals(v => ({ ...v, [key]: val }));
  const setDev = key => e => setDevices(d => ({ ...d, [key]: e.target.checked }));

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
              <div style={{ fontSize: 18, fontWeight: 800, color: C.text }}>IPD Initial Assessment</div>
              <span style={{ background: C.accentL, color: C.accent, border: `1px solid ${C.accent}30`,
                padding: "2px 10px", borderRadius: 5, fontSize: 10, fontWeight: 800, letterSpacing: 1 }}>IPD</span>
              <span style={{ background: C.greenL, color: C.green, border: `1px solid ${C.green}30`,
                padding: "2px 10px", borderRadius: 5, fontSize: 10, fontWeight: 700 }}>NABH Compliant</span>
            </div>
            <div style={{ fontSize: 11, color: C.muted }}>
              Nursing Assessment + Doctor Initial Assessment · {new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <AutoSaveIndicator savedAt={savedAt} hasDraft={hasDraft} />
          <button onClick={() => setShowSetup(true)}
            style={{ padding:"7px 12px", background: signature ? "#f0fdf4" : "#fffbeb", border:`1.5px solid ${signature ? "#bbf7d0" : "#fde68a"}`, borderRadius:8, cursor:"pointer", fontSize:11, fontWeight:700, color: signature ? "#16a34a" : "#92400e", display:"flex", alignItems:"center", gap:5 }}>
            {signature ? <><i className="pi pi-verified" /> Signature Set</> : <><i className="pi pi-pen-to-square" /> Setup Signature</>}
          </button>
          <button onClick={() => handleSave(false)} disabled={saving}
            style={{ padding: "8px 18px", border: `1.5px solid ${C.border}`, borderRadius: 8,
              background: "white", cursor: saving ? "not-allowed" : "pointer",
              fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 600, color: C.muted }}>
            <i className="pi pi-save" style={{ marginRight: 6, fontSize: 12 }} />Save Draft
          </button>
          <button onClick={() => handleSave(true)} disabled={saving || !patient}
            style={{ padding: "8px 22px", border: "none", borderRadius: 8,
              background: saving ? "#93c5fd" : C.accent, cursor: saving ? "not-allowed" : "pointer",
              fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 700, color: "white" }}>
            <i className="pi pi-check-circle" style={{ marginRight: 6, fontSize: 12 }} />
            {saving ? "Saving…" : "Sign & Submit"}
          </button>
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

        {/* ── Tab switcher ── */}
        <div style={{ display: "flex", gap: 0, marginBottom: 16,
          background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
          overflow: "hidden", width: "fit-content" }}>
          {[
            { key: "nursing", label: "Nursing Assessment", icon: "pi-heart", color: C.pink },
            { key: "doctor",  label: "Doctor Initial Assessment", icon: "pi-stethoscope", color: C.accent },
          ].map(tab => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              style={{
                padding: "11px 24px", border: "none", cursor: "pointer",
                background: activeTab === tab.key ? tab.color : "white",
                color: activeTab === tab.key ? "white" : C.muted,
                fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 700,
                display: "flex", alignItems: "center", gap: 7,
                transition: "all .15s",
              }}>
              <i className={`pi ${tab.icon}`} style={{ fontSize: 13 }} />
              {tab.label}
            </button>
          ))}
        </div>

        {/* ══════════════ NURSING TAB ══════════════ */}
        {activeTab === "nursing" && (<>

          {/* ── Admission Details ── */}
          <Section title="Admission Details" icon="pi-calendar-plus" color={C.teal}>
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
          <Section title="Vitals on Admission" icon="pi-heart-fill" color={C.red} badge="NABH Required">
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
          <Section title="Pain Assessment" icon="pi-exclamation-circle" color={C.orange}>
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
          <Section title="Skin Integrity & Medical Devices" icon="pi-user" color={C.purple}>
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
          <Section title="Morse Fall Scale" icon="pi-exclamation-triangle" color={C.amber} badge="NABH Required">
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
          <Section title="Braden Scale — Pressure Ulcer Risk" icon="pi-th-large" color={C.purple} badge="NABH Required">
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
          <Section title="Nutritional Risk Screening (NRS-2002)" icon="pi-chart-bar" color={C.green} badge="NABH Required">
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

          {/* ── VTE Risk — Caprini ── */}
          <Section title="VTE Risk Assessment (Caprini Score)" icon="pi-wave-pulse" color={C.red} badge="NABH Required">
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 20, alignItems: "start" }}>
              <div>
                {VTE_GROUPS.map(grp => (
                  <div key={grp.group} style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase",
                      letterSpacing: ".7px", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
                      {grp.group}
                      <span style={{ background: C.redL, color: C.red, padding: "1px 7px",
                        borderRadius: 4, fontSize: 10, fontWeight: 800 }}>
                        +{VTE_POINTS[grp.group]} each
                      </span>
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 12px" }}>
                      {grp.items.map(item => (
                        <label key={item.key} style={{
                          display: "flex", alignItems: "center", gap: 6, cursor: "pointer",
                          padding: "4px 10px", borderRadius: 6,
                          border: `1.5px solid ${vte[item.key] ? C.red : C.border}`,
                          background: vte[item.key] ? C.redL : "white",
                          fontWeight: vte[item.key] ? 700 : 400, fontSize: 12,
                          color: vte[item.key] ? C.red : C.muted,
                        }}>
                          <input type="checkbox" checked={!!vte[item.key]}
                            onChange={e => setVte(v => ({ ...v, [item.key]: e.target.checked }))}
                            style={{ accentColor: C.red, width: 13, height: 13 }} />
                          {item.label}
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ minWidth: 140 }}>
                <ScoreBadge score={vteTotal} label="Caprini Score" risk={vteMeta.label} color={vteMeta.color} />
                <div style={{ marginTop: 10, fontSize: 10, color: C.muted, lineHeight: 1.5 }}>
                  {vteTotal === 0 && "Early ambulation only"}
                  {vteTotal >= 1 && vteTotal <= 2 && "IPCD recommended"}
                  {vteTotal >= 3 && vteTotal <= 4 && "LMWH + IPCD"}
                  {vteTotal >= 5 && "LMWH + IPCD + stockings"}
                </div>
              </div>
            </div>
          </Section>

          {/* ── Nursing Plan ── */}
          <Section title="Nursing Problems & Care Goals" icon="pi-pencil" color={C.pink}>
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

          {/* ── Nursing sign-off ── */}
          <div style={{ background: "#fdf2f8", border: `1px solid ${C.pink}30`, borderRadius: 12,
            padding: "14px 20px", marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.pink }}>
                <i className="pi pi-verified" style={{ marginRight: 6 }} />Nurse's Digital Signature
              </div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                {nurseName || user?.fullName || "—"} · {new Date().toLocaleString("en-IN")}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => handleSave(false, "nursing")} disabled={saving}
                style={{ padding: "9px 20px", border: `1.5px solid ${C.border}`, borderRadius: 8,
                  background: "white", cursor: saving ? "not-allowed" : "pointer",
                  fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 600, color: C.muted }}>
                Save Draft
              </button>
              <button onClick={() => handleSave(true, "nursing")} disabled={saving}
                style={{ padding: "9px 22px", border: "none", borderRadius: 8, background: C.pink,
                  cursor: saving ? "not-allowed" : "pointer",
                  fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 700, color: "white",
                  boxShadow: `0 4px 14px ${C.pink}40` }}>
                <i className="pi pi-check-circle" style={{ marginRight: 6, fontSize: 12 }} />
                {saving ? "Saving…" : "Sign Nursing Assessment"}
              </button>
            </div>
          </div>

        </>)}

        {/* ══════════════ DOCTOR TAB ══════════════ */}
        {activeTab === "doctor" && (<>

          {/* ── Doctor Header ── */}
          <Section title="Doctor & Admission Info" icon="pi-id-card" color={C.accent}>
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

          {/* ── History ── */}
          <Section title="History" icon="pi-book" color={C.purple}>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <Field label="History of Present Illness / Chief Complaint *">
                <textarea value={hopi} onChange={e => setHopi(e.target.value)}
                  placeholder="Onset, duration, character, progression, associated symptoms, relieving/aggravating factors…"
                  className="his-textarea" style={{ minHeight: 100 }} />
              </Field>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12 }}>
                <Field label="Past Medical History">
                  <textarea value={pmh} onChange={e => setPmh(e.target.value)}
                    placeholder="DM, HTN, CAD…" className="his-textarea" style={{ minHeight: 64 }} />
                </Field>
                <Field label="Past Surgical History">
                  <textarea value={psh} onChange={e => setPsh(e.target.value)}
                    placeholder="Previous surgeries…" className="his-textarea" style={{ minHeight: 64 }} />
                </Field>
                <Field label="Family History">
                  <textarea value={famHx} onChange={e => setFamHx(e.target.value)}
                    placeholder="Hereditary conditions…" className="his-textarea" style={{ minHeight: 64 }} />
                </Field>
                <Field label="Social / Personal History">
                  <textarea value={socHx} onChange={e => setSocHx(e.target.value)}
                    placeholder="Smoking, alcohol, occupation…" className="his-textarea" style={{ minHeight: 64 }} />
                </Field>
              </div>
              <Field label="Known Allergies">
                <input value={docAllergy} onChange={e => setDocAllergy(e.target.value)}
                  placeholder="Drug / food allergies — None if none" className="his-field" />
              </Field>
            </div>
          </Section>

          {/* ── Examination ── */}
          <Section title="Physical Examination" icon="pi-eye" color={C.teal}>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <Field label="General Examination">
                <textarea value={genExam} onChange={e => setGenExam(e.target.value)}
                  placeholder="Built, nourishment, pallor, icterus, cyanosis, clubbing, lymphadenopathy, edema…"
                  className="his-textarea" style={{ minHeight: 72 }} />
              </Field>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <Field label="CVS">
                  <textarea value={cvs} onChange={e => setCvs(e.target.value)}
                    placeholder="S1 S2, murmurs, JVP, peripheral pulses…" className="his-textarea" />
                </Field>
                <Field label="Respiratory System">
                  <textarea value={rs} onChange={e => setRs(e.target.value)}
                    placeholder="Air entry, breath sounds, percussion…" className="his-textarea" />
                </Field>
                <Field label="Abdomen">
                  <textarea value={abdomen} onChange={e => setAbdomen(e.target.value)}
                    placeholder="Soft/distended, tenderness, organomegaly, bowel sounds…" className="his-textarea" />
                </Field>
                <Field label="CNS">
                  <textarea value={cns} onChange={e => setCns(e.target.value)}
                    placeholder="Orientation, cranial nerves, motor, sensory, reflexes…" className="his-textarea" />
                </Field>
              </div>
            </div>
          </Section>

          {/* ── Diagnosis ── */}
          <Section title="Diagnosis" icon="pi-tag" color={C.accent} badge="NABH Required">
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <Field label="Provisional Diagnosis *">
                <textarea value={provDx} onChange={e => setProvDx(e.target.value)}
                  placeholder="Clinical impression based on history and examination…"
                  className="his-textarea" style={{ minHeight: 64 }} />
              </Field>
              <Grid2>
                <Field label="Final / Confirmed Diagnosis">
                  <textarea value={finalDx} onChange={e => setFinalDx(e.target.value)}
                    placeholder="Confirmed after investigations…" className="his-textarea" style={{ minHeight: 56 }} />
                </Field>
                <Field label="ICD-10 Code">
                  <input value={icd10} onChange={e => setIcd10(e.target.value)}
                    placeholder="e.g. J18.9, K35.9…" className="his-field" />
                </Field>
              </Grid2>
            </div>
          </Section>

          {/* ── Investigations ── */}
          <Section title="Investigations Ordered" icon="pi-list-check" color={C.purple}>
            <Field label="Tests / Investigations">
              <textarea value={investigations} onChange={e => setInvestigations(e.target.value)}
                placeholder="CBC, LFT, RFT, Blood sugar, ECG, X-Ray Chest, USG Abdomen, Cultures…"
                className="his-textarea" style={{ minHeight: 80 }} />
            </Field>
          </Section>

          {/* ── Treatment Plan ── */}
          <Section title="Treatment Plan" icon="pi-list" color={C.green}>
            <Field label="Treatment Plan / Management">
              <textarea value={treatmentPlan} onChange={e => setTreatmentPlan(e.target.value)}
                placeholder="Conservative / surgical plan, monitoring required, nursing orders, special instructions…"
                className="his-textarea" style={{ minHeight: 80 }} />
            </Field>
          </Section>

          {/* ── Prescription ── */}
          <Section title="Prescription" icon="pi-file-edit" color={C.green}
            badge={`${rxRows.filter(r => r.drug).length} drug(s)`}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "#f8fafc" }}>
                    {["#", "Drug / Medicine", "Dose", "Route", "Frequency", "Duration", "Instructions", ""].map(h => (
                      <th key={h} style={{ padding: "8px 10px", textAlign: "left", fontSize: 10, fontWeight: 700,
                        color: C.muted, textTransform: "uppercase", letterSpacing: ".6px",
                        borderBottom: `1.5px solid ${C.border}`, whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rxRows.map((row, idx) => (
                    <tr key={row.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                      <td style={{ padding: "8px 10px", fontSize: 12, fontWeight: 700, color: C.muted }}>{idx + 1}</td>
                      <td style={{ padding: "6px 6px", minWidth: 180 }}>
                        <input value={row.drug} onChange={e => setRxRows(r => r.map(x => x.id === row.id ? { ...x, drug: e.target.value } : x))}
                          placeholder="Drug name…" className="his-field" style={{ padding: "6px 8px" }} />
                      </td>
                      <td style={{ padding: "6px 6px", minWidth: 80 }}>
                        <input value={row.dose} onChange={e => setRxRows(r => r.map(x => x.id === row.id ? { ...x, dose: e.target.value } : x))}
                          placeholder="500mg" className="his-field" style={{ padding: "6px 8px" }} />
                      </td>
                      <td style={{ padding: "6px 6px", minWidth: 90 }}>
                        <select value={row.route} onChange={e => setRxRows(r => r.map(x => x.id === row.id ? { ...x, route: e.target.value } : x))}
                          className="his-field" style={{ padding: "6px 8px" }}>
                          {ROUTES.map(r => <option key={r}>{r}</option>)}
                        </select>
                      </td>
                      <td style={{ padding: "6px 6px", minWidth: 90 }}>
                        <select value={row.frequency} onChange={e => setRxRows(r => r.map(x => x.id === row.id ? { ...x, frequency: e.target.value } : x))}
                          className="his-field" style={{ padding: "6px 8px" }}>
                          {FREQS.map(f => <option key={f}>{f}</option>)}
                        </select>
                      </td>
                      <td style={{ padding: "6px 6px", minWidth: 90 }}>
                        <input value={row.duration} onChange={e => setRxRows(r => r.map(x => x.id === row.id ? { ...x, duration: e.target.value } : x))}
                          placeholder="5 days" className="his-field" style={{ padding: "6px 8px" }} />
                      </td>
                      <td style={{ padding: "6px 6px", minWidth: 140 }}>
                        <input value={row.instructions} onChange={e => setRxRows(r => r.map(x => x.id === row.id ? { ...x, instructions: e.target.value } : x))}
                          placeholder="After food, SOS…" className="his-field" style={{ padding: "6px 8px" }} />
                      </td>
                      <td style={{ padding: "6px 6px" }}>
                        <button onClick={() => setRxRows(r => r.filter(x => x.id !== row.id))}
                          style={{ background: "none", border: "none", cursor: "pointer", color: "#ef4444", padding: 4 }}>
                          <i className="pi pi-trash" style={{ fontSize: 13 }} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button onClick={() => setRxRows(r => [...r, blankRx()])}
              style={{ marginTop: 12, padding: "7px 16px", border: `1.5px dashed ${C.green}60`,
                borderRadius: 8, background: C.greenL, cursor: "pointer",
                fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 600, color: C.green }}>
              <i className="pi pi-plus" style={{ marginRight: 6, fontSize: 11 }} />Add Medicine
            </button>
          </Section>

          {/* ── Diet, Activity & Follow-up ── */}
          <Section title="Diet, Activity & Follow-up" icon="pi-calendar-clock" color={C.teal}>
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

          {/* ── Doctor sign-off ── */}
          <div style={{ background: C.accentL, border: `1px solid ${C.accent}30`, borderRadius: 12,
            padding: "14px 20px", marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.accent }}>
                <i className="pi pi-verified" style={{ marginRight: 6 }} />Doctor's Digital Signature
              </div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                {doctorName || "—"} · {regNo || "Reg. no. not entered"} · {new Date().toLocaleString("en-IN")}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => handleSave(false, "doctor")} disabled={saving}
                style={{ padding: "9px 20px", border: `1.5px solid ${C.border}`, borderRadius: 8,
                  background: "white", cursor: saving ? "not-allowed" : "pointer",
                  fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 600, color: C.muted }}>
                Save Draft
              </button>
              <button onClick={() => handleSave(true, "doctor")} disabled={saving}
                style={{ padding: "9px 22px", border: "none", borderRadius: 8, background: C.accent,
                  cursor: saving ? "not-allowed" : "pointer",
                  fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 700, color: "white",
                  boxShadow: `0 4px 14px ${C.accent}40` }}>
                <i className="pi pi-check-circle" style={{ marginRight: 6, fontSize: 12 }} />
                {saving ? "Submitting…" : "Sign Doctor Initial Assessment"}
              </button>
            </div>
          </div>

        </>)}

      </>)}
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

export default function IPDInitialAssessmentPage() {
  const [selectedPatient, setSelectedPatient] = useState(null);
  return (
    <ClinicalLayout onPatientSelect={setSelectedPatient} selectedId={selectedPatient?._id} pageType="ipd-assessment">
      <IPDInitialAssessmentContent selectedPatient={selectedPatient} />
    </ClinicalLayout>
  );
}
