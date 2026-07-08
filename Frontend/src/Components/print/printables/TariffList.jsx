// Components/print/printables/TariffList.jsx
// R7hr(NABH-P3.6) — patient-facing hospital tariff list. NABH PRE.4 gives
// the patient a right to tariff information; charge data previously lived
// only behind staff-only pages (billing.read). Reception prints this on
// request and hands it over — grouped by category, uniform-tariff rates
// from ServiceMaster (the same master every bill prices from).

import React from "react";
import PrintShell from "../PrintShell";
import { toNum } from "../../../utils/printUtils";

const TariffList = ({ settings, receipt = {} }) => {
  const items = Array.isArray(receipt.items) ? receipt.items : [];
  // Group by category, alphabetical inside each group.
  const map = {};
  items.forEach((it) => {
    const cat = it.category || "OTHER";
    if (!map[cat]) map[cat] = [];
    map[cat].push(it);
  });
  const groups = Object.keys(map).sort().map((cat) => ({
    name: cat,
    items: map[cat].sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""))),
  }));

  return (
    <PrintShell
      settings={settings}
      documentTitle="Hospital Tariff List"
      serialNo={receipt.tariffRef}
      infoItems={[
        { label: "Effective Date", value: new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) },
        { label: "Tariff Class",   value: receipt.tariffClass || "General / Cash" },
        { label: "Services Listed", value: String(items.length) },
      ]}
      signatureLabels={["Authorised Signatory"]}
    >
      <div style={{
        background: "#eff6ff", border: "1.5px solid #93c5fd", borderRadius: 8,
        padding: "10px 14px", marginBottom: 14, fontSize: 11, color: "#1e3a8a",
      }}>
        Rates are per the hospital's uniform tariff (NABH PRE.4) and apply to General/Cash
        class unless stated. Room-category-linked charges (bed, nursing) vary by ward class —
        ask reception for the room-category sheet. Rates are subject to revision; the rate on
        the date of service applies. Applicable GST is charged extra where the law prescribes
        (e.g. room rent above ₹5,000/day, non-ICU).
      </div>

      {groups.map((g, gi) => (
        <div key={gi} style={{ marginBottom: 12 }}>
          <div style={{
            background: "var(--pr-accent-color, #4f46e5)15",
            color: "var(--pr-accent-color, #4f46e5)",
            fontWeight: 800, fontSize: 10.5, textTransform: "uppercase",
            letterSpacing: ".5px", padding: "5px 10px", borderRadius: 4,
          }}>
            {g.name}
          </div>
          <table className="pr-table" style={{ marginTop: 4 }}>
            <thead>
              <tr>
                <th style={{ width: 30 }}>#</th>
                <th>Service</th>
                <th style={{ width: 100 }}>Code</th>
                <th className="right" style={{ width: 110 }}>Rate (₹)</th>
              </tr>
            </thead>
            <tbody>
              {g.items.map((it, i) => (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td>{it.name}</td>
                  <td style={{ fontFamily: "'DM Mono', monospace", fontSize: 10 }}>{it.code || "—"}</td>
                  <td className="right">{toNum(it.price).toLocaleString("en-IN")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      <div className="pr-section">
        <div className="pr-section__body" style={{ fontSize: 10.5, color: "#475569" }}>
          For package rates, TPA/corporate tariffs, estimated treatment costs, or any
          clarification, please contact the billing counter. A written cost estimate is
          provided for planned admissions.
        </div>
      </div>
    </PrintShell>
  );
};

export default TariffList;
