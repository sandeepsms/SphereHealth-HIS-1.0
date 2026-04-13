import React, { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import axios from "axios";
import { API_ENDPOINTS } from "../../config/api";
import { useAuth } from "../../context/AuthContext";
import { toast } from "react-toastify";

/* ── Design tokens ── */
const C = {
  bg: "#f0f2f5", card: "#fff", border: "#e2e6ea", text: "#1a1d23", muted: "#6b7280",
  accent: "#1e40af", accentL: "#eff6ff",
  green: "#16a34a", greenL: "#dcfce7",
  red: "#dc2626", redL: "#fef2f2",
  amber: "#d97706", amberL: "#fffbeb",
  teal: "#0d9488", tealL: "#f0fdfa",
  purple: "#7c3aed", purpleL: "#f5f3ff",
  slate: "#1e293b",
};

const fld = {
  padding: "8px 11px", border: `1.5px solid ${C.border}`, borderRadius: 8,
  fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: C.text,
  outline: "none", background: "white", width: "100%", boxSizing: "border-box",
};

const ta = { ...fld, resize: "vertical", minHeight: 72 };

/* ── Blank prescription row ── */
const blankRx = () => ({
  id: Date.now() + Math.random(),
  drug: "", dose: "", route: "Oral", frequency: "OD", duration: "", instructions: "",
});

/* ── Section card wrapper ── */
function SectionCard({ title, icon, color = C.accent, children, badge }) {
  const [open, setOpen] = useState(true);
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
      overflow: "hidden", marginBottom: 16,
    }}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          padding: "11px 18px", background: "#f8fafc", borderBottom: open ? `1px solid ${C.border}` : "none",
          display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 28, height: 28, borderRadius: 7, background: color + "18",
            display: "flex", alignItems: "center", justifyContent: "center" }}>
            <i className={`pi ${icon}`} style={{ fontSize: 13, color }} />
          </span>
          <span style={{ fontWeight: 700, fontSize: 13, color: C.text }}>{title}</span>
          {badge && (
            <span style={{ background: color + "18", color, border: `1px solid ${color}30`,
              fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 4 }}>{badge}</span>
          )}
        </div>
        <i className={`pi ${open ? "pi-chevron-up" : "pi-chevron-down"}`}
          style={{ fontSize: 11, color: C.muted }} />
      </div>
      {open && <div style={{ padding: "18px 20px" }}>{children}</div>}
    </div>
  );
}

/* ── Two-column grid ── */
function Grid2({ children }) {
  return <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>{children}</div>;
}

/* ── Four-column grid ── */
function Grid4({ children }) {
  return <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>{children}</div>;
}

/* ── Field label + input ── */
function Field({ label, children }) {
  return (
    <div>
      <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: C.muted,
        textTransform: "uppercase", letterSpacing: ".6px", marginBottom: 5 }}>
        {label}
      </label>
      {children}
    </div>
  );
}

/* ── Vital input ── */
function VitalInput({ label, value, unit, onChange, normal }) {
  return (
    <div style={{ background: C.bg, border: `1.5px solid ${C.border}`, borderRadius: 9,
      padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase",
        letterSpacing: ".7px", color: C.muted }}>{label}</div>
      <input value={value} onChange={e => onChange(e.target.value)}
        placeholder={normal || "—"}
        style={{ ...fld, textAlign: "center", fontFamily: "'DM Mono', monospace",
          fontSize: 16, fontWeight: 700, padding: "4px 8px" }} />
      {unit && <div style={{ fontSize: 9, color: C.muted, textAlign: "center" }}>{unit}</div>}
    </div>
  );
}

/* ── Checkbox toggle ── */
function CheckItem({ label, checked, onChange }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer",
      fontSize: 13, color: checked ? C.text : C.muted, fontWeight: checked ? 600 : 400 }}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}
        style={{ accentColor: C.accent, width: 14, height: 14 }} />
      {label}
    </label>
  );
}

const ROUTES = ["Oral", "IV", "IM", "SC", "SL", "Topical", "Inhaled", "PR", "Nasal", "Eye drops"];
const FREQS  = ["OD", "BD", "TDS", "QID", "SOS", "Stat", "HS", "Alternate days", "Weekly"];

/* ════════════════════════════════════════════════════════════════════ */
export default function OPDAssessmentPage() {
  const { uhid: uhidParam } = useParams();
  const navigate = useNavigate();
  const { user }  = useAuth();

  /* ── Patient state ── */
  const [uhid, setUhid]           = useState(uhidParam || "");
  const [patient, setPatient]     = useState(null);
  const [loadingPt, setLoadingPt] = useState(false);
  const [saving, setSaving]       = useState(false);

  /* ── Form state ── */
  const [cc, setCc]         = useState("");        // Chief Complaint
  const [hpi, setHpi]       = useState("");        // History of Present Illness
  const [pmh, setPmh]       = useState("");        // Past Medical History
  const [psh, setPsh]       = useState("");        // Past Surgical History
  const [famHx, setFamHx]   = useState("");        // Family History
  const [socHx, setSocHx]   = useState("");        // Social History
  const [allergy, setAllergy] = useState("");      // Known allergies

  /* ── Vitals ── */
  const [vitals, setVitals] = useState({
    bpSys: "", bpDia: "", pulse: "", temp: "", spo2: "",
    rr: "", weight: "", height: "", bmi: "",
  });

  /* ── General Examination ── */
  const [genExam, setGenExam] = useState({
    conscious: true, oriented: true, cooperative: true,
    pallor: false, icterus: false, cyanosis: false,
    clubbing: false, lymphNodes: false, edema: false,
    findings: "",
  });

  /* ── Systemic Examination ── */
  const [sysExam, setSysExam] = useState({ cvs: "", rs: "", abdomen: "", cns: "" });

  /* ── Diagnosis ── */
  const [provDx, setProvDx]   = useState("");
  const [finalDx, setFinalDx] = useState("");
  const [icd10, setIcd10]     = useState("");

  /* ── Investigations ── */
  const [investigations, setInvestigations] = useState("");

  /* ── Prescription rows ── */
  const [rxRows, setRxRows] = useState([blankRx()]);

  /* ── Follow-up ── */
  const [followupDate, setFollowupDate] = useState("");
  const [followupNotes, setFollowupNotes] = useState("");

  /* ── Existing note ID (for update) ── */
  const [noteId, setNoteId] = useState(null);

  /* ── Auto-load patient from URL param ── */
  useEffect(() => {
    if (uhidParam) loadPatient(uhidParam);
  }, [uhidParam]);

  /* ── Auto-calculate BMI ── */
  useEffect(() => {
    const h = parseFloat(vitals.height);
    const w = parseFloat(vitals.weight);
    if (h > 0 && w > 0) {
      const hm = h / 100;
      setVitals(v => ({ ...v, bmi: (w / (hm * hm)).toFixed(1) }));
    }
  }, [vitals.height, vitals.weight]);

  const setV = (key) => (val) => setVitals(v => ({ ...v, [key]: val }));
  const setGe = (key, val) => setGenExam(g => ({ ...g, [key]: val }));
  const setSe = (key) => (e) => setSysExam(s => ({ ...s, [key]: e.target.value }));

  /* ── Load patient ── */
  const loadPatient = async (id) => {
    if (!id?.trim()) return;
    setLoadingPt(true);
    setPatient(null);
    try {
      const res = await axios.get(`${API_ENDPOINTS.PATIENTS}/uhid/${id.trim().toUpperCase()}`);
      const pt = res.data?.data || res.data;
      if (!pt) { toast.error("Patient not found"); return; }
      setPatient(pt);
      setUhid(pt.UHID || id);
      // Pre-fill known allergies if stored
      if (pt.allergies) setAllergy(pt.allergies);
      // Load any existing OPD note for today
      loadExistingNote(pt.UHID || id);
    } catch {
      toast.error("Patient not found");
    } finally {
      setLoadingPt(false);
    }
  };

  const loadExistingNote = async (uid) => {
    try {
      const res = await axios.get(
        `${API_ENDPOINTS.BASE}/doctorNotes/patient/${uid}?type=OPD&limit=1`
      );
      const notes = res.data?.data || res.data || [];
      const today = new Date().toDateString();
      const todayNote = Array.isArray(notes)
        ? notes.find(n => new Date(n.createdAt).toDateString() === today)
        : null;
      if (todayNote) {
        setNoteId(todayNote._id);
        populateForm(todayNote);
        toast.info("Loaded today's existing note");
      }
    } catch { /* no existing note is fine */ }
  };

  const populateForm = (note) => {
    const d = note.formData || note;
    if (d.cc)      setCc(d.cc);
    if (d.hpi)     setHpi(d.hpi);
    if (d.pmh)     setPmh(d.pmh);
    if (d.psh)     setPsh(d.psh);
    if (d.famHx)   setFamHx(d.famHx);
    if (d.socHx)   setSocHx(d.socHx);
    if (d.allergy) setAllergy(d.allergy);
    if (d.vitals)  setVitals(v => ({ ...v, ...d.vitals }));
    if (d.genExam) setGenExam(g => ({ ...g, ...d.genExam }));
    if (d.sysExam) setSysExam(s => ({ ...s, ...d.sysExam }));
    if (d.provDx)  setProvDx(d.provDx);
    if (d.finalDx) setFinalDx(d.finalDx);
    if (d.icd10)   setIcd10(d.icd10);
    if (d.investigations) setInvestigations(d.investigations);
    if (d.rxRows?.length) setRxRows(d.rxRows.map(r => ({ ...r, id: r.id || Date.now() + Math.random() })));
    if (d.followupDate)  setFollowupDate(d.followupDate);
    if (d.followupNotes) setFollowupNotes(d.followupNotes);
  };

  /* ── Prescription helpers ── */
  const addRxRow = () => setRxRows(r => [...r, blankRx()]);
  const removeRxRow = (id) => setRxRows(r => r.filter(x => x.id !== id));
  const updateRx = (id, key, val) =>
    setRxRows(r => r.map(x => x.id === id ? { ...x, [key]: val } : x));

  /* ── Build payload ── */
  const buildPayload = (status = "draft") => ({
    visitType: "OPD",
    patientUHID: patient?.UHID || uhid,
    patientId: patient?._id,
    patientName: patient?.fullName || "",
    doctorName: user?.fullName || `${user?.firstName || ""} ${user?.lastName || ""}`.trim(),
    doctorId: user?._id,
    status,
    assessmentDate: new Date().toISOString(),
    formData: {
      cc, hpi, pmh, psh, famHx, socHx, allergy,
      vitals, genExam, sysExam,
      provDx, finalDx, icd10,
      investigations,
      rxRows: rxRows.filter(r => r.drug.trim()),
      followupDate, followupNotes,
    },
  });

  const handleSave = async (sign = false) => {
    if (!patient) { toast.warn("Load a patient first"); return; }
    setSaving(true);
    try {
      const payload = buildPayload(sign ? "signed" : "draft");
      let res;
      if (noteId) {
        res = await axios.put(`${API_ENDPOINTS.BASE}/doctorNotes/${noteId}`, payload);
        if (sign) await axios.patch(`${API_ENDPOINTS.BASE}/doctorNotes/${noteId}/sign`);
      } else {
        res = await axios.post(`${API_ENDPOINTS.BASE}/doctorNotes`, payload);
        setNoteId(res.data?.data?._id || res.data?._id);
      }
      toast.success(sign ? "Assessment signed & submitted" : "Draft saved");
    } catch (err) {
      toast.error(err.response?.data?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  /* ══════════════ RENDER ══════════════ */
  return (
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>

      {/* ── Page header ── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: 18,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={() => navigate(-1)}
            style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 8,
              padding: "6px 12px", cursor: "pointer", fontSize: 12, color: C.muted,
              display: "flex", alignItems: "center", gap: 6 }}>
            <i className="pi pi-arrow-left" style={{ fontSize: 11 }} /> Back
          </button>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: C.text }}>OPD Assessment</div>
            <div style={{ fontSize: 11, color: C.muted }}>
              NABH-compliant · {new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => handleSave(false)} disabled={saving}
            style={{ padding: "8px 18px", border: `1.5px solid ${C.border}`, borderRadius: 8,
              background: "white", cursor: saving ? "not-allowed" : "pointer",
              fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 600, color: C.muted }}>
            <i className="pi pi-save" style={{ marginRight: 6, fontSize: 12 }} />
            Save Draft
          </button>
          <button onClick={() => handleSave(true)} disabled={saving || !patient}
            style={{ padding: "8px 18px", border: "none", borderRadius: 8,
              background: saving ? "#93c5fd" : C.accent, cursor: saving ? "not-allowed" : "pointer",
              fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 700, color: "white" }}>
            <i className="pi pi-check-circle" style={{ marginRight: 6, fontSize: 12 }} />
            {saving ? "Saving…" : "Sign & Submit"}
          </button>
        </div>
      </div>

      {/* ── Patient search bar ── */}
      <div style={{
        background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
        padding: "14px 20px", marginBottom: 16,
        display: "flex", alignItems: "center", gap: 12,
      }}>
        <i className="pi pi-search" style={{ color: C.accent, fontSize: 16 }} />
        <input
          value={uhid}
          onChange={e => setUhid(e.target.value.toUpperCase())}
          onKeyDown={e => e.key === "Enter" && loadPatient(uhid)}
          placeholder="Type UHID and press Enter…"
          style={{ ...fld, maxWidth: 260 }}
        />
        <button onClick={() => loadPatient(uhid)} disabled={loadingPt}
          style={{ padding: "8px 18px", border: "none", borderRadius: 8,
            background: C.accent, color: "white", cursor: "pointer",
            fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 600 }}>
          {loadingPt ? <i className="pi pi-spin pi-spinner" /> : "Load Patient"}
        </button>
        {patient && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginLeft: 8 }}>
            <div style={{ width: 36, height: 36, borderRadius: "50%",
              background: C.accentL, border: `2px solid ${C.accent}30`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontWeight: 800, fontSize: 14, color: C.accent }}>
              {(patient.fullName || patient.firstName || "?")[0]}
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, color: C.text }}>
                {patient.title ? `${patient.title} ` : ""}{patient.fullName || `${patient.firstName} ${patient.lastName}`}
              </div>
              <div style={{ fontSize: 11, color: C.muted }}>
                {patient.UHID} &nbsp;·&nbsp; {patient.age}y / {patient.gender?.[0] || "—"} &nbsp;·&nbsp;
                <span style={{ fontWeight: 600, color: C.teal }}>OPD</span>
              </div>
            </div>
            {patient.bloodGroup && (
              <span style={{ background: C.redL, color: C.red, border: `1px solid ${C.red}30`,
                padding: "2px 8px", borderRadius: 5, fontSize: 11, fontWeight: 700 }}>
                {patient.bloodGroup}
              </span>
            )}
          </div>
        )}
      </div>

      {!patient && (
        <div style={{ textAlign: "center", padding: "60px 20px", color: C.muted }}>
          <i className="pi pi-user-plus" style={{ fontSize: 40, display: "block", marginBottom: 12, color: "#cbd5e1" }} />
          <div style={{ fontSize: 14, fontWeight: 600 }}>Load a patient to begin assessment</div>
          <div style={{ fontSize: 12, marginTop: 4 }}>Enter UHID above and press Enter</div>
        </div>
      )}

      {patient && (<>

        {/* ── 1. Chief Complaint & HPI ── */}
        <SectionCard title="Chief Complaint & History of Present Illness" icon="pi-comment" color={C.teal}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Field label="Chief Complaint *">
              <textarea value={cc} onChange={e => setCc(e.target.value)}
                placeholder="Patient's main complaint in their own words…"
                style={{ ...ta, minHeight: 64 }} />
            </Field>
            <Field label="History of Present Illness">
              <textarea value={hpi} onChange={e => setHpi(e.target.value)}
                placeholder="Onset, duration, progression, associated symptoms, relieving/aggravating factors…"
                style={{ ...ta, minHeight: 96 }} />
            </Field>
            <Field label="Known Allergies">
              <input value={allergy} onChange={e => setAllergy(e.target.value)}
                placeholder="Drug / food / environmental allergies — None if none"
                style={fld} />
            </Field>
          </div>
        </SectionCard>

        {/* ── 2. History ── */}
        <SectionCard title="Past & Family History" icon="pi-book" color={C.purple}>
          <Grid2>
            <Field label="Past Medical History">
              <textarea value={pmh} onChange={e => setPmh(e.target.value)}
                placeholder="Diabetes, Hypertension, Asthma, Thyroid, Heart disease…"
                style={ta} />
            </Field>
            <Field label="Past Surgical History">
              <textarea value={psh} onChange={e => setPsh(e.target.value)}
                placeholder="Previous operations, hospitalizations…"
                style={ta} />
            </Field>
            <Field label="Family History">
              <textarea value={famHx} onChange={e => setFamHx(e.target.value)}
                placeholder="Hereditary conditions in family…"
                style={ta} />
            </Field>
            <Field label="Social History">
              <textarea value={socHx} onChange={e => setSocHx(e.target.value)}
                placeholder="Smoking, alcohol, occupation, diet, marital status…"
                style={ta} />
            </Field>
          </Grid2>
        </SectionCard>

        {/* ── 3. Vitals ── */}
        <SectionCard title="Vitals" icon="pi-heart" color={C.red} badge="NABH Required">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 14 }}>
            <VitalInput label="BP Systolic" value={vitals.bpSys} unit="mmHg" normal="90–130" onChange={setV("bpSys")} />
            <VitalInput label="BP Diastolic" value={vitals.bpDia} unit="mmHg" normal="60–90" onChange={setV("bpDia")} />
            <VitalInput label="Pulse" value={vitals.pulse} unit="bpm" normal="60–100" onChange={setV("pulse")} />
            <VitalInput label="Temperature" value={vitals.temp} unit="°F" normal="97–99" onChange={setV("temp")} />
            <VitalInput label="SpO₂" value={vitals.spo2} unit="%" normal="≥95" onChange={setV("spo2")} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
            <VitalInput label="Resp Rate" value={vitals.rr} unit="/min" normal="14–20" onChange={setV("rr")} />
            <VitalInput label="Weight" value={vitals.weight} unit="kg" onChange={setV("weight")} />
            <VitalInput label="Height" value={vitals.height} unit="cm" onChange={setV("height")} />
            <div style={{ background: vitals.bmi ? C.accentL : C.bg, border: `1.5px solid ${vitals.bmi ? C.accent : C.border}`,
              borderRadius: 9, padding: "10px 12px", display: "flex", flexDirection: "column",
              gap: 6, alignItems: "center", justifyContent: "center" }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase",
                letterSpacing: ".7px", color: C.muted }}>BMI</div>
              <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 20, fontWeight: 800,
                color: vitals.bmi ? C.accent : C.muted }}>{vitals.bmi || "—"}</div>
              {vitals.bmi && (
                <div style={{ fontSize: 9, color: C.muted }}>
                  {parseFloat(vitals.bmi) < 18.5 ? "Underweight" : parseFloat(vitals.bmi) < 25 ? "Normal" :
                   parseFloat(vitals.bmi) < 30 ? "Overweight" : "Obese"}
                </div>
              )}
            </div>
          </div>
        </SectionCard>

        {/* ── 4. General Examination ── */}
        <SectionCard title="General Examination" icon="pi-user" color={C.amber}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "10px 24px" }}>
              {[
                { key: "conscious",   label: "Conscious" },
                { key: "oriented",    label: "Oriented" },
                { key: "cooperative", label: "Cooperative" },
                { key: "pallor",      label: "Pallor" },
                { key: "icterus",     label: "Icterus" },
                { key: "cyanosis",    label: "Cyanosis" },
                { key: "clubbing",    label: "Clubbing" },
                { key: "lymphNodes",  label: "Lymphadenopathy" },
                { key: "edema",       label: "Pedal Edema" },
              ].map(({ key, label }) => (
                <CheckItem key={key} label={label}
                  checked={genExam[key]} onChange={v => setGe(key, v)} />
              ))}
            </div>
            <Field label="General Findings / Notes">
              <textarea value={genExam.findings} onChange={e => setGe("findings", e.target.value)}
                placeholder="Built, nourishment, gait, decubitus, any other finding…"
                style={{ ...ta, minHeight: 64 }} />
            </Field>
          </div>
        </SectionCard>

        {/* ── 5. Systemic Examination ── */}
        <SectionCard title="Systemic Examination" icon="pi-heart-fill" color={C.red}>
          <Grid2>
            <Field label="Cardiovascular System (CVS)">
              <textarea value={sysExam.cvs} onChange={setSe("cvs")}
                placeholder="S1 S2 heard, murmurs, pulse, peripheral perfusion…"
                style={ta} />
            </Field>
            <Field label="Respiratory System (RS)">
              <textarea value={sysExam.rs} onChange={setSe("rs")}
                placeholder="Air entry, adventitious sounds, percussion…"
                style={ta} />
            </Field>
            <Field label="Abdomen">
              <textarea value={sysExam.abdomen} onChange={setSe("abdomen")}
                placeholder="Soft / distended, tenderness, organomegaly, bowel sounds…"
                style={ta} />
            </Field>
            <Field label="Central Nervous System (CNS)">
              <textarea value={sysExam.cns} onChange={setSe("cns")}
                placeholder="Higher functions, cranial nerves, motor, sensory, reflexes…"
                style={ta} />
            </Field>
          </Grid2>
        </SectionCard>

        {/* ── 6. Diagnosis ── */}
        <SectionCard title="Diagnosis" icon="pi-tag" color={C.accent} badge="NABH Required">
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Field label="Provisional Diagnosis *">
              <textarea value={provDx} onChange={e => setProvDx(e.target.value)}
                placeholder="Clinical impression based on history and examination…"
                style={{ ...ta, minHeight: 64 }} />
            </Field>
            <Grid2>
              <Field label="Final / Confirmed Diagnosis">
                <textarea value={finalDx} onChange={e => setFinalDx(e.target.value)}
                  placeholder="Confirmed diagnosis (if available)…"
                  style={{ ...ta, minHeight: 56 }} />
              </Field>
              <Field label="ICD-10 Code">
                <input value={icd10} onChange={e => setIcd10(e.target.value)}
                  placeholder="e.g. J06.9, K30, Z00.0…"
                  style={fld} />
              </Field>
            </Grid2>
          </div>
        </SectionCard>

        {/* ── 7. Investigations ── */}
        <SectionCard title="Investigations Ordered" icon="pi-list-check" color={C.purple}>
          <Field label="Tests / Investigations">
            <textarea value={investigations} onChange={e => setInvestigations(e.target.value)}
              placeholder="CBC, LFT, RFT, Blood Sugar, X-Ray Chest PA, ECG, USG Abdomen…"
              style={{ ...ta, minHeight: 80 }} />
          </Field>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 8 }}>
            <i className="pi pi-info-circle" style={{ marginRight: 4 }} />
            These will be forwarded to the respective lab/radiology department
          </div>
        </SectionCard>

        {/* ── 8. Prescription ── */}
        <SectionCard title="Prescription" icon="pi-file-edit" color={C.green} badge={`${rxRows.filter(r => r.drug).length} drug(s)`}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#f8fafc" }}>
                  {["#", "Drug / Medicine", "Dose", "Route", "Frequency", "Duration", "Instructions", ""].map(h => (
                    <th key={h} style={{ padding: "8px 10px", textAlign: "left", fontSize: 10,
                      fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".6px",
                      borderBottom: `1.5px solid ${C.border}`, whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rxRows.map((row, idx) => (
                  <tr key={row.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                    <td style={{ padding: "8px 10px", fontSize: 12, fontWeight: 700, color: C.muted }}>
                      {idx + 1}
                    </td>
                    <td style={{ padding: "6px 6px", minWidth: 180 }}>
                      <input value={row.drug} onChange={e => updateRx(row.id, "drug", e.target.value)}
                        placeholder="Drug name…"
                        style={{ ...fld, padding: "6px 8px" }} />
                    </td>
                    <td style={{ padding: "6px 6px", minWidth: 80 }}>
                      <input value={row.dose} onChange={e => updateRx(row.id, "dose", e.target.value)}
                        placeholder="e.g. 500mg"
                        style={{ ...fld, padding: "6px 8px" }} />
                    </td>
                    <td style={{ padding: "6px 6px", minWidth: 90 }}>
                      <select value={row.route} onChange={e => updateRx(row.id, "route", e.target.value)}
                        style={{ ...fld, padding: "6px 8px" }}>
                        {ROUTES.map(r => <option key={r}>{r}</option>)}
                      </select>
                    </td>
                    <td style={{ padding: "6px 6px", minWidth: 90 }}>
                      <select value={row.frequency} onChange={e => updateRx(row.id, "frequency", e.target.value)}
                        style={{ ...fld, padding: "6px 8px" }}>
                        {FREQS.map(f => <option key={f}>{f}</option>)}
                      </select>
                    </td>
                    <td style={{ padding: "6px 6px", minWidth: 90 }}>
                      <input value={row.duration} onChange={e => updateRx(row.id, "duration", e.target.value)}
                        placeholder="5 days"
                        style={{ ...fld, padding: "6px 8px" }} />
                    </td>
                    <td style={{ padding: "6px 6px", minWidth: 140 }}>
                      <input value={row.instructions} onChange={e => updateRx(row.id, "instructions", e.target.value)}
                        placeholder="After food, SOS…"
                        style={{ ...fld, padding: "6px 8px" }} />
                    </td>
                    <td style={{ padding: "6px 6px" }}>
                      <button onClick={() => removeRxRow(row.id)}
                        style={{ background: "none", border: "none", cursor: "pointer",
                          color: "#ef4444", padding: 4 }}>
                        <i className="pi pi-trash" style={{ fontSize: 13 }} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button onClick={addRxRow}
            style={{ marginTop: 12, padding: "7px 16px", border: `1.5px dashed ${C.green}60`,
              borderRadius: 8, background: C.greenL, cursor: "pointer",
              fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 600, color: C.green }}>
            <i className="pi pi-plus" style={{ marginRight: 6, fontSize: 11 }} />
            Add Medicine
          </button>
        </SectionCard>

        {/* ── 9. Follow-up ── */}
        <SectionCard title="Follow-up & Advice" icon="pi-calendar-clock" color={C.teal}>
          <Grid2>
            <Field label="Follow-up Date">
              <input type="date" value={followupDate} onChange={e => setFollowupDate(e.target.value)}
                style={fld} />
            </Field>
            <Field label="Follow-up Instructions / Advice">
              <textarea value={followupNotes} onChange={e => setFollowupNotes(e.target.value)}
                placeholder="Diet advice, activity restrictions, red flags, when to return immediately…"
                style={{ ...ta, minHeight: 64 }} />
            </Field>
          </Grid2>
        </SectionCard>

        {/* ── Doctor sign-off strip ── */}
        <div style={{
          background: C.accentL, border: `1px solid ${C.accent}30`,
          borderRadius: 12, padding: "14px 20px", marginBottom: 16,
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.accent }}>
              <i className="pi pi-verified" style={{ marginRight: 6 }} />
              Doctor&apos;s Digital Signature
            </div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
              {user?.fullName || `${user?.firstName || ""} ${user?.lastName || ""}`.trim()} &nbsp;·&nbsp;
              {new Date().toLocaleString("en-IN")}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => handleSave(false)} disabled={saving}
              style={{ padding: "9px 20px", border: `1.5px solid ${C.border}`, borderRadius: 8,
                background: "white", cursor: saving ? "not-allowed" : "pointer",
                fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 600, color: C.muted }}>
              Save Draft
            </button>
            <button onClick={() => handleSave(true)} disabled={saving}
              style={{ padding: "9px 22px", border: "none", borderRadius: 8,
                background: C.accent, cursor: saving ? "not-allowed" : "pointer",
                fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 700, color: "white",
                boxShadow: `0 4px 14px ${C.accent}40` }}>
              <i className="pi pi-check-circle" style={{ marginRight: 6, fontSize: 12 }} />
              {saving ? "Submitting…" : "Sign & Submit Assessment"}
            </button>
          </div>
        </div>

      </>)}
    </div>
  );
}
