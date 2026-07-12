/**
 * FullMarSection.jsx — R7hr(DOCS-FULL, owner 2026-07-12)
 * ─────────────────────────────────────────────────────────
 * Standalone-MARSheet-style medication administration grid inside the
 * Complete Patient File: per-day tables with fixed slot columns
 * (06 / 10 / 14 / 18 / 22 + Other), one row per drug, each cell showing
 * the status glyph + actual time + nurse, a Given/Missed/Held totals
 * footer and the glyph legend. The day-wise journey keeps its inline
 * "who·when·on-time" narrative; this is the formal consolidated MAR.
 *
 * Data: f.doctorOrders[].admin (DoctorOrder.administrationRecord — the
 * canonical MAR) with f.mar rows as fallback for out-of-band deployments.
 */
import React from "react";

const S = {
  day: { fontSize: 9.5, fontWeight: 800, color: "#334155", margin: "6px 0 2px", textTransform: "uppercase", letterSpacing: ".4px" },
  tbl: { width: "100%", borderCollapse: "collapse", fontSize: 9, margin: "2px 0 4px", breakInside: "avoid" },
  th: { border: "1px solid #e7edf3", background: "#f6f8fb", padding: "2px 4px", textAlign: "left", fontWeight: 800, textTransform: "uppercase", fontSize: 8, color: "#475569" },
  td: { border: "1px solid #eef2f6", padding: "2px 4px", verticalAlign: "top", color: "#0f172a" },
  legend: { fontSize: 8, color: "#64748b", margin: "2px 0 6px" },
};

const SLOTS = [6, 10, 14, 18, 22];
const str = (v) => (v === null || v === undefined ? "" : String(v).trim());
const dayKey = (d) => { const x = new Date(d); return isNaN(x) ? "" : x.toISOString().slice(0, 10); };
const fmtDay = (k) => new Date(k + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
const hhmm = (d) => { const x = new Date(d); return isNaN(x) ? "" : x.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false }); };
const initials = (name) => str(name).split(/\s+/).map((w) => w[0]).join("").toUpperCase().slice(0, 3);
const GLYPH = { given: "✓", missed: "✗", refused: "R", held: "H", pending: "○" };

/* Slot index for an admin record: scheduledTime "HH:MM" wins, else givenAt
   hour; nearest fixed slot within ±2h, else the Other column (index 5). */
const slotOf = (a) => {
  let h = null;
  const m = /^(\d{1,2})/.exec(str(a.schedTime));
  if (m) h = Number(m[1]);
  else if (a.givenAt) { const d = new Date(a.givenAt); if (!isNaN(d)) h = d.getHours(); }
  if (h === null) return 5;
  let best = 5, gap = 3;
  SLOTS.forEach((s, i) => { const g = Math.abs(s - h); if (g < gap) { gap = g; best = i; } });
  return best;
};

export default function FullMarSection({ file }) {
  const f = file || {};
  // Canonical rows from order-embedded administrationRecord.
  const rows = [];
  (f.doctorOrders || []).forEach((o) => {
    (o.admin || []).forEach((a) => {
      const when = a.givenAt || a.schedDate;
      if (!when) return;
      rows.push({
        day: dayKey(when),
        drug: str(o.displayName) || "—",
        dose: str(a.doseGiven || o.dose),
        route: str(a.routeUsed || o.route),
        freq: str(o.frequency),
        a,
      });
    });
  });
  // Out-of-band MAR collection fallback (deployments without order-embedded records).
  if (!rows.length) {
    (f.mar || []).forEach((m) => {
      const when = m.givenAt || m.createdAt;
      if (!when) return;
      rows.push({
        day: dayKey(when), drug: str(m.drug) || "—", dose: str(m.dose), route: str(m.route), freq: str(m.frequency),
        a: { status: str(m.status) || "given", givenAt: m.givenAt, givenBy: m.givenBy, schedTime: "" },
      });
    });
  }
  if (!rows.length) return null;

  const byDay = new Map();
  rows.forEach((r) => { if (!r.day) return; if (!byDay.has(r.day)) byDay.set(r.day, []); byDay.get(r.day).push(r); });
  const days = [...byDay.keys()].sort();

  return (
    <>
      {days.map((dk) => {
        const dayRows = byDay.get(dk);
        // rows per drug — cells bucketed into slots
        const drugs = new Map();
        dayRows.forEach((r) => {
          const key = `${r.drug}|${r.dose}|${r.route}`;
          if (!drugs.has(key)) drugs.set(key, { ...r, cells: [[], [], [], [], [], []] });
          drugs.get(key).cells[slotOf(r.a)].push(r.a);
        });
        const totals = { given: 0, missed: 0, held: 0 };
        dayRows.forEach((r) => {
          const s = str(r.a.status).toLowerCase();
          if (s === "given") totals.given++;
          else if (s === "missed" || s === "refused") totals.missed++;
          else if (s === "held") totals.held++;
        });
        return (
          <div key={dk}>
            <div style={S.day}>{fmtDay(dk)}</div>
            <table style={S.tbl}>
              <thead>
                <tr>
                  <th style={{ ...S.th, width: "26%" }}>Drug · Dose · Route</th>
                  {SLOTS.map((s) => <th key={s} style={{ ...S.th, textAlign: "center" }}>{String(s).padStart(2, "0")}:00</th>)}
                  <th style={{ ...S.th, textAlign: "center" }}>Other</th>
                </tr>
              </thead>
              <tbody>
                {[...drugs.values()].map((d, i) => (
                  <tr key={i}>
                    <td style={S.td}><strong>{d.drug}</strong>{d.dose ? ` ${d.dose}` : ""}{d.route ? ` · ${d.route}` : ""}{d.freq ? <div style={{ fontSize: 7.5, color: "#64748b" }}>{d.freq}</div> : null}</td>
                    {d.cells.map((cell, ci) => (
                      <td key={ci} style={{ ...S.td, textAlign: "center" }}>
                        {cell.map((a, ai) => {
                          const s = str(a.status).toLowerCase();
                          const g = GLYPH[s] || "•";
                          return (
                            <div key={ai} style={{ color: s === "given" ? "#15803d" : s === "pending" ? "#64748b" : "#b91c1c", fontWeight: 700 }}>
                              {g}{a.adverse ? "⚠" : ""} {a.givenAt ? hhmm(a.givenAt) : str(a.schedTime)}
                              {str(a.givenBy) ? <span style={{ fontSize: 7.5, color: "#64748b" }}> {initials(a.givenBy)}</span> : null}
                            </div>
                          );
                        })}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td style={{ ...S.td, fontWeight: 800 }} colSpan={7}>
                    Given: {totals.given} · Missed/Refused: {totals.missed} · Held: {totals.held}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        );
      })}
      <div style={S.legend}>✓ Given · ✗ Missed · R Refused · H Held · ○ Pending · ⚠ Adverse event · initials = administering nurse</div>
    </>
  );
}
