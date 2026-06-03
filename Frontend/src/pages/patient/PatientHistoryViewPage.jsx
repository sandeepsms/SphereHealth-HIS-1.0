/**
 * PatientHistoryViewPage.jsx
 * ════════════════════════════════════════════════════════════════
 * Two-tab read-only view that complements the existing
 * CompletePatientFilePage (which is one giant sectioned scroll):
 *
 *   Tab 1 — OPD History
 *     Every OPDRegistration document for the UHID, newest first,
 *     as expandable visit cards. Each card shows the complete
 *     assessment a doctor or nurse saved during that visit
 *     (chief complaint, HOPI, examination, diagnosis, prescription,
 *     advice, follow-up) along with any linked doctor/nurse notes.
 *
 *   Tab 2 — IPD File
 *     For a chosen admission (picker shown if patient has >1),
 *     every clinical artefact tied to that admission merged into
 *     a single vertical timeline sorted ASCENDING — admission day
 *     first, discharge last — grouped by date with collapsible
 *     day headers. Doctor notes, nurse notes, vitals, MAR doses,
 *     doctor orders, intake/output, consents, MLC, discharge
 *     summary, NABH register entries — all in one chronological
 *     stream.
 *
 * Route: /patient-history-view/:uhid (also accepts no param + a
 * top-bar search box that accepts UHID or IPD number).
 *
 * Permissions: shown to any role with `patient.read`. The backend
 * already enforces this — frontend never gates.
 *
 * Styling: reuses patient-file.css tokens (--pf-*) and adds a
 * page-scoped sheet for the tab chrome only. No inline JS styles
 * for the layout (per workflow_no_inline_styles.md). Decorative
 * inline styles are accepted in tiny per-row payload renders
 * matching the convention CompletePatientFilePage already uses.
 */

import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import axios from "axios";
import { API_ENDPOINTS } from "../../config/api";
import "./patient-file.css";
import "./PatientHistoryViewPage.css";

const BASE = API_ENDPOINTS.BASE;

/* ── Formatters (match patient-file.css conventions) ──────────── */
const fmtDT = (d) => {
  try {
    return d
      ? new Date(d).toLocaleString("en-IN", {
          day: "2-digit", month: "short", year: "numeric",
          hour: "2-digit", minute: "2-digit",
        })
      : "—";
  } catch { return "—"; }
};
const fmtDate = (d) => {
  try {
    return d
      ? new Date(d).toLocaleDateString("en-IN", {
          day: "2-digit", month: "short", year: "numeric", weekday: "short",
        })
      : "—";
  } catch { return "—"; }
};
const fmtTime = (d) => {
  try {
    return d
      ? new Date(d).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
      : "—";
  } catch { return "—"; }
};
const dayKey = (d) => {
  try { return new Date(d).toISOString().slice(0, 10); } catch { return ""; }
};

/* ── Kind → colour / icon for IPD timeline rows ───────────────── */
const KIND_META = {
  "admission":          { icon: "🛏",  color: "#7c3aed", label: "Admission" },
  "doctor-note":        { icon: "👨‍⚕️", color: "#7c3aed", label: "Doctor Note" },
  "nurse-note":         { icon: "👩‍⚕️", color: "#db2777", label: "Nurse Note" },
  "order":              { icon: "💊",  color: "#ea580c", label: "Doctor Order" },
  "mar":                { icon: "💉",  color: "#db2777", label: "MAR Dose" },
  "vital":              { icon: "📈",  color: "#0d9488", label: "Vitals" },
  "nursing-assessment": { icon: "📑",  color: "#db2777", label: "Nursing Assessment" },
  "care-plan":          { icon: "📋",  color: "#db2777", label: "Care Plan" },
  "handover":           { icon: "🔄",  color: "#0284c7", label: "Shift Handover" },
  "bed-transfer":       { icon: "🛏",  color: "#475569", label: "Bed Transfer" },
  "consent":            { icon: "📝",  color: "#ca8a04", label: "Consent" },
  "mlc":                { icon: "⚖",  color: "#dc2626", label: "MLC" },
  "investigation":      { icon: "🧪",  color: "#0284c7", label: "Investigation" },
  "intake-output":      { icon: "💧",  color: "#0d9488", label: "Intake / Output" },
  "diet-plan":          { icon: "🥗",  color: "#16a34a", label: "Diet Plan" },
  "bill":               { icon: "💰",  color: "#d97706", label: "Bill" },
  "billing-trigger":    { icon: "💸",  color: "#92400e", label: "Charge" },
  "discharge":          { icon: "🏥",  color: "#0d9488", label: "Discharge Summary" },
  "discharge-event":    { icon: "🚪",  color: "#0d9488", label: "Discharged" },
};

/* ── Field row helper ─────────────────────────────────────────── */
function Row({ label, value }) {
  if (value == null || value === "" || (Array.isArray(value) && !value.length)) return null;
  return (
    <div className="phv-row">
      <span className="phv-row__label">{label}</span>
      <span className="phv-row__value">{value}</span>
    </div>
  );
}

/* ── One OPD visit, expanded view of every saved field ────────── */
function OPDVisitCard({ v, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);

  const dxLine = [v.provisionalDiagnosis, v.workingDiagnosis, v.finalDiagnosis]
    .filter(Boolean).join("  →  ") || "—";

  const meds = (v.prescribedMedications || []).filter((m) => m.medicineName);
  const inv  = (v.investigationsOrdered  || []).filter((i) => i.testName);

  // Examination chips — only show ticks/values that were filled in
  const genExam = v.genExam || {};
  const sysExam = v.sysExam || {};
  const sysChips = [];
  for (const [sys, fields] of Object.entries(sysExam || {})) {
    if (!fields || typeof fields !== "object") continue;
    const bits = Object.entries(fields)
      .filter(([_, val]) => val !== "" && val !== false && val != null)
      .map(([k, val]) => `${k}=${typeof val === "boolean" ? "✓" : val}`)
      .join(" · ");
    if (bits) sysChips.push({ sys: sys.toUpperCase(), bits });
  }

  return (
    <div className={`phv-visit ${open ? "phv-visit--open" : ""}`}>
      <button className="phv-visit__head" onClick={() => setOpen(!open)} type="button">
        <div className="phv-visit__head-l">
          <span className="phv-visit__chev">{open ? "▾" : "▸"}</span>
          <span className="phv-visit__num">{v.visitNumber || "(no number)"}</span>
          <span className="phv-visit__date">{fmtDT(v.visitDate)}</span>
        </div>
        <div className="phv-visit__head-r">
          {v.department && <span className="phv-tag phv-tag--dept">{v.department}</span>}
          {v.consultantName && <span className="phv-tag phv-tag--dr">{v.consultantName}</span>}
          {v.status && <span className={`phv-tag phv-tag--status phv-status--${(v.status || "").toLowerCase().replace(/\s+/g, "-")}`}>{v.status}</span>}
        </div>
      </button>

      {open && (
        <div className="phv-visit__body">
          {/* ── Vitals strip ── */}
          {v.vitals && Object.keys(v.vitals).some((k) => v.vitals[k] != null && v.vitals[k] !== "") && (
            <div className="phv-block">
              <div className="phv-block__title">📊 Vitals</div>
              <div className="phv-vitals">
                {v.vitals.weight != null && <span className="phv-vital">Wt {v.vitals.weight} kg</span>}
                {v.vitals.height != null && <span className="phv-vital">Ht {v.vitals.height} cm</span>}
                {v.vitals.bmi    != null && <span className="phv-vital">BMI {v.vitals.bmi}</span>}
                {v.vitals.bloodPressure && <span className="phv-vital">BP {v.vitals.bloodPressure}</span>}
                {v.vitals.pulse  != null && <span className="phv-vital">P {v.vitals.pulse}</span>}
                {v.vitals.respiratoryRate != null && <span className="phv-vital">RR {v.vitals.respiratoryRate}</span>}
                {v.vitals.temperature != null && <span className="phv-vital">T {v.vitals.temperature}°F</span>}
                {v.vitals.oxygenSaturation != null && <span className="phv-vital">SpO₂ {v.vitals.oxygenSaturation}%</span>}
              </div>
              {v.vitalsEnteredBy && (
                <div className="phv-tiny">Entered by {v.vitalsEnteredBy} · {fmtDT(v.vitalsEnteredAt)}</div>
              )}
            </div>
          )}

          {/* ── Chief complaint + HOPI ── */}
          <div className="phv-block">
            <div className="phv-block__title">🩺 Chief Complaint &amp; History</div>
            <Row label="Chief Complaint" value={v.chiefComplaint} />
            <Row label="Duration" value={v.complaintDuration} />
            <Row label="HOPI Onset" value={v.hopiOnset} />
            <Row label="HOPI Duration" value={[v.hopiDurationValue, v.hopiDurationUnit].filter(Boolean).join(" ") || null} />
            <Row label="Progression" value={v.hopiProgression} />
            <Row label="Character" value={v.hopiCharacter} />
            <Row label="Associated Symptoms" value={(v.hopiAssociatedSymptoms || []).join(", ") || null} />
            <Row label="Aggravating" value={v.hopiAggravating} />
            <Row label="Relieving" value={v.hopiRelieving} />
            <Row label="Past Medical History" value={v.pastMedicalHistory} />
            <Row label="Allergy" value={v.allergyHistory} />
            <Row label="Current Medications" value={v.currentMedications} />
            {(v.chronicConditions || []).length > 0 && (
              <Row label="Chronic" value={v.chronicConditions.map((c) => c.condition + (c.duration ? ` (${c.duration})` : "")).join(", ")} />
            )}
            {v.chronicOthers && <Row label="Other Chronic" value={v.chronicOthers} />}
          </div>

          {/* ── OBG history (only if filled) ── */}
          {Object.entries(v).some(([k, val]) => k.startsWith("obg") && val !== "" && val != null) && (
            <div className="phv-block">
              <div className="phv-block__title">🌸 OBG History</div>
              <Row label="LMP"           value={v.obgLmp} />
              <Row label="EDD"           value={v.obgEdd} />
              <Row label="Menarche"      value={v.obgMenarche} />
              <Row label="Cycle (days)"  value={v.obgCycleLength} />
              <Row label="Flow (days)"   value={v.obgFlowDays} />
              <Row label="Regularity"    value={v.obgRegularity} />
              <Row label="Dysmenorrhea"  value={v.obgDysmenorrhea} />
              <Row label="Menopause"     value={v.obgMenopause} />
              <Row label="G/P/A/L"       value={[v.obgGravida, v.obgPara, v.obgAbortion, v.obgLiving].filter((x) => x !== "" && x != null).join("/") || null} />
              <Row label="Last Childbirth" value={v.obgLastChildBirth} />
              <Row label="Mode of Delivery" value={v.obgDeliveryMode} />
              <Row label="Last PAP smear" value={v.obgLastPapSmear} />
              <Row label="Last USG"      value={v.obgLastUSG} />
              <Row label="OB Complications" value={v.obgObComplications} />
              <Row label="Contraception" value={v.obgContraception} />
              <Row label="Prior Surgery" value={v.obgPriorSurgery} />
              <Row label="OBG Notes"     value={v.obgNotes} />
            </div>
          )}

          {/* ── Examination ── */}
          {(v.generalExamination || v.systemicExamination || Object.values(genExam).some(Boolean) || sysChips.length > 0) && (
            <div className="phv-block">
              <div className="phv-block__title">🔍 Examination</div>
              <Row label="General Exam (narrative)" value={v.generalExamination} />
              {Object.values(genExam).some(Boolean) && (
                <Row label="General — structured" value={Object.entries(genExam)
                  .filter(([_, val]) => val !== "" && val !== false && val != null)
                  .map(([k, val]) => `${k}: ${typeof val === "boolean" ? "✓" : val}`)
                  .join(" · ")
                } />
              )}
              <Row label="Systemic Exam (narrative)" value={v.systemicExamination} />
              {sysChips.map((s) => (
                <Row key={s.sys} label={`${s.sys}`} value={s.bits} />
              ))}
            </div>
          )}

          {/* ── Diagnosis ── */}
          <div className="phv-block">
            <div className="phv-block__title">🎯 Diagnosis</div>
            <Row label="Provisional → Working → Final" value={dxLine} />
            <Row label="ICD-10" value={[v.icd10Code, v.icd10Description].filter(Boolean).join(" — ")} />
            <Row label="Patient Status" value={v.patientStatus} />
          </div>

          {/* ── Prescriptions ── */}
          {meds.length > 0 && (
            <div className="phv-block">
              <div className="phv-block__title">💊 Prescription ({meds.length})</div>
              <table className="phv-table">
                <thead>
                  <tr><th>Medicine</th><th>Dose</th><th>Frequency</th><th>Duration</th><th>Instructions</th></tr>
                </thead>
                <tbody>
                  {meds.map((m, i) => (
                    <tr key={i}>
                      <td><b>{m.medicineName}</b></td>
                      <td>{m.dosage || "—"}</td>
                      <td>{m.frequency || "—"}</td>
                      <td>{m.duration || "—"}</td>
                      <td>{m.instructions || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Investigations ── */}
          {inv.length > 0 && (
            <div className="phv-block">
              <div className="phv-block__title">🧪 Investigations Ordered ({inv.length})</div>
              <ul className="phv-list">
                {inv.map((i, idx) => (
                  <li key={idx}>
                    <b>{i.testName}</b>{" "}
                    <span className={`phv-tag phv-status--${(i.status || "").toLowerCase()}`}>{i.status || "Pending"}</span>
                    {i.orderedDate && <span className="phv-tiny"> · {fmtDate(i.orderedDate)}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* ── Advice + Follow-up ── */}
          {(v.advice || v.dietaryRecommendations || v.followUpRequired || v.followUpDate) && (
            <div className="phv-block">
              <div className="phv-block__title">📝 Advice &amp; Follow-up</div>
              <Row label="Advice" value={v.advice} />
              <Row label="Dietary" value={v.dietaryRecommendations} />
              {v.followUpRequired && (
                <Row label="Follow-up" value={[v.followUpDate ? fmtDate(v.followUpDate) : null, v.followUpInstructions].filter(Boolean).join(" — ")} />
              )}
              <Row label="Doctor Notes" value={v.doctorNotes} />
            </div>
          )}

          {/* ── SOAP ── */}
          {(v.subjectiveNote || v.objectiveNote || v.assessmentNote || v.planNote) && (
            <div className="phv-block">
              <div className="phv-block__title">📋 SOAP Note</div>
              <Row label="S — Subjective" value={v.subjectiveNote} />
              <Row label="O — Objective"  value={v.objectiveNote} />
              <Row label="A — Assessment" value={v.assessmentNote} />
              <Row label="P — Plan"       value={v.planNote} />
              {v.assessedBy && <Row label="Assessed by" value={`${v.assessedBy} · ${fmtDT(v.assessedAt)}`} />}
            </div>
          )}

          {/* ── Linked doctor / nurse notes authored against this visit ── */}
          {(v.linkedDoctorNotes?.length || v.linkedNurseNotes?.length) > 0 && (
            <div className="phv-block">
              <div className="phv-block__title">📎 Notes authored during this visit</div>
              {v.linkedDoctorNotes?.map((n) => (
                <div key={n._id} className="phv-linked phv-linked--doc">
                  <div className="phv-linked__head">
                    <b>Dr {n.doctorName || "—"}</b> · {n.noteType || "progress"} · {fmtDT(n.visitDate || n.createdAt)}
                  </div>
                  {n.subjective && <Row label="S" value={n.subjective} />}
                  {n.objective  && <Row label="O" value={n.objective} />}
                  {n.assessment && <Row label="A" value={n.assessment} />}
                  {n.plan       && <Row label="P" value={n.plan} />}
                </div>
              ))}
              {v.linkedNurseNotes?.map((n) => (
                <div key={n._id} className="phv-linked phv-linked--nurse">
                  <div className="phv-linked__head">
                    <b>Nurse {n.nurseName || "—"}</b> · {n.noteType || "general"} · {fmtDT(n.noteDate || n.createdAt)}
                  </div>
                  {n.summary && <Row label="Summary" value={n.summary} />}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── OPD History tab body ─────────────────────────────────────── */
function OPDHistoryTab({ uhid }) {
  const [data, setData] = useState(null);
  const [err, setErr]   = useState("");

  useEffect(() => {
    if (!uhid) return;
    setData(null); setErr("");
    let cancelled = false;
    axios.get(`${BASE}/patient-history/${uhid}/opd`)
      .then((res) => { if (!cancelled) setData(res.data?.data || null); })
      .catch((e) => { if (!cancelled) setErr(e.response?.data?.message || e.message); });
    return () => { cancelled = true; };
  }, [uhid]);

  if (err)   return <div className="phv-empty">⚠ {err}</div>;
  if (!data) return <div className="phv-loading"><div className="phv-spinner" /></div>;
  if (!data.visits?.length) {
    return <div className="phv-empty">📁 No OPD visits on record for {data.patient?.UHID}.</div>;
  }

  return (
    <div className="phv-list-stack">
      <div className="phv-summary">
        <b>{data.count}</b> OPD visit{data.count === 1 ? "" : "s"} on record for{" "}
        <b>{data.patient?.fullName || data.patient?.UHID}</b>
        {data.patient?.age && <span> · {data.patient.age}y · {data.patient.gender}</span>}
      </div>
      {data.visits.map((v, i) => (
        <OPDVisitCard key={v._id} v={v} defaultOpen={i === 0} />
      ))}
    </div>
  );
}

/* ── IPD timeline event card ──────────────────────────────────── */
function TimelineEventRow({ e }) {
  const meta = KIND_META[e.kind] || { icon: "•", color: "#475569", label: e.kind };
  return (
    <div className="phv-tl-row" style={{ borderLeftColor: meta.color }}>
      <div className="phv-tl-time">{fmtTime(e.when)}</div>
      <div className="phv-tl-icon" style={{ background: `${meta.color}18`, color: meta.color }}>{meta.icon}</div>
      <div className="phv-tl-body">
        <div className="phv-tl-label">
          <span className="phv-tl-kind" style={{ color: meta.color }}>{meta.label}</span>
          {" — "}
          {e.label}
        </div>
        {/* Expand: show a one-line snippet of payload for the common kinds */}
        {e.kind === "doctor-note" && e.payload && (
          <div className="phv-tiny">
            {[e.payload.subjective, e.payload.assessment, e.payload.plan].filter(Boolean).join(" · ").slice(0, 220)}
          </div>
        )}
        {e.kind === "nurse-note" && e.payload && (
          <div className="phv-tiny">{(e.payload.summary || "").slice(0, 220)}</div>
        )}
        {e.kind === "order" && e.payload?.orderDetails && (
          <div className="phv-tiny">
            {e.payload.orderDetails.dose && `Dose: ${e.payload.orderDetails.dose} · `}
            {e.payload.orderDetails.frequency && `Freq: ${e.payload.orderDetails.frequency} · `}
            {e.payload.orderDetails.route && `Route: ${e.payload.orderDetails.route}`}
          </div>
        )}
        {e.kind === "intake-output" && e.payload && (
          <div className="phv-tiny">
            {e.payload.fluidType || ""} {e.payload.notes ? `· ${e.payload.notes}` : ""}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── IPD File tab body ────────────────────────────────────────── */
function IPDFileTab({ uhid }) {
  const [admissions, setAdmissions] = useState([]);
  const [selected, setSelected]     = useState(""); // admission._id or admissionNumber
  const [fileData, setFileData]     = useState(null);
  const [err, setErr]   = useState("");
  const [collapsed, setCollapsed]   = useState({}); // dayKey → bool

  // Step 1 — load admissions list for picker
  useEffect(() => {
    if (!uhid) return;
    let cancelled = false;
    axios.get(`${BASE}/patient-history/${uhid}/admissions`)
      .then((res) => {
        if (cancelled) return;
        const arr = res.data?.data || [];
        setAdmissions(arr);
        // Auto-select active or latest admission
        const active = arr.find((a) => a.status === "Active");
        setSelected(active?.admissionNumber || arr[0]?.admissionNumber || "");
      })
      .catch((e) => { if (!cancelled) setErr(e.response?.data?.message || e.message); });
    return () => { cancelled = true; };
  }, [uhid]);

  // Step 2 — load the chosen admission's file
  useEffect(() => {
    if (!selected) { setFileData(null); return; }
    setFileData(null); setErr("");
    let cancelled = false;
    axios.get(`${BASE}/patient-history/${encodeURIComponent(selected)}/file`)
      .then((res) => { if (!cancelled) setFileData(res.data?.data || null); })
      .catch((e) => { if (!cancelled) setErr(e.response?.data?.message || e.message); });
    return () => { cancelled = true; };
  }, [selected]);

  // Group timeline by day
  const days = useMemo(() => {
    if (!fileData?.timeline) return [];
    const map = new Map();
    for (const e of fileData.timeline) {
      const k = dayKey(e.when);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(e);
    }
    // ASC by date (already so but explicit)
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [fileData]);

  if (err)   return <div className="phv-empty">⚠ {err}</div>;
  if (!admissions.length) {
    return <div className="phv-empty">📁 No admissions on record for this patient.</div>;
  }

  return (
    <div className="phv-ipd">
      {admissions.length > 1 && (
        <div className="phv-picker">
          <label className="phv-picker__label">Admission:</label>
          <select
            className="phv-picker__select"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            {admissions.map((a) => (
              <option key={a._id} value={a.admissionNumber || a._id}>
                {a.admissionNumber} — {fmtDate(a.admissionDate)} — {a.bedNumber || a.admissionType} — {a.status}
              </option>
            ))}
          </select>
        </div>
      )}

      {!fileData ? <div className="phv-loading"><div className="phv-spinner" /></div> : (
        <>
          <div className="phv-summary">
            <b>{fileData.admission?.admissionNumber}</b> ·{" "}
            {fileData.patient?.fullName} ({fileData.admission?.UHID}) ·{" "}
            Admitted {fmtDate(fileData.admission?.admissionDate)} ·{" "}
            Bed {fileData.admission?.bedNumber || "—"} ·{" "}
            <span className={`phv-tag phv-status--${(fileData.admission?.status || "").toLowerCase()}`}>
              {fileData.admission?.status}
            </span>{" "}
            · <b>{fileData.counts?.totalEvents}</b> events across{" "}
            <b>{days.length}</b> day{days.length === 1 ? "" : "s"}
          </div>

          {/* Counts strip */}
          <div className="phv-counts">
            {Object.entries(fileData.counts || {})
              .filter(([k, v]) => v > 0 && k !== "totalEvents")
              .map(([k, v]) => (
                <span key={k} className="phv-count-pill">
                  <b>{v}</b> {k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase())}
                </span>
              ))}
          </div>

          {/* Day-grouped timeline */}
          <div className="phv-tl">
            {days.map(([k, events]) => {
              const isCollapsed = collapsed[k];
              return (
                <div key={k} className="phv-tl-day">
                  <button
                    className="phv-tl-day__head"
                    onClick={() => setCollapsed((c) => ({ ...c, [k]: !c[k] }))}
                    type="button"
                  >
                    <span className="phv-tl-day__chev">{isCollapsed ? "▸" : "▾"}</span>
                    <span className="phv-tl-day__date">{fmtDate(k)}</span>
                    <span className="phv-tl-day__count">{events.length} event{events.length === 1 ? "" : "s"}</span>
                  </button>
                  {!isCollapsed && (
                    <div className="phv-tl-day__body">
                      {events.map((e, i) => (
                        <TimelineEventRow key={i} e={e} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

/* ── Top-bar search box ────────────────────────────────────────
   R7gq — search by UHID, IPD number, NAME, or MOBILE.
   - UHID typed (UH…) or admission number (ADM… / IPD-…) → direct route
     on Enter / "Open File" (existing R7bu behaviour).
   - Everything else (name fragment, phone number, partial name) →
     debounced live search against /api/patients/search which already
     searches name + UHID + phone server-side. Matching patients show
     as a dropdown; clicking one opens that patient's file.
*/
function SearchBox({ initial = "", onResolve }) {
  const [q, setQ] = useState(initial);
  const [results, setResults] = useState([]);   // [{_id, UHID, fullName, age, gender, contactNumber}]
  const [loading, setLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [hi, setHi] = useState(-1);             // keyboard highlight index
  const navigate = useNavigate();

  // Distinguish identifier-style queries from free-text. UHIDs and
  // admission numbers go straight through; everything else hits the
  // /search endpoint.
  const isIdentifier = (s) => /^UH/i.test(s) || /^ADM/i.test(s) || /^IPD-/i.test(s);

  // Debounced live search for name/phone queries (≥ 2 chars).
  useEffect(() => {
    const v = (q || "").trim();
    if (!v || v.length < 2 || isIdentifier(v)) {
      setResults([]); setShowDropdown(false); return;
    }
    let cancelled = false;
    setLoading(true);
    const handle = setTimeout(() => {
      axios.get(`${BASE}/patients/search`, { params: { q: v, limit: 10 } })
        .then((res) => {
          if (cancelled) return;
          const list = res.data?.data || [];
          setResults(list);
          setShowDropdown(list.length > 0);
          setHi(list.length ? 0 : -1);
        })
        .catch(() => { if (!cancelled) { setResults([]); setShowDropdown(false); } })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 250);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [q]);

  const openByUHID = (uhid) => navigate(`/patient-history-view/${uhid}`);

  const submit = (e) => {
    e?.preventDefault?.();
    const v = (q || "").trim();
    if (!v) return;

    // Keyboard pick from dropdown
    if (showDropdown && results[hi]) {
      openByUHID(results[hi].UHID);
      setShowDropdown(false);
      return;
    }

    // Smart routing — identifier paths first
    if (/^UH/i.test(v)) {
      openByUHID(v.toUpperCase());
    } else if (/^ADM|^IPD-/i.test(v)) {
      axios.get(`${BASE}/patient-history/${encodeURIComponent(v)}/file`)
        .then((res) => {
          const adm = res.data?.data?.admission;
          if (adm?.UHID) {
            navigate(`/patient-history-view/${adm.UHID}?admission=${encodeURIComponent(adm.admissionNumber || v)}&tab=ipd`);
          }
        })
        .catch(() => { navigate(`/patient-history-view/${v}`); });
    } else if (results[0]) {
      // Name / phone Enter with results visible → open the top match.
      openByUHID(results[0].UHID);
    }
  };

  // Keyboard nav within the results dropdown
  const onKeyDown = (e) => {
    if (!showDropdown || !results.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHi((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHi((i) => Math.max(0, i - 1));
    } else if (e.key === "Escape") {
      setShowDropdown(false);
    }
  };

  return (
    <form className="phv-search" onSubmit={submit} autoComplete="off">
      <div className="phv-search__inputwrap" style={{ position: "relative", flex: 1 }}>
        <input
          className="phv-search__input"
          placeholder="Search by UHID, IPD number, patient name, or mobile (min 2 chars)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => { if (results.length) setShowDropdown(true); }}
          onBlur={() => { setTimeout(() => setShowDropdown(false), 180); }}
          autoFocus={!initial}
        />
        {loading && (
          <span style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", fontSize: 11, color: "#64748b" }}>
            Searching…
          </span>
        )}
        {showDropdown && results.length > 0 && (
          <div
            className="phv-search__dropdown"
            style={{
              position: "absolute", top: "100%", left: 0, right: 0, zIndex: 50,
              background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8,
              marginTop: 4, boxShadow: "0 10px 28px rgba(15,23,42,.12)",
              maxHeight: 360, overflowY: "auto",
            }}
            role="listbox"
          >
            {results.map((p, i) => (
              <div
                key={p._id || p.UHID}
                role="option"
                aria-selected={i === hi}
                onMouseDown={(ev) => { ev.preventDefault(); openByUHID(p.UHID); }}
                onMouseEnter={() => setHi(i)}
                style={{
                  display: "flex", gap: 10, alignItems: "center",
                  padding: "9px 12px",
                  background: i === hi ? "#f5f3ff" : "#fff",
                  borderBottom: "1px solid #f1f5f9",
                  cursor: "pointer",
                }}
              >
                <div style={{
                  width: 32, height: 32, borderRadius: "50%",
                  background: "#ede9fe", color: "#5b21b6",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontWeight: 700, fontSize: 12, flexShrink: 0,
                }}>
                  {(p.fullName || "?").trim().split(/\s+/).slice(0, 2).map((s) => (s || "")[0]).join("").toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: "#0f172a" }}>
                    {p.fullName || "(no name)"}
                  </div>
                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 1 }}>
                    {p.UHID}
                    {p.age != null && ` · ${p.age}y`}
                    {p.gender && ` · ${p.gender}`}
                    {p.contactNumber && ` · ☎ ${p.contactNumber}`}
                  </div>
                </div>
                <span style={{ fontSize: 10, color: "#7c3aed", fontWeight: 600, letterSpacing: ".3px" }}>OPEN →</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <button type="submit" className="phv-search__btn">🔎 Open File</button>
    </form>
  );
}

/* ── Top-level page component ─────────────────────────────────── */
export default function PatientHistoryViewPage() {
  const { uhid } = useParams();
  const [search, setSearch] = useSearchParams();
  const navigate = useNavigate();
  const tab = (search.get("tab") || "opd").toLowerCase();

  // Header summary for the patient (one cheap call to /patients/uhid/:uhid).
  const [patient, setPatient] = useState(null);
  useEffect(() => {
    if (!uhid) return;
    axios.get(`${BASE}/patients/uhid/${uhid}`)
      .then((res) => setPatient(res.data?.data || res.data || null))
      .catch(() => setPatient(null));
  }, [uhid]);

  const setTab = (t) => {
    const nx = new URLSearchParams(search);
    nx.set("tab", t);
    setSearch(nx, { replace: true });
  };

  if (!uhid) {
    return (
      <div className="phv-page">
        <div className="phv-container">
          <h2 className="phv-h1">Patient File — OPD History &amp; IPD File</h2>
          <p className="phv-lead">
            Find a patient's complete record. Search by UHID, IPD/admission number,
            patient name, or mobile.
          </p>
          <SearchBox />
        </div>
      </div>
    );
  }

  return (
    <div className="phv-page">
      <div className="phv-container">
        {/* Header */}
        <div className="phv-header">
          <div className="phv-header__id">
            <div className="phv-header__avatar">
              {(patient?.fullName || "?").trim().split(/\s+/).slice(0, 2).map((p) => (p || "")[0]).join("").toUpperCase()}
            </div>
            <div>
              <div className="phv-header__name">
                {patient?.title ? patient.title + " " : ""}{patient?.fullName || "Patient"}
              </div>
              <div className="phv-header__sub">
                UHID {patient?.UHID || uhid}
                {patient?.age && ` · ${patient.age}y`}
                {patient?.gender && ` · ${patient.gender}`}
                {patient?.bloodGroup && ` · ${patient.bloodGroup}`}
                {patient?.contactNumber && ` · ☎ ${patient.contactNumber}`}
              </div>
            </div>
          </div>
          <div className="phv-header__actions">
            <button className="phv-btn" onClick={() => navigate(-1)}>← Back</button>
            <button className="phv-btn" onClick={() => navigate(`/patient-file/${uhid}`)}>
              📁 Full File View
            </button>
            <button className="phv-btn phv-btn--solid" onClick={() => window.print()}>
              🖨 Print
            </button>
          </div>
        </div>

        {/* Re-search box always available */}
        <SearchBox initial="" />

        {/* Tab bar */}
        <div className="phv-tabs" role="tablist">
          <button
            className={`phv-tab ${tab === "opd" ? "phv-tab--active" : ""}`}
            role="tab" aria-selected={tab === "opd"}
            onClick={() => setTab("opd")}
            type="button"
          >
            🩺 OPD History
          </button>
          <button
            className={`phv-tab ${tab === "ipd" ? "phv-tab--active" : ""}`}
            role="tab" aria-selected={tab === "ipd"}
            onClick={() => setTab("ipd")}
            type="button"
          >
            🛏 IPD File (chronological)
          </button>
        </div>

        {/* Tab body */}
        <div className="phv-tab-body">
          {tab === "opd" ? <OPDHistoryTab uhid={uhid} /> : <IPDFileTab uhid={uhid} />}
        </div>
      </div>
    </div>
  );
}
