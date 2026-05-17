/**
 * PatientLookupPage.jsx — unified patient search, directory, history & billing
 *
 * Replaces and aliases 4 previously-separate pages:
 *   /patient-search      (Receptionist — live name lookup → side panel)
 *   /visit-history       (Receptionist — UHID → timeline + billing)
 *   /allpatient          (Doctor/Nurse/Admin — paginated directory table)
 *   /patient-history     (Doctor/Nurse/Admin — search → clinical timeline)
 *
 * Everything those 4 pages did is now reachable here without leaving the
 * window. The component picks a sensible initial view based on user role
 * (Receptionist → search; clinical → directory; with `?uhid=` → timeline)
 * but the user can switch via the view-tab strip at any time.
 *
 * DB integrity: every backend route this page calls is exactly the same
 * route the legacy 4 pages already used — `/api/patients/search`,
 * `/api/patients/uhid/:uhid`, `/api/admissions`, `/api/opd/patient/:id`,
 * `/api/emergency/patient/:id`, `/api/billing/uhid/:uhid`. No schema
 * changes, no new endpoints; this is a frontend-only consolidation.
 */

import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useNavigate, useSearchParams, useParams } from "react-router-dom";
import axios from "axios";
import { toast } from "react-toastify";
import { API_ENDPOINTS } from "../../config/api";
import { useAuth } from "../../context/AuthContext";
import "../reception/reception-shared.css";

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
  if (typeof d === "string") return d;
  const pi = d.personalInfo || {};
  const full = pi.fullName || [pi.firstName, pi.lastName].filter(Boolean).join(" ");
  return full ? `Dr. ${full}` : d.name || "—";
};
const deptName = (d) => {
  if (!d) return "—";
  if (typeof d === "string") return d;
  return d.departmentName || d.name || "—";
};

const TIMELINE_TABS = [
  { key: "ALL",       label: "All",       icon: "pi-history" },
  { key: "OPD",       label: "OPD",       icon: "pi-user-plus" },
  { key: "IPD",       label: "IPD",       icon: "pi-home" },
  { key: "Emergency", label: "Emergency", icon: "pi-bolt" },
];

/* ─── Cross-route timeline loaders ─────────────────────────────
   These mirror the loader logic the legacy PatientHistoryPage used
   so the response shape parity stays intact. */
async function loadAdmissions(patientId, uhid, signal) {
  const BASE = API_ENDPOINTS.ADMISSIONS;
  const extract = (r) => {
    const d = r?.data?.admissions || r?.data?.data || r?.data;
    return Array.isArray(d) ? d : null;
  };
  try {
    const r = await axios.get(BASE, { params: { patientId, limit: 200 }, signal });
    const d = extract(r);
    if (d) return d;
  } catch { /* fall through */ }
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
    return r?.data?.data || r?.data || [];
  } catch { return []; }
}

async function loadEmergencyForPatient(patientId, signal) {
  if (!patientId) return [];
  try {
    const r = await axios.get(`${API_ENDPOINTS.BASE}/emergency/patient/${patientId}`, { signal });
    return r?.data?.data || r?.data || [];
  } catch { return []; }
}

async function loadBillsForUHID(uhid, signal) {
  if (!uhid) return [];
  try {
    const r = await axios.get(`${API_ENDPOINTS.BASE}/billing/uhid/${encodeURIComponent(uhid)}`, { signal });
    return r?.data?.data || r?.data || [];
  } catch { return []; }
}

/* ════════════════ MAIN COMPONENT ════════════════ */
export default function PatientLookupPage({ initialView = "auto" }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { uhid: routeUhid } = useParams(); // for legacy /visit-history/:uhid
  const { user } = useAuth();
  const role = user?.role;

  // Capabilities derived from role
  const isRX        = role === "Receptionist";
  const isClinical  = role === "Doctor" || role === "Nurse";
  const isAdmin     = role === "Admin";
  const canEdit     = isAdmin || isRX;            // RX can fix demographics
  const canDelete   = isAdmin;
  const canNewVisit = isAdmin || isRX;            // start a fresh visit from here

  // Auto-pick initial view by role (or honor a URL query / prop override).
  // search    — live name/UHID search; default for Receptionist
  // directory — paginated patient table; default for clinical roles
  // timeline  — full visit history; auto-selected when ?uhid= arrives
  // Accept UHID from either `?uhid=` (modern) or `/:uhid` path param (legacy
  // /visit-history/:uhid). Query string wins if both are present.
  const urlUhid = (searchParams.get("uhid") || routeUhid || "").toUpperCase();
  const defaultView = useMemo(() => {
    if (urlUhid) return "timeline";
    if (initialView && initialView !== "auto") return initialView;
    return isRX ? "search" : "directory";
  }, [urlUhid, initialView, isRX]);
  const [view, setView] = useState(defaultView);

  /* ─── Live search ──────────────────────────────────────────── */
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

  /* ─── Selected patient detail (right panel / timeline / billing) ── */
  const [selected, setSelected] = useState(null);    // patient master record
  const [opd, setOpd]           = useState([]);
  const [adm, setAdm]           = useState([]);
  const [er, setEr]             = useState([]);
  const [bills, setBills]       = useState([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [timelineFilter, setTimelineFilter] = useState("ALL");
  const [detailTab, setDetailTab] = useState("profile"); // "profile" | "visits" | "billing"

  // Pull full patient record + all timeline streams for the selected UHID
  const loadPatientDetail = useCallback(async (uhidOrId) => {
    if (!uhidOrId) return;
    setDetailLoading(true);
    const ac = new AbortController();
    try {
      // 1. Patient master — always by UHID, falls back to id-by-id if needed
      let patient = null;
      try {
        const r = await axios.get(`${API_ENDPOINTS.PATIENTS}/uhid/${encodeURIComponent(uhidOrId)}`, { signal: ac.signal });
        patient = r?.data?.data || r?.data;
      } catch {
        // maybe caller gave us an ObjectId
        try {
          const r = await axios.get(`${API_ENDPOINTS.PATIENTS}/${uhidOrId}`, { signal: ac.signal });
          patient = r?.data?.data || r?.data;
        } catch (e) {
          if (!axios.isCancel(e)) console.error("[PatientLookup] patient lookup:", e?.message);
        }
      }
      if (!patient || ac.signal.aborted) return;
      setSelected(patient);

      // 2. Visit streams + bills — parallel, all share the same abort signal
      const [opdRows, admRows, erRows, billRows] = await Promise.all([
        loadOPDForPatient(patient._id, ac.signal),
        loadAdmissions(patient._id, patient.UHID, ac.signal),
        loadEmergencyForPatient(patient._id, ac.signal),
        loadBillsForUHID(patient.UHID, ac.signal),
      ]);
      if (ac.signal.aborted) return;
      setOpd(opdRows);
      setAdm(admRows);
      setEr(erRows);
      setBills(billRows);
    } finally {
      if (!ac.signal.aborted) setDetailLoading(false);
    }
    return () => ac.abort();
  }, []);

  // Auto-load when ?uhid= arrives or when caller clicks a search row
  useEffect(() => {
    if (urlUhid) loadPatientDetail(urlUhid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlUhid]);

  const pickPatient = (p) => {
    setSelected(p);
    loadPatientDetail(p.UHID);
    setDetailTab("profile");
  };

  /* ─── Directory mode (paginated) ──────────────────────────── */
  const [dirRows, setDirRows] = useState([]);
  const [dirPage, setDirPage] = useState(1);
  const [dirType, setDirType] = useState("ALL");
  const [dirSearch, setDirSearch] = useState("");
  const [dirTotal, setDirTotal] = useState(0);
  const [dirLoading, setDirLoading] = useState(false);
  const DIR_LIMIT = 12;

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
      const rows = data?.data || data?.patients || data || [];
      const total = data?.total || data?.count || rows.length;
      setDirRows(Array.isArray(rows) ? rows : []);
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

  /* ─── Unified timeline rows for the selected patient ─────── */
  const timelineRows = useMemo(() => {
    const items = [];
    for (const v of opd) {
      items.push({
        key:      `opd-${v._id}`,
        kind:     "OPD",
        when:     v.visitDate || v.createdAt,
        title:    `OPD Visit ${v.visitNumber || ""}`,
        doctor:   docName(v.doctorId || v.consultantName),
        dept:     deptName(v.departmentId || v.department),
        complaint:v.chiefComplaint,
        status:   v.status,
        raw:      v,
      });
    }
    for (const a of adm) {
      items.push({
        key:      `adm-${a._id}`,
        kind:     "IPD",
        when:     a.admissionDate || a.createdAt,
        title:    `${a.admissionType || "IPD"} Admission ${a.admissionNumber || ""}`,
        doctor:   a.attendingDoctor || docName(a.attendingDoctorId),
        dept:     a.department || deptName(a.departmentId),
        bed:      a.bedNumber,
        complaint:a.reasonForAdmission || a.provisionalDiagnosis,
        status:   a.status,
        raw:      a,
      });
    }
    for (const e of er) {
      items.push({
        key:      `er-${e._id}`,
        kind:     "Emergency",
        when:     e.visitDate || e.createdAt,
        title:    `Emergency ${e.visitNumber || ""}`,
        doctor:   docName(e.doctorId),
        dept:     deptName(e.departmentId),
        complaint:e.chiefComplaint,
        status:   e.status,
        raw:      e,
      });
    }
    items.sort((a, b) => new Date(b.when) - new Date(a.when));
    if (timelineFilter === "ALL") return items;
    return items.filter((i) => i.kind === timelineFilter);
  }, [opd, adm, er, timelineFilter]);

  const totals = useMemo(() => ({
    opd: opd.length,
    ipd: adm.length,
    er:  er.length,
    bills: bills.length,
    outstanding: bills.reduce((s, b) => s + (Number(b.balanceAmount) || Number(b.balance) || 0), 0),
  }), [opd, adm, er, bills]);

  /* ════════════════ RENDER ════════════════ */
  return (
    <div className="rx-page" style={{ padding: 16 }}>

      {/* ── Top bar: title + view-mode tabs ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, gap: 12, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, color: "#0f172a" }}>
            <i className="pi pi-id-card" style={{ color: "#0891b2", marginRight: 8 }} />
            Patient Lookup
          </h2>
          <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
            Search · Directory · Visit Timeline · Billing — all in one window
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, background: "#f1f5f9", padding: 4, borderRadius: 10 }}>
          {[
            { k: "search",    label: "Search",    icon: "pi-search" },
            { k: "directory", label: "Directory", icon: "pi-table" },
            { k: "timeline",  label: "Timeline",  icon: "pi-history", disabled: !selected },
          ].map((t) => (
            <button
              key={t.k}
              disabled={t.disabled}
              onClick={() => setView(t.k)}
              style={{
                padding: "8px 14px",
                fontSize: 13,
                fontWeight: 600,
                border: "none",
                borderRadius: 7,
                background: view === t.k ? "#ffffff" : "transparent",
                color: view === t.k ? "#0891b2" : (t.disabled ? "#94a3b8" : "#475569"),
                boxShadow: view === t.k ? "0 1px 2px rgba(0,0,0,.08)" : "none",
                cursor: t.disabled ? "not-allowed" : "pointer",
                opacity: t.disabled ? 0.5 : 1,
              }}
            >
              <i className={`pi ${t.icon}`} style={{ marginRight: 6, fontSize: 12 }} />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ════════════════ SEARCH VIEW ════════════════ */}
      {view === "search" && (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.2fr)", gap: 14 }}>
          {/* ── Search column ── */}
          <div className="rx-card">
            <div className="rx-card-head">
              <i className="pi pi-search" /> Live Search
              <span className="rx-card-meta">{results.length} result{results.length !== 1 ? "s" : ""}</span>
            </div>
            <div className="rx-card-body">
              <input
                autoFocus
                type="text"
                placeholder="Name, UHID, or phone (min 2 chars)"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                style={{
                  width: "100%", padding: "10px 12px",
                  border: "1.5px solid #e2e8f0", borderRadius: 8,
                  fontSize: 14, marginBottom: 12,
                }}
              />
              {searching && <div style={{ color: "#64748b", fontSize: 12 }}>Searching…</div>}
              {!searching && q.trim().length >= 2 && results.length === 0 && (
                <div className="rx-empty">No patients match "{q}"</div>
              )}
              <div style={{ display: "grid", gap: 8 }}>
                {results.map((p) => {
                  const isSelected = selected?._id === p._id;
                  return (
                    <button
                      key={p._id}
                      onClick={() => pickPatient(p)}
                      style={{
                        textAlign: "left", padding: 10,
                        border: `1.5px solid ${isSelected ? "#0891b2" : "#e2e8f0"}`,
                        background: isSelected ? "#ecfeff" : "#ffffff",
                        borderRadius: 8, cursor: "pointer",
                        display: "flex", alignItems: "center", gap: 10,
                      }}
                    >
                      <div style={{
                        width: 36, height: 36, borderRadius: "50%",
                        background: "#0891b2", color: "#ffffff",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontWeight: 700, fontSize: 13,
                      }}>{initials(p.fullName)}</div>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontWeight: 700, color: "#0f172a", fontSize: 13 }}>
                          {p.title ? `${p.title} ` : ""}{p.fullName}
                        </div>
                        <div style={{ fontSize: 11, color: "#64748b" }}>
                          {p.UHID} · {ageGenderLine(p)} · {p.contactNumber || "—"}
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
          />
        </div>
      )}

      {/* ════════════════ DIRECTORY VIEW ════════════════ */}
      {view === "directory" && (
        <div>
          {/* Filter row */}
          <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
            <input
              type="text"
              placeholder="Search name / UHID / phone…"
              value={dirSearch}
              onChange={(e) => { setDirPage(1); setDirSearch(e.target.value); }}
              style={{
                flex: "1 1 280px", padding: "10px 12px",
                border: "1.5px solid #e2e8f0", borderRadius: 8, fontSize: 14,
              }}
            />
            <select
              value={dirType}
              onChange={(e) => { setDirPage(1); setDirType(e.target.value); }}
              style={{
                padding: "10px 12px", border: "1.5px solid #e2e8f0",
                borderRadius: 8, fontSize: 14, background: "#fff",
              }}
            >
              <option value="ALL">All Types</option>
              <option value="OPD">OPD</option>
              <option value="IPD">IPD</option>
              <option value="Emergency">Emergency</option>
              <option value="Daycare">Day Care</option>
            </select>
          </div>

          {/* Table */}
          <div className="rx-card">
            <div className="rx-card-head">
              <i className="pi pi-users" /> Patient Directory
              <span className="rx-card-meta">{dirTotal} total</span>
            </div>
            <div className="rx-card-body" style={{ padding: 0 }}>
              {dirLoading && <div style={{ padding: 16, color: "#64748b" }}>Loading…</div>}
              {!dirLoading && dirRows.length === 0 && (
                <div className="rx-empty" style={{ padding: 24 }}>
                  No patients found
                </div>
              )}
              {!dirLoading && dirRows.length > 0 && (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: "#f8fafc", color: "#475569" }}>
                      <th style={th}>Patient</th>
                      <th style={th}>UHID</th>
                      <th style={th}>Age / Sex</th>
                      <th style={th}>Contact</th>
                      <th style={th}>Type</th>
                      <th style={th}>Doctor / Dept</th>
                      <th style={{ ...th, textAlign: "right" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dirRows.map((p) => (
                      <tr key={p._id} style={{ borderTop: "1px solid #e2e8f0" }}>
                        <td style={td}>
                          <div style={{ fontWeight: 700, color: "#0f172a" }}>
                            {p.title ? `${p.title} ` : ""}{p.fullName}
                          </div>
                        </td>
                        <td style={{ ...td, fontFamily: "monospace", fontSize: 12 }}>{p.UHID}</td>
                        <td style={td}>{ageGenderLine(p) || "—"}</td>
                        <td style={td}>{p.contactNumber || "—"}</td>
                        <td style={td}>
                          {p.registrationType && (
                            <span className={`rx-pill rx-pill--${(p.registrationType || "").toLowerCase()}`}>
                              {p.registrationType}
                            </span>
                          )}
                        </td>
                        <td style={td}>
                          <div>{docName(p.doctor)}</div>
                          <div style={{ fontSize: 11, color: "#94a3b8" }}>{deptName(p.department)}</div>
                        </td>
                        <td style={{ ...td, textAlign: "right" }}>
                          <button onClick={() => { pickPatient(p); setView("timeline"); }}
                                  style={btnSm}>
                            <i className="pi pi-eye" /> Open
                          </button>
                          {canEdit && (
                            <button onClick={() => navigate(`/reception/register?uhid=${encodeURIComponent(p.UHID || "")}`)}
                                    style={{ ...btnSm, marginLeft: 6 }}>
                              <i className="pi pi-pencil" /> Edit
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Pager */}
          {dirTotal > DIR_LIMIT && (
            <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 12 }}>
              <button onClick={() => setDirPage(Math.max(1, dirPage - 1))} disabled={dirPage === 1} style={btnSm}>
                ← Prev
              </button>
              <span style={{ alignSelf: "center", fontSize: 13, color: "#475569" }}>
                Page {dirPage} of {Math.max(1, Math.ceil(dirTotal / DIR_LIMIT))}
              </span>
              <button onClick={() => setDirPage(dirPage + 1)} disabled={dirPage * DIR_LIMIT >= dirTotal} style={btnSm}>
                Next →
              </button>
            </div>
          )}
        </div>
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
          fullWidth
          // When the timeline view loads without a selection (e.g. user
          // clicks the tab before picking a patient), prompt them back
          // into Search.
          emptyHint={!selected && (
            <div className="rx-empty" style={{ padding: 24 }}>
              No patient selected.{" "}
              <button onClick={() => setView("search")} style={{ ...btnSm, marginLeft: 8 }}>
                Search for a patient →
              </button>
            </div>
          )}
        />
      )}
    </div>
  );
}

/* ─── Detail panel (Profile / Visits / Billing tabs) ────────── */
function PatientDetailPanel({
  patient, opd, adm, er, bills, tab, setTab,
  timelineFilter, setTimelineFilter, timelineRows, totals, loading,
  canNewVisit, canEdit, navigate, fullWidth, emptyHint,
}) {
  if (!patient && emptyHint) return emptyHint;
  if (!patient) {
    return (
      <div className="rx-card" style={{ ...(fullWidth ? { width: "100%" } : {}) }}>
        <div className="rx-card-body">
          <div className="rx-empty">
            <i className="pi pi-id-card" style={{ fontSize: 24, color: "#cbd5e1" }} />
            <div style={{ marginTop: 8, color: "#64748b" }}>
              Select a patient on the left to see their profile, visits, and billing.
            </div>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="rx-card" style={{ ...(fullWidth ? { width: "100%" } : {}) }}>
      {/* Header */}
      <div style={{ padding: 14, borderBottom: "1px solid #e2e8f0", display: "flex", gap: 12, alignItems: "center" }}>
        <div style={{
          width: 48, height: 48, borderRadius: "50%",
          background: "#0891b2", color: "#fff",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontWeight: 700, fontSize: 16,
        }}>{initials(patient.fullName)}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 16, color: "#0f172a" }}>
            {patient.title ? `${patient.title} ` : ""}{patient.fullName}
          </div>
          <div style={{ fontSize: 12, color: "#64748b" }}>
            {patient.UHID} · {ageGenderLine(patient)} · {patient.contactNumber || "—"}
            {patient.bloodGroup && <span> · {patient.bloodGroup}</span>}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {canNewVisit && (
            <button onClick={() => navigate(`/reception/register?uhid=${encodeURIComponent(patient.UHID || "")}`)} style={btnPrimary}>
              <i className="pi pi-plus" /> New Visit
            </button>
          )}
          <button onClick={() => navigate(`/reception-billing?uhid=${encodeURIComponent(patient.UHID || "")}`)} style={btnSm}>
            <i className="pi pi-receipt" /> Billing
          </button>
        </div>
      </div>

      {/* Detail tabs */}
      <div style={{ display: "flex", gap: 4, padding: "10px 14px 0", borderBottom: "1px solid #e2e8f0" }}>
        {[
          { k: "profile", label: "Profile",  icon: "pi-id-card", count: null },
          { k: "visits",  label: "Visits",   icon: "pi-history", count: timelineRows.length },
          { k: "billing", label: "Billing",  icon: "pi-receipt", count: totals.bills },
        ].map((t) => (
          <button
            key={t.k}
            onClick={() => setTab(t.k)}
            style={{
              padding: "8px 14px", border: "none",
              borderBottom: tab === t.k ? "2px solid #0891b2" : "2px solid transparent",
              background: "transparent",
              color: tab === t.k ? "#0891b2" : "#64748b",
              fontWeight: 600, fontSize: 13, cursor: "pointer",
            }}
          >
            <i className={`pi ${t.icon}`} style={{ marginRight: 6 }} />
            {t.label}{t.count != null && <span style={{ color: "#94a3b8", fontWeight: 500 }}> ({t.count})</span>}
          </button>
        ))}
      </div>

      {/* Tab bodies */}
      <div style={{ padding: 14, minHeight: 200 }}>
        {loading && <div style={{ color: "#64748b" }}>Loading…</div>}

        {!loading && tab === "profile" && (
          <ProfileBody patient={patient} totals={totals} />
        )}

        {!loading && tab === "visits" && (
          <>
            <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
              {TIMELINE_TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTimelineFilter(t.key)}
                  style={{
                    padding: "6px 10px",
                    border: `1px solid ${timelineFilter === t.key ? "#0891b2" : "#e2e8f0"}`,
                    background: timelineFilter === t.key ? "#ecfeff" : "#ffffff",
                    color: timelineFilter === t.key ? "#0891b2" : "#475569",
                    borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600,
                  }}
                >
                  <i className={`pi ${t.icon}`} style={{ marginRight: 4 }} /> {t.label}
                </button>
              ))}
            </div>
            {timelineRows.length === 0 ? (
              <div className="rx-empty">No visits in this filter</div>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                {timelineRows.map((r) => <TimelineRow key={r.key} r={r} />)}
              </div>
            )}
          </>
        )}

        {!loading && tab === "billing" && (
          <BillingBody bills={bills} totals={totals} />
        )}
      </div>
    </div>
  );
}

function ProfileBody({ patient, totals }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
      <Field label="DOB" value={fmtDate(patient.dateOfBirth)} />
      <Field label="Blood Group" value={patient.bloodGroup || "—"} />
      <Field label="Marital Status" value={patient.maritalStatus || "—"} />
      <Field label="Email" value={patient.email || "—"} />
      <Field label="Allergies" value={patient.knownAllergies || "None"} />
      <Field label="Department" value={deptName(patient.department)} />
      <Field label="Primary Doctor" value={docName(patient.doctor)} />
      <Field label="Address" value={patient.address?.completeAddress || patient.address || "—"} full />
      <div style={{ gridColumn: "1 / -1", display: "flex", gap: 16, marginTop: 6 }}>
        <Stat label="OPD" value={totals.opd} />
        <Stat label="IPD" value={totals.ipd} />
        <Stat label="ER"  value={totals.er} />
        <Stat label="Bills" value={totals.bills} />
        {totals.outstanding > 0 && <Stat label="Outstanding" value={fmtCur(totals.outstanding)} color="#dc2626" />}
      </div>
    </div>
  );
}

function BillingBody({ bills }) {
  if (!bills || bills.length === 0) return <div className="rx-empty">No bills on file</div>;
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {bills.map((b) => {
        const balance = Number(b.balanceAmount) || Number(b.balance) || 0;
        const total   = Number(b.netAmount)     || Number(b.totalAmount) || 0;
        return (
          <div key={b._id} style={{
            border: "1px solid #e2e8f0", borderRadius: 8, padding: 10,
            display: "flex", justifyContent: "space-between", alignItems: "center",
          }}>
            <div>
              <div style={{ fontWeight: 700, color: "#0f172a", fontSize: 13 }}>
                {b.billNumber} · {b.visitType}
              </div>
              <div style={{ fontSize: 11, color: "#64748b" }}>
                {fmtDateTime(b.billDate || b.createdAt)} · status: {b.billStatus}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontWeight: 700, color: "#0f172a", fontSize: 14 }}>{fmtCur(total)}</div>
              {balance > 0 && <div style={{ fontSize: 12, color: "#dc2626" }}>Due: {fmtCur(balance)}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TimelineRow({ r }) {
  const tone = { OPD: "#7c3aed", IPD: "#1d4ed8", Emergency: "#dc2626" }[r.kind] || "#64748b";
  return (
    <div style={{
      border: "1px solid #e2e8f0", borderRadius: 8, padding: 10,
      display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 12, alignItems: "center",
    }}>
      <span style={{
        background: `${tone}15`, color: tone, padding: "3px 8px",
        borderRadius: 4, fontSize: 11, fontWeight: 700,
      }}>{r.kind}</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 700, color: "#0f172a", fontSize: 13 }}>{r.title}</div>
        <div style={{ fontSize: 11, color: "#64748b" }}>
          {r.doctor} · {r.dept}{r.bed && ` · Bed ${r.bed}`}
        </div>
        {r.complaint && (
          <div style={{ fontSize: 12, color: "#475569", marginTop: 4 }}>
            <strong>Complaint:</strong> {r.complaint}
          </div>
        )}
      </div>
      <div style={{ textAlign: "right" }}>
        <div style={{ fontSize: 11, color: "#64748b" }}>{fmtDateTime(r.when)}</div>
        {r.status && <div style={{ fontSize: 11, fontWeight: 600, color: tone, marginTop: 2 }}>{r.status}</div>}
      </div>
    </div>
  );
}

function Field({ label, value, full }) {
  return (
    <div style={{ gridColumn: full ? "1 / -1" : undefined }}>
      <div style={{ fontSize: 11, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.6px", fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 13, color: "#0f172a", marginTop: 2 }}>{value}</div>
    </div>
  );
}

function Stat({ label, value, color = "#0891b2" }) {
  return (
    <div style={{ background: `${color}10`, borderRadius: 8, padding: "10px 14px", minWidth: 84 }}>
      <div style={{ fontSize: 11, color: "#64748b", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px" }}>{label}</div>
      <div style={{ fontSize: 20, color, fontWeight: 700, marginTop: 2 }}>{value}</div>
    </div>
  );
}

/* ─── Inline style helpers ────────────────────────────────── */
const th = { textAlign: "left", padding: "10px 12px", fontWeight: 700, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.5px" };
const td = { padding: "10px 12px", color: "#0f172a", verticalAlign: "middle" };
const btnSm = {
  padding: "6px 12px", border: "1px solid #e2e8f0", background: "#ffffff",
  color: "#475569", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600,
};
const btnPrimary = {
  padding: "6px 12px", border: "1px solid #0891b2", background: "#0891b2",
  color: "#ffffff", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600,
};
