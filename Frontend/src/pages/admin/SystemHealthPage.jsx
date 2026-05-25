/**
 * SystemHealthPage.jsx — R7bz admin-only "System Health" dashboard.
 *
 * Single page that surfaces the read-only diagnostics produced by
 * GET /api/admin/system-health (see
 * Backend/controllers/Admin/systemHealthController.js).
 *
 * Six sections, one card each:
 *   1. DB        — per-collection document counts + total db size.
 *   2. Crons     — known scheduled jobs with their current lock state.
 *   3. Errors    — client-side render crashes from the React boundary.
 *   4. Activity  — today's hospital activity (admissions, beds, OPDs).
 *   5. Integrity — invariant checks tagged ok | warn | crit.
 *   6. Server    — node version, uptime, memory, pid.
 *
 * Auto-refreshes every 30 s while the tab is open.  A manual "Refresh"
 * button is also present so an admin can force-pull immediately after
 * a hot config change.
 *
 * Loading skeleton renders empty card outlines so the page never shows
 * a half-empty grid mid-fetch.
 *
 * Gated by RoleGuard allow=["Admin"] at the route layer (App.jsx) — the
 * page itself doesn't enforce the role, it relies on the router guard
 * + the backend `users.read` action gate. Belt and braces.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE_URL as API_URL } from "../../config/api";
import "./SystemHealthPage.css";

const REFRESH_MS = 30_000;

/* ── Small helpers ─────────────────────────────────────────────────── */
function fmtBytes(n) {
  if (n == null || Number.isNaN(n)) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0, v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${units[i]}`;
}
function fmtNum(n) {
  if (n == null || Number.isNaN(n)) return "—";
  return Number(n).toLocaleString("en-IN");
}
function fmtUptime(sec) {
  if (sec == null) return "—";
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${Math.floor(sec % 60)}s`;
}
function fmtTime(iso) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString("en-IN", { hour12: false }); }
  catch (_) { return String(iso); }
}
function mongoStateLabel(s) {
  switch (s) {
    case 0: return "disconnected";
    case 1: return "connected";
    case 2: return "connecting";
    case 3: return "disconnecting";
    default: return `unknown (${s})`;
  }
}

/* ── Tiny presentational primitives ───────────────────────────────── */
function Section({ icon, title, children, danger, warn }) {
  return (
    <section className={`health-section ${danger ? "is-danger" : ""} ${warn ? "is-warn" : ""}`}>
      <header className="health-section__head">
        <i className={`pi ${icon}`} />
        <h2>{title}</h2>
      </header>
      <div className="health-section__body">{children}</div>
    </section>
  );
}
function KV({ label, value, mono }) {
  return (
    <div className="health-kv">
      <span className="health-kv__k">{label}</span>
      <span className={`health-kv__v ${mono ? "is-mono" : ""}`}>{value}</span>
    </div>
  );
}
function Dot({ status }) {
  return <span className={`health-dot health-dot--${status || "ok"}`} aria-label={status} />;
}
function Skeleton({ rows = 4 }) {
  return (
    <div className="health-skeleton">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="health-skeleton__row" />
      ))}
    </div>
  );
}

/* ── Main page ────────────────────────────────────────────────────── */
export default function SystemHealthPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [fetchedAt, setFetchedAt] = useState(null);
  const timerRef = useRef(null);

  const fetchHealth = useCallback(async (showSpinner = false) => {
    if (showSpinner) setLoading(true);
    setError(null);
    try {
      const token = sessionStorage.getItem("his_token");
      const res = await fetch(`${API_URL}/admin/system-health`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.message || `HTTP ${res.status}`);
      }
      setData(json.data);
      setFetchedAt(json.generatedAt || new Date().toISOString());
    } catch (e) {
      setError(e.message || "Failed to load system health");
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load + auto-refresh.  We clear the interval in the cleanup
  // so a navigation away from the page doesn't keep polling.
  useEffect(() => {
    fetchHealth(true);
    timerRef.current = setInterval(() => fetchHealth(false), REFRESH_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [fetchHealth]);

  // Render skeleton during FIRST load only — subsequent silent refreshes
  // leave the existing data on screen so the page never blinks.
  const showSkeleton = loading && !data;

  return (
    <div className="health-shell">
      {/* ── Hero ───────────────────────────────────────────────── */}
      <header className="health-hero">
        <div className="health-hero__left">
          <i className="pi pi-server health-hero__icon" />
          <div>
            <h1 className="health-hero__title">System Health</h1>
            <p className="health-hero__subtitle">
              Live read-only diagnostics — DB, crons, errors, activity, integrity, server.
            </p>
          </div>
        </div>
        <div className="health-hero__right">
          {fetchedAt && (
            <span className="health-pill">
              Last fetched: {fmtTime(fetchedAt)}
            </span>
          )}
          <button
            className="health-refresh"
            onClick={() => fetchHealth(false)}
            disabled={loading}
          >
            <i className={`pi ${loading ? "pi-spin pi-spinner" : "pi-refresh"}`} />
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      {error && (
        <div className="health-error">
          <i className="pi pi-exclamation-triangle" />
          <div>
            <strong>Failed to load system health.</strong>
            <p>{error}</p>
          </div>
        </div>
      )}

      {/* ── Grid: 6 sections ──────────────────────────────────── */}
      <div className="health-grid">
        {/* 1. DB ────────────────────────────────────────────── */}
        <Section icon="pi-database" title="Database">
          {showSkeleton ? <Skeleton rows={8} /> : (
            <DbCard db={data?.db} />
          )}
        </Section>

        {/* 2. Crons ─────────────────────────────────────────── */}
        <Section icon="pi-clock" title="Scheduled Jobs (Crons)">
          {showSkeleton ? <Skeleton rows={6} /> : (
            <CronsCard crons={data?.crons} />
          )}
        </Section>

        {/* 3. Errors ────────────────────────────────────────── */}
        <Section icon="pi-exclamation-triangle" title="Client Errors">
          {showSkeleton ? <Skeleton rows={4} /> : (
            <ErrorsCard errors={data?.errors} />
          )}
        </Section>

        {/* 4. Activity ──────────────────────────────────────── */}
        <Section icon="pi-chart-line" title="Today's Activity">
          {showSkeleton ? <Skeleton rows={6} /> : (
            <ActivityCard activity={data?.activity} />
          )}
        </Section>

        {/* 5. Integrity ─────────────────────────────────────── */}
        <Section icon="pi-shield" title="Integrity Checks">
          {showSkeleton ? <Skeleton rows={3} /> : (
            <IntegrityCard integrity={data?.integrity} />
          )}
        </Section>

        {/* 6. Server ────────────────────────────────────────── */}
        <Section icon="pi-cog" title="Server">
          {showSkeleton ? <Skeleton rows={6} /> : (
            <ServerCard server={data?.server} />
          )}
        </Section>
      </div>
    </div>
  );
}

/* ── Card bodies ──────────────────────────────────────────────────── */
function DbCard({ db }) {
  if (!db || db.error) {
    return <p className="health-empty">{db?.error || "No DB data."}</p>;
  }
  const c = db.counts || {};
  const s = db.stats || {};
  return (
    <>
      <h3 className="health-kv__group">Collection counts</h3>
      <KV label="Patients" value={fmtNum(c.patients)} />
      <KV label="Admissions" value={fmtNum(c.admissions)} />
      <KV label="OPDs" value={fmtNum(c.opds)} />
      <KV label="Bills" value={fmtNum(c.bills)} />
      <KV label="Billing triggers" value={fmtNum(c.billingTriggers)} />
      <KV label="Drug batches" value={fmtNum(c.drugBatches)} />
      <KV label="Doctor orders" value={fmtNum(c.doctorOrders)} />
      <KV label="Prescriptions" value={fmtNum(c.prescriptions)} />
      <KV label="MAR entries" value={fmtNum(c.marEntries)} />
      <KV label="Client errors" value={fmtNum(c.clientErrors)} />

      <h3 className="health-kv__group">NABH registers</h3>
      <KV label="OT register" value={fmtNum(c.nabh?.otRegisters)} />
      <KV label="ASA register" value={fmtNum(c.nabh?.asaRegisters)} />
      <KV label="Readmission register" value={fmtNum(c.nabh?.readmissionRegisters)} />
      <KV label="Mortality register" value={fmtNum(c.nabh?.mortalityRegisters)} />
      <KV label="Restraint register" value={fmtNum(c.nabh?.restraintRegisters)} />
      <KV label="Antimicrobial register" value={fmtNum(c.nabh?.antimicrobialRegisters)} />

      <h3 className="health-kv__group">db.stats()</h3>
      {s.error ? (
        <p className="health-empty">{s.error}</p>
      ) : (
        <>
          <KV label="Collections" value={fmtNum(s.collections)} />
          <KV label="Objects" value={fmtNum(s.objects)} />
          <KV label="Data size" value={fmtBytes(s.dataSize)} />
          <KV label="Storage size" value={fmtBytes(s.storageSize)} />
          <KV label="Indexes" value={fmtNum(s.indexes)} />
          <KV label="Index size" value={fmtBytes(s.indexSize)} />
        </>
      )}
    </>
  );
}

function CronsCard({ crons }) {
  if (!crons || crons.error) {
    return <p className="health-empty">{crons?.error || "No cron data."}</p>;
  }
  const jobs = Array.isArray(crons.jobs) ? crons.jobs : [];
  return (
    <>
      <p className="health-note">{crons.note}</p>
      <table className="health-table">
        <thead>
          <tr>
            <th>Job</th>
            <th>Schedule</th>
            <th>Lock</th>
            <th>Acquired</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((j) => (
            <tr key={j.name}>
              <td className="is-mono">{j.name}</td>
              <td>{j.schedule}</td>
              <td>
                {j.lockHeld
                  ? <span className="health-pill health-pill--warn">held</span>
                  : <span className="health-pill health-pill--ok">free</span>}
              </td>
              <td>{fmtTime(j.lockAcquiredAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {Array.isArray(crons.orphans) && crons.orphans.length > 0 && (
        <p className="health-note health-note--warn">
          Orphan locks found (cron name not registered here): {crons.orphans.join(", ")}
        </p>
      )}
    </>
  );
}

function ErrorsCard({ errors }) {
  if (!errors || errors.error) {
    return <p className="health-empty">{errors?.error || "No error data."}</p>;
  }
  const e = errors;
  return (
    <>
      <KV label="Last 24h" value={fmtNum(e.totalClientErrors24h)} />
      <KV label="Last 7 days" value={fmtNum(e.totalClientErrors7d)} />
      <KV label="Top error count" value={fmtNum(e.topErrorCount)} />
      <KV label="Top error last seen" value={fmtTime(e.topErrorLastSeen)} />
      <div className="health-kv">
        <span className="health-kv__k">Top error message</span>
        <span className="health-kv__v is-mono health-clip">
          {e.topErrorMessage || "—"}
        </span>
      </div>
    </>
  );
}

function ActivityCard({ activity }) {
  if (!activity || activity.error) {
    return <p className="health-empty">{activity?.error || "No activity data."}</p>;
  }
  const a = activity;
  const occPct = a.totalBeds > 0
    ? Math.round((a.occupiedBeds / a.totalBeds) * 100)
    : null;
  return (
    <>
      <KV label="Active admissions" value={fmtNum(a.activeAdmissions)} />
      <KV
        label="Beds occupied / total"
        value={`${fmtNum(a.occupiedBeds)} / ${fmtNum(a.totalBeds)}${occPct != null ? ` (${occPct}%)` : ""}`}
      />
      <KV label="Registered today" value={fmtNum(a.registeredToday)} />
      <KV label="OPDs today" value={fmtNum(a.opdToday)} />
      <KV label="Bills today" value={fmtNum(a.billsToday)} />
    </>
  );
}

function IntegrityCard({ integrity }) {
  if (!integrity || integrity.error) {
    return <p className="health-empty">{integrity?.error || "No integrity data."}</p>;
  }
  const checks = Array.isArray(integrity.checks) ? integrity.checks : [];
  if (checks.length === 0) return <p className="health-empty">No checks ran.</p>;
  return (
    <ul className="health-checks">
      {checks.map((c) => (
        <li key={c.name} className={`health-check is-${c.status}`}>
          <Dot status={c.status} />
          <div className="health-check__body">
            <div className="health-check__top">
              <strong>{c.name}</strong>
              <span className="is-mono">
                {c.count == null ? "n/a" : fmtNum(c.count)}
              </span>
            </div>
            <div className="health-check__hint">{c.hint}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function ServerCard({ server }) {
  if (!server || server.error) {
    return <p className="health-empty">{server?.error || "No server data."}</p>;
  }
  const s = server;
  const mem = s.memoryUsage || {};
  return (
    <>
      <KV label="Node version" value={s.nodeVersion || "—"} mono />
      <KV label="Uptime" value={fmtUptime(s.uptime)} />
      <KV label="PID" value={fmtNum(s.pid)} mono />
      <KV label="Platform" value={`${s.platform || "—"} / ${s.arch || "—"}`} mono />
      <KV label="Mongo state" value={mongoStateLabel(s.mongoState)} />
      <KV label="RSS" value={fmtBytes(mem.rss)} />
      <KV label="Heap used / total" value={`${fmtBytes(mem.heapUsed)} / ${fmtBytes(mem.heapTotal)}`} />
      <KV label="External" value={fmtBytes(mem.external)} />
    </>
  );
}
