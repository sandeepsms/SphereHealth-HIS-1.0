// Components/print/printables/ScheduleXRegisterPrint.jsx
// R7bh-F7 / R7bg-8-CRIT-P1 + R7bg-7-CRIT-3: SCHEDULE X NARCOTICS REGISTER
// (Drugs & Cosmetics Rules §66/67). Per-drug daily ledger: opening
// balance, receipts (with batch + invoice), dispenses (with prescription
// ref, patient UHID, prescriber, witness), closing balance. NDPS Act
// requires this register to be maintained in bound form, retained for
// 2 years, and inspected on demand.

import React from "react";
import PrintShell from "../PrintShell";
import { toNum, numberToIndianWords } from "../../../utils/printUtils";

const fmtD = (d) => d
  ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
  : "—";
const fmtDT = (d) => d
  ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
  : "—";

const ScheduleXRegisterPrint = ({ settings = {}, receipt = {} }) => {
  const r = receipt;
  const printCount = toNum(r.printCount);

  // Two shapes accepted:
  //   r.drugs = [{ drugName, strength, form, unit, openingBalance,
  //                rows: [{ date, type, batch, invoiceRef, qty,
  //                         rxNo, patientUHID, patientName,
  //                         prescriber, prescriberRegNo, witness,
  //                         witnessRegNo, balance }], closingBalance }]
  //   r.rows  = flat list of all rows across drugs (used by Pharmacy Register
  //             list view); we group by drugName here.
  let drugs = Array.isArray(r.drugs) ? r.drugs : null;
  if (!drugs && Array.isArray(r.rows)) {
    const map = new Map();
    for (const row of r.rows) {
      const key = row.drugName || "Unknown drug";
      if (!map.has(key)) {
        map.set(key, {
          drugName: row.drugName,
          strength: row.strength,
          form: row.form,
          unit: row.unit || "units",
          openingBalance: toNum(row.openingBalance),
          rows: [],
        });
      }
      map.get(key).rows.push(row);
    }
    drugs = [...map.values()];
  }
  if (!drugs) drugs = [];

  // For each drug compute a running balance if the back-end didn't send
  // per-row balance, so the printout always reconciles.
  for (const d of drugs) {
    let bal = toNum(d.openingBalance);
    for (const row of d.rows) {
      const recv = toNum(row.receipt ?? (row.type === "RECEIPT" ? row.qty : 0));
      const disp = toNum(row.dispensed ?? (row.type === "DISPENSE" ? row.qty : 0));
      bal += recv - disp;
      if (row.balance == null) row.balance = bal;
    }
    if (d.closingBalance == null) d.closingBalance = bal;
  }

  const totalRows = drugs.reduce((s, d) => s + d.rows.length, 0);

  // R7eo-D — Pattern D regulatory fix (D&C Rules §66/67 Form B): derive
  // title from registerKind so the same component prints the correct
  // statutory label for Schedule H1 / Schedule X / NDPS Narcotic registers.
  const titleByKind = {
    scheduleH1: "Schedule H1 Register",
    scheduleX:  "Schedule X Psychotropic Register",
    narcotic:   "NDPS Narcotic Register",
    ndps:       "NDPS Narcotic Register",
  };
  const computedTitle = titleByKind[r.registerKind] || "SCHEDULE X NARCOTICS REGISTER";

  return (
    <PrintShell
      settings={settings}
      documentTitle={computedTitle}
      serialNo={r.registerNo}
      printCount={printCount}
      infoItems={[
        { label: "Period",          value: r.period || (r.fromDate ? `${fmtD(r.fromDate)} — ${fmtD(r.toDate || new Date())}` : fmtD(r.date)) },
        { label: "Hospital GSTIN",  value: settings.gstin },
        { label: "Drug Licence",    value: settings.drugLicenseNo || settings.drugLicenseNumber || "—" },
        { label: "Pharmacy",        value: settings.hospitalName },
        { label: "Drugs Tracked",   value: drugs.length },
        { label: "Total Rows",      value: totalRows },
        { label: "Verified By",     value: r.verifiedBy || "—" },
        { label: "Verified On",     value: fmtDT(r.verifiedAt || new Date()) },
      ]}
      signatureLabels={["Pharmacist In-charge", "Verifier / Witness"]}
    >
      <div style={{
        background: "#fef2f2", border: "1.5px solid #fecaca", color: "#7f1d1d",
        padding: "10px 14px", borderRadius: 6, marginBottom: 12,
        fontSize: 11, fontWeight: 700,
      }}>
        SCHEDULE X NARCOTICS REGISTER — Drugs &amp; Cosmetics Rules §66 / §67 + NDPS Act.
        Maintain in bound form. Retain for minimum 2 years from last entry. Inspectable on demand.
      </div>

      {drugs.length === 0 ? (
        <div className="muted center" style={{ padding: 32, fontStyle: "italic" }}>
          No Schedule X drug movements recorded for this period.
        </div>
      ) : drugs.map((d, di) => {
        // R7bh-F7 spec: page-break-after every drug (or every 25 rows
        // within a drug) so each drug's ledger reconciles independently.
        const chunks = [];
        const CHUNK_SIZE = 25;
        for (let i = 0; i < d.rows.length; i += CHUNK_SIZE) {
          chunks.push(d.rows.slice(i, i + CHUNK_SIZE));
        }
        if (chunks.length === 0) chunks.push([]);

        return (
          <div
            key={di}
            style={{ pageBreakAfter: "always", breakAfter: "page", marginBottom: 14 }}
            className="sched-x-drug"
          >
            <div className="pr-section">
              <div className="pr-section__title">
                Drug {di + 1} of {drugs.length}: {d.drugName}
                {(d.strength || d.form) && (
                  <span style={{ marginLeft: 6, color: "#64748b", fontWeight: 600, fontSize: 10 }}>
                    {[d.form, d.strength].filter(Boolean).join(" · ")}
                  </span>
                )}
              </div>
              <div style={{
                display: "grid", gridTemplateColumns: "repeat(3, 1fr)",
                gap: 8, fontSize: 11, marginBottom: 8,
              }}>
                <div style={{ border: "1px solid #e2e8f0", borderRadius: 6, padding: "6px 10px", background: "#f8fafc" }}>
                  <div style={{ fontSize: 9, fontWeight: 800, color: "#64748b", textTransform: "uppercase", letterSpacing: ".5px" }}>
                    Opening Balance
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: "#0f172a", marginTop: 2 }}>
                    {toNum(d.openingBalance)} {d.unit || "units"}
                  </div>
                </div>
                <div style={{ border: "1px solid #e2e8f0", borderRadius: 6, padding: "6px 10px", background: "#f8fafc" }}>
                  <div style={{ fontSize: 9, fontWeight: 800, color: "#64748b", textTransform: "uppercase", letterSpacing: ".5px" }}>
                    Total Rows
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: "#0f172a", marginTop: 2 }}>
                    {d.rows.length}
                  </div>
                </div>
                <div style={{ border: "1px solid #fecaca", borderRadius: 6, padding: "6px 10px", background: "#fef2f2" }}>
                  <div style={{ fontSize: 9, fontWeight: 800, color: "#991b1b", textTransform: "uppercase", letterSpacing: ".5px" }}>
                    Closing Balance
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: "#7f1d1d", marginTop: 2 }}>
                    {toNum(d.closingBalance)} {d.unit || "units"}
                  </div>
                </div>
              </div>

              {chunks.map((chunk, ci) => {
                // R7eo-D — Pattern D regulatory fix (D&C Rules §66/67 Form B):
                // closing balance for this chunk, used for "Balance in words"
                // sub-row below the chunk total.
                const chunkClosingBal = chunk.length
                  ? toNum(chunk[chunk.length - 1].balance)
                  : toNum(d.openingBalance);
                return (
                <table key={ci} className="pr-table" style={{
                  fontSize: 10, marginTop: ci > 0 ? 8 : 0,
                  pageBreakInside: "auto",
                }}>
                  <thead>
                    <tr>
                      <th style={{ width: 70 }}>Date</th>
                      <th style={{ width: 60 }}>Type</th>
                      <th style={{ width: 70 }}>Batch</th>
                      <th>Invoice / Rx Ref</th>
                      {/* R7eo-D — Pattern D regulatory fix (D&C §66/67 Form B): manufacturer + supplier columns required */}
                      <th style={{ width: 80 }}>Manufacturer</th>
                      <th style={{ width: 90 }}>Supplier</th>
                      <th style={{ width: 90 }}>Patient (UHID)</th>
                      <th style={{ width: 90 }}>Prescriber</th>
                      <th style={{ width: 90 }}>Witness</th>
                      {/* R7eo-D — Pattern D regulatory fix (D&C §66/67): dispenser signature required */}
                      <th style={{ width: 80 }}>Dispenser Sign</th>
                      <th className="right" style={{ width: 45 }}>In</th>
                      <th className="right" style={{ width: 45 }}>Out</th>
                      <th className="right" style={{ width: 55 }}>Bal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chunk.length === 0 ? (
                      <tr><td colSpan={13} className="muted center" style={{ padding: 12, fontStyle: "italic" }}>No movements.</td></tr>
                    ) : chunk.map((row, ri) => {
                      const type = row.type || (toNum(row.dispensed) > 0 ? "DISPENSE" : "RECEIPT");
                      const recv = toNum(row.receipt ?? (type === "RECEIPT" ? row.qty : 0));
                      const disp = toNum(row.dispensed ?? (type === "DISPENSE" ? row.qty : 0));
                      return (
                        <tr key={ri}>
                          <td>{fmtD(row.date)}</td>
                          <td>
                            <span style={{
                              fontSize: 8.5, fontWeight: 800, padding: "1px 6px",
                              borderRadius: 4, letterSpacing: ".3px",
                              background: type === "DISPENSE" ? "#fee2e2" : "#dcfce7",
                              color: type === "DISPENSE" ? "#991b1b" : "#166534",
                            }}>{type}</span>
                          </td>
                          <td style={{ fontFamily: "'DM Mono', monospace", fontSize: 9.5 }}>{row.batch || row.batchNo || "—"}</td>
                          <td style={{ fontFamily: "'DM Mono', monospace", fontSize: 9.5 }}>
                            {row.invoiceRef || row.rxNo || row.refNo || "—"}
                          </td>
                          {/* R7eo-D — Pattern D regulatory fix (D&C §66/67 Form B): manufacturer */}
                          <td style={{ fontSize: 9.5 }}>
                            {row.manufacturer || row.mfgName || "—"}
                          </td>
                          {/* R7eo-D — Pattern D regulatory fix (D&C §66/67 Form B): supplier (name + address) */}
                          <td style={{ fontSize: 9.5 }}>
                            {row.supplierName || row.vendor || "—"}
                            {row.supplierAddress && (
                              <div className="muted" style={{ fontSize: 8.5 }}>{row.supplierAddress}</div>
                            )}
                          </td>
                          <td style={{ fontSize: 9.5 }}>
                            {row.patientName || "—"}
                            {row.patientUHID && (
                              <div className="muted" style={{ fontSize: 8.5 }}>{row.patientUHID}</div>
                            )}
                          </td>
                          <td style={{ fontSize: 9.5 }}>
                            {row.prescriber || row.prescriberName || "—"}
                            {row.prescriberRegNo && (
                              <div className="muted" style={{ fontSize: 8.5 }}>Reg: {row.prescriberRegNo}</div>
                            )}
                          </td>
                          <td style={{ fontSize: 9.5 }}>
                            {row.witness || "—"}
                            {row.witnessRegNo && (
                              <div className="muted" style={{ fontSize: 8.5 }}>Reg: {row.witnessRegNo}</div>
                            )}
                          </td>
                          {/* R7eo-D — Pattern D regulatory fix (D&C §66/67): dispenser signature column */}
                          <td style={{ fontSize: 9.5 }}>
                            {row.dispenserName || row.dispenserId || ""}
                          </td>
                          <td className="right" style={{ color: recv > 0 ? "#15803d" : "#94a3b8" }}>
                            {recv > 0 ? recv : "—"}
                          </td>
                          <td className="right" style={{ color: disp > 0 ? "#b91c1c" : "#94a3b8" }}>
                            {disp > 0 ? disp : "—"}
                          </td>
                          <td className="right" style={{ fontWeight: 700 }}>{toNum(row.balance)}</td>
                        </tr>
                      );
                    })}
                    {/* R7eo-D — Pattern D regulatory fix (D&C §66/67 Form B): balance in words after each chunk total row */}
                    {chunk.length > 0 && (
                      <tr style={{ background: "#fffbeb" }}>
                        <td colSpan={13} style={{ fontSize: 9.5, fontStyle: "italic", color: "#78350f", padding: "4px 8px" }}>
                          <strong>Balance in figures:</strong> {chunkClosingBal} {d.unit || "units"} &nbsp;·&nbsp;
                          <strong>Balance in words:</strong> {numberToIndianWords(chunkClosingBal)}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
                );
              })}

              {/* Per-drug reconciliation */}
              <div style={{
                marginTop: 8, padding: "8px 12px",
                background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6,
                display: "flex", justifyContent: "space-between", fontSize: 11,
                fontWeight: 700,
              }}>
                <span>
                  Reconciliation: {toNum(d.openingBalance)} +{" "}
                  {d.rows.reduce((s, x) => s + toNum(x.receipt ?? (x.type === "RECEIPT" ? x.qty : 0)), 0)} −{" "}
                  {d.rows.reduce((s, x) => s + toNum(x.dispensed ?? (x.type === "DISPENSE" ? x.qty : 0)), 0)} ={" "}
                  <strong>{toNum(d.closingBalance)}</strong> {d.unit || "units"}
                </span>
                <span style={{ color: "#7f1d1d" }}>
                  Witness signature required for each dispense (NDPS §66.2)
                </span>
              </div>
            </div>
          </div>
        );
      })}

      <div className="pr-section">
        <div className="pr-section__title">Verifier Declaration</div>
        <div className="pr-section__body" style={{ fontSize: 10.5, lineHeight: 1.55 }}>
          I certify that the entries above are a true and complete record of all Schedule X narcotic
          drug movements at this pharmacy for the period stated. Opening and closing balances reconcile
          for each drug. The register is maintained in bound form in compliance with Drugs &amp; Cosmetics
          Rules §66 and §67 and the Narcotic Drugs &amp; Psychotropic Substances Act.
        </div>
      </div>
    </PrintShell>
  );
};

export default ScheduleXRegisterPrint;
