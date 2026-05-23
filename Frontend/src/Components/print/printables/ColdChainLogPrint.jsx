// Components/print/printables/ColdChainLogPrint.jsx
// R7bm-F7 — Cold-chain (vaccine / insulin / biologic) temperature
// log printable. Backs NABH MOM.2, D&C Schedule K, FSSAI 2.1.13,
// and WHO PQS E003. Renders a date-bounded fridge log with the
// per-reading table, breach summary, and acknowledgement chain.
//
// Retention horizon: 3 years from record date per FSSAI 2.1.13 —
// reinforced in the footer block.

import React from "react";
import PrintShell from "../PrintShell";
import { toNum } from "../../../utils/printUtils";

const fmtDateTime = (d) => d ? new Date(d).toLocaleString("en-IN", {
  day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
}) : "—";

const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-IN", {
  day: "2-digit", month: "short", year: "numeric",
}) : "—";

const FRIDGE_LABEL = {
  FRIDGE:    "Refrigerator (2–8 °C)",
  FREEZER:   "Freezer (−25 to −15 °C)",
  ROOM_TEMP: "Room-temperature store",
};

const BreachBadge = ({ inRange, isBreach }) => {
  if (isBreach) {
    return (
      <span style={{
        display: "inline-block", padding: "1px 6px", borderRadius: 4,
        background: "#fee2e2", color: "#7f1d1d", border: "1px solid #fca5a5",
        fontSize: 9, fontWeight: 800, textTransform: "uppercase",
      }}>BREACH</span>
    );
  }
  if (inRange) {
    return (
      <span style={{
        display: "inline-block", padding: "1px 6px", borderRadius: 4,
        background: "#dcfce7", color: "#14532d", border: "1px solid #86efac",
        fontSize: 9, fontWeight: 800, textTransform: "uppercase",
      }}>IN-RANGE</span>
    );
  }
  return (
    <span style={{
      display: "inline-block", padding: "1px 6px", borderRadius: 4,
      background: "#fef3c7", color: "#78350f", border: "1px solid #fde68a",
      fontSize: 9, fontWeight: 800, textTransform: "uppercase",
    }}>WARN</span>
  );
};

const ColdChainLogPrint = ({ settings, receipt = {} }) => {
  const r = receipt;
  const rows = Array.isArray(r.rows) ? r.rows : Array.isArray(r.readings) ? r.readings : [];
  const fridge = r.fridge || {
    fridgeId: r.fridgeId,
    fridgeLabel: r.fridgeLabel,
    fridgeLocation: r.fridgeLocation,
    fridgeType: r.fridgeType,
  };
  const breaches = rows.filter((x) => x.isBreachIncident);
  const ackPending = breaches.filter((x) => !x.acknowledgedAt).length;

  const temps = rows.map((x) => Number(x.temperatureC)).filter((n) => Number.isFinite(n));
  const tMin = temps.length ? Math.min(...temps) : null;
  const tMax = temps.length ? Math.max(...temps) : null;
  const tAvg = temps.length ? temps.reduce((a, b) => a + b, 0) / temps.length : null;

  return (
    <PrintShell
      settings={settings}
      documentTitle="Cold-Chain Temperature Log"
      serialNo={fridge.fridgeId}
      printCount={toNum(r.printCount)}
      watermarkLabel="COLD CHAIN — D&C Schedule K"
      infoItems={[
        { label: "Fridge ID",    value: fridge.fridgeId },
        { label: "Label",        value: fridge.fridgeLabel || "—" },
        { label: "Location",     value: fridge.fridgeLocation || "—" },
        { label: "Equipment",    value: FRIDGE_LABEL[fridge.fridgeType] || fridge.fridgeType || "—" },
        { label: "Period From",  value: fmtDate(r.periodStart || r.from) },
        { label: "Period To",    value: fmtDate(r.periodEnd || r.to) },
        { label: "Readings",     value: rows.length },
      ]}
      signatureLabels={["Pharmacy In-charge", "Quality / Infection Control"]}
    >
      {/* Breach summary banner */}
      <div style={{
        background: breaches.length ? "#fee2e2" : "#dcfce7",
        border: `2px solid ${breaches.length ? "#fca5a5" : "#86efac"}`,
        borderRadius: 8, padding: "12px 16px", marginBottom: 14,
      }}>
        <div style={{ fontSize: 10, color: breaches.length ? "#7f1d1d" : "#14532d", textTransform: "uppercase", letterSpacing: ".5px", fontWeight: 800 }}>
          Period Summary
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginTop: 8, fontSize: 11 }}>
          <div>
            <div style={{ fontSize: 9, color: "#475569", fontWeight: 700 }}>Readings</div>
            <div style={{ fontSize: 18, fontWeight: 900 }}>{rows.length}</div>
          </div>
          <div>
            <div style={{ fontSize: 9, color: "#475569", fontWeight: 700 }}>Min Temp</div>
            <div style={{ fontSize: 18, fontWeight: 900 }}>{tMin == null ? "—" : `${tMin.toFixed(1)} °C`}</div>
          </div>
          <div>
            <div style={{ fontSize: 9, color: "#475569", fontWeight: 700 }}>Max Temp</div>
            <div style={{ fontSize: 18, fontWeight: 900 }}>{tMax == null ? "—" : `${tMax.toFixed(1)} °C`}</div>
          </div>
          <div>
            <div style={{ fontSize: 9, color: "#475569", fontWeight: 700 }}>Avg Temp</div>
            <div style={{ fontSize: 18, fontWeight: 900 }}>{tAvg == null ? "—" : `${tAvg.toFixed(1)} °C`}</div>
          </div>
          <div>
            <div style={{ fontSize: 9, color: "#475569", fontWeight: 700 }}>Breaches</div>
            <div style={{ fontSize: 18, fontWeight: 900, color: breaches.length ? "#7f1d1d" : "#14532d" }}>
              {breaches.length}{ackPending ? <span style={{ fontSize: 10, marginLeft: 4 }}>({ackPending} un-ack)</span> : null}
            </div>
          </div>
        </div>
      </div>

      {/* Reading table */}
      <div className="pr-section">
        <div className="pr-section__title">Temperature Readings</div>
        <table className="pr-table" style={{ fontSize: 10.5 }}>
          <thead>
            <tr>
              <th style={{ width: 28 }}>#</th>
              <th style={{ width: 130 }}>Recorded At</th>
              <th style={{ width: 70 }} className="right">Temp (°C)</th>
              <th style={{ width: 70 }} className="right">RH %</th>
              <th style={{ width: 80 }}>Status</th>
              <th style={{ width: 130 }}>Recorded By</th>
              <th>Notes / Corrective Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={7} className="muted center" style={{ padding: 12 }}>No readings in the selected period.</td></tr>
            ) : rows.map((x, i) => (
              <tr key={x._id || `${x.recordedAt}-${i}`} style={{ pageBreakInside: "avoid" }}>
                <td>{i + 1}</td>
                <td>{fmtDateTime(x.recordedAt)}</td>
                <td className="right" style={{ fontFamily: "'DM Mono', monospace", color: x.isBreachIncident ? "#7f1d1d" : "#0f172a", fontWeight: x.isBreachIncident ? 800 : 600 }}>
                  {Number(x.temperatureC).toFixed(1)}
                </td>
                <td className="right">{x.humidityPct == null ? "—" : Number(x.humidityPct).toFixed(0)}</td>
                <td><BreachBadge inRange={x.inRange} isBreach={x.isBreachIncident} /></td>
                <td>{x.recordedByName || "—"}</td>
                <td style={{ fontSize: 9.5 }}>
                  {x.incidentNotes ? <div><strong>Note:</strong> {x.incidentNotes}</div> : null}
                  {x.correctiveAction ? <div><strong>CAPA:</strong> {x.correctiveAction}</div> : null}
                  {x.acknowledgedAt ? <div className="muted">Ack by {x.acknowledgedByName || "—"} on {fmtDateTime(x.acknowledgedAt)}</div> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Breach incident detail */}
      {breaches.length > 0 && (
        <div className="pr-section">
          <div className="pr-section__title">Breach Incidents Detail</div>
          <table className="pr-table" style={{ fontSize: 10.5 }}>
            <thead>
              <tr>
                <th style={{ width: 130 }}>Breach At</th>
                <th style={{ width: 70 }} className="right">Temp (°C)</th>
                <th>Notes</th>
                <th>Corrective Action</th>
                <th style={{ width: 130 }}>Acknowledged</th>
              </tr>
            </thead>
            <tbody>
              {breaches.map((x, i) => (
                <tr key={x._id || `breach-${i}`} style={{ pageBreakInside: "avoid" }}>
                  <td>{fmtDateTime(x.recordedAt)}</td>
                  <td className="right" style={{ color: "#7f1d1d", fontWeight: 800 }}>{Number(x.temperatureC).toFixed(1)}</td>
                  <td>{x.incidentNotes || "—"}</td>
                  <td>{x.correctiveAction || "—"}</td>
                  <td style={{ fontSize: 9.5 }}>
                    {x.acknowledgedAt
                      ? <>{fmtDateTime(x.acknowledgedAt)}<br/><span className="muted">by {x.acknowledgedByName || "—"}</span></>
                      : <span style={{ color: "#7f1d1d", fontWeight: 700 }}>PENDING</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{
        marginTop: 8, padding: "10px 12px",
        background: "#fef9c3", border: "1.5px solid #facc15",
        borderRadius: 8, fontSize: 10.5, color: "#713f12",
      }}>
        <strong>FSSAI 2.1.13 + D&amp;C Schedule K + WHO PQS E003:</strong> Cold-chain
        logs for vaccine / insulin / biologic storage must be retained for at
        least <strong>3 years</strong> from the record date. Breach incidents must be
        acknowledged with a corrective-and-preventive action (CAPA) plan
        within the timelines specified by the hospital&apos;s Pharmacy SOP.
      </div>
    </PrintShell>
  );
};

export default ColdChainLogPrint;
