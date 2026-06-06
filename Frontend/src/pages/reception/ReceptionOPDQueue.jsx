/**
 * ReceptionOPDQueue.jsx — Today's OPD queue (receptionist view)
 *
 * Receptionist sees the live OPD queue with:
 *   • Per-doctor grouping
 *   • Token / wait time
 *   • Patient name, UHID, age, fee status
 *   • Quick actions: print receipt (route to existing OPD print),
 *     view patient, mark fee paid (uses billing if billId on visit)
 *
 * NO clinical fields (no SOAP, no prescription) — that's the doctor's job.
 *
 * API: GET /api/opd/today, GET /api/opd?date=YYYY-MM-DD&status=Active
 */
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { toast } from "react-toastify";
import { API_ENDPOINTS } from "../../config/api";
import "./reception-shared.css";

const todayISO = () => new Date().toISOString().slice(0, 10);
const fmtTime = (d) => d ? new Date(d).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—";
const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const fmtCur  = (n) => `₹${(Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

// "Active" is a UI bucket that maps to OPD enum values "Waiting" + "In Progress"
// — see `bucketOf()` below. Without this mapping every walk-in lived in
// "Waiting" and the default tab silently showed an empty queue.
const STATUSES = ["Active", "Completed", "Referred"];
const bucketOf = (v) => {
  const st = v?.status || "Waiting";
  if (st === "Waiting" || st === "In Progress") return "Active";
  return st;
};

export default function ReceptionOPDQueue() {
  const navigate = useNavigate();
  const [date, setDate] = useState(todayISO());
  const [tab, setTab] = useState("Active");
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [groupBy, setGroupBy] = useState("doctor"); // doctor | none

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // The Active tab is a live queue — patients keep waiting until someone
      // marks them Completed, so we ignore the date filter and fetch ALL
      // Waiting + In-Progress visits across days. Otherwise a patient seeded
      // / registered yesterday but still Waiting silently disappears today.
      //
      // For Completed / Referred tabs we DO filter by date (these are
      // per-day historical buckets the receptionist usually scans by day).
      let visits = [];
      if (tab === "Active") {
        const [waitRes, inProgRes] = await Promise.all([
          axios.get(`${API_ENDPOINTS.OPD}?limit=500&status=Waiting`),
          axios.get(`${API_ENDPOINTS.OPD}?limit=500&status=In Progress`),
        ]);
        const waiting    = waitRes.data?.data || waitRes.data || [];
        const inProgress = inProgRes.data?.data || inProgRes.data || [];
        visits = [...waiting, ...inProgress];
      } else if (date === todayISO()) {
        // Completed/Referred for today — dedicated endpoint is faster.
        const { data } = await axios.get(`${API_ENDPOINTS.OPD}/today`);
        visits = data?.data || data || [];
      } else {
        const { data } = await axios.get(`${API_ENDPOINTS.OPD}?limit=500&date=${date}`);
        visits = data?.data || data || [];
      }
      setList(visits);
    } catch (e) {
      toast.error("Could not load OPD queue");
    } finally { setLoading(false); }
  }, [date, tab]);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh every 30s so reception sees walk-ins in real time
  useEffect(() => {
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  const filtered = useMemo(() => {
    let r = list.filter(v => bucketOf(v) === tab);
    const s = search.trim().toLowerCase();
    if (s) r = r.filter(v => {
      const name = v.patientId?.fullName || v.patientName || "";
      const uhid = v.patientId?.UHID || v.UHID || "";
      return name.toLowerCase().includes(s) ||
             uhid.toLowerCase().includes(s) ||
             (v.visitNumber || "").toLowerCase().includes(s) ||
             (v.consultantName || "").toLowerCase().includes(s);
    });
    return r;
  }, [list, tab, search]);

  const counts = STATUSES.reduce((acc, s) => {
    acc[s] = list.filter(v => bucketOf(v) === s).length;
    return acc;
  }, {});

  // Group by doctor
  const groups = useMemo(() => {
    if (groupBy !== "doctor") return [{ doctor: "All", visits: filtered }];
    const m = {};
    filtered.forEach(v => {
      const key = v.consultantName || v.doctorId?.personalInfo?.fullName || "— Unassigned —";
      (m[key] ||= []).push(v);
    });
    return Object.entries(m)
      .sort((a, b) => b[1].length - a[1].length)
      .map(([doctor, visits]) => ({ doctor, visits }));
  }, [filtered, groupBy]);

  return (
    <div className="rx-page">
      <div className="rx-header">
        <div>
          <div className="rx-header-title"><i className="pi pi-list" /> OPD Queue</div>
          <div className="rx-header-meta">
            Live queue · Auto-refresh 30s · {filtered.length} visit{filtered.length === 1 ? "" : "s"}
            {tab === "Active"
              ? " · showing all currently Waiting / In-Progress patients (any date)"
              : ` for ${fmtDate(date)}`}
          </div>
        </div>
        <div className="rx-header-actions">
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            max={todayISO()}
            className="rx-header-date"
            disabled={tab === "Active"}
            title={tab === "Active" ? "Active queue ignores date — switch to Completed / Referred to pick a date" : "Pick a date"}
          />
          <button className="rx-btn-ghost" onClick={load}><i className="pi pi-refresh" /> Refresh</button>
          <button className="rx-btn-primary" onClick={() => navigate("/reception/register?type=OPD")}>
            <i className="pi pi-plus" /> New OPD
          </button>
          <button className="rx-btn-ghost" onClick={() => navigate("/reception")}>
            <i className="pi pi-arrow-left" /> Dashboard
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="rx-tabs">
        {STATUSES.map(s => (
          <button key={s} className={`rx-tab ${tab === s ? "rx-tab--active" : ""}`} onClick={() => setTab(s)}>
            {s === "Active" ? "Waiting / In-progress" : s}{" "}
            <span className="rx-tab-count">{counts[s] || 0}</span>
          </button>
        ))}
      </div>

      {/* Toolbar */}
      <div className="rx-toolbar">
        <div className="rx-search rx-search--inline">
          <i className="pi pi-search" />
          <input placeholder="Search by patient, UHID, visit #, doctor…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select value={groupBy} onChange={e => setGroupBy(e.target.value)}>
          <option value="doctor">Group by Doctor</option>
          <option value="none">No Grouping</option>
        </select>
      </div>

      {loading ? (
        <div className="rx-empty"><i className="pi pi-spin pi-spinner rx-loader-icon" /></div>
      ) : filtered.length === 0 ? (
        <div className="rx-empty">
          <span className="rx-empty-icon">📋</span>
          {tab === "Active"
            ? "No patients currently Waiting or In-Progress in the OPD queue."
            : <>No {tab.toLowerCase()} OPD visits {date !== todayISO() && <>for {fmtDate(date)}</>}</>}
        </div>
      ) : groups.map(grp => (
        <div key={grp.doctor} className="rx-ward-block">
          <div className="rx-ward-head">
            <i className="pi pi-user-edit" />
            <span>Dr. {grp.doctor}</span>
            <span className="rx-ward-count">
              <span className="rx-ward-count-grp">{grp.visits.length} pt</span>
            </span>
          </div>
          <div className="rx-p-10">
            {grp.visits.map((v, idx) => <OPDRow key={v._id} v={v} idx={idx + 1} navigate={navigate} reload={load} />)}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ───────────────────────────────────────────────────────────── */

function OPDRow({ v, idx, navigate, reload }) {
  const name = v.patientId?.fullName || v.patientName || "Patient";
  const uhid = v.patientId?.UHID || v.UHID;
  const age  = v.patientId?.age ?? v.age;
  const gender = v.patientId?.gender || v.gender;
  const fee  = v.consultationFee || v.fee || 0;
  const paid = v.feePaid || v.paymentStatus === "Paid";

  return (
    <div className="rx-card rx-card--compact">
      <div className="rx-card-main">
        <div className="rx-card-name rx-card-name--sm">
          <span className="rx-queue-pos">{idx}</span>
          {name}
          {v.hasAppointment && <span className="rx-card-stage rx-card-stage--booked">📅 Appt</span>}
          {v.visitType && <span className="rx-mono-tag">{v.visitType}</span>}
          {paid ? <span className="rx-card-stage rx-card-stage--cleared">FEE PAID</span>
                : <span className="rx-card-stage rx-card-stage--pending">FEE PENDING</span>}
        </div>
        <div className="rx-card-meta">
          <span>Visit #: <strong>{v.visitNumber}</strong></span>
          {uhid && <span>UHID: <strong>{uhid}</strong></span>}
          {(age || gender) && <span><strong>{age ?? "?"}y · {gender || "—"}</strong></span>}
          <span>Time: <strong>{fmtTime(v.visitDate)}</strong></span>
          {fee > 0 && <span>Fee: <strong>{fmtCur(fee)}</strong></span>}
          {v.chiefComplaint && <span>Reason: <strong>{v.chiefComplaint}</strong></span>}
        </div>
      </div>
      <div className="rx-card-actions">
        {/* R7hr-56 — Receipt button removed. It used to navigate to
            `/opd/:UHID` (the legacy OPDPrint page) which read patient
            data once at page-load and rendered a generic OPD slip with
            no link to the actual visit's bill — so cashiers would print
            stale, back-dated information. The correct receipt for any
            given visit is now generated from the Billing Counter
            (Print button on the visit's bill row), which is reached
            via the Bill button below. */}
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
