/**
 * ReceptionEmergencyCases.jsx — Active emergency cases (receptionist view)
 *
 * Receptionist-focused view:
 *   • Active emergencies, sorted by triage severity then arrival
 *   • Triage colour chips, MLC tag, arrival mode
 *   • Vitals snapshot (BP / pulse / SpO₂ / GCS) — read-only
 *   • Quick actions: New ER registration, print, WhatsApp family
 *
 * API:
 *   GET /api/emergency/active     → active cases (sorted by triage)
 *   GET /api/emergency/mlc        → MLC tab
 *   GET /api/emergency/triage/:c  → filter by triage
 *   GET /api/emergency/today      → today's all cases
 */
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { toast } from "react-toastify";
import { API_ENDPOINTS } from "../../config/api";
import "./reception-shared.css";

const TRIAGE_ORDER = ["Critical", "Emergency", "Urgent", "Semi-urgent", "Non-urgent"];
const TRIAGE_CLASS = {
  "Critical":     "critical",
  "Emergency":    "emergency",
  "Urgent":       "urgent",
  "Semi-urgent":  "semiurgent",
  "Non-urgent":   "nonurgent",
};

const fmtTime = (d) => d ? new Date(d).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—";
const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "—";
const minutesAgo = (d) => {
  if (!d) return null;
  const m = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); return `${h}h ${m % 60}m ago`;
};

export default function ReceptionEmergencyCases() {
  const navigate = useNavigate();
  const [tab, setTab] = useState("Active"); // Active | MLC | Today
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [triageFilter, setTriageFilter] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      let url;
      if (tab === "MLC")    url = `${API_ENDPOINTS.EMERGENCY}/mlc`;
      else if (tab === "Today") url = `${API_ENDPOINTS.EMERGENCY}/today`;
      else url = `${API_ENDPOINTS.EMERGENCY}/active`;
      const { data } = await axios.get(url);
      setList(data?.data || data || []);
    } catch (e) {
      toast.error("Could not load emergency cases");
    } finally { setLoading(false); }
  }, [tab]);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh every 30s — emergencies change quickly
  useEffect(() => {
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  const filtered = useMemo(() => {
    let r = list;
    if (triageFilter) r = r.filter(e => e.triageCategory === triageFilter);
    const s = search.trim().toLowerCase();
    if (s) r = r.filter(e => {
      const name = e.patientId?.fullName || "";
      const uhid = e.patientId?.UHID || "";
      return name.toLowerCase().includes(s) ||
             uhid.toLowerCase().includes(s) ||
             (e.emergencyNumber || "").toLowerCase().includes(s) ||
             (e.consultantIncharge || "").toLowerCase().includes(s);
    });
    // Re-sort by triage severity then arrival
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
      <div className="rx-header" style={{ background: "linear-gradient(135deg,#7f1d1d,#dc2626)" }}>
        <div>
          <div className="rx-header-title"><i className="pi pi-bolt" /> Emergency Cases</div>
          <div className="rx-header-meta">Live triage board · Auto-refresh 30s · {filtered.length} case{filtered.length === 1 ? "" : "s"}</div>
        </div>
        <div className="rx-header-actions">
          <button className="rx-btn-ghost" onClick={load}><i className="pi pi-refresh" /> Refresh</button>
          <button className="rx-btn-primary" onClick={() => navigate("/reception/register?type=Emergency")}
                  style={{ background: "linear-gradient(135deg,#dc2626,#ef4444)" }}>
            <i className="pi pi-plus" /> New ER Registration
          </button>
          <button className="rx-btn-ghost" onClick={() => navigate("/reception")}>
            <i className="pi pi-arrow-left" /> Dashboard
          </button>
        </div>
      </div>

      {/* Triage KPI strip */}
      <div className="rx-kpis">
        {TRIAGE_ORDER.map(t => (
          <div key={t} className="rx-kpi" style={{ cursor: "pointer", borderLeft: `4px solid ${
            t === "Critical" ? "#991b1b" : t === "Emergency" ? "#c2410c" :
            t === "Urgent" ? "#a16207" : t === "Semi-urgent" ? "#0e7490" : "#15803d"
          }` }} onClick={() => setTriageFilter(triageFilter === t ? "" : t)}>
            <div className="rx-kpi-label">{t}</div>
            <div className="rx-kpi-value">{triageCounts[t] || 0}</div>
            {triageFilter === t && <div className="rx-kpi-sub" style={{ color: "#06b6d4" }}>✓ filtering</div>}
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="rx-tabs">
        {[
          { id: "Active", label: "Active Cases" },
          { id: "MLC",    label: "MLC (Medico-legal)" },
          { id: "Today",  label: "Today's All" },
        ].map(({ id, label }) => (
          <button key={id} className={`rx-tab ${tab === id ? "rx-tab--active" : ""}`} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {/* Search bar */}
      <div className="rx-search">
        <i className="pi pi-search" />
        <input placeholder="Search by patient, UHID, ER #, doctor…" value={search} onChange={e => setSearch(e.target.value)} />
        {triageFilter && (
          <button className="rx-action-btn" onClick={() => setTriageFilter("")}>
            <i className="pi pi-filter-slash" /> Clear triage: {triageFilter}
          </button>
        )}
      </div>

      {loading ? (
        <div className="rx-empty"><i className="pi pi-spin pi-spinner" style={{ fontSize: 28 }} /></div>
      ) : filtered.length === 0 ? (
        <div className="rx-empty">
          <span className="rx-empty-icon">🚑</span>
          No {tab === "MLC" ? "MLC" : tab.toLowerCase()} emergency cases
        </div>
      ) : filtered.map(e => <EmergencyRow key={e._id} e={e} navigate={navigate} />)}
    </div>
  );
}

/* ───────────────────────────────────────────────────────────── */

function EmergencyRow({ e, navigate }) {
  const name = e.patientId?.fullName || e.patientName || "Unknown Patient";
  const uhid = e.patientId?.UHID || e.UHID;
  const age = e.patientId?.age;
  const gender = e.patientId?.gender;
  const phone = e.patientId?.contactNumber || e.contactNumber;
  const triageClass = TRIAGE_CLASS[e.triageCategory] || "urgent";
  const vitals = e.vitals || {};
  const gcs = e.triage?.glasgowComaScale;

  const sendWA = () => {
    if (!phone) return toast.warning("No family contact on file");
    const num = phone.replace(/\D/g, "");
    const ph = num.length === 10 ? `91${num}` : num;
    const msg = `Emergency intimation: ${name} (UHID ${uhid || "—"}) is currently being treated at SphereHealth Hospital, ER. Triage: ${e.triageCategory}. ER #: ${e.emergencyNumber}. Please reach the hospital. — Reception`;
    window.open(`https://wa.me/${ph}?text=${encodeURIComponent(msg)}`, "_blank");
  };

  return (
    <div className="rx-card" style={{ borderLeft: `4px solid ${
      e.triageCategory === "Critical" ? "#991b1b" :
      e.triageCategory === "Emergency" ? "#c2410c" :
      e.triageCategory === "Urgent" ? "#a16207" :
      e.triageCategory === "Semi-urgent" ? "#0e7490" : "#15803d"
    }` }}>
      <div className="rx-card-main">
        <div className="rx-card-name">
          {name}
          <span className={`rx-triage rx-triage--${triageClass}`}>{e.triageCategory || "Urgent"}</span>
          {e.isMLC && <span className="rx-card-stage rx-card-stage--denied">⚖ MLC</span>}
          {e.status && <span className="rx-card-stage rx-card-stage--booked">{e.status}</span>}
        </div>
        <div className="rx-card-meta">
          <span>ER #: <strong>{e.emergencyNumber}</strong></span>
          {uhid && <span>UHID: <strong>{uhid}</strong></span>}
          {(age || gender) && <span><strong>{age ?? "?"}y · {gender || "—"}</strong></span>}
          <span>Arrival: <strong>{fmtTime(e.arrivalDate)}</strong> {minutesAgo(e.arrivalDate) && `(${minutesAgo(e.arrivalDate)})`}</span>
          {e.arrivalMode && <span>Mode: <strong>{e.arrivalMode}</strong></span>}
          {e.consultantIncharge && <span>Doctor: <strong>{e.consultantIncharge}</strong></span>}
          {e.presentingComplaints && <span>Complaint: <strong>{e.presentingComplaints}</strong></span>}
          {e.isMLC && e.mlcNumber && <span style={{ color: "#b91c1c" }}>MLC #: <strong>{e.mlcNumber}</strong></span>}
        </div>
        {(vitals.bloodPressure || vitals.pulse || vitals.oxygenSaturation || gcs) && (
          <div className="rx-card-meta" style={{ marginTop: 6, borderTop: "1px dashed #e2e8f0", paddingTop: 6 }}>
            {vitals.bloodPressure && <span>BP: <strong>{vitals.bloodPressure}</strong></span>}
            {vitals.pulse && <span>Pulse: <strong>{vitals.pulse}/min</strong></span>}
            {vitals.oxygenSaturation && <span>SpO₂: <strong>{vitals.oxygenSaturation}%</strong></span>}
            {vitals.painScore != null && <span>Pain: <strong>{vitals.painScore}/10</strong></span>}
            {gcs && <span>GCS: <strong>{gcs}</strong></span>}
          </div>
        )}
      </div>
      <div className="rx-card-actions">
        {phone && (
          <button className="rx-action-btn" onClick={sendWA} title="WhatsApp family">
            <i className="pi pi-whatsapp" style={{ color: "#22c55e" }} />
          </button>
        )}
        {uhid && (
          <button className="rx-action-btn"
                  onClick={() => navigate(`/visit-history/${uhid}`)} title="Patient history">
            <i className="pi pi-clock" />
          </button>
        )}
        {uhid && (
          <button className="rx-action-btn rx-action-btn--primary"
                  onClick={() => navigate(`/reception-billing/${uhid}`)} title="Billing">
            <i className="pi pi-receipt" /> Bill
          </button>
        )}
      </div>
    </div>
  );
}
