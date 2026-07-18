/**
 * FullOrderSheetSection.jsx — R7hr(DOCS-FULL, owner 2026-07-12)
 * ───────────────────────────────────────────────────────────────
 * Consolidated standalone-DoctorOrderSheet-style order sheet inside the
 * Complete Patient File: all orders grouped as Medication Orders /
 * Investigations Ordered / Other Orders, with the rich columns the
 * standalone prints (generic + indication sub-lines, duration, STAT
 * highlight, status, ordered-by). The day-wise journey keeps its per-day
 * "Orders raised" table; this is the formal order-sheet document.
 *
 * Data: f.doctorOrders (normalizeData) — details{} carries the raw
 * orderDetails for duration / indication / instructions. The standalone's
 * diet / restrictions / standing-orders block comes from its page's
 * rounds payload, which the file API does not carry — data-limited by
 * design (documented in TASK-LOG).
 */
import React from "react";

const S = {
  h: { fontSize: 9.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".5px", color: "#475569", margin: "5px 0 1px" },
  tbl: { width: "100%", borderCollapse: "collapse", fontSize: 9, margin: "2px 0 5px", breakInside: "avoid" },
  th: { border: "1px solid #e7edf3", background: "#f6f8fb", padding: "2px 5px", textAlign: "left", fontWeight: 800, textTransform: "uppercase", fontSize: 8, color: "#475569" },
  td: { border: "1px solid #eef2f6", padding: "2px 5px", verticalAlign: "top", color: "#0f172a" },
  sub: { fontSize: 7.5, color: "#64748b" },
};

const str = (v) => (v === null || v === undefined ? "" : String(v).trim());
const has = (v) => !!str(v);
const fmtDT = (v) => { if (!v) return ""; const d = new Date(v); return isNaN(d) ? str(v) : d.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); };
const isStat = (o) => /stat|urgent/i.test(str(o.priority));
const Priority = ({ o }) => isStat(o)
  ? <span style={{ color: "#b91c1c", fontWeight: 800 }}>{str(o.priority).toUpperCase()}</span>
  : <>{str(o.priority) || "Routine"}</>;

export default function FullOrderSheetSection({ file }) {
  const orders = (file?.doctorOrders || []).slice().sort((a, b) => new Date(a.orderedAt || 0) - new Date(b.orderedAt || 0));
  if (!orders.length) return null;
  const kind = (o) => {
    const t = str(o.orderType).toLowerCase();
    if (/med|drug|iv|infusion|fluid/.test(t)) return "med";
    if (/invest|lab|test|radiol|imaging/.test(t)) return "inv";
    return "other";
  };
  const meds = orders.filter((o) => kind(o) === "med");
  const invs = orders.filter((o) => kind(o) === "inv");
  const others = orders.filter((o) => kind(o) === "other");
  const d = (o) => o.details || {};

  return (
    <>
      {meds.length > 0 && (
        <>
          <div style={S.h}>Medication Orders</div>
          <table style={S.tbl}>
            <thead><tr>{["Ordered", "Drug", "Dose", "Route", "Frequency", "Duration", "Priority", "Status", "Ordered by"].map((h) => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>
              {meds.map((o, i) => (
                <tr key={i}>
                  <td style={S.td}>{fmtDT(o.orderedAt)}</td>
                  <td style={S.td}>
                    <strong>{str(o.displayName) || "—"}</strong>
                    {has(d(o).genericName) ? <div style={S.sub}>{str(d(o).genericName)}</div> : null}
                    {has(d(o).indication) ? <div style={S.sub}>Indication: {str(d(o).indication)}</div> : null}
                  </td>
                  <td style={S.td}>{str(o.dose) || "—"}</td>
                  <td style={S.td}>{str(o.route) || "—"}</td>
                  <td style={S.td}>{str(o.frequency) || "—"}</td>
                  <td style={S.td}>{str(d(o).duration) || "—"}</td>
                  <td style={S.td}><Priority o={o} /></td>
                  <td style={S.td}>{str(o.status) || "—"}</td>
                  <td style={S.td}>{str(o.orderedBy) || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {invs.length > 0 && (
        <>
          <div style={S.h}>Investigations Ordered</div>
          <table style={S.tbl}>
            <thead><tr>{["Ordered", "Investigation", "Priority", "Status", "Instructions", "Ordered by"].map((h) => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>
              {invs.map((o, i) => (
                <tr key={i}>
                  <td style={S.td}>{fmtDT(o.orderedAt)}</td>
                  <td style={S.td}><strong>{str(o.displayName) || "—"}</strong></td>
                  <td style={S.td}><Priority o={o} /></td>
                  <td style={S.td}>{str(o.status) || "—"}</td>
                  <td style={S.td}>{str(d(o).instructions || d(o).notes) || "—"}</td>
                  <td style={S.td}>{str(o.orderedBy) || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {others.length > 0 && (
        <>
          <div style={S.h}>Other Orders (Procedures / Diet / Nursing)</div>
          <table style={S.tbl}>
            <thead><tr>{["Ordered", "Type", "Order", "Priority", "Status", "Ordered by"].map((h) => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>
              {others.map((o, i) => (
                <tr key={i}>
                  <td style={S.td}>{fmtDT(o.orderedAt)}</td>
                  <td style={S.td}>{str(o.orderType) || "—"}</td>
                  <td style={S.td}><strong>{str(o.displayName) || "—"}</strong>{has(d(o).instructions || d(o).notes) ? <div style={S.sub}>{str(d(o).instructions || d(o).notes)}</div> : null}</td>
                  <td style={S.td}><Priority o={o} /></td>
                  <td style={S.td}>{str(o.status) || "—"}</td>
                  <td style={S.td}>{str(o.orderedBy) || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}
