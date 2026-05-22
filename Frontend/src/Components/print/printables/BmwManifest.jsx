// Components/print/printables/BmwManifest.jsx
// Bio-Medical Waste Manifest — BMW Rules 2016, Form-IV.
// Issued to the Common Bio-medical Waste Treatment Facility
// (CBWTF) operator at the point of pick-up. Bag-by-bag table
// (barcode / colour / category / weight / from-ward) with
// hospital and CBWTF driver signatures.
//
// Compliance: BMW Management Rules 2016 §17, Schedule I/II.

import React from "react";
import PrintShell from "../PrintShell";
import { toNum } from "../../../utils/printUtils";

const fmtDateTime = (d) => d ? new Date(d).toLocaleString("en-IN", {
  day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
}) : "—";

const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-IN", {
  day: "2-digit", month: "short", year: "numeric",
}) : "—";

const COLOR_STYLE = {
  yellow: { bg: "#fef3c7", color: "#78350f", border: "#fde68a", label: "Yellow" },
  red:    { bg: "#fee2e2", color: "#7f1d1d", border: "#fca5a5", label: "Red" },
  white:  { bg: "#f8fafc", color: "#0f172a", border: "#cbd5e1", label: "White (Translucent)" },
  blue:   { bg: "#dbeafe", color: "#1e3a8a", border: "#93c5fd", label: "Blue" },
};

const BmwManifest = ({ settings, receipt = {} }) => {
  const r = receipt;
  const bags = Array.isArray(r.bags) ? r.bags : [];
  const totals = r.totals || (() => {
    const t = { yellow: 0, red: 0, white: 0, blue: 0, count: bags.length, weight: 0 };
    bags.forEach((b) => {
      const c = (b.color || "yellow").toLowerCase();
      if (t[c] != null) t[c] += toNum(b.weight);
      t.weight += toNum(b.weight);
    });
    return t;
  })();

  return (
    <PrintShell
      settings={settings}
      documentTitle="Bio-Medical Waste Manifest (BMW Rules Form-IV)"
      serialNo={r.manifestNo}
      printCount={toNum(r.printCount)}
      infoItems={[
        { label: "Manifest #",       value: r.manifestNo },
        { label: "Date",             value: fmtDate(r.manifestDate || new Date()) },
        { label: "CBWTF Name",       value: r.cbwtfName },
        { label: "CBWTF Licence #",  value: r.cbwtfLicenceNo },
        { label: "Hospital Licence", value: settings.bmwLicenceNo || settings.registrationNo },
        { label: "Pick-up At",       value: fmtDateTime(r.pickupAt) },
      ]}
      signatureLabels={["Hospital BMW Officer", "CBWTF Driver / Operator"]}
    >
      {/* Totals card */}
      <div className="pr-section">
        <div className="pr-section__title">Manifest Totals</div>
        <div className="pr-section__body" style={{ fontSize: 11 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8 }}>
            {["yellow", "red", "white", "blue"].map((c) => {
              const s = COLOR_STYLE[c];
              return (
                <div key={c} style={{ border: `1.5px solid ${s.border}`, background: s.bg, borderRadius: 6, padding: 8, textAlign: "center" }}>
                  <div style={{ fontSize: 10, color: s.color, textTransform: "uppercase", letterSpacing: ".5px", fontWeight: 800 }}>{s.label}</div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: s.color, marginTop: 3 }}>{Number(totals[c] || 0).toFixed(2)} kg</div>
                </div>
              );
            })}
            <div style={{ border: "1.5px solid #cbd5e1", background: "#0f172a", borderRadius: 6, padding: 8, textAlign: "center" }}>
              <div style={{ fontSize: 10, color: "#fff", textTransform: "uppercase", letterSpacing: ".5px", fontWeight: 800 }}>Total</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: "#fff", marginTop: 3 }}>{Number(totals.weight || 0).toFixed(2)} kg</div>
              <div style={{ fontSize: 9, color: "#cbd5e1" }}>{totals.count || bags.length} bags</div>
            </div>
          </div>
        </div>
      </div>

      {/* Bag-by-bag table */}
      <div className="pr-section">
        <div className="pr-section__title">Bag-by-Bag Manifest</div>
        <table className="pr-table" style={{ fontSize: 10.5 }}>
          <thead>
            <tr>
              <th style={{ width: 28 }}>#</th>
              <th style={{ width: 110 }}>Barcode</th>
              <th style={{ width: 72 }}>Colour</th>
              <th style={{ width: 80 }}>Category</th>
              <th style={{ width: 60 }} className="right">Weight (kg)</th>
              <th style={{ width: 110 }}>From Ward / Unit</th>
              <th style={{ width: 90 }}>Generated</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {bags.length === 0 ? (
              <tr><td colSpan={8} className="muted center" style={{ padding: 12 }}>No bags recorded.</td></tr>
            ) : bags.map((b, i) => {
              const c = (b.color || "yellow").toLowerCase();
              const s = COLOR_STYLE[c] || COLOR_STYLE.yellow;
              return (
                <tr key={i} style={{ pageBreakInside: "avoid" }}>
                  <td>{i + 1}</td>
                  <td style={{ fontFamily: "'DM Mono', monospace", fontSize: 10 }}>{b.barcode || b.bagNo || "—"}</td>
                  <td>
                    <span style={{
                      display: "inline-block", padding: "1px 6px", borderRadius: 4,
                      background: s.bg, color: s.color, border: `1px solid ${s.border}`,
                      fontSize: 9, fontWeight: 800, textTransform: "uppercase",
                    }}>{s.label}</span>
                  </td>
                  <td>{b.category || "—"}</td>
                  <td className="right">{toNum(b.weight).toFixed(2)}</td>
                  <td>{b.fromWard || b.source || "—"}</td>
                  <td>{fmtDate(b.generatedAt || b.generatedDate)}</td>
                  <td style={{ fontSize: 9.5 }}>{b.notes || ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* CBWTF / vehicle */}
      <div className="pr-section">
        <div className="pr-section__title">CBWTF Vehicle &amp; Receipt</div>
        <table className="pr-table" style={{ fontSize: 11 }}>
          <tbody>
            <tr>
              <td style={{ width: "25%", fontWeight: 700 }}>Vehicle #</td>
              <td>{r.vehicleNumber || "—"}</td>
              <td style={{ width: "25%", fontWeight: 700 }}>Driver Name</td>
              <td>{r.driverName || "—"}</td>
            </tr>
            <tr>
              <td style={{ fontWeight: 700 }}>Driver Contact</td>
              <td>{r.driverContact || "—"}</td>
              <td style={{ fontWeight: 700 }}>Receipt Timestamp</td>
              <td>{fmtDateTime(r.cbwtfReceiptAt || r.pickupAt)}</td>
            </tr>
            <tr>
              <td style={{ fontWeight: 700 }}>SPCB Return #</td>
              <td>{r.spcbReturnNo || "—"}</td>
              <td style={{ fontWeight: 700 }}>Disposal Facility</td>
              <td>{r.disposalFacility || "—"}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div style={{
        marginTop: 8, padding: "10px 12px",
        background: "#fef9c3", border: "1.5px solid #facc15",
        borderRadius: 8, fontSize: 10.5, color: "#713f12",
      }}>
        <strong>BMW Rules 2016, §17 + Form-IV:</strong> This manifest accompanies
        every consignment of bio-medical waste handed over to the CBWTF. A
        signed copy is retained at the generator (hospital) for not less than
        5 years and forms part of the annual return (Form-IV) filed with the
        State Pollution Control Board.
      </div>
    </PrintShell>
  );
};

export default BmwManifest;
