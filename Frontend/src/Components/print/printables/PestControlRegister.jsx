// Components/print/printables/PestControlRegister.jsx
// Pest-control visit register — printed at the end of each
// scheduled pest-control round. Captures vendor credentials
// (FSSAI / CIB-registered pesticide), pesticide details, area
// treated and applicator details.
//
// Compliance: NABH FMS.4 (safe environment), CIB&RC pesticide
// registration verification, and FSSAI hygiene requirements for
// food-handling areas (kitchens, dietary stores).

import React from "react";
import PrintShell from "../PrintShell";
import { toNum } from "../../../utils/printUtils";

const fmtDateTime = (d) => d ? new Date(d).toLocaleString("en-IN", {
  day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
}) : "—";

const PestControlRegister = ({ settings, receipt = {} }) => {
  const r = receipt;
  const pesticides = Array.isArray(r.pesticides) && r.pesticides.length
    ? r.pesticides
    : [{
        name: r.pesticide,
        cibRegNo: r.cibRegNo,
        dose: r.dose,
        dilution: r.dilution,
        targetPest: r.targetPest,
      }];

  return (
    <PrintShell
      settings={settings}
      documentTitle="Pest Control Register Entry"
      serialNo={r.scheduleNo}
      printCount={toNum(r.printCount)}
      infoItems={[
        { label: "Schedule #",     value: r.scheduleNo },
        { label: "Visit Date",     value: fmtDateTime(r.visitDate || r.completedAt) },
        { label: "Vendor",         value: r.vendorName },
        { label: "Vendor FSSAI #", value: r.vendorFssaiNo },
        { label: "Applicator",     value: r.appliedBy },
        { label: "Hospital Witness", value: r.hospitalWitness },
      ]}
      showBank={false}
      signatureLabels={["Vendor / Applicator", "Hospital Supervisor"]}
    >
      {/* Vendor credentials block */}
      <div style={{
        border: "1.5px solid #93c5fd",
        background: "linear-gradient(135deg, #dbeafe, #eff6ff)",
        borderRadius: 8, padding: "10px 14px", marginBottom: 12,
      }}>
        <div style={{ fontSize: 10, color: "#1e3a8a", textTransform: "uppercase", letterSpacing: ".5px", fontWeight: 800 }}>
          Vendor Credentials
        </div>
        <div style={{ fontSize: 13, fontWeight: 800, marginTop: 2, color: "#0f172a" }}>
          {r.vendorName || "—"}
        </div>
        <div style={{ fontSize: 11, color: "#1e3a8a", marginTop: 4 }}>
          {r.vendorFssaiNo && <><strong>FSSAI #:</strong> <span style={{ fontFamily: "'DM Mono', monospace" }}>{r.vendorFssaiNo}</span></>}
          {r.vendorCibNo  && <> · <strong>CIB #:</strong> <span style={{ fontFamily: "'DM Mono', monospace" }}>{r.vendorCibNo}</span></>}
          {r.vendorContact && <> · 📞 {r.vendorContact}</>}
        </div>
      </div>

      <div className="pr-section">
        <div className="pr-section__title">Area Treated</div>
        <div className="pr-section__body" style={{ fontSize: 11.5 }}>
          <div><strong>Areas:</strong> {Array.isArray(r.areas) ? r.areas.join(", ") : (r.areas || r.area || "—")}</div>
          <div><strong>Total Area:</strong> {r.totalArea || "—"}</div>
          <div><strong>Frequency:</strong> {r.frequency || "Monthly"}</div>
          <div><strong>Visit Started:</strong> {fmtDateTime(r.startedAt)}</div>
          <div><strong>Visit Completed:</strong> {fmtDateTime(r.completedAt)}</div>
        </div>
      </div>

      {/* Pesticides table */}
      <div className="pr-section">
        <div className="pr-section__title">Pesticides Applied</div>
        <table className="pr-table" style={{ fontSize: 11 }}>
          <thead>
            <tr>
              <th style={{ width: 24 }}>#</th>
              <th>Pesticide / Brand</th>
              <th style={{ width: 110 }}>CIB Reg. #</th>
              <th style={{ width: 70 }}>Dose</th>
              <th style={{ width: 80 }}>Dilution</th>
              <th style={{ width: 90 }}>Target Pest</th>
            </tr>
          </thead>
          <tbody>
            {pesticides.length === 0 || !pesticides[0]?.name ? (
              <tr><td colSpan={6} className="muted center" style={{ padding: 12 }}>No pesticide details recorded.</td></tr>
            ) : pesticides.map((p, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td><strong>{p.name || "—"}</strong>
                  {p.activeIngredient && <div className="muted" style={{ fontSize: 10 }}>{p.activeIngredient}</div>}
                </td>
                <td style={{ fontFamily: "'DM Mono', monospace", fontSize: 10.5 }}>{p.cibRegNo || "—"}</td>
                <td>{p.dose || "—"}</td>
                <td>{p.dilution || "—"}</td>
                <td>{p.targetPest || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="pr-section">
        <div className="pr-section__title">Safety &amp; Re-entry</div>
        <div className="pr-section__body" style={{ fontSize: 11.5 }}>
          <div><strong>PPE used:</strong> {Array.isArray(r.ppe) ? r.ppe.join(", ") : (r.ppe || "Gloves, mask, eye-shield, apron")}</div>
          <div><strong>Re-entry interval:</strong> {r.reentryInterval || "—"}</div>
          <div><strong>Patient-care areas evacuated:</strong> {r.areasEvacuated ? "YES" : "NO"}</div>
          <div><strong>Observations:</strong> {r.observations || "—"}</div>
          <div><strong>Next scheduled visit:</strong> {fmtDateTime(r.nextVisitAt)}</div>
        </div>
      </div>

      <div style={{
        marginTop: 8, padding: "8px 12px", border: "1px dashed #cbd5e1",
        borderRadius: 6, background: "#f8fafc", fontSize: 10, color: "#475569",
      }}>
        <strong>FMS.4 / FSSAI:</strong> Only CIB&amp;RC-registered pesticides may be
        applied within the hospital. Vendor must hold a valid pest-control licence
        and FSSAI clearance when treating food-handling areas. Material Safety
        Data Sheets (MSDS) of all pesticides used are retained at the vendor desk.
      </div>
    </PrintShell>
  );
};

export default PestControlRegister;
