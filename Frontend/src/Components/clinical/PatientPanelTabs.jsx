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

/* ──────────────────────── Formatters ───────────────────────── */
const fmtDateTime = (d) =>
  d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

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

      {/* Doctor initial assessment */}
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
          docInitial.map((n) => <DoctorNoteExpanded key={n._id} note={n} />)
        )}
      </div>

      {/* Nurse initial assessment */}
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
          nurseInitial.map((n) => <NurseNoteExpanded key={n._id} note={n} />)
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
export function MLCOrDoctorNotesTab({ patient, doctorNotes = [] }) {
  const [mlcList, setMlcList]   = useState([]);
  const [loading, setLoading]   = useState(false);
  const uhid = patient?.UHID;

  useEffect(() => {
    if (!uhid) return;
    setLoading(true);
    axios.get(`${API_ENDPOINTS.MLC}?UHID=${encodeURIComponent(uhid)}&limit=50`)
      .then((r) => setMlcList(r.data?.data || []))
      .catch(() => setMlcList([]))
      .finally(() => setLoading(false));
  }, [uhid]);

  const hasMLC = mlcList.length > 0;
  const nonInitialDocNotes = doctorNotes.filter(
    (n) => n.noteType !== "initial" && n.noteType !== "initialAssessment",
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
            : "Doctor's clinical notes — daily progress, ICU, procedure, consultation, pre/post-op, etc."}
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
          nonInitialDocNotes
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
            .map((n) => <DoctorNoteExpanded key={n._id} note={n} />)
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
export function NursingNotesExpandedTab({ nursingNotes = [] }) {
  const grouped = useMemo(() => {
    const m = {};
    nursingNotes
      .filter((n) => n.noteType !== "initial" && n.noteType !== "initialAssessment")
      .forEach((n) => {
        const t = n.noteType || "general";
        (m[t] ||= []).push(n);
      });
    return m;
  }, [nursingNotes]);

  const ORDER = [
    ["general",    "📋 General Nursing Notes"],
    ["vitals",     "📈 Vital Signs"],
    ["pain",       "😣 Pain Assessment"],
    ["neuro",      "🧠 Neuro / GCS"],
    ["intake",     "💧 Intake / Output"],
    ["iv",         "🩸 IV Infusion"],
    ["blood",      "🩸 Blood Transfusion"],
    ["wound",      "🩹 Wound / Dressing"],
    ["skin",       "🌡️ Skin / Pressure"],
    ["fall",       "⚠️ Fall Risk (Morse)"],
    ["procedure",  "⚙️ Procedure / Intervention"],
    ["discharge",  "📤 Discharge / SBAR"],
    ["mews",       "📊 MEWS Score"],
    ["daily",      "🗓️ Daily Assessment"],
  ];

  const totalShown = ORDER.reduce((acc, [k]) => acc + (grouped[k]?.length || 0), 0);

  return (
    <div className="ppt-tab">
      <div className="ppt-tab-header">
        <h2 className="ppt-tab-title">📝 Nursing Notes — All Categories</h2>
        <p className="ppt-tab-sub">All nursing records fully expanded for review and printing · {totalShown} record(s)</p>
      </div>

      {ORDER.map(([key, label]) => {
        const items = grouped[key] || [];
        if (!items.length) return null;
        return (
          <div key={key} className="ppt-card">
            <div className="ppt-section-title">
              {label}
              <span className="ppt-badge ppt-badge--info">{items.length}</span>
            </div>
            {items
              .sort((a, b) => new Date(b.noteDate || b.createdAt) - new Date(a.noteDate || a.createdAt))
              .map((n) => <NurseNoteExpanded key={n._id} note={n} />)}
          </div>
        );
      })}

      {totalShown === 0 && (
        <div className="ppt-empty">No nursing notes recorded yet.</div>
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
    return [...vNotes, ...vsRows].sort((a, b) => new Date(b.when) - new Date(a.when));
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
  const rows = useMemo(() => {
    return nursingNotes
      .filter((n) => n.intakeOutput && (n.intakeOutput.oral || n.intakeOutput.ivFluids || n.intakeOutput.urineOutput || n.intakeOutput.otherOutput))
      .map((n) => {
        const io = n.intakeOutput || {};
        const intake = (io.oral || 0) + (io.ivFluids || 0);
        const output = (io.urineOutput || 0) + (io.otherOutput || 0);
        return {
          _id: n._id,
          when: n.noteDate || n.createdAt,
          by:   n.nurseName || "—",
          shift: n.shift || "—",
          oral: io.oral || 0,
          iv:   io.ivFluids || 0,
          urine:io.urineOutput || 0,
          other:io.otherOutput || 0,
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

  // Antidiabetic medications administered
  const ANTIDIABETIC_RE = /insulin|glucose|dextrose|metformin|glimepiride|gliclazide|sitagliptin|sugar/i;
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

/* ════════════════════════════════════════════════════════════════
   Building blocks — DoctorNoteExpanded, NurseNoteExpanded, MLCExpanded
   ════════════════════════════════════════════════════════════════ */

function DoctorNoteExpanded({ note }) {
  const TYPE_LABELS = {
    initial:"Initial Assessment", medication:"Medication Order", infusion:"Infusion Order",
    daily:"Daily Progress", icu:"ICU / Critical Care", procedure:"Procedure Note",
    consultation:"Consultation", preop:"Pre-operative", postop:"Post-operative",
    death:"Death Note", amendment:"Amendment", initialAssessment:"Initial Assessment",
  };
  return (
    <div className="ppt-note ppt-note--doctor">
      <div className="ppt-note-head">
        <span className="ppt-note-type">{TYPE_LABELS[note.noteType] || note.noteType || "Note"}</span>
        <span className="ppt-note-meta">
          {note.doctorName || "Doctor"} · {fmtDateTime(note.createdAt || note.noteDate)}
          {note.status && <span className={`ppt-note-status ppt-note-status--${note.status}`}>{note.status}</span>}
        </span>
      </div>
      <KeyValueAll obj={note} skip={SKIP_NOTE_FIELDS} />
    </div>
  );
}

function NurseNoteExpanded({ note }) {
  return (
    <div className="ppt-note ppt-note--nurse">
      <div className="ppt-note-head">
        <span className="ppt-note-type">{note.noteType || "general"}</span>
        <span className="ppt-note-meta">
          {note.nurseName || "Nurse"} · {note.shift || "shift"} · {fmtDateTime(note.noteDate || note.createdAt)}
        </span>
      </div>
      <KeyValueAll obj={note} skip={SKIP_NOTE_FIELDS} />
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
]);

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
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (v instanceof Date) return fmtDateTime(v);
  if (Array.isArray(v)) {
    if (v.length === 0) return "—";
    if (typeof v[0] === "string") return v.join(", ");
    return v.map((x, i) => <div key={i} className="ppt-sub-row">{renderObj(x)}</div>);
  }
  if (typeof v === "object") return renderObj(v);
  return String(v);
}

function renderObj(o) {
  return Object.entries(o)
    .filter(([k, val]) => val != null && val !== "" && k !== "_id")
    .map(([k, val]) => (
      <span key={k} className="ppt-sub-kv">
        <span className="ppt-sub-k">{prettyKey(k)}:</span>{" "}
        <span className="ppt-sub-v">{typeof val === "object" ? JSON.stringify(val) : String(val)}</span>
      </span>
    ));
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
