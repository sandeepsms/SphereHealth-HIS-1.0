// Components/print/printables/OPDPrescription.jsx
// OPD doctor's prescription pad — vitals, chief complaints, diagnosis,
// the Rx drug list with frequency / duration / instructions, plus
// advice / lab orders / follow-up. A4 portrait by default.

import React from "react";
import { QRCodeSVG } from "qrcode.react";
import PrintShell from "../PrintShell";

const VitalCell = ({ label, value, unit }) => (
  <div style={{
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    borderRadius: 6,
    padding: "6px 10px",
    fontSize: 10.5,
    flex: 1,
    minWidth: 90,
  }}>
    <div style={{ fontSize: 9.5, color: "#64748b", textTransform: "uppercase", fontWeight: 700, letterSpacing: ".5px" }}>
      {label}
    </div>
    <div style={{ fontWeight: 800, color: "#0f172a" }}>
      {value || "—"}{value && unit ? <span style={{ fontSize: 9.5, color: "#64748b", fontWeight: 500 }}> {unit}</span> : null}
    </div>
  </div>
);

/* OPD-PRINT-AUDIT Item 19: bordered diagnosis tier pill.
   Color + 1px border + uppercase short label so the tier remains
   distinguishable on B/W photocopy. */
const DX_TIER_TONE = {
  Provisional: { bg: "#fef3c7", fg: "#92400e", border: "#b45309", short: "PROV"  },
  Working:     { bg: "#dbeafe", fg: "#1e40af", border: "#1d4ed8", short: "WORK"  },
  Final:       { bg: "#dcfce7", fg: "#14532d", border: "#15803d", short: "FINAL" },
};
const DxTier = ({ tier, text }) => {
  const t = DX_TIER_TONE[tier] || DX_TIER_TONE.Provisional;
  return (
    <div style={{ marginBottom: 4, display: "flex", alignItems: "flex-start", gap: 8 }}>
      <span style={{
        display: "inline-block",
        background: t.bg, color: t.fg,
        border: `1px solid ${t.border}`,
        padding: "1px 8px", borderRadius: 4,
        fontSize: 9.5, fontWeight: 800,
        textTransform: "uppercase", letterSpacing: ".4px",
        minWidth: 52, textAlign: "center",
        flexShrink: 0,
      }}>{t.short}</span>
      <span style={{ fontSize: 10.5, color: "#0f172a" }}>{text}</span>
    </div>
  );
};

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
  // OPD-PRINT-AUDIT Item 8: drop placeholder/dashes rows. A "real" drug
  // has a non-empty name (or medicineName/drug field).
  const drugsRaw = Array.isArray(receipt.drugs) ? receipt.drugs : [];
  const drugs = drugsRaw.filter(d =>
    String(d.name || d.medicineName || d.drug || "").trim() !== ""
  );
  const labs   = Array.isArray(receipt.investigations) ? receipt.investigations : [];
  const advice = Array.isArray(receipt.advice)
    ? receipt.advice
    : (receipt.advice ? String(receipt.advice).split("\n").filter(Boolean) : []);

  // OPD-PRINT-AUDIT Item 1 (NABH): allergy state. Defaults to NKDA when
  // both fields are blank — per NABH "absent allergy" must still be
  // explicitly declared on the prescription.
  const allergiesText = String(receipt.allergies || "").trim();
  const isNKDA = receipt.allergiesIsNKDA === true || (allergiesText === "" && !receipt.allergiesIsNKDA);

  // OPD-PRINT-AUDIT Item 20: deep-link QR for verification.
  const verifyId =
    receipt.visit?._id || receipt.visit_id || receipt.visitId ||
    receipt._id || receipt.opdId || receipt.rxNo || receipt.visitNo || "unknown";
  const verifyBase = (settings.website || settings.verifyBaseUrl || "").replace(/\/+$/, "");
  const verifyUrl = `${verifyBase || "https://spherehealth.local"}/verify/opd/${verifyId}`;

  // System-exam lines are pre-joined by "\n" in the payload — split so we
  // can render each system on its own row (CVS:, RS:, CNS:, P/A:).
  const sysLines = (receipt.systemicExam || "")
    .split("\n")
    .map(s => s.trim())
    .filter(Boolean);

  // R7bh-F5 / R7bg-8-CRIT-P3 (MCI Regulation 1.4.2): every prescription must
  // carry the prescribing doctor's NMC/DMC registration number + council name.
  // Resolve from multiple historical payload shapes:
  //   - new structured shape: receipt.doctor.{dmcNumber|registrationNumber, councilName}
  //   - legacy flat: receipt.doctorReg
  const docDmc =
    receipt.doctor?.dmcNumber ||
    receipt.doctor?.registrationNumber ||
    receipt.doctorReg ||
    "—";
  const docCouncil = receipt.doctor?.councilName || receipt.councilName || "Medical Council";
  const regLine = docDmc === "—" ? "—" : `${docDmc} · ${docCouncil}`;

  // R7bh-F5 / META-1: printCount drives PrintShell's DUPLICATE watermark.
  // Fallback chain mirrors money.toNum shape.
  const printCount = Number(
    (receipt.printCount && (receipt.printCount.$numberDecimal ?? receipt.printCount)) || 0
  ) || 0;

  // R7eo-A — Pattern A fix: hardcoded "OPD Prescription · Rx" was
  // misleading on Emergency / Daycare / IPD visits which reuse this
  // template. Derive from receipt.visitType so the document title
  // reflects the actual setting. Legacy OPD callers (no visitType)
  // keep the original label.
  const visitTypeRaw = receipt.visitType ? String(receipt.visitType).toUpperCase() : "";
  const docTitle =
      visitTypeRaw === "IPD"        ? "IPD Prescription · Rx"
    : visitTypeRaw === "EMERGENCY"  ? "Emergency Prescription · Rx"
    : visitTypeRaw === "ER"         ? "Emergency Prescription · Rx"
    : visitTypeRaw === "DAYCARE"    ? "Daycare Prescription · Rx"
    : visitTypeRaw === "DAY CARE"   ? "Daycare Prescription · Rx"
                                    : "OPD Prescription · Rx";

  return (
    <PrintShell
      settings={settings}
      documentTitle={docTitle}
      serialNo={receipt.rxNo || receipt.visitNo}
      printCount={printCount}
      /* OPD-PRINT-AUDIT Item 6: a prescription is not a bill — hide the
         shared bank-details footer + commercial terms strip. */
      showBank={false}
      showTerms={false}
      /* OPD-PRINT-AUDIT Item 2 + 12: e-signed Rx — pass signature image
         + signedAt for the doctor's block in the footer. */
      signatureImage={receipt.signatureImage || receipt.doctor?.signatureImage}
      signedAt={receipt.signedAt || receipt.doctor?.signedAt}
      infoItems={[
        { label: "Patient",    value: receipt.patientName },
        { label: "UHID",       value: receipt.uhid },
        { label: "Age / Sex",  value: [receipt.age && `${receipt.age}Y`, receipt.gender].filter(Boolean).join(" / ") },
        { label: "Mobile",     value: receipt.mobile },
        { label: "Doctor",     value: receipt.doctorName },
        { label: "Reg. No",    value: regLine },
        { label: "Department", value: receipt.department },
        { label: "Visit Date", value: receipt.visitDate
            ? new Date(receipt.visitDate).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
            : new Date().toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) },
      ]}
      /* OPD-PRINT-AUDIT Item 20: verification QR top-right of patient strip. */
      headerExtra={
        <div style={{ textAlign: "center" }}>
          <QRCodeSVG value={verifyUrl} size={64} level="M" includeMargin={false} />
          <div style={{ fontSize: 9.5, color: "#64748b", marginTop: 2, fontWeight: 600, letterSpacing: ".3px" }}>
            VERIFY
          </div>
        </div>
      }
      signatureLabels={["Doctor's Signature & Stamp", "Patient / Attendant"]}
    >
      {/* ── Allergies banner (NABH-mandated) ──
           OPD-PRINT-AUDIT Item 1: every prescription must state the
           patient's drug-allergy status. Red banner when allergies are
           recorded; green NKDA pill when not. NKDA defaults on when
           both fields are blank — "unknown" is unsafe to print. */}
      {allergiesText && !isNKDA ? (
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          background: "#fee2e2", border: "1.5px solid #dc2626",
          borderLeft: "5px solid #b91c1c",
          padding: "8px 12px", borderRadius: 6,
          marginBottom: 12,
          color: "#7f1d1d",
        }}>
          <span style={{ fontSize: 16, lineHeight: 1 }}>⚠</span>
          <div>
            <div style={{
              fontSize: 9.5, fontWeight: 800,
              textTransform: "uppercase", letterSpacing: ".5px",
              color: "#7f1d1d",
            }}>
              Allergies
            </div>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: "#7f1d1d" }}>
              {allergiesText}
            </div>
          </div>
        </div>
      ) : (
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          background: "#dcfce7", border: "1px solid #15803d",
          padding: "3px 10px", borderRadius: 999,
          marginBottom: 12,
          fontSize: 9.5, fontWeight: 800,
          color: "#14532d", textTransform: "uppercase", letterSpacing: ".4px",
        }}>
          <span style={{ fontSize: 11 }}>✓</span> NKDA — No Known Drug Allergies
        </div>
      )}

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
            {/* OPD-PRINT-AUDIT Item 19: bordered tier pills — color + 1px
                border + uppercase short label so the tier is legible on
                B/W photocopy. */}
            {receipt.provisionalDx && <DxTier tier="Provisional" text={receipt.provisionalDx} />}
            {receipt.workingDx     && <DxTier tier="Working"     text={receipt.workingDx}     />}
            {receipt.diagnosis     && <DxTier tier="Final"       text={receipt.diagnosis}     />}
            {receipt.icd10 && (
              <div style={{ fontSize: 10.5, color: "#64748b", marginTop: 4 }}>
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
                    fontSize: 9.5, fontWeight: 800,
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
                <ul style={{ margin: "2px 0 0 18px", padding: 0, fontSize: 10.5 }}>
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

      {/* ── Rx block (the actual prescription) ──
           OPD-PRINT-AUDIT Item 8: section ENTIRELY hidden when no real
           drugs were prescribed (zero rows after placeholder filter).
           No "No medications" fallback — silence is more honest than a
           row of dashes for a follow-up / advice-only consult.
           Item 25 page-break: `.pr-section--allow-break` lets a 20-drug
           list flow across pages instead of orphaning the first one. */}
      {drugs.length > 0 && (
        <div className="pr-section pr-section--allow-break" style={{ marginTop: 14 }}>
          <div className="pr-section__title" style={{
            display: "flex", alignItems: "center", gap: 8, fontSize: 10.5,
          }}>
            <span style={{
              background: "var(--pr-accent-color, #1d4ed8)", color: "white",
              width: 26, height: 26, borderRadius: 6,
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              fontSize: 16, fontWeight: 800, fontStyle: "italic",
            }}>R<small style={{ fontSize: 9.5, marginLeft: -3 }}>x</small></span>
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
              {drugs.map((d, i) => {
                const ms = d.mealStatus || d.meal || "";
                const msTone = /before/i.test(ms) ? { bg: "#fef3c7", fg: "#92400e" }
                  : /after/i.test(ms)  ? { bg: "#dcfce7", fg: "#15803d" }
                  : /with/i.test(ms)   ? { bg: "#dbeafe", fg: "#1d4ed8" }
                  : /bed/i.test(ms)    ? { bg: "#ede9fe", fg: "#6d28d9" }
                  : null;
                /* OPD-PRINT-AUDIT Item 22: HAM (Hospital Acquired
                   Medication / High-Alert Med) chip in the drug name
                   cell — visible cue for the dispensing pharmacist. */
                const isHam = d.isHam === true || d.hamFlag === true;
                return (
                  <tr key={i}>
                    <td>{i + 1}</td>
                    <td>
                      <div style={{ fontWeight: 700, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <span>{d.name || d.medicineName || d.drug || "—"}</span>
                        {isHam && (
                          <span style={{
                            display: "inline-flex", alignItems: "center", gap: 3,
                            background: "#fee2e2", color: "#991b1b",
                            border: "1px solid #dc2626",
                            padding: "0 6px", borderRadius: 8,
                            fontSize: 9.5, fontWeight: 800, letterSpacing: ".4px",
                          }}>
                            <span style={{ fontSize: 8 }}>●</span> HAM
                          </span>
                        )}
                      </div>
                      {d.generic && <div className="muted" style={{ fontSize: 9.5 }}>({d.generic})</div>}
                    </td>
                    <td>{d.dose || d.strength || "—"}</td>
                    <td className="center">{d.frequency || d.freq || "—"}</td>
                    <td className="center">
                      {ms ? (
                        <span style={{
                          background: msTone?.bg || "#f1f5f9",
                          color:      msTone?.fg || "#475569",
                          padding: "1px 7px", borderRadius: 8,
                          fontSize: 9.5, fontWeight: 700, letterSpacing: ".2px",
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
      )}

      {/* ── Investigations / labs ── */}
      {labs.length > 0 && (
        <div className="pr-section">
          <div className="pr-section__title">Investigations / Tests Advised</div>
          <ol style={{ margin: "4px 0 0 18px", padding: 0, fontSize: 10.5 }}>
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
          <ol style={{ margin: "4px 0 0 18px", padding: 0, fontSize: 10.5 }}>
            {receipt.procedures.map((p, i) => (
              <li key={i} style={{ marginBottom: 2 }}>
                <strong>{p.name}</strong>
                {p.type && <span className="muted"> · {p.type}</span>}
                {p.duration && <span className="muted"> · {p.duration} min</span>}
                {p.consent && p.consent !== "NotRequired" && (
                  <span style={{
                    marginLeft: 6, fontSize: 9.5, fontWeight: 700,
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
                    {s.notes && <div className="muted" style={{ fontSize: 9.5 }}>{s.notes}</div>}
                  </td>
                  <td className="muted" style={{ fontSize: 9.5 }}>{s.category || "—"}</td>
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
          <ul style={{ margin: "4px 0 0 18px", padding: 0, fontSize: 10.5 }}>
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
