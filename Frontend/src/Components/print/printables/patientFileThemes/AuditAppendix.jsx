/**
 * AuditAppendix — "print Complete File WITH audit logs" (Admin/MRD).
 *
 * Rendered by CompleteIPDFile AFTER whichever theme printed the clinical
 * body, so all five themes share one appendix implementation. The data
 * arrives pre-fetched on the receipt (`receipt.auditBundle`, from
 * GET /api/patient-file/:uhid/audit-bundle — gated patient-file.audit-print),
 * so this component is render-only.
 *
 * Four sub-sections, each a compact print table capped at 500 rows by the
 * backend (a "latest 500" note prints when capped):
 *   1. Access / Activity Log   — who opened/edited the file   [NABH IMS.1]
 *   2. Print History           — who printed what, copy no.    [NABH IMS.4]
 *   3. Billing Audit Trail     — money events with actor+reason
 *   4. Clinical Action Trail   — note/MAR/consent lifecycle    [NABH AAC.7]
 */
import React from "react";

const fmtDT = (d) =>
  d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";

const S = {
  page:  { pageBreakBefore: "always", fontFamily: "'DM Sans', Arial, sans-serif", color: "#0f172a", padding: "6mm 0 0" },
  band:  { borderTop: "3px solid #1e293b", borderBottom: "1px solid #cbd5e1", padding: "8px 2px 7px", marginBottom: 10 },
  h1:    { margin: 0, fontSize: 15, fontWeight: 800, letterSpacing: ".4px" },
  sub:   { margin: "3px 0 0", fontSize: 9.5, color: "#64748b" },
  sec:   { margin: "12px 0 0", pageBreakInside: "auto" },
  h2:    { display: "flex", alignItems: "baseline", gap: 8, margin: "0 0 5px", fontSize: 11.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".5px" },
  nabh:  { fontSize: 8.5, fontWeight: 700, color: "#4338ca", background: "#eef2ff", padding: "1px 7px", borderRadius: 8 },
  count: { fontSize: 9, fontWeight: 600, color: "#64748b", marginLeft: "auto" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 9.3, lineHeight: 1.35 },
  th:    { textAlign: "left", background: "#f1f5f9", border: "1px solid #dbe1ea", padding: "3px 6px", fontSize: 8.6, textTransform: "uppercase", letterSpacing: ".4px", color: "#475569" },
  td:    { border: "1px solid #e5e9f0", padding: "3px 6px", verticalAlign: "top", wordBreak: "break-word" },
  empty: { border: "1px dashed #cbd5e1", padding: "8px 10px", fontSize: 9.5, color: "#94a3b8", borderRadius: 6 },
  capped:{ fontSize: 8.5, color: "#b45309", margin: "3px 0 0" },
};

function AuditTable({ title, nabh, headers, rows, widths, capped, emptyMsg }) {
  return (
    <div style={S.sec}>
      <h3 style={S.h2}>
        <span>{title}</span>
        {nabh ? <span style={S.nabh}>{nabh}</span> : null}
        <span style={S.count}>{rows.length} record{rows.length === 1 ? "" : "s"}</span>
      </h3>
      {rows.length === 0 ? (
        <div style={S.empty}>{emptyMsg}</div>
      ) : (
        <table style={S.table}>
          <thead>
            <tr>{headers.map((h, i) => <th key={h} style={{ ...S.th, width: widths?.[i] }}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((cells, ri) => (
              <tr key={ri} style={{ pageBreakInside: "avoid" }}>
                {cells.map((c, ci) => <td key={ci} style={S.td}>{c || ""}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {capped ? <div style={S.capped}>Showing the latest 500 records — older entries are retained in the system and available on the audit registers.</div> : null}
    </div>
  );
}

export default function AuditAppendix({ bundle = {}, selections, patient = {}, viewerRole = "" }) {
  // Defence in depth: the bundle only exists when the Admin/MRD-gated API
  // returned it, but never render for a demo/anonymous print context.
  if (!["admin", "mrd"].includes(String(viewerRole || "").toLowerCase())) return null;

  const pick = Array.isArray(selections) && selections.length > 0 ? new Set(selections) : null;
  const on = (k) => !pick || pick.has(k);

  const activity = Array.isArray(bundle.activityLog)   ? bundle.activityLog   : [];
  const prints   = Array.isArray(bundle.printAudit)    ? bundle.printAudit    : [];
  const billing  = Array.isArray(bundle.billingAudit)  ? bundle.billingAudit  : [];
  const clinical = Array.isArray(bundle.clinicalAudit) ? bundle.clinicalAudit : [];
  const capped = bundle.capped || {};

  return (
    <div className="pr-page" style={S.page}>
      <div style={S.band}>
        <h2 style={S.h1}>AUDIT APPENDIX — {patient.name || "Patient"} ({patient.uhid || "—"}{patient.ipdNo ? ` · ${patient.ipdNo}` : ""})</h2>
        <p style={S.sub}>
          System-generated audit trails appended to the Complete Patient File. Access restricted to Admin / Medical Records.
          {bundle.window?.from || bundle.window?.to
            ? ` Window: ${bundle.window.from || "start"} → ${bundle.window.to || "now"}.`
            : " Window: full record."}
        </p>
      </div>

      {on("activityLog") && (
        <AuditTable
          title="1 · Access & Activity Log" nabh="NABH IMS.1"
          headers={["Timestamp", "User", "Role", "Action", "Module", "Summary"]}
          widths={["13%", "15%", "9%", "10%", "13%", "40%"]}
          rows={activity.map((a) => [fmtDT(a.createdAt), a.userName, a.userRole, a.action, a.module, a.summary || a.area])}
          capped={capped.activityLog}
          emptyMsg="No file-access activity recorded for this patient."
        />
      )}

      {on("printAudit") && (
        <AuditTable
          title="2 · Print History" nabh="NABH IMS.4"
          headers={["Printed At", "Document", "Doc No.", "Copy #", "Printed By", "Role"]}
          widths={["14%", "18%", "22%", "8%", "22%", "16%"]}
          rows={prints.map((p) => [fmtDT(p.printedAt), p.entityType, p.entityNumber, p.printCount ? `#${p.printCount}${p.printCount > 1 ? " (dup)" : ""}` : "", p.printedByName, p.printedByRole])}
          capped={capped.printAudit}
          emptyMsg="No prints recorded for this patient's documents."
        />
      )}

      {on("billingAudit") && (
        <AuditTable
          title="3 · Billing Audit Trail" nabh="GST §35 / 7-yr retention"
          headers={["Timestamp", "Event", "Bill No.", "Amount (₹)", "Actor", "Role", "Reason / Note"]}
          widths={["12%", "16%", "13%", "9%", "14%", "9%", "27%"]}
          rows={billing.map((b) => [
            fmtDT(b.createdAt), String(b.event || "").replace(/_/g, " "), b.billNumber,
            b.amount !== undefined && b.amount !== null ? Number(b.amount).toLocaleString("en-IN") : "",
            b.actorName, b.actorRole, b.reason,
          ])}
          capped={capped.billingAudit}
          emptyMsg="No billing audit events recorded for this patient."
        />
      )}

      {on("clinicalAudit") && (
        <AuditTable
          title="4 · Clinical Action Trail" nabh="NABH AAC.7"
          headers={["Timestamp", "Event", "Record", "Actor", "Role", "Reason"]}
          widths={["13%", "22%", "13%", "16%", "10%", "26%"]}
          rows={clinical.map((c) => [fmtDT(c.createdAt), String(c.event || "").replace(/_/g, " "), c.targetType, c.actorName, c.actorRole, c.reason])}
          capped={capped.clinicalAudit}
          emptyMsg="No clinical audit events recorded for this patient."
        />
      )}
    </div>
  );
}
