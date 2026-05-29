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
  // R7eo-D — Pattern D regulatory fix (CrPC §174): treat the explicit
  // isMlc flag as authoritative when set; otherwise fall back to the
  // older r.mlc shape for backward compatibility.
  const isMlc = r.isMlc === true || (!!r.mlc && r.isMlc !== false);
  // R7eo-D — Pattern D regulatory fix (CrPC §174): MLC release without
  // a written police NOC is illegal. Block the acknowledgement section.
  const mlcReleaseBlocked = isMlc && !r.policeNocNo;

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
        // R7eo-D — suppress release time on the header when MLC release is blocked
        ...(mlcReleaseBlocked ? [] : [{ label: "Release Time", value: fmtDateTime(r.releasedAt) }]),
      ]}
      signatureLabels={["Witness 1", "Witness 2"]}
    >
      {/* R7eo-D — Pattern D regulatory fix (CrPC §174): hard block when
          MLC body has no police NOC. Without this banner, the previous
          template printed a valid-looking release form for an illegal
          handover. */}
      {mlcReleaseBlocked && (
        <div style={{
          background: "#dc2626", border: "3px solid #7f1d1d", color: "#ffffff",
          padding: "16px 18px", borderRadius: 10, marginBottom: 14,
          fontSize: 15, fontWeight: 900, textAlign: "center",
          textTransform: "uppercase", letterSpacing: ".75px",
          boxShadow: "0 0 0 2px #fecaca",
        }}>
          BLOCKED — POLICE NOC REQUIRED FOR MLC BODY RELEASE
          <div style={{ marginTop: 8, fontSize: 11, fontWeight: 700, textTransform: "none", letterSpacing: 0 }}>
            Release of a medico-legal body without a written police NOC is prohibited under CrPC §174.
            This form is invalid until the Police NOC number is recorded.
          </div>
        </div>
      )}
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

      {/* R7eo-D — Pattern D regulatory fix (CrPC §174): hide receiver
          acknowledgement + release timestamp when MLC release is blocked. */}
      {mlcReleaseBlocked ? (
        <div className="pr-section">
          <div className="pr-section__title">Request for Police NOC</div>
          <div className="pr-section__body" style={{ fontSize: 11, lineHeight: 1.6, color: "#7f1d1d" }}>
            The mortal remains identified above are held in the mortuary pending receipt
            of a written No-Objection Certificate from the investigating police authority
            ({r.policeStation || "station not specified"}
            {r.policeFirNo ? `, FIR ${r.policeFirNo}` : ""}).
            No receiver acknowledgement or release timestamp shall be recorded until the
            NOC is produced and entered on this form.
          </div>
        </div>
      ) : (
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
      )}

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
