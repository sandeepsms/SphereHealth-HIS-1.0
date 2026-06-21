// Components/print/printables/ValuablesHandoverSlip.jsx
// R7hr-174 (USER, 2026-06-09): Valuables & Belongings handover slip.
// Auto-printed from the Nurse Initial Assessment when the nurse ticks
// "Receipt issued to patient / family" in the N15 Valuables section and
// signs the IA. NABH ROP + PSQ compliance — gives the family a printed
// record of which jewellery/cash/documents were sent home, with whom,
// and the nurse's countersignature. Half-A4 friendly.
//
// Patient-strip mapping (Track-A contract):
//   left:  Slip No · UHID · Patient Name · Gender/Age · Contact
//   right: Slip Date · IP No · Admission Date · Ward / Bed · Attending Doctor

import React from "react";
import PrintShell from "@/templates/PrintShell";

const fmtDateTime = (d) =>
  d
    ? new Date(d).toLocaleString("en-IN", {
        day: "2-digit", month: "short", year: "numeric",
        hour: "2-digit", minute: "2-digit",
      })
    : "—";
const fmtDate = (d) =>
  d
    ? new Date(d).toLocaleString("en-IN", {
        day: "2-digit", month: "short", year: "numeric",
      })
    : "—";

const ValuablesHandoverSlip = ({ settings = {}, receipt = {} }) => {
  const slipNo = receipt.slipNo || "—";
  const genderAge = [receipt.gender, receipt.age && `${receipt.age}Y`]
    .filter(Boolean).join(" ");
  const wardBed = [receipt.wardName, receipt.bedNumber].filter(Boolean).join(" / ") || "—";

  const patientLeft = [
    { label: "Slip No",      value: slipNo },
    { label: "UHID",         value: receipt.uhid || "—" },
    { label: "Patient Name", value: receipt.patientName || "—" },
    { label: "Gender/Age",   value: genderAge || "—" },
    { label: "Contact",      value: receipt.contactNumber || receipt.mobile || "—" },
  ];
  const patientRight = [
    { label: "Slip Date",        value: fmtDateTime(receipt.date || new Date().toISOString()) },
    { label: "IP No",            value: receipt.ipdNo || "—" },
    { label: "Admission Date",   value: fmtDate(receipt.admissionDate) },
    { label: "Ward / Bed",       value: wardBed },
    { label: "Attending Doctor", value: receipt.doctor || "—" },
  ];

  const itemsRaw = String(receipt.items || "").trim();
  const itemsLines = itemsRaw ? itemsRaw.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean) : [];

  return (
    <PrintShell
      hospital={settings}
      docTitle="Valuables & Belongings Handover Slip"
      patient={{ left: patientLeft, right: patientRight }}
      // R7hr-265 (sprint review fix): PrintShell's SignatureZone only knows
      // "double" / "single" / "prepared-by" — the prior type:"dual" + leftBy/
      // rightBy was invented API that fell through to an empty "Prepared By"
      // stamp, dropping BOTH signatures (the whole point of an NABH valuables
      // handover slip). Use the real "double" shape (left/right {name,role,reg}).
      // "double" has no label slots, so the Handed-Over-By / Received-By wording
      // rides on the role line.
      signatures={{
        type: "double",
        left:  {
          name: receipt.nurseName || "—",
          role: "Handed Over By · Nursing Staff",
          reg:  receipt.nurseEmployeeId || "",
        },
        right: {
          name: receipt.handedTo || "—",
          role: "Received By · Family / Self",
        },
      }}
      banners={{ emergency24x7: true }}
      meta={{
        docNumber: slipNo,
        pageOf: "1 of 1",
        printCount: 0,
      }}
    >
      {/* Status callout */}
      <div style={{
        border: "1px solid #cbd5e1", borderRadius: 6,
        padding: "8px 12px", marginBottom: 12, background: "#f8fafc",
      }}>
        <div style={{ fontSize: 11, color: "#475569", textTransform: "uppercase", fontWeight: 600, letterSpacing: 0.4 }}>
          Status of Valuables
        </div>
        <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a", marginTop: 2 }}>
          {receipt.status || "—"}
        </div>
        <div style={{ fontSize: 11, color: "#475569", marginTop: 4 }}>
          Handed to: <strong style={{ color: "#0f172a" }}>{receipt.handedTo || "—"}</strong>
        </div>
      </div>

      {/* Itemised list table */}
      <table className="pr-table" style={{ marginBottom: 12 }}>
        <thead>
          <tr>
            <th style={{ width: 40 }}>#</th>
            <th>Item Description</th>
          </tr>
        </thead>
        <tbody>
          {itemsLines.length > 0 ? itemsLines.map((line, i) => (
            <tr key={i} className="bill-line-row">
              <td className="right">{i + 1}</td>
              <td>{line}</td>
            </tr>
          )) : (
            <tr>
              <td colSpan={2} style={{ textAlign: "center", color: "#94a3b8", fontStyle: "italic", padding: "12px 8px" }}>
                Nil declared / no itemised list captured
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {/* NABH attestation block */}
      <div style={{
        border: "1px dashed #94a3b8", borderRadius: 6,
        padding: "10px 12px", marginBottom: 8, background: "#fffbeb",
        fontSize: 10.5, color: "#475569", lineHeight: 1.5,
      }}>
        <strong style={{ color: "#0f172a" }}>NABH ROP + PSQ attestation:</strong>{" "}
        The items listed above were noted at the time of admission and handed
        over as recorded. The hospital is NOT responsible for any valuables
        retained on the patient's person against this advice. The family
        confirms receipt by signing below.
      </div>
    </PrintShell>
  );
};

export default ValuablesHandoverSlip;
