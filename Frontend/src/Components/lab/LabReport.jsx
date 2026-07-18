// Components/lab/LabReport.jsx
// ════════════════════════════════════════════════════════════════════
// R7bf-F / A4-CRIT-2: NABH AAC.3 compliant lab report.
// R7bf-F / A4-HIGH-11: "VERIFIED BY: Dr X, DMC #" footer.
//
// Pre-R7bf the lab printout showed test name + result + flag. NABH
// AAC.3 mandates the following on every accredited lab report:
//   • Lab accreditation number (NABL ID + scope reference)
//   • Method used (e.g. "Photometry", "ELISA", "Immunochemiluminescence")
//   • Equipment ID (analyser serial / asset tag)
//   • Reference range source (e.g. "CLSI EP28-A3 / WHO 2019")
//   • Biological reference interval label per test
//   • Units per test (SI preferred)
//   • Verified-by signature row with DMC registration number
//
// Hospital-level fields (accreditation number, NABL scope) come from
// the same hospital-settings doc the rest of the print pipeline uses.
// Per-test fields (method, equipment, ref range source) come off the
// LabRecord doc — the lab tech enters these at result-time.
//
// Registered in printables/index.js under slug "lab-report".
// ════════════════════════════════════════════════════════════════════

import React from "react";
import PrintShell from "../print/PrintShell";
import { toNum } from "../../utils/printUtils";

const fmtDate = (d, withTime = true) => {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString("en-IN", withTime
      ? { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }
      : { day: "2-digit", month: "short", year: "numeric" });
  } catch { return String(d); }
};

const flagTone = (flag) => {
  const s = String(flag || "").toUpperCase();
  if (s === "H" || s === "HIGH")     return { bg: "#fef3c7", fg: "#92400e", label: "HIGH" };
  if (s === "L" || s === "LOW")      return { bg: "#e0e7ff", fg: "#4f46e5", label: "LOW" };
  if (s === "HH" || s === "CRITICAL HIGH") return { bg: "#fee2e2", fg: "#7f1d1d", label: "CRIT HIGH" };
  if (s === "LL" || s === "CRITICAL LOW")  return { bg: "#fecaca", fg: "#7f1d1d", label: "CRIT LOW" };
  if (s === "A" || s === "ABNORMAL") return { bg: "#fef3c7", fg: "#92400e", label: "ABN" };
  return null;
};

const LabReport = ({ settings = {}, receipt = {} }) => {
  const r = receipt;
  const tests = Array.isArray(r.tests) ? r.tests : [];
  const printCount = toNum(r.printCount);

  // R7bf-F / A4-CRIT-2: hospital-level NABH fields. Pull from
  // hospital-settings (rendered globally) — fall back to "—" so the
  // template never shows undefined. NABL ID is the accreditation
  // reference number; scope references the test list document.
  // R7hr(LAB-P4): hospital settings actually store certificates in the
  // accreditations[] array ({name, certNumber}) — read the NABL entry
  // from there first so the real certificate number prints.
  const nablCert = (settings.accreditations || []).find(
    (a) => /NABL/i.test(a?.name || "") && a?.certNumber
  )?.certNumber;
  const labAccredNo = r.labAccreditationNo
    || nablCert
    || settings.nablAccreditationNo
    || settings.nablId
    || (settings.nabl ? "NABL Accredited" : "—");

  // R7hr(LAB-P4) — NABL/ISO 15189: results released before authorization
  // must be clearly marked provisional; a re-released report after edits
  // must be identified as amended.
  const isFinal = /final|verified/i.test(String(r.status || ""));
  const refRangeSource = r.referenceRangeSource
    || settings.labReferenceRangeSource
    || "CLSI EP28-A3 / Manufacturer's package insert";

  // R7bf-F / A4-HIGH-11: verifier name + DMC registration
  const verifierName  = r.verifiedByName || r.consultantName || "—";
  const verifierDmc   = r.verifiedByDmc  || r.consultantDmc  || r.doctorReg || "";

  return (
    <PrintShell
      settings={settings}
      documentTitle="Laboratory Investigation Report"
      serialNo={r.reportNo || r.labNo}
      printCount={printCount}
      fontSize="14px"  /* R7bf-F / A4-MED-3: 14pt default for elderly readability */
      signatureLabels={["Reviewed By Patient / Attendant", "Authorized Pathologist"]}
      infoItems={[
        { label: "Patient",       value: r.patientName },
        { label: "UHID",          value: r.uhid },
        { label: "Age / Sex",     value: [r.age && `${r.age}Y`, r.gender].filter(Boolean).join(" / ") },
        { label: "Referring Dr",  value: r.referringDoctor },
        { label: "Lab Accred No", value: labAccredNo },
        { label: "Sample Type",   value: r.sampleType },
        { label: "Sample ID",     value: r.sampleId },
        { label: "Collected",     value: fmtDate(r.collectedAt) },
        { label: "Received",      value: fmtDate(r.receivedAt) },
        { label: "Reported",      value: fmtDate(r.reportedAt || new Date()) },
        { label: "Status",        value: r.status || "Final" },
      ]}
    >
      <div className="pr-lab-report">
        {/* R7hr(LAB-P4) — release-status strips (NABL / ISO 15189) */}
        {r.amended && (
          <div style={{ margin: "0 0 8px", padding: "7px 12px", borderRadius: 6, background: "#fee2e2", border: "1.5px solid #dc2626", color: "#7f1d1d", fontWeight: 800, fontSize: 12, letterSpacing: ".4px", textAlign: "center" }}>
            AMENDED REPORT — supersedes the version released on {fmtDate(r.verifiedAt)}
          </div>
        )}
        {!isFinal && (
          <div style={{ margin: "0 0 8px", padding: "7px 12px", borderRadius: 6, background: "#fef3c7", border: "1.5px solid #d97706", color: "#92400e", fontWeight: 800, fontSize: 12, letterSpacing: ".4px", textAlign: "center" }}>
            PROVISIONAL REPORT — pending verification by the authorized signatory
          </div>
        )}

        {/* Hospital + test-list scope banner — NABH AAC.3 reference */}
        <div className="pr-section">
          <div className="pr-section__title">Methodology &amp; Scope</div>
          <div className="pr-section__body" style={{ fontSize: 12 }}>
            <div><strong>Reference range source:</strong> {refRangeSource}</div>
            {r.scope && <div><strong>Scope of accreditation:</strong> {r.scope}</div>}
            {settings.labQualityStatement && (
              <div style={{ marginTop: 3, fontStyle: "italic", color: "#475569" }}>
                {settings.labQualityStatement}
              </div>
            )}
          </div>
        </div>

        <table className="pr-table">
          <thead>
            <tr>
              <th style={{ width: 28 }}>#</th>
              <th>Investigation</th>
              <th style={{ width: 110 }}>Result</th>
              <th style={{ width: 70 }}>Units</th>
              <th style={{ width: 140 }}>Reference Range</th>
              <th style={{ width: 60 }}>Flag</th>
              <th style={{ width: 130 }}>Method</th>
              <th style={{ width: 100 }}>Equipment</th>
            </tr>
          </thead>
          <tbody>
            {tests.length === 0 ? (
              <tr><td colSpan={8} className="muted center" style={{ padding: 20, fontStyle: "italic" }}>
                No tests reported.
              </td></tr>
            ) : tests.map((t, i) => {
              const tone = flagTone(t.flag);
              return (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td>
                    <strong>{t.name || t.testName || "—"}</strong>
                    {t.loincCode && <div className="muted" style={{ fontSize: 10 }}>LOINC: {t.loincCode}</div>}
                    {t.bioRefIntervalLabel && (
                      <div className="muted" style={{ fontSize: 10, fontStyle: "italic" }}>
                        Population: {t.bioRefIntervalLabel}
                      </div>
                    )}
                  </td>
                  <td style={{ fontWeight: 800 }}>{t.result ?? "—"}</td>
                  <td>{t.units || t.unit || "—"}</td>
                  <td>{t.referenceRange || t.refRange || t.normalRange || "—"}</td>
                  <td>
                    {tone ? (
                      <span style={{
                        background: tone.bg, color: tone.fg,
                        padding: "2px 7px", borderRadius: 8,
                        fontSize: 10.5, fontWeight: 800,
                      }}>{tone.label}</span>
                    ) : (
                      <span style={{ color: "#15803d", fontWeight: 700 }}>Normal</span>
                    )}
                  </td>
                  <td style={{ fontSize: 11 }}>{t.method || "—"}</td>
                  <td style={{ fontSize: 11, fontFamily: "'DM Mono', monospace" }}>
                    {t.equipmentId || t.equipment || "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Comments / interpretation */}
        {r.interpretation && (
          <div className="pr-section">
            <div className="pr-section__title">Interpretation / Comments</div>
            <div className="pr-section__body" style={{ whiteSpace: "pre-wrap" }}>
              {r.interpretation}
            </div>
          </div>
        )}

        {/* R7bf-F / A4-HIGH-11: "VERIFIED BY: Dr X, DMC #" footer */}
        <div className="pr-section" style={{ marginTop: 16 }}>
          <div className="pr-section__title">Verification</div>
          <div className="pr-section__body" style={{ fontSize: 12 }}>
            <div style={{ fontWeight: 800, color: "#0f172a" }}>
              VERIFIED BY: {verifierName}
              {verifierDmc && <span style={{ fontWeight: 700, color: "#475569" }}>, DMC {verifierDmc}</span>}
            </div>
            {r.verifiedAt && (
              <div style={{ color: "#475569", fontSize: 11, marginTop: 3 }}>
                Verified at: {fmtDate(r.verifiedAt)}
              </div>
            )}
            {r.qualifications && (
              <div style={{ color: "#475569", fontSize: 11 }}>
                Qualifications: {r.qualifications}
              </div>
            )}
          </div>
        </div>

        {/* NABH note — every accredited report carries this disclaimer */}
        <div style={{
          marginTop: 10, padding: "8px 12px", borderRadius: 6,
          background: "#f8fafc", border: "1px solid #e2e8f0",
          fontSize: 10.5, color: "#475569", fontStyle: "italic",
        }}>
          This report is generated from samples collected per the
          {" "}<strong>{r.collectionProtocol || "approved collection protocol"}</strong>{" "}
          and analysed per the methodology stated above. Reference
          intervals are population-specific; correlate clinically.
          Critical values are communicated per the hospital&apos;s
          critical-value notification policy (AAC.6).
        </div>
      </div>
    </PrintShell>
  );
};

export default LabReport;
