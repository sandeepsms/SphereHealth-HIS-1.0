/**
 * SentinelEventRegisterPage.jsx — R7gw-B9-T01 / NABH AAC.7 + MOM.4
 *
 * Surveyor + Quality / Compliance officer facing chronological log of every
 * sentinel event recorded by the HIS. Auto-populated by the backend when:
 *   • a pressure-area assessment records a hospital-acquired ulcer at
 *     stage III, IV, Unstageable or DTI (HAPU stage 3+); or
 *   • a fall-risk assessment records a fall occurrence with a major injury.
 *
 * Manual "Add Entry" path lets compliance staff log incidents not surfaced
 * by existing emit hooks (wrong-patient surgery, suicide attempt, retained
 * foreign object, severe maternal morbidity, etc.).
 *
 *   URL: /compliance/nabh-registers/sentinelevent
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

// Enum lists — keep in lock-step with SentinelEventRegisterModel.js
const EVENT_TYPES = [
  "Unexpected-Death",
  "HAPU-stage3-4",
  "Wrong-Patient-Surgery",
  "Medication-Error-NCC-E-plus",
  "Suicide-attempt",
  "Severe-Maternal-Morbidity",
  "Retained-Object",
  "Fall-with-Major-Injury",
];
const SEVERITIES = ["Critical", "Major"];
const STATUSES = ["Open", "InProgress", "Closed"];

const tdStyle = { padding: "8px 12px", borderBottom: `1px solid ${C.border}`, fontSize: 12, verticalAlign: "top" };
const inputStyle = { padding: 6, border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 13, width: "100%" };
const labelStyle = { fontSize: 11, color: C.muted, display: "block", marginBottom: 2 };

const blankEntry = {
  UHID: "",
  patientName: "",
  eventType: "Unexpected-Death",
  discoveredAt: new Date().toISOString().slice(0, 16),
  discoveredByEmpId: "",
  severity: "Critical",
  immediateAction: "",
  rcaInitiated: false,
};

export default function SentinelEventRegisterPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [startDate, setStartDate] = useState(isoDaysAgo(30));
  const [endDate, setEndDate] = useState(todayISO());
  const [statusFilter, setStatusFilter] = useState("");
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
        ...(qText ? { q: qText } : {}),
      };
      const r = await axios.get(`${API}/nabh-registers/sentinel-events`, {
        ...authHdr(),
        params,
      });
      setRows(r.data?.data || []);
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to load sentinel-event register");
    }
    setLoading(false);
  }, [startDate, endDate, statusFilter, qText]);

  useEffect(() => { fetchList(); }, [fetchList]);

  // ── Submit a manual sentinel-event entry ─────────────────────────
  const submitEntry = async () => {
    if (!entry.UHID) { toast.warn("UHID is required"); return; }
    if (!entry.eventType) { toast.warn("Event type is required"); return; }
    setSubmitting(true);
    try {
      const r = await axios.post(`${API}/nabh-registers/sentinel-events`, {
        UHID: entry.UHID,
        patientName: entry.patientName,
        eventType: entry.eventType,
        discoveredAt: entry.discoveredAt || new Date().toISOString(),
        discoveredByEmpId: entry.discoveredByEmpId,
        severity: entry.severity,
        immediateAction: entry.immediateAction,
        rcaInitiated: entry.rcaInitiated,
      }, authHdr());
      toast.success(`Sentinel-event logged · ${r.data?.data?._id?.slice(-6) || "OK"}`);
      setEntry({ ...blankEntry });
      setModalOpen(false);
      fetchList();
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to save sentinel-event");
    }
    setSubmitting(false);
  };

  // ── Status badge helper ──────────────────────────────────────────
  const statusBadge = (s) => {
    if (s === "Closed") return <Badge value="CLOSED" palette="green" />;
    if (s === "InProgress") return <Badge value="IN PROGRESS" palette="blue" />;
    return <Badge value="OPEN" palette="red" />;
  };

  const severityBadge = (sev) => {
    if (sev === "Critical") return <Badge value="CRITICAL" palette="red" />;
    return <Badge value="MAJOR" palette="orange" />;
  };

  const totalOpen = useMemo(() => rows.filter((r) => r.status === "Open").length, [rows]);
  const totalCritical = useMemo(() => rows.filter((r) => r.severity === "Critical").length, [rows]);

  return (
    <AdminPage>
      <Hero
        icon="pi-exclamation-triangle"
        title="Sentinel Event Register"
        subtitle="NABH AAC.7 / MOM.4 — chronological log of unanticipated events causing death or serious physical / psychological injury. Auto-emitted from HAPU stage III+ and fall-with-major-injury; manual entries for the rest."
        color="red"
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
              style={{ ...inputStyle, width: 160 }}>
              <option value="">All</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Search</label>
            <input value={qText} onChange={(e) => setQText(e.target.value)}
              placeholder="UHID / patient / event"
              style={{ ...inputStyle, width: 220 }} />
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
            <div style={{ fontSize: 12, color: C.muted }}>
              <strong style={{ color: C.text }}>{rows.length}</strong> entries
              {totalOpen > 0 && <> · <span style={{ color: "#dc2626", fontWeight: 600 }}>{totalOpen} open</span></>}
              {totalCritical > 0 && <> · <span style={{ color: "#dc2626", fontWeight: 600 }}>{totalCritical} critical</span></>}
            </div>
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              style={{
                padding: "6px 14px", borderRadius: 6, border: `1px solid #dc2626`,
                background: "#dc2626", color: "#fff", cursor: "pointer",
                fontWeight: 700, fontSize: 13,
              }}
            >
              <i className="pi pi-plus" style={{ marginRight: 6 }} />Add Entry
            </button>
          </div>
        </div>
      </Card>

      {/* ── Table ─────────────────────────────────────────────────── */}
      <Card title={`Sentinel Events · ${rows.length} entries`}>
        <Table cols={["Discovered", "UHID", "Patient", "Event", "Severity", "Status", "Immediate Action", "RCA", "By"]}>
          {rows.length === 0 ? (
            <EmptyRow span={9} text={loading ? "Loading…" : "No sentinel events recorded in this range"} />
          ) : rows.map((r) => (
            <tr
              key={r._id}
              onClick={() => setDetail({ ...r })}
              style={{ cursor: "pointer" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "#fef2f2"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "#fff"; }}
            >
              <td style={tdStyle}>{fmt(r.discoveredAt)}</td>
              <td style={tdStyle}><strong>{r.UHID}</strong></td>
              <td style={tdStyle}>{r.patientName || "—"}</td>
              <td style={tdStyle}><Badge value={r.eventType} palette="red" /></td>
              <td style={tdStyle}>{severityBadge(r.severity)}</td>
              <td style={tdStyle}>{statusBadge(r.status)}</td>
              <td style={tdStyle}>{(r.immediateAction || "—").slice(0, 80)}</td>
              <td style={tdStyle}>
                {r.rcaInitiated
                  ? <Badge value="INITIATED" palette="blue" />
                  : <Badge value="PENDING" palette="muted" />}
              </td>
              <td style={tdStyle}>{r.discoveredByEmpId || "—"}</td>
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
          background: "#fff", borderRadius: 10, padding: 22, maxWidth: 700,
          width: "100%", maxHeight: "90vh", overflow: "auto",
          boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: "#dc2626" }}>
            <i className="pi pi-exclamation-triangle" style={{ marginRight: 8 }} />
            Log Sentinel Event
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
            <label style={labelStyle}>UHID *</label>
            <input
              value={entry.UHID}
              onChange={(e) => onChange({ UHID: e.target.value.toUpperCase() })}
              placeholder="UHID000001"
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Patient name</label>
            <input
              value={entry.patientName}
              onChange={(e) => onChange({ patientName: e.target.value })}
              placeholder="As recorded on UHID"
              style={inputStyle}
            />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
          <div>
            <label style={labelStyle}>Event type *</label>
            <select value={entry.eventType}
              onChange={(e) => onChange({ eventType: e.target.value })}
              style={inputStyle}>
              {EVENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Severity *</label>
            <select value={entry.severity}
              onChange={(e) => onChange({ severity: e.target.value })}
              style={inputStyle}>
              {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Discovered at *</label>
            <input type="datetime-local" value={entry.discoveredAt}
              onChange={(e) => onChange({ discoveredAt: e.target.value })}
              style={inputStyle} />
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle}>Discovered by (Employee ID / name)</label>
          <input
            value={entry.discoveredByEmpId}
            onChange={(e) => onChange({ discoveredByEmpId: e.target.value })}
            placeholder="EMP-001 / Dr Smith"
            style={inputStyle}
          />
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle}>Immediate action taken</label>
          <textarea value={entry.immediateAction}
            onChange={(e) => onChange({ immediateAction: e.target.value })}
            placeholder="Stabilisation, escalation, notifications…"
            rows={3}
            style={{ ...inputStyle, fontFamily: "inherit", resize: "vertical" }} />
        </div>

        <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <input
            type="checkbox"
            checked={!!entry.rcaInitiated}
            onChange={(e) => onChange({ rcaInitiated: e.target.checked })}
          />
          RCA already initiated
        </label>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "6px 14px", borderRadius: 6, border: `1px solid ${C.border}`,
              background: "#fff", color: C.muted, cursor: "pointer", fontWeight: 600, fontSize: 13,
            }}
          >Cancel</button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={submitting || !entry.UHID || !entry.eventType}
            style={{
              padding: "6px 18px", borderRadius: 6, border: `1px solid #dc2626`,
              background: submitting || !entry.UHID ? C.border : "#dc2626",
              color: "#fff", cursor: submitting || !entry.UHID ? "not-allowed" : "pointer",
              fontWeight: 700, fontSize: 13,
            }}
          >
            {submitting ? "Logging..." : "Log Sentinel Event"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Detail modal — readonly view of a row + audit trail
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
            <div style={{ fontSize: 18, fontWeight: 700, color: C.text }}>
              <i className="pi pi-exclamation-triangle" style={{ marginRight: 8, color: "#dc2626" }} />
              {row.eventType} <span style={{ color: C.muted, fontWeight: 400, fontSize: 14 }}>· {row.patientName || row.UHID}</span>
            </div>
            <div style={{ marginTop: 4, display: "flex", gap: 6, alignItems: "center" }}>
              <Badge value={row.severity?.toUpperCase()} palette={row.severity === "Critical" ? "red" : "orange"} />
              <Badge value={row.status?.toUpperCase()}
                palette={row.status === "Closed" ? "green" : row.status === "InProgress" ? "blue" : "red"} />
              {row.rcaInitiated && <Badge value="RCA INITIATED" palette="blue" />}
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

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 14, fontSize: 12 }}>
          <div><span style={{ color: C.muted }}>UHID</span><div>{row.UHID}</div></div>
          <div><span style={{ color: C.muted }}>Discovered at</span><div>{fmt(row.discoveredAt)}</div></div>
          <div><span style={{ color: C.muted }}>Discovered by</span><div>{row.discoveredByEmpId || "—"}</div></div>
          <div style={{ gridColumn: "span 3" }}>
            <span style={{ color: C.muted }}>Immediate action</span>
            <div>{row.immediateAction || "—"}</div>
          </div>
        </div>

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
                  <th style={{ ...tdStyle, fontWeight: 700, background: "#f8fafc" }}>Notes</th>
                </tr>
              </thead>
              <tbody>
                {(row.auditTrail || []).map((a, i) => (
                  <tr key={i}>
                    <td style={tdStyle}>{fmt(a.at)}</td>
                    <td style={tdStyle}>
                      <Badge value={a.action}
                        palette={a.action === "CREATED" ? "muted"
                          : a.action === "CLOSED" ? "green"
                          : a.action === "RCA_INITIATED" ? "blue" : "muted"} />
                    </td>
                    <td style={tdStyle}>{a.byName || "—"}{a.byRole ? <div style={{ fontSize: 10, color: C.muted }}>{a.byRole}</div> : null}</td>
                    <td style={tdStyle}>{a.notes || "—"}</td>
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
