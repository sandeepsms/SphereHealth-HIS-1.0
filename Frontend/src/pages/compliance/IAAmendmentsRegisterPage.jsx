/**
 * IAAmendmentsRegisterPage.jsx — NABH AAC.1 / IMS.2
 *
 * Read-only audit register that lists every Initial Assessment (IA)
 * amendment so a surveyor can see WHO edited WHAT, WHEN and WHY.
 *
 * Driven by the ClinicalAudit collection — rows where
 *   event ∈ { DOCTOR_NOTE_AMENDED, NURSE_NOTE_AMENDED }
 *
 *   URL: /compliance/ia-amendments
 *
 * Role-gated to Admin / MRD / ComplianceOfficer at the route level
 * (action="reports.audit") and re-checked in-page so the friendly
 * "Access denied" copy surfaces if the route guard is loosened.
 *
 * The page never writes — it's a chronological mirror of the immutable
 * audit log. The actual amendments happen on the IA pages themselves;
 * each save emits a ClinicalAudit row carrying before/after snapshots
 * which this page diffs into a per-field change grid.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import {
  AdminPage, Hero, Card, Table, EmptyRow, Badge, C,
} from "../../Components/admin-theme";
import { API_BASE_URL as API } from "../../config/api";
import { useAuth } from "../../context/AuthContext";

const authHdr = () => ({
  headers: { Authorization: `Bearer ${sessionStorage.getItem("his_token")}` },
});

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" }) : "—";
const fmtTime = (d) =>
  d ? new Date(d).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "";

const tdStyle = { padding: "10px 12px", borderBottom: `1px solid ${C.border}`, fontSize: 12, verticalAlign: "top" };
const TRUNC = 140;

// ── Filter chips ────────────────────────────────────────────────
const FILTERS = [
  { id: "all",    label: "All" },
  { id: "doc",    label: "Doctor" },
  { id: "nurse",  label: "Nurse" },
  { id: "today",  label: "Today" },
  { id: "week",   label: "This week" },
];

// Top-level keys present on every audit row that we want to skip when
// diffing the user-meaningful payload. The audit emit puts the actual
// changed fields under `before` / `after`; metadata like `_id` and
// `status` is interesting context but not a "field edit".
const META_KEYS = new Set([
  "_id", "status", "noteType", "shift",
  "isSigned", "signedByEmpId", "isAddendum",
  "originalNoteId", "supersedesNoteId",
]);

/**
 * Compute per-field diff between before/after snapshots on an audit
 * row. The emit helper stores before/after as Mongoose Mixed bags of
 * the snapshot fields the controller chose to capture. Pre-built
 * `payload.changes` is not guaranteed by the schema, so we derive it
 * here from union(before-keys, after-keys) and keep only entries
 * where the value actually moved.
 *
 * Returns: [{ field, oldValue, newValue }, …]
 */
function deriveChanges(row) {
  // Some emit sites may already pre-bake a `changes[]` on the audit
  // row's payload (out of scope for the existing emits but a forward-
  // compatible escape hatch). Honour it if present.
  const preBaked = row?.payload?.changes
    || row?.after?.changes
    || row?.before?.changes;
  if (Array.isArray(preBaked) && preBaked.length) return preBaked;

  const before = row?.before || {};
  const after  = row?.after  || {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const out = [];
  for (const k of keys) {
    if (META_KEYS.has(k)) continue;
    const oldV = before[k];
    const newV = after[k];
    // Cheap structural compare via JSON. Skip when both are null/undefined
    // or identically serialised — a "no-op" amendment shouldn't show as a
    // change row.
    const oldS = oldV === undefined ? "" : JSON.stringify(oldV);
    const newS = newV === undefined ? "" : JSON.stringify(newV);
    if (oldS === newS) continue;
    out.push({ field: k, oldValue: oldV, newValue: newV });
  }
  return out;
}

function renderVal(v) {
  if (v === null || v === undefined || v === "") return <span style={{ color: C.muted }}>—</span>;
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "object") {
    try { return <code style={{ fontFamily: "DM Mono, monospace", fontSize: 11 }}>{JSON.stringify(v)}</code>; }
    catch { return String(v); }
  }
  return String(v);
}

function truncate(s, n = TRUNC) {
  if (!s) return "";
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

// CSV exporter — quotes every field, doubles inner quotes per RFC 4180.
function toCSV(rows) {
  const head = [
    "When", "Role", "Actor Name", "Actor Role",
    "UHID", "Patient Name", "Event",
    "Target Type", "Target ID", "Reason",
    "Changes Count", "Changed Fields",
  ];
  const esc = (v) => {
    const s = v == null ? "" : String(v);
    return `"${s.replace(/"/g, '""')}"`;
  };
  const lines = [head.map(esc).join(",")];
  for (const r of rows) {
    const changes = deriveChanges(r);
    const when = r.createdAt ? new Date(r.createdAt).toISOString() : "";
    const role = r.event === "DOCTOR_NOTE_AMENDED" ? "Doctor"
               : r.event === "NURSE_NOTE_AMENDED"  ? "Nurse" : "—";
    lines.push([
      when, role, r.actorName || "", r.actorRole || "",
      r.UHID || "", r.patientName || "", r.event,
      r.targetType || "", r.targetId || "", r.reason || "",
      changes.length, changes.map((c) => c.field).join(" | "),
    ].map(esc).join(","));
  }
  return lines.join("\n");
}

function downloadCSV(text, filename) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function IAAmendmentsRegisterPage() {
  const { hasRole } = useAuth();
  // Role gate per AAC.1 surveyor-access policy. The route also wraps
  // this component in <RoleGuard action="reports.audit"> but we re-check
  // in-page so the message names the right registers regardless of how
  // the action mapping evolves.
  const canSee = hasRole("Admin", "MRD", "ComplianceOfficer");

  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter]   = useState("all");
  const [expanded, setExpanded] = useState(null); // _id of expanded row

  const fetchRows = useCallback(async () => {
    if (!canSee) return;
    setLoading(true);
    try {
      const r = await axios.get(`${API}/clinical-audit`, {
        ...authHdr(),
        params: {
          kind: "DOCTOR_NOTE_AMENDED,NURSE_NOTE_AMENDED",
          limit: 200,
          sort: "-createdAt",
        },
      });
      setRows(r.data?.data || []);
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to load amendments");
    } finally {
      setLoading(false);
    }
  }, [canSee]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  // Apply the chip filter client-side so chip switching is instant —
  // 200-row cap means the table is small and re-rendering on filter is cheap.
  const filteredRows = useMemo(() => {
    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
    const startOfWeek = new Date(); startOfWeek.setDate(startOfWeek.getDate() - 7);
    startOfWeek.setHours(0, 0, 0, 0);
    return rows.filter((r) => {
      const ts = r.createdAt ? new Date(r.createdAt) : null;
      if (filter === "doc"   && r.event !== "DOCTOR_NOTE_AMENDED") return false;
      if (filter === "nurse" && r.event !== "NURSE_NOTE_AMENDED")  return false;
      if (filter === "today" && (!ts || ts < startOfToday)) return false;
      if (filter === "week"  && (!ts || ts < startOfWeek))  return false;
      return true;
    });
  }, [rows, filter]);

  // ── Access-denied card (route guard is the primary defence; this is
  //    the in-page mirror so the copy reads "compliance audit register"
  //    rather than the generic RoleGuard fallback). ──
  if (!canSee) {
    return (
      <AdminPage>
        <Hero
          icon="pi-lock"
          title="Initial Assessment Amendments"
          subtitle="NABH AAC.1 traceability — surveyor-access only"
          color="orange"
        />
        <Card>
          <div style={{ padding: 28, textAlign: "center" }}>
            <i className="pi pi-lock" style={{ fontSize: 36, color: "#dc2626", marginBottom: 10, display: "block" }} />
            <div style={{ fontSize: 17, fontWeight: 800, color: C.text }}>Access denied</div>
            <div style={{ fontSize: 13, color: C.muted, marginTop: 6 }}>
              Only Admin, MRD and Compliance staff can view the IA Amendments register.
            </div>
          </div>
        </Card>
      </AdminPage>
    );
  }

  return (
    <AdminPage>
      <Hero
        icon="pi-history"
        title="Initial Assessment Amendments"
        subtitle="WHO edited WHAT, WHEN and WHY — NABH AAC.1 / IMS.2 audit trail"
        color="orange"
        right={
          <button
            type="button"
            onClick={() => downloadCSV(toCSV(filteredRows), `ia-amendments-${new Date().toISOString().slice(0,10)}.csv`)}
            disabled={filteredRows.length === 0}
            style={{
              padding: "8px 14px",
              borderRadius: 8,
              border: "1px solid #fff",
              background: "rgba(255,255,255,0.18)",
              color: "#fff",
              fontSize: 12,
              fontWeight: 700,
              cursor: filteredRows.length === 0 ? "not-allowed" : "pointer",
              opacity: filteredRows.length === 0 ? 0.5 : 1,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
            title="Download visible rows as CSV"
          >
            <i className="pi pi-download" style={{ fontSize: 12 }} /> Export CSV
          </button>
        }
      />

      <Card title="Filters">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {FILTERS.map((f) => {
            const active = filter === f.id;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                style={{
                  padding: "6px 14px",
                  borderRadius: 999,
                  border: `1px solid ${active ? "#b45309" : C.border}`,
                  background: active ? "#fef3c7" : "#fff",
                  color: active ? "#92400e" : C.muted,
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: "pointer",
                  letterSpacing: ".1px",
                  transition: "background 0.12s ease, border-color 0.12s ease, color 0.12s ease",
                }}
              >
                {f.label}
              </button>
            );
          })}
          <div style={{ marginLeft: "auto", fontSize: 12, color: C.muted, alignSelf: "center" }}>
            Showing <strong style={{ color: C.text }}>{filteredRows.length}</strong> of {rows.length} {loading && "· loading…"}
          </div>
        </div>
      </Card>

      <Card title={`Amendments · ${filteredRows.length}`}>
        <Table cols={["When", "Role", "Actor", "Patient", "Reason", "Changes"]}>
          {filteredRows.length === 0 ? (
            <EmptyRow
              span={6}
              text={loading ? "Loading…" : (
                <div style={{ padding: "8px 0" }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>No amendments yet</div>
                  <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>
                    When a clinician edits a signed Initial Assessment, an immutable
                    audit row is recorded here for NABH AAC.1 traceability.
                  </div>
                </div>
              )}
            />
          ) : (
            filteredRows.map((r) => {
              const changes = deriveChanges(r);
              const isOpen = expanded === r._id;
              const isDoc = r.event === "DOCTOR_NOTE_AMENDED";
              return (
                <React.Fragment key={r._id}>
                  <tr
                    onClick={() => setExpanded(isOpen ? null : r._id)}
                    style={{ cursor: "pointer", background: isOpen ? "#fffbeb" : "transparent" }}
                  >
                    <td style={tdStyle}>
                      <div style={{ fontWeight: 700, color: C.text }}>{fmtDate(r.createdAt)}</div>
                      <div style={{ fontSize: 11, color: C.muted }}>{fmtTime(r.createdAt)}</div>
                    </td>
                    <td style={tdStyle}>
                      <Badge value={isDoc ? "Doctor" : "Nurse"} palette={isDoc ? "blue" : "approved"} />
                    </td>
                    <td style={tdStyle}>
                      <div style={{ fontWeight: 600 }}>{r.actorName || "—"}</div>
                      <div style={{ fontSize: 11, color: C.muted }}>{r.actorRole || ""}</div>
                    </td>
                    <td style={tdStyle}>
                      <div style={{ fontFamily: "DM Mono, monospace", fontSize: 11, color: C.muted }}>{r.UHID || "—"}</div>
                      <div>{r.patientName || "—"}</div>
                    </td>
                    <td style={tdStyle} title={r.reason || ""}>
                      <span style={{ fontSize: 12, color: C.text }}>{truncate(r.reason)}</span>
                    </td>
                    <td style={tdStyle}>
                      <span style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "2px 10px",
                        borderRadius: 999,
                        background: changes.length ? "#e0e7ff" : "#f1f5f9",
                        color: changes.length ? "#4338ca" : C.muted,
                        fontSize: 11,
                        fontWeight: 800,
                        letterSpacing: ".2px",
                      }}>
                        {changes.length} field{changes.length === 1 ? "" : "s"}
                      </span>
                      <i
                        className={`pi ${isOpen ? "pi-chevron-up" : "pi-chevron-down"}`}
                        style={{ fontSize: 11, color: C.muted, marginLeft: 8 }}
                      />
                    </td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={6} style={{ background: "#fff7ed", padding: 0, borderBottom: `1px solid ${C.border}` }}>
                        <div style={{ padding: 16 }}>
                          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 12, fontSize: 12 }}>
                            <div>
                              <div style={{ fontSize: 11, color: C.muted, fontWeight: 700 }}>EVENT</div>
                              <div style={{ fontFamily: "DM Mono, monospace" }}>{r.event}</div>
                            </div>
                            <div>
                              <div style={{ fontSize: 11, color: C.muted, fontWeight: 700 }}>TARGET</div>
                              <div style={{ fontFamily: "DM Mono, monospace", fontSize: 11 }}>
                                {r.targetType || "—"} {r.targetId ? `· ${r.targetId}` : ""}
                              </div>
                            </div>
                            <div>
                              <div style={{ fontSize: 11, color: C.muted, fontWeight: 700 }}>IP</div>
                              <div style={{ fontFamily: "DM Mono, monospace", fontSize: 11 }}>{r.ipAddress || "—"}</div>
                            </div>
                            {r.reason && r.reason.length > TRUNC && (
                              <div style={{ flex: "1 1 100%" }}>
                                <div style={{ fontSize: 11, color: C.muted, fontWeight: 700 }}>REASON (full)</div>
                                <div style={{ fontSize: 12 }}>{r.reason}</div>
                              </div>
                            )}
                          </div>

                          {changes.length === 0 ? (
                            <div style={{ fontSize: 12, color: C.muted, fontStyle: "italic" }}>
                              No field-level diff captured on this row (snapshot bag was identical).
                            </div>
                          ) : (
                            <>
                              <div style={{ fontSize: 11, fontWeight: 800, color: C.muted, letterSpacing: ".4px", marginBottom: 6 }}>
                                FIELD-LEVEL CHANGES
                              </div>
                              <div style={{
                                display: "grid",
                                gridTemplateColumns: "minmax(140px, 1fr) 2fr 2fr",
                                gap: "1px",
                                background: C.border,
                                border: `1px solid ${C.border}`,
                                borderRadius: 8,
                                overflow: "hidden",
                              }}>
                                <div style={{ background: "#f8fafc", padding: "6px 10px", fontSize: 11, fontWeight: 800, color: C.muted }}>Field</div>
                                <div style={{ background: "#f8fafc", padding: "6px 10px", fontSize: 11, fontWeight: 800, color: C.muted }}>Old value</div>
                                <div style={{ background: "#f8fafc", padding: "6px 10px", fontSize: 11, fontWeight: 800, color: C.muted }}>New value</div>
                                {changes.map((c, i) => (
                                  <React.Fragment key={`${c.field}-${i}`}>
                                    <div style={{ background: "#fff", padding: "8px 10px", fontSize: 12, fontWeight: 700, color: C.text, fontFamily: "DM Mono, monospace" }}>{c.field}</div>
                                    <div style={{ background: "#fff5f5", padding: "8px 10px", fontSize: 12 }}>{renderVal(c.oldValue)}</div>
                                    <div style={{ background: "#f0fdf4", padding: "8px 10px", fontSize: 12 }}>{renderVal(c.newValue)}</div>
                                  </React.Fragment>
                                ))}
                              </div>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })
          )}
        </Table>
      </Card>
    </AdminPage>
  );
}
