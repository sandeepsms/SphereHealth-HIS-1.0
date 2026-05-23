// Components/print/printables/DischargeSummary.jsx
// Standalone discharge summary — what goes home with the patient.
// Different from Complete IPD File: this is a curated, patient-facing
// document with diagnosis, course of stay, discharge medications,
// advice, and follow-up. NABH COP.6 compliant.

import React from "react";
import PrintShell from "../PrintShell";
import { fmtINR } from "../amountWords";
import { toNum } from "../../../utils/printUtils";

const fmtDate = (d, withTime = false) => {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString("en-IN", withTime
      ? { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }
      : { day: "2-digit", month: "short", year: "numeric" });
  } catch { return String(d); }
};

const Section = ({ title, children }) => (
  <div className="pr-section">
    <div className="pr-section__title">{title}</div>
    <div className="pr-section__body">{children}</div>
  </div>
);

const DischargeSummary = ({ settings, receipt = {} }) => {
  const r = receipt;
  const meds = Array.isArray(r.dischargeMeds) ? r.dischargeMeds : [];
  const advice = Array.isArray(r.advice)
    ? r.advice
    : (r.advice ? String(r.advice).split("\n").filter(Boolean) : []);
  // R7bf-F / A4-HIGH-1: total / cost fields are sometimes attached to
  // the summary payload (when the discharge endpoint inlines the final
  // bill snapshot). Pre-R7bf they were rendered as the raw mongoose
  // Decimal128 wire shape `{$numberDecimal:"4500.00"}` because the
  // template used `${r.totalAmount}` directly. toNum() guarantees a
  // proper Number even if the controller skipped its toJSON transform.
  const totalBill = toNum(r.totalAmount ?? r.totalBill ?? r.finalBillAmount);
  const printCount = toNum(r.printCount);

  // R7bh-F5 / R7bg-8-CRIT-P3 (MCI Regulation 1.4.2): discharge summary must
  // carry the attending consultant's NMC/DMC registration number + council
  // name. Multiple historical payload shapes supported.
  const consultDmc =
    r.consultant?.dmcNumber ||
    r.consultant?.registrationNumber ||
    r.consultantDmc ||
    r.consultantReg ||
    "—";
  const consultCouncil = r.consultant?.councilName || r.consultantCouncil || "Medical Council";
  const consultRegLine = consultDmc === "—" ? "—" : `${consultDmc} · ${consultCouncil}`;

  return (
    <PrintShell
      settings={settings}
      documentTitle="Discharge Summary"
      serialNo={r.summaryNo || r.ipdNo}
      printCount={printCount}
      infoItems={[
        { label: "Patient",    value: r.patientName },
        { label: "UHID",       value: r.uhid },
        { label: "IPD No",     value: r.ipdNo },
        { label: "Age / Sex",  value: [r.age && `${r.age}Y`, r.gender].filter(Boolean).join(" / ") },
        { label: "Admitted",   value: fmtDate(r.admissionDate, true) },
        { label: "Discharged", value: fmtDate(r.dischargeDate, true) },
        { label: "Length of Stay", value: r.totalDays ? `${r.totalDays} day${r.totalDays === 1 ? "" : "s"}` : "—" },
        { label: "Consultant", value: r.consultantName },
        { label: "Reg. No",    value: consultRegLine },
        { label: "Bed / Ward", value: [r.bedNumber, r.wardName].filter(Boolean).join(" · ") },
        { label: "Discharge Type", value: r.dischargeType || "Normal" },
      ]}
      signatureLabels={["Consultant", "Patient / Attendant"]}
    >
      <Section title="Final Diagnosis">
        <div style={{ fontSize: 13, fontWeight: 800, color: "#0f172a" }}>
          {r.finalDiagnosis || "—"}
        </div>
        {r.icd10 && (
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 3 }}>
            ICD-10: <strong style={{ color: "#0f172a" }}>{r.icd10}</strong>
            {r.icd10Desc && <> — {r.icd10Desc}</>}
          </div>
        )}
        {r.secondaryDiagnoses && (
          <div style={{ marginTop: 6 }}>
            <strong>Co-morbidities / Secondary:</strong>
            <div style={{ whiteSpace: "pre-wrap", marginTop: 2 }}>{r.secondaryDiagnoses}</div>
          </div>
        )}
      </Section>

      {r.chiefComplaints && (
        <Section title="Reason for Admission">
          <div style={{ whiteSpace: "pre-wrap" }}>{r.chiefComplaints}</div>
        </Section>
      )}

      {r.courseOfStay && (
        <Section title="Course in Hospital">
          <div style={{ whiteSpace: "pre-wrap" }}>{r.courseOfStay}</div>
        </Section>
      )}

      {r.proceduresDone && (
        <Section title="Procedures Performed">
          {Array.isArray(r.proceduresDone) ? (
            <ol style={{ margin: "2px 0 0 18px", padding: 0 }}>
              {r.proceduresDone.map((p, i) => (
                <li key={i} style={{ marginBottom: 3 }}>
                  <strong>{p.name || p}</strong>
                  {p.date && <span className="muted"> · {fmtDate(p.date)}</span>}
                  {p.surgeon && <span className="muted"> · {p.surgeon}</span>}
                </li>
              ))}
            </ol>
          ) : (
            <div style={{ whiteSpace: "pre-wrap" }}>{r.proceduresDone}</div>
          )}
        </Section>
      )}

      {r.investigationsSummary && (
        <Section title="Key Investigations">
          <div style={{ whiteSpace: "pre-wrap" }}>{r.investigationsSummary}</div>
        </Section>
      )}

      {r.conditionOnDischarge && (
        <Section title="Condition on Discharge">
          <div style={{ display: "inline-block", padding: "4px 12px", borderRadius: 999,
            background: r.conditionOnDischarge === "Critical" ? "#fee2e2"
              : r.conditionOnDischarge === "LAMA" ? "#fef3c7"
              : "#dcfce7",
            color: r.conditionOnDischarge === "Critical" ? "#991b1b"
              : r.conditionOnDischarge === "LAMA" ? "#92400e"
              : "#15803d",
            fontWeight: 800, fontSize: 12, letterSpacing: ".3px",
          }}>
            {r.conditionOnDischarge}
          </div>
          {r.dischargeNotes && (
            <div style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>{r.dischargeNotes}</div>
          )}
        </Section>
      )}

      {meds.length > 0 && (
        <Section title="Discharge Medications">
          <table className="pr-table">
            <thead>
              <tr>
                <th style={{ width: 30 }}>#</th>
                <th>Drug</th>
                <th style={{ width: 90 }}>Dose</th>
                <th style={{ width: 110 }}>Frequency</th>
                <th style={{ width: 90 }}>Duration</th>
                <th>Instructions</th>
              </tr>
            </thead>
            <tbody>
              {meds.map((m, i) => (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td><strong>{m.name || m.drug}</strong>
                    {m.generic && <div className="muted" style={{ fontSize: 9.5 }}>({m.generic})</div>}
                  </td>
                  <td>{m.dose || m.strength || "—"}</td>
                  <td>{m.frequency || m.freq || "—"}</td>
                  <td>{m.duration || "—"}</td>
                  <td>{m.instructions || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {advice.length > 0 && (
        <Section title="Discharge Advice">
          <ol style={{ margin: "2px 0 0 18px", padding: 0 }}>
            {advice.map((a, i) => <li key={i} style={{ marginBottom: 3 }}>{a}</li>)}
          </ol>
        </Section>
      )}

      {r.dietAdvice && (
        <Section title="Dietary Advice">
          <div style={{ whiteSpace: "pre-wrap" }}>{r.dietAdvice}</div>
        </Section>
      )}

      {/* R7bf-F / A4-HIGH-1: when a final-bill snapshot is inlined on
          the summary payload, render it as a proper money string —
          never the raw {$numberDecimal:"..."} object. */}
      {totalBill > 0 && (
        <Section title="Financial Summary">
          <div style={{ display: "flex", justifyContent: "space-between", maxWidth: 360, fontWeight: 800, fontSize: 12 }}>
            <span>Total Bill (Final)</span>
            <span>{fmtINR(totalBill)}</span>
          </div>
        </Section>
      )}

      {(r.followUpDate || r.followUpDoctor) && (
        <Section title="Follow-up">
          {r.followUpDate && (
            <div><strong>Next visit:</strong> {fmtDate(r.followUpDate)}
              <span className="muted"> ({new Date(r.followUpDate).toLocaleDateString("en-IN", { weekday: "long" })})</span>
            </div>
          )}
          {r.followUpDoctor && <div><strong>With:</strong> {r.followUpDoctor}</div>}
          {r.followUpNotes && <div style={{ marginTop: 3 }}>{r.followUpNotes}</div>}
        </Section>
      )}

      <Section title="Warning Signs · Return Immediately If">
        <div style={{ fontSize: 11, color: "#7f1d1d", background: "#fee2e2",
          border: "1px solid #fca5a5", borderRadius: 6, padding: "8px 12px" }}>
          {r.warningSigns || (
            <ul style={{ margin: 0, paddingLeft: 16 }}>
              <li>High fever (&gt; 101°F) not responding to medication</li>
              <li>Severe pain, vomiting, or bleeding</li>
              <li>Breathlessness or chest pain</li>
              <li>Altered consciousness or confusion</li>
              <li>Any new symptom you are unsure about</li>
            </ul>
          )}
        </div>
      </Section>
    </PrintShell>
  );
};

export default DischargeSummary;
