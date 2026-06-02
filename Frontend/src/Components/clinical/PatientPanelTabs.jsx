/**
 * PatientPanelTabs — shared tab components used by both DoctorPatientPanel
 * and NursePatientPanel.
 *
 * Per the user's spec:
 *   1. First tab: Initial Assessment (Doctor + Nursing combined)
 *   2. Second tab: MLC (if patient has one) OR Doctor Notes
 *   3. Nursing Notes — categorized + FULLY EXPANDABLE for proper reading
 *      and printing
 *   4. Vital Chart
 *   5. Input / Output Chart
 *   6. Blood Transfusion Records
 *   7. RBS Monitoring + Medication for the same
 *
 * Every section is rendered FULLY EXPANDED — no truncation, no "show
 * more" tease — so the printable view shows the entire record. Styles
 * live in patient-panel-tabs.css.
 */

import React, { useEffect, useState, useMemo } from "react";
import axios from "axios";
import { API_ENDPOINTS } from "../../config/api";
import "./patient-panel-tabs.css";
// R7gn — Reuse the SAME per-type card builders that the Complete File
// (Narrative.jsx) prints. The patient panel was showing a generic
// expanded-note skeleton; the user wants the live panel to mirror the
// Complete File 1:1 — same admission/ICU/procedure/discharge/consult
// templates, same headers, same vitals tables.
import { buildDoctorNoteCardHtml } from "../../pages/doctor/buildDoctorNoteCardHtml";
import { buildNurseNoteCardHtml }  from "../../pages/nursing/printNurseNote";

/* ──────────────────────── Formatters ───────────────────────── */
const fmtDateTime = (d) =>
  d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

// R7gn — Day-bucket helpers (same shape as Narrative.jsx so the panel
// view and the printed Complete File group identically).
const dayKey = (d) => {
  if (!d) return "";
  try { return new Date(d).toISOString().slice(0, 10); } catch { return ""; }
};
const dayHeading = (d) => {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-IN", {
      day: "2-digit", month: "short", year: "numeric", weekday: "short",
    });
  } catch { return String(d); }
};
const dayNumber = (eventDate, admissionDate) => {
  if (!eventDate || !admissionDate) return null;
  const a = new Date(admissionDate);
  const e = new Date(eventDate);
  if (Number.isNaN(a.getTime()) || Number.isNaN(e.getTime())) return null;
  const diff = Math.floor((dayKeyToMidnight(e) - dayKeyToMidnight(a)) / 86_400_000);
  return diff >= 0 ? diff + 1 : null;
};
const dayKeyToMidnight = (d) => {
  const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime();
};

/* R7gn — Wraps the Complete File per-type card HTML so the patient
   panel and the printed file show identical artwork. The builder
   returns a self-contained HTML string with its own inline styles
   (.dfx-* / .nfx-* classes) — safe to drop in via dangerouslySetInnerHTML.
*/
function NoteCardEmbed({ note, role }) {
  const html = role === "nurse"
    ? buildNurseNoteCardHtml(note)
    : buildDoctorNoteCardHtml(note);
  return (
    <div
      className={`ppt-embed-card ppt-embed-card--${role}`}
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/* R7gn — Group notes by calendar day; entries inside a day are kept
   in chronological order (oldest-first) — matches Complete File.
   Day buckets themselves are ordered most-recent-day-first so the
   doctor on rounds sees today's notes at the top. */
function groupByDayChrono(notes, getAt) {
  const map = new Map();
  (notes || []).forEach((n) => {
    const at = getAt(n);
    const k = dayKey(at);
    if (!k) return;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(n);
  });
  // Oldest-first within each day
  for (const arr of map.values()) {
    arr.sort((a, b) => new Date(getAt(a)) - new Date(getAt(b)));
  }
  // Most-recent day first
  return Array.from(map.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1));
}

/* ────────────────────────────────────────────────────────────────
   1. InitialAssessmentTab
   ────────────────────────────────────────────────────────────────
   Combines Doctor's initial assessment + Nurse's initial assessment
   so the team sees the full intake picture in one place.
*/
export function InitialAssessmentTab({ doctorNotes = [], nursingNotes = [], admission }) {
  const docInitial   = doctorNotes.filter((n) => n.noteType === "initial" || n.noteType === "initialAssessment");
  const nurseInitial = nursingNotes.filter((n) => n.noteType === "initial" || n.noteType === "initialAssessment");

  return (
    <div className="ppt-tab">
      <div className="ppt-tab-header">
        <h2 className="ppt-tab-title">🩺 Initial Assessment</h2>
        <p className="ppt-tab-sub">Combined doctor + nursing intake records (NABH COP.2 + IPSG.6)</p>
      </div>

      {admission && (
        <div className="ppt-card ppt-card--admission">
          <div className="ppt-section-title">Admission Summary</div>
          <div className="ppt-detail-grid">
            <Field label="IPD / Admission No." value={admission.admissionNumber} mono />
            <Field label="Admitted On"          value={fmtDateTime(admission.admissionDate)} />
            <Field label="Reason for Admission" value={admission.reasonForAdmission} wide />
            <Field label="Provisional Diagnosis" value={admission.provisionalDiagnosis} wide />
            <Field label="Attending Doctor"     value={admission.attendingDoctor} />
            <Field label="Department"           value={admission.department} />
            <Field label="Bed / Ward"           value={[admission.bedNumber, admission.wardName].filter(Boolean).join(" — ")} />
          </div>
        </div>
      )}

      {/* R7gp — Doctor + Nurse initial assessments now use the same
          per-type card builders the printed Complete File uses. Replaces
          the legacy DoctorNoteExpanded/NurseNoteExpanded fallback that
          rendered noteDetails.nabh as raw stringified JSON. */}
      <div className="ppt-card ppt-card--doctor">
        <div className="ppt-section-title">
          <span className="ppt-section-icon">👨‍⚕️</span>
          Doctor's Initial Assessment
          <span className={`ppt-badge ${docInitial.length ? "ppt-badge--ok" : "ppt-badge--warn"}`}>
            {docInitial.length ? `${docInitial.length} record(s)` : "Not recorded"}
          </span>
        </div>
        {docInitial.length === 0 ? (
          <div className="ppt-empty">
            ⚠️ Doctor's initial assessment is mandatory before any further documentation. NABH COP.2.
          </div>
        ) : (
          // Latest first — Initial Assessment is usually one record but
          // amendments / re-sign attempts can produce extras; show newest
          // at top so the most current sign is the first thing read.
          [...docInitial]
            .sort((a, b) => new Date(b.visitDate || b.createdAt) - new Date(a.visitDate || a.createdAt))
            .map((n) => <NoteCardEmbed key={n._id} note={n} role="doctor" />)
        )}
      </div>

      <div className="ppt-card ppt-card--nurse">
        <div className="ppt-section-title">
          <span className="ppt-section-icon">👩‍⚕️</span>
          Nursing Initial Assessment
          <span className={`ppt-badge ${nurseInitial.length ? "ppt-badge--ok" : "ppt-badge--warn"}`}>
            {nurseInitial.length ? `${nurseInitial.length} record(s)` : "Not recorded"}
          </span>
        </div>
        {nurseInitial.length === 0 ? (
          <div className="ppt-empty">
            ⚠️ Nursing initial assessment pending. NABH IPSG.6.
          </div>
        ) : (
          [...nurseInitial]
            .sort((a, b) => new Date(b.noteDate || b.createdAt) - new Date(a.noteDate || a.createdAt))
            .map((n) => <NoteCardEmbed key={n._id} note={n} role="nurse" />)
        )}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────
   2. MLCOrDoctorNotesTab
   ────────────────────────────────────────────────────────────────
   If the patient has an MLC on record → show MLC details (+ a quick
   link to the full MLC page). Otherwise → show doctor notes timeline
   fully expanded.
*/
export function MLCOrDoctorNotesTab({ patient, doctorNotes = [], admission }) {
  const [mlcList, setMlcList]   = useState([]);
  const [loading, setLoading]   = useState(false);
  const uhid = patient?.UHID;

  // FIX (audit P27-B1): cancel late stale fetches on rapid UHID changes
  // so the prior patient's MLC list doesn't flash into the new patient's
  // panel.
  useEffect(() => {
    if (!uhid) return;
    let cancelled = false;
    setLoading(true);
    axios.get(`${API_ENDPOINTS.MLC}?UHID=${encodeURIComponent(uhid)}&limit=50`)
      .then((r) => { if (!cancelled) setMlcList(r.data?.data || []); })
      .catch(() => { if (!cancelled) setMlcList([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [uhid]);

  const hasMLC = mlcList.length > 0;
  const nonInitialDocNotes = doctorNotes.filter(
    (n) => n.noteType !== "initial" && n.noteType !== "initialAssessment",
  );

  // R7gn — Day-wise group, same shape as Complete File Narrative theme.
  const admissionDate = admission?.admissionDate || admission?.date;
  const daysByDate = useMemo(
    () => groupByDayChrono(nonInitialDocNotes, (n) => n.noteDate || n.visitDate || n.createdAt),
    [nonInitialDocNotes],
  );

  return (
    <div className="ppt-tab">
      <div className="ppt-tab-header">
        <h2 className="ppt-tab-title">
          {hasMLC ? "⚖ Medico-Legal Case (MLC)" : "🩺 Doctor Notes"}
        </h2>
        <p className="ppt-tab-sub">
          {hasMLC
            ? "This patient has one or more medico-legal cases on file. Doctor notes follow."
            : "Doctor's clinical notes — admission, daily progress, ICU, procedure, consultation, pre/post-op, etc. Same per-type cards as the printed Complete File."}
        </p>
      </div>

      {loading && <div className="ppt-empty"><i className="pi pi-spin pi-spinner" /> Loading MLC records…</div>}

      {hasMLC && mlcList.map((m) => <MLCExpanded key={m._id} mlc={m} />)}

      <div className="ppt-card">
        <div className="ppt-section-title">
          <span className="ppt-section-icon">📝</span>
          Doctor Notes Timeline
          <span className="ppt-badge ppt-badge--info">{nonInitialDocNotes.length} note(s)</span>
        </div>
        {nonInitialDocNotes.length === 0 ? (
          <div className="ppt-empty">No further doctor notes yet.</div>
        ) : (
          daysByDate.map(([k, notes]) => {
            const dn = dayNumber(k, admissionDate);
            return (
              <div key={k} className="ppt-day-block">
                <div className="ppt-day-heading">
                  {dn ? <span className="ppt-day-num">Day {dn}</span> : null}
                  <span className="ppt-day-date">{dayHeading(k)}</span>
                  <span className="ppt-day-count">{notes.length} note{notes.length === 1 ? "" : "s"}</span>
                </div>
                {notes.map((n) => <NoteCardEmbed key={n._id} note={n} role="doctor" />)}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────
   3. NursingNotesExpandedTab
   ────────────────────────────────────────────────────────────────
   Categorised list of nursing notes, fully expanded for reading +
   printing. Categories: General, Vitals, Pain, Neuro/GCS, Intake/
   Output, IV Infusion, Blood Transfusion, Wound, Skin, Fall Risk,
   Procedure, Discharge/SBAR, MEWS.
*/
export function NursingNotesExpandedTab({ nursingNotes = [], admission }) {
  // R7gn — Layout matches Complete File: day-wise blocks, each entry
  // rendered with the SAME per-type card builder Narrative.jsx uses for
  // print. The previous "group by type" layout buried the timeline; the
  // user wants chronological journey parity with the printed file.
  const filtered = useMemo(
    () => (nursingNotes || []).filter((n) => n.noteType !== "initial" && n.noteType !== "initialAssessment"),
    [nursingNotes],
  );
  const admissionDate = admission?.admissionDate || admission?.date;
  const daysByDate = useMemo(
    () => groupByDayChrono(filtered, (n) => n.noteDate || n.createdAt),
    [filtered],
  );

  // Type-count chips at the top — quick scan of what's been written.
  const typeCounts = useMemo(() => {
    const m = {};
    filtered.forEach((n) => { const t = n.noteType || "general"; m[t] = (m[t] || 0) + 1; });
    return m;
  }, [filtered]);
  const TYPE_LABEL = {
    general: "📋 General", vitals: "📈 Vitals", pain: "😣 Pain", neuro: "🧠 Neuro/GCS",
    intake: "💧 I/O", iv: "🩸 IV", blood: "🩸 Blood Transfusion", wound: "🩹 Wound",
    skin: "🌡️ Skin", fall: "⚠️ Fall", procedure: "⚙️ Procedure", discharge: "📤 Discharge/SBAR",
    mews: "📊 MEWS", daily: "🗓️ Daily", careplan: "💚 Care Plan", nutrition: "🍎 Nutrition",
    education: "📚 Education",
  };

  return (
    <div className="ppt-tab">
      <div className="ppt-tab-header">
        <h2 className="ppt-tab-title">📝 Nursing Notes — Chronological Journey</h2>
        <p className="ppt-tab-sub">
          Day-wise, ordered the same way as the printed Complete File · {filtered.length} record(s)
        </p>
      </div>

      {Object.keys(typeCounts).length > 0 && (
        <div className="ppt-chip-list" style={{ marginBottom: 12 }}>
          {Object.entries(typeCounts)
            .sort((a, b) => b[1] - a[1])
            .map(([t, n]) => (
              <span key={t} className="ppt-chip ppt-chip--info">
                {TYPE_LABEL[t] || t} · {n}
              </span>
            ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="ppt-empty">No nursing notes recorded yet.</div>
      ) : (
        daysByDate.map(([k, notes]) => {
          const dn = dayNumber(k, admissionDate);
          return (
            <div key={k} className="ppt-day-block">
              <div className="ppt-day-heading">
                {dn ? <span className="ppt-day-num">Day {dn}</span> : null}
                <span className="ppt-day-date">{dayHeading(k)}</span>
                <span className="ppt-day-count">{notes.length} note{notes.length === 1 ? "" : "s"}</span>
              </div>
              {notes.map((n) => <NoteCardEmbed key={n._id} note={n} role="nurse" />)}
            </div>
          );
        })
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────
   4. VitalChartTab
   ────────────────────────────────────────────────────────────────
   Tabular trend of vitals across every nursing note that captured
   them. Print-friendly grid.
*/
export function VitalChartTab({ nursingNotes = [], vitalSheet = [] }) {
  const rows = useMemo(() => {
    const vNotes = nursingNotes
      .filter((n) => n.vitals && (n.vitals.bp || n.vitals.pulse || n.vitals.temp || n.vitals.spo2 || n.vitals.rr))
      .map((n) => ({
        when: n.noteDate || n.createdAt,
        by:   n.nurseName || "—",
        bp:   n.vitals?.bp ? `${n.vitals.bp.systolic || "—"}/${n.vitals.bp.diastolic || "—"}` : "—",
        pulse:n.vitals?.pulse,
        temp: n.vitals?.temp,
        rr:   n.vitals?.rr,
        spo2: n.vitals?.spo2,
        bsl:  n.vitals?.bloodSugar,
        gcs:  n.noteData?.glasgowComaScale || n.noteData?.gcs,
        src:  "Nursing",
      }));
    const vsRows = (vitalSheet || []).map((v) => ({
      when: v.recordedAt || v.createdAt,
      by:   v.recordedBy || "—",
      bp:   v.bloodPressure || (v.bp ? `${v.bp.systolic||"—"}/${v.bp.diastolic||"—"}` : "—"),
      pulse:v.pulse,
      temp: v.temperature || v.temp,
      rr:   v.respiratoryRate || v.rr,
      spo2: v.oxygenSaturation || v.spo2,
      bsl:  v.bloodSugar,
      gcs:  v.glasgowComaScale || v.gcs,
      src:  "Vital Sheet",
    }));
    // FIX (audit P27-B5): de-dupe nursing-note vitals against vital-sheet
    // entries that landed at the same minute (some nursing flows write
    // both). Key on minute-precision timestamp + recorder name.
    const merged = [...vNotes, ...vsRows];
    const seen = new Set();
    const deduped = merged.filter((r) => {
      const minute = r.when ? new Date(r.when).toISOString().slice(0, 16) : "";
      const key = `${minute}|${r.by}|${r.bp || ""}|${r.pulse || ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return deduped.sort((a, b) => new Date(b.when) - new Date(a.when));
  }, [nursingNotes, vitalSheet]);

  return (
    <div className="ppt-tab">
      <div className="ppt-tab-header">
        <h2 className="ppt-tab-title">📈 Vital Chart</h2>
        <p className="ppt-tab-sub">All vital recordings — nursing notes + dedicated vital sheets · {rows.length} entries</p>
      </div>
      {rows.length === 0 ? (
        <div className="ppt-empty">No vital recordings yet.</div>
      ) : (
        <div className="ppt-table-wrap">
          <table className="ppt-table">
            <thead>
              <tr>
                <th>Recorded At</th>
                <th>By</th>
                <th>BP</th>
                <th>Pulse</th>
                <th>Temp</th>
                <th>RR</th>
                <th>SpO₂</th>
                <th>BSL</th>
                <th>GCS</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className={isAbnormal(r) ? "ppt-tr--alert" : ""}>
                  <td>{fmtDateTime(r.when)}</td>
                  <td>{r.by}</td>
                  <td>{r.bp || "—"}</td>
                  <td>{r.pulse ?? "—"}</td>
                  <td>{r.temp != null ? `${r.temp}°F` : "—"}</td>
                  <td>{r.rr ?? "—"}</td>
                  <td>{r.spo2 != null ? `${r.spo2}%` : "—"}</td>
                  <td>{r.bsl != null ? `${r.bsl} mg/dL` : "—"}</td>
                  <td>{r.gcs ?? "—"}</td>
                  <td className="ppt-cell-src">{r.src}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function isAbnormal(r) {
  const p = Number(r.pulse);
  const sp = Number(r.spo2);
  const t = Number(r.temp);
  const bsl = Number(r.bsl);
  return (p && (p > 100 || p < 60)) ||
         (sp && sp < 94) ||
         (t && t > 100.4) ||
         (bsl && (bsl > 180 || bsl < 70));
}

/* ────────────────────────────────────────────────────────────────
   5. IntakeOutputChartTab
   ────────────────────────────────────────────────────────────────
   Daily I/O summary aggregated from nursing notes' `intakeOutput`.
*/
export function IntakeOutputChartTab({ nursingNotes = [] }) {
  // R7az-D5-MED-2 / D5-MED-9 — Match the full set of intake & output
  // buckets that NursingNotes.jsx actually writes:
  //   intake : oral, ivFluids, ivMedFluids, bloodProducts
  //   output : urineOutput, otherOutput, nasogastricOutput
  // Pre-fix the chart only added oral+ivFluids on the intake side and
  // urineOutput+otherOutput on the output side — so IV-med volumes and
  // NGT drainage silently disappeared from the daily totals + net
  // balance row.
  const rows = useMemo(() => {
    return nursingNotes
      .filter((n) => n.intakeOutput && (
        n.intakeOutput.oral || n.intakeOutput.ivFluids || n.intakeOutput.ivMedFluids ||
        n.intakeOutput.bloodProducts || n.intakeOutput.urineOutput ||
        n.intakeOutput.otherOutput || n.intakeOutput.nasogastricOutput
      ))
      .map((n) => {
        const io = n.intakeOutput || {};
        const oral   = Number(io.oral)            || 0;
        const iv     = Number(io.ivFluids)        || 0;
        const ivMed  = Number(io.ivMedFluids)     || 0;
        const blood  = Number(io.bloodProducts)   || 0;
        const urine  = Number(io.urineOutput)     || 0;
        const ngt    = Number(io.nasogastricOutput) || 0;
        const other  = Number(io.otherOutput)     || 0;
        const intake = oral + iv + ivMed + blood;
        const output = urine + ngt + other;
        return {
          _id: n._id,
          when: n.noteDate || n.createdAt,
          by:   n.nurseName || "—",
          shift: n.shift || "—",
          oral, iv, ivMed, blood,
          urine, ngt, other,
          intake, output,
          balance: intake - output,
          notes: io.notes,
        };
      })
      .sort((a, b) => new Date(b.when) - new Date(a.when));
  }, [nursingNotes]);

  const totals = rows.reduce((acc, r) => {
    acc.intake += r.intake;
    acc.output += r.output;
    return acc;
  }, { intake: 0, output: 0 });

  return (
    <div className="ppt-tab">
      <div className="ppt-tab-header">
        <h2 className="ppt-tab-title">💧 Intake / Output Chart</h2>
        <p className="ppt-tab-sub">All recorded I/O entries · {rows.length} entries</p>
      </div>

      {rows.length === 0 ? (
        <div className="ppt-empty">No intake/output recordings yet.</div>
      ) : (
        <>
          <div className="ppt-io-totals">
            <div className="ppt-io-card ppt-io-card--in">
              <div className="ppt-io-label">Total Intake</div>
              <div className="ppt-io-val">{totals.intake} <span>mL</span></div>
            </div>
            <div className="ppt-io-card ppt-io-card--out">
              <div className="ppt-io-label">Total Output</div>
              <div className="ppt-io-val">{totals.output} <span>mL</span></div>
            </div>
            <div className={`ppt-io-card ${totals.intake - totals.output >= 0 ? "ppt-io-card--pos" : "ppt-io-card--neg"}`}>
              <div className="ppt-io-label">Net Balance</div>
              <div className="ppt-io-val">{totals.intake - totals.output >= 0 ? "+" : ""}{totals.intake - totals.output} <span>mL</span></div>
            </div>
          </div>

          <div className="ppt-table-wrap">
            <table className="ppt-table">
              <thead>
                <tr>
                  <th>Recorded At</th>
                  <th>By / Shift</th>
                  <th>Oral (mL)</th>
                  <th>IV (mL)</th>
                  <th className="ppt-th-sum">Intake</th>
                  <th>Urine (mL)</th>
                  <th>Other (mL)</th>
                  <th className="ppt-th-sum">Output</th>
                  <th className="ppt-th-sum">Net</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r._id}>
                    <td>{fmtDateTime(r.when)}</td>
                    <td>{r.by}<br/><small className="ppt-shift">{r.shift}</small></td>
                    <td>{r.oral || "—"}</td>
                    <td>{r.iv || "—"}</td>
                    <td className="ppt-td-sum">{r.intake}</td>
                    <td>{r.urine || "—"}</td>
                    <td>{r.other || "—"}</td>
                    <td className="ppt-td-sum">{r.output}</td>
                    <td className={`ppt-td-sum ${r.balance >= 0 ? "ppt-pos" : "ppt-neg"}`}>
                      {r.balance >= 0 ? "+" : ""}{r.balance}
                    </td>
                    <td>{r.notes || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────
   6. BloodTransfusionRecordsTab
   ────────────────────────────────────────────────────────────────
   Every nursing note tagged `blood` with full transfusion details
   (component, group, units, monitoring observations).
*/
export function BloodTransfusionRecordsTab({ nursingNotes = [] }) {
  const records = nursingNotes
    .filter((n) => n.noteType === "blood")
    .sort((a, b) => new Date(b.noteDate || b.createdAt) - new Date(a.noteDate || a.createdAt));

  return (
    <div className="ppt-tab">
      <div className="ppt-tab-header">
        <h2 className="ppt-tab-title">🩸 Blood Transfusion Records</h2>
        <p className="ppt-tab-sub">NABH COP.7 · {records.length} transfusion record(s)</p>
      </div>
      {records.length === 0 ? (
        <div className="ppt-empty">No blood transfusion records on file.</div>
      ) : (
        records.map((n) => {
          const d = n.noteData?.bloodTransfusion || n.noteData || {};
          return (
            <div key={n._id} className="ppt-card ppt-card--blood">
              <div className="ppt-section-title">
                <span className="ppt-section-icon">🩸</span>
                {d.component || "Blood Product"} — {fmtDateTime(n.noteDate || n.createdAt)}
                <span className="ppt-badge ppt-badge--info">By {n.nurseName || "Nurse"}</span>
              </div>
              <div className="ppt-detail-grid">
                <Field label="Component"          value={d.component} />
                <Field label="Blood Group"        value={d.bloodGroup} />
                <Field label="Units / Bag No."    value={d.unitNumber || d.bagNumber} />
                <Field label="Volume"             value={d.volume ? `${d.volume} mL` : null} />
                <Field label="Cross-match Done"   value={d.crossMatchDone == null ? null : (d.crossMatchDone ? "Yes" : "No")} />
                <Field label="Consent Taken"      value={d.consentTaken == null ? null : (d.consentTaken ? "Yes" : "No")} />
                <Field label="Start Time"         value={fmtDateTime(d.startTime)} />
                <Field label="End Time"           value={fmtDateTime(d.endTime)} />
                <Field label="Pre-Vitals"         value={d.preVitals} wide />
                <Field label="Post-Vitals"        value={d.postVitals} wide />
                <Field label="Reactions Observed" value={d.reactions} wide danger={!!d.reactions && d.reactions.toLowerCase() !== "nil"} />
                <Field label="Doctor Notified"    value={d.doctorNotified} />
                <Field label="Remarks"            value={d.remarks || n.remarks} wide />
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────
   7. RBSMonitoringTab
   ────────────────────────────────────────────────────────────────
   Random Blood Sugar chart + insulin / OHA orders given against it.
   Reads `vitals.bloodSugar` from nursing notes and joins them with
   matching antidiabetic medication doses (insulin / metformin etc.)
   from doctorOrders' administrationRecord.
*/
export function RBSMonitoringTab({ nursingNotes = [], doctorOrders = [] }) {
  const readings = useMemo(() => {
    return nursingNotes
      .filter((n) => n.vitals?.bloodSugar != null)
      .map((n) => ({
        when: n.noteDate || n.createdAt,
        bsl:  Number(n.vitals.bloodSugar),
        by:   n.nurseName || "—",
        shift: n.shift,
      }))
      .sort((a, b) => new Date(b.when) - new Date(a.when));
  }, [nursingNotes]);

  // Antidiabetic medications administered. Generic + common Indian
  // brand names. `glucose`/`dextrose` are included because hospital
  // RBS-monitoring flow tracks the rescue dose alongside the antidiabetic.
  const ANTIDIABETIC_RE = new RegExp([
    // Insulins — generic + trade names
    "insulin", "humulin", "novolin", "actrapid", "mixtard", "humalog",
    "lantus", "levemir", "novorapid", "novomix", "tresiba", "ryzodeg",
    "glargine", "aspart", "lispro", "detemir", "degludec",
    // Sulfonylureas
    "glimepiride", "gliclazide", "glipizide", "glibenclamide", "glyburide",
    // Biguanides
    "metformin", "glycomet",
    // DPP-4 inhibitors
    "sitagliptin", "vildagliptin", "linagliptin", "saxagliptin", "teneligliptin",
    // SGLT2 inhibitors
    "empagliflozin", "dapagliflozin", "canagliflozin", "ertugliflozin",
    // GLP-1 agonists
    "liraglutide", "semaglutide", "dulaglutide", "exenatide",
    // Thiazolidinediones
    "pioglitazone", "rosiglitazone",
    // Meglitinides
    "repaglinide", "nateglinide",
    // α-glucosidase inhibitors
    "acarbose", "miglitol", "voglibose",
    // Rescue / monitoring
    "glucose", "dextrose",
  ].join("|"), "i");
  const doses = useMemo(() => {
    const list = [];
    (doctorOrders || []).forEach((o) => {
      const isAD = ANTIDIABETIC_RE.test(`${o.drug || ""} ${o.drugFluid || ""} ${o.medicineName || ""}`);
      if (!isAD) return;
      (o.administrationRecord || []).forEach((a) => {
        if (!a.givenAt) return;
        list.push({
          when:  a.givenAt,
          drug:  o.drug || o.drugFluid || o.medicineName || "Antidiabetic",
          dose:  a.doseGiven || a.dose || o.dose,
          route: a.route || o.route,
          by:    a.givenBy || "—",
          status: a.status || "given",
          reason: a.statReason || a.reason,
        });
      });
    });
    return list.sort((a, b) => new Date(b.when) - new Date(a.when));
  }, [doctorOrders]);

  const flagBSL = (bsl) =>
    bsl > 180 ? "ppt-bsl--high" :
    bsl < 70  ? "ppt-bsl--low"  : "";

  return (
    <div className="ppt-tab">
      <div className="ppt-tab-header">
        <h2 className="ppt-tab-title">🩸 RBS Monitoring &amp; Diabetic Medication</h2>
        <p className="ppt-tab-sub">
          {readings.length} blood-sugar reading(s) · {doses.length} antidiabetic dose(s)
        </p>
      </div>

      <div className="ppt-grid-2">
        <div className="ppt-card">
          <div className="ppt-section-title">📈 Blood Sugar Readings</div>
          {readings.length === 0 ? (
            <div className="ppt-empty">No RBS readings recorded yet.</div>
          ) : (
            <table className="ppt-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>BSL (mg/dL)</th>
                  <th>Shift / Nurse</th>
                </tr>
              </thead>
              <tbody>
                {readings.map((r, i) => (
                  <tr key={i} className={flagBSL(r.bsl)}>
                    <td>{fmtDateTime(r.when)}</td>
                    <td className="ppt-bsl-cell"><strong>{r.bsl}</strong></td>
                    <td>{r.shift || "—"}<br/><small>{r.by}</small></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="ppt-card">
          <div className="ppt-section-title">💉 Antidiabetic Doses Given</div>
          {doses.length === 0 ? (
            <div className="ppt-empty">No antidiabetic medications administered yet.</div>
          ) : (
            <table className="ppt-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Drug</th>
                  <th>Dose</th>
                  <th>By</th>
                </tr>
              </thead>
              <tbody>
                {doses.map((d, i) => (
                  <tr key={i}>
                    <td>{fmtDateTime(d.when)}</td>
                    <td>
                      <strong>{d.drug}</strong>
                      {d.route && <><br/><small>{d.route}</small></>}
                    </td>
                    <td>{d.dose || "—"}</td>
                    <td>{d.by}<br/><small className={`ppt-status ppt-status--${d.status}`}>{d.status}</small></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="ppt-card">
        <div className="ppt-section-title">🚦 Reference Range</div>
        <div className="ppt-bsl-legend">
          <span className="ppt-bsl-chip ppt-bsl-chip--low">&lt; 70 mg/dL · Hypoglycaemia</span>
          <span className="ppt-bsl-chip ppt-bsl-chip--normal">70–140 mg/dL · Normal fasting</span>
          <span className="ppt-bsl-chip ppt-bsl-chip--ok">140–180 mg/dL · Acceptable post-meal</span>
          <span className="ppt-bsl-chip ppt-bsl-chip--high">&gt; 180 mg/dL · Hyperglycaemia — needs action</span>
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────
   8. HandoverNotesTab
   ────────────────────────────────────────────────────────────────
   Aggregates every kind of handover record on file for this admission
   so the next shift / next doctor / receiving department picks up
   without losing context:

     • 🛏  Bed-Transfer Handover (Doctor → Nurse handover that's already
            its own state-machine — Doctor initiates, Nurse completes)
     • 🌅  Nursing Shift (SBAR)   — noteType="discharge" with SBAR or
                                    noteType="handover"/"shiftHandover"
     • 🩺  Doctor Shift Handover  — doctor noteType="handover"/"shift"
     • ➡  Doctor → Nurse Care    — doctor handover meant for nursing
                                    (noteData.targetRole === "Nurse")
     • ⚠   Critical Findings      — nurse → doctor escalation
                                    (noteData.handoverType === "critical")
     • 🚪  Pre-Discharge Handover — doctor or nurse with
                                    noteType="predischarge"

   Each entry renders fully expanded for proper reading + printing.
*/
export function HandoverNotesTab({ patient, admission, doctorNotes = [], nursingNotes = [] }) {
  const admissionId = admission?._id;
  const [transfers, setTransfers] = useState([]);
  const [loadingTx, setLoadingTx]   = useState(false);

  useEffect(() => {
    if (!admissionId) { setTransfers([]); return; }
    let cancelled = false;
    setLoadingTx(true);
    axios.get(`${API_ENDPOINTS.BASE}/bed-transfers?admissionId=${admissionId}`)
      .then((r) => { if (!cancelled) setTransfers(r.data?.data || r.data?.transfers || []); })
      .catch(() => { if (!cancelled) setTransfers([]); })
      .finally(() => { if (!cancelled) setLoadingTx(false); });
    return () => { cancelled = true; };
  }, [admissionId]);

  /* ── Classify nursing handovers ───────────────────────────────── */
  const nursingHandovers = nursingNotes.filter((n) => {
    const t = (n.noteType || "").toLowerCase();
    const subtype = (n.noteData?.handoverType || "").toLowerCase();
    return t === "discharge" || t === "handover" || t === "shifthandover" || t === "sbar"
        || subtype === "shift" || subtype === "sbar";
  });

  const sbar     = nursingHandovers.filter((n) => {
    const t = (n.noteType || "").toLowerCase();
    return t !== "predischarge" && (n.noteData?.handoverType || "").toLowerCase() !== "critical";
  });
  const critical = nursingHandovers.filter((n) => (n.noteData?.handoverType || "").toLowerCase() === "critical");

  /* ── Classify doctor handovers ───────────────────────────────── */
  const doctorHandovers = doctorNotes.filter((n) => {
    const t = (n.noteType || "").toLowerCase();
    return t === "handover" || t === "shift" || t === "shifthandover";
  });
  const doctorShift = doctorHandovers.filter((n) => {
    const target = (n.noteData?.targetRole || n.targetRole || "").toLowerCase();
    return target !== "nurse";
  });
  const doctorToNurse = doctorHandovers.filter((n) => {
    const target = (n.noteData?.targetRole || n.targetRole || "").toLowerCase();
    return target === "nurse";
  });

  /* ── Pre-discharge handovers (from either side) ─────────────── */
  const preDischarge = [
    ...doctorNotes.filter((n) => (n.noteType || "").toLowerCase() === "predischarge"),
    ...nursingNotes.filter((n) => (n.noteType || "").toLowerCase() === "predischarge"),
  ].sort((a, b) => new Date(b.createdAt || b.noteDate) - new Date(a.createdAt || a.noteDate));

  /* ── Bed-transfer handovers ──────────────────────────────────── */
  const pending  = transfers.filter((t) => t.status === "PendingHandover");
  const completed = transfers.filter((t) => t.status === "Complete");

  const totalCount = pending.length + completed.length + sbar.length + critical.length
                   + doctorShift.length + doctorToNurse.length + preDischarge.length;

  return (
    <div className="ppt-tab">
      <div className="ppt-tab-header">
        <h2 className="ppt-tab-title">🔄 Handover Notes — All Types</h2>
        <p className="ppt-tab-sub">
          Shift handovers, bed-transfer handovers, doctor→nurse care plans, critical-findings escalations,
          and pre-discharge handovers · {totalCount} record(s)
        </p>
      </div>

      {/* 1 — Pending bed-transfer (action required) */}
      {pending.length > 0 && (
        <div className="ppt-card ppt-card--mlc">
          <div className="ppt-section-title">
            <span className="ppt-section-icon">🛏</span>
            Bed Transfer — Handover Pending
            <span className="ppt-badge ppt-badge--warn">ACTION REQUIRED</span>
          </div>
          {pending.map((t) => <BedTransferRow key={t._id} t={t} state="pending" />)}
        </div>
      )}

      {/* 2 — Nursing Shift (SBAR) */}
      <HandoverSection
        title="🌅 Nursing Shift Handover (SBAR)"
        items={sbar}
        emptyMsg="No nursing shift handovers recorded yet."
        kind="nurse"
      />

      {/* 3 — Doctor Shift */}
      <HandoverSection
        title="🩺 Doctor Shift Handover"
        items={doctorShift}
        emptyMsg="No doctor shift handovers recorded yet."
        kind="doctor"
      />

      {/* 4 — Doctor → Nurse care plan */}
      <HandoverSection
        title="➡ Doctor → Nurse Care Handover"
        items={doctorToNurse}
        emptyMsg="No doctor-to-nurse care handovers recorded yet."
        kind="doctor"
      />

      {/* 5 — Critical Findings (nurse → doctor escalation) */}
      <HandoverSection
        title="⚠ Critical Findings Handover (Nurse → Doctor escalation)"
        items={critical}
        emptyMsg="No critical-findings escalations on record."
        kind="nurse"
        urgent
      />

      {/* 6 — Pre-Discharge */}
      <HandoverSection
        title="🚪 Pre-Discharge Handover"
        items={preDischarge}
        emptyMsg="No pre-discharge handovers recorded yet."
        kind="mixed"
      />

      {/* 7 — Completed bed-transfer history */}
      <div className="ppt-card">
        <div className="ppt-section-title">
          <span className="ppt-section-icon">🛏</span>
          Bed-Transfer Handover History
          <span className="ppt-badge ppt-badge--info">{completed.length} completed</span>
        </div>
        {loadingTx && <div className="ppt-empty"><i className="pi pi-spin pi-spinner" /> Loading transfers…</div>}
        {!loadingTx && completed.length === 0 && (
          <div className="ppt-empty">No completed bed transfers on file.</div>
        )}
        {completed
          .sort((a, b) => new Date(b.handoverAt || b.updatedAt) - new Date(a.handoverAt || a.updatedAt))
          .map((t) => <BedTransferRow key={t._id} t={t} state="completed" />)}
      </div>
    </div>
  );
}

function HandoverSection({ title, items, emptyMsg, kind, urgent }) {
  return (
    <div className={`ppt-card ${urgent ? "ppt-card--blood" : kind === "doctor" ? "ppt-card--doctor" : kind === "nurse" ? "ppt-card--nurse" : ""}`}>
      <div className="ppt-section-title">
        {title}
        <span className={`ppt-badge ${items.length === 0 ? "ppt-badge--info" : urgent ? "ppt-badge--warn" : "ppt-badge--ok"}`}>
          {items.length} record(s)
        </span>
      </div>
      {items.length === 0 ? (
        <div className="ppt-empty">{emptyMsg}</div>
      ) : (
        items.map((n) => (
          kind === "doctor"
            ? <DoctorNoteExpanded key={n._id} note={n} />
            : <NurseNoteExpanded  key={n._id} note={n} />
        ))
      )}
    </div>
  );
}

function BedTransferRow({ t, state }) {
  return (
    <div className="ppt-note ppt-note--nurse">
      <div className="ppt-note-head">
        <span className="ppt-note-type">
          {t.transferNo || "Bed Transfer"}
          {state === "pending"  && <span className="ppt-note-status ppt-note-status--draft">{t.status}</span>}
          {state === "completed" && <span className="ppt-note-status ppt-note-status--signed">{t.status}</span>}
        </span>
        <span className="ppt-note-meta">
          Initiated: {fmtDateTime(t.requestedAt)} {t.requestedBy && <>by <strong>{t.requestedBy}</strong></>}
          {t.handoverAt && <> · Completed: {fmtDateTime(t.handoverAt)} by <strong>{t.handoverBy || "Nurse"}</strong></>}
        </span>
      </div>
      <div className="ppt-detail-grid">
        <Field label="From Bed" value={[t.fromBedNumber, t.fromWardName].filter(Boolean).join(" — ")} />
        <Field label="To Bed"   value={[t.toBedNumber, t.toWardName].filter(Boolean).join(" — ")} />
        <Field label="Reason"   value={t.reason} wide />
        <Field label="Doctor's Shifting Notes" value={t.shiftingNotes} wide />
        {t.handoverNotes && <Field label="Nurse's Handover Notes" value={t.handoverNotes} wide />}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   Building blocks — DoctorNoteExpanded, NurseNoteExpanded, MLCExpanded
   ════════════════════════════════════════════════════════════════ */

function DoctorNoteExpanded({ note }) {
  const TYPE_LABELS = {
    initial:"Initial Assessment", medication:"Medication Order", infusion:"Infusion Order",
    daily:"Daily Progress", icu:"ICU / Critical Care", procedure:"Procedure Note",
    consultation:"Consultation", preop:"Pre-operative", postop:"Post-operative",
    death:"Death Note", amendment:"Amendment", initialAssessment:"Initial Assessment",
    progress:"Progress Note", assessment:"Assessment", admission:"Admission Note",
    discharge:"Discharge Note", general:"General Note", operative:"Operative Note",
  };
  const typeLabel = TYPE_LABELS[note.noteType] || note.noteType || "Clinical Note";
  return (
    <div className="ppt-note ppt-note--doctor">
      {/* Banner — chart-style: type + meta + status badge */}
      <div className="ppt-note-head">
        <span className="ppt-note-type">{typeLabel}</span>
        <span className="ppt-note-meta">
          <strong>{note.doctorName || "Doctor"}</strong>
          {note.doctorRegNo && <span className="ppt-reg">Reg {note.doctorRegNo}</span>}
          · {fmtDateTime(note.visitDate || note.createdAt || note.noteDate)}
          {note.shift && <span className="ppt-shift-badge">{note.shift}</span>}
          {note.status && <span className={`ppt-note-status ppt-note-status--${note.status}`}>{note.status}</span>}
          {note.isCritical && <span className="ppt-note-status ppt-note-status--critical">⚠ critical</span>}
        </span>
      </div>

      {/* SOAP block (S/O/A/P) — collapsible labelled paragraphs */}
      {note.soap && Object.values(note.soap).some(Boolean) && (
        <div className="ppt-soap">
          {note.soap.subjective && <SoapRow letter="S" label="Subjective"  body={note.soap.subjective} />}
          {note.soap.objective  && <SoapRow letter="O" label="Objective"   body={note.soap.objective} />}
          {note.soap.assessment && <SoapRow letter="A" label="Assessment"  body={note.soap.assessment} />}
          {note.soap.plan       && <SoapRow letter="P" label="Plan"        body={note.soap.plan} />}
        </div>
      )}

      {/* Diagnosis line */}
      {(note.provisionalDiagnosis || note.workingDiagnosis || note.finalDiagnosis || note.icd10Code) && (
        <div className="ppt-detail-grid ppt-dx-grid">
          {note.provisionalDiagnosis && <Field label="Provisional Diagnosis" value={note.provisionalDiagnosis} wide />}
          {note.workingDiagnosis     && <Field label="Working Diagnosis"     value={note.workingDiagnosis}     wide />}
          {note.finalDiagnosis       && <Field label="Final Diagnosis"       value={note.finalDiagnosis}       wide />}
          {note.icd10Code            && <Field label="ICD-10"                value={`${note.icd10Code}${note.icd10Description ? ` — ${note.icd10Description}` : ""}`} />}
        </div>
      )}

      {/* Vitals chips */}
      {note.vitals && Object.values(note.vitals).some((v) => v != null && v !== "") && (
        <VitalsChipRow vitals={note.vitals} />
      )}

      {/* Investigations ordered (just the list) */}
      {Array.isArray(note.investigations) && note.investigations.length > 0 && (
        <div className="ppt-inline-block">
          <div className="ppt-section-sub">Investigations Ordered</div>
          <div className="ppt-chip-list">
            {note.investigations.map((inv, i) => (
              <span key={i} className="ppt-chip ppt-chip--info">{typeof inv === "string" ? inv : (inv.testName || inv.name || "—")}</span>
            ))}
          </div>
        </div>
      )}

      {/* Orders table */}
      {Array.isArray(note.orders) && note.orders.length > 0 && (
        <div className="ppt-inline-block">
          <div className="ppt-section-sub">Orders ({note.orders.length})</div>
          <div className="ppt-table-wrap">
            <table className="ppt-table">
              <thead>
                <tr><th>Type</th><th>Instruction</th><th>Route</th><th>Frequency</th><th>Duration</th><th>Status</th></tr>
              </thead>
              <tbody>
                {note.orders.map((o, i) => (
                  <tr key={i}>
                    <td className="ppt-cap">{o.type || "—"}</td>
                    <td>{o.instruction || "—"}</td>
                    <td>{o.route || "—"}</td>
                    <td>{o.frequency || "—"}</td>
                    <td>{o.duration || "—"}</td>
                    <td><span className={`ppt-status ppt-status--${(o.nurseStatus || "pending")}`}>{o.nurseStatus || "pending"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Free-text body for non-SOAP notes (legacy "remarks" / "note" / "content") */}
      {(note.remarks || note.note || note.noteText || note.content || note.patientStatus) && (
        <div className="ppt-detail-grid">
          {note.patientStatus && <Field label="Patient Status" value={note.patientStatus} />}
          {(note.remarks || note.note || note.noteText || note.content) && (
            <Field label="Notes" value={note.remarks || note.note || note.noteText || note.content} wide />
          )}
        </div>
      )}

      {/* Extended noteDetails (ICU/procedure-specific custom JSON) */}
      {note.noteDetails && typeof note.noteDetails === "object" && Object.keys(note.noteDetails).length > 0 && (
        <div className="ppt-inline-block">
          <div className="ppt-section-sub">Additional Details</div>
          <KeyValueAll obj={note.noteDetails} skip={EMPTY_SKIP} />
        </div>
      )}

      {/* Tags */}
      {Array.isArray(note.tags) && note.tags.length > 0 && (
        <div className="ppt-chip-list" style={{ marginTop: 6 }}>
          {note.tags.map((t, i) => <span key={i} className="ppt-chip">{t}</span>)}
        </div>
      )}

      {/* Signature footer */}
      <NoteSignature note={note} role="Doctor" />
    </div>
  );
}

function NurseNoteExpanded({ note }) {
  const TYPE_LABELS = {
    initial:"Initial Assessment", initialAssessment:"Initial Assessment",
    general:"General Note", vitals:"Vitals", pain:"Pain Assessment",
    neuro:"Neuro / GCS", intake:"Intake / Output", iv:"IV / Cannula Note",
    blood:"Blood Transfusion", wound:"Wound Care", skin:"Skin Assessment",
    procedure:"Procedure Note", discharge:"Discharge Note", fall:"Fall Risk",
    mews:"MEWS Score", daily:"Daily Care", careplan:"Care Plan",
    nutrition:"Nutrition", education:"Patient Education",
  };
  const typeLabel = TYPE_LABELS[note.noteType] || note.noteType || "Nursing Note";
  return (
    <div className="ppt-note ppt-note--nurse">
      <div className="ppt-note-head">
        <span className="ppt-note-type">{typeLabel}</span>
        <span className="ppt-note-meta">
          <strong>{note.nurseName || "Nurse"}</strong>
          · {fmtDateTime(note.noteDate || note.createdAt)}
          {note.shift && <span className="ppt-shift-badge">{note.shift}</span>}
          {note.status && <span className={`ppt-note-status ppt-note-status--${note.status}`}>{note.status}</span>}
        </span>
      </div>

      {/* Vitals chips (common to many nurse note types) */}
      {note.vitals && Object.values(note.vitals).some((v) => v != null && v !== "") && (
        <VitalsChipRow vitals={note.vitals} />
      )}

      {/* Free-text body — the primary content of a nursing note */}
      {(note.remarks || note.note || note.noteText || note.content) && (
        <div className="ppt-detail-grid">
          <Field label="Notes" value={note.remarks || note.note || note.noteText || note.content} wide />
        </div>
      )}

      {/* Pain assessment block */}
      {note.painAssessment && Object.values(note.painAssessment).some(Boolean) && (
        <div className="ppt-inline-block">
          <div className="ppt-section-sub">Pain Assessment</div>
          <KeyValueAll obj={note.painAssessment} skip={EMPTY_SKIP} />
        </div>
      )}

      {/* GCS / neuro block */}
      {note.gcs && (
        <div className="ppt-inline-block">
          <div className="ppt-section-sub">GCS / Neuro</div>
          <KeyValueAll obj={note.gcs} skip={EMPTY_SKIP} />
        </div>
      )}

      {/* Intake / output rows */}
      {(Array.isArray(note.intake) || Array.isArray(note.output)) && (note.intake?.length > 0 || note.output?.length > 0) && (
        <div className="ppt-inline-block">
          <div className="ppt-section-sub">Intake / Output</div>
          <IORows intake={note.intake} output={note.output} />
        </div>
      )}

      {/* Blood transfusion specific block */}
      {note.bloodTransfusion && (
        <div className="ppt-inline-block">
          <div className="ppt-section-sub">Blood Transfusion</div>
          <KeyValueAll obj={note.bloodTransfusion} skip={EMPTY_SKIP} />
        </div>
      )}

      {/* Generic catch-all for any other structured field that has content */}
      <ExtraFields note={note} />

      {/* Signature footer */}
      <NoteSignature note={note} role="Nurse" />
    </div>
  );
}

/* ─── note building-blocks ─── */

function SoapRow({ letter, label, body }) {
  return (
    <div className="ppt-soap-row">
      <span className="ppt-soap-letter">{letter}</span>
      <div className="ppt-soap-body">
        <div className="ppt-soap-label">{label}</div>
        <div className="ppt-soap-text">{body}</div>
      </div>
    </div>
  );
}

function VitalsChipRow({ vitals }) {
  const items = [];
  if (vitals.bp && (vitals.bp.systolic || vitals.bp.diastolic)) {
    items.push({ k: "BP",   v: `${vitals.bp.systolic || "—"}/${vitals.bp.diastolic || "—"}`, u: "mmHg" });
  } else if (typeof vitals.bp === "string" && vitals.bp) {
    items.push({ k: "BP", v: vitals.bp, u: "mmHg" });
  }
  if (vitals.pulse) items.push({ k: "Pulse", v: vitals.pulse, u: "bpm" });
  if (vitals.temp)  items.push({ k: "Temp",  v: vitals.temp,  u: "°F" });
  if (vitals.rr)    items.push({ k: "RR",    v: vitals.rr,    u: "/min" });
  if (vitals.spo2)  items.push({ k: "SpO₂",  v: vitals.spo2,  u: "%" });
  if (vitals.bsl)   items.push({ k: "BSL",   v: vitals.bsl,   u: "mg/dL" });
  if (vitals.gcs)   items.push({ k: "GCS",   v: vitals.gcs,   u: "" });
  if (vitals.pain != null) items.push({ k: "Pain", v: vitals.pain, u: "/10" });
  if (!items.length) return null;
  return (
    <div className="ppt-vitals-row">
      {items.map((it, i) => (
        <div key={i} className="ppt-vital-chip">
          <span className="ppt-vital-k">{it.k}</span>
          <span className="ppt-vital-v">{it.v}</span>
          {it.u && <span className="ppt-vital-u">{it.u}</span>}
        </div>
      ))}
    </div>
  );
}

function IORows({ intake = [], output = [] }) {
  return (
    <div className="ppt-table-wrap">
      <table className="ppt-table ppt-table--compact">
        <thead>
          <tr><th>Type</th><th>Time</th><th>Item</th><th>Route</th><th>Amount (ml)</th></tr>
        </thead>
        <tbody>
          {intake.map((r, i) => (
            <tr key={`in-${i}`}>
              <td><span className="ppt-chip ppt-chip--info">IN</span></td>
              <td>{fmtDateTime(r.time || r.at)}</td>
              <td>{r.item || r.fluid || r.type || "—"}</td>
              <td>{r.route || "—"}</td>
              <td className="ppt-mono">{r.amount || r.volume || "—"}</td>
            </tr>
          ))}
          {output.map((r, i) => (
            <tr key={`out-${i}`}>
              <td><span className="ppt-chip ppt-chip--warn">OUT</span></td>
              <td>{fmtDateTime(r.time || r.at)}</td>
              <td>{r.item || r.fluid || r.type || "—"}</td>
              <td>{r.route || "—"}</td>
              <td className="ppt-mono">{r.amount || r.volume || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* Signature footer — the real fix.
 * Renders the signature as an <img> when it's a data URL or a /uploads/ path;
 * otherwise shows a clean "Signed by Name (Reg) on date" line. NEVER spits
 * raw base64 into the page. */
function NoteSignature({ note, role }) {
  const sig = note.signature || note.nurseSignature || "";
  const isImg = typeof sig === "string" && (sig.startsWith("data:image/") || sig.startsWith("/uploads/") || /^https?:\/\//.test(sig));
  const signedByName = note.signedByName || (role === "Nurse" ? note.nurseName : note.doctorName) || "";
  const signedByReg  = note.signedByReg  || note.doctorRegNo || "";
  // R7go — Hospital employee ID surfaced next to the name + reg no. Same
  // field precedence used by the HTML builders so panel + print stay in
  // sync. signedByEmpId is captured at sign time; doctorEmpId /
  // nurseEmployeeId are the original author's IDs and shown when nothing
  // explicit was recorded at sign time (older notes).
  const signedByEmpId = note.signedByEmpId
    || (role === "Nurse" ? note.nurseEmployeeId : note.doctorEmpId)
    || "";
  const signedAt     = note.signedAt;

  if (!sig && !signedByName && !signedAt) return null;
  return (
    <div className="ppt-sig">
      <div className="ppt-sig-line">
        {isImg ? (
          <img src={sig} alt={`${role} signature`} className="ppt-sig-img" />
        ) : sig ? (
          <span className="ppt-sig-cursive">{signedByName || "Signed"}</span>
        ) : (
          <span className="ppt-sig-cursive ppt-sig-cursive--placeholder">— digital signature —</span>
        )}
      </div>
      <div className="ppt-sig-meta">
        <strong>{signedByName || `${role} (unsigned)`}</strong>
        {signedByEmpId && <span className="ppt-emp-id">Emp ID {signedByEmpId}</span>}
        {signedByReg && <span className="ppt-reg">Reg {signedByReg}</span>}
        {signedAt && <span>· {fmtDateTime(signedAt)}</span>}
        {role && <span className="ppt-sig-role">· {role}</span>}
      </div>
    </div>
  );
}

/* Renders any remaining structured fields not handled by the per-section blocks.
 * Heavy nested objects (noteData / intakeOutput / vitalsHistory) get
 * specialised renderers below so the user never sees raw JSON dumped on the
 * page — that was the old "looks bad" UX.
 */
function ExtraFields({ note }) {
  const HANDLED = new Set([
    ...SKIP_NOTE_FIELDS,
    "soap","vitals","orders","investigations","tags","noteDetails",
    "remarks","note","noteText","content","patientStatus","isCritical",
    "doctorName","doctorRegNo","nurseName","shift","status","signedAt",
    "doctorId","consultantName","visitDate","painAssessment","gcs",
    "intake","output","bloodTransfusion","provisionalDiagnosis",
    "workingDiagnosis","finalDiagnosis","icd10Code","icd10Description",
    // Heavy keys handled by dedicated child blocks below
    "noteData","intakeOutput","ivLine","nursingCare","painScore",
    "generalCondition","isCriticalEvent","triagecategory","triageCategory",
  ]);
  const note0 = note || {};
  const entries = Object.entries(note0)
    .filter(([k, v]) => !HANDLED.has(k) && v != null && v !== "" && v !== false)
    .filter(([, v]) => !(Array.isArray(v) && v.length === 0))
    .filter(([, v]) => typeof v !== "object" || Object.keys(v).length > 0);

  return (
    <>
      {/* General-condition + IV-line summary chips (nursing-specific) */}
      <NursingSummaryChips note={note0} />

      {/* Intake / output structured block */}
      <IntakeOutputBlock io={note0.intakeOutput} />

      {/* Free-text observation (noteData.generalObservation etc.) */}
      <ObservationBlock data={note0.noteData} />

      {entries.length > 0 && (
        <div className="ppt-inline-block">
          <div className="ppt-section-sub">Additional Fields</div>
          <div className="ppt-detail-grid">
            {entries.map(([k, v]) => (
              <Field key={k} label={prettyKey(k)} value={renderValue(v)} wide={typeof v === "string" && v.length > 60} />
            ))}
          </div>
        </div>
      )}
    </>
  );
}

/** Renders a few quick-reference chips (general condition, IV line, pain) so
 * the reader doesn't need to dig through Additional Fields. Only the truthy
 * values show up. */
function NursingSummaryChips({ note }) {
  const gc = note.generalCondition;
  const iv = note.ivLine;
  const ps = note.painScore;
  const items = [];
  if (gc && typeof gc === "object") {
    Object.entries(gc).forEach(([k, v]) => { if (v && v !== "false") items.push({ k: prettyKey(k), v }); });
  }
  if (iv && typeof iv === "object" && iv.condition) items.push({ k: "IV Line", v: iv.condition });
  if (ps != null && ps !== "") items.push({ k: "Pain", v: `${ps}/10` });
  if (!items.length) return null;
  return (
    <div className="ppt-chip-list" style={{ margin: "10px 0" }}>
      {items.map((it, i) => (
        <span key={i} className="ppt-chip ppt-chip--info">
          <strong>{it.k}:</strong> {String(it.v)}
        </span>
      ))}
    </div>
  );
}

/** Intake / Output — supports a few shapes:
 *  - { ivFluidEntries: [{time, volume, fluid, via, ...}], oral, urineOutput, ... }
 *  - flat numbers (oral, ivFluids, urineOutput, otherOutput)
 */
function IntakeOutputBlock({ io }) {
  if (!io || typeof io !== "object") return null;
  const entries = Array.isArray(io.ivFluidEntries) ? io.ivFluidEntries : [];
  const totals = {};
  ["oral","ivFluids","urineOutput","otherOutput","stool","drain","ngOutput"].forEach((k) => {
    if (io[k] != null && io[k] !== "" && io[k] !== 0) totals[k] = io[k];
  });
  if (entries.length === 0 && Object.keys(totals).length === 0) return null;
  return (
    <div className="ppt-inline-block">
      <div className="ppt-section-sub">Intake / Output</div>
      {Object.keys(totals).length > 0 && (
        <div className="ppt-chip-list" style={{ marginBottom: 8 }}>
          {Object.entries(totals).map(([k, v]) => (
            <span key={k} className="ppt-chip">
              <strong>{prettyKey(k)}:</strong> {v}{typeof v === "number" || /^\d+$/.test(String(v)) ? " ml" : ""}
            </span>
          ))}
        </div>
      )}
      {entries.length > 0 && (
        <div className="ppt-table-wrap">
          <table className="ppt-table ppt-table--compact">
            <thead>
              <tr><th>Time</th><th>Fluid</th><th>Volume</th><th>Via</th><th>Entered By</th></tr>
            </thead>
            <tbody>
              {entries.map((e, i) => (
                <tr key={i}>
                  <td>{fmtDateTime(e.time)}</td>
                  <td>{e.fluid || "—"}</td>
                  <td className="ppt-mono">{e.volume != null ? `${e.volume} ml` : "—"}</td>
                  <td>{e.via || "—"}</td>
                  <td className="ppt-cell-src">{e.enteredBy || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Free-text observation block — pulls human-readable paragraphs out of a
 * Mixed-type noteData blob and renders them as a proper card body rather
 * than the JSON dump the legacy code produced. */
function ObservationBlock({ data }) {
  if (!data || typeof data !== "object") return null;
  // Pull out string fields that look like observations (no nested JSON)
  const textFields = [];
  const structured = {};
  Object.entries(data).forEach(([k, v]) => {
    if (k === "_id" || k === "__v") return;
    if (typeof v === "string" && v.length > 0 && !v.startsWith("data:image/")) {
      textFields.push({ k: prettyKey(k), v });
    } else if (typeof v === "object" && v != null && !Array.isArray(v)) {
      structured[k] = v;
    } else if (Array.isArray(v) && v.length > 0) {
      structured[k] = v;
    } else if (typeof v === "number" || typeof v === "boolean") {
      if (v !== false && v !== 0) textFields.push({ k: prettyKey(k), v: String(v) });
    }
  });
  if (textFields.length === 0 && Object.keys(structured).length === 0) return null;
  return (
    <div className="ppt-inline-block">
      <div className="ppt-section-sub">Observation</div>
      {textFields.length > 0 && (
        <div className="ppt-detail-grid">
          {textFields.map((t, i) => (
            <Field key={i} label={t.k} value={t.v} wide={t.v.length > 80} />
          ))}
        </div>
      )}
      {Object.keys(structured).length > 0 && (
        <div className="ppt-detail-grid" style={{ marginTop: 8 }}>
          {Object.entries(structured).map(([k, v]) => (
            <Field key={k} label={prettyKey(k)} value={renderValue(v)} wide />
          ))}
        </div>
      )}
    </div>
  );
}

function MLCExpanded({ mlc }) {
  return (
    <div className="ppt-card ppt-card--mlc">
      <div className="ppt-section-title">
        <span className="ppt-section-icon">⚖</span>
        MLR&nbsp;<span className="ppt-mlr">{mlc.mlrNumber}</span>
        <span className={`ppt-badge ppt-badge--${mlc.status === "Closed" ? "info" : "warn"}`}>{mlc.status}</span>
        <span className="ppt-badge ppt-badge--info">{mlc.source} · {mlc.mlcType}</span>
      </div>
      <div className="ppt-detail-grid">
        <Field label="Issued By"            value={mlc.doctorName} />
        <Field label="Recorded On"          value={fmtDateTime(mlc.createdAt)} />
        <Field label="Incident Date / Time" value={`${fmtDate(mlc.incidentDate)} ${mlc.incidentTime || ""}`} />
        <Field label="Place of Incident"    value={mlc.incidentPlace} />
        <Field label="Brought By"           value={[mlc.broughtBy, mlc.broughtByName].filter(Boolean).join(" — ")} />
        <Field label="Police Station"       value={mlc.policeStation} />
        <Field label="FIR No."              value={mlc.firNumber} mono />
        <Field label="Investigating Officer" value={mlc.investigatingOfficer} />
        <Field label="Alleged History"      value={mlc.allegedHistory} wide />
        <Field label="Provisional Diagnosis" value={mlc.provisionalDiagnosis} />
        <Field label="Disposition"          value={mlc.disposition} />
        <Field label="Doctor's Opinion"     value={mlc.opinion} wide />
        {mlc.source === "External" && (
          <>
            <Field label="External MLC No."     value={mlc.externalDetails?.externalMlcNumber} mono />
            <Field label="External Hospital"    value={mlc.externalDetails?.externalHospital} />
            <Field label="External Date"        value={fmtDate(mlc.externalDetails?.externalDate)} />
          </>
        )}
      </div>
      {(mlc.injuries || []).length > 0 && (
        <div className="ppt-mlc-injuries">
          <div className="ppt-section-sub">Injuries Documented</div>
          <table className="ppt-table ppt-table--inj">
            <thead><tr><th>#</th><th>Region</th><th>Type</th><th>Size</th><th>Age</th><th>Description</th></tr></thead>
            <tbody>
              {mlc.injuries.map((inj, i) => (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td>{inj.region || "—"}</td>
                  <td>{inj.type}</td>
                  <td>{inj.size || "—"}</td>
                  <td>{inj.ageOfInjury || "—"}</td>
                  <td>{inj.description || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ──────────────────── tiny helpers ──────────────────── */

const SKIP_NOTE_FIELDS = new Set([
  "_id","__v","createdAt","updatedAt","patient","patientName","patientUHID",
  "nurseStaffId","nurseEmployeeId","nurse","doctor","department","ipdNo",
  "noteType","noteDate","createdBy","modifiedBy","modifiedAt","auditTrail","loginUserId",
  // FIX (signature bug): these are rendered by <NoteSignature/> at the
  // bottom of every note. Listing them here keeps the raw base64 string
  // / name / reg number from showing up as a "field" inside the body.
  "signature","nurseSignature","signedByName","signedByReg","signedAt","signedByRole",
  "updatedBy",
]);

// Empty Set passed when a child needs the FULL auto-render of an object
// (e.g. noteDetails Mixed type — we want every key surfaced there).
const EMPTY_SKIP = new Set();

function KeyValueAll({ obj, skip = new Set() }) {
  const entries = Object.entries(obj || {})
    .filter(([k, v]) => !skip.has(k) && v != null && v !== "" && !(Array.isArray(v) && v.length === 0))
    .filter(([, v]) => {
      if (typeof v === "object") {
        return Object.keys(v).length > 0;
      }
      return true;
    });
  if (entries.length === 0) return <div className="ppt-note-empty">— no extra fields recorded —</div>;
  return (
    <div className="ppt-detail-grid">
      {entries.map(([k, v]) => (
        <Field key={k} label={prettyKey(k)} value={renderValue(v)} wide={typeof v === "string" && v.length > 60} />
      ))}
    </div>
  );
}

function renderValue(v) {
  if (v == null) return "—";
  if (typeof v === "string") {
    // FIX (signature bug): a base64 data URL is an embedded image, not a
    // string field — render it as an <img>. Same for /uploads/ paths and
    // remote http(s) image URLs. Anything else stays as text.
    if (v.startsWith("data:image/") || v.startsWith("/uploads/") || /^https?:\/\/.+\.(png|jpe?g|gif|webp|svg)$/i.test(v)) {
      return <img src={v} alt="" className="ppt-inline-img" />;
    }
    // ISO date strings → format. Heuristic — must look like an ISO date.
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) {
      return fmtDateTime(v);
    }
    return v;
  }
  if (typeof v === "number") return String(v);
  if (v instanceof Date) return fmtDateTime(v);
  if (Array.isArray(v)) {
    if (v.length === 0) return "—";
    if (typeof v[0] === "string" || typeof v[0] === "number") return v.join(", ");
    return v.map((x, i) => <div key={i} className="ppt-sub-row">{renderObj(x)}</div>);
  }
  if (typeof v === "object") return renderObj(v);
  return String(v);
}

function renderObj(o) {
  return Object.entries(o)
    // FIX (note rendering): drop noise — `false` defaults and empty arrays.
    // These are normally unchecked checkboxes / unfilled radios that the
    // backend stored as the schema default. They add clutter without
    // signal (e.g. "Bedsore Check: false" means the box was never ticked).
    .filter(([k, val]) => {
      if (val == null || val === "" || val === false) return false;
      if (k === "_id" || k === "__v") return false;
      if (Array.isArray(val) && val.length === 0) return false;
      if (typeof val === "object" && Object.keys(val).length === 0) return false;
      return true;
    })
    .map(([k, val]) => {
      let display;
      // Strings that are actually images → render as <img>, never as text.
      if (typeof val === "string" && (val.startsWith("data:image/") || val.startsWith("/uploads/"))) {
        display = <img src={val} alt={k} className="ppt-inline-img" />;
      } else if (typeof val === "string" && val.length > 200) {
        // Truncate absurdly long strings (very long signatures, dumps) so the
        // UI never gets bricked.
        display = `${val.slice(0, 200)}…[truncated]`;
      } else if (Array.isArray(val)) {
        // Arrays of primitives render as a clean comma-separated list — never
        // as raw JSON like `["None"]`. Arrays of objects fall back to JSON
        // (no good single-line representation) but go through the try/catch
        // below.
        if (val.length === 0) {
          display = "—";
        } else if (val.every((x) => typeof x === "string" || typeof x === "number")) {
          display = val.join(", ");
        } else {
          try { display = JSON.stringify(val); } catch { display = "[array]"; }
        }
      } else {
        // FIX (audit P27-B2): wrap JSON.stringify in try/catch — Mongoose
        // populated docs can contain circular references that would crash
        // the tab. On failure, fall back to a safe placeholder.
        try {
          display = typeof val === "object" ? JSON.stringify(val) : String(val);
        } catch {
          display = "[object]";
        }
      }
      return (
        <span key={k} className="ppt-sub-kv">
          <span className="ppt-sub-k">{prettyKey(k)}:</span>{" "}
          <span className="ppt-sub-v">{display}</span>
        </span>
      );
    });
}

function prettyKey(k) {
  return k.replace(/([a-z])([A-Z])/g, "$1 $2")
          .replace(/_/g, " ")
          .replace(/^./, (c) => c.toUpperCase());
}

function Field({ label, value, mono, wide, danger }) {
  const isEmpty = value == null || value === "" || (typeof value === "string" && value.trim() === "");
  return (
    <div className={`ppt-field ${wide ? "ppt-field--wide" : ""}`}>
      <div className="ppt-field-label">{label}</div>
      <div className={`ppt-field-value ${mono ? "ppt-mono" : ""} ${danger ? "ppt-danger" : ""}`}>
        {isEmpty ? "—" : value}
      </div>
    </div>
  );
}
