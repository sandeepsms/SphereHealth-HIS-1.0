/**
 * FullLabSection.jsx — R7hr(DOCS-FULL, owner 2026-07-12)
 * ────────────────────────────────────────────────────────
 * Standalone-level lab detail inside the Complete Patient File:
 *
 *  1. DIAGNOSTIC / IMAGING REPORTS (f.labReports[].full — raw LabReport
 *     docs): full findings / clinical details / organism & sensitivity /
 *     recommendations / verifier, not the one-line impression digest.
 *  2. NABL RESULTS TABLES (f.labTrends — LabTrend panels): per-panel
 *     sample-meta strip (accession, collected/received, referring doctor,
 *     analyser) + tests table with latest result, unit, reference range,
 *     derived H/L flag and method, + verifier line. Before DOCS-FULL no
 *     theme rendered labTrends at all.
 *
 * Field chains are MODEL-KEY FIRST (labRecordsModels.js: LabReport /
 * LabTrend / TestRowSchema / ReadingSchema) — registerRows.js precedent.
 */
import React from "react";

const S = {
  card: { border: "1px solid #e2e8f0", borderRadius: 6, padding: "6px 10px", margin: "5px 0", breakInside: "avoid" },
  title: { fontSize: 10.5, fontWeight: 800, color: "#0f172a" },
  meta: { fontSize: 8.5, color: "#64748b", margin: "1px 0 4px" },
  h: { fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".5px", color: "#475569", margin: "4px 0 1px" },
  p: { fontSize: 10, color: "#0f172a", margin: "1px 0", lineHeight: 1.45, whiteSpace: "pre-wrap" },
  tbl: { width: "100%", borderCollapse: "collapse", fontSize: 9.5, margin: "3px 0 4px" },
  th: { border: "1px solid #e7edf3", background: "#f6f8fb", padding: "2px 6px", textAlign: "left", fontWeight: 800, textTransform: "uppercase", fontSize: 8.5, color: "#475569" },
  td: { border: "1px solid #eef2f6", padding: "2px 6px", verticalAlign: "top", color: "#0f172a" },
  sign: { fontSize: 8.5, color: "#475569", marginTop: 3, borderTop: "1px dashed #e2e8f0", paddingTop: 2 },
};

const str = (v) => (v === null || v === undefined ? "" : String(v).trim());
const has = (v) => Array.isArray(v) ? v.length > 0 : !!str(v);
const fmtDT = (v) => { if (!v) return ""; const d = new Date(v); return isNaN(d) ? str(v) : d.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); };
const fmtD = (v) => { if (!v) return ""; const d = new Date(v); return isNaN(d) ? str(v) : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }); };

/* Latest reading of a TestRow + derived H/L flag against refMin/refMax. */
const latestReading = (t) => {
  const rs = (t.readings || []).filter((r) => has(r.value));
  if (!rs.length) return null;
  return rs.reduce((a, b) => (new Date(a.date || 0) >= new Date(b.date || 0) ? a : b));
};
const flagOf = (t, reading) => {
  if (!reading) return "";
  if (reading.status === "critical") return "!!";
  const n = parseFloat(reading.value);
  if (!Number.isFinite(n)) return "";
  if (t.refMax !== null && t.refMax !== undefined && n > t.refMax) return "H";
  if (t.refMin !== null && t.refMin !== undefined && n < t.refMin) return "L";
  return "";
};
const refRange = (t) => {
  const lo = t.refMin, hi = t.refMax;
  if (lo === null || lo === undefined) return (hi === null || hi === undefined) ? "—" : `≤ ${hi}`;
  return (hi === null || hi === undefined) ? `≥ ${lo}` : `${lo} – ${hi}`;
};

export function FullDiagnosticReports({ file }) {
  const reports = (file?.labReports || []).filter((r) => r.full);
  if (!reports.length) return null;
  return (
    <>
      {reports.map((rp, i) => {
        const x = rp.full || {};
        return (
          <div key={i} style={S.card}>
            <div style={S.title}>
              {str(x.testName || rp.name) || "Diagnostic Report"}
              {has(x.reportType || rp.reportType) ? ` · ${str(x.reportType || rp.reportType).toUpperCase()}` : ""}
              {has(x.bodyPart) ? ` · ${str(x.bodyPart)}` : ""}
              {str(x.status || rp.status).toLowerCase() === "verified" ? " · ✓ VERIFIED" : has(x.status || rp.status) ? ` · ${str(x.status || rp.status).toUpperCase()}` : ""}
            </div>
            <div style={S.meta}>
              {[x.reportDate || rp.date ? `Reported ${fmtD(x.reportDate || rp.date)}` : "",
                x.collectionDate ? `Collected ${fmtD(x.collectionDate)}` : "",
                has(x.specimen) ? `Specimen: ${str(x.specimen)}` : "",
                has(x.reportedByName) ? `By ${str(x.reportedByName)}` : ""].filter(Boolean).join(" · ")}
            </div>
            {has(x.clinicalDetails) && <><div style={S.h}>Clinical Details</div><div style={S.p}>{str(x.clinicalDetails)}</div></>}
            {has(x.findings) && <><div style={S.h}>Findings</div><div style={S.p}>{str(x.findings)}</div></>}
            {has(x.impression || rp.impression) && <><div style={S.h}>Impression</div><div style={{ ...S.p, fontWeight: 700 }}>{str(x.impression || rp.impression)}</div></>}
            {has(x.organism) && <><div style={S.h}>Organism / Culture</div><div style={S.p}>{str(x.organism)}{has(x.sensitivity) ? ` — Sensitivity: ${Array.isArray(x.sensitivity) ? x.sensitivity.join(", ") : str(x.sensitivity)}` : ""}</div></>}
            {has(x.recommendations) && <><div style={S.h}>Recommendations</div><div style={S.p}>{str(x.recommendations)}</div></>}
            {has(x.verifiedByName) && <div style={S.sign}>Verified by <strong>{str(x.verifiedByName)}</strong>{x.verifiedAt ? ` · ${fmtDT(x.verifiedAt)}` : ""}</div>}
          </div>
        );
      })}
    </>
  );
}

export function FullLabTrends({ file }) {
  const panels = (file?.labTrends || []).filter((t) => (t.tests || []).some((x) => (x.readings || []).length));
  if (!panels.length) return null;
  return (
    <>
      {panels.map((t, i) => {
        const rows = (t.tests || []).map((x) => ({ t: x, r: latestReading(x) })).filter((e) => e.r);
        if (!rows.length) return null;
        return (
          <div key={i} style={S.card}>
            <div style={S.title}>{str(t.name) || "Lab Panel"}{str(t.status).toLowerCase() === "verified" ? " · ✓ VERIFIED" : ""}</div>
            <div style={S.meta}>
              {[has(t.sampleId) ? `Sample/Accession: ${str(t.sampleId)}` : "",
                t.sampleCollectedAt ? `Collected ${fmtDT(t.sampleCollectedAt)}` : "",
                t.sampleReceivedAt ? `Received ${fmtDT(t.sampleReceivedAt)}` : "",
                has(t.referringDoctor) ? `Referred by ${str(t.referringDoctor)}` : "",
                has(t.equipmentId) ? `Analyser: ${str(t.equipmentId)}` : ""].filter(Boolean).join(" · ")}
            </div>
            <table style={S.tbl}>
              <thead><tr>{["Test", "Result", "Unit", "Reference Range", "Flag", "Method"].map((h) => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
              <tbody>
                {rows.map(({ t: x, r }, j) => {
                  const fl = flagOf(x, r);
                  return (
                    <tr key={j}>
                      <td style={S.td}><strong>{str(x.name)}</strong></td>
                      <td style={{ ...S.td, fontWeight: fl ? 800 : 400, color: fl ? "#b91c1c" : "#0f172a" }}>{str(r.value)}{r.date ? <span style={{ fontSize: 8, color: "#94a3b8" }}> ({fmtD(r.date)})</span> : null}</td>
                      <td style={S.td}>{str(x.unit) || "—"}</td>
                      <td style={S.td}>{refRange(x)}</td>
                      <td style={{ ...S.td, fontWeight: 800, color: fl ? "#b91c1c" : "#16a34a" }}>{fl || "N"}</td>
                      <td style={S.td}>{str(x.method) || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {(has(t.verifiedByName) || has(t.notes)) && (
              <div style={S.sign}>
                {has(t.verifiedByName) ? <>Verified by <strong>{str(t.verifiedByName)}</strong>{t.verifiedAt ? ` · ${fmtDT(t.verifiedAt)}` : ""}</> : null}
                {has(t.notes) ? <> · {str(t.notes)}</> : null}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

export default function FullLabSection({ file }) {
  return (
    <>
      <FullLabTrends file={file} />
      <FullDiagnosticReports file={file} />
    </>
  );
}
