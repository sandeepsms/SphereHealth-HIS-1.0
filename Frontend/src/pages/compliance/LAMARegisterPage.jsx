/**
 * LAMARegisterPage.jsx — R7gw-B9-B9-T07 / NABH AAC.4
 *
 * Surveyor + Compliance / MRD officer facing chronological log of every
 * LAMA / DAMA (Leave Against Medical Advice / Discharge Against Medical
 * Advice) episode in the facility.
 *
 * Auto-populated by the backend when a discharge is finalised with
 * disposition === "LAMA"; manual "Add Entry" path lets Compliance staff
 * backfill historical events or capture LAMA cases that didn't flow
 * through the discharge form (e.g. an ER patient who walked out before
 * triage).
 *
 *   URL: /compliance/nabh-registers/lama
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

// Enum lists — keep in lock-step with LAMARegisterModel.js
const STATUSES = ["Open", "InProgress", "Closed"];

const tdStyle = { padding: "8px 12px", borderBottom: `1px solid ${C.border}`, fontSize: 12, verticalAlign: "top" };
const inputStyle = { padding: 6, border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 13, width: "100%" };
const labelStyle = { fontSize: 11, color: C.muted, display: "block", marginBottom: 2 };

const blankEntry = {
  UHID: "",
  patientName: "",
  admissionNumber: "",
  lamaAt: new Date().toISOString().slice(0, 16),
  lamaReason: "",
  patientSignature: "",
  witnessName: "",
  witnessSignature: "",
  doctorCounsellingNotes: "",
  risksExplained: false,
  familyInformed: false,
  policeNotified: false,
  policeStation: "",
  policeFIRNo: "",
  transferRequested: false,
  transferTo: "",
  counsellingDoctor: "",
};

export default function LAMARegisterPage() {
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
      const r = await axios.get(`${API}/nabh-registers/lama`, {
        ...authHdr(),
        params,
      });
      setRows(r.data?.data || []);
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to load LAMA register");
    }
    setLoading(false);
  }, [startDate, endDate, statusFilter, qText]);

  useEffect(() => { fetchList(); }, [fetchList]);

  // ── Submit a manual LAMA entry ────────────────────────────────────
  const submitEntry = async () => {
    if (!entry.UHID) { toast.warn("UHID is required"); return; }
    if (!entry.lamaReason) { toast.warn("LAMA reason is required"); return; }
    setSubmitting(true);
    try {
      const r = await axios.post(`${API}/nabh-registers/lama`, {
        UHID: entry.UHID,
        patientName: entry.patientName,
        admissionNumber: entry.admissionNumber,
        lamaAt: entry.lamaAt || new Date().toISOString(),
        lamaReason: entry.lamaReason,
        patientSignature: entry.patientSignature,
        witnessName: entry.witnessName,
        witnessSignature: entry.witnessSignature,
        doctorCounsellingNotes: entry.doctorCounsellingNotes,
        risksExplained: entry.risksExplained,
        familyInformed: entry.familyInformed,
        policeNotified: entry.policeNotified,
        policeStation: entry.policeStation,
        policeFIRNo: entry.policeFIRNo,
        transferRequested: entry.transferRequested,
        transferTo: entry.transferTo,
        counsellingDoctor: entry.counsellingDoctor,
      }, authHdr());
      toast.success(`LAMA logged · ${r.data?.data?._id?.slice(-6) || "OK"}`);
      setEntry({ ...blankEntry });
      setModalOpen(false);
      fetchList();
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to save LAMA entry");
    }
    setSubmitting(false);
  };

  // ── Status badge helper ──────────────────────────────────────────
  const statusBadge = (s) => {
    if (s === "Closed") return <Badge value="CLOSED" palette="green" />;
    if (s === "InProgress") return <Badge value="IN PROGRESS" palette="blue" />;
    return <Badge value="OPEN" palette="orange" />;
  };

  const totalOpen     = useMemo(() => rows.filter((r) => r.status === "Open").length, [rows]);
  const totalRisks    = useMemo(() => rows.filter((r) => !r.risksExplained).length, [rows]);
  const totalPolice   = useMemo(() => rows.filter((r) => r.policeNotified).length, [rows]);

  return (
    <AdminPage>
      <Hero
        icon="pi-sign-out"
        title="LAMA / DAMA Register"
        subtitle="NABH AAC.4 — chronological log of every patient who left Against Medical Advice. Auto-populated when a discharge is finalised with disposition LAMA; counselling notes, signatures and risks-explained attestation are captured per episode."
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
              style={{ ...inputStyle, width: 160 }}>
              <option value="">All</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Search</label>
            <input value={qText} onChange={(e) => setQText(e.target.value)}
              placeholder="UHID / patient / reason / witness"
              style={{ ...inputStyle, width: 240 }} />
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
            <div style={{ fontSize: 12, color: C.muted }}>
              <strong style={{ color: C.text }}>{rows.length}</strong> entries
              {totalOpen > 0 && <> · <span style={{ color: "#ea580c", fontWeight: 600 }}>{totalOpen} open</span></>}
              {totalRisks > 0 && <> · <span style={{ color: "#dc2626", fontWeight: 600 }}>{totalRisks} missing-risk-attestation</span></>}
              {totalPolice > 0 && <> · <span style={{ color: "#4f46e5", fontWeight: 600 }}>{totalPolice} police-notified</span></>}
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
      <Card title={`LAMA Episodes · ${rows.length} entries`}>
        <Table cols={["LAMA at", "UHID", "Patient", "Reason", "Risks Explained", "Family", "Police", "Transfer", "Witness", "Status"]}>
          {rows.length === 0 ? (
            <EmptyRow span={10} text={loading ? "Loading…" : "No LAMA episodes recorded in this range"} />
          ) : rows.map((r) => (
            <tr
              key={r._id}
              onClick={() => setDetail({ ...r })}
              style={{ cursor: "pointer" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "#fff7ed"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "#fff"; }}
            >
              <td style={tdStyle}>{fmt(r.lamaAt)}</td>
              <td style={tdStyle}><strong>{r.UHID}</strong></td>
              <td style={tdStyle}>{r.patientName || "—"}</td>
              <td style={tdStyle}>{(r.lamaReason || "—").slice(0, 80)}</td>
              <td style={tdStyle}>
                {r.risksExplained
                  ? <Badge value="YES" palette="green" />
                  : <Badge value="NO" palette="red" />}
              </td>
              <td style={tdStyle}>
                {r.familyInformed
                  ? <Badge value="YES" palette="green" />
                  : <Badge value="NO" palette="muted" />}
              </td>
              <td style={tdStyle}>
                {r.policeNotified
                  ? <Badge value="NOTIFIED" palette="blue" />
                  : <Badge value="—" palette="muted" />}
              </td>
              <td style={tdStyle}>
                {r.transferRequested
                  ? <Badge value={r.transferTo || "YES"} palette="blue" />
                  : <Badge value="—" palette="muted" />}
              </td>
              <td style={tdStyle}>{r.witnessName || "—"}</td>
              <td style={tdStyle}>{statusBadge(r.status)}</td>
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
          background: "#fff", borderRadius: 10, padding: 22, maxWidth: 820,
          width: "100%", maxHeight: "90vh", overflow: "auto",
          boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: "#ea580c" }}>
            <i className="pi pi-sign-out" style={{ marginRight: 8 }} />
            Log LAMA Episode
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

        {/* Patient identification */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr 1fr", gap: 12, marginBottom: 12 }}>
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
          <div>
            <label style={labelStyle}>Admission #</label>
            <input
              value={entry.admissionNumber}
              onChange={(e) => onChange({ admissionNumber: e.target.value })}
              placeholder="IPD-…"
              style={inputStyle}
            />
          </div>
        </div>

        {/* LAMA timestamp + reason */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12, marginBottom: 12 }}>
          <div>
            <label style={labelStyle}>LAMA at *</label>
            <input type="datetime-local" value={entry.lamaAt}
              onChange={(e) => onChange({ lamaAt: e.target.value })}
              style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Reason for LAMA *</label>
            <input
              value={entry.lamaReason}
              onChange={(e) => onChange({ lamaReason: e.target.value })}
              placeholder="Financial / personal / dissatisfaction / second-opinion …"
              style={inputStyle}
            />
          </div>
        </div>

        {/* Counselling block */}
        <div style={{ fontWeight: 600, fontSize: 13, color: C.text, marginBottom: 6 }}>Counselling & Risk Disclosure</div>
        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle}>Doctor counselling notes</label>
          <textarea value={entry.doctorCounsellingNotes}
            onChange={(e) => onChange({ doctorCounsellingNotes: e.target.value })}
            placeholder="Risks explained, alternatives offered, patient's understanding…"
            rows={3}
            style={{ ...inputStyle, fontFamily: "inherit", resize: "vertical" }} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
          <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
            <input type="checkbox" checked={!!entry.risksExplained}
              onChange={(e) => onChange({ risksExplained: e.target.checked })} />
            Risks explained
          </label>
          <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
            <input type="checkbox" checked={!!entry.familyInformed}
              onChange={(e) => onChange({ familyInformed: e.target.checked })} />
            Family informed
          </label>
          <div>
            <label style={labelStyle}>Counselling doctor</label>
            <input value={entry.counsellingDoctor}
              onChange={(e) => onChange({ counsellingDoctor: e.target.value })}
              placeholder="Dr name"
              style={inputStyle} />
          </div>
        </div>

        {/* Signatures */}
        <div style={{ fontWeight: 600, fontSize: 13, color: C.text, marginBottom: 6 }}>Signatures</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 14 }}>
          <div>
            <label style={labelStyle}>Patient signature (text)</label>
            <input value={entry.patientSignature}
              onChange={(e) => onChange({ patientSignature: e.target.value })}
              placeholder="Signed by patient"
              style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Witness name</label>
            <input value={entry.witnessName}
              onChange={(e) => onChange({ witnessName: e.target.value })}
              placeholder="Family / staff witness"
              style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Witness signature (text)</label>
            <input value={entry.witnessSignature}
              onChange={(e) => onChange({ witnessSignature: e.target.value })}
              placeholder="Signed by witness"
              style={inputStyle} />
          </div>
        </div>

        {/* Police / Transfer */}
        <div style={{ fontWeight: 600, fontSize: 13, color: C.text, marginBottom: 6 }}>Notifications & Transfer</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
          <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
            <input type="checkbox" checked={!!entry.policeNotified}
              onChange={(e) => onChange({ policeNotified: e.target.checked })} />
            Police notified
          </label>
          <div>
            <label style={labelStyle}>Police station</label>
            <input value={entry.policeStation}
              onChange={(e) => onChange({ policeStation: e.target.value })}
              placeholder="Station name (if MLC)"
              style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>FIR / DD #</label>
            <input value={entry.policeFIRNo}
              onChange={(e) => onChange({ policeFIRNo: e.target.value })}
              placeholder="FIR / Daily Diary #"
              style={inputStyle} />
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12, marginBottom: 16 }}>
          <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
            <input type="checkbox" checked={!!entry.transferRequested}
              onChange={(e) => onChange({ transferRequested: e.target.checked })} />
            Transfer requested
          </label>
          <div>
            <label style={labelStyle}>Transfer to (other facility)</label>
            <input value={entry.transferTo}
              onChange={(e) => onChange({ transferTo: e.target.value })}
              placeholder="Receiving hospital name"
              style={inputStyle} />
          </div>
        </div>

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
            disabled={submitting || !entry.UHID || !entry.lamaReason}
            style={{
              padding: "6px 18px", borderRadius: 6, border: `1px solid #ea580c`,
              background: (submitting || !entry.UHID || !entry.lamaReason) ? C.border : "#ea580c",
              color: "#fff",
              cursor: (submitting || !entry.UHID || !entry.lamaReason) ? "not-allowed" : "pointer",
              fontWeight: 700, fontSize: 13,
            }}
          >
            {submitting ? "Saving..." : "Log LAMA Episode"}
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
          background: "#fff", borderRadius: 10, padding: 22, maxWidth: 820,
          width: "100%", maxHeight: "90vh", overflow: "auto",
          boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.text }}>
              <i className="pi pi-sign-out" style={{ marginRight: 8, color: "#ea580c" }} />
              LAMA · {row.patientName || row.UHID} <span style={{ color: C.muted, fontWeight: 400, fontSize: 14 }}>· {row.UHID}</span>
            </div>
            <div style={{ marginTop: 4, display: "flex", gap: 6, alignItems: "center" }}>
              <Badge value={row.status?.toUpperCase() || "OPEN"}
                palette={row.status === "Closed" ? "green" : row.status === "InProgress" ? "blue" : "orange"} />
              {row.risksExplained
                ? <Badge value="RISKS EXPLAINED" palette="green" />
                : <Badge value="RISKS NOT EXPLAINED" palette="red" />}
              {row.familyInformed && <Badge value="FAMILY INFORMED" palette="blue" />}
              {row.policeNotified && <Badge value="POLICE NOTIFIED" palette="blue" />}
              {row.transferRequested && <Badge value="TRANSFER" palette="muted" />}
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
          <div><span style={{ color: C.muted }}>LAMA at</span><div>{fmt(row.lamaAt)}</div></div>
          <div><span style={{ color: C.muted }}>Admission #</span><div>{row.admissionNumber || "—"}</div></div>
          <div style={{ gridColumn: "span 3" }}>
            <span style={{ color: C.muted }}>Reason</span>
            <div>{row.lamaReason || "—"}</div>
          </div>
          <div style={{ gridColumn: "span 3" }}>
            <span style={{ color: C.muted }}>Doctor counselling notes</span>
            <div>{row.doctorCounsellingNotes || "—"}</div>
          </div>
          <div><span style={{ color: C.muted }}>Counselling doctor</span><div>{row.counsellingDoctor || "—"}</div></div>
          <div><span style={{ color: C.muted }}>Witness</span><div>{row.witnessName || "—"}</div></div>
          <div><span style={{ color: C.muted }}>Ward</span><div>{row.ward || "—"}</div></div>
          <div><span style={{ color: C.muted }}>Patient signature</span><div>{row.patientSignature || "—"}</div></div>
          <div><span style={{ color: C.muted }}>Witness signature</span><div>{row.witnessSignature || "—"}</div></div>
          <div><span style={{ color: C.muted }}>Police</span>
            <div>{row.policeNotified ? `${row.policeStation || "—"} / FIR ${row.policeFIRNo || "—"}` : "—"}</div>
          </div>
          {row.transferRequested && (
            <div style={{ gridColumn: "span 3" }}>
              <span style={{ color: C.muted }}>Transfer to</span>
              <div>{row.transferTo || "—"}</div>
            </div>
          )}
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
                          : a.action === "REOPENED" ? "orange" : "muted"} />
                    </td>
                    <td style={tdStyle}>{a.byName || "—"}{a.byRole ? <div style={{ fontSize: 10, color: C.muted }}>{a.byRole}</div> : null}</td>
                    <td style={tdStyle}>{a.notes || a.reason || "—"}</td>
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
