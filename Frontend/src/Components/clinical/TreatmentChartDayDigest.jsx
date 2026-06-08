/**
 * TreatmentChartDayDigest.jsx — R7hr-126
 *
 * Per-day STATIC tabular digest of everything the clinical team saved
 * for one calendar day on this admission. Renders five small tables
 * one under the other:
 *
 *   1. Vitals Chart       (BP, HR, SpO2, Temp, RR, Pain, RBS per time-slot)
 *   2. Medications        (drug × scheduled doses × Given/Pending/Held + given-by/time)
 *   3. Infusions          (fluid, rate, started/stopped, RATE CHANGES with reason)
 *   4. Intake / Output    (running ledger + totals)
 *   5. Other Observations (Pain assessment, Fall risk re-score, RBS-only readings
 *                          recorded outside the vitals form — anything else the
 *                          ward staff saved & submitted for the day)
 *
 * Read-only by design. Live administration actions (Administer / Hold /
 * Refused / Rate-change) still live inside the standalone live MAR page —
 * a CTA at the top of TreatmentChartDayStack links there for active
 * doses. This view is the launch-ready PRESENTATION layer; it does NOT
 * regress any of the existing write paths (R25).
 *
 * R26 / R27 honoured — Initial Assessment surfaces are not touched.
 *
 * Inputs are slices already pre-filtered by the parent DayStack so we
 * don't run a fetch per day for 30-day admissions.
 */

import React, { useMemo } from "react";

/* ── Colour palette (matches the rest of the patient panel) ── */
const C = {
  card: "#ffffff",
  border: "#e2e8f0",
  borderL: "#f1f5f9",
  text: "#0f172a",
  textM: "#475569",
  muted: "#64748b",
  blue: "#0ea5e9",
  blueL: "#e0f2fe",
  blueB: "#7dd3fc",
  green: "#16a34a",
  greenL: "#dcfce7",
  greenB: "#86efac",
  amber: "#d97706",
  amberL: "#fef3c7",
  amberB: "#fbbf24",
  red: "#dc2626",
  redL: "#fee2e2",
  redB: "#fca5a5",
  teal: "#0d9488",
  tealL: "#ccfbf1",
  tealB: "#5eead4",
  purple: "#7c3aed",
  purpleL: "#f3e8ff",
  purpleB: "#d8b4fe",
  slate: "#334155",
  slateL: "#f1f5f9",
};

/* ── Formatters ── */
const sameDay = (a, b) => {
  if (!a || !b) return false;
  const x = new Date(a), y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
};
const dateKey = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};
const fmtTime = (ts) => {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
  } catch { return "—"; }
};
const fmtVol = (ml) => {
  if (ml == null || ml === "" || isNaN(Number(ml))) return "—";
  return `${Number(ml).toFixed(0)} mL`;
};

/* ── Status pill for admin records ── */
const STATUS_STYLE = {
  given:        { bg: "#dcfce7", color: "#15803d", border: "#86efac", icon: "✓", label: "Given" },
  pending:      { bg: "#e0f2fe", color: "#0369a1", border: "#7dd3fc", icon: "⏳", label: "Pending" },
  hold:         { bg: "#fef3c7", color: "#92400e", border: "#fbbf24", icon: "⏸", label: "Hold" },
  not_available:{ bg: "#fee2e2", color: "#b91c1c", border: "#fca5a5", icon: "✗", label: "Not Available" },
  delayed:      { bg: "#fde68a", color: "#92400e", border: "#facc15", icon: "↻", label: "Delayed" },
  skipped:      { bg: "#e2e8f0", color: "#475569", border: "#cbd5e1", icon: "⊘", label: "Skipped" },
  refused:      { bg: "#fee2e2", color: "#b91c1c", border: "#fca5a5", icon: "✗", label: "Refused" },
  partial:      { bg: "#fef3c7", color: "#92400e", border: "#fbbf24", icon: "◐", label: "Partial" },
  missed:       { bg: "#fee2e2", color: "#b91c1c", border: "#fca5a5", icon: "!", label: "Missed" },
};

const StatusPill = ({ status, time, by, notes, modified, isStat }) => {
  const cfg = STATUS_STYLE[status] || STATUS_STYLE.pending;
  return (
    <div
      title={notes || `${cfg.label}${isStat ? " · STAT" : ""}${time ? " · " + fmtTime(time) : ""}${by ? " · " + by : ""}`}
      style={{
        display: "inline-flex", flexDirection: "column", alignItems: "stretch", gap: 1,
        padding: "3px 7px", borderRadius: 5,
        // R7hr-146 — STAT doses get a red border + slight red tint so
        // they're unmistakable in the day digest. Pre-fix a STAT dose
        // looked identical to a regularly-scheduled one (the user
        // marked the "11:25" Tab PCM STAT dose by hand on the
        // screenshot — that information was completely invisible).
        border: `1px solid ${isStat ? C.red : cfg.border}`,
        background: isStat ? "#fff1f2" : cfg.bg,
        color: cfg.color, fontSize: 10, fontWeight: 700, minWidth: 60,
        position: "relative",
      }}
    >
      {isStat && (
        <span style={{
          position: "absolute", top: -7, right: -6,
          background: C.red, color: "#fff", fontSize: 8, fontWeight: 800,
          padding: "1px 5px", borderRadius: 8, letterSpacing: ".3px",
          border: "1px solid #fff",
        }}>
          STAT
        </span>
      )}
      <span>{cfg.icon} {cfg.label}{modified && !isStat ? " ✎" : ""}</span>
      {time && <span style={{ fontSize: 9, fontWeight: 500 }}>{fmtTime(time)}</span>}
      {by && <span style={{ fontSize: 9, fontWeight: 500, opacity: 0.85 }}>{by}</span>}
    </div>
  );
};

/* ── Section header ── */
const SectionHead = ({ icon, title, count, accent = C.blue, accentL = C.blueL }) => (
  <div
    style={{
      padding: "8px 12px", borderBottom: `1px solid ${C.border}`,
      background: accentL, display: "flex", alignItems: "center", gap: 8,
    }}
  >
    <span style={{ fontSize: 14 }}>{icon}</span>
    <span style={{ fontWeight: 800, fontSize: 13, color: accent }}>{title}</span>
    {count != null && (
      <span style={{
        marginLeft: "auto", fontSize: 10, color: accent, background: "white",
        border: `1px solid ${accent}`, padding: "1px 7px", borderRadius: 10, fontWeight: 700,
      }}>
        {count}
      </span>
    )}
  </div>
);

const TableShell = ({ children }) => (
  <div style={{ overflowX: "auto" }}>
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, color: C.text }}>
      {children}
    </table>
  </div>
);

const Th = ({ children, w }) => (
  <th
    style={{
      padding: "6px 8px", textAlign: "left", borderBottom: `1.5px solid ${C.border}`,
      background: C.slateL, fontWeight: 700, fontSize: 11, color: C.slate, width: w,
      whiteSpace: "nowrap",
    }}
  >
    {children}
  </th>
);

const Td = ({ children, mono, color, bold, w, align }) => (
  <td
    style={{
      padding: "6px 8px", borderBottom: `1px solid ${C.borderL}`, verticalAlign: "top",
      fontFamily: mono ? "ui-monospace,monospace" : undefined, color: color || undefined,
      fontWeight: bold ? 700 : undefined, width: w, textAlign: align || "left",
    }}
  >
    {children}
  </td>
);

const Empty = ({ msg }) => (
  <div style={{ padding: "12px 14px", fontSize: 12, color: C.muted, fontStyle: "italic" }}>
    {msg}
  </div>
);

/* ════════════════════════════════════════════════════
 * 1) VITALS CHART
 * ════════════════════════════════════════════════════ */
function VitalsSection({ vitalSheetForDay }) {
  const rows = useMemo(() => {
    if (!vitalSheetForDay || !Array.isArray(vitalSheetForDay.tableData)) return [];
    return [...vitalSheetForDay.tableData].sort((a, b) =>
      (a.time || "").localeCompare(b.time || ""),
    );
  }, [vitalSheetForDay]);

  const getVal = (row, key) => {
    const v = row?.values?.[key];
    if (v == null) return "";
    if (typeof v === "object") return v.value ?? "";
    return v;
  };

  if (!rows.length) {
    return (
      <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden", marginBottom: 12 }}>
        <SectionHead icon="📈" title="Vitals Chart" accent={C.red} accentL={C.redL} />
        <Empty msg="No vitals saved on this day." />
      </div>
    );
  }

  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden", marginBottom: 12 }}>
      <SectionHead icon="📈" title="Vitals Chart" count={rows.length} accent={C.red} accentL={C.redL} />
      <TableShell>
        <thead>
          <tr>
            <Th w={70}>Time</Th>
            <Th w={80}>BP</Th>
            <Th w={50}>HR</Th>
            <Th w={60}>SpO₂</Th>
            <Th w={60}>Temp</Th>
            <Th w={50}>RR</Th>
            <Th w={50}>Pain</Th>
            <Th w={60}>RBS</Th>
            <Th>Recorded by</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const sbp = getVal(r, "BP Systolic");
            const dbp = getVal(r, "BP Diastolic");
            const bp = sbp && dbp ? `${sbp}/${dbp}` : (sbp || dbp || "—");
            return (
              <tr key={i}>
                <Td mono bold>{r.time || "—"}</Td>
                <Td mono>{bp}</Td>
                <Td mono>{getVal(r, "Pulse") || "—"}</Td>
                <Td mono>{getVal(r, "SpO2") || "—"}</Td>
                <Td mono>{getVal(r, "Temperature") || "—"}</Td>
                <Td mono>{getVal(r, "Resp Rate") || "—"}</Td>
                <Td mono>{getVal(r, "Pain Score") || "—"}</Td>
                <Td mono>{getVal(r, "BSL") || "—"}</Td>
                <Td color={C.muted}>{r.nurse || r.recordedBy || "—"}</Td>
              </tr>
            );
          })}
        </tbody>
      </TableShell>
    </div>
  );
}

/* ════════════════════════════════════════════════════
 * 2) MEDICATIONS — drug × scheduled doses × status
 * ════════════════════════════════════════════════════ */
function MedicationsSection({ medOrders, day }) {
  // Filter administrations to ones that either fall on this day, or are
  // still pending (scheduledDate matches the day too).
  const dayKey = dateKey(day);
  const rows = useMemo(() => {
    return medOrders
      .map((o) => {
        const admins = (o.administrationRecord || [])
          .filter((a) => {
            // Match by scheduledDate if present, else fall back to givenAt date.
            if (a.scheduledDate) return dateKey(a.scheduledDate) === dayKey;
            if (a.givenAt) return dateKey(a.givenAt) === dayKey;
            return false;
          })
          .sort((a, b) => (a.scheduledTime || "").localeCompare(b.scheduledTime || ""));
        if (!admins.length) return null;
        const det = o.orderDetails || {};
        return {
          id: o._id,
          drugName: det.medicineName || det.drugName || "Unnamed",
          dose: det.dose || "—",
          route: det.route || "—",
          freq: det.frequency || "—",
          ham: o.hamFlag === true,
          indication: det.indication || det.directionOfUse || "—",
          admins,
        };
      })
      .filter(Boolean);
  }, [medOrders, dayKey]);

  // Tally
  const tally = useMemo(() => {
    const t = { given: 0, pending: 0, modified: 0, held: 0, refused: 0, missed: 0 };
    rows.forEach((r) => r.admins.forEach((a) => {
      if (a.status === "given") t.given++;
      else if (a.status === "pending") t.pending++;
      else if (a.status === "hold") t.held++;
      else if (a.status === "refused" || a.status === "skipped" || a.status === "not_available") t.refused++;
      else if (a.status === "missed") t.missed++;
      if (a.status === "delayed" || a.status === "partial") t.modified++;
    }));
    return t;
  }, [rows]);

  if (!rows.length) {
    return (
      <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden", marginBottom: 12 }}>
        <SectionHead icon="💊" title="Medications Administered" accent={C.purple} accentL={C.purpleL} />
        <Empty msg="No medication doses scheduled or recorded for this day." />
      </div>
    );
  }

  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden", marginBottom: 12 }}>
      <SectionHead icon="💊" title="Medications Administered" count={rows.length} accent={C.purple} accentL={C.purpleL} />

      {/* Tally strip */}
      <div style={{
        padding: "6px 12px", background: "#fafbff", borderBottom: `1px solid ${C.borderL}`,
        display: "flex", gap: 14, flexWrap: "wrap", fontSize: 11, fontWeight: 700,
      }}>
        <span style={{ color: C.green }}>✓ Given: {tally.given}</span>
        <span style={{ color: C.blue }}>⏳ Pending: {tally.pending}</span>
        <span style={{ color: C.amber }}>✎ Modified: {tally.modified}</span>
        <span style={{ color: C.amber }}>⏸ Held: {tally.held}</span>
        <span style={{ color: C.red }}>✗ Refused / N/A: {tally.refused}</span>
        {tally.missed > 0 && <span style={{ color: C.red }}>! Missed: {tally.missed}</span>}
      </div>

      <TableShell>
        <thead>
          <tr>
            <Th>Drug</Th>
            <Th w={90}>Dose</Th>
            <Th w={60}>Route</Th>
            <Th w={60}>Freq</Th>
            <Th>Today's Doses</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <Td bold>
                <div>{r.drugName} {r.ham && <span style={{
                  background: C.redL, color: C.red, fontSize: 9, padding: "1px 5px",
                  borderRadius: 3, marginLeft: 4, fontWeight: 800,
                }}>HAM</span>}</div>
                {r.indication !== "—" && (
                  <div style={{ fontSize: 10, color: C.muted, fontWeight: 400 }}>
                    Ind: {r.indication}
                  </div>
                )}
              </Td>
              <Td mono>{r.dose}</Td>
              <Td>{r.route}</Td>
              <Td bold color={C.blue}>{r.freq}</Td>
              <Td>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {r.admins.map((a, i) => (
                    <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
                      <div style={{ fontSize: 10, color: C.muted, fontWeight: 700 }}>{a.scheduledTime || "—"}</div>
                      <StatusPill
                        status={a.status}
                        time={a.givenAt}
                        by={a.givenBy}
                        notes={a.notes || a.holdReason || a.delayReason || a.statReason}
                        modified={a.status === "delayed" || a.status === "partial"}
                        isStat={!!a.isStatDose}
                      />
                    </div>
                  ))}
                </div>
              </Td>
            </tr>
          ))}
        </tbody>
      </TableShell>
    </div>
  );
}

/* ════════════════════════════════════════════════════
 * 3) INFUSIONS — rate, started/stopped, rate-change log with reason
 * ════════════════════════════════════════════════════ */
function InfusionsSection({ infOrders, day }) {
  const dayKey = dateKey(day);

  // Show infusions that were running at any point during this day
  // (started before end-of-day AND not stopped before start-of-day).
  const dayStart = new Date(day); dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(day); dayEnd.setHours(23, 59, 59, 999);

  const rows = useMemo(() => {
    // R7hr-138 — One infusion = one card. Pre-fix every order whose
    // [start, stop] window intersected the day's window was rendered as
    // a full card, so a 14h infusion that crossed midnight appeared in
    // BOTH yesterday's AND today's digest with identical 100ml/100%/
    // started-by/completed-by ribbons. Surveyors / doctors read that as
    // "two infusions given" — a real reconciliation hazard.
    //
    // New rule:
    //  • Anchor the FULL card to the day the infusion STARTED.
    //  • On a later day where the infusion was still running, only
    //    surface the row if that day produced fresh activity (a rate
    //    change or a nurse monitoring entry). The row is flagged
    //    `isCarryOver` so the renderer paints a "↪ Carried over from
    //    [start date]" badge instead of duplicating the audit ribbon.
    //  • Orders without an infusionStarted stamp fall back to the
    //    legacy "show if anything happened today" rule so standalone
    //    rate-change / monitoring logs still surface somewhere.
    return infOrders
      .map((o) => {
        const started = o.infusionStarted ? new Date(o.infusionStarted) : null;
        const stopped = o.infusionStopped ? new Date(o.infusionStopped) : null;
        // Not started yet by end of day -> skip.
        if (started && started > dayEnd) return null;
        // Stopped before this day -> skip.
        if (stopped && stopped < dayStart) return null;

        const todaysRateChanges = (o.rateChanges || []).filter((rc) =>
          sameDay(rc.changedAt, day),
        );
        const todaysMonitor = (o.infusionMonitoring || []).filter((m) =>
          sameDay(m.time, day),
        );
        const hasActivityToday = todaysRateChanges.length > 0 || todaysMonitor.length > 0;

        let isCarryOver = false;
        let carryFromDate = null;
        if (!started) {
          if (!hasActivityToday) return null;
        } else if (!sameDay(started, day)) {
          // Carry-over day — only render if SOMETHING happened today.
          if (!hasActivityToday) return null;
          isCarryOver = true;
          carryFromDate = started;
        }

        const det = o.orderDetails || {};
        return {
          id: o._id,
          // R7hr-136 — infusion orderDetails actually use `fluidName` +
          // `displayName` + `totalVolume` (set by InfusionPanel + R7hr-97
          // IA fan-out). Pre-fix we only read medicineName/drugName/fluidType
          // and volume/volumeML — none of which the producer writes — so
          // every row collapsed to "💧 Fluid · Vol: —".
          fluid: det.fluidName || det.displayName || det.medicineName || det.drugName || det.fluidType || "Fluid",
          volume: det.totalVolume || det.volume || det.volumeML || "—",
          rate: o.currentRate || det.rate || "—",
          route: det.route || "",
          duration: det.duration || "",
          additives: det.additives || "",
          notes: det.notes || "",
          dilutionVolume: det.dilutionVolume,
          dilutionFluid: det.dilutionFluid,
          started: o.infusionStarted,
          stopped: o.infusionStopped || o.completedAt,
          stopReason: o.stopReason,
          startedBy: o.acknowledgedBy || "",
          stoppedBy: o.completedBy || "",
          hamFlag: !!o.hamFlag,
          status: o.status,
          rateChanges: todaysRateChanges,
          monitor: todaysMonitor,
          isCarryOver,
          carryFromDate,
        };
      })
      .filter(Boolean);
  }, [infOrders, dayKey]);

  if (!rows.length) {
    return (
      <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden", marginBottom: 12 }}>
        <SectionHead icon="💧" title="Infusions" accent={C.teal} accentL={C.tealL} />
        <Empty msg="No infusions running on this day." />
      </div>
    );
  }

  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden", marginBottom: 12 }}>
      <SectionHead icon="💧" title="Infusions" count={rows.length} accent={C.teal} accentL={C.tealL} />
      {rows.map((r) => (
        <div key={r.id} style={{ borderBottom: `1px solid ${C.borderL}`, padding: "10px 12px" }}>
          {/* R7hr-136 — Richer infusion row.
              Title line (drug + HAM badge + status pill) sits on top.
              Second line carries the regimen detail (vol / route / rate /
              duration / dilution / additives) so a surveyor or doctor
              reading the per-day digest can see WHAT was running, not
              just "Fluid 25 ml/hr". Audit-row (start/stop + actors) sits
              under that as its own grid.                                 */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 4 }}>
            <div style={{ fontWeight: 800, color: C.teal, fontSize: 14 }}>💧 {r.fluid}</div>
            {r.hamFlag && (
              <span style={{ background: "#fef2f2", color: C.red, border: `1px solid #fecaca`, padding: "0 6px", borderRadius: 4, fontSize: 10, fontWeight: 800 }}>
                ● HAM
              </span>
            )}
            {/* R7hr-138 — Carry-over badge. On days AFTER the start day
                this surfaces "↪ Carried over from [date]" so the row is
                visually distinct from the anchor card on the start day.
                Prevents the surveyor reading the same infusion twice. */}
            {r.isCarryOver && r.carryFromDate && (
              <span style={{ background: C.blueL, color: C.blue, border: `1px solid ${C.blueB}`, padding: "1px 8px", borderRadius: 10, fontSize: 10, fontWeight: 700 }}>
                ↪ Carried over from {new Date(r.carryFromDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
              </span>
            )}
            <span style={{
              marginLeft: "auto",
              background: r.status === "Completed" ? C.greenL : r.status === "Stopped" ? C.redL : C.amberL,
              color:      r.status === "Completed" ? C.green  : r.status === "Stopped" ? C.red  : C.amber,
              padding: "2px 9px", borderRadius: 10, fontWeight: 800, fontSize: 11,
            }}>
              {r.status === "Completed" ? "✓ " : r.status === "Stopped" ? "⏹ " : ""}{r.status}
            </span>
          </div>

          {/* Regimen detail line — vol / rate / route / duration / dilution / additives */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, fontSize: 11, color: C.slate, marginBottom: 6 }}>
            <div><b style={{ color: C.muted, fontWeight: 700 }}>Vol:</b> <span style={{ fontFamily: "monospace", fontWeight: 700 }}>{r.volume}</span></div>
            <div><b style={{ color: C.muted, fontWeight: 700 }}>Rate:</b> <span style={{
              background: C.tealL, padding: "1px 7px", borderRadius: 3, fontWeight: 800, color: C.teal,
            }}>{r.rate}</span></div>
            {r.route && <div><b style={{ color: C.muted, fontWeight: 700 }}>Route:</b> {r.route}</div>}
            {r.duration && <div><b style={{ color: C.muted, fontWeight: 700 }}>Duration:</b> {r.duration}</div>}
            {r.dilutionVolume && (
              <div><b style={{ color: C.muted, fontWeight: 700 }}>Dilution:</b> {r.dilutionVolume} ml {r.dilutionFluid || ""}</div>
            )}
            {r.additives && <div><b style={{ color: C.muted, fontWeight: 700 }}>Additives:</b> {r.additives}</div>}
          </div>

          {/* R7hr-138 — Audit-row (Started/Completed/Notes) renders ONLY
              on the start day. On a carry-over day the full audit ribbon
              would be a duplicate of the anchor card and would mislead a
              surveyor into thinking the infusion was started AGAIN today.
              The carry-over day still shows the rate-change log + nursing
              monitor entries that fall on this day (below). */}
          {!r.isCarryOver && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 8, fontSize: 11 }}>
              <div style={{ background: "#f8fafc", border: `1px solid ${C.borderL}`, borderRadius: 6, padding: "5px 9px" }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".5px" }}>Started</div>
                <div style={{ fontWeight: 700, color: C.slate }}>
                  {fmtTime(r.started)}{r.started ? ` · ${new Date(r.started).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}` : ""}
                </div>
                {r.startedBy && <div style={{ fontSize: 10, color: C.muted }}>by {r.startedBy}</div>}
              </div>
              {r.stopped && (
                <div style={{ background: "#f8fafc", border: `1px solid ${C.borderL}`, borderRadius: 6, padding: "5px 9px" }}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".5px" }}>
                    {r.status === "Completed" ? "Completed" : "Stopped"}
                  </div>
                  <div style={{ fontWeight: 700, color: C.slate }}>
                    {fmtTime(r.stopped)}{r.stopped ? ` · ${new Date(r.stopped).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}` : ""}
                  </div>
                  {r.stoppedBy && <div style={{ fontSize: 10, color: C.muted }}>by {r.stoppedBy}</div>}
                  {r.stopReason && <div style={{ fontSize: 10, color: C.muted, fontStyle: "italic" }}>{r.stopReason}</div>}
                </div>
              )}
              {r.notes && (
                <div style={{ background: "#fffbeb", border: `1px solid #fde68a`, borderRadius: 6, padding: "5px 9px" }}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".5px" }}>Notes</div>
                  <div style={{ fontSize: 11, color: C.slate }}>{r.notes}</div>
                </div>
              )}
            </div>
          )}

          {/* Rate change log */}
          {r.rateChanges.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.amber, marginBottom: 3 }}>
                ✎ Rate changes today ({r.rateChanges.length}):
              </div>
              <TableShell>
                <thead>
                  <tr>
                    <Th w={70}>Time</Th>
                    <Th w={120}>Change</Th>
                    <Th>Reason</Th>
                    <Th>Changed by</Th>
                    <Th w={80}>Dr informed</Th>
                  </tr>
                </thead>
                <tbody>
                  {r.rateChanges.map((rc, i) => (
                    <tr key={i}>
                      <Td mono bold>{fmtTime(rc.changedAt)}</Td>
                      <Td mono color={C.amber}><b>{rc.oldRate || "—"}</b> → <b>{rc.newRate || "—"}</b></Td>
                      <Td>
                        <div style={{ fontWeight: 700, color: C.slate }}>{rc.reason || "—"}</div>
                        {rc.reasonDetail && <div style={{ fontSize: 10, color: C.muted }}>{rc.reasonDetail}</div>}
                      </Td>
                      <Td color={C.muted}>{rc.changedBy || "—"}</Td>
                      <Td align="center">
                        {rc.doctorInformed
                          ? <span title={rc.doctorName || ""} style={{ color: C.green, fontWeight: 800 }}>✓ Yes</span>
                          : <span style={{ color: C.muted }}>—</span>}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </TableShell>
            </div>
          )}

          {/* Hourly monitor entries */}
          {r.monitor.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.teal, marginBottom: 3 }}>
                🕒 Hourly nursing monitor ({r.monitor.length}):
              </div>
              <TableShell>
                <thead>
                  <tr>
                    <Th w={70}>Time</Th>
                    <Th w={70}>Rate</Th>
                    <Th w={70}>BP</Th>
                    <Th w={50}>Pulse</Th>
                    <Th w={60}>SpO₂</Th>
                    <Th w={70}>Volume</Th>
                    <Th w={80}>Site</Th>
                    <Th>Action / Remarks</Th>
                    <Th>Nurse</Th>
                  </tr>
                </thead>
                <tbody>
                  {r.monitor.map((m, i) => (
                    <tr key={i}>
                      <Td mono>{fmtTime(m.time)}</Td>
                      <Td mono>{m.currentRate || "—"}</Td>
                      <Td mono>{m.bp || "—"}</Td>
                      <Td mono>{m.pulse || "—"}</Td>
                      <Td mono>{m.spo2 || "—"}</Td>
                      <Td mono>{m.volumeInfused || "—"}</Td>
                      <Td>{m.siteCondition || "—"}</Td>
                      <Td>
                        <div style={{ fontWeight: 700 }}>{m.action || "—"}</div>
                        {m.remarks && <div style={{ fontSize: 10, color: C.muted }}>{m.remarks}</div>}
                      </Td>
                      <Td color={C.muted}>{m.nurse || "—"}</Td>
                    </tr>
                  ))}
                </tbody>
              </TableShell>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ════════════════════════════════════════════════════
 * 4) INTAKE / OUTPUT
 * ════════════════════════════════════════════════════ */
function IntakeOutputSection({ ioRowsForDay }) {
  const rows = (ioRowsForDay || []).slice().sort((a, b) =>
    new Date(a.ts || 0) - new Date(b.ts || 0),
  );

  const totals = useMemo(() => {
    let in_ = 0, out = 0;
    rows.forEach((r) => {
      const v = Number(r.volumeML) || 0;
      // R7hr-127 B1 — IntakeOutputEntryModel persists direction as the
      // enum ["IN","OUT"] (uppercase). Pre-127 we compared with "in" /
      // "out" lowercase so every row silently fell through both
      // branches, leaving In:0 mL · Out:0 mL · Net:0 even on patients
      // who had hourly infusion auto-rows. Normalising to uppercase
      // makes the check case-tolerant in case any source ever writes
      // lowercase.
      const dir = String(r.direction || "").toUpperCase();
      if (dir === "IN") in_ += v;
      else if (dir === "OUT") out += v;
    });
    return { in: in_, out, net: in_ - out };
  }, [rows]);

  if (!rows.length) {
    return (
      <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden", marginBottom: 12 }}>
        <SectionHead icon="🥛" title="Intake / Output" accent={C.blue} accentL={C.blueL} />
        <Empty msg="No intake or output entries recorded for this day." />
      </div>
    );
  }

  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden", marginBottom: 12 }}>
      <SectionHead icon="🥛" title="Intake / Output" count={rows.length} accent={C.blue} accentL={C.blueL} />

      {/* Totals strip */}
      <div style={{
        padding: "6px 12px", background: "#fafbff", borderBottom: `1px solid ${C.borderL}`,
        display: "flex", gap: 16, flexWrap: "wrap", fontSize: 11, fontWeight: 700,
      }}>
        <span style={{ color: C.green }}>⬇ In: {fmtVol(totals.in)}</span>
        <span style={{ color: C.amber }}>⬆ Out: {fmtVol(totals.out)}</span>
        <span style={{ color: totals.net >= 0 ? C.green : C.red }}>
          Σ Net: {totals.net >= 0 ? "+" : ""}{fmtVol(totals.net)}
        </span>
      </div>

      <TableShell>
        <thead>
          <tr>
            <Th w={70}>Time</Th>
            <Th w={60}>Dir</Th>
            <Th w={80}>Volume</Th>
            <Th>Fluid / Label</Th>
            <Th>Notes</Th>
            <Th>Recorded by</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            // R7hr-127 B1 — direction is uppercase "IN"/"OUT" on the
            // backend enum; normalise once per row so the colour pill
            // matches the totals tally above.
            const dir = String(r.direction || "").toUpperCase();
            const isIn = dir === "IN";
            return (
            <tr key={r._id || i} style={r.voided ? { opacity: 0.45, textDecoration: "line-through" } : undefined}>
              <Td mono>{fmtTime(r.ts)}</Td>
              <Td bold color={isIn ? C.green : C.amber}>
                {isIn ? "⬇ In" : "⬆ Out"}
              </Td>
              <Td mono bold>{fmtVol(r.volumeML)}</Td>
              <Td>
                <div style={{ fontWeight: 700 }}>{r.fluidType || r.label || "—"}</div>
                {r.label && r.fluidType && r.label !== r.fluidType && (
                  <div style={{ fontSize: 10, color: C.muted }}>{r.label}</div>
                )}
              </Td>
              <Td color={C.muted}>{r.notes || "—"}</Td>
              <Td color={C.muted}>{r.recordedBy?.name || r.recordedBy || "—"}</Td>
            </tr>
            );
          })}
        </tbody>
      </TableShell>
    </div>
  );
}

/* ════════════════════════════════════════════════════
 * 5) OTHER OBSERVATIONS — any other staff-submitted item for the day
 * ════════════════════════════════════════════════════ */
function OtherObservationsSection({ otherItems }) {
  if (!otherItems || !otherItems.length) {
    return (
      <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden", marginBottom: 12 }}>
        <SectionHead icon="📋" title="Other Observations" accent={C.slate} accentL={C.slateL} />
        <Empty msg="No additional assessments or observations recorded for this day." />
      </div>
    );
  }

  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden", marginBottom: 12 }}>
      <SectionHead icon="📋" title="Other Observations" count={otherItems.length} accent={C.slate} accentL={C.slateL} />
      <TableShell>
        <thead>
          <tr>
            <Th w={70}>Time</Th>
            <Th w={140}>Kind</Th>
            <Th>Details</Th>
            <Th>Recorded by</Th>
          </tr>
        </thead>
        <tbody>
          {otherItems.map((it, i) => (
            <tr key={i}>
              <Td mono>{fmtTime(it.ts)}</Td>
              <Td bold color={it.color || C.slate}>{it.kind || "—"}</Td>
              <Td>{it.details || "—"}</Td>
              <Td color={C.muted}>{it.by || "—"}</Td>
            </tr>
          ))}
        </tbody>
      </TableShell>
    </div>
  );
}

/* ════════════════════════════════════════════════════
 * Composite digest — orchestrates all five sections
 * ════════════════════════════════════════════════════ */
export default function TreatmentChartDayDigest({
  day,                       // Date — the calendar day this card represents
  vitalSheetForDay = null,   // single vitalsheet doc matched on date
  medOrders        = [],     // DoctorOrder docs of type Medication
  infOrders        = [],     // DoctorOrder docs of type IV_Fluid
  ioRowsForDay     = [],     // intake/output rows already filtered for this day
  otherItems       = [],     // any extra staff-submitted observations
  printMode        = false,  // R7hr-152.1 — strict print: only Vitals + Meds
                             // + Infusions + Intake/Output (4 sections), no
                             // "Other Observations" tail. Suppresses the 5th
                             // section so the printed sheet exactly matches
                             // the user's spec.
}) {
  return (
    <div style={{ padding: "10px 14px", background: "#fcfdff" }}>
      <VitalsSection vitalSheetForDay={vitalSheetForDay} />
      <MedicationsSection medOrders={medOrders} day={day} />
      <InfusionsSection infOrders={infOrders} day={day} />
      <IntakeOutputSection ioRowsForDay={ioRowsForDay} />
      {!printMode && <OtherObservationsSection otherItems={otherItems} />}
    </div>
  );
}
