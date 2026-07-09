/**
 * EmergencyList.jsx — Hospital-wide ER cases dashboard (/emergency)
 *
 * Generic ER list view for Doctors / Nurses / Admin — distinct from the
 * receptionist board at /reception-emergency. Shared visual language
 * (rx-* design system) keeps both pages consistent.
 *
 * Data is merged from two sources because reception's ER flow creates BOTH
 * an Emergency record AND an Admission(admissionType=Emergency). If the
 * Emergency record creation fails (validation), we still show the case via
 * the admission record so the ER board never silently loses a patient.
 *
 *   GET /api/emergency/active|today|mlc
 *   GET /api/admissions?admissionType=Emergency&status=Active|...
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { toast } from "react-toastify";
import { API_ENDPOINTS } from "../../config/api";
import { openPrint } from "../../Components/print/openPrint";   // R7hr(ER-P1.2)
import "../reception/reception-shared.css";

const TRIAGE_ORDER = ["Critical", "Emergency", "Urgent", "Semi-urgent", "Non-urgent"];
const TRIAGE_CLASS = {
  "Critical":     "critical",
  "Emergency":    "emergency",
  "Urgent":       "urgent",
  "Semi-urgent":  "semiurgent",
  "Non-urgent":   "nonurgent",
};
const TRIAGE_NORMALIZE = {
  "Red (P1)":    "Critical",
  "Yellow (P2)": "Emergency",
  "Green (P3)":  "Urgent",
  "Blue (P4)":   "Non-urgent",
};

const fmtTime = (d) => d ? new Date(d).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—";
const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "—";
const minutesAgo = (d) => {
  if (!d) return null;
  const m = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
  if (m < 0) return null;
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); return `${h}h ${m % 60}m ago`;
};

const admissionToErCard = (a) => ({
  _id: a._id,
  _source: "admission",
  emergencyNumber: a.admissionNumber || a._id,
  patientId: a.patientId,
  UHID: a.UHID,
  patientName: a.patientName,
  age: a.patientId?.age ?? a.age,
  gender: a.patientId?.gender ?? a.gender,
  contactNumber: a.patientId?.contactNumber ?? a.contactNumber,
  arrivalDate: a.admissionDate || a.createdAt,
  arrivalMode: a.modeOfArrival || "Walk-in",
  triageCategory: TRIAGE_NORMALIZE[a.triageLevel] || a.triageCategory || "Urgent",
  isMLC: !!a.isMLC,
  mlcNumber: a.mlcNumber || "",
  consultantIncharge: a.attendingDoctor || "On-call",
  presentingComplaints: a.reasonForAdmission || a.provisionalDiagnosis || "",
  vitals: {},
  status: a.status === "Active" ? "Active" : a.status,
});

const dedupeMerge = (emergencies, admissions) => {
  const seen = new Set(emergencies.map(e => `${e.UHID}|${(new Date(e.arrivalDate)).toDateString()}`));
  const extra = admissions.filter(a => {
    const key = `${a.UHID}|${(new Date(a.admissionDate || a.createdAt)).toDateString()}`;
    return !seen.has(key);
  });
  return [...emergencies, ...extra.map(admissionToErCard)];
};

export default function EmergencyList() {
  const navigate = useNavigate();
  const [tab, setTab] = useState("Active");          // Active | Today | MLC
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [triageFilter, setTriageFilter] = useState("");
  // R7hr(ER-P1.1) — serial-vitals modal target (the visit being recorded).
  const [vitalsFor, setVitalsFor] = useState(null);
  // R7hr(ER-P1.2) — disposition modal target (the visit being closed).
  const [dispoFor, setDispoFor] = useState(null);
  const inputRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      let emergencyUrl, admissionParams;
      if (tab === "MLC") {
        emergencyUrl    = `${API_ENDPOINTS.EMERGENCY}/mlc`;
        admissionParams = { admissionType: "Emergency", isMLC: true, limit: 200 };
      } else if (tab === "Today") {
        emergencyUrl    = `${API_ENDPOINTS.EMERGENCY}/today`;
        const today = new Date(); today.setHours(0, 0, 0, 0);
        admissionParams = { admissionType: "Emergency", fromDate: today.toISOString(), limit: 200 };
      } else {
        emergencyUrl    = `${API_ENDPOINTS.EMERGENCY}/active`;
        admissionParams = { admissionType: "Emergency", status: "Active", limit: 200 };
      }

      const [erRes, admRes] = await Promise.all([
        axios.get(emergencyUrl).catch(() => ({ data: { data: [] } })),
        axios.get(`${API_ENDPOINTS.ADMISSIONS}`, { params: admissionParams })
             .catch(() => ({ data: { admissions: [], data: [] } })),
      ]);
      const emergencies = erRes.data?.data || erRes.data || [];
      let admissions    = admRes.data?.admissions || admRes.data?.data || [];
      // Backend's admissions list doesn't accept isMLC filter — narrow it
      // client-side so the MLC tab doesn't include non-MLC admissions.
      if (tab === "MLC") admissions = admissions.filter(a => !!a.isMLC);
      setList(dedupeMerge(emergencies, admissions));
    } catch (e) {
      toast.error("Could not load emergency cases");
    } finally { setLoading(false); }
  }, [tab]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const filtered = useMemo(() => {
    let r = list;
    if (triageFilter) r = r.filter(e => e.triageCategory === triageFilter);
    const s = search.trim().toLowerCase();
    if (s) r = r.filter(e => {
      const name = e.patientId?.fullName || e.patientName || "";
      const uhid = e.patientId?.UHID || e.UHID || "";
      return name.toLowerCase().includes(s) ||
             uhid.toLowerCase().includes(s) ||
             (e.emergencyNumber || "").toLowerCase().includes(s) ||
             (e.consultantIncharge || "").toLowerCase().includes(s);
    });
    r = [...r].sort((a, b) => {
      const ai = TRIAGE_ORDER.indexOf(a.triageCategory);
      const bi = TRIAGE_ORDER.indexOf(b.triageCategory);
      if (ai !== bi) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      return new Date(a.arrivalDate) - new Date(b.arrivalDate);
    });
    return r;
  }, [list, search, triageFilter]);

  const triageCounts = TRIAGE_ORDER.reduce((acc, t) => {
    acc[t] = list.filter(e => e.triageCategory === t).length;
    return acc;
  }, {});

  return (
    <div className="rx-page">
      {/* Header */}
      <div className="rx-header rx-header--er">
        <div>
          <div className="rx-header-title"><i className="pi pi-bolt" /> Emergency Cases</div>
          <div className="rx-header-meta">
            Hospital-wide triage board · Auto-refresh 30s · {filtered.length} case{filtered.length === 1 ? "" : "s"}
          </div>
        </div>
        <div className="rx-header-actions">
          <button className="rx-btn-ghost" onClick={load}>
            <i className={`pi ${loading ? "pi-spin pi-spinner" : "pi-refresh"}`} /> Refresh
          </button>
          <button className="rx-btn-primary rx-btn-primary--er"
                  onClick={() => navigate("/reception/register?type=Emergency")}>
            <i className="pi pi-plus" /> New ER Registration
          </button>
          <button className="rx-btn-ghost" onClick={() => navigate(-1)}>
            <i className="pi pi-arrow-left" /> Back
          </button>
        </div>
      </div>

      {/* Triage KPI strip */}
      <div className="rx-kpis">
        {TRIAGE_ORDER.map(t => {
          const variant = t.toLowerCase().replace(/[^a-z]/g, "");
          return (
            <div key={t}
                 className={`rx-kpi rx-kpi-tile--${variant} ${triageFilter === t ? "rx-kpi-tile--filtering" : ""}`}
                 onClick={() => setTriageFilter(triageFilter === t ? "" : t)}>
              <div className="rx-kpi-label">{t}</div>
              <div className="rx-kpi-value">{triageCounts[t] || 0}</div>
              {triageFilter === t && <div className="rx-kpi-sub rx-kpi-active">✓ filtering</div>}
            </div>
          );
        })}
      </div>

      {/* Tabs */}
      <div className="rx-tabs">
        {[
          { id: "Active", label: "Active Cases",       icon: "pi-bolt" },
          { id: "Today",  label: "Today's All",        icon: "pi-calendar" },
          { id: "MLC",    label: "MLC (Medico-legal)", icon: "pi-shield" },
        ].map(({ id, label, icon }) => (
          <button key={id} className={`rx-tab ${tab === id ? "rx-tab--active" : ""}`} onClick={() => setTab(id)}>
            <i className={`pi ${icon}`} /> {label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="rx-search">
        <i className="pi pi-search" />
        <input
          ref={inputRef}
          placeholder="Search by patient, UHID, ER #, doctor…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {triageFilter && (
          <button className="rx-action-btn" onClick={() => setTriageFilter("")}>
            <i className="pi pi-filter-slash" /> Clear triage: {triageFilter}
          </button>
        )}
      </div>

      {/* List */}
      {loading ? (
        <div className="rx-empty"><i className="pi pi-spin pi-spinner rx-loader-icon" /></div>
      ) : filtered.length === 0 ? (
        <div className="rx-empty">
          <span className="rx-empty-icon">🚑</span>
          No {tab === "MLC" ? "MLC" : tab.toLowerCase()} emergency cases.
          {tab === "Active" && (
            <div className="rx-empty-tip">
              Tip: switch to <strong>Today's All</strong> to see closed/completed cases from today.
            </div>
          )}
        </div>
      ) : filtered.map(e => <ErRow key={`${e._id}-${e._source || "er"}`} e={e} navigate={navigate} onVitals={setVitalsFor} onDispo={setDispoFor} />)}

      {vitalsFor && (
        <VitalsModal
          visit={vitalsFor}
          onClose={() => setVitalsFor(null)}
          onSaved={() => { setVitalsFor(null); load(); }}
        />
      )}
      {dispoFor && (
        <DispositionModal
          visit={dispoFor}
          onClose={() => setDispoFor(null)}
          onSaved={() => { setDispoFor(null); load(); }}
        />
      )}
    </div>
  );
}

/* R7hr(ER-P1.2) — shared receipt builder for the ER Treatment Summary.
   Pulls everything the printable needs from the visit doc + the just-
   submitted disposition form (extra). Latest vitals from vitalsLog tail. */
function buildErSummaryReceipt(visit, extra = {}) {
  const lastLog = Array.isArray(visit.vitalsLog) && visit.vitalsLog.length
    ? visit.vitalsLog[visit.vitalsLog.length - 1]
    : null;
  return {
    erNumber:             visit.emergencyNumber,
    patientName:          visit.patientId?.fullName || visit.patientName,
    uhid:                 visit.patientId?.UHID || visit.UHID,
    age:                  visit.patientId?.age ?? visit.age,
    gender:               visit.patientId?.gender || visit.gender,
    arrivalDate:          visit.arrivalDate || visit.createdAt,
    triageCategory:       visit.triageCategory,
    arrivalMode:          visit.arrivalMode,
    consultantIncharge:   visit.consultantIncharge,
    isMLC:                visit.isMLC,
    mlcNumber:            visit.mlcNumber,
    presentingComplaints: visit.presentingComplaints,
    arrivalVitals:        visit.triage?.vitals || visit.vitals || {},
    latestVitals:         lastLog,
    latestVitalsAt:       lastLog?.recordedAt,
    investigations:       visit.investigationsOrdered || [],
    medications:          visit.treatmentGiven?.medications || [],
    procedures:           visit.treatmentGiven?.procedures || [],
    disposition:          extra.disposition || visit.disposition,
    dispositionNotes:     extra.dispositionNotes || "",
    advice:               extra.advice || "",
    referredToHospital:   extra.referredToHospital || visit.referredTo?.hospital || "",
    referralReason:       extra.referralReason || visit.referredTo?.reason || "",
    damaReason:           extra.damaReason || visit.damaDetails?.reason || "",
    damaExplainedBy:      extra.damaExplainedBy || visit.damaDetails?.explainedBy || "",
    damaWitness:          extra.damaWitness || visit.damaDetails?.witnessName || "",
    printAudit: {
      entityType:   "Emergency",
      entityId:     visit._id,
      entityNumber: visit.emergencyNumber,
      UHID:         visit.patientId?.UHID || visit.UHID,
      patientName:  visit.patientId?.fullName || visit.patientName,
    },
  };
}

/* R7hr(ER-P1.2) — disposition modal. The R7z attestation machinery
   (updateDisposition) had NO frontend caller — dispositions never got set
   from the UI. This closes ER cases from the board with the per-branch
   attestation the service enforces: Referred needs hospital+reason, LAMA
   needs reason/explained-by/witness, Expired needs certifier+cause+manner.
   On Discharged/Referred/LAMA success the ER Treatment Summary auto-prints.
   Admission goes through the Assessment page (bed flow lives there). */
function DispositionModal({ visit, onClose, onSaved }) {
  const [dispo, setDispo] = useState("Discharged");
  const [f, setF] = useState({
    advice: "", dispositionNotes: "",
    referredToHospital: "", referralReason: "",
    damaReason: "", damaExplainedBy: "", damaWitness: "",
    declaredBy: "", immediateCause: "", mannerOfDeath: "Natural",
  });
  const [saving, setSaving] = useState(false);
  const set = (k) => (ev) => setF((p) => ({ ...p, [k]: ev.target.value }));

  const save = async () => {
    // client-side mirrors of the R7z service attestation
    if (dispo === "Referred" && (!f.referredToHospital.trim() || !f.referralReason.trim()))
      return toast.error("Referral needs hospital + reason");
    if (dispo === "Left Against Medical Advice" && (!f.damaReason.trim() || !f.damaExplainedBy.trim() || !f.damaWitness.trim()))
      return toast.error("LAMA needs reason, explained-by and witness");
    if (dispo === "Expired" && (!f.declaredBy.trim() || !f.immediateCause.trim()))
      return toast.error("Death declaration needs certifying doctor + immediate cause");

    setSaving(true);
    try {
      const payload = {
        disposition: dispo,
        dispositionNotes: f.dispositionNotes || f.advice || "",
        ...(dispo === "Referred" ? { referredTo: { hospital: f.referredToHospital.trim(), reason: f.referralReason.trim() } } : {}),
        ...(dispo === "Left Against Medical Advice" ? {
          damaDetails: { reason: f.damaReason.trim(), risksExplained: true, explainedBy: f.damaExplainedBy.trim(), witnessName: f.damaWitness.trim() },
        } : {}),
        ...(dispo === "Expired" ? {
          deathDetails: { declaredBy: f.declaredBy.trim(), immediateCause: f.immediateCause.trim(), mannerOfDeath: f.mannerOfDeath },
        } : {}),
      };
      const res = await axios.put(`${API_ENDPOINTS.EMERGENCY}/${encodeURIComponent(visit.emergencyNumber)}/disposition`, payload);
      const updated = res.data?.data || visit;
      toast.success(`Disposition saved — ${dispo}`);
      // R7hr(ER-P1.3) — exit billing: backend finalised the ER draft and
      // returned the due; tell the desk to collect BEFORE the patient walks.
      const eb = res.data?.erBill;
      if (eb?.balance > 0.5) {
        toast.warn(`💰 ER bill ${eb.billNumber || ""} — ₹${Number(eb.balance).toFixed(2)} due. Billing Counter par collect karo.`, { autoClose: 10000 });
      }
      if (["Discharged", "Referred", "Left Against Medical Advice"].includes(dispo)) {
        openPrint("er-summary", buildErSummaryReceipt({ ...visit, ...updated }, { ...f, disposition: dispo }));
      }
      // R7hr(ER-P2) — Referred exit pe formal referral letter bhi (existing
      // printable, ab wired): clinical summary ER data se auto-composed.
      if (dispo === "Referred") {
        const lastLog = Array.isArray(visit.vitalsLog) && visit.vitalsLog.length ? visit.vitalsLog[visit.vitalsLog.length - 1] : null;
        openPrint("referral-letter", {
          referralNo:        `REF-${visit.emergencyNumber}`,
          date:              new Date().toISOString(),
          patientName:       visit.patientId?.fullName || visit.patientName,
          uhid:              visit.patientId?.UHID || visit.UHID,
          age:               visit.patientId?.age ?? visit.age,
          gender:            visit.patientId?.gender || visit.gender,
          referToHospital:   f.referredToHospital,
          reasonForReferral: f.referralReason,
          urgency:           "Urgent",
          provisionalDiagnosis: visit.provisionalDiagnosis || visit.presentingComplaints,
          clinicalSummary:   `ER presentation: ${visit.presentingComplaints || "—"} (triage ${visit.triageCategory || "—"}). ` +
                             (lastLog ? `Latest vitals: BP ${lastLog.bloodPressure || "—"}, pulse ${lastLog.pulse || "—"}, SpO₂ ${lastLog.oxygenSaturation || "—"}%. ` : "") +
                             (f.dispositionNotes || ""),
          treatmentGiven:    (visit.treatmentGiven?.medications || []).map((m) => `${m.medicineName} ${m.dosage || ""}`).join("; "),
          investigationsDone:(visit.investigationsOrdered || []).map((iv) => iv.testName).join("; "),
          doctorName:        visit.consultantIncharge || "",
        });
      }
      onSaved();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Disposition save failed");
      setSaving(false);
    }
  };

  const inp = (k, ph, w = "100%") => (
    <input value={f[k]} onChange={set(k)} placeholder={ph}
      style={{ width: w, boxSizing: "border-box", padding: "7px 9px", border: "1px solid #cbd5e1", borderRadius: 7, fontSize: 13, fontFamily: "inherit", marginBottom: 8 }} />
  );

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={(ev) => ev.stopPropagation()} style={{ background: "#fff", borderRadius: 14, padding: 18, width: "min(520px, 96vw)", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 50px rgba(0,0,0,.25)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontWeight: 800, fontSize: 15 }}>
            🏁 Disposition — {visit.patientId?.fullName || visit.patientName || visit.emergencyNumber}
            <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>ER #{visit.emergencyNumber}</div>
          </div>
          <button onClick={onClose} style={{ border: "none", background: "transparent", fontSize: 18, cursor: "pointer", color: "#64748b" }}>✕</button>
        </div>

        <label style={{ fontSize: 10.5, fontWeight: 700, color: "#64748b" }}>Disposition</label>
        <select value={dispo} onChange={(ev) => setDispo(ev.target.value)}
          style={{ width: "100%", padding: "8px 9px", border: "1px solid #cbd5e1", borderRadius: 7, fontSize: 13, fontFamily: "inherit", marginBottom: 10 }}>
          <option>Discharged</option>
          <option>Referred</option>
          <option>Left Against Medical Advice</option>
          <option>Observation</option>
          <option>Expired</option>
        </select>

        {dispo === "Referred" && (
          <>
            <label style={{ fontSize: 10.5, fontWeight: 700, color: "#64748b" }}>Referred to (hospital) *</label>
            {inp("referredToHospital", "e.g. PGIMS Rohtak")}
            <label style={{ fontSize: 10.5, fontWeight: 700, color: "#64748b" }}>Reason *</label>
            {inp("referralReason", "e.g. needs neurosurgery — not available here")}
          </>
        )}
        {dispo === "Left Against Medical Advice" && (
          <>
            <label style={{ fontSize: 10.5, fontWeight: 700, color: "#64748b" }}>Reason *</label>
            {inp("damaReason", "patient/attendant's stated reason")}
            <label style={{ fontSize: 10.5, fontWeight: 700, color: "#64748b" }}>Risks explained by *</label>
            {inp("damaExplainedBy", "doctor name")}
            <label style={{ fontSize: 10.5, fontWeight: 700, color: "#64748b" }}>Witness *</label>
            {inp("damaWitness", "witness name")}
          </>
        )}
        {dispo === "Expired" && (
          <>
            <label style={{ fontSize: 10.5, fontWeight: 700, color: "#64748b" }}>Death declared by (doctor) *</label>
            {inp("declaredBy", "certifying doctor")}
            <label style={{ fontSize: 10.5, fontWeight: 700, color: "#64748b" }}>Immediate cause *</label>
            {inp("immediateCause", "e.g. cardiorespiratory arrest")}
            <label style={{ fontSize: 10.5, fontWeight: 700, color: "#64748b" }}>Manner of death</label>
            <select value={f.mannerOfDeath} onChange={set("mannerOfDeath")}
              style={{ width: "100%", padding: "8px 9px", border: "1px solid #cbd5e1", borderRadius: 7, fontSize: 13, fontFamily: "inherit", marginBottom: 8 }}>
              {["Natural", "Accident", "Suicide", "Homicide", "Undetermined", "Pending Investigation"].map((m) => <option key={m}>{m}</option>)}
            </select>
            <div style={{ fontSize: 10.5, color: "#7f1d1d", marginBottom: 8 }}>
              Non-natural manner auto-flags MLC + police intimation (backend).
            </div>
          </>
        )}
        {["Discharged", "Referred"].includes(dispo) && (
          <>
            <label style={{ fontSize: 10.5, fontWeight: 700, color: "#64748b" }}>Advice / follow-up (prints on summary)</label>
            {inp("advice", "e.g. review in Medicine OPD after 3 days; continue meds as prescribed")}
          </>
        )}
        <label style={{ fontSize: 10.5, fontWeight: 700, color: "#64748b" }}>Notes (optional)</label>
        {inp("dispositionNotes", "any additional note for the record")}

        <button onClick={save} disabled={saving}
          style={{ width: "100%", padding: "10px 0", background: "#0f172a", color: "#fff", border: "none", borderRadius: 9, fontWeight: 800, fontSize: 13.5, cursor: saving ? "wait" : "pointer", fontFamily: "inherit" }}>
          {saving ? "Saving…" : `Save — ${dispo}`}
        </button>
        <div style={{ fontSize: 10.5, color: "#64748b", marginTop: 8 }}>
          Admit karna hai? Assessment page se bed allot karke sign-and-submit karo — wahi ER→IPD bridge chalata hai.
        </div>
      </div>
    </div>
  );
}

/* R7hr(ER-P1.1) — serial-vitals quick entry. ER stays run hours (especially
   Observation); the arrival snapshot alone hides deterioration. This modal
   POSTs a timestamped vitalsLog row (backend refreshes the snapshot to the
   latest values) and shows the trail so the nurse sees the trend while
   recording. Inline-styled overlay — no page-CSS dependency. */
function VitalsModal({ visit, onClose, onSaved }) {
  const [f, setF] = useState({ bloodPressure: "", pulse: "", respiratoryRate: "", oxygenSaturation: "", temperature: "", painScore: "", glasgowComaScale: "", note: "" });
  const [saving, setSaving] = useState(false);
  const set = (k) => (ev) => setF((p) => ({ ...p, [k]: ev.target.value }));
  const log = Array.isArray(visit.vitalsLog) ? [...visit.vitalsLog].slice(-5).reverse() : [];

  const save = async () => {
    setSaving(true);
    try {
      await axios.post(`${API_ENDPOINTS.EMERGENCY}/${encodeURIComponent(visit.emergencyNumber)}/vitals`, f);
      toast.success("Vitals recorded");
      onSaved();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Vitals save failed");
      setSaving(false);
    }
  };

  const F = ({ label, k, ph, w = 110 }) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, width: w }}>
      <label style={{ fontSize: 10.5, fontWeight: 700, color: "#64748b" }}>{label}</label>
      <input value={f[k]} onChange={set(k)} placeholder={ph}
        style={{ padding: "7px 9px", border: "1px solid #cbd5e1", borderRadius: 7, fontSize: 13, fontFamily: "inherit" }} />
    </div>
  );

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={(ev) => ev.stopPropagation()} style={{ background: "#fff", borderRadius: 14, padding: 18, width: "min(560px, 96vw)", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 50px rgba(0,0,0,.25)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontWeight: 800, fontSize: 15 }}>
            ➕ Record Vitals — {visit.patientId?.fullName || visit.patientName || visit.emergencyNumber}
            <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>ER #{visit.emergencyNumber}</div>
          </div>
          <button onClick={onClose} style={{ border: "none", background: "transparent", fontSize: 18, cursor: "pointer", color: "#64748b" }}>✕</button>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 10 }}>
          <F label="BP (mmHg)" k="bloodPressure" ph="120/80" />
          <F label="Pulse /min" k="pulse" ph="80" w={80} />
          <F label="RR /min" k="respiratoryRate" ph="16" w={80} />
          <F label="SpO₂ %" k="oxygenSaturation" ph="98" w={80} />
          <F label="Temp °F" k="temperature" ph="98.6" w={80} />
          <F label="Pain 0-10" k="painScore" ph="0" w={80} />
          <F label="GCS 3-15" k="glasgowComaScale" ph="15" w={80} />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 10.5, fontWeight: 700, color: "#64748b" }}>Note (optional)</label>
          <input value={f.note} onChange={set("note")} placeholder="e.g. post-nebulisation, patient comfortable"
            style={{ width: "100%", padding: "7px 9px", border: "1px solid #cbd5e1", borderRadius: 7, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
        </div>

        <button onClick={save} disabled={saving}
          style={{ width: "100%", padding: "10px 0", background: "#dc2626", color: "#fff", border: "none", borderRadius: 9, fontWeight: 800, fontSize: 13.5, cursor: saving ? "wait" : "pointer", fontFamily: "inherit" }}>
          {saving ? "Saving…" : "Save Vitals"}
        </button>

        {log.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: "#64748b", textTransform: "uppercase", letterSpacing: ".4px", marginBottom: 6 }}>
              Recent readings (latest first)
            </div>
            {log.map((r, i) => (
              <div key={i} style={{ fontSize: 12, padding: "6px 8px", borderLeft: "3px solid #fca5a5", background: "#fef2f2", borderRadius: 6, marginBottom: 5 }}>
                <strong>{r.recordedAt ? new Date(r.recordedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—"}</strong>
                {" · "}
                {[r.bloodPressure && `BP ${r.bloodPressure}`, r.pulse && `P ${r.pulse}`, r.respiratoryRate && `RR ${r.respiratoryRate}`,
                  r.oxygenSaturation && `SpO₂ ${r.oxygenSaturation}%`, r.temperature && `T ${r.temperature}°F`,
                  r.painScore != null && r.painScore !== "" && `Pain ${r.painScore}`, r.glasgowComaScale && `GCS ${r.glasgowComaScale}`]
                  .filter(Boolean).join(" · ")}
                {r.note && <span style={{ color: "#64748b" }}> — {r.note}</span>}
                {r.recordedBy && <span style={{ color: "#94a3b8" }}> ({r.recordedBy})</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ───────────────────────────────────────────────────────────── */

function ErRow({ e, navigate, onVitals, onDispo }) {
  const name   = e.patientId?.fullName     || e.patientName || "Unknown Patient";
  const uhid   = e.patientId?.UHID         || e.UHID;
  const age    = e.patientId?.age          ?? e.age;
  const gender = e.patientId?.gender       || e.gender;
  const triageClass = TRIAGE_CLASS[e.triageCategory] || "urgent";
  const vitals = e.vitals || {};
  const gcs    = e.triage?.glasgowComaScale;
  const isAdmission = e._source === "admission";

  const openDetails = () => {
    if (isAdmission) {
      // No dedicated admission-detail route in the SPA — fall back to the
      // patient history page where the admission is part of the timeline.
      if (uhid) navigate(`/patient-history?uhid=${uhid}`);
      else toast.warning("Detail view unavailable for this record");
    } else {
      navigate(`/emergency/${e.emergencyNumber}`);
    }
  };

  return (
    <div className={`rx-card rx-card-stripe--${triageClass}`} onClick={openDetails} style={{ cursor: "pointer" }}>
      <div className="rx-card-main">
        <div className="rx-card-name">
          {name}
          <span className={`rx-triage rx-triage--${triageClass}`}>{e.triageCategory || "Urgent"}</span>
          {e.isMLC && <span className="rx-card-stage rx-card-stage--denied">⚖ MLC</span>}
          {e.status && <span className="rx-card-stage rx-card-stage--booked">{e.status}</span>}
          {/* R7hr(ER-P1.4) — observation review clock. Overdue = red pulse;
              otherwise show when the next re-assessment (vitals entry) is due. */}
          {e.status === "Under Observation" && e.nextReviewDue && (
            new Date(e.nextReviewDue) < new Date()
              ? <span className="rx-card-stage rx-card-stage--denied" style={{ fontWeight: 800 }}>
                  ⏰ Review OVERDUE ({new Date(e.nextReviewDue).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })})
                </span>
              : <span className="rx-card-stage" style={{ background: "#fef3c7", color: "#92400e" }}>
                  ⏱ Review by {new Date(e.nextReviewDue).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                </span>
          )}
          {isAdmission && <span className="rx-mono-tag rx-mono-tag--subtle">via Admission</span>}
        </div>
        <div className="rx-card-meta">
          <span>ER #: <strong>{e.emergencyNumber}</strong></span>
          {uhid && <span>UHID: <strong>{uhid}</strong></span>}
          {(age || gender) && <span><strong>{age ?? "?"}y · {gender || "—"}</strong></span>}
          <span>Arrival: <strong>{fmtTime(e.arrivalDate)}</strong> {minutesAgo(e.arrivalDate) && `(${minutesAgo(e.arrivalDate)})`}</span>
          {e.arrivalMode && <span>Mode: <strong>{e.arrivalMode}</strong></span>}
          {e.consultantIncharge && <span>Doctor: <strong>{e.consultantIncharge}</strong></span>}
          {e.presentingComplaints && <span>Complaint: <strong>{e.presentingComplaints}</strong></span>}
          {e.isMLC && e.mlcNumber && <span className="rx-text-danger">MLC #: <strong>{e.mlcNumber}</strong></span>}
        </div>
        {(vitals.bloodPressure || vitals.pulse || vitals.oxygenSaturation || gcs) && (
          <div className="rx-card-meta rx-card-divider">
            {vitals.bloodPressure && <span>BP: <strong>{vitals.bloodPressure}</strong></span>}
            {vitals.pulse && <span>Pulse: <strong>{vitals.pulse}/min</strong></span>}
            {vitals.oxygenSaturation && <span>SpO₂: <strong>{vitals.oxygenSaturation}%</strong></span>}
            {vitals.painScore != null && <span>Pain: <strong>{vitals.painScore}/10</strong></span>}
            {gcs && <span>GCS: <strong>{gcs}</strong></span>}
          </div>
        )}
      </div>
      <div className="rx-card-actions">
        <button className="rx-action-btn rx-action-btn--primary"
                onClick={(ev) => { ev.stopPropagation(); openDetails(); }}
                title="View case">
          <i className="pi pi-eye" /> View
        </button>
        {!isAdmission && (
          <button className="rx-action-btn"
                  onClick={(ev) => { ev.stopPropagation(); navigate(`/emergency-assessment/${uhid || ""}`); }}
                  title="Assessment">
            <i className="pi pi-file-edit" />
          </button>
        )}
        {/* R7hr(ER-P1.1) — serial vitals during the stay; hidden on closed
            cases and admission-sourced cards (those chart on the ward). */}
        {!isAdmission && !["Discharged", "Completed"].includes(e.status) && (
          <button className="rx-action-btn"
                  onClick={(ev) => { ev.stopPropagation(); onVitals?.(e); }}
                  title="Record vitals">
            <i className="pi pi-heart" />
          </button>
        )}
        {/* R7hr(ER-P1.2) — disposition (close the case) on OPEN visits;
            terminal dispositions are sticky server-side, so the button
            hides once one is set. Closed exits get a reprint action. */}
        {!isAdmission && (!e.disposition || ["Pending", "Observation"].includes(e.disposition)) && (
          <button className="rx-action-btn"
                  onClick={(ev) => { ev.stopPropagation(); onDispo?.(e); }}
                  title="Disposition — close case">
            <i className="pi pi-sign-out" />
          </button>
        )}
        {!isAdmission && ["Discharged", "Referred", "Left Against Medical Advice"].includes(e.disposition) && (
          <button className="rx-action-btn"
                  onClick={(ev) => { ev.stopPropagation(); openPrint("er-summary", buildErSummaryReceipt(e)); }}
                  title="Print ER treatment summary">
            <i className="pi pi-print" />
          </button>
        )}
        {/* R7hr(ER-P2) — SBAR handover for Admitted cases (ward nurse copy) */}
        {!isAdmission && e.disposition === "Admitted" && (
          <button className="rx-action-btn"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    const lastLog = Array.isArray(e.vitalsLog) && e.vitalsLog.length ? e.vitalsLog[e.vitalsLog.length - 1] : (e.vitals || {});
                    openPrint("er-handover", {
                      erNumber: e.emergencyNumber, patientName: e.patientId?.fullName || e.patientName,
                      uhid: e.patientId?.UHID || e.UHID, age: e.patientId?.age ?? e.age, gender: e.patientId?.gender || e.gender,
                      toWard: e.admittedToWard, toBed: e.admittedToBed, doctor: e.consultantIncharge,
                      arrivalDate: e.arrivalDate, triageCategory: e.triageCategory, isMLC: e.isMLC, mlcNumber: e.mlcNumber,
                      presentingComplaints: e.presentingComplaints, pastMedicalHistory: e.pastMedicalHistory,
                      allergyHistory: e.allergyHistory, currentMedications: e.currentMedications,
                      provisionalDiagnosis: e.provisionalDiagnosis, latestVitals: lastLog,
                      treatmentSummary: (e.treatmentGiven?.medications || []).map((m) => m.medicineName).join(", "),
                      pendingItems: (e.investigationsOrdered || []).filter((iv) => !iv.result).map((iv) => iv.testName).join(", "),
                    });
                  }}
                  title="Print SBAR handover (ER → ward)">
            <i className="pi pi-arrow-right-arrow-left" />
          </button>
        )}
        {uhid && (
          <button className="rx-action-btn"
                  onClick={(ev) => { ev.stopPropagation(); navigate(`/patient-history?uhid=${uhid}`); }}
                  title="Patient history">
            <i className="pi pi-clock" />
          </button>
        )}
      </div>
    </div>
  );
}
