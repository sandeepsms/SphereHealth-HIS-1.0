// pages/admin/BackupRecoveryPage.jsx
// R7hr-272 — Admin "Backup & Recovery" page. Surfaces the existing tool-free
// backup system (R7hr-253/254) IN the app: status, run-now, download. The
// destructive RESTORE stays CLI-only (shown as instructions, no button).
import React, { useEffect, useState, useCallback } from "react";
import { backupService } from "../../Services/backupService";

const C = {
  ink: "#0f172a", sub: "#64748b", line: "#e2e8f0", bg: "#f8fafc",
  blue: "#2563eb", blueL: "#eff6ff", green: "#16a34a", greenL: "#f0fdf4",
  amber: "#b45309", amberL: "#fffbeb", red: "#dc2626", redL: "#fef2f2",
};

const fmtBytes = (n) => {
  if (!n && n !== 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(2)} MB`;
};
const fmtDate = (s) =>
  s ? new Date(s).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

const card = { background: "#fff", border: `1px solid ${C.line}`, borderRadius: 12, padding: 18, marginBottom: 16, boxShadow: "0 1px 3px rgba(0,0,0,.04)" };

export default function BackupRecoveryPage() {
  const [status, setStatus]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [msg, setMsg]         = useState(null);     // { tone, text }
  const [logTail, setLogTail] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await backupService.getStatus();
      setStatus(r.data || r);
    } catch (e) {
      setMsg({ tone: "err", text: e?.response?.data?.message || "Could not load backup status." });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const runNow = async () => {
    setRunning(true); setMsg(null); setLogTail("");
    try {
      const r = await backupService.runBackup();
      const d = r.data || r;
      if (d.ok) {
        setMsg({ tone: "ok", text: `Backup complete — ${d.status?.totalDocs ?? "?"} documents, ${fmtBytes(d.status?.sizeBytes)}${d.offlineOnly ? " (offline-only — configure a cloud folder for off-site copy)" : ""}.` });
      } else if (r.busy || d.busy) {
        setMsg({ tone: "warn", text: "A backup is already running — try again shortly." });
      } else {
        setMsg({ tone: "err", text: `Backup failed${d.status?.error ? `: ${d.status.error}` : ` (exit ${d.code})`}.` });
      }
      if (d.logTail) setLogTail(d.logTail);
    } catch (e) {
      setMsg({ tone: "err", text: e?.response?.data?.message || "Run failed." });
    } finally {
      setRunning(false);
      load();
    }
  };

  const download = async (file) => {
    try { await backupService.downloadBackup(file); }
    catch (e) { setMsg({ tone: "err", text: e?.response?.data?.message || "Download failed." }); }
  };

  const last = status?.last;
  const allFiles = [...(status?.nightly || []), ...(status?.monthly || [])];

  const tone = (t) => t === "ok"
    ? { bg: C.greenL, bd: "#86efac", fg: C.green }
    : t === "warn"
    ? { bg: C.amberL, bd: "#fcd34d", fg: C.amber }
    : { bg: C.redL, bd: "#fecaca", fg: C.red };

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: "22px 18px", color: C.ink }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>🛟 Backup &amp; Recovery</h1>
        <button onClick={load} disabled={loading}
          style={{ border: `1px solid ${C.line}`, background: "#fff", borderRadius: 8, padding: "7px 12px", cursor: "pointer", color: C.sub }}>
          ↻ Refresh
        </button>
      </div>
      <p style={{ color: C.sub, marginTop: 0, marginBottom: 18 }}>
        Full-fidelity database backups (every collection, integrity-checked). Nightly + monthly
        run automatically once scheduled; you can also run one on demand here.
      </p>

      {msg && (
        <div style={{ ...card, background: tone(msg.tone).bg, border: `1px solid ${tone(msg.tone).bd}`, color: tone(msg.tone).fg, fontWeight: 600 }}>
          {msg.text}
        </div>
      )}

      {/* Configuration / destinations */}
      <div style={card}>
        <div style={{ fontWeight: 700, marginBottom: 10 }}>Destinations</div>
        <Row label="Offline (local) folder" value={status?.offlineDir} ok={status?.offlineConfigured}
             hint={status?.offlineConfigured ? null : "using default — set BACKUP_OFFLINE_DIR in Backend/.env for an external/USB drive"} />
        <Row label="Online (cloud-synced) folder" value={status?.syncedDir || "Not configured"} ok={status?.syncedConfigured}
             hint={status?.syncedConfigured ? null : "set BACKUP_SYNCED_DIR (e.g. a OneDrive folder) for an off-site copy"} />
      </div>

      {/* Last backup + Run now */}
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ fontWeight: 700 }}>Last backup</div>
          <button onClick={runNow} disabled={running}
            style={{ background: running ? "#93c5fd" : C.blue, color: "#fff", border: "none", borderRadius: 8, padding: "9px 16px", fontWeight: 700, cursor: running ? "wait" : "pointer" }}>
            {running ? "⏳ Backing up…" : "▶ Run Backup Now"}
          </button>
        </div>
        {running && <div style={{ color: C.sub, fontSize: 13, marginBottom: 8 }}>This can take up to a minute on a large database — please wait…</div>}
        {!last && <div style={{ color: C.sub }}>No backup has run yet.</div>}
        {last && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }}>
            <Stat label="Status" value={last.ok ? "✅ OK" : "❌ Failed"} fg={last.ok ? C.green : C.red} />
            <Stat label="When" value={fmtDate(last.at)} />
            <Stat label="Documents" value={last.totalDocs ?? "—"} />
            <Stat label="Size" value={fmtBytes(last.sizeBytes)} />
            <Stat label="Off-site" value={last.online || "—"} />
            <Stat label="SHA-256" value={last.sha256 ? `${String(last.sha256).slice(0, 12)}…` : "—"} />
          </div>
        )}
        {!last?.ok && last?.error && <div style={{ color: C.red, marginTop: 8, fontSize: 13 }}>Error: {last.error}</div>}
        {logTail && (
          <pre style={{ marginTop: 12, background: "#0f172a", color: "#e2e8f0", padding: 12, borderRadius: 8, fontSize: 12, maxHeight: 180, overflow: "auto", whiteSpace: "pre-wrap" }}>{logTail}</pre>
        )}
      </div>

      {/* Available backup files */}
      <div style={card}>
        <div style={{ fontWeight: 700, marginBottom: 10 }}>Available backups ({allFiles.length})</div>
        {allFiles.length === 0 && <div style={{ color: C.sub }}>None yet — run a backup above.</div>}
        {allFiles.length > 0 && (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", color: C.sub, borderBottom: `1px solid ${C.line}` }}>
                <th style={{ padding: "8px 6px" }}>File</th>
                <th style={{ padding: "8px 6px" }}>Type</th>
                <th style={{ padding: "8px 6px" }}>Date</th>
                <th style={{ padding: "8px 6px" }}>Size</th>
                <th style={{ padding: "8px 6px" }}></th>
              </tr>
            </thead>
            <tbody>
              {allFiles.map((f) => (
                <tr key={f.sub + f.name} style={{ borderBottom: `1px solid ${C.line}` }}>
                  <td style={{ padding: "8px 6px", fontFamily: "monospace" }}>{f.name}</td>
                  <td style={{ padding: "8px 6px", textTransform: "capitalize" }}>{f.sub}</td>
                  <td style={{ padding: "8px 6px" }}>{fmtDate(f.mtime)}</td>
                  <td style={{ padding: "8px 6px" }}>{fmtBytes(f.sizeBytes)}</td>
                  <td style={{ padding: "8px 6px", textAlign: "right" }}>
                    <button onClick={() => download(f.name)}
                      style={{ border: `1px solid ${C.blue}`, color: C.blue, background: C.blueL, borderRadius: 6, padding: "5px 10px", cursor: "pointer", fontWeight: 600 }}>
                      ⬇ Download
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Restore — CLI only (safety) */}
      <div style={{ ...card, background: C.amberL, border: "1px solid #fcd34d" }}>
        <div style={{ fontWeight: 700, color: C.amber, marginBottom: 6 }}>🔒 Restore (recovery) — command-line only</div>
        <div style={{ color: "#92400e", fontSize: 13, marginBottom: 10 }}>
          Restore <b>overwrites the live database</b>, so it is intentionally not a button here.
          On the server, pick the newest good backup and run (it verifies the checksum first):
        </div>
        <pre style={{ background: "#1f2937", color: "#e5e7eb", padding: 12, borderRadius: 8, fontSize: 12, overflow: "auto" }}>
{`node Backend/scripts/backup/restore.js \\
   --file="<path>\\sphere_YYYYMMDD_HHmm.shbak.gz" \\
   --confirm --drop --yes-overwrite`}
        </pre>
        <div style={{ color: "#92400e", fontSize: 12 }}>
          Full step-by-step guide: <code>Backend/scripts/backup/BACKUP_RECOVERY_RUNBOOK.md</code>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, ok, hint }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "6px 0" }}>
      <div style={{ minWidth: 200, color: C.sub, fontSize: 13 }}>{label}</div>
      <div style={{ flex: 1 }}>
        <span style={{ fontFamily: "monospace", fontSize: 13 }}>{value || "—"}</span>
        {" "}
        <span style={{ fontSize: 12, color: ok ? C.green : C.amber }}>{ok ? "✓ configured" : "• default"}</span>
        {hint && <div style={{ fontSize: 12, color: C.sub, marginTop: 2 }}>{hint}</div>}
      </div>
    </div>
  );
}

function Stat({ label, value, fg }) {
  return (
    <div style={{ background: C.bg, border: `1px solid ${C.line}`, borderRadius: 8, padding: "8px 10px" }}>
      <div style={{ fontSize: 11, color: C.sub, textTransform: "uppercase", letterSpacing: ".04em" }}>{label}</div>
      <div style={{ fontWeight: 700, color: fg || C.ink, fontSize: 14, marginTop: 2, wordBreak: "break-all" }}>{value}</div>
    </div>
  );
}
