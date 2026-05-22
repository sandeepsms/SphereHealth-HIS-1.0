// Components/print/printables/CompleteIPDFile.jsx
// Complete IPD patient file — multi-section, multi-page A4 document.
//
// Sections (in order, each becomes a page break candidate):
//   1. Admission summary (demographics, diagnosis, consultant, bed)
//   2. Chief complaints + medical / surgical / family / social history
//   3. Vitals on admission + Initial Assessment
//   4. Investigations + reports
//   5. Treatment chart / Medication Administration Record (MAR)
//   6. Doctor's notes timeline
//   7. Nursing notes timeline
//   8. Procedure / OT notes
//   9. Consent forms (titles + signed status)
//  10. Discharge summary

import React from "react";
import PrintShell from "../PrintShell";
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

const KV = ({ label, value }) => value ? (
  <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: 4, fontSize: 11, padding: "2px 0" }}>
    <span style={{ color: "#64748b", fontWeight: 700 }}>{label}</span>
    <span style={{ color: "#0f172a" }}>{value}</span>
  </div>
) : null;

const CompleteIPDFile = ({ settings, receipt = {} }) => {
  const r = receipt;
  const investigations = Array.isArray(r.investigations) ? r.investigations : [];
  const medications    = Array.isArray(r.medications)    ? r.medications    : [];
  const doctorNotes    = Array.isArray(r.doctorNotes)    ? r.doctorNotes    : [];
  const nursingNotes   = Array.isArray(r.nursingNotes)   ? r.nursingNotes   : [];
  const procedures     = Array.isArray(r.procedures)     ? r.procedures     : [];
  const consents       = Array.isArray(r.consents)       ? r.consents       : [];
  const vitalsOnAdm    = r.vitalsOnAdmission || {};

  const printCount = toNum(r.printCount);

  return (
    <PrintShell
      settings={settings}
      documentTitle="Complete IPD File"
      serialNo={r.ipdNo}
      printCount={printCount}
      infoItems={[
        { label: "Patient",     value: r.patientName },
        { label: "UHID",        value: r.uhid },
        { label: "IPD No",      value: r.ipdNo },
        { label: "Age / Sex",   value: [r.age && `${r.age}Y`, r.gender].filter(Boolean).join(" / ") },
        { label: "Mobile",      value: r.mobile },
        { label: "Blood Group", value: r.bloodGroup },
        { label: "Admitted",    value: fmtDate(r.admissionDate, true) },
        { label: "Discharged",  value: fmtDate(r.dischargeDate, true) },
        { label: "Length of Stay", value: r.totalDays ? `${r.totalDays} day${r.totalDays === 1 ? "" : "s"}` : "—" },
        { label: "Consultant",  value: r.consultantName },
        { label: "Bed / Ward",  value: [r.bedNumber, r.wardName].filter(Boolean).join(" · ") },
        { label: "Final Dx",    value: r.finalDiagnosis },
      ]}
      signatureLabels={["Consultant", "Medical Records Officer"]}
    >
      {/* ── 1. Admission Summary ── */}
      <Section title="Admission Summary">
        <KV label="Type of admission"    value={r.admissionType} />
        <KV label="Mode of arrival"      value={r.modeOfArrival} />
        <KV label="Referring doctor"     value={r.referringDoctor} />
        <KV label="Provisional Dx"       value={r.provisionalDiagnosis} />
        <KV label="Working Dx"           value={r.workingDiagnosis} />
        <KV label="Final Dx"             value={r.finalDiagnosis} />
        <KV label="ICD-10"               value={r.icd10 ? `${r.icd10}${r.icd10Desc ? " — " + r.icd10Desc : ""}` : null} />
        <KV label="Allergies"            value={Array.isArray(r.allergies) ? r.allergies.join(", ") : r.allergies} />
        <KV label="Isolation flags"      value={Array.isArray(r.isolationFlags) ? r.isolationFlags.join(", ") : r.isolationFlags} />
      </Section>

      {/* ── 2. Complaints + History ── */}
      {(r.chiefComplaints || r.history || r.medicalHistory || r.surgicalHistory) && (
        <Section title="Chief Complaints & History">
          {r.chiefComplaints && (<><strong>Chief complaints:</strong>
            <div style={{ whiteSpace: "pre-wrap", margin: "2px 0 6px" }}>{r.chiefComplaints}</div></>)}
          {r.history && (<><strong>History of presenting illness:</strong>
            <div style={{ whiteSpace: "pre-wrap", margin: "2px 0 6px" }}>{r.history}</div></>)}
          {r.medicalHistory  && (<KV label="Past medical hx" value={r.medicalHistory} />)}
          {r.surgicalHistory && (<KV label="Past surgical hx" value={r.surgicalHistory} />)}
          {r.familyHistory   && (<KV label="Family history" value={r.familyHistory} />)}
          {r.socialHistory   && (<KV label="Social history" value={r.socialHistory} />)}
        </Section>
      )}

      {/* ── 3. Vitals on Admission ── */}
      {Object.keys(vitalsOnAdm).length > 0 && (
        <Section title="Vitals on Admission">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 6 }}>
            {[
              ["BP",     vitalsOnAdm.bp,     "mmHg"],
              ["Pulse",  vitalsOnAdm.pulse,  "bpm"],
              ["Temp",   vitalsOnAdm.temp,   "°F"],
              ["SpO₂",   vitalsOnAdm.spo2,   "%"],
              ["RR",     vitalsOnAdm.rr,     "/min"],
              ["Weight", vitalsOnAdm.weight, "kg"],
              ["Height", vitalsOnAdm.height, "cm"],
              ["BMI",    vitalsOnAdm.bmi,    null],
            ].filter(([, v]) => v != null && v !== "").map(([label, value, unit]) => (
              <div key={label} style={{
                background: "#f8fafc", border: "1px solid #e2e8f0",
                borderRadius: 6, padding: "5px 9px", fontSize: 10.5,
              }}>
                <div style={{ fontSize: 9, color: "#64748b", textTransform: "uppercase", fontWeight: 700 }}>
                  {label}
                </div>
                <div style={{ fontWeight: 800, color: "#0f172a" }}>
                  {value}{unit && <span style={{ fontSize: 9, color: "#64748b", fontWeight: 500 }}> {unit}</span>}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* ── 4. Investigations ── */}
      {investigations.length > 0 && (
        <Section title="Investigations & Reports">
          <table className="pr-table">
            <thead>
              <tr>
                <th>Test / Investigation</th>
                <th style={{ width: 90 }}>Ordered</th>
                <th style={{ width: 90 }}>Reported</th>
                <th>Result / Findings</th>
              </tr>
            </thead>
            <tbody>
              {investigations.map((inv, i) => (
                <tr key={i}>
                  <td><strong>{inv.name || inv.test}</strong></td>
                  <td>{fmtDate(inv.orderedAt)}</td>
                  <td>{fmtDate(inv.reportedAt)}</td>
                  <td style={{ whiteSpace: "pre-wrap" }}>{inv.result || inv.findings || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {/* R7bf-F / A4-HIGH-6: section order enforced —
            5. Doctor Orders / Notes (BEFORE nursing — clinical
               decision precedes execution)
            6. Nursing Notes
            7. MAR (medication chart — execution log)
            8. Procedures / OT
            9. Consents
           10. Discharge summary
          Pre-R7bf MAR came BEFORE doctor notes, putting execution
          ahead of the orders that drove it — confused medical
          records reviewers. */}

      {/* ── 5. Doctor's notes / orders timeline ── */}
      {doctorNotes.length > 0 && (
        <Section title="Doctor's Orders &amp; Notes Timeline">
          {doctorNotes.map((n, i) => (
            <div key={i} style={{
              borderLeft: "3px solid var(--pr-accent-color, #1d4ed8)",
              padding: "6px 10px",
              marginBottom: 6,
              background: "#f8fafc",
              borderRadius: "0 6px 6px 0",
              breakInside: "avoid",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#475569", fontWeight: 700 }}>
                <span>{n.noteType || "Note"} · {n.shift || ""}</span>
                <span>{fmtDate(n.createdAt || n.date, true)}</span>
              </div>
              <div style={{ fontSize: 11, color: "#0f172a", whiteSpace: "pre-wrap", marginTop: 3 }}>
                {n.content || n.text || n.note || ""}
              </div>
              {n.doctorName && <div style={{ fontSize: 10, color: "#64748b", marginTop: 3, fontStyle: "italic" }}>— {n.doctorName}</div>}
            </div>
          ))}
        </Section>
      )}

      {/* ── 6. Nursing notes timeline ── */}
      {nursingNotes.length > 0 && (
        <Section title="Nursing Notes Timeline">
          {nursingNotes.map((n, i) => (
            <div key={i} style={{
              borderLeft: "3px solid #db2777",
              padding: "6px 10px",
              marginBottom: 6,
              background: "#fdf2f8",
              borderRadius: "0 6px 6px 0",
              breakInside: "avoid",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#9d174d", fontWeight: 700 }}>
                <span>{n.noteType || "Care note"} · {n.shift || ""}</span>
                <span>{fmtDate(n.createdAt || n.date, true)}</span>
              </div>
              <div style={{ fontSize: 11, color: "#0f172a", whiteSpace: "pre-wrap", marginTop: 3 }}>
                {n.content || n.text || n.note || ""}
              </div>
              {n.nurseName && <div style={{ fontSize: 10, color: "#9d174d", marginTop: 3, fontStyle: "italic" }}>— {n.nurseName}</div>}
            </div>
          ))}
        </Section>
      )}

      {/* ── 7. MAR / Treatment Chart ── */}
      {medications.length > 0 && (
        <div className="pr-section pr-page-break">
          <div className="pr-section__title">Medication Administration Record (MAR)</div>
          <table className="pr-table">
            <thead>
              <tr>
                <th>Drug</th>
                <th style={{ width: 80 }}>Dose</th>
                <th style={{ width: 80 }}>Route</th>
                <th style={{ width: 80 }}>Frequency</th>
                <th style={{ width: 90 }}>Start</th>
                <th style={{ width: 90 }}>End</th>
                <th>Indication / Notes</th>
              </tr>
            </thead>
            <tbody>
              {medications.map((m, i) => (
                <tr key={i}>
                  <td><strong>{m.drug || m.name}</strong>{m.generic && <div className="muted" style={{ fontSize: 9.5 }}>({m.generic})</div>}</td>
                  <td>{m.dose || m.strength || "—"}</td>
                  <td>{m.route || "—"}</td>
                  <td>{m.frequency || m.freq || "—"}</td>
                  <td>{fmtDate(m.startDate)}</td>
                  <td>{fmtDate(m.endDate)}</td>
                  <td>{m.indication || m.notes || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── 8. Procedures ── */}
      {procedures.length > 0 && (
        <Section title="Procedures / OT Notes">
          {procedures.map((p, i) => (
            <div key={i} style={{ border: "1px solid #e2e8f0", borderRadius: 6, padding: 8, marginBottom: 6, breakInside: "avoid" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 800 }}>
                <span>{p.name || p.procedure}</span>
                <span style={{ fontSize: 10, color: "#64748b" }}>{fmtDate(p.date, true)}</span>
              </div>
              {p.surgeon  && <KV label="Surgeon" value={p.surgeon} />}
              {p.assistant && <KV label="Assistant" value={p.assistant} />}
              {p.anesthesia && <KV label="Anesthesia" value={p.anesthesia} />}
              {/* R7bf-F / A4-MED-6: scrub-tech + circulating-nurse anchors. */}
              {p.scrubTech && <KV label="Scrub Tech / Nurse" value={p.scrubTech} />}
              {p.circulatingNurse && <KV label="Circulating Nurse" value={p.circulatingNurse} />}
              {p.findings && <div style={{ marginTop: 3, fontSize: 11, whiteSpace: "pre-wrap" }}><strong>Findings: </strong>{p.findings}</div>}
              {p.notes    && <div style={{ marginTop: 3, fontSize: 11, whiteSpace: "pre-wrap" }}>{p.notes}</div>}
              {/* Signature blocks — always rendered so the OT team has a
                  physical sign-off space even when the procedure was
                  entered via the digital form without typed names. */}
              <div style={{
                display: "grid", gridTemplateColumns: "repeat(4, 1fr)",
                gap: 10, marginTop: 12, paddingTop: 8,
                borderTop: "1px dashed #cbd5e1",
              }}>
                {[
                  { lbl: "Surgeon",            v: p.surgeon },
                  { lbl: "Anesthetist",        v: p.anesthesia || p.anesthetist },
                  { lbl: "Scrub Tech / Nurse", v: p.scrubTech },
                  { lbl: "Circulating Nurse",  v: p.circulatingNurse },
                ].map((s, si) => (
                  <div key={si} style={{ fontSize: 10, textAlign: "center" }}>
                    <div style={{ height: 24, borderBottom: "1px solid #94a3b8" }} />
                    <div style={{ marginTop: 3, color: "#475569", fontWeight: 700 }}>
                      {s.lbl}
                    </div>
                    {s.v && <div style={{ color: "#0f172a", fontSize: 9.5 }}>{s.v}</div>}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </Section>
      )}

      {/* ── 9. Consents ── */}
      {consents.length > 0 && (
        <Section title="Consent Forms">
          <table className="pr-table">
            <thead>
              <tr>
                <th>Form</th>
                <th>Signed</th>
                <th>By</th>
                <th>Witness</th>
              </tr>
            </thead>
            <tbody>
              {consents.map((c, i) => (
                <tr key={i}>
                  <td><strong>{c.name || c.formName}</strong></td>
                  <td>{c.signed ? fmtDate(c.signedAt, true) : <em>Not signed</em>}</td>
                  <td>{c.signedBy || "—"}</td>
                  <td>{c.witness || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {/* ── 10. Discharge summary ── */}
      {r.dischargeSummary && (
        <Section title="Discharge Summary">
          <div style={{ whiteSpace: "pre-wrap", fontSize: 11.5, padding: 8, background: "#f8fafc", borderRadius: 6, border: "1px solid #e2e8f0" }}>
            {r.dischargeSummary}
          </div>
          {r.dischargeAdvice && (
            <div style={{ marginTop: 8 }}>
              <strong style={{ fontSize: 11, color: "var(--pr-accent-color, #1d4ed8)" }}>Discharge advice:</strong>
              <div style={{ whiteSpace: "pre-wrap", marginTop: 3 }}>{r.dischargeAdvice}</div>
            </div>
          )}
          {r.followUpDate && (
            <div style={{ marginTop: 6, fontSize: 11 }}>
              <strong>Follow-up:</strong> {fmtDate(r.followUpDate)}
            </div>
          )}
        </Section>
      )}
    </PrintShell>
  );
};

export default CompleteIPDFile;
