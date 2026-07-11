/**
 * SharedRegisterSections.jsx — R7hr(THEME-REG)
 * Coverage records + NABH Safety & Compliance registers for the four
 * non-Narrative patient-file themes (Timeline / Executive / Audit /
 * Editorial), which previously omitted them entirely — a Complete File
 * printed on those themes silently lost pharmacy dispenses, advances,
 * ADRs, code events and every safety register.
 *
 * Self-contained styling (no theme CSS dependency) so it drops into any
 * theme; all field-name knowledge lives in registerRows.js, shared with
 * Narrative — one rename updates every theme (the REG-V lesson).
 */
import React from "react";
import { COVERAGE_BLOCKS, COVERAGE_ORDER, REGISTER_META, REGISTER_HEADERS, REGISTER_WIDTHS, registerRow } from "./registerRows";

const S = {
  section: { breakInside: "avoid-page", marginTop: 14 },
  h: {
    fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".6px",
    color: "#1e293b", borderBottom: "1.5px solid #1e293b", padding: "2px 0 3px", margin: "12px 0 5px",
    display: "flex", justifyContent: "space-between", alignItems: "baseline",
  },
  sub: { fontSize: 10, fontWeight: 800, color: "#334155", margin: "8px 0 3px", textTransform: "uppercase", letterSpacing: ".4px" },
  nabh: { fontSize: 8, fontWeight: 700, color: "#64748b", letterSpacing: ".4px" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 9, marginBottom: 6 },
  th: { textAlign: "left", padding: "2.5px 5px", fontSize: 8, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".3px", color: "#475569", borderBottom: "1px solid #94a3b8", background: "#f8fafc" },
  td: { padding: "2.5px 5px", borderBottom: "0.5px solid #e2e8f0", verticalAlign: "top", color: "#0f172a" },
};

const Tbl = ({ headers, widths, rows }) => (
  <table style={S.table}>
    <thead><tr>{headers.map((h, i) => <th key={i} style={{ ...S.th, width: widths?.[i] }}>{h}</th>)}</tr></thead>
    <tbody>
      {rows.map((cells, ri) => (
        <tr key={ri} style={{ breakInside: "avoid" }}>
          {cells.map((c, ci) => <td key={ci} style={S.td}>{c}</td>)}
        </tr>
      ))}
    </tbody>
  </table>
);

export default function SharedRegisterSections({ file }) {
  const f = file || {};
  const coverage = COVERAGE_BLOCKS
    .slice()
    .sort((a, b) => {
      const ia = COVERAGE_ORDER.indexOf(a.key), ib = COVERAGE_ORDER.indexOf(b.key);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    })
    .map((b) => ({ b, rows: Array.isArray(f[b.key]) ? f[b.key] : [] }))
    .filter(({ rows }) => rows.length > 0);

  const reg = f.complianceRegisters || {};
  const regKeys = Object.keys(REGISTER_META).filter((k) => Array.isArray(reg[k]) && reg[k].length > 0);

  if (coverage.length === 0 && regKeys.length === 0) return null;

  return (
    <div style={S.section}>
      {coverage.length > 0 && (
        <>
          <div style={S.h}><span>Coverage Records</span><span style={S.nabh}>Full-file coverage</span></div>
          {coverage.map(({ b, rows }) => (
            <React.Fragment key={b.key}>
              <div style={S.sub}>{b.title}{b.nabh ? <span style={S.nabh}> · {b.nabh}</span> : null}</div>
              <Tbl headers={b.headers} widths={b.widths} rows={rows.map((x) => b.row(x))} />
            </React.Fragment>
          ))}
        </>
      )}
      {regKeys.length > 0 && (
        <>
          <div style={S.h}><span>Safety &amp; Compliance Registers</span><span style={S.nabh}>NABH</span></div>
          {regKeys.map((k) => (
            <React.Fragment key={k}>
              <div style={S.sub}>{REGISTER_META[k].title}{REGISTER_META[k].nabh ? <span style={S.nabh}> · {REGISTER_META[k].nabh}</span> : null}</div>
              <Tbl headers={REGISTER_HEADERS} widths={REGISTER_WIDTHS} rows={reg[k].map(registerRow)} />
            </React.Fragment>
          ))}
        </>
      )}
    </div>
  );
}
