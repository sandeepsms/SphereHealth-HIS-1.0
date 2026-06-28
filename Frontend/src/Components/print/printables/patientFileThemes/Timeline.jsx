// R7ft Theme 2 — Chronological Journal / Day-Diary
//
// Single vertical timeline.  After a 1-page patient ID + diagnosis
// card, every clinical event (admission · Initial Assessment · vitals
// · doctor note · nursing note · investigation order · investigation
// result · medication start/stop · procedure · discharge) appears as
// a date-time-stamped entry in strict ascending chronological order.
// This is the killer feature for MLC / NABH inspector / legal audit
// traceability — every clinically significant event in one stream.
//
// Layout:
//   Page 1 — Patient summary card (identity + admission/discharge +
//            diagnoses + consultant/ward/bed), allergy/isolation
//            callout, LOS + event-count footer.
//   Page 2+ — Vertical timeline with day-divider banners between
//             calendar days.  Narrow left date-time gutter (60mm) +
//             main content column with a 1px rail and coloured dot
//             per event kind.
//
// Forensic / serious vibe.  Body 10pt, line-height 1.4, gutter in
// DM Mono.  Target page count: ~5 A4 for a 4-day demo admission.

import React from "react";
import PrintShell from "@/templates/PrintShell";
import { fmtDate, fmtTime } from "./normalizeData";

/* ── Event-kind metadata (colour + label) ──────────────────────── */
const KIND_META = {
  admission:     { color: "#4f46e5", label: "ADMISSION"     },
  discharge:     { color: "#059669", label: "DISCHARGE"     },
  "ia-doctor":   { color: "#7c3aed", label: "IA-DOCTOR"     },
  "ia-nursing":  { color: "#db2777", label: "IA-NURSING"    },
  "doctor-note": { color: "#4f46e5", label: "DOCTOR-NOTE"   },
  "nursing-note":{ color: "#db2777", label: "NURSING-NOTE"  },
  "lab-order":   { color: "#ea580c", label: "LAB-ORDER"     },
  "lab-report":  { color: "#16a34a", label: "LAB-REPORT"    },
  "med-start":   { color: "#0891b2", label: "MED-START"     },
  "med-stop":    { color: "#6b7280", label: "MED-STOP"      },
  procedure:     { color: "#be123c", label: "PROCEDURE"     },
};

/* ── Day-divider helpers ───────────────────────────────────────── */
const DAY_NAMES = [
  "Sunday", "Monday", "Tuesday", "Wednesday",
  "Thursday", "Friday", "Saturday",
];

const dayKey = (d) => {
  const dt = new Date(d);
  return `${dt.getFullYear()}-${dt.getMonth()}-${dt.getDate()}`;
};

const fmtBannerDate = (d) => {
  if (!d) return "";
  const dt = new Date(d);
  const day = DAY_NAMES[dt.getDay()];
  return `${day}, ${fmtDate(d)}`;
};

const computeLOS = (admit, discharge) => {
  if (!admit) return null;
  const end = discharge || new Date();
  const ms  = new Date(end).getTime() - new Date(admit).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  // Calendar-day inclusive count (4-day stay = admit + 3 nights + discharge)
  const days = Math.floor(ms / 86400000) + 1;
  return Math.max(1, days);
};

/* ── Reusable mini-components ──────────────────────────────────── */
const CardKV = ({ label, value }) => (
  <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 6, fontSize: 10.5, padding: "3px 0" }}>
    <span style={{ color: "#64748b", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3, fontSize: 9 }}>
      {label}
    </span>
    <span style={{ color: "#0f172a" }}>{value || "—"}</span>
  </div>
);

const SectionRow = ({ title, children }) => (
  <div style={{
    borderTop:    "1px solid #e2e8f0",
    paddingTop:   8,
    marginTop:    10,
  }}>
    <div style={{
      fontSize:       9,
      fontWeight:     700,
      letterSpacing:  0.6,
      textTransform:  "uppercase",
      color:          "#3730a3",
      marginBottom:   6,
    }}>{title}</div>
    {children}
  </div>
);

/* ── Patient summary card (page 1) ─────────────────────────────── */
const SummaryCard = ({ file, eventCount, losDays }) => {
  const a = file.admission;
  const p = file.patient;
  const ageSex = [p.age && `${p.age} y`, p.gender].filter(Boolean).join(" · ");

  const diagnoses = [
    a.provisionalDiagnosis && `Provisional: ${a.provisionalDiagnosis}`,
    a.workingDiagnosis     && `Working:     ${a.workingDiagnosis}`,
    a.finalDiagnosis       && `Final:       ${a.finalDiagnosis}`,
    (a.icd10 || a.icd10Desc) && `ICD-10:      ${[a.icd10, a.icd10Desc].filter(Boolean).join(" · ")}`,
  ].filter(Boolean);

  const hasAllergies = (file.alerts?.allergies?.length || 0) > 0;
  const hasIsolation = (file.alerts?.isolationFlags?.length || 0) > 0;

  return (
    <div style={{ pageBreakAfter: "always", breakAfter: "page" }}>
      {/* ── Forensic-style banner above the card ─────────────── */}
      <div style={{
        background:    "#0f172a",
        color:         "#f8fafc",
        padding:       "6px 12px",
        fontSize:      9.5,
        fontWeight:    700,
        letterSpacing: 1,
        textTransform: "uppercase",
        textAlign:     "center",
        marginBottom:  14,
      }}>
        Chronological Journal · Medico-Legal Record · Single Source of Truth
      </div>

      {/* ── Patient identity row ─────────────────────────────── */}
      <SectionRow title="Patient Identification">
        <CardKV label="Full Name"  value={p.fullName} />
        <CardKV label="UHID / IPD" value={[file.meta.uhid, file.meta.ipdNo].filter(Boolean).join("  ·  ")} />
        <CardKV label="Age / Sex"  value={ageSex} />
        <CardKV label="Contact"    value={p.mobile} />
        <CardKV label="Blood Group" value={p.bloodGroup} />
        <CardKV label="Address"    value={p.address} />
      </SectionRow>

      {/* ── Admission row ────────────────────────────────────── */}
      <SectionRow title="Admission & Discharge">
        <CardKV label="Admitted"   value={fmtDate(a.date, true)} />
        <CardKV label="Discharged" value={fmtDate(a.dischargeDate, true)} />
        <CardKV label="Admission Type" value={a.type} />
        <CardKV label="Mode of Arrival" value={a.modeOfArrival} />
        <CardKV label="Referring Dr."   value={a.referringDoctor} />
      </SectionRow>

      {/* ── Diagnoses row ────────────────────────────────────── */}
      <SectionRow title="Diagnoses (provisional → working → final)">
        {diagnoses.length === 0 ? (
          <div style={{ fontSize: 10.5, color: "#94a3b8", fontStyle: "italic" }}>
            No diagnosis recorded.
          </div>
        ) : diagnoses.map((line, i) => (
          <div key={i} style={{
            fontFamily: "'DM Mono', 'Courier New', monospace",
            fontSize:    10,
            color:       "#0f172a",
            padding:     "2px 0",
            whiteSpace:  "pre",
          }}>{line}</div>
        ))}
      </SectionRow>

      {/* ── Treatment team row ───────────────────────────────── */}
      <SectionRow title="Treatment Team & Location">
        <CardKV label="Consultant" value={a.consultant} />
        <CardKV label="Department" value={a.department} />
        <CardKV label="Ward"       value={a.ward} />
        <CardKV label="Bed"        value={a.bed} />
      </SectionRow>

      {/* ── Allergy / isolation callout box ──────────────────── */}
      {(hasAllergies || hasIsolation) && (
        <div style={{
          marginTop:     14,
          border:        "2px solid #b91c1c",
          background:    "#fef2f2",
          padding:       "8px 12px",
          borderRadius:  4,
          pageBreakInside: "avoid",
          breakInside:   "avoid",
        }}>
          {hasAllergies && (
            <div style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: hasIsolation ? 4 : 0 }}>
              <span style={{
                fontSize:      10,
                fontWeight:    800,
                color:         "#991b1b",
                letterSpacing: 0.5,
                textTransform: "uppercase",
                whiteSpace:    "nowrap",
              }}>Allergy Alert:</span>
              <span style={{ fontSize: 10.5, color: "#7f1d1d" }}>
                {file.alerts.allergies.map((a) => {
                  if (!a) return "";
                  if (typeof a === "string") return a;
                  return [a.allergen || a.agent, a.severity && `(${a.severity})`, a.reaction]
                    .filter(Boolean).join(" ");
                }).filter(Boolean).join(" · ")}
              </span>
            </div>
          )}
          {hasIsolation && (
            <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <span style={{
                fontSize:      10,
                fontWeight:    800,
                color:         "#991b1b",
                letterSpacing: 0.5,
                textTransform: "uppercase",
                whiteSpace:    "nowrap",
              }}>Isolation:</span>
              <span style={{ fontSize: 10.5, color: "#7f1d1d" }}>
                {file.alerts.isolationFlags.join(" · ")}
              </span>
            </div>
          )}
        </div>
      )}

      {/* ── File summary footer line ─────────────────────────── */}
      <div style={{
        marginTop:    18,
        padding:      "8px 12px",
        background:   "#f1f5f9",
        border:       "1px solid #cbd5e1",
        fontSize:     10.5,
        color:        "#334155",
        textAlign:    "center",
        letterSpacing: 0.3,
      }}>
        This file contains <strong>{eventCount}</strong> events
        {losDays != null && <> spanning <strong>{losDays}</strong> {losDays === 1 ? "day" : "days"} of admission</>}.
        Timeline begins overleaf.
      </div>
    </div>
  );
};

/* ── Day-divider banner ────────────────────────────────────────── */
const DayDividerBanner = ({ dayNumber, date }) => (
  <div style={{
    background:     "#f1f5f9",
    color:          "#3730a3",
    padding:        "4px 10px",
    margin:         "12px 0 8px",
    fontSize:       10,
    fontWeight:     700,
    letterSpacing:  0.6,
    textTransform:  "uppercase",
    textAlign:      "center",
    borderTop:      "1px solid #cbd5e1",
    borderBottom:   "1px solid #cbd5e1",
    pageBreakInside:"avoid",
    breakInside:    "avoid",
    pageBreakAfter: "avoid",
    breakAfter:     "avoid",
  }}>
    ═════ Day {dayNumber} · {fmtBannerDate(date)} ═════
  </div>
);

/* ── Single timeline row (one event) ──────────────────────────── */
const TimelineRow = ({ event }) => {
  const meta = KIND_META[event.kind] || { color: "#64748b", label: String(event.kind || "EVENT").toUpperCase() };

  // Show detail row only when it's substantively different from
  // the summary (avoid duplicating the same string twice).
  const sum  = (event.summary || "").trim();
  const det  = (event.detail  || "").trim();
  const hasDetail = det && det.length > 0 && det !== sum && !sum.includes(det);

  return (
    <div style={{
      display:         "grid",
      gridTemplateColumns: "60mm 1fr",
      gap:             0,
      pageBreakInside: "avoid",
      breakInside:     "avoid",
      marginBottom:    8,
    }}>
      {/* ── Date-time gutter ─────────────────────────────────── */}
      <div style={{
        fontFamily:    "'DM Mono', 'Courier New', monospace",
        fontSize:      9,
        color:         "#475569",
        lineHeight:    1.4,
        textAlign:     "right",
        paddingRight:  10,
        paddingTop:    2,
      }}>
        <div style={{ fontWeight: 600, color: "#0f172a" }}>
          [{fmtDate(event.at)}]
        </div>
        <div>[{fmtTime(event.at)}]</div>
      </div>

      {/* ── Rail + content column ───────────────────────────── */}
      <div style={{
        borderLeft:    "1px solid #cbd5e1",
        paddingLeft:   12,
        paddingTop:    0,
        position:      "relative",
        lineHeight:    1.4,
      }}>
        {/* coloured dot (●) hugging the rail */}
        <span style={{
          position:    "absolute",
          left:        -5.5,
          top:         3,
          width:       10,
          height:      10,
          borderRadius:"50%",
          background:  meta.color,
          border:      "2px solid #ffffff",
          boxShadow:   `0 0 0 1px ${meta.color}`,
        }} />
        <div style={{ fontSize: 10, color: "#0f172a" }}>
          <span style={{
            fontWeight:    800,
            color:         meta.color,
            letterSpacing: 0.4,
            marginRight:   6,
          }}>{meta.label}</span>
          {event.actor && (
            <span style={{ color: "#475569", fontSize: 9.5 }}>
              ({event.actor})
            </span>
          )}
        </div>
        <div style={{ fontSize: 10, color: "#0f172a", marginTop: 1 }}>
          {sum || <span style={{ color: "#94a3b8", fontStyle: "italic" }}>(no summary recorded)</span>}
        </div>
        {hasDetail && (
          <div style={{ fontSize: 9.5, color: "#334155", marginTop: 2, fontStyle: "normal" }}>
            {det}
          </div>
        )}
      </div>
    </div>
  );
};

/* ── Main theme component ─────────────────────────────────────── */
const TimelineTheme = ({ settings, file, events }) => {
  const ageSex = [file.patient.age && `${file.patient.age}Y`, file.patient.gender]
    .filter(Boolean).join(" / ");
  const losDays = file.admission.totalDays
    || computeLOS(file.admission.date, file.admission.dischargeDate);

  // Build the timeline with day-divider banners inserted whenever
  // the calendar date changes. `events` is already sorted ascending
  // by normalizeData.js — defensive filter just in case.
  const validEvents = (events || []).filter(
    (e) => e && e.at instanceof Date && !isNaN(e.at.getTime())
  );

  const timelineNodes = [];
  let lastKey   = null;
  let dayNumber = 0;
  validEvents.forEach((ev, i) => {
    const k = dayKey(ev.at);
    if (k !== lastKey) {
      dayNumber += 1;
      timelineNodes.push(
        <DayDividerBanner
          key={`day-${k}`}
          dayNumber={dayNumber}
          date={ev.at}
        />
      );
      lastKey = k;
    }
    timelineNodes.push(<TimelineRow key={`ev-${i}`} event={ev} />);
  });

  // ── PrintShell patient-strip ──────────────────────────────
  const patientLeft = [
    { label: "Name",   value: file.patient.fullName || "—" },
    { label: "UHID",   value: file.meta.uhid || "—" },
    { label: "IPD No", value: file.meta.ipdNo || "—" },
    { label: "Age/Sex", value: ageSex || "—" },
  ];
  const patientRight = [
    { label: "Admitted",   value: fmtDate(file.admission.date, true) },
    { label: "Discharged", value: fmtDate(file.admission.dischargeDate, true) },
    { label: "LOS",        value: losDays != null ? `${losDays} ${losDays === 1 ? "day" : "days"}` : "—" },
    { label: "Consultant", value: file.admission.consultant || "—" },
  ];

  return (
    <PrintShell
      hospital={settings}
      docTitle="Patient File — Chronological Journal"
      docSubtitle="Single chronological stream of every clinically significant event"
      patient={{ left: patientLeft, right: patientRight }}
      signatures={{
        type: "double",
        left:  { name: file.signatures.consultant || file.admission.consultant || "", role: "Attending Consultant" },
        right: { name: file.signatures.mro || "", role: "Medical Records Officer" },
        showAttestedStamp: true,
      }}
      banners={{ emergency24x7: true }}
      meta={{
        docNumber: file.meta.ipdNo,
        printedAt: file.meta.printedAt,
      }}
    >
      {/* ── Page 1 — Patient summary card ─────────────────── */}
      <SummaryCard
        file={file}
        eventCount={validEvents.length}
        losDays={losDays}
      />

      {/* ── Page 2+ — Vertical timeline ───────────────────── */}
      <div>
        <div style={{
          fontSize:      11,
          fontWeight:    700,
          letterSpacing: 0.5,
          textTransform: "uppercase",
          color:         "#3730a3",
          paddingBottom: 6,
          borderBottom:  "2px solid #3730a3",
          marginBottom:  10,
        }}>
          Chronological Event Timeline
        </div>

        {validEvents.length === 0 ? (
          <div style={{
            padding:     "24px 0",
            textAlign:   "center",
            fontStyle:   "italic",
            color:       "#94a3b8",
            fontSize:    11,
          }}>
            No events recorded yet.
          </div>
        ) : (
          <div style={{
            fontSize:   10,
            lineHeight: 1.4,
          }}>
            {timelineNodes}
          </div>
        )}
      </div>
    </PrintShell>
  );
};

export default TimelineTheme;
