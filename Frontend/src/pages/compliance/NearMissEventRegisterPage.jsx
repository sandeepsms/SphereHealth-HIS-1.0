/**
 * NearMissEventRegisterPage.jsx — R7gw-B9-T02 / NABH QPS.5
 *
 * Manual-entry log of every near-miss caught in the facility — wrong-med
 * intercepted at MAR, wrong-patient grab caught at biometric scan, fall
 * prevented by sitter, IV extravasation noticed before harm, equipment
 * malfunction detected pre-use.
 *
 * NABH QPS.5 expects the QPS Committee to chart these monthly. Clusters
 * around the same root cause as a recent sentinel are the highest-yield
 * surveyor signal — hence the optional linkedSentinelId field.
 *
 *   URL: /compliance/nabh-registers/nearmissevent
 *
 * Role-gated: Admin / Doctor / Nurse / MRD (compliance.nabh.read for the
 * page; compliance.nabh.write for the manual entry form).
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import {
  AdminPage, Hero, Card, Table, EmptyRow, Badge, C,
} from "../../Components/admin-theme";
import { API_BASE_URL as API } from "../../config/api";

const authHdr = () => ({
  headers: { Authorization: `Bearer ${sessionStorage.getItem("his_token")}` },
});

const fmt = (d) =>
  d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

const todayISO = () => new Date().toISOString().slice(0, 10);
const isoDaysAgo = (n) => {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

// Enum lists — keep in lock-step with NearMissEventRegisterModel.js
const EVENT_TYPES = [
  "Wrong-medication-intercepted",
  "Wrong-patient-intercepted",
  "Wrong-site-intercepted",
  "IV-extravasation-prevented",
  "Fall-prevented",
  "Equipment-malfunction-detected",
];
// NCC-MERP severity scale A-I (would-have-been if not intercepted)
const SEVERITIES = ["A", "B", "C", "D", "E", "F", "G", "H", "I"];
const SEVERITY_HINT = {
  A: "A — Circumstances with capacity to cause error",
  B: "B — Error occurred, did not reach patient",
  C: "C — Reached patient, no harm",
  D: "D — Reached patient, monitoring required",
  E: "E — Temporary harm, intervention",
  F: "F — Temporary harm, hospitalisation",
  G: "G — Permanent harm",
  H: "H — Required intervention to sustain life",
  I: "I — Patient died",
};
const STATUSES = ["Open", "InProgress", "Closed"];

const tdStyle = { padding: "8px 12px", borderBottom: `1px solid ${C.border}`, fontSize: 12, verticalAlign: "top" };
const inputStyle = { padding: 6, border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 13, width: "100%" };
const labelStyle = { fontSize: 11, color: C.muted, display: "block", marginBottom: 2 };

const blankEntry = {
  UHID: "",
  patientName: "",
  eventType: "Wrong-medication-intercepted",
  observedAt: new Date().toISOString().slice(0, 16),
  observedByEmpId: "",
  severityIfMissed: "C",
  interventionTaken: "",
  recommendation: "",
  linkedSentinelId: "",
  status: "Open",
};

export default function NearMissEventRegisterPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [startDate, setStartDate] = useState(isoDaysAgo(30));
  const [endDate, setEndDate] = useState(todayISO());
  const [statusFilter, setStatusFilter] = useState("");
  const [eventTypeFilter, setEventTypeFilter] = useState("");
  const [severityFilter, setSeverityFilter] = useState("");
  const [qText, setQText] = useState("");

  // Add-entry modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [entry, setEntry] = useState({ ...blankEntry });
  const [submitting, setSubmitting] = useState(false);

  // Detail modal
  const [detail, setDetail] = useState(null);

  // ── Fetch the list ────────────────────────────────────────────────
  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const params = {
        startDate,
        endDate,
        limit: 200,
        ...(statusFilter ? { status: statusFilter } : {}),
        ...(eventTypeFilter ? { eventType: eventTypeFilter } : {}),
        ...(severityFilter ? { severityIfMissed: severityFilter } : {}),
        ...(qText ? { q: qText } : {}),
      };
      const r = await axios.get(`${API}/nabh-registers/near-miss-events`, {
        ...authHdr(),
        params,
      });
      setRows(r.data?.data || []);
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to load near-miss register");
    }
    setLoading(false);
  }, [startDate, endDate, statusFilter, eventTypeFilter, severityFilter, qText]);

  useEffect(() => { fetchList(); }, [fetchList]);

  // ── Submit a manual near-miss entry ─────────────────────────────
  const submitEntry = async () => {
    if (!entry.eventType) { toast.warn("Event type is required"); return; }
    if (!entry.observedAt) { toast.warn("Observed-at is required"); return; }
    if (!entry.observedByEmpId) { toast.warn("Observer Emp ID is required"); return; }
    if (!entry.severityIfMissed) { toast.warn("Severity-if-missed is required"); return; }
    setSubmitting(true);
    try {
      const r = await axios.post(`${API}/nabh-registers/near-miss-events`, {
        UHID: entry.UHID,
        patientName: entry.patientName,
        eventType: entry.eventType,
        observedAt: entry.observedAt || new Date().toISOString(),
        observedByEmpId: entry.observedByEmpId,
        severityIfMissed: entry.severityIfMissed,
        interventionTaken: entry.interventionTaken,
        recommendation: entry.recommendation,
        linkedSentinelId: entry.linkedSentinelId || undefined,
        status: entry.status || "Open",
      }, authHdr());
      toast.success(`Near-miss logged · ${r.data?.data?._id?.slice(-6) || "OK"}`);
      setEntry({ ...blankEntry });
      setModalOpen(false);
      fetchList();
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to save near-miss");
    }
    setSubmitting(false);
  };

  // ── Status badge helpers ──────────────────────────────────────────
  const statusBadge = (s) => {
    if (s === "Closed") return <Badge value="CLOSED" palette="green" />;
    if (s === "InProgress") return <Badge value="IN PROGRESS" palette="blue" />;
    return <Badge value="OPEN" palette="orange" />;
  };

  const severityBadge = (sev) => {
    // A-D: low (green/blue); E-F: medium (orange); G-I: high (red)
    if (!sev) return <Badge value="—" palette="muted" />;
    const palette = ["G", "H", "I"].includes(sev) ? "red"
                  : ["E", "F"].includes(sev) ? "orange"
                  : ["A", "B", "C", "D"].includes(sev) ? "green" : "muted";
    return <Badge value={sev} palette={palette} />;
  };

  const totalOpen = useMemo(() => rows.filter((r) => r.status === "Open").length, [rows]);
  const totalCritical = useMemo(() => rows.filter((r) => ["G", "H", "I"].includes(r.severityIfMissed)).length, [rows]);

  return (
    <AdminPage>
      <Hero
        icon="pi-shield"
        title="Near-Miss Event Register"
        subtitle="NABH QPS.5 — chronological log of every near-miss intercepted before harm (wrong-med caught at MAR, prevented fall, equipment failure detected). Manual entry only — no auto-trigger."
        color="orange"
      />

      {/* ── Filters ───────────────────────────────────────────────── */}
      <Card title="Filters">
        <div style={{ display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap" }}>
          <div>
            <label style={labelStyle}>From</label>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
              style={{ ...inputStyle, width: 160 }} />
          </div>
          <div>
            <label style={labelStyle}>To</label>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
              style={{ ...inputStyle, width: 160 }} />
          </div>
          <div>
            <label style={labelStyle}>Status</label>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
              style={{ ...inputStyle, width: 150 }}>
              <option value="">All</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Event type</label>
            <select value={eventTypeFilter} onChange={(e) => setEventTypeFilter(e.target.value)}
              style={{ ...inputStyle, width: 220 }}>
              <option value="">All</option>
              {EVENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Severity</label>
            <select value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)}
              style={{ ...inputStyle, width: 110 }}>
              <option value="">All</option>
              {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Search</label>
            <input value={qText} onChange={(e) => setQText(e.target.value)}
              placeholder="UHID / patient / intervention"
              style={{ ...inputStyle, width: 220 }} />
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
            <div style={{ fontSize: 12, color: C.muted }}>
              <strong style={{ color: C.text }}>{rows.length}</strong> entries
              {totalOpen > 0 && <> · <span style={{ color: "#ea580c", fontWeight: 600 }}>{totalOpen} open</span></>}
              {totalCritical > 0 && <> · <span style={{ color: "#dc2626", fontWeight: 600 }}>{totalCritical} high-severity-if-missed</span></>}
            </div>
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              style={{
                padding: "6px 14px", borderRadius: 6, border: `1px solid #ea580c`,
                background: "#ea580c", color: "#fff", cursor: "pointer",
                fontWeight: 700, fontSize: 13,
              }}
            >
              <i className="pi pi-plus" style={{ marginRight: 6 }} />Add Entry
            </button>
          </div>
        </div>
      </Card>

      {/* ── Table ─────────────────────────────────────────────────── */}
      <Card title={`Near-Miss Events · ${rows.length} entries`}>
        <Table cols={["Observed", "UHID", "Patient", "Event", "Sev-if-Missed", "Intervention", "Status", "Obs. Emp ID", "Sentinel?"]}>
          {rows.length === 0 ? (
            <EmptyRow span={9} text={loading ? "Loading…" : "No near-miss events recorded in this range"} />
          ) : rows.map((r) => (
            <tr
              key={r._id}
              onClick={() => setDetail({ ...r })}
              style={{ cursor: "pointer" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "#fff7ed"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "#fff"; }}
            >
              <td style={tdStyle}>{fmt(r.observedAt)}</td>
              <td style={tdStyle}>{r.UHID ? <strong>{r.UHID}</strong> : "—"}</td>
              <td style={tdStyle}>{r.patientName || "—"}</td>
              <td style={tdStyle}><Badge value={r.eventType} palette="orange" /></td>
              <td style={tdStyle}>{severityBadge(r.severityIfMissed)}</td>
              <td style={tdStyle}>{(r.interventionTaken || "—").slice(0, 80)}</td>
              <td style={tdStyle}>{statusBadge(r.status)}</td>
              <td style={tdStyle}>{r.observedByEmpId || "—"}</td>
              <td style={tdStyle}>
                {r.linkedSentinelId
                  ? <Badge value="LINKED" palette="red" />
                  : <Badge value="—" palette="muted" />}
              </td>
            </tr>
          ))}
        </Table>
      </Card>

      {/* ── Add-entry modal ──────────────────────────────────────── */}
      {modalOpen && (
        <AddEntryModal
          entry={entry}
          onChange={(patch) => setEntry((p) => ({ ...p, ...patch }))}
          onClose={() => { setModalOpen(false); setEntry({ ...blankEntry }); }}
          onSubmit={submitEntry}
          submitting={submitting}
        />
      )}

      {/* ── Detail modal ─────────────────────────────────────────── */}
      {detail && (
        <DetailModal
          row={detail}
          onClose={() => setDetail(null)}
        />
      )}
    </AdminPage>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Add Entry modal
// ─────────────────────────────────────────────────────────────────────────
function AddEntryModal({ entry, onChange, onClose, onSubmit, submitting }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.6)",
        zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff", borderRadius: 10, padding: 22, maxWidth: 720,
          width: "100%", maxHeight: "90vh", overflow: "auto",
          boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: "#ea580c" }}>
            <i className="pi pi-shield" style={{ marginRight: 8 }} />
            Log Near-Miss Event
          </div>
          <button
            onClick={onClose}
            style={{
              padding: "4px 10px", borderRadius: 6, border: `1px solid ${C.border}`,
              background: "#fff", color: C.muted, cursor: "pointer",
              fontSize: 12, fontWeight: 600,
            }}
          >Close</button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12, marginBottom: 12 }}>
          <div>
            <label style={labelStyle}>UHID</label>
            <input
              value={entry.UHID}
              onChange={(e) => onChange({ UHID: e.target.value.toUpperCase() })}
              placeholder="Optional"
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Patient name</label>
            <input
              value={entry.patientName}
              onChange={(e) => onChange({ patientName: e.target.value })}
              placeholder="Optional — pre-fill if known"
              style={inputStyle}
            />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
          <div>
            <label style={labelStyle}>Event type *</label>
            <select
              value={entry.eventType}
              onChange={(e) => onChange({ eventType: e.target.value })}
              style={inputStyle}
            >
              {EVENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Observed at *</label>
            <input
              type="datetime-local"
              value={entry.observedAt}
              onChange={(e) => onChange({ observedAt: e.target.value })}
              style={inputStyle}
            />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
          <div>
            <label style={labelStyle}>Observed by (Emp ID) *</label>
            <input
              value={entry.observedByEmpId}
              onChange={(e) => onChange({ observedByEmpId: e.target.value })}
              placeholder="e.g. EMP00123"
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Severity if missed (NCC-MERP) *</label>
            <select
              value={entry.severityIfMissed}
              onChange={(e) => onChange({ severityIfMissed: e.target.value })}
              style={inputStyle}
            >
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>{SEVERITY_HINT[s] || s}</option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle}>Intervention taken (what stopped the harm)</label>
          <textarea
            value={entry.interventionTaken}
            onChange={(e) => onChange({ interventionTaken: e.target.value })}
            rows={2}
            placeholder="e.g. Nurse cross-checked patient ID band before administering, drug withheld"
            style={{ ...inputStyle, fontFamily: "inherit", resize: "vertical" }}
          />
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle}>Recommendation (system-level change)</label>
          <textarea
            value={entry.recommendation}
            onChange={(e) => onChange({ recommendation: e.target.value })}
            rows={2}
            placeholder="e.g. Update look-alike-sound-alike storage policy in dispensary"
            style={{ ...inputStyle, fontFamily: "inherit", resize: "vertical" }}
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
          <div>
            <label style={labelStyle}>Status</label>
            <select
              value={entry.status}
              onChange={(e) => onChange({ status: e.target.value })}
              style={inputStyle}
            >
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Linked Sentinel _id (optional)</label>
            <input
              value={entry.linkedSentinelId}
              onChange={(e) => onChange({ linkedSentinelId: e.target.value })}
              placeholder="24-hex ObjectId or blank"
              style={inputStyle}
            />
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "6px 14px", borderRadius: 6, border: `1px solid ${C.border}`,
              background: "#fff", color: C.muted, cursor: "pointer",
              fontWeight: 600, fontSize: 13,
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={submitting}
            style={{
              padding: "6px 18px", borderRadius: 6, border: `1px solid #ea580c`,
              background: submitting ? C.border : "#ea580c",
              color: "#fff", cursor: submitting ? "not-allowed" : "pointer",
              fontWeight: 700, fontSize: 13,
            }}
          >
            {submitting ? "Saving..." : "Log Near-Miss"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Detail modal — full row + audit trail
// ─────────────────────────────────────────────────────────────────────────
function DetailModal({ row, onClose }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.6)",
        zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff", borderRadius: 10, padding: 22, maxWidth: 800,
          width: "100%", maxHeight: "90vh", overflow: "auto",
          boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, color: C.text }}>
              {row.eventType}
              {row.UHID ? <span style={{ color: C.muted, fontWeight: 400, fontSize: 14 }}> · {row.UHID}</span> : null}
            </div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
              Observed {fmt(row.observedAt)} by {row.observedByEmpId || "—"}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              padding: "4px 10px", borderRadius: 6, border: `1px solid ${C.border}`,
              background: "#fff", color: C.muted, cursor: "pointer",
              fontSize: 12, fontWeight: 600,
            }}
          >Close</button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, fontSize: 12, marginBottom: 14 }}>
          <div><span style={{ color: C.muted }}>Patient</span><div>{row.patientName || "—"}</div></div>
          <div><span style={{ color: C.muted }}>UHID</span><div>{row.UHID || "—"}</div></div>
          <div><span style={{ color: C.muted }}>Status</span><div>{row.status || "Open"}</div></div>
          <div><span style={{ color: C.muted }}>Severity if missed</span><div>{SEVERITY_HINT[row.severityIfMissed] || row.severityIfMissed || "—"}</div></div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>Intervention taken</div>
          <div style={{
            padding: 10, borderRadius: 6, background: "#f8fafc",
            fontSize: 12, color: C.text, border: `1px solid ${C.border}`,
          }}>{row.interventionTaken || "—"}</div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>Recommendation</div>
          <div style={{
            padding: 10, borderRadius: 6, background: "#f8fafc",
            fontSize: 12, color: C.text, border: `1px solid ${C.border}`,
          }}>{row.recommendation || "—"}</div>
        </div>

        {row.linkedSentinelId && (
          <div style={{
            padding: 10, borderRadius: 6, background: "#fef2f2",
            border: `1px solid #fecaca`, marginBottom: 14, fontSize: 12,
          }}>
            <strong>Linked to Sentinel:</strong> {row.linkedSentinelId}
          </div>
        )}

        {/* Audit trail */}
        <div style={{ fontWeight: 600, fontSize: 13, color: C.text, marginBottom: 6 }}>Audit Trail</div>
        <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 8 }}>
          {(row.auditTrail || []).length === 0 ? (
            <div style={{ fontSize: 12, color: C.muted }}>No audit entries</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ ...tdStyle, fontWeight: 700, background: "#f8fafc" }}>When</th>
                  <th style={{ ...tdStyle, fontWeight: 700, background: "#f8fafc" }}>Action</th>
                  <th style={{ ...tdStyle, fontWeight: 700, background: "#f8fafc" }}>By</th>
                  <th style={{ ...tdStyle, fontWeight: 700, background: "#f8fafc" }}>Note</th>
                </tr>
              </thead>
              <tbody>
                {(row.auditTrail || []).map((a, i) => (
                  <tr key={i}>
                    <td style={tdStyle}>{a.at ? new Date(a.at).toLocaleString("en-IN") : "—"}</td>
                    <td style={tdStyle}><Badge value={a.action} palette="muted" /></td>
                    <td style={tdStyle}>{a.byName || "—"}{a.byRole ? <div style={{ fontSize: 10, color: C.muted }}>{a.byRole}</div> : null}</td>
                    <td style={tdStyle}>{a.reason || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
