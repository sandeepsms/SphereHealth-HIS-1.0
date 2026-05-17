/**
 * PatientLookupPage.jsx — unified search · directory · timeline · billing
 *
 * Aliases /patient-search, /visit-history, /allpatient, /patient-history.
 * Three view modes the receptionist or clinician can switch between:
 *
 *   • SEARCH    — live name/UHID/phone lookup (200ms debounce, min 2 chars)
 *                 with a side panel showing the picked patient's profile,
 *                 unified visit timeline, and billing history
 *   • DIRECTORY — paginated patient table with type filter (OPD/IPD/ER/...)
 *                 and per-row Open / Edit actions
 *   • TIMELINE  — full-width detail panel for a single patient, used when
 *                 arriving via /visit-history/:uhid or ?uhid=
 *
 * Per-role defaults:
 *   • Receptionist  → Search
 *   • Doctor/Nurse  → Directory
 *   • ?uhid= present → Timeline
 *
 * Styling: HIS theme classes from reception-shared.css (`.rx-*`) + a small
 * page-scoped sheet (PatientLookupPage.css) for layout-only rules. No
 * inline JS styles (per workflow_no_inline_styles.md).
 *
 * DB integrity: every endpoint is unchanged from the legacy 4 pages —
 * /api/patients/search, /api/patients/uhid/:uhid, /api/patients (list),
 * /api/admissions, /api/opd/patient/:id, /api/emergency/patient/:id,
 * /api/billing/uhid/:uhid. Frontend-only consolidation.
 */

import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useNavigate, useSearchParams, useParams } from "react-router-dom";
import axios from "axios";
import { API_ENDPOINTS } from "../../config/api";
import { useAuth } from "../../context/AuthContext";
import "../reception/reception-shared.css";
import "./PatientLookupPage.css";

/* ─── Formatters ─────────────────────────────────────────────── */
const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const fmtDateTime = (d) =>
  d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
const fmtCur = (n) => `₹${(Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const initials = (name = "") =>
  (name.trim().split(/\s+/).slice(0, 2).map((p) => p[0] || "").join("") || "?").toUpperCase();
const ageGenderLine = (p) => {
  const bits = [];
  if (p?.age != null && p.age !== "") bits.push(`${p.age}y`);
  if (p?.gender) bits.push(p.gender);
  return bits.join(" · ");
};
const docName = (d) => {
  if (!d) return "—";
  if (typeof d === "string") return d.startsWith("Dr") ? d : `Dr. ${d}`;
  const pi = d.personalInfo || {};
  const full = pi.fullName || [pi.firstName, pi.lastName].filter(Boolean).join(" ");
  return full ? `Dr. ${full}` : d.name || "—";
};
const deptName = (d) => {
  if (!d) return "—";
  if (typeof d === "string") return d;
  return d.departmentName || d.name || "—";
};
const fullAddr = (a) => {
  if (!a) return "—";
  if (typeof a === "string") return a;
  return [a.completeAddress, a.city, a.district, a.state, a.pincode]
    .filter(Boolean).join(", ") || "—";
};

const TIMELINE_TABS = [
  { key: "ALL",       label: "All",       icon: "pi-history" },
  { key: "OPD",       label: "OPD",       icon: "pi-user-plus" },
  { key: "IPD",       label: "IPD",       icon: "pi-home" },
  { key: "Emergency", label: "Emergency", icon: "pi-bolt" },
];

/* ─── Cross-route timeline loaders ─────────────────────────────
   Mirror the loader logic the legacy PatientHistoryPage used so the
   response-shape parity stays intact. Every loader returns an Array
   so downstream .map / .reduce / .filter calls are safe. */
const toArray = (x) => {
  if (Array.isArray(x)) return x;
  if (x && typeof x === "object") {
    // Common envelope shapes seen across the HIS API
    for (const k of ["bills", "data", "admissions", "items", "results", "rows", "records", "list"]) {
      if (Array.isArray(x[k])) return x[k];
    }
  }
  return [];
};
async function loadAdmissions(patientId, uhid, signal) {
  const BASE = API_ENDPOINTS.ADMISSIONS;
  const extract = (r) => {
    const root = r?.data;
    const a =
      toArray(root?.admissions) ||
      toArray(root?.data) ||
      toArray(root);
    return a.length ? a : null;
  };
  try {
    const r = await axios.get(BASE, { params: { patientId, limit: 200 }, signal });
    const d = extract(r);
    if (d) return d;
  } catch { /* fall through to UHID lookup */ }
  if (uhid) {
    try {
      const r = await axios.get(BASE, { params: { UHID: uhid, limit: 200 }, signal });
      const d = extract(r);
      if (d) return d;
    } catch { /* nothing else to try */ }
  }
  return [];
}
async function loadOPDForPatient(patientId, signal) {
  if (!patientId) return [];
  try {
    const r = await axios.get(`${API_ENDPOINTS.BASE}/opd/patient/${patientId}`, { signal });
    const inner = toArray(r?.data?.data);
    return inner.length ? inner : toArray(r?.data);
  } catch { return []; }
}
async function loadEmergencyForPatient(patientId, signal) {
  if (!patientId) return [];
  try {
    const r = await axios.get(`${API_ENDPOINTS.BASE}/emergency/patient/${patientId}`, { signal });
    const inner = toArray(r?.data?.data);
    return inner.length ? inner : toArray(r?.data);
  } catch { return []; }
}
async function loadBillsForUHID(uhid, signal) {
  if (!uhid) return [];
  try {
    const r = await axios.get(`${API_ENDPOINTS.BASE}/billing/uhid/${encodeURIComponent(uhid)}`, { signal });
    const inner = toArray(r?.data?.data);
    return inner.length ? inner : toArray(r?.data);
  } catch { return []; }
}
async function loadAdvancesForUHID(uhid, signal) {
  if (!uhid) return { advances: [], totalUnspent: 0 };
  try {
    const r = await axios.get(`${API_ENDPOINTS.BASE}/billing/advance/uhid/${encodeURIComponent(uhid)}`, { signal });
    const d = r?.data?.data || {};
    return {
      advances:     toArray(d.advances),
      totalUnspent: Number(d.totalUnspent) || 0,
    };
  } catch { return { advances: [], totalUnspent: 0 }; }
}

/* ════════════════ MAIN COMPONENT ════════════════ */
export default function PatientLookupPage({ initialView = "auto" }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { uhid: routeUhid } = useParams(); // legacy /visit-history/:uhid
  const { user } = useAuth();
  const role = user?.role;

  const isRX        = role === "Receptionist";
  const isAdmin     = role === "Admin";
  const canEdit     = isAdmin || isRX;
  const canNewVisit = isAdmin || isRX;

  // Auto-pick initial view by role / URL.
  const urlUhid = (searchParams.get("uhid") || routeUhid || "").toUpperCase();
  const defaultView = useMemo(() => {
    if (urlUhid) return "timeline";
    if (initialView && initialView !== "auto") return initialView;
    return isRX ? "search" : "directory";
  }, [urlUhid, initialView, isRX]);
  const [view, setView] = useState(defaultView);

  /* ─── Live search ─────────────────────────────────────────── */
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const debRef = useRef(null);

  useEffect(() => {
    if (debRef.current) clearTimeout(debRef.current);
    if (!q || q.trim().length < 2) { setResults([]); return; }
    const ac = new AbortController();
    debRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const { data } = await axios.get(
          `${API_ENDPOINTS.PATIENTS}/search?q=${encodeURIComponent(q.trim())}&limit=30`,
          { signal: ac.signal },
        );
        if (!ac.signal.aborted) setResults(data?.data || data || []);
      } catch (e) {
        if (!axios.isCancel(e)) console.error("[PatientLookup] search:", e?.message);
      } finally {
        if (!ac.signal.aborted) setSearching(false);
      }
    }, 200);
    return () => { ac.abort(); if (debRef.current) clearTimeout(debRef.current); };
  }, [q]);

  /* ─── Selected patient + all timeline streams ──────────────── */
  const [selected, setSelected] = useState(null);
  const [opd, setOpd]           = useState([]);
  const [adm, setAdm]           = useState([]);
  const [er, setEr]             = useState([]);
  const [bills, setBills]       = useState([]);
  const [advances,     setAdvances]     = useState([]);
  const [unspentAdv,   setUnspentAdv]   = useState(0);
  const [showAdvDlg,   setShowAdvDlg]   = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [timelineFilter, setTimelineFilter] = useState("ALL");
  const [detailTab, setDetailTab] = useState("profile"); // profile · visits · billing

  const loadPatientDetail = useCallback(async (uhidOrId) => {
    if (!uhidOrId) return;
    setDetailLoading(true);
    const ac = new AbortController();
    try {
      let patient = null;
      try {
        const r = await axios.get(`${API_ENDPOINTS.PATIENTS}/uhid/${encodeURIComponent(uhidOrId)}`, { signal: ac.signal });
        patient = r?.data?.data || r?.data;
      } catch {
        try {
          const r = await axios.get(`${API_ENDPOINTS.PATIENTS}/${uhidOrId}`, { signal: ac.signal });
          patient = r?.data?.data || r?.data;
        } catch (e) {
          if (!axios.isCancel(e)) console.error("[PatientLookup] patient lookup:", e?.message);
        }
      }
      if (!patient || ac.signal.aborted) return;
      setSelected(patient);

      const [opdRows, admRows, erRows, billRows, advData] = await Promise.all([
        loadOPDForPatient(patient._id, ac.signal),
        loadAdmissions(patient._id, patient.UHID, ac.signal),
        loadEmergencyForPatient(patient._id, ac.signal),
        loadBillsForUHID(patient.UHID, ac.signal),
        loadAdvancesForUHID(patient.UHID, ac.signal),
      ]);
      if (ac.signal.aborted) return;
      setOpd(Array.isArray(opdRows) ? opdRows : []);
      setAdm(Array.isArray(admRows) ? admRows : []);
      setEr(Array.isArray(erRows) ? erRows : []);
      setBills(Array.isArray(billRows) ? billRows : []);
      setAdvances(advData?.advances || []);
      setUnspentAdv(advData?.totalUnspent || 0);
    } finally {
      if (!ac.signal.aborted) setDetailLoading(false);
    }
    return () => ac.abort();
  }, []);

  useEffect(() => {
    if (urlUhid) loadPatientDetail(urlUhid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlUhid]);

  const pickPatient = (p) => {
    setSelected(p);
    loadPatientDetail(p.UHID);
    setDetailTab("profile");
  };

  /* ─── Idle-state directory (SEARCH view) ─────────────────────
   When the receptionist lands on /patient-search and hasn't typed
   anything yet, we still want to show them WHO's currently active
   (mirrors the ReceptionBilling pattern). Pill tabs filter by
   registrationType; today's patients float to the top because the
   backend now sorts by lastVisitDate DESC. */
  const [idleType, setIdleType]       = useState("OPD");
  const [idleRows, setIdleRows]       = useState([]);
  const [idleLoading, setIdleLoading] = useState(false);
  useEffect(() => {
    if (view !== "search") return;
    if (q.trim().length >= 2) return;  // user is actively searching
    const ac = new AbortController();
    setIdleLoading(true);
    const params = new URLSearchParams({ limit: "60" });
    if (idleType !== "ALL") params.set("registrationType", idleType);
    axios.get(`${API_ENDPOINTS.PATIENTS}?${params.toString()}`, { signal: ac.signal })
      .then(({ data }) => {
        if (ac.signal.aborted) return;
        const rows = data?.patients || data?.data || (Array.isArray(data) ? data : []);
        setIdleRows(Array.isArray(rows) ? rows : []);
      })
      .catch((e) => { if (!axios.isCancel(e)) console.warn("[PatientLookup] idle directory:", e?.message); })
      .finally(() => { if (!ac.signal.aborted) setIdleLoading(false); });
    return () => ac.abort();
  }, [view, q, idleType]);

  /* ─── Directory mode (paginated) ───────────────────────────── */
  const [dirRows,     setDirRows]     = useState([]);
  const [dirPage,     setDirPage]     = useState(1);
  const [dirType,     setDirType]     = useState("ALL");
  const [dirSearch,   setDirSearch]   = useState("");
  const [dirTotal,    setDirTotal]    = useState(0);
  const [dirLoading,  setDirLoading]  = useState(false);
  const DIR_LIMIT = 15;

  const loadDirectory = useCallback(async () => {
    if (view !== "directory") return;
    setDirLoading(true);
    const ac = new AbortController();
    try {
      const params = { page: dirPage, limit: DIR_LIMIT };
      if (dirSearch.trim()) params.q = dirSearch.trim();
      if (dirType !== "ALL") params.registrationType = dirType;
      const { data } = await axios.get(API_ENDPOINTS.PATIENTS, { params, signal: ac.signal });
      if (ac.signal.aborted) return;
      const rows = toArray(data?.data) .length ? toArray(data?.data)
                 : toArray(data?.patients).length ? toArray(data?.patients)
                 : toArray(data);
      const total = Number(data?.total) || Number(data?.count) || rows.length;
      setDirRows(rows);
      setDirTotal(total);
    } catch (e) {
      if (!axios.isCancel(e)) console.error("[PatientLookup] directory:", e?.message);
    } finally {
      if (!ac.signal.aborted) setDirLoading(false);
    }
    return () => ac.abort();
  }, [view, dirPage, dirType, dirSearch]);

  useEffect(() => {
    const cleanup = loadDirectory();
    return () => { if (typeof cleanup === "function") cleanup(); };
  }, [loadDirectory]);

  /* ─── Unified timeline rows ───────────────────────────────── */
  const timelineRows = useMemo(() => {
    const items = [];
    const opdArr = Array.isArray(opd) ? opd : [];
    const admArr = Array.isArray(adm) ? adm : [];
    const erArr  = Array.isArray(er)  ? er  : [];
    for (const v of opdArr) {
      items.push({
        key: `opd-${v._id}`, kind: "OPD",
        when:   v.visitDate || v.createdAt,
        title:  `OPD ${v.visitNumber || ""}`.trim(),
        token:  v.tokenNumber,
        doctor: docName(v.doctorId || v.consultantName),
        dept:   deptName(v.departmentId || v.department),
        complaint: v.chiefComplaint,
        duration:  v.complaintDuration,
        history:   v.historyOfPresentIllness,
        pastHx:    v.pastMedicalHistory,
        status:    v.status,
        vitalsStatus: v.vitalsStatus,
        raw: v,
      });
    }
    for (const a of admArr) {
      items.push({
        key: `adm-${a._id}`, kind: "IPD",
        when:   a.admissionDate || a.createdAt,
        title:  `${a.admissionType || "IPD"} ${a.admissionNumber || ""}`.trim(),
        doctor: a.attendingDoctor || docName(a.attendingDoctorId),
        dept:   a.department || deptName(a.departmentId),
        bed:    a.bedNumber,
        room:   a.roomNumber,
        complaint: a.reasonForAdmission,
        diagnosis: a.provisionalDiagnosis,
        status: a.status,
        dischargeDate: a.actualDischargeDate,
        condition: a.conditionOnDischarge,
        cost: a.totalCost,
        advance: a.advancePaid,
        estimated: a.estimatedCost,
        raw: a,
      });
    }
    for (const e of erArr) {
      items.push({
        key: `er-${e._id}`, kind: "Emergency",
        when:   e.visitDate || e.createdAt,
        title:  `Emergency ${e.visitNumber || ""}`.trim(),
        doctor: docName(e.doctorId),
        dept:   deptName(e.departmentId),
        complaint: e.chiefComplaint,
        triage: e.triageLevel,
        mlc:    e.isMLC,
        mlcNo:  e.mlcNumber,
        status: e.status,
        raw: e,
      });
    }
    items.sort((a, b) => new Date(b.when) - new Date(a.when));
    if (timelineFilter === "ALL") return items;
    return items.filter((i) => i.kind === timelineFilter);
  }, [opd, adm, er, timelineFilter]);

  const totals = useMemo(() => {
    const opdArr   = Array.isArray(opd)   ? opd   : [];
    const admArr   = Array.isArray(adm)   ? adm   : [];
    const erArr    = Array.isArray(er)    ? er    : [];
    const billsArr = Array.isArray(bills) ? bills : [];
    return {
      opd: opdArr.length,
      ipd: admArr.length,
      er:  erArr.length,
      bills: billsArr.length,
      outstanding: billsArr.reduce((s, b) => s + (Number(b.balanceAmount) || Number(b.balance) || 0), 0),
      paid:        billsArr.reduce((s, b) => s + (Number(b.totalPaid)     || Number(b.paidAmount) || 0), 0),
    };
  }, [opd, adm, er, bills]);

  /* ════════════════ RENDER ════════════════ */
  return (
    <div className="rx-page pl-page">

      {/* ── HIS-themed header bar ── */}
      <div className="rx-header">
        <div>
          <div className="rx-header-title">
            <i className="pi pi-id-card" /> Patient Lookup
          </div>
          <div className="rx-header-meta">
            Search · Directory · Visit Timeline · Billing — all in one window
          </div>
        </div>
        <div className="rx-header-actions">
          <div className="pl-view-switch" role="tablist" aria-label="View mode">
            <button
              role="tab"
              aria-selected={view === "search"}
              className={`pl-view-btn ${view === "search" ? "pl-view-btn--active" : ""}`}
              onClick={() => setView("search")}
            >
              <i className="pi pi-search" /> Search
            </button>
            <button
              role="tab"
              aria-selected={view === "directory"}
              className={`pl-view-btn ${view === "directory" ? "pl-view-btn--active" : ""}`}
              onClick={() => setView("directory")}
            >
              <i className="pi pi-table" /> Directory
            </button>
            <button
              role="tab"
              aria-selected={view === "timeline"}
              disabled={!selected}
              className={`pl-view-btn ${view === "timeline" ? "pl-view-btn--active" : ""}`}
              onClick={() => setView("timeline")}
            >
              <i className="pi pi-history" /> Timeline
            </button>
          </div>
        </div>
      </div>

      {/* ════════════════ SEARCH VIEW ════════════════ */}
      {view === "search" && (
        <>
          {/* ── Idle-state directory — visible whenever the cashier
              isn't actively searching for / viewing a specific patient.
              Same pill-tab pattern as ReceptionBilling so the staff
              sees who's checked in today (sort: lastVisitDate DESC
              then createdAt DESC, today-first). ── */}
          {q.trim().length < 2 && !selected && (
            <ActivePatientDirectory
              listType={idleType}
              setListType={setIdleType}
              rows={idleRows}
              loading={idleLoading}
              onPick={pickPatient}
            />
          )}

        <div className="pl-search-grid">
          {/* ── Search column ── */}
          <div className="rx-card pl-search-col">
            <div className="pl-col-head">
              <i className="pi pi-search" /> Live Search
              <span className="pl-col-meta">{results.length} result{results.length !== 1 ? "s" : ""}</span>
            </div>
            <div className="pl-col-body">
              <div className="rx-search">
                <i className="pi pi-search" />
                <input
                  autoFocus
                  type="text"
                  placeholder="Name, UHID, or phone (min 2 chars)"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
              </div>
              {searching && <div className="pl-hint">Searching…</div>}
              {!searching && q.trim().length >= 2 && results.length === 0 && (
                <div className="rx-empty">No patients match "{q}"</div>
              )}
              <div className="pl-result-list">
                {results.map((p) => {
                  const isSelected = selected?._id === p._id;
                  return (
                    <button
                      key={p._id}
                      onClick={() => pickPatient(p)}
                      className={`pl-result-card ${isSelected ? "pl-result-card--active" : ""}`}
                    >
                      <span className="pl-avatar">{initials(p.fullName)}</span>
                      <div className="pl-result-info">
                        <div className="pl-result-name">
                          {p.title ? `${p.title} ` : ""}{p.fullName}
                        </div>
                        <div className="pl-result-meta">
                          <span className="rx-mono-tag">{p.UHID}</span>
                          <span>{ageGenderLine(p)}</span>
                          {p.contactNumber && <span>{p.contactNumber}</span>}
                          {p.bloodGroup   && <span className="pl-bg">{p.bloodGroup}</span>}
                        </div>
                      </div>
                      {p.registrationType && (
                        <span className={`rx-pill rx-pill--${(p.registrationType || "").toLowerCase()}`}>
                          {p.registrationType}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* ── Selected patient column ── */}
          <PatientDetailPanel
            patient={selected}
            opd={opd} adm={adm} er={er} bills={bills}
            tab={detailTab} setTab={setDetailTab}
            timelineFilter={timelineFilter} setTimelineFilter={setTimelineFilter}
            timelineRows={timelineRows} totals={totals}
            loading={detailLoading}
            canNewVisit={canNewVisit}
            canEdit={canEdit}
            navigate={navigate}
            advancesList={advances}
            unspentAdv={unspentAdv}
            onTakeAdvance={() => setShowAdvDlg(true)}
            onApplyAdvance={async (advanceId, billId) => {
              try {
                await axios.post(`${API_ENDPOINTS.BASE}/billing/advance/${advanceId}/apply`, { billId });
                loadPatientDetail(selected.UHID);
              } catch (e) {
                window.alert(e?.response?.data?.message || "Apply failed");
              }
            }}
          />
        </div>
        </>
      )}

      {/* ════════════════ DIRECTORY VIEW ════════════════ */}
      {view === "directory" && (
        <>
          <div className="pl-dir-filters">
            <div className="rx-search pl-dir-search">
              <i className="pi pi-search" />
              <input
                type="text"
                placeholder="Search name / UHID / phone / email…"
                value={dirSearch}
                onChange={(e) => { setDirPage(1); setDirSearch(e.target.value); }}
              />
            </div>
            <select
              className="his-select pl-dir-type"
              value={dirType}
              onChange={(e) => { setDirPage(1); setDirType(e.target.value); }}
            >
              <option value="ALL">All Types</option>
              <option value="OPD">OPD</option>
              <option value="IPD">IPD</option>
              <option value="Emergency">Emergency</option>
              <option value="Daycare">Day Care</option>
            </select>
            <span className="pl-dir-total">{dirTotal} total</span>
          </div>

          <div className="rx-card pl-dir-card">
            {dirLoading ? (
              <div className="pl-hint pl-hint--pad">
                <i className="pi pi-spin pi-spinner" /> Loading…
              </div>
            ) : dirRows.length === 0 ? (
              <div className="rx-empty">
                <span className="rx-empty-icon">🔍</span>
                No patients found
              </div>
            ) : (
              <div className="rx-table-wrap pl-dir-tablewrap">
                <table className="rx-table">
                  <thead>
                    <tr>
                      <th>Patient</th>
                      <th>UHID</th>
                      <th>Age / Sex</th>
                      <th>Contact</th>
                      <th>Type</th>
                      <th>Doctor / Department</th>
                      <th>Payment</th>
                      <th className="pl-th-actions">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dirRows.map((p) => (
                      <tr key={p._id}>
                        <td>
                          <div className="pl-cell-name">
                            <span className="pl-avatar pl-avatar--sm">{initials(p.fullName)}</span>
                            <span>{p.title ? `${p.title} ` : ""}{p.fullName}</span>
                          </div>
                        </td>
                        <td><span className="rx-mono-tag">{p.UHID}</span></td>
                        <td>{ageGenderLine(p) || "—"}</td>
                        <td>
                          <div>{p.contactNumber || "—"}</div>
                          {p.email && <div className="pl-sub">{p.email}</div>}
                        </td>
                        <td>
                          {p.registrationType && (
                            <span className={`rx-pill rx-pill--${(p.registrationType || "").toLowerCase()}`}>
                              {p.registrationType}
                            </span>
                          )}
                        </td>
                        <td>
                          <div>{docName(p.doctor)}</div>
                          <div className="pl-sub">{deptName(p.department)}</div>
                        </td>
                        <td>
                          <span className="rx-mode-pill">{p.paymentType || "CASH"}</span>
                          {p.tpa && <div className="pl-sub">{p.tpa.tpaName || p.tpa.name || "TPA"}</div>}
                        </td>
                        <td className="pl-td-actions">
                          <button className="rx-action-btn rx-action-btn--primary"
                                  onClick={() => { pickPatient(p); setView("timeline"); }}>
                            <i className="pi pi-eye" /> Open
                          </button>
                          {canEdit && (
                            <button className="rx-action-btn"
                                    onClick={() => navigate(`/reception/register?uhid=${encodeURIComponent(p.UHID || "")}`)}>
                              <i className="pi pi-pencil" /> Edit
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {dirTotal > DIR_LIMIT && (
            <div className="pl-pager">
              <button className="rx-action-btn"
                      onClick={() => setDirPage(Math.max(1, dirPage - 1))} disabled={dirPage === 1}>
                <i className="pi pi-chevron-left" /> Prev
              </button>
              <span className="pl-pager-meta">
                Page {dirPage} of {Math.max(1, Math.ceil(dirTotal / DIR_LIMIT))}
              </span>
              <button className="rx-action-btn"
                      onClick={() => setDirPage(dirPage + 1)} disabled={dirPage * DIR_LIMIT >= dirTotal}>
                Next <i className="pi pi-chevron-right" />
              </button>
            </div>
          )}
        </>
      )}

      {/* ════════════════ TIMELINE VIEW ════════════════ */}
      {view === "timeline" && (
        <PatientDetailPanel
          patient={selected}
          opd={opd} adm={adm} er={er} bills={bills}
          tab={detailTab} setTab={setDetailTab}
          timelineFilter={timelineFilter} setTimelineFilter={setTimelineFilter}
          timelineRows={timelineRows} totals={totals}
          loading={detailLoading}
          canNewVisit={canNewVisit}
          canEdit={canEdit}
          navigate={navigate}
          advancesList={advances}
          unspentAdv={unspentAdv}
          onTakeAdvance={() => setShowAdvDlg(true)}
          onApplyAdvance={async (advanceId, billId) => {
            try {
              await axios.post(`${API_ENDPOINTS.BASE}/billing/advance/${advanceId}/apply`, { billId });
              loadPatientDetail(selected.UHID);
            } catch (e) {
              window.alert(e?.response?.data?.message || "Apply failed");
            }
          }}
          fullWidth
          emptyHint={!selected && (
            <div className="rx-empty">
              <span className="rx-empty-icon">🔍</span>
              No patient selected.{" "}
              <button className="rx-action-btn rx-action-btn--primary pl-empty-cta"
                      onClick={() => setView("search")}>
                Search for a patient →
              </button>
            </div>
          )}
        />
      )}

      {/* ── TAKE-ADVANCE MODAL ─────────────────────────────────────── */}
      {showAdvDlg && selected && (
        <TakeAdvanceModal
          patient={selected}
          onClose={() => setShowAdvDlg(false)}
          onSaved={() => {
            setShowAdvDlg(false);
            loadPatientDetail(selected.UHID);
          }}
        />
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   DETAIL PANEL — Profile / Visits / Billing tabs
   Shows ALL backend fields per audit requirement.
══════════════════════════════════════════════════════════════ */
function PatientDetailPanel({
  patient, opd, adm, er, bills, tab, setTab,
  timelineFilter, setTimelineFilter, timelineRows, totals, loading,
  canNewVisit, canEdit, navigate, fullWidth, emptyHint,
  advancesList = [], unspentAdv = 0, onTakeAdvance, onApplyAdvance,
}) {
  if (!patient && emptyHint) return emptyHint;
  if (!patient) {
    return (
      <div className={`rx-card pl-detail-card ${fullWidth ? "pl-detail-card--full" : ""}`}>
        <div className="rx-empty pl-empty">
          <i className="pi pi-id-card pl-empty-icon" />
          <div>Select a patient on the left to see their profile, visits, and billing.</div>
        </div>
      </div>
    );
  }
  return (
    <div className={`rx-card pl-detail-card ${fullWidth ? "pl-detail-card--full" : ""}`}>
      {/* ── Identity strip ── */}
      <div className="pl-id-strip">
        <span className="pl-avatar pl-avatar--lg">{initials(patient.fullName)}</span>
        <div className="pl-id-main">
          <div className="pl-id-name">
            {patient.title ? `${patient.title} ` : ""}{patient.fullName}
            {patient.isMLC && <span className="rx-pill rx-pill--mlc">MLC{patient.mlcNumber ? ` · ${patient.mlcNumber}` : ""}</span>}
          </div>
          <div className="pl-id-meta">
            <span className="rx-mono-tag">{patient.UHID}</span>
            <span>{ageGenderLine(patient) || "—"}</span>
            {patient.contactNumber && <span><i className="pi pi-phone" /> {patient.contactNumber}</span>}
            {patient.bloodGroup    && <span className="pl-bg">{patient.bloodGroup}</span>}
            {patient.registrationType && (
              <span className={`rx-pill rx-pill--${(patient.registrationType || "").toLowerCase()}`}>
                {patient.registrationType}
              </span>
            )}
          </div>
        </div>
        <div className="pl-id-actions">
          {canNewVisit && (
            <button className="rx-action-btn rx-action-btn--primary"
                    onClick={() => navigate(`/reception/register?uhid=${encodeURIComponent(patient.UHID || "")}`)}>
              <i className="pi pi-plus" /> New Visit
            </button>
          )}
          {canNewVisit && onTakeAdvance && (
            <button className="rx-action-btn"
                    onClick={onTakeAdvance}
                    title="Take cash / UPI / card deposit before bills are generated">
              <i className="pi pi-wallet" /> Take Advance
            </button>
          )}
          <button className="rx-action-btn"
                  onClick={() => navigate(`/reception-billing?uhid=${encodeURIComponent(patient.UHID || "")}`)}>
            <i className="pi pi-receipt" /> Billing
          </button>
          {canEdit && (
            <button className="rx-action-btn"
                    onClick={() => navigate(`/reception/register?uhid=${encodeURIComponent(patient.UHID || "")}`)}>
              <i className="pi pi-pencil" /> Edit
            </button>
          )}
        </div>
      </div>

      {/* ── Quick KPIs ── */}
      <div className="rx-kpis pl-kpis">
        <div className="rx-kpi">
          <span className="rx-kpi-label">OPD</span>
          <span className="rx-kpi-value">{totals.opd}</span>
        </div>
        <div className="rx-kpi">
          <span className="rx-kpi-label">IPD</span>
          <span className="rx-kpi-value">{totals.ipd}</span>
        </div>
        <div className="rx-kpi">
          <span className="rx-kpi-label">ER</span>
          <span className="rx-kpi-value">{totals.er}</span>
        </div>
        <div className="rx-kpi">
          <span className="rx-kpi-label">Bills</span>
          <span className="rx-kpi-value">{totals.bills}</span>
          {totals.paid > 0 && <span className="rx-kpi-sub">Paid {fmtCur(totals.paid)}</span>}
        </div>
        {totals.outstanding > 0 && (
          <div className="rx-kpi pl-kpi-due">
            <span className="rx-kpi-label">Outstanding</span>
            <span className="rx-kpi-value">{fmtCur(totals.outstanding)}</span>
          </div>
        )}
        {unspentAdv > 0 && (
          <div className="rx-kpi pl-kpi-credit"
               title="Advance deposit on file — applicable to upcoming bills">
            <span className="rx-kpi-label">Advance Credit</span>
            <span className="rx-kpi-value">{fmtCur(unspentAdv)}</span>
            <span className="rx-kpi-sub">{advancesList?.filter?.((a) => (a.remainingAmount || 0) > 0).length} deposit{advancesList?.filter?.((a) => (a.remainingAmount || 0) > 0).length === 1 ? "" : "s"}</span>
          </div>
        )}
      </div>

      {/* ── Detail tabs ── */}
      <div className="rx-tabs pl-detail-tabs">
        <button
          className={`rx-tab ${tab === "profile" ? "rx-tab--active" : ""}`}
          onClick={() => setTab("profile")}>
          <i className="pi pi-id-card" /> Profile
        </button>
        <button
          className={`rx-tab ${tab === "visits" ? "rx-tab--active" : ""}`}
          onClick={() => setTab("visits")}>
          <i className="pi pi-history" /> Visits <span className="rx-tab-count">{timelineRows.length}</span>
        </button>
        <button
          className={`rx-tab ${tab === "billing" ? "rx-tab--active" : ""}`}
          onClick={() => setTab("billing")}>
          <i className="pi pi-receipt" /> Billing <span className="rx-tab-count">{totals.bills}</span>
        </button>
      </div>

      <div className="pl-tab-body">
        {loading && <div className="pl-hint pl-hint--pad"><i className="pi pi-spin pi-spinner" /> Loading…</div>}

        {!loading && tab === "profile" && <ProfileBody patient={patient} />}

        {!loading && tab === "visits" && (
          <>
            <div className="pl-tl-filter">
              {TIMELINE_TABS.map((t) => (
                <button
                  key={t.key}
                  className={`pl-tl-chip ${timelineFilter === t.key ? "pl-tl-chip--active" : ""}`}
                  onClick={() => setTimelineFilter(t.key)}
                >
                  <i className={`pi ${t.icon}`} /> {t.label}
                </button>
              ))}
            </div>
            {timelineRows.length === 0 ? (
              <div className="rx-empty">No visits in this filter</div>
            ) : (
              <div className="rx-timeline pl-timeline">
                {timelineRows.map((r) => <TimelineCard key={r.key} r={r} />)}
              </div>
            )}
          </>
        )}

        {!loading && tab === "billing" && (
          <BillingBody
            patient={patient}
            bills={bills}
            advancesList={advancesList}
            unspentAdv={unspentAdv}
            onApplyAdvance={onApplyAdvance}
          />
        )}
      </div>
    </div>
  );
}

/* ─── Profile body — every backend field on the patient master ── */
function ProfileBody({ patient }) {
  return (
    <div className="pl-profile-grid">
      <Section title="Personal">
        <Field label="DOB" value={fmtDate(patient.dateOfBirth)} />
        <Field label="Marital Status" value={patient.maritalStatus || "—"} />
        <Field label="Father / Guardian" value={patient.fatherName || "—"} />
        <Field label="Mother" value={patient.motherName || "—"} />
        <Field label="Occupation" value={patient.occupation || "—"} />
        <Field label="Nationality" value={patient.nationality || "Indian"} />
      </Section>
      <Section title="Contact">
        <Field label="Phone" value={patient.contactNumber || "—"} />
        <Field label="Alt Phone" value={patient.alternateContact || "—"} />
        <Field label="Email" value={patient.email || "—"} />
        <Field full label="Address" value={fullAddr(patient.address)} />
      </Section>
      <Section title="Medical">
        <Field label="Blood Group" value={patient.bloodGroup || "—"} />
        <Field full label="Known Allergies" value={patient.knownAllergies || "None known"} />
        <Field full label="Chronic Conditions" value={patient.chronicConditions || patient.knownConditions || "—"} />
      </Section>
      <Section title="Visit / Care Team">
        <Field label="Registration Type" value={patient.registrationType || "—"} />
        <Field label="Department" value={deptName(patient.department)} />
        <Field label="Primary Doctor" value={docName(patient.doctor)} />
        <Field label="Total OPD" value={String(patient.totalOPDVisits ?? "—")} />
        <Field label="Total IPD" value={String(patient.totalIPDVisits ?? "—")} />
        <Field label="Last Visit" value={fmtDate(patient.lastVisitDate)} />
      </Section>
      <Section title="Payment & Insurance">
        <Field label="Payment Type" value={patient.paymentType || "CASH"} />
        {patient.tpa && (
          <>
            <Field label="TPA" value={patient.tpa.tpaName || patient.tpa.name || "—"} />
            <Field label="TPA Code" value={patient.tpa.tpaCode || "—"} />
            <Field label="Policy / Card #" value={patient.tpaCardNumber || patient.policyNumber || "—"} />
          </>
        )}
        {patient.isMLC && (
          <Field label="MLC Number" value={patient.mlcNumber || "—"} />
        )}
      </Section>
      <Section title="Companion / Emergency Contact">
        <Field label="Name" value={patient.companionName || "—"} />
        <Field label="Relationship" value={patient.companionRelationship || "—"} />
        <Field label="Phone" value={patient.companionContact || "—"} />
      </Section>
      <Section title="System">
        <Field label="Registered" value={fmtDateTime(patient.createdAt)} />
        <Field label="Last Updated" value={fmtDateTime(patient.updatedAt)} />
        <Field label="Patient ID" value={<span className="rx-mono-tag rx-mono-tag--subtle">{patient._id}</span>} />
      </Section>
    </div>
  );
}

/* ─── Billing body — full bill + payment ledger + advance section ── */
function BillingBody({ bills, advancesList = [], unspentAdv = 0, onApplyAdvance, patient }) {
  const list = Array.isArray(bills) ? bills : [];
  const unspentAdvances = (advancesList || []).filter((a) => (a.remainingAmount || 0) > 0);

  // ── Advance section — visible whenever the patient has unspent
  //    deposits OR has any advance history (so refunded/applied
  //    advances stay traceable too).
  const advanceSection = (advancesList && advancesList.length > 0) ? (
    <div className="pl-advance-panel">
      <div className="pl-advance-head">
        <i className="pi pi-wallet" /> Advance Deposits
        <span className="pl-advance-unspent">
          {unspentAdv > 0 ? `Available: ${fmtCur(unspentAdv)}` : "Fully applied"}
        </span>
      </div>
      {advancesList.map((a) => (
        <div key={a._id} className={`pl-advance-row pl-advance-row--${(a.status || "").toLowerCase()}`}>
          <div className="pl-advance-line">
            <span className="rx-mono-tag">{a.receiptNumber || "ADV"}</span>
            <span className="rx-mode-pill">{a.paymentMode}</span>
            {a.transactionId && <span className="rx-mono-tag rx-mono-tag--subtle">{a.transactionId}</span>}
            <span className="pl-pay-by">by {a.receivedBy}</span>
            <span className="pl-advance-amt">
              {fmtCur(a.amount)}
              {a.remainingAmount > 0 && a.remainingAmount < a.amount && (
                <span className="pl-advance-rem"> ({fmtCur(a.remainingAmount)} left)</span>
              )}
            </span>
            {/* Reprint button — admin / cashier can reprint at any time
                (e.g. patient asks for a duplicate copy). Hidden for
                refunded / cancelled rows since their receipt is no
                longer valid evidence of held money. */}
            {patient && a.status !== "REFUNDED" && a.status !== "CANCELLED" && (
              <button
                type="button"
                className="pl-advance-print"
                title={`Reprint receipt ${a.receiptNumber}`}
                onClick={(e) => { e.stopPropagation(); printAdvanceReceipt(a, patient); }}
              >
                <i className="pi pi-print" />
              </button>
            )}
          </div>
          <div className="pl-advance-meta">
            {fmtDateTime(a.paidAt)} · status: <strong>{a.status}</strong>
            {a.appliedTo?.length > 0 && ` · applied to ${a.appliedTo.map((x) => x.billNumber).join(", ")}`}
            {a.remarks && ` · ${a.remarks}`}
          </div>
        </div>
      ))}
    </div>
  ) : null;

  if (list.length === 0) {
    return (
      <>
        {advanceSection}
        <div className="rx-empty">
          <span className="rx-empty-icon">🧾</span>
          No bills on file
        </div>
      </>
    );
  }
  return (
    <>
      {advanceSection}
      <div className="pl-bills">
        {list.map((b) => {
          const balance = Number(b.balanceAmount) || Number(b.balance) || 0;
          const total   = Number(b.netAmount)     || Number(b.totalAmount) || 0;
          const paid    = Number(b.totalPaid)     || Number(b.paidAmount)  || (total - balance);
          const canApply = balance > 0 && unspentAdvances.length > 0 && b.billStatus !== "DRAFT";
          return (
            <div key={b._id} className="pl-bill-card">
              <div className="pl-bill-head">
                <div>
                  <div className="pl-bill-num">
                    <i className="pi pi-receipt" /> {b.billNumber}
                    <span className={`rx-pill rx-pill--${(b.visitType || "").toLowerCase()}`}>{b.visitType}</span>
                  </div>
                  <div className="pl-bill-sub">{fmtDateTime(b.billDate || b.createdAt)}</div>
                </div>
                <span className={`pl-bill-status pl-bill-status--${(b.billStatus || "").toLowerCase()}`}>
                  {b.billStatus}
                </span>
              </div>
              <div className="pl-bill-rows">
                <BillRow label="Gross"     v={b.grossAmount} />
                <BillRow label="Discount"  v={b.totalDiscount} discount />
                <BillRow label="Tax (GST)" v={b.totalTax || b.taxAmount} />
                <BillRow label="Net"       v={total} bold />
                <BillRow label="Paid"      v={paid} success />
                {balance > 0 && <BillRow label="Outstanding" v={balance} due />}
              </div>
              {Array.isArray(b.payments) && b.payments.length > 0 && (
                <div className="pl-payments">
                  <div className="pl-payments-head">
                    <i className="pi pi-wallet" /> Payment ledger
                  </div>
                  {b.payments.map((p, i) => (
                    <div key={p._id || i} className="pl-pay-row">
                      <span>{fmtDate(p.paymentDate || p.createdAt)}</span>
                      <span className="rx-mode-pill">{p.paymentMode || "CASH"}</span>
                      {p.transactionId && <span className="rx-mono-tag rx-mono-tag--subtle">{p.transactionId}</span>}
                      {p.receivedBy && <span className="pl-pay-by">by {p.receivedBy}</span>}
                      <span className="pl-pay-amt">{fmtCur(p.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
              {canApply && onApplyAdvance && (
                <div className="pl-bill-apply">
                  <button
                    className="rx-action-btn rx-action-btn--primary"
                    onClick={() => {
                      // Auto-pick the oldest unspent advance (FIFO) for the
                      // typical case. A future enhancement could open a picker.
                      const adv = unspentAdvances[unspentAdvances.length - 1] || unspentAdvances[0];
                      if (adv) onApplyAdvance(adv._id, b._id);
                    }}
                    title="Apply oldest advance deposit to this bill (FIFO)"
                  >
                    <i className="pi pi-arrow-circle-down" /> Apply Advance ({fmtCur(unspentAdv)} available)
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

/* ─── Timeline card — full backend fields per visit kind ───── */
function TimelineCard({ r }) {
  const cls = r.kind === "OPD" ? "opd" : r.kind === "IPD" ? "ipd" : "emergency";
  return (
    <div className={`rx-tl-item rx-tl-item--${cls} pl-tl-card`}>
      <div className="rx-tl-head">
        <span className="rx-tl-date">{fmtDateTime(r.when)}</span>
        <span className={`rx-tl-type rx-tl-type--${cls}`}>{r.kind}</span>
        {r.status && <span className="pl-tl-status">{r.status}</span>}
      </div>
      <div className="rx-tl-meta">
        <strong>{r.title}</strong>
        {" · "}{r.doctor}
        {" · "}{r.dept}
        {r.bed  && <> · Bed {r.bed}{r.room ? ` (${r.room})` : ""}</>}
        {r.token != null && <> · Token #{r.token}</>}
        {r.triage && <> · Triage {r.triage}</>}
        {r.mlc && <> · <span className="rx-pill rx-pill--mlc">MLC{r.mlcNo ? ` ${r.mlcNo}` : ""}</span></>}
      </div>
      {r.complaint && (
        <div className="pl-tl-row">
          <span className="pl-tl-key">Complaint</span>
          <span>{r.complaint}{r.duration ? ` · ${r.duration}` : ""}</span>
        </div>
      )}
      {r.diagnosis && (
        <div className="pl-tl-row">
          <span className="pl-tl-key">Diagnosis</span>
          <span>{r.diagnosis}</span>
        </div>
      )}
      {r.history && (
        <div className="pl-tl-row">
          <span className="pl-tl-key">HoPI</span>
          <span>{r.history}</span>
        </div>
      )}
      {r.pastHx && (
        <div className="pl-tl-row">
          <span className="pl-tl-key">Past Hx</span>
          <span>{r.pastHx}</span>
        </div>
      )}
      {r.kind === "IPD" && (
        <div className="pl-tl-row pl-tl-row--cost">
          {r.estimated != null && <span><span className="pl-tl-key">Est</span> {fmtCur(r.estimated)}</span>}
          {r.advance   != null && <span><span className="pl-tl-key">Advance</span> {fmtCur(r.advance)}</span>}
          {r.cost      != null && <span><span className="pl-tl-key">Final</span> {fmtCur(r.cost)}</span>}
          {r.dischargeDate && <span><span className="pl-tl-key">DC</span> {fmtDate(r.dischargeDate)}</span>}
          {r.condition && <span><span className="pl-tl-key">Cond.</span> {r.condition}</span>}
        </div>
      )}
      {r.kind === "OPD" && r.vitalsStatus && (
        <div className="pl-tl-row">
          <span className="pl-tl-key">Vitals</span>
          <span>{r.vitalsStatus}</span>
        </div>
      )}
    </div>
  );
}

/* ─── Small atoms ─────────────────────────────────────────── */
function Section({ title, children }) {
  return (
    <div className="pl-section">
      <div className="pl-section-title">{title}</div>
      <div className="pl-section-body">{children}</div>
    </div>
  );
}
function Field({ label, value, full }) {
  return (
    <div className={`pl-field${full ? " pl-field--full" : ""}`}>
      <div className="pl-field-label">{label}</div>
      <div className="pl-field-value">{value || "—"}</div>
    </div>
  );
}
function BillRow({ label, v, bold, success, due, discount }) {
  if (v == null || Number(v) === 0) return null;
  const cls = [
    "pl-billrow",
    bold && "pl-billrow--bold",
    success && "pl-billrow--success",
    due && "pl-billrow--due",
    discount && "pl-billrow--discount",
  ].filter(Boolean).join(" ");
  return (
    <div className={cls}>
      <span>{label}</span>
      <span>{fmtCur(v)}</span>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Helper: open /print/advance-receipt in a popup with the payload
   pre-loaded in sessionStorage. Matches the contract documented in
   PrintRouterPage.jsx — sessionStorage["printPayload-<slug>"] is
   the canonical channel for large payloads.
═══════════════════════════════════════════════════════════════ */
function printAdvanceReceipt(advance, patient) {
  if (!advance || !patient) return;
  const payload = {
    receiptNo:    advance.receiptNumber,
    patientName:  [patient.title, patient.fullName].filter(Boolean).join(" "),
    uhid:         patient.UHID,
    ipdNo:        advance.admission?.admissionNumber || null,
    admissionDate: advance.admission?.admissionDate || null,
    bedNumber:    null,
    wardName:     null,
    date:         advance.paidAt || advance.createdAt || new Date().toISOString(),
    amount:       Number(advance.amount?.$numberDecimal ?? advance.amount) || 0,
    method:       advance.paymentMode,
    refNo:        advance.transactionId,
    depositPurpose: advance.remarks || "hospitalization advance",
    estimatedCost: advance.estimatedCost || null,
  };
  try {
    sessionStorage.setItem(`printPayload-advance-receipt`, JSON.stringify(payload));
  } catch (e) {
    console.error("[print] sessionStorage write failed:", e?.message);
  }
  // Open in a new window so the existing app session stays open
  // behind the print dialog. Width/height match the printable's A5
  // default layout — toolbar lets the user upsize to A4 if needed.
  window.open("/print/advance-receipt", "_blank", "noopener,noreferrer,width=900,height=1100");
}

/* ═══════════════════════════════════════════════════════════════
   TakeAdvanceModal — cash/UPI/card deposit before bills exist
   Posts to /api/billing/advance and refreshes the parent panel.
═══════════════════════════════════════════════════════════════ */
function TakeAdvanceModal({ patient, onClose, onSaved }) {
  const [amount,        setAmount]        = useState("");
  const [paymentMode,   setPaymentMode]   = useState("CASH");
  const [transactionId, setTransactionId] = useState("");
  const [bankName,      setBankName]      = useState("");
  const [remarks,       setRemarks]       = useState("");
  const [saving,        setSaving]        = useState(false);
  const [err,           setErr]           = useState(null);
  const [savedAdv,      setSavedAdv]      = useState(null);   // set once POST returns

  const submit = async () => {
    const amt = Number(amount);
    if (!amt || amt <= 0) { setErr("Enter a valid amount"); return; }
    if (paymentMode !== "CASH" && !transactionId) {
      setErr(`Transaction reference required for ${paymentMode}`);
      return;
    }
    setErr(null);
    setSaving(true);
    try {
      const { data } = await axios.post(`${API_ENDPOINTS.BASE}/billing/advance`, {
        UHID: patient.UHID,
        amount: amt,
        paymentMode,
        transactionId: transactionId || null,
        bankName:      bankName      || null,
        remarks:       remarks       || null,
      });
      // Switch modal into success state so the cashier can either
      // print immediately or close + take the next deposit. The parent
      // is NOT notified yet — onSaved fires when user clicks Done so
      // the lookup panel only refreshes after they've moved on.
      setSavedAdv(data?.data || null);
    } catch (e) {
      setErr(e?.response?.data?.message || e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  // ── Success state — receipt summary + print button ───────────────
  if (savedAdv) {
    const amt = Number(savedAdv.amount?.$numberDecimal ?? savedAdv.amount) || 0;
    return (
      <div className="pl-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) { onSaved && onSaved(); } }}>
        <div className="pl-modal" role="dialog" aria-label="Advance saved">
          <div className="pl-modal-head pl-modal-head--success">
            <i className="pi pi-check-circle" /> Advance Received
            <button className="pl-modal-close" onClick={() => onSaved && onSaved()} aria-label="Close">✕</button>
          </div>
          <div className="pl-modal-body">
            <div className="pl-success-card">
              <div className="pl-success-rno">{savedAdv.receiptNumber}</div>
              <div className="pl-success-amt">₹{amt.toLocaleString("en-IN")}</div>
              <div className="pl-success-meta">
                {savedAdv.paymentMode}
                {savedAdv.transactionId ? ` · ref ${savedAdv.transactionId}` : ""}
              </div>
              <div className="pl-success-meta">
                from {patient.title ? patient.title + " " : ""}{patient.fullName} ({patient.UHID})
              </div>
            </div>
            <div className="pl-modal-info">
              <i className="pi pi-info-circle" /> This credit is now on the UHID with status
              <strong> ACTIVE</strong>. It auto-applies to future bills via the
              "Apply Advance" button on each bill card.
            </div>
          </div>
          <div className="pl-modal-foot">
            <button className="rx-action-btn" onClick={() => onSaved && onSaved()}>
              Done
            </button>
            <button
              className="rx-action-btn rx-action-btn--primary"
              onClick={() => {
                printAdvanceReceipt(savedAdv, patient);
                // keep the modal open so the cashier can click again
                // if the popup blocker swallowed the first try.
              }}
            >
              <i className="pi pi-print" /> Print Receipt
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="pl-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pl-modal" role="dialog" aria-label="Take advance deposit">
        <div className="pl-modal-head">
          <i className="pi pi-wallet" /> Take Advance Deposit
          <button className="pl-modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="pl-modal-body">
          <div className="pl-advance-patient">
            <div><strong>{patient.title ? `${patient.title} ` : ""}{patient.fullName}</strong></div>
            <div className="pl-bill-sub">{patient.UHID} · {patient.contactNumber || "no phone"}</div>
          </div>

          <div className="pl-modal-grid">
            <div className="pl-field">
              <div className="pl-field-label">Amount (₹) *</div>
              <input
                type="number"
                min="1"
                className="pl-modal-input"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="e.g. 10000"
                autoFocus
              />
            </div>
            <div className="pl-field">
              <div className="pl-field-label">Payment Mode *</div>
              <select
                className="pl-modal-input"
                value={paymentMode}
                onChange={(e) => setPaymentMode(e.target.value)}
              >
                <option value="CASH">CASH</option>
                <option value="UPI">UPI</option>
                <option value="CARD">CARD</option>
                <option value="CHEQUE">CHEQUE</option>
                <option value="ONLINE">ONLINE</option>
              </select>
            </div>
            {paymentMode !== "CASH" && (
              <div className="pl-field pl-field--full">
                <div className="pl-field-label">
                  {paymentMode === "CHEQUE" ? "Cheque No" : paymentMode === "CARD" ? "Card Auth / Last 4" : "Transaction Reference"} *
                </div>
                <input
                  className="pl-modal-input"
                  value={transactionId}
                  onChange={(e) => setTransactionId(e.target.value)}
                  placeholder={paymentMode === "UPI" ? "UPI ref id (12 digits)" : ""}
                />
              </div>
            )}
            {(paymentMode === "CHEQUE" || paymentMode === "ONLINE") && (
              <div className="pl-field pl-field--full">
                <div className="pl-field-label">Bank Name</div>
                <input
                  className="pl-modal-input"
                  value={bankName}
                  onChange={(e) => setBankName(e.target.value)}
                  placeholder="e.g. HDFC, SBI"
                />
              </div>
            )}
            <div className="pl-field pl-field--full">
              <div className="pl-field-label">Remarks</div>
              <input
                className="pl-modal-input"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="e.g. IPD admission deposit"
              />
            </div>
          </div>

          {err && <div className="pl-modal-err">{err}</div>}

          <div className="pl-modal-info">
            <i className="pi pi-info-circle" /> Deposit will land on this patient's UHID as
            <strong> ADV-YYYY-NNNNNN</strong> with status <strong>ACTIVE</strong>. It
            auto-applies to bills via the "Apply Advance" button until the credit is exhausted.
            Refund is gated to Accountant/Admin.
          </div>
        </div>
        <div className="pl-modal-foot">
          <button className="rx-action-btn" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            className="rx-action-btn rx-action-btn--primary"
            onClick={submit}
            disabled={saving || !amount || Number(amount) <= 0}
          >
            <i className="pi pi-check" /> {saving ? "Saving…" : "Save Deposit"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   ActivePatientDirectory — pill-tab strip + card grid for the
   idle state of the SEARCH view. Mirrors ReceptionBilling's
   PatientDirectory so /reception-billing and /patient-search feel
   like the same desk.
   ═══════════════════════════════════════════════════════════════ */
function ActivePatientDirectory({ listType, setListType, rows, loading, onPick }) {
  const TYPES = [
    { key: "OPD",       label: "OPD",        icon: "pi-user-plus", color: "#06b6d4" },
    { key: "IPD",       label: "IPD",        icon: "pi-home",      color: "#7c3aed" },
    { key: "Daycare",   label: "Day Care",   icon: "pi-sun",       color: "#d97706" },
    { key: "Emergency", label: "Emergency",  icon: "pi-bolt",      color: "#dc2626" },
    { key: "Services",  label: "Services",   icon: "pi-cog",       color: "#0e7490" },
    { key: "ALL",       label: "All Types",  icon: "pi-list",      color: "#475569" },
  ];

  // Today-first detection — backend already sorts by lastVisitDate
  // DESC then createdAt DESC, but we tag each row visually so the
  // staff can see at a glance who walked in TODAY vs older active
  // patients. Compares the local-date portion of either field.
  const isToday = (p) => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const d = new Date(p?.lastVisitDate || p?.registrationDate || p?.createdAt || 0);
    if (Number.isNaN(d.getTime())) return false;
    d.setHours(0, 0, 0, 0);
    return d.getTime() === today.getTime();
  };

  const todayCount = rows.filter(isToday).length;

  return (
    <div className="pl-idle-dir">
      {/* Tab strip */}
      <div className="pl-idle-tabs">
        {TYPES.map(t => {
          const active = listType === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setListType(t.key)}
              className={`pl-idle-tab ${active ? "pl-idle-tab--active" : ""}`}
              data-color={t.color}
              style={active ? { background: `linear-gradient(135deg, ${t.color}, ${t.color}dd)` } : undefined}
            >
              <i className={`pi ${t.icon}`} /> {t.label}
            </button>
          );
        })}
        <span className="pl-idle-count">
          {loading ? "Loading…" : (
            <>
              <strong>{rows.length}</strong> patient{rows.length === 1 ? "" : "s"}
              {todayCount > 0 && <> · <span className="pl-idle-today-count">{todayCount} today</span></>}
            </>
          )}
        </span>
      </div>

      {/* Grid */}
      {loading && rows.length === 0 ? (
        <div className="rx-empty"><i className="pi pi-spin pi-spinner rx-loader-icon" /></div>
      ) : rows.length === 0 ? (
        <div className="rx-empty">
          <span className="rx-empty-icon">👥</span>
          No active {listType === "ALL" ? "" : listType} patients yet today.
        </div>
      ) : (
        <div className="pl-idle-grid">
          {rows.map(p => {
            const today = isToday(p);
            return (
              <button
                key={p._id}
                onClick={() => onPick(p)}
                className={`pl-idle-card ${today ? "pl-idle-card--today" : ""}`}
                title={`Open ${p.fullName} (${p.UHID})`}
              >
                {today && <span className="pl-idle-badge">TODAY</span>}
                <div className="pl-idle-avatar">
                  {String(p.fullName || "?").trim().split(/\s+/).slice(0,2).map(x => x[0] || "").join("").toUpperCase()}
                </div>
                <div className="pl-idle-info">
                  <div className="pl-idle-name">
                    {p.title ? `${p.title} ` : ""}{p.fullName}
                  </div>
                  <div className="pl-idle-meta">
                    <span className="rx-mono-tag rx-mono-tag--subtle">{p.UHID}</span>
                    {p.contactNumber && <span>📱 {p.contactNumber}</span>}
                  </div>
                  <div className="pl-idle-sub">
                    {p.age != null && `${p.age}y · `}{p.gender || ""}
                    {p.lastVisitDate && ` · Last visit ${new Date(p.lastVisitDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}`}
                  </div>
                </div>
                {p.registrationType && (
                  <span className="rx-mode-pill pl-idle-pill">{p.registrationType}</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
