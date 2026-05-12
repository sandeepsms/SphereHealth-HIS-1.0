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
      ) : filtered.map(e => <ErRow key={`${e._id}-${e._source || "er"}`} e={e} navigate={navigate} />)}
    </div>
  );
}

/* ───────────────────────────────────────────────────────────── */

function ErRow({ e, navigate }) {
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
