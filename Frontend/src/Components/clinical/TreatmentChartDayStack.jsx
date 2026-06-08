/**
 * TreatmentChartDayStack.jsx — R7hr-124 / R7hr-125 / R7hr-126
 *
 * Patient-panel wrapper that renders the Treatment Chart day-wise,
 * stacked vertically: Today at the top, Yesterday below it, then the
 * day before that, and so on back to the admission date (capped at
 * 30 days).
 *
 * R7hr-124 — vertical day-stack scaffold
 * R7hr-125 — compact tabular presentation (stripped chrome)
 * R7hr-126 — STATIC tabular digest per day showing:
 *              • Vitals chart
 *              • Total medicines (given / pending / modified)
 *              • Infusion details + rate-change log (with reason)
 *              • Intake / Output ledger
 *              • Any other observations the staff saved & submitted
 *
 * Live administration actions (Administer / Hold / Refuse / Rate-change)
 * are NOT rendered here — this is the presentation/digest view. A CTA
 * at the top of the stack jumps to the live MAR action surface
 * (NursePatientPanel header already exposes a "💊 MAR" button too).
 * R25 honoured: every existing write path stays intact.
 *
 * Standalone /treatment-chart page still uses <TreatmentChart> directly
 * with its single-day Prev/Today/Next pager — unchanged.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { API_ENDPOINTS, API_BASE_URL } from "../../config/api";
import TreatmentChartDayDigest from "./TreatmentChartDayDigest";

const MAX_LOOKBACK_DAYS = 30;

// R7hr-127 B4 — match the cadence the legacy <TreatmentChart> used
// (30s). Today card needs to re-fetch after a nurse jumps to /mar,
// gives a dose, and comes back. Without this the digest shows stale
// "Pending" pills for doses that have just been administered.
const AUTO_REFRESH_MS = 30_000;

// R7hr-127 B12 — nursing-assessment types whose rows we surface in the
// "Other Observations" section of the per-day digest. The shared
// /api/nursing-assessments endpoint returns rows of all types; we
// label each kind so the digest reads naturally.
const OBSERVATION_TYPES = [
  { type: "pain",          label: "Pain Assessment",      color: "#dc2626", icon: "🤕" },
  { type: "fall-risk",     label: "Fall Risk Re-score",   color: "#d97706", icon: "🪜" },
  { type: "pressure-area", label: "Pressure Area Round",  color: "#7c3aed", icon: "🛏" },
  { type: "dvt",           label: "DVT (Caprini)",        color: "#0d9488", icon: "🦵" },
  { type: "nutrition",     label: "Nutrition Assessment", color: "#16a34a", icon: "🥗" },
  { type: "education",     label: "Patient Education",    color: "#0ea5e9", icon: "📘" },
];

/* ── Day helpers ─────────────────────────────────────────────────── */
function buildDayList(admissionDate) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let start = today;
  if (admissionDate) {
    const ad = new Date(admissionDate);
    if (!isNaN(ad)) {
      ad.setHours(0, 0, 0, 0);
      start = ad < today ? ad : today;
    }
  }

  const days = [];
  const cursor = new Date(start);
  while (cursor <= today && days.length < MAX_LOOKBACK_DAYS) {
    days.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  days.reverse(); // newest-first
  return days;
}

const fmtDayHeader = (d) =>
  d.toLocaleDateString("en-IN", {
    weekday: "long",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

const isToday = (d) => {
  const t = new Date();
  return d.toDateString() === t.toDateString();
};

const isYesterday = (d) => {
  const y = new Date();
  y.setDate(y.getDate() - 1);
  return d.toDateString() === y.toDateString();
};

const sameDay = (a, b) => {
  if (!a || !b) return false;
  const x = new Date(a), y = new Date(b);
  return (
    x.getFullYear() === y.getFullYear() &&
    x.getMonth() === y.getMonth() &&
    x.getDate() === y.getDate()
  );
};

const dateKey = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};

// R7hr-127 B12 — collapse the per-assessment-type form payload into a
// single human-readable string. Each nursing-assessment type uses its
// own field names (pain score vs Morse fall score vs Braden vs Caprini
// etc.); we surface the most-clinically-meaningful 2-3 fields so the
// "Other Observations" row reads naturally. Falls back to a "saved"
// note when the payload is empty so the row never collapses to "—".
function summariseObservation(type, data = {}) {
  if (!data || typeof data !== "object") return "Submitted";
  const parts = [];
  const push = (label, value) => {
    if (value == null || value === "") return;
    parts.push(`${label}: ${value}`);
  };
  switch (type) {
    case "pain":
      push("Score", data.painScore ?? data.score);
      push("Site",  data.painSite ?? data.site);
      push("Type",  data.painType ?? data.character);
      push("Intervention", data.intervention ?? data.action);
      break;
    case "fall-risk":
      push("Morse",   data.morseScore ?? data.score);
      push("Risk",    data.riskLevel ?? data.risk);
      push("Plan",    data.preventionPlan ?? data.intervention);
      break;
    case "pressure-area":
      push("Braden",  data.bradenScore ?? data.score);
      push("Risk",    data.riskLevel ?? data.risk);
      push("Sites",   Array.isArray(data.sites) ? data.sites.join(", ") : data.sites);
      break;
    case "dvt":
      push("Caprini", data.capriniScore ?? data.score);
      push("Risk",    data.capriniRisk ?? data.risk);
      push("Prophylaxis", data.prophylaxis);
      break;
    case "nutrition":
      push("MUST",    data.mustScore ?? data.score);
      push("Status",  data.nutritionStatus ?? data.status);
      break;
    case "education":
      push("Topic",   data.topic);
      push("Method",  data.method);
      push("Understood", data.understood);
      break;
    default: {
      const k = Object.keys(data).slice(0, 3);
      k.forEach((key) => push(key, data[key]));
    }
  }
  return parts.length ? parts.join(" · ") : "Saved (no detail)";
}

/* ── Main wrapper ────────────────────────────────────────────────── */
export default function TreatmentChartDayStack({
  UHID,
  visitId,
  patientName,
  nurseMode = true, // eslint-disable-line no-unused-vars -- accepted for API parity with TreatmentChart
  refreshTrigger = 0,
  onAdminSave,      // eslint-disable-line no-unused-vars -- accepted for API parity
  admissionId,
  admissionDate,
  // R7hr-152 — when true, suppress the live-MAR CTA strip + Refresh /
  // Open Live MAR buttons, disable the 30s auto-refresh interval, and
  // emit a `data-print-ready="true"` attribute on the root when the
  // initial fetch resolves. The wrapper TreatmentChartMarPrint page
  // watches that attribute to fire window.print() once everything is
  // on screen — keeps the digest UI single-source-of-truth (R25).
  printMode = false,
  onPrintReady,
}) {
  const navigate = useNavigate();
  const days = useMemo(() => buildDayList(admissionDate), [admissionDate]);

  /* ── Day-stack data: fetched ONCE upfront then sliced per day ── */
  const [orders, setOrders] = useState([]);     // DoctorOrder docs
  const [vitalSheet, setVitalSheet] = useState([]); // [{date, tableData[]}]
  const [ioRows, setIoRows] = useState([]);     // intake-output rows
  const [observations, setObservations] = useState([]); // nursing-assessments
  const [loaded, setLoaded] = useState(false);
  const [lastRefreshAt, setLastRefreshAt] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  // cancelledRef survives across renders inside the same mount — used
  // to abort the in-flight fetch's setStates when the component
  // unmounts mid-request. Declared before fetchAll so the closure
  // captures it at definition time.
  const cancelledRef = useRef(false);

  // R7hr-127 B13 — pull data-fetch out of useEffect into a stable
  // callback so the 30-second auto-refresh interval AND a manual
  // "Refresh" button can call the same path. Original lived inline so
  // there was no way to drive a re-fetch other than re-mounting the
  // component (which the patient panel never does inside a session).
  const fetchAll = useCallback(async ({ silent = false } = {}) => {
    if (!UHID) return;
    silent ? setRefreshing(true) : setLoaded(false);
    try {
      // Doctor orders (medications + infusions). Treatment chart is
      // IPD-scoped — fetch all orders for this UHID; we filter active
      // ones day-by-day in the digest. We don't pass visitId because
      // R7bv linked admissionId already lives on the docs.
      const ordersUrl = visitId
        ? `${API_ENDPOINTS.DOCTOR_ORDERS}?UHID=${UHID}&visitId=${visitId}`
        : `${API_ENDPOINTS.DOCTOR_ORDERS}?UHID=${UHID}`;
      const ordersPromise = axios
        .get(ordersUrl)
        .then((r) => (Array.isArray(r.data) ? r.data : r.data?.data || []))
        .catch(() => []);

      // Vital sheet — one doc per calendar day with tableData[] inside.
      const vitalPromise = axios
        .get(`${API_ENDPOINTS.VITAL_SHEET}`, { params: { uhid: UHID } })
        .then((r) => (Array.isArray(r.data?.data) ? r.data.data : Array.isArray(r.data) ? r.data : []))
        .catch(() => []);

      // Intake/Output ledger — server filters by admissionId.
      const ioPromise = admissionId
        ? axios
            .get(`${API_BASE_URL}/intake-output`, { params: { admissionId } })
            .then((r) => {
              const data = r.data?.data || r.data || {};
              return Array.isArray(data.rows) ? data.rows : Array.isArray(data) ? data : [];
            })
            .catch(() => [])
        : Promise.resolve([]);

      // R7hr-127 B12 — nursing assessments (pain, fall-risk, pressure
      // area, dvt, nutrition, education). Server filters by UHID;
      // admissionId is preferred when present so we don't bleed in
      // assessments from an earlier admission.
      const obsPromise = axios
        .get(`${API_BASE_URL}/nursing-assessments`, {
          params: admissionId ? { admissionId } : { UHID },
        })
        .then((r) => {
          const list = Array.isArray(r.data?.data) ? r.data.data
                     : Array.isArray(r.data)      ? r.data
                     : [];
          return list;
        })
        .catch(() => []);

      const [o, v, io, obs] = await Promise.all([
        ordersPromise, vitalPromise, ioPromise, obsPromise,
      ]);
      if (cancelledRef.current) return;
      setOrders(Array.isArray(o) ? o.filter((d) => !["Cancelled"].includes(d.status)) : []);
      setVitalSheet(Array.isArray(v) ? v : []);
      setIoRows(Array.isArray(io) ? io : []);
      setObservations(Array.isArray(obs) ? obs : []);
      setLastRefreshAt(new Date());
    } catch {
      /* swallow — UI shows empty sections */
    } finally {
      if (!cancelledRef.current) {
        setLoaded(true);
        setRefreshing(false);
      }
    }
  }, [UHID, visitId, admissionId]);

  useEffect(() => {
    cancelledRef.current = false;
    // R7hr-127 B13 — when UHID is missing we still need to clear the
    // "Loading day-wise digest…" banner. Pre-B13 the loaded flag stayed
    // false forever in that degenerate case, freezing the UI on the
    // amber spinner. Treat "no patient" as "done loading nothing".
    if (!UHID) {
      setLoaded(true);
      return () => { cancelledRef.current = true; };
    }
    fetchAll({ silent: false });

    // R7hr-127 B4 — 30s auto-refresh on Today's data (matches the
    // cadence the standalone TreatmentChart used). Refreshing silently
    // (no full spinner) so the digest doesn't flicker between fetches.
    // R7hr-152 — but in printMode we want a fixed snapshot, not a live
    // ticker; skip the interval so the print preview doesn't re-render
    // while the user is dragging the print dialog around.
    const id = printMode
      ? null
      : setInterval(() => { fetchAll({ silent: true }); }, AUTO_REFRESH_MS);

    return () => {
      cancelledRef.current = true;
      if (id) clearInterval(id);
    };
  }, [UHID, visitId, admissionId, refreshTrigger, fetchAll, printMode]);

  // R7hr-152 — Tell the parent (print wrapper) the moment data has
  // settled. We only fire ONCE per mount so the print dialog opens
  // exactly when the first paint is complete.
  const _firedPrintReadyRef = useRef(false);
  useEffect(() => {
    if (!printMode) return;
    if (!loaded) return;
    if (_firedPrintReadyRef.current) return;
    _firedPrintReadyRef.current = true;
    if (typeof onPrintReady === "function") onPrintReady();
  }, [loaded, printMode, onPrintReady]);

  /* ── Pre-split orders by type once so we don't refilter per day ── */
  const medOrders = useMemo(
    () => orders.filter((o) => o.orderType === "Medication"),
    [orders],
  );
  const infOrders = useMemo(
    () => orders.filter((o) => o.orderType === "IV_Fluid"),
    [orders],
  );

  /* ── Pre-bucket observations by day-key so we don't re-scan per day ── */
  const observationsByDay = useMemo(() => {
    const map = new Map();
    observations.forEach((o) => {
      const ts = o?.recordedAt || o?.createdAt;
      if (!ts) return;
      const k = dateKey(ts);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(o);
    });
    return map;
  }, [observations]);

  /* ── Build per-day slices ── */
  const daySlices = useMemo(() => {
    return days.map((d) => {
      const key = dateKey(d);
      const vitalForDay = vitalSheet.find((s) => {
        if (!s?.date) return false;
        return dateKey(s.date) === key;
      });
      const ioForDay = ioRows.filter((r) => r?.ts && sameDay(r.ts, d));
      // R7hr-127 B12 — transform raw nursing-assessment docs into the
      // {ts, kind, color, details, by} shape that
      // TreatmentChartDayDigest.OtherObservationsSection expects.
      const rawObs = observationsByDay.get(key) || [];
      const otherItemsForDay = rawObs.map((o) => {
        const cfg = OBSERVATION_TYPES.find((c) => c.type === o.type) || {
          label: o.type || "Observation", color: "#334155", icon: "📋",
        };
        const data = o.data || {};
        const details = summariseObservation(o.type, data);
        return {
          ts:      o.recordedAt || o.createdAt,
          kind:    `${cfg.icon} ${cfg.label}`,
          color:   cfg.color,
          details,
          by:      o.recordedBy || o.recordedByName || "—",
        };
      }).sort((a, b) => new Date(a.ts || 0) - new Date(b.ts || 0));
      return { day: d, vitalForDay, ioForDay, otherItemsForDay };
    });
  }, [days, vitalSheet, ioRows, observationsByDay]);

  if (!days.length) {
    return (
      <div style={{ padding: 14, color: "#64748b" }}>
        No admission date — cannot compute day-wise digest.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }} data-print-ready={loaded ? "true" : "false"}>

      {/* ── CTA strip: jump to live MAR for actions ──
          R7hr-152 — hidden in printMode; the print page has its own
          header band and we don't want a "Refresh" / "Open Live MAR"
          button bleeding into a printed PDF. */}
      {!printMode && (
      <div
        style={{
          border: "1px solid #bae6fd",
          background: "linear-gradient(90deg,#f0f9ff,#e0f2fe)",
          borderRadius: 10,
          padding: "10px 14px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 18 }}>📋</span>
          <div>
            <div style={{ fontWeight: 800, fontSize: 13, color: "#0369a1" }}>
              Treatment Chart — Day-wise Summary
            </div>
            <div style={{ fontSize: 11, color: "#0c4a6e", marginTop: 1 }}>
              Read-only view of every dose given, pending, modified · infusion
              rate changes with reason · vitals · I/O · all staff submissions.
              Use the live MAR for administering doses.
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {/* R7hr-127 B4 — manual refresh button next to the auto-tick.
              Lets the nurse pull fresh data on demand without waiting
              for the next 30s tick. Disabled while a fetch is in flight
              so a double-click doesn't fire two parallel requests. */}
          <button
            onClick={() => fetchAll({ silent: true })}
            disabled={refreshing}
            title="Refresh now (auto-refreshes every 30s)"
            style={{
              padding: "8px 12px",
              background: refreshing ? "#cbd5e1" : "#ffffff",
              color: "#0369a1",
              border: "1px solid #7dd3fc",
              borderRadius: 7,
              fontWeight: 700,
              fontSize: 12,
              cursor: refreshing ? "wait" : "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {refreshing ? "⏳ Refreshing…" : "🔄 Refresh"}
          </button>
          <button
            onClick={() => navigate(`/mar?uhid=${encodeURIComponent(UHID || "")}`)}
            style={{
              padding: "8px 16px",
              background: "linear-gradient(135deg,#0ea5e9,#0369a1)",
              color: "white",
              border: "none",
              borderRadius: 7,
              fontWeight: 800,
              fontSize: 12,
              cursor: "pointer",
              whiteSpace: "nowrap",
              boxShadow: "0 1px 3px rgba(14,165,233,.30)",
            }}
          >
            💉 Open Live MAR
          </button>
        </div>
      </div>
      )}

      {/* R7hr-152 — Suppress the amber loader in print mode. The print
          wrapper waits on onPrintReady (which fires only after loaded
          flips true), so the dialog never opens while the spinner is
          on screen anyway — but if a slow network leaves it up, we
          don't want a glaring yellow banner sitting on a printed sheet. */}
      {!loaded && !printMode && (
        <div style={{
          padding: "10px 14px",
          background: "#fef9c3",
          border: "1px solid #fde68a",
          borderRadius: 8,
          fontSize: 12,
          fontWeight: 700,
          color: "#92400e",
        }}>
          ⏳ Loading day-wise digest…
        </div>
      )}

      {/* ── One static digest card per day ── */}
      {daySlices.map(({ day: d, vitalForDay, ioForDay, otherItemsForDay }, idx) => {
        const today = isToday(d);
        const yesterday = isYesterday(d);
        const label = today
          ? "📅 Today"
          : yesterday
            ? "🕒 Yesterday"
            : `🗓️ ${fmtDayHeader(d).split(", ")[0]}`;
        const sub = fmtDayHeader(d);
        return (
          <div
            key={d.toISOString().slice(0, 10)}
            style={{
              border: `1px solid ${today ? "#16a34a" : "#cbd5e1"}`,
              borderRadius: 10,
              overflow: "hidden",
              background: "white",
              boxShadow: today
                ? "0 2px 8px rgba(22,163,74,.10)"
                : "0 1px 3px rgba(15,23,42,.05)",
            }}
          >
            <div
              style={{
                padding: "10px 16px",
                background: today
                  ? "linear-gradient(90deg,#dcfce7,#f0fdf4)"
                  : yesterday
                    ? "linear-gradient(90deg,#fef3c7,#fffbeb)"
                    : "linear-gradient(90deg,#f1f5f9,#f8fafc)",
                borderBottom: `1px solid ${
                  today ? "#86efac" : yesterday ? "#fde68a" : "#e2e8f0"
                }`,
                display: "flex",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <span
                style={{
                  fontWeight: 800,
                  fontSize: 14,
                  color: today
                    ? "#15803d"
                    : yesterday
                      ? "#b45309"
                      : "#334155",
                }}
              >
                {label}
              </span>
              <span style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>
                {sub}
              </span>
              <span
                style={{
                  marginLeft: "auto",
                  fontSize: 10,
                  color: today ? "#15803d" : "#94a3b8",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: ".6px",
                }}
              >
                {today ? "Live ledger" : "📖 history view"}
                {" · "}Day {days.length - idx} of {days.length}
              </span>
            </div>

            <TreatmentChartDayDigest
              day={d}
              vitalSheetForDay={vitalForDay}
              medOrders={medOrders}
              infOrders={infOrders}
              ioRowsForDay={ioForDay}
              otherItems={otherItemsForDay}
              printMode={printMode}
            />
          </div>
        );
      })}

      {/* Caller-info footer */}
      <div
        style={{
          fontSize: 10,
          color: "#94a3b8",
          textAlign: "center",
          fontStyle: "italic",
          marginTop: 4,
        }}
      >
        {patientName ? `Patient: ${patientName} · ` : ""}
        Days shown: {days.length} (max {MAX_LOOKBACK_DAYS}) · Auto-refresh every{" "}
        {Math.round(AUTO_REFRESH_MS / 1000)}s · Last refresh:{" "}
        {lastRefreshAt ? lastRefreshAt.toLocaleTimeString("en-IN") : "—"}
      </div>
    </div>
  );
}
