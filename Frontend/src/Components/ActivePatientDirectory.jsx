/**
 * ActivePatientDirectory.jsx — shared patient-by-type pill-tab grid.
 *
 * Used by:
 *   • /reception-billing — idle state above the bills detail
 *   • /patient-search    — idle state on the SEARCH view
 *   • /visitor-passes    — header-of-page directory for IPD attendants
 *
 * Today-detection: looks at lastVisitDate || registrationDate || createdAt
 * and compares the local-date portion to today. Today's cards get a
 * yellow tinted background and a "TODAY" corner badge so the front desk
 * sees who walked in this shift at a glance.
 *
 * Backend ordering: the /api/patients endpoint now sorts by
 * lastVisitDate DESC then createdAt DESC so the list naturally puts
 * today's patients first — the visual badge is just a quick filter
 * hint for the eye.
 *
 * Self-loading mode: pass `autoLoad` to make the component fetch its
 * own rows from /api/patients?registrationType=… instead of expecting
 * the parent to provide them (saves the parent from duplicating the
 * useEffect across three pages).
 */
import React, { useEffect, useState } from "react";
import axios from "axios";
import { API_ENDPOINTS } from "../config/api";

// Shared type config — same six pill tabs everywhere so the receptionist's
// muscle memory carries between pages. Order matters: it drives the digit
// shortcuts (1=OPD, 2=IPD, …) on Reception Billing.
export const PATIENT_TYPES = [
  { key: "OPD",       label: "OPD",        icon: "pi-user-plus", color: "#06b6d4" },
  { key: "IPD",       label: "IPD",        icon: "pi-home",      color: "#7c3aed" },
  { key: "Daycare",   label: "Day Care",   icon: "pi-sun",       color: "#d97706" },
  { key: "Emergency", label: "Emergency",  icon: "pi-bolt",      color: "#dc2626" },
  { key: "Services",  label: "Services",   icon: "pi-cog",       color: "#0e7490" },
  { key: "ALL",       label: "All Types",  icon: "pi-list",      color: "#475569" },
];

function isPatientFromToday(p) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(p?.lastVisitDate || p?.registrationDate || p?.createdAt || 0);
  if (Number.isNaN(d.getTime())) return false;
  d.setHours(0, 0, 0, 0);
  return d.getTime() === today.getTime();
}

export default function ActivePatientDirectory({
  listType,
  setListType,
  rows: providedRows,
  loading: providedLoading,
  onPick,
  autoLoad = false,        // self-fetch when parent doesn't manage state
  defaultType = "OPD",
  typesToShow,              // optional override — e.g. ["IPD","ALL"] for visitor passes
  patientFilter,            // optional predicate after fetch (e.g. only with active admission)
  emptyHintNoun = "active",
}) {
  // Self-load mode — kept inside the component so VisitorPasses doesn't
  // have to copy-paste the same useEffect that ReceptionBilling already has.
  const [selfType, setSelfType] = useState(defaultType);
  const [selfRows, setSelfRows] = useState([]);
  const [selfLoading, setSelfLoading] = useState(false);
  const effType    = autoLoad ? selfType    : listType;
  const setEffType = autoLoad ? setSelfType : setListType;
  const rawRows    = autoLoad ? selfRows    : (providedRows || []);
  const loading    = autoLoad ? selfLoading : !!providedLoading;
  const rows = typeof patientFilter === "function" ? rawRows.filter(patientFilter) : rawRows;

  useEffect(() => {
    if (!autoLoad) return;
    const ac = new AbortController();
    setSelfLoading(true);
    const params = new URLSearchParams({ limit: "60" });
    if (effType !== "ALL") params.set("registrationType", effType);
    axios.get(`${API_ENDPOINTS.PATIENTS}?${params.toString()}`, { signal: ac.signal })
      .then(({ data }) => {
        if (ac.signal.aborted) return;
        const fetched = data?.patients || data?.data || (Array.isArray(data) ? data : []);
        setSelfRows(Array.isArray(fetched) ? fetched : []);
      })
      .catch((e) => { if (!axios.isCancel(e)) console.warn("[ActivePatientDirectory]:", e?.message); })
      .finally(() => { if (!ac.signal.aborted) setSelfLoading(false); });
    return () => ac.abort();
  }, [autoLoad, effType]);

  const TYPES = Array.isArray(typesToShow) && typesToShow.length
    ? PATIENT_TYPES.filter(t => typesToShow.includes(t.key))
    : PATIENT_TYPES;

  const todayCount = rows.filter(isPatientFromToday).length;

  return (
    <div className="pl-idle-dir">
      <div className="pl-idle-tabs">
        {TYPES.map(t => {
          const active = effType === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setEffType(t.key)}
              className={`pl-idle-tab ${active ? "pl-idle-tab--active" : ""}`}
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

      {loading && rows.length === 0 ? (
        <div className="rx-empty"><i className="pi pi-spin pi-spinner rx-loader-icon" /></div>
      ) : rows.length === 0 ? (
        <div className="rx-empty">
          <span className="rx-empty-icon">👥</span>
          No {emptyHintNoun} {effType === "ALL" ? "" : effType} patients yet today.
        </div>
      ) : (
        <div className="pl-idle-grid">
          {rows.map(p => {
            const today = isPatientFromToday(p);
            return (
              <button
                key={p._id}
                type="button"
                onClick={() => onPick && onPick(p)}
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
