/**
 * TpaDeskPage.jsx — R7hr(TPA-P2)
 * TPA claim-desk cockpit: MIS tiles (from /reports/tpa-mis — TAT, approval %,
 * realization), per-TPA breakdown, the two rot-lists (stale SUBMITTED claims
 * + unanswered insurer queries), and the query raise/reply loop per claim.
 * A REJECTED claim re-submits via the existing tpa-preauth-submit route.
 */
import React, { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { API_ENDPOINTS } from "../../config/api";

const C = { ink: "#0f172a", muted: "#64748b", line: "#e2e8f0", violet: "#7c3aed", red: "#dc2626", amber: "#b45309", green: "#166534" };

const Tile = ({ label, value, tone = C.ink, sub }) => (
  <div style={{ flex: "1 1 130px", background: "#fff", border: `1px solid ${C.line}`, borderRadius: 12, padding: "12px 14px" }}>
    <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".4px" }}>{label}</div>
    <div style={{ fontSize: 22, fontWeight: 800, color: tone, marginTop: 2 }}>{value ?? "—"}</div>
    {sub && <div style={{ fontSize: 10.5, color: C.muted }}>{sub}</div>}
  </div>
);

const Th = ({ children, right }) => <th style={{ textAlign: right ? "right" : "left", padding: "7px 10px", fontSize: 10.5, color: C.muted, textTransform: "uppercase", letterSpacing: ".4px", borderBottom: `1px solid ${C.line}` }}>{children}</th>;
const Td = ({ children, right, tone }) => <td style={{ textAlign: right ? "right" : "left", padding: "7px 10px", fontSize: 12.5, color: tone || C.ink, borderBottom: `1px solid #f1f5f9` }}>{children}</td>;

export default function TpaDeskPage() {
  const [mis, setMis] = useState(null);
  const [claims, setClaims] = useState([]);
  const [loading, setLoading] = useState(true);
  const [queryFor, setQueryFor] = useState(null);   // claim being queried/replied

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [m, c] = await Promise.all([
        axios.get(`${API_ENDPOINTS.BASE}/reports/tpa-mis`).then((r) => r.data?.data || r.data).catch(() => null),
        axios.get(`${API_ENDPOINTS.BILLING}/tpa-cases`).then((r) => r.data?.data || []).catch(() => []),
      ]);
      setMis(m);
      setClaims(Array.isArray(c) ? c : []);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const o = mis?.overall || {};
  return (
    <div style={{ maxWidth: 1150, margin: "0 auto", padding: 16, fontFamily: "inherit" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, color: C.ink }}>🛡 TPA Desk</div>
          <div style={{ fontSize: 12, color: C.muted }}>Claims MIS · stale follow-ups · insurer query loop {mis ? `· ${mis.from} → ${mis.to}` : ""}</div>
        </div>
        <button onClick={load} style={{ padding: "8px 14px", borderRadius: 8, border: `1px solid ${C.line}`, background: "#fff", cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: 12 }}>
          ↻ Refresh
        </button>
      </div>

      {/* KPI tiles */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        <Tile label="Claims (window)" value={o.claims} sub={Object.entries(o.byStatus || {}).map(([k, v]) => `${k}:${v}`).join(" · ")} />
        <Tile label="Approval %" value={o.approvalPct != null ? `${o.approvalPct}%` : "—"} tone={C.green} />
        <Tile label="Avg approve TAT" value={o.avgApproveTatDays != null ? `${o.avgApproveTatDays}d` : "—"} />
        <Tile label="Realization" value={o.realizationPct != null ? `${o.realizationPct}%` : "—"} tone={o.realizationPct >= 90 ? C.green : C.amber} sub={`₹${(o.settledAmt || 0).toLocaleString("en-IN")} / ₹${(o.approvedAmt || 0).toLocaleString("en-IN")}`} />
        <Tile label="Stale claims" value={(mis?.staleClaims || []).length} tone={C.red} sub={`SUBMITTED > ${mis?.staleDays || 7}d`} />
        <Tile label="Open queries" value={(mis?.openQueries || []).length} tone={C.red} />
      </div>

      {/* Rot lists */}
      {(mis?.staleClaims || []).length > 0 && (
        <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 12, marginBottom: 14, overflow: "hidden" }}>
          <div style={{ padding: "9px 12px", fontWeight: 800, fontSize: 13, color: C.red }}>⏰ Stale claims — chase the insurer</div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr><Th>Bill</Th><Th>Patient</Th><Th>TPA</Th><Th>Claim #</Th><Th right>Ageing</Th></tr></thead>
            <tbody>{mis.staleClaims.map((s, i) => (
              <tr key={i}><Td>{s.billNumber}</Td><Td>{s.patientName} · {s.UHID}</Td><Td>{s.tpaName || "—"}</Td><Td>{s.tpaClaimNumber || "—"}</Td><Td right tone={C.red}><strong>{s.ageingDays}d</strong></Td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {(mis?.openQueries || []).length > 0 && (
        <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 12, marginBottom: 14, overflow: "hidden" }}>
          <div style={{ padding: "9px 12px", fontWeight: 800, fontSize: 13, color: C.amber }}>❓ Open insurer queries — reply pending</div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr><Th>Bill</Th><Th>Patient</Th><Th>Query</Th><Th right>Ageing</Th><Th right>Action</Th></tr></thead>
            <tbody>{mis.openQueries.map((q, i) => (
              <tr key={i}>
                <Td>{q.billNumber}</Td><Td>{q.patientName} · {q.UHID}</Td>
                <Td>{(q.queryText || "").slice(0, 70)}{(q.queryText || "").length > 70 ? "…" : ""}</Td>
                <Td right tone={C.amber}><strong>{q.ageingDays}d</strong></Td>
                <Td right>
                  <button onClick={() => { const claim = claims.find((cl) => String(cl._id) === String(q.billId)) || { _id: q.billId, billNumber: q.billNumber, patientName: q.patientName, tpaQueryLog: [] }; setQueryFor(claim); }}
                    style={{ padding: "4px 10px", borderRadius: 7, border: "none", background: C.violet, color: "#fff", cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: 11 }}>
                    Reply
                  </button>
                </Td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {/* per-TPA breakdown */}
      {(mis?.byTpa || []).length > 0 && (
        <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 12, marginBottom: 14, overflow: "hidden" }}>
          <div style={{ padding: "9px 12px", fontWeight: 800, fontSize: 13 }}>Per-TPA performance</div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr><Th>TPA</Th><Th right>Claims</Th><Th right>Approved ₹</Th><Th right>Settled ₹</Th><Th right>Realization</Th><Th right>TAT</Th></tr></thead>
            <tbody>{mis.byTpa.map((t, i) => (
              <tr key={i}>
                <Td><strong>{t.tpa}</strong></Td><Td right>{t.claims}</Td>
                <Td right>₹{(t.approvedAmt || 0).toLocaleString("en-IN")}</Td>
                <Td right>₹{(t.settledAmt || 0).toLocaleString("en-IN")}</Td>
                <Td right tone={t.realizationPct >= 90 ? C.green : C.amber}>{t.realizationPct != null ? `${t.realizationPct}%` : "—"}</Td>
                <Td right>{t.avgApproveTatDays != null ? `${t.avgApproveTatDays}d` : "—"}</Td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {/* Claims list + query action */}
      <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: "9px 12px", fontWeight: 800, fontSize: 13 }}>Active claims {loading ? "· loading…" : `(${claims.length})`}</div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><Th>Bill</Th><Th>Patient</Th><Th>TPA</Th><Th>Status</Th><Th right>Approved ₹</Th><Th right>Queries</Th><Th right>Action</Th></tr></thead>
          <tbody>
            {claims.map((cl) => {
              const open = (cl.tpaQueryLog || []).filter((q) => q.status === "OPEN").length;
              return (
                <tr key={cl._id}>
                  <Td>{cl.billNumber || "(draft)"}</Td>
                  <Td>{cl.patient?.fullName || cl.patientName} · {cl.UHID}</Td>
                  <Td>{cl.tpa?.tpaName || cl.tpaName || "—"}</Td>
                  <Td tone={cl.tpaClaimStatus === "REJECTED" ? C.red : undefined}><strong>{cl.tpaClaimStatus}</strong></Td>
                  <Td right>₹{Number(cl.tpaApprovedAmount || 0).toLocaleString("en-IN")}</Td>
                  <Td right tone={open ? C.amber : undefined}>{(cl.tpaQueryLog || []).length}{open ? ` (${open} open)` : ""}</Td>
                  <Td right>
                    <button onClick={() => setQueryFor(cl)}
                      style={{ padding: "4px 10px", borderRadius: 7, border: `1px solid ${C.violet}`, background: "#fff", color: C.violet, cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: 11 }}>
                      ❓ Queries
                    </button>
                  </Td>
                </tr>
              );
            })}
            {!loading && claims.length === 0 && <tr><Td>No outstanding TPA claims 🎉</Td></tr>}
          </tbody>
        </table>
      </div>

      {queryFor && <QueryModal claim={queryFor} onClose={() => setQueryFor(null)} onSaved={() => { setQueryFor(null); load(); }} />}
    </div>
  );
}

/* Query raise/reply modal — the loop. Re-submit for REJECTED claims rides
   the existing tpa-preauth-submit route. */
function QueryModal({ claim, onClose, onSaved }) {
  const [text, setText] = useState("");
  const [replyFor, setReplyFor] = useState(null);   // queryId being replied
  const [saving, setSaving] = useState(false);
  const log = [...(claim.tpaQueryLog || [])].reverse();

  const raise = async () => {
    if (!text.trim()) return toast.error("Insurer ki query likho");
    setSaving(true);
    try {
      await axios.post(`${API_ENDPOINTS.BILLING}/${claim._id}/tpa-query`, { queryText: text.trim() });
      toast.success("Query logged");
      onSaved();
    } catch (e) { toast.error(e?.response?.data?.message || "Failed"); setSaving(false); }
  };
  const reply = async () => {
    if (!text.trim()) return toast.error("Reply likho");
    setSaving(true);
    try {
      await axios.post(`${API_ENDPOINTS.BILLING}/${claim._id}/tpa-query/${replyFor}/reply`, { replyText: text.trim() });
      toast.success("Reply logged");
      onSaved();
    } catch (e) { toast.error(e?.response?.data?.message || "Failed"); setSaving(false); }
  };
  const resubmit = async () => {
    setSaving(true);
    try {
      await axios.post(`${API_ENDPOINTS.BILLING}/${claim._id}/tpa-preauth-submit`, { claimNumber: claim.tpaClaimNumber, requestedAmount: Number(claim.tpaPayableAmount) || undefined });
      toast.success("Claim re-submitted to insurer");
      onSaved();
    } catch (e) { toast.error(e?.response?.data?.message || "Re-submit failed"); setSaving(false); }
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 14, padding: 18, width: "min(560px,96vw)", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 50px rgba(0,0,0,.25)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
          <div style={{ fontWeight: 800, fontSize: 15 }}>❓ Insurer Queries — {claim.billNumber || claim.patientName}</div>
          <button onClick={onClose} style={{ border: "none", background: "transparent", fontSize: 18, cursor: "pointer", color: "#64748b" }}>✕</button>
        </div>

        {log.length > 0 && (
          <div style={{ marginBottom: 10 }}>
            {log.map((q) => (
              <div key={q._id} style={{ borderLeft: `3px solid ${q.status === "OPEN" ? "#f59e0b" : "#22c55e"}`, background: q.status === "OPEN" ? "#fffbeb" : "#f0fdf4", borderRadius: 6, padding: "6px 9px", marginBottom: 6, fontSize: 12 }}>
                <div><strong>Q:</strong> {q.queryText} <span style={{ color: "#94a3b8" }}>({q.raisedAt ? new Date(q.raisedAt).toLocaleDateString("en-IN") : ""} · {q.recordedBy})</span></div>
                {q.status === "REPLIED"
                  ? <div style={{ marginTop: 2 }}><strong>A:</strong> {q.replyText} <span style={{ color: "#94a3b8" }}>({q.repliedBy})</span></div>
                  : <button onClick={() => { setReplyFor(q._id); setText(""); }} style={{ marginTop: 4, padding: "3px 10px", borderRadius: 6, border: "none", background: "#f59e0b", color: "#fff", cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: 11 }}>Reply</button>}
              </div>
            ))}
          </div>
        )}

        <label style={{ fontSize: 10.5, fontWeight: 700, color: "#64748b" }}>{replyFor ? "Reply to selected query" : "Log new insurer query"}</label>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3}
          placeholder={replyFor ? "hospital ka jawab / bheje gaye documents" : "insurer ne kya poochha (verbatim)"}
          style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", border: "1px solid #cbd5e1", borderRadius: 7, fontSize: 13, fontFamily: "inherit", marginBottom: 8 }} />
        <div style={{ display: "flex", gap: 8 }}>
          {replyFor
            ? <button onClick={reply} disabled={saving} style={{ flex: 1, padding: "9px 0", background: "#f59e0b", color: "#fff", border: "none", borderRadius: 8, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>{saving ? "…" : "Save Reply"}</button>
            : <button onClick={raise} disabled={saving} style={{ flex: 1, padding: "9px 0", background: "#7c3aed", color: "#fff", border: "none", borderRadius: 8, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>{saving ? "…" : "Log Query"}</button>}
          {claim.tpaClaimStatus === "REJECTED" && (
            <button onClick={resubmit} disabled={saving} style={{ flex: 1, padding: "9px 0", background: "#0f172a", color: "#fff", border: "none", borderRadius: 8, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>↻ Re-submit Claim</button>
          )}
        </div>
        {replyFor && <button onClick={() => setReplyFor(null)} style={{ marginTop: 6, border: "none", background: "transparent", color: "#64748b", cursor: "pointer", fontSize: 11.5, fontFamily: "inherit" }}>← naya query log karna hai</button>}
      </div>
    </div>
  );
}
