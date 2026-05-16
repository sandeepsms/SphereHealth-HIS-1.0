/**
 * ReceptionVisitHistory.jsx — Unified OPD / IPD / Emergency timeline
 *
 * URL: /visit-history            → enter UHID
 *      /visit-history/:uhid      → directly load that patient's history
 *
 * Pulls:
 *   GET /api/patients/uhid/:UHID            → patient header + counters
 *   GET /api/opd/patient/:patientId         → OPD visits
 *   GET /api/emergency/patient/:patientId   → emergency visits
 *   GET /api/admissions?patientId=...       → IPD admissions (best-effort)
 *   GET /api/billing/uhid/:UHID             → bills (for total spent)
 */
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import axios from "axios";
import { toast } from "react-toastify";
import { API_ENDPOINTS } from "../../config/api";
import "./reception-shared.css";

const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const fmtDateTime = (d) => d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
const fmtCur = (n) => `₹${(Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export default function ReceptionVisitHistory() {
  const { uhid: paramUhid } = useParams();
  const navigate = useNavigate();
  const [uhid, setUhid] = useState(paramUhid || "");
  const [patient, setPatient] = useState(null);
  const [opdList, setOpdList] = useState([]);
  const [erList, setErList] = useState([]);
  const [admList, setAdmList] = useState([]);
  const [bills, setBills] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("ALL"); // ALL | OPD | IPD | EMERGENCY

  const load = useCallback(async (uhidArg) => {
    if (!uhidArg) return;
    setLoading(true);
    setPatient(null); setOpdList([]); setErList([]); setAdmList([]); setBills([]);
    try {
      const { data } = await axios.get(`${API_ENDPOINTS.PATIENTS}/uhid/${uhidArg}`);
      const p = data?.data || data;
      if (!p?._id) { toast.error("Patient not found"); setLoading(false); return; }
      setPatient(p);

      const [opdRes, erRes, billRes, admRes] = await Promise.allSettled([
        axios.get(`${API_ENDPOINTS.OPD}/patient/${p._id}`),
        axios.get(`${API_ENDPOINTS.EMERGENCY}/patient/${p._id}`),
        axios.get(`${API_ENDPOINTS.BILLING}/uhid/${uhidArg}`),
        axios.get(`${API_ENDPOINTS.ADMISSIONS}?patientId=${p._id}`),
      ]);
      const asArr = (v) => Array.isArray(v) ? v : [];
      if (opdRes.status === "fulfilled") {
        const d = opdRes.value.data;
        setOpdList(asArr(d?.data) || asArr(d));
      }
      if (erRes.status === "fulfilled") {
        const d = erRes.value.data;
        setErList(asArr(d?.data) || asArr(d));
      }
      if (billRes.status === "fulfilled") {
        const d = billRes.value.data;
        setBills(asArr(d?.bills) || asArr(d?.data?.bills));
      }
      // admissions endpoint returns { success, admissions, pagination }
      if (admRes.status === "fulfilled") {
        const ad = admRes.value.data;
        const arr = Array.isArray(ad?.admissions) ? ad.admissions
                  : Array.isArray(ad?.data)       ? ad.data
                  : Array.isArray(ad)             ? ad : [];
        setAdmList(arr);
      }
    } catch (e) {
      toast.error("Failed to load patient history");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { if (paramUhid) load(paramUhid); }, [paramUhid, load]);

  const timeline = useMemo(() => {
    const items = [];
    opdList.forEach(v => items.push({
      kind: "OPD", date: v.visitDate || v.createdAt, id: v._id,
      number: v.visitNumber, doctor: v.consultantName,
      department: typeof v.department === "object" ? v.department?.name : v.department,
      complaint: v.chiefComplaint, status: v.status, raw: v,
    }));
    erList.forEach(v => items.push({
      kind: "EMERGENCY", date: v.arrivalDate || v.createdAt, id: v._id,
      number: v.emergencyNumber, doctor: v.consultantIncharge,
      triage: v.triageCategory, status: v.status, isMLC: v.isMLC,
      complaint: v.presentingComplaints, raw: v,
    }));
    admList.forEach(a => items.push({
      kind: "IPD", date: a.admissionDate || a.createdAt, id: a._id,
      number: a.admissionNumber, doctor: a.consultantDoctor?.fullName || a.consultantName,
      department: typeof a.department === "object" ? a.department?.name : a.department,
      ward: a.bed?.wardName, complaint: a.diagnosis || a.reasonForAdmission,
      status: a.status, raw: a,
    }));
    items.sort((a, b) => new Date(b.date) - new Date(a.date));
    return filter === "ALL" ? items : items.filter(i => i.kind === filter);
  }, [opdList, erList, admList, filter]);

  const totalSpend = useMemo(() => bills.reduce((s, b) => s + (b.netAmount || 0), 0), [bills]);
  const totalPaid  = useMemo(() => bills.reduce((s, b) => s + ((b.netAmount || 0) - (b.balanceAmount || 0)), 0), [bills]);
  const totalDue   = useMemo(() => bills.reduce((s, b) => s + (b.balanceAmount || 0), 0), [bills]);

  return (
    <div className="rx-page">
      <div className="rx-header">
        <div>
          <div className="rx-header-title"><i className="pi pi-clock" /> Visit History</div>
          <div className="rx-header-meta">Unified timeline · OPD · IPD · Emergency · Billing</div>
        </div>
        <div className="rx-header-actions">
          <button className="rx-btn-ghost" onClick={() => navigate("/patient-search")}>
            <i className="pi pi-search" /> Patient Search
          </button>
          <button className="rx-btn-ghost" onClick={() => navigate("/reception")}>
            <i className="pi pi-arrow-left" /> Dashboard
          </button>
        </div>
      </div>

      {/* UHID input */}
      <div className="rx-search rx-mb-14">
        <i className="pi pi-id-card" />
        <input
          placeholder="Enter UHID (e.g. UH0001) and press Enter"
          value={uhid}
          onChange={e => setUhid(e.target.value)}
          onKeyDown={e => e.key === "Enter" && load(uhid)}
        />
        <button className="rx-btn-primary rx-btn-compact" onClick={() => load(uhid)}>
          <i className="pi pi-search" /> Load
        </button>
      </div>

      {loading ? (
        <div className="rx-empty"><i className="pi pi-spin pi-spinner rx-loader-icon" /></div>
      ) : !patient ? (
        <div className="rx-empty">
          <span className="rx-empty-icon">🗂️</span>
          Enter a UHID above to view a patient's full visit history.
        </div>
      ) : (
        <>
          {/* Patient header */}
          <div className="rx-card rx-mb-14">
            <div className="rx-card-main">
              <div className="rx-card-name">
                {patient.fullName}
                <span className="rx-card-age-sex">{patient.age}y · {patient.gender}</span>
                {patient.bloodGroup && <span className="rx-card-stage rx-card-stage--booked">🩸 {patient.bloodGroup}</span>}
              </div>
              <div className="rx-card-meta">
                <span>UHID: <strong>{patient.UHID}</strong></span>
                {patient.contactNumber && <span>📱 <strong>{patient.contactNumber}</strong></span>}
                {patient.email && <span>✉ <strong>{patient.email}</strong></span>}
                {patient.knownAllergies && <span className="rx-text-danger">⚠ Allergies: <strong>{patient.knownAllergies}</strong></span>}
              </div>
            </div>
            <div className="rx-card-actions">
              <button className="rx-action-btn rx-action-btn--primary"
                      onClick={() => navigate(`/reception/register?uhid=${patient.UHID}`)}>
                <i className="pi pi-plus" /> New Visit
              </button>
              <button className="rx-action-btn"
                      onClick={() => navigate(`/reception-billing/${patient.UHID}`)}>
                <i className="pi pi-receipt" /> Billing
              </button>
            </div>
          </div>

          {/* KPI strip */}
          <div className="rx-kpis">
            <div className="rx-kpi rx-kpi--accent">
              <div className="rx-kpi-label">OPD Visits</div>
              <div className="rx-kpi-value">{opdList.length}</div>
            </div>
            <div className="rx-kpi rx-kpi--accent">
              <div className="rx-kpi-label">IPD Admissions</div>
              <div className="rx-kpi-value">{admList.length}</div>
            </div>
            <div className="rx-kpi rx-kpi--accent">
              <div className="rx-kpi-label">Emergency</div>
              <div className="rx-kpi-value">{erList.length}</div>
            </div>
            <div className="rx-kpi rx-kpi--accent">
              <div className="rx-kpi-label">Bills</div>
              <div className="rx-kpi-value">{bills.length}</div>
              <div className="rx-kpi-sub">Total {fmtCur(totalSpend)}</div>
            </div>
            <div className="rx-kpi rx-kpi--accent">
              <div className="rx-kpi-label">Paid</div>
              <div className="rx-kpi-value rx-text-success">{fmtCur(totalPaid)}</div>
            </div>
            <div className="rx-kpi rx-kpi--accent">
              <div className="rx-kpi-label">Outstanding</div>
              <div className={`rx-kpi-value ${totalDue > 0 ? "rx-text-danger" : "rx-text-success"}`}>{fmtCur(totalDue)}</div>
            </div>
          </div>

          {/* Filter tabs */}
          <div className="rx-tabs">
            {["ALL", "OPD", "IPD", "EMERGENCY"].map(f => (
              <button key={f} className={`rx-tab ${filter === f ? "rx-tab--active" : ""}`} onClick={() => setFilter(f)}>
                {f === "ALL" ? "All Visits" : f} <span className="rx-tab-count">
                  {f === "ALL" ? (opdList.length + erList.length + admList.length) :
                   f === "OPD" ? opdList.length :
                   f === "IPD" ? admList.length : erList.length}
                </span>
              </button>
            ))}
          </div>

          {/* Timeline */}
          {timeline.length === 0 ? (
            <div className="rx-empty">
              <span className="rx-empty-icon">📭</span>
              No {filter === "ALL" ? "" : filter + " "}visits on record yet.
            </div>
          ) : (
            <div className="rx-timeline">
              {timeline.map(item => (
                <div key={`${item.kind}-${item.id}`} className={`rx-tl-item rx-tl-item--${item.kind.toLowerCase()}`}>
                  <div className="rx-tl-head">
                    <span className={`rx-tl-type rx-tl-type--${item.kind.toLowerCase()}`}>{item.kind}</span>
                    <span>{item.number}</span>
                    {item.isMLC && <span className="rx-card-stage rx-card-stage--denied">MLC</span>}
                    {item.triage && <span className={`rx-triage rx-triage--${(item.triage || "").toLowerCase().replace(/[^a-z]/g, "")}`}>{item.triage}</span>}
                    {item.status && <span className="rx-card-stage rx-card-stage--booked">{item.status}</span>}
                    <span className="rx-tl-date rx-ml-auto">{fmtDateTime(item.date)}</span>
                  </div>
                  <div className="rx-tl-meta">
                    {item.doctor && <span>Doctor: <strong>{item.doctor}</strong></span>}
                    {item.department && <span>Dept: <strong>{item.department}</strong></span>}
                    {item.ward && <span>Ward: <strong>{item.ward}</strong></span>}
                    {item.complaint && <span>{item.kind === "EMERGENCY" ? "Complaint" : "Reason"}: <strong>{item.complaint}</strong></span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
