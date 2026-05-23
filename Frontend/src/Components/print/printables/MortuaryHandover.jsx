// Components/print/printables/MortuaryHandover.jsx
// Mortuary body-handover release form — legally critical. Issued
// when the body of a deceased patient is released from the
// mortuary to the next-of-kin / funeral service.
//
// Requirements:
//   - Two-witness signatures (mandatory)
//   - Police NOC field for medico-legal (MLC) cases
//   - Receiver ID-proof block
//   - Time of death + declared-by doctor (with sign)
//   - Body release time + vehicle / hearse details

import React from "react";
import PrintShell from "../PrintShell";
import { toNum } from "../../../utils/printUtils";

const fmtDateTime = (d) => d ? new Date(d).toLocaleString("en-IN", {
  day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
}) : "—";

const MortuaryHandover = ({ settings, receipt = {} }) => {
  const r = receipt;
  const isMlc = !!r.mlc;

  return (
    <PrintShell
      settings={settings}
      documentTitle="Mortuary — Body Handover &amp; Release Form"
      serialNo={r.deathRecordNo || r.handoverNo}
      printCount={toNum(r.printCount)}
      watermarkLabel="MORTUARY RELEASE — TWO-WITNESS"
      infoItems={[
        { label: "Death Record #", value: r.deathRecordNo },
        { label: "UHID",           value: r.uhid },
        { label: "Deceased",       value: r.patientName },
        { label: "Age / Sex",      value: [r.age && `${r.age}Y`, r.gender].filter(Boolean).join(" / ") },
        { label: "Time of Death",  value: fmtDateTime(r.timeOfDeath) },
        { label: "Release Time",   value: fmtDateTime(r.releasedAt) },
      ]}
      signatureLabels={["Witness 1", "Witness 2"]}
    >
      {/* MLC banner */}
      {isMlc && (
        <div style={{
          background: "linear-gradient(135deg, #fef3c7, #fde68a)",
          border: "2px solid #d97706",
          borderRadius: 8, padding: "10px 14px", marginBottom: 12,
        }}>
          <div style={{ fontSize: 11, color: "#78350f", textTransform: "uppercase", letterSpacing: ".5px", fontWeight: 800 }}>
            ⚠ Medico-Legal Case (MLC)
          </div>
          <div style={{ marginTop: 4, fontSize: 11.5, color: "#78350f" }}>
            <strong>Police NOC #:</strong> <span style={{ fontFamily: "'DM Mono', monospace" }}>{r.policeNocNo || "PENDING — RELEASE BLOCKED"}</span>
            {r.policeStation && <> · <strong>Station:</strong> {r.policeStation}</>}
            {r.policeFirNo && <> · <strong>FIR #:</strong> <span style={{ fontFamily: "'DM Mono', monospace" }}>{r.policeFirNo}</span></>}
          </div>
        </div>
      )}

      {/* Deceased details */}
      <div className="pr-section">
        <div className="pr-section__title">Deceased Particulars</div>
        <table className="pr-table" style={{ fontSize: 11 }}>
          <tbody>
            <tr>
              <td style={{ width: "20%", fontWeight: 700 }}>Name</td>
              <td>{r.patientName || "—"}</td>
              <td style={{ width: "15%", fontWeight: 700 }}>UHID</td>
              <td>{r.uhid || "—"}</td>
            </tr>
            <tr>
              <td style={{ fontWeight: 700 }}>Age / Sex</td>
              <td>{[r.age && `${r.age}Y`, r.gender].filter(Boolean).join(" / ") || "—"}</td>
              <td style={{ fontWeight: 700 }}>Religion</td>
              <td>{r.religion || "—"}</td>
            </tr>
            <tr>
              <td style={{ fontWeight: 700 }}>IPD #</td>
              <td>{r.ipdNo || "—"}</td>
              <td style={{ fontWeight: 700 }}>Ward / Bed</td>
              <td>{[r.bedNumber, r.wardName].filter(Boolean).join(" · ") || "—"}</td>
            </tr>
            <tr>
              <td style={{ fontWeight: 700 }}>Cause of Death</td>
              <td colSpan={3}>{r.causeOfDeath || "—"}</td>
            </tr>
            <tr>
              <td style={{ fontWeight: 700 }}>Death Certificate #</td>
              <td>{r.deathCertNo || "—"}</td>
              <td style={{ fontWeight: 700 }}>Mortuary Locker</td>
              <td>{r.mortuaryLocker || "—"}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Declaring doctor */}
      <div className="pr-section">
        <div className="pr-section__title">Declaration of Death</div>
        <div className="pr-section__body" style={{ fontSize: 11.5 }}>
          <div><strong>Declared by Doctor:</strong> {r.declaredByDoctor || "—"}</div>
          <div><strong>Reg. No:</strong> <span style={{ fontFamily: "'DM Mono', monospace" }}>{r.declaredByDoctorRegNo || "—"}</span></div>
          <div><strong>Declared At:</strong> {fmtDateTime(r.declaredAt || r.timeOfDeath)}</div>
          <div style={{ marginTop: 8, borderTop: "1px dotted #cbd5e1", paddingTop: 6 }}>
            Doctor&apos;s Signature: __________________________ Stamp:
          </div>
        </div>
      </div>

      {/* Body handover */}
      <div className="pr-section">
        <div className="pr-section__title">Body Handover</div>
        <table className="pr-table" style={{ fontSize: 11 }}>
          <tbody>
            <tr>
              <td style={{ width: "30%", fontWeight: 700 }}>Receiver Name</td>
              <td>{r.receiverName || "—"}</td>
            </tr>
            <tr>
              <td style={{ fontWeight: 700 }}>Relationship</td>
              <td>{r.receiverRelation || "—"}</td>
            </tr>
            <tr>
              <td style={{ fontWeight: 700 }}>ID Proof</td>
              <td>{r.receiverIdType ? `${r.receiverIdType}: ${r.receiverIdNumber || "—"}` : (r.receiverIdNumber || "—")}</td>
            </tr>
            <tr>
              <td style={{ fontWeight: 700 }}>Address</td>
              <td>{r.receiverAddress || "—"}</td>
            </tr>
            <tr>
              <td style={{ fontWeight: 700 }}>Contact</td>
              <td>{r.receiverContact || "—"}</td>
            </tr>
            <tr>
              <td style={{ fontWeight: 700 }}>Vehicle / Hearse</td>
              <td>{[r.vehicleType, r.vehicleNumber].filter(Boolean).join(" · ") || "—"}</td>
            </tr>
            <tr>
              <td style={{ fontWeight: 700 }}>Driver Name + Contact</td>
              <td>{[r.driverName, r.driverContact].filter(Boolean).join(" · ") || "—"}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Receiver acknowledgement */}
      <div className="pr-section">
        <div className="pr-section__title">Receiver Acknowledgement</div>
        <div className="pr-section__body" style={{ fontSize: 11, lineHeight: 1.6 }}>
          I, <strong>{r.receiverName || "________________________"}</strong>, son/daughter/spouse of
          the deceased noted above, hereby acknowledge receipt of the mortal remains
          {isMlc ? " after due production of the Police NOC referenced overhead. " : ". "}
          I have inspected the body and personal effects, found them to be in order
          and assume full responsibility for the further conveyance and last rites.
          <div style={{ marginTop: 14, borderTop: "1px dotted #cbd5e1", paddingTop: 6 }}>
            Receiver&apos;s Signature: __________________________ &nbsp;&nbsp; Date / Time: {fmtDateTime(r.releasedAt) || "_______________"}
          </div>
        </div>
      </div>

      {/* Personal effects */}
      {Array.isArray(r.personalEffects) && r.personalEffects.length > 0 && (
        <div className="pr-section">
          <div className="pr-section__title">Personal Effects Handed Over</div>
          <ol style={{ margin: "4px 0 0 18px", padding: 0, fontSize: 11 }}>
            {r.personalEffects.map((it, i) => (
              <li key={i}>{typeof it === "string" ? it : (it.item || it.description || "—")}
                {typeof it === "object" && it.qty && <> · Qty: {it.qty}</>}
              </li>
            ))}
          </ol>
        </div>
      )}

      <div style={{
        marginTop: 8, padding: "10px 12px",
        background: "#fef2f2", border: "1.5px solid #fca5a5",
        borderRadius: 8, fontSize: 10.5, color: "#7f1d1d",
      }}>
        <strong>LEGAL NOTICE:</strong> Body release requires two witness signatures
        and, for medico-legal cases, written police NOC. This form is the
        permanent release record and must be preserved in the mortuary register
        for not less than 10 years. Tampering is a punishable offence under
        Indian law.
      </div>
    </PrintShell>
  );
};

export default MortuaryHandover;
