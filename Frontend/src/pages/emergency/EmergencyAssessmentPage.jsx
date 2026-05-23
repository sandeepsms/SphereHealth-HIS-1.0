import React, { useState, useEffect } from "react";
import "../../Components/clinical/clinical-forms.css";
import { useParams, useNavigate } from "react-router-dom";
import axios from "axios";
import { API_ENDPOINTS } from "../../config/api";
import { useAuth } from "../../context/AuthContext";
import { toast } from "react-toastify";
import { useAutoSave } from "../../hooks/useAutoSave";
import { useDigitalSignature } from "../../hooks/useDigitalSignature";
import AutoSaveIndicator from "../../Components/signature/AutoSaveIndicator";
import SignaturePad from "../../Components/signature/SignaturePad";
import SignatureStamp from "../../Components/signature/SignatureStamp";
import ClinicalLayout from "../../Components/clinical/ClinicalLayout";
// R7ay — Shared clinical-form panels that used to be inline in OPD.
// Emergency's Step 3 now mounts the same three modules (Prescription,
// IV Infusion, Services & Orders → DRAFT bill) so the ER doctor has
// the same authoring experience as OPD.
import PrescriptionPanel from "../../Components/clinical/PrescriptionPanel";
import InfusionPanel from "../../Components/clinical/InfusionPanel";
import ServicesOrdersPanel from "../../Components/clinical/ServicesOrdersPanel";

/* ── Design tokens ── */
const C = {
  bg: "#f0f2f5", card: "#fff", border: "#e2e6ea", text: "#1a1d23", muted: "#6b7280",
  accent: "#1e40af", accentL: "#eff6ff",
  green: "#16a34a", greenL: "#dcfce7",
  red: "#dc2626", redL: "#fef2f2",
  amber: "#d97706", amberL: "#fffbeb",
  orange: "#ea580c", orangeL: "#fff7ed",
  teal: "#0d9488", tealL: "#f0fdfa",
  purple: "#7c3aed", purpleL: "#f5f3ff",
  pink: "#db2777",
  slate: "#1e293b",
};

/* ── Triage levels ── */
const TRIAGE_LEVELS = [
  { key: "I",   label: "Level I — Resuscitation",  subtitle: "Life-threatening — Immediate",  color: "#7c3aed", bg: "#f5f3ff", icon: "pi-times-circle" },
  { key: "II",  label: "Level II — Emergent",       subtitle: "Potentially life-threatening — ≤15 min", color: C.red, bg: C.redL, icon: "pi-exclamation-triangle" },
  { key: "III", label: "Level III — Urgent",        subtitle: "Serious condition — ≤30 min",  color: C.amber, bg: C.amberL, icon: "pi-clock" },
  { key: "IV",  label: "Level IV — Less Urgent",    subtitle: "Stable — ≤60 min",             color: C.green, bg: C.greenL, icon: "pi-info-circle" },
  { key: "V",   label: "Level V — Non-Urgent",      subtitle: "Minor — ≤120 min",             color: C.teal, bg: C.tealL, icon: "pi-check-circle" },
];

/* ── ABCDE items ── */
const ABCDE_ITEMS = [
  { key: "A", full: "Airway", color: C.red,    icon: "pi-sort-up-fill" },
  { key: "B", full: "Breathing", color: C.orange, icon: "pi-wave-pulse" },
  { key: "C", full: "Circulation", color: C.purple, icon: "pi-heart-fill" },
  { key: "D", full: "Disability (Neuro)", color: C.accent, icon: "pi-eye" },
  { key: "E", full: "Exposure / Environment", color: C.teal, icon: "pi-user" },
];

const blankRx = () => ({
  id: Date.now() + Math.random(),
  type: "medication", detail: "", dose: "", route: "IV", freq: "", priority: "URGENT",
});

const ORDER_TYPES = ["medication", "iv_fluid", "blood", "lab", "radiology", "procedure", "nursing", "consultation"];
const ROUTES = ["IV", "IM", "SC", "Oral", "Inhaled", "Nasal", "Topical", "PR"];
const PRIORITIES = ["STAT", "URGENT", "ROUTINE"];

/* ── Section card ── */
function Section({ title, icon, color = C.red, badge, children }) {
  const [open, setOpen] = useState(true);
  return (
    <div style={{ background: C.card, border: `1.5px solid ${color}30`, borderRadius: 12, overflow: "hidden", marginBottom: 16 }}>
      <div onClick={() => setOpen(o => !o)} style={{
        padding: "11px 18px", background: color + "08", borderBottom: open ? `1px solid ${color}20` : "none",
        display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 28, height: 28, borderRadius: 7, background: color + "20",
            display: "flex", alignItems: "center", justifyContent: "center" }}>
            <i className={`pi ${icon}`} style={{ fontSize: 13, color }} />
          </span>
          <span style={{ fontWeight: 700, fontSize: 13, color: C.text }}>{title}</span>
          {badge && (
            <span style={{ background: color + "18", color, border: `1px solid ${color}30`,
              fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 4 }}>{badge}</span>
          )}
        </div>
        <i className={`pi ${open ? "pi-chevron-up" : "pi-chevron-down"}`} style={{ fontSize: 11, color: C.muted }} />
      </div>
      {open && <div style={{ padding: "18px 20px" }}>{children}</div>}
    </div>
  );
}

function Grid2({ children }) {
  return <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>{children}</div>;
}

function Field({ label, required, children }) {
  return (
    <div>
      <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: C.muted,
        textTransform: "uppercase", letterSpacing: ".6px", marginBottom: 5 }}>
        {label}{required && <span style={{ color: C.red, marginLeft: 3 }}>*</span>}
      </label>
      {children}
    </div>
  );
}

function VitalBox({ label, value, unit, onChange, critical }) {
  return (
    <div style={{ background: critical ? C.redL : C.bg, border: `1.5px solid ${critical ? C.red : C.border}`,
      borderRadius: 9, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 5 }}>
      <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".7px",
        color: critical ? C.red : C.muted }}>{label}</div>
      <input value={value} onChange={e => onChange(e.target.value)}
        className="his-field" style={{ textAlign: "center", fontFamily: "'DM Mono', monospace",
          fontSize: 16, fontWeight: 700, padding: "4px 8px", borderColor: critical ? C.red : C.border }} />
      {unit && <div style={{ fontSize: 9, color: C.muted, textAlign: "center" }}>{unit}</div>}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════ */
export function EmergencyAssessmentPageContent({ selectedPatient }) {
  const { uhid: uhidParam } = useParams();
  const navigate  = useNavigate();
  const { user }  = useAuth();

  const [uhid, setUhid]           = useState(uhidParam || "");
  const [patient, setPatient]     = useState(null);
  const [loadingPt, setLoadingPt] = useState(false);
  const [saving, setSaving]       = useState(false);
  const [noteId, setNoteId]       = useState(null);

  /* ── Triage ── */
  const [triageLevel, setTriageLevel] = useState("");
  const [triageTime, setTriageTime]   = useState(new Date().toTimeString().slice(0, 5));
  const [arrivalMode, setArrivalMode] = useState("Walk-in");
  const [isMLC, setIsMLC]             = useState(false);
  const [mlcNumber, setMlcNumber]     = useState("");
  const [chiefComplaint, setChiefComplaint] = useState("");
  const [complaintDuration, setComplaintDuration] = useState("");

  /* ── Vitals ── */
  const [vitals, setVitals] = useState({
    bpSys: "", bpDia: "", pulse: "", rr: "", spo2: "",
    temp: "", gcs: "", painScore: "", weight: "",
  });

  /* ── ABCDE ── */
  const [abcde, setAbcde] = useState({
    A: { patent: true, intervention: "", notes: "" },
    B: { rate: "", effort: "Normal", sounds: "", notes: "" },
    C: { rhythm: "Regular", perfusion: "Warm", notes: "" },
    D: { gcs: "", pupils: "Equal & Reactive", posture: "Normal", notes: "" },
    E: { temp: "Normothermic", skin: "Normal", rash: false, trauma: false, notes: "" },
  });

  /* ── PMH / Allergy ── */
  const [pmh, setPmh]         = useState("");
  const [allergy, setAllergy] = useState("");

  /* ── Clinical Notes ── */
  const [exam, setExam]       = useState("");
  const [provDx, setProvDx]   = useState("");

  /* ── Orders — R7ay ──
     Replaced the legacy flat `orders` table with three richer modules:
       • meds      → PrescriptionPanel  (DrugAutocomplete + 7 fields/row)
       • infusions → InfusionPanel       (fluid + rate + duration)
       • Services & Orders → ServicesOrdersPanel (auto-creates DRAFT bill)
     The Services & Orders panel manages its own bill state internally —
     no need to plumb it through formData. */
  const [meds, setMeds]           = useState([]);
  const [infusions, setInfusions] = useState([]);

  /* ── Disposition ── */
  const [disposition, setDisposition] = useState("");
  const [dispNotes, setDispNotes]     = useState("");

  /* ── General Examination ── */
  const [consciousness,    setConsciousness]    = useState("");
  const [nutritionalStatus,setNutritionalStatus]= useState("");
  const [physicalSigns,    setPhysicalSigns]    = useState({
    pallor: "", icterus: "", cyanosis: "", clubbing: "", lymphadenopathy: "", pedalEdema: "",
  });
  const [painScoreVAS, setPainScoreVAS] = useState(0);

  /* ── Systemic Examination ── */
  const [rs,      setRs]      = useState({ breathSounds: "", addedSounds: "", percussionNote: "", tracheaPosition: "" });
  const [cvs,     setCvs]     = useState({ heartRhythm: "", heartSounds: "", murmur: "", jvp: "" });
  const [abdomen, setAbdomen] = useState({ tenderness: "", organomegaly: [], bowelSounds: "", ascites: "" });
  const [cns,     setCns]     = useState({ motorSystem: "", motorSide: "", tone: "", reflexes: "", speech: "" });

  const setV = key => val => setVitals(v => ({ ...v, [key]: val }));
  const setA = (letter, key, val) => setAbcde(a => ({ ...a, [letter]: { ...a[letter], [key]: val } }));
  const sps  = (k, v) => setPhysicalSigns(p => ({ ...p, [k]: v }));
  const srs  = (k, v) => setRs(p => ({ ...p, [k]: v }));
  const scvs = (k, v) => setCvs(p => ({ ...p, [k]: v }));
  const sabd = (k, v) => setAbdomen(p => ({ ...p, [k]: v }));
  const scns = (k, v) => setCns(p => ({ ...p, [k]: v }));

  /* ── Auto-save draft — R7ay: orders→meds/infusions ── */
  const draftKey = uhid ? `sphere_draft_er_${uhid}` : null;
  const { savedAt, hasDraft, clearDraft } = useAutoSave(
    draftKey,
    { triageLevel, triageTime, arrivalMode, isMLC, mlcNumber, chiefComplaint, complaintDuration,
      vitals, abcde, pmh, allergy, exam, provDx, meds, infusions, disposition, dispNotes,
      consciousness, nutritionalStatus, physicalSigns, painScoreVAS, rs, cvs, abdomen, cns },
    2000
  );

  /* ── Digital signature ── */
  const { signature, showSetup, setShowSetup, saveSignature } = useDigitalSignature();

  useEffect(() => { if (uhidParam) loadPatient(uhidParam); }, [uhidParam]);

  // Auto-load when patient selected from AdmittedPatientPanel
  useEffect(() => {
    if (!selectedPatient) return;
    loadPatient(selectedPatient.UHID || "");
  }, [selectedPatient?._id]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadPatient = async (id) => {
    if (!id?.trim()) return;
    setLoadingPt(true); setPatient(null);
    try {
      const res = await axios.get(`${API_ENDPOINTS.PATIENTS}/uhid/${id.trim().toUpperCase()}`);
      const pt  = res.data?.data || res.data;
      if (!pt) { toast.error("Patient not found"); return; }
      setPatient(pt);
      const resolvedUhid = pt.UHID || id;
      setUhid(resolvedUhid);
      if (pt.allergies) setAllergy(pt.allergies);

      // Restore draft if one exists for this patient
      const dKey = `sphere_draft_er_${resolvedUhid}`;
      try {
        const raw = localStorage.getItem(dKey);
        if (raw) {
          // R7ay: orders → meds + infusions (legacy `orders` ignored on
          // restore since the data shape no longer matches the Step 3 UI;
          // services / labs / radiology now go through ServicesOrdersPanel
          // which loads its own DRAFT bill from the backend on mount).
          const { _meta, triageLevel: tl, triageTime: tt, arrivalMode: am, isMLC: ml, mlcNumber: mn,
            chiefComplaint: cc, complaintDuration: cd, vitals: vt, abcde: ab, pmh: ph, allergy: al,
            exam: ex, provDx: pd, meds: md, infusions: inf, disposition: dp, dispNotes: dn,
            consciousness: co, nutritionalStatus: ns, physicalSigns: ps, painScoreVAS: pv,
            rs: rss, cvs: cv, abdomen: abd, cns: cn } = JSON.parse(raw);
          if (tl) setTriageLevel(tl);
          if (tt) setTriageTime(tt);
          if (am) setArrivalMode(am);
          if (ml !== undefined) setIsMLC(ml);
          if (mn) setMlcNumber(mn);
          if (cc) setChiefComplaint(cc);
          if (cd) setComplaintDuration(cd);
          if (vt) setVitals(v => ({ ...v, ...vt }));
          if (ab) setAbcde(a => ({ ...a, ...ab }));
          if (ph) setPmh(ph);
          if (al) setAllergy(al);
          if (ex) setExam(ex);
          if (pd) setProvDx(pd);
          if (Array.isArray(md)) setMeds(md);
          if (Array.isArray(inf)) setInfusions(inf);
          if (dp) setDisposition(dp);
          if (dn) setDispNotes(dn);
          if (co) setConsciousness(co);
          if (ns) setNutritionalStatus(ns);
          if (ps) setPhysicalSigns(p => ({ ...p, ...ps }));
          if (pv !== undefined) setPainScoreVAS(pv);
          if (rss) setRs(r => ({ ...r, ...rss }));
          if (cv) setCvs(c => ({ ...c, ...cv }));
          if (abd) setAbdomen(a => ({ ...a, ...abd }));
          if (cn) setCns(c => ({ ...c, ...cn }));
          toast.info(`📝 Draft restored (${_meta?.savedAt ? new Date(_meta.savedAt).toLocaleTimeString() : "last session"})`, { autoClose: 3000 });
        }
      } catch (_) {}
    } catch { toast.error("Patient not found"); }
    finally { setLoadingPt(false); }
  };

  // R7ay — legacy addOrder/removeOrder/updateOrder removed. Step 3 now
  // delegates row management to the PrescriptionPanel / InfusionPanel /
  // ServicesOrdersPanel components below; each owns its own + Add / × Remove.

  const handleSave = async (sign = false) => {
    if (!patient) { toast.warn("Load a patient first"); return; }
    if (!triageLevel) { toast.warn("Select a triage level before saving"); return; }
    setSaving(true);
    try {
      const payload = {
        visitType: "Emergency",
        patientUHID: patient.UHID || uhid,
        patientId: patient._id,
        patientName: patient.fullName || "",
        doctorName: user?.fullName || `${user?.firstName || ""} ${user?.lastName || ""}`.trim(),
        doctorId: user?._id,
        status: sign ? "signed" : "draft",
        assessmentDate: new Date().toISOString(),
        formData: {
          triageLevel, triageTime, arrivalMode, isMLC, mlcNumber,
          chiefComplaint, complaintDuration,
          vitals, abcde, pmh, allergy, exam, provDx,
          generalExamination: { consciousness, nutritionalStatus, ...physicalSigns, painScoreVAS },
          systemicExamination: { rs, cvs, abdomen, cns },
          // R7ay — meds + infusions replace the legacy flat `orders` array.
          // Services / lab / radiology orders go through the in-Panel DRAFT
          // bill flow (ServicesOrdersPanel) so they don't ride this payload.
          medications: meds.filter(m => (m.name || "").trim()),
          infusions: infusions.filter(f => (f.name || "").trim()),
          disposition, dispNotes,
        },
      };
      let res;
      if (noteId) {
        res = await axios.put(`${API_ENDPOINTS.DOCTOR_NOTES}/${noteId}`, payload);
        if (sign) await axios.patch(`${API_ENDPOINTS.DOCTOR_NOTES}/${noteId}/sign`);
      } else {
        res = await axios.post(`${API_ENDPOINTS.DOCTOR_NOTES}`, payload);
        setNoteId(res.data?.data?._id || res.data?._id);
      }
      clearDraft(); // clear auto-saved draft on successful save
      toast.success(sign ? "Emergency assessment signed & submitted" : "Draft saved");
    } catch (err) {
      toast.error(err.response?.data?.message || "Save failed");
    } finally { setSaving(false); }
  };

  /* ── Selected triage meta ── */
  const tMeta = TRIAGE_LEVELS.find(t => t.key === triageLevel);

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={() => navigate(-1)} style={{ background: "none", border: `1px solid ${C.border}`,
            borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontSize: 12, color: C.muted,
            display: "flex", alignItems: "center", gap: 6 }}>
            <i className="pi pi-arrow-left" style={{ fontSize: 11 }} /> Back
          </button>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: C.text }}>Emergency Assessment</div>
              <span style={{ background: C.redL, color: C.red, border: `1px solid ${C.red}30`,
                padding: "2px 10px", borderRadius: 5, fontSize: 10, fontWeight: 800, letterSpacing: 1 }}>
                EMERGENCY
              </span>
            </div>
            <div style={{ fontSize: 11, color: C.muted }}>
              NABH-compliant · Triage → ABCDE → Orders ·{" "}
              {new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => handleSave(false)} disabled={saving}
            style={{ padding: "8px 18px", border: `1.5px solid ${C.border}`, borderRadius: 8,
              background: "white", cursor: saving ? "not-allowed" : "pointer",
              fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 600, color: C.muted }}>
            <i className="pi pi-save" style={{ marginRight: 6, fontSize: 12 }} />Save Draft
          </button>
          <button onClick={() => handleSave(true)} disabled={saving || !patient}
            style={{ padding: "8px 22px", border: "none", borderRadius: 8,
              background: saving ? "#fca5a5" : C.red, cursor: saving ? "not-allowed" : "pointer",
              fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 700, color: "white" }}>
            <i className="pi pi-check-circle" style={{ marginRight: 6, fontSize: 12 }} />
            {saving ? "Saving…" : "Sign & Submit"}
          </button>
        </div>
      </div>

      {/* ── Patient search ── */}
      <div style={{ background: C.card, border: `1.5px solid ${C.red}30`, borderRadius: 12,
        padding: "14px 20px", marginBottom: 16, display: "flex", alignItems: "center", gap: 12 }}>
        <i className="pi pi-search" style={{ color: C.red, fontSize: 16 }} />
        <input value={uhid} onChange={e => setUhid(e.target.value.toUpperCase())}
          onKeyDown={e => e.key === "Enter" && loadPatient(uhid)}
          placeholder="Type UHID and press Enter…"
          className="his-field" style={{ maxWidth: 260 }} />
        <button onClick={() => loadPatient(uhid)} disabled={loadingPt}
          style={{ padding: "8px 18px", border: "none", borderRadius: 8, background: C.red,
            color: "white", cursor: "pointer", fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 600 }}>
          {loadingPt ? <i className="pi pi-spin pi-spinner" /> : "Load Patient"}
        </button>
        {patient && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginLeft: 8 }}>
            <div style={{ width: 36, height: 36, borderRadius: "50%", background: C.redL,
              border: `2px solid ${C.red}40`, display: "flex", alignItems: "center", justifyContent: "center",
              fontWeight: 800, fontSize: 14, color: C.red }}>
              {(patient.fullName || patient.firstName || "?")[0]}
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>
                {patient.title ? patient.title + " " : ""}{patient.fullName || `${patient.firstName} ${patient.lastName}`}
              </div>
              <div style={{ fontSize: 11, color: C.muted }}>
                {patient.UHID} · {patient.age}y / {patient.gender?.[0] || "—"}
              </div>
            </div>
            {patient.bloodGroup && (
              <span style={{ background: C.redL, color: C.red, border: `1px solid ${C.red}30`,
                padding: "2px 8px", borderRadius: 5, fontSize: 11, fontWeight: 700 }}>{patient.bloodGroup}</span>
            )}
          </div>
        )}
      </div>

      {!patient && (
        <div style={{ textAlign: "center", padding: "60px 20px", color: C.muted }}>
          <i className="pi pi-exclamation-circle" style={{ fontSize: 40, display: "block", marginBottom: 12, color: "#fca5a5" }} />
          <div style={{ fontSize: 14, fontWeight: 600 }}>Load a patient to begin emergency assessment</div>
        </div>
      )}

      {patient && (<>

        {/* ══ STEP 1: TRIAGE ══ */}
        <Section title="Step 1 — Triage" icon="pi-exclamation-triangle" color={C.red} badge="NABH: within 5 min of arrival">
          {/* Triage level selector */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10, marginBottom: 18 }}>
            {TRIAGE_LEVELS.map(t => (
              <button key={t.key} onClick={() => setTriageLevel(t.key)}
                style={{
                  padding: "12px 10px", borderRadius: 10, cursor: "pointer",
                  border: triageLevel === t.key ? `2px solid ${t.color}` : `1.5px solid ${t.color}30`,
                  background: triageLevel === t.key ? t.bg : "white",
                  boxShadow: triageLevel === t.key ? `0 4px 14px ${t.color}25` : "none",
                  transform: triageLevel === t.key ? "translateY(-2px)" : "none",
                  transition: "all .15s", fontFamily: "'DM Sans', sans-serif", textAlign: "center",
                }}>
                <div style={{ fontSize: 22, fontWeight: 900, color: t.color, marginBottom: 4 }}>{t.key}</div>
                <div style={{ fontSize: 10, fontWeight: 700, color: t.color }}>{t.label.split("—")[1]?.trim()}</div>
                <div style={{ fontSize: 9, color: C.muted, marginTop: 3 }}>{t.subtitle.split("—")[1]?.trim()}</div>
              </button>
            ))}
          </div>

          {tMeta && (
            <div style={{ background: tMeta.bg, border: `1.5px solid ${tMeta.color}40`, borderRadius: 10,
              padding: "10px 16px", marginBottom: 16, display: "flex", alignItems: "center", gap: 10 }}>
              <i className={`pi ${tMeta.icon}`} style={{ fontSize: 18, color: tMeta.color }} />
              <div>
                <div style={{ fontWeight: 700, fontSize: 13, color: tMeta.color }}>{tMeta.label}</div>
                <div style={{ fontSize: 11, color: C.muted }}>{tMeta.subtitle}</div>
              </div>
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: 14, marginBottom: 14, alignItems: "end" }}>
            <Field label="Triage Time">
              <input type="time" value={triageTime} onChange={e => setTriageTime(e.target.value)} className="his-field" />
            </Field>
            <Field label="Arrival Mode">
              <select value={arrivalMode} onChange={e => setArrivalMode(e.target.value)} className="his-field">
                {["Walk-in", "Ambulance", "Referred", "Police", "Self", "Other"].map(m => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </Field>
            <Field label="Complaint Duration">
              <input value={complaintDuration} onChange={e => setComplaintDuration(e.target.value)}
                placeholder="e.g. 2 hours, since morning" className="his-field" />
            </Field>
            <div style={{ display: "flex", alignItems: "center", gap: 8, paddingBottom: 2 }}>
              <input type="checkbox" id="mlc" checked={isMLC} onChange={e => setIsMLC(e.target.checked)}
                style={{ accentColor: C.red, width: 16, height: 16 }} />
              <label htmlFor="mlc" style={{ fontWeight: 700, fontSize: 13, color: isMLC ? C.red : C.muted, cursor: "pointer" }}>MLC</label>
            </div>
          </div>

          {isMLC && (
            <Field label="MLC Number">
              <input value={mlcNumber} onChange={e => setMlcNumber(e.target.value)}
                placeholder="Medico-Legal Case number" className="his-field" style={{ maxWidth: 320 }} />
            </Field>
          )}

          <Field label="Chief Complaint / Presenting Complaint *">
            <textarea value={chiefComplaint} onChange={e => setChiefComplaint(e.target.value)}
              placeholder="Patient's presenting complaint in their own words — onset, character, severity…"
              className="his-textarea" style={{ marginTop: 8 }} />
          </Field>

          <Field label="Known Allergies">
            <input value={allergy} onChange={e => setAllergy(e.target.value)}
              placeholder="Drug / food allergies — None if none" className="his-field" style={{ marginTop: 8 }} />
          </Field>
        </Section>

        {/* ── Vitals (between triage and ABCDE) ── */}
        <Section title="Vitals on Arrival" icon="pi-heart" color={C.purple} badge="NABH Required">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 12 }}>
            <VitalBox label="BP Systolic" unit="mmHg" value={vitals.bpSys} onChange={setV("bpSys")}
              critical={parseInt(vitals.bpSys) < 90 || parseInt(vitals.bpSys) > 180} />
            <VitalBox label="BP Diastolic" unit="mmHg" value={vitals.bpDia} onChange={setV("bpDia")} />
            <VitalBox label="Pulse" unit="bpm" value={vitals.pulse} onChange={setV("pulse")}
              critical={parseInt(vitals.pulse) < 40 || parseInt(vitals.pulse) > 150} />
            <VitalBox label="RR" unit="/min" value={vitals.rr} onChange={setV("rr")}
              critical={parseInt(vitals.rr) > 30 || parseInt(vitals.rr) < 8} />
            <VitalBox label="SpO₂" unit="%" value={vitals.spo2} onChange={setV("spo2")}
              critical={parseInt(vitals.spo2) < 94} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
            <VitalBox label="Temperature" unit="°F" value={vitals.temp} onChange={setV("temp")} />
            <VitalBox label="GCS" unit="3–15" value={vitals.gcs} onChange={setV("gcs")}
              critical={parseInt(vitals.gcs) < 9} />
            <VitalBox label="Pain Score" unit="0–10" value={vitals.painScore} onChange={setV("painScore")}
              critical={parseInt(vitals.painScore) >= 8} />
            <VitalBox label="Weight" unit="kg" value={vitals.weight} onChange={setV("weight")} />
          </div>
        </Section>

        {/* ══ STEP 2: ABCDE ══ */}
        <Section title="Step 2 — ABCDE Primary Survey" icon="pi-list-check" color={C.accent} badge="Systematic Assessment">
          {ABCDE_ITEMS.map(item => (
            <div key={item.key} style={{
              border: `1.5px solid ${item.color}30`, borderRadius: 10,
              marginBottom: 12, overflow: "hidden",
            }}>
              <div style={{ padding: "10px 16px", background: item.color + "08",
                display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ width: 32, height: 32, borderRadius: "50%", background: item.color + "20",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontWeight: 900, fontSize: 16, color: item.color }}>{item.key}</span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13, color: C.text }}>{item.full}</div>
                </div>
              </div>
              <div style={{ padding: "14px 16px" }}>
                {item.key === "A" && (
                  <div style={{ display: "grid", gridTemplateColumns: "auto 1fr 1fr", gap: 14, alignItems: "start" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
                      paddingTop: 24, fontWeight: 700, fontSize: 13, color: abcde.A.patent ? C.green : C.red }}>
                      <input type="checkbox" checked={abcde.A.patent}
                        onChange={e => setA("A", "patent", e.target.checked)}
                        style={{ accentColor: C.green, width: 16, height: 16 }} />
                      Airway Patent
                    </label>
                    <Field label="Intervention">
                      <input value={abcde.A.intervention} onChange={e => setA("A", "intervention", e.target.value)}
                        placeholder="None / O₂ mask / NPA / OPA / Intubated…" className="his-field" />
                    </Field>
                    <Field label="Notes">
                      <input value={abcde.A.notes} onChange={e => setA("A", "notes", e.target.value)}
                        placeholder="Stridor, secretions, swelling…" className="his-field" />
                    </Field>
                  </div>
                )}
                {item.key === "B" && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 14 }}>
                    <Field label="Rate (/min)">
                      <input value={abcde.B.rate} onChange={e => setA("B", "rate", e.target.value)}
                        placeholder="—" className="his-field" />
                    </Field>
                    <Field label="Effort">
                      <select value={abcde.B.effort} onChange={e => setA("B", "effort", e.target.value)} className="his-field">
                        {["Normal", "Mild distress", "Moderate distress", "Severe distress", "Not breathing"].map(o => <option key={o}>{o}</option>)}
                      </select>
                    </Field>
                    <Field label="Breath Sounds">
                      <input value={abcde.B.sounds} onChange={e => setA("B", "sounds", e.target.value)}
                        placeholder="Clear / wheeze / creps…" className="his-field" />
                    </Field>
                    <Field label="Notes">
                      <input value={abcde.B.notes} onChange={e => setA("B", "notes", e.target.value)}
                        placeholder="O₂ therapy, SpO₂…" className="his-field" />
                    </Field>
                  </div>
                )}
                {item.key === "C" && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
                    <Field label="Rhythm">
                      <select value={abcde.C.rhythm} onChange={e => setA("C", "rhythm", e.target.value)} className="his-field">
                        {["Regular", "Irregular", "Tachycardic", "Bradycardic", "No pulse — CPR"].map(o => <option key={o}>{o}</option>)}
                      </select>
                    </Field>
                    <Field label="Peripheral Perfusion">
                      <select value={abcde.C.perfusion} onChange={e => setA("C", "perfusion", e.target.value)} className="his-field">
                        {["Warm", "Cold peripheries", "Capillary refill >2s", "Mottled", "Shocked"].map(o => <option key={o}>{o}</option>)}
                      </select>
                    </Field>
                    <Field label="Notes">
                      <input value={abcde.C.notes} onChange={e => setA("C", "notes", e.target.value)}
                        placeholder="IV access, bleeding, fluid…" className="his-field" />
                    </Field>
                  </div>
                )}
                {item.key === "D" && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 14 }}>
                    <Field label="GCS">
                      <input value={abcde.D.gcs} onChange={e => setA("D", "gcs", e.target.value)}
                        placeholder="E_V_M_  /15" className="his-field" />
                    </Field>
                    <Field label="Pupils">
                      <select value={abcde.D.pupils} onChange={e => setA("D", "pupils", e.target.value)} className="his-field">
                        {["Equal & Reactive", "Unequal", "Fixed & Dilated", "Pinpoint", "Sluggish"].map(o => <option key={o}>{o}</option>)}
                      </select>
                    </Field>
                    <Field label="Posture / Power">
                      <select value={abcde.D.posture} onChange={e => setA("D", "posture", e.target.value)} className="his-field">
                        {["Normal", "Flaccid", "Decorticate", "Decerebrate", "Focal deficit"].map(o => <option key={o}>{o}</option>)}
                      </select>
                    </Field>
                    <Field label="Notes">
                      <input value={abcde.D.notes} onChange={e => setA("D", "notes", e.target.value)}
                        placeholder="BGL, seizure, history…" className="his-field" />
                    </Field>
                  </div>
                )}
                {item.key === "E" && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto auto 1fr", gap: 14, alignItems: "start" }}>
                    <Field label="Thermal Status">
                      <select value={abcde.E.temp} onChange={e => setA("E", "temp", e.target.value)} className="his-field">
                        {["Normothermic", "Febrile", "Hypothermic", "Hyperpyrexia"].map(o => <option key={o}>{o}</option>)}
                      </select>
                    </Field>
                    <Field label="Skin">
                      <select value={abcde.E.skin} onChange={e => setA("E", "skin", e.target.value)} className="his-field">
                        {["Normal", "Pale", "Jaundiced", "Cyanotic", "Diaphoretic", "Dry"].map(o => <option key={o}>{o}</option>)}
                      </select>
                    </Field>
                    <label style={{ display: "flex", alignItems: "center", gap: 7, paddingTop: 22, cursor: "pointer",
                      fontWeight: 700, fontSize: 13, color: abcde.E.rash ? C.amber : C.muted }}>
                      <input type="checkbox" checked={abcde.E.rash}
                        onChange={e => setA("E", "rash", e.target.checked)}
                        style={{ accentColor: C.amber, width: 16, height: 16 }} /> Rash
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 7, paddingTop: 22, cursor: "pointer",
                      fontWeight: 700, fontSize: 13, color: abcde.E.trauma ? C.red : C.muted }}>
                      <input type="checkbox" checked={abcde.E.trauma}
                        onChange={e => setA("E", "trauma", e.target.checked)}
                        style={{ accentColor: C.red, width: 16, height: 16 }} /> Trauma
                    </label>
                    <Field label="Notes">
                      <input value={abcde.E.notes} onChange={e => setA("E", "notes", e.target.value)}
                        placeholder="Injuries, burns, exposures…" className="his-field" />
                    </Field>
                  </div>
                )}
              </div>
            </div>
          ))}
        </Section>

        {/* ── General Examination ── */}
        <Section title="General Examination" icon="pi-search" color={C.teal} badge="NABH Required">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
            <Field label="Level of Consciousness">
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px" }}>
                {["Alert & Oriented","Confused","Drowsy","Stuporous","Comatose"].map(opt => (
                  <label key={opt} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, cursor: "pointer" }}>
                    <input type="radio" name="er_consciousness" checked={consciousness === opt}
                      onChange={() => setConsciousness(opt)} style={{ accentColor: C.accent }} />
                    {opt}
                  </label>
                ))}
              </div>
            </Field>
            <Field label="Nutritional Status">
              <div style={{ display: "flex", gap: 16 }}>
                {["Well-Nourished","Malnourished","Cachectic"].map(opt => (
                  <label key={opt} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, cursor: "pointer" }}>
                    <input type="radio" name="er_nutritionalStatus" checked={nutritionalStatus === opt}
                      onChange={() => setNutritionalStatus(opt)} style={{ accentColor: C.accent }} />
                    {opt}
                  </label>
                ))}
              </div>
            </Field>
          </div>

          {/* Physical Signs ICCPLE */}
          <div style={{ background: "#f8fafc", border: `1px solid ${C.border}`, borderRadius: 9, padding: "12px 16px", marginBottom: 16 }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".7px", color: C.muted, marginBottom: 10 }}>Physical Signs (ICCPLE)</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 10 }}>
              {[
                { key: "pallor",          label: "Pallor" },
                { key: "icterus",         label: "Icterus" },
                { key: "cyanosis",        label: "Cyanosis" },
                { key: "clubbing",        label: "Clubbing" },
                { key: "lymphadenopathy", label: "Lymphadenopathy" },
                { key: "pedalEdema",      label: "Pedal Edema" },
              ].map(({ key, label }) => (
                <div key={key} style={{ background: "white", border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 10px" }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, marginBottom: 6 }}>{label}</div>
                  <div style={{ display: "flex", gap: 10 }}>
                    {["Present","Absent"].map(opt => (
                      <label key={opt} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, cursor: "pointer" }}>
                        <input type="radio" name={`er_${key}`} checked={physicalSigns[key] === opt}
                          onChange={() => sps(key, opt)}
                          style={{ accentColor: opt === "Present" ? C.red : C.green }} />
                        <span style={{
                          color: opt === "Present" && physicalSigns[key] === "Present" ? C.red
                               : opt === "Absent"  && physicalSigns[key] === "Absent"  ? C.green : C.text,
                          fontWeight: physicalSigns[key] === opt ? 700 : 400,
                        }}>{opt}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Pain Score VAS */}
          <Field label={`Pain Score (VAS) — ${painScoreVAS}/10 · ${["No Pain","","Mild","","Moderate","","Moderately Severe","","Severe","","Worst Possible"][painScoreVAS] || ""}`}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 11, color: C.green, fontWeight: 700 }}>0</span>
              <input type="range" min={0} max={10} step={1} value={painScoreVAS}
                onChange={e => setPainScoreVAS(Number(e.target.value))}
                style={{ flex: 1, accentColor: painScoreVAS >= 7 ? C.red : painScoreVAS >= 4 ? C.amber : C.green }} />
              <span style={{ fontSize: 11, color: C.red, fontWeight: 700 }}>10</span>
              <span style={{
                minWidth: 28, textAlign: "center", padding: "4px 10px", borderRadius: 6, fontWeight: 800, fontSize: 15,
                background: painScoreVAS >= 7 ? C.redL : painScoreVAS >= 4 ? C.amberL : "#dcfce7",
                color: painScoreVAS >= 7 ? C.red : painScoreVAS >= 4 ? C.amber : C.green,
              }}>{painScoreVAS}</span>
            </div>
          </Field>
        </Section>

        {/* ── Systemic Examination ── */}
        <Section title="Systemic Examination" icon="pi-list-check" color={C.purple}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            {/* RS */}
            <div style={{ background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 10, padding: "12px 14px" }}>
              <div style={{ fontWeight: 700, fontSize: 12, color: "#0369a1", marginBottom: 10 }}>🫁 Respiratory System (RS)</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <Field label="Breath Sounds">
                  <select className="his-field" value={rs.breathSounds} onChange={e => srs("breathSounds", e.target.value)}>
                    <option value="">Select…</option>
                    {["Clear","Vesicular","Bronchial","Diminished","Absent"].map(o => <option key={o}>{o}</option>)}
                  </select>
                </Field>
                <Field label="Added Sounds">
                  <select className="his-field" value={rs.addedSounds} onChange={e => srs("addedSounds", e.target.value)}>
                    <option value="">None</option>
                    {["Crepitations","Rhonchi","Wheeze","Pleural Rub","Stridor"].map(o => <option key={o}>{o}</option>)}
                  </select>
                </Field>
                <Field label="Percussion Note">
                  <select className="his-field" value={rs.percussionNote} onChange={e => srs("percussionNote", e.target.value)}>
                    <option value="">Select…</option>
                    {["Resonant","Dull","Stony Dull","Hyper-resonant","Tympanic"].map(o => <option key={o}>{o}</option>)}
                  </select>
                </Field>
                <Field label="Trachea Position">
                  <select className="his-field" value={rs.tracheaPosition} onChange={e => srs("tracheaPosition", e.target.value)}>
                    <option value="">Select…</option>
                    {["Central","Shifted to Right","Shifted to Left"].map(o => <option key={o}>{o}</option>)}
                  </select>
                </Field>
              </div>
            </div>

            {/* CVS */}
            <div style={{ background: C.redL, border: "1px solid #fecaca", borderRadius: 10, padding: "12px 14px" }}>
              <div style={{ fontWeight: 700, fontSize: 12, color: C.red, marginBottom: 10 }}>❤️ Cardiovascular System (CVS)</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <Field label="Heart Rhythm">
                  <select className="his-field" value={cvs.heartRhythm} onChange={e => scvs("heartRhythm", e.target.value)}>
                    <option value="">Select…</option>
                    {["Regular","Irregularly Irregular","Regularly Irregular"].map(o => <option key={o}>{o}</option>)}
                  </select>
                </Field>
                <Field label="Heart Sounds">
                  <select className="his-field" value={cvs.heartSounds} onChange={e => scvs("heartSounds", e.target.value)}>
                    <option value="">Select…</option>
                    {["S1 S2 Normal","S1 S2 + S3","S1 S2 + S4","Muffled","Prosthetic Valve"].map(o => <option key={o}>{o}</option>)}
                  </select>
                </Field>
                <Field label="Murmur">
                  <input className="his-field" value={cvs.murmur} onChange={e => scvs("murmur", e.target.value)} placeholder="Timing, grade, location…" />
                </Field>
                <Field label="JVP">
                  <select className="his-field" value={cvs.jvp} onChange={e => scvs("jvp", e.target.value)}>
                    <option value="">Select…</option>
                    {["Normal","Raised","Not Visible"].map(o => <option key={o}>{o}</option>)}
                  </select>
                </Field>
              </div>
            </div>

            {/* Abdomen */}
            <div style={{ background: C.amberL, border: "1px solid #fde68a", borderRadius: 10, padding: "12px 14px" }}>
              <div style={{ fontWeight: 700, fontSize: 12, color: C.amber, marginBottom: 10 }}>🫃 Abdomen</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <Field label="Tenderness">
                  <input className="his-field" value={abdomen.tenderness} onChange={e => sabd("tenderness", e.target.value)} placeholder="Location of tenderness…" />
                </Field>
                <Field label="Organomegaly">
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px" }}>
                    {["Hepatomegaly","Splenomegaly","Renal Mass","None"].map(o => (
                      <label key={o} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, cursor: "pointer" }}>
                        <input type="checkbox"
                          checked={(abdomen.organomegaly || []).includes(o)}
                          onChange={e => {
                            const arr = e.target.checked
                              ? [...(abdomen.organomegaly || []), o]
                              : (abdomen.organomegaly || []).filter(x => x !== o);
                            sabd("organomegaly", arr);
                          }} style={{ accentColor: C.amber }} />
                        {o}
                      </label>
                    ))}
                  </div>
                </Field>
                <Field label="Bowel Sounds">
                  <select className="his-field" value={abdomen.bowelSounds} onChange={e => sabd("bowelSounds", e.target.value)}>
                    <option value="">Select…</option>
                    {["Normal","Increased","Decreased","Absent"].map(o => <option key={o}>{o}</option>)}
                  </select>
                </Field>
                <Field label="Ascites">
                  <select className="his-field" value={abdomen.ascites} onChange={e => sabd("ascites", e.target.value)}>
                    <option value="">Select…</option>
                    {["Absent","Mild","Moderate","Gross"].map(o => <option key={o}>{o}</option>)}
                  </select>
                </Field>
              </div>
            </div>

            {/* CNS */}
            <div style={{ background: C.purpleL, border: "1px solid #ddd6fe", borderRadius: 10, padding: "12px 14px" }}>
              <div style={{ fontWeight: 700, fontSize: 12, color: C.purple, marginBottom: 10 }}>🧠 CNS / Neuro</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <Field label="Motor System">
                  <select className="his-field" value={cns.motorSystem} onChange={e => scns("motorSystem", e.target.value)}>
                    <option value="">Select…</option>
                    {["Normal","Hemiparesis","Hemiplegia","Paraparesis","Paraplegia","Quadriparesis","Quadriplegia","Focal Deficit"].map(o => <option key={o}>{o}</option>)}
                  </select>
                </Field>
                {cns.motorSystem && cns.motorSystem !== "Normal" && (
                  <Field label="Affected Side">
                    <select className="his-field" value={cns.motorSide} onChange={e => scns("motorSide", e.target.value)}>
                      <option value="">Select…</option>
                      {["Right","Left","Bilateral"].map(o => <option key={o}>{o}</option>)}
                    </select>
                  </Field>
                )}
                <Field label="Tone">
                  <select className="his-field" value={cns.tone} onChange={e => scns("tone", e.target.value)}>
                    <option value="">Select…</option>
                    {["Normal","Hypertonia","Hypotonia","Flaccid"].map(o => <option key={o}>{o}</option>)}
                  </select>
                </Field>
                <Field label="Reflexes (DTR/Plantar)">
                  <input className="his-field" value={cns.reflexes} onChange={e => scns("reflexes", e.target.value)} placeholder="e.g. DTR+2, Plantar flexor…" />
                </Field>
                <Field label="Speech">
                  <select className="his-field" value={cns.speech} onChange={e => scns("speech", e.target.value)}>
                    <option value="">Select…</option>
                    {["Normal","Slurred","Aphasia","Dysarthria","Non-verbal"].map(o => <option key={o}>{o}</option>)}
                  </select>
                </Field>
              </div>
            </div>
          </div>
        </Section>

        {/* ── Secondary Survey ── */}
        <Section title="Secondary Survey & Provisional Diagnosis" icon="pi-tag" color={C.amber}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Grid2>
              <Field label="Past Medical History">
                <textarea value={pmh} onChange={e => setPmh(e.target.value)}
                  placeholder="Diabetes, HTN, cardiac conditions, previous surgeries…"
                  className="his-textarea" style={{ minHeight: 72 }} />
              </Field>
              <Field label="General Examination Notes">
                <textarea value={exam} onChange={e => setExam(e.target.value)}
                  placeholder="Conscious, oriented, systemic exam findings…"
                  className="his-textarea" style={{ minHeight: 72 }} />
              </Field>
            </Grid2>
            <Field label="Provisional / Working Diagnosis *">
              <textarea value={provDx} onChange={e => setProvDx(e.target.value)}
                placeholder="Clinical impression based on triage, vitals, and ABCDE findings…"
                className="his-textarea" style={{ minHeight: 64 }} />
            </Field>
          </div>
        </Section>

        {/* ══ STEP 3: ORDERS & PRESCRIPTIONS — R7ay ══
            Replaces the legacy single-table emergency-orders block with
            three richer modules mirroring the OPD doctor experience:
              1. Prescription      — DrugAutocomplete + dose/freq/meal/duration/route
              2. Infusions         — fluid datalist + rate/volume/duration/additives
              3. Services & Orders — ServiceMaster picker that spins a
                                     DRAFT ER bill, lab/imaging/consumable rows
                                     billed on completion. */}
        <Section title="Step 3 — Orders & Prescriptions" icon="pi-list" color={C.purple}
          badge={`${meds.length} med · ${infusions.length} inf`}>

          {/* ─── Prescription ─────────────────────────────────────── */}
          <div style={{ marginBottom: 22 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12,
              paddingBottom: 8, borderBottom: `1px solid ${C.border}` }}>
              <span style={{ width: 26, height: 26, borderRadius: 6, background: C.amberL,
                display: "flex", alignItems: "center", justifyContent: "center" }}>
                <i className="pi pi-pencil" style={{ fontSize: 12, color: C.amber }} />
              </span>
              <span style={{ fontWeight: 700, fontSize: 13, color: C.text }}>Prescription</span>
              <span style={{ background: C.amberL, color: C.amber, border: `1px solid ${C.amber}30`,
                fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 4 }}>
                {meds.length} medication{meds.length === 1 ? "" : "s"}
              </span>
            </div>
            <PrescriptionPanel
              value={meds}
              onChange={setMeds}
              theme={{ warn: C.amber, border: C.border, dark: C.text, muted: C.muted, bg: C.bg }}
            />
          </div>

          {/* ─── Infusions / IV Fluids ────────────────────────────── */}
          <div style={{ marginBottom: 22 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12,
              paddingBottom: 8, borderBottom: `1px solid ${C.border}` }}>
              <span style={{ width: 26, height: 26, borderRadius: 6, background: C.tealL,
                display: "flex", alignItems: "center", justifyContent: "center" }}>
                <i className="pi pi-tint" style={{ fontSize: 12, color: C.teal }} />
              </span>
              <span style={{ fontWeight: 700, fontSize: 13, color: C.text }}>Infusions / IV Fluids</span>
              <span style={{ background: C.tealL, color: C.teal, border: `1px solid ${C.teal}30`,
                fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 4 }}>
                {infusions.length} infusion{infusions.length === 1 ? "" : "s"}
              </span>
            </div>
            <InfusionPanel
              value={infusions}
              onChange={setInfusions}
              theme={{ border: C.border, dark: C.text, muted: C.muted, bg: C.bg, accent: C.teal }}
            />
          </div>

          {/* ─── Services & Orders → DRAFT ER bill ────────────────── */}
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12,
              paddingBottom: 8, borderBottom: `1px solid ${C.border}` }}>
              <span style={{ width: 26, height: 26, borderRadius: 6, background: C.accentL,
                display: "flex", alignItems: "center", justifyContent: "center" }}>
                <i className="pi pi-list" style={{ fontSize: 12, color: C.accent }} />
              </span>
              <span style={{ fontWeight: 700, fontSize: 13, color: C.text }}>
                Services & Orders — bills on completion
              </span>
            </div>
            <ServicesOrdersPanel
              uhid={patient?.UHID || uhid}
              visitType="ER"
              addedBy={user?.fullName || `${user?.firstName || ""} ${user?.lastName || ""}`.trim() || "ER Doctor"}
              theme={{ border: C.border, dark: C.text, muted: C.muted, bg: C.bg, accent: C.accent }}
            />
          </div>
        </Section>

        {/* ── Disposition ── */}
        <Section title="Disposition" icon="pi-directions" color={C.green}>
          <Grid2>
            <Field label="Disposition Decision">
              <select value={disposition} onChange={e => setDisposition(e.target.value)} className="his-field">
                <option value="">— Select —</option>
                {["Admit to IPD", "Admit to ICU", "Admit to HDU", "Transfer to higher centre",
                  "Discharge with advice", "LAMA", "Referred out", "Deceased"].map(d => (
                  <option key={d}>{d}</option>
                ))}
              </select>
            </Field>
            <Field label="Disposition Notes">
              <input value={dispNotes} onChange={e => setDispNotes(e.target.value)}
                placeholder="Ward, bed, special instructions…" className="his-field" />
            </Field>
          </Grid2>
        </Section>

        {/* ── Sign-off + Signature ── */}
        <div style={{ background: C.redL, border: `1px solid ${C.red}30`, borderRadius: 12,
          padding: "14px 20px", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.red }}>
                <i className="pi pi-verified" style={{ marginRight: 6 }} />Doctor's Digital Signature
              </div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                {user?.fullName || `${user?.firstName || ""} ${user?.lastName || ""}`.trim()} · {new Date().toLocaleString("en-IN")}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <AutoSaveIndicator savedAt={savedAt} hasDraft={hasDraft} />
              <button onClick={() => setShowSetup(true)}
                style={{ padding: "8px 14px", background: signature ? "#f0fdf4" : "#fffbeb", border: `1.5px solid ${signature ? "#bbf7d0" : "#fde68a"}`, borderRadius: 8, cursor: "pointer", fontSize: 11, fontWeight: 700, color: signature ? "#16a34a" : "#92400e", display: "flex", alignItems: "center", gap: 6 }}>
                {signature ? <><i className="pi pi-verified" /> Signature Set</> : <><i className="pi pi-pen-to-square" /> Setup Signature</>}
              </button>
              <button onClick={() => handleSave(false)} disabled={saving}
                style={{ padding: "9px 20px", border: `1.5px solid ${C.border}`, borderRadius: 8,
                  background: "white", cursor: saving ? "not-allowed" : "pointer",
                  fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 600, color: C.muted }}>
                Save Draft
              </button>
              <button onClick={() => handleSave(true)} disabled={saving}
                style={{ padding: "9px 22px", border: "none", borderRadius: 8, background: C.red,
                  cursor: saving ? "not-allowed" : "pointer",
                  fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 700, color: "white",
                  boxShadow: `0 4px 14px ${C.red}40` }}>
                <i className="pi pi-check-circle" style={{ marginRight: 6, fontSize: 12 }} />
                {saving ? "Submitting…" : "Sign & Submit"}
              </button>
            </div>
          </div>
          {/* Signature preview */}
          {signature && (
            <div style={{ marginTop: 14, borderTop: `1px solid ${C.red}20`, paddingTop: 10 }}>
              <SignatureStamp
                signature={signature}
                userName={user?.fullName || `${user?.firstName || ""} ${user?.lastName || ""}`.trim()}
                role="Doctor / Emergency Physician"
                regNo={user?.doctorDetails?.registrationNumber}
                timestamp={new Date()}
                onSetup={() => setShowSetup(true)}
              />
            </div>
          )}
        </div>

        {/* ── Digital Signature Setup Modal ── */}
        {showSetup && (
          <SignaturePad
            existing={signature}
            userName={user?.fullName || `${user?.firstName || ""} ${user?.lastName || ""}`.trim()}
            onSave={async (dataUrl) => {
              await saveSignature(dataUrl);
              setShowSetup(false);
              toast.success("Signature saved — auto-embedded in all documents");
            }}
            onCancel={() => setShowSetup(false)}
          />
        )}

      </>)}
    </div>
  );
}

export default function EmergencyAssessmentPage() {
  const [sel, setSel] = useState(null);
  return (
    <ClinicalLayout onPatientSelect={setSel} selectedId={sel?._id} pageType="emergency-assessment">
      <EmergencyAssessmentPageContent selectedPatient={sel} />
    </ClinicalLayout>
  );
}
