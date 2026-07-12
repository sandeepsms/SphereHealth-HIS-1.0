/**
 * SharedFormalDocSections.jsx — R7hr(DOCS-FULL-FU, task #122)
 * ─────────────────────────────────────────────────────────────
 * The six full formal documents (DOCS-FULL, owner 2026-07-12) for the four
 * non-Narrative patient-file themes (Timeline / Executive / Audit /
 * Editorial). Narrative integrates the same Full*Section components into
 * its own numbered sections; the other themes render this appendix after
 * SharedRegisterSections so a file printed on ANY theme carries the
 * standalone-level Doctor Order Sheet, MAR grid, NABL lab tables, full
 * diagnostic reports, consent records, diet plans and discharge summary.
 *
 * Each block is guarded by data presence; the `.full`-gated blocks skip on
 * legacy payloads (the themes' own compact discharge / investigations
 * summaries continue to cover those).
 */
import React from "react";
import FullDischargeSection from "./FullDischargeSection";
import { FullLabTrends, FullDiagnosticReports } from "./FullLabSection";
import FullConsentSection from "./FullConsentSection";
import FullDietSection from "./FullDietSection";
import FullMarSection from "./FullMarSection";
import FullOrderSheetSection from "./FullOrderSheetSection";

const H = {
  fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".6px",
  color: "#1e293b", borderBottom: "1.5px solid #1e293b", padding: "2px 0 3px", margin: "12px 0 5px",
  display: "flex", justifyContent: "space-between", alignItems: "baseline",
};
const NABH = { fontSize: 8, fontWeight: 700, color: "#64748b", letterSpacing: ".4px" };

const Sec = ({ title, nabh, children }) => (
  <div style={{ breakInside: "avoid-page", marginTop: 10 }}>
    <div style={H}><span>{title}</span>{nabh ? <span style={NABH}>{nabh}</span> : null}</div>
    {children}
  </div>
);

export default function SharedFormalDocSections({ file }) {
  const f = file || {};
  const hasOrders   = (f.doctorOrders || []).length > 0;
  const hasMar      = (f.doctorOrders || []).some((o) => (o.admin || []).length) || (f.mar || []).length > 0;
  const hasTrends   = (f.labTrends || []).some((t) => (t.tests || []).some((x) => (x.readings || []).length));
  const hasReports  = (f.labReports || []).some((r) => r.full);
  const hasConsents = (f.consents || []).some((c) => c.full);
  const hasDiet     = (f.dietPlans || []).some((d) => d.full);
  const hasDischarge = !!f.discharge?.full;
  if (!hasOrders && !hasMar && !hasTrends && !hasReports && !hasConsents && !hasDiet && !hasDischarge) return null;

  return (
    <>
      {hasOrders && <Sec title="Doctor Order Sheet" nabh="NABH MOM.4"><FullOrderSheetSection file={f} /></Sec>}
      {hasMar && <Sec title="Medication Administration Record (MAR)" nabh="NABH MOM.6"><FullMarSection file={f} /></Sec>}
      {hasTrends && <Sec title="Laboratory Results (NABL format)" nabh="NABH AAC.7"><FullLabTrends file={f} /></Sec>}
      {hasReports && <Sec title="Diagnostic / Imaging Reports" nabh="NABH AAC.8"><FullDiagnosticReports file={f} /></Sec>}
      {hasConsents && <Sec title="Consent Records" nabh="NABH PRE.1"><FullConsentSection file={f} /></Sec>}
      {hasDiet && <Sec title="Dietetic Care — Full Plans" nabh="NABH COP.4"><FullDietSection file={f} /></Sec>}
      {hasDischarge && <Sec title="Discharge Summary — Full Document" nabh="NABH AAC.11"><FullDischargeSection file={f} /></Sec>}
    </>
  );
}
