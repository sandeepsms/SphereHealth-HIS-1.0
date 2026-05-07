/**
 * NurseInitialAssessmentPage.jsx
 * NABH-Compliant Nursing Initial Assessment (Admission Assessment by Nurse)
 * Covers: Patient identification, vitals, head-to-toe, psychosocial, risk scores,
 *         skin integrity, functional status, nutrition, pain, fall risk, discharge planning
 */

import React, { useState, useEffect } from "react";
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
  bg: "#f8fafc", card: "#ffffff", border: "#e2e8f0", text: "#0f172a", muted: "#64748b",
  primary: "#0f766e", primaryL: "#f0fdfa", primaryMid: "#0d9488",
  green: "#16a34a", greenL: "#dcfce7", greenB: "#bbf7d0",
  amber: "#d97706", amberL: "#fffbeb", amberB: "#fde68a",
  red: "#dc2626", redL: "#fef2f2", redB: "#fecaca",
  blue: "#1d4ed8", blueL: "#eff6ff", blueB: "#bfdbfe",
  purple: "#7c3aed", purpleL: "#f5f3ff",
  slate: "#1e293b", slateMid: "#334155",
  pink: "#be185d", pinkL: "#fdf2f8",
};

const fld = {
  padding: "9px 12px", border: "1.5px solid #e2e8f0", borderRadius: 8,
  fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: "#0f172a",
  outline: "none", background: "white", width: "100%", boxSizing: "border-box",
};
const sel = { ...fld, cursor: "pointer" };
const ta  = { ...fld, resize: "vertical", minHeight: 80 };

/* ── Section card ── */
function Section({ title, icon, color = C.primary, badge, nabh, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{
      background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 14,
      marginBottom: 16, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,.04)",
    }}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          padding: "12px 20px", background: "#f8fafc",
          borderBottom: open ? `1px solid ${C.border}` : "none",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          cursor: "pointer", userSelect: "none",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{
            width: 30, height: 30, borderRadius: 8, background: color + "18",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <i className={`pi ${icon}`} style={{ fontSize: 13, color }} />
          </span>
          <span style={{ fontWeight: 700, fontSize: 13, color: C.text }}>{title}</span>
          {nabh && (
            <span style={{
              background: "#7c3aed18", color: "#7c3aed", border: "1px solid #7c3aed30",
              fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 4,
            }}>NABH</span>
          )}
          {badge && (
            <span style={{
              background: color + "18", color, border: `1px solid ${color}30`,
              fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 4,
            }}>{badge}</span>
          )}
        </div>
        <i className={`pi ${open ? "pi-chevron-up" : "pi-chevron-down"}`} style={{ fontSize: 10, color: C.muted }} />
      </div>
      {open && <div style={{ padding: "18px 20px" }}>{children}</div>}
    </div>
  );
}

function G2({ children, gap = 14 }) {
  return <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap }}>{children}</div>;
}
function G3({ children }) {
  return <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>{children}</div>;
}
function G4({ children }) {
  return <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14 }}>{children}</div>;
}

function F({ label, required, children, hint }) {
  return (
    <div>
      <label style={{
        display: "block", fontSize: 11, fontWeight: 700, color: C.muted,
        textTransform: "uppercase", letterSpacing: ".6px", marginBottom: 5,
      }}>
        {label}{required && <span style={{ color: C.red, marginLeft: 3 }}>*</span>}
      </label>
      {children}
      {hint && <div style={{ fontSize: 10, color: C.muted, marginTop: 3 }}>{hint}</div>}
    </div>
  );
}

/* ── Pill toggle for Yes/No ── */
function YesNo({ value, onChange }) {
  return (
    <div style={{ display: "flex", gap: 6, marginTop: 2 }}>
      {["Yes", "No"].map(v => (
        <button
          key={v}
          onClick={() => onChange(v)}
          style={{
            padding: "6px 18px", borderRadius: 20, border: "1.5px solid",
            borderColor: value === v ? (v === "Yes" ? C.green : C.red) : C.border,
            background: value === v ? (v === "Yes" ? C.greenL : C.redL) : "white",
            color: value === v ? (v === "Yes" ? C.green : C.red) : C.muted,
            fontWeight: value === v ? 700 : 500, fontSize: 12, cursor: "pointer",
            fontFamily: "'DM Sans',sans-serif", transition: "all .15s",
          }}
        >{v}</button>
      ))}
    </div>
  );
}

/* ── Pain scale 0-10 ── */
function PainScale({ value, onChange }) {
  const getColor = (n) => {
    if (n <= 3) return C.green;
    if (n <= 6) return C.amber;
    return C.red;
  };
  return (
    <div>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {[0,1,2,3,4,5,6,7,8,9,10].map(n => {
          const active = parseInt(value) === n;
          const col = getColor(n);
          return (
            <button
              key={n}
              onClick={() => onChange(String(n))}
              style={{
                width: 34, height: 34, borderRadius: 8, border: "1.5px solid",
                borderColor: active ? col : C.border,
                background: active ? col : "white",
                color: active ? "white" : C.muted,
                fontWeight: 700, fontSize: 13, cursor: "pointer",
                fontFamily: "'DM Sans',sans-serif", transition: "all .15s",
              }}
            >{n}</button>
          );
        })}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: C.muted, marginTop: 5 }}>
        <span style={{ color: C.green, fontWeight: 600 }}>0 — No Pain</span>
        <span style={{ color: C.amber, fontWeight: 600 }}>5 — Moderate</span>
        <span style={{ color: C.red, fontWeight: 600 }}>10 — Worst</span>
      </div>
    </div>
  );
}

/* ── Color-coded score badge ── */
function ScoreBadge({ score, label, color = C.blue }) {
  return (
    <div style={{
      textAlign: "center", padding: "10px 18px",
      background: color + "12", border: `2px solid ${color}40`, borderRadius: 12,
      minWidth: 90,
    }}>
      <div style={{ fontSize: 30, fontWeight: 800, color, lineHeight: 1 }}>{score}</div>
      <div style={{ fontSize: 10, color: C.muted, fontWeight: 600, marginTop: 4 }}>{label}</div>
    </div>
  );
}

/* ── Vital card ── */
function VitalCard({ label, value, unit, placeholder, onChange, type = "number", step, color = C.primary, icon }) {
  return (
    <div style={{
      background: color + "08", border: `1.5px solid ${color}25`, borderRadius: 12,
      padding: "12px 14px",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        {icon && <i className={`pi ${icon}`} style={{ fontSize: 12, color }} />}
        <span style={{ fontSize: 10, fontWeight: 700, color, textTransform: "uppercase", letterSpacing: ".5px" }}>{label}</span>
      </div>
      <input
        style={{
          ...fld, background: "white", border: `1.5px solid ${color}30`,
          fontWeight: 700, fontSize: 15, color,
        }}
        type={type} step={step} value={value} onChange={onChange}
        placeholder={placeholder}
      />
      {unit && <div style={{ fontSize: 10, color: C.muted, marginTop: 4 }}>{unit}</div>}
    </div>
  );
}

/* ── Sub-system block inside Section ── */
function SubSystem({ title, color, icon, children }) {
  return (
    <div style={{
      marginBottom: 16, padding: "14px 16px",
      background: color + "05", borderRadius: 10, border: `1px solid ${color}20`,
    }}>
      <div style={{
        fontSize: 11, fontWeight: 700, color,
        textTransform: "uppercase", letterSpacing: ".6px", marginBottom: 12,
        display: "flex", alignItems: "center", gap: 6,
      }}>
        {icon && <i className={`pi ${icon}`} style={{ fontSize: 11 }} />}
        {title}
      </div>
      {children}
    </div>
  );
}

/* ════════════════════════════════════════
   MAIN COMPONENT
════════════════════════════════════════ */
function NurseInitialAssessmentContent({ selectedPatient }) {
  const { user } = useAuth();

  // ── Patient identification ────────────────────────────────────
  const [uhid,      setUhid]      = useState("");
  const [ipdNo,     setIpdNo]     = useState("");
  const [patInfo,   setPatInfo]   = useState(null);
  const [searching, setSearching] = useState(false);
  const [saving,    setSaving]    = useState(false);
  const [saved,     setSaved]     = useState(false);

  // ── Assessment date/time ──────────────────────────────────────
  const [assessedAt] = useState(new Date().toISOString().slice(0, 16));

  // ── Vitals at admission ───────────────────────────────────────
  const [vitals, setVitals] = useState({
    bpSys: "", bpDia: "", pulse: "", temp: "", spo2: "", rr: "",
    weight: "", height: "", bmi: "", painScore: "0",
    consciousnessLevel: "Alert", pupils: "Equal & Reacting",
    gcs: "", glucometer: "",
  });

  // ── Head-to-toe system assessment ────────────────────────────
  const [systems, setSystems] = useState({
    // Neurological
    neuroStatus: "Normal", neuroNotes: "",
    // Respiratory
    respiratoryPattern: "Normal", breathSounds: "Clear", oxygenSupport: "No",
    oxygenLPM: "", respiratoryNotes: "",
    // Cardiovascular
    heartSounds: "Normal", capRefill: "< 2 sec", peripheralPulse: "Present", cvNotes: "",
    // GI / Abdomen
    abdomen: "Soft", bowelSounds: "Present", lastBowelMovement: "", nausea: "No",
    vomiting: "No", giNotes: "",
    // Genitourinary
    urinaryPattern: "Normal", catheter: "No", catheterSite: "", guNotes: "",
    // Musculoskeletal
    mobility: "Independent", assistiveDevice: "None", musculoNotes: "",
    // Integumentary / Skin
    skinColor: "Normal", skinTurgor: "Normal", skinIntact: "Yes",
    woundPresent: "No", woundLocation: "", woundDescription: "", edema: "No", edemaLocation: "",
    // IV Access
    ivAccess: "No", ivSite: "", ivSize: "", ivInsertedDate: "",
  });

  // ── Psychosocial ─────────────────────────────────────────────
  const [psycho, setPsycho] = useState({
    anxietyLevel: "None", emotionalStatus: "Calm", cooperationLevel: "Cooperative",
    cognitiveStatus: "Oriented", languageBarrier: "No", language: "",
    spiritualNeeds: "No", spiritualNotes: "",
    physicalAbuseRisk: "No", socialSupport: "Family Present",
  });

  // ── Nutrition & Hydration ─────────────────────────────────────
  const [nutrition, setNutrition] = useState({
    dietaryRestrictions: "None", allergies: "", nutritionRisk: "Low",
    hydrationStatus: "Adequate", lastMealTime: "", swallowingDifficulty: "No",
    feedingMethod: "Oral", nutritionNotes: "",
  });

  // ── Risk Assessments ─────────────────────────────────────────
  const [braden, setBraden] = useState({
    sensoryPerception: "4", moisture: "4", activity: "4",
    mobility: "4", nutrition: "4", frictionShear: "3",
  });

  const [morse, setMorse] = useState({
    fallHistory: "0",
    secondaryDiagnosis: "0",
    ambulatoryAid: "0",
    ivAccess: "0",
    gaitBalance: "0",
    mentalStatus: "0",
  });

  // ── Discharge Planning ────────────────────────────────────────
  const [discharge, setDischarge] = useState({
    livesAlone: "No", caregiver: "Family", homeSupportAvailable: "Yes",
    anticipatedDischargeNeeds: "", educationNeeded: "", socialWorkReferral: "No",
    dischargePlanNotes: "",
  });

  // ── Nurse sign-off ────────────────────────────────────────────
  const [signoff, setSignoff] = useState({
    nurseName: user?.fullName || user?.firstName || "",
    nurseId: user?.employeeId || "",
    designation: "Staff Nurse",
    notes: "",
  });

  const draftKey = selectedPatient?._id ? `sphere_draft_nurse_initial_${selectedPatient._id}` : null;
  const { savedAt, hasDraft, loadDraft, clearDraft } = useAutoSave(
    draftKey,
    { vitals, systems, psycho, nutrition, braden, morse, discharge, signoff },
    2000
  );
  const { signature, showSetup, setShowSetup, saveSignature } = useDigitalSignature();

  // ── Auto-fill when selectedPatient changes ────────────────────
  useEffect(() => {
    if (selectedPatient) {
      setUhid(selectedPatient.UHID || "");
      setIpdNo(selectedPatient.admissionNumber || selectedPatient.bedNumber || "");
      setPatInfo(selectedPatient);
      // Restore auto-save draft if available
      const draft = loadDraft();
      if (draft?.data) {
        const d = draft.data;
        if (d.vitals)    setVitals(d.vitals);
        if (d.systems)   setSystems(d.systems);
        if (d.psycho)    setPsycho(d.psycho);
        if (d.nutrition) setNutrition(d.nutrition);
        if (d.braden)    setBraden(d.braden);
        if (d.morse)     setMorse(d.morse);
        if (d.discharge) setDischarge(d.discharge);
        if (d.signoff)   setSignoff(d.signoff);
        toast.info("Draft restored", { autoClose: 2000 });
      }
    }
  }, [selectedPatient]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived scores ────────────────────────────────────────────
  const bradenScore = Object.values(braden).reduce((s, v) => s + parseInt(v || 0), 0);
  const bradenRisk  = bradenScore <= 9  ? { label: "Very High Risk", color: C.red }
                    : bradenScore <= 12 ? { label: "High Risk",       color: C.red }
                    : bradenScore <= 14 ? { label: "Moderate Risk",   color: C.amber }
                    : bradenScore <= 18 ? { label: "Mild Risk",       color: C.amber }
                    : { label: "No Risk", color: C.green };

  const morseScore = Object.values(morse).reduce((s, v) => s + parseInt(v || 0), 0);
  const morseRisk  = morseScore >= 45 ? { label: "High Fall Risk",   color: C.red }
                   : morseScore >= 25 ? { label: "Medium Fall Risk", color: C.amber }
                   : { label: "Low Fall Risk", color: C.green };

  const bmi = (() => {
    const w = parseFloat(vitals.weight), h = parseFloat(vitals.height) / 100;
    return w && h ? (w / (h * h)).toFixed(1) : "";
  })();

  // ── Search patient ────────────────────────────────────────────
  const handleSearch = async () => {
    if (!uhid.trim()) return;
    setSearching(true);
    try {
      const token = localStorage.getItem("his_token");
      const res = await axios.get(`${API_ENDPOINTS.ADMISSIONS}/active`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const admissions = Array.isArray(res.data?.data) ? res.data.data
        : Array.isArray(res.data) ? res.data : [];
      const found = admissions.find(a =>
        a.UHID === uhid.trim().toUpperCase() ||
        a.admissionNumber === uhid.trim() ||
        a.patientId?.UHID === uhid.trim().toUpperCase()
      );
      if (found) {
        setPatInfo(found);
        setIpdNo(found.admissionNumber || "");
        toast.success("Patient found");
      } else {
        toast.warn("No active admission found for this UHID");
      }
    } catch {
      toast.error("Failed to search patient");
    } finally {
      setSearching(false);
    }
  };

  // ── Save ─────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!patInfo) { toast.warn("Please load a patient first"); return; }
    if (!patInfo._id) { toast.warn("Admission ID missing — reload patient"); return; }
    setSaving(true);
    try {
      const token = localStorage.getItem("his_token");
      const payload = {
        UHID: patInfo.UHID || patInfo.patientId?.UHID || uhid,
        assessedAt,
        assessedBy: signoff.nurseName,
        nurseId: signoff.nurseId,
        designation: signoff.designation,
        vitals: { ...vitals, bmi: bmi || vitals.bmi },
        systemAssessment: systems,
        psychosocial: psycho,
        nutritionHydration: nutrition,
        riskAssessments: {
          bradenScale: { ...braden, totalScore: bradenScore, riskLevel: bradenRisk.label },
          morseFallScale: { ...morse, totalScore: morseScore, riskLevel: morseRisk.label },
        },
        dischargePlanning: discharge,
        notes: signoff.notes,
        nurseSignature: signature || undefined,
      };

      // ✅ Use dedicated endpoint — no NurseStaff ObjectId required
      await axios.post(
        `${API_ENDPOINTS.ADMISSIONS}/${patInfo._id}/nurse-assessment`,
        payload,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      toast.success("✅ Nursing Initial Assessment saved successfully");
      clearDraft();
      setSaved(true);
    } catch (err) {
      console.error("[NurseAssessment] Save error:", err.response?.data || err.message);
      toast.error(err.response?.data?.message || "Failed to save assessment. Check console for details.");
    } finally {
      setSaving(false);
    }
  };

  const upd = (setter) => (field) => (e) =>
    setter(prev => ({ ...prev, [field]: e.target ? e.target.value : e }));

  // patient display helpers
  const patName = patInfo?.patientName || patInfo?.patientId?.fullName || "";
  const patWard = patInfo?.wardId?.wardName || patInfo?.wardName || "—";
  const patBed  = patInfo?.bedNumber || patInfo?.bedId?.bedNumber || "—";
  const patAdmDate = patInfo?.admissionDate
    ? new Date(patInfo.admissionDate).toLocaleDateString("en-IN")
    : "—";
  const patBlood = patInfo?.patientId?.bloodGroup || patInfo?.bloodGroup || "";

  return (
    <div style={{ fontFamily: "'DM Sans', sans-serif", background: C.bg, minHeight: "100vh", paddingBottom: 100 }}>

      {/* ── Page header banner ── */}
      <div style={{
        background: `linear-gradient(135deg, ${C.slate} 0%, ${C.primary} 100%)`,
        borderRadius: 16, padding: "20px 28px", marginBottom: 18,
        display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12,
        boxShadow: "0 4px 16px rgba(15,118,110,.18)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{
            width: 48, height: 48, borderRadius: 14,
            background: "rgba(255,255,255,.15)", backdropFilter: "blur(8px)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <i className="pi pi-heart-fill" style={{ fontSize: 22, color: "white" }} />
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 18, color: "white", letterSpacing: "-.2px" }}>
              Nursing Initial Assessment
            </div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,.65)", marginTop: 2 }}>
              NABH-Compliant Admission Assessment &nbsp;•&nbsp;
              {new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
              {signoff.nurseName && <> &nbsp;•&nbsp; {signoff.nurseName}</>}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span style={{
            background: "rgba(255,255,255,.15)", color: "white",
            border: "1px solid rgba(255,255,255,.3)",
            fontSize: 11, fontWeight: 700, padding: "4px 12px", borderRadius: 6, letterSpacing: ".5px",
          }}>NABH</span>
          <button
            onClick={() => window.print()}
            style={{
              padding: "8px 16px", borderRadius: 9, border: "1px solid rgba(255,255,255,.3)",
              background: "rgba(255,255,255,.12)", cursor: "pointer", fontSize: 12,
              color: "white", fontWeight: 600, fontFamily: "'DM Sans',sans-serif",
              display: "flex", alignItems: "center", gap: 6,
            }}
          >
            <i className="pi pi-print" style={{ fontSize: 12 }} />Print
          </button>
        </div>
      </div>

      {/* ── Patient search bar (sticky) ── */}
      <div style={{
        position: "sticky", top: 0, zIndex: 30,
        background: C.card, borderRadius: 12, padding: "12px 18px",
        marginBottom: 18, border: `2px solid ${C.primary}30`,
        display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
        boxShadow: "0 2px 12px rgba(15,118,110,.08)",
      }}>
        <i className="pi pi-search" style={{ fontSize: 14, color: C.primary }} />
        <input
          value={uhid}
          onChange={e => setUhid(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handleSearch()}
          style={{
            ...fld, flex: 1, minWidth: 220, maxWidth: 320,
            border: `1.5px solid ${C.primary}40`, borderRadius: 9,
          }}
          placeholder="Enter UHID or Admission No. and press Enter…"
        />
        <button
          onClick={handleSearch}
          disabled={searching}
          style={{
            padding: "9px 20px", borderRadius: 9, border: "none",
            background: searching ? C.muted : `linear-gradient(135deg, ${C.primary}, ${C.primaryMid})`,
            color: "white", fontWeight: 700, fontSize: 12, cursor: searching ? "not-allowed" : "pointer",
            fontFamily: "'DM Sans',sans-serif", display: "flex", alignItems: "center", gap: 6,
          }}
        >
          <i className="pi pi-search" style={{ fontSize: 11 }} />
          {searching ? "Searching…" : "Load Patient"}
        </button>
        {patInfo && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginLeft: 4 }}>
            <span style={{
              background: C.primaryL, color: C.primary, border: `1px solid ${C.primary}30`,
              fontSize: 12, fontWeight: 700, padding: "4px 12px", borderRadius: 20,
            }}>
              <i className="pi pi-check-circle" style={{ marginRight: 5, fontSize: 11 }} />
              {patName}
            </span>
            <span style={{ fontSize: 12, color: C.muted, alignSelf: "center" }}>
              UHID: <b style={{ color: C.text }}>{patInfo.UHID}</b>
            </span>
            <span style={{ fontSize: 12, color: C.muted, alignSelf: "center" }}>
              Ward/Bed: <b style={{ color: C.text }}>{patWard} / {patBed}</b>
            </span>
          </div>
        )}
      </div>

      {/* ── Loaded patient header card ── */}
      {patInfo && (
        <div style={{
          background: C.card, border: `1.5px solid ${C.primary}25`, borderRadius: 14,
          padding: "16px 22px", marginBottom: 18,
          boxShadow: "0 2px 10px rgba(15,118,110,.07)",
        }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
            <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
              <div style={{
                width: 50, height: 50, borderRadius: 14, background: C.primaryL,
                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
              }}>
                <i className="pi pi-user" style={{ fontSize: 22, color: C.primary }} />
              </div>
              <div>
                <div style={{ fontWeight: 800, fontSize: 17, color: C.text }}>{patName}</div>
                <div style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>
                  UHID: <b style={{ color: C.text }}>{patInfo.UHID}</b>
                  &nbsp;•&nbsp; IPD No: <b style={{ color: C.text }}>{ipdNo || "—"}</b>
                  &nbsp;•&nbsp; Admitted: <b style={{ color: C.text }}>{patAdmDate}</b>
                </div>
                <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
                  Ward: <b style={{ color: C.text }}>{patWard}</b>
                  &nbsp;•&nbsp; Bed: <b style={{ color: C.text }}>{patBed}</b>
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              {patBlood && (
                <span style={{
                  background: C.redL, color: C.red, border: `1.5px solid ${C.redB}`,
                  fontSize: 13, fontWeight: 800, padding: "5px 14px", borderRadius: 20,
                }}>
                  <i className="pi pi-heart" style={{ marginRight: 4, fontSize: 11 }} />{patBlood}
                </span>
              )}
              {(patInfo?.patientId?.allergies || patInfo?.allergies) && (
                <span style={{
                  background: C.amberL, color: C.amber, border: `1.5px solid ${C.amberB}`,
                  fontSize: 11, fontWeight: 700, padding: "5px 12px", borderRadius: 20,
                }}>
                  <i className="pi pi-exclamation-triangle" style={{ marginRight: 4, fontSize: 10 }} />
                  Allergy: {patInfo?.patientId?.allergies || patInfo?.allergies}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── 1. Assessment Details ── */}
      <Section title="Patient Identification & Assessment Details" icon="pi-id-card" color={C.primary} nabh>
        <G3>
          <F label="Assessment Date & Time" required>
            <input style={fld} type="datetime-local" defaultValue={assessedAt} readOnly />
          </F>
          <F label="Nurse Name" required>
            <input
              style={fld} value={signoff.nurseName}
              onChange={e => setSignoff(p => ({ ...p, nurseName: e.target.value }))}
              placeholder="Full name of assessing nurse"
            />
          </F>
          <F label="Nurse ID / Registration No.">
            <input
              style={fld} value={signoff.nurseId}
              onChange={e => setSignoff(p => ({ ...p, nurseId: e.target.value }))}
              placeholder="Employee ID"
            />
          </F>
          <F label="Designation">
            <select
              style={sel} value={signoff.designation}
              onChange={e => setSignoff(p => ({ ...p, designation: e.target.value }))}
            >
              {["Staff Nurse","Senior Staff Nurse","Charge Nurse","Head Nurse","Nursing Supervisor","ICU Nurse"].map(d => (
                <option key={d}>{d}</option>
              ))}
            </select>
          </F>
          <F label="Admission No.">
            <input style={{ ...fld, background: "#f8fafc" }} value={ipdNo} readOnly placeholder="Auto-filled from patient" />
          </F>
          <F label="Ward / Bed">
            <input
              style={{ ...fld, background: "#f8fafc" }} readOnly
              value={patInfo ? `${patWard} / ${patBed}` : ""}
              placeholder="Auto-filled from patient"
            />
          </F>
        </G3>
      </Section>

      {/* ── 2. Vital Signs ── */}
      <Section title="Vital Signs at Admission" icon="pi-heart" color={C.red} nabh>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 16 }}>
          <VitalCard label="BP Systolic" unit="mmHg" placeholder="120" icon="pi-angle-up"
            value={vitals.bpSys} onChange={upd(setVitals)("bpSys")} color={C.red} />
          <VitalCard label="BP Diastolic" unit="mmHg" placeholder="80" icon="pi-angle-down"
            value={vitals.bpDia} onChange={upd(setVitals)("bpDia")} color={C.pink} />
          <VitalCard label="Pulse" unit="bpm" placeholder="72" icon="pi-heart"
            value={vitals.pulse} onChange={upd(setVitals)("pulse")} color={C.red} />
          <VitalCard label="Temperature" unit="°F" placeholder="98.6" step="0.1"
            value={vitals.temp} onChange={upd(setVitals)("temp")} color={C.amber} />
          <VitalCard label="SpO₂" unit="%" placeholder="98"
            value={vitals.spo2} onChange={upd(setVitals)("spo2")} color={C.blue} />
          <VitalCard label="Resp. Rate" unit="/min" placeholder="18"
            value={vitals.rr} onChange={upd(setVitals)("rr")} color={C.primary} />
          <VitalCard label="Weight" unit="kg" placeholder="70" step="0.1"
            value={vitals.weight}
            onChange={e => setVitals(p => ({ ...p, weight: e.target.value }))}
            color={C.purple} />
          <VitalCard label="Height" unit="cm" placeholder="170"
            value={vitals.height}
            onChange={e => setVitals(p => ({ ...p, height: e.target.value }))}
            color={C.purple} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 2fr", gap: 12, marginBottom: 16 }}>
          <div style={{
            background: C.primaryL, border: `1.5px solid ${C.primary}25`, borderRadius: 12,
            padding: "12px 14px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: C.primary, textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 4 }}>BMI</div>
            <div style={{ fontSize: 26, fontWeight: 800, color: C.primary }}>{bmi || "—"}</div>
            <div style={{ fontSize: 10, color: C.muted }}>Auto-calculated</div>
          </div>
          <F label="Blood Glucose (mg/dL)">
            <input style={fld} type="number" value={vitals.glucometer}
              onChange={upd(setVitals)("glucometer")} placeholder="mg/dL" />
          </F>
          <F label="GCS Score (3–15)">
            <input style={fld} type="number" min="3" max="15" value={vitals.gcs}
              onChange={upd(setVitals)("gcs")} placeholder="15 = fully conscious" />
          </F>
        </div>

        <div style={{ background: "#f8fafc", borderRadius: 10, padding: "14px 16px", marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 12 }}>
            Pain Assessment (NRS 0–10)
          </div>
          <PainScale value={vitals.painScore} onChange={v => setVitals(p => ({ ...p, painScore: v }))} />
        </div>

        <G3>
          <F label="Level of Consciousness">
            <select style={sel} value={vitals.consciousnessLevel} onChange={upd(setVitals)("consciousnessLevel")}>
              {["Alert","Verbal Response","Pain Response","Unresponsive","Sedated"].map(v => <option key={v}>{v}</option>)}
            </select>
          </F>
          <F label="Pupil Reaction">
            <select style={sel} value={vitals.pupils} onChange={upd(setVitals)("pupils")}>
              {["Equal & Reacting","Unequal","Non-Reactive","Sluggish"].map(v => <option key={v}>{v}</option>)}
            </select>
          </F>
          <F label="Oxygen Support">
            <select style={sel} value={systems.oxygenSupport} onChange={upd(setSystems)("oxygenSupport")}>
              {["No","Nasal Prongs","Face Mask","Non-Rebreather Mask","Ventilator","CPAP","BiPAP"].map(v => <option key={v}>{v}</option>)}
            </select>
          </F>
        </G3>
      </Section>

      {/* ── 3. General Appearance & Nutrition screening ── */}
      <Section title="General Appearance & Nutrition" icon="pi-eye" color={C.green} nabh>
        <G3>
          <F label="Nutrition Risk">
            <select style={sel} value={nutrition.nutritionRisk} onChange={upd(setNutrition)("nutritionRisk")}>
              {["Low","Moderate","High"].map(v => <option key={v}>{v}</option>)}
            </select>
          </F>
          <F label="Hydration Status">
            <select style={sel} value={nutrition.hydrationStatus} onChange={upd(setNutrition)("hydrationStatus")}>
              {["Adequate","Mild dehydration","Moderate dehydration","Severe dehydration"].map(v => <option key={v}>{v}</option>)}
            </select>
          </F>
          <F label="Feeding Method">
            <select style={sel} value={nutrition.feedingMethod} onChange={upd(setNutrition)("feedingMethod")}>
              {["Oral","NG Tube","PEG","TPN","IV Fluids only","NPO"].map(v => <option key={v}>{v}</option>)}
            </select>
          </F>
          <F label="Swallowing Difficulty">
            <select style={sel} value={nutrition.swallowingDifficulty} onChange={upd(setNutrition)("swallowingDifficulty")}>
              {["No","Mild","Moderate","Severe — NPO"].map(v => <option key={v}>{v}</option>)}
            </select>
          </F>
          <F label="Dietary Restrictions">
            <input style={fld} value={nutrition.dietaryRestrictions}
              onChange={upd(setNutrition)("dietaryRestrictions")}
              placeholder="e.g. Diabetic diet, Low sodium…" />
          </F>
          <F label="Last Meal Time">
            <input style={fld} type="datetime-local" value={nutrition.lastMealTime}
              onChange={upd(setNutrition)("lastMealTime")} />
          </F>
          <F label="Known Food Allergies">
            <input style={fld} value={nutrition.allergies}
              onChange={upd(setNutrition)("allergies")}
              placeholder="None / list specific items" />
          </F>
        </G3>
      </Section>

      {/* ── 4. Neurological Assessment ── */}
      <Section title="Neurological Assessment" icon="pi-bolt" color={C.blue} nabh>
        <G3>
          <F label="Neurological Status">
            <select style={sel} value={systems.neuroStatus} onChange={upd(setSystems)("neuroStatus")}>
              {["Normal","Confused","Disoriented","Lethargic","Obtunded","Stuporous","Comatose"].map(v => <option key={v}>{v}</option>)}
            </select>
          </F>
          <F label="Level of Consciousness">
            <select style={sel} value={vitals.consciousnessLevel} onChange={upd(setVitals)("consciousnessLevel")}>
              {["Alert","Verbal Response","Pain Response","Unresponsive","Sedated"].map(v => <option key={v}>{v}</option>)}
            </select>
          </F>
          <F label="GCS Total Score">
            <input style={fld} type="number" min="3" max="15" value={vitals.gcs}
              onChange={upd(setVitals)("gcs")} placeholder="3–15" />
          </F>
        </G3>
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 10 }}>
            Pain Scale (NRS)
          </div>
          <PainScale value={vitals.painScore} onChange={v => setVitals(p => ({ ...p, painScore: v }))} />
        </div>
        <div style={{ marginTop: 14 }}>
          <F label="Neurological Notes" hint="Orientation, behavior, speech, focal deficits">
            <input style={fld} value={systems.neuroNotes} onChange={upd(setSystems)("neuroNotes")}
              placeholder="Any abnormal findings…" />
          </F>
        </div>
      </Section>

      {/* ── 5. Cardiovascular Assessment ── */}
      <Section title="Cardiovascular Assessment" icon="pi-heart" color={C.red} nabh>
        <G4>
          <F label="Heart Sounds">
            <select style={sel} value={systems.heartSounds} onChange={upd(setSystems)("heartSounds")}>
              {["Normal","Murmur","Irregular","Muffled","S3/S4 Gallop"].map(v => <option key={v}>{v}</option>)}
            </select>
          </F>
          <F label="Capillary Refill">
            <select style={sel} value={systems.capRefill} onChange={upd(setSystems)("capRefill")}>
              {["< 2 sec","> 2 sec","Delayed"].map(v => <option key={v}>{v}</option>)}
            </select>
          </F>
          <F label="Peripheral Pulse">
            <select style={sel} value={systems.peripheralPulse} onChange={upd(setSystems)("peripheralPulse")}>
              {["Present","Absent","Weak","Bounding"].map(v => <option key={v}>{v}</option>)}
            </select>
          </F>
          <F label="CV Notes">
            <input style={fld} value={systems.cvNotes} onChange={upd(setSystems)("cvNotes")}
              placeholder="Palpitations, chest pain…" />
          </F>
        </G4>
      </Section>

      {/* ── 6. Respiratory Assessment ── */}
      <Section title="Respiratory Assessment" icon="pi-cloud" color={C.primary} nabh>
        <G3>
          <F label="Breathing Pattern">
            <select style={sel} value={systems.respiratoryPattern} onChange={upd(setSystems)("respiratoryPattern")}>
              {["Normal","Labored","Shallow","Deep","Cheyne-Stokes","Kussmaul"].map(v => <option key={v}>{v}</option>)}
            </select>
          </F>
          <F label="Breath Sounds">
            <select style={sel} value={systems.breathSounds} onChange={upd(setSystems)("breathSounds")}>
              {["Clear","Crackles","Wheezes","Rhonchi","Absent","Diminished"].map(v => <option key={v}>{v}</option>)}
            </select>
          </F>
          <F label="Oxygen Support">
            <select style={sel} value={systems.oxygenSupport} onChange={upd(setSystems)("oxygenSupport")}>
              {["No","Nasal Prongs","Face Mask","Non-Rebreather Mask","Ventilator","CPAP","BiPAP"].map(v => <option key={v}>{v}</option>)}
            </select>
          </F>
          <F label="Respiratory Notes">
            <input style={fld} value={systems.respiratoryNotes} onChange={upd(setSystems)("respiratoryNotes")}
              placeholder="Cough, sputum, dyspnea…" />
          </F>
        </G3>
      </Section>

      {/* ── 7. Gastrointestinal Assessment ── */}
      <Section title="Gastrointestinal Assessment" icon="pi-circle" color={C.amber} nabh>
        <G4>
          <F label="Abdomen">
            <select style={sel} value={systems.abdomen} onChange={upd(setSystems)("abdomen")}>
              {["Soft","Distended","Rigid","Tender","Guarding"].map(v => <option key={v}>{v}</option>)}
            </select>
          </F>
          <F label="Bowel Sounds">
            <select style={sel} value={systems.bowelSounds} onChange={upd(setSystems)("bowelSounds")}>
              {["Present","Absent","Hyperactive","Hypoactive"].map(v => <option key={v}>{v}</option>)}
            </select>
          </F>
          <F label="Last Bowel Movement">
            <input style={fld} type="date" value={systems.lastBowelMovement}
              onChange={upd(setSystems)("lastBowelMovement")} />
          </F>
          <F label="GI Notes">
            <input style={fld} value={systems.giNotes} onChange={upd(setSystems)("giNotes")}
              placeholder="Nausea, vomiting, appetite…" />
          </F>
        </G4>
      </Section>

      {/* ── 8. Musculoskeletal & Skin Integrity ── */}
      <Section title="Musculoskeletal & Skin Integrity" icon="pi-th-large" color={C.purple} nabh>
        <SubSystem title="Musculoskeletal" color={C.purple} icon="pi-arrows-alt">
          <G3>
            <F label="Mobility">
              <select style={sel} value={systems.mobility} onChange={upd(setSystems)("mobility")}>
                {["Independent","Requires assistance","Dependent","Bedbound"].map(v => <option key={v}>{v}</option>)}
              </select>
            </F>
            <F label="Assistive Device">
              <select style={sel} value={systems.assistiveDevice} onChange={upd(setSystems)("assistiveDevice")}>
                {["None","Walker","Crutches","Cane","Wheelchair","Bedrest"].map(v => <option key={v}>{v}</option>)}
              </select>
            </F>
            <F label="Notes">
              <input style={fld} value={systems.musculoNotes} onChange={upd(setSystems)("musculoNotes")}
                placeholder="Range of motion, contractures…" />
            </F>
          </G3>
        </SubSystem>

        <SubSystem title="Skin Integrity" color={C.pink} icon="pi-star">
          <G4>
            <F label="Skin Color">
              <select style={sel} value={systems.skinColor} onChange={upd(setSystems)("skinColor")}>
                {["Normal","Pale","Jaundiced","Cyanotic","Flushed","Mottled"].map(v => <option key={v}>{v}</option>)}
              </select>
            </F>
            <F label="Skin Turgor">
              <select style={sel} value={systems.skinTurgor} onChange={upd(setSystems)("skinTurgor")}>
                {["Normal","Poor","Very Poor"].map(v => <option key={v}>{v}</option>)}
              </select>
            </F>
            <F label="Skin Intact">
              <select style={sel} value={systems.skinIntact} onChange={upd(setSystems)("skinIntact")}>
                {["Yes","No"].map(v => <option key={v}>{v}</option>)}
              </select>
            </F>
            <F label="Edema">
              <select style={sel} value={systems.edema} onChange={upd(setSystems)("edema")}>
                {["No","Pitting +1","Pitting +2","Pitting +3","Pitting +4","Non-pitting"].map(v => <option key={v}>{v}</option>)}
              </select>
            </F>
          </G4>
          {(systems.skinIntact === "No" || systems.edema !== "No") && (
            <div style={{ marginTop: 12 }}>
              <G2>
                <F label="Wound / Lesion Location">
                  <input style={fld} value={systems.woundLocation} onChange={upd(setSystems)("woundLocation")}
                    placeholder="e.g. Left heel, sacrum…" />
                </F>
                <F label="Wound Description">
                  <input style={fld} value={systems.woundDescription} onChange={upd(setSystems)("woundDescription")}
                    placeholder="Size, color, drainage, stage…" />
                </F>
              </G2>
            </div>
          )}
        </SubSystem>

        {/* Lines / Devices as toggle chips */}
        <SubSystem title="Lines, Tubes & Devices" color={C.primary} icon="pi-link">
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 10 }}>
              IV / Vascular Access
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {["No","Peripheral IV","Central Line","PICC","Arterial Line","Port"].map(v => {
                const active = systems.ivAccess === v;
                return (
                  <button
                    key={v}
                    onClick={() => setSystems(p => ({ ...p, ivAccess: v }))}
                    style={{
                      padding: "8px 16px", borderRadius: 20, border: "1.5px solid",
                      borderColor: active ? C.primary : C.border,
                      background: active ? C.primaryL : "white",
                      color: active ? C.primary : C.muted,
                      fontWeight: active ? 700 : 500, fontSize: 12,
                      cursor: "pointer", fontFamily: "'DM Sans',sans-serif",
                      transition: "all .15s",
                    }}
                  >
                    {active && <i className="pi pi-check" style={{ marginRight: 5, fontSize: 10 }} />}
                    {v}
                  </button>
                );
              })}
            </div>
          </div>
          {systems.ivAccess !== "No" && (
            <G3>
              <F label="IV Site">
                <input style={fld} value={systems.ivSite} onChange={upd(setSystems)("ivSite")}
                  placeholder="e.g. Right forearm" />
              </F>
              <F label="Cannula Size">
                <input style={fld} value={systems.ivSize} onChange={upd(setSystems)("ivSize")}
                  placeholder="e.g. 18G" />
              </F>
              <F label="Insertion Date">
                <input style={fld} type="date" value={systems.ivInsertedDate}
                  onChange={upd(setSystems)("ivInsertedDate")} />
              </F>
            </G3>
          )}
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 10 }}>
              Other Tubes / Devices
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {[
                { label: "Foley Catheter", key: "catheter" },
                { label: "NG Tube",        key: "feedingMethod_ngt" },
                { label: "O₂ Support",     key: "oxygenSupport_active" },
                { label: "Drain",          key: "drain" },
              ].map(({ label, key }) => {
                const active =
                  key === "catheter"           ? systems.catheter === "Yes"
                  : key === "feedingMethod_ngt" ? nutrition.feedingMethod === "NG Tube"
                  : key === "oxygenSupport_active" ? systems.oxygenSupport !== "No"
                  : false;
                return (
                  <button
                    key={key}
                    onClick={() => {
                      if (key === "catheter")
                        setSystems(p => ({ ...p, catheter: p.catheter === "Yes" ? "No" : "Yes" }));
                      else if (key === "feedingMethod_ngt")
                        setNutrition(p => ({ ...p, feedingMethod: p.feedingMethod === "NG Tube" ? "Oral" : "NG Tube" }));
                      else if (key === "oxygenSupport_active")
                        setSystems(p => ({ ...p, oxygenSupport: p.oxygenSupport !== "No" ? "No" : "Nasal Prongs" }));
                    }}
                    style={{
                      padding: "8px 18px", borderRadius: 10, border: "1.5px solid",
                      borderColor: active ? C.primary : C.border,
                      background: active ? C.primary : "white",
                      color: active ? "white" : C.muted,
                      fontWeight: 600, fontSize: 12, cursor: "pointer",
                      fontFamily: "'DM Sans',sans-serif", transition: "all .15s",
                    }}
                  >
                    {active && <i className="pi pi-check" style={{ marginRight: 5, fontSize: 10 }} />}
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        </SubSystem>
      </Section>

      {/* ── 9. Psychosocial Assessment ── */}
      <Section title="Psychosocial Assessment" icon="pi-comments" color={C.purple} nabh>
        <G3>
          <F label="Emotional Status">
            <select style={sel} value={psycho.emotionalStatus} onChange={upd(setPsycho)("emotionalStatus")}>
              {["Calm","Anxious","Fearful","Depressed","Agitated","Angry","Withdrawn"].map(v => <option key={v}>{v}</option>)}
            </select>
          </F>
          <F label="Cognitive Status">
            <select style={sel} value={psycho.cognitiveStatus} onChange={upd(setPsycho)("cognitiveStatus")}>
              {["Oriented x3","Oriented x2","Oriented x1","Disoriented","Confused","Impaired"].map(v => <option key={v}>{v}</option>)}
            </select>
          </F>
          <F label="Cooperation Level">
            <select style={sel} value={psycho.cooperationLevel} onChange={upd(setPsycho)("cooperationLevel")}>
              {["Cooperative","Uncooperative","Requires encouragement","Unable to assess"].map(v => <option key={v}>{v}</option>)}
            </select>
          </F>
          <F label="Anxiety Level">
            <select style={sel} value={psycho.anxietyLevel} onChange={upd(setPsycho)("anxietyLevel")}>
              {["None","Mild","Moderate","Severe"].map(v => <option key={v}>{v}</option>)}
            </select>
          </F>
          <F label="Language Barrier">
            <select style={sel} value={psycho.languageBarrier} onChange={upd(setPsycho)("languageBarrier")}>
              {["No","Yes — Interpreter needed"].map(v => <option key={v}>{v}</option>)}
            </select>
          </F>
          <F label="Social Support">
            <select style={sel} value={psycho.socialSupport} onChange={upd(setPsycho)("socialSupport")}>
              {["Family Present","Friend Present","Caregiver Present","Alone","No Support"].map(v => <option key={v}>{v}</option>)}
            </select>
          </F>
        </G3>
      </Section>

      {/* ── 10. Risk Assessment ── */}
      <Section title="Risk Assessment (Braden + Morse)" icon="pi-exclamation-triangle" color={C.amber} nabh>

        {/* Braden Scale */}
        <div style={{ marginBottom: 20 }}>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            marginBottom: 14, flexWrap: "wrap", gap: 10,
          }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 14, color: C.text }}>Braden Scale — Pressure Injury Risk</div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>Score 6–23 &nbsp;|&nbsp; ≤18 = At Risk</div>
            </div>
            <ScoreBadge score={bradenScore} label={bradenRisk.label} color={bradenRisk.color} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
            {[
              { key: "sensoryPerception", label: "Sensory Perception", opts: [["1","Completely Limited"],["2","Very Limited"],["3","Slightly Limited"],["4","No Impairment"]] },
              { key: "moisture",          label: "Moisture",           opts: [["1","Constantly Moist"],["2","Often Moist"],["3","Occasionally"],["4","Rarely Moist"]] },
              { key: "activity",          label: "Activity",           opts: [["1","Bedfast"],["2","Chairfast"],["3","Walks Occasionally"],["4","Walks Frequently"]] },
              { key: "mobility",          label: "Mobility",           opts: [["1","Completely Immobile"],["2","Very Limited"],["3","Slightly Limited"],["4","No Limitations"]] },
              { key: "nutrition",         label: "Nutrition",          opts: [["1","Very Poor"],["2","Probably Inadequate"],["3","Adequate"],["4","Excellent"]] },
              { key: "frictionShear",     label: "Friction & Shear",   opts: [["1","Problem"],["2","Potential Problem"],["3","No Apparent Problem"]] },
            ].map(({ key, label, opts }) => (
              <F key={key} label={label}>
                <select style={sel} value={braden[key]} onChange={e => setBraden(p => ({ ...p, [key]: e.target.value }))}>
                  {opts.map(([v, l]) => <option key={v} value={v}>{v} — {l}</option>)}
                </select>
              </F>
            ))}
          </div>
        </div>

        <div style={{ height: 1, background: C.border, marginBottom: 20 }} />

        {/* Morse Fall Scale */}
        <div>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            marginBottom: 14, flexWrap: "wrap", gap: 10,
          }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 14, color: C.text }}>Morse Fall Scale</div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>≥45 = High Risk &nbsp;|&nbsp; 25–44 = Medium Risk</div>
            </div>
            <ScoreBadge score={morseScore} label={morseRisk.label} color={morseRisk.color} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
            {[
              { key: "fallHistory",        label: "History of Falling",    opts: [["0","No"],["25","Yes"]] },
              { key: "secondaryDiagnosis", label: "Secondary Diagnosis",   opts: [["0","No"],["15","Yes"]] },
              { key: "ambulatoryAid",      label: "Ambulatory Aid",        opts: [["0","None / Bedrest"],["15","Crutches / Cane / Walker"],["30","Furniture"]] },
              { key: "ivAccess",           label: "IV / Heparin Lock",     opts: [["0","No"],["20","Yes"]] },
              { key: "gaitBalance",        label: "Gait / Transferring",   opts: [["0","Normal / Bedrest"],["10","Weak"],["20","Impaired"]] },
              { key: "mentalStatus",       label: "Mental Status",         opts: [["0","Oriented"],["15","Forgets Limitations"]] },
            ].map(({ key, label, opts }) => (
              <F key={key} label={label}>
                <select style={sel} value={morse[key]} onChange={e => setMorse(p => ({ ...p, [key]: e.target.value }))}>
                  {opts.map(([v, l]) => <option key={v} value={v}>{v} — {l}</option>)}
                </select>
              </F>
            ))}
          </div>
          {morseScore >= 25 && (
            <div style={{
              marginTop: 14, padding: "10px 16px",
              background: morseRisk.color + "10", border: `1px solid ${morseRisk.color}30`,
              borderRadius: 10, fontSize: 12, color: morseRisk.color, fontWeight: 600,
              display: "flex", alignItems: "center", gap: 8,
            }}>
              <i className="pi pi-exclamation-triangle" style={{ fontSize: 14 }} />
              Fall prevention protocol should be initiated. Ensure bed rails up, call bell within reach, non-slip footwear.
            </div>
          )}
        </div>
      </Section>

      {/* ── 11. Patient Education & Discharge Planning ── */}
      <Section title="Patient Education & Discharge Planning" icon="pi-sign-out" color={C.slateMid} nabh>
        <G3>
          <F label="Lives Alone">
            <select style={sel} value={discharge.livesAlone} onChange={upd(setDischarge)("livesAlone")}>
              {["No","Yes"].map(v => <option key={v}>{v}</option>)}
            </select>
          </F>
          <F label="Primary Caregiver">
            <select style={sel} value={discharge.caregiver} onChange={upd(setDischarge)("caregiver")}>
              {["Family","Spouse","Child","Paid Caregiver","None"].map(v => <option key={v}>{v}</option>)}
            </select>
          </F>
          <F label="Home Support Available">
            <select style={sel} value={discharge.homeSupportAvailable} onChange={upd(setDischarge)("homeSupportAvailable")}>
              {["Yes","No","Unknown"].map(v => <option key={v}>{v}</option>)}
            </select>
          </F>
          <F label="Social Work Referral Needed">
            <select style={sel} value={discharge.socialWorkReferral} onChange={upd(setDischarge)("socialWorkReferral")}>
              {["No","Yes"].map(v => <option key={v}>{v}</option>)}
            </select>
          </F>
          <F label="Anticipated Discharge Needs">
            <input style={fld} value={discharge.anticipatedDischargeNeeds}
              onChange={upd(setDischarge)("anticipatedDischargeNeeds")}
              placeholder="Home nursing, physiotherapy, dressing…" />
          </F>
          <F label="Education Needed">
            <input style={fld} value={discharge.educationNeeded}
              onChange={upd(setDischarge)("educationNeeded")}
              placeholder="Medication, diet, wound care…" />
          </F>
        </G3>
        <div style={{ marginTop: 14 }}>
          <F label="Discharge Plan Notes">
            <textarea style={ta} value={discharge.dischargePlanNotes}
              onChange={upd(setDischarge)("dischargePlanNotes")}
              placeholder="Any additional discharge planning observations…" />
          </F>
        </div>
      </Section>

      {/* ── 12. Nursing Notes & Signature ── */}
      <Section title="Nursing Notes & Signature" icon="pi-pencil" color={C.primary}>
        <F label="Nursing Admission Notes">
          <textarea
            style={{ ...ta, minHeight: 100 }}
            value={signoff.notes}
            onChange={e => setSignoff(p => ({ ...p, notes: e.target.value }))}
            placeholder="Overall clinical impression, priority concerns, immediate actions taken…"
          />
        </F>
        <div style={{
          marginTop: 14, display: "flex", alignItems: "center",
          justifyContent: "space-between", flexWrap: "wrap", gap: 12,
        }}>
          <div style={{ fontSize: 12, color: C.muted }}>
            <i className="pi pi-info-circle" style={{ marginRight: 5 }} />
            Assessed by: <b style={{ color: C.text }}>{signoff.nurseName || "—"}</b>
            &nbsp;&nbsp;|&nbsp;&nbsp;
            Date: <b style={{ color: C.text }}>{new Date(assessedAt).toLocaleString("en-IN")}</b>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={() => window.print()} style={{
              padding: "10px 20px", borderRadius: 9, border: `1.5px solid ${C.border}`,
              background: "white", cursor: "pointer", fontSize: 13, color: C.slateMid,
              fontWeight: 600, fontFamily: "'DM Sans',sans-serif",
              display: "flex", alignItems: "center", gap: 6,
            }}>
              <i className="pi pi-print" style={{ fontSize: 12 }} />Print
            </button>
          </div>
        </div>
      </Section>

      {/* ── Sticky save footer ── */}
      <div style={{
        position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 50,
        background: "rgba(248,250,252,.92)", backdropFilter: "blur(12px)",
        borderTop: `1.5px solid ${C.border}`,
        padding: "12px 28px",
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <AutoSaveIndicator savedAt={savedAt} hasDraft={hasDraft} />
          <button onClick={() => setShowSetup(true)}
            style={{ padding:"7px 12px", background: signature ? "#f0fdf4" : "#fffbeb", border:`1.5px solid ${signature ? "#bbf7d0" : "#fde68a"}`, borderRadius:8, cursor:"pointer", fontSize:11, fontWeight:700, color: signature ? "#16a34a" : "#92400e", display:"flex", alignItems:"center", gap:5 }}>
            {signature ? <><i className="pi pi-verified" /> Signature Set</> : <><i className="pi pi-pen-to-square" /> Setup Signature</>}
          </button>
          <div style={{ fontSize: 12, color: C.muted }}>
            {saved
              ? <span style={{ color: C.green, fontWeight: 700 }}><i className="pi pi-check-circle" style={{ marginRight: 5 }} />Assessment saved successfully</span>
              : patInfo
                ? <span><i className="pi pi-user" style={{ marginRight: 5, color: C.primary }} />Patient: <b style={{ color: C.text }}>{patName}</b></span>
                : <span><i className="pi pi-info-circle" style={{ marginRight: 5 }} />Load a patient to enable saving</span>
            }
          </div>
        </div>
        <button
          onClick={handleSave}
          disabled={saving || !patInfo}
          style={{
            padding: "11px 36px", borderRadius: 10, border: "none",
            background: (!patInfo || saving)
              ? C.muted
              : saved
                ? `linear-gradient(135deg, ${C.green}, #15803d)`
                : `linear-gradient(135deg, ${C.primary}, ${C.primaryMid})`,
            cursor: (!patInfo || saving) ? "not-allowed" : "pointer",
            fontSize: 14, fontWeight: 800, color: "white",
            fontFamily: "'DM Sans',sans-serif",
            boxShadow: patInfo && !saving ? "0 4px 14px rgba(15,118,110,.35)" : "none",
            display: "flex", alignItems: "center", gap: 8,
            transition: "all .2s",
          }}
        >
          {saving
            ? <><i className="pi pi-spin pi-spinner" style={{ fontSize: 14 }} /> Saving…</>
            : saved
              ? <><i className="pi pi-check" style={{ fontSize: 14 }} /> Assessment Saved</>
              : <><i className="pi pi-save" style={{ fontSize: 14 }} /> Save Assessment</>
          }
        </button>
      </div>
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

/* ── Wrap with ClinicalLayout ── */
export default function NurseInitialAssessmentPage() {
  const [selectedPatient, setSelectedPatient] = useState(null);
  return (
    <ClinicalLayout
      onPatientSelect={setSelectedPatient}
      selectedId={selectedPatient?._id}
      pageType="nursing"
    >
      <NurseInitialAssessmentContent selectedPatient={selectedPatient} />
    </ClinicalLayout>
  );
}
