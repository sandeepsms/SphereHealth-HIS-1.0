// Components/print/printables/OPDPrescription.jsx
// OPD doctor's prescription pad — vitals, chief complaints, diagnosis,
// the Rx drug list with frequency / duration / instructions, plus
// advice / lab orders / follow-up. A4 portrait by default.

import React from "react";
import PrintShell from "../PrintShell";

const VitalCell = ({ label, value, unit }) => (
  <div style={{
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    borderRadius: 6,
    padding: "6px 10px",
    fontSize: 11,
    flex: 1,
    minWidth: 90,
  }}>
    <div style={{ fontSize: 9, color: "#64748b", textTransform: "uppercase", fontWeight: 700, letterSpacing: ".5px" }}>
      {label}
    </div>
    <div style={{ fontWeight: 800, color: "#0f172a" }}>
      {value || "—"}{value && unit ? <span style={{ fontSize: 10, color: "#64748b", fontWeight: 500 }}> {unit}</span> : null}
    </div>
  </div>
);

/* Patient status pill — mirrors the on-screen Diagnosis card status strip
   so the printout reads as "Stable / Improving / Critical / etc." in the
   same colour the doctor saw while typing. */
const STATUS_TONE = {
  Stable:        { bg: "#dcfce7", fg: "#15803d", border: "#86efac" },
  Improving:     { bg: "#dbeafe", fg: "#1d4ed8", border: "#93c5fd" },
  Worsening:     { bg: "#fee2e2", fg: "#b91c1c", border: "#fca5a5" },
  Critical:      { bg: "#fecaca", fg: "#7f1d1d", border: "#f87171" },
  "Under Review":{ bg: "#fef3c7", fg: "#a16207", border: "#fcd34d" },
  Recovered:     { bg: "#d1fae5", fg: "#065f46", border: "#6ee7b7" },
};
const statusTone = (s) => STATUS_TONE[s] || { bg: "#f1f5f9", fg: "#475569", border: "#cbd5e1" };

const OPDPrescription = ({ settings, receipt = {} }) => {
  const vitals = receipt.vitals || {};
  const drugs  = Array.isArray(receipt.drugs)        ? receipt.drugs        : [];
  const labs   = Array.isArray(receipt.investigations) ? receipt.investigations : [];
  const advice = Array.isArray(receipt.advice)
    ? receipt.advice
    : (receipt.advice ? String(receipt.advice).split("\n").filter(Boolean) : []);

  // System-exam lines are pre-joined by "\n" in the payload — split so we
  // can render each system on its own row (CVS:, RS:, CNS:, P/A:).
  const sysLines = (receipt.systemicExam || "")
    .split("\n")
    .map(s => s.trim())
    .filter(Boolean);

  return (
    <PrintShell
      settings={settings}
      documentTitle="OPD Prescription · Rx"
      serialNo={receipt.rxNo || receipt.visitNo}
      infoItems={[
        { label: "Patient",    value: receipt.patientName },
        { label: "UHID",       value: receipt.uhid },
        { label: "Age / Sex",  value: [receipt.age && `${receipt.age}Y`, receipt.gender].filter(Boolean).join(" / ") },
        { label: "Mobile",     value: receipt.mobile },
        { label: "Doctor",     value: receipt.doctorName },
        { label: "Reg. No",    value: receipt.doctorReg },
        { label: "Department", value: receipt.department },
        { label: "Visit Date", value: receipt.visitDate
            ? new Date(receipt.visitDate).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
            : new Date().toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) },
      ]}
      signatureLabels={["Doctor's Signature & Stamp", "Patient / Attendant"]}
    >
      {/* ── Vitals strip ── */}
      {(vitals.bp || vitals.pulse || vitals.temp || vitals.spo2 || vitals.weight || vitals.height) && (
        <div className="pr-section">
          <div className="pr-section__title">Vitals on Examination</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <VitalCell label="BP"      value={vitals.bp}      unit="mmHg" />
            <VitalCell label="Pulse"   value={vitals.pulse}   unit="bpm"  />
            <VitalCell label="Temp"    value={vitals.temp}    unit="°F"   />
            <VitalCell label="SpO₂"    value={vitals.spo2}    unit="%"    />
            <VitalCell label="RR"      value={vitals.rr}      unit="/min" />
            <VitalCell label="Weight"  value={vitals.weight}  unit="kg"   />
            <VitalCell label="Height"  value={vitals.height}  unit="cm"   />
            <VitalCell label="BMI"     value={vitals.bmi}                 />
          </div>
        </div>
      )}

      {/* ── Complaints + HOPI + history + chronic ──
           Renders the whole subjective block in one card: chief complaints
           on top, then a HOPI (history of present illness) line, then the
           free-text history note from soap.objectiveNote, and finally any
           chronic comorbidities the doctor ticked. Each row is conditional
           so the section gracefully shrinks if some pieces are blank. */}
      {(receipt.chiefComplaints || receipt.hopi || receipt.history || receipt.chronic) && (
        <div className="pr-section">
          <div className="pr-section__title">Chief Complaints &amp; History</div>
          <div className="pr-section__body" style={{ whiteSpace: "pre-wrap" }}>
            {receipt.chiefComplaints && (
              <div style={{ marginBottom: 4 }}>{receipt.chiefComplaints}</div>
            )}
            {receipt.hopi && (
              <div style={{ marginBottom: 4 }}>
                <strong>HOPI: </strong>{receipt.hopi}
              </div>
            )}
            {receipt.history && (
              <div style={{ marginBottom: 4 }}>
                <strong>History: </strong>{receipt.history}
              </div>
            )}
            {receipt.chronic && (
              <div>
                <strong>Chronic / Comorbidities: </strong>{receipt.chronic}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Diagnosis (three-tier + ICD-10 + Patient Status) ──
           Provisional → Working → Final mirrors the on-screen card. The
           Patient Status pill prints in the same colour family the doctor
           saw on /opd-assessment so it reads as a clinical at-a-glance. */}
      {(receipt.provisionalDx || receipt.workingDx || receipt.diagnosis || receipt.icd10 || receipt.patientStatus) && (
        <div className="pr-section">
          <div className="pr-section__title">Diagnosis</div>
          <div className="pr-section__body">
            {receipt.provisionalDx && (
              <div style={{ marginBottom: 2 }}>
                <span style={{
                  display: "inline-block", minWidth: 90,
                  fontWeight: 800, color: "#c2410c",
                }}>Provisional:</span> {receipt.provisionalDx}
              </div>
            )}
            {receipt.workingDx && (
              <div style={{ marginBottom: 2 }}>
                <span style={{
                  display: "inline-block", minWidth: 90,
                  fontWeight: 800, color: "#1d4ed8",
                }}>Working:</span> {receipt.workingDx}
              </div>
            )}
            {receipt.diagnosis && (
              <div style={{ marginBottom: 2 }}>
                <span style={{
                  display: "inline-block", minWidth: 90,
                  fontWeight: 800, color: "#15803d",
                }}>Final:</span> {receipt.diagnosis}
              </div>
            )}
            {receipt.icd10 && (
              <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>
                ICD-10: <strong style={{
                  color: "#6d28d9", fontFamily: "'DM Mono', monospace",
                  background: "#ede9fe", padding: "1px 6px", borderRadius: 4,
                }}>{receipt.icd10}</strong>
                {receipt.icd10Desc && <> — {receipt.icd10Desc}</>}
              </div>
            )}
            {receipt.patientStatus && (() => {
              const t = statusTone(receipt.patientStatus);
              return (
                <div style={{ marginTop: 6 }}>
                  <span style={{
                    display: "inline-block",
                    background: t.bg, color: t.fg,
                    border: `1px solid ${t.border}`,
                    padding: "2px 10px", borderRadius: 12,
                    fontSize: 10.5, fontWeight: 800,
                    textTransform: "uppercase", letterSpacing: ".4px",
                  }}>
                    Status: {receipt.patientStatus}
                  </span>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* ── Clinical Examination (general + per-system findings) ──
           Both fields are compacted on the assessment page so this just
           renders the resulting strings — keeps the printable dumb. */}
      {(receipt.generalExam || sysLines.length > 0) && (
        <div className="pr-section">
          <div className="pr-section__title">Clinical Examination</div>
          <div className="pr-section__body">
            {receipt.generalExam && (
              <div style={{ marginBottom: sysLines.length ? 4 : 0 }}>
                <strong>General:</strong> {receipt.generalExam}
              </div>
            )}
            {sysLines.length > 0 && (
              <div>
                <strong>Systemic:</strong>
                <ul style={{ margin: "2px 0 0 18px", padding: 0, fontSize: 11.5 }}>
                  {sysLines.map((line, i) => (
                    <li key={i} style={{ marginBottom: 1 }}>{line}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Assessment & Plan (SOAP A/P) ──
           Separate from the diagnosis card — these are the doctor's
           free-text clinical reasoning + management plan notes. */}
      {(receipt.assessmentNote || receipt.planNote) && (
        <div className="pr-section">
          <div className="pr-section__title">Assessment &amp; Plan</div>
          <div className="pr-section__body" style={{ whiteSpace: "pre-wrap" }}>
            {receipt.assessmentNote && (
              <div style={{ marginBottom: 4 }}>
                <strong>Assessment: </strong>{receipt.assessmentNote}
              </div>
            )}
            {receipt.planNote && (
              <div>
                <strong>Plan: </strong>{receipt.planNote}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Obstetric & Gynae History (only when populated) ──
           Doctor only fills this card for Gynae visits, so the section
           silently disappears on non-OBG prescriptions. */}
      {receipt.obgHistory && (
        <div className="pr-section">
          <div className="pr-section__title">Obstetric &amp; Gynae History</div>
          <div className="pr-section__body" style={{ whiteSpace: "pre-wrap" }}>
            {receipt.obgHistory}
          </div>
        </div>
      )}

      {/* ── Rx block (the actual prescription) ── */}
      <div className="pr-section" style={{ marginTop: 14 }}>
        <div className="pr-section__title" style={{
          display: "flex", alignItems: "center", gap: 8, fontSize: 13,
        }}>
          <span style={{
            background: "var(--pr-accent-color, #1d4ed8)", color: "white",
            width: 26, height: 26, borderRadius: 6,
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            fontSize: 16, fontWeight: 800, fontStyle: "italic",
          }}>R<small style={{ fontSize: 10, marginLeft: -3 }}>x</small></span>
          Prescription
        </div>
        {/* R7bf-F / A4-HIGH-3: explicit Meal Status column.
            Pre-R7bf the field was concatenated into Instructions
            ("After food · Route: Oral · ..."), making it easy for the
            patient to miss. Now each med shows its own pill-coloured
            Before food / After food / With food / Bedtime cell. */}
        <table className="pr-table" style={{ marginTop: 6 }}>
          <thead>
            <tr>
              <th style={{ width: 30 }}>#</th>
              <th>Medication</th>
              <th style={{ width: 90 }}>Dose / Form</th>
              <th className="center" style={{ width: 100 }}>Frequency</th>
              <th className="center" style={{ width: 90 }}>Meal Status</th>
              <th className="center" style={{ width: 80 }}>Duration</th>
              <th style={{ width: 160 }}>Instructions</th>
            </tr>
          </thead>
          <tbody>
            {drugs.length === 0 ? (
              <tr><td colSpan={7} className="muted center" style={{ padding: 20, fontStyle: "italic" }}>
                No medications prescribed.
              </td></tr>
            ) : drugs.map((d, i) => {
              const ms = d.mealStatus || d.meal || "";
              const msTone = /before/i.test(ms) ? { bg: "#fef3c7", fg: "#92400e" }
                : /after/i.test(ms)  ? { bg: "#dcfce7", fg: "#15803d" }
                : /with/i.test(ms)   ? { bg: "#dbeafe", fg: "#1d4ed8" }
                : /bed/i.test(ms)    ? { bg: "#ede9fe", fg: "#6d28d9" }
                : null;
              return (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td>
                    <div style={{ fontWeight: 700 }}>{d.name || d.drug || "—"}</div>
                    {d.generic && <div className="muted" style={{ fontSize: 10 }}>({d.generic})</div>}
                  </td>
                  <td>{d.dose || d.strength || "—"}</td>
                  <td className="center">{d.frequency || d.freq || "—"}</td>
                  <td className="center">
                    {ms ? (
                      <span style={{
                        background: msTone?.bg || "#f1f5f9",
                        color:      msTone?.fg || "#475569",
                        padding: "1px 7px", borderRadius: 8,
                        fontSize: 10, fontWeight: 700, letterSpacing: ".2px",
                      }}>{ms}</span>
                    ) : "—"}
                  </td>
                  <td className="center">{d.duration || "—"}</td>
                  <td>{d.instructions || d.notes || ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Investigations / labs ── */}
      {labs.length > 0 && (
        <div className="pr-section">
          <div className="pr-section__title">Investigations / Tests Advised</div>
          <ol style={{ margin: "4px 0 0 18px", padding: 0, fontSize: 11.5 }}>
            {labs.map((l, i) => (
              <li key={i} style={{ marginBottom: 2 }}>
                <strong>{l.name || l.test || l}</strong>
                {l.urgent && <span style={{ color: "#dc2626", fontWeight: 700, marginLeft: 6 }}>(URGENT)</span>}
                {l.notes && <span className="muted"> — {l.notes}</span>}
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* ── Procedures advised ──
           From either the standalone procedures card (with consent
           tracking) or PROCEDURE/SURGERY/PHYSIOTHERAPY services raised
           on the unified Services & Orders panel. */}
      {Array.isArray(receipt.procedures) && receipt.procedures.length > 0 && (
        <div className="pr-section">
          <div className="pr-section__title">Procedures Advised</div>
          <ol style={{ margin: "4px 0 0 18px", padding: 0, fontSize: 11.5 }}>
            {receipt.procedures.map((p, i) => (
              <li key={i} style={{ marginBottom: 2 }}>
                <strong>{p.name}</strong>
                {p.type && <span className="muted"> · {p.type}</span>}
                {p.duration && <span className="muted"> · {p.duration} min</span>}
                {p.consent && p.consent !== "NotRequired" && (
                  <span style={{
                    marginLeft: 6, fontSize: 9, fontWeight: 700,
                    padding: "1px 5px", borderRadius: 8,
                    background: p.consent === "Obtained" ? "#dcfce7" : "#fef3c7",
                    color:      p.consent === "Obtained" ? "#15803d" : "#a16207",
                  }}>
                    Consent: {p.consent}
                  </span>
                )}
                {p.notes && <span className="muted"> — {p.notes}</span>}
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* ── Services Billed (non-lab/non-procedure ServiceMaster rows) ──
           Renders consumables / packages / room / equipment lines so
           the patient sees on the slip exactly what the receptionist's
           DRAFT bill contains. */}
      {Array.isArray(receipt.otherServices) && receipt.otherServices.length > 0 && (
        <div className="pr-section">
          <div className="pr-section__title">Services Billed</div>
          <table className="pr-table" style={{ marginTop: 4 }}>
            <thead>
              <tr>
                <th style={{ width: 30 }}>#</th>
                <th>Service</th>
                <th style={{ width: 100 }}>Category</th>
                <th className="center" style={{ width: 50 }}>Qty</th>
                <th className="right" style={{ width: 80 }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {receipt.otherServices.map((s, i) => (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{s.name}</div>
                    {s.notes && <div className="muted" style={{ fontSize: 10 }}>{s.notes}</div>}
                  </td>
                  <td className="muted" style={{ fontSize: 10 }}>{s.category || "—"}</td>
                  <td className="center">{s.qty ?? 1}</td>
                  <td className="right">{s.total != null ? `₹${Number(s.total).toLocaleString("en-IN")}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Advice ── */}
      {advice.length > 0 && (
        <div className="pr-section">
          <div className="pr-section__title">General Advice</div>
          <ul style={{ margin: "4px 0 0 18px", padding: 0, fontSize: 11.5 }}>
            {advice.map((a, i) => <li key={i} style={{ marginBottom: 2 }}>{a}</li>)}
          </ul>
        </div>
      )}

      {/* ── Follow-up ── */}
      {(receipt.followUpDate || receipt.followUpNotes) && (
        <div className="pr-section">
          <div className="pr-section__title">Follow-up</div>
          <div className="pr-section__body">
            {receipt.followUpDate && (
              <div><strong>Next visit:</strong> {new Date(receipt.followUpDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", weekday: "long" })}</div>
            )}
            {receipt.followUpNotes && <div>{receipt.followUpNotes}</div>}
          </div>
        </div>
      )}
    </PrintShell>
  );
};

export default OPDPrescription;
