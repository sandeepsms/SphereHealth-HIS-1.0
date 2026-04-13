import React, { useState, useEffect } from "react";
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
  orange: "#ea580c", orangeL: "#fff7ed",
  teal: "#0d9488", tealL: "#f0fdfa",
  purple: "#7c3aed", purpleL: "#f5f3ff",
  pink: "#db2777",
  slate: "#1e293b",
};

const fld = {
  padding: "8px 11px", border: `1.5px solid ${C.border}`, borderRadius: 8,
  fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: C.text,
  outline: "none", background: "white", width: "100%", boxSizing: "border-box",
};
const ta = { ...fld, resize: "vertical", minHeight: 80 };

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
        style={{ ...fld, textAlign: "center", fontFamily: "'DM Mono', monospace",
          fontSize: 16, fontWeight: 700, padding: "4px 8px", borderColor: critical ? C.red : C.border }} />
      {unit && <div style={{ fontSize: 9, color: C.muted, textAlign: "center" }}>{unit}</div>}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════ */
export default function EmergencyAssessmentPage() {
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

  /* ── Orders ── */
  const [orders, setOrders] = useState([blankRx()]);

  /* ── Disposition ── */
  const [disposition, setDisposition] = useState("");
  const [dispNotes, setDispNotes]     = useState("");

  const setV = key => val => setVitals(v => ({ ...v, [key]: val }));
  const setA = (letter, key, val) => setAbcde(a => ({ ...a, [letter]: { ...a[letter], [key]: val } }));

  useEffect(() => { if (uhidParam) loadPatient(uhidParam); }, [uhidParam]);

  const loadPatient = async (id) => {
    if (!id?.trim()) return;
    setLoadingPt(true); setPatient(null);
    try {
      const res = await axios.get(`${API_ENDPOINTS.PATIENTS}/uhid/${id.trim().toUpperCase()}`);
      const pt  = res.data?.data || res.data;
      if (!pt) { toast.error("Patient not found"); return; }
      setPatient(pt); setUhid(pt.UHID || id);
      if (pt.allergies) setAllergy(pt.allergies);
    } catch { toast.error("Patient not found"); }
    finally { setLoadingPt(false); }
  };

  const addOrder = () => setOrders(o => [...o, blankRx()]);
  const removeOrder = id => setOrders(o => o.filter(x => x.id !== id));
  const updateOrder = (id, key, val) => setOrders(o => o.map(x => x.id === id ? { ...x, [key]: val } : x));

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
          orders: orders.filter(o => o.detail.trim()),
          disposition, dispNotes,
        },
      };
      let res;
      if (noteId) {
        res = await axios.put(`${API_ENDPOINTS.BASE}/doctorNotes/${noteId}`, payload);
        if (sign) await axios.patch(`${API_ENDPOINTS.BASE}/doctorNotes/${noteId}/sign`);
      } else {
        res = await axios.post(`${API_ENDPOINTS.BASE}/doctorNotes`, payload);
        setNoteId(res.data?.data?._id || res.data?._id);
      }
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
          style={{ ...fld, maxWidth: 260 }} />
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
              <input type="time" value={triageTime} onChange={e => setTriageTime(e.target.value)} style={fld} />
            </Field>
            <Field label="Arrival Mode">
              <select value={arrivalMode} onChange={e => setArrivalMode(e.target.value)} style={fld}>
                {["Walk-in", "Ambulance", "Referred", "Police", "Self", "Other"].map(m => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </Field>
            <Field label="Complaint Duration">
              <input value={complaintDuration} onChange={e => setComplaintDuration(e.target.value)}
                placeholder="e.g. 2 hours, since morning" style={fld} />
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
                placeholder="Medico-Legal Case number" style={{ ...fld, maxWidth: 320 }} />
            </Field>
          )}

          <Field label="Chief Complaint / Presenting Complaint *">
            <textarea value={chiefComplaint} onChange={e => setChiefComplaint(e.target.value)}
              placeholder="Patient's presenting complaint in their own words — onset, character, severity…"
              style={{ ...ta, marginTop: 8 }} />
          </Field>

          <Field label="Known Allergies">
            <input value={allergy} onChange={e => setAllergy(e.target.value)}
              placeholder="Drug / food allergies — None if none" style={{ ...fld, marginTop: 8 }} />
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
                        placeholder="None / O₂ mask / NPA / OPA / Intubated…" style={fld} />
                    </Field>
                    <Field label="Notes">
                      <input value={abcde.A.notes} onChange={e => setA("A", "notes", e.target.value)}
                        placeholder="Stridor, secretions, swelling…" style={fld} />
                    </Field>
                  </div>
                )}
                {item.key === "B" && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 14 }}>
                    <Field label="Rate (/min)">
                      <input value={abcde.B.rate} onChange={e => setA("B", "rate", e.target.value)}
                        placeholder="—" style={fld} />
                    </Field>
                    <Field label="Effort">
                      <select value={abcde.B.effort} onChange={e => setA("B", "effort", e.target.value)} style={fld}>
                        {["Normal", "Mild distress", "Moderate distress", "Severe distress", "Not breathing"].map(o => <option key={o}>{o}</option>)}
                      </select>
                    </Field>
                    <Field label="Breath Sounds">
                      <input value={abcde.B.sounds} onChange={e => setA("B", "sounds", e.target.value)}
                        placeholder="Clear / wheeze / creps…" style={fld} />
                    </Field>
                    <Field label="Notes">
                      <input value={abcde.B.notes} onChange={e => setA("B", "notes", e.target.value)}
                        placeholder="O₂ therapy, SpO₂…" style={fld} />
                    </Field>
                  </div>
                )}
                {item.key === "C" && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
                    <Field label="Rhythm">
                      <select value={abcde.C.rhythm} onChange={e => setA("C", "rhythm", e.target.value)} style={fld}>
                        {["Regular", "Irregular", "Tachycardic", "Bradycardic", "No pulse — CPR"].map(o => <option key={o}>{o}</option>)}
                      </select>
                    </Field>
                    <Field label="Peripheral Perfusion">
                      <select value={abcde.C.perfusion} onChange={e => setA("C", "perfusion", e.target.value)} style={fld}>
                        {["Warm", "Cold peripheries", "Capillary refill >2s", "Mottled", "Shocked"].map(o => <option key={o}>{o}</option>)}
                      </select>
                    </Field>
                    <Field label="Notes">
                      <input value={abcde.C.notes} onChange={e => setA("C", "notes", e.target.value)}
                        placeholder="IV access, bleeding, fluid…" style={fld} />
                    </Field>
                  </div>
                )}
                {item.key === "D" && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 14 }}>
                    <Field label="GCS">
                      <input value={abcde.D.gcs} onChange={e => setA("D", "gcs", e.target.value)}
                        placeholder="E_V_M_  /15" style={fld} />
                    </Field>
                    <Field label="Pupils">
                      <select value={abcde.D.pupils} onChange={e => setA("D", "pupils", e.target.value)} style={fld}>
                        {["Equal & Reactive", "Unequal", "Fixed & Dilated", "Pinpoint", "Sluggish"].map(o => <option key={o}>{o}</option>)}
                      </select>
                    </Field>
                    <Field label="Posture / Power">
                      <select value={abcde.D.posture} onChange={e => setA("D", "posture", e.target.value)} style={fld}>
                        {["Normal", "Flaccid", "Decorticate", "Decerebrate", "Focal deficit"].map(o => <option key={o}>{o}</option>)}
                      </select>
                    </Field>
                    <Field label="Notes">
                      <input value={abcde.D.notes} onChange={e => setA("D", "notes", e.target.value)}
                        placeholder="BGL, seizure, history…" style={fld} />
                    </Field>
                  </div>
                )}
                {item.key === "E" && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto auto 1fr", gap: 14, alignItems: "start" }}>
                    <Field label="Thermal Status">
                      <select value={abcde.E.temp} onChange={e => setA("E", "temp", e.target.value)} style={fld}>
                        {["Normothermic", "Febrile", "Hypothermic", "Hyperpyrexia"].map(o => <option key={o}>{o}</option>)}
                      </select>
                    </Field>
                    <Field label="Skin">
                      <select value={abcde.E.skin} onChange={e => setA("E", "skin", e.target.value)} style={fld}>
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
                        placeholder="Injuries, burns, exposures…" style={fld} />
                    </Field>
                  </div>
                )}
              </div>
            </div>
          ))}
        </Section>

        {/* ── Secondary Survey ── */}
        <Section title="Secondary Survey & Provisional Diagnosis" icon="pi-tag" color={C.amber}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Grid2>
              <Field label="Past Medical History">
                <textarea value={pmh} onChange={e => setPmh(e.target.value)}
                  placeholder="Diabetes, HTN, cardiac conditions, previous surgeries…"
                  style={{ ...ta, minHeight: 72 }} />
              </Field>
              <Field label="General Examination Notes">
                <textarea value={exam} onChange={e => setExam(e.target.value)}
                  placeholder="Conscious, oriented, systemic exam findings…"
                  style={{ ...ta, minHeight: 72 }} />
              </Field>
            </Grid2>
            <Field label="Provisional / Working Diagnosis *">
              <textarea value={provDx} onChange={e => setProvDx(e.target.value)}
                placeholder="Clinical impression based on triage, vitals, and ABCDE findings…"
                style={{ ...ta, minHeight: 64 }} />
            </Field>
          </div>
        </Section>

        {/* ══ STEP 3: ORDERS ══ */}
        <Section title="Step 3 — Emergency Orders" icon="pi-list" color={C.purple}
          badge={`${orders.filter(o => o.detail).length} order(s)`}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#f8fafc" }}>
                  {["#", "Type", "Drug / Detail", "Dose / Rate", "Route", "Frequency", "Priority", ""].map(h => (
                    <th key={h} style={{ padding: "8px 10px", textAlign: "left", fontSize: 10, fontWeight: 700,
                      color: C.muted, textTransform: "uppercase", letterSpacing: ".6px",
                      borderBottom: `1.5px solid ${C.border}`, whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {orders.map((ord, idx) => (
                  <tr key={ord.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                    <td style={{ padding: "8px 10px", fontSize: 12, fontWeight: 700, color: C.muted }}>{idx + 1}</td>
                    <td style={{ padding: "6px 6px", minWidth: 110 }}>
                      <select value={ord.type} onChange={e => updateOrder(ord.id, "type", e.target.value)}
                        style={{ ...fld, padding: "6px 8px" }}>
                        {ORDER_TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1).replace("_", " ")}</option>)}
                      </select>
                    </td>
                    <td style={{ padding: "6px 6px", minWidth: 180 }}>
                      <input value={ord.detail} onChange={e => updateOrder(ord.id, "detail", e.target.value)}
                        placeholder="Drug / test / procedure name…" style={{ ...fld, padding: "6px 8px" }} />
                    </td>
                    <td style={{ padding: "6px 6px", minWidth: 100 }}>
                      <input value={ord.dose} onChange={e => updateOrder(ord.id, "dose", e.target.value)}
                        placeholder="500mg / 1L" style={{ ...fld, padding: "6px 8px" }} />
                    </td>
                    <td style={{ padding: "6px 6px", minWidth: 80 }}>
                      <select value={ord.route} onChange={e => updateOrder(ord.id, "route", e.target.value)}
                        style={{ ...fld, padding: "6px 8px" }}>
                        {ROUTES.map(r => <option key={r}>{r}</option>)}
                      </select>
                    </td>
                    <td style={{ padding: "6px 6px", minWidth: 90 }}>
                      <input value={ord.freq} onChange={e => updateOrder(ord.id, "freq", e.target.value)}
                        placeholder="STAT / 8hrly" style={{ ...fld, padding: "6px 8px" }} />
                    </td>
                    <td style={{ padding: "6px 6px", minWidth: 90 }}>
                      <select value={ord.priority} onChange={e => updateOrder(ord.id, "priority", e.target.value)}
                        style={{ ...fld, padding: "6px 8px",
                          color: ord.priority === "STAT" ? "#9f1239" : ord.priority === "URGENT" ? C.red : C.muted,
                          fontWeight: 700 }}>
                        {PRIORITIES.map(p => <option key={p}>{p}</option>)}
                      </select>
                    </td>
                    <td style={{ padding: "6px 6px" }}>
                      <button onClick={() => removeOrder(ord.id)}
                        style={{ background: "none", border: "none", cursor: "pointer", color: "#ef4444", padding: 4 }}>
                        <i className="pi pi-trash" style={{ fontSize: 13 }} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button onClick={addOrder}
            style={{ marginTop: 12, padding: "7px 16px", border: `1.5px dashed ${C.red}60`,
              borderRadius: 8, background: C.redL, cursor: "pointer",
              fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 600, color: C.red }}>
            <i className="pi pi-plus" style={{ marginRight: 6, fontSize: 11 }} /> Add Order
          </button>
        </Section>

        {/* ── Disposition ── */}
        <Section title="Disposition" icon="pi-directions" color={C.green}>
          <Grid2>
            <Field label="Disposition Decision">
              <select value={disposition} onChange={e => setDisposition(e.target.value)} style={fld}>
                <option value="">— Select —</option>
                {["Admit to IPD", "Admit to ICU", "Admit to HDU", "Transfer to higher centre",
                  "Discharge with advice", "LAMA", "Referred out", "Deceased"].map(d => (
                  <option key={d}>{d}</option>
                ))}
              </select>
            </Field>
            <Field label="Disposition Notes">
              <input value={dispNotes} onChange={e => setDispNotes(e.target.value)}
                placeholder="Ward, bed, special instructions…" style={fld} />
            </Field>
          </Grid2>
        </Section>

        {/* ── Sign-off ── */}
        <div style={{ background: C.redL, border: `1px solid ${C.red}30`, borderRadius: 12,
          padding: "14px 20px", marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.red }}>
              <i className="pi pi-verified" style={{ marginRight: 6 }} />Doctor's Digital Signature
            </div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
              {user?.fullName || `${user?.firstName || ""} ${user?.lastName || ""}`.trim()} · {new Date().toLocaleString("en-IN")}
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
              style={{ padding: "9px 22px", border: "none", borderRadius: 8, background: C.red,
                cursor: saving ? "not-allowed" : "pointer",
                fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 700, color: "white",
                boxShadow: `0 4px 14px ${C.red}40` }}>
              <i className="pi pi-check-circle" style={{ marginRight: 6, fontSize: 12 }} />
              {saving ? "Submitting…" : "Sign & Submit"}
            </button>
          </div>
        </div>

      </>)}
    </div>
  );
}
